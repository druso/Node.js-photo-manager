/**
 * MANIFEST.JSON SCHEMA DEFINITION
 * 
 * This file defines the complete schema for the manifest.json structure used throughout
 * the photo management application. It serves as the single source of truth for:
 * - Data structure validation
 * - Type checking
 * - Default value generation
 * - Schema evolution and migration
 * 
 * IMPORTANT: When adding new fields to the manifest structure:
 * 1. Update the schema definitions below
 * 2. Update the validation functions
 * 3. Update the default value generators
 * 4. Consider backward compatibility and migration needs
 * 5. Update all enforcement points in the codebase (marked with SCHEMA_ENFORCEMENT comments)
 */

// Schema version for future migrations
const SCHEMA_VERSION = '1.0.0';

/**
 * MANIFEST BASE STRUCTURE SCHEMA
 * Defines the top-level manifest.json structure
 */
const MANIFEST_SCHEMA = {
  project_name: {
    type: 'string',
    required: true,
    description: 'Human-readable name of the photo project'
  },
  created_at: {
    type: 'string',
    format: 'iso-datetime',
    required: true,
    description: 'ISO timestamp when the project was created'
  },
  updated_at: {
    type: 'string',
    format: 'iso-datetime',
    required: true,
    description: 'ISO timestamp when the project was last modified'
  },
  entries: {
    type: 'array',
    items: 'PHOTO_ENTRY_SCHEMA',
    required: true,
    description: 'Array of photo entries in this project'
  },
  schema_version: {
    type: 'string',
    required: false,
    default: SCHEMA_VERSION,
    description: 'Schema version for migration purposes'
  }
};

/**
 * PHOTO ENTRY STRUCTURE SCHEMA
 * Defines the structure of individual photo entries within the manifest
 */
const PHOTO_ENTRY_SCHEMA = {
  id: {
    type: 'string',
    required: true,
    description: 'Unique identifier for the photo entry (timestamp-filename format)'
  },
  filename: {
    type: 'string',
    required: true,
    description: 'Original filename without extension (used as primary key)'
  },
  created_at: {
    type: 'string',
    format: 'iso-datetime',
    required: true,
    description: 'ISO timestamp when the photo entry was created'
  },
  updated_at: {
    type: 'string',
    format: 'iso-datetime',
    required: true,
    description: 'ISO timestamp when the photo entry was last modified'
  },
  jpg_available: {
    type: 'boolean',
    required: true,
    default: false,
    description: 'Whether a JPG version of this photo exists'
  },
  raw_available: {
    type: 'boolean',
    required: true,
    default: false,
    description: 'Whether a RAW version of this photo exists'
  },
  other_available: {
    type: 'boolean',
    required: true,
    default: false,
    description: 'Whether other file formats of this photo exist'
  },
  keep_jpg: {
    type: 'boolean',
    required: true,
    default: true,
    description: 'User preference: whether to keep the JPG version'
  },
  keep_raw: {
    type: 'boolean',
    required: true,
    default: true,
    description: 'User preference: whether to keep the RAW version'
  },
  tags: {
    type: 'array',
    items: 'string',
    required: true,
    default: [],
    description: 'Array of user-assigned tags for this photo'
  },
  metadata: {
    type: 'object',
    required: true,
    default: {},
    description: 'EXIF and other metadata extracted from the photo file',
    properties: {
      date_time_original: {
        type: 'string',
        format: 'iso-datetime',
        required: false,
        description: 'Original date/time when photo was taken (from EXIF)'
      },
      camera_make: {
        type: 'string',
        required: false,
        description: 'Camera manufacturer (from EXIF)'
      },
      camera_model: {
        type: 'string',
        required: false,
        description: 'Camera model (from EXIF)'
      },
      make: {
        type: 'string',
        required: false,
        description: 'Camera/device manufacturer (Make from EXIF)'
      },
      model: {
        type: 'string',
        required: false,
        description: 'Camera/device model (Model from EXIF)'
      },
      exif_image_width: {
        type: 'number',
        required: false,
        description: 'Image width in pixels (ExifImageWidth from EXIF)'
      },
      exif_image_height: {
        type: 'number',
        required: false,
        description: 'Image height in pixels (ExifImageHeight from EXIF)'
      },
      orientation: {
        type: 'number',
        required: false,
        description: 'Image orientation value (Orientation from EXIF, 1-8)'
      }
    }
  },
  // Processing statuses for generated assets
  thumbnail_status: {
    type: 'string',
    required: false,
    description: "Thumbnail generation status: 'pending' | 'generated' | 'failed' | 'not_supported'"
  },
  preview_status: {
    type: 'string',
    required: false,
    description: "Preview generation status: 'pending' | 'generated' | 'failed' | 'not_supported'"
  }
};

