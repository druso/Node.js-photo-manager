const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const path = require('node:path');
const fs = require('fs-extra');

const { withAuthEnv, loadFresh } = require('../../services/auth/__tests__/testUtils');
const { getDb } = require('../../services/db');
const tokenService = require('../../services/auth/tokenService');

const PROJECTS_ROOT = path.join(__dirname, '../../..', '.projects', 'user_0');
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

const publicAssetHashes = loadRel('../../services/publicAssetHashes');

function loadRel(modulePath) {
  return loadFresh(path.join(__dirname, modulePath));
}

function createTestApp() {
  const app = express();
  const requestId = loadRel('../../middleware/requestId');
  const authenticateAdmin = loadRel('../../middleware/authenticateAdmin');
  const assetsRouter = loadRel('../assets');
  const photosActionsRouter = loadRel('../photosActions');

  const PUBLIC_ASSET_PATH = /^\/projects\/[^/]+\/(thumbnail|preview|image)\//;
  const PUBLIC_HASH_METADATA_PATH = /^\/projects\/image\/[^/]+$/;

  app.use(requestId());
  app.use(cookieParser());
  app.use(express.json());

  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/')) {
      return next();
    }
    if (req.method === 'GET' && (PUBLIC_ASSET_PATH.test(req.path) || PUBLIC_HASH_METADATA_PATH.test(req.path))) {
      return next();
    }
    return authenticateAdmin(req, res, next);
  });

  app.use('/api/projects', assetsRouter);
  app.use('/api', photosActionsRouter);

  return app;
}

