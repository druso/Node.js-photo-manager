const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const path = require('node:path');
const fs = require('fs-extra');

const { withAuthEnv, loadFresh } = require('../../services/auth/__tests__/testUtils');
const { getDb } = require('../../services/db');

function loadRel(modulePath) {
  return loadFresh(path.join(__dirname, modulePath));
}

const PROJECTS_ROOT = path.join(__dirname, '../../..', '.projects', 'user_0');

describe('project commit handlers', { concurrency: false }, () => {
  let cleanupFns;

  beforeEach(() => {
    cleanupFns = [];
    fs.ensureDirSync(PROJECTS_ROOT);
  });

  afterEach(() => {
    for (const fn of cleanupFns.reverse()) {
      try { fn(); } catch {}
    }
    cleanupFns = [];
  });

  function seedProject({ folder, name, photos }) {
    const db = getDb();
    const ts = new Date().toISOString();

    const insertProject = db.prepare(`
      INSERT INTO projects (project_folder, project_name, created_at, updated_at, schema_version, status, archived_at)
      VALUES (?, ?, ?, ?, NULL, NULL, NULL)
    `);
    const projectInfo = insertProject.run(folder, name, ts, ts);
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
        jpg_available,
        raw_available,
        other_available,
        keep_jpg,
        keep_raw,
        thumbnail_status,
        preview_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const photoRecords = photos.map((photo, index) => {
      const manifestId = `${projectId}:${photo.filename}`;
      const now = new Date(Date.now() + index).toISOString();
      const info = insertPhoto.run(
        projectId,
        manifestId,
        photo.filename,
        path.parse(photo.filename).name,
        path.extname(photo.filename),
        now,
        now,
        photo.jpg_available ? 1 : 0,
        photo.raw_available ? 1 : 0,
        0,
        photo.keep_jpg ? 1 : 0,
        photo.keep_raw ? 1 : 0,
        photo.thumbnail_status || 'generated',
        photo.preview_status || 'generated'
      );
      return {
        id: info.lastInsertRowid,
        filename: photo.filename,
      };
    });

    const projectDir = path.join(PROJECTS_ROOT, folder);
    fs.ensureDirSync(projectDir);
    cleanupFns.push(() => {
      const dbCleanup = getDb();
      dbCleanup.prepare('DELETE FROM photos WHERE project_id = ?').run(projectId);
      dbCleanup.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      fs.removeSync(projectDir);
    });

    return { projectId, projectDir, photoRecords };
  }

  function createApp() {
    const app = express();
    const requestId = loadRel('../../middleware/requestId');
    const authenticateAdmin = loadRel('../../middleware/authenticateAdmin');
    const projectsRouter = loadRel('../projects');
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

    app.use('/api/projects', projectsRouter);
    app.use('/api', photosActionsRouter);

    return app;
  }

  test('global commit enqueues photo-set job with project hints', async () => {
    await withAuthEnv({}, async () => {
      const { projectId: projectIdA, photoRecords: photosA } = seedProject({
        folder: `commit-a-${Date.now()}`,
        name: 'Commit Project A',
        photos: [
          { filename: 'a-one.jpg', jpg_available: true, keep_jpg: false, keep_raw: false },
          { filename: 'a-two.jpg', jpg_available: true, keep_jpg: false, keep_raw: true },
        ],
      });

      const { projectId: projectIdB, photoRecords: photosB } = seedProject({
        folder: `commit-b-${Date.now()}`,
        name: 'Commit Project B',
        photos: [
          { filename: 'b-one.jpg', jpg_available: true, keep_jpg: false, keep_raw: false },
        ],
      });

      const jobsRepo = loadRel('../../services/repositories/jobsRepo');
      const originalEnqueueWithItems = jobsRepo.enqueueWithItems;
      const captured = [];
      jobsRepo.enqueueWithItems = function patched(options) {
        captured.push(options);
        return originalEnqueueWithItems.call(this, options);
      };
      cleanupFns.push(() => { jobsRepo.enqueueWithItems = originalEnqueueWithItems; });

      const app = createApp();

      const db = getDb();
      db.prepare('UPDATE photos SET keep_jpg = 0, keep_raw = 0 WHERE project_id IN (?, ?)').run(projectIdA, projectIdB);

      const tokenService = loadRel('../../services/auth/tokenService');
      const token = tokenService.issueAccessToken({ sub: 'admin-test' });

      const res = await request(app)
        .post('/api/photos/commit-changes')
        .set('Authorization', `Bearer ${token}`)
        .send({ projects: [] });

      assert.equal(res.status, 200);
      assert.equal(res.body.started, true);
      assert.ok(res.body.task_id, 'task id should be present');

      assert.equal(captured.length, 1);
      const [jobArgs] = captured;
      assert.equal(jobArgs.scope, 'photo_set');
      assert.ok(Array.isArray(jobArgs.items));

      const expectPhotoIds = new Set([...photosA, ...photosB].map(p => p.id));
      for (const item of jobArgs.items) {
        assert.ok(expectPhotoIds.has(item.photo_id), `unexpected photo id ${item.photo_id}`);
        assert.ok(item.project_id, 'project_id hint missing');
        assert.ok(item.project_folder, 'project_folder hint missing');
        assert.ok(item.project_name, 'project_name hint missing');
        expectPhotoIds.delete(item.photo_id);
      }
      assert.equal(expectPhotoIds.size, 0, 'all photos should be enqueued exactly once');
    });
  });
});
