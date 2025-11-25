import fs from "fs";
import path from "path";
import express from "express";
import cookieParser from "cookie-parser";
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
import { login, register, logout, checkAuth, authenticateToken } from "./utils/auth.js";
import { jellyfinPoller } from "./jellyfinPoller.js";
import JellyfinWebSocketClient from "./jellyfinWebSocket.js";
import { minutesToHhMm } from "./utils/time.js";
import { fetchOMDbData } from "./api/omdb.js";
import {
  CONFIG_PATH,
  readConfig,
  writeConfig,
  loadConfigToEnv,
  getUserMappings,
  saveUserMapping,
  deleteUserMapping
} from "./utils/configFile.js";

// --- CONFIGURATION ---
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

    // Save migrated config using centralized writeConfig
    if (writeConfig(migratedConfig)) {
      logger.info("✅ Migration successful! config.json created from .env");
      logger.info("📝 You can now delete the .env file as it's no longer needed.");
    } else {
      logger.error("❌ Error saving migrated config - check permissions");
    }
  }
}

function loadConfig() {
  logger.debug("[LOADCONFIG] Checking CONFIG_PATH:", CONFIG_PATH);
  logger.debug("[LOADCONFIG] File exists:", fs.existsSync(CONFIG_PATH));

  // Use centralized loadConfigToEnv (includes all migrations)
  const success = loadConfigToEnv();

  if (success) {
    logger.debug("[LOADCONFIG] Config keys loaded:", Object.keys(process.env).filter(k => k.startsWith('DISCORD') || k.startsWith('JELLYFIN') || k.startsWith('JELLYSEERR')).length);
    logger.debug("[LOADCONFIG] DISCORD_TOKEN in process.env:", process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.slice(0, 6) + '...' : 'UNDEFINED');
  } else {
    logger.debug("[LOADCONFIG] Config file does not exist or failed to load");
  }

  return success;
}

/**
 * Verify volume persistence configuration for Docker deployments
 * Detects if /config is mounted as a proper volume and warns if misconfigured
 */
function verifyVolumeConfiguration() {
  // Check if running in Docker (Docker always has /config directory created)
  const isDocker = fs.existsSync("/config");

  if (!isDocker) {
    logger.debug("Running in local mode (not Docker) - config will be stored in ./config/");
    return;
  }

  // In Docker - verify /config is writable
  try {
    const testFile = path.join("/config", ".volume-test");
    fs.writeFileSync(testFile, "test", { mode: 0o666 });
    fs.unlinkSync(testFile);
    logger.info("✅ Volume /config is properly configured and writable");
  } catch (error) {
    if (error.code === 'EACCES') {
      logger.error("❌ CRITICAL: /config directory exists but is NOT writable!");
      logger.error("   For UNRAID users: Ensure container volume mapping is correctly configured:");
      logger.error("   1. Go to Docker tab → Edit container");
      logger.error("   2. Add volume mapping: Container Path=/config → Host Path=/mnt/user/appdata/anchorr");
      logger.error("   3. Set Access Mode to RW (Read-Write)");
      logger.error("   4. Save and restart container");
    } else if (error.code === 'EROFS') {
      logger.error("❌ CRITICAL: /config is on a read-only file system!");
      logger.error("   Check your Docker volume configuration - /config should be writable");
    } else {
      logger.warn("⚠️  Could not verify /config writability:", error.message);
    }
  }
}

const app = express();
let port = process.env.WEBHOOK_PORT || 8282;

