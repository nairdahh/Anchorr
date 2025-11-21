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
- **📤 One-Click Requests**: Directly request media to Jellyseerr with `/request` command
- **📺 Smart TV Handling**: Choose specific seasons when searching for TV series using `/search`, or request all the seasons at once with `/request`
- **📬 Jellyfin Notifications**: Automatic Discord notifications when new media is added to your library
- **🎨 Rich Embeds**: Beautiful, detailed embeds with:
  - Movie/TV show posters and backdrops
  - Director/Creator information
  - IMDb ratings and links
  - Runtime, genres, and synopsis
  - Quick action buttons (IMDb, Letterboxd, Watch Now)
- **🔗 Autocomplete Support**: Intelligent autocomplete for search queries
- **👁️ Ephemeral Interactions**: Optional private responses visible only to the command user
- **⚙️ Web Dashboard**: User-friendly web interface for configuration

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
| `EPHEMERAL_INTERACTIONS` | Make bot responses private     | `true` or `false` (default)    |
| `JELLYSEERR_URL`      | Jellyseerr API endpoint           | `http://localhost:5055/api/v1` |
| `JELLYSEERR_API_KEY`  | Your Jellyseerr API key           | `abc123...`                    |
| `TMDB_API_KEY`        | TMDB API key                      | `xyz789...`                    |
| `OMDB_API_KEY`        | OMDb API key (optional)           | `abc123xyz...`                 |
| `JELLYFIN_BASE_URL`   | Public Jellyfin URL               | `http://jellyfin.example.com`  |
| `JELLYFIN_API_KEY`    | Jellyfin API key (optional)       | `c4b6b3c8f1d4f0a8a6c2e4d8...`  |
| `JELLYFIN_CHANNEL_ID` | Discord channel for notifications | `123456789...`                 |
| `JELLYFIN_EXCLUDED_LIBRARIES` | Libraries to exclude from notifications | `lib1,lib2,lib3`        |
| `WEBHOOK_PORT`        | Port for webhook listener         | `8282`                         |

### 🔄 Automatic Migration from `.env`

If you're upgrading from an older version with a `.env` file:

- Simply run the new version
- The app will automatically detect and migrate your `.env` variables to `config.json`
- You can then safely delete the `.env` file

## 💬 Commands

### `/search <title>`

Search for a movie or TV show and view detailed information.

- Shows poster, backdrop, ratings, genres, and synopsis
- Interactive buttons to request directly or view on IMDb/Letterboxd
- For TV shows: Choose specific seasons to request
- **Private Mode**: When ephemeral interactions are enabled, only you can see the search results

### `/request <title>`

Instantly request a movie or TV show (all seasons for TV).

- Automatically sends to Jellyseerr
- Shows confirmation with media details
- **Private Mode**: When ephemeral interactions are enabled, only you can see the request confirmation

### Autocomplete

Start typing in either command to see real-time suggestions with release year and the director/creator.

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

### 📚 Library Exclusion

You can exclude specific Jellyfin libraries from notifications to filter out unwanted alerts:

1. **Configure in Dashboard**: Open the web dashboard and navigate to "Jellyfin Notifications"
2. **Load Libraries**: Click "Load Libraries" to fetch all available libraries from your Jellyfin server
3. **Select to Exclude**: Check the boxes next to libraries you want to exclude from notifications
4. **Save Settings**: Click "Save Settings" to apply your exclusion list

**Use Cases:**
- Exclude test or personal libraries
- Filter notifications by content type
- Reduce noise from specific collections

The system automatically filters webhook events from excluded libraries, logging skipped notifications for transparency.

## 🐳 Docker Deployment

### Using Docker Compose (Recommended)

You can run Anchorr without cloning the repository! Just download the compose file:

```bash
# Download the compose file
curl -O https://raw.githubusercontent.com/nairdahh/anchorr/main/docker-compose.yml

# Start the container
docker compose up -d
```

Or if you have cloned the repository:

```bash
docker compose up -d
```

The bot will automatically pull the pre-built image from GitHub Container Registry.

### Alternative Docker Images

If GitHub Container Registry is unavailable, you can use Docker Hub:

```bash
# Edit your compose file to use Docker Hub image
image: nairdah/anchorr:latest
```

### Custom Docker Build

For development or custom builds:

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
