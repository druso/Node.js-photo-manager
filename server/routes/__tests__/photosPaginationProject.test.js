const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const path = require('node:path');

const { withAuthEnv, loadFresh } = require('../../services/auth/__tests__/testUtils');
const tokenService = require('../../services/auth/tokenService');
const { createFixtureTracker } = require('../../tests/utils/dataFixtures');
const { ensureProjectDirs } = require('../../services/fsUtils');

function loadRel(modulePath) {
  return loadFresh(path.join(__dirname, modulePath));
}

describe('Project Photos Pagination', { concurrency: false }, () => {
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

  function issueToken() {
    return tokenService.issueAccessToken({ sub: 'admin-test' });
  }

  async function seedProjectWithPhotos({ prefix, count, startDate = new Date(Date.UTC(2024, 0, 1, 12, 0, 0)) }) {
    const projectsRepo = loadRel('../../services/repositories/projectsRepo');
    const photosRepo = loadRel('../../services/repositories/photosRepo');

    const project = projectsRepo.createProject({ project_name: `${prefix} Project ${Date.now()}` });
    fixtures.registerProject(project);
    ensureProjectDirs(project.project_folder);

    const photos = [];
    for (let i = 0; i < count; i += 1) {
      const padded = String(i).padStart(2, '0');
      const filename = `${prefix}_photo_${padded}.JPG`;
      const takenAt = new Date(startDate.getTime() + i * 60 * 1000).toISOString();

      const record = photosRepo.upsertPhoto(project.id, {
        filename,
        basename: `${prefix}_photo_${padded}`,
        ext: 'JPG',
        date_time_original: takenAt,
        jpg_available: true,
        raw_available: false,
        other_available: false,
        keep_jpg: true,
        keep_raw: false,
        thumbnail_status: 'generated',
        preview_status: 'generated',
        orientation: i % 3 === 0 ? 6 : 1,
        meta_json: JSON.stringify({ exif_image_width: 6000 + i, exif_image_height: 4000 + i }),
        visibility: 'private',
      });
      photos.push(record);
    }

    return { project, photos };
  }

  function decodeCursor(cursor) {
    if (!cursor) return null;
    const normalized = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4;
    const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
    try {
      const json = Buffer.from(padded, 'base64').toString('utf8');
      return JSON.parse(json);
    } catch (err) {
      return null;
    }
  }

  test('forward pagination within project returns distinct pages and cursors', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const { project } = await seedProjectWithPhotos({ prefix: 'projA', count: 25 });

      const first = await request(app)
        .get(`/api/projects/${project.project_folder}/photos`)
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 10, sort: 'date_time_original', dir: 'DESC' });

      assert.equal(first.status, 200);
      assert.equal(first.body.items.length, 10);
      assert.ok(first.body.next_cursor, 'first page should expose next_cursor');
      assert.equal(first.body.prev_cursor, null);

      const firstCursorPayload = decodeCursor(first.body.next_cursor);
      assert.ok(firstCursorPayload?.taken_at);
      assert.ok(Number.isFinite(firstCursorPayload?.id));

      const firstIds = new Set(first.body.items.map((item) => item.id));

      const second = await request(app)
        .get(`/api/projects/${project.project_folder}/photos`)
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 10, cursor: first.body.next_cursor, sort: 'date_time_original', dir: 'DESC' });

      assert.equal(second.status, 200);
      assert.equal(second.body.items.length, 10);
      assert.ok(second.body.next_cursor);
      assert.ok(second.body.prev_cursor);

      const prevCursorPayload = decodeCursor(second.body.prev_cursor);
      assert.ok(prevCursorPayload);
      assert.equal(prevCursorPayload.id, second.body.items[0].id, 'prev cursor should reference first item of current page');

      const secondIds = new Set(second.body.items.map((item) => item.id));
      const overlap = [...firstIds].filter((id) => secondIds.has(id));
      assert.equal(overlap.length, 0, 'project pages should not overlap');
    });
  });

  test('project pagination respects project boundary and totals', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const { project: projectA } = await seedProjectWithPhotos({ prefix: 'alpha', count: 8 });
      await seedProjectWithPhotos({ prefix: 'beta', count: 6 });

      const res = await request(app)
        .get(`/api/projects/${projectA.project_folder}/photos`)
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 20, sort: 'date_time_original', dir: 'DESC' });

      assert.equal(res.status, 200);
      assert.equal(res.body.items.length, 8);
      assert.equal(res.body.total, 8);
      assert.equal(res.body.unfiltered_total, 8);
      res.body.items.forEach((item) => {
        assert.ok(item.filename.startsWith('alpha_photo_'), `expected filename to belong to projectA, got ${item.filename}`);
      });
    });
  });

  test('changing sort resets pagination window', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const { project } = await seedProjectWithPhotos({ prefix: 'gamma', count: 12 });

      const alphaPage = await request(app)
        .get(`/api/projects/${project.project_folder}/photos`)
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 5, sort: 'filename', dir: 'ASC' });

      assert.equal(alphaPage.status, 200);
      const alphaItems = alphaPage.body.items.map((item) => item.filename);
      const sortedAlpha = [...alphaItems].sort();
      assert.deepEqual(alphaItems, sortedAlpha, 'filename ASC should yield alphabetical order');
      const alphaCursor = alphaPage.body.next_cursor;

      if (alphaCursor) {
        const nextAlpha = await request(app)
          .get(`/api/projects/${project.project_folder}/photos`)
          .set('Authorization', `Bearer ${token}`)
          .query({ limit: 5, cursor: alphaCursor, sort: 'filename', dir: 'ASC' });
        assert.equal(nextAlpha.status, 200);
        assert.ok(nextAlpha.body.prev_cursor, 'subsequent alphabetical page should expose prev_cursor');
      }

      const datePage = await request(app)
        .get(`/api/projects/${project.project_folder}/photos`)
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 5, sort: 'date_time_original', dir: 'DESC' });

      assert.equal(datePage.status, 200);
      assert.equal(datePage.body.prev_cursor, null, 'new sort should reset pagination to first page');
      const newest = datePage.body.items[0];
      const newestTaken = new Date(newest.date_time_original).getTime();
      datePage.body.items.forEach((item, index) => {
        const currentTime = new Date(item.date_time_original).getTime();
        assert.ok(currentTime <= newestTaken + 1, `expected descending taken_at order at index ${index}`);
      });
      if (alphaCursor) {
        assert.notEqual(datePage.body.next_cursor, alphaCursor, 'changing sort should not reuse prior cursor token');
      }
    });
  });
});
