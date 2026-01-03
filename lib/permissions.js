/**
 * Jellyseerr Permission System
 * Centralized permission handling based on official Jellyseerr permissions
 * Source: https://github.com/seerr-team/seerr/blob/d0c9afc16ec12d44dbeeb195e86328a154458e18/server/lib/permissions.ts
 */

import logger from '../utils/logger.js';

// Official Jellyseerr Permission constants (from the source repository)
export const Permission = {
  NONE: 0,
  ADMIN: 2,
  MANAGE_SETTINGS: 4,
  MANAGE_USERS: 8,
  MANAGE_REQUESTS: 16,
  REQUEST: 32,
  VOTE: 64,
  AUTO_APPROVE: 128,
  AUTO_APPROVE_MOVIE: 256,
  AUTO_APPROVE_TV: 512,
  REQUEST_4K: 1024,
  REQUEST_4K_MOVIE: 2048,
  REQUEST_4K_TV: 4096,
  REQUEST_ADVANCED: 8192,
  REQUEST_VIEW: 16384,
  AUTO_APPROVE_4K: 32768,
  AUTO_APPROVE_4K_MOVIE: 65536,
  AUTO_APPROVE_4K_TV: 131072,
  REQUEST_MOVIE: 262144,
  REQUEST_TV: 524288,
  MANAGE_ISSUES: 1048576,
  VIEW_ISSUES: 2097152,
  CREATE_ISSUES: 4194304,
  AUTO_REQUEST: 8388608,
  AUTO_REQUEST_MOVIE: 16777216,
  AUTO_REQUEST_TV: 33554432,
  RECENT_VIEW: 67108864,
  WATCHLIST_VIEW: 134217728,
  MANAGE_BLACKLIST: 268435456,
  VIEW_BLACKLIST: 1073741824,
};

/**
 * Check if a user has a specific permission or array of permissions
 * Based on official Jellyseerr hasPermission function
 * @param {number|number[]} permissions - Single permission or array of permissions to check
 * @param {number} userPermissions - User's permission value
 * @param {Object} options - Check options
 * @returns {boolean} - True if user has the permission(s)
 */
export const hasPermission = (
  permissions,
  userPermissions,
  options = { type: 'and' }
) => {
  // Validate input
  if (typeof userPermissions !== 'number' || isNaN(userPermissions)) {
    logger.warn(`Invalid user permissions value: ${userPermissions}`);
    return false;
  }

  // If checking for NONE permission, always return true
  if (permissions === Permission.NONE) {
    return true;
  }

  // Admin users have all permissions
  if (userPermissions & Permission.ADMIN) {
    return true;
  }

  // Handle array of permissions
  if (Array.isArray(permissions)) {
    switch (options.type) {
      case 'and':
        return permissions.every((permission) => !!(userPermissions & permission));
      case 'or':
        return permissions.some((permission) => !!(userPermissions & permission));
      default:
        logger.warn(`Invalid permission check type: ${options.type}`);
        return false;
    }
  }

  // Handle single permission
  return !!(userPermissions & permissions);
};

/**
 * Determine the highest privilege level of a user
 * @param {number} userPermissions - User's permission value
 * @returns {string} - Permission type: 'admin', 'manager', 'auto-approve', or 'user'
 */
export const getPermissionType = (userPermissions) => {
  if (typeof userPermissions !== 'number' || isNaN(userPermissions)) {
    logger.warn(`Invalid permissions value for type determination: ${userPermissions}`);
    return 'user';
  }

  // Admin check (highest priority)
  if (hasPermission(Permission.ADMIN, userPermissions)) {
    return 'admin';
  }

  // Manager check - has any management permission
  const managementPermissions = [
    Permission.MANAGE_SETTINGS,
    Permission.MANAGE_USERS,
    Permission.MANAGE_REQUESTS,
    Permission.MANAGE_ISSUES,
    Permission.MANAGE_BLACKLIST
  ];

  if (hasPermission(managementPermissions, userPermissions, { type: 'or' })) {
    return 'manager';
  }

  // Auto-approve check - has any auto-approval permission
  const autoApprovePermissions = [
    Permission.AUTO_APPROVE,
    Permission.AUTO_APPROVE_MOVIE,
    Permission.AUTO_APPROVE_TV,
    Permission.AUTO_APPROVE_4K,
    Permission.AUTO_APPROVE_4K_MOVIE,
    Permission.AUTO_APPROVE_4K_TV
  ];

  if (hasPermission(autoApprovePermissions, userPermissions, { type: 'or' })) {
    return 'auto-approve';
  }

  // Default to user
  return 'user';
};

/**
 * Check if a user can approve requests
 * @param {number} userPermissions - User's permission value
 * @returns {boolean} - True if user can approve requests
 */
