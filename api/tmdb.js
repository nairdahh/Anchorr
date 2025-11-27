/**
 * TMDB (The Movie Database) API Client
 * Handles all TMDB API interactions with caching
 */

import axios from "axios";
import cache from "../utils/cache.js";
import { TIMEOUTS } from "../lib/constants.js";

/**
 * Search for movies and TV shows
 * @param {string} query - Search query
 * @param {string} apiKey - TMDB API key
 * @returns {Promise<Array>} Search results
 */
export async function tmdbSearch(query, apiKey) {
  // Check cache first
  const cached = cache.tmdbSearch(query);
  if (cached) {
    return cached;
  }

  // Fetch from API
  const url = "https://api.themoviedb.org/3/search/multi";
  const res = await axios.get(url, {
    params: { api_key: apiKey, query, include_adult: false, page: 1 },
    timeout: TIMEOUTS.TMDB_API,
  });
  const results = res.data.results || [];

  // Store in cache
  cache.tmdbSearch(query, results);
  return results;
}

/**
 * Get trending movies and TV shows
 * @param {string} apiKey - TMDB API key
 * @returns {Promise<Array>} Trending results
 */
export async function tmdbGetTrending(apiKey) {
  // Check cache first
  const cached = cache.tmdbTrending();
  if (cached) {
    return cached;
  }

  // Fetch from API
  const url = "https://api.themoviedb.org/3/trending/all/week";
  const res = await axios.get(url, {
    params: { api_key: apiKey },
    timeout: TIMEOUTS.TMDB_API,
  });
  const results = res.data.results || [];

  // Store in cache
  cache.tmdbTrending(results);
  return results;
}

/**
 * Get detailed information about a movie or TV show
 * @param {number} id - TMDB ID
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {string} apiKey - TMDB API key
 * @returns {Promise<Object>} Media details
 */
export async function tmdbGetDetails(id, mediaType, apiKey) {
  // Check cache first
  const cached = cache.tmdbDetails(id, mediaType);
  if (cached) {
    return cached;
  }

  // Fetch from API
  const url =
    mediaType === "movie"
      ? `https://api.themoviedb.org/3/movie/${id}`
      : `https://api.themoviedb.org/3/tv/${id}`;
  const res = await axios.get(url, {
    params: {
      api_key: apiKey,
      language: "en-US",
      append_to_response: "images,credits",
    },
    timeout: TIMEOUTS.TMDB_API,
  });
  const details = res.data;

  // Store in cache
  cache.tmdbDetails(id, mediaType, details);
  return details;
}

/**
 * Get external IDs (IMDb) for a movie or TV show
 * @param {number} id - TMDB ID
 * @param {string} mediaType - 'movie' or 'tv'
 * @param {string} apiKey - TMDB API key
 * @returns {Promise<string|null>} IMDb ID
 */
export async function tmdbGetExternalImdb(id, mediaType, apiKey) {
  // Check cache first
  const cached = cache.tmdbExternalIds(id, mediaType);
  if (cached) {
    return cached;
  }

  // Fetch from API
  const url =
    mediaType === "movie"
      ? `https://api.themoviedb.org/3/movie/${id}/external_ids`
      : `https://api.themoviedb.org/3/tv/${id}/external_ids`;
  const res = await axios.get(url, {
    params: { api_key: apiKey },
    timeout: TIMEOUTS.TMDB_API,
  });
  const imdbId = res.data.imdb_id || null;

  // Store in cache
  cache.tmdbExternalIds(id, mediaType, imdbId);
  return imdbId;
}

/**
 * Find the best backdrop image for a media item
 * @param {Object} details - Media details object
 * @returns {string|null} Backdrop path
 */
export function findBestBackdrop(details) {
  if (details.images?.backdrops?.length > 0) {
    const englishBackdrop = details.images.backdrops.find(
      (b) => b.iso_639_1 === "en"
    );
    if (englishBackdrop) return englishBackdrop.file_path;
  }
  return details.backdrop_path;
}