/**
 * VALIDATION FUNCTIONS
 */

/**
 * Validates a complete manifest object against the schema
 * @param {Object} manifest - The manifest object to validate
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validateManifest(manifest) {
  const errors = [];
  
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest must be an object'] };
  }
  
  // Validate required fields
  if (!manifest.project_name || typeof manifest.project_name !== 'string') {
    errors.push('project_name is required and must be a string');
  }
  
  if (!manifest.created_at || !isValidISODate(manifest.created_at)) {
    errors.push('created_at is required and must be a valid ISO datetime');
  }
  
  if (!manifest.updated_at || !isValidISODate(manifest.updated_at)) {
    errors.push('updated_at is required and must be a valid ISO datetime');
  }
  
  if (!Array.isArray(manifest.entries)) {
    errors.push('entries is required and must be an array');
  } else {
    // Validate each entry
    manifest.entries.forEach((entry, index) => {
      const entryValidation = validatePhotoEntry(entry);
      if (!entryValidation.valid) {
        errors.push(`Entry ${index}: ${entryValidation.errors.join(', ')}`);
      }
    });
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validates a photo entry object against the schema
 * @param {Object} entry - The photo entry object to validate
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validatePhotoEntry(entry) {
  const errors = [];
  
  if (!entry || typeof entry !== 'object') {
    return { valid: false, errors: ['Photo entry must be an object'] };
  }
  
  // Validate required string fields
  const requiredStrings = ['id', 'filename', 'created_at', 'updated_at'];
  requiredStrings.forEach(field => {
    if (!entry[field] || typeof entry[field] !== 'string') {
      errors.push(`${field} is required and must be a string`);
    }
  });
  
  // Validate datetime fields
  if (entry.created_at && !isValidISODate(entry.created_at)) {
    errors.push('created_at must be a valid ISO datetime');
  }
  
  if (entry.updated_at && !isValidISODate(entry.updated_at)) {
    errors.push('updated_at must be a valid ISO datetime');
  }
  
  // Validate boolean fields
  const requiredBooleans = ['jpg_available', 'raw_available', 'other_available', 'keep_jpg', 'keep_raw'];
  requiredBooleans.forEach(field => {
    if (typeof entry[field] !== 'boolean') {
      errors.push(`${field} is required and must be a boolean`);
    }
  });
  
  // Validate tags array
  if (!Array.isArray(entry.tags)) {
    errors.push('tags is required and must be an array');
  } else {
    entry.tags.forEach((tag, index) => {
      if (typeof tag !== 'string') {
        errors.push(`tags[${index}] must be a string`);
      }
    });
  }
  
  // Validate metadata object
  if (!entry.metadata || typeof entry.metadata !== 'object') {
    errors.push('metadata is required and must be an object');
  } else {
    // Validate optional metadata string fields
    const optionalStringFields = ['date_time_original', 'camera_make', 'camera_model', 'make', 'model'];
    optionalStringFields.forEach(field => {
      if (entry.metadata[field] !== undefined && typeof entry.metadata[field] !== 'string') {
        errors.push(`metadata.${field} must be a string if provided`);
      }
    });
    
    // Validate optional metadata number fields
    const optionalNumberFields = ['exif_image_width', 'exif_image_height', 'orientation'];
    optionalNumberFields.forEach(field => {
      if (entry.metadata[field] !== undefined && typeof entry.metadata[field] !== 'number') {
        errors.push(`metadata.${field} must be a number if provided`);
      }
    });
    
    // Validate orientation range (1-8 according to EXIF spec)
    if (entry.metadata.orientation !== undefined && 
        (entry.metadata.orientation < 1 || entry.metadata.orientation > 8)) {
      errors.push('metadata.orientation must be between 1 and 8 if provided');
    }
    
    // Validate image dimensions are positive
    if (entry.metadata.exif_image_width !== undefined && entry.metadata.exif_image_width <= 0) {
      errors.push('metadata.exif_image_width must be a positive number if provided');
    }
    if (entry.metadata.exif_image_height !== undefined && entry.metadata.exif_image_height <= 0) {
      errors.push('metadata.exif_image_height must be a positive number if provided');
    }
  }

  // Optional derivative statuses
  const allowedStatus = ['pending', 'generated', 'failed', 'not_supported'];
  if (entry.thumbnail_status !== undefined) {
    if (typeof entry.thumbnail_status !== 'string' || !allowedStatus.includes(entry.thumbnail_status)) {
      errors.push("thumbnail_status must be one of 'pending'|'generated'|'failed'|'not_supported' if provided");
    }
  }
  if (entry.preview_status !== undefined) {
    if (typeof entry.preview_status !== 'string' || !allowedStatus.includes(entry.preview_status)) {
      errors.push("preview_status must be one of 'pending'|'generated'|'failed'|'not_supported' if provided");
    }
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * DEFAULT VALUE GENERATORS
 */

