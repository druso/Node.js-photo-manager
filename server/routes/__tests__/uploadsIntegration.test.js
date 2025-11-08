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

describe('photo uploads – integration flow', { concurrency: false }, () => {
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
    const jobsRouter = loadRel('../jobs');

    app.use(requestId());
    app.use(cookieParser());
    app.use(express.json());

    app.use('/api', (req, res, next) => {
      if (req.path.startsWith('/auth/')) {
        return next();
      }
      return authenticateAdmin(req, res, next);
    });

    app.use('/api/projects', uploadsRouter);
    app.use('/api', jobsRouter);
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

  function readFixtureBuffer(fixture) {
    return fs.readFileSync(getFixturePath(fixture));
  }

  async function uploadFiles(app, project, token, files = [], fields = {}) {
    let req = request(app)
      .post(`/api/projects/${project.project_folder}/upload`)
      .set('Authorization', `Bearer ${token}`);

    for (const [key, value] of Object.entries(fields)) {
      req = req.field(key, value);
    }

    for (const file of files) {
      req = req.attach('photos', file.buffer, {
        filename: file.filename,
        contentType: file.contentType,
      });
    }

    return req;
  }

  test('analyze → upload → process flow enqueues jobs and emits SSE-style updates when worker runs', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const project = createProject('Integration Flow');
      const token = issueToken();

      const analyzeInitial = await request(app)
        .post(`/api/projects/${project.project_folder}/analyze-files`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          files: [
            { name: 'DSC02215.JPG', type: 'image/jpeg' },
          ],
        });

      assert.equal(analyzeInitial.status, 200);
      assert.equal(analyzeInitial.body?.success, true);
      assert.equal(analyzeInitial.body?.imageGroups?.DSC02215?.isNew, true);
      assert.equal(analyzeInitial.body?.summary?.conflictImages, 0);

      const jpgBuffer = readFixtureBuffer(TEST_FIXTURES.PORTRAIT_JPG);
      const uploadRes = await uploadFiles(app, project, token, [
        { buffer: jpgBuffer, filename: 'DSC02215.JPG', contentType: 'image/jpeg' },
      ]);

      assert.equal(uploadRes.status, 201);
      assert.equal(uploadRes.body?.files?.[0]?.filename, 'DSC02215.JPG');

      const jobsRepo = loadRel('../../services/repositories/jobsRepo');
      const uploadJob = jobsRepo.claimNext({ workerId: 'integration-worker' });
      assert.ok(uploadJob, 'expected upload_postprocess job to be queued');
      assert.equal(uploadJob.type, 'upload_postprocess');

      const tasksOrchestrator = require('../../services/tasksOrchestrator');
      const originalOnJobCompleted = tasksOrchestrator.onJobCompleted;
      tasksOrchestrator.onJobCompleted = () => {};

      const { onJobUpdate } = require('../../services/events');
      const updates = [];
      const unsubscribe = onJobUpdate((payload) => {
        updates.push(payload);
      });

      const derivativesWorker = loadRel('../../services/workers/derivativesWorker');
      try {
        await derivativesWorker.runGenerateDerivatives({ job: uploadJob });
        jobsRepo.complete(uploadJob.id);
      } finally {
        unsubscribe();
        tasksOrchestrator.onJobCompleted = originalOnJobCompleted;
      }

      const analyzeAfterUpload = await request(app)
        .post(`/api/projects/${project.project_folder}/analyze-files`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          files: [
            { name: 'DSC02215.JPG', type: 'image/jpeg' },
          ],
        });

      assert.equal(analyzeAfterUpload.status, 200);
      assert.equal(analyzeAfterUpload.body?.success, true);
      assert.equal(analyzeAfterUpload.body?.imageGroups?.DSC02215?.hasConflict, true);
      assert.equal(analyzeAfterUpload.body?.imageGroups?.DSC02215?.conflictType, 'duplicate');

      const processRes = await request(app)
        .post(`/api/projects/${project.project_folder}/process`)
        .set('Authorization', `Bearer ${token}`)
        .send({ filenames: ['DSC02215'] });

      assert.equal(processRes.status, 202);
      const enqueuedJob = processRes.body?.job;
      assert.equal(enqueuedJob?.type, 'generate_derivatives');
      assert.equal(enqueuedJob?.project_id, project.id);

      const processJob = jobsRepo.claimNext({ workerId: 'integration-worker' });
      assert.ok(processJob, 'expected a queued job to process');
      assert.equal(processJob.type, 'generate_derivatives');

      jobsRepo.cancel(processJob.id);

      assert.ok(updates.some((evt) => evt && evt.id === uploadJob.id && evt.status === 'running'), 'expected progress events for job');
      assert.ok(updates.some((evt) => evt && evt.type === 'item' && evt.project_folder === project.project_folder && evt.filename === 'DSC02215'), 'expected item-level SSE update');

      const projectPath = getProjectPath(project.project_folder);
      assert.ok(fs.existsSync(path.join(projectPath, '.thumb', 'DSC02215.jpg')), 'thumbnail derivative should exist');
      assert.ok(fs.existsSync(path.join(projectPath, '.preview', 'DSC02215.jpg')), 'preview derivative should exist');
    });
  });

  test('upload without multipart file parts returns 400 and does not enqueue jobs', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const project = createProject('Integration Errors');
      const token = issueToken();
      const jobsRepo = loadRel('../../services/repositories/jobsRepo');

      const res = await uploadFiles(app, project, token, [], { someField: 'value' });

      assert.equal(res.status, 400);
      assert.match(String(res.body?.error || ''), /No files uploaded/i);

      const jobs = jobsRepo.listByProject(project.id, {});
      assert.equal(Array.isArray(jobs) ? jobs.length : 0, 0, 'no jobs should be queued');
    });
  });

  test('concurrent uploads to same project persist both photos and metadata', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const project = createProject('Integration Concurrency');
      const token = issueToken();
      const photosRepo = loadRel('../../services/repositories/photosRepo');

      const firstBuffer = readFixtureBuffer(TEST_FIXTURES.PORTRAIT_JPG);
      const secondBuffer = readFixtureBuffer(TEST_FIXTURES.LANDSCAPE_JPG);

      const [firstRes, secondRes] = await Promise.all([
        uploadFiles(app, project, token, [
          { buffer: firstBuffer, filename: 'DSC02215.JPG', contentType: 'image/jpeg' },
        ]),
        uploadFiles(app, project, token, [
          { buffer: secondBuffer, filename: 'DSC03890.JPG', contentType: 'image/jpeg' },
        ]),
      ]);

      assert.equal(firstRes.status, 201);
      assert.equal(secondRes.status, 201);

      const photoOne = photosRepo.getByProjectAndFilename(project.id, 'DSC02215');
      const photoTwo = photosRepo.getByProjectAndFilename(project.id, 'DSC03890');
      assert.ok(photoOne, 'first photo should be recorded');
      assert.ok(photoTwo, 'second photo should be recorded');
      assert.equal(photoOne.jpg_available, 1);
      assert.equal(photoTwo.jpg_available, 1);

      const projectPath = getProjectPath(project.project_folder);
      assert.ok(fs.existsSync(path.join(projectPath, 'DSC02215.JPG')));
      assert.ok(fs.existsSync(path.join(projectPath, 'DSC03890.JPG')));
    });
  });
});
