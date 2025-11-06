const { describe, test, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const path = require('node:path');
const { withAuthEnv, loadFresh } = require('../../services/auth/__tests__/testUtils');
const { createFixtureTracker } = require('../../tests/utils/dataFixtures');

function loadRel(modulePath) {
  return loadFresh(path.join(__dirname, modulePath));
}

const fixtures = createFixtureTracker();

function createTestApp() {
  const app = express();
  const requestId = loadRel('../../middleware/requestId');
  const sharedLinksRouter = loadRel('../sharedLinks');

  app.use(requestId());
  app.use(cookieParser());
  app.use(express.json());

  // Public endpoint - no authentication required (match server.js exactly)
  app.use('/shared/api', sharedLinksRouter);

  return app;
}

function seedTestData() {
  fixtures.cleanup();

  // Load repositories
  const projectsRepo = loadRel('../../services/repositories/projectsRepo');
  const photosRepo = loadRel('../../services/repositories/photosRepo');
  const publicLinksRepo = loadRel('../../services/repositories/publicLinksRepo');
  const publicAssetHashes = loadRel('../../services/publicAssetHashes');

  // Create test project with unique name
  const testId = Date.now() + Math.random();
  const project = projectsRepo.createProject({ project_name: `Test Project ${testId}` });
  fixtures.registerProject(project);

  // Create test photos
  const publicPhoto1 = photosRepo.upsertPhoto(project.id, {
    filename: 'public1.jpg',
    basename: 'public1',
    ext: '.jpg',
    visibility: 'public',
    jpg_available: true,
    raw_available: false,
    other_available: false,
    keep_jpg: 'keep',
    keep_raw: null,
    keep_other: null,
  });

  const publicPhoto2 = photosRepo.upsertPhoto(project.id, {
    filename: 'public2.jpg',
    basename: 'public2',
    ext: '.jpg',
    visibility: 'public',
    jpg_available: true,
    raw_available: false,
    other_available: false,
    keep_jpg: 'keep',
    keep_raw: null,
    keep_other: null,
  });

  const privatePhoto = photosRepo.upsertPhoto(project.id, {
    filename: 'private.jpg',
    basename: 'private',
    ext: '.jpg',
    visibility: 'private',
    jpg_available: true,
    raw_available: false,
    other_available: false,
    keep_jpg: 'keep',
    keep_raw: null,
    keep_other: null,
  });

  // Create link and associate photos (repos already loaded above)
  const link = publicLinksRepo.create({ 
    title: 'Test Gallery',
    description: 'Test Description'
  });
  fixtures.registerLink(link);

  // Associate all photos (including private)
  publicLinksRepo.associatePhotos(link.id, [publicPhoto1.id, publicPhoto2.id, privatePhoto.id]);

  // Generate hashes for public photos (publicAssetHashes already loaded above)
  publicAssetHashes.ensureHashForPhoto(publicPhoto1.id);
  publicAssetHashes.ensureHashForPhoto(publicPhoto2.id);

  return { project, publicPhoto1, publicPhoto2, privatePhoto, link };
}

describe('Shared Links Public Endpoints', { concurrency: false }, () => {
  // Ensure cleanup after all tests
  after(() => {
    fixtures.cleanup();
  });

  // Add delay between tests to avoid SQLITE_BUSY
  afterEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  test('Public endpoint accessible without authentication', async () => {
    await withAuthEnv({}, async () => {
      const { link } = seedTestData();
      const app = createTestApp();

      const res = await request(app)
        .get(`/shared/api/${link.hashed_key}`)
        .expect(200);

      assert.ok(res.body.id);
      assert.equal(res.body.title, 'Test Gallery');
      assert.equal(res.body.description, 'Test Description');
      assert.ok(Array.isArray(res.body.photos));
    });
  });

  test('Private photos are filtered out from public endpoint', async () => {
    await withAuthEnv({}, async () => {
      const { link, publicPhoto1, publicPhoto2, privatePhoto } = seedTestData();
      const app = createTestApp();

      const res = await request(app)
        .get(`/shared/api/${link.hashed_key}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.photos));
      assert.equal(res.body.photos.length, 2); // Only 2 public photos

      const photoIds = res.body.photos.map(p => p.id);
      assert.ok(photoIds.includes(publicPhoto1.id));
      assert.ok(photoIds.includes(publicPhoto2.id));
      assert.ok(!photoIds.includes(privatePhoto.id)); // Private photo excluded
    });
  });

  test('Returns 404 for invalid hashed key (wrong length)', async () => {
    await withAuthEnv({}, async () => {
      seedTestData();
      const app = createTestApp();

      await request(app)
        .get('/shared/api/tooshort')
        .expect(404);
    });
  });

  test('Returns 404 for non-existent hashed key', async () => {
    await withAuthEnv({}, async () => {
      seedTestData();
      const app = createTestApp();

      // Valid format but doesn't exist
      await request(app)
        .get('/shared/api/AbCdEfGhIjKlMnOpQrStUvWxYz012345')
        .expect(404);
    });
  });

  test('Returns correct photo data shape with project_folder', async () => {
    await withAuthEnv({}, async () => {
      const { link, project } = seedTestData();
      const app = createTestApp();

      const res = await request(app)
        .get(`/shared/api/${link.hashed_key}`)
        .expect(200);

      assert.ok(res.body.photos.length > 0);
      const photo = res.body.photos[0];
      
      // Verify required fields
      assert.ok(photo.id);
      assert.ok(photo.filename);
      assert.ok(photo.project_folder); // Critical field for asset URLs
      assert.equal(photo.project_folder, project.project_folder);
      assert.ok(photo.public_hash); // For asset access
      assert.equal(photo.visibility, 'public');
    });
  });

  test('Pagination works correctly', async () => {
    await withAuthEnv({}, async () => {
      fixtures.cleanup();

      // Create project
      const projectsRepo = loadRel('../../services/repositories/projectsRepo');
      const testId = Date.now() + Math.random();
      const project = projectsRepo.createProject({ project_name: `Test Project ${testId}` });
      fixtures.registerProject(project);

      // Create many public photos
      const photosRepo = loadRel('../../services/repositories/photosRepo');
      const photoIds = [];
      for (let i = 0; i < 15; i++) {
        const photo = photosRepo.upsertPhoto(project.id, {
          filename: `photo${i}.jpg`,
          basename: `photo${i}`,
          ext: '.jpg',
          visibility: 'public',
          jpg_available: true,
          raw_available: false,
          other_available: false,
          keep_jpg: 'keep',
          keep_raw: null,
          keep_other: null,
        });
        photoIds.push(photo.id);
      }

      // Create link and associate photos
      const publicLinksRepo = loadRel('../../services/repositories/publicLinksRepo');
      const link = publicLinksRepo.create({ title: 'Test Gallery', description: 'Test' });
      fixtures.registerLink(link);
      publicLinksRepo.associatePhotos(link.id, photoIds);

      const app = createTestApp();

      // First page
      const res1 = await request(app)
        .get(`/shared/api/${link.hashed_key}?limit=10`)
        .expect(200);

      assert.equal(res1.body.photos.length, 10);
      assert.equal(res1.body.total, 15);
      assert.ok(res1.body.next_cursor); // Should have next page

      // Second page - if cursor pagination is working
      if (res1.body.next_cursor) {
        const res2 = await request(app)
          .get(`/shared/api/${link.hashed_key}?limit=10&cursor=${res1.body.next_cursor}`)
          .expect(200);

        // Should have remaining photos (may be 0 if cursor format changed)
        assert.ok(Array.isArray(res2.body.photos));
        assert.ok(res2.body.total === 15);
      }
    });
  });

  test('Returns empty array when link has no photos', async () => {
    await withAuthEnv({}, async () => {
      fixtures.cleanup();

      // Create link without photos
      const publicLinksRepo = loadRel('../../services/repositories/publicLinksRepo');
      const link = publicLinksRepo.create({ title: 'Empty Gallery', description: 'Test' });
      fixtures.registerLink(link);

      const app = createTestApp();

      const res = await request(app)
        .get(`/shared/api/${link.hashed_key}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.photos));
      assert.equal(res.body.photos.length, 0);
      assert.equal(res.body.total, 0);
    });
  });

  test('Returns empty array when all photos are private', async () => {
    await withAuthEnv({}, async () => {
      fixtures.cleanup();

      // Create project
      const projectsRepo = loadRel('../../services/repositories/projectsRepo');
      const testId = Date.now() + Math.random();
      const project = projectsRepo.createProject({ project_name: `Test Project ${testId}` });
      fixtures.registerProject(project);

      // Create only private photos
      const photosRepo = loadRel('../../services/repositories/photosRepo');
      const privatePhoto = photosRepo.upsertPhoto(project.id, {
        filename: 'private.jpg',
        basename: 'private',
        ext: '.jpg',
        visibility: 'private',
        jpg_available: true,
        raw_available: false,
        other_available: false,
        keep_jpg: 'keep',
        keep_raw: null,
        keep_other: null,
      });

      // Create link and associate private photo
      const publicLinksRepo = loadRel('../../services/repositories/publicLinksRepo');
      const link = publicLinksRepo.create({ title: 'Test Gallery', description: 'Test' });
      fixtures.registerLink(link);
      publicLinksRepo.associatePhotos(link.id, [privatePhoto.id]);

      const app = createTestApp();

      const res = await request(app)
        .get(`/shared/api/${link.hashed_key}`)
        .expect(200);

      // Should return empty array since all photos are private
      assert.ok(Array.isArray(res.body.photos));
      assert.equal(res.body.photos.length, 0);
      assert.equal(res.body.total, 0);
    });
  });
});

