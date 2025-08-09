const express = require('express');
const path = require('path');
const fs = require('fs-extra');

const {
  loadManifest,
  saveManifest,
  validatePhotoEntry,
  getCurrentTimestamp
} = require('../services/manifest');

const router = express.Router();

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');
fs.ensureDirSync(PROJECTS_DIR);

// PUT /api/projects/:folder/tags
router.put('/:folder/tags', async (req, res) => {
  try {
    const { folder } = req.params;
    const { updates } = req.body; // Array of { filename, tags }

    const projectPath = path.join(PROJECTS_DIR, folder);
    if (!await fs.pathExists(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const manifest = await loadManifest(projectPath);
    if (!manifest) {
      return res.status(404).json({ error: 'Project manifest not found' });
    }

    let updatedCount = 0;

    for (const update of updates || []) {
      const entry = manifest.entries.find(e => e.filename === update.filename);
      if (!entry) continue;

      if (!Array.isArray(update.tags)) {
        console.error(`Invalid tags for ${update.filename}: tags must be an array`);
        continue;
      }

      const invalidTags = update.tags.filter(tag => typeof tag !== 'string');
      if (invalidTags.length > 0) {
        console.error(`Invalid tag types for ${update.filename}: all tags must be strings`);
        continue;
      }

      entry.tags = update.tags;
      entry.updated_at = getCurrentTimestamp();

      const validation = validatePhotoEntry(entry);
      if (!validation.valid) {
        console.error(`Photo entry validation failed after tag update for ${update.filename}:`, validation.errors);
      }
      updatedCount++;
    }

    await saveManifest(projectPath, manifest);
    res.json({ message: `Updated tags for ${updatedCount} photos`, updated_count: updatedCount });
  } catch (err) {
    console.error('Tags router: error updating tags:', err);
    res.status(500).json({ error: 'Failed to update tags' });
  }
});

module.exports = router;
