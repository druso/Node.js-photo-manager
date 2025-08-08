# Manifest.json Schema Documentation

## Overview

The photo management application uses a formal schema system to ensure data consistency and reliability across the entire codebase. This document explains how the schema is structured, enforced, and how to safely extend it.

## 🏗️ Schema Architecture

### Core Components

1. **Schema Definition** (`/schema/manifest-schema.js`)
   - Defines the complete structure of manifest.json files
   - Provides validation functions
   - Includes default value generators
   - Handles schema migration for future versions

2. **Enforcement Points** (Throughout codebase)
   - All locations marked with `// SCHEMA_ENFORCEMENT:` comments
   - Automatic validation during data creation, loading, and saving
   - Runtime validation of user inputs

## 📋 Schema Structure

### Manifest Base Structure
```json
{
  "project_name": "string (required)",
  "created_at": "ISO datetime string (required)",
  "updated_at": "ISO datetime string (required)", 
  "entries": "array of photo entries (required)",
  "schema_version": "string (optional, defaults to current version)"
}
```

### Photo Entry Structure
```json
{
  "id": "string (required) - unique identifier",
  "filename": "string (required) - filename without extension",
  "created_at": "ISO datetime string (required)",
  "updated_at": "ISO datetime string (required)",
  "jpg_available": "boolean (required)",
  "raw_available": "boolean (required)", 
  "other_available": "boolean (required)",
  "keep_jpg": "boolean (required)",
  "keep_raw": "boolean (required)",
  "tags": "array of strings (required)",
  "metadata": {
    "date_time_original": "ISO datetime string (optional)",
    "camera_make": "string (optional)",
    "camera_model": "string (optional)",
    "make": "string (optional) - Camera/device manufacturer",
    "model": "string (optional) - Camera/device model",
    "exif_image_width": "number (optional) - Image width in pixels",
    "exif_image_height": "number (optional) - Image height in pixels",
    "orientation": "number (optional) - Image orientation (1-8)"
  }
}
```

## 🔧 Schema Enforcement Points

### Backend (server.js)

1. **Manifest Creation** (Line ~65)
   ```javascript
   // SCHEMA_ENFORCEMENT: Use schema-compliant manifest creation
   const createManifest = (projectName) => {
     const manifest = createDefaultManifest(projectName);
     // Validation occurs here
   }
   ```

2. **Manifest Loading** (Line ~85)
   ```javascript
   // SCHEMA_ENFORCEMENT: Load manifest with validation and migration
   const loadManifest = async (projectPath) => {
     // Migration and validation occurs here
   }
   ```

3. **Manifest Saving** (Line ~110)
   ```javascript
   // SCHEMA_ENFORCEMENT: Save manifest with validation
   const saveManifest = async (projectPath, manifest) => {
     // Validation before save occurs here
   }
   ```

4. **Photo Entry Creation** (Line ~285)
   ```javascript
   // SCHEMA_ENFORCEMENT: Create new entry using schema-compliant function
   entry = createDefaultPhotoEntry(originalName, fileType, metadata);
   // Validation occurs here
   ```

5. **Tag Updates** (Line ~353)
   ```javascript
   // SCHEMA_ENFORCEMENT: Validate and update photo entries with tag changes
   // Tag validation and entry validation occurs here
   ```

### Frontend

The frontend receives transformed data (`entries` → `photos`) but should be updated to include validation when the schema is extended to frontend operations.

## 🚀 Adding New Fields to the Schema

### Step-by-Step Process

1. **Update Schema Definition** (`/schema/manifest-schema.js`)
   ```javascript
   // Add to MANIFEST_SCHEMA or PHOTO_ENTRY_SCHEMA
   new_field: {
     type: 'string',
     required: false,
     default: 'default_value',
     description: 'Description of the new field'
   }
   ```

2. **Update Validation Functions**
   ```javascript
   // Add validation logic in validateManifest() or validatePhotoEntry()
   if (entry.new_field && typeof entry.new_field !== 'string') {
     errors.push('new_field must be a string');
   }
   ```

3. **Update Default Value Generators**
   ```javascript
   // Add to createDefaultManifest() or createDefaultPhotoEntry()
   new_field: 'default_value'
   ```

4. **Update Schema Version** (if breaking change)
   ```javascript
   const SCHEMA_VERSION = '1.1.0'; // Increment version
   ```

5. **Add Migration Logic** (if needed)
   ```javascript
   function migrateManifest(manifest) {
     if (manifest.schema_version === '1.0.0') {
       // Add migration logic here
       manifest.new_field = 'default_value';
       manifest.schema_version = '1.1.0';
     }
     return manifest;
   }
   ```

6. **Update All Enforcement Points**
   - Search for `// SCHEMA_ENFORCEMENT:` comments
   - Update any code that creates or modifies the affected structure
   - Add validation calls where appropriate

7. **Update Documentation**
   - Update this file
   - Update any API documentation
   - Update frontend interfaces if needed

## ⚠️ Important Guidelines

### DO's
- ✅ Always use schema functions (`createDefaultManifest`, `createDefaultPhotoEntry`)
- ✅ Validate data at all enforcement points
- ✅ Add descriptive comments with `// SCHEMA_ENFORCEMENT:`
- ✅ Consider backward compatibility when adding fields
- ✅ Test schema changes thoroughly
- ✅ Update schema version for breaking changes

### DON'Ts
- ❌ Never create manifest/entry objects manually
- ❌ Don't skip validation at enforcement points
- ❌ Don't modify schema without updating all enforcement points
- ❌ Don't remove required fields without migration logic
- ❌ Don't ignore validation errors in production

## 🧪 Testing Schema Changes

### Validation Testing
```javascript
const { validateManifest, validatePhotoEntry } = require('./schema/manifest-schema');

// Test manifest validation
const testManifest = { /* test data */ };
const result = validateManifest(testManifest);
console.log('Valid:', result.valid);
console.log('Errors:', result.errors);
```

### Migration Testing
```javascript
const { migrateManifest } = require('./schema/manifest-schema');

// Test with old schema version
const oldManifest = { /* old format data */ };
const migratedManifest = migrateManifest(oldManifest);
```

## 🔍 Debugging Schema Issues

### Common Issues
1. **Validation Failures**: Check console logs for detailed error messages
2. **Migration Problems**: Ensure old data is properly transformed
3. **Type Mismatches**: Verify data types match schema definitions
4. **Missing Fields**: Check if required fields are being set

### Debug Tools
- Enable detailed logging in schema validation functions
- Use browser/Node.js debugger at enforcement points
- Check manifest.json files directly for corruption
- Validate against schema in development environment

## 📚 Related Files

- `/schema/manifest-schema.js` - Main schema definition and validation
- `/server.js` - Primary enforcement points in backend
- `/SCHEMA_DOCUMENTATION.md` - This documentation file
- Individual manifest.json files in project folders

## 🔄 Schema Evolution Strategy

The schema system is designed to handle evolution over time:

1. **Additive Changes**: New optional fields can be added without breaking existing data
2. **Migration Support**: Old data is automatically migrated when loaded
3. **Version Tracking**: Schema versions are tracked for proper migration
4. **Backward Compatibility**: Old clients can still work with new data (within reason)

This ensures the application can grow and evolve while maintaining data integrity and reliability.
