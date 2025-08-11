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

// PUT /api/projects/:folder/keep
// Body: { updates: [{ filename, keep_jpg, keep_raw }] }
router.put('/:folder/keep', async (req, res) => {
  try {
    const { folder } = req.params;
    const { updates } = req.body || {};

    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'updates must be an array' });
    }

    const projectPath = path.join(PROJECTS_DIR, folder);
    if (!await fs.pathExists(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const manifest = await loadManifest(projectPath);
    if (!manifest) {
      return res.status(404).json({ error: 'Project manifest not found' });
    }

    let updatedCount = 0;

    for (const upd of updates) {
      if (!upd || typeof upd.filename !== 'string') continue;
      const entry = manifest.entries.find(e => e.filename === upd.filename);
      if (!entry) continue;

      if (typeof upd.keep_jpg === 'boolean') entry.keep_jpg = upd.keep_jpg;
      if (typeof upd.keep_raw === 'boolean') entry.keep_raw = upd.keep_raw;
      entry.updated_at = getCurrentTimestamp();

      const validation = validatePhotoEntry(entry);
      if (!validation.valid) {
        console.error(`Photo entry validation failed after keep update for ${upd.filename}:`, validation.errors);
      }
      updatedCount++;
    }

    await saveManifest(projectPath, manifest);
    res.json({ message: `Updated keep flags for ${updatedCount} photos`, updated_count: updatedCount });
  } catch (err) {
    console.error('Keep router: error updating keep flags:', err);
    res.status(500).json({ error: 'Failed to update keep flags' });
  }
});

module.exports = router;
