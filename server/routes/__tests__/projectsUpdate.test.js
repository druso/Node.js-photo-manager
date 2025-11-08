const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const path = require('node:path');

const { withAuthEnv, loadFresh } = require('../../services/auth/__tests__/testUtils');
const tokenService = require('../../services/auth/tokenService');
const { createFixtureTracker } = require('../../tests/utils/dataFixtures');

function loadRel(modulePath) {
  return loadFresh(path.join(__dirname, modulePath));
}

describe('Project Updates', { concurrency: false }, () => {
  let fixtures;

  beforeEach(() => {
    fixtures = createFixtureTracker();
  });

  afterEach(() => {
    fixtures.cleanup();
  });

  function createTestApp() {
    const app = express();
    const requestId = loadRel('../../middleware/requestId');
    const authenticateAdmin = loadRel('../../middleware/authenticateAdmin');
    const projectsRouter = loadRel('../projects');

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
    return app;
  }

  function issueToken() {
    return tokenService.issueAccessToken({ sub: 'admin-test' });
  }

  function createProject(name = 'Update Project') {
    const projectsRepo = loadRel('../../services/repositories/projectsRepo');
    const project = projectsRepo.createProject({ project_name: name });
    fixtures.registerProject(project);
    return project;
  }

  function readManifest(folder) {
    const { readManifest } = loadRel('../../services/projectManifest');
    return readManifest(folder);
  }

  test('renames project display name and manifest while keeping folder stable', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const project = createProject('Original Name');

      const res = await request(app)
        .patch(`/api/projects/${encodeURIComponent(project.project_folder)}/rename`)
        .set('Authorization', `Bearer ${token}`)
        .send({ new_name: 'New Display Name' });

      assert.equal(res.status, 200);
      assert.match(res.body.message, /updated successfully/i);
      assert.equal(res.body.project.name, 'New Display Name');
      assert.equal(res.body.project.folder, project.project_folder);

      const projectsRepo = loadRel('../../services/repositories/projectsRepo');
      const stored = projectsRepo.getByFolder(project.project_folder);
      assert.equal(stored.project_name, 'New Display Name');
      assert.equal(stored.project_folder, project.project_folder);

      const manifest = readManifest(project.project_folder);
      assert.ok(manifest, 'manifest exists');
      assert.equal(manifest.name, 'New Display Name');
      assert.equal(manifest.id, project.id);
    });
  });

  test('requires new_name field', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const project = createProject('Needs Name');

      const res = await request(app)
        .patch(`/api/projects/${encodeURIComponent(project.project_folder)}/rename`)
        .set('Authorization', `Bearer ${token}`)
        .send({ new_name: '' });

      assert.equal(res.status, 400);
      assert.match(res.body.error, /required/i);
    });
  });

  test('cannot rename canceled projects', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const project = createProject('Canceled Project');

      const projectsRepo = loadRel('../../services/repositories/projectsRepo');
      projectsRepo.archive(project.id);

      const res = await request(app)
        .patch(`/api/projects/${encodeURIComponent(project.project_folder)}/rename`)
        .set('Authorization', `Bearer ${token}`)
        .send({ new_name: 'Attempted Rename' });

      assert.equal(res.status, 404);
      assert.match(res.body.error, /not found/i);
    });
  });

  test('requires authentication for rename', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const project = createProject('Auth Required');

      const res = await request(app)
        .patch(`/api/projects/${encodeURIComponent(project.project_folder)}/rename`)
        .send({ new_name: 'No Auth' });

      assert.equal(res.status, 401);
    });
  });
});