/**
 * Creates a new manifest with default values
 * @param {string} projectName - Name of the project
 * @returns {Object} - New manifest object conforming to schema
 */
function createDefaultManifest(projectName) {
  const timestamp = new Date().toISOString();
  
  return {
    project_name: projectName,
    created_at: timestamp,
    updated_at: timestamp,
    entries: [],
    schema_version: SCHEMA_VERSION
  };
}

/**
 * Creates a new photo entry with default values
 * @param {string} filename - Original filename without extension
 * @param {string} fileType - File type ('jpg', 'raw', 'other')
 * @param {Object} metadata - Optional metadata object
 * @returns {Object} - New photo entry object conforming to schema
 */
function createDefaultPhotoEntry(filename, fileType, metadata = {}) {
  const timestamp = new Date().toISOString();
  const id = `${Date.now()}-${filename.replace(/\s/g, '_')}`;
  
  return {
    id,
    filename,
    created_at: timestamp,
    updated_at: timestamp,
    jpg_available: fileType === 'jpg',
    raw_available: fileType === 'raw',
    other_available: fileType === 'other',
    keep_jpg: true,
    keep_raw: true,
    tags: [],
    metadata: metadata || {}
  };
}

/**
 * UTILITY FUNCTIONS
 */

/**
 * Validates if a string is a valid ISO datetime
 * @param {string} dateString - The date string to validate
 * @returns {boolean} - True if valid ISO datetime
 */
function isValidISODate(dateString) {
  if (typeof dateString !== 'string') return false;
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date) && date.toISOString() === dateString;
}

/**
 * Gets the current timestamp in ISO format
 * @returns {string} - Current timestamp as ISO string
 */
function getCurrentTimestamp() {
  return new Date().toISOString();
}

/**
 * SCHEMA MIGRATION FUNCTIONS
 * (For future use when schema evolves)
 */

/**
 * Migrates a manifest from an older schema version to the current version
 * @param {Object} manifest - The manifest to migrate
 * @returns {Object} - Migrated manifest
 */
function migrateManifest(manifest) {
  // Add schema_version if missing (v1.0.0 migration)
  if (!manifest.schema_version) {
    manifest.schema_version = SCHEMA_VERSION;
    manifest.updated_at = getCurrentTimestamp();
  }
  
  // Future migrations can be added here
  // Example:
  // if (manifest.schema_version === '1.0.0') {
  //   // Migrate from 1.0.0 to 1.1.0
  //   manifest = migrateFrom1_0_0To1_1_0(manifest);
  // }
  
  return manifest;
}

// Export all functions and schemas
module.exports = {
  // Schema definitions
  MANIFEST_SCHEMA,
  PHOTO_ENTRY_SCHEMA,
  SCHEMA_VERSION,
  
  // Validation functions
  validateManifest,
  validatePhotoEntry,
  
  // Default value generators
  createDefaultManifest,
  createDefaultPhotoEntry,
  
  // Utility functions
  isValidISODate,
  getCurrentTimestamp,
  
  // Migration functions
  migrateManifest
};
