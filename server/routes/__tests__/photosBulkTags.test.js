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

describe('Bulk Tag Operations', { concurrency: false }, () => {
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

  function seedProjectWithPhotos({ prefix, count, tagMap = {} }) {
    const projectsRepo = loadRel('../../services/repositories/projectsRepo');
    const photosRepo = loadRel('../../services/repositories/photosRepo');
    const tagsRepo = loadRel('../../services/repositories/tagsRepo');
    const photoTagsRepo = loadRel('../../services/repositories/photoTagsRepo');

    const project = projectsRepo.createProject({ project_name: `${prefix} Project ${Date.now()}` });
    fixtures.registerProject(project);
    ensureProjectFolder(project.project_folder);

    const photos = [];
    for (let i = 0; i < count; i += 1) {
      const filename = `${prefix}_photo_${String(i).padStart(2, '0')}.JPG`;
      const record = photosRepo.upsertPhoto(project.id, {
        filename,
        basename: path.parse(filename).name,
        ext: 'JPG',
        date_time_original: new Date(Date.UTC(2025, 0, 1, 12, i)).toISOString(),
        jpg_available: true,
        raw_available: false,
        other_available: false,
        keep_jpg: true,
        keep_raw: false,
        thumbnail_status: 'generated',
        preview_status: 'generated',
        orientation: 1,
        meta_json: JSON.stringify({ exif_image_width: 6000 + i, exif_image_height: 4000 + i }),
        visibility: 'private',
      });

      const desiredTags = tagMap[i] || [];
      desiredTags.forEach((name) => {
        const tag = tagsRepo.getOrCreateTag(project.id, name);
        photoTagsRepo.addTagToPhoto(record.id, tag.id);
      });

      photos.push(record);
    }

    return { project, photos };
  }

  function listTagNames(photoId) {
    const photoTagsRepo = loadRel('../../services/repositories/photoTagsRepo');
    const tags = photoTagsRepo.listTagsForPhoto(photoId) || [];
    return tags.map((t) => t.name).sort();
  }

  test('adds tags to multiple photos with shared overlap', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const { photos } = seedProjectWithPhotos({ prefix: 'bulkAdd', count: 2 });

      const res = await request(app)
        .post('/api/photos/tags/add')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { photo_id: photos[0].id, tags: ['portrait', 'sunset'] },
            { photo_id: photos[1].id, tags: ['portrait', 'night'] },
          ],
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.updated, 2);
      assert.deepEqual(listTagNames(photos[0].id), ['portrait', 'sunset']);
      assert.deepEqual(listTagNames(photos[1].id), ['night', 'portrait']);
      assert.equal(res.body.errors, undefined);
    });
  });

  test('removes tags and keeps unrelated tags intact', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const { photos } = seedProjectWithPhotos({
        prefix: 'bulkRemove',
        count: 2,
        tagMap: {
          0: ['portrait', 'outdoor', 'primary'],
          1: ['portrait', 'studio'],
        },
      });

      const res = await request(app)
        .post('/api/photos/tags/remove')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { photo_id: photos[0].id, tags: ['portrait', 'missing-tag'] },
            { photo_id: photos[1].id, tags: ['studio'] },
          ],
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.updated, 2);
      assert.deepEqual(listTagNames(photos[0].id), ['outdoor', 'primary']);
      assert.deepEqual(listTagNames(photos[1].id), ['portrait']);
      assert.equal(res.body.errors, undefined);
    });
  });

  test('operates across projects when mixing photo_ids', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const first = seedProjectWithPhotos({ prefix: 'bulkProjectA', count: 1 });
      const second = seedProjectWithPhotos({ prefix: 'bulkProjectB', count: 1, tagMap: { 0: ['existing'] } });

      const payload = {
        items: [
          { photo_id: first.photos[0].id, tags: ['travel'] },
          { photo_id: second.photos[0].id, tags: ['existing', 'portrait'] },
        ],
      };

      const addRes = await request(app)
        .post('/api/photos/tags/add')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      assert.equal(addRes.status, 200);
      assert.equal(addRes.body.updated, 2);
      assert.deepEqual(listTagNames(first.photos[0].id), ['travel']);
      assert.deepEqual(listTagNames(second.photos[0].id), ['existing', 'portrait']);

      const removeRes = await request(app)
        .post('/api/photos/tags/remove')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { photo_id: first.photos[0].id, tags: ['travel'] },
            { photo_id: second.photos[0].id, tags: ['portrait'] },
          ],
        });

      assert.equal(removeRes.status, 200);
      assert.equal(removeRes.body.updated, 2);
      assert.deepEqual(listTagNames(first.photos[0].id), []);
      assert.deepEqual(listTagNames(second.photos[0].id), ['existing']);
    });
  });

  test('dry run previews add/remove changes without mutating state', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const { photos } = seedProjectWithPhotos({ prefix: 'dryRun', count: 1, tagMap: { 0: ['existing'] } });

      const resAdd = await request(app)
        .post('/api/photos/tags/add')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dry_run: true,
          items: [
            { photo_id: photos[0].id, tags: ['existing', 'new-tag'] },
          ],
        });

      assert.equal(resAdd.status, 200);
      assert.equal(resAdd.body.updated, 1);
      assert.equal(resAdd.body.dry_run.updated, 1);
      assert.deepEqual(resAdd.body.dry_run.per_item, [
        { photo_id: photos[0].id, would_add: ['new-tag'] },
      ]);
      assert.deepEqual(listTagNames(photos[0].id), ['existing']);

      const resRemove = await request(app)
        .post('/api/photos/tags/remove')
        .set('Authorization', `Bearer ${token}`)
        .send({
          dry_run: true,
          items: [
            { photo_id: photos[0].id, tags: ['existing'] },
          ],
        });

      assert.equal(resRemove.status, 200);
      assert.equal(resRemove.body.updated, 1);
      assert.equal(resRemove.body.dry_run.updated, 1);
      assert.deepEqual(resRemove.body.dry_run.per_item, [
        { photo_id: photos[0].id, would_remove: ['existing'] },
      ]);
      assert.deepEqual(listTagNames(photos[0].id), ['existing']);
    });
  });

  test('returns errors for invalid photo ids while continuing other work', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const { photos } = seedProjectWithPhotos({ prefix: 'invalidPhoto', count: 1 });

      const res = await request(app)
        .post('/api/photos/tags/add')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { photo_id: 9999999, tags: ['should-fail'] },
            { photo_id: photos[0].id, tags: ['valid-tag'] },
          ],
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.updated, 1);
      assert.ok(Array.isArray(res.body.errors));
      assert.equal(res.body.errors.length, 1);
      assert.match(res.body.errors[0].error, /not found/i);
      assert.deepEqual(listTagNames(photos[0].id), ['valid-tag']);
    });
  });
});
