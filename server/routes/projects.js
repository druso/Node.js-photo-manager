const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const router = express.Router();

// DB repositories
const projectsRepo = require('../services/repositories/projectsRepo');
const photosRepo = require('../services/repositories/photosRepo');
const jobsRepo = require('../services/repositories/jobsRepo');
const tasksOrchestrator = require('../services/tasksOrchestrator');
const { isCanonicalProjectFolder } = require('../utils/projects');
const { rateLimit } = require('../utils/rateLimit');

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
    console.error('Projects router: list failed', err);
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
    console.error('Projects router: rename failed', err);
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

    // Fresh-start creation: derive folder as <slug(name)>--p<id> in repo layer
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
    console.error('Projects router: create failed', err);
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
    console.error('Projects router: get details failed', err);
    res.status(500).json({ error: 'Failed to get project details' });
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
      console.error('Failed to enqueue project_delete task:', e);
    }
    res.json({ message: 'Project deletion queued', folder });
  } catch (err) {
    console.error('Projects router: delete failed', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

module.exports = router;
