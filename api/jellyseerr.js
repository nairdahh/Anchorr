/**
 * Jellyseerr API Client
 * Handles all Jellyseerr API interactions
 */

import axios from "axios";
import logger from "../utils/logger.js";
import { TIMEOUTS, CACHE_TTL } from "../lib/constants.js";

// Cache for root folders, tags, quality profiles, and servers
let rootFoldersCache = null;
let rootFoldersCacheTime = 0;
let tagsCache = null;
let tagsCacheTime = 0;
let qualityProfilesCache = null;
let qualityProfilesCacheTime = 0;
let serversCache = null;
let serversCacheTime = 0;

/**
 * Fetch data from Radarr/Sonarr servers
 * @param {string} jellyseerrUrl - Jellyseerr API URL
 * @param {string} apiKey - Jellyseerr API key
 * @param {boolean} fetchDetails - Whether to fetch detailed info for each server
 * @param {Function} extractData - Function to extract data from server/details response
 * @returns {Promise<Array>} Extracted data
 */
async function fetchFromServers(jellyseerrUrl, apiKey, fetchDetails, extractData) {
  const results = [];

  // Fetch from Radarr servers
  try {
    const radarrListResponse = await axios.get(
      `${jellyseerrUrl}/service/radarr`,
      {
        headers: { "X-Api-Key": apiKey },
        timeout: TIMEOUTS.JELLYSEERR_API,
      }
    );

    for (const server of radarrListResponse.data) {
      try {
        if (fetchDetails) {
          const detailsResponse = await axios.get(
            `${jellyseerrUrl}/service/radarr/${server.id}`,
            {
              headers: { "X-Api-Key": apiKey },
              timeout: TIMEOUTS.JELLYSEERR_API,
            }
          );
          const data = extractData(server, detailsResponse.data, "radarr");
          if (data) results.push(...(Array.isArray(data) ? data : [data]));
        } else {
          const data = extractData(server, null, "radarr");
          if (data) results.push(...(Array.isArray(data) ? data : [data]));
        }
      } catch (err) {
        logger.warn(
          `Failed to fetch Radarr ${server.id} details:`,
          err?.message
        );
      }
    }
  } catch (err) {
    logger.warn("Failed to fetch Radarr servers:", err?.message);
  }

  // Fetch from Sonarr servers
  try {
    const sonarrListResponse = await axios.get(
      `${jellyseerrUrl}/service/sonarr`,
      {
        headers: { "X-Api-Key": apiKey },
        timeout: TIMEOUTS.JELLYSEERR_API,
      }
    );

    for (const server of sonarrListResponse.data) {
      try {
        if (fetchDetails) {
          const detailsResponse = await axios.get(
            `${jellyseerrUrl}/service/sonarr/${server.id}`,
            {
              headers: { "X-Api-Key": apiKey },
              timeout: TIMEOUTS.JELLYSEERR_API,
            }
          );
          const data = extractData(server, detailsResponse.data, "sonarr");
          if (data) results.push(...(Array.isArray(data) ? data : [data]));
        } else {
          const data = extractData(server, null, "sonarr");
          if (data) results.push(...(Array.isArray(data) ? data : [data]));
        }
      } catch (err) {
        logger.warn(
          `Failed to fetch Sonarr ${server.id} details:`,
          err?.message
        );
      }
    }
  } catch (err) {
    logger.warn("Failed to fetch Sonarr servers:", err?.message);
  }

  return results;
}

/**
 * Check if media exists and is available in Jellyseerr
 * @param {number} tmdbId - TMDB ID
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {Array} requestedSeasons - Season numbers or ['all']
 * @param {string} jellyseerrUrl - Jellyseerr API URL
 * @param {string} apiKey - Jellyseerr API key
 * @returns {Promise<Object>} Status object
 */
export async function checkMediaStatus(
  tmdbId,
  mediaType,
  requestedSeasons = [],
  jellyseerrUrl,
  apiKey
) {
  try {
    const url =
      mediaType === "movie"
        ? `${jellyseerrUrl}/movie/${tmdbId}`
        : `${jellyseerrUrl}/tv/${tmdbId}`;

    const response = await axios.get(url, {
      headers: { "X-Api-Key": apiKey },
      timeout: TIMEOUTS.TMDB_API,
    });

    // For movies, simple check
    if (mediaType === "movie") {
      return {
        exists: true,
        available:
          response.data.mediaInfo?.status === 5 ||
          response.data.mediaInfo?.status === 4,
        status: response.data.mediaInfo?.status,
        data: response.data,
      };
    }

    // For TV shows, check specific seasons
    if (mediaType === "tv" && requestedSeasons.length > 0) {
      const seasonStatuses = response.data.mediaInfo?.seasons || [];

      // If requesting all seasons
      if (requestedSeasons.includes("all")) {
        if (seasonStatuses.length === 0) {
          return {
            exists: true,
            available: false,
            status: response.data.mediaInfo?.status,
            data: response.data,
          };
        }

        const allAvailable = seasonStatuses.every(
          (s) => s.status === 5 || s.status === 4
        );
        return {
          exists: true,
          available: allAvailable,
          status: response.data.mediaInfo?.status,
          data: response.data,
        };
      }

      // If requesting specific seasons
      const requestedSeasonNums = requestedSeasons.map((s) => parseInt(s, 10));
      const requestedSeasonAvailable = seasonStatuses.some(
        (s) =>
          requestedSeasonNums.includes(s.seasonNumber) &&
          (s.status === 5 || s.status === 4)
      );

      return {
        exists: true,
        available: requestedSeasonAvailable,
        status: response.data.mediaInfo?.status,
        data: response.data,
      };
    }

    // If no specific seasons requested, check overall status
    return {
      exists: true,
      available:
        response.data.mediaInfo?.status === 5 ||
        response.data.mediaInfo?.status === 4,
      status: response.data.mediaInfo?.status,
      data: response.data,
    };
  } catch (err) {
    // If 404, media doesn't exist in Jellyseerr
    if (err.response && err.response.status === 404) {
      return { exists: false, available: false };
    }
    logger.warn("Error checking media status:", err?.message || err);
    return { exists: false, available: false };
  }
}

