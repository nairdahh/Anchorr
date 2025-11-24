# Jellyfin Webhook Configuration Guide

Anchorr uses Jellyfin webhooks to receive real-time notifications when new media is added to your library.

## Prerequisites

- Jellyfin server with the **Webhook plugin** installed
- Anchorr running and accessible from your Jellyfin server
- Discord bot configured in Anchorr

## Installation Steps

### 1. Install Jellyfin Webhook Plugin

1. Open your Jellyfin admin dashboard
2. Navigate to **Dashboard** → **Plugins** → **Catalog**
3. Find and install the **Webhook** plugin
4. Restart your Jellyfin server

### 2. Configure Webhook in Jellyfin

1. Go to **Dashboard** → **Plugins** → **Webhook**
2. Click **Add Generic Destination**
3. Configure the webhook:
   - **Webhook Name**: `Anchorr Discord Notifications`
   - **Webhook Url**: `http://YOUR_ANCHORR_HOST:8282/jellyfin/webhook`
     - Replace `YOUR_ANCHORR_HOST` with your Anchorr server address
     - If running in Docker on the same host: `http://anchorr:8282/jellyfin/webhook`
     - If running locally: `http://localhost:8282/jellyfin/webhook`
   - **Notification Type**: Select **Item Added**
   - **Item Type**: Select the media types you want notifications for:
     - ✅ Movie
     - ✅ Series
     - ✅ Season (optional)
     - ✅ Episode (optional)
   - **User Filter**: Leave empty to trigger for all users
   - **Send All Properties**: ✅ Enable this option

4. Click **Save**

### 3. Configure Library Channel Mapping in Anchorr

1. Open Anchorr web interface
2. Go to **Settings** → **Jellyfin Configuration**
3. Configure:
   - **Jellyfin URL**: Your Jellyfin server URL (e.g., `http://jellyfin:8096`)
   - **Jellyfin API Key**: Your Jellyfin API key (optional, for library detection)
   - **Default Channel**: Discord channel for notifications
   - **Library Channel Mapping**: Map specific libraries to different channels

## Library Channel Mapping

You can send notifications from different Jellyfin libraries to different Discord channels:

1. In Anchorr settings, click **Fetch Libraries** to load your Jellyfin libraries
2. For each library, select the Discord channel where notifications should be sent
3. If no channel is selected for a library, notifications will go to the default channel

**Example:**
- Movies Library → `#movies` channel
- TV Shows Library → `#tv-shows` channel
- Anime Library → `#anime` channel

## Notification Filtering

Control which types of media trigger notifications:

- **Movies**: Notify when movies are added
- **Series**: Notify when TV series are added
- **Seasons**: Notify when seasons are added
- **Episodes**: Notify when individual episodes are added

**Recommended settings:**
- ✅ Movies: `true`
- ✅ Series: `true`
- ❌ Seasons: `false` (to avoid duplicate notifications)
- ❌ Episodes: `false` (to avoid spam)

## Testing

1. Add a new movie or TV show to your Jellyfin library
2. Check your Discord channel for the notification
3. If no notification appears:
   - Check Anchorr logs for webhook receipt
   - Verify webhook URL is correct in Jellyfin
   - Ensure Discord bot is running in Anchorr
   - Check that the library is mapped to a channel

## Troubleshooting

### No notifications appearing

1. **Check webhook is configured correctly in Jellyfin:**
   - Verify the webhook URL points to Anchorr
   - Ensure "Item Added" notification type is selected
   - Confirm "Send All Properties" is enabled

2. **Check Anchorr logs:**
   ```bash
   # Docker
   docker logs anchorr
   
   # Local
   Check logs in the Anchorr web interface
   ```

3. **Verify Discord bot is running:**
   - Check Anchorr dashboard shows bot as "Running"
   - Ensure bot has permissions to send messages in the target channel

4. **Test webhook manually:**
   ```bash
   curl -X POST http://YOUR_ANCHORR_HOST:8282/jellyfin/webhook \
     -H "Content-Type: application/json" \
     -d '{
       "ItemType": "Movie",
       "Name": "Test Movie",
       "Year": 2024,
       "Provider_tmdb": "12345"
     }'
   ```

### Notifications going to wrong channel

1. Check library channel mapping in Anchorr settings
2. Verify the library ID matches between Jellyfin and Anchorr
3. Click "Fetch Libraries" to refresh library list

### Duplicate notifications

- Disable "Seasons" and "Episodes" notifications if you only want to be notified when a series is added
- Check that you don't have multiple webhooks configured in Jellyfin

## Advanced Configuration

### Docker Compose Example

```yaml
services:
  anchorr:
    image: your-anchorr-image
    ports:
      - "8282:8282"
    environment:
      - WEBHOOK_PORT=8282
    networks:
      - media-network

  jellyfin:
    image: jellyfin/jellyfin
    networks:
      - media-network
    # Webhook URL: http://anchorr:8282/jellyfin/webhook
```

### Reverse Proxy (Nginx)

If using a reverse proxy, ensure it forwards POST requests:

```nginx
location /jellyfin/webhook {
    proxy_pass http://anchorr:8282;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

## Support

For issues or questions:
- Check the [GitHub Issues](https://github.com/yourusername/anchorr/issues)
- Join our Discord community
- Review Anchorr logs for error messages
