const express = require('express');
const path = require('path');
const fs = require('fs-extra');

const projectsRepo = require('../services/repositories/projectsRepo');
const photosRepo = require('../services/repositories/photosRepo');
const tagsRepo = require('../services/repositories/tagsRepo');
const photoTagsRepo = require('../services/repositories/photoTagsRepo');

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
        console.error(`Invalid tags for ${update.filename}: tags must be an array`);
        continue;
      }

      const invalidTags = update.tags.filter(tag => typeof tag !== 'string');
      if (invalidTags.length > 0) {
        console.error(`Invalid tag types for ${update.filename}: all tags must be strings`);
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
    console.error('Tags router: error updating tags:', err);
    res.status(500).json({ error: 'Failed to update tags' });
  }
});

module.exports = router;
