import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import axios from "axios";
import debounce from "lodash.debounce";
import { minutesToHhMm } from "./utils/time.js";
import logger from "./utils/logger.js";
import { fetchOMDbData } from "./api/omdb.js";
import { findBestBackdrop } from "./api/tmdb.js";

const debouncedSenders = new Map();
const sentNotifications = new Map();
const episodeMessages = new Map(); // Track Discord messages for editing: SeriesId -> { messageId, channelId }

// Cleanup configuration
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_DEBOUNCE_MS = 60000; // 60 seconds (1 minute)

// Periodic cleanup for old debouncer entries (prevent memory leaks on long-running servers)
setInterval(() => {
  const now = Date.now();
  const sevenDaysAgo = now - CLEANUP_THRESHOLD_MS;
  
  let cleanedCount = 0;
  for (const [seriesId, data] of debouncedSenders.entries()) {
    // Check if debouncer has a timestamp and is older than 7 days
    if (data.timestamp && data.timestamp < sevenDaysAgo) {
      debouncedSenders.delete(seriesId);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    logger.debug(`Periodic cleanup: Removed ${cleanedCount} old debouncer(s)`);
  }
}, CLEANUP_INTERVAL_MS);

function getItemLevel(itemType) {
  switch (itemType) {
    case "Series":
      return 3;
    case "Season":
      return 2;
    case "Episode":
      return 1;
    default:
      return 0;
  }
}

// Build a Jellyfin URL that preserves a potential subpath (e.g., /jellyfin)
// and appends the provided path and optional hash fragment safely.
function buildJellyfinUrl(baseUrl, appendPath, hash) {
  try {
    const u = new URL(baseUrl);
    let p = u.pathname || "/";
    if (!p.endsWith("/")) p += "/";
    const pathClean = String(appendPath || "").replace(/^\/+/, "");
    u.pathname = p + pathClean;
    if (hash != null) {
      const h = String(hash);
      u.hash = h.startsWith("#") ? h.slice(1) : h;
    }
    return u.toString();
  } catch (_e) {
    const baseNoSlash = String(baseUrl || "").replace(/\/+$/, "");
    const pathNoLead = String(appendPath || "").replace(/^\/+/, "");
    const h = hash
      ? String(hash).startsWith("#")
        ? String(hash)
        : `#${hash}`
      : "";
    return `${baseNoSlash}/${pathNoLead}${h}`;
  }
}

async function processAndSendNotification(
  data,
  client,
  pendingRequests,
  targetChannelId = null,
  episodeCount = 0,
  episodeDetails = null
) {
  const {
    ItemType,
    ItemId,
    SeasonId,
    SeriesId,
    Name,
    SeriesName,
    IndexNumber,
    Year,
    Overview,
    RunTime,
    Genres,
    Provider_imdb: imdbIdFromWebhook, // Renamed to avoid conflict
    ServerUrl,
    ServerId,
    SeasonNumber,
    EpisodeNumber,
    Video_0_Height,
    Video_0_Codec,
    Video_0_VideoRange,
    Audio_0_Codec,
    Audio_0_Channels,
    Audio_0_Language,
  } = data;

  // We need to fetch details from TMDB to get the backdrop
  const tmdbId = data.Provider_tmdb;

  logger.info(
    `Webhook received: ItemType=${ItemType}, Name=${Name}, tmdbId=${tmdbId}, Provider_imdb=${data.Provider_imdb}`
  );

  // Check if anyone requested this content
  const notifyEnabled = process.env.NOTIFY_ON_AVAILABLE === "true";
  let usersToNotify = [];

  if (notifyEnabled && tmdbId && pendingRequests) {
    const movieKey = `${tmdbId}-movie`;
    const tvKey = `${tmdbId}-tv`;

    logger.debug(
      `Checking pending requests. notifyEnabled=${notifyEnabled}, tmdbId=${tmdbId}`
    );
    logger.debug(`Pending requests keys:`, Array.from(pendingRequests.keys()));

    if (ItemType === "Movie" && pendingRequests.has(movieKey)) {
      usersToNotify = Array.from(pendingRequests.get(movieKey));
      pendingRequests.delete(movieKey);
      logger.info(
        `Found ${usersToNotify.length} users to notify for movie ${tmdbId}`
      );
    } else if (
      (ItemType === "Series" ||
        ItemType === "Season" ||
        ItemType === "Episode") &&
      pendingRequests.has(tvKey)
    ) {
      usersToNotify = Array.from(pendingRequests.get(tvKey));
      pendingRequests.delete(tvKey);
      logger.info(
        `Found ${usersToNotify.length} users to notify for TV show ${tmdbId}`
      );
    } else {
      logger.debug(`No matching pending requests found for ${tmdbId}`);
    }
  } else {
    logger.debug(
      `Notification check skipped: notifyEnabled=${notifyEnabled}, tmdbId=${tmdbId}, hasPendingRequests=${!!pendingRequests}`
    );
  }
  let details = null;
  if (tmdbId) {
    try {
      const res = await axios.get(
        `https://api.themoviedb.org/3/${
          ItemType === "Movie" ? "movie" : "tv"
        }/${tmdbId}`,
        {
          params: {
            api_key: process.env.TMDB_API_KEY,
            append_to_response: "images,external_ids",
          },
        }
      );
      details = res.data;
    } catch (e) {
      logger.warn(`Could not fetch TMDB details for ${tmdbId}`);
    }
  }

  // Prioritize IMDb ID from TMDB, fallback to webhook
  const imdbId = details?.external_ids?.imdb_id || imdbIdFromWebhook;

  const omdb = imdbId ? await fetchOMDbData(imdbId) : null;

  let runtime = "Unknown";
  // Prioritize webhook runtime data for episodes
  if (ItemType === "Episode" && RunTime) {
    runtime = RunTime; // Webhook already provides formatted runtime like "00:25:02"
  } else if (omdb?.Runtime && omdb.Runtime !== "N/A") {
    const match = String(omdb.Runtime).match(/(\d+)/);
    if (match) runtime = minutesToHhMm(parseInt(match[1], 10));
  } else if (ItemType === "Movie" && details?.runtime > 0) {
    runtime = minutesToHhMm(details.runtime);
  } else if (
    (ItemType === "Series" ||
      ItemType === "Season") &&
    details &&
    Array.isArray(details.episode_run_time) &&
    details.episode_run_time.length > 0
  ) {
    runtime = minutesToHhMm(details.episode_run_time[0]);
  }

  const rating = omdb?.imdbRating ? `${omdb.imdbRating}/10` : "N/A";
  const genreList = Array.isArray(Genres)
    ? Genres.join(", ")
    : Genres || omdb?.Genre || "Unknown";
  const overviewText =
    Overview?.trim() || omdb?.Plot || "No description available.";

  let headerLine = "Summary";
  if (omdb) {
    if (ItemType === "Movie" && omdb.Director && omdb.Director !== "N/A") {
      headerLine = `Directed by ${omdb.Director}`;
    } else if (omdb.Writer && omdb.Writer !== "N/A") {
      const creator = omdb.Writer.split(",")[0].trim();
      headerLine = `Created by ${creator}`;
    }
  }

  // Build quality info from webhook data
  let qualityInfo = "";
  if (Video_0_Height && Video_0_Codec) {
    const videoQuality = Video_0_Height >= 2160 ? "4K" : 
                        Video_0_Height >= 1440 ? "1440p" :
                        Video_0_Height >= 1080 ? "1080p" :
                        Video_0_Height >= 720 ? "720p" : `${Video_0_Height}p`;
    
    const videoCodec = Video_0_Codec.toUpperCase();
    const hdr = Video_0_VideoRange && Video_0_VideoRange !== "SDR" ? ` ${Video_0_VideoRange}` : "";
    
    qualityInfo = `${videoQuality} ${videoCodec}${hdr}`;
    
    if (Audio_0_Codec && Audio_0_Channels) {
      const audioCodec = Audio_0_Codec.toUpperCase();
      const channels = Audio_0_Channels === 6 ? "5.1" : 
                      Audio_0_Channels === 8 ? "7.1" :
                      Audio_0_Channels === 2 ? "Stereo" : `${Audio_0_Channels}ch`;
      qualityInfo += ` • ${audioCodec} ${channels}`;
    }
  }

  let embedTitle = "";
  let authorName = "";

  switch (ItemType) {
    case "Movie":
      authorName = "🎬 New movie added!";
      embedTitle = `${Name || "Unknown Title"} (${Year || "?"})`;
      break;
    case "Series":
      authorName = "📺 New TV show added!";
      embedTitle = `${Name || "Unknown Series"} (${Year || "?"})`;
      break;
    case "Season":
      authorName = "📺 New season added!";
      embedTitle = `${SeriesName || "Unknown Series"} (${
        Year || "?"
      }) - Season ${SeasonNumber || IndexNumber || "?"}`;
      break;
    case "Episode":
      if (episodeCount > 1 && episodeDetails) {
        authorName = `📺 New Episodes Added!`;
        embedTitle = `${SeriesName || "Unknown Series"}`;
        
        // Use simple format for batched episodes
        Overview = `${episodeCount} new episodes were added to your library.`;
      } else {
        authorName = "📺 New episode added!";
        const season = String(SeasonNumber || 1).padStart(2, "0");
        const episode = String(EpisodeNumber || IndexNumber || 1).padStart(2, "0");
        embedTitle = `${SeriesName || "Unknown Series"} - S${season}E${episode} - ${Name}`;
      }
      break;
    default:
      authorName = "✨ New item added";
      embedTitle = Name || "Unknown Title";
  }

  // Smart color coding based on content type and count
  let embedColor = "#cba6f7"; // Default purple
  if (ItemType === "Movie") {
    embedColor = "#f38ba8"; // Pink for movies
  } else if (ItemType === "Series") {
    embedColor = "#a6e3a1"; // Green for new series
  } else if (ItemType === "Season") {
    embedColor = "#fab387"; // Orange for seasons
  } else if (ItemType === "Episode") {
    if (episodeCount > 5) {
      embedColor = "#f9e2af"; // Yellow for many episodes
    } else if (episodeCount > 1) {
      embedColor = "#89dceb"; // Light blue for few episodes
    } else {
      embedColor = "#cba6f7"; // Purple for single episode
    }
  }

  const embed = new EmbedBuilder()
    .setAuthor({ name: authorName })
    .setTitle(embedTitle)
    .setURL(
      buildJellyfinUrl(
        ServerUrl,
        "web/index.html",
        `!/details?id=${ItemId}&serverId=${ServerId}`
      )
    )
    .setColor(embedColor);

  // Add fields based on ItemType
  if (ItemType === "Episode") {
    // Episodes: Only Summary and Runtime
    embed.addFields(
      { name: headerLine, value: overviewText || "No description available." }
    );
    if (runtime && runtime !== "Unknown") {
      embed.addFields({ name: "Runtime", value: runtime, inline: true });
    }
  } else if (ItemType === "Season") {
    // Seasons: Only Summary
    embed.addFields(
      { name: headerLine, value: overviewText || "No description available." }
    );
  } else {
    // Movies and Series: Summary, Genre, Runtime, Rating
    embed.addFields(
      { name: headerLine, value: overviewText || "No description available." },
      { name: "Genre", value: genreList || "Unknown", inline: true },
      { name: "Runtime", value: runtime || "Unknown", inline: true },
      { name: "Rating", value: rating || "N/A", inline: true }
    );
  }



  // Add episode list for multiple episodes
  if (episodeCount > 1 && episodeDetails && episodeDetails.episodes.length <= 10) {
    const episodeList = episodeDetails.episodes
      .sort((a, b) => (a.EpisodeNumber || 0) - (b.EpisodeNumber || 0))
      .map(ep => {
        const epNum = String(ep.EpisodeNumber || 0).padStart(2, "0");
        return `E${epNum}: ${ep.Name || "Unknown Episode"}`;
      })
      .join("\n");
    
    embed.addFields({ name: `Episodes (${episodeCount})`, value: episodeList, inline: false });
  } else if (episodeCount > 10) {
    embed.addFields({ 
      name: `Episodes (${episodeCount})`, 
      value: `Too many episodes to list individually. Added episodes 1-${episodeCount}.`, 
      inline: false 
    });
  }

  const backdropPath = details ? findBestBackdrop(details) : null;
  const backdrop = backdropPath
    ? `https://image.tmdb.org/t/p/w1280${backdropPath}`
    : buildJellyfinUrl(ServerUrl, `Items/${ItemId}/Images/Backdrop`);
  embed.setImage(backdrop);

  const buttonComponents = [];

  if (imdbId) {
    buttonComponents.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("Letterboxd")
        .setURL(`https://letterboxd.com/imdb/${imdbId}`),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("IMDb")
        .setURL(`https://www.imdb.com/title/${imdbId}/`)
    );
  }

  buttonComponents.push(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel("▶ Watch Now!")
      .setURL(
        buildJellyfinUrl(
          ServerUrl,
          "web/index.html",
          `!/details?id=${ItemId}&serverId=${ServerId}`
        )
      )
  );

  const buttons = new ActionRowBuilder().addComponents(buttonComponents);

  const channelId = targetChannelId || process.env.JELLYFIN_CHANNEL_ID;
  const channel = await client.channels.fetch(channelId);
  // Check if this is a batched episode notification and we have an existing message to edit
  if (ItemType === 'Episode' && episodeCount > 1 && episodeDetails && SeriesId) {
    const existingMessage = episodeMessages.get(SeriesId);
    
    if (existingMessage) {
      try {
        const channel = await client.channels.fetch(existingMessage.channelId);
        const message = await channel.messages.fetch(existingMessage.messageId);
        await message.edit({ embeds: [embed], components: [buttons] });
        logger.info(`Updated existing message for: ${embedTitle} (${episodeCount} episodes total)`);
        return; // Early return, don't send a new message
      } catch (err) {
        logger.warn(`Failed to edit existing message for ${SeriesId}, sending new one:`, err);
        // Continue to send new message
      }
    }
  }

  const sentMessage = await channel.send({ embeds: [embed], components: [buttons] });
  
  // Store message reference for future edits (batched episodes only)
  if (ItemType === 'Episode' && episodeCount > 1 && episodeDetails && SeriesId) {
    episodeMessages.set(SeriesId, {
      messageId: sentMessage.id,
      channelId: channel.id
    });
    
    // Clean up message reference after some time (prevent memory leaks)
    setTimeout(() => {
      episodeMessages.delete(SeriesId);
      logger.debug(`Cleaned up message reference for SeriesId: ${SeriesId}`);
    }, 6 * 60 * 60 * 1000); // 6 hours
  }
  logger.info(`Sent notification for: ${embedTitle}`);

  // Send DMs to users who requested this content
  if (usersToNotify.length > 0) {
    for (const userId of usersToNotify) {
      try {
        const user = await client.users.fetch(userId);
        const dmEmbed = new EmbedBuilder()
          .setAuthor({ name: "✅ Your request is now available!" })
          .setTitle(embedTitle)
          .setURL(
            buildJellyfinUrl(
              ServerUrl,
              "web/index.html",
              `!/details?id=${ItemId}&serverId=${ServerId}`
            )
          )
          .setColor("#a6d189")
          .setDescription(
            `${
              Name || SeriesName || "Your requested content"
            } is now available on Jellyfin!`
          )
          .addFields(
            { name: "Genre", value: genreList, inline: true },
            { name: "Runtime", value: runtime, inline: true },
            { name: "Rating", value: rating, inline: true }
          );

        if (backdropPath) {
          const backdropUrl = `https://image.tmdb.org/t/p/w1280${backdropPath}`;
          dmEmbed.setImage(backdropUrl);
        }

        const dmButtons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel("▶ Watch Now!")
            .setURL(
              buildJellyfinUrl(
                ServerUrl,
                "web/index.html",
                `!/details?id=${ItemId}&serverId=${ServerId}`
              )
            )
        );

        await user.send({ embeds: [dmEmbed], components: [dmButtons] });
        logger.info(`Sent DM notification to user ${userId} for ${embedTitle}`);
      } catch (err) {
        logger.error(
          `Failed to send DM to user ${userId}:`,
          err?.message || err
        );
      }
    }
  }
}

