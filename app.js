import fs from "fs";
import path from "path";
import express from "express";
import rateLimit from "express-rate-limit";
import { handleJellyfinWebhook } from "./jellyfinWebhook.js";
import { configTemplate } from "./config/config.js";
import axios from "axios";

import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";

// --- MODULE IMPORTS ---
import * as tmdbApi from "./api/tmdb.js";
import * as jellyseerrApi from "./api/jellyseerr.js";
import { registerCommands } from "./discord/commands.js";
import logger from "./utils/logger.js";
import { validateBody, configSchema, userMappingSchema } from "./utils/validation.js";
import cache from "./utils/cache.js";
import { COLORS, TIMEOUTS } from "./config/constants.js";

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
    logger.error("Error reading or parsing .env file:", error);
    return {};
  }
}

function migrateEnvToConfig() {
  // Check if .env exists and config.json doesn't
  if (fs.existsSync(ENV_PATH) && !fs.existsSync(CONFIG_PATH)) {
    logger.info(
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
      
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(migratedConfig, null, 2), { mode: 0o600 });
      logger.info("✅ Migration successful! config.json created from .env");
      logger.info(
        "📝 You can now delete the .env file as it's no longer needed."
      );
    } catch (error) {
      logger.error("❌ Error saving migrated config:", error);
      logger.error("Check that /config directory has write permissions");
    }
  }
}

function loadConfig() {
  logger.debug("[LOADCONFIG] Checking CONFIG_PATH:", CONFIG_PATH);
  logger.debug("[LOADCONFIG] File exists:", fs.existsSync(CONFIG_PATH));
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const rawData = fs.readFileSync(CONFIG_PATH, "utf-8");
      const config = JSON.parse(rawData);
      logger.debug("[LOADCONFIG] Config keys:", Object.keys(config));
      logger.debug("[LOADCONFIG] DISCORD_TOKEN in config:", config.DISCORD_TOKEN ? config.DISCORD_TOKEN.slice(0, 6) + '...' : 'UNDEFINED IN CONFIG');

      // Normalize JELLYSEERR_URL to remove /api/v1 suffix if present
      if (config.JELLYSEERR_URL && typeof config.JELLYSEERR_URL === 'string') {
        config.JELLYSEERR_URL = config.JELLYSEERR_URL.replace(/\/api\/v1\/?$/, '');
      }

      // Load config into process.env for compatibility with existing code
      for (const [key, value] of Object.entries(config)) {
        // Convert objects to JSON strings to avoid "[object Object]" conversion
        process.env[key] = typeof value === 'object' ? JSON.stringify(value) : value;
      }
      logger.debug("[LOADCONFIG] Loaded DISCORD_TOKEN into process.env:", process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.slice(0, 6) + '...' : 'UNDEFINED AFTER SET');
      return true;
    } catch (error) {
      logger.error("Error reading or parsing config.json:", error);
      return false;
    }
  }
  logger.debug("[LOADCONFIG] Config file does not exist");
  return false;
}

const app = express();
let port = process.env.WEBHOOK_PORT || 8282;

// --- BOT STATE MANAGEMENT ---
let discordClient = null;
let isBotRunning = false;

// --- PENDING REQUESTS TRACKING ---
// Map to track user requests: key = "tmdbId-mediaType", value = Set of Discord user IDs
const pendingRequests = new Map();

