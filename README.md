<p align="center">
  <img src="./assets/logo-text.png" alt="Anchorr logo-text" width="300"/>
</p>

<p align="center">
  <strong>A helpful Discord bot for requesting media via Jellyseerr and receiving Jellyfin notifications for new content in your library.</strong>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-configuration">Configuration</a> •
  <a href="#-commands">Commands</a> •
  <a href="#-docker-deployment">Docker</a> •
  <a href="./CHANGELOG.md">Changelog</a> •
  <a href="./CONTRIBUTING.md">Contributing</a> •
  <a href="https://discord.gg/S5JrsZe9mB">Discord</a>
</p>

## 💬 Discord Server

**Before anything else, I invite you to join my Discord server for faster help, discussions, and important information such as an organizd list of known bugs that are currently being tracker or planned features scheduled for future releases!**

##### This helps avoid duplicate requests and keeps everyone informed about what's coming next!

### Join Here:

[![](https://dcbadge.limes.pink/api/server/https://discord.gg/S5JrsZe9mB)](https://discord.gg/S5JrsZe9mB)

I also have a dedicated channel on the [r/JellyfinCommunity](https://discord.gg/awFC5m4xkr) server (if you are already a member): [Join me here](https://discord.gg/awFC5m4xkr)

## 🌟 Features

- **🔍 Media Search**: Search for movies and TV shows with `/search` command - you can then request it later within the message embed
- **🔥 Trending Content**: Browse weekly trending movies and TV shows with `/trending` command
- **📤 One-Click Requests**: Directly request media to Jellyseerr with `/request` command
- **📺 Smart TV Handling**: Choose specific seasons when searching for TV series using `/search`, or request all the seasons at once with `/request`
- **🚫 Duplicate Detection**: Automatically checks if content already exists in Jellyseerr before allowing requests
- **🏷️ Tag Selection**: Select Radarr/Sonarr tags when requesting media for better organization and categorization
- **📬 Jellyfin Notifications**: Automatic Discord notifications when new media is added to your library
- **📚 Library Filtering and Mapping**: Choose which Jellyfin libraries send Discord notifications and on what channel
- **👤 User Mapping**: Map Discord users to Jellyseerr accounts so requests appear from the correct user
- **🔐 Role-Based Permissions**: Control who can use bot commands through Discord roles (allowlist/blocklist)
- **🔔 Private Notifications**: Optional PM when your requested content becomes available on Jellyfin
- **👻 Ephemeral Mode**: Make bot responses visible only to the command user
- **🌍 Multi-Language Support**: Fully translated interface with automatic language detection
- **🎨 Rich Embeds**: Beautiful, detailed embeds with:
  - Movie/TV show posters and backdrops
  - Director/Creator information
  - IMDb ratings and links
  - Runtime, genres, and synopsis
  - Quick action buttons (IMDb, Letterboxd, Watch Now)
- **🔗 Autocomplete Support**: Intelligent autocomplete for search queries with rich metadata
- **⚙️ Web Dashboard**: User-friendly web interface for configuration with auto-detection

## 📋 Prerequisites

Before getting started, ensure you have:

- ✅ A running **Jellyfin** server
- ✅ A running **Jellyseerr** instance
- ✅ A **Discord account** with a server where you have admin privileges
- ✅ API keys from:
  - [The Movie Database (TMDB)](https://www.themoviedb.org/settings/api) - **Required**
  - [OMDb API](http://www.omdbapi.com/apikey.aspx) - Optional, but recommended for richer data
- ✅ **Node.js** v18+ or **Docker & Docker Compose**

## 🚀 Quick Start

### 1️⃣ Clone and Install

```bash
git clone https://github.com/nairdahh/anchorr.git
cd anchorr
npm install
```

### 2️⃣ Start the Application

```bash
node app.js
```

The web dashboard will be available at `http://localhost:8282`

### 3️⃣ Configure via Web Dashboard

1. Open `http://localhost:8282` in your browser
2. Fill in your Discord Bot credentials, API keys, and service URLs
3. Click the test buttons to verify connections
4. Start the bot using the dashboard button

### 4️⃣ Invite Bot to Discord

Generate an OAuth2 URL in [Discord Developer Portal](https://discord.com/developers/applications):

- OAuth2 → URL Generator
- Scopes: `bot`, `applications.commands`
- Permissions: Send Messages, Embed Links
- Copy generated URL and open in browser

### 5️⃣ Configure Jellyfin Webhook

In Jellyfin Dashboard → Webhooks:

1. Click **+** to add new Discord webhook
2. Enter URL: `http://<bot-host>:<port>/jellyfin-webhook`
3. Example: `http://192.168.1.100:8282/jellyfin-webhook`
4. Save and you're done! 🎉

## ⚙️ Configuration

Configuration is managed through a **web dashboard** at `http://localhost:8282/`. However, you can also configure it programmatically.

## 🐳 Docker Deployment

Deploying with Docker is the recommended method for running Anchorr. You can use Docker Compose (the easiest way) or run the container manually.

### Method 1: Docker Compose

**Option A: Clone the full repository**

```bash
git clone https://github.com/nairdahh/anchorr.git
cd anchorr
docker compose up -d
```

**Option B: Download only docker-compose.yml**

```bash
mkdir anchorr && cd anchorr
wget https://raw.githubusercontent.com/nairdahh/anchorr/main/docker-compose.yml
# OR with curl: curl -O https://raw.githubusercontent.com/nairdahh/anchorr/main/docker-compose.yml
docker compose up -d
```

**Access:** Open browser at `http://<your-server-ip>:8282` (e.g., `http://192.168.1.100:8282` or `http://localhost:8282`)

### Method 2: Manual Docker Run

```bash
# Run container (using port 8282)
docker run -d \
  --name anchorr \
  --restart unless-stopped \
  -p 8282:8282 \
  -v ./anchorr-data:/usr/src/app/config \
  -e WEBHOOK_PORT=8282 \
  -e NODE_ENV=production \
  nairdah/anchorr:latest
```

**Access:** Open browser at `http://<your-server-ip>:8282`

**Important parameters:**

- `-p 8282:8282` - **Port mapping** (host:container). First number is the port on your host.
- `-v ./anchorr-data:/usr/src/app/config` - Persistent config storage (saves to `./anchorr-data/config.json`)
- `--restart unless-stopped` - Auto-restart on failure
- `-e WEBHOOK_PORT=8282` - Web dashboard port
- `-e NODE_ENV=production` - Production mode

**Example for Unraid:**
When adding the container in Unraid Community Apps, add this volume mapping in the "Path" section:

- **Container Path**: `/usr/src/app/config`
- **Host Path**: `/mnt/user/appdata/anchorr`
- **Access Mode**: `RW` (Read-Write)

### Method 3: Install Directly from Docker Hub

If you use **Docker Desktop** or other GUI tools (Portainer, Unraid, etc.), you can install directly from Docker Hub without cloning the repository:

1. Open Docker Desktop → Images (or search in your GUI)
2. Search for `nairdah/anchorr` or just `anchorr`
3. Pull the latest image
4. Create a new container with these settings:
   - **Port:** `8282:8282` (or change as needed)
   - **Volume:** `./anchorr-data` → `/usr/src/app/config`
   - **Environment variables:**
     - `WEBHOOK_PORT=8282`
     - `NODE_ENV=production`
   - **Restart policy:** Unless stopped

### Using a Different Port

If port 8282 is already in use:

**Docker Compose:** Edit `docker-compose.yml`

```yaml
ports:
  - "9000:8282" # Change 9000 to your desired port
```

**Docker Run:** Change the first port number

```bash
docker run -d \
  --name anchorr \
  --restart unless-stopped \
  -p 9000:8282 \              # Use port 9000 on host
  -v ./anchorr-data:/usr/src/app/config \
  -e WEBHOOK_PORT=8282 \
  -e NODE_ENV=production \
  nairdah/anchorr:latest
```

Then access at: `http://localhost:9000`

## 🔄 Updates

### Node.js Installation

```bash
cd anchorr
git pull origin main
npm install
# Restart the application (Ctrl+C, then run: node app.js)
```

### Docker Compose

```bash
cd anchorr
git pull origin main
docker compose up -d --pull always
```

### Docker Manual Run

```bash
docker pull nairdah/anchorr:latest
docker stop anchorr
docker rm anchorr
docker run -d \
  --name anchorr \
  --restart unless-stopped \
  -p 8282:8282 \
  -v ./anchorr-data:/usr/src/app/config \
  -e WEBHOOK_PORT=8282 \
  -e NODE_ENV=production \
  nairdah/anchorr:latest
```

## 📸 Screenshots (a bit outdated for now)

| Feature               | Screenshot                                            |
| --------------------- | ----------------------------------------------------- |
| Autocomplete          | ![Autocomplete](./assets/screenshot-autocomplete.png) |
| Search Results        | ![Search](./assets/screenshot-search.png)             |
| Request Confirmation  | ![Request](./assets/screenshot-request.png)           |
| Jellyfin Notification | ![New Media](./assets/screenshot-newmedia.png)        |

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

### 🌍 Adding Translations

Help make Anchorr accessible to more users by contributing translations! The system now automatically detects and loads new languages.

**Quick start:**
```bash
npm run create-translation es "Español" "Your Name"
```

See [TRANSLATION_GUIDE.md](./TRANSLATION_GUIDE.md) for detailed instructions.

## 👥 Contributors

Thanks to all the amazing people who have contributed to Anchorr! 🎉

<table>
<tr>
    <td align="center">
        <a href="https://github.com/nairdahh">
            <img src="https://github.com/nairdahh.png" width="100px;" alt="nairdahh"/><br />
            <sub><b>nairdahh</b></sub>
        </a><br />
        <a href="https://github.com/nairdahh/anchorr/commits?author=nairdahh" title="Code">💻</a>
        <a href="#maintenance-nairdahh" title="Maintenance">🚧</a>
        <a href="#ideas-nairdahh" title="Ideas & Planning">🤔</a>
    </td>
    <td align="center">
        <a href="https://github.com/retardgerman">
            <img src="https://github.com/retardgerman.png" width="100px;" alt="retardgerman"/><br />
            <sub><b>retardgerman</b></sub>
        </a><br />
        <a href="https://github.com/nairdahh/anchorr/commits?author=retardgerman" title="Code">💻</a>
        <a href="https://github.com/nairdahh/anchorr/pulls?q=author%3Aretardgerman" title="Bug fixes">🐛</a>
        <a href="#ideas-retardgerman" title="Ideas & Planning">🤔</a>
    </td>
    <td align="center">
        <a href="https://github.com/whoopsi-daisy">
            <img src="https://github.com/whoopsi-daisy.png" width="100px;" alt="whoopsi-daisy"/><br />
            <sub><b>whoopsi-daisy</b></sub>
        </a><br />
        <a href="https://github.com/nairdahh/anchorr/pulls?q=author%3Awhoopsi-daisy" title="Documentation">📖</a>
    </td>
</tr>
</table>

## 📄 License

This project is released under the **Unlicense** — it's public domain. Do anything you want with the code!
