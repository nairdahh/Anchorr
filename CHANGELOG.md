# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.2] - 2025-11-18

### ✨ Added

- **Autocomplete**: Added runtime information for movies in autocomplete suggestions
- **Autocomplete**: Added season count for TV shows in autocomplete suggestions
- **Format**: Autocomplete now displays as "🎬 Title (Year) — directed by Director — runtime: 2h 14m" for movies
- **Format**: Autocomplete now displays as "📺 Title (Year) — created by Creator — 3 seasons" for TV shows
- **Auto-start Bot**: Added `AUTO_START_BOT` configuration option to automatically start the bot on server boot when valid credentials are present
- **Web UI**: Added toggle in Discord settings to enable/disable bot auto-start feature

### 🐛 Fixed

- **Autocomplete Character Limit**: Fixed Discord character limit errors by truncating long names to 95 characters + "..."
- **Autocomplete Performance**: Optimized TMDB API calls to include credits in a single request (append_to_response)
- **Linux Permissions**: Improved config.json permission handling on Linux systems with better error handling

### 🔄 Changed

- **TMDB API**: Updated `tmdbGetDetails()` to include credits information for director/creator data
- **Bot Startup**: Bot now auto-starts on container/server restart if `AUTO_START_BOT` is enabled and Discord credentials are valid

---

## [1.2.1] - 2025-11-17

### 🐛 Fixed

- **Watch Now Button**: Fixed double slash issue in Jellyfin URLs (e.g., `//web/index.html`) by properly normalizing base URLs
- **Docker Permissions**: Fixed `config.json` permission issues in Docker volumes by setting proper ownership and chmod during build and runtime
- **Web UI**: Added clear step-by-step instructions for creating Discord bot in configuration panel
- **Web UI**: Jellyfin is no longer a sin

## [1.2.0] - 2025-11-16

### ✨ Added

- **🔄 Automatic .env Migration**: Configuration automatically migrates from `.env` to `config.json` on first run
- **⚙️ Web Dashboard**: User-friendly configuration interface at `http://localhost:8282`
- **🔗 Connection Testing**: Test buttons for Jellyseerr and Jellyfin connections
- **📝 Improved Documentation**: Completely rewritten README and CONTRIBUTING.md with modern design
- **🎯 Auto-start Bot**: Start/stop bot directly from web dashboard

### 🔄 Changed

- **Configuration System**: Moved from `.env` to `config.json` for better persistence and UI management
- **Docker Setup**: Removed `env_file` dependency; uses volume mount for `config.json`
- **API Endpoints**: Enhanced error handling and status reporting

### 🗑️ Removed

- `dotenv` dependency (no longer needed with config.json)
- `body-parser` dependency (Express 5.x includes it)
- `node-fetch` dependency (unused)

### 🔒 Security

- Ensure `config.json` is never committed (added to `.gitignore`)
- Non-root Docker user maintained
- Improved secrets handling

### 📚 Documentation

- 🆕 Modern README with quick start guide
- 🆕 Updated CONTRIBUTING.md with contribution guidelines
- 🆕 Clear configuration documentation
- 🆕 Advanced features section

### 🐳 Docker

- Simplified `docker-compose.yml`
- Added volume mount for persistent `config.json`
- Improved documentation for Docker deployment

### 🚀 Migration Guide for Users

If upgrading from v1.1.0:

1. **Backup your current setup** (optional)
2. **Update to v1.2.0** and run `npm install`
3. **If you have a `.env` file**:
   - The app will automatically migrate your variables to `config.json`
   - You can safely delete the `.env` file afterward
4. **If using Docker**:
   - Pull the new image: `docker pull nairdah/anchorr:main`
   - Run `docker compose up -d --build`
5. **Configure via Web Dashboard**:
   - Open `http://localhost:8282`
   - Verify and update configuration if needed
   - Start the bot using the dashboard

**⚠️ Breaking Changes**:

- `.env` files are no longer used (automatic migration handles this)
- Docker users: `env_file: .env` is removed from compose file
- Removed unused dependencies (`dotenv`, `body-parser`, `node-fetch`)

## [1.1.0] - 2025-11-15

### ✨ Added

- Initial release
- Discord slash commands (`/search`, `/request`)
- Jellyfin webhook notifications
- TMDB and OMDb API integration
- Jellyseerr request functionality
- Docker support

### 🌟 Features

- Rich embeds with media details
- Autocomplete for search queries
- Season-specific TV show requests
- IMDb and Letterboxd quick links
- Jellyfin webhook debouncing
