<p align="center">
  <img src="./assets/logo-text.png" alt="Anchorr logo-text"/>
</p>

# Anchorr

**Anchorr** — a small Discord bot that lets you request movies/TV via Jellyseerr and receives Jellyfin "item added" notifications in Discord.  
Use slash commands to search/request (TMDB and OMDB-backed) and get pretty embeds when content shows up on your server.

## Features

- `/search <title>` — search TMDB and show details in an embed; from the embed you can Request.
- `/request <title>` — send a request immediately to Jellyseerr.
- Receives Jellyfin-style webhooks and posts Add notifications into a configured Discord channel (embed with director, short summary, runtime, rating, and quick buttons).
- Optional OMDb lookup for IMDb rating / director / actors.

## Prerequisites

Before you begin, ensure you have the following:

- A running **Jellyfin** server.
- A running **Jellyseerr** instance.
- A **Discord account** and a server where you have administrative privileges.
- API keys from:
  - **The Movie Database (TMDB)**
  - **OMDb API** (Optional, but recommended for richer data)
- **Node.js** (version 18.x or later).
- **Docker** and **Docker Compose** (if you choose the Docker installation method).

## Setup Guide

This project is intended to be self-hosted by each user (so everyone keeps their own API keys).  
The bot will also available as a hosted Discord bot (maintainer-hosted) soon.

### Step 1: Create & Configure the Discord Bot

Before installing `anchorr`, you need to create an application and a bot user in the Discord Developer Portal.

