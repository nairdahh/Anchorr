# Revert to Webhook-Only Notifications - Summary

## Overview
Successfully reverted Anchorr from WebSocket/API-based notifications back to webhook-only notifications from Jellyfin.

## Changes Made

### 1. Backend Changes (`app.js`)
- ✅ Removed imports for `jellyfinPoller` and `JellyfinWebSocketClient`
- ✅ Removed `jellyfinWebSocketClient` variable declaration
- ✅ Added webhook endpoint: `POST /jellyfin/webhook`
- ✅ Added libraries endpoint: `GET /api/jellyfin/libraries` (for channel mapping)
- ✅ Removed WebSocket/Polling auto-enable logic from config save
- ✅ Removed WebSocket/Polling startup code from bot initialization
- ✅ Removed WebSocket/Polling cleanup code from bot restart

### 2. Configuration Files
#### `config/config.js`
- ✅ Removed `JELLYFIN_WEBSOCKET_ENABLED` field
- ✅ Removed `JELLYFIN_POLLING_ENABLED` field
- ✅ Removed `JELLYFIN_POLLING_INTERVAL` field

#### `utils/validation.js`
- ✅ Removed validation for `JELLYFIN_WEBSOCKET_ENABLED`
- ✅ Removed validation for `JELLYFIN_POLLING_ENABLED`
- ✅ Removed validation for `JELLYFIN_POLLING_INTERVAL`

### 3. Webhook Handler (`jellyfinWebhook.js`)
- ✅ Removed polling check that was ignoring webhooks when polling was enabled
- ✅ Kept `processAndSendNotification` function (handles channel mapping)
- ✅ Kept library detection logic (finds which library an item belongs to)

### 4. Frontend Changes (`web/script.js`)
- ✅ Removed polling interval conversion (minutes ↔ milliseconds) from config loading
- ✅ Removed polling interval conversion from config saving

### 5. API Functions (`api/jellyfin.js`)
- ✅ Kept `fetchLibraries()` - fetches all Jellyfin libraries
- ✅ Kept `findLibraryId()` - detects which library an item belongs to
- ✅ Kept `transformToWebhookFormat()` - converts Jellyfin items to webhook format

### 6. Documentation
- ✅ Created `JELLYFIN_WEBHOOK_SETUP.md` - comprehensive webhook configuration guide

## Files Preserved (Not Modified)
- `jellyfinWebSocket.js` - kept for reference, not imported or used
- `jellyfinPoller.js` - kept for reference, not imported or used

## How It Works Now

### Notification Flow
1. **Jellyfin** → Sends webhook to `http://anchorr:8282/jellyfin/webhook`
2. **Anchorr** → Receives webhook via `handleJellyfinWebhook()`
3. **Library Detection** → Uses `findLibraryId()` to determine which library the item belongs to
4. **Channel Mapping** → Looks up library in `JELLYFIN_NOTIFICATION_LIBRARIES` to get target channel
5. **Discord** → Sends notification to mapped channel (or default channel)

### Configuration Options
- `JELLYFIN_BASE_URL` - Jellyfin server URL
- `JELLYFIN_API_KEY` - API key for library detection (optional)
- `JELLYFIN_CHANNEL_ID` - Default Discord channel for notifications
- `JELLYFIN_NOTIFICATION_LIBRARIES` - Object mapping library IDs to channel IDs
  ```json
  {
    "library-id-1": "discord-channel-id-1",
    "library-id-2": "discord-channel-id-2"
  }
  ```
- `JELLYFIN_NOTIFY_MOVIES` - Enable/disable movie notifications
- `JELLYFIN_NOTIFY_SERIES` - Enable/disable series notifications
- `JELLYFIN_NOTIFY_SEASONS` - Enable/disable season notifications
- `JELLYFIN_NOTIFY_EPISODES` - Enable/disable episode notifications

## Next Steps for User

### 1. Install Jellyfin Webhook Plugin
- Go to Jellyfin Dashboard → Plugins → Catalog
- Install "Webhook" plugin
- Restart Jellyfin

### 2. Configure Webhook in Jellyfin
- Dashboard → Plugins → Webhook → Add Generic Destination
- **Webhook URL**: `http://anchorr:8282/jellyfin/webhook`
- **Notification Type**: Item Added
- **Item Types**: Movie, Series, Season (optional), Episode (optional)
- **Send All Properties**: ✅ Enable

### 3. Configure Library Channel Mapping in Anchorr
- Open Anchorr web interface
- Go to Jellyfin Configuration tab
- Enter Jellyfin URL and API Key
- Click "Fetch Libraries"
- Map each library to a Discord channel

## Testing
1. Add a new movie or TV show to Jellyfin
2. Check Discord for notification
3. Verify it appears in the correct channel based on library mapping

## Troubleshooting
- Check Anchorr logs: `docker logs anchorr`
- Verify webhook URL in Jellyfin points to Anchorr
- Ensure Discord bot is running
- Confirm library is mapped to a channel

## Benefits of Webhook Approach
- ✅ **Instant notifications** - no polling delay
- ✅ **Lower resource usage** - no constant API polling
- ✅ **Simpler architecture** - fewer moving parts
- ✅ **Official Jellyfin support** - uses official webhook plugin
- ✅ **Reliable** - Jellyfin guarantees webhook delivery

## Removed Features
- ❌ WebSocket real-time connection to Jellyfin
- ❌ API polling fallback mechanism
- ❌ Automatic notification method selection

These features are no longer needed as webhooks provide instant, reliable notifications.
