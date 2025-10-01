const express = require('express');
const router = express.Router();
const { getDb } = require('../services/db');

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
    
    // Debug: Check total photos and mismatches
    const totalPhotos = db.prepare('SELECT COUNT(*) as count FROM photos').get();
    const mismatches = db.prepare(`
      SELECT COUNT(*) as count FROM photos
      WHERE (jpg_available = 1 AND keep_jpg = 0) OR (raw_available = 1 AND keep_raw = 0)
    `).get();
    
    console.log('[SSE] Database check:', {
      totalPhotos: totalPhotos.count,
      totalMismatches: mismatches.count
    });
    
    // Debug: Show some example mismatches
    const examples = db.prepare(`
      SELECT 
        ph.filename,
        p.project_folder,
        ph.jpg_available,
        ph.keep_jpg,
        ph.raw_available,
        ph.keep_raw
      FROM photos ph
      JOIN projects p ON ph.project_id = p.id
      WHERE (ph.jpg_available = 1 AND ph.keep_jpg = 0) OR (ph.raw_available = 1 AND ph.keep_raw = 0)
      LIMIT 5
    `).all();
    
    console.log('[SSE] Example mismatches:', examples);
    
    // Join with projects table to get folder name
    const results = db.prepare(`
      SELECT 
        p.project_folder,
        COUNT(*) as mismatch_count
      FROM photos ph
      JOIN projects p ON ph.project_id = p.id
      WHERE (ph.jpg_available = 1 AND ph.keep_jpg = 0) OR (ph.raw_available = 1 AND ph.keep_raw = 0)
      GROUP BY p.project_folder
    `).all();
    
    console.log('[SSE] Projects with mismatches:', results);
    
    const state = {};
    for (const row of results) {
      state[row.project_folder] = true;
    }
    
    console.log('[SSE] Current pending changes state:', state);
    return state;
  } catch (error) {
    console.error('[SSE] Error getting pending changes state:', error);
    return {};
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
