import fs from "fs";
import path from "path";
import express from "express";
import { handleJellyfinWebhook } from "./jellyfinWebhook.js";
import { configTemplate } from "./config/config.js";
import axios from "axios";

import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} from "discord.js";

// --- CONFIGURATION ---
// Use /config volume if in Docker, otherwise use current directory
const CONFIG_PATH = fs.existsSync("/config")
  ? path.join("/config", "config.json")
  : path.join(process.cwd(), "config.json");
const ENV_PATH = path.join(process.cwd(), ".env");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const envVars = {};

    content.split("\n").forEach((line) => {
      line = line.trim();
      // Skip empty lines and comments
      if (!line || line.startsWith("#")) return;

      const [key, ...valueParts] = line.split("=");
      const trimmedKey = key.trim();
      const trimmedValue = valueParts.join("=").trim();

      // Remove quotes if present
      const cleanValue = trimmedValue.replace(/^["']|["']$/g, "");

      if (trimmedKey && cleanValue) {
        envVars[trimmedKey] = cleanValue;
      }
    });

    return envVars;
  } catch (error) {
    console.error("Error reading or parsing .env file:", error);
    return {};
  }
}

function migrateEnvToConfig() {
  // Check if .env exists and config.json doesn't
  if (fs.existsSync(ENV_PATH) && !fs.existsSync(CONFIG_PATH)) {
    console.log(
      "🔄 Detected .env file. Migrating environment variables to config.json..."
    );

    const envVars = parseEnvFile(ENV_PATH);
    const migratedConfig = { ...configTemplate };

    // Map .env variables to config
    for (const [key, value] of Object.entries(envVars)) {
      if (key in migratedConfig) {
        migratedConfig[key] = value;
      }
    }

    // Save migrated config
    try {
      // Ensure /config directory exists with proper permissions
      const configDir = path.dirname(CONFIG_PATH);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true, mode: 0o777 });
      }
      
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(migratedConfig, null, 2), { mode: 0o666 });
      console.log("✅ Migration successful! config.json created from .env");
      console.log(
        "📝 You can now delete the .env file as it's no longer needed."
      );
    } catch (error) {
      console.error("❌ Error saving migrated config:", error);
      console.error("Check that /config directory has write permissions");
    }
  }
}

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const rawData = fs.readFileSync(CONFIG_PATH, "utf-8");
      const config = JSON.parse(rawData);
      // Load config into process.env for compatibility with existing code
      for (const [key, value] of Object.entries(config)) {
        process.env[key] = value;
      }
      return true;
    } catch (error) {
      console.error("Error reading or parsing config.json:", error);
      return false;
    }
  }
  return false;
}

const app = express();
let port = process.env.WEBHOOK_PORT || 8282;

// --- BOT STATE MANAGEMENT ---
let discordClient = null;
let isBotRunning = false;

