const { getDb } = require('../db');
const makeLogger = require('../../utils/logger2');
const log = makeLogger('photoPendingOps');

/**
 * List photos with pending deletions for a specific project
 * @param {number} project_id - Project ID
 * @returns {Array} Array of photos with pending deletions
 */
function listPendingDeletesForProject(project_id) {
  if (!project_id) return [];
  const db = getDb();
  return db.prepare(`
    SELECT *
    FROM photos
    WHERE project_id = ?
      AND (
        (jpg_available = 1 AND keep_jpg = 0)
        OR (raw_available = 1 AND keep_raw = 0)
      )
  `).all(project_id);
}

/**
 * List pending deletions grouped by project with optional filters
 * @param {Object} options - Filter options
 * @param {number} [options.project_id] - Specific project ID
 * @param {string} [options.project_folder] - Specific project folder
 * @param {string} [options.date_from] - Start date filter
 * @param {string} [options.date_to] - End date filter
 * @param {string} [options.file_type] - File type filter
 * @param {string} [options.orientation] - Orientation filter
 * @returns {Array} Array of project summaries with pending deletion counts
 */
function listPendingDeletesByProject({ 
  project_id = null, 
  project_folder = null, 
  date_from = null, 
  date_to = null, 
  file_type = null, 
  orientation = null 
} = {}) {
  const db = getDb();
  const params = [];
  const filters = [];
  
  if (project_id != null) {
    filters.push('p.id = ?');
    params.push(project_id);
  }
  if (project_folder) {
    filters.push('p.project_folder = ?');
    params.push(project_folder);
  }
  
  // Add date range filter
  if (date_from) {
    filters.push('ph.date_time_original >= ?');
    params.push(date_from);
  }
  if (date_to) {
    filters.push('ph.date_time_original <= ?');
    params.push(date_to + ' 23:59:59');
  }
  
  // Add file type filter
  if (file_type && file_type !== 'any') {
    if (file_type === 'jpg_only') {
      filters.push('ph.jpg_available = 1 AND ph.raw_available = 0');
    } else if (file_type === 'raw_only') {
      filters.push('ph.raw_available = 1 AND ph.jpg_available = 0');
    } else if (file_type === 'both') {
      filters.push('ph.jpg_available = 1 AND ph.raw_available = 1');
    }
  }
  
  // Add orientation filter
  if (orientation && orientation !== 'any') {
    if (orientation === 'vertical') {
      filters.push('ph.height > ph.width');
    } else if (orientation === 'horizontal') {
      filters.push('ph.width > ph.height');
    }
  }
  
  const where = filters.length ? `AND ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT
      p.id AS project_id,
      p.project_folder,
      p.project_name,
      SUM(CASE WHEN ph.jpg_available = 1 AND ph.keep_jpg = 0 THEN 1 ELSE 0 END) AS pending_jpg,
      SUM(CASE WHEN ph.raw_available = 1 AND ph.keep_raw = 0 THEN 1 ELSE 0 END) AS pending_raw
    FROM photos ph
    JOIN projects p ON p.id = ph.project_id
    WHERE (p.status IS NULL OR p.status != 'canceled')
      AND (
        (ph.jpg_available = 1 AND ph.keep_jpg = 0)
        OR (ph.raw_available = 1 AND ph.keep_raw = 0)
      )
      ${where}
    GROUP BY p.id
    HAVING pending_jpg > 0 OR pending_raw > 0
    ORDER BY p.updated_at DESC
  `).all(...params);
  return rows;
}

/**
 * List photos with keep flag mismatches for a specific project
 * @param {number} project_id - Project ID
 * @returns {Array} Array of photos with keep flag mismatches
 */
function listKeepMismatchesForProject(project_id) {
  if (!project_id) return [];
  const db = getDb();
  return db.prepare(`
    SELECT *
    FROM photos
    WHERE project_id = ?
      AND (
        COALESCE(keep_jpg, 0) != COALESCE(jpg_available, 0)
        OR COALESCE(keep_raw, 0) != COALESCE(raw_available, 0)
      )
  `).all(project_id);
}

/**
 * List keep flag mismatches grouped by project
 * @param {Object} options - Filter options
 * @param {number} [options.project_id] - Specific project ID
 * @param {string} [options.project_folder] - Specific project folder
 * @returns {Array} Array of project summaries with mismatch counts
 */
function listKeepMismatchesByProject({ project_id = null, project_folder = null } = {}) {
  const db = getDb();
  const params = [];
  const filters = [];
  
  if (project_id != null) {
    filters.push('p.id = ?');
    params.push(project_id);
  }
  if (project_folder) {
    filters.push('p.project_folder = ?');
    params.push(project_folder);
  }
  
  const where = filters.length ? `AND ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT
      p.id AS project_id,
      p.project_folder,
      p.project_name,
      SUM(CASE WHEN COALESCE(ph.keep_jpg, 0) != COALESCE(ph.jpg_available, 0) THEN 1 ELSE 0 END) AS mismatch_jpg,
      SUM(CASE WHEN COALESCE(ph.keep_raw, 0) != COALESCE(ph.raw_available, 0) THEN 1 ELSE 0 END) AS mismatch_raw
    FROM photos ph
    JOIN projects p ON p.id = ph.project_id
    WHERE (p.status IS NULL OR p.status != 'canceled')
      AND (
        COALESCE(ph.keep_jpg, 0) != COALESCE(ph.jpg_available, 0)
        OR COALESCE(ph.keep_raw, 0) != COALESCE(ph.raw_available, 0)
      )
      ${where}
    GROUP BY p.id
    HAVING mismatch_jpg > 0 OR mismatch_raw > 0
    ORDER BY p.updated_at DESC
  `).all(...params);
  return rows;
}

/**
 * Count photos missing generated derivatives for a specific project
 * Missing asset = thumbnail or preview not marked generated
 */
function countMissingDerivativesForProject(project_id) {
  if (!project_id) return 0;
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) AS c
    FROM photos
    WHERE project_id = ?
      AND (
        COALESCE(thumbnail_status, '') != 'generated'
        OR COALESCE(preview_status, '') != 'generated'
      )
  `).get(project_id);
  return row?.c || 0;
}

module.exports = {
  listPendingDeletesForProject,
  listPendingDeletesByProject,
  listKeepMismatchesForProject,
  listKeepMismatchesByProject,
  countMissingDerivativesForProject
};
