const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const makeLogger = require('../utils/logger2');
const log = makeLogger('keep');
const { rateLimit } = require('../utils/rateLimit');

const projectsRepo = require('../services/repositories/projectsRepo');
const photosRepo = require('../services/repositories/photosRepo');
const { emitJobUpdate } = require('../services/events');

const router = express.Router();
// Ensure JSON parsing for this router
router.use(express.json());

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
      // Accept filename with or without extension
      const base = path.parse(upd.filename).name || upd.filename;
      let photo = photosRepo.getByProjectAndFilename(project.id, upd.filename);
      if (!photo && base && base !== upd.filename) {
        photo = photosRepo.getByProjectAndFilename(project.id, base);
      }
      if (!photo) continue;

      const patch = {};
      if (typeof upd.keep_jpg === 'boolean') patch.keep_jpg = upd.keep_jpg;
      if (typeof upd.keep_raw === 'boolean') patch.keep_raw = upd.keep_raw;
      if (Object.keys(patch).length > 0) {
        photosRepo.updateKeepFlags(photo.id, patch);
        updatedCount++;
        // Emit SSE item-level update so clients can reconcile keep flags without full refetch
        try {
          emitJobUpdate({
            type: 'item',
            project_folder: folder,
            filename: photo.filename,
            keep_jpg: (typeof patch.keep_jpg === 'boolean') ? patch.keep_jpg : photo.keep_jpg,
            keep_raw: (typeof patch.keep_raw === 'boolean') ? patch.keep_raw : photo.keep_raw,
            updated_at: new Date().toISOString(),
          });
        } catch (_) {
          // best-effort emit; ignore
        }
      }
    }
    res.json({ message: `Updated keep flags for ${updatedCount} photos`, updated_count: updatedCount });
  } catch (err) {
    log.error('keep_update_failed', { error: err && err.message, stack: err && err.stack, project_folder: req.params && req.params.folder });
    res.status(500).json({ error: 'Failed to update keep flags' });
  }
});

module.exports = router;
