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
const { getProjectPath } = require('../../services/fsUtils');
const { TEST_FIXTURES, getFixturePath } = require('../../tests/utils/testFixtures');

function loadRel(modulePath) {
  return loadFresh(path.join(__dirname, modulePath));
}

describe('photo uploads – basic scenarios', { concurrency: false }, () => {
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
    const uploadsRouter = loadRel('../uploads');

    app.use(requestId());
    app.use(cookieParser());

    app.use('/api', (req, res, next) => {
      if (req.path.startsWith('/auth/')) {
        return next();
      }
      return authenticateAdmin(req, res, next);
    });

    app.use('/api/projects', uploadsRouter);
    return app;
  }

  function createProject(name) {
    const projectsRepo = loadRel('../../services/repositories/projectsRepo');
    const project = projectsRepo.createProject({ project_name: `${name} ${Date.now()}` });
    fixtures.registerProject(project);
    return project;
  }

  function issueToken() {
    return tokenService.issueAccessToken({ sub: 'admin-test' });
  }

  function readFixture(fixture) {
    return fs.readFileSync(getFixturePath(fixture));
  }

  test('upload new JPG creates photo record and enqueues post-process task', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const project = createProject('Upload JPG');
      const token = issueToken();
      const tasksOrchestrator = require('../../services/tasksOrchestrator');
      const originalStartTask = tasksOrchestrator.startTask;
      const capturedTasks = [];
      tasksOrchestrator.startTask = (options) => {
        capturedTasks.push(options);
        return { task_id: 'stub', type: options?.type };
      };

      try {
        const jpgBuffer = readFixture(TEST_FIXTURES.PORTRAIT_JPG);
        const res = await request(app)
          .post(`/api/projects/${project.project_folder}/upload`)
          .set('Authorization', `Bearer ${token}`)
          .attach('photos', jpgBuffer, { filename: 'DSC02215.JPG', contentType: 'image/jpeg' });

        assert.equal(res.status, 201);
        assert.equal(res.body?.files?.length, 1);
        assert.equal(res.body.files[0].filename, 'DSC02215.JPG');

        const photosRepo = loadRel('../../services/repositories/photosRepo');
        const photo = photosRepo.getByProjectAndFilename(project.id, 'DSC02215');
        assert.ok(photo, 'photo record should exist');
        assert.equal(photo.jpg_available, 1);
        assert.equal(photo.raw_available, 0);
        assert.equal(photo.keep_jpg, 1);
        const projectPath = getProjectPath(project.project_folder);
        assert.ok(fs.existsSync(path.join(projectPath, 'DSC02215.JPG')));

        assert.ok(capturedTasks.some(t => t && t.type === 'upload_postprocess'), 'upload_postprocess task should be scheduled');
      } finally {
        tasksOrchestrator.startTask = originalStartTask;
      }
    });
  });

  test('upload paired RAW + JPG creates single photo with both formats', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const project = createProject('Upload Pair');
      const token = issueToken();

      const jpgBuffer = readFixture(TEST_FIXTURES.PORTRAIT_JPG);
      const rawBuffer = readFixture(TEST_FIXTURES.PORTRAIT_RAW);

      const res = await request(app)
        .post(`/api/projects/${project.project_folder}/upload`)
        .set('Authorization', `Bearer ${token}`)
        .attach('photos', jpgBuffer, { filename: 'DSC02215.JPG', contentType: 'image/jpeg' })
        .attach('photos', rawBuffer, { filename: 'DSC02215.ARW', contentType: 'image/x-sony-arw' });

      assert.equal(res.status, 201);
      assert.equal(res.body?.files?.length, 2);

      const photosRepo = loadRel('../../services/repositories/photosRepo');
      const photo = photosRepo.getByProjectAndFilename(project.id, 'DSC02215');
      assert.ok(photo, 'photo record should exist');
      assert.equal(photo.jpg_available, 1);
      assert.equal(photo.raw_available, 1);
      assert.equal(photo.keep_jpg, 1);
      assert.equal(photo.keep_raw, 1);

      const projectPath = getProjectPath(project.project_folder);
      assert.ok(fs.existsSync(path.join(projectPath, 'DSC02215.JPG')));
      assert.ok(fs.existsSync(path.join(projectPath, 'DSC02215.ARW')));
    });
  });

  test('upload extracts EXIF metadata for JPG uploads', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const project = createProject('Upload EXIF');
      const token = issueToken();

      const jpgBuffer = readFixture(TEST_FIXTURES.PORTRAIT_JPG);
      const res = await request(app)
        .post(`/api/projects/${project.project_folder}/upload`)
        .set('Authorization', `Bearer ${token}`)
        .attach('photos', jpgBuffer, { filename: 'DSC02215.JPG', contentType: 'image/jpeg' });

      assert.equal(res.status, 201);

      const photosRepo = loadRel('../../services/repositories/photosRepo');
      const photo = photosRepo.getByProjectAndFilename(project.id, 'DSC02215');
      assert.ok(photo, 'photo record should exist');
      assert.ok(photo.date_time_original, 'date_time_original should be captured');
      assert.ok(photo.meta_json, 'meta_json should be populated');
      const metadata = JSON.parse(photo.meta_json);
      assert.ok(metadata.camera_model || metadata.Model, 'metadata should include camera model');
      assert.notEqual(photo.thumbnail_status, null);
      assert.notEqual(photo.preview_status, null);
    });
  });

  test('upload rejects invalid file types', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const project = createProject('Upload Invalid Type');
      const token = issueToken();

      const res = await request(app)
        .post(`/api/projects/${project.project_folder}/upload`)
        .set('Authorization', `Bearer ${token}`)
        .attach('photos', Buffer.from('not-an-image'), { filename: 'note.txt', contentType: 'text/plain' });

      assert.equal(res.status, 400);
      assert.match(String(res.body?.error || ''), /only accepted image files/i);

      const photosRepo = loadRel('../../services/repositories/photosRepo');
      const photo = photosRepo.getByProjectAndFilename(project.id, 'note');
      assert.equal(photo, undefined, 'no photo record should be created');
    });
  });

  test('upload enforces file size limits', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const project = createProject('Upload Large File');
      const token = issueToken();

      const oversized = Buffer.alloc(101 * 1024 * 1024, 0x41);

      const res = await request(app)
        .post(`/api/projects/${project.project_folder}/upload`)
        .set('Authorization', `Bearer ${token}`)
        .attach('photos', oversized, { filename: 'huge.jpg', contentType: 'image/jpeg' });

      assert.equal(res.status, 400);
      assert.match(String(res.body?.error || ''), /file too large/i);

      const photosRepo = loadRel('../../services/repositories/photosRepo');
      const photo = photosRepo.getByProjectAndFilename(project.id, 'huge');
      assert.equal(photo, undefined, 'no photo record should be created for oversized file');
    });
  });
});
