const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const path = require('node:path');
const fs = require('fs-extra');

const { withAuthEnv, loadFresh } = require('../../services/auth/__tests__/testUtils');
const { getDb } = require('../../services/db');
const tokenService = require('../../services/auth/tokenService');
const { ensureProjectDirs } = require('../../services/fsUtils');
const { createFixtureTracker } = require('../../tests/utils/dataFixtures');

let fixtures;

function loadRel(modulePath) {
  return loadFresh(path.join(__dirname, modulePath));
}

function createTestApp() {
  const app = express();
  const requestId = loadRel('../../middleware/requestId');
  const authenticateAdmin = loadRel('../../middleware/authenticateAdmin');
  const projectsRouter = loadRel('../projects');
  const photosRouter = loadRel('../photos');

  app.use(requestId());
  app.use(cookieParser());
  app.use(express.json());

  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/')) {
      return next();
    }
    return authenticateAdmin(req, res, next);
  });

  app.use('/api/projects', projectsRouter);
  app.use('/api', photosRouter);

  return app;
}

function seedProject() {
  const db = getDb();
  const ts = new Date().toISOString();
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const projectFolder = `pvis_filter_${unique}`;
  const projectName = `Visibility List ${projectFolder}`;

  const info = db.prepare(`
    INSERT INTO projects (project_folder, project_name, created_at, updated_at, schema_version, status, archived_at)
    VALUES (?, ?, ?, ?, NULL, NULL, NULL)
  `).run(projectFolder, projectName, ts, ts);
  const projectId = info.lastInsertRowid;

  fixtures.registerProject({ id: projectId, project_folder: projectFolder });
  ensureProjectDirs(projectFolder);

  return { projectFolder, projectId };
}

describe('visibility filter validation', { concurrency: false }, () => {
  beforeEach(() => {
    fixtures = createFixtureTracker();
  });

  afterEach(() => {
    fixtures.cleanup();
  });

  test('GET /api/photos rejects invalid visibility value', async () => {
    await withAuthEnv({}, async () => {
      seedProject();
      const app = createTestApp();
      const token = tokenService.issueAccessToken({ sub: 'admin-test' });
      const res = await request(app)
        .get('/api/photos?visibility=invalid')
        .set('Authorization', `Bearer ${token}`);
      assert.equal(res.status, 400);
      assert.equal(res.body?.error, 'visibility must be "public" or "private"');
    });
  });

  test('GET /api/projects/:folder/photos rejects invalid visibility value', async () => {
    await withAuthEnv({}, async () => {
      const { projectFolder } = seedProject();
      const app = createTestApp();
      const token = tokenService.issueAccessToken({ sub: 'admin-test' });
      const res = await request(app)
        .get(`/api/projects/${projectFolder}/photos?visibility=invalid`)
        .set('Authorization', `Bearer ${token}`);
      assert.equal(res.status, 400);
      assert.equal(res.body?.error, 'visibility must be "public" or "private"');
    });
  });
});
