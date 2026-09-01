const appId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!appId || !token) throw new Error("DISCORD_APPLICATION_ID et DISCORD_TOKEN sont requis");

const commands = [
  { name: "ping", description: "Vérifie que le bot répond" },
  { name: "setup", description: "Initialise la configuration de sécurité du serveur" }
];

const endpoint = guildId
  ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${appId}/commands`;

const response = await fetch(endpoint, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands)
});

if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
console.log("Commandes enregistrées avec succès.");