/**
 * Fetch root folders from Radarr/Sonarr via Jellyseerr
 * @param {string} jellyseerrUrl - Jellyseerr API URL
 * @param {string} apiKey - Jellyseerr API key
 * @returns {Promise<Array>} Root folders
 */
export async function fetchRootFolders(jellyseerrUrl, apiKey) {
  const now = Date.now();

  // Return cached folders if still valid
  if (rootFoldersCache && now - rootFoldersCacheTime < CACHE_TTL.ROOT_FOLDERS) {
    return rootFoldersCache;
  }

  try {
    const folders = await fetchFromServers(
      jellyseerrUrl,
      apiKey,
      true,
      (server, details, type) => {
        if (!details?.rootFolder) return [];
        return details.rootFolder.map((folder) => ({
          id: folder.id,
          path: folder.path,
          serverId: server.id,
          serverName: server.name || `${type === "radarr" ? "Radarr" : "Sonarr"} ${server.id}`,
          type,
        }));
      }
    );

    rootFoldersCache = folders;
    rootFoldersCacheTime = now;

    logger.info(`✅ Fetched ${folders.length} root folders from Jellyseerr`);
    return folders;
  } catch (err) {
    logger.warn("Failed to fetch root folders:", err?.message);
    return rootFoldersCache || [];
  }
}

/**
 * Fetch tags from Radarr/Sonarr via Jellyseerr
 * @param {string} jellyseerrUrl - Jellyseerr API URL
 * @param {string} apiKey - Jellyseerr API key
 * @returns {Promise<Array>} Tags
 */
export async function fetchTags(jellyseerrUrl, apiKey) {
  const now = Date.now();

  // Return cached tags if still valid
  if (tagsCache && now - tagsCacheTime < CACHE_TTL.TAGS) {
    return tagsCache;
  }

  try {
    const tags = await fetchFromServers(
      jellyseerrUrl,
      apiKey,
      true,
      (server, details, type) => {
        if (!details?.tags) return [];
        return details.tags.map((tag) => ({
          id: tag.id,
          label: tag.label,
          serverId: server.id,
          serverName: server.name || `${type === "radarr" ? "Radarr" : "Sonarr"} ${server.id}`,
          type,
        }));
      }
    );

    tagsCache = tags;
    tagsCacheTime = now;

    logger.info(`✅ Fetched ${tags.length} tags from Jellyseerr`);
    return tags;
  } catch (err) {
    logger.warn("Failed to fetch tags:", err?.message);
    return tagsCache || [];
  }
}

/**
 * Fetch servers (Radarr/Sonarr) via Jellyseerr
 * @param {string} jellyseerrUrl - Jellyseerr API URL
 * @param {string} apiKey - Jellyseerr API key
 * @returns {Promise<Array>} Servers list
 */
export async function fetchServers(jellyseerrUrl, apiKey) {
  const now = Date.now();

  // Return cached servers if still valid
  if (serversCache && now - serversCacheTime < CACHE_TTL.SERVERS) {
    return serversCache;
  }

  try {
    const servers = await fetchFromServers(
      jellyseerrUrl,
      apiKey,
      false,
      (server, details, type) => ({
        id: server.id,
        name: server.name || `${type === "radarr" ? "Radarr" : "Sonarr"} ${server.id}`,
        isDefault: server.isDefault || false,
        type,
      })
    );

    serversCache = servers;
    serversCacheTime = now;

    logger.info(`✅ Fetched ${servers.length} servers from Jellyseerr`);
    return servers;
  } catch (err) {
    logger.warn("Failed to fetch servers:", err?.message);
    return serversCache || [];
  }
}

/**
 * Fetch quality profiles from Radarr/Sonarr via Jellyseerr
 * @param {string} jellyseerrUrl - Jellyseerr API URL
 * @param {string} apiKey - Jellyseerr API key
 * @returns {Promise<Array>} Quality profiles
 */