async function startBot() {
  if (isBotRunning && discordClient) {
    console.log("Bot is already running.");
    return { success: true, message: "Bot is already running." };
  }

  // Load the latest config from file
  const configLoaded = loadConfig();
  port = process.env.WEBHOOK_PORT || 8282; // Recalculate port in case it changed
  if (!configLoaded) {
    throw new Error(
      "Configuration file (config.json) not found or is invalid."
    );
  }

  // ----------------- VALIDATE ENV -----------------
  const REQUIRED_DISCORD = ["DISCORD_TOKEN", "BOT_ID", "GUILD_ID"];

  const missing = REQUIRED_DISCORD.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Bot cannot start. Missing required Discord variables: ${missing.join(
        ", "
      )}`
    );
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    partials: [Partials.Channel],
  });
  discordClient = client; // Store client instance globally

  const BOT_ID = process.env.BOT_ID;
  const GUILD_ID = process.env.GUILD_ID;
  const JELLYSEERR_URL = process.env.JELLYSEERR_URL?.replace(/\/$/, "");
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
      params: {
        api_key: TMDB_API_KEY,
        language: "en-US",
        append_to_response: "images,credits",
      },
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
  async function sendRequestToJellyseerr(tmdbId, mediaType, seasons = []) {
    const payload = {
      mediaId: tmdbId,
      mediaType: mediaType,
    };

    if (mediaType === "tv" && seasons.length > 0) {
      payload.seasons = seasons.includes("all")
        ? "all"
        : seasons.map((s) => parseInt(s, 10));
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
    if (omdb?.Runtime && omdb.Runtime !== "N/A") {
      const match = String(omdb.Runtime).match(/(\d+)/);
      if (match) runtime = minutesToHhMm(parseInt(match[1], 10));
    } else if (mediaType === "movie" && details.runtime > 0) {
      runtime = minutesToHhMm(details.runtime);
    } else if (
      mediaType === "tv" &&
      Array.isArray(details.episode_run_time) &&
      details.episode_run_time.length > 0
    ) {
      runtime = minutesToHhMm(details.episode_run_time[0]);
    }

    const rating = omdb?.imdbRating
      ? `${omdb.imdbRating}/10`
      : typeof details.vote_average === "number" && details.vote_average > 0
      ? `${details.vote_average.toFixed(1)}/10`
      : "N/A";

    const overview =
      (details.overview && details.overview.trim() !== ""
        ? details.overview
        : null) ||
      (omdb?.Plot && omdb.Plot !== "N/A"
        ? omdb.Plot
        : "No description available.");

    let headerLine = "Summary";
    if (omdb) {
      if (mediaType === "movie" && omdb.Director && omdb.Director !== "N/A") {
        headerLine = `Directed by ${omdb.Director}`;
      } else if (mediaType === "tv" && omdb.Writer && omdb.Writer !== "N/A") {
        // OMDb often lists creators under "Writer"
        const creator = omdb.Writer.split(",")[0].trim();
        headerLine = `Created by ${creator}`;
      }
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

    const backdropPath = findBestBackdrop(details);
    const backdrop = backdropPath
      ? `https://image.tmdb.org/t/p/w1280${backdropPath}`
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
  function buildButtons(
    tmdbId,
    imdbId,
    requested = false,
    mediaType = "movie",
    details = null,
    requestedSeasons = []
  ) {
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

    const rows = [];
    if (
      mediaType === "tv" &&
      details?.seasons?.length > 0 &&
      requestedSeasons.length === 0 &&
      !requested // Don't show selector if it's an instant request
    ) {
      const seasonOptions = [
        { label: "All Seasons", value: "all" },
        ...details.seasons
          .filter((s) => s.season_number > 0)
          .map((s) => ({
            label: `Season ${s.season_number} (${s.episode_count} episodes)`,
            value: String(s.season_number),
          })),
      ];

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`request_seasons|${tmdbId}`)
        .setPlaceholder("Select seasons to request...")
        .setMinValues(1)
        .setMaxValues(seasonOptions.length)
        .addOptions(seasonOptions.slice(0, 25)); // Max 25 options

      if (buttons.length > 0) {
        rows.push(new ActionRowBuilder().addComponents(buttons));
      }
      rows.push(new ActionRowBuilder().addComponents(selectMenu));
    } else {
      if (requested) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`requested|${tmdbId}|${mediaType}`)
            .setLabel("Requested, stay tuned!")
            .setStyle(ButtonStyle.Success)
            .setDisabled(true)
        );
        if (requestedSeasons.length > 0) {
          let seasonLabel;
          if (requestedSeasons.includes("all")) {
            seasonLabel = "All Seasons";
          } else if (requestedSeasons.length === 1) {
            seasonLabel = `Season ${requestedSeasons[0]}`;
          } else {
            const lastSeason = requestedSeasons.pop();
            seasonLabel = `Seasons ${requestedSeasons.join(
              ", "
            )} and ${lastSeason}`;
          }
          buttons[buttons.length - 1].setLabel(`Requested ${seasonLabel}`);
        } else {
          buttons[buttons.length - 1].setLabel("Requested, stay tuned!");
        }
      } else {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`request_btn|${tmdbId}|${mediaType}`)
            .setLabel("Request")
            .setStyle(ButtonStyle.Primary)
        );
      }
      if (buttons.length > 0) {
        rows.push(new ActionRowBuilder().addComponents(...buttons.slice(0, 5)));
      }
    }

    return rows;
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

    // Use MessageFlags.Ephemeral based on configuration
    const isEphemeral = String(process.env.EPHEMERAL_INTERACTIONS || 'false').toLowerCase() === 'true';
    await interaction.deferReply({ flags: isEphemeral ? MessageFlags.Ephemeral : undefined });

    try {
      const details = await tmdbGetDetails(tmdbId, mediaType);

      if (mode === "request") {
        await sendRequestToJellyseerr(tmdbId, mediaType, ["all"]);
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
        mediaType,
        details
      );

      // For both search & request: check if interactions should be ephemeral.
      const isEphemeral = String(process.env.EPHEMERAL_INTERACTIONS || 'false').toLowerCase() === 'true';
      await interaction.editReply({ embeds: [embed], components, ephemeral: isEphemeral });
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

  // --- CONFIGURE WEBHOOK ROUTE FOR BOT MODE ---
  // This must be done before app.listen is called.
  app.use(express.json({ limit: "10mb" }));
  app.post("/jellyfin-webhook", (req, res) => {
    if (!isBotRunning) return res.status(503).send("Bot is not running.");
    handleJellyfinWebhook(req, res, client);
  });

  // ----------------- REGISTER COMMANDS -----------------
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log("Registering guild commands...");
    await rest.put(Routes.applicationGuildCommands(BOT_ID, GUILD_ID), {
      body: commands,
    });
    console.log("Commands registered!");
  } catch (err) {
    throw new Error(`Failed to register Discord commands: ${err.message}`);
  }

  // ----------------- EVENTS -----------------

  client.on("interactionCreate", async (interaction) => {
    try {
      // Autocomplete
      if (interaction.isAutocomplete()) {
        const focused = interaction.options.getFocused();
        if (!focused) return interaction.respond([]);
        
        try {
          const results = await tmdbSearch(focused);
          const filtered = results
            .filter((r) => r.media_type === "movie" || r.media_type === "tv")
            .slice(0, 25);
          
          const choicePromises = filtered.map(async (item) => {
            try {
              const emoji = item.media_type === "movie" ? "🎬" : "📺";
              const date = item.release_date || item.first_air_date || "";
              const year = date ? ` (${date.slice(0, 4)})` : "";
              
              // Fetch detailed info from TMDB
              const details = await tmdbGetDetails(item.id, item.media_type);
              
              let extraInfo = "";
              
              if (item.media_type === "movie") {
                // Get director
                const director = details.credits?.crew?.find(c => c.job === "Director")?.name;
                if (director) {
                  extraInfo += ` — directed by ${director}`;
                }
                // Get runtime
                if (details.runtime) {
                  const hours = Math.floor(details.runtime / 60);
                  const mins = details.runtime % 60;
                  const runtime = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                  extraInfo += ` — runtime: ${runtime}`;
                }
              } else if (item.media_type === "tv") {
                // Get creator
                const creator = details.created_by?.[0]?.name;
                if (creator) {
                  extraInfo += ` — created by ${creator}`;
                }
                // Get seasons count
                if (details.number_of_seasons) {
                  const seasons = details.number_of_seasons;
                  extraInfo += ` — ${seasons} season${seasons > 1 ? 's' : ''}`;
                }
              }
              
              let fullName = `${emoji} ${item.title || item.name}${year}${extraInfo}`;
              
              // Discord requires choice names to be 1-100 characters
              // Keep it safe at 98 and add ... within that limit if needed
              if (fullName.length > 98) {
                fullName = fullName.substring(0, 95) + '...';
              }
              
              return {
                name: fullName,
                value: `${item.id}|${item.media_type}`,
              };
            } catch (e) {
              // Fallback to basic info if details fetch fails
              const emoji = item.media_type === "movie" ? "🎬" : "📺";
              const date = item.release_date || item.first_air_date || "";
              const year = date ? ` (${date.slice(0, 4)})` : "";
              let fallback = `${emoji} ${item.title || item.name}${year}`;
              if (fallback.length > 98) fallback = fallback.substring(0, 95) + '...';
              return {
                name: fallback,
                value: `${item.id}|${item.media_type}`,
              };
            }
          });

          const choices = await Promise.all(choicePromises);
          return await interaction.respond(choices);
        } catch (e) {
          console.error('Autocomplete error:', e);
          return await interaction.respond([]);
        }
      }

      // Commands
      if (interaction.isCommand()) {
        // Check if the required configs for commands are present
        if (!JELLYSEERR_URL || !JELLYSEERR_API_KEY || !TMDB_API_KEY) {
          return interaction.reply({
            content:
              "⚠️ This command is disabled because Jellyseerr or TMDB configuration is missing.",
            flags: MessageFlags.Ephemeral,
          });
        }
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

          await sendRequestToJellyseerr(tmdbId, mediaType, ["all"]);

          const imdbId = await tmdbGetExternalImdb(tmdbId, mediaType);
          const omdb = imdbId ? await fetchOMDbData(imdbId) : null;

          const embed = buildNotificationEmbed(
            details,
            mediaType,
            imdbId,
            "success",
            omdb
          );
          const originalEmbeds = interaction.message.embeds;
          const disabledComponents = buildButtons(tmdbId, imdbId, true, mediaType);

          await interaction.editReply({ embeds: originalEmbeds, components: disabledComponents });
          const isEphemeral = String(process.env.EPHEMERAL_INTERACTIONS || 'false').toLowerCase() === 'true';
          await interaction.followUp({ embeds: [embed], flags: isEphemeral ? MessageFlags.Ephemeral : undefined });
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

      // Select Menu: request seasons
      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith("request_seasons|")
      ) {
        const tmdbId = parseInt(interaction.customId.split("|")[1], 10);
        const selectedSeasons = interaction.values;

        if (!tmdbId || !selectedSeasons.length) {
          return interaction.reply({
            content: "⚠️ Invalid selection.",
            flags: MessageFlags.Ephemeral,
          });
        }

        await interaction.deferUpdate();

        try {
          await sendRequestToJellyseerr(tmdbId, "tv", selectedSeasons);

          const details = await tmdbGetDetails(tmdbId, "tv");
          const imdbId = await tmdbGetExternalImdb(tmdbId, "tv");
          const omdb = imdbId ? await fetchOMDbData(imdbId) : null;

          const embed = buildNotificationEmbed(
            details,
            "tv",
            imdbId,
            "success",
            omdb
          );

          // Disable the select menu after successful request
          const originalEmbeds = interaction.message.embeds;
          const disabledComponents = buildButtons(
            tmdbId,
            imdbId,
            true,
            "tv",
            details,
            selectedSeasons
          );

          await interaction.editReply({
            embeds: originalEmbeds,
            components: disabledComponents,
          });
          const isEphemeral = String(process.env.EPHEMERAL_INTERACTIONS || 'false').toLowerCase() === 'true';
          await interaction.followUp({ embeds: [embed], flags: isEphemeral ? MessageFlags.Ephemeral : undefined });
        } catch (err) {
          console.error("Season request error:", err);
          await interaction.followUp({
            content:
              "⚠️ I could not send the request for the selected seasons.",
            flags: MessageFlags.Ephemeral,
          });
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

  return new Promise((resolve, reject) => {
    client.once("ready", () => {
      console.log(`✅ Bot logged in as ${client.user.tag}`);
      isBotRunning = true;
      resolve({ success: true, message: `Logged in as ${client.user.tag}` });
    });

    client.login(process.env.DISCORD_TOKEN).catch((err) => {
      console.error("Bot login failed:", err);
      isBotRunning = false;
      discordClient = null;
      reject(err);
    });
  });
}

function configureWebServer() {
  app.use(express.json()); // Middleware for parsing JSON bodies
  app.use("/assets", express.static(path.join(process.cwd(), "assets")));
  app.use(express.static(path.join(process.cwd(), "web")));

  app.get("/", (req, res) => {
    res.sendFile(path.join(process.cwd(), "web", "index.html"));
  });

  app.post("/jellyfin-webhook", (req, res) => {
    if (!isBotRunning || !discordClient)
      return res.status(503).send("Bot is not running.");
    handleJellyfinWebhook(req, res, discordClient);
  });

  app.get("/api/config", (req, res) => {
    if (fs.existsSync(CONFIG_PATH)) {
      const rawData = fs.readFileSync(CONFIG_PATH, "utf-8");
      const config = JSON.parse(rawData);
      res.json(config);
    } else {
      // If no config file, return the template from config/config.js
      res.json(configTemplate);
    }
  });

  app.post("/api/save-config", async (req, res) => {
    const configData = req.body;
    const oldToken = process.env.DISCORD_TOKEN;
    const oldGuildId = process.env.GUILD_ID;

    try {
      // Ensure /config directory exists with proper permissions
      const configDir = path.dirname(CONFIG_PATH);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true, mode: 0o777 });
      }
      
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(configData, null, 2), { mode: 0o666 });
      console.log('✅ Configuration saved successfully');
    } catch (writeErr) {
      console.error('Error saving config.json:', writeErr);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to save configuration file. Check Docker volume permissions.' 
      });
    }
    
    loadConfig(); // Reload config into process.env

    // If bot is running and critical settings changed, restart the bot logic
    if (
      isBotRunning &&
      (oldToken !== process.env.DISCORD_TOKEN ||
        oldGuildId !== process.env.GUILD_ID)
    ) {
      console.log("Critical Discord settings changed. Restarting bot logic...");
      await discordClient.destroy();
      isBotRunning = false;
      discordClient = null;
      try {
        await startBot();
        res
          .status(200)
          .json({ message: "Configuration saved. Bot restarted." });
      } catch (error) {
        res.status(500).json({
          message: `Config saved, but bot failed to restart: ${error.message}`,
        });
      }
    } else {
      res.status(200).json({ message: "Configuration saved successfully!" });
    }
  });

  app.post("/api/test-jellyseerr", async (req, res) => {
    const { url, apiKey } = req.body;
    if (!url || !apiKey) {
      return res
        .status(400)
        .json({ success: false, message: "URL and API Key are required." });
    }

    try {
      const response = await axios.get(
        `${url.replace(/\/$/, "")}/settings/about`,
        {
          headers: { "X-Api-Key": apiKey },
          timeout: 8000,
        }
      );
      const version = response.data?.version;
      res.json({
        success: true,
        message: `Connection successful! (v${version})`,
      });
    } catch (error) {
      console.error("Jellyseerr test failed:", error.message);
      // Check if the error is due to an invalid API key (401/403)
      if (error.response && [401, 403].includes(error.response.status)) {
        return res
          .status(401)
          .json({ success: false, message: "Invalid API Key." });
      }
      res.status(500).json({
        success: false,
        message: "Connection failed. Check URL and API Key.",
      });
    }
  });

  app.post("/api/test-jellyfin", async (req, res) => {
    const { url, apiKey } = req.body;
    if (!url) {
      return res
        .status(400)
        .json({ success: false, message: "Jellyfin URL is required." });
    }

    try {
      const testUrl = `${url.replace(/\/$/, "")}/System/Info/Public`;
      const headers = {};
      
      // Add API key to headers if provided for more comprehensive testing
      if (apiKey) {
        headers["X-Emby-Token"] = apiKey;
      }
      
      const response = await axios.get(testUrl, { 
        headers,
        timeout: 8000 
      });

      if (response.data?.ServerName && response.data?.Version) {
        const authStatus = apiKey ? " (with API key)" : " (public endpoint)";
        return res.json({
          success: true,
          message: `Connected to ${response.data.ServerName} (v${response.data.Version})${authStatus}`,
        });
      }
      throw new Error("Invalid response from Jellyfin server.");
    } catch (error) {
      console.error("Jellyfin test failed:", error.message);
      res.status(500).json({
        success: false,
        message: "Connection failed. Check URL and network.",
      });
    }
  });

  // Fetch all Jellyfin libraries for the exclusion UI
  app.post("/api/jellyfin-libraries", async (req, res) => {
    const { url, apiKey } = req.body;
    if (!url) {
      return res
        .status(400)
        .json({ success: false, message: "Jellyfin URL is required." });
    }

    try {
      // Fetch libraries from Jellyfin API
      // The endpoint requires authentication if apiKey is provided
      const librariesUrl = `${url.replace(/\/$/, "")}/Library/MediaFolders`;
      const headers = {};
      
      // Add API key to headers if provided
      if (apiKey) {
        headers["X-Emby-Token"] = apiKey;
      }

      const response = await axios.get(librariesUrl, { 
        headers,
        timeout: 8000 
      });

      // Extract relevant library information
      const libraries = (response.data?.Items || []).map(lib => ({
        id: lib.Id,
        name: lib.Name,
        type: lib.CollectionType || 'mixed'
      }));

      res.json({
        success: true,
        libraries: libraries
      });
    } catch (error) {
      console.error("Failed to fetch Jellyfin libraries:", error.message);
      res.status(500).json({
        success: false,
        message: "Failed to fetch libraries. Make sure the URL is correct and the server is accessible.",
      });
    }
  });

  app.get("/api/status", (req, res) => {
    res.json({
      isBotRunning,
      botUsername:
        isBotRunning && discordClient?.user ? discordClient.user.tag : null,
    });
  });

  app.post("/api/start-bot", async (req, res) => {
    if (isBotRunning) {
      return res.status(400).json({ message: "Bot is already running." });
    }
    try {
      const result = await startBot();
      res
        .status(200)
        .json({ message: `Bot started successfully! ${result.message}` });
    } catch (error) {
      res.status(500).json({
        message: `Failed to start bot: ${error.message}`,
      });
    }
  });

  app.post("/api/stop-bot", async (req, res) => {
    if (!isBotRunning || !discordClient) {
      return res.status(400).json({ message: "Bot is not running." });
    }
    await discordClient.destroy();
    isBotRunning = false;
    discordClient = null;
    console.log("Bot has been stopped.");
    res.status(200).json({ message: "Bot stopped successfully." });
  });
}

