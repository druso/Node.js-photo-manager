const path = require('path');
const fs = require('fs-extra');

// Schema helpers
const {
  validateManifest,
  validatePhotoEntry,
  createDefaultManifest,
  createDefaultPhotoEntry,
  getCurrentTimestamp,
  migrateManifest
} = require('../../schema/manifest-schema');

// Create a new, validated manifest object
function createManifest(projectName) {
  const manifest = createDefaultManifest(projectName);
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new Error('Failed to create valid manifest: ' + validation.errors.join(', '));
  }
  return manifest;
}

// Load manifest.json from a project folder, migrate and validate
async function loadManifest(projectPath) {
  const manifestPath = path.join(projectPath, 'manifest.json');
  try {
    const data = await fs.readFile(manifestPath, 'utf8');
    let manifest = JSON.parse(data);
    manifest = migrateManifest(manifest);
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      console.error(`Manifest validation failed for ${projectPath}:`, validation.errors);
    }
    return manifest;
  } catch (err) {
    console.error(`Failed to load manifest from ${projectPath}:`, err.message);
    return null;
  }
}

// Save manifest.json after validation and timestamp update
async function saveManifest(projectPath, manifest) {
  const manifestPath = path.join(projectPath, 'manifest.json');
  manifest.updated_at = getCurrentTimestamp();
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    console.error('Manifest validation failed before save:', validation.errors);
    throw new Error('Cannot save invalid manifest: ' + validation.errors.join(', '));
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Manifest saved and validated for project: ${manifest.project_name}`);
}

module.exports = {
  createManifest,
  loadManifest,
  saveManifest,
  // Re-export useful schema helpers for callers that need them
  validatePhotoEntry,
  createDefaultPhotoEntry,
  getCurrentTimestamp
};
