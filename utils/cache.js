/**
 * Centralized API Response Caching
 * Uses node-cache for in-memory caching with TTL support
 */

import NodeCache from "node-cache";
import { CACHE_TTL } from "../lib/constants.js";
import logger from "./logger.js";

class APICache {
  constructor() {
    // TMDB cache - 5 minutes TTL
    this.tmdbCache = new NodeCache({
      stdTTL: CACHE_TTL.TMDB_SEARCH / 1000, // Convert ms to seconds
      checkperiod: 120, // Check for expired keys every 2 minutes
      useClones: false, // Don't clone objects (better performance)
    });

    // Jellyseerr cache - 1 minute TTL
    this.jellyseerrCache = new NodeCache({
      stdTTL: CACHE_TTL.JELLYSEERR_STATUS / 1000,
      checkperiod: 30,
      useClones: false,
    });

    // Statistics
    this.stats = {
      tmdbHits: 0,
      tmdbMisses: 0,
      jellyseerrHits: 0,
      jellyseerrMisses: 0,
    };
  }

  // TMDB Search Cache
  tmdbSearch(query, results) {
    const key = `search:${query.toLowerCase().trim()}`;

    if (results === undefined) {
      // GET
      const cached = this.tmdbCache.get(key);
      if (cached) {
        this.stats.tmdbHits++;
        return cached;
      }
      this.stats.tmdbMisses++;
      return null;
    } else {
      // SET
      this.tmdbCache.set(key, results);
      return results;
    }
  }

  // TMDB Details Cache
  tmdbDetails(id, mediaType, details) {
    const key = `details:${mediaType}:${id}`;

    if (details === undefined) {
      // GET
      const cached = this.tmdbCache.get(key);
      if (cached) {
        this.stats.tmdbHits++;
        return cached;
      }
      this.stats.tmdbMisses++;
      return null;
    } else {
      // SET
      this.tmdbCache.set(key, details);
      return details;
    }
  }

  // TMDB External IDs Cache
  tmdbExternalIds(id, mediaType, externalIds) {
    const key = `external:${mediaType}:${id}`;

    if (externalIds === undefined) {
      // GET
      const cached = this.tmdbCache.get(key);
      if (cached) {
        this.stats.tmdbHits++;
        return cached;
      }
      this.stats.tmdbMisses++;
      return null;
    } else {
      // SET
      this.tmdbCache.set(key, externalIds);
      return externalIds;
    }
  }

  // TMDB Trending Cache
  tmdbTrending(results) {
    const key = "trending:weekly";

    if (results === undefined) {
      // GET
      const cached = this.tmdbCache.get(key);
      if (cached) {
        this.stats.tmdbHits++;
        return cached;
      }
      this.stats.tmdbMisses++;
      return null;
    } else {
      // SET
      this.tmdbCache.set(key, results);
      return results;
    }
  }

  // Jellyseerr Request Status Cache
  jellyseerrStatus(tmdbId, mediaType, status) {
    const key = `status:${mediaType}:${tmdbId}`;

    if (status === undefined) {
      // GET
      const cached = this.jellyseerrCache.get(key);
      if (cached) {
        this.stats.jellyseerrHits++;
        return cached;
      }
      this.stats.jellyseerrMisses++;
      return null;
    } else {
      // SET
      this.jellyseerrCache.set(key, status);
      return status;
    }
  }

  // Clear specific cache
  clearTMDB() {
    this.tmdbCache.flushAll();
    logger.info("TMDB cache cleared");
  }

  clearJellyseerr() {
    this.jellyseerrCache.flushAll();
    logger.info("Jellyseerr cache cleared");
  }

  // Clear all caches
  clearAll() {
    this.tmdbCache.flushAll();
    this.jellyseerrCache.flushAll();
    logger.info("All caches cleared");
  }

  // Get cache statistics
  getStats() {
    const tmdbKeys = this.tmdbCache.keys().length;
    const jellyseerrKeys = this.jellyseerrCache.keys().length;
    const tmdbTotal = this.stats.tmdbHits + this.stats.tmdbMisses;
    const jellyseerrTotal =
      this.stats.jellyseerrHits + this.stats.jellyseerrMisses;

    return {
      tmdb: {
        keys: tmdbKeys,
        hits: this.stats.tmdbHits,
        misses: this.stats.tmdbMisses,
        hitRate:
          tmdbTotal > 0
            ? ((this.stats.tmdbHits / tmdbTotal) * 100).toFixed(2) + "%"
            : "0%",
      },
      jellyseerr: {
        keys: jellyseerrKeys,
        hits: this.stats.jellyseerrHits,
        misses: this.stats.jellyseerrMisses,
        hitRate:
          jellyseerrTotal > 0
            ? ((this.stats.jellyseerrHits / jellyseerrTotal) * 100).toFixed(2) +
              "%"
            : "0%",
      },
    };
  }
}

// Export singleton instance
export default new APICache();
