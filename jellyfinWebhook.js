import express from "express";
import bodyParser from "body-parser";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import dotenv from "dotenv";
import axios from "axios";
import { config } from "./config/config.js";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const debounceMap = new Map();
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
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function fetchOMDbData(imdbId) {
  if (!imdbId) return null;
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
    Provider_imdb: imdbId,
    ServerUrl,
    ServerId,
  } = data;

  const omdb = imdbId ? await fetchOMDbData(imdbId) : null;

  let runtime = "Unknown";
  if (omdb?.Runtime) {
    const match = String(omdb.Runtime).match(/(\d+)\s*min/);
    if (match) runtime = minutesToHhMm(parseInt(match[1], 10));
  } else if (RunTime) {
    const ticksMatch = String(RunTime).match(/(\d+)/);
    if (ticksMatch) {
      const mins = Math.round(parseInt(ticksMatch[1], 10) / 600000000);
      runtime = minutesToHhMm(mins);
    }
  }

  const rating = omdb?.imdbRating ? `${omdb.imdbRating}/10` : "N/A";
  const genreList = Array.isArray(Genres)
    ? Genres.join(", ")
    : Genres || omdb?.Genre || "Unknown";
  const overviewText =
    Overview?.trim() || omdb?.Plot || "No description available.";

  const director =
    omdb?.Director && omdb.Director !== "N/A" ? omdb.Director : "";
  let headerLine = "Summary"; // Header default pentru seriale

  if (ItemType === "Movie" && director) {
    headerLine = `Directed by ${director}`;
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
      embedTitle = `${Name || "Unknown Series"}`;
      break;
    case "Season":
      authorName = "📺 New season added!";
      embedTitle = `${SeriesName || "Unknown Series"} - Season ${
        IndexNumber || "?"
      }`;
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
      `${ServerUrl}/web/index.html#!/details?id=${ItemId}&serverId=${ServerId}`
    )
    .setColor("#cba6f7")
    .addFields(
      { name: headerLine, value: overviewText },
      { name: "Genre", value: genreList, inline: true },
      { name: "Runtime", value: runtime, inline: true },
      { name: "Rating", value: rating, inline: true }
    )
    .setImage(`${ServerUrl}/Items/${ItemId}/Images/Thumb`);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel("▶ Watch Now!")
      .setURL(
        `${ServerUrl}/web/index.html#!/details?id=${ItemId}&serverId=${ServerId}`
      )
  );

  if (imdbId) {
    buttons.addComponents(
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

  const channel = await client.channels.fetch(process.env.JELLYFIN_CHANNEL_ID);
  await channel.send({ embeds: [embed], components: [buttons] });
  console.log(`Sent notification for: ${embedTitle}`);
}

export function initJellyfinWebhook(client) {
  const app = express();
  app.use(bodyParser.json({ limit: "10mb" }));

  app.use(express.static(path.join(__dirname)));

  app.post("/jellyfin-webhook", async (req, res) => {
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
          return res
            .status(200)
            .send("OK: TV notification sent (no SeriesId).");
        }

        const existingNotification = debounceMap.get(SeriesId);

        if (existingNotification) {
          clearTimeout(existingNotification.timer);
        }

        const existingLevel = existingNotification
          ? getItemLevel(existingNotification.data.ItemType)
          : 0;

        const dataToSend =
          currentLevel >= existingLevel ? data : existingNotification.data;

        const timer = setTimeout(() => {
          const seriesId = dataToSend.SeriesId;

          processAndSendNotification(dataToSend, client);

          const levelSent = getItemLevel(dataToSend.ItemType);

          if (
            sentNotifications.has(seriesId) &&
            sentNotifications.get(seriesId).cleanupTimer
          ) {
            clearTimeout(sentNotifications.get(seriesId).cleanupTimer);
          }

          const cleanupTimer = setTimeout(() => {
            sentNotifications.delete(seriesId);
            console.log(
              `Cleaned up sent notification state for SeriesId: ${seriesId}`
            );
          }, 24 * 60 * 60 * 1000);

          sentNotifications.set(seriesId, {
            level: levelSent,
            cleanupTimer: cleanupTimer,
          });

          debounceMap.delete(seriesId);
        }, config.webhook.debounce_delay);

        debounceMap.set(SeriesId, {
          timer: timer,
          data: dataToSend,
        });

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
  });

  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
  });

  const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || "8282", 10);
  app.listen(WEBHOOK_PORT, "0.0.0.0", () => {
    console.log(`✅ Jellyfin webhook listener started on port ${WEBHOOK_PORT}`);
  });
}