export const canApproveRequests = (userPermissions) => {
  return hasPermission([
    Permission.ADMIN,
    Permission.MANAGE_REQUESTS
  ], userPermissions, { type: 'or' });
};

/**
 * Check if a user can auto-approve requests
 * @param {number} userPermissions - User's permission value
 * @param {string} mediaType - Optional media type ('movie' or 'tv')
 * @param {boolean} is4K - Optional 4K flag
 * @returns {boolean} - True if user has auto-approve permissions
 */
export const canAutoApprove = (userPermissions, mediaType = null, is4K = false) => {
  // Admin can always auto-approve
  if (hasPermission(Permission.ADMIN, userPermissions)) {
    return true;
  }

  // General auto-approve permission covers everything
  if (hasPermission(Permission.AUTO_APPROVE, userPermissions)) {
    return true;
  }

  // If no specific media type is provided, check if user has ANY auto-approve permission
  if (mediaType === null) {
    const anyAutoApprovePermissions = [
      Permission.AUTO_APPROVE_MOVIE,
      Permission.AUTO_APPROVE_TV,
      Permission.AUTO_APPROVE_4K,
      Permission.AUTO_APPROVE_4K_MOVIE,
      Permission.AUTO_APPROVE_4K_TV
    ];
    
    return hasPermission(anyAutoApprovePermissions, userPermissions, { type: 'or' });
  }

  // 4K auto-approve permissions
  if (is4K) {
    if (hasPermission(Permission.AUTO_APPROVE_4K, userPermissions)) {
      return true;
    }
    
    if (mediaType === 'movie' && hasPermission(Permission.AUTO_APPROVE_4K_MOVIE, userPermissions)) {
      return true;
    }
    
    if (mediaType === 'tv' && hasPermission(Permission.AUTO_APPROVE_4K_TV, userPermissions)) {
      return true;
    }
  } else {
    // Regular auto-approve permissions
    if (mediaType === 'movie' && hasPermission(Permission.AUTO_APPROVE_MOVIE, userPermissions)) {
      return true;
    }
    
    if (mediaType === 'tv' && hasPermission(Permission.AUTO_APPROVE_TV, userPermissions)) {
      return true;
    }
  }

  return false;
};

/**
 * Get detailed permission analysis for a user
 * @param {number} userPermissions - User's permission value
 * @returns {Object} - Detailed permission breakdown
 */
export const analyzePermissions = (userPermissions) => {
  if (typeof userPermissions !== 'number' || isNaN(userPermissions)) {
    logger.warn(`Invalid permissions value for analysis: ${userPermissions}`);
    return {
      isValid: false,
      permissionType: 'user',
      permissions: 0,
      capabilities: {}
    };
  }

  const permissionType = getPermissionType(userPermissions);

  return {
    isValid: true,
    permissionType,
    permissions: userPermissions,
    permissionsBinary: userPermissions.toString(2),
    capabilities: {
      // Admin capabilities
      isAdmin: hasPermission(Permission.ADMIN, userPermissions),
      
      // Management capabilities
      canManageSettings: hasPermission(Permission.MANAGE_SETTINGS, userPermissions),
      canManageUsers: hasPermission(Permission.MANAGE_USERS, userPermissions),
      canManageRequests: hasPermission(Permission.MANAGE_REQUESTS, userPermissions),
      canManageIssues: hasPermission(Permission.MANAGE_ISSUES, userPermissions),
      canManageBlacklist: hasPermission(Permission.MANAGE_BLACKLIST, userPermissions),
      
      // Request capabilities
      canRequest: hasPermission(Permission.REQUEST, userPermissions),
      canRequestMovies: hasPermission(Permission.REQUEST_MOVIE, userPermissions),
      canRequestTv: hasPermission(Permission.REQUEST_TV, userPermissions),
      canRequest4K: hasPermission(Permission.REQUEST_4K, userPermissions),
      canRequest4KMovies: hasPermission(Permission.REQUEST_4K_MOVIE, userPermissions),
      canRequest4KTv: hasPermission(Permission.REQUEST_4K_TV, userPermissions),
      canRequestAdvanced: hasPermission(Permission.REQUEST_ADVANCED, userPermissions),
      canViewRequests: hasPermission(Permission.REQUEST_VIEW, userPermissions),
      
      // Auto-approval capabilities
      hasAutoApprove: hasPermission(Permission.AUTO_APPROVE, userPermissions),
      hasAutoApproveMovies: hasPermission(Permission.AUTO_APPROVE_MOVIE, userPermissions),
      hasAutoApproveTv: hasPermission(Permission.AUTO_APPROVE_TV, userPermissions),
      hasAutoApprove4K: hasPermission(Permission.AUTO_APPROVE_4K, userPermissions),
      hasAutoApprove4KMovies: hasPermission(Permission.AUTO_APPROVE_4K_MOVIE, userPermissions),
      hasAutoApprove4KTv: hasPermission(Permission.AUTO_APPROVE_4K_TV, userPermissions),
      
      // Other capabilities
      canVote: hasPermission(Permission.VOTE, userPermissions),
      canViewIssues: hasPermission(Permission.VIEW_ISSUES, userPermissions),
      canCreateIssues: hasPermission(Permission.CREATE_ISSUES, userPermissions),
      hasAutoRequest: hasPermission(Permission.AUTO_REQUEST, userPermissions),
      hasAutoRequestMovies: hasPermission(Permission.AUTO_REQUEST_MOVIE, userPermissions),
      hasAutoRequestTv: hasPermission(Permission.AUTO_REQUEST_TV, userPermissions),
      canViewRecent: hasPermission(Permission.RECENT_VIEW, userPermissions),
      canViewWatchlist: hasPermission(Permission.WATCHLIST_VIEW, userPermissions),
      canViewBlacklist: hasPermission(Permission.VIEW_BLACKLIST, userPermissions)
    }
  };
};

