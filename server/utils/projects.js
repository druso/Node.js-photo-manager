// Project utilities: folder/id helpers
// New model: Folders use human-readable names with (n) suffix for duplicates

const path = require('path');
const fs = require('fs-extra');

// Get PROJECTS_DIR and DEFAULT_USER - need to handle circular dependency carefully
let PROJECTS_DIR;
let DEFAULT_USER;
let getProjectPath;
try {
  const fsUtils = require('../services/fsUtils');
  PROJECTS_DIR = fsUtils.PROJECTS_DIR;
  DEFAULT_USER = fsUtils.DEFAULT_USER;
  getProjectPath = fsUtils.getProjectPath;
} catch (err) {
  // Fallback if fsUtils not available
  PROJECTS_DIR = path.join(__dirname, '..', '..', '.projects');
  DEFAULT_USER = 'user_0';
  getProjectPath = (folder) => path.join(PROJECTS_DIR, DEFAULT_USER, folder);
}

/**
 * Sanitize a project name for use as a folder name
 * Replaces filesystem-unsafe characters with safe alternatives
 * @param {string} name - The project name to sanitize
 * @returns {string} Sanitized folder name
 */
function sanitizeFolderName(name) {
  if (!name || typeof name !== 'string') {
    return 'Untitled Project';
  }
  
  let sanitized = String(name)
    .trim()
    // Replace filesystem-unsafe characters
    .replace(/[\/\\]/g, '-')      // Forward/back slashes → dash
    .replace(/:/g, '-')            // Colon → dash
    .replace(/[*?]/g, '_')         // Asterisk/question → underscore
    .replace(/"/g, "'")            // Double quote → single quote
    .replace(/[<>|]/g, '_')        // Angle brackets/pipe → underscore
    // Remove control characters
    .replace(/[\x00-\x1f\x80-\x9f]/g, '')
    // Collapse multiple spaces/dashes
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim();
  
  // Ensure not empty after sanitization
  if (!sanitized || sanitized === '') {
    return 'Untitled Project';
  }
  
  // Truncate to filesystem limit (255 chars, leave room for (n) suffix)
  const maxLength = 240;
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength).trim();
  }
  
  return sanitized;
}

/**
 * Generate a unique folder name by checking filesystem and adding (n) suffix if needed
 * @param {string} baseName - The base project name (already sanitized)
 * @returns {string} Unique folder name
 */
function generateUniqueFolderName(baseName) {
  const sanitized = sanitizeFolderName(baseName);
  return findNextAvailableName(sanitized);
}

/**
 * Find the next available folder name by checking filesystem AND database
 * Adds (n) suffix if conflicts exist
 * @param {string} baseName - The base folder name
 * @returns {string} Available folder name
 */
function findNextAvailableName(baseName) {
  // Ensure user directory exists
  const userDir = path.join(PROJECTS_DIR, DEFAULT_USER);
  fs.ensureDirSync(userDir);
  
  // Helper to check if name is available (both filesystem and database)
  function isNameAvailable(name) {
    // Check filesystem
    const folderPath = getProjectPath(name);
    if (fs.existsSync(folderPath)) {
      return false;
    }
    
    // Check database (avoid circular dependency by lazy-loading)
    try {
      const projectsRepo = require('../services/repositories/projectsRepo');
      const existing = projectsRepo.getByFolder(name);
      if (existing && existing.status !== 'canceled') {
        return false;
      }
    } catch (err) {
      // If repo not available (e.g., during tests), just check filesystem
    }
    
    return true;
  }
  
  // Check if base name is available
  if (isNameAvailable(baseName)) {
    return baseName;
  }
  
  // Find next available (n) suffix
  let counter = 2;
  let candidateName;
  
  do {
    candidateName = `${baseName} (${counter})`;
    counter++;
    
    // Safety limit to prevent infinite loop
    if (counter > 1000) {
      // Fallback to timestamp-based name
      const timestamp = Date.now();
      candidateName = `${baseName} (${timestamp})`;
      break;
    }
  } while (!isNameAvailable(candidateName));
  
  return candidateName;
}

/**
 * Check if a folder name matches the old p<id> format
 * @param {string} folder - The folder name to check
 * @returns {boolean} True if old format, false otherwise
 */
function isLegacyProjectFolder(folder) {
  return /^p\d+$/.test(String(folder));
}

/**
 * Parse project ID from old-style p<id> folder name
 * @param {string} folder - The folder name
 * @returns {number|null} Project ID or null if not legacy format
 */
function parseProjectIdFromFolder(folder) {
  const m = /^p(\d+)$/.exec(String(folder));
  return m ? Number(m[1]) : null;
}

/**
 * Legacy function - kept for backward compatibility during transition
 * @deprecated Use generateUniqueFolderName instead
 */
function makeProjectFolderName(project_name, id) {
  // During transition, still support old format
  return `p${id}`;
}

/**
 * Legacy function - kept for backward compatibility
 * @deprecated Use isLegacyProjectFolder instead
 */
function isCanonicalProjectFolder(folder) {
  return isLegacyProjectFolder(folder);
}

/**
 * Legacy slugify function - kept for reference
 * @deprecated Not used in new folder naming
 */
function slugify(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-_]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

module.exports = {
  // New functions
  sanitizeFolderName,
  generateUniqueFolderName,
  findNextAvailableName,
  isLegacyProjectFolder,
  
  // Legacy functions (for backward compatibility)
  makeProjectFolderName,
  isCanonicalProjectFolder,
  parseProjectIdFromFolder,
  slugify,
};