// --- INITIALIZE AND START SERVER ---
// First, check for .env migration before anything else
migrateEnvToConfig();

console.log("Initializing web server...");
configureWebServer();
console.log("Web server configured successfully");

// --- START THE SERVER ---
// This single `app.listen` call handles both modes.
let server;

function startServer() {
  loadConfig();
  port = process.env.WEBHOOK_PORT || 8282;
  console.log(`Attempting to start server on port ${port}...`);
  server = app.listen(port, "0.0.0.0");

  server.on("listening", () => {
    const address = server.address();
    if (address) {
      console.log(`✅ Anchorr web server is running on port ${address.port}.`);
      console.log(`📝 Access it at:`);
      console.log(`   - Local: http://127.0.0.1:${address.port}`);
      console.log(`   - Network: http://<your-server-ip>:${address.port}`);
      console.log(`   - Docker: http://<host-ip>:${address.port}`);
    }

    // Auto-start bot if a valid config.json is present
    try {
      const autoStartFlag = String(
        typeof process.env.AUTO_START_BOT === "undefined"
          ? "true"
          : process.env.AUTO_START_BOT
      )
        .trim()
        .toLowerCase();

      const autoStartDisabled = ["false", "0", "no"].includes(autoStartFlag);
      if (autoStartDisabled) {
        console.log("ℹ️ AUTO_START_BOT is disabled. Bot will not auto-start.");
        return;
      }

      const hasConfigFile = fs.existsSync(CONFIG_PATH);
      const required = ["DISCORD_TOKEN", "BOT_ID", "GUILD_ID"];
      const hasDiscordCreds = required.every(
        (k) => process.env[k] && String(process.env[k]).trim() !== ""
      );

      if (!isBotRunning && hasConfigFile && hasDiscordCreds) {
        console.log("🚀 Detected existing config.json with Discord credentials. Auto-starting bot...");
        (async () => {
          try {
            await startBot();
            console.log("✅ Bot auto-started successfully.");
          } catch (e) {
            console.error("❌ Bot auto-start failed:", e?.message || e);
          }
        })();
      } else if (!hasDiscordCreds) {
        console.log("ℹ️ Config found but Discord credentials are incomplete. Bot not auto-started.");
      }
    } catch (e) {
      console.error("Error during auto-start check:", e?.message || e);
    }
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `❌ Port ${port} is already in use. Please free the port or change WEBHOOK_PORT.`
      );
    } else {
      console.error("Server error:", err);
    }
    process.exit(1);
  });
}

// Keep the process alive
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

// Catch uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

startServer();
