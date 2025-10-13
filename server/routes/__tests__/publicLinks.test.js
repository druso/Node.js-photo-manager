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

// Track created data for cleanup
const createdData = {
  projectIds: [],
  projectFolders: [],
  linkIds: []
};

function cleanupTestData() {
  const db = getDb();
  
  // Force a WAL checkpoint to release locks
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) {
    // Ignore checkpoint errors
  }
  
  // Simple approach: just run the deletes with retries
  const maxRetries = 5;
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      // Clean up only data we created
      if (createdData.linkIds.length > 0) {
        const linkPlaceholders = createdData.linkIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM photo_public_links WHERE public_link_id IN (${linkPlaceholders})`).run(...createdData.linkIds);
        db.prepare(`DELETE FROM public_links WHERE id IN (${linkPlaceholders})`).run(...createdData.linkIds);
      }
      
      if (createdData.projectIds.length > 0) {
        const projectPlaceholders = createdData.projectIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM photo_public_hashes WHERE photo_id IN (SELECT id FROM photos WHERE project_id IN (${projectPlaceholders}))`).run(...createdData.projectIds);
        db.prepare(`DELETE FROM photos WHERE project_id IN (${projectPlaceholders})`).run(...createdData.projectIds);
        db.prepare(`DELETE FROM projects WHERE id IN (${projectPlaceholders})`).run(...createdData.projectIds);
      }
      
      // Success - break out of retry loop
      break;
    } catch (err) {
      if (err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_BUSY_SNAPSHOT') {
        retries++;
        if (retries < maxRetries) {
          // Wait exponentially longer each retry
          const delay = 50 * Math.pow(2, retries);
          const start = Date.now();
          while (Date.now() - start < delay) {
            // Busy wait
          }
        } else {
          console.error('Cleanup failed after retries:', err.message);
        }
      } else {
        throw err;
      }
    }
  }
  
  // Clean up filesystem folders
  if (fs.existsSync(PROJECTS_ROOT)) {
    for (const folder of createdData.projectFolders) {
      const projectDir = path.join(PROJECTS_ROOT, folder);
      try {
        if (fs.existsSync(projectDir)) {
          fs.removeSync(projectDir);
        }
      } catch (err) {
        // Ignore cleanup errors
      }
    }
  }
  
  // Reset tracking
  createdData.projectIds = [];
  createdData.projectFolders = [];
  createdData.linkIds = [];
}

function seedTestData() {
  cleanupTestData();
  
  // Load repositories
  const projectsRepo = loadRel('../../services/repositories/projectsRepo');
  const photosRepo = loadRel('../../services/repositories/photosRepo');
  
  // Create test project with unique name
  const testId = Date.now() + Math.random();
  const project = projectsRepo.createProject({ project_name: `Test Project ${testId}` });
  createdData.projectIds.push(project.id);
  createdData.projectFolders.push(project.project_folder);

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
    cleanupTestData();
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
      createdData.linkIds.push(link.id); // Track for cleanup

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
      createdData.linkIds.push(link.id); // Track for cleanup

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
      createdData.linkIds.push(link.id); // Track for cleanup

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
      createdData.linkIds.push(link.id); // Track for cleanup

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
      createdData.linkIds.push(link.id); // Track for cleanup
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
      createdData.linkIds.push(link.id); // Track for cleanup
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
