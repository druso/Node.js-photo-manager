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

describe('photo uploads – conflict handling', { concurrency: false }, () => {
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
    app.use(express.json());

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

  test('re-uploading same JPG overwrites existing photo within the project', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const project = createProject('Conflict Duplicate');
      const token = issueToken();
      const photosRepo = loadRel('../../services/repositories/photosRepo');

      const firstBuffer = readFixtureBuffer(TEST_FIXTURES.PORTRAIT_JPG);
      const firstUpload = await uploadFiles(app, project, token, [
        { buffer: firstBuffer, filename: 'DSC02215.JPG', contentType: 'image/jpeg' },
      ]);
      assert.equal(firstUpload.status, 201);

      const initialPhoto = photosRepo.getByProjectAndFilename(project.id, 'DSC02215');
      assert.ok(initialPhoto, 'photo should exist after first upload');
      const initialUpdatedAt = initialPhoto.updated_at;

      const overwriteBuffer = Buffer.concat([firstBuffer, Buffer.from('overwrite-proof', 'utf8')]);
      const secondUpload = await uploadFiles(
        app,
        project,
        token,
        [{ buffer: overwriteBuffer, filename: 'DSC02215.JPG', contentType: 'image/jpeg' }],
        { overwriteInThisProject: 'false' }
      );

      assert.equal(secondUpload.status, 201);
      assert.equal(secondUpload.body?.files?.length, 1);
      assert.equal(secondUpload.body.files[0].filename, 'DSC02215.JPG');
      assert.equal(secondUpload.body?.flags?.overwriteInThisProject, false);

      const projectPath = getProjectPath(project.project_folder);
      const stored = fs.readFileSync(path.join(projectPath, 'DSC02215.JPG'));
      assert.ok(stored.equals(overwriteBuffer), 'stored file should match latest upload buffer');

      const updatedPhoto = photosRepo.getByProjectAndFilename(project.id, 'DSC02215');
      assert.ok(updatedPhoto, 'photo record should still exist');
      assert.ok(updatedPhoto.updated_at > initialUpdatedAt, 'photo updated_at should advance after overwrite');
      assert.equal(updatedPhoto.jpg_available, 1);
      assert.equal(updatedPhoto.raw_available, 0);
    });
  });

  test('reloadConflictsIntoThisProject schedules image_move task and returns 202 for move-only requests', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const sourceProject = createProject('Conflict Source');
      const targetProject = createProject('Conflict Target');
      const token = issueToken();
      const photosRepo = loadRel('../../services/repositories/photosRepo');
      const tasksOrchestrator = require('../../services/tasksOrchestrator');
      const originalStartTask = tasksOrchestrator.startTask;
      const capturedTasks = [];
      tasksOrchestrator.startTask = (options) => {
        capturedTasks.push(options);
        return { task_id: 'stub', type: options?.type };
      };

      try {
        const jpgBuffer = readFixtureBuffer(TEST_FIXTURES.PORTRAIT_JPG);
        const initialUpload = await uploadFiles(app, sourceProject, token, [
          { buffer: jpgBuffer, filename: 'DSC02215.JPG', contentType: 'image/jpeg' },
        ]);
        assert.equal(initialUpload.status, 201);

        const moveResponse = await uploadFiles(
          app,
          targetProject,
          token,
          [],
          {
            reloadConflictsIntoThisProject: 'true',
            conflictItems: JSON.stringify(['DSC02215']),
          }
        );

        assert.equal(moveResponse.status, 202);
        assert.ok(Array.isArray(moveResponse.body.files));
        assert.equal(moveResponse.body.files.length, 0);
        assert.equal(moveResponse.body?.flags?.reloadConflictsIntoThisProject, true);
        assert.match(moveResponse.body?.message || '', /Scheduled consolidation/i);

        const moveTask = capturedTasks.find((t) => t?.type === 'image_move');
        assert.ok(moveTask, 'image_move task should be enqueued');
        assert.equal(moveTask.project_id, targetProject.id);
        assert.deepEqual(moveTask.items, ['DSC02215']);

        const sourcePhoto = photosRepo.getByProjectAndFilename(sourceProject.id, 'DSC02215');
        assert.ok(sourcePhoto, 'source project retains original photo');

        const targetPhoto = photosRepo.getByProjectAndFilename(targetProject.id, 'DSC02215');
        assert.equal(targetPhoto, undefined, 'target project should not ingest file immediately');

        const targetPath = getProjectPath(targetProject.project_folder);
        assert.equal(fs.existsSync(path.join(targetPath, 'DSC02215.JPG')), false);
      } finally {
        tasksOrchestrator.startTask = originalStartTask;
      }
    });
  });

  test('cross-project duplicate without reload is rejected and leaves original untouched', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const sourceProject = createProject('Conflict Source Reject');
      const targetProject = createProject('Conflict Target Reject');
      const token = issueToken();
      const photosRepo = loadRel('../../services/repositories/photosRepo');

      const jpgBuffer = readFixtureBuffer(TEST_FIXTURES.PORTRAIT_JPG);
      const initialUpload = await uploadFiles(app, sourceProject, token, [
        { buffer: jpgBuffer, filename: 'DSC02215.JPG', contentType: 'image/jpeg' },
      ]);
      assert.equal(initialUpload.status, 201);

      const duplicateAttempt = await uploadFiles(app, targetProject, token, [
        { buffer: jpgBuffer, filename: 'DSC02215.JPG', contentType: 'image/jpeg' },
      ]);

      assert.equal(duplicateAttempt.status, 400);
      assert.ok(Array.isArray(duplicateAttempt.body?.perFileErrors));
      assert.match(duplicateAttempt.body.perFileErrors[0]?.error || '', /another project/i);

      const sourcePhoto = photosRepo.getByProjectAndFilename(sourceProject.id, 'DSC02215');
      assert.ok(sourcePhoto, 'source project photo should remain');

      const targetPhoto = photosRepo.getByProjectAndFilename(targetProject.id, 'DSC02215');
      assert.equal(targetPhoto, undefined, 'target project should not create conflicting photo');

      const targetPath = getProjectPath(targetProject.project_folder);
      assert.equal(fs.existsSync(path.join(targetPath, 'DSC02215.JPG')), false);
    });
  });

  test('uploading RAW after JPG completes existing photo record', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const project = createProject('Conflict Completion');
      const token = issueToken();
      const photosRepo = loadRel('../../services/repositories/photosRepo');

      const jpgBuffer = readFixtureBuffer(TEST_FIXTURES.PORTRAIT_JPG);
      const rawBuffer = readFixtureBuffer(TEST_FIXTURES.PORTRAIT_RAW);

      const jpgUpload = await uploadFiles(app, project, token, [
        { buffer: jpgBuffer, filename: 'DSC02215.JPG', contentType: 'image/jpeg' },
      ]);
      assert.equal(jpgUpload.status, 201);

      const photoAfterJpg = photosRepo.getByProjectAndFilename(project.id, 'DSC02215');
      assert.ok(photoAfterJpg);
      assert.equal(photoAfterJpg.jpg_available, 1);
      assert.equal(photoAfterJpg.raw_available, 0);

      const rawUpload = await uploadFiles(app, project, token, [
        { buffer: rawBuffer, filename: 'DSC02215.ARW', contentType: 'image/x-sony-arw' },
      ]);
      assert.equal(rawUpload.status, 201);
      assert.equal(rawUpload.body?.files?.length, 1);
      assert.equal(rawUpload.body.files[0].filename, 'DSC02215.ARW');

      const completedPhoto = photosRepo.getByProjectAndFilename(project.id, 'DSC02215');
      assert.ok(completedPhoto);
      assert.equal(completedPhoto.jpg_available, 1);
      assert.equal(completedPhoto.raw_available, 1);
      assert.equal(completedPhoto.keep_raw, 1);

      const projectPath = getProjectPath(project.project_folder);
      assert.ok(fs.existsSync(path.join(projectPath, 'DSC02215.JPG')));
      assert.ok(fs.existsSync(path.join(projectPath, 'DSC02215.ARW')));
    });
  });

  test('analyze-files endpoint reports cross-project conflicts and completion hints', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const sourceProject = createProject('Conflict Analyze Source');
      const targetProject = createProject('Conflict Analyze Target');
      const token = issueToken();

      const jpgBuffer = readFixtureBuffer(TEST_FIXTURES.PORTRAIT_JPG);
      const rawBuffer = readFixtureBuffer(TEST_FIXTURES.PORTRAIT_RAW);

      const uploadOriginal = await uploadFiles(app, sourceProject, token, [
        { buffer: jpgBuffer, filename: 'DSC02215.JPG', contentType: 'image/jpeg' },
      ]);
      assert.equal(uploadOriginal.status, 201);

      const analyzeResponse = await request(app)
        .post(`/api/projects/${targetProject.project_folder}/analyze-files`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          files: [
            { name: 'DSC02215.JPG', type: 'image/jpeg' },
            { name: 'DSC02215.ARW', type: 'image/x-sony-arw' },
          ],
        });

      assert.equal(analyzeResponse.status, 200);
      assert.equal(analyzeResponse.body?.success, true);

      const { imageGroups, conflicts, completion_conflicts: completionConflicts } = analyzeResponse.body;
      assert.ok(imageGroups?.DSC02215, 'analysis should include DSC02215');
      assert.equal(imageGroups.DSC02215.hasConflict, true);
      assert.equal(imageGroups.DSC02215.conflictType, 'cross_project');

      assert.ok(Array.isArray(conflicts));
      assert.ok(conflicts.some((c) => c.filename === 'DSC02215'));

      assert.ok(Array.isArray(completionConflicts));
      assert.ok(completionConflicts.some((c) => c.filename === 'DSC02215' && c.sibling_type === 'jpg'));

      const completionUpload = await uploadFiles(app, sourceProject, token, [
        { buffer: rawBuffer, filename: 'DSC02215.ARW', contentType: 'image/x-sony-arw' },
      ]);
      assert.equal(completionUpload.status, 201);

      const postCompletionAnalyze = await request(app)
        .post(`/api/projects/${targetProject.project_folder}/analyze-files`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          files: [
            { name: 'DSC02215.ARW', type: 'image/x-sony-arw' },
          ],
        });

      assert.equal(postCompletionAnalyze.status, 200);
      const completionGroups = postCompletionAnalyze.body?.imageGroups;
      assert.equal(completionGroups?.DSC02215?.hasConflict, true);
      assert.equal(completionGroups?.DSC02215?.conflictType, 'cross_project');
    });
  });
});
