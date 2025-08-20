const express = require('express');
const projectsRepo = require('../services/repositories/projectsRepo');
const tasksOrchestrator = require('../services/tasksOrchestrator');
const jobsRepo = require('../services/repositories/jobsRepo');
const fs = require('fs');
const path = require('path');
const { onJobUpdate } = require('../services/events');
const makeLogger = require('../utils/logger2');
const log = makeLogger('jobs');

const router = express.Router();
router.use(express.json());
const ipConnCounts = new Map(); // ip -> count
const MAX_SSE_PER_IP = Number(process.env.SSE_MAX_CONN_PER_IP || 2);

// POST /api/projects/:folder/jobs -> start a task for a project (no standalone jobs)
router.post('/projects/:folder/jobs', (req, res) => {
  try {
    const { folder } = req.params;
    const { task_type, source, items } = req.body || {};
    if (!task_type) return res.status(400).json({ error: 'task_type is required (tasks-only API)' });
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const start = tasksOrchestrator.startTask({ project_id: project.id, type: task_type, source: source || 'api', items: Array.isArray(items) ? items : null });
    return res.status(202).json({ task: start });
  } catch (err) {
    log.error('enqueue_task_failed', { project_folder: req.params && req.params.folder, task_type, error: err && err.message, stack: err && err.stack });
    return res.status(500).json({ error: 'Failed to start task' });
  }
});

// GET /api/projects/:folder/jobs -> list jobs for a project
router.get('/projects/:folder/jobs', (req, res) => {
  try {
    const { folder } = req.params;
    const { status, type, limit, offset } = req.query;
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const jobs = jobsRepo.listByProject(project.id, {
      status: status || undefined,
      type: type || undefined,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
    return res.json({ jobs });
  } catch (err) {
    log.error('list_jobs_failed', { project_folder: req.params && req.params.folder, error: err && err.message, stack: err && err.stack });
    return res.status(500).json({ error: 'Failed to list jobs' });
  }
});

// GET /api/jobs/stream -> SSE for job updates (declare before :id route)
router.get('/jobs/stream', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const current = ipConnCounts.get(ip) || 0;
  if (current >= MAX_SSE_PER_IP) {
    return res.status(429).json({ error: 'Too many SSE connections from this IP' });
  }
  ipConnCounts.set(ip, current + 1);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  const send = (data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (_) {
      // ignore
    }
  };

  const off = onJobUpdate(send);
  // Heartbeat every 25s to keep intermediaries alive
  const heartbeat = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch (_) {}
  }, 25 * 1000);

  // Idle timeout: close after 5 minutes to prevent pinned resources
  const idleTimeoutMs = Number(process.env.SSE_IDLE_TIMEOUT_MS || (5 * 60 * 1000));
  const idleTimer = setTimeout(() => {
    try { res.write(`event: bye\ndata: {"reason":"idle_timeout"}\n\n`); } catch (_) {}
    try { res.end(); } catch (_) {}
  }, idleTimeoutMs);

  function cleanup() {
    clearInterval(heartbeat);
    clearTimeout(idleTimer);
    off();
    const cur = ipConnCounts.get(ip) || 1;
    if (cur <= 1) ipConnCounts.delete(ip); else ipConnCounts.set(ip, cur - 1);
  }

  req.on('close', cleanup);

  // initial heartbeat and hello
  try { res.write(`: ping\n\n`); } catch (_) {}
  send({ type: 'hello' });
});

// GET /api/jobs/:id -> job details (including items summary)
// Avoid regex patterns for Express 5 path-to-regexp; validate numerically inside
router.get('/jobs/:id', (req, res) => {
  try {
    const idRaw = req.params.id;
    // If not a numeric id, treat as not found to avoid collision with other routes
    if (!/^\d+$/.test(idRaw)) return res.status(404).json({ error: 'Job not found' });
    const id = Number(idRaw);
    const job = jobsRepo.getById(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const items = jobsRepo.listItems(id) || [];
    const summary = items.reduce((acc, it) => {
      acc[it.status] = (acc[it.status] || 0) + 1;
      return acc;
    }, {});
    return res.json({ job, items_summary: summary, total_items: items.length });
  } catch (err) {
    log.error('get_job_failed', { job_id: req.params && req.params.id, error: err && err.message, stack: err && err.stack });
    return res.status(500).json({ error: 'Failed to get job' });
  }
});

// GET /api/tasks/definitions -> expose task definitions (labels, user_relevant, steps)
router.get('/tasks/definitions', (req, res) => {
  try {
    const p = path.join(__dirname, '..', 'services', 'task_definitions.json');
    const raw = fs.readFileSync(p, 'utf8');
    const defs = JSON.parse(raw);
    return res.json(defs);
  } catch (err) {
    log.error('load_task_definitions_failed', { error: err && err.message, stack: err && err.stack });
    return res.status(500).json({ error: 'Failed to load task definitions' });
  }
});

module.exports = router;
