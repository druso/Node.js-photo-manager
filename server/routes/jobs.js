const express = require('express');
const projectsRepo = require('../services/repositories/projectsRepo');
const jobsRepo = require('../services/repositories/jobsRepo');
const { onJobUpdate } = require('../services/events');

const router = express.Router();
router.use(express.json());

// POST /api/projects/:folder/jobs -> enqueue a job for a project
router.post('/projects/:folder/jobs', (req, res) => {
  try {
    const { folder } = req.params;
    const { type, payload } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type is required' });
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const tenant_id = 'user_0';

    // If payload includes filenames, create job_items
    const filenames = Array.isArray(payload?.filenames) ? payload.filenames : [];
    if (filenames.length > 0) {
      const items = filenames.map(fn => ({ filename: fn }));
      const job = jobsRepo.enqueueWithItems({ tenant_id, project_id: project.id, type, payload, items });
      return res.status(202).json({ job });
    }
    const job = jobsRepo.enqueue({ tenant_id, project_id: project.id, type, payload, progress_total: null });
    return res.status(202).json({ job });
  } catch (err) {
    console.error('Failed to enqueue job:', err);
    return res.status(500).json({ error: 'Failed to enqueue job' });
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
    console.error('Failed to list jobs:', err);
    return res.status(500).json({ error: 'Failed to list jobs' });
  }
});

// GET /api/jobs/:id -> job details (including items summary)
// Constrain :id to digits so it doesn't match '/jobs/stream'
router.get('/jobs/:id(\\d+)', (req, res) => {
  try {
    const id = Number(req.params.id);
    const job = jobsRepo.getById(id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const items = jobsRepo.listItems(id) || [];
    const summary = items.reduce((acc, it) => {
      acc[it.status] = (acc[it.status] || 0) + 1;
      return acc;
    }, {});
    return res.json({ job, items_summary: summary, total_items: items.length });
  } catch (err) {
    console.error('Failed to get job:', err);
    return res.status(500).json({ error: 'Failed to get job' });
  }
});

// GET /api/jobs/stream -> SSE for job updates
router.get('/jobs/stream', (req, res) => {
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

  req.on('close', () => {
    off();
    try { res.end(); } catch (_) {}
  });

  // initial heartbeat
  send({ type: 'hello' });
});

module.exports = router;
