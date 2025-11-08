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

describe('Bulk Keep Operations', { concurrency: false }, () => {
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

  function seedProjectWithPhotos({ prefix, count, keepMap = {} }) {
    const projectsRepo = loadRel('../../services/repositories/projectsRepo');
    const photosRepo = loadRel('../../services/repositories/photosRepo');

    const project = projectsRepo.createProject({ project_name: `${prefix} Project ${Date.now()}` });
    fixtures.registerProject(project);
    ensureProjectFolder(project.project_folder);

    const photos = [];
    for (let i = 0; i < count; i += 1) {
      const filename = `${prefix}_photo_${String(i).padStart(2, '0')}.JPG`;
      const keep = keepMap[i] || { keep_jpg: true, keep_raw: false };
      const record = photosRepo.upsertPhoto(project.id, {
        filename,
        basename: path.parse(filename).name,
        ext: 'JPG',
        date_time_original: new Date(Date.UTC(2025, 0, 2, 12, i)).toISOString(),
        jpg_available: true,
        raw_available: true,
        other_available: false,
        keep_jpg: keep.keep_jpg,
        keep_raw: keep.keep_raw,
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

  function getKeepFlags(photoId) {
    const photosRepo = loadRel('../../services/repositories/photosRepo');
    const photo = photosRepo.getById(photoId);
    return { keep_jpg: !!photo.keep_jpg, keep_raw: !!photo.keep_raw };
  }

  test('updates keep flags for multiple photos', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const { photos } = seedProjectWithPhotos({
        prefix: 'keepBasic',
        count: 2,
        keepMap: {
          0: { keep_jpg: true, keep_raw: true },
          1: { keep_jpg: false, keep_raw: true },
        },
      });

      const res = await request(app)
        .post('/api/photos/keep')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { photo_id: photos[0].id, keep_jpg: false, keep_raw: true },
            { photo_id: photos[1].id, keep_jpg: false, keep_raw: false },
          ],
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.updated, 2);
      assert.deepEqual(getKeepFlags(photos[0].id), { keep_jpg: false, keep_raw: true });
      assert.deepEqual(getKeepFlags(photos[1].id), { keep_jpg: false, keep_raw: false });
      assert.equal(res.body.errors, undefined);
    });
  });

  test('supports cross-project updates in same payload', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const first = seedProjectWithPhotos({ prefix: 'keepProjectA', count: 1, keepMap: { 0: { keep_jpg: true, keep_raw: false } } });
      const second = seedProjectWithPhotos({ prefix: 'keepProjectB', count: 1, keepMap: { 0: { keep_jpg: false, keep_raw: true } } });

      const res = await request(app)
        .post('/api/photos/keep')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { photo_id: first.photos[0].id, keep_jpg: true, keep_raw: true },
            { photo_id: second.photos[0].id, keep_jpg: true, keep_raw: true },
          ],
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.updated, 2);
      assert.deepEqual(getKeepFlags(first.photos[0].id), { keep_jpg: true, keep_raw: true });
      assert.deepEqual(getKeepFlags(second.photos[0].id), { keep_jpg: true, keep_raw: true });
      assert.equal(res.body.errors, undefined);
    });
  });

  test('dry run previews keep changes without persisting', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const { photos } = seedProjectWithPhotos({ prefix: 'keepDryRun', count: 1, keepMap: { 0: { keep_jpg: true, keep_raw: false } } });

      const res = await request(app)
        .post('/api/photos/keep')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dry_run: true,
          items: [
            { photo_id: photos[0].id, keep_jpg: false, keep_raw: true },
          ],
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.updated, 1);
      assert.equal(res.body.dry_run.updated, 1);
      assert.deepEqual(res.body.dry_run.per_item, [
        {
          photo_id: photos[0].id,
          would_update: { keep_jpg: false, keep_raw: true },
        },
      ]);
      assert.deepEqual(getKeepFlags(photos[0].id), { keep_jpg: true, keep_raw: false });
    });
  });

  test('ignores entries without keep fields and still processes others', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const { photos } = seedProjectWithPhotos({
        prefix: 'keepNoop',
        count: 2,
        keepMap: {
          0: { keep_jpg: true, keep_raw: true },
          1: { keep_jpg: false, keep_raw: false },
        },
      });

      const res = await request(app)
        .post('/api/photos/keep')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { photo_id: photos[0].id },
            { photo_id: photos[1].id, keep_raw: true },
          ],
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.updated, 1);
      assert.deepEqual(getKeepFlags(photos[0].id), { keep_jpg: true, keep_raw: true });
      assert.deepEqual(getKeepFlags(photos[1].id), { keep_jpg: false, keep_raw: true });
    });
  });

  test('reports errors for invalid photo ids while succeeding others', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const { photos } = seedProjectWithPhotos({ prefix: 'keepInvalid', count: 1, keepMap: { 0: { keep_jpg: true, keep_raw: true } } });

      const res = await request(app)
        .post('/api/photos/keep')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { photo_id: 99999999, keep_jpg: false },
            { photo_id: photos[0].id, keep_jpg: true, keep_raw: false },
          ],
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.updated, 1);
      assert.ok(Array.isArray(res.body.errors));
      assert.equal(res.body.errors.length, 1);
      assert.match(res.body.errors[0].error, /not found/i);
      assert.deepEqual(getKeepFlags(photos[0].id), { keep_jpg: true, keep_raw: false });
    });
  });
});
