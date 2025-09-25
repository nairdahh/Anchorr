import "dotenv/config";
import { initJellyfinWebhook } from "./jellyfinWebhook.js";
import axios from "axios";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

// ----------------- VALIDATE ENV -----------------
const REQUIRED = [
  "DISCORD_TOKEN",
  "BOT_ID",
  "GUILD_ID",
  "JELLYSEERR_URL",
  "JELLYSEERR_API_KEY",
  "TMDB_API_KEY",
];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing required .env vars:", missing.join(", "));
  process.exit(1);
}

// Optional Jellyfin env for new media notifications
const JELLYFIN_BASE_URL = process.env.JELLYFIN_BASE_URL || null;
const JELLYFIN_SERVER_ID = process.env.JELLYFIN_SERVER_ID || null;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const BOT_ID = process.env.BOT_ID;
const GUILD_ID = process.env.GUILD_ID;
const JELLYSEERR_URL = process.env.JELLYSEERR_URL.replace(/\/$/, "");
const JELLYSEERR_API_KEY = process.env.JELLYSEERR_API_KEY;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// Colors
const COLOR_SEARCH = 0xef9f76;
const COLOR_SUCCESS = 0xa6d189;
const COLOR_DEFAULT = 0xef9f76;

// ----------------- HELPERS -----------------
function pad2(n) {
  return String(n).padStart(2, "0");
}

// runtime Xh Ym
function minutesToHhMm(mins) {
  if (typeof mins !== "number" || isNaN(mins) || mins <= 0) return "Unknown";
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60);
  let result = "";
  if (h > 0) result += `${h}h `;
  result += `${m}m`;
  return result;
}

// OMDb fetch (used to get Director / Actors / imdbRating / Runtime fallback)
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

function getOptionStringRobust(
  interaction,
  possibleNames = ["title", "query", "name"]
) {
  for (const n of possibleNames) {
    try {
      const v = interaction.options.getString(n);
      if (typeof v === "string" && v.length > 0) return v;
    } catch (e) {}
  }
  try {
    const data = (interaction.options && interaction.options.data) || [];
    if (Array.isArray(data) && data.length > 0) {
      for (const opt of data) {
        if (typeof opt.value !== "undefined" && opt.value !== null)
          return String(opt.value);
      }
    }
  } catch (e) {}
  return null;
}

async function tmdbSearch(query) {
  const url = "https://api.themoviedb.org/3/search/multi";
  const res = await axios.get(url, {
    params: { api_key: TMDB_API_KEY, query, include_adult: false, page: 1 },
    timeout: 8000,
  });
  return res.data.results || [];
}

async function tmdbGetDetails(id, mediaType) {
  const url =
    mediaType === "movie"
      ? `https://api.themoviedb.org/3/movie/${id}`
      : `https://api.themoviedb.org/3/tv/${id}`;
  const res = await axios.get(url, {
    params: { api_key: TMDB_API_KEY, language: "en-US" },
  });
  return res.data;
}

async function tmdbGetExternalImdb(id, mediaType) {
  const url =
    mediaType === "movie"
      ? `https://api.themoviedb.org/3/movie/${id}/external_ids`
      : `https://api.themoviedb.org/3/tv/${id}/external_ids`;
  const res = await axios.get(url, { params: { api_key: TMDB_API_KEY } });
  return res.data.imdb_id || null;
}

// ----------------- JELLYSEERR -----------------
async function sendRequestToJellyseerr(tmdbId, mediaType, details) {
  const payload = {
    mediaId: tmdbId,
    mediaType: mediaType,
  };

  if (mediaType === "tv") {
    if (
      details &&
      Array.isArray(details.seasons) &&
      details.seasons.length > 0
    ) {
      const firstSeason = details.seasons.find(
        (s) => typeof s.season_number === "number" && s.season_number > 0
      );
      payload.seasons = firstSeason ? [firstSeason.season_number] : [1];
    } else {
      payload.seasons = [1];
    }
  }

  try {
    console.log("Trying Jellyseerr request with payload:", payload);
    const response = await axios.post(`${JELLYSEERR_URL}/request`, payload, {
      headers: { "X-Api-Key": JELLYSEERR_API_KEY },
      timeout: 10000,
    });
    console.log("Jellyseerr request successful!");
    return response.data;
  } catch (err) {
    console.error(
      "Jellyseerr request failed:",
      err?.response?.data || err?.message || err
    );
    throw err;
  }
}

