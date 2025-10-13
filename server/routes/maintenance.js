const express = require('express');
const { rateLimit } = require('../utils/rateLimit');
const { commitChanges, revertChanges } = require('./projectCommitHandlers');
const jobsRepo = require('../services/repositories/jobsRepo');
const makeLogger = require('../utils/logger2');
const log = makeLogger('maintenance');

const router = express.Router();
router.use(express.json());

// POST /api/projects/:folder/commit-changes
// Limit: 10 requests per 5 minutes per IP
router.post('/:folder/commit-changes', rateLimit({ windowMs: 5 * 60 * 1000, max: 10 }), (req, res, next) => {
  req.routeContext = { scope: 'project' };
  next();
}, commitChanges);

// POST /api/projects/:folder/revert-changes
// Limit: 10 requests per 5 minutes per IP
router.post('/:folder/revert-changes', rateLimit({ windowMs: 5 * 60 * 1000, max: 10 }), (req, res, next) => {
  req.routeContext = { scope: 'project' };
  next();
}, revertChanges);

// POST /api/projects/maintenance/discover-folders
// Manual trigger for folder discovery
// Limit: 5 requests per 10 minutes per IP
// Note: This is under /api/projects so it inherits authentication
router.post('/maintenance/discover-folders', rateLimit({ windowMs: 10 * 60 * 1000, max: 5 }), async (req, res) => {
  try {
    const job = jobsRepo.enqueue({
      tenant_id: 1,
      project_id: null,
      type: 'folder_discovery',
      priority: 95,
      scope: 'global',
      payload: { 
        source: 'manual',
        triggered_at: new Date().toISOString()
      }
    });
    
    log.info('manual_folder_discovery_triggered', { 
      job_id: job.id
    });
    
    res.json({ 
      success: true, 
      job_id: job.id,
      message: 'Folder discovery job enqueued. Check job status or logs for results.' 
    });
  } catch (err) {
    log.error('manual_folder_discovery_failed', { error: err.message });
    res.status(500).json({ error: err.message || 'Failed to enqueue folder discovery job' });
  }
});

module.exports = router;
