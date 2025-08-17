const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const makeLogger = require('../utils/logger2');
const log = makeLogger('keep');
const { rateLimit } = require('../utils/rateLimit');

const projectsRepo = require('../services/repositories/projectsRepo');
const photosRepo = require('../services/repositories/photosRepo');

const router = express.Router();

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');
fs.ensureDirSync(PROJECTS_DIR);

// PUT /api/projects/:folder/keep
// Body: { updates: [{ filename, keep_jpg, keep_raw }] }
// Light rate limit to avoid spamming metadata updates
router.put('/:folder/keep', rateLimit({ windowMs: 60 * 1000, max: 120 }), async (req, res) => {
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
    const project = projectsRepo.getByFolder(folder);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    let updatedCount = 0;

    for (const upd of updates) {
      if (!upd || typeof upd.filename !== 'string') continue;
      const photo = photosRepo.getByProjectAndFilename(project.id, upd.filename);
      if (!photo) continue;

      const patch = {};
      if (typeof upd.keep_jpg === 'boolean') patch.keep_jpg = upd.keep_jpg;
      if (typeof upd.keep_raw === 'boolean') patch.keep_raw = upd.keep_raw;
      if (Object.keys(patch).length > 0) {
        photosRepo.updateKeepFlags(photo.id, patch);
      }
      updatedCount++;
    }
    res.json({ message: `Updated keep flags for ${updatedCount} photos`, updated_count: updatedCount });
  } catch (err) {
    log.error('keep_update_failed', { error: err && err.message, stack: err && err.stack, project_folder: req.params && req.params.folder });
    res.status(500).json({ error: 'Failed to update keep flags' });
  }
});

module.exports = router;