// --- BOT STATE MANAGEMENT ---
let discordClient = null;
let isBotRunning = false;
let jellyfinWebSocketClient = null;

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


  // ----------------- HELPERS -----------------
  function pad2(n) {
    return String(n).padStart(2, "0");
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
    omdb = null,
    tmdbId = null
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

    // Generate Jellyseerr URL for the author link
    // Remove /api/v1 from JELLYSEERR_URL to get the base domain
    // Add ?manage=1 only for success status
    let jellyseerrMediaUrl;
    if (tmdbId && JELLYSEERR_URL) {
      const jellyseerrDomain = JELLYSEERR_URL.replace(/\/api\/v1\/?$/, '');
      const baseUrl = `${jellyseerrDomain}/${mediaType}/${tmdbId}`;
      jellyseerrMediaUrl = status === "success" ? `${baseUrl}?manage=1` : baseUrl;
    }

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
      .setAuthor({
        name: authorName,
        url: jellyseerrMediaUrl
      })
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
    requestedSeasons = [],
    requestedTags = [],
    selectedSeasons = [],
    selectedTags = []
  ) {
    const rows = [];
    const buttons = [];

    // Always add IMDB and Letterboxd buttons if available
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

    // Add Request button (dynamic label based on selections)
    if (requested) {
      // Show success state with full info
      let successLabel = "Requested";
      if (requestedSeasons.length > 0) {
        if (requestedSeasons.includes("all")) {
          successLabel = "Requested all seasons";
        } else if (requestedSeasons.length === 1) {
          successLabel = `Requested season ${requestedSeasons[0]}`;
        } else {
          const seasons = [...requestedSeasons];
          const lastSeason = seasons.pop();
          successLabel = `Requested seasons ${seasons.join(", ")} and ${lastSeason}`;
        }
      }
      if (requestedTags.length > 0) {
        // requestedTags contains tag names when coming from request_btn handler
        const tagLabel = requestedTags.length === 1 ? requestedTags[0] : requestedTags.join(", ");
        successLabel += ` with ${tagLabel} tag${requestedTags.length > 1 ? 's' : ''}`;
      }
      successLabel += ", stay tuned!";

      buttons.push(
        new ButtonBuilder()
          .setCustomId(`requested|${tmdbId}|${mediaType}`)
          .setLabel(successLabel)
          .setStyle(ButtonStyle.Success)
          .setDisabled(true)
      );
    } else {
      // Show Request button with dynamic label
      let requestLabel = "Request";

      if (mediaType === "tv" && selectedSeasons.length > 0) {
        if (selectedSeasons.includes("all")) {
          requestLabel = "Request all seasons";
        } else if (selectedSeasons.length === 1) {
          requestLabel = `Request season ${selectedSeasons[0]}`;
        } else {
          const seasons = [...selectedSeasons];
          const lastSeason = seasons.pop();
          requestLabel = `Request seasons ${seasons.join(", ")} and ${lastSeason}`;
        }
      }

      if (selectedTags.length > 0) {
        // selectedTags contains tag names (not IDs) when coming from select_tags handler
        const tagLabel = selectedTags.length === 1 ? selectedTags[0] : selectedTags.join(", ");
        requestLabel += ` with ${tagLabel} tag${selectedTags.length > 1 ? 's' : ''}`;
      }

      const seasonsParam = selectedSeasons.length > 0 ? selectedSeasons.join(',') : '';
      const tagsParam = selectedTags.length > 0 ? selectedTags.join(',') : '';

      buttons.push(
        new ButtonBuilder()
          .setCustomId(`request_btn|${tmdbId}|${mediaType}|${seasonsParam}|${tagsParam}`)
          .setLabel(requestLabel)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(mediaType === "tv" && selectedSeasons.length === 0)
      );
    }

    // Add first row with all buttons (IMDB + Letterboxd + Request)
    if (buttons.length > 0) {
      rows.push(new ActionRowBuilder().addComponents(...buttons.slice(0, 5)));
    }

    // Add season selector for TV shows (if not requested, has seasons, and seasons not yet selected)
    if (mediaType === "tv" && details?.seasons?.length > 0 && !requested && selectedSeasons.length === 0) {
      const seenSeasons = new Set();
      const uniqueSeasons = details.seasons.filter((s) => {
        if (s.season_number <= 0) return false;
        if (seenSeasons.has(s.season_number)) return false;
        seenSeasons.add(s.season_number);
        return true;
      });

      const seasonOptions = [
        { label: "All Seasons", value: "all" },
        ...uniqueSeasons.map((s) => ({
          label: `Season ${s.season_number} (${s.episode_count} episodes)`,
          value: String(s.season_number),
        })),
      ];

      const tagsParam = selectedTags.length > 0 ? selectedTags.join(',') : '';
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_seasons|${tmdbId}|${tagsParam}`)
        .setPlaceholder("Select seasons to request...")
        .setMinValues(1)
        .setMaxValues(seasonOptions.length)
        .addOptions(seasonOptions.slice(0, 25));

      rows.push(new ActionRowBuilder().addComponents(selectMenu));
    }

    // Add tag selector for movies (if not requested and has available tags)
    // For movies, show tags row directly (no season selection needed)
    if (mediaType === "movie" && !requested && selectedTags.length === 0) {
      // Note: Tags are fetched and added dynamically when building components
      // This is a placeholder row that will be populated by the calling code
      // The actual tag options need to be fetched from Jellyseerr
      // This is handled in the search/request handlers
    }

    return rows;
  }

  // ----------------- COMMON SEARCH LOGIC -----------------
  async function handleSearchOrRequest(interaction, rawInput, mode, tags = []) {
    let tmdbId, mediaType;
    
    // Check if input is direct ID (format: "12345|movie")
    if (rawInput.includes("|")) {
      [tmdbId, mediaType] = rawInput.split("|");
    } else {
      // Fallback search if raw text was passed
      const results = await tmdbApi.tmdbSearch(rawInput, TMDB_API_KEY);
      const found = results.filter(
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

    const isEphemeral = process.env.PRIVATE_MESSAGE_MODE === 'true';
    await interaction.deferReply({ ephemeral: isEphemeral });

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
            flags: 64,
          });
          return;
        }

        // Convert tag labels to IDs if tags were provided
        let tagIds = [];
        if (tags && tags.length > 0) {
          try {
            const allTags = await jellyseerrApi.fetchTags(JELLYSEERR_URL, JELLYSEERR_API_KEY);
            // Filter to appropriate type (Sonarr for TV, Radarr for movies)
            const relevantTags = allTags.filter(tag => 
              mediaType === 'tv' ? tag.type === 'sonarr' : tag.type === 'radarr'
            );
            
            // Map tag labels to IDs
            tagIds = tags
              .map(tagLabel => {
                const tag = relevantTags.find(t => (t.label || t.name) === tagLabel);
                return tag ? tag.id : null;
              })
              .filter(id => id !== null);
            
            logger.debug(`Converted tag labels ${tags.join(', ')} to IDs: ${tagIds.join(', ')}`);
          } catch (err) {
            logger.warn('Failed to convert tag labels to IDs:', err?.message);
          }
        }

        await jellyseerrApi.sendRequest({
          tmdbId,
          mediaType,
          seasons: ["all"],
          tags: tagIds,
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
        omdb,
        tmdbId
      );

      const components = buildButtons(
        tmdbId,
        imdbId,
        mode === "request",
        mediaType,
        details
      );

      // Add tag selector for movies (if in search mode and not already requested)
      if (mediaType === "movie" && mode === "search") {
        try {
          const allTags = await jellyseerrApi.fetchTags(JELLYSEERR_URL, JELLYSEERR_API_KEY);

          // Filter to only Radarr tags for movies
          const radarrTags = allTags.filter(tag => tag.type === "radarr");

          if (radarrTags && radarrTags.length > 0) {
            // Deduplicate tags by ID
            const uniqueTags = [];
            const seenIds = new Set();

            for (const tag of radarrTags) {
              if (!seenIds.has(tag.id)) {
                seenIds.add(tag.id);
                uniqueTags.push(tag);
              }
            }

            const tagOptions = uniqueTags.slice(0, 25).map(tag => ({
              label: tag.label || tag.name || `Tag ${tag.id}`,
              value: tag.id.toString(),
            }));

            const tagMenu = new StringSelectMenuBuilder()
              .setCustomId(`select_tags|${tmdbId}|`)
              .setPlaceholder("Select tags (optional)")
              .addOptions(tagOptions)
              .setMinValues(0)
              .setMaxValues(Math.min(5, tagOptions.length));

            const tagRow = new ActionRowBuilder().addComponents(tagMenu);
            components.push(tagRow);
          }
        } catch (err) {
          logger.debug("Failed to fetch tags for movie tag selector:", err?.message);
          // Continue without tag selector if fetch fails
        }
      }

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
    await registerCommands(rest, BOT_ID, GUILD_ID || null, logger);
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
        const focusedOption = interaction.options.getFocused(true);
        const focusedValue = focusedOption.value;

        // Handle Tag Autocomplete
        if (focusedOption.name === 'tag') {
          try {
            const allTags = await jellyseerrApi.fetchTags(JELLYSEERR_URL, JELLYSEERR_API_KEY);
            
            // Filter tags based on user input
            const filteredTags = allTags.filter(tag => {
              const label = tag.label || tag.name || '';
              return label.toLowerCase().includes(focusedValue.toLowerCase());
            });

            // Deduplicate by label/name
            const uniqueTags = [];
            const seenLabels = new Set();
            
            for (const tag of filteredTags) {
              const label = tag.label || tag.name;
              if (label && !seenLabels.has(label)) {
                seenLabels.add(label);
                uniqueTags.push({
                  name: label,
                  value: label // Pass the label as value, we'll map it to ID later
                });
              }
            }

            // Limit to 25 choices (Discord limit)
            return await interaction.respond(uniqueTags.slice(0, 25));
          } catch (e) {
            logger.error('Tag autocomplete error:', e);
            return await interaction.respond([]);
          }
        }

        // Handle Title Autocomplete (existing logic)
        if (!focusedValue) return interaction.respond([]);
        
        try {
          const results = await tmdbApi.tmdbSearch(focusedValue, TMDB_API_KEY);
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
        if (interaction.commandName === "request") {
          const tag = interaction.options.getString('tag');
          // Pass tag as an array if present
          return handleSearchOrRequest(interaction, raw, "request", tag ? [tag] : []);
        }
      }

      // ===== REQUEST BUTTON HANDLER (NEW FLOW) =====
      // customId format: request_btn|tmdbId|mediaType|seasonsParam|tagsParam
      if (
        interaction.isButton() &&
        interaction.customId.startsWith("request_btn|")
      ) {
        const parts = interaction.customId.split("|");
        const tmdbId = parseInt(parts[1], 10);
        const mediaType = parts[2] || "movie";
        const seasonsParam = parts[3] || "";
        const tagsParam = parts[4] || "";

        if (!tmdbId) {
          return interaction.reply({ content: "⚠️ ID invalid.", flags: 64 });
        }

        await interaction.deferUpdate();

        try {
          const details = await tmdbApi.tmdbGetDetails(tmdbId, mediaType, TMDB_API_KEY);

          // Parse seasons and tags from customId
          const selectedSeasons = seasonsParam ? seasonsParam.split(",") : (mediaType === "tv" ? [] : ["all"]);
          const selectedTagNames = tagsParam ? tagsParam.split(",") : [];

          // Convert tag names to IDs for API call
          let selectedTagIds = [];
          if (selectedTagNames.length > 0) {
            try {
              const allTags = await jellyseerrApi.fetchTags(JELLYSEERR_URL, JELLYSEERR_API_KEY);

              // Filter by type: Radarr for movies, Sonarr for TV
              const filteredTags = mediaType === "movie"
                ? allTags.filter(tag => tag.type === "radarr")
                : allTags.filter(tag => tag.type === "sonarr");

              selectedTagIds = selectedTagNames
                .map(tagName => {
                  const tag = filteredTags.find(t => (t.label || t.name) === tagName);
                  return tag ? tag.id : null;
                })
                .filter(id => id !== null);
            } catch (err) {
              logger.debug("Failed to fetch tags for API call:", err?.message);
              // Continue without tags if fetch fails
            }
          }

          // Check if media already exists in Jellyseerr
          const checkSeasons = selectedSeasons.length > 0 ? selectedSeasons : ["all"];
          const status = await jellyseerrApi.checkMediaStatus(
            tmdbId,
            mediaType,
            checkSeasons,
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

          // Send the request with selected seasons and tags
          await jellyseerrApi.sendRequest({
            tmdbId,
            mediaType,
            seasons: selectedSeasons.length > 0 ? selectedSeasons : ["all"],
            tags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
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
            omdb,
            tmdbId
          );

          // Build final buttons with requested seasons and tag names (for display)
          const components = buildButtons(
            tmdbId,
            imdbId,
            true,
            mediaType,
            details,
            selectedSeasons.length > 0 ? selectedSeasons : ["all"],
            selectedTagNames
          );

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

      // ===== SELECT SEASONS HANDLER (NEW FLOW) =====
      // customId format: select_seasons|tmdbId|selectedTagsParam
      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith("select_seasons|")
      ) {
        const parts = interaction.customId.split("|");
        const tmdbId = parseInt(parts[1], 10);
        const selectedTagsParam = parts[2] || "";
        const selectedSeasons = interaction.values;

        if (!tmdbId || !selectedSeasons.length) {
          return interaction.reply({
            content: "⚠️ Invalid selection.",
            ephemeral: true,
          });
        }

        await interaction.deferUpdate();

        try {
          // Parse existing tags from customId if any
          const selectedTags = selectedTagsParam ? selectedTagsParam.split(",") : [];

          // Fetch available tags for tag selector (only if not already selected)
          let tags = [];
          if (selectedTags.length === 0) {
            tags = await jellyseerrApi.fetchTags(JELLYSEERR_URL, JELLYSEERR_API_KEY);
          }

          // Get TMDB details and IMDb ID for building updated components
          const details = await tmdbApi.tmdbGetDetails(tmdbId, "tv", TMDB_API_KEY);
          const imdbId = await tmdbApi.tmdbGetExternalImdb(tmdbId, "tv", TMDB_API_KEY);

          // Build updated components with selected seasons
          const components = buildButtons(
            tmdbId,
            imdbId,
            false,
            "tv",
            details,
            [],
            [],
            selectedSeasons,
            selectedTags
          );

          // If tags are available and not yet selected, add tag selector
          if (tags && tags.length > 0 && selectedTags.length === 0) {
            // Deduplicate tags by ID
            const uniqueTags = [];
            const seenIds = new Set();

            for (const tag of tags) {
              if (!seenIds.has(tag.id)) {
                seenIds.add(tag.id);
                uniqueTags.push(tag);
              }
            }

            const tagOptions = uniqueTags.slice(0, 25).map(tag => ({
              label: tag.label || tag.name || `Tag ${tag.id}`,
              value: tag.id.toString(),
            }));

            const tagMenu = new StringSelectMenuBuilder()
              .setCustomId(`select_tags|${tmdbId}|${selectedSeasons.join(',')}`)
              .setPlaceholder("Select tags (optional)")
              .addOptions(tagOptions)
              .setMinValues(0)
              .setMaxValues(Math.min(5, tagOptions.length));

            const tagRow = new ActionRowBuilder().addComponents(tagMenu);
            components.push(tagRow);
          }

          await interaction.editReply({
            components,
          });
        } catch (err) {
          logger.error("Season selection error:", err);
          try {
            await interaction.followUp({
              content: "⚠️ Error processing season selection.",
              flags: 64,
            });
          } catch (followUpErr) {
            logger.error("Failed to send follow-up message:", followUpErr);
          }
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

      // ===== SELECT TAGS HANDLER (NEW FLOW) =====
      // customId format: select_tags|tmdbId|selectedSeasonsParam (for TV) or select_tags|tmdbId| (for movies)
      // This handler only updates the buttons with tag selection - does NOT send the request
      if (
        interaction.isStringSelectMenu() &&
        interaction.customId.startsWith("select_tags|")
      ) {
        const parts = interaction.customId.split("|");
        const tmdbId = parseInt(parts[1], 10);
        const selectedSeasonsParam = parts[2] || "";
        const selectedSeasons = selectedSeasonsParam ? selectedSeasonsParam.split(",") : [];
        const selectedTagIds = interaction.values.map(v => v.toString());

        if (!tmdbId) {
          return interaction.reply({
            content: "⚠️ Invalid request data.",
            flags: 64,
          });
        }

        await interaction.deferUpdate();

        try {
          // Determine if this is for TV or movie based on presence of seasons
          const mediaType = selectedSeasons.length > 0 ? "tv" : "movie";

          // Get TMDB details for building updated buttons
          const details = await tmdbApi.tmdbGetDetails(tmdbId, mediaType, TMDB_API_KEY);
          const imdbId = await tmdbApi.tmdbGetExternalImdb(tmdbId, mediaType, TMDB_API_KEY);

          // Fetch all tags to map IDs to names
          let selectedTagNames = [];
          if (selectedTagIds.length > 0) {
            try {
              const allTags = await jellyseerrApi.fetchTags(JELLYSEERR_URL, JELLYSEERR_API_KEY);

              // Filter by type: Radarr for movies, Sonarr for TV
              const filteredTags = mediaType === "movie"
                ? allTags.filter(tag => tag.type === "radarr")
                : allTags.filter(tag => tag.type === "sonarr");

              selectedTagNames = selectedTagIds
                .map(tagId => {
                  const tag = filteredTags.find(t => t.id.toString() === tagId);
                  return tag ? (tag.label || tag.name) : null;
                })
                .filter(name => name !== null);
            } catch (err) {
              logger.debug("Failed to fetch tag names:", err?.message);
              // Continue with tag IDs if names can't be fetched
              selectedTagNames = selectedTagIds;
            }
          }

          // Build updated buttons with selected seasons and tags
          // Pass selectedSeasons and selectedTagNames to show them in the Request button label
          const components = buildButtons(
            tmdbId,
            imdbId,
            false,
            mediaType,
            details,
            [],
            [],
            selectedSeasons,
            selectedTagNames
          );

          // Remove tag selector after selection - user now sees updated Request button
          // and can click it to send the request

          await interaction.editReply({
            components,
          });
        } catch (err) {
          logger.error("Tag selection error:", err);
          try {
            await interaction.followUp({
              content: "⚠️ Error updating selection.",
              flags: 64,
            });
          } catch (followUpErr) {
            logger.error("Failed to send follow-up message:", followUpErr);
          }
        }
      }
    } catch (outerErr) {
      logger.error("Interaction handler error:", outerErr);
    }
  });

  return new Promise((resolve, reject) => {
    client.once("clientReady", async () => {
      logger.info(`✅ Bot logged in as ${client.user.tag}`);
      isBotRunning = true;

      logger.info("ℹ️ Jellyfin notifications will be received via webhooks.");

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
    app.use(cookieParser());

    // Rate limiting middleware - DoS protection
    const apiLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // Limit each IP to 100 requests per windowMs
      message: { success: false, error: 'Too many requests, please try again later.' },
      standardHeaders: true,
      legacyHeaders: false,
    });

    const configLimiter = rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 50, // Limit config changes to 50 per minute
      message: { success: false, error: 'Too many configuration changes, please slow down.' },
      standardHeaders: true,
      legacyHeaders: false,
    });

    // --- AUTH ENDPOINTS (no rate limiting for auth) ---
    app.post("/api/auth/login", login);
    app.post("/api/auth/register", register);
    app.post("/api/auth/logout", logout);
    app.get("/api/auth/check", checkAuth);

    // --- JELLYFIN WEBHOOK ENDPOINT (no rate limiting for webhooks) ---
    app.post("/jellyfin/webhook", express.json(), async (req, res) => {
      try {
        logger.info("📥 Received Jellyfin webhook");
        logger.debug("Webhook payload:", JSON.stringify(req.body, null, 2));

        // Acknowledge receipt immediately
        res.status(200).json({ success: true, message: "Webhook received" });

        // Process webhook asynchronously
        if (discordClient && isBotRunning) {
          await handleJellyfinWebhook(req, res, discordClient, pendingRequests);
        } else {
          logger.warn("⚠️ Jellyfin webhook received but Discord bot is not running");
        }
      } catch (error) {
        logger.error("❌ Error processing Jellyfin webhook:", error);
        // Don't send error response since we already sent 200
      }
    });

    // Apply rate limiting to all API endpoints (except auth and webhooks)
    app.use('/api/', apiLimiter);

    // Endpoint for Discord servers list (guilds)
    app.get("/api/discord/guilds", authenticateToken, async (req, res) => {
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

    // Endpoint for Discord channels list from a server
    app.get("/api/discord/channels/:guildId", authenticateToken, async (req, res) => {
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

    // Endpoint for Discord members from a server
    app.get("/api/discord-members", authenticateToken, async (req, res) => {
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

    // Endpoint for Discord roles from a server
    app.get("/api/discord-roles", authenticateToken, async (req, res) => {
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

    // Endpoint for Jellyseerr users
    app.get("/api/jellyseerr-users", authenticateToken, async (req, res) => {
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

    // Endpoint for user mappings
    app.get("/api/user-mappings", authenticateToken, (req, res) => {
      // Load from config.json using centralized helper
      const mappings = getUserMappings();
      res.json(mappings);
    });

    app.post("/api/user-mappings", authenticateToken, validateBody(userMappingSchema), (req, res) => {
      const { discordUserId, jellyseerrUserId, discordUsername, discordDisplayName, jellyseerrDisplayName } = req.body;

      if (!discordUserId || !jellyseerrUserId) {
        return res.status(400).json({ success: false, message: "Discord user ID and Jellyseerr user ID are required." });
      }

      try {
        const mapping = {
          discordUserId,
          jellyseerrUserId,
          discordUsername: discordUsername || null,
          discordDisplayName: discordDisplayName || null,
          jellyseerrDisplayName: jellyseerrDisplayName || null
        };

        // Use centralized saveUserMapping helper
        saveUserMapping(mapping);

        res.json({ success: true, message: "Mapping saved successfully." });
      } catch (error) {
        logger.error("Error saving user mapping:", error);
        res.status(500).json({ success: false, message: "Failed to save mapping - check server logs." });
      }
    });

    app.delete("/api/user-mappings/:discordUserId", authenticateToken, (req, res) => {
      const { discordUserId } = req.params;

      try {
        // Use centralized deleteUserMapping helper
        const deleted = deleteUserMapping(discordUserId);

        if (!deleted) {
          return res.status(404).json({ success: false, message: "Mapping not found." });
        }

        res.json({ success: true, message: "Mapping deleted successfully." });
      } catch (error) {
        logger.error("Error deleting user mapping:", error);
        res.status(500).json({ success: false, message: "Failed to delete mapping - check server logs." });
      }
    });

    // Endpoint for Jellyfin libraries
    app.post("/api/jellyfin-libraries", async (req, res) => {
      try {
        const { url, apiKey } = req.body;

        if (!url || !apiKey) {
          return res.status(400).json({ success: false, message: "URL and API Key are required." });
        }

        const response = await axios.get(
          `${url.replace(/\/$/, "")}/Library/MediaFolders`,
          {
            headers: { "X-MediaBrowser-Token": apiKey },
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

  app.get("/api/config", authenticateToken, (req, res) => {
    const config = readConfig();
    if (config) {
      res.json(config);
    } else {
      // If no config file, return the template from config/config.js
      res.json(configTemplate);
    }
  });

  app.post("/api/save-config", authenticateToken, configLimiter, validateBody(configSchema), async (req, res) => {
    const configData = req.body;
    const oldToken = process.env.DISCORD_TOKEN;
    const oldGuildId = process.env.GUILD_ID;
    const oldJellyfinApiKey = process.env.JELLYFIN_API_KEY;

    // Normalize JELLYSEERR_URL to remove /api/v1 suffix if present
    if (configData.JELLYSEERR_URL && typeof configData.JELLYSEERR_URL === 'string') {
      configData.JELLYSEERR_URL = configData.JELLYSEERR_URL.replace(/\/api\/v1\/?$/, '');
    }

    try {
      // Load existing config to preserve USER_MAPPINGS and other non-form fields
      const existingConfig = readConfig() || {};

      // Merge with existing config, preserving USER_MAPPINGS and other fields not in the form
      const finalConfig = {
        ...existingConfig,
        ...configData,
        // Ensure USER_MAPPINGS, USERS, and JWT_SECRET are preserved
        USER_MAPPINGS: existingConfig.USER_MAPPINGS || [],
        USERS: existingConfig.USERS || [],
        JWT_SECRET: existingConfig.JWT_SECRET || process.env.JWT_SECRET,
        // Safety check for library mappings - prefer new config, fallback to existing if missing in request
        JELLYFIN_NOTIFICATION_LIBRARIES: configData.JELLYFIN_NOTIFICATION_LIBRARIES || existingConfig.JELLYFIN_NOTIFICATION_LIBRARIES || {},
      };

      // Use centralized writeConfig with robust error handling
      if (!writeConfig(finalConfig)) {
        return res.status(500).json({
          success: false,
          error: 'Failed to save configuration file. Check Docker volume permissions and server logs.'
        });
      }

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
    const jellyfinApiKeyChanged = oldJellyfinApiKey !== process.env.JELLYFIN_API_KEY;
    const needsRestart =
      oldToken !== process.env.DISCORD_TOKEN ||
      oldGuildId !== process.env.GUILD_ID ||
      jellyfinApiKeyChanged;

    if (isBotRunning && needsRestart) {
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

  app.post("/api/test-jellyseerr", authenticateToken, async (req, res) => {
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

  app.post("/api/test-jellyfin", authenticateToken, async (req, res) => {
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
          serverId: response.data.Id
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

  app.get("/api/jellyfin/libraries", authenticateToken, async (req, res) => {
    try {
      const apiKey = process.env.JELLYFIN_API_KEY;
      const baseUrl = process.env.JELLYFIN_URL;

      if (!apiKey || !baseUrl) {
        return res.status(400).json({
          success: false,
          message: "Jellyfin API key and URL are required in configuration.",
        });
      }

      // Import fetchLibraries dynamically
      const { fetchLibraries } = await import("./api/jellyfin.js");
      const libraries = await fetchLibraries(apiKey, baseUrl);

      res.json({
        success: true,
        libraries: libraries.map(lib => ({
          id: lib.ItemId,
          collectionId: lib.CollectionId,
          name: lib.Name,
          type: lib.CollectionType
        }))
      });
    } catch (error) {
      logger.error("Failed to fetch Jellyfin libraries:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch libraries. Check Jellyfin configuration.",
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
  function parseLogFile(filePath, limit = 1000) {
    try {
      if (!fs.existsSync(filePath)) {
        return { entries: [], truncated: false };
      }
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter(line => line.trim());

      // Keep only the last 'limit' entries
      const truncated = lines.length > limit;
      const relevantLines = lines.slice(-limit);

      const entries = relevantLines.map(line => {
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

      return { entries, truncated };
    } catch (error) {
      logger.error("Error parsing log file:", error);
      return { entries: [], truncated: false };
    }
  }

  // API endpoint for error logs
  app.get("/api/logs/error", authenticateToken, (req, res) => {
    const logsDir = path.join(process.cwd(), "logs");
    // Find the current error log file (error-YYYY-MM-DD.log)
    let errorLogPath = path.join(logsDir, "error.log");

    // Try to find the latest rotated error log file
    try {
      const files = fs.readdirSync(logsDir);
      const errorFiles = files.filter(f => f.startsWith('error-') && f.endsWith('.log'));
      if (errorFiles.length > 0) {
        errorFiles.sort().reverse();
        errorLogPath = path.join(logsDir, errorFiles[0]);
      }
    } catch (e) {
      // Fallback to default path
    }

    const { entries, truncated } = parseLogFile(errorLogPath);
    res.json({
      file: path.basename(errorLogPath),
      count: entries.length,
      total: truncated ? "1000+" : entries.length,
      truncated,
      entries
    });
  });

  // API endpoint for all logs
  app.get("/api/logs/all", authenticateToken, (req, res) => {
    const logsDir = path.join(process.cwd(), "logs");
    // Find the current combined log file (combined-YYYY-MM-DD.log)
    let combinedLogPath = path.join(logsDir, "combined.log");

    // Try to find the latest rotated combined log file
    try {
      const files = fs.readdirSync(logsDir);
      const combinedFiles = files.filter(f => f.startsWith('combined-') && f.endsWith('.log'));
      if (combinedFiles.length > 0) {
        combinedFiles.sort().reverse();
        combinedLogPath = path.join(logsDir, combinedFiles[0]);
      }
    } catch (e) {
      // Fallback to default path
    }

    const { entries, truncated } = parseLogFile(combinedLogPath);
    res.json({
      file: path.basename(combinedLogPath),
      count: entries.length,
      total: truncated ? "1000+" : entries.length,
      truncated,
      entries
    });
  });

  app.get("/api/status", authenticateToken, (req, res) => {
    res.json({
      isBotRunning,
      botUsername:
        isBotRunning && discordClient?.user ? discordClient.user.tag : null,
    });
  });

  app.post("/api/start-bot", authenticateToken, async (req, res) => {
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

  app.post("/api/stop-bot", authenticateToken, async (req, res) => {
    if (!isBotRunning || !discordClient) {
      return res.status(400).json({ message: "Bot is not running." });
    }

    // Stop Jellyfin notification services
    try {
      if (jellyfinWebSocketClient) {
        jellyfinWebSocketClient.stop();
        jellyfinWebSocketClient = null;
        logger.info("Jellyfin WebSocket client stopped");
      }
    } catch (error) {
      logger.error("Error stopping Jellyfin WebSocket client:", error);
    }

    try {
      jellyfinPoller.stop();
      logger.info("Jellyfin poller stopped");
    } catch (error) {
      logger.error("Error stopping Jellyfin poller:", error);
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
  // Check volume configuration early
  verifyVolumeConfiguration();

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
