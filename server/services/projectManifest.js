const path = require('path');
const fs = require('fs-extra');
const yaml = require('js-yaml');
const makeLogger = require('../utils/logger2');
const log = makeLogger('manifest');

const { ensureProjectDirs, PROJECTS_DIR } = require('./fsUtils');

const MANIFEST_FILENAME = '.project.yaml';
const MANIFEST_VERSION = '1.0';

/**
 * Read and parse a project manifest file
 * @param {string} projectFolder - The project folder name
 * @returns {Object|null} Parsed manifest object or null if not found/invalid
 */
function readManifest(projectFolder) {
  try {
    const projectPath = path.join(PROJECTS_DIR, projectFolder);
    const manifestPath = path.join(projectPath, MANIFEST_FILENAME);
    
    if (!fs.existsSync(manifestPath)) {
      log.debug('manifest_not_found', { project_folder: projectFolder });
      return null;
    }
    
    const content = fs.readFileSync(manifestPath, 'utf8');
    const manifest = yaml.load(content);
    
    if (!validateManifest(manifest)) {
      log.warn('manifest_invalid', { project_folder: projectFolder });
      return null;
    }
    
    log.debug('manifest_read', { project_folder: projectFolder, manifest });
    return manifest;
  } catch (err) {
    log.error('manifest_read_failed', { 
      project_folder: projectFolder, 
      error: err.message 
    });
    return null;
  }
}

/**
 * Write a manifest file to a project folder
 * @param {string} projectFolder - The project folder name
 * @param {Object} data - Manifest data to write
 * @returns {boolean} True if successful, false otherwise
 */
function writeManifest(projectFolder, data) {
  try {
    const projectPath = ensureProjectDirs(projectFolder);
    const manifestPath = path.join(projectPath, MANIFEST_FILENAME);
    
    // Ensure manifest has required fields
    const manifest = {
      name: data.name || projectFolder,
      id: data.id,
      created_at: data.created_at || new Date().toISOString(),
      version: MANIFEST_VERSION,
      ...data
    };
    
    // Validate before writing
    if (!validateManifest(manifest)) {
      log.error('manifest_validation_failed', { 
        project_folder: projectFolder, 
        manifest 
      });
      return false;
    }
    
    // Convert to YAML and write
    const yamlContent = yaml.dump(manifest, {
      indent: 2,
      lineWidth: 80,
      noRefs: true
    });
    
    fs.writeFileSync(manifestPath, yamlContent, 'utf8');
    
    log.info('manifest_written', { 
      project_folder: projectFolder, 
      manifest_id: manifest.id 
    });
    return true;
  } catch (err) {
    log.error('manifest_write_failed', { 
      project_folder: projectFolder, 
      error: err.message 
    });
    return false;
  }
}

/**
 * Validate a manifest object structure
 * @param {Object} manifest - Manifest object to validate
 * @returns {boolean} True if valid, false otherwise
 */
function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    log.debug('manifest_validation_failed', { reason: 'not_an_object' });
    return false;
  }
  
  // Required fields
  if (!manifest.name || typeof manifest.name !== 'string') {
    log.debug('manifest_validation_failed', { reason: 'missing_or_invalid_name' });
    return false;
  }
  
  if (!manifest.id || typeof manifest.id !== 'number') {
    log.debug('manifest_validation_failed', { reason: 'missing_or_invalid_id' });
    return false;
  }
  
  if (!manifest.created_at || typeof manifest.created_at !== 'string') {
    log.debug('manifest_validation_failed', { reason: 'missing_or_invalid_created_at' });
    return false;
  }
  
  // Validate created_at is a valid ISO date
  try {
    const date = new Date(manifest.created_at);
    if (isNaN(date.getTime())) {
      log.debug('manifest_validation_failed', { reason: 'invalid_date_format' });
      return false;
    }
  } catch (err) {
    log.debug('manifest_validation_failed', { reason: 'date_parse_error' });
    return false;
  }
  
  return true;
}

/**
 * Generate a new manifest object
 * @param {string} projectName - The project name
 * @param {number} projectId - The project database ID
 * @returns {Object} New manifest object
 */
function generateManifest(projectName, projectId) {
  return {
    name: projectName,
    id: projectId,
    created_at: new Date().toISOString(),
    version: MANIFEST_VERSION
  };
}

/**
 * Check if a manifest exists for a project
 * @param {string} projectFolder - The project folder name
 * @returns {boolean} True if manifest exists, false otherwise
 */
function manifestExists(projectFolder) {
  try {
    const projectPath = path.join(PROJECTS_DIR, projectFolder);
    const manifestPath = path.join(projectPath, MANIFEST_FILENAME);
    return fs.existsSync(manifestPath);
  } catch (err) {
    return false;
  }
}

/**
 * Delete a manifest file
 * @param {string} projectFolder - The project folder name
 * @returns {boolean} True if successful, false otherwise
 */
function deleteManifest(projectFolder) {
  try {
    const projectPath = path.join(PROJECTS_DIR, projectFolder);
    const manifestPath = path.join(projectPath, MANIFEST_FILENAME);
    
    if (fs.existsSync(manifestPath)) {
      fs.removeSync(manifestPath);
      log.info('manifest_deleted', { project_folder: projectFolder });
      return true;
    }
    
    return false;
  } catch (err) {
    log.error('manifest_delete_failed', { 
      project_folder: projectFolder, 
      error: err.message 
    });
    return false;
  }
}

module.exports = {
  readManifest,
  writeManifest,
  validateManifest,
  generateManifest,
  manifestExists,
  deleteManifest,
  MANIFEST_FILENAME,
  MANIFEST_VERSION
};
