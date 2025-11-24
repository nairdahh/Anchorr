/**
 * Jellyseerr API Client
 * Handles all Jellyseerr API interactions
 */

import axios from 'axios';
import logger from '../utils/logger.js';
import { TIMEOUTS, CACHE_TTL } from '../config/constants.js';

// Cache for root folders and tags
let rootFoldersCache = null;
let rootFoldersCacheTime = 0;
let tagsCache = null;
let tagsCacheTime = 0;

/**
 * Check if media exists and is available in Jellyseerr
 * @param {number} tmdbId - TMDB ID
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {Array} requestedSeasons - Season numbers or ['all']
 * @param {string} jellyseerrUrl - Jellyseerr API URL
 * @param {string} apiKey - Jellyseerr API key
 * @returns {Promise<Object>} Status object
 */
export async function checkMediaStatus(tmdbId, mediaType, requestedSeasons = [], jellyseerrUrl, apiKey) {
  try {
    const url = mediaType === "movie"
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
        available: response.data.mediaInfo?.status === 5 || response.data.mediaInfo?.status === 4,
        status: response.data.mediaInfo?.status,
        data: response.data
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
            data: response.data
          };
        }

        const allAvailable = seasonStatuses.every(s => s.status === 5 || s.status === 4);
        return {
          exists: true,
          available: allAvailable,
          status: response.data.mediaInfo?.status,
          data: response.data
        };
      }

      // If requesting specific seasons
      const requestedSeasonNums = requestedSeasons.map(s => parseInt(s, 10));
      const requestedSeasonAvailable = seasonStatuses.some(s =>
        requestedSeasonNums.includes(s.seasonNumber) && (s.status === 5 || s.status === 4)
      );

      return {
        exists: true,
        available: requestedSeasonAvailable,
        status: response.data.mediaInfo?.status,
        data: response.data
      };
    }

    // If no specific seasons requested, check overall status
    return {
      exists: true,
      available: response.data.mediaInfo?.status === 5 || response.data.mediaInfo?.status === 4,
      status: response.data.mediaInfo?.status,
      data: response.data
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
  if (rootFoldersCache && (now - rootFoldersCacheTime) < CACHE_TTL.ROOT_FOLDERS) {
    return rootFoldersCache;
  }

  try {
    const folders = [];

    // Fetch Radarr servers (for movies)
    try {
      const radarrListResponse = await axios.get(`${jellyseerrUrl}/service/radarr`, {
        headers: { "X-Api-Key": apiKey },
        timeout: TIMEOUTS.JELLYSEERR_API,
      });

      for (const server of radarrListResponse.data) {
        try {
          const detailsResponse = await axios.get(`${jellyseerrUrl}/service/radarr/${server.id}`, {
            headers: { "X-Api-Key": apiKey },
            timeout: TIMEOUTS.JELLYSEERR_API,
          });

          if (detailsResponse.data.rootFolder) {
            detailsResponse.data.rootFolder.forEach((folder) => {
              folders.push({
                id: folder.id,
                path: folder.path,
                serverId: server.id,
                serverName: server.name || `Radarr ${server.id}`,
                type: "radarr"
              });
            });
          }
        } catch (err) {
          logger.warn(`Failed to fetch Radarr ${server.id} details:`, err?.message);
        }
      }
    } catch (err) {
      logger.warn("Failed to fetch Radarr servers:", err?.message);
    }

    // Fetch Sonarr servers (for TV shows)
    try {
      const sonarrListResponse = await axios.get(`${jellyseerrUrl}/service/sonarr`, {
        headers: { "X-Api-Key": apiKey },
        timeout: TIMEOUTS.JELLYSEERR_API,
      });

      for (const server of sonarrListResponse.data) {
        try {
          const detailsResponse = await axios.get(`${jellyseerrUrl}/service/sonarr/${server.id}`, {
            headers: { "X-Api-Key": apiKey },
            timeout: TIMEOUTS.JELLYSEERR_API,
          });

          if (detailsResponse.data.rootFolder) {
            detailsResponse.data.rootFolder.forEach((folder) => {
              folders.push({
                id: folder.id,
                path: folder.path,
                serverId: server.id,
                serverName: server.name || `Sonarr ${server.id}`,
                type: "sonarr"
              });
            });
          }
        } catch (err) {
          logger.warn(`Failed to fetch Sonarr ${server.id} details:`, err?.message);
        }
      }
    } catch (err) {
      logger.warn("Failed to fetch Sonarr servers:", err?.message);
    }

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
  if (tagsCache && (now - tagsCacheTime) < CACHE_TTL.TAGS) {
    return tagsCache;
  }

  try {
    const tags = [];

    // Fetch Radarr servers (for movies)
    try {
      const radarrListResponse = await axios.get(`${jellyseerrUrl}/service/radarr`, {
        headers: { "X-Api-Key": apiKey },
        timeout: TIMEOUTS.JELLYSEERR_API,
      });

      for (const server of radarrListResponse.data) {
        try {
          const detailsResponse = await axios.get(`${jellyseerrUrl}/service/radarr/${server.id}`, {
            headers: { "X-Api-Key": apiKey },
            timeout: TIMEOUTS.JELLYSEERR_API,
          });

          if (detailsResponse.data.tags) {
            detailsResponse.data.tags.forEach((tag) => {
              tags.push({
                id: tag.id,
                label: tag.label,
                serverId: server.id,
                serverName: server.name || `Radarr ${server.id}`,
                type: "radarr"
              });
            });
          }
        } catch (err) {
          logger.warn(`Failed to fetch Radarr ${server.id} details:`, err?.message);
        }
      }
    } catch (err) {
      logger.warn("Failed to fetch Radarr servers:", err?.message);
    }

    // Fetch Sonarr servers (for TV shows)
    try {
      const sonarrListResponse = await axios.get(`${jellyseerrUrl}/service/sonarr`, {
        headers: { "X-Api-Key": apiKey },
        timeout: TIMEOUTS.JELLYSEERR_API,
      });

      for (const server of sonarrListResponse.data) {
        try {
          const detailsResponse = await axios.get(`${jellyseerrUrl}/service/sonarr/${server.id}`, {
            headers: { "X-Api-Key": apiKey },
            timeout: TIMEOUTS.JELLYSEERR_API,
          });

          if (detailsResponse.data.tags) {
            detailsResponse.data.tags.forEach((tag) => {
              tags.push({
                id: tag.id,
                label: tag.label,
                serverId: server.id,
                serverName: server.name || `Sonarr ${server.id}`,
                type: "sonarr"
              });
            });
          }
        } catch (err) {
          logger.warn(`Failed to fetch Sonarr ${server.id} details:`, err?.message);
        }
      }
    } catch (err) {
      logger.warn("Failed to fetch Sonarr servers:", err?.message);
    }

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
  tags = null,
  jellyseerrUrl,
  apiKey,
  userMappings = {}
}) {
  // Prepare seasons for TV shows
  let seasonsFormatted;
  if (mediaType === "tv" && seasons && seasons.length > 0) {
    // If seasons is ["all"] or contains "all", send "all" as string
    if (seasons.includes("all") || seasons[0] === "all") {
      seasonsFormatted = "all";
    } else {
      // Convert to array of numbers
      seasonsFormatted = seasons.map(s => parseInt(s, 10));
    }
  }

  const payload = {
    mediaType,
    mediaId: tmdbId,
    ...(mediaType === "tv" && seasonsFormatted && { seasons: seasonsFormatted }),
  };

  // Add tags if provided
  if (tags && Array.isArray(tags) && tags.length > 0) {
    payload.tags = tags.map(t => parseInt(t, 10));
    logger.debug(`Using tags: ${tags.join(', ')}`);
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

  // Check if we have a user mapping for this Discord user
  if (discordUserId) {
    try {
      const mappings = typeof userMappings === 'string'
        ? JSON.parse(userMappings)
        : userMappings;

      let jellyseerrUserId = null;

      // Handle array format (current standard)
      if (Array.isArray(mappings)) {
        const mapping = mappings.find(m => m.discordUserId === discordUserId);
        if (mapping) {
          jellyseerrUserId = mapping.jellyseerrUserId;
        }
      } 
      // Handle object format (legacy/fallback)
      else if (mappings && typeof mappings === 'object' && mappings[discordUserId]) {
        jellyseerrUserId = mappings[discordUserId];
      }

      if (jellyseerrUserId) {
        payload.userId = parseInt(jellyseerrUserId, 10);
        logger.debug(`Using Jellyseerr user ID ${payload.userId} for Discord user ${discordUserId}`);
      }
    } catch (e) {
      logger.warn("Failed to parse USER_MAPPINGS:", e);
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
