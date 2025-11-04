const express = require('express');
const router = express.Router();
const { getDb } = require('../services/db');
const photosRepo = require('../services/repositories/photosRepo');

// Store active SSE connections
const connections = new Map();

/**
 * SSE endpoint for pending changes notifications
 * Sends real-time updates when photos have mismatches between keep flags and availability
 */
router.get('/pending-changes', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Generate unique connection ID
  const connectionId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  
  console.log(`[SSE] Client connected: ${connectionId}, total connections: ${connections.size + 1}`);
  
  // Store connection
  connections.set(connectionId, res);
  
  // Send initial state
  try {
    const initialState = getPendingChangesState();
    console.log('[SSE] Sending initial state to client:', initialState);
    res.write(`data: ${JSON.stringify(initialState)}\n\n`);
  } catch (error) {
    console.error('[SSE] Error sending initial state:', error);
  }
  
  // Send keepalive every 30 seconds
  const keepaliveInterval = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);
  
  // Handle client disconnect
  req.on('close', () => {
    clearInterval(keepaliveInterval);
    connections.delete(connectionId);
    console.log(`[SSE] Client disconnected: ${connectionId}`);
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
    console.error('[SSE] Error getting pending changes state:', error);
    return { timestamp: new Date().toISOString(), totals: { total: 0, jpg: 0, raw: 0 }, projects: [], photos: [], flags: {} };
  }
}

/**
 * Broadcast pending changes update to all connected clients
 * @param {string|null} projectFolder - Optional specific project to update, or null for all projects
 */
function broadcastPendingChanges(projectFolder = null) {
  console.log(`[SSE] broadcastPendingChanges called for project: ${projectFolder || 'all'}`);
  
  if (connections.size === 0) {
    console.log('[SSE] No clients connected, skipping broadcast');
    return; // No clients connected, skip
  }
  
  try {
    const state = getPendingChangesState();
    const message = `data: ${JSON.stringify(state)}\n\n`;
    
    console.log(`[SSE] Broadcasting to ${connections.size} clients:`, state);
    
    for (const [id, res] of connections) {
      try {
        res.write(message);
      } catch (error) {
        console.error(`[SSE] Error writing to client ${id}:`, error);
        connections.delete(id);
      }
    }
  } catch (error) {
    console.error('[SSE] Error broadcasting pending changes:', error);
  }
}

module.exports = { router, broadcastPendingChanges };
