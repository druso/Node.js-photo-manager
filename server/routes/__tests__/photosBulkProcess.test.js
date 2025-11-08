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

describe('Bulk Process Operations', { concurrency: false }, () => {
  let fixtures;
  let orchestrator;
  let originalStartTask;
  let startCalls;

  beforeEach(() => {
    fixtures = createFixtureTracker();
    orchestrator = loadRel('../../services/tasksOrchestrator');
    originalStartTask = orchestrator.startTask;
    startCalls = [];
    orchestrator.startTask = (payload) => {
      startCalls.push(payload);
      return {
        task_id: `task-${startCalls.length}`,
        first_job_id: `job-${startCalls.length}`,
        job_count: 1,
        chunked: false,
      };
    };
  });

  afterEach(() => {
    orchestrator.startTask = originalStartTask;
    fixtures.cleanup();
  });

  function createTestApp() {
    const app = express();
    const requestId = loadRel('../../middleware/requestId');
    const authenticateAdmin = loadRel('../../middleware/authenticateAdmin');
    const photosActionsRouter = loadRel('../photosActions');

    app.use(requestId());
    app.use(cookieParser());
    app.use(express.json());

    app.use('/api', (req, res, next) => {
      if (req.path.startsWith('/auth/')) {
        return next();
      }
      return authenticateAdmin(req, res, next);
    });

    app.use('/api', photosActionsRouter);
    return app;
  }

  function issueToken() {
    return tokenService.issueAccessToken({ sub: 'admin-test' });
  }

  function ensureProjectFolder(projectFolder) {
    const fsUtils = loadRel('../../services/fsUtils');
    fsUtils.ensureProjectDirs(projectFolder);
  }

  function seedProjectWithPhotos({ prefix, count }) {
    const projectsRepo = loadRel('../../services/repositories/projectsRepo');
    const photosRepo = loadRel('../../services/repositories/photosRepo');

    const project = projectsRepo.createProject({ project_name: `${prefix} Project ${Date.now()}` });
    fixtures.registerProject(project);
    ensureProjectFolder(project.project_folder);

    const photos = [];
    for (let i = 0; i < count; i += 1) {
      const filename = `${prefix}_photo_${String(i).padStart(2, '0')}`;
      const record = photosRepo.upsertPhoto(project.id, {
        filename: `${filename}.JPG`,
        basename: filename,
        ext: 'JPG',
        date_time_original: new Date(Date.UTC(2025, 0, 4, 12, i)).toISOString(),
        jpg_available: true,
        raw_available: false,
        other_available: false,
        keep_jpg: true,
        keep_raw: false,
        thumbnail_status: 'pending',
        preview_status: 'pending',
        orientation: 1,
        meta_json: JSON.stringify({ exif_image_width: 4500 + i, exif_image_height: 3000 + i }),
        visibility: 'private',
      });
      photos.push(record);
    }

    return { project, photos };
  }

  function assertStartTaskCalledOnce() {
    assert.equal(startCalls.length, 1);
    return startCalls[0];
  }

  test('queues derivative generation for provided photos', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const { photos } = seedProjectWithPhotos({ prefix: 'processBasic', count: 2 });

      const res = await request(app)
        .post('/api/photos/process')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: photos.map((p) => ({ photo_id: p.id })),
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.message, 'Processing queued');
      assert.equal(res.body.task_id, 'task-1');
      assert.deepEqual(res.body.job_ids, ['job-1']);
      const call = assertStartTaskCalledOnce();
      assert.equal(call.type, 'generate_derivatives');
      assert.equal(call.scope, 'photo_set');
      assert.deepEqual(call.items, photos.map((p) => ({ photo_id: p.id }))); 
      assert.deepEqual(call.payload, { force: false });
    });
  });

  test('groups cross-project photos into single task', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const first = seedProjectWithPhotos({ prefix: 'processCrossA', count: 1 });
      const second = seedProjectWithPhotos({ prefix: 'processCrossB', count: 1 });

      const res = await request(app)
        .post('/api/photos/process')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { photo_id: first.photos[0].id },
            { photo_id: second.photos[0].id },
          ],
        });

      assert.equal(res.status, 200);
      const call = assertStartTaskCalledOnce();
      assert.equal(call.project_id, undefined);
      assert.deepEqual(call.items, [
        { photo_id: first.photos[0].id },
        { photo_id: second.photos[0].id },
      ]);
    });
  });

  test('force flag propagates to queued task payload', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const { photos } = seedProjectWithPhotos({ prefix: 'processForce', count: 1 });

      const res = await request(app)
        .post('/api/photos/process')
        .set('Authorization', `Bearer ${token}`)
        .send({
          force: true,
          items: [{ photo_id: photos[0].id }],
        });

      assert.equal(res.status, 200);
      const call = assertStartTaskCalledOnce();
      assert.deepEqual(call.payload, { force: true });
    });
  });

  test('dry run previews processing without queuing jobs', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const seeded = seedProjectWithPhotos({ prefix: 'processDryRun', count: 2 });

      const res = await request(app)
        .post('/api/photos/process')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dry_run: true,
          items: seeded.photos.map((p) => ({ photo_id: p.id })),
        });

      assert.equal(res.status, 200);
      assert.ok(res.body.dry_run);
      assert.equal(res.body.dry_run.photos, 2);
      assert.equal(res.body.dry_run.projects, 1);
      assert.equal(startCalls.length, 0);
    });
  });

  test('reports errors for invalid photos while processing remaining', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const { photos } = seedProjectWithPhotos({ prefix: 'processInvalid', count: 1 });

      const res = await request(app)
        .post('/api/photos/process')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { photo_id: 987654321 },
            { photo_id: photos[0].id },
          ],
        });

      assert.equal(res.status, 200);
      const call = assertStartTaskCalledOnce();
      assert.deepEqual(call.items, [{ photo_id: photos[0].id }]);
      assert.ok(Array.isArray(res.body.errors));
      assert.equal(res.body.errors.length, 1);
      assert.match(res.body.errors[0].error, /not found/i);
    });
  });
});
