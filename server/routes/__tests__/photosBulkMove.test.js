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

describe('Bulk Move Operations', { concurrency: false }, () => {
  let fixtures;
  let orchestrator;
  let originalStartTask;
  let startCalls;

  beforeEach(() => {
    fixtures = createFixtureTracker();
    orchestrator = loadRel('../../services/tasksOrchestrator');
    originalStartTask = orchestrator.startTask;
    startCalls = [];
    orchestrator.startTask = async (payload) => {
      startCalls.push(payload);
      return { id: `job-${startCalls.length}` };
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

  function seedProject({ prefix, count }) {
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
        date_time_original: new Date(Date.UTC(2025, 0, 3, 12, i)).toISOString(),
        jpg_available: true,
        raw_available: false,
        other_available: false,
        keep_jpg: true,
        keep_raw: false,
        thumbnail_status: 'generated',
        preview_status: 'generated',
        orientation: 1,
        meta_json: JSON.stringify({ exif_image_width: 4000 + i, exif_image_height: 3000 + i }),
        visibility: 'private',
      });
      photos.push(record);
    }

    return { project, photos };
  }

  function getProjectsRepo() {
    return loadRel('../../services/repositories/projectsRepo');
  }

  test('queues move jobs and returns 202 with job ids', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const source = seedProject({ prefix: 'moveSource', count: 2 });
      const dest = seedProject({ prefix: 'moveDest', count: 0 });

      const res = await request(app)
        .post('/api/photos/move')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dest_folder: dest.project.project_folder,
          items: source.photos.map((p) => ({ photo_id: p.id })),
        });

      assert.equal(res.status, 202);
      assert.equal(res.body.job_count, 1);
      assert.deepEqual(res.body.job_ids, ['job-1']);
      assert.equal(startCalls.length, 1);
      assert.deepEqual(startCalls[0], {
        project_id: source.project.id,
        type: 'image_move',
        source: 'user',
        items: source.photos.map((p) => p.basename),
        tenant_id: 'user_0',
        options: {
          destination_project_id: dest.project.id,
          destination_project_folder: dest.project.project_folder,
        },
      });
    });
  });

  test('returns 404 when destination project missing', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const source = seedProject({ prefix: 'moveMissingDest', count: 1 });

      const res = await request(app)
        .post('/api/photos/move')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dest_folder: 'nonexistent-folder',
          items: [{ photo_id: source.photos[0].id }],
        });

      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'Destination project not found');
      assert.equal(startCalls.length, 0);
    });
  });

  test('dry run previews move details without queuing jobs', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const source = seedProject({ prefix: 'moveDryRunSrc', count: 1 });
      const dest = seedProject({ prefix: 'moveDryRunDest', count: 0 });

      const res = await request(app)
        .post('/api/photos/move')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dry_run: true,
          dest_folder: dest.project.project_folder,
          items: [{ photo_id: source.photos[0].id }],
        });

      assert.equal(res.status, 200);
      assert.ok(res.body.dry_run);
      assert.equal(res.body.dry_run.destination_project.id, dest.project.id);
      assert.equal(res.body.dry_run.photos, 1);
      assert.equal(startCalls.length, 0);
    });
  });

  test('skips photos already in destination while moving others', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const dest = seedProject({ prefix: 'moveSkipDest', count: 1 });
      const source = seedProject({ prefix: 'moveSkipSource', count: 1 });

      const res = await request(app)
        .post('/api/photos/move')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dest_folder: dest.project.project_folder,
          items: [
            { photo_id: dest.photos[0].id },
            { photo_id: source.photos[0].id },
          ],
        });

      assert.equal(res.status, 202);
      assert.equal(startCalls.length, 1);
      assert.equal(res.body.job_count, 1);
      assert.deepEqual(startCalls[0].items, [source.photos[0].basename]);
      assert.ok(Array.isArray(res.body.errors));
      assert.match(res.body.errors[0].error, /already in destination/i);
    });
  });

  test('reports errors for invalid photo ids but queues remaining', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const source = seedProject({ prefix: 'moveInvalid', count: 1 });
      const dest = seedProject({ prefix: 'moveInvalidDest', count: 0 });

      const res = await request(app)
        .post('/api/photos/move')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dest_folder: dest.project.project_folder,
          items: [
            { photo_id: 123456789 },
            { photo_id: source.photos[0].id },
          ],
        });

      assert.equal(res.status, 202);
      assert.equal(startCalls.length, 1);
      assert.equal(res.body.job_count, 1);
      assert.ok(Array.isArray(res.body.errors));
      assert.equal(res.body.errors.length, 1);
      assert.match(res.body.errors[0].error, /not found/i);
    });
  });
});
