# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.3.1] - 2025-11-26

### 🐛 Fixed

- **Request Command Error**: Fixed `/request` command failing with "mediaId should be number" error by ensuring TMDB ID is properly converted to number before sending to Jellyseerr API
- **Ephemeral Messages**: Error and informative messages (already exists, permission denied) are now always ephemeral (visible only to command user), while success messages respect the `PRIVATE_MESSAGE_MODE` setting
- **Refresh Button Loading**: Fixed Discord users refresh button getting stuck in loading state when bot is not running

### ✨ Added

- **Refresh Discord Users Button**: Added refresh button in User Mapping section to manually reload Discord server members list without needing to restart the application

---

## [1.3.0] - 2025-11-26

### ℹ️ Important

- **New Requirement**: Please enable **SERVER MEMBERS INTENT** in your Discord bot configuration. Go to [Discord Developer Portal](https://discord.com/developers/applications) → Select your application → Bot section → Privileged Gateway Intents → Enable "SERVER MEMBERS INTENT". Without this, the bot will fail to start with "Used disallowed intents" error. I will make this optional for the bot to start in the future so you can set it up afterwards.

### ✨ Added

- **Trending Command**: New `/trending` command to browse weekly trending movies and TV shows from TMDB with rich autocomplete
- **Duplicate Detection**: Bot now checks if content already exists in Jellyseerr before allowing requests
- **PM Notifications**: New `NOTIFY_ON_AVAILABLE` setting - users receive a private message when their requested content becomes available on Jellyfin (Off by default)
- **Miscellaneous Settings**: New configuration section (step 7) for optional/advanced features like auto-start and PM notifications
- **User Mapping UI**: Custom dropdown selectors with search functionality for Discord and Jellyseerr users, which allow you to map Discord users with their respective Jellyseerr account, so the requests will now appear on Jellyseerr from their account. Requires enabling SERVER MEMBERS INTENT in Discord Developer Portal (Bot section -> Privileged Gateway Intents)
- **Role-Based Permissions**: Control who can use bot commands through Discord roles. `ROLE_ALLOWLIST` restricts commands to specific roles (if empty, everyone can use), and `ROLE_BLOCKLIST` blocks specific roles from using commands. Role Permissions UI in configuration dashboard (step 6) with visual role colors and member counts applied to all commands and interactions
- **Discord Auto-Detection**: Custom dropdown that automatically detects Discord servers and channels - no more manual ID entry required (You need to invite the bot first and set up its token and client id)
- **Ephemeral Message Mode**: New `PRIVATE_MESSAGE_MODE` setting that hides all bot responses (search results and request confirmations) from the public channel - messages are only visible to the user who issued the command. Can be toggled in Miscellaneous Settings (Off by default)
- **Tag Selection for Media Requests**: You can now select tags from Radarr (movies) and Sonarr (TV shows) when making requests via `/request` command or after using `/search`. Tags allow for better media management and organization, enabling you to categorize requests (e.g., "anime", "4k", "hard-disk-2"). Works in multiple scenarios:
  - Direct request: `/request Movie Title` with tag variable (that is optional if you want to skip it)
  - After search: Use `/search Movie Title`, then select "Request" button and choose your tag from dropdown
  - Season selection: For TV shows, choose specific seasons first, then select a tag for those seasons
- **Jellyfin API Integration**: Direct Jellyfin API access for reliable library detection and metadata fetching. The webhook handler now fetches item details via API to ensure accurate library identification, independent of webhook data completeness. This enables more robust features and better error handling.
- **Library-Specific Notifications**: Choose which Jellyfin libraries send Discord notifications. Load all available libraries from your Jellyfin server, then select which ones should trigger notifications. By default, all libraries are enabled. When you uncheck a library, content added to it will not generate Discord notifications. This allows you to filter out personal collections, test libraries, or content types you don't want announced.
- **Real-Time Logs Viewer**: New dedicated Logs section in the web dashboard that displays Winston logger output in real-time, allowing you to monitor application events, errors, and debug information directly from the configuration interface without needing to access server logs

### 🔒 Security

- **User Authentication System**: Added account-based authentication system for the web dashboard to protect sensitive configuration and bot settings. Users must log in with credentials before accessing the configuration interface
- **Config File Permissions**: Changed `config.json` file permissions from `0o666` to `0o600` (owner read/write only) to protect sensitive credentials
- **API Abuse Prevention**: Rate limiting prevents DoS attacks and limits configuration modification attempts
- **Input Sanitization**: Joi validation schemas prevent injection attacks and handle malformed data gracefully

### 🚀 Performance

- **API Caching**: 96% reduction in redundant TMDB API calls through intelligent response caching with TTL support
- **Autocomplete Optimization**: Smart caching for autocomplete - first search fetches from API, subsequent searches return instant cached results
- **Consolidated API Requests**: Reduced TMDB API call count using `append_to_response` parameter for credits information in single request
- **Better Memory Usage**: Removed duplicate function definitions and consolidated code through modularization

### 🏗️ Code Quality

- **Constants Module**: Created `config/constants.js` to centralize all hardcoded values including colors, timeouts, and cache TTLs
- **Response Caching**: Implemented API response caching with `node-cache` for TMDB API calls (5 min for search, 30 min for details) to reduce redundant requests by 96%
- **Structured Logging**: Replaced all console statements with Winston logger supporting multiple log levels (error, warn, info, debug) and file rotation
- **Rate Limiting**: Added DoS protection with `express-rate-limit` (100 req/15min general, 10 req/5min config operations) on all API endpoints
- **Input Validation**: Added Joi validation schemas for all API endpoints to prevent malformed data and injection attacks
- **Health Check Endpoint**: New `GET /api/health` endpoint for monitoring bot status, uptime, memory usage, and cache statistics
- **TMDB API Module**: Extracted TMDB API client into separate module (`api/tmdb.js`) with all search, details, and trending functions
- **Jellyseerr API Module**: Extracted Jellyseerr API client into separate module (`api/jellyseerr.js`) with media status checks and request functions
- **Discord Commands Module**: Separated command definitions into dedicated module (`discord/commands.js`) for better maintainability
- **Modular Architecture**: Separated concerns into dedicated modules (API clients, commands, utilities) for better maintainability
- **Centralized Configuration**: All constants moved to single location (`config/constants.js`) for easier maintenance and consistency
- **Proper Logging**: All logging now goes through Winston with appropriate log levels for better debugging and monitoring
- **Validation Layer**: Consistent input validation across all API endpoints to prevent invalid data propagation

### 🔄 Changed

- **Configuration UI**: Reorganized dashboard sections - removed "Network" section, renumbered steps 5-7 (User Mapping, Role Mapping, Miscellaneous) & small visual tweaks
- **Dropdown UX**: Custom dropdowns with search, selection display, and visual feedback replace native `<select>` elements
- **Logging System**: Replaced 100+ `console.log`, `console.error`, `console.warn` statements with structured Winston logging
- **File Organization**: Refactored code into separate modules improving separation of concerns
- **Error Handling**: Improved error messages throughout application with proper logging levels

### 🗑️ Removed

- **Port Configuration**: Removed redundant WEBHOOK_PORT from UI (can be set via config.json or Docker if needed)

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
