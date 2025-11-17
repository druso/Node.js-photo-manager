const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const makeLogger = require('../utils/logger2');
const log = makeLogger('projects');
const router = express.Router();
// DB repositories
const projectsRepo = require('../services/repositories/projectsRepo');
const photosRepo = require('../services/repositories/photosRepo');
const photoTagsRepo = require('../services/repositories/photoTagsRepo');
const jobsRepo = require('../services/repositories/jobsRepo');
const { emitJobUpdate } = require('../services/events');
const { normalizeVisibilityParam } = require('../utils/visibility');
const tasksOrchestrator = require('../services/tasksOrchestrator');
const { isCanonicalProjectFolder } = require('../utils/projects');
const { rateLimit } = require('../utils/rateLimit');
const { getConfig } = require('../services/config');
const { ensureProjectDirs, PROJECTS_DIR, DEFAULT_USER } = require('../services/fsUtils');

// Ensure base directories exist when router loads
const userDir = path.join(PROJECTS_DIR, DEFAULT_USER);
fs.ensureDirSync(userDir);

// Apply rate limiting (180 requests per minute per IP) for locate endpoints
// Increased from 60 to accommodate normal usage patterns with SSE and polling
const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  message: 'Too many requests, please try again later.'
});

// GET /api/projects - list projects
router.get('/', async (req, res) => {
  try {
    const rows = projectsRepo.list();
    const projects = rows.map(p => ({
      id: p.id,
      name: p.project_name,
      folder: p.project_folder,
      created_at: p.created_at,
      updated_at: p.updated_at,
      photo_count: photosRepo.countByProject(p.id)
    }));
    res.json(projects);
  } catch (err) {
    log.error('projects_list_failed', { error: err && err.message, stack: err && err.stack });
    res.status(500).json({ error: 'Failed to get projects' });
  }
});

// PATCH /api/projects/:folder/rename - rename project
// Updates display name only - maintenance will align folder name automatically
// Limit: 10 requests per 5 minutes per IP
router.patch('/:folder/rename', rateLimit({ windowMs: 5 * 60 * 1000, max: 10 }), async (req, res) => {
  try {
    const { folder } = req.params;
    const { new_name } = req.body || {};
    
    if (!new_name || String(new_name).trim() === '') {
      return res.status(400).json({ error: 'New project name is required' });
    }
    
    // Get current project
    const project = projectsRepo.getByFolder(folder);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Import utilities
    const { writeManifest } = require('../services/projectManifest');
    
    // Update display name in database
    const updated = projectsRepo.updateName(project.id, String(new_name));
    
    // Update manifest with new name
    // Maintenance will detect mismatch and align folder name later
    writeManifest(folder, {
      name: new_name,
      id: project.id,
      created_at: project.created_at
    });
    
    log.info('project_name_updated', {
      project_id: project.id,
      project_folder: folder,
      new_name: new_name,
      note: 'Folder alignment will be handled by maintenance'
    });
    
    return res.json({
      message: 'Project name updated successfully. Folder will be aligned during next maintenance cycle.',
      project: {
        id: updated.id,
        name: updated.project_name,
        folder: updated.project_folder,
        created_at: updated.created_at,
        updated_at: updated.updated_at
      }
    });
  } catch (err) {
    log.error('project_rename_failed', { 
      error: err && err.message, 
      stack: err && err.stack, 
      folder: req.params && req.params.folder 
    });
    res.status(500).json({ error: 'Failed to rename project: ' + (err.message || 'Unknown error') });
  }
});

