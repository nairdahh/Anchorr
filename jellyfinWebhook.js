import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import axios from "axios";
import debounce from "lodash.debounce";

const debouncedSenders = new Map();
const sentNotifications = new Map();

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

function minutesToHhMm(mins) {
  if (typeof mins !== "number" || isNaN(mins) || mins <= 0) return "Unknown";
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60);
  let result = "";
  if (h > 0) result += `${h}h `;
  result += `${m}m`;
  return result;
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
    const h = hash ? (String(hash).startsWith("#") ? String(hash) : `#${hash}`) : "";
    return `${baseNoSlash}/${pathNoLead}${h}`;
  }
}

async function fetchOMDbData(imdbId) {
  if (!imdbId || !process.env.OMDB_API_KEY) return null;
  try {
    const res = await axios.get("http://www.omdbapi.com/", {
      params: { i: imdbId, apikey: process.env.OMDB_API_KEY },
      timeout: 7000,
    });
    return res.data;
  } catch (err) {
    console.warn("OMDb fetch failed:", err?.message || err);
    return null;
  }
}

const findBestBackdrop = (details) => {
  if (details.images?.backdrops?.length > 0) {
    const englishBackdrop = details.images.backdrops.find(
      (b) => b.iso_639_1 === "en"
    );
    if (englishBackdrop) return englishBackdrop.file_path;
  }
  return details.backdrop_path;
};

async function processAndSendNotification(data, client) {
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
  } = data;

  // We need to fetch details from TMDB to get the backdrop
  const tmdbId = data.Provider_tmdb;
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
      console.warn(`Could not fetch TMDB details for ${tmdbId}`);
    }
  }

  // Prioritize IMDb ID from TMDB, fallback to webhook
  const imdbId = details?.external_ids?.imdb_id || imdbIdFromWebhook;

  const omdb = imdbId ? await fetchOMDbData(imdbId) : null;

  let runtime = "Unknown";
  if (omdb?.Runtime && omdb.Runtime !== "N/A") {
    const match = String(omdb.Runtime).match(/(\d+)/);
    if (match) runtime = minutesToHhMm(parseInt(match[1], 10));
  } else if (ItemType === "Movie" && details?.runtime > 0) {
    runtime = minutesToHhMm(details.runtime);
  } else if (
    (ItemType === "Series" ||
      ItemType === "Episode" ||
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
      }) - Season ${IndexNumber || "?"}`;
      break;
    case "Episode":
      authorName = "📺 New episode added!";
      embedTitle = `${SeriesName || "Unknown Series"} - S${String(
        data.ParentIndexNumber
      ).padStart(2, "0")}E${String(IndexNumber).padStart(2, "0")} - ${Name}`;
      break;
    default:
      authorName = "✨ New item added";
      embedTitle = Name || "Unknown Title";
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
    .setColor("#cba6f7")
    .addFields(
      { name: headerLine, value: overviewText },
      { name: "Genre", value: genreList, inline: true },
      { name: "Runtime", value: runtime, inline: true },
      { name: "Rating", value: rating, inline: true }
    );

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

  const channel = await client.channels.fetch(process.env.JELLYFIN_CHANNEL_ID);
  await channel.send({ embeds: [embed], components: [buttons] });
  console.log(`Sent notification for: ${embedTitle}`);
}

export async function handleJellyfinWebhook(req, res, client) {
  try {
    const data = req.body;
    if (!data || !data.ItemId) return res.status(400).send("No valid data");

    if (data.ItemType === "Movie") {
      await processAndSendNotification(data, client);
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
        await processAndSendNotification(data, client);
        return res.status(200).send("OK: TV notification sent (no SeriesId).");
      }

      // If we don't have a debounced function for this series yet, create one.
      if (!debouncedSenders.has(SeriesId)) {
        const newDebouncedSender = debounce((latestData) => {
          processAndSendNotification(latestData, client);

          const levelSent = getItemLevel(latestData.ItemType);

          // Set a cleanup timer for the 'sent' notification state
          const cleanupTimer = setTimeout(() => {
            sentNotifications.delete(SeriesId);
            console.log(
              `Cleaned up sent notification state for SeriesId: ${SeriesId}`
            );
          }, 24 * 60 * 60 * 1000); // 24 hours

          sentNotifications.set(SeriesId, {
            level: levelSent,
            cleanupTimer: cleanupTimer,
          });

          // The debounced function has fired, we can remove it.
          debouncedSenders.delete(SeriesId);
        }, 30000); // 30-second debounce window

        debouncedSenders.set(SeriesId, {
          sender: newDebouncedSender,
          latestData: data,
        });
      }

      // Update the data to be sent with the highest-level notification received so far.
      const debouncer = debouncedSenders.get(SeriesId);
      const existingLevel = getItemLevel(debouncer.latestData.ItemType);

      if (currentLevel >= existingLevel) {
        debouncer.latestData = data;
      }

      // Call the debounced function. It will only execute after 30s of inactivity.
      debouncer.sender(debouncer.latestData);

      return res
        .status(200)
        .send(`OK: TV notification for ${SeriesId} is debounced.`);
    }

    await processAndSendNotification(data, client);
    res.status(200).send("OK: Notification sent.");
  } catch (err) {
    console.error("Error handling Jellyfin webhook:", err);
    res.status(500).send("Error");
  }
}
