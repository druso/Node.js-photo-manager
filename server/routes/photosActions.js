const express = require('express');
const makeLogger = require('../utils/logger2');
const { rateLimit } = require('../utils/rateLimit');

const photosRepo = require('../services/repositories/photosRepo');
const projectsRepo = require('../services/repositories/projectsRepo');
const tagsRepo = require('../services/repositories/tagsRepo');
const photoTagsRepo = require('../services/repositories/photoTagsRepo');
const jobsRepo = require('../services/repositories/jobsRepo');
const tasksOrchestrator = require('../services/tasksOrchestrator');
const { emitJobUpdate } = require('../services/events');
const projectCommitHandlers = require('./projectCommitHandlers');

const log = makeLogger('photosActions');
const router = express.Router();

router.post(
  '/photos/commit-changes',
  rateLimit({ windowMs: 5 * 60 * 1000, max: 10 }),
  async (req, res, next) => {
    req.routeContext = { scope: 'global' };
    next();
  },
  projectCommitHandlers.commitChanges
);

router.post(
  '/photos/revert-changes',
  rateLimit({ windowMs: 5 * 60 * 1000, max: 10 }),
  async (req, res, next) => {
    req.routeContext = { scope: 'global' };
    next();
  },
  projectCommitHandlers.revertChanges
);

