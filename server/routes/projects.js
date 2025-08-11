const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const router = express.Router();

// DB repositories
const projectsRepo = require('../services/repositories/projectsRepo');
const photosRepo = require('../services/repositories/photosRepo');

// Resolve project directories relative to project root
// __dirname => <projectRoot>/server/routes
// project root => path.join(__dirname, '..', '..')
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');

// Ensure base directories exist when router loads
fs.ensureDirSync(PROJECTS_DIR);

// Helpers
function sanitizeFolderName(name) {
  return name.replace(/[^a-zA-Z0-9\s-_]/g, '').replace(/\s+/g, '_');
}

async function ensureProjectDirs(folderName) {
  const projectPath = path.join(PROJECTS_DIR, folderName);
  await fs.ensureDir(projectPath);
  await fs.ensureDir(path.join(projectPath, '.thumb'));
  await fs.ensureDir(path.join(projectPath, '.preview'));
  return projectPath;
}

// GET /api/projects - list projects
router.get('/', async (req, res) => {
  try {
    const rows = projectsRepo.list();
    const projects = rows.map(p => ({
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

// POST /api/projects - create project
router.post('/', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const folderName = sanitizeFolderName(name);
    const existing = projectsRepo.getByFolder(folderName);
    if (existing) {
      return res.status(400).json({ error: 'Project already exists' });
    }

    await ensureProjectDirs(folderName);

    const created = projectsRepo.createProject({ project_folder: folderName, project_name: name, schema_version: '1' });

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
    const project = projectsRepo.getByFolder(folder);
    if (!project) {
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
router.delete('/:folder', async (req, res) => {
  try {
    const { folder } = req.params;
    const project = projectsRepo.getByFolder(folder);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    // Remove from DB (photos cascade)
    projectsRepo.remove(project.id);
    // Remove folder from disk
    const projectPath = path.join(PROJECTS_DIR, folder);
    if (await fs.pathExists(projectPath)) {
      await fs.remove(projectPath);
    }
    res.json({ message: 'Project deleted successfully', folder });
  } catch (err) {
    console.error('Projects router: delete failed', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

module.exports = router;
