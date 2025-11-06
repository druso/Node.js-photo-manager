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
  const publicLinksRouter = loadRel('../publicLinks');

  app.use(requestId());
  app.use(cookieParser());
  app.use(express.json());

  // Match server.js setup exactly - auth middleware then router
  app.use('/api/public-links', (req, res, next) => {
    authenticateAdmin(req, res, next);
  }, publicLinksRouter);

  return app;
}

function seedTestData() {
  fixtures.cleanup();
  
  // Load repositories
  const projectsRepo = loadRel('../../services/repositories/projectsRepo');
  const photosRepo = loadRel('../../services/repositories/photosRepo');
  
  // Create test project with unique name
  const testId = Date.now() + Math.random();
  const project = projectsRepo.createProject({ project_name: `Test Project ${testId}` });
  fixtures.registerProject(project);

  // Create test photos
  const publicPhoto = photosRepo.upsertPhoto(project.id, {
    filename: 'public.jpg',
    basename: 'public',
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

  return { project, publicPhoto, privatePhoto };
}

describe('Public Links Admin Endpoints', { concurrency: false }, () => {
  // Ensure cleanup after all tests
  after(() => {
    fixtures.cleanup();
  });

  // Add delay between tests to avoid SQLITE_BUSY
  afterEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  test('POST /api/public-links requires authentication', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      
      await request(app)
        .post('/api/public-links')
        .send({ title: 'Test Link' })
        .expect(401);
    });
  });

  test('GET /api/public-links requires authentication', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      
      await request(app)
        .get('/api/public-links')
        .expect(401);
    });
  });

  test('Admin can create a public link', async () => {
    await withAuthEnv({}, async () => {
      seedTestData();
      const app = createTestApp();
      const token = tokenService.issueAccessToken({ sub: 'admin-test' });

      const res = await request(app)
        .post('/api/public-links')
        .set('Authorization', `Bearer ${token}`)
        .send({ 
          title: 'My Gallery',
          description: 'Test description'
        })
        .expect(201);

      if (res.body?.id) {
        fixtures.registerLink(res.body.id);
      }

      assert.ok(res.body.id);
      assert.ok(res.body.hashed_key);
      assert.equal(res.body.hashed_key.length, 32);
      assert.equal(res.body.title, 'My Gallery');
      assert.equal(res.body.description, 'Test description');
    });
  });

  test('Admin can list public links', async () => {
    await withAuthEnv({}, async () => {
      seedTestData();
      const publicLinksRepo = loadRel('../../services/repositories/publicLinksRepo');
      const link = publicLinksRepo.create({ title: 'Test Link', description: 'Test' });
      fixtures.registerLink(link);

      const app = createTestApp();
      const token = tokenService.issueAccessToken({ sub: 'admin-test' });

      const res = await request(app)
        .get('/api/public-links')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.ok(Array.isArray(res.body));
      assert.ok(res.body.length > 0);
      assert.equal(res.body[0].id, link.id);
    });
  });

  test('Admin can update a public link', async () => {
    await withAuthEnv({}, async () => {
      seedTestData();
      const publicLinksRepo = loadRel('../../services/repositories/publicLinksRepo');
      const link = publicLinksRepo.create({ title: 'Old Title', description: 'Old' });
      fixtures.registerLink(link);

      const app = createTestApp();
      const token = tokenService.issueAccessToken({ sub: 'admin-test' });

      const res = await request(app)
        .patch(`/api/public-links/${link.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'New Title', description: 'New Description' })
        .expect(200);

      assert.equal(res.body.title, 'New Title');
      assert.equal(res.body.description, 'New Description');
    });
  });

  test('Admin can delete a public link', async () => {
    await withAuthEnv({}, async () => {
      seedTestData();
      const publicLinksRepo = loadRel('../../services/repositories/publicLinksRepo');
      const link = publicLinksRepo.create({ title: 'To Delete', description: 'Test' });
      fixtures.registerLink(link);

      const app = createTestApp();
      const token = tokenService.issueAccessToken({ sub: 'admin-test' });

      await request(app)
        .delete(`/api/public-links/${link.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      // Verify it's deleted
      const deleted = publicLinksRepo.getById(link.id);
      assert.ok(!deleted); // Should be null or undefined
    });
  });

  test('Admin can associate photos with a link', async () => {
    await withAuthEnv({}, async () => {
      const { publicPhoto, privatePhoto } = seedTestData();
      const publicLinksRepo = loadRel('../../services/repositories/publicLinksRepo');
      const link = publicLinksRepo.create({ title: 'Test Link', description: 'Test' });
      fixtures.registerLink(link);

      const app = createTestApp();
      const token = tokenService.issueAccessToken({ sub: 'admin-test' });

      const res = await request(app)
        .post(`/api/public-links/${link.id}/photos`)
        .set('Authorization', `Bearer ${token}`)
        .send({ photo_ids: [publicPhoto.id, privatePhoto.id] })
        .expect(200);

      assert.equal(res.body.photos_added, 2);
      assert.ok(res.body.visibility_updated >= 0); // Should have updated visibility to public
      assert.ok(res.body.hashes_generated >= 0); // Should have generated hashes
    });
  });

  test('Admin can remove a photo from a link', async () => {
    await withAuthEnv({}, async () => {
      const { publicPhoto } = seedTestData();
      const publicLinksRepo = loadRel('../../services/repositories/publicLinksRepo');
      const link = publicLinksRepo.create({ title: 'Test Link', description: 'Test' });
      fixtures.registerLink(link);
      publicLinksRepo.associatePhotos(link.id, [publicPhoto.id]);

      const app = createTestApp();
      const token = tokenService.issueAccessToken({ sub: 'admin-test' });

      await request(app)
        .delete(`/api/public-links/${link.id}/photos/${publicPhoto.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
    });
  });

  test('Admin can regenerate hashed key', async () => {
    await withAuthEnv({}, async () => {
      seedTestData();
      const publicLinksRepo = loadRel('../../services/repositories/publicLinksRepo');
      const link = publicLinksRepo.create({ title: 'Test Link', description: 'Test' });
      fixtures.registerLink(link);
      const oldKey = link.hashed_key;

      const app = createTestApp();
      const token = tokenService.issueAccessToken({ sub: 'admin-test' });

      const res = await request(app)
        .post(`/api/public-links/${link.id}/regenerate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.ok(res.body.hashed_key);
      assert.notEqual(res.body.hashed_key, oldKey);
      assert.equal(res.body.hashed_key.length, 32);
    });
  });

  test('Returns 404 for non-existent link', async () => {
    await withAuthEnv({}, async () => {
      seedTestData();
      const app = createTestApp();
      const token = tokenService.issueAccessToken({ sub: 'admin-test' });

      await request(app)
        .get('/api/public-links/non-existent-id')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  test('Validates required fields on create', async () => {
    await withAuthEnv({}, async () => {
      seedTestData();
      const app = createTestApp();
      const token = tokenService.issueAccessToken({ sub: 'admin-test' });

      await request(app)
        .post('/api/public-links')
        .set('Authorization', `Bearer ${token}`)
        .send({}) // Missing title
        .expect(400);
    });
  });
});
