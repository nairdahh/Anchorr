# Library Exclusion Feature

## Overview

The library exclusion feature allows you to filter out Jellyfin webhook notifications from specific libraries. This is useful when you have libraries you don't want to receive Discord notifications for (e.g., personal collections, test libraries, etc.).

## How to Configure

1. **Navigate to Jellyfin Settings**
   - Open the Anchorr dashboard at `http://localhost:8282` (or your configured port)
   - Click on "4. Jellyfin Notifications" in the sidebar

2. **Enter Jellyfin URL**
   - Make sure you've entered your Jellyfin Public URL in the configuration

3. **Load Libraries**
   - Click the "Load Libraries" button
   - The system will fetch all available libraries from your Jellyfin server
   - Libraries will be displayed with checkboxes

4. **Select Libraries to Exclude**
   - Check the boxes next to libraries you want to exclude from notifications
   - You can select multiple libraries

5. **Save Configuration**
   - Click "Save Settings" to apply your changes
   - The configuration is stored in `config.json`

## How It Works

When a Jellyfin webhook is received:

1. The webhook handler extracts the library ID from the incoming data
2. It checks if the library ID is in the excluded list
3. If excluded, the notification is skipped with a log message
4. If not excluded, the notification proceeds normally

## Webhook Fields Checked

The handler checks the following fields from the Jellyfin webhook payload:
- `LibraryId` - Direct library identifier
- `CollectionId` - Collection/library identifier  
- `Library_Id` - Alternative library identifier format

## Configuration Storage

Excluded libraries are stored as a comma-separated string in the `JELLYFIN_EXCLUDED_LIBRARIES` configuration field:

```json
{
  "JELLYFIN_EXCLUDED_LIBRARIES": "lib-id-1,lib-id-2,lib-id-3"
}
```

## Troubleshooting

### Libraries Not Loading

- Verify your Jellyfin Public URL is correct
- Ensure your Jellyfin server is accessible from the Anchorr instance
- Check if your Jellyfin server requires authentication (some servers may need API keys)

### Notifications Still Coming Through

- Verify the library is actually checked in the exclusion list
- Save the configuration after selecting libraries
- Check the Anchorr logs to see if the webhook is being filtered
- Verify the webhook is sending the library ID field

## Example Use Cases

- **Exclude Test Libraries**: Don't get notified when adding content to test/staging libraries
- **Filter Personal Content**: Exclude personal media collections from shared notifications
- **Separate Movie/TV Libraries**: Only get notifications for specific content types
- **Multi-User Setup**: Filter out libraries belonging to specific users