/**
 * Get human-readable permission name
 * @param {number} permission - Permission constant
 * @returns {string} - Human-readable name
 */
export const getPermissionName = (permission) => {
  const names = {
    [Permission.NONE]: 'None',
    [Permission.ADMIN]: 'Admin',
    [Permission.MANAGE_SETTINGS]: 'Manage Settings',
    [Permission.MANAGE_USERS]: 'Manage Users',
    [Permission.MANAGE_REQUESTS]: 'Manage Requests',
    [Permission.REQUEST]: 'Request',
    [Permission.VOTE]: 'Vote',
    [Permission.AUTO_APPROVE]: 'Auto Approve',
    [Permission.AUTO_APPROVE_MOVIE]: 'Auto Approve Movies',
    [Permission.AUTO_APPROVE_TV]: 'Auto Approve TV',
    [Permission.REQUEST_4K]: 'Request 4K',
    [Permission.REQUEST_4K_MOVIE]: 'Request 4K Movies',
    [Permission.REQUEST_4K_TV]: 'Request 4K TV',
    [Permission.REQUEST_ADVANCED]: 'Advanced Requests',
    [Permission.REQUEST_VIEW]: 'View Requests',
    [Permission.AUTO_APPROVE_4K]: 'Auto Approve 4K',
    [Permission.AUTO_APPROVE_4K_MOVIE]: 'Auto Approve 4K Movies',
    [Permission.AUTO_APPROVE_4K_TV]: 'Auto Approve 4K TV',
    [Permission.REQUEST_MOVIE]: 'Request Movies',
    [Permission.REQUEST_TV]: 'Request TV',
    [Permission.MANAGE_ISSUES]: 'Manage Issues',
    [Permission.VIEW_ISSUES]: 'View Issues',
    [Permission.CREATE_ISSUES]: 'Create Issues',
    [Permission.AUTO_REQUEST]: 'Auto Request',
    [Permission.AUTO_REQUEST_MOVIE]: 'Auto Request Movies',
    [Permission.AUTO_REQUEST_TV]: 'Auto Request TV',
    [Permission.RECENT_VIEW]: 'View Recent',
    [Permission.WATCHLIST_VIEW]: 'View Watchlist',
    [Permission.MANAGE_BLACKLIST]: 'Manage Blacklist',
    [Permission.VIEW_BLACKLIST]: 'View Blacklist',
  };

  return names[permission] || `Unknown (${permission})`;
};

/**
 * Debug helper to log permission analysis
 * @param {string} userId - User identifier for logging
 * @param {number} userPermissions - User's permission value
 */
export const debugPermissions = (userId, userPermissions) => {
  const analysis = analyzePermissions(userPermissions);
  
  logger.debug(`Permission analysis for user ${userId}:`, {
    raw: userPermissions,
    binary: analysis.permissionsBinary,
    type: analysis.permissionType,
    isValid: analysis.isValid,
    capabilities: analysis.capabilities
  });

  // Log specific permissions that are set
  const setPermissions = [];
  for (const [key, value] of Object.entries(Permission)) {
    if (hasPermission(value, userPermissions)) {
      setPermissions.push(`${key}(${value})`);
    }
  }
  
  if (setPermissions.length > 0) {
    logger.debug(`User ${userId} has permissions: ${setPermissions.join(', ')}`);
  } else {
    logger.debug(`User ${userId} has no permissions set`);
  }
};

export default {
  Permission,
  hasPermission,
  getPermissionType,
  canApproveRequests,
  canAutoApprove,
  analyzePermissions,
  getPermissionName,
  debugPermissions
};