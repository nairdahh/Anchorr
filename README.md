# Jellycorrd

![Jellycorrd logo](./assets/logo.png)

**Jellycorrd** — a small Discord bot that lets you request movies/TV via Jellyseerr and receives Jellyfin/Jellyseerr "item added" notifications in Discord.  
Use slash commands to search/request (TMDB-backed) and get pretty embeds when content shows up on your server.

## Features

- `/search <title>` — search TMDB and show details in an embed; from the embed you can Request.
- `/request <title>` — send a request immediately to Jellyseerr.
- Receives Jellyfin-style webhooks and posts Add notifications into a configured Discord channel (embed with director, short summary, runtime, rating, and quick buttons).
- Optional OMDb lookup for IMDb rating / director / actors.

## Quickstart — self-host (recommended for most users)

This project is intended to be self-hosted by each user (so everyone keeps their own API keys).
The bot will also available as a hosted Discord bot (maintainer-hosted) soon.

1. **Clone the repo**
   bash
   git clone https://github.com/nairdahh/jellycorrd.git
   cd jellycorrd

2. **Copy and fill .env**
   cp .env.example .env

3. **Run with Node (dev)**
   npm install
   node app.js

4. **Or run with Docker Compose**
   docker compose up -d --build

5. **Set up Jellyfin webhook**
   In Jellyfin (server settings → Webhooks) add your webhook URL:
   http://<your-host-ip>:<WEBHOOK_PORT>/jellyfin-webhook
   Example: http://192.168.1.100:8282/jellyfin-webhook

6. **Invite bot to your server**
   Create a Discord Application, create a Bot, copy the DISCORD_TOKEN to .env
   Generate an invite link with scopes bot and applications.commands. Give minimal permissions (Send Messages, Embed Links).

## Commands & usage

    /search <title> — opens interactive embed; use the Request button to send to Jellyseerr.
    /request <title> — instantly request the title.

    When Jellyfin (or your add pipeline) sends a webhook to http://<host>:<port>/jellyfin-webhook, the bot will post the notification to the configured Discord channel.

## Publishing & Docker (optional)

    A Dockerfile is provided in the repo. Use docker compose up -d to run.

    Keep secrets out of the repo (use .env only).

    GitHub Actions can be set up to build/push images to GHCR or Docker Hub.

## ontributing

    Contributions welcome. Keep PRs small and focused. Please open an issue or PR for:
    - bugfixes
    - packaging improvements (Docker Compose)
    - adding per-guild settings (DB-backed)
    - building a web dashboard for settings

## License

This repo is released under the Unlicense — public domain. Do anything with the code.
(If you want a LICENSE file, create one and paste the Unlicense text.)
