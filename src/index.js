const API = "https://discord.com/api/v10";
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

async function verifyDiscordRequest(request, publicKey) {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp || !publicKey) return false;
  const body = await request.clone().text();
  const hexToBytes = (hex) => Uint8Array.from(hex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return crypto.subtle.verify("Ed25519", key, hexToBytes(signature), new TextEncoder().encode(timestamp + body));
  } catch { return false; }
}

async function discord(env, path, options = {}) {
  return fetch(`${API}${path}`, {
    ...options,
    headers: { authorization: `Bot ${env.DISCORD_TOKEN}`, "content-type": "application/json", ...(options.headers || {}) }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, service: "discord-moderator" });
    if (url.pathname === "/interactions" && request.method === "POST") {
      if (!(await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY))) return new Response("Invalid signature", { status: 401 });
      const interaction = await request.json();
      if (interaction.type === 1) return json({ type: 1 });
      if (interaction.type === 2) {
        const command = interaction.data?.name;
        if (command === "setup") {
          const guildId = interaction.guild_id;
          await env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName(guildId)).fetch("https://do/config", { method: "POST", body: JSON.stringify({ guildId }) });
          return json({ type: 4, data: { content: "Configuration initialisée. Utilise les variables d’environnement ou les commandes d’administration pour personnaliser le bot.", flags: 64 } });
        }
        if (command === "ping") return json({ type: 4, data: { content: "Pong — bot actif sur Cloudflare Workers." } });
      }
      return json({ type: 4, data: { content: "Commande non configurée.", flags: 64 } });
    }
    if (url.pathname === "/gateway/start" && request.method === "POST") {
      const providedKey = request.headers.get("X-Admin-Key");
      if (!env.ADMIN_START_KEY || providedKey !== env.ADMIN_START_KEY) return new Response("Unauthorized", { status: 401 });
      const id = env.DISCORD_GATEWAY.idFromName("global");
      return env.DISCORD_GATEWAY.get(id).fetch("https://do/start", { method: "POST" });
    }
    return json({ error: "Not found" }, 404);
  }
};

export class DiscordGateway {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.buckets = new Map();
    this.config = { spamLimit: 6, spamWindowMs: 8000, raidLimit: 4, raidWindowMs: 10000 };
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/config" && request.method === "POST") {
      const incoming = await request.json();
      this.config = { ...this.config, ...incoming };
      await this.state.storage.put("config", this.config);
      return json({ ok: true, config: this.config });
    }
    if (path === "/start") {
      this.config = (await this.state.storage.get("config")) || this.config;
      this.connectGateway();
      return json({ ok: true, started: true });
    }
    return json({ error: "Not found" }, 404);
  }

  connectGateway() {
    if (this.gateway) return;
    try {
      const ws = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");
      this.gateway = ws;
      ws.addEventListener("message", (event) => this.onGatewayMessage(JSON.parse(event.data)));
      ws.addEventListener("close", () => { this.gateway = null; setTimeout(() => this.connectGateway(), 5000); });
      ws.addEventListener("error", () => { try { ws.close(); } catch {} });
    } catch { this.gateway = null; }
  }

  onGatewayMessage(packet) {
    if (packet.op === 10) {
      const identify = {
        op: 2,
        d: { token: this.env.DISCORD_TOKEN, intents: 1 | 2 | 16 | 512 | 32768, properties: { os: "cloudflare", browser: "discord-cloudflare-moderator", device: "discord-cloudflare-moderator" } }
      };
      this.gateway.send(JSON.stringify(identify));
      return;
    }
    if (packet.op === 1) { this.gateway.send(JSON.stringify({ op: 1, d: packet.s ?? null })); return; }
    if (packet.op === 7 || packet.op === 9) { try { this.gateway.close(); } catch {} return; }
    if (packet.op === 0) this.handleDispatch(packet.t, packet.d).catch(() => {});
  }

  async handleDispatch(type, data) {
    if (type === "MESSAGE_CREATE") await this.handleMessage(data);
    if (type === "GUILD_MEMBER_ADD") await this.handleMemberAdd(data);
    if (type === "GUILD_MEMBER_REMOVE") await this.handleMemberRemove(data);
    if (type === "GUILD_CREATE") await this.updateMemberCounter(data.id, data.member_count);
    if (type === "GUILD_MEMBER_UPDATE") return;
    if (type === "GUILD_AUDIT_LOG_ENTRY_CREATE") await this.handleAuditEntry(data);
  }

  async handleMessage(message) {
    if (!message.guild_id || message.author?.bot) return;
    const key = `${message.guild_id}:${message.author.id}`;
    const now = Date.now();
    const list = (this.buckets.get(key) || []).filter((time) => now - time < this.config.spamWindowMs);
    list.push(now); this.buckets.set(key, list);
    if (list.length >= this.config.spamLimit) {
      await discord(this.env, `/channels/${message.channel_id}/messages/${message.id}`, { method: "DELETE" });
      await discord(this.env, `/guilds/${message.guild_id}/members/${message.author.id}`, { method: "PATCH", body: JSON.stringify({ communication_disabled_until: new Date(now + 60_000).toISOString() }) });
      await discord(this.env, `/channels/${message.channel_id}/messages`, { method: "POST", body: JSON.stringify({ content: `<@${message.author.id}> a été temporairement limité pour spam.` }) });
      this.buckets.delete(key);
    }
  }

  async handleMemberAdd(member) {
    const channelId = await this.state.storage.get(`welcome:${member.guild_id}`);
    if (channelId) await discord(this.env, `/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ content: `Bienvenue <@${member.user.id}> sur le serveur !` }) });
  }

  async handleMemberRemove(member) {
    const channelId = await this.state.storage.get(`goodbye:${member.guild_id}`);
    if (channelId) await discord(this.env, `/channels/${channelId}/messages`, { method: "POST", body: JSON.stringify({ content: `${member.user?.username || "Un membre"} a quitté le serveur.` }) });
  }

  async handleAuditEntry(entry) {
    if (!entry.guild_id || !entry.user_id) return;
    const key = `audit:${entry.guild_id}:${entry.user_id}`;
    const now = Date.now();
    const list = (this.buckets.get(key) || []).filter((time) => now - time < this.config.raidWindowMs);
    list.push(now); this.buckets.set(key, list);
    if (list.length >= this.config.raidLimit) {
      await discord(this.env, `/guilds/${entry.guild_id}/members/${entry.user_id}`, { method: "PATCH", body: JSON.stringify({ communication_disabled_until: new Date(now + 600_000).toISOString() }) });
      this.buckets.delete(key);
    }
  }

  async updateMemberCounter(guildId, count) {
    const channelId = await this.state.storage.get(`counter:${guildId}`);
    if (!channelId || count == null) return;
    await discord(this.env, `/channels/${channelId}`, { method: "PATCH", body: JSON.stringify({ name: `Membres : ${count}` }) });
  }
}