// ----------------- EMBED BUILDER -----------------
function buildNotificationEmbed(
  details,
  mediaType,
  imdbId,
  status = "search",
  omdb = null
) {
  const titleName = details.title || details.name || "Unknown";
  const releaseDate = details.release_date || details.first_air_date || "";
  const year = releaseDate ? releaseDate.slice(0, 4) : "";
  const titleWithYear = year ? `${titleName} (${year})` : titleName;

  const authorName =
    status === "success"
      ? "✅ Successfully requested!"
      : mediaType === "movie"
      ? "🎬 Movie found:"
      : "📺 TV show found:";

  const genres =
    (details.genres || []).map((g) => g.name).join(", ") || "Unknown";

  let runtime = "Unknown";
  if (mediaType === "movie" && details.runtime > 0)
    runtime = minutesToHhMm(details.runtime);
  else if (
    mediaType === "tv" &&
    Array.isArray(details.episode_run_time) &&
    details.episode_run_time.length
  )
    runtime = minutesToHhMm(details.episode_run_time[0]);

  const rating =
    typeof details.vote_average === "number" && details.vote_average > 0
      ? `${details.vote_average.toFixed(1)}/10`
      : "N/A";

  const overview =
    (details.overview && details.overview.trim() !== ""
      ? details.overview
      : null) ||
    (omdb?.Plot && omdb.Plot !== "N/A"
      ? omdb.Plot
      : "No description available.");

  let director = "";
  if (omdb && mediaType === "movie") {
    director = omdb.Director && omdb.Director !== "N/A" ? omdb.Director : "";
  }

  let headerLine = "Summary";
  if (director) {
    headerLine = `Directed by ${director}`;
  }

  const embed = new EmbedBuilder()
    .setAuthor({ name: authorName })
    .setTitle(titleWithYear)
    .setURL(imdbId ? `https://www.imdb.com/title/${imdbId}/` : undefined)
    .setColor(
      status === "success"
        ? COLOR_SUCCESS
        : status === "search"
        ? COLOR_SEARCH
        : COLOR_DEFAULT
    );

  const backdrop = details.backdrop_path
    ? `https://image.tmdb.org/t/p/w1280${details.backdrop_path}`
    : null;
  const poster = details.poster_path
    ? `https://image.tmdb.org/t/p/w342${details.poster_path}`
    : null;
  if (backdrop) embed.setImage(backdrop);
  else if (poster) embed.setThumbnail(poster);

  embed.addFields(
    {
      name: headerLine,
      value: overview.length ? overview : "No description available.",
    },
    { name: "Genre", value: genres, inline: true },
    { name: "Runtime", value: runtime, inline: true },
    { name: "Rating", value: rating, inline: true }
  );

  return embed;
}

// ----------------- BUTTONS BUILDER -----------------
function buildButtons(tmdbId, imdbId, requested = false, mediaType = "movie") {
  const buttons = [];

  if (imdbId) {
    buttons.push(
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

  if (requested) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`requested|${tmdbId}|${mediaType}`)
        .setLabel("Requested, stay tuned!")
        .setStyle(ButtonStyle.Success)
        .setDisabled(true)
    );
  } else {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`request_btn|${tmdbId}|${mediaType}`)
        .setLabel("Request")
        .setStyle(ButtonStyle.Primary)
    );
  }

  return [new ActionRowBuilder().addComponents(...buttons.slice(0, 5))];
}

// ----------------- COMMON SEARCH LOGIC -----------------
async function handleSearchOrRequest(interaction, raw, mode = "search") {
  let tmdbId = null;
  let mediaType = null;

  if (raw?.includes("|")) {
    [tmdbId, mediaType] = raw.split("|");
    tmdbId = parseInt(tmdbId, 10);
  } else if (raw) {
    const found = (await tmdbSearch(raw)).filter(
      (r) => r.media_type === "movie" || r.media_type === "tv"
    );
    if (found.length) {
      tmdbId = found[0].id;
      mediaType = found[0].media_type;
    }
  }

  if (!tmdbId || !mediaType) {
    return interaction.reply({
      content: "⚠️ The title seems to be invalid.",
      flags: 64,
    });
  }

  await interaction.deferReply();

  try {
    const details = await tmdbGetDetails(tmdbId, mediaType);

    if (mode === "request") {
      await sendRequestToJellyseerr(tmdbId, mediaType, details);
    }

    const imdbId = await tmdbGetExternalImdb(tmdbId, mediaType);

    const omdb = imdbId ? await fetchOMDbData(imdbId) : null;

    const embed = buildNotificationEmbed(
      details,
      mediaType,
      imdbId,
      mode === "request" ? "success" : "search",
      omdb
    );

    const components = buildButtons(
      tmdbId,
      imdbId,
      mode === "request",
      mediaType
    );

    await interaction.editReply({ embeds: [embed], components });
  } catch (err) {
    console.error("Error in handleSearchOrRequest:", err);
    await interaction.editReply({
      content: "⚠️ An error occurred.",
      components: [],
      embeds: [],
    });
  }
}

