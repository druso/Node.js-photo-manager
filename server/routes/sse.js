const express = require('express');
const router = express.Router();
const { getDb } = require('../services/db');
const photosRepo = require('../services/repositories/photosRepo');
const sseMultiplexer = require('../services/sseMultiplexer');
const makeLogger = require('../utils/logger2');
const log = makeLogger('sse-pending');


const MAX_SSE_PER_IP = Number(process.env.SSE_MAX_CONN_PER_IP || 5);

/**
 * UNIFIED SSE ENDPOINT - Multiplexed stream for all events
 * Supports channel-based subscriptions via ?channels=jobs,pending-changes
 * This is the new consolidated endpoint that replaces /pending-changes and /api/jobs/stream
 */
router.get('/stream', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const userId = req.user?.id || ip;
  const channelsParam = req.query.channels || 'all';
  const channels = channelsParam === 'all' ? ['all'] : channelsParam.split(',').map(c => c.trim());

  // Enforce per-IP connection limit for security
  const currentConnections = sseMultiplexer.getConnectionCountForUser(ip);
  if (currentConnections >= MAX_SSE_PER_IP) {
    log.warn('sse_stream_ip_limit_exceeded', { ip, current: currentConnections, max: MAX_SSE_PER_IP });
    res.setHeader('Retry-After', '30');
    return res.status(429).json({ error: 'Too many SSE connections from this IP' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Add connection to multiplexer (use IP for connection tracking to enforce limits)
  sseMultiplexer.addConnection(ip, res, channels);

  log.info('sse_stream_connected', { ip, userId, channels, totalConnections: sseMultiplexer.getTotalConnections() });

  // Send initial connected event
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ channels, timestamp: new Date().toISOString() })}\n\n`);

  // If subscribed to pending-changes, send initial state
  if (channels.includes('all') || channels.includes('pending-changes')) {
    try {
      const initialState = getPendingChangesState();
      res.write(`event: pending_changes_state\n`);
      res.write(`data: ${JSON.stringify(initialState)}\n\n`);
    } catch (error) {
      log.error('sse_stream_initial_state_failed', { userId, error: error?.message });
    }
  }

  // Handle client disconnect
  req.on('close', () => {
    sseMultiplexer.removeConnection(ip, res);
    log.info('sse_stream_disconnected', { ip, userId, remainingConnections: sseMultiplexer.getTotalConnections() });
  });
});



/**
 * Get current pending changes state for all projects
 * Returns object with project_folder as key and boolean as value
 */
function getPendingChangesState() {
  try {
    const db = getDb();

    const perProject = db.prepare(`
      SELECT 
        p.id AS project_id,
        p.project_folder,
        SUM(CASE WHEN ph.jpg_available = 1 AND ph.keep_jpg = 0 THEN 1 ELSE 0 END) AS pending_jpg,
        SUM(CASE WHEN ph.raw_available = 1 AND ph.keep_raw = 0 THEN 1 ELSE 0 END) AS pending_raw
      FROM photos ph
      JOIN projects p ON p.id = ph.project_id
      WHERE (p.status IS NULL OR p.status != 'canceled')
        AND (
          (ph.jpg_available = 1 AND ph.keep_jpg = 0)
          OR (ph.raw_available = 1 AND ph.keep_raw = 0)
        )
      GROUP BY p.id
    `).all();

    const projectMetaById = new Map();
    const totals = perProject.reduce((acc, row) => {
      const jpg = Number(row.pending_jpg) || 0;
      const raw = Number(row.pending_raw) || 0;
      const total = jpg + raw;
      projectMetaById.set(row.project_id, {
        project_id: row.project_id,
        project_folder: row.project_folder,
        pending_total: total,
        pending_jpg: jpg,
        pending_raw: raw,
        has_pending: total > 0,
      });
      acc.jpg += jpg;
      acc.raw += raw;
      acc.total += total;
      return acc;
    }, { total: 0, jpg: 0, raw: 0 });

    const projects = Array.from(projectMetaById.values());
    const flags = Object.fromEntries(projects.map(entry => [entry.project_folder, entry.has_pending]));

    const pendingPhotos = photosRepo.listPendingDeletePhotos();
    const photos = pendingPhotos.map(row => {
      const meta = projectMetaById.get(row.project_id);
      return {
        photo_id: row.id,
        project_id: row.project_id,
        project_folder: meta ? meta.project_folder : null,
        jpg_available: !!row.jpg_available,
        raw_available: !!row.raw_available,
        keep_jpg: row.keep_jpg === 1,
        keep_raw: row.keep_raw === 1,
        pending_jpg: !!(row.jpg_available && row.keep_jpg === 0),
        pending_raw: !!(row.raw_available && row.keep_raw === 0),
      };
    });

    const timestamp = new Date().toISOString();

    return {
      timestamp,
      totals,
      projects,
      photos,
      flags,
    };
  } catch (error) {
    log.error('sse_pending_state_query_failed', { error: error?.message, stack: error?.stack });
    return { timestamp: new Date().toISOString(), totals: { total: 0, jpg: 0, raw: 0 }, projects: [], photos: [], flags: {} };
  }
}

/**
 * Broadcast pending changes update to all connected clients
 * Uses the new multiplexer for unified endpoint and legacy connections for backward compatibility
 * @param {string|null} projectFolder - Optional specific project to update, or null for all projects
 */
function broadcastPendingChanges(projectFolder = null) {
  log.debug('sse_pending_broadcast_called', {
    projectFolder: projectFolder || 'all',
    multiplexerConnections: sseMultiplexer.getTotalConnections()
  });

  try {
    const state = getPendingChangesState();

    // Broadcast via new multiplexer (to /stream endpoint clients)
    sseMultiplexer.broadcast('pending-changes', 'pending_changes_state', state);
  } catch (error) {
    log.error('sse_pending_broadcast_failed', { error: error?.message, stack: error?.stack });
  }
}

module.exports = { router, broadcastPendingChanges };