async function startBot() {
  if (isBotRunning && discordClient) {
    logger.info("Bot is already running.");
    return { success: true, message: "Bot is already running." };
  }


  // DEBUG: Log Discord credentials (partial)
  logger.debug("[DEBUG] BOT_ID:", process.env.BOT_ID);
  logger.debug("[DEBUG] GUILD_ID:", process.env.GUILD_ID);
  logger.debug("[DEBUG] DISCORD_TOKEN:", process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.slice(0, 6) + '...' : undefined);

  // Load the latest config from file
  const configLoaded = loadConfig();
  port = process.env.WEBHOOK_PORT || 8282; // Recalculate port in case it changed
  if (!configLoaded) {
    throw new Error(
      "Configuration file (config.json) not found or is invalid."
    );
  }

  // DEBUG: Log Discord credentials after loadConfig
  logger.debug("[DEBUG AFTER LOAD] BOT_ID:", process.env.BOT_ID);
  logger.debug("[DEBUG AFTER LOAD] GUILD_ID:", process.env.GUILD_ID);
  logger.debug("[DEBUG AFTER LOAD] DISCORD_TOKEN:", process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.slice(0, 6) + '...' : 'UNDEFINED AFTER LOAD');

  // ----------------- VALIDATE ENV -----------------
  const REQUIRED_DISCORD = ["DISCORD_TOKEN", "BOT_ID"];
  const missing = REQUIRED_DISCORD.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Bot cannot start. Missing required Discord variables: ${missing.join(", ")}`
    );
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.Channel],
  });
  discordClient = client; // Store client instance globally

  const BOT_ID = process.env.BOT_ID;
  const GUILD_ID = process.env.GUILD_ID;
  let JELLYSEERR_URL = process.env.JELLYSEERR_URL?.replace(/\/$/, "");
  if (JELLYSEERR_URL && !JELLYSEERR_URL.endsWith('/api/v1')) {
    JELLYSEERR_URL += '/api/v1';
  }
  const JELLYSEERR_API_KEY = process.env.JELLYSEERR_API_KEY;
  const TMDB_API_KEY = process.env.TMDB_API_KEY;

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
        timeout: TIMEOUTS.OMDB_API,
      });
      return res.data;
    } catch (err) {
      logger.warn("OMDb fetch failed:", err?.message || err);
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

    let overview =
      (details.overview && details.overview.trim() !== ""
        ? details.overview
        : null) ||
      (omdb?.Plot && omdb.Plot !== "N/A"
        ? omdb.Plot
        : "No description available.");

    // Add "stay tuned!" for successful requests
    if (status === "success") {
      overview = overview + "\n\n🎬 Stay tuned!";
    }

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
          ? COLORS.SUCCESS
          : status === "search"
          ? COLORS.SEARCH
          : COLORS.DEFAULT
      );

    const backdropPath = tmdbApi.findBestBackdrop(details);
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
      const found = (await tmdbApi.tmdbSearch(raw, TMDB_API_KEY)).filter(
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
      const details = await tmdbApi.tmdbGetDetails(tmdbId, mediaType, TMDB_API_KEY);

      if (mode === "request") {
        // Check if media already exists in Jellyseerr
        const status = await jellyseerrApi.checkMediaStatus(
          tmdbId,
          mediaType,
          ["all"],
          JELLYSEERR_URL,
          JELLYSEERR_API_KEY
        );

        if (status.exists && status.available) {
          // Media already available
          await interaction.editReply({
            content: "✅ This content is already available in your library!",
            components: [],
            embeds: [],
          });
          return;
        }

        await jellyseerrApi.sendRequest({
          tmdbId,
          mediaType,
          seasons: ["all"],
          jellyseerrUrl: JELLYSEERR_URL,
          apiKey: JELLYSEERR_API_KEY,
          discordUserId: interaction.user.id,
          userMappings: process.env.USER_MAPPINGS || {},
        });

        // Track request for notifications if enabled
        if (process.env.NOTIFY_ON_AVAILABLE === "true") {
          const requestKey = `${tmdbId}-${mediaType}`;
          if (!pendingRequests.has(requestKey)) {
            pendingRequests.set(requestKey, new Set());
          }
          pendingRequests.get(requestKey).add(interaction.user.id);
        }
      }

      const imdbId = await tmdbApi.tmdbGetExternalImdb(tmdbId, mediaType, TMDB_API_KEY);

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

      await interaction.editReply({ embeds: [embed], components });
    } catch (err) {
      logger.error("Error in handleSearchOrRequest:", err);
      await interaction.editReply({
        content: "⚠️ An error occurred.",
        components: [],
        embeds: [],
      });
    }
  }

  // ----------------- REGISTER COMMANDS -----------------
  // Înregistrează comenzile global sau guild-specific
  logger.debug(`[REGISTER COMMANDS] Attempting to register commands for BOT_ID: ${BOT_ID}`);
  logger.debug(`[REGISTER COMMANDS] DISCORD_TOKEN available: ${!!process.env.DISCORD_TOKEN}`);
  logger.debug(`[REGISTER COMMANDS] DISCORD_TOKEN value: ${process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.slice(0, 10) + '...' : 'UNDEFINED'}`);

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  logger.debug(`[REGISTER COMMANDS] REST token set: ${!!rest.token}`);
  logger.debug(`[REGISTER COMMANDS] REST token value: ${rest.token ? rest.token.slice(0, 10) + '...' : 'UNDEFINED'}`);

  try {
    await registerCommands(rest, BOT_ID, GUILD_ID || null, console);
  } catch (err) {
    logger.error(`[REGISTER COMMANDS] Failed to register Discord commands:`, err);
    throw new Error(`Failed to register Discord commands: ${err.message}`);
  }

  // ----------------- EVENTS -----------------

  // Helper function to check if user has permission based on role allowlist/blocklist
  function checkRolePermission(member) {
    if (!member || !member.roles) return true; // No member info, allow

    const allowlist = process.env.ROLE_ALLOWLIST
      ? JSON.parse(process.env.ROLE_ALLOWLIST)
      : [];
    const blocklist = process.env.ROLE_BLOCKLIST
      ? JSON.parse(process.env.ROLE_BLOCKLIST)
      : [];

    const userRoles = member.roles.cache.map(r => r.id);

    // If allowlist exists and user doesn't have any of those roles, deny
    if (allowlist.length > 0 && !userRoles.some(r => allowlist.includes(r))) {
      return false;
    }

    // If user has any blocklisted role, deny
    if (blocklist.length > 0 && userRoles.some(r => blocklist.includes(r))) {
      return false;
    }

    return true;
  }

  client.on("interactionCreate", async (interaction) => {
    try {
      // Check role permissions for all commands
      if (interaction.isCommand() || interaction.isStringSelectMenu() && !interaction.customId.startsWith("request_seasons|") && !interaction.customId.startsWith("request_with_tags|")) {
        if (!checkRolePermission(interaction.member)) {
          return interaction.reply({
            content: "❌ You don't have permission to use this command.",
            flags: 64,
          });
        }
      }

      // Autocomplete
      if (interaction.isAutocomplete()) {
        const focused = interaction.options.getFocused();
        if (!focused) return interaction.respond([]);
        
        try {
          const results = await tmdbApi.tmdbSearch(focused, TMDB_API_KEY);
          const filtered = results
            .filter((r) => r.media_type === "movie" || r.media_type === "tv")
            .slice(0, 25);

          const choicePromises = filtered.map(async (item) => {
            try {
              const emoji = item.media_type === "movie" ? "🎬" : "📺";
              const date = item.release_date || item.first_air_date || "";
              const year = date ? ` (${date.slice(0, 4)})` : "";

              // Fetch detailed info from TMDB
              const details = await tmdbApi.tmdbGetDetails(item.id, item.media_type, TMDB_API_KEY);
              
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
          logger.error('Autocomplete error:', e);
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
            ephemeral: true,
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
          const details = await tmdbApi.tmdbGetDetails(tmdbId, mediaType, TMDB_API_KEY);

          // Check if media already exists in Jellyseerr
          const status = await jellyseerrApi.checkMediaStatus(
            tmdbId,
            mediaType,
            ["all"],
            JELLYSEERR_URL,
            JELLYSEERR_API_KEY
          );

          if (status.exists && status.available) {
            // Media already available
            await interaction.followUp({
              content: "✅ This content is already available in your library!",
              flags: 64,
            });
            return;
          }

          await jellyseerrApi.sendRequest({
            tmdbId,
            mediaType,
            seasons: ["all"],
            jellyseerrUrl: JELLYSEERR_URL,
            apiKey: JELLYSEERR_API_KEY,
            discordUserId: interaction.user.id,
            userMappings: process.env.USER_MAPPINGS || {},
          });

          // Track request for notifications if enabled
          if (process.env.NOTIFY_ON_AVAILABLE === "true") {
            const requestKey = `${tmdbId}-${mediaType}`;
            if (!pendingRequests.has(requestKey)) {
              pendingRequests.set(requestKey, new Set());
            }
            pendingRequests.get(requestKey).add(interaction.user.id);
          }

          const imdbId = await tmdbApi.tmdbGetExternalImdb(tmdbId, mediaType, TMDB_API_KEY);
          const omdb = imdbId ? await fetchOMDbData(imdbId) : null;

          const embed = buildNotificationEmbed(
            details,
            mediaType,
            imdbId,
            "success",
            omdb
          );
          const components = buildButtons(tmdbId, imdbId, true, mediaType);

          await interaction.editReply({ embeds: [embed], components });
        } catch (err) {
          logger.error("Button request error:", err);
          try {
            await interaction.followUp({
              content: "⚠️ I could not send the request.",
              flags: 64,
            });
          } catch (followUpErr) {
            logger.error("Failed to send follow-up message:", followUpErr);
          }
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
            ephemeral: true,
          });
        }

        await interaction.deferUpdate();

        try {
          // Check if requested seasons already exist in Jellyseerr
          const status = await jellyseerrApi.checkMediaStatus(
            tmdbId,
            "tv",
            selectedSeasons,
            JELLYSEERR_URL,
            JELLYSEERR_API_KEY
          );

          if (status.exists && status.available) {
            // Requested seasons already available
            await interaction.followUp({
              content: "✅ The requested seasons are already available in your library!",
              flags: 64,
            });
            return;
          }

          // Fetch available tags for selection
          const tags = await jellyseerrApi.fetchTags(JELLYSEERR_URL, JELLYSEERR_API_KEY);

          // If tags are available, show tag selection menu; otherwise proceed with request
          if (tags && tags.length > 0) {
            const tagOptions = tags.slice(0, 25).map(tag => ({
              label: tag.label || tag.name || `Tag ${tag.id}`,
              value: tag.id.toString(),
            }));

            const tagMenu = new StringSelectMenuBuilder()
              .setCustomId(`request_with_tags|${tmdbId}|${selectedSeasons.join(',')}`)
              .setPlaceholder("Select tags (optional)")
              .addOptions(tagOptions)
              .setMinValues(0)
              .setMaxValues(Math.min(5, tagOptions.length));

            const tagRow = new ActionRowBuilder().addComponents(tagMenu);

            await interaction.editReply({
              content: "Select tags for this request (optional):",
              components: [tagRow],
            });
            return;
          }

          // No tags available, proceed directly with request
          await jellyseerrApi.sendRequest({
            tmdbId,
            mediaType: "tv",
            seasons: selectedSeasons,
            jellyseerrUrl: JELLYSEERR_URL,
            apiKey: JELLYSEERR_API_KEY,
            discordUserId: interaction.user.id,
            userMappings: process.env.USER_MAPPINGS || {},
          });

          // Track request for notifications if enabled
          if (process.env.NOTIFY_ON_AVAILABLE === "true") {
            const requestKey = `${tmdbId}-tv`;
            if (!pendingRequests.has(requestKey)) {
              pendingRequests.set(requestKey, new Set());
            }
            pendingRequests.get(requestKey).add(interaction.user.id);
          }

          const details = await tmdbApi.tmdbGetDetails(tmdbId, "tv", TMDB_API_KEY);
          const imdbId = await tmdbApi.tmdbGetExternalImdb(tmdbId, "tv", TMDB_API_KEY);
          const omdb = imdbId ? await fetchOMDbData(imdbId) : null;

          const embed = buildNotificationEmbed(
            details,
            "tv",
            imdbId,
            "success",
            omdb
          );

          // Disable the select menu after successful request
          const components = buildButtons(
            tmdbId,
            imdbId,
            true,
            "tv",
            details,
            selectedSeasons
          );

          await interaction.editReply({
            embeds: [embed],
            components: components,
          });
        } catch (err) {
          logger.error("Season request error:", err);
          await interaction.followUp({
            content:
              "⚠️ I could not send the request for the selected seasons.",
            ephemeral: true,
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
        } catch (replyErr) {
          logger.error("Failed to send 'already requested' reply:", replyErr);
        }
      }

      // Select Menu: tags for request
      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith("request_with_tags|")
      ) {
        const parts = interaction.customId.split("|");
        const tmdbId = parseInt(parts[1], 10);
        const selectedSeasons = parts[2].split(",");
        const selectedTags = interaction.values.map(v => parseInt(v, 10));

        if (!tmdbId) {
          return interaction.reply({
            content: "⚠️ Invalid request data.",
            flags: 64,
          });
        }

        await interaction.deferUpdate();

        try {
          // Get tag names from Jellyseerr for display
          const allTags = await jellyseerrApi.fetchTags(JELLYSEERR_URL, JELLYSEERR_API_KEY);
          const tagNames = selectedTags
            .map(tagId => allTags.find(t => t.id === tagId)?.label || allTags.find(t => t.id === tagId)?.name || `Tag ${tagId}`)
            .join(", ");

          // Build button label
          const seasonLabel = selectedSeasons.length === 1 ? `season ${selectedSeasons[0]}` : `seasons ${selectedSeasons.join(", ")}`;
          const buttonLabel = tagNames
            ? `Request ${seasonLabel} with ${tagNames}`
            : `Request ${seasonLabel}`;

          // Trim to 80 chars max (Discord button limit)
          const trimmedLabel = buttonLabel.length > 80 ? buttonLabel.substring(0, 77) + "..." : buttonLabel;

          // Create button to confirm request with tags
          const confirmButton = new ButtonBuilder()
            .setCustomId(`confirm_request_with_tags|${tmdbId}|${selectedSeasons.join(',')}|${selectedTags.join(',')}`)
            .setLabel(trimmedLabel)
            .setStyle(ButtonStyle.Success);

          const buttonRow = new ActionRowBuilder().addComponents(confirmButton);

          await interaction.editReply({
            content: `Confirm your request:`,
            components: [buttonRow],
          });
        } catch (err) {
          logger.error("Tags display error:", err);
          await interaction.followUp({
            content: "⚠️ Could not display tags.",
            ephemeral: true,
          });
        }
      }

      // Button: confirm request with tags
      if (
        interaction.isButton() &&
        interaction.customId.startsWith("confirm_request_with_tags|")
      ) {
        const parts = interaction.customId.split("|");
        const tmdbId = parseInt(parts[1], 10);
        const selectedSeasons = parts[2].split(",");
        const selectedTags = parts[3].split(",").map(v => parseInt(v, 10));

        if (!tmdbId) {
          return interaction.reply({
            content: "⚠️ Invalid request data.",
            flags: 64,
          });
        }

        await interaction.deferUpdate();

        try {
          await jellyseerrApi.sendRequest({
            tmdbId,
            mediaType: "tv",
            seasons: selectedSeasons,
            tags: selectedTags.length > 0 ? selectedTags : undefined,
            jellyseerrUrl: JELLYSEERR_URL,
            apiKey: JELLYSEERR_API_KEY,
            discordUserId: interaction.user.id,
            userMappings: process.env.USER_MAPPINGS || {},
          });

          // Track request for notifications if enabled
          if (process.env.NOTIFY_ON_AVAILABLE === "true") {
            const requestKey = `${tmdbId}-tv`;
            if (!pendingRequests.has(requestKey)) {
              pendingRequests.set(requestKey, new Set());
            }
            pendingRequests.get(requestKey).add(interaction.user.id);
          }

          const details = await tmdbApi.tmdbGetDetails(tmdbId, "tv", TMDB_API_KEY);
          const imdbId = await tmdbApi.tmdbGetExternalImdb(tmdbId, "tv", TMDB_API_KEY);
          const omdb = imdbId ? await fetchOMDbData(imdbId) : null;

          const embed = buildNotificationEmbed(
            details,
            "tv",
            imdbId,
            "success",
            omdb
          );

          const components = buildButtons(
            tmdbId,
            imdbId,
            true,
            "tv",
            details,
            selectedSeasons
          );

          await interaction.editReply({
            embeds: [embed],
            components: components,
          });
        } catch (err) {
          logger.error("Request with tags error:", err);
          await interaction.followUp({
            content: "⚠️ I could not send the request with tags.",
            ephemeral: true,
          });
        }
      }
    } catch (outerErr) {
      logger.error("Interaction handler error:", outerErr);
    }
  });

  return new Promise((resolve, reject) => {
    client.once("clientReady", () => {
      logger.info(`✅ Bot logged in as ${client.user.tag}`);
      isBotRunning = true;
      resolve({ success: true, message: `Logged in as ${client.user.tag}` });
    });

    client.login(process.env.DISCORD_TOKEN).catch((err) => {
      logger.error("[DISCORD LOGIN ERROR] Bot login failed:");
      if (err && err.message) {
        logger.error("[DISCORD LOGIN ERROR] Message:", err.message);
      }
      if (err && err.code) {
        logger.error("[DISCORD LOGIN ERROR] Code:", err.code);
      }
      if (err && err.stack) {
        logger.error("[DISCORD LOGIN ERROR] Stack:", err.stack);
      }
      isBotRunning = false;
      discordClient = null;
      reject(err);
    });
  });
}

function configureWebServer() {
    // Middleware for parsing JSON bodies - MUST be before routes that use req.body
    app.use(express.json());

    // Rate limiting middleware - DoS protection
    const apiLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per windowMs
      message: { success: false, error: 'Too many requests, please try again later.' },
      standardHeaders: true,
      legacyHeaders: false,
    });

    const configLimiter = rateLimit({
      windowMs: 5 * 60 * 1000, // 5 minutes
      max: 10, // Limit config changes to 10 per 5 minutes
      message: { success: false, error: 'Too many configuration changes, please slow down.' },
      standardHeaders: true,
      legacyHeaders: false,
    });

    // Apply rate limiting to all API endpoints
    app.use('/api/', apiLimiter);

    // Endpoint pentru lista de servere Discord (guilds)
    app.get("/api/discord/guilds", async (req, res) => {
      try {
        if (!discordClient || !discordClient.user) {
          logger.debug("[GUILDS API] Bot not running or not logged in.");
          return res.json({ success: false, message: "Bot not running" });
        }
        // Debug: log all guilds
        logger.debug("[GUILDS API] discordClient.guilds.cache:", discordClient.guilds.cache.map(g => ({id: g.id, name: g.name})));
        // Fetch guilds the bot is in
        const guilds = discordClient.guilds.cache.map(g => ({
          id: g.id,
          name: g.name
        }));
        res.json({ success: true, guilds });
      } catch (err) {
        logger.error("[GUILDS API] Error:", err);
        res.json({ success: false, message: err.message });
      }
    });

    // Endpoint pentru lista de canale Discord dintr-un server
    app.get("/api/discord/channels/:guildId", async (req, res) => {
      try {
        const { guildId } = req.params;
        if (!discordClient || !discordClient.user) {
          logger.debug("[CHANNELS API] Bot not running or not logged in.");
          return res.json({ success: false, message: "Bot not running" });
        }

        const guild = discordClient.guilds.cache.get(guildId);
        if (!guild) {
          return res.json({ success: false, message: "Guild not found" });
        }

        // Fetch text channels where bot can send messages
        const channels = guild.channels.cache
          .filter(channel =>
            channel.type === 0 && // GUILD_TEXT
            channel.permissionsFor(discordClient.user).has("SendMessages")
          )
          .map(channel => ({
            id: channel.id,
            name: channel.name,
            type: channel.type === 2 ? 'announcement' : 'text'
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        logger.debug(`[CHANNELS API] Found ${channels.length} channels in guild ${guild.name}`);
        res.json({ success: true, channels });
      } catch (err) {
        logger.error("[CHANNELS API] Error:", err);
        res.json({ success: false, message: err.message });
      }
    });

    // Endpoint pentru membrii Discord dintr-un server
    app.get("/api/discord-members", async (req, res) => {
      try {
        logger.debug("[MEMBERS API] Request received");
        if (!discordClient || !discordClient.user) {
          logger.debug("[MEMBERS API] Bot not running");
          return res.json({ success: false, message: "Bot not running" });
        }

        const guildId = process.env.GUILD_ID;
        logger.debug("[MEMBERS API] GUILD_ID from env:", guildId);
        if (!guildId) {
          logger.debug("[MEMBERS API] No guild selected");
          return res.json({ success: false, message: "No guild selected" });
        }

        const guild = discordClient.guilds.cache.get(guildId);
        if (!guild) {
          logger.debug("[MEMBERS API] Guild not found in cache");
          return res.json({ success: false, message: "Guild not found" });
        }

        logger.debug("[MEMBERS API] Guild found:", guild.name, "Member count:", guild.memberCount);

        // Check if bot has permission to view members
        const botMember = guild.members.cache.get(discordClient.user.id);
        if (!botMember) {
          logger.debug("[MEMBERS API] Bot member not found in guild");
          return res.json({ success: false, message: "Bot not in guild" });
        }

        logger.debug("[MEMBERS API] Bot permissions:", botMember.permissions.toArray());

        // Try to fetch members - this may fail if GUILD_MEMBERS intent is not enabled
        try {
          logger.debug("[MEMBERS API] Attempting to fetch members...");
          await guild.members.fetch();
          logger.debug("[MEMBERS API] Members fetched successfully");
        } catch (fetchErr) {
          logger.error("[MEMBERS API] Failed to fetch members:", fetchErr.message);
          logger.debug("[MEMBERS API] This is normal if Server Members Intent is not enabled in Discord Developer Portal");
          logger.debug("[MEMBERS API] Using cached members instead");
        }

        // Get members from cache (will include bot and users that have been active)
        const members = guild.members.cache
          .filter(member => !member.user.bot) // Exclude bots
          .map(member => ({
            id: member.id,
            username: member.user.username,
            displayName: member.displayName,
            avatar: member.user.displayAvatarURL({ size: 64 }),
            discriminator: member.user.discriminator
          }))
          .slice(0, 100); // Limit to first 100 members for performance

        logger.debug(`[MEMBERS API] Returning ${members.length} members`);
        res.json({ success: true, members });
      } catch (err) {
        logger.error("[MEMBERS API] Error:", err);
        res.json({ success: false, message: err.message });
      }
    });

    // Endpoint pentru rolurile Discord dintr-un server
    app.get("/api/discord-roles", async (req, res) => {
      try {
        logger.debug("[ROLES API] Request received");
        if (!discordClient || !discordClient.user) {
          logger.debug("[ROLES API] Bot not running");
          return res.json({ success: false, message: "Bot not running" });
        }

        const guildId = process.env.GUILD_ID;
        logger.debug("[ROLES API] GUILD_ID from env:", guildId);
        if (!guildId) {
          logger.debug("[ROLES API] No guild selected");
          return res.json({ success: false, message: "No guild selected" });
        }

        const guild = discordClient.guilds.cache.get(guildId);
        if (!guild) {
          logger.debug("[ROLES API] Guild not found in cache");
          return res.json({ success: false, message: "Guild not found" });
        }

        logger.debug("[ROLES API] Guild found:", guild.name);

        // Fetch roles
        const roles = guild.roles.cache
          .filter(role => !role.managed) // Exclude managed roles (bot roles)
          .map(role => ({
            id: role.id,
            name: role.name,
            color: role.hexColor,
            memberCount: role.members.size
          }))
          .sort((a, b) => b.memberCount - a.memberCount); // Sort by member count descending

        logger.debug(`[ROLES API] Returning ${roles.length} roles`);
        res.json({ success: true, roles });
      } catch (err) {
        logger.error("[ROLES API] Error:", err);
        res.json({ success: false, message: err.message });
      }
    });

    // Endpoint pentru utilizatorii Jellyseerr
    app.get("/api/jellyseerr-users", async (req, res) => {
      try {
        logger.debug("[JELLYSEERR USERS API] Request received");
        const jellyseerrUrl = process.env.JELLYSEERR_URL;
        const apiKey = process.env.JELLYSEERR_API_KEY;

        logger.debug("[JELLYSEERR USERS API] JELLYSEERR_URL:", jellyseerrUrl);
        logger.debug("[JELLYSEERR USERS API] API_KEY present:", !!apiKey);

        if (!jellyseerrUrl || !apiKey) {
          logger.debug("[JELLYSEERR USERS API] Missing configuration");
          return res.json({ success: false, message: "Jellyseerr configuration missing" });
        }

        let baseUrl = jellyseerrUrl.replace(/\/$/, "");
        if (!baseUrl.endsWith('/api/v1')) {
          baseUrl += '/api/v1';
        }

        logger.debug("[JELLYSEERR USERS API] Making request to:", `${baseUrl}/user`);

        const response = await axios.get(
          `${baseUrl}/user`,
          {
            headers: { "X-Api-Key": apiKey },
            timeout: TIMEOUTS.JELLYSEERR_API,
          }
        );

        logger.debug("[JELLYSEERR USERS API] Response received, status:", response.status);
        logger.debug("[JELLYSEERR USERS API] Response data type:", typeof response.data);
        logger.debug("[JELLYSEERR USERS API] Response data is array:", Array.isArray(response.data));
        if (!Array.isArray(response.data)) {
          logger.debug("[JELLYSEERR USERS API] Response data keys:", Object.keys(response.data));
        }
        logger.debug("[JELLYSEERR USERS API] Response data length:", Array.isArray(response.data) ? response.data.length : (response.data.results?.length || 'N/A'));

        // Jellyseerr API returns { pageInfo, results: [] }
        const userData = response.data.results || [];
        
        const users = userData.map(user => {
          let avatar = user.avatar || null;
          // If avatar is relative, make it absolute
          if (avatar && !avatar.startsWith('http')) {
            avatar = `${jellyseerrUrl.replace(/\/api\/v1$/, '')}${avatar}`;
          }
          return {
            id: user.id,
            displayName: user.displayName || user.username || `User ${user.id}`,
            email: user.email || '',
            avatar: avatar
          };
        });

        logger.debug(`[JELLYSEERR USERS API] Returning ${users.length} users`);
        res.json({ success: true, users });
      } catch (err) {
        logger.error("[JELLYSEERR USERS API] Error:", err.message);
        if (err.response) {
          logger.error("[JELLYSEERR USERS API] Response status:", err.response.status);
          logger.error("[JELLYSEERR USERS API] Response data:", err.response.data);
        }
        res.json({ success: false, message: err.message });
      }
    });

    // Endpoint pentru mapările utilizatorilor
    app.get("/api/user-mappings", (req, res) => {
      // Load from config.json
      if (fs.existsSync(CONFIG_PATH)) {
        try {
          const rawData = fs.readFileSync(CONFIG_PATH, "utf-8");
          const config = JSON.parse(rawData);
          const mappings = config.USER_MAPPINGS || [];
          res.json(mappings);
        } catch (error) {
          logger.error("Error reading config for mappings:", error);
          res.json([]);
        }
      } else {
        res.json([]);
      }
    });

    app.post("/api/user-mappings", validateBody(userMappingSchema), (req, res) => {
      const { discordUserId, jellyseerrUserId, discordUsername, discordDisplayName, jellyseerrDisplayName } = req.body;

      if (!discordUserId || !jellyseerrUserId) {
        return res.status(400).json({ success: false, message: "Discord user ID and Jellyseerr user ID are required." });
      }

      try {
        // Load current config
        let config = {};
        if (fs.existsSync(CONFIG_PATH)) {
          const rawData = fs.readFileSync(CONFIG_PATH, "utf-8");
          config = JSON.parse(rawData);
        }

        // Initialize USER_MAPPINGS if it doesn't exist
        if (!config.USER_MAPPINGS) {
          config.USER_MAPPINGS = [];
        }

        // Check if mapping already exists
        const existingIndex = config.USER_MAPPINGS.findIndex(
          mapping => mapping.discordUserId === discordUserId
        );

        const mapping = {
          discordUserId,
          jellyseerrUserId,
          discordUsername: discordUsername || null,
          discordDisplayName: discordDisplayName || null,
          jellyseerrDisplayName: jellyseerrDisplayName || null,
          createdAt: new Date().toISOString()
        };

        if (existingIndex >= 0) {
          // Update existing mapping
          config.USER_MAPPINGS[existingIndex] = mapping;
        } else {
          // Add new mapping
          config.USER_MAPPINGS.push(mapping);
        }

        // Save updated config
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });

        res.json({ success: true, message: "Mapping saved successfully." });
      } catch (error) {
        logger.error("Error saving user mapping:", error);
        res.status(500).json({ success: false, message: "Failed to save mapping." });
      }
    });

    app.delete("/api/user-mappings/:discordUserId", (req, res) => {
      const { discordUserId } = req.params;

      try {
        // Load current config
        let config = {};
        if (fs.existsSync(CONFIG_PATH)) {
          const rawData = fs.readFileSync(CONFIG_PATH, "utf-8");
          config = JSON.parse(rawData);
        }

        if (!config.USER_MAPPINGS) {
          return res.status(404).json({ success: false, message: "No mappings found." });
        }

        // Find and remove the mapping
        const initialLength = config.USER_MAPPINGS.length;
        config.USER_MAPPINGS = config.USER_MAPPINGS.filter(
          mapping => mapping.discordUserId !== discordUserId
        );

        if (config.USER_MAPPINGS.length === initialLength) {
          return res.status(404).json({ success: false, message: "Mapping not found." });
        }

        // Save updated config
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });

        res.json({ success: true, message: "Mapping deleted successfully." });
      } catch (error) {
        logger.error("Error deleting user mapping:", error);
        res.status(500).json({ success: false, message: "Failed to delete mapping." });
      }
    });

    // Endpoint pentru bibliotecile Jellyfin
    app.post("/api/jellyfin-libraries", async (req, res) => {
      try {
        const { url, apiKey } = req.body;

        if (!url || !apiKey) {
          return res.status(400).json({ success: false, message: "URL and API Key are required." });
        }

        const response = await axios.get(
          `${url.replace(/\/$/, "")}/Library/MediaFolders`,
          {
            headers: { "X-Emby-Token": apiKey },
            timeout: TIMEOUTS.JELLYFIN_API,
          }
        );

        const libraries = response.data.Items.map(item => ({
          id: item.Id,
          name: item.Name,
          type: item.CollectionType || 'unknown'
        }));

        res.json({ success: true, libraries });
      } catch (err) {
        logger.error("[JELLYFIN LIBRARIES API] Error:", err);
        res.json({ success: false, message: err.message });
      }
    });

  // Global error handler middleware - must be last
  app.use((err, req, res, next) => {
    logger.error('Express error handler:', {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method
    });

    // Don't expose internal errors to client in production
    const statusCode = err.status || err.statusCode || 500;
    const message = statusCode === 500 ? 'Internal server error' : err.message;

    res.status(statusCode).json({
      success: false,
      error: message
    });
  });

  app.use("/assets", express.static(path.join(process.cwd(), "assets")));
  app.use(express.static(path.join(process.cwd(), "web")));

  app.get("/", (req, res) => {
    res.sendFile(path.join(process.cwd(), "web", "index.html"));
  });

  app.post("/jellyfin-webhook", (req, res) => {
    if (!isBotRunning || !discordClient)
      return res.status(503).send("Bot is not running.");
    handleJellyfinWebhook(req, res, discordClient, pendingRequests);
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

  app.post("/api/save-config", configLimiter, validateBody(configSchema), async (req, res) => {
    const configData = req.body;
    const oldToken = process.env.DISCORD_TOKEN;
    const oldGuildId = process.env.GUILD_ID;

    // Normalize JELLYSEERR_URL to remove /api/v1 suffix if present
    if (configData.JELLYSEERR_URL && typeof configData.JELLYSEERR_URL === 'string') {
      configData.JELLYSEERR_URL = configData.JELLYSEERR_URL.replace(/\/api\/v1\/?$/, '');
    }

    try {
      // Load existing config to preserve USER_MAPPINGS and other non-form fields
      let existingConfig = {};
      if (fs.existsSync(CONFIG_PATH)) {
        const rawData = fs.readFileSync(CONFIG_PATH, "utf-8");
        existingConfig = JSON.parse(rawData);
      }

      // Merge with existing config, preserving USER_MAPPINGS and other fields not in the form
      const finalConfig = {
        ...existingConfig,
        ...configData,
        // Ensure USER_MAPPINGS is preserved
        USER_MAPPINGS: existingConfig.USER_MAPPINGS || []
      };

      // Ensure /config directory exists with proper permissions
      const configDir = path.dirname(CONFIG_PATH);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true, mode: 0o777 });
      }
      
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(finalConfig, null, 2), { mode: 0o600 });
      logger.info('✅ Configuration saved successfully');
    } catch (writeErr) {
      logger.error('Error saving config.json:', writeErr);
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
      logger.warn("Critical Discord settings changed. Restarting bot logic...");
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
      let baseUrl = url.replace(/\/$/, "");
      if (!baseUrl.endsWith('/api/v1')) {
        baseUrl += '/api/v1';
      }

      const response = await axios.get(
        `${baseUrl}/settings/about`,
        {
          headers: { "X-Api-Key": apiKey },
          timeout: TIMEOUTS.JELLYSEERR_API,
        }
      );
      const version = response.data?.version;
      res.json({
        success: true,
        message: `Connection successful! (v${version})`,
      });
    } catch (error) {
      logger.error("Jellyseerr test failed:", error.message);
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
    const { url } = req.body;
    if (!url) {
      return res
        .status(400)
        .json({ success: false, message: "Jellyfin URL is required." });
    }

    try {
      const testUrl = `${url.replace(/\/$/, "")}/System/Info/Public`;
      const response = await axios.get(testUrl, { timeout: TIMEOUTS.JELLYFIN_API });

      if (response.data?.ServerName && response.data?.Version) {
        return res.json({
          success: true,
          message: `Connected to ${response.data.ServerName} (v${response.data.Version})`,
        });
      }
      throw new Error("Invalid response from Jellyfin server.");
    } catch (error) {
      logger.error("Jellyfin test failed:", error.message);
      res.status(500).json({
        success: false,
        message: "Connection failed. Check URL and network.",
      });
    }
  });

  // Health check endpoint for monitoring
  app.get("/api/health", (req, res) => {
    const uptime = process.uptime();
    const cacheStats = cache.getStats();

    res.json({
      status: "healthy",
      uptime: Math.floor(uptime),
      uptimeFormatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
      bot: {
        running: isBotRunning,
        username: isBotRunning && discordClient?.user ? discordClient.user.tag : null,
        connected: discordClient?.ws?.status === 0, // 0 = READY
      },
      cache: {
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        keys: cacheStats.keys,
        hitRate: cacheStats.hits + cacheStats.misses > 0
          ? ((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100).toFixed(2) + '%'
          : '0%'
      },
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
      },
      timestamp: new Date().toISOString()
    });
  });

  // Parse log file and return formatted entries
  function parseLogFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return [];
      }
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter(line => line.trim());

      return lines.map(line => {
        // Parse Winston JSON logs
        try {
          const logEntry = JSON.parse(line);
          return {
            timestamp: logEntry.timestamp || "N/A",
            level: logEntry.level || "unknown",
            message: logEntry.message || ""
          };
        } catch {
          // Fallback for non-JSON lines
          const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(\w+):\s+(.+)$/);
          if (match) {
            return {
              timestamp: match[1],
              level: match[2],
              message: match[3]
            };
          }
          return {
            timestamp: "N/A",
            level: "unknown",
            message: line
          };
        }
      });
    } catch (error) {
      logger.error("Error parsing log file:", error);
      return [];
    }
  }

  // API endpoint for error logs
  app.get("/api/logs/error", (req, res) => {
    const logsDir = path.join(process.cwd(), "logs");
    const errorLogPath = path.join(logsDir, "error.log");
    const logs = parseLogFile(errorLogPath);
    res.json({
      file: "error.log",
      count: logs.length,
      entries: logs
    });
  });

  // API endpoint for all logs
  app.get("/api/logs/all", (req, res) => {
    const logsDir = path.join(process.cwd(), "logs");
    const combinedLogPath = path.join(logsDir, "combined.log");
    const logs = parseLogFile(combinedLogPath);
    res.json({
      file: "combined.log",
      count: logs.length,
      entries: logs
    });
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
    logger.info("Bot has been stopped.");
    res.status(200).json({ message: "Bot stopped successfully." });
  });
}

// --- INITIALIZE AND START SERVER ---
// First, check for .env migration before anything else
migrateEnvToConfig();

logger.info("Initializing web server...");
configureWebServer();
logger.info("Web server configured successfully");

// --- START THE SERVER ---
// This single `app.listen` call handles both modes.
let server;

function startServer() {
  loadConfig();
  port = process.env.WEBHOOK_PORT || 8282;
  logger.info(`Attempting to start server on port ${port}...`);
  server = app.listen(port, "0.0.0.0");

  server.on("listening", () => {
    const address = server.address();
    if (address) {
      logger.info(`✅ Anchorr web server is running on port ${address.port}.`);
      logger.info(`📝 Access it at:`);
      logger.info(`   - Local: http://127.0.0.1:${address.port}`);
      logger.info(`   - Network: http://<your-server-ip>:${address.port}`);
      logger.info(`   - Docker: http://<host-ip>:${address.port}`);
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
        logger.info("ℹ️ AUTO_START_BOT is disabled. Bot will not auto-start.");
        return;
      }

      const hasConfigFile = fs.existsSync(CONFIG_PATH);
      const required = ["DISCORD_TOKEN", "BOT_ID"];
      const hasDiscordCreds = required.every(
        (k) => process.env[k] && String(process.env[k]).trim() !== ""
      );

      if (!isBotRunning && hasConfigFile && hasDiscordCreds) {
        logger.info("🚀 Detected existing config.json with Discord credentials. Auto-starting bot...");
        (async () => {
          try {
            await startBot();
            logger.info("✅ Bot auto-started successfully.");
          } catch (e) {
            logger.error("❌ Bot auto-start failed:", e?.message || e);
          }
        })();
      } else if (!hasDiscordCreds) {
        logger.info("ℹ️ Config found but Discord credentials are incomplete. Bot not auto-started.");
      }
    } catch (e) {
      logger.error("Error during auto-start check:", e?.message || e);
    }
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      logger.error(
        `❌ Port ${port} is already in use. Please free the port or change WEBHOOK_PORT.`
      );
    } else {
      logger.error("Server error:", err);
    }
    process.exit(1);
  });
}

// Keep the process alive
process.on("SIGTERM", () => {
  logger.info("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  logger.info("SIGINT signal received: closing HTTP server");
  server.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
});

// Catch uncaught exceptions
process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

startServer();
