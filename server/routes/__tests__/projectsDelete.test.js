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

describe('Project Deletion', { concurrency: false }, () => {
  let fixtures;
  let orchestrator;
  let originalStartTask;
  let startCalls;
  let jobsRepo;
  let originalCancelByProject;
  let canceledProjects;

  beforeEach(() => {
    fixtures = createFixtureTracker();
    orchestrator = loadRel('../../services/tasksOrchestrator');
    originalStartTask = orchestrator.startTask;
    startCalls = [];
    orchestrator.startTask = (payload) => {
      startCalls.push(payload);
      return { task_id: `task-${startCalls.length}`, first_job_id: `job-${startCalls.length}`, job_count: 1, chunked: false };
    };

    jobsRepo = loadRel('../../services/repositories/jobsRepo');
    originalCancelByProject = jobsRepo.cancelByProject;
    canceledProjects = [];
    jobsRepo.cancelByProject = (projectId) => {
      canceledProjects.push(projectId);
    };
  });

  afterEach(() => {
    orchestrator.startTask = originalStartTask;
    jobsRepo.cancelByProject = originalCancelByProject;
    fixtures.cleanup();
  });

  function createTestApp() {
    const app = express();
    const requestId = loadRel('../../middleware/requestId');
    const authenticateAdmin = loadRel('../../middleware/authenticateAdmin');
    const projectsRouter = loadRel('../projects');

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
    return app;
  }

  function issueToken() {
    return tokenService.issueAccessToken({ sub: 'admin-test' });
  }

  function createProject(name = 'Delete Me') {
    const projectsRepo = loadRel('../../services/repositories/projectsRepo');
    const project = projectsRepo.createProject({ project_name: name });
    fixtures.registerProject(project);
    return project;
  }

  test('queues deletion task and cancels jobs', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();
      const project = createProject('Project To Delete');

      const res = await request(app)
        .delete(`/api/projects/${project.id}`)
        .set('Authorization', `Bearer ${token}`);

      assert.equal(res.status, 200);
      assert.equal(res.body.message, 'Project deletion queued');
      assert.equal(res.body.folder, project.project_folder);

      assert.deepEqual(canceledProjects, [project.id]);
      assert.equal(startCalls.length, 1);
      assert.deepEqual(startCalls[0], {
        project_id: project.id,
        type: 'project_delete',
        source: 'user',
        items: null,
        tenant_id: 'user_0',
      });
    });
  });

  test('validates id parameter', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const token = issueToken();

      const res = await request(app)
        .delete('/api/projects/not-a-number')
        .set('Authorization', `Bearer ${token}`);

      assert.equal(res.status, 400);
      assert.match(res.body.error, /invalid project id/i);
    });
  });

  test('requires authentication', async () => {
    await withAuthEnv({}, async () => {
      const app = createTestApp();
      const project = createProject('Needs Auth');

      const res = await request(app)
        .delete(`/api/projects/${project.id}`);

      assert.equal(res.status, 401);
    });
  });
});