// ----------------- SLASH COMMANDS -----------------
const commands = [
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Search for a movie/TV show (you can request it later)")
    .addStringOption((opt) =>
      opt
        .setName("title")
        .setDescription("Title")
        .setRequired(true)
        .setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName("request")
    .setDescription("Send instant request for a movie/TV show")
    .addStringOption((opt) =>
      opt
        .setName("title")
        .setDescription("Title")
        .setRequired(true)
        .setAutocomplete(true)
    ),
].map((c) => c.toJSON());

// ----------------- REGISTER COMMANDS -----------------
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  try {
    console.log("Registering guild commands...");
    await rest.put(Routes.applicationGuildCommands(BOT_ID, GUILD_ID), {
      body: commands,
    });
    console.log("Commands registered!");
  } catch (err) {
    console.error("Failed registering commands:", err);
  }
})();

// ----------------- EVENTS -----------------

client.on("interactionCreate", async (interaction) => {
  try {
    // Autocomplete
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused();
      if (!focused) return interaction.respond([]);
      const results = await tmdbSearch(focused);
      const filtered = results
        .filter((r) => r.media_type === "movie" || r.media_type === "tv")
        .slice(0, 25);
      const choices = filtered.map((item) => {
        const emoji = item.media_type === "movie" ? "🎬" : "📺";
        const date = item.release_date || item.first_air_date || "";
        const year = date ? ` (${date.slice(0, 4)})` : "";
        return {
          name: `${emoji} ${item.title || item.name}${year}`,
          value: `${item.id}|${item.media_type}`,
        };
      });
      return interaction.respond(choices);
    }

    // Commands
    if (interaction.isCommand()) {
      const raw = getOptionStringRobust(interaction);
      if (interaction.commandName === "search")
        return handleSearchOrRequest(interaction, raw, "search");
      if (interaction.commandName === "request")
        return handleSearchOrRequest(interaction, raw, "request");
    }

    // Button: request
    if (
      interaction.isButton() &&
      interaction.customId.startsWith("request_btn|")
    ) {
      const parts = interaction.customId.split("|");
      const tmdbIdStr = parts[1];
      const mediaType = parts[2] || "movie";
      const tmdbId = parseInt(tmdbIdStr, 10);
      if (!tmdbId)
        return interaction.reply({ content: "⚠️ ID invalid.", flags: 64 });

      await interaction.deferUpdate();

      try {
        const details = await tmdbGetDetails(tmdbId, mediaType);

        await sendRequestToJellyseerr(tmdbId, mediaType, details);

        const imdbId = await tmdbGetExternalImdb(tmdbId, mediaType);
        const omdb = imdbId ? await fetchOMDbData(imdbId) : null;

        const embed = buildNotificationEmbed(
          details,
          mediaType,
          imdbId,
          "success",
          omdb
        );
        const components = buildButtons(tmdbId, imdbId, true, mediaType);

        if (interaction.message && interaction.message.edit) {
          await interaction.message.edit({ embeds: [embed], components });
        } else {
          await interaction.followUp({
            embeds: [embed],
            components,
            flags: 64,
          });
        }
      } catch (err) {
        console.error("Button request error:", err);
        try {
          await interaction.followUp({
            content: "⚠️ I could not send the request.",
            flags: 64,
          });
        } catch {}
      }
    }

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("requested|")
    ) {
      try {
        await interaction.reply({
          content: "This item was already requested.",
          flags: 64,
        });
      } catch {}
    }
  } catch (outerErr) {
    console.error("Interaction handler error:", outerErr);
  }
});

// ----------------- LOGIN -----------------
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  initJellyfinWebhook(client);
});

client.login(process.env.DISCORD_TOKEN);
