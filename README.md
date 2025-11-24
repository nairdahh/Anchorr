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
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

## 🌟 Features

- **🔍 Media Search**: Search for movies and TV shows with `/search` command - you can then request it later within the message embed
- **🔥 Trending Content**: Browse weekly trending movies and TV shows with `/trending` command
- **📤 One-Click Requests**: Directly request media to Jellyseerr with `/request` command
- **📺 Smart TV Handling**: Choose specific seasons when searching for TV series using `/search`, or request all the seasons at once with `/request`
- **🚫 Duplicate Detection**: Automatically checks if content already exists in Jellyseerr before allowing requests
- **🏷️ Tag Selection**: Select Radarr/Sonarr tags when requesting media for better organization and categorization
- **📬 Jellyfin Notifications**: Automatic Discord notifications when new media is added to your library
- **📚 Library Filtering**: Choose which Jellyfin libraries send Discord notifications
- **👤 User Mapping**: Map Discord users to Jellyseerr accounts so requests appear from the correct user
- **🔐 Role-Based Permissions**: Control who can use bot commands through Discord roles (allowlist/blocklist)
- **🔔 Private Notifications**: Optional PM when your requested content becomes available on Jellyfin
- **👻 Ephemeral Mode**: Make bot responses visible only to the command user
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

1. Click **+** to add new webhook
2. Enter URL: `http://<bot-host>:<port>/jellyfin-webhook`
3. Example: `http://192.168.1.100:8282/jellyfin-webhook`
4. Save and you're done! 🎉

## ⚙️ Configuration

Configuration is managed through a **web dashboard** at `http://localhost:8282/`. However, you can also configure it programmatically.

### Configuration Variables

| Variable              | Description                       | Example                        |
| --------------------- | --------------------------------- | ------------------------------ |
| `DISCORD_TOKEN`       | Your bot's secret token           | `MjU0...`                      |
| `BOT_ID`              | Bot's Application ID              | `123456789...`                 |
| `GUILD_ID`            | Discord server ID                 | `987654321...`                 |
| `JELLYSEERR_URL`      | Jellyseerr API endpoint           | `http://localhost:5055/api/v1` |
| `JELLYSEERR_API_KEY`  | Your Jellyseerr API key           | `abc123...`                    |
| `TMDB_API_KEY`        | TMDB API key                      | `xyz789...`                    |
| `OMDB_API_KEY`        | OMDb API key (optional)           | `abc123xyz...`                 |
| `JELLYFIN_BASE_URL`   | Public Jellyfin URL               | `http://jellyfin.example.com`  |
| `JELLYFIN_CHANNEL_ID` | Discord channel for notifications | `123456789...`                 |
| `WEBHOOK_PORT`        | Port for webhook listener         | `8282`                         |

### 🔄 Automatic Migration from `.env`

If you're upgrading from an older version with a `.env` file:

- Simply run the new version
- The app will automatically detect and migrate your `.env` variables to `config.json`
- You can then safely delete the `.env` file

### 🔐 Role-Based Permissions

Control who can use bot commands through Discord roles:

| Variable           | Description                                    | Example                              |
| ------------------ | ---------------------------------------------- | ------------------------------------ |
| `ROLE_ALLOWLIST`   | Only these roles can use commands (empty = all)| `["Member", "VIP"]`                  |
| `ROLE_BLOCKLIST`   | These roles cannot use commands                | `["Banned", "Guest"]`                |

Configure in the web dashboard (Configuration → Step 6: Role Mapping).

### 👤 User Mapping

Map Discord users to Jellyseerr accounts so requests appear from the correct user:

1. Enable **SERVER MEMBERS INTENT** in Discord Developer Portal → Bot → Privileged Gateway Intents
2. Configure mappings in web dashboard (Configuration → Step 5: User Mapping)
3. Requests will now appear from the mapped Jellyseerr user

### 🔔 Notification Settings

