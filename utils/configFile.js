import fs from 'fs';
import path from 'path';
import logger from './logger.js';

/**
 * CONFIG_PATH determines where config.json is saved:
 * - Docker: /config/config.json (volume mount)
 * - Local (Windows/Linux): ./config/config.json (config folder)
 */
export const CONFIG_PATH = fs.existsSync("/config")
  ? path.join("/config", "config.json")
  : path.join(process.cwd(), "config", "config.json");

/**
 * Reads config.json and returns the parsed object
 * @returns {Object|null} Config object or null if doesn't exist
 */
export function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    logger.debug(`Config file not found at ${CONFIG_PATH}`);
    return null;
  }

  try {
    const rawData = fs.readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(rawData);
    logger.debug(`Config loaded successfully from ${CONFIG_PATH}`);
    return config;
  } catch (error) {
    logger.error(`Error reading config from ${CONFIG_PATH}:`, error);
    return null;
  }
}

/**
 * Creates a backup of the current config.json
 * @returns {string|null} Backup file path or null if failed
 */
function createConfigBackup() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return null; // Nothing to backup
    }

    const configDir = path.dirname(CONFIG_PATH);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupPath = path.join(configDir, `config.backup.${timestamp}.json`);

    fs.copyFileSync(CONFIG_PATH, backupPath);
    logger.debug(`Config backup created at ${backupPath}`);
    return backupPath;
  } catch (error) {
    logger.warn(`Failed to create config backup: ${error.message}`);
    return null;
  }
}

/**
 * Writes entire config object to config.json with robust error handling
 * @param {Object} config - Config object to save
 * @returns {boolean} True if save succeeded
 */
export function writeConfig(config) {
  try {
    // Ensure /config directory exists
    const configDir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(configDir)) {
      logger.info(`Creating config directory: ${configDir}`);
      fs.mkdirSync(configDir, { recursive: true, mode: 0o777 });
    }

    // Create backup before writing (in case of corruption)
    createConfigBackup();

    // Write with explicit permissions
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(config, null, 2),
      {
        mode: 0o666,
        encoding: 'utf-8'
      }
    );

    logger.debug(`Config saved successfully to ${CONFIG_PATH}`);
    return true;
  } catch (error) {
    logger.error(`❌ CRITICAL: Failed to write config to ${CONFIG_PATH}`, error);

    // Detailed error diagnostics
    if (error.code === 'EACCES') {
      logger.error(`❌ Permission denied writing to ${CONFIG_PATH}`);
      logger.error(`   Try: chmod 666 ${CONFIG_PATH} or check Docker volume permissions`);
      logger.error(`   Current user: uid=${process.getuid?.() || 'N/A'}, gid=${process.getgid?.() || 'N/A'}`);
    } else if (error.code === 'ENOENT') {
      logger.error(`❌ Directory does not exist: ${configDir}`);
      logger.error(`   Try: mkdir -p ${configDir} && chmod 777 ${configDir}`);
    } else if (error.code === 'EROFS') {
      logger.error(`❌ Read-only file system: ${CONFIG_PATH}`);
      logger.error(`   Check Docker volume mount configuration`);
    }

    return false;
  }
}

/**
 * Updates only specific keys in config (merge)
 * @param {Object} updates - Object with keys to update
 * @returns {boolean} True if update succeeded
 */
export function updateConfig(updates) {
  const config = readConfig() || {};
  const updatedConfig = { ...config, ...updates };
  return writeConfig(updatedConfig);
}

/**
 * Loads config into process.env for compatibility with existing code
 * Includes automatic migrations for backwards compatibility
 * @returns {boolean} True if load succeeded
 */