// POST /api/projects - create project
router.post('/', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Project name is required' });
    }

    // Fresh-start creation: repository assigns canonical folder as p<id>
    const created = projectsRepo.createProject({ project_name: name });

    // Create on-disk directories for the final canonical folder
    await ensureProjectDirs(created.project_folder);

    res.json({
      message: 'Project created successfully',
      project: {
        name: created.project_name,
        folder: created.project_folder,
        created_at: created.created_at,
        updated_at: created.updated_at,
        photo_count: 0
      }
    });
  } catch (err) {
    log.error('project_create_failed', { error: err && err.message, stack: err && err.stack });
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// GET /api/projects/:folder - get project details
router.get('/:folder', async (req, res) => {
  try {
    const { folder } = req.params;
    if (!isCanonicalProjectFolder(folder)) {
      return res.status(400).json({ error: 'Invalid project folder format' });
    }

    const project = projectsRepo.getByFolder(folder);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const pendingDeletes = photosRepo.listPendingDeletesForProject(project.id) || [];
    const keepMismatches = photosRepo.listKeepMismatchesForProject(project.id) || [];
    const missingDerivatives = photosRepo.countMissingDerivativesForProject
      ? photosRepo.countMissingDerivativesForProject(project.id)
      : 0;
    const totalPhotos = photosRepo.countByProject(project.id);
    const recentJobs = jobsRepo.listByProject(project.id, { limit: 1 }) || [];
    const recent = recentJobs.length ? {
      last_job_started_at: recentJobs[0].started_at || recentJobs[0].created_at || null,
      last_job_type: recentJobs[0].type || null,
      last_job_status: recentJobs[0].status || null,
    } : null;

    res.json({
      summary: {
        id: project.id,
        project_name: project.project_name,
        project_folder: project.project_folder,
        created_at: project.created_at,
        updated_at: project.updated_at,
        status: project.status || 'active',
      },
      counts: {
        photos_total: totalPhotos,
        photos_pending_delete: pendingDeletes.length,
        photos_keep_mismatch: keepMismatches.length,
        photos_missing_derivatives: missingDerivatives,
      },
      recent_activity: recent,
      links: {
        photos: `/api/projects/${encodeURIComponent(project.project_folder)}/photos`,
        locate_page: `/api/projects/${encodeURIComponent(project.project_folder)}/photos/locate-page`,
        jobs: `/api/projects/${encodeURIComponent(project.project_folder)}/jobs`,
      },
    });
  } catch (err) {
    log.error('project_get_failed', { error: err && err.message, stack: err && err.stack, project_folder: req.params && req.params.folder });
    res.status(500).json({ error: 'Failed to get project details' });
  }
});

// GET /api/projects/:folder/photos/locate-page - Locate a specific photo within a project and return its page
router.get('/:folder/photos/locate-page', apiRateLimit, async (req, res) => {
  try {
    // Ensure fresh pagination data
    res.set('Cache-Control', 'no-store');

    const { folder } = req.params;
    if (!isCanonicalProjectFolder(folder)) {
      return res.status(400).json({ error: 'Invalid project folder format' });
    }

    const q = req.query || {};
    const { filename, name, limit, date_from, date_to, file_type, keep_type, orientation } = q;
    const tags = typeof q.tags === 'string' && q.tags.length ? q.tags : null; // comma-separated list of tags, with optional - prefix for exclusion
    const visibility = typeof q.visibility === 'string' && q.visibility.length ? q.visibility : null;

    if (!filename && !name) {
      return res.status(400).json({ error: 'filename or name is required' });
    }

    const result = await photosRepo.locateProjectPage({
      project_folder: folder,
      filename: filename || undefined,
      name: name || undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      date_from: date_from || undefined,
      date_to: date_to || undefined,
      file_type: file_type || undefined,
      keep_type: keep_type || undefined,
      orientation: orientation || undefined,
      tags: tags || undefined,
      visibility: visibility || undefined,
    });

    const items = (result.items || []).map(r => ({
      id: r.id,
      manifest_id: r.manifest_id,
      filename: r.filename,
      basename: r.basename || undefined,
      ext: r.ext || undefined,
      created_at: r.created_at,
      updated_at: r.updated_at,
      date_time_original: r.date_time_original || undefined,
      jpg_available: !!r.jpg_available,
      raw_available: !!r.raw_available,
      other_available: !!r.other_available,
      keep_jpg: !!r.keep_jpg,
      keep_raw: !!r.keep_raw,
      thumbnail_status: r.thumbnail_status || undefined,
      preview_status: r.preview_status || undefined,
      orientation: r.orientation ?? undefined,
      metadata: r.meta_json ? JSON.parse(r.meta_json) : undefined,
      visibility: r.visibility || 'private',
    }));

    return res.json({
      items,
      position: result.position,
      page_index: result.page_index,
      limit: result.limit,
      next_cursor: result.nextCursor || null,
      prev_cursor: result.prevCursor || null,
      idx_in_items: result.idx_in_items,
      target: result.target,
      date_from: date_from || null,
      date_to: date_to || null,
    });
  } catch (err) {
    log.error('project_locate_page_failed', {
      error: err && err.message,
      code: err && err.code,
      stack: err && err.stack,
      project_folder: req.params && req.params.folder,
    });
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message || 'Photo not found or filtered out' });
    } else if (err.code === 'AMBIGUOUS') {
      return res.status(409).json({ error: err.message || 'Multiple photos match the provided name' });
    } else if (err.code === 'INVALID') {
      return res.status(400).json({ error: err.message || 'Invalid request parameters' });
    }
    return res.status(500).json({ error: 'Failed to locate photo' });
  }
});

