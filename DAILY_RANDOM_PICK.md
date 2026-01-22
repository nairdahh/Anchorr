# Daily Random Pick Feature - Implementation Summary

## Overview
A lightweight feature that recommends random media daily from a balanced pool of popular and undiscovered content. The bot sends an embed with a "Request This" button, allowing users to quickly add the recommended media to their library.

## Features

### Smart Media Selection Algorithm
- **Balanced Approach**: 60% from trending, 40% from discovery
- **Quality Filter**: Requires at least 50 votes on TMDB
- **Popularity Range**: Selects media with 10-100 popularity score (avoids completely obscure but not just trending)
- **Randomization**: Picks from random pages (1-5) when using discovery mode
- **Variety**: Randomly alternates between Movies and TV shows

### Scheduling
- **Daily Delivery**: Sends one recommendation per day at configured hour
- **Smart Scheduling**: Calculates exact time and schedules for tomorrow if time has passed
- **Interval-based**: Once started, repeats every 24 hours

### Discord Integration
- **Embed Display**: Shows media title, year, rating, genres, and backdrop image
- **Request Button**: Users can request the recommended media with one click
- **Automatic Tracking**: Requests are tracked for notifications if enabled

## Configuration

### Web Panel (Miscellaneous Section)
Three simple settings:

1. **Enable Daily Random Pick** - Toggle (default: OFF)
2. **Channel** - Discord channel ID for recommendations
3. **Time of Day** - Hour in 24h format (default: 9 = 9 AM)

### Config Variables
```json
{
  "DAILY_RANDOM_PICK_ENABLED": "false",
  "DAILY_RANDOM_PICK_CHANNEL_ID": "",
  "DAILY_RANDOM_PICK_HOUR": "9"
}
```

## Implementation Details

### Files Modified

#### 1. `api/tmdb.js`
- Added `tmdbGetRandomMedia(apiKey)` function
- Uses `/discover/movie` and `/discover/tv` endpoints
- Falls back to trending if discover returns no results
- Returns full details for the selected media

#### 2. `app.js`
- Added `scheduleDailyRandomPick(client)` function
- Added `sendDailyRandomPick(client)` function
- Added button handler for `request_random_*` customId
- Integrated scheduling into bot's `clientReady` event

#### 3. `lib/config.js`
- Added three new config variables to template:
  - `DAILY_RANDOM_PICK_ENABLED`
  - `DAILY_RANDOM_PICK_CHANNEL_ID`
  - `DAILY_RANDOM_PICK_HOUR`

#### 4. `web/index.html`
- Added "Daily Random Pick" section in Miscellaneous settings
- Includes toggle, channel input, and hour selector
- Styled with orange left border to stand out

## How It Works

### Startup Flow
1. Bot logs in and emits `clientReady` event
2. `scheduleDailyRandomPick()` is called
3. If enabled, calculates next scheduled time
4. Sets up `setTimeout` for first pick
5. After first pick, sets `setInterval` for 24-hour repeats

### Daily Pick Flow
1. `sendDailyRandomPick()` is called at scheduled hour
2. Gets random media using `tmdbGetRandomMedia()`
3. Builds Discord embed with media info
4. Adds "Request This" button with `customId: request_random_<id>_<type>`
5. Sends to configured channel
6. If user clicks button, sends request to Jellyseerr

### Request Flow
1. User clicks "Request This" button
2. Bot defers the update (no visible response)
3. Gets full media details from TMDB
4. Applies default quality/server settings
5. Sends request to Jellyseerr
6. Sends ephemeral confirmation to user
7. Tracks request for notifications (if enabled)

## Smart Selection Logic

### Media Quality Filter
- Minimum 50 votes (ensures decent quality)
- Popularity 10-100 (sweet spot for discovery)
- Random page selection (1-5) for variety

### Fallback Strategy
- If discover returns no results → use trending
- If media details fetch fails → use basic info
- Filters to movies/TV only (excludes people, networks, etc.)

## Performance Considerations

✅ **Lightweight**
- Single TMDB API call per daily pick
- Results cached via existing cache system
- No external dependencies beyond axios (already used)

✅ **Non-blocking**
- Uses `setTimeout`/`setInterval` (doesn't block bot)
- Async/await properly handled
- Errors logged but don't crash bot

✅ **Efficient**
- Simple scheduling (no external scheduler library)
- Minimal database/state management needed
- Integrates with existing TMDB API infrastructure

## Testing

### Enable the Feature
1. Go to Dashboard → Miscellaneous
2. Check "Enable Daily Random Pick"
3. Enter Discord channel ID
4. Set time of day (e.g., 9 for 9 AM)
5. Save configuration

### Verify Setup
- Check logs for "Daily Random Pick scheduled for..."
- At scheduled time, check Discord for the embed
- Click "Request This" to verify button works
- Check that request appears in Jellyseerr

### Restart Bot
- Scheduling only activates on bot startup
- After config changes, restart bot to apply

## UI/UX

### Minimal Configuration
- Just 3 settings (enable, channel, hour)
- No complex customization options
- Clear, helpful descriptions
- Styled consistently with other settings

### Discord Presentation
- Orange-colored accent (discovery theme)
- Clear media information
- Simple, actionable button
- Fits Discord's design language

## Future Enhancement Ideas
- Probability weighting (favor certain genres)
- Time zone support
- Exclude already-available media
- Filter by genres
- Custom randomization algorithms

## Edge Cases Handled

✅ Disabled feature doesn't schedule anything
✅ Missing channel ID shows warning, doesn't crash
✅ No TMDB API key fails gracefully
✅ Time already passed today → schedules tomorrow
✅ Media details fetch fails → uses basic info
✅ Channel not found → logs error, continues
✅ User no longer has request permission → errors shown

## Summary

A complete daily recommendation system that:
- Balances discovery with quality
- Requires minimal configuration
- Works seamlessly with existing infrastructure
- Provides engaging way to explore library
- Lightweight and performant