export { processAndSendNotification };

export async function handleJellyfinWebhook(req, res, client, pendingRequests) {
  try {
    const data = req.body;
    if (!data || !data.ItemId) return res.status(400).send("No valid data");

    // Allow episodes and seasons with enhanced debouncing

    // Get library ID - try multiple sources from webhook data
    let libraryId = data.LibraryId || data.CollectionId || data.Library_Id;

    // If no library ID in webhook, use advanced detection (traverse parent chain)
    if (!libraryId && data.ItemId) {
      try {
        const apiKey = process.env.JELLYFIN_API_KEY;
        const baseUrl = process.env.JELLYFIN_BASE_URL;

        if (!apiKey || !baseUrl) {
          logger.warn(
            "Cannot detect library: JELLYFIN_API_KEY or JELLYFIN_BASE_URL not configured"
          );
        } else {
          // Import and use the library detection from api/jellyfin.js
          const { fetchLibraries, findLibraryByAncestors } = await import(
            "./api/jellyfin.js"
          );

          // Get libraries and create a Map: CollectionId -> library object
          const libraries = await fetchLibraries(apiKey, baseUrl);

          const libraryMap = new Map();
          for (const lib of libraries) {
            // Map both CollectionId and ItemId to the library object
            libraryMap.set(lib.CollectionId, lib);
            if (lib.ItemId !== lib.CollectionId) {
              libraryMap.set(lib.ItemId, lib);
            }
          }

          // Use new method: query Jellyfin to find which library contains this item
          // Pass ItemType to filter libraries (e.g. don't match Movies library for Episodes)
          libraryId = await findLibraryByAncestors(
            data.ItemId,
            apiKey,
            baseUrl,
            libraryMap,
            data.ItemType
          );
          if (libraryId) {
          }
        }
      } catch (err) {
        logger.warn(`Advanced library detection failed:`, err?.message || err);
      }
    }

    // Parse notification libraries from config (supports both array and object format)
    let notificationLibraries = {};
    let libraryChannelId = null;

    try {
      const parsedLibraries = JSON.parse(
        process.env.JELLYFIN_NOTIFICATION_LIBRARIES || "{}"
      );

      // Handle both array (legacy) and object format
      if (Array.isArray(parsedLibraries)) {
        // Convert array to object with default channel
        parsedLibraries.forEach((libId) => {
          notificationLibraries[libId] = process.env.JELLYFIN_CHANNEL_ID || "";
        });
      } else {
        notificationLibraries = parsedLibraries;
      }
    } catch (e) {
      logger.error("Error parsing JELLYFIN_NOTIFICATION_LIBRARIES:", e);
      notificationLibraries = {};
    }

    logger.debug(
      `Configured libraries: ${JSON.stringify(notificationLibraries)}`
    );

    // Check if library is enabled and get specific channel
    const libraryKeys = Object.keys(notificationLibraries);
    if (
      libraryKeys.length > 0 &&
      libraryId &&
      libraryId in notificationLibraries
    ) {
      // Library found in configuration - use its specific channel or default if empty
      libraryChannelId =
        notificationLibraries[libraryId] || process.env.JELLYFIN_CHANNEL_ID;
      logger.info(
        `✅ Using channel: ${libraryChannelId} for configured library: ${libraryId}`
      );
    } else if (libraryKeys.length > 0 && libraryId) {
      // Library detected but not in configuration - disable notifications
      logger.info(
        `🚫 Library ${libraryId} not enabled in JELLYFIN_NOTIFICATION_LIBRARIES. Skipping notification.`
      );
      return res
        .status(200)
        .send("OK: Notification skipped for disabled library.");
    } else {
      // No library detected - use default channel
      libraryChannelId = process.env.JELLYFIN_CHANNEL_ID;
      logger.warn(
        `⚠️ Could not detect library. Using default channel: ${libraryChannelId}`
      );
    }

    if (data.ItemType === "Movie") {
      await processAndSendNotification(
        data,
        client,
        pendingRequests,
        libraryChannelId
      );
      return res.status(200).send("OK: Movie notification sent.");
    }

    if (
      data.ItemType === "Series" ||
      data.ItemType === "Season" ||
      data.ItemType === "Episode"
    ) {
      const { SeriesId } = data;

      const sentLevel = sentNotifications.has(SeriesId)
        ? sentNotifications.get(SeriesId).level
        : 0;
      const currentLevel = getItemLevel(data.ItemType);

      if (currentLevel <= sentLevel) {
        return res
          .status(200)
          .send(
            `OK: Notification for ${data.Name} skipped, a higher-level notification was already sent.`
          );
      }

      if (!SeriesId) {
        await processAndSendNotification(
          data,
          client,
          pendingRequests,
          libraryChannelId
        );
        return res.status(200).send("OK: TV notification sent (no SeriesId).");
      }

      // If we don't have a debounced function for this series yet, create one.
      if (!debouncedSenders.has(SeriesId)) {
        const newDebouncedSender = debounce((latestData, episodeCount = 0, episodeDetails = null) => {
          processAndSendNotification(
            latestData,
            client,
            pendingRequests,
            libraryChannelId,
            episodeCount,
            episodeDetails
          );

          const levelSent = getItemLevel(latestData.ItemType);

          // Set a cleanup timer for the 'sent' notification state
          const cleanupTimer = setTimeout(() => {
            sentNotifications.delete(SeriesId);
            logger.debug(
              `Cleaned up sent notification state for SeriesId: ${SeriesId}`
            );
          }, 24 * 60 * 60 * 1000); // 24 hours

          sentNotifications.set(SeriesId, {
            level: levelSent,
            cleanupTimer: cleanupTimer,
          });

          // The debounced function has fired, we can remove it.
          debouncedSenders.delete(SeriesId);
        }, parseInt(process.env.WEBHOOK_DEBOUNCE_MS) || DEFAULT_DEBOUNCE_MS);

        debouncedSenders.set(SeriesId, {
          sender: newDebouncedSender,
          latestData: data,
          episodeCount: data.ItemType === 'Episode' ? 1 : 0,
          episodes: data.ItemType === 'Episode' ? [data] : [], // Track individual episodes
          firstEpisode: data.ItemType === 'Episode' ? data : null,
          lastEpisode: data.ItemType === 'Episode' ? data : null,
          timestamp: Date.now(), // Track creation time for periodic cleanup
        });
      }

      // Update the data to be sent with the highest-level notification received so far.
      const debouncer = debouncedSenders.get(SeriesId);
      const existingLevel = getItemLevel(debouncer.latestData.ItemType);

      if (currentLevel >= existingLevel) {
        debouncer.latestData = data;
      }
      
      // Track episode count for better notifications
      if (data.ItemType === 'Episode') {
        debouncer.episodes = debouncer.episodes || [];
        
        // Check for duplicates by EpisodeNumber before adding
        const existingEpisode = debouncer.episodes.find(ep => 
          ep.EpisodeNumber === data.EpisodeNumber && 
          ep.SeasonNumber === data.SeasonNumber
        );
        
        if (!existingEpisode) {
          // Only increment count and add episode if it's not a duplicate
          debouncer.episodeCount = (debouncer.episodeCount || 0) + 1;
          debouncer.episodes.push(data);
          
          // Track first and last episode for range display
          if (!debouncer.firstEpisode || data.EpisodeNumber < debouncer.firstEpisode.EpisodeNumber) {
            debouncer.firstEpisode = data;
          }
          if (!debouncer.lastEpisode || data.EpisodeNumber > debouncer.lastEpisode.EpisodeNumber) {
            debouncer.lastEpisode = data;
          }
        } else {
          logger.debug(`Duplicate episode detected: S${data.SeasonNumber}E${data.EpisodeNumber} - ${data.Name}`);
        }
      }

      // Call the debounced function. It will only execute after the configured debounce period of inactivity.
      const episodeDetails = debouncer.episodes ? {
        episodes: debouncer.episodes,
        firstEpisode: debouncer.firstEpisode,
        lastEpisode: debouncer.lastEpisode
      } : null;
      
      debouncer.sender(debouncer.latestData, debouncer.episodeCount || 0, episodeDetails);

      return res
        .status(200)
        .send(`OK: TV notification for ${SeriesId} is debounced.`);
    }

    await processAndSendNotification(data, client, pendingRequests);
    res.status(200).send("OK: Notification sent.");
  } catch (err) {
    logger.error("Error handling Jellyfin webhook:", err);
    res.status(500).send("Error");
  }
}
