const express = require('express');
const { rateLimit } = require('../utils/rateLimit');
const { commitChanges, revertChanges } = require('./projectCommitHandlers');

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

module.exports = router;