export function loadConfigToEnv() {
  const config = readConfig();
  if (!config) {
    logger.warn("No config found to load into process.env");
    return false;
  }

  // --- AUTO-MIGRATIONS ---

  // 1. Normalize JELLYSEERR_URL (remove /api/v1 suffix)
  if (config.JELLYSEERR_URL && typeof config.JELLYSEERR_URL === 'string') {
    const originalUrl = config.JELLYSEERR_URL;
    config.JELLYSEERR_URL = config.JELLYSEERR_URL.replace(/\/api\/v1\/?$/, '');
    if (originalUrl !== config.JELLYSEERR_URL) {
      logger.debug(`Normalized JELLYSEERR_URL: ${originalUrl} → ${config.JELLYSEERR_URL}`);
    }
  }

  // 2. Auto-migrate JELLYFIN_NOTIFICATION_LIBRARIES from array to object
  if (Array.isArray(config.JELLYFIN_NOTIFICATION_LIBRARIES)) {
    logger.info("🔄 Migrating JELLYFIN_NOTIFICATION_LIBRARIES from array to object format...");
    const defaultChannel = config.JELLYFIN_CHANNEL_ID || '';
    const migratedLibraries = {};

    config.JELLYFIN_NOTIFICATION_LIBRARIES.forEach(libId => {
      migratedLibraries[libId] = defaultChannel;
    });

    config.JELLYFIN_NOTIFICATION_LIBRARIES = migratedLibraries;

    // Save migrated version
    if (writeConfig(config)) {
      logger.info(`✅ Successfully migrated ${Object.keys(migratedLibraries).length} libraries to default channel: ${defaultChannel || '(none set)'}`);
    } else {
      logger.error("Failed to save migrated config");
    }
  }

  // --- LOAD INTO PROCESS.ENV ---
  for (const [key, value] of Object.entries(config)) {
    // Convert objects/arrays to JSON strings to avoid "[object Object]"
    process.env[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  logger.debug(`Config loaded into process.env (${Object.keys(config).length} keys)`);
  return true;
}

// ============================================
// HELPERS FOR SPECIFIC CONFIG SECTIONS
// ============================================

/**
 * Get USERS array from config
 * @returns {Array} Array of user objects
 */
export function getUsers() {
  const config = readConfig();
  return config?.USERS || [];
}

/**
 * Save a new user to config.json
 * @param {string} username - Username
 * @param {string} passwordHash - Bcrypt hashed password
 * @returns {Object} The newly created user object
 * @throws {Error} If save fails
 */
export function saveUser(username, passwordHash) {
  const config = readConfig() || {};

  if (!config.USERS) {
    config.USERS = [];
  }

  const newUser = {
    id: Date.now().toString(),
    username,
    password: passwordHash,
    createdAt: new Date().toISOString()
  };

  config.USERS.push(newUser);

  if (!writeConfig(config)) {
    throw new Error("Failed to save user to config.json - check permissions");
  }

  logger.info(`✅ User "${username}" saved to config.json`);
  return newUser;
}

/**
 * Get USER_MAPPINGS array from config
 * @returns {Array} Array of mapping objects
 */
export function getUserMappings() {
  const config = readConfig();
  return config?.USER_MAPPINGS || [];
}

/**
 * Save or update a user mapping
 * @param {Object} mapping - Mapping object with discordUserId, jellyseerrUserId, etc.
 * @returns {Object} The saved mapping object
 * @throws {Error} If save fails
 */
export function saveUserMapping(mapping) {
  const config = readConfig() || {};

  if (!config.USER_MAPPINGS) {
    config.USER_MAPPINGS = [];
  }

  // Check if mapping already exists for this Discord user
  const existingIndex = config.USER_MAPPINGS.findIndex(
    m => m.discordUserId === mapping.discordUserId
  );

  const newMapping = {
    ...mapping,
    createdAt: mapping.createdAt || new Date().toISOString()
  };

  if (existingIndex >= 0) {
    config.USER_MAPPINGS[existingIndex] = newMapping;
    logger.info(`✅ Updated user mapping for Discord user ${mapping.discordUserId}`);
  } else {
    config.USER_MAPPINGS.push(newMapping);
    logger.info(`✅ Added new user mapping for Discord user ${mapping.discordUserId}`);
  }

  if (!writeConfig(config)) {
    throw new Error("Failed to save user mapping to config.json - check permissions");
  }

  return newMapping;
}

/**
 * Delete a user mapping by Discord user ID
 * @param {string} discordUserId - Discord user ID to remove
 * @returns {boolean} True if deleted, false if not found
 */
export function deleteUserMapping(discordUserId) {
  const config = readConfig() || {};

  if (!config.USER_MAPPINGS || config.USER_MAPPINGS.length === 0) {
    return false;
  }

  const initialLength = config.USER_MAPPINGS.length;
  config.USER_MAPPINGS = config.USER_MAPPINGS.filter(
    m => m.discordUserId !== discordUserId
  );

  if (config.USER_MAPPINGS.length === initialLength) {
    return false; // Not found
  }

  if (!writeConfig(config)) {
    throw new Error("Failed to save config after deleting user mapping");
  }

  logger.info(`✅ Deleted user mapping for Discord user ${discordUserId}`);
  return true;
}

/**
 * Helper to normalize Jellyseerr URL (removes /api/v1 suffix)
 * @param {string} url - Jellyseerr URL
 * @returns {string} Normalized URL
 */
export function normalizeJellyseerrUrl(url) {
  if (!url) return '';
  return url.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
}

/**
 * Helper to get full Jellyseerr API URL (with /api/v1)
 * @param {string} url - Jellyseerr base URL
 * @returns {string} Full API URL
 */
export function getJellyseerrApiUrl(url) {
  const base = normalizeJellyseerrUrl(url);
  return base ? `${base}/api/v1` : '';
}
