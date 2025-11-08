const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const path = require('node:path');
const fs = require('fs-extra');

const { withAuthEnv, loadFresh } = require('../../services/auth/__tests__/testUtils');
const tokenService = require('../../services/auth/tokenService');
const { createFixtureTracker } = require('../../tests/utils/dataFixtures');

function loadRel(modulePath) {
  return loadFresh(path.join(__dirname, modulePath));
}

describe('Project Creation', { concurrency: false }, () => {
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

  function getProjectPath(folder) {
    const fsUtils = loadRel('../../services/fsUtils');
    return fsUtils.getProjectPath(folder);
  }

  function readManifest(folder) {
    const { readManifest } = loadRel('../../services/projectManifest');
    return readManifest(folder);
  }

  test('creates project with unique folder and manifest', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();

      const res = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Test Project Alpha' });

      assert.equal(res.status, 200);
      assert.equal(res.body.message, 'Project created successfully');
      const project = res.body.project;
      assert.equal(project.name, 'Test Project Alpha');
      assert.ok(project.folder);

      const projectsRepo = loadRel('../../services/repositories/projectsRepo');
      const stored = projectsRepo.getByFolder(project.folder);
      fixtures.registerProject(stored);

      assert.ok(stored, 'project persisted in repository');
      assert.equal(stored.project_name, 'Test Project Alpha');

      const projectPath = getProjectPath(project.folder);
      assert.ok(fs.existsSync(projectPath), 'project directory created');
      assert.ok(fs.existsSync(path.join(projectPath, '.project.yaml')), 'project manifest written');

      const manifest = readManifest(project.folder);
      assert.ok(manifest, 'manifest readable');
      assert.equal(manifest.name, 'Test Project Alpha');
      assert.equal(manifest.id, stored.id);
    });
  });

  test('duplicate project names receive suffixed folder names', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();

      const first = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Wedding Shoot' });
      assert.equal(first.status, 200);
      const firstFolder = first.body.project.folder;
      const projectsRepo = loadRel('../../services/repositories/projectsRepo');
      const firstStored = projectsRepo.getByFolder(firstFolder);
      fixtures.registerProject(firstStored);

      const second = await request(app)
        .post('/api/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Wedding Shoot' });
      assert.equal(second.status, 200);
      const secondFolder = second.body.project.folder;
      const secondStored = projectsRepo.getByFolder(secondFolder);
      fixtures.registerProject(secondStored);

      assert.notEqual(secondFolder, firstFolder);
      assert.match(secondFolder, /\(2\)$/);
      assert.ok(fs.existsSync(getProjectPath(secondFolder)), 'second project directory created');
    });
  });

  test('requires authentication', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();

      const res = await request(app)
        .post('/api/projects')
        .send({ name: 'Unauthorized Project' });

      assert.equal(res.status, 401);
    });
  });
});
