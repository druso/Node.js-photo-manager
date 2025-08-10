const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const router = express.Router();

// Services
const {
  createManifest,
  loadManifest,
  saveManifest
} = require('../services/manifest');

// Resolve project directories relative to project root
// __dirname => <projectRoot>/server/routes
// project root => path.join(__dirname, '..', '..')
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');

// Ensure base directories exist when router loads
fs.ensureDirSync(PROJECTS_DIR);

// GET /api/projects - list projects
router.get('/', async (req, res) => {
  try {
    const projects = [];
    const projectDirs = await fs.readdir(PROJECTS_DIR);

    for (const dir of projectDirs) {
      const projectPath = path.join(PROJECTS_DIR, dir);
      const stat = await fs.stat(projectPath);
      if (!stat.isDirectory()) continue;

      const manifest = await loadManifest(projectPath);
      if (manifest) {
        projects.push({
          name: manifest.project_name,
          folder: dir,
          created_at: manifest.created_at,
          updated_at: manifest.updated_at,
          photo_count: (manifest.entries || []).length
        });
      }
    }

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

    const folderName = name.replace(/[^a-zA-Z0-9\s-_]/g, '').replace(/\s+/g, '_');
    const projectPath = path.join(PROJECTS_DIR, folderName);

    if (await fs.pathExists(projectPath)) {
      return res.status(400).json({ error: 'Project already exists' });
    }

    await fs.ensureDir(projectPath);
    await fs.ensureDir(path.join(projectPath, '.thumb'));
    await fs.ensureDir(path.join(projectPath, '.preview'));

    const manifest = createManifest(name);
    await saveManifest(projectPath, manifest);

    res.json({
      message: 'Project created successfully',
      project: {
        name: manifest.project_name,
        folder: folderName,
        created_at: manifest.created_at,
        updated_at: manifest.updated_at,
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
    const projectPath = path.join(PROJECTS_DIR, folder);

    if (!await fs.pathExists(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const manifest = await loadManifest(projectPath);
    if (!manifest) {
      return res.status(404).json({ error: 'Project manifest not found' });
    }

    const projectData = {
      ...manifest,
      photos: manifest.entries || []
    };
    delete projectData.entries;

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
    const projectPath = path.join(PROJECTS_DIR, folder);

    if (!await fs.pathExists(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    await fs.remove(projectPath);
    res.json({ message: 'Project deleted successfully', folder });
  } catch (err) {
    console.error('Projects router: delete failed', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

module.exports = router;
