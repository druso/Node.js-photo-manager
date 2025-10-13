const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const makeLogger = require('../utils/logger2');
const { rateLimit } = require('../utils/rateLimit');
const { PROJECTS_DIR, DEFAULT_USER, getProjectPath } = require('../services/fsUtils');
const projectsRepo = require('../services/repositories/projectsRepo');
const photosRepo = require('../services/repositories/photosRepo');
const photoTagsRepo = require('../services/repositories/photoTagsRepo');

const router = express.Router();
const log = makeLogger('tags');

// Ensure user directory exists
const userDir = path.join(PROJECTS_DIR, DEFAULT_USER);
fs.ensureDirSync(userDir);

// PUT /api/projects/:folder/tags
// Light limit to avoid spamming metadata updates
router.put('/:folder/tags', rateLimit({ windowMs: 60 * 1000, max: 60 }), async (req, res) => {
  try {
    const { folder } = req.params;
    const { updates } = req.body; // Array of { filename, tags }

    const projectPath = getProjectPath(folder);
    if (!await fs.pathExists(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const project = projectsRepo.getByFolder(folder);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    let updatedCount = 0;

    for (const update of updates || []) {
      if (!update || typeof update.filename !== 'string') continue;
      const photo = photosRepo.getByProjectAndFilename(project.id, update.filename);
      if (!photo) continue;

      if (!Array.isArray(update.tags)) {
        log.warn('tags_update_invalid_tags_array', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name, filename: update.filename });
        continue;
      }

      const invalidTags = update.tags.filter(tag => typeof tag !== 'string');
      if (invalidTags.length > 0) {
        log.warn('tags_update_invalid_tag_types', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name, filename: update.filename, invalid_count: invalidTags.length });
        continue;
      }

      // Normalize and de-duplicate tag names
      const desiredNames = Array.from(new Set(update.tags.map(t => t.trim()).filter(Boolean)));
      // Resolve or create tags, get IDs
      const desiredTags = desiredNames.map(name => tagsRepo.getOrCreateTag(project.id, name));
      const desiredTagIds = new Set(desiredTags.map(t => t.id));

      // Current tags for photo
      const currentTags = photoTagsRepo.listTagsForPhoto(photo.id);
      const currentTagIds = new Set(currentTags.map(t => t.id));

      // Compute additions and removals
      for (const tag of desiredTags) {
        if (!currentTagIds.has(tag.id)) {
          photoTagsRepo.addTagToPhoto(photo.id, tag.id);
        }
      }
      for (const tag of currentTags) {
        if (!desiredTagIds.has(tag.id)) {
          photoTagsRepo.removeTagFromPhoto(photo.id, tag.id);
        }
      }
      updatedCount++;
    }
    res.json({ message: `Updated tags for ${updatedCount} photos`, updated_count: updatedCount });
  } catch (err) {
    log.error('tags_update_failed', { error: err && err.message, stack: err && err.stack });
    res.status(500).json({ error: 'Failed to update tags' });
  }
});

module.exports = router;