1.  **Go to the [Discord Developer Portal](https://discord.com/developers/applications)** and log in.
2.  Click the **"New Application"** button in the top-right corner. Give it a name and accept the terms.
3.  In the left-hand menu, navigate to the **"Bot"** section.
4.  Click the **"Add Bot"** button and confirm the action.
5.  Under the bot's username, click **"Reset Token"** to generate the bot's secret key. Copy this token. **Keep this token secure and do not share it with anyone!** You will need it shortly.
6.  Now, let's generate the invite link. Go to **"OAuth2"** -> **"URL Generator"**.
7.  In the **"SCOPES"** section, check the boxes for `bot` and `applications.commands`.
8.  A new **"BOT PERMISSIONS"** section will appear below. Grant the following minimum permissions:
    - **Send Messages**
    - **Embed Links**
9.  Copy the generated URL at the bottom of the page, open it in a new browser tab, and invite the bot to your Discord server.

### Step 2: Install the Jellyfin Webhook Plugin

For Jellyfin to be able to send notifications to the bot, you need the official Webhooks plugin.

1.  Log in to your Jellyfin interface with an administrator account.
2.  Navigate to **Dashboard** -> **Plugins**.
3.  Go to the **"Catalog"** tab and search for the plugin named **Webhooks**.
4.  Click on it and install it.
5.  After the installation is complete, **restart your Jellyfin server** to activate the plugin.

### Step 3: Download & Configure the Bot

Now we will download the source code and set up the environment variables.

1.  **Clone the repository** into a folder of your choice:
    ```bash
    git clone https://github.com/nairdahh/anchorr.git
    cd anchorr
    ```
2.  **Create and configure the `.env` file**. Copy the example file and open it with a text editor.
    ```bash
    cp .env.example .env
    ```
3.  Edit the `.env` file and fill in the required variables.

### Step 4: Run the Bot (Choose a method)

You can run the bot directly using Node.js or through a Docker container.

#### Option 1: Run with Node.js (for development)

This method is ideal if you want to modify the code or debug. It requires **Node.js** and **npm** to be installed.

1.  **Install the project dependencies**:
    ```bash
    npm install
    ```
2.  **Start the bot**:
    ```bash
    node app.js
    ```

#### Option 2: Run with Docker Compose (recommended)

This is the recommended method for most users as it simplifies dependency management. It requires **Docker** and **Docker Compose** to be installed.

1.  **Build and start the container** in the background:
    ```bash
    docker compose up -d --build
    ```

### Step 5: Connect Jellyfin to the Bot

The final step is to configure Jellyfin to send events to your running bot.

1.  Go back to your **Jellyfin Dashboard** -> **Webhooks** (the section will appear in the menu after the plugin is installed).
2.  Click the **`+`** button to add a new webhook.
3.  In the **URL** field, enter the IP address of the machine where the bot is running, followed by the port set in `.env` and the webhook path. The format is:
    `http://<your-host-ip>:<WEBHOOK_PORT>/jellyfin-webhook`
4.  **Example**: If the bot is running on a machine with the local IP `192.168.1.100` and you left the port as `8282` in your `.env` file, the URL will be:
    ```
    http://192.168.1.100:8282/jellyfin-webhook
    ```
5.  Choose which notifications you want to receive, save, and you're all set! Your bot is now fully configured.

## Configuration

Anchorr is configured using a `.env` file. Copy the `.env.example` to `.env` and fill in the values:

- `DISCORD_TOKEN`: Your **bot's unique token**. Think of it as the bot's password. You can get this from the "Bot" section of your application in the Discord Developer Portal.
- `BOT_ID`: The **Client ID of your bot**. Find this on the "General Information" page of your Discord application.
- `GUILD_ID`: The **ID of the Discord server** where you will use the bot. Enable Developer Mode in Discord, then right-click your server icon and "Copy Server ID".
- `JELLYSEERR_URL`: The full **URL to your Jellyseerr API**. The correct value depends on your setup. **Make sure to include `/api/v1` at the end**.

  - **If running the bot directly with Node.js (without Docker):**

    - If Jellyseerr is on the **same machine**, use localhost: `JELLYSEERR_URL=http://localhost:5055/api/v1`

    - If Jellyseerr is on a **different machine on your local network**, use its IP address: `JELLYSEERR_URL=http://<jellyseerr-ip-address>:5055/api/v1`

  - **If running the bot inside a Docker container:**

    - If Jellyseerr is running on the **host machine (outside of Docker)**, you must use host.docker.internal: `JELLYSEERR_URL=http://host.docker.internal:5055/api/v1`
      _(Note: `host.docker.internal` is a special DNS name provided by Docker that resolves to the host machine's IP address)._

    - If Jellyseerr is running **in another Docker container on the same network**, use its service name: `JELLYSEERR_URL=http://jellyseerr:5055/api/v1`
      _(Note: Here, `jellyseerr` is the service name of your Jellyseerr container in your `docker-compose.yml` file)._

- `JELLYSEERR_API_KEY`: Your **API key from Jellyseerr**. Find it in your Jellyseerr settings under `Settings` -> `API Keys`.

- `TMDB_API_KEY`: Your **API key from The Movie Database** (TMDB). You can get one by creating an account on their website.
- `OMDB_API_KEY`: (Optional) Your **API key from OMDb API** for fetching IMDb ratings, director, and actor information.

- `JELLYFIN_BASE_URL`: The **publicly accessible URL of your Jellyfin server**. **This must be reachable from the internet** for the "Watch Now" links in Discord to work for other users.
  - **Correct examples:** `http://jellyfin.yourdomain.com` or `http://88.99.100.101:8096` (if using a public IP).
  - **Note:** Using `localhost` or a local network IP (e.g., `192.168.1.100`) will only work for users on the same local network as the server.
- `JELLYFIN_SERVER_ID`: The unique **ID of your Jellyfin server**. You can find this by navigating to any item in your library; it's the `serverId` parameter in the URL.
- `JELLYFIN_CHANNEL_ID`: The **ID of the Discord text channel** where you want to receive notifications about new media. Enable Developer Mode, right-click the channel, and "Copy Channel ID".

- `WEBHOOK_PORT`: The **network port** the bot will listen on for incoming webhooks from Jellyfin. The default is `8282`.

## Commands & usage

`/search <title>` — opens interactive embed; use the Request button to send to Jellyseerr.  
`/request <title>` — instantly request the title.

When Jellyfin (or your add pipeline) sends a webhook to `http://<host>:<port>/jellyfin-webhook`, the bot will post the notification to the configured Discord channel.

## Publishing & Docker (optional)

A Dockerfile is provided in the repo. Use `docker compose up -d` to run.

Keep secrets out of the repo (use `.env` only).

GitHub Actions can be set up to build/push images to GHCR or Docker Hub.

## Screenshots

![App screenshot autocomplete](./assets/screenshot-autocomplete.png)  
![App screenshot search](./assets/screenshot-search.png)  
![App screenshot request](./assets/screenshot-request.png)
![App screenshot new media](./assets/screenshot-newmedia.png)

## Contributing

Contributions are always welcome!

See `contributing.md` for ways to get started.

## License

This repo is released under the Unlicense — public domain. Do anything with the code.