| Variable              | Description                                           | Default |
| --------------------- | ----------------------------------------------------- | ------- |
| `NOTIFY_ON_AVAILABLE` | Send PM to users when their requested content is ready| `false` |
| `PRIVATE_MESSAGE_MODE`| Make all bot responses visible only to command user   | `false` |

Configure in the web dashboard (Configuration → Step 7: Miscellaneous Settings).

### 📚 Library-Specific Notifications

Choose which Jellyfin libraries send Discord notifications:

1. Configure Jellyfin connection in web dashboard
2. Load available libraries (Configuration → Step 4: Jellyfin)
3. Select which libraries should trigger notifications
4. By default, all libraries are enabled
5. Uncheck a library to exclude its content from Discord notifications

## 💬 Commands

### `/search <title>`

Search for a movie or TV show and view detailed information.

- Shows poster, backdrop, ratings, genres, and synopsis
- Interactive buttons to request directly or view on IMDb/Letterboxd
- For TV shows: Choose specific seasons to request
- Optional tag selection when making requests

### `/request <title> [tag]`

Instantly request a movie or TV show (all seasons for TV).

- Automatically sends to Jellyseerr
- Shows confirmation with media details
- Optional tag parameter for better organization

### `/trending`

Browse weekly trending movies and TV shows.

- Shows top trending content from TMDB
- Interactive autocomplete with real-time suggestions
- Same action buttons and workflows as `/search`

### Autocomplete

Start typing in any command to see real-time suggestions with release year and the director/creator information.

## 🔔 Jellyfin Notifications

When new media is added to your Jellyfin library, the bot automatically posts to your configured Discord channel:

- 🎬 **Movies**: Full details with IMDb and Letterboxd links
- 📺 **TV Shows**: Series information with IMDb link and when available, a Letterboxd link
- 🎞️ **Episodes**: Season and episode number with timestamps

Each notification includes:

- High-quality poster
- Runtime, rating, genres and synopsis
- "Watch Now" button linking directly to Jellyfin
- IMDb and Letterboxd quick links

## 🐳 Docker Deployment

### Using Docker Compose (Recommended)

```bash
docker compose up -d --build
```

### Custom Docker Build

```bash
docker build -t anchorr .
docker run -p 8282:8282 \
  -e DISCORD_TOKEN=your_token \
  -e BOT_ID=your_bot_id \
  -e GUILD_ID=your_guild_id \
  anchorr
```

**Note**: For Docker, use `host.docker.internal` to reference services on the host machine.

## 📸 Screenshots (a bit outdated for now)

| Feature               | Screenshot                                            |
| --------------------- | ----------------------------------------------------- |
| Autocomplete          | ![Autocomplete](./assets/screenshot-autocomplete.png) |
| Search Results        | ![Search](./assets/screenshot-search.png)             |
| Request Confirmation  | ![Request](./assets/screenshot-request.png)           |
| Jellyfin Notification | ![New Media](./assets/screenshot-newmedia.png)        |

## 🔧 Advanced Features

### Web Dashboard

- ✅ Real-time bot status monitoring
- ✅ One-click start/stop controls
- ✅ Connection testing for Jellyseerr and Jellyfin
- ✅ Configuration editing and persistence
- ✅ Webhook URL display with copy-to-clipboard
- ✅ Tab-based organization (Discord, Jellyseerr, TMDB, Jellyfin)

### API Endpoints (Internal)

- `GET /api/config` - Fetch current configuration
- `POST /api/save-config` - Save configuration changes
- `GET /api/status` - Get bot status
- `POST /api/start-bot` - Start the bot
- `POST /api/stop-bot` - Stop the bot
- `POST /api/test-jellyseerr` - Test Jellyseerr connection
- `POST /api/test-jellyfin` - Test Jellyfin connection

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## 📄 License

This project is released under the **Unlicense** — it's public domain. Do anything you want with the code!
