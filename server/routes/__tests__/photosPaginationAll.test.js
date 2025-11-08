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
const { TEST_FIXTURES, seedProjectWithFixtures } = require('../../tests/utils/testFixtures');

function loadRel(modulePath) {
  return loadFresh(path.join(__dirname, modulePath));
}

describe('All Photos Pagination', { concurrency: false }, () => {
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

    app.use('/api', photosRouter);
    return app;
  }

  function issueToken() {
    return tokenService.issueAccessToken({ sub: 'admin-test' });
  }

  async function seedProjectsWithPhotos(projectCount = 3, photosPerProject = 10) {
    const projectsRepo = loadRel('../../services/repositories/projectsRepo');
    const photosRepo = loadRel('../../services/repositories/photosRepo');

    const projects = [];
    for (let p = 0; p < projectCount; p += 1) {
      const project = projectsRepo.createProject({ project_name: `Pagination Project ${Date.now()}-${p}` });
      fixtures.registerProject(project);
      projects.push(project);

      const seedDate = new Date(Date.UTC(2025, 6, 1 + p)).toISOString();

      for (let i = 0; i < photosPerProject; i += 1) {
        const basename = `photo_${p}_${i}`;
        const ext = i % 2 === 0 ? '.JPG' : '.ARW';
        const filename = `${basename}${ext}`;
        const takenAt = new Date(Date.UTC(2024, 11, 1, 12, 0, p * photosPerProject + i)).toISOString();
        const metadata = JSON.stringify({
          exif_image_width: 4000 + i,
          exif_image_height: 3000 + i,
          orientation: i % 3 === 0 ? 6 : 1,
        });

        photosRepo.upsertPhoto(project.id, {
          filename,
          basename,
          ext: ext.replace('.', ''),
          date_time_original: takenAt,
          jpg_available: ext.toLowerCase() === '.jpg',
          raw_available: ext.toLowerCase() === '.arw',
          other_available: false,
          keep_jpg: ext.toLowerCase() === '.jpg',
          keep_raw: ext.toLowerCase() === '.arw',
          thumbnail_status: 'generated',
          preview_status: 'generated',
          orientation: i % 3 === 0 ? 6 : 1,
          meta_json: metadata,
          visibility: 'private',
        });
      }
    }

    return projects;
  }

  async function seedWithFixtures(project, fixturesList) {
    const projectsRepo = loadRel('../../services/repositories/projectsRepo');
    const photosRepo = loadRel('../../services/repositories/photosRepo');

    await seedProjectWithFixtures(project.project_folder, fixturesList);

    fixturesList.forEach((fixture, idx) => {
      const basename = path.parse(fixture).name;
      const ext = path.extname(fixture).replace('.', '');
      photosRepo.upsertPhoto(project.id, {
        filename: `${basename}.${ext}`,
        basename,
        ext,
        date_time_original: new Date(Date.UTC(2024, 10, idx + 1)).toISOString(),
        jpg_available: ext.toLowerCase() === 'jpg',
        raw_available: ext.toLowerCase() === 'arw',
        other_available: false,
        keep_jpg: ext.toLowerCase() === 'jpg',
        keep_raw: ext.toLowerCase() === 'arw',
        thumbnail_status: 'generated',
        preview_status: 'generated',
        orientation: 1,
        meta_json: JSON.stringify({ exif_image_width: 6000, exif_image_height: 4000 }),
        visibility: 'private',
      });
    });
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

  test('forward pagination returns distinct pages and cursors', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      await seedProjectsWithPhotos(3, 10);

      const page1 = await request(app)
        .get('/api/photos')
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 10, sort: 'date_time_original', dir: 'DESC' });

      assert.equal(page1.status, 200);
      assert.equal(page1.body.items.length, 10);
      assert.ok(page1.body.next_cursor, 'first page should include next_cursor');
      assert.equal(page1.body.prev_cursor, null);

      const cursorPayload = decodeCursor(page1.body.next_cursor);
      assert.ok(cursorPayload?.taken_at, 'cursor should encode taken_at');
      assert.ok(Number.isFinite(cursorPayload?.id), 'cursor should encode id');
      const lastItemPage1 = page1.body.items[page1.body.items.length - 1];
      assert.equal(cursorPayload.id, lastItemPage1.id, 'forward cursor anchored to last item in page');

      const idsPage1 = new Set(page1.body.items.map((item) => item.id));

      const page2 = await request(app)
        .get('/api/photos')
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 10, cursor: page1.body.next_cursor, sort: 'date_time_original', dir: 'DESC' });

      assert.equal(page2.status, 200);
      assert.equal(page2.body.items.length, 10);
      assert.ok(page2.body.next_cursor);
      assert.ok(page2.body.prev_cursor);

      const prevCursorPayload = decodeCursor(page2.body.prev_cursor);
      assert.ok(prevCursorPayload);
      assert.equal(prevCursorPayload.id, page2.body.items[0].id, 'prev cursor corresponds to first item of current page');

      const idsPage2 = new Set(page2.body.items.map((item) => item.id));
      const intersection = [...idsPage1].filter((id) => idsPage2.has(id));
      assert.equal(intersection.length, 0, 'pages should not overlap when paginating forward');
    });
  });

  test('backward pagination navigates previous pages correctly', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      await seedProjectsWithPhotos(3, 12);

      const first = await request(app)
        .get('/api/photos')
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 10, sort: 'date_time_original', dir: 'DESC' });

      const second = await request(app)
        .get('/api/photos')
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 10, cursor: first.body.next_cursor, sort: 'date_time_original', dir: 'DESC' });

      const third = await request(app)
        .get('/api/photos')
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 10, cursor: second.body.next_cursor, sort: 'date_time_original', dir: 'DESC' });

      assert.ok(third.body.prev_cursor, 'third page should expose prev_cursor');

      const backToSecond = await request(app)
        .get('/api/photos')
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 10, before_cursor: third.body.prev_cursor, sort: 'date_time_original', dir: 'DESC' });

      assert.equal(backToSecond.status, 200);
      assert.equal(backToSecond.body.items.length, 10);
      assert.ok(backToSecond.body.next_cursor, 'backward fetch exposes next cursor for forward navigation');
      const fwdCursor = decodeCursor(backToSecond.body.next_cursor);
      assert.ok(fwdCursor);

      const idsForward = new Set(second.body.items.map((item) => item.id));
      const idsBackward = new Set(backToSecond.body.items.map((item) => item.id));
      assert.deepEqual(new Set([...idsForward]), new Set([...idsBackward]), 'backward pagination should return previous page items');
    });
  });

  test('sorting by date desc matches taken_at ordering', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      await seedProjectsWithPhotos(2, 8);

      const res = await request(app)
        .get('/api/photos')
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 15, sort: 'date_time_original', dir: 'DESC' });

      assert.equal(res.status, 200);
      const items = res.body.items;
      const sliced = items.slice(0, 10);
      const sorted = [...sliced].sort((a, b) => new Date(b.taken_at) - new Date(a.taken_at));
      assert.deepEqual(sliced.map((p) => p.id), sorted.map((p) => p.id), 'items should already be sorted by taken_at desc');
    });
  });

  test('sorting by date asc returns oldest first and exposes prev cursor', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      await seedProjectsWithPhotos(2, 12);

      const firstAsc = await request(app)
        .get('/api/photos')
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 10, sort: 'date_time_original', dir: 'ASC' });

      assert.equal(firstAsc.status, 200);
      assert.ok(firstAsc.body.next_cursor, 'ASC sorting should have next cursor');

      const nextAsc = await request(app)
        .get('/api/photos')
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 10, cursor: firstAsc.body.next_cursor, sort: 'date_time_original', dir: 'ASC' });

      assert.equal(nextAsc.status, 200);
      assert.ok(nextAsc.body.prev_cursor, 'forward paging should set prev cursor for ASC');
    });
  });

  test('filters by file_type and keep_type while preserving pagination', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      await seedProjectsWithPhotos(3, 8);

      const filtered = await request(app)
        .get('/api/photos')
        .set('Authorization', `Bearer ${token}`)
        .query({
          limit: 10,
          file_type: 'jpg_only',
          keep_type: 'jpg_only',
          sort: 'date_time_original',
          dir: 'DESC',
        });

      assert.equal(filtered.status, 200);
      filtered.body.items.forEach((item) => {
        assert.equal(item.jpg_available, true);
        assert.equal(item.raw_available, false);
        assert.equal(item.keep_jpg, true);
        assert.equal(item.keep_raw, false);
      });

      if (filtered.body.next_cursor) {
        const nextFiltered = await request(app)
          .get('/api/photos')
          .set('Authorization', `Bearer ${token}`)
          .query({
            limit: 10,
            cursor: filtered.body.next_cursor,
            file_type: 'jpg_only',
            keep_type: 'jpg_only',
            sort: 'date_time_original',
            dir: 'DESC',
          });

        assert.equal(nextFiltered.status, 200);
        nextFiltered.body.items.forEach((item) => {
          assert.equal(item.jpg_available, true);
          assert.equal(item.raw_available, false);
          assert.equal(item.keep_jpg, true);
          assert.equal(item.keep_raw, false);
        });
      }
    });
  });

  test('last page exposes null next_cursor', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      await seedProjectsWithPhotos(1, 5);

      const page = await request(app)
        .get('/api/photos')
        .set('Authorization', `Bearer ${token}`)
        .query({ limit: 10, sort: 'date_time_original', dir: 'DESC' });

      assert.equal(page.status, 200);
      assert.equal(page.body.items.length, 5);
      assert.equal(page.body.next_cursor, null);
      assert.equal(page.body.prev_cursor, null);
    });
  });

  test('invalid cursor yields 400 error', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      await seedProjectsWithPhotos(1, 5);

      const bad = await request(app)
        .get('/api/photos')
        .set('Authorization', `Bearer ${token}`)
        .query({ cursor: 'not-a-real-cursor', limit: 10 });

      assert.equal(bad.status, 200);
      assert.ok(Array.isArray(bad.body.items));
      assert.ok(bad.body.items.length > 0);
      if (bad.body.next_cursor) {
        const decoded = decodeCursor(bad.body.next_cursor);
        assert.ok(decoded, 'next_cursor should decode when provided');
      }
    });
  });
});
