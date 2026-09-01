# Discord Cloudflare Moderator

Bot Discord JavaScript conçu pour Cloudflare Workers et Durable Objects. Il fournit une base pour l’anti-spam, l’anti-nuke, les messages de bienvenue et de départ, ainsi qu’un compteur de membres dans un salon vocal renommé automatiquement.

> Important : le token Discord ne doit jamais être ajouté à GitHub. Il doit être enregistré comme secret Cloudflare.

## Fonctionnement

Le Worker reçoit les interactions Discord sur `/interactions`. Le Durable Object conserve l’état et ouvre la connexion temps réel avec la Gateway Discord. La version initiale utilise une limitation temporaire pour les comportements de spam et une réaction automatique aux rafales d’entrées d’audit. Les actions de suppression, de timeout et de renommage exigent que le rôle du bot dispose des permissions correspondantes.

## Installation locale

Installe Node.js 20 ou une version plus récente, puis lance :

```bash
npm install
npx wrangler login
```

Ajoute les secrets sans les écrire dans les fichiers :

```bash
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put ADMIN_START_KEY
```

Pour enregistrer les commandes slash sur un serveur de test :

```bash
DISCORD_APPLICATION_ID="..." DISCORD_TOKEN="..." DISCORD_GUILD_ID="..." npm run register
```

Déploie ensuite le Worker :

```bash
npm run deploy
```

Dans le Developer Portal Discord, renseigne l’URL suivante comme **Interactions Endpoint URL** :

```text
https://TON-NOM.workers.dev/interactions
```

Active au minimum les intents **Message Content**, **Server Members** et **Guild Moderation** selon les besoins affichés dans le portail. Invite le bot avec les permissions `View Channels`, `Send Messages`, `Manage Messages`, `Moderate Members`, `Manage Channels` et `View Audit Log`. N’accorde `Administrator` que si tu acceptes le risque associé.

## Démarrage de la Gateway

Après le déploiement, appelle une seule fois l’endpoint protégé de démarrage dans un environnement sûr :

```bash
curl -X POST https://TON-NOM.workers.dev/gateway/start -H "X-Admin-Key: TA_CLE_ADMIN"
```

Pour une version de production, protège cet endpoint par une clé d’administration avant de le rendre accessible publiquement.

## GitHub

Crée un dépôt vide sur GitHub, puis exécute :

```bash
git init
git add .
git commit -m "Initial Discord moderation bot"
git branch -M main
git remote add origin https://github.com/TON-COMPTE/discord-cloudflare-moderator.git
git push -u origin main
```

Le fichier `.gitignore` doit exclure `.dev.vars`, `.env`, les journaux et les fichiers générés. Vérifie toujours l’historique Git avant publication afin qu’aucun secret ne soit présent.

## Limites à connaître

Cloudflare Workers peut accueillir les interactions HTTP et les Durable Objects peuvent gérer des WebSockets, mais la Gateway Discord reste plus exigeante qu’un simple bot HTTP. Il faut donc surveiller les reconnexions, les limites de requêtes, les permissions et les limites du forfait Cloudflare. Pour un serveur important, une instance Node.js toujours active restera généralement plus simple à maintenir.