export async function fetchQualityProfiles(jellyseerrUrl, apiKey) {
  const now = Date.now();

  // Return cached profiles if still valid
  if (qualityProfilesCache && now - qualityProfilesCacheTime < CACHE_TTL.QUALITY_PROFILES) {
    return qualityProfilesCache;
  }

  try {
    const profiles = await fetchFromServers(
      jellyseerrUrl,
      apiKey,
      true,
      (server, details, type) => {
        if (!details?.profiles) return [];
        return details.profiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
          serverId: server.id,
          serverName: server.name || `${type === "radarr" ? "Radarr" : "Sonarr"} ${server.id}`,
          type,
        }));
      }
    );

    qualityProfilesCache = profiles;
    qualityProfilesCacheTime = now;

    logger.info(`✅ Fetched ${profiles.length} quality profiles from Jellyseerr`);
    return profiles;
  } catch (err) {
    logger.warn("Failed to fetch quality profiles:", err?.message);
    return qualityProfilesCache || [];
  }
}

/**
 * Send a media request to Jellyseerr
 * @param {Object} params - Request parameters
 * @returns {Promise<Object>} Response data
 */
export async function sendRequest({
  tmdbId,
  mediaType,
  seasons = [],
  discordUserId = null,
  rootFolder = null,
  serverId = null,
  profileId = null,
  tags = null,
  jellyseerrUrl,
  apiKey,
  userMappings = {},
}) {
  // Prepare seasons for TV shows
  let seasonsFormatted;
  if (mediaType === "tv" && seasons && seasons.length > 0) {
    // If seasons is ["all"] or contains "all", send "all" as string
    if (seasons.includes("all") || seasons[0] === "all") {
      seasonsFormatted = "all";
    } else {
      // Convert to array of numbers
      seasonsFormatted = seasons.map((s) => parseInt(s, 10));
    }
  }

  const payload = {
    mediaType,
    mediaId: parseInt(tmdbId, 10),
    ...(mediaType === "tv" &&
      seasonsFormatted && { seasons: seasonsFormatted }),
  };

  // Add tags if provided
  if (tags && Array.isArray(tags) && tags.length > 0) {
    payload.tags = tags.map((t) => parseInt(t, 10));
    logger.debug(`Using tags: ${tags.join(", ")}`);
  }

  // Add root folder and server ID if provided
  if (rootFolder) {
    payload.rootFolder = rootFolder;
    logger.debug(`Using root folder: ${rootFolder}`);
  }

  if (serverId !== null && serverId !== undefined) {
    payload.serverId = parseInt(serverId, 10);
    logger.debug(`Using server ID: ${serverId}`);
  }

  // Add quality profile ID if provided
  if (profileId !== null && profileId !== undefined) {
    payload.profileId = parseInt(profileId, 10);
    logger.debug(`Using quality profile ID: ${profileId}`);
  }

  // Check if we have a user mapping for this Discord user
  if (discordUserId) {
    try {
      const mappings =
        typeof userMappings === "string"
          ? JSON.parse(userMappings)
          : userMappings;

      logger.debug(`[JELLYSEERR] Checking mapping for Discord user ${discordUserId}`);
      logger.debug(`[JELLYSEERR] Available mappings: ${JSON.stringify(mappings)}`);

      let jellyseerrUserId = null;

      // Handle array format (current standard)
      if (Array.isArray(mappings)) {
        const mapping = mappings.find((m) => String(m.discordUserId) === String(discordUserId));
        if (mapping) {
          jellyseerrUserId = mapping.jellyseerrUserId;
          logger.debug(`[JELLYSEERR] Found array mapping: Discord ${discordUserId} -> Jellyseerr ${jellyseerrUserId}`);
        }
      }
      // Handle object format (legacy/fallback)
      else if (
        mappings &&
        typeof mappings === "object" &&
        mappings[discordUserId]
      ) {
        jellyseerrUserId = mappings[discordUserId];
        logger.debug(`[JELLYSEERR] Found object mapping: Discord ${discordUserId} -> Jellyseerr ${jellyseerrUserId}`);
      }

      if (jellyseerrUserId !== null && jellyseerrUserId !== undefined) {
        payload.userId = parseInt(jellyseerrUserId, 10);
        logger.info(
          `[JELLYSEERR] ✅ MAPPING FOUND: Discord ${discordUserId} -> Jellyseerr User ID ${payload.userId}`
        );
        logger.debug(`[JELLYSEERR] Payload for Jellyseerr: ${JSON.stringify(payload)}`);
      } else {
        logger.warn(
          `[JELLYSEERR] ⚠️ NO MAPPING: Discord user ${discordUserId} not found in mappings. Request will be made as the API key owner.`
        );
      }
    } catch (e) {
      logger.error("[JELLYSEERR] Failed to parse USER_MAPPINGS:", e);
    }
  }

  try {
    logger.debug("Trying Jellyseerr request with payload:", payload);
    const response = await axios.post(`${jellyseerrUrl}/request`, payload, {
      headers: { "X-Api-Key": apiKey },
      timeout: TIMEOUTS.JELLYSEERR_POST,
    });
    logger.info("Jellyseerr request successful!");
    return response.data;
  } catch (err) {
    logger.error(
      "Jellyseerr request failed:",
      err?.response?.data || err?.message || err
    );
    throw err;
  }
}
