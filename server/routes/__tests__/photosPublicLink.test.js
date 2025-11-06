const { describe, test, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const path = require('node:path');
const { withAuthEnv, loadFresh } = require('../../services/auth/__tests__/testUtils');
const { createFixtureTracker } = require('../../tests/utils/dataFixtures');
const tokenService = require('../../services/auth/tokenService');

function loadRel(modulePath) {
  return loadFresh(path.join(__dirname, modulePath));
}

const fixtures = createFixtureTracker();

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

function seedTestData() {
  fixtures.cleanup();

  const projectsRepo = loadRel('../../services/repositories/projectsRepo');
  const photosRepo = loadRel('../../services/repositories/photosRepo');
  const publicLinksRepo = loadRel('../../services/repositories/publicLinksRepo');

  const ts = Date.now() + Math.random();
  const project = projectsRepo.createProject({ project_name: `Photos Public Link Test ${ts}` });
  fixtures.registerProject(project);

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
  fixtures.registerLink(link);

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
    fixtures.cleanup();
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
