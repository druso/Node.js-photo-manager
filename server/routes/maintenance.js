const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const projectsRepo = require('../services/repositories/projectsRepo');
const photosRepo = require('../services/repositories/photosRepo');
const jobsRepo = require('../services/repositories/jobsRepo');
const { ensureProjectDirs, moveToTrash } = require('../services/fsUtils');

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
router.post('/:folder/commit-changes', async (req, res) => {
  try {
    const { folder } = req.params;
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const projectPath = ensureProjectDirs(project.project_folder);

    const page = photosRepo.listPaged({ project_id: project.id, limit: 100000 });
    const jpgExts = new Set(['jpg','jpeg']);
    const rawExts = new Set(['raw','cr2','nef','arw','dng','raf','orf','rw2']);

    let updated = 0;

    for (const p of page.items) {
      // Move JPG if not kept
      if (!p.keep_jpg && p.jpg_available) {
        const candidates = extVariants(p.filename, jpgExts);
        for (const c of candidates) {
          const full = path.join(projectPath, c);
          if (fs.existsSync(full)) {
            try { fs.moveSync(full, path.join(projectPath, '.trash', path.basename(full)), { overwrite: true }); } catch {}
          }
        }
        photosRepo.upsertPhoto(project.id, {
          manifest_id: p.manifest_id,
          filename: p.filename,
          basename: p.basename || p.filename,
          ext: p.ext,
          date_time_original: p.date_time_original,
          jpg_available: false,
          raw_available: !!p.raw_available,
          other_available: !!p.other_available,
          keep_jpg: !!p.keep_jpg,
          keep_raw: !!p.keep_raw,
          thumbnail_status: p.thumbnail_status,
          preview_status: p.preview_status,
          orientation: p.orientation,
          meta_json: p.meta_json,
        });
        updated++;
      }
      // Move RAW if not kept
      if (!p.keep_raw && p.raw_available) {
        const candidates = extVariants(p.filename, rawExts);
        for (const c of candidates) {
          const full = path.join(projectPath, c);
          if (fs.existsSync(full)) {
            try { fs.moveSync(full, path.join(projectPath, '.trash', path.basename(full)), { overwrite: true }); } catch {}
          }
        }
        photosRepo.upsertPhoto(project.id, {
          manifest_id: p.manifest_id,
          filename: p.filename,
          basename: p.basename || p.filename,
          ext: p.ext,
          date_time_original: p.date_time_original,
          jpg_available: !!p.jpg_available,
          raw_available: false,
          other_available: !!p.other_available,
          keep_jpg: !!p.keep_jpg,
          keep_raw: !!p.keep_raw,
          thumbnail_status: p.thumbnail_status,
          preview_status: p.preview_status,
          orientation: p.orientation,
          meta_json: p.meta_json,
        });
        updated++;
      }
    }

    // Enqueue reconciliation jobs with high priority
    const tenant_id = 'user_0';
    const enqueued = [];
    enqueued.push(jobsRepo.enqueue({ tenant_id, project_id: project.id, type: 'manifest_check', priority: 95 }));
    enqueued.push(jobsRepo.enqueue({ tenant_id, project_id: project.id, type: 'folder_check', priority: 95 }));
    enqueued.push(jobsRepo.enqueue({ tenant_id, project_id: project.id, type: 'manifest_cleaning', priority: 80 }));

    res.json({ updatedCount: updated, enqueued: enqueued.map(j => ({ id: j.id, type: j.type })) });
  } catch (err) {
    console.error('commit-changes failed:', err);
    res.status(500).json({ error: 'Failed to commit changes' });
  }
});

module.exports = router;
