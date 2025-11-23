/**
 * Input Validation using Joi
 * Provides schema validation for API endpoints and user inputs
 */

import Joi from 'joi';

// --- CONFIG VALIDATION ---
export const configSchema = Joi.object({
  DISCORD_TOKEN: Joi.string().allow('').optional(),
  BOT_ID: Joi.string().allow('').optional(),
  GUILD_ID: Joi.string().allow('').optional(),
  JELLYSEERR_URL: Joi.string().uri().allow('').optional(),
  JELLYSEERR_API_KEY: Joi.string().allow('').optional(),
  TMDB_API_KEY: Joi.string().allow('').optional(),
  OMDB_API_KEY: Joi.string().allow('').optional(),
  JELLYFIN_BASE_URL: Joi.string().uri().allow('').optional(),
  JELLYFIN_API_KEY: Joi.string().allow('').optional(),
  JELLYFIN_SERVER_ID: Joi.string().allow('').optional(),
  JELLYFIN_CHANNEL_ID: Joi.string().allow('').optional(),
  JELLYFIN_NOTIFICATION_LIBRARIES: Joi.alternatives(
    Joi.array().items(Joi.string()),  // Legacy array format
    Joi.object().pattern(Joi.string(), Joi.string())  // New object format: { libraryId: channelId }
  ).optional(),
  JELLYFIN_POLLING_ENABLED: Joi.string().valid('true', 'false').optional(),
  JELLYFIN_POLLING_INTERVAL: Joi.string().pattern(/^\d+$/).custom((value, helpers) => {
    const num = parseInt(value, 10);
    if (num < 60000) {
      return helpers.error('any.invalid', { message: 'Polling interval must be at least 60000ms (1 minute)' });
    }
    return value;
  }).optional(),
  JELLYFIN_NOTIFY_MOVIES: Joi.string().valid('true', 'false').optional(),
  JELLYFIN_NOTIFY_SERIES: Joi.string().valid('true', 'false').optional(),
  JELLYFIN_NOTIFY_SEASONS: Joi.string().valid('true', 'false').optional(),
  JELLYFIN_NOTIFY_EPISODES: Joi.string().valid('true', 'false').optional(),
  WEBHOOK_PORT: Joi.alternatives(Joi.string(), Joi.number().port()).optional(),
  AUTO_START_BOT: Joi.string().valid('true', 'false').optional(),
  NOTIFY_ON_AVAILABLE: Joi.string().valid('true', 'false').optional(),
  PRIVATE_MESSAGE_MODE: Joi.string().valid('true', 'false').optional(),
  DEBUG: Joi.string().valid('true', 'false').optional(),
  USER_MAPPINGS: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
  USER_MAPPING_METADATA: Joi.object().optional(),
  ROLE_ALLOWLIST: Joi.array().items(Joi.string()).optional(),
  ROLE_BLOCKLIST: Joi.array().items(Joi.string()).optional()
});

// --- USER MAPPING VALIDATION ---
export const userMappingSchema = Joi.object({
  discordUserId: Joi.string().required(),
  jellyseerrUserId: Joi.string().required(),
  discordUsername: Joi.string().allow(null, '').optional(),
  jellyseerrUsername: Joi.string().allow(null, '').optional(),
  discordDisplayName: Joi.string().allow(null, '').optional(),
  discordAvatar: Joi.string().allow(null, '').optional(),
  jellyseerrDisplayName: Joi.string().allow(null, '').optional()
});

// --- JELLYSEERR REQUEST VALIDATION ---
export const jellyseerrRequestSchema = Joi.object({
  mediaType: Joi.string().valid('movie', 'tv').required(),
  mediaId: Joi.number().integer().positive().required(),
  seasons: Joi.alternatives(
    Joi.array().items(Joi.number().integer().positive()),
    Joi.array().items(Joi.string().valid('all'))
  ).optional(),
  tags: Joi.array().items(Joi.number().integer().positive()).optional(),
  rootFolder: Joi.string().optional(),
  serverId: Joi.number().integer().positive().optional(),
  userId: Joi.number().integer().positive().optional()
});

// --- SEARCH QUERY VALIDATION ---
export const searchQuerySchema = Joi.object({
  query: Joi.string().min(1).max(200).required()
});

// --- ID VALIDATION ---
export const tmdbIdSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
  mediaType: Joi.string().valid('movie', 'tv').required()
});

// --- VALIDATION MIDDLEWARE ---
/**
 * Express middleware factory for validating request body
 * @param {Joi.Schema} schema - Joi validation schema
 * @returns {Function} Express middleware function
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false, // Get all errors, not just first
      stripUnknown: true // Remove unknown fields
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    // Replace req.body with validated/sanitized value
    req.body = value;
    next();
  };
}

/**
 * Express middleware factory for validating query parameters
 * @param {Joi.Schema} schema - Joi validation schema
 * @returns {Function} Express middleware function
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    req.query = value;
    next();
  };
}

/**
 * Express middleware factory for validating URL parameters
 * @param {Joi.Schema} schema - Joi validation schema
 * @returns {Function} Express middleware function
 */
export function validateParams(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    req.params = value;
    next();
  };
}
