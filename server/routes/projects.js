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
const tasksOrchestrator = require('../services/tasksOrchestrator');
const { isCanonicalProjectFolder } = require('../utils/projects');
const { rateLimit } = require('../utils/rateLimit');
const { getConfig } = require('../services/config');

// Resolve project directories relative to project root
// __dirname => <projectRoot>/server/routes
// project root => path.join(__dirname, '..', '..')
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');

// Ensure base directories exist when router loads
fs.ensureDirSync(PROJECTS_DIR);

async function ensureProjectDirs(folderName) {
  const projectPath = path.join(PROJECTS_DIR, folderName);
  await fs.ensureDir(projectPath);
  await fs.ensureDir(path.join(projectPath, '.thumb'));
  await fs.ensureDir(path.join(projectPath, '.preview'));
  await fs.ensureDir(path.join(projectPath, '.trash'));
  return projectPath;
}

// Apply rate limiting (60 requests per minute per IP) for locate endpoints
const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many requests, please try again later.'
});

// GET /api/projects - list projects
router.get('/', async (req, res) => {
  try {
    const rows = projectsRepo.list();
    // Hide canceled projects from UI lists
    const projects = rows.filter(p => p.status !== 'canceled').map(p => ({
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

// PATCH /api/projects/:id - rename display name only
// Limit: 10 requests per 5 minutes per IP
router.patch('/:id', rateLimit({ windowMs: 5 * 60 * 1000, max: 10 }), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid project id' });
    }
    const { name } = req.body || {};
    if (!name || String(name).trim() === '') {
      return res.status(400).json({ error: 'Project name is required' });
    }
    const existing = projectsRepo.getById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const updated = projectsRepo.updateName(id, String(name));
    return res.json({
      message: 'Project renamed successfully',
      project: {
        name: updated.project_name,
        folder: updated.project_folder,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
      }
    });
  } catch (err) {
    log.error('project_rename_failed', { error: err && err.message, stack: err && err.stack, project_id: req.params && req.params.id });
    res.status(500).json({ error: 'Failed to rename project' });
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
    if (project.status === 'canceled') {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Map photos rows to legacy manifest-like shape expected by client
    const page = photosRepo.listPaged({ project_id: project.id, limit: 100000, sort: 'filename', dir: 'ASC', cursor: null });
    const photos = (page.items || []).map(r => ({
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
    }));

    const projectData = {
      id: project.id,
      project_name: project.project_name,
      project_folder: project.project_folder,
      created_at: project.created_at,
      updated_at: project.updated_at,
      photos,
    };

    res.json(projectData);
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
      tags
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
      nextCursor: page.nextCursor, 
      prevCursor: page.prevCursor || null, 
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

// DELETE /api/projects/:folder - delete project
// Limit: 10 requests per 5 minutes per IP
router.delete('/:folder', rateLimit({ windowMs: 5 * 60 * 1000, max: 10 }), async (req, res) => {
  try {
    const { folder } = req.params;
    if (!isCanonicalProjectFolder(folder)) {
      return res.status(400).json({ error: 'Invalid project folder format' });
    }
    const project = projectsRepo.getByFolder(folder);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    // Soft-delete: mark as canceled (archived), cancel related jobs, enqueue deletion task
    try { projectsRepo.archive(project.id); } catch {}
    try { jobsRepo.cancelByProject(project.id); } catch {}
    // Start high-priority deletion task (stop processes -> delete files -> cleanup DB)
    try {
      tasksOrchestrator.startTask({ project_id: project.id, type: 'project_delete', source: 'user', items: null, tenant_id: 'user_0' });
    } catch (e) {
      // If orchestration fails, still return archived so UI removes project; background cleanup might be missing.
      log.error('enqueue_project_delete_failed', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name, error: e && e.message, stack: e && e.stack });
    }
    res.json({ message: 'Project deletion queued', folder });
  } catch (err) {
    log.error('project_delete_failed', { error: err && err.message, stack: err && err.stack, project_folder: req.params && req.params.folder });
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

module.exports = router;
