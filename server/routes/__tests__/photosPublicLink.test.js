const { describe, test, after, afterEach } = require('node:test');
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

function loadRel(modulePath) {
  return loadFresh(path.join(__dirname, modulePath));
}

function createTestApp() {
  const app = express();
  const requestId = loadRel('../../middleware/requestId');
  const authenticateAdmin = loadRel('../../middleware/authenticateAdmin');
  const photosRouter = loadRel('../photos');

  app.use(requestId());
  app.use(cookieParser());
  app.use(express.json());

  // Attach admin context when a valid token is present (mirrors server.js behavior)
  app.use((req, _res, next) => {
    if (typeof authenticateAdmin.attachAdminToRequest === 'function') {
      authenticateAdmin.attachAdminToRequest(req);
    }
    next();
  });

  app.use('/api', photosRouter);

  return app;
}

const createdData = {
  projectIds: [],
  projectFolders: [],
  linkIds: [],
};

function cleanupTestData() {
  const db = getDb();

  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    // Ignore
  }

  const maxRetries = 5;
  let retries = 0;
  while (retries < maxRetries) {
    try {
      if (createdData.linkIds.length > 0) {
        const placeholders = createdData.linkIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM photo_public_links WHERE public_link_id IN (${placeholders})`).run(...createdData.linkIds);
        db.prepare(`DELETE FROM public_links WHERE id IN (${placeholders})`).run(...createdData.linkIds);
      }

      if (createdData.projectIds.length > 0) {
        const placeholders = createdData.projectIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM photo_public_hashes WHERE photo_id IN (SELECT id FROM photos WHERE project_id IN (${placeholders}))`).run(...createdData.projectIds);
        db.prepare(`DELETE FROM photos WHERE project_id IN (${placeholders})`).run(...createdData.projectIds);
        db.prepare(`DELETE FROM projects WHERE id IN (${placeholders})`).run(...createdData.projectIds);
      }

      break;
    } catch (err) {
      if (err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_BUSY_SNAPSHOT') {
        retries += 1;
        if (retries < maxRetries) {
          const delay = 50 * Math.pow(2, retries);
          const start = Date.now();
          while (Date.now() - start < delay) {
            // busy wait
          }
        } else {
          console.error('Cleanup failed after retries:', err.message);
        }
      } else {
        throw err;
      }
    }
  }

  if (fs.existsSync(PROJECTS_ROOT)) {
    for (const folder of createdData.projectFolders) {
      const projectDir = path.join(PROJECTS_ROOT, folder);
      try {
        if (fs.existsSync(projectDir)) {
          fs.removeSync(projectDir);
        }
      } catch (err) {
        // Ignore
      }
    }
  }

  createdData.projectIds = [];
  createdData.projectFolders = [];
  createdData.linkIds = [];
}

function seedTestData() {
  cleanupTestData();

  const projectsRepo = loadRel('../../services/repositories/projectsRepo');
  const photosRepo = loadRel('../../services/repositories/photosRepo');
  const publicLinksRepo = loadRel('../../services/repositories/publicLinksRepo');

  const ts = Date.now() + Math.random();
  const project = projectsRepo.createProject({ project_name: `Photos Public Link Test ${ts}` });
  createdData.projectIds.push(project.id);
  createdData.projectFolders.push(project.project_folder);

  const publicLinkedPhoto = photosRepo.upsertPhoto(project.id, {
    filename: 'public-linked.jpg',
    basename: 'public-linked',
    ext: '.jpg',
    visibility: 'public',
    jpg_available: true,
    raw_available: false,
    other_available: false,
    keep_jpg: 'keep',
    keep_raw: null,
    keep_other: null,
  });

  const privateLinkedPhoto = photosRepo.upsertPhoto(project.id, {
    filename: 'private-linked.jpg',
    basename: 'private-linked',
    ext: '.jpg',
    visibility: 'private',
    jpg_available: true,
    raw_available: false,
    other_available: false,
    keep_jpg: 'keep',
    keep_raw: null,
    keep_other: null,
  });

  const excludedPhoto = photosRepo.upsertPhoto(project.id, {
    filename: 'excluded.jpg',
    basename: 'excluded',
    ext: '.jpg',
    visibility: 'public',
    jpg_available: true,
    raw_available: false,
    other_available: false,
    keep_jpg: 'keep',
    keep_raw: null,
    keep_other: null,
  });

  const link = publicLinksRepo.create({ title: 'Filter Test Link', description: 'Test description' });
  createdData.linkIds.push(link.id);

  publicLinksRepo.associatePhotos(link.id, [publicLinkedPhoto.id, privateLinkedPhoto.id]);

  return {
    project,
    publicPhotoId: publicLinkedPhoto.id,
    privatePhotoId: privateLinkedPhoto.id,
    excludedId: excludedPhoto.id,
    link,
  };
}

describe('GET /api/photos with public_link_id filter', { concurrency: false }, () => {
  after(() => {
    cleanupTestData();
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  test('returns only photos associated with the public link', async () => {
    await withAuthEnv({}, async () => {
      const { publicPhotoId, privatePhotoId, excludedId, link } = seedTestData();
      const app = createTestApp();

      const res = await request(app)
        .get(`/api/photos?public_link_id=${link.hashed_key}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.items), 'items array is present');
      const returnedIds = res.body.items.map((item) => item.id);

      assert(returnedIds.includes(publicPhotoId), 'response should include public linked photo');
      assert(!returnedIds.includes(privatePhotoId), 'response should exclude private linked photo for public request');
      assert(!returnedIds.includes(excludedId), 'response should exclude photos not in the link');
      assert.equal(res.body.total, 1, 'total should reflect only public linked photo');
      assert.ok(res.body.items.every((item) => item.visibility === 'public'), 'all returned photos should be public');
    });
  });

  test('admin can see private linked photos', async () => {
    await withAuthEnv({}, async () => {
      const { publicPhotoId, privatePhotoId, excludedId, link } = seedTestData();
      const app = createTestApp();
      const token = tokenService.issueAccessToken({ sub: 'admin-test' });

      const res = await request(app)
        .get(`/api/photos?public_link_id=${link.hashed_key}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const returnedIds = res.body.items.map((item) => item.id);
      assert(returnedIds.includes(publicPhotoId), 'admin response should include public photo');
      assert(returnedIds.includes(privatePhotoId), 'admin response should include private photo');
      assert(!returnedIds.includes(excludedId), 'admin response should exclude non-linked photo');
    });
  });

  test('returns 404 for unknown public link hash', async () => {
    await withAuthEnv({}, async () => {
      seedTestData();
      const app = createTestApp();

      await request(app)
        .get('/api/photos?public_link_id=does_not_exist_hash_aaaaaaaaaaaaaa')
        .expect(404);
    });
  });
});