router.get('/photos/pending-deletes', async (req, res) => {
  try {
    const { date_from, date_to, file_type, orientation } = req.query;

    // Get all pending deletions across projects
    const pendingRows = photosRepo.listPendingDeletesByProject({
      date_from,
      date_to,
      file_type,
      orientation,
    });

    let jpg = 0, raw = 0;
    const projects = [];

    for (const row of pendingRows) {
      jpg += row.pending_jpg || 0;
      raw += row.pending_raw || 0;
      if ((row.pending_jpg || 0) + (row.pending_raw || 0) > 0) {
        projects.push(row.project_folder);
      }
    }

    res.json({
      jpg,
      raw,
      total: jpg + raw,
      byProject: projects,
    });
  } catch (err) {
    log.error('pending_deletes_failed', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to fetch pending deletions' });
  }
});

// Light JSON validation helper
function ensureItemsArray(body) {
  if (!body || !Array.isArray(body.items)) {
    const err = new Error('Body must be { items: [...] }');
    err.status = 400;
    throw err;
  }
  return body.items;
}

// Validate payload size against MAX_ITEMS_PER_JOB limit
function validatePayloadSize(items) {
  const { MAX_ITEMS_PER_JOB } = jobsRepo;
  if (items.length > MAX_ITEMS_PER_JOB) {
    const err = new Error(`Payload contains ${items.length} items, exceeding maximum of ${MAX_ITEMS_PER_JOB}. Please reduce the batch size or split into multiple requests.`);
    err.status = 400;
    throw err;
  }
}

function parseDryRun(body) {
  return Boolean(body && body.dry_run);
}

// Helper: resolve photo by id and return { photo }
function mustGetPhotoById(photo_id) {
  const idNum = Number(photo_id);
  if (!Number.isFinite(idNum)) {
    const err = new Error('photo_id must be a number');
    err.status = 400;
    throw err;
  }
  const photo = photosRepo.getById(idNum);
  if (!photo) {
    const err = new Error('Photo not found');
    err.status = 404;
    throw err;
  }
  return photo;
}

// POST /api/photos/tags/add
router.post(
  '/photos/tags/add',
  rateLimit({ windowMs: 60 * 1000, max: 120 }),
  async (req, res) => {
    try {
      const items = ensureItemsArray(req.body);
      validatePayloadSize(items); // Enforce 2K item limit
      const dryRun = parseDryRun(req.body);

      let updated = 0;
      const errors = [];
      const dry = dryRun ? { per_item: [], updated: 0 } : null;

      for (const it of items) {
        try {
          if (!it || !('photo_id' in it)) throw new Error('Missing photo_id');
          const photo = mustGetPhotoById(it.photo_id);
          const project_id = photo.project_id;

          if (!Array.isArray(it.tags)) throw new Error('tags must be an array');
          const names = Array.from(new Set((it.tags || []).map(t => String(t || '').trim()).filter(Boolean)));
          if (!names.length) continue; // nothing to do

          // Determine which would be added
          const current = photoTagsRepo.listTagsForPhoto(photo.id);
          const currentByName = new Set(current.map(t => t.name));
          const toAddNames = names.filter(n => !currentByName.has(n));

          if (dryRun) {
            dry.per_item.push({ photo_id: photo.id, would_add: toAddNames });
            if (toAddNames.length) dry.updated++;
            continue;
          }

          for (const name of toAddNames) {
            const tag = tagsRepo.getOrCreateTag(project_id, name);
            photoTagsRepo.addTagToPhoto(photo.id, tag.id);
          }
          if (toAddNames.length) updated++;
        } catch (e) {
          errors.push({ photo_id: it && it.photo_id, error: e.message });
        }
      }

      const payload = dryRun ? { updated: dry.updated, dry_run: dry, errors: errors.length ? errors : undefined } : { updated, errors: errors.length ? errors : undefined };
      res.json(payload);
    } catch (err) {
      log.error('tags_add_failed', { error: err && err.message, stack: err && err.stack });
      res.status(err.status || 500).json({ error: err.message || 'Failed to add tags' });
    }
  }
);

// POST /api/photos/tags/remove
router.post(
  '/photos/tags/remove',
  rateLimit({ windowMs: 60 * 1000, max: 120 }),
  async (req, res) => {
    try {
      const items = ensureItemsArray(req.body);
      validatePayloadSize(items); // Enforce 2K item limit
      const dryRun = parseDryRun(req.body);

      let updated = 0;
      const errors = [];
      const dry = dryRun ? { per_item: [], updated: 0 } : null;

      for (const it of items) {
        try {
          if (!it || !('photo_id' in it)) throw new Error('Missing photo_id');
          const photo = mustGetPhotoById(it.photo_id);
          const project_id = photo.project_id;

          if (!Array.isArray(it.tags)) throw new Error('tags must be an array');
          const names = Array.from(new Set((it.tags || []).map(t => String(t || '').trim()).filter(Boolean)));
          if (!names.length) continue;

          // Determine which would be removed
          const current = photoTagsRepo.listTagsForPhoto(photo.id);
          const currentByName = new Set(current.map(t => t.name));
          const toRemoveNames = names.filter(n => currentByName.has(n));

          if (dryRun) {
            dry.per_item.push({ photo_id: photo.id, would_remove: toRemoveNames });
            if (toRemoveNames.length) dry.updated++;
            continue;
          }

          for (const name of toRemoveNames) {
            const tag = tagsRepo.getByName(project_id, name);
            if (tag) {
              photoTagsRepo.removeTagFromPhoto(photo.id, tag.id);
            }
          }
          if (toRemoveNames.length) updated++;
        } catch (e) {
          errors.push({ photo_id: it && it.photo_id, error: e.message });
        }
      }

      const payload = dryRun ? { updated: dry.updated, dry_run: dry, errors: errors.length ? errors : undefined } : { updated, errors: errors.length ? errors : undefined };
      res.json(payload);
    } catch (err) {
      log.error('tags_remove_failed', { error: err && err.message, stack: err && err.stack });
      res.status(err.status || 500).json({ error: err.message || 'Failed to remove tags' });
    }
  }
);

// POST /api/photos/keep
router.post(
  '/photos/keep',
  rateLimit({ windowMs: 60 * 1000, max: 240 }),
  async (req, res) => {
    try {
      const items = ensureItemsArray(req.body);
      validatePayloadSize(items); // Enforce 2K item limit
      const dryRun = parseDryRun(req.body);

      let updated = 0;
      const errors = [];
      const dry = dryRun ? { per_item: [], updated: 0 } : null;

      for (const it of items) {
        try {
          if (!it || !('photo_id' in it)) throw new Error('Missing photo_id');
          const photo = mustGetPhotoById(it.photo_id);

          const patch = {};
          if (typeof it.keep_jpg === 'boolean') patch.keep_jpg = it.keep_jpg;
          if (typeof it.keep_raw === 'boolean') patch.keep_raw = it.keep_raw;
          if (!Object.keys(patch).length) continue;

          if (dryRun) {
            dry.per_item.push({ photo_id: photo.id, would_update: patch });
            dry.updated++;
            continue;
          }

          const after = photosRepo.updateKeepFlags(photo.id, patch);
          const proj = projectsRepo.getById(after.project_id);
          updated++;
          try {
            // Emit SSE item-level update so clients reconcile keep flags
            emitJobUpdate({
              type: 'item',
              project_folder: proj && proj.project_folder ? proj.project_folder : null,
              filename: after.filename,
              keep_jpg: after.keep_jpg,
              keep_raw: after.keep_raw,
              updated_at: new Date().toISOString(),
              photo_id: after.id,
            });
          } catch (_e) {
            // best-effort emit
          }
        } catch (e) {
          errors.push({ photo_id: it && it.photo_id, error: e.message });
        }
      }

      const payload = dryRun ? { updated: dry.updated, dry_run: dry, errors: errors.length ? errors : undefined } : { updated, errors: errors.length ? errors : undefined };
      res.json(payload);
    } catch (err) {
      log.error('keep_update_failed', { error: err && err.message, stack: err && err.stack });
      res.status(err.status || 500).json({ error: err.message || 'Failed to update keep flags' });
    }
  }
);

// POST /api/photos/visibility
router.post(
  '/photos/visibility',
  rateLimit({ windowMs: 60 * 1000, max: 120 }),
  async (req, res) => {
    try {
      const items = ensureItemsArray(req.body);
      validatePayloadSize(items);
      let updated = 0;
      const errors = [];
      const allowedVisibilities = new Set(['public', 'private']);

      for (const it of items) {
        try {
          if (!it || !('photo_id' in it)) throw new Error('Missing photo_id');
          if (!('visibility' in it)) throw new Error('Missing visibility');

          const photo = mustGetPhotoById(it.photo_id);
          const normalized = String(it.visibility || '').trim().toLowerCase();
          if (!allowedVisibilities.has(normalized)) {
            throw new Error('visibility must be "public" or "private"');
          }

          if ((photo.visibility || 'private') === normalized) {
            continue;
          }

          const after = photosRepo.updateVisibility(photo.id, normalized);
          updated++;

          try {
            const proj = projectsRepo.getById(after.project_id);
            emitJobUpdate({
              type: 'item',
              project_folder: proj && proj.project_folder ? proj.project_folder : null,
              filename: after.filename,
              visibility: after.visibility,
              updated_at: after.updated_at,
              photo_id: after.id,
            });
          } catch (_e) {
            // best-effort emit
          }
        } catch (e) {
          errors.push({ photo_id: it && it.photo_id, error: e.message });
        }
      }

      res.json({ updated, errors: errors.length ? errors : undefined });
    } catch (err) {
      log.error('visibility_update_failed', { error: err && err.message, stack: err && err.stack });
      res.status(err.status || 500).json({ error: err.message || 'Failed to update visibility' });
    }
  }
);

// POST /api/photos/process
// Process derivatives for photos by photo_id with optional force flag
router.post(
  '/photos/process',
  rateLimit({ windowMs: 60 * 1000, max: 60 }),
  async (req, res) => {
    try {
      const items = ensureItemsArray(req.body);
      validatePayloadSize(items); // Enforce 2K item limit
      const dryRun = parseDryRun(req.body);
      const force = Boolean(req.body && req.body.force);

      // Group photos by project for efficient processing
      const photosByProject = {};
      const errors = [];

      // First pass: validate and group photos by project
      for (const it of items) {
        try {
          if (!it || !('photo_id' in it)) throw new Error('Missing photo_id');
          const photo = mustGetPhotoById(it.photo_id);
          const projectId = photo.project_id;

          if (!photosByProject[projectId]) {
            photosByProject[projectId] = [];
          }
          photosByProject[projectId].push({
            photo_id: photo.id,
            filename: photo.filename,
            basename: photo.basename || photo.filename
          });
        } catch (e) {
          errors.push({ photo_id: it && it.photo_id, error: e.message });
        }
      }

      if (dryRun) {
        // Return what would be processed without actually doing it
        const projectCount = Object.keys(photosByProject).length;
        const photoCount = Object.values(photosByProject).reduce((sum, photos) => sum + photos.length, 0);

        return res.json({
          dry_run: {
            projects: projectCount,
            photos: photoCount,
            by_project: Object.entries(photosByProject).map(([projectId, photos]) => ({
              project_id: Number(projectId),
              photo_count: photos.length,
              filenames: photos.map(p => p.filename)
            }))
          },
          errors: errors.length ? errors : undefined
        });
      }

      // Use scope-aware orchestration for cross-project processing
      try {
        // Flatten all photos into a single list with photo_id
        const allPhotoIds = [];
        for (const photos of Object.values(photosByProject)) {
          allPhotoIds.push(...photos.map(p => p.photo_id));
        }

        // Enqueue a single photo_set-scoped job for all photos
        const jobInfo = tasksOrchestrator.startTask({
          type: 'generate_derivatives',
          source: 'user',
          scope: 'photo_set',
          items: allPhotoIds.map(id => ({ photo_id: id })),
          payload: { force },
          tenant_id: 'user_0'
        });

        res.json({
          message: 'Processing queued',
          task_id: jobInfo.task_id,
          job_count: jobInfo.job_count || 1,
          job_ids: jobInfo.chunked ? [jobInfo.first_job_id] : [jobInfo.first_job_id],
          chunked: jobInfo.chunked,
          errors: errors.length ? errors : undefined
        });
      } catch (e) {
        log.error('queue_processing_failed', { error: e.message, stack: e.stack });
        errors.push({ error: e.message });
        res.status(500).json({
          error: 'Failed to queue processing',
          errors
        });
      }
    } catch (err) {
      log.error('process_photos_failed', { error: err && err.message, stack: err && err.stack });
      res.status(err.status || 500).json({ error: err.message || 'Failed to process photos' });
    }
  }
);

// POST /api/photos/move
// Move photos by photo_id to a destination project
router.post(
  '/photos/move',
  rateLimit({ windowMs: 60 * 1000, max: 60 }),
  async (req, res) => {
    try {
      const items = ensureItemsArray(req.body);
      validatePayloadSize(items); // Enforce 2K item limit
      const dryRun = parseDryRun(req.body);
      const destFolder = req.body && req.body.dest_folder;

      if (!destFolder || typeof destFolder !== 'string') {
        return res.status(400).json({ error: 'dest_folder is required' });
      }

      // Validate destination project
      const destProject = projectsRepo.getByFolder(destFolder);
      if (!destProject) {
        return res.status(404).json({ error: 'Destination project not found' });
      }

      // Group photos by source project for efficient processing
      const photosByProject = {};
      const errors = [];

      // First pass: validate and group photos by source project
      for (const it of items) {
        try {
          if (!it || !('photo_id' in it)) throw new Error('Missing photo_id');
          const photo = mustGetPhotoById(it.photo_id);

          // Skip if already in destination project
          if (photo.project_id === destProject.id) {
            errors.push({ photo_id: photo.id, error: 'Photo already in destination project' });
            continue;
          }

          const sourceProjectId = photo.project_id;
          if (!photosByProject[sourceProjectId]) {
            photosByProject[sourceProjectId] = [];
          }
          photosByProject[sourceProjectId].push({
            photo_id: photo.id,
            filename: photo.filename,
            basename: photo.basename || photo.filename
          });
        } catch (e) {
          errors.push({ photo_id: it && it.photo_id, error: e.message });
        }
      }

      if (dryRun) {
        // Return what would be moved without actually doing it
        const sourceProjectCount = Object.keys(photosByProject).length;
        const photoCount = Object.values(photosByProject).reduce((sum, photos) => sum + photos.length, 0);

        return res.json({
          dry_run: {
            source_projects: sourceProjectCount,
            destination_project: {
              id: destProject.id,
              folder: destProject.project_folder,
              name: destProject.project_name
            },
            photos: photoCount,
            by_source_project: Object.entries(photosByProject).map(([projectId, photos]) => {
              const project = projectsRepo.getById(Number(projectId));
              return {
                project_id: Number(projectId),
                project_folder: project ? project.project_folder : null,
                project_name: project ? project.project_name : null,
                photo_count: photos.length,
                filenames: photos.map(p => p.filename)
              };
            })
          },
          errors: errors.length ? errors : undefined
        });
      }

      // Second pass: enqueue move jobs per source project
      const jobIds = [];
      for (const [sourceProjectId, photos] of Object.entries(photosByProject)) {
        try {
          const sourceProject = projectsRepo.getById(Number(sourceProjectId));
          if (!sourceProject) {
            errors.push({ project_id: sourceProjectId, error: 'Source project not found' });
            continue;
          }

          // Enqueue an image_move job for this source project
          const jobInfo = await tasksOrchestrator.startTask({
            project_id: sourceProject.id,
            type: 'image_move',
            source: 'user',
            items: photos.map(p => p.basename),
            tenant_id: 'user_0',
            options: {
              destination_project_id: destProject.id,
              destination_project_folder: destProject.project_folder
            }
          });

          jobIds.push(jobInfo.id);
        } catch (e) {
          errors.push({ project_id: sourceProjectId, error: e.message });
        }
      }

      res.status(202).json({
        message: 'Move queued',
        job_count: jobIds.length,
        job_ids: jobIds,
        destination_project: {
          id: destProject.id,
          folder: destProject.project_folder,
          name: destProject.project_name
        },
        errors: errors.length ? errors : undefined
      });
    } catch (err) {
      log.error('move_photos_failed', { error: err && err.message, stack: err && err.stack });
      res.status(err.status || 500).json({ error: err.message || 'Failed to move photos' });
    }
  }
);

module.exports = router;