function seedVisibilityFixtures() {
  const db = getDb();
  const ts = new Date().toISOString();
  const projectFolder = `pvis_${Date.now()}`;
  const projectName = `Visibility Test ${projectFolder}`;

  fs.ensureDirSync(path.join(__dirname, '../../..', '.projects'));
  fs.ensureDirSync(PROJECTS_ROOT);

  const projectInfo = db.prepare(`
    INSERT INTO projects (project_folder, project_name, created_at, updated_at, schema_version, status, archived_at)
    VALUES (?, ?, ?, ?, NULL, NULL, NULL)
  `).run(projectFolder, projectName, ts, ts);
  const projectId = projectInfo.lastInsertRowid;

  const insertPhoto = db.prepare(`
    INSERT INTO photos (
      project_id,
      manifest_id,
      filename,
      basename,
      ext,
      created_at,
      updated_at,
      date_time_original,
      jpg_available,
      raw_available,
      other_available,
      keep_jpg,
      keep_raw,
      thumbnail_status,
      preview_status,
      orientation,
      meta_json,
      visibility
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const publicInfo = insertPhoto.run(
    projectId,
    `${projectId}:public.jpg`,
    'public.jpg',
    'public',
    '.jpg',
    ts,
    ts,
    ts,
    1,
    0,
    0,
    1,
    0,
    'generated',
    'generated',
    null,
    null,
    'public'
  );

  const privateInfo = insertPhoto.run(
    projectId,
    `${projectId}:private.jpg`,
    'private.jpg',
    'private',
    '.jpg',
    ts,
    ts,
    ts,
    1,
    0,
    0,
    1,
    0,
    'generated',
    'generated',
    null,
    null,
    'private'
  );

  const projectDir = path.join(PROJECTS_ROOT, projectFolder);
  fs.ensureDirSync(path.join(projectDir, '.thumb'));
  fs.ensureDirSync(path.join(projectDir, '.preview'));
  const publicThumbPath = path.join(projectDir, '.thumb', 'public.jpg');
  const privateThumbPath = path.join(projectDir, '.thumb', 'private.jpg');
  fs.writeFileSync(publicThumbPath, JPEG_BYTES);
  fs.writeFileSync(privateThumbPath, JPEG_BYTES);
  assert.ok(fs.existsSync(publicThumbPath), 'public thumb should exist for tests');
  assert.ok(fs.existsSync(privateThumbPath), 'private thumb should exist for tests');

  const publicHashes = loadRel('../../services/publicAssetHashes');
  const hashRecord = publicHashes.ensureHashForPhoto(publicInfo.lastInsertRowid);

  const cleanup = () => {
    const dbCleanup = getDb();
    dbCleanup.prepare('DELETE FROM photos WHERE project_id = ?').run(projectId);
    dbCleanup.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    fs.removeSync(projectDir);
  };

  return {
    projectId,
    projectFolder,
    publicPhotoId: publicInfo.lastInsertRowid,
    publicHash: hashRecord?.hash || null,
    privatePhotoId: privateInfo.lastInsertRowid,
    cleanup,
  };
}

describe('assets visibility enforcement', { concurrency: false }, () => {
  test('public thumbnails stream without authentication', async () => {
    await withAuthEnv({}, async () => {
      const { projectFolder, publicHash, cleanup } = seedVisibilityFixtures();
      const app = createTestApp();
      try {
        const url = `/api/projects/${projectFolder}/thumbnail/public.jpg${publicHash ? `?hash=${encodeURIComponent(publicHash)}` : ''}`;
        const res = await request(app).get(url);
        assert.equal(res.status, 200);
        assert.equal(res.headers['content-type'], 'image/jpeg');
        assert.ok(res.body.length > 0);
      } finally {
        cleanup();
      }
    });
  });

  test('private thumbnails return 404 for anonymous requests', async () => {
    await withAuthEnv({}, async () => {
      const { projectFolder, cleanup } = seedVisibilityFixtures();
      const app = createTestApp();
      try {
        const res = await request(app).get(`/api/projects/${projectFolder}/thumbnail/private.jpg`);
        assert.equal(res.status, 404);
      } finally {
        cleanup();
      }
    });
  });

  test('private thumbnails stream for authenticated admins', async () => {
    await withAuthEnv({}, async () => {
      const { projectFolder, cleanup } = seedVisibilityFixtures();
      const app = createTestApp();
      const token = tokenService.issueAccessToken({ sub: 'admin-test' });
      try {
        const res = await request(app)
          .get(`/api/projects/${projectFolder}/thumbnail/private.jpg`)
          .set('Authorization', `Bearer ${token}`);
        assert.equal(res.status, 200);
        assert.equal(res.headers['content-type'], 'image/jpeg');
        assert.ok(res.body.length > 0);
      } finally {
        cleanup();
      }
    });
  });

  test('POST /api/photos/visibility updates visibility when authorized', async () => {
    await withAuthEnv({}, async () => {
      const { projectFolder, privatePhotoId, cleanup } = seedVisibilityFixtures();
      const app = createTestApp();
      const token = tokenService.issueAccessToken({ sub: 'admin-test' });
      try {
        const res = await request(app)
          .post('/api/photos/visibility')
          .set('Authorization', `Bearer ${token}`)
          .send({ items: [{ photo_id: privatePhotoId, visibility: 'public' }] });

        assert.equal(res.status, 200);
        assert.equal(res.body.updated, 1);

        const row = getDb().prepare('SELECT visibility FROM photos WHERE id = ?').get(privatePhotoId);
        assert.equal(row.visibility, 'public');
      } finally {
        cleanup();
      }
    });
  });

  test('public thumbnails reject missing hash', async () => {
    await withAuthEnv({}, async () => {
      const { projectFolder, cleanup } = seedVisibilityFixtures();
      const app = createTestApp();
      try {
        const res = await request(app).get(`/api/projects/${projectFolder}/thumbnail/public.jpg`);
        assert.equal(res.status, 401);
        assert.equal(res.body?.reason, 'missing');
      } finally {
        cleanup();
      }
    });
  });

  test('public thumbnails reject invalid hash', async () => {
    await withAuthEnv({}, async () => {
      const { projectFolder, cleanup } = seedVisibilityFixtures();
      const app = createTestApp();
      try {
        const res = await request(app).get(`/api/projects/${projectFolder}/thumbnail/public.jpg?hash=${encodeURIComponent('not-a-valid-hash')}`);
        assert.equal(res.status, 401);
        assert.equal(res.body?.reason, 'mismatch');
      } finally {
        cleanup();
      }
    });
  });

  test('GET /api/projects/image/:filename responds with public metadata', async () => {
    await withAuthEnv({}, async () => {
      const { projectFolder, cleanup } = seedVisibilityFixtures();
      const app = createTestApp();
      try {
        const res = await request(app).get(`/api/projects/image/public.jpg`);
        assert.equal(res.status, 200);
        assert.equal(res.body?.photo?.project_folder, projectFolder);
        assert.equal(typeof res.body?.photo?.hash, 'string');
        assert.equal(res.body?.photo?.visibility, 'public');
        assert.equal(typeof res.body?.assets?.thumbnail_url, 'string');
      } finally {
        cleanup();
      }
    });
  });

  test('GET /api/projects/image/:filename enforces visibility', async () => {
    await withAuthEnv({}, async () => {
      const { cleanup } = seedVisibilityFixtures();
      const app = createTestApp();
      try {
        const res = await request(app).get(`/api/projects/image/private.jpg`);
        assert.equal(res.status, 401);
        assert.equal(res.body?.visibility, 'private');
      } finally {
        cleanup();
      }
    });
  });

  test('rotateDueHashes refreshes expired hashes', async () => {
    await withAuthEnv({}, async () => {
      const { publicPhotoId, cleanup } = seedVisibilityFixtures();
      const originalNow = new Date('2025-01-01T00:00:00.000Z');
      const lateNow = new Date('2025-02-15T00:00:00.000Z');
      publicAssetHashes.__setNowProvider(() => originalNow);
      const initialRecord = publicAssetHashes.ensureHashForPhoto(publicPhotoId, { force: true });
      assert.ok(initialRecord?.hash);

      publicAssetHashes.__setNowProvider(() => lateNow);
      const rotatedCount = publicAssetHashes.rotateDueHashes(lateNow);
      const refreshed = publicAssetHashes.getActiveHash(publicPhotoId);

      try {
        assert.equal(rotatedCount, 1);
        assert.ok(refreshed?.hash);
        assert.notEqual(refreshed.hash, initialRecord.hash);
        assert.ok(new Date(refreshed.expires_at).getTime() > lateNow.getTime());
      } finally {
        publicAssetHashes.__setNowProvider(() => new Date());
        cleanup();
      }
    });
  });
});
