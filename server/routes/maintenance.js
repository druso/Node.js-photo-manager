const express = require('express');
const projectsRepo = require('../services/repositories/projectsRepo');
const photosRepo = require('../services/repositories/photosRepo');
const tasksOrchestrator = require('../services/tasksOrchestrator');
const { rateLimit } = require('../utils/rateLimit');

const router = express.Router();
router.use(express.json());

function extVariants(name, exts) {
  const out = [];
  for (const e of exts) {
    out.push(`${name}.${e}`);
    out.push(`${name}.${e.toUpperCase()}`);
  }
  return out;
}

// POST /api/projects/:folder/commit-changes
// Limit: 10 requests per 5 minutes per IP
router.post('/:folder/commit-changes', rateLimit({ windowMs: 5 * 60 * 1000, max: 10 }), async (req, res) => {
  try {
    const { folder } = req.params;
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { task_id } = tasksOrchestrator.startTask({ project_id: project.id, type: 'change_commit', source: 'commit' });
    res.json({ started: true, task_id });
  } catch (err) {
    console.error('commit-changes failed:', err);
    res.status(500).json({ error: 'Failed to commit changes' });
  }
});

// POST /api/projects/:folder/revert-changes
// Limit: 10 requests per 5 minutes per IP
router.post('/:folder/revert-changes', rateLimit({ windowMs: 5 * 60 * 1000, max: 10 }), async (req, res) => {
  try {
    const { folder } = req.params;
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const page = photosRepo.listPaged({ project_id: project.id, limit: 100000 });
    let updated = 0;
    for (const p of page.items) {
      const nextKeepJpg = !!p.jpg_available;
      const nextKeepRaw = !!p.raw_available;
      if (p.keep_jpg !== nextKeepJpg || p.keep_raw !== nextKeepRaw) {
        photosRepo.upsertPhoto(project.id, {
          manifest_id: p.manifest_id,
          filename: p.filename,
          basename: p.basename || p.filename,
          ext: p.ext,
          date_time_original: p.date_time_original,
          jpg_available: !!p.jpg_available,
          raw_available: !!p.raw_available,
          other_available: !!p.other_available,
          keep_jpg: nextKeepJpg,
          keep_raw: nextKeepRaw,
          thumbnail_status: p.thumbnail_status,
          preview_status: p.preview_status,
          orientation: p.orientation,
          meta_json: p.meta_json,
        });
        updated++;
      }
    }
    res.json({ updated });
  } catch (err) {
    console.error('revert-changes failed:', err);
    res.status(500).json({ error: 'Failed to revert changes' });
  }
});

module.exports = router;