// GET /api/projects/:folder/photos - paginated photos for a project
// Supports query: ?limit=250&cursor=0&sort=filename|date_time_original|created_at|updated_at&dir=ASC|DESC
// Also supports filtering: ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&file_type=jpg_only&keep_type=any&orientation=vertical
router.get('/:folder/photos', async (req, res) => {
  try {
    const { folder } = req.params;
    if (!isCanonicalProjectFolder(folder)) {
      return res.status(400).json({ error: 'Invalid project folder' });
    }
    
    const project = projectsRepo.getByFolder(folder);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const q = req.query;
    const limit = Math.min(300, Math.max(1, Number(q.limit) || 100));
    const cursor = q.cursor || null;
    const before_cursor = q.before_cursor || null;
    const sort = typeof q.sort === 'string' ? q.sort : 'filename';
    const dir = (typeof q.dir === 'string' && q.dir.toUpperCase() === 'DESC') ? 'DESC' : 'ASC';
    
    // Extract filter parameters (same as All Photos)
    const date_from = q.date_from || null;
    const date_to = q.date_to || null;
    const file_type = q.file_type || null;
    const keep_type = q.keep_type || null;
    const orientation = q.orientation || null;
    const includeTags = q.include === 'tags';
    const tags = typeof q.tags === 'string' && q.tags.length ? q.tags : null; // comma-separated list of tags, with optional - prefix for exclusion
    const { value: visibility, error: visibilityError } = normalizeVisibilityParam(q.visibility);
    if (visibilityError) {
      return res.status(400).json({ error: visibilityError });
    }

    const page = photosRepo.listProjectFiltered({ 
      project_id: project.id, 
      limit, 
      cursor, 
      before_cursor,
      date_from,
      date_to,
      file_type,
      keep_type,
      orientation,
      tags,
      visibility,
      sort,
      dir,
    });

    const items = (page.items || []).map(r => ({
      id: r.id,
      manifest_id: r.manifest_id,
      filename: r.filename,
      basename: r.basename || undefined,
      ext: r.ext || undefined,
      created_at: r.created_at,
      updated_at: r.updated_at,
      date_time_original: r.date_time_original || undefined,
      jpg_available: !!r.jpg_available,
      raw_available: !!r.raw_available,
      other_available: !!r.other_available,
      keep_jpg: !!r.keep_jpg,
      keep_raw: !!r.keep_raw,
      thumbnail_status: r.thumbnail_status || undefined,
      preview_status: r.preview_status || undefined,
      orientation: r.orientation ?? undefined,
      metadata: r.meta_json ? JSON.parse(r.meta_json) : undefined,
      visibility: r.visibility || 'private',
      public_hash: r.public_hash || null,
      public_hash_expires_at: r.public_hash_expires_at || null,
    }));
    
    // Optionally include tags when requested
    if (includeTags && items.length > 0) {
      try {
        // Fetch tags for all photos in the page in a single efficient query
        const photoIds = items.map(item => item.id);
        const tagsMap = photoTagsRepo.listTagsForPhotos(photoIds);
        
        // Add tags to each item
        items.forEach(item => {
          item.tags = tagsMap[item.id] || [];
        });
        
        log.debug('project_photos_tags_included', { count: photoIds.length, project_id: project.id });
      } catch (tagErr) {
        log.warn('project_photos_tags_fetch_failed', { error: tagErr?.message, project_id: project.id });
        // Continue without tags rather than failing the whole request
      }
    }

    res.json({ 
      items, 
      total: page.total, 
      unfiltered_total: page.unfiltered_total,
      next_cursor: page.nextCursor || null, 
      prev_cursor: page.prevCursor || null, 
      limit, 
      sort, 
      dir,
      date_from,
      date_to
    });
  } catch (err) {
    log.error('project_photos_paged_failed', { error: err && err.message, stack: err && err.stack, project_folder: req.params && req.params.folder });
    res.status(500).json({ error: 'Failed to get photos' });
  }
});

// DELETE /api/projects/:id - delete project
// Limit: 10 requests per 5 minutes per IP
router.delete('/:id', rateLimit({ windowMs: 5 * 60 * 1000, max: 10 }), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid project id' });
    }
    const project = projectsRepo.getById(id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Cancel related jobs before deletion
    try { 
      jobsRepo.cancelByProject(project.id); 
    } catch (e) {
      log.warn('cancel_jobs_failed', { project_id: project.id, error: e.message });
    }
    
    // Start high-priority deletion task (stop processes -> delete files -> cleanup DB)
    try {
      tasksOrchestrator.startTask({ 
        project_id: project.id, 
        type: 'project_delete', 
        source: 'user', 
        items: null, 
        tenant_id: 'user_0' 
      });
      
      log.info('project_deletion_queued', { 
        project_id: project.id, 
        project_folder: project.project_folder, 
        project_name: project.project_name 
      });
      
      res.json({ 
        message: 'Project deletion queued', 
        folder: project.project_folder 
      });
    } catch (e) {
      log.error('enqueue_project_delete_failed', { 
        project_id: project.id, 
        project_folder: project.project_folder, 
        project_name: project.project_name, 
        error: e.message, 
        stack: e.stack 
      });
      res.status(500).json({ error: 'Failed to queue project deletion' });
    }
  } catch (err) {
    log.error('project_delete_failed', { 
      error: err.message, 
      stack: err.stack, 
      project_id: req.params.id 
    });
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

module.exports = router;