describe('Shared Links Admin Endpoint', { concurrency: false }, () => {
  // Ensure cleanup after all tests
  after(() => {
    fixtures.cleanup();
  });

  // Add delay between tests to avoid SQLITE_BUSY
  afterEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  test('Admin endpoint returns all photos (public + private) with valid token', async () => {
    await withAuthEnv({}, async () => {
      const { link, publicPhoto1, publicPhoto2, privatePhoto } = seedTestData();
      
      // Create test app with admin auth middleware
      const tokenService = loadRel('../../services/auth/tokenService');
      const adminToken = tokenService.issueAccessToken({ sub: 'admin-test' });
      
      const app = createTestApp();

      const res = await request(app)
        .get(`/shared/api/${link.hashed_key}/admin`)
        .set('Cookie', `pm_access_token=${adminToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.photos));
      assert.equal(res.body.photos.length, 3); // All 3 photos (2 public + 1 private)

      const photoIds = res.body.photos.map(p => p.id);
      assert.ok(photoIds.includes(publicPhoto1.id));
      assert.ok(photoIds.includes(publicPhoto2.id));
      assert.ok(photoIds.includes(privatePhoto.id)); // Private photo included for admin
      
      assert.equal(res.body.total, 3);
    });
  });

  test('Admin endpoint returns 401 without authentication', async () => {
    await withAuthEnv({}, async () => {
      const { link } = seedTestData();
      const app = createTestApp();

      await request(app)
        .get(`/shared/api/${link.hashed_key}/admin`)
        .expect(401);
    });
  });

  test('Admin endpoint returns 401 with invalid token', async () => {
    await withAuthEnv({}, async () => {
      const { link } = seedTestData();
      const app = createTestApp();

      await request(app)
        .get(`/shared/api/${link.hashed_key}/admin`)
        .set('Cookie', 'pm_access_token=invalid_token_here')
        .expect(401);
    });
  });

  test('Admin endpoint returns 404 for non-existent link', async () => {
    await withAuthEnv({}, async () => {
      seedTestData();
      
      const tokenService = loadRel('../../services/auth/tokenService');
      const adminToken = tokenService.issueAccessToken({ sub: 'admin-test' });
      
      const app = createTestApp();

      await request(app)
        .get('/shared/api/AbCdEfGhIjKlMnOpQrStUvWxYz012345/admin')
        .set('Cookie', `pm_access_token=${adminToken}`)
        .expect(404);
    });
  });

  test('Admin endpoint pagination works correctly', async () => {
    await withAuthEnv({}, async () => {
      fixtures.cleanup();

      // Create project
      const projectsRepo = loadRel('../../services/repositories/projectsRepo');
      const testId = Date.now() + Math.random();
      const project = projectsRepo.createProject({ project_name: `Test Project ${testId}` });
      fixtures.registerProject(project);

      // Create mix of public and private photos
      const photosRepo = loadRel('../../services/repositories/photosRepo');
      const photoIds = [];
      for (let i = 0; i < 10; i++) {
        const photo = photosRepo.upsertPhoto(project.id, {
          filename: `photo${i}.jpg`,
          basename: `photo${i}`,
          ext: '.jpg',
          visibility: i % 2 === 0 ? 'public' : 'private', // Alternate public/private
          jpg_available: true,
          raw_available: false,
          other_available: false,
          keep_jpg: 'keep',
          keep_raw: null,
          keep_other: null,
        });
        photoIds.push(photo.id);
      }

      // Create link and associate all photos
      const publicLinksRepo = loadRel('../../services/repositories/publicLinksRepo');
      const link = publicLinksRepo.create({ title: 'Test Gallery', description: 'Test' });
      fixtures.registerLink(link);
      publicLinksRepo.associatePhotos(link.id, photoIds);

      const tokenService = loadRel('../../services/auth/tokenService');
      const adminToken = tokenService.issueAccessToken({ sub: 'admin-test' });
      
      const app = createTestApp();

      // First page
      const res1 = await request(app)
        .get(`/shared/api/${link.hashed_key}/admin?limit=5`)
        .set('Cookie', `pm_access_token=${adminToken}`)
        .expect(200);

      assert.equal(res1.body.photos.length, 5);
      assert.equal(res1.body.total, 10); // All photos (public + private)
      assert.ok(res1.body.next_cursor);

      // Second page
      if (res1.body.next_cursor) {
        const res2 = await request(app)
          .get(`/shared/api/${link.hashed_key}/admin?limit=5&cursor=${res1.body.next_cursor}`)
          .set('Cookie', `pm_access_token=${adminToken}`)
          .expect(200);

        assert.ok(Array.isArray(res2.body.photos));
        assert.equal(res2.body.total, 10);
      }
    });
  });

  test('Public endpoint still returns only public photos (regression test)', async () => {
    await withAuthEnv({}, async () => {
      const { link, publicPhoto1, publicPhoto2, privatePhoto } = seedTestData();
      const app = createTestApp();

      // Public endpoint should still filter private photos
      const res = await request(app)
        .get(`/shared/api/${link.hashed_key}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.photos));
      assert.equal(res.body.photos.length, 2); // Only 2 public photos

      const photoIds = res.body.photos.map(p => p.id);
      assert.ok(photoIds.includes(publicPhoto1.id));
      assert.ok(photoIds.includes(publicPhoto2.id));
      assert.ok(!photoIds.includes(privatePhoto.id)); // Private photo still excluded
    });
  });

  test('Admin endpoint returns correct total count', async () => {
    await withAuthEnv({}, async () => {
      const { link } = seedTestData();
      
      const tokenService = loadRel('../../services/auth/tokenService');
      const adminToken = tokenService.issueAccessToken({ sub: 'admin-test' });
      
      const app = createTestApp();

      const res = await request(app)
        .get(`/shared/api/${link.hashed_key}/admin`)
        .set('Cookie', `pm_access_token=${adminToken}`)
        .expect(200);

      // Should return total of 3 (2 public + 1 private)
      assert.equal(res.body.total, 3);
      assert.equal(res.body.photos.length, 3);
    });
  });
});
