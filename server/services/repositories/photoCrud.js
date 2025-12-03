const { getDb } = require('../db');
const stmtCache = require('./preparedStatements');
const makeLogger = require('../../utils/logger2');
const log = makeLogger('photoCrud');

function nowISO() { return new Date().toISOString(); }

/**
 * Get photo by ID
 * @param {number} id - Photo ID
 * @returns {Object|null} Photo record or null if not found
 */
function getById(id) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'photos:getById', 'SELECT * FROM photos WHERE id = ?');
  return stmt.get(id);
}

/**
 * Get photo by manifest ID
 * @param {string} manifest_id - Manifest ID
 * @returns {Object|null} Photo record or null if not found
 */
function getByManifestId(manifest_id) {
  if (!manifest_id) return null;
  const db = getDb();
  const stmt = stmtCache.get(db, 'photos:getByManifestId', 'SELECT * FROM photos WHERE manifest_id = ?');
  return stmt.get(manifest_id);
}

/**
 * Get photo by filename within a project
 * @param {number} project_id - Project ID
 * @param {string} filename - Photo filename
 * @returns {Object|null} Photo record or null if not found
 */
function getByFilename(project_id, filename) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'photos:getByFilename', 'SELECT * FROM photos WHERE project_id = ? AND filename = ?');
  return stmt.get(project_id, filename);
}

/**
 * Get photo by project and filename (with null checks)
 * @param {number} project_id - Project ID
 * @param {string} filename - Photo filename
 * @returns {Object|null} Photo record or null if not found
 */
function getByProjectAndFilename(project_id, filename) {
  if (!project_id || !filename) return null;
  const db = getDb();
  const stmt = stmtCache.get(db, 'photos:getByProjectAndFilename', 'SELECT * FROM photos WHERE project_id = ? AND filename = ?');
  return stmt.get(project_id, filename);
}

/**
 * Get photo by project and basename (fuzzy match)
 * @param {number} project_id - Project ID
 * @param {string} basename - Photo basename (without extension)
 * @returns {Object|null} Photo record or null if not found
 */
function getByProjectAndBasename(project_id, basename) {
  if (!project_id || !basename) return null;
  const db = getDb();
  const normalized = String(basename).toLowerCase();
  const stmt = stmtCache.get(db, 'photos:getByProjectAndBasename', `
    SELECT * FROM photos
    WHERE project_id = ?
      AND (
        (basename IS NOT NULL AND lower(basename) = ?)
        OR lower(filename) = ?
        OR lower(filename) LIKE (? || '.%')
      )
    LIMIT 1
  `);
  return stmt.get(project_id, normalized, normalized, normalized);
}

/**
 * Get photo by filename across all projects, optionally excluding a project
 * @param {string} filename - Photo filename
 * @param {Object} options - Options object
 * @param {number} [options.exclude_project_id] - Project ID to exclude from search
 * @returns {Object|null} Photo record or null if not found
 */
function getGlobalByFilename(filename, { exclude_project_id = null } = {}) {
  if (!filename) return null;
  const db = getDb();
  const conds = ['filename = ?'];
  const params = [filename];
  if (exclude_project_id != null) {
    conds.push('project_id != ?');
    params.push(exclude_project_id);
  }
  const where = `WHERE ${conds.join(' AND ')}`;
  const cacheKey = `photos:getGlobalByFilename:${conds.join(':')}`;
  const sql = `SELECT * FROM photos ${where} LIMIT 1`;
  const stmt = stmtCache.get(db, cacheKey, sql);
  return stmt.get(...params);
}

/**
 * Get photo by filename across all projects, case-insensitive, optionally excluding a project
 * @param {string} filename - Photo filename
 * @param {Object} options - Options object
 * @param {number} [options.exclude_project_id] - Project ID to exclude from search
 * @returns {Object|null} Photo record or null if not found
 */
function getGlobalByFilenameInsensitive(filename, { exclude_project_id = null } = {}) {
  if (!filename) return null;
  const db = getDb();
  // SQLite default collation is usually binary, so we use explicit LOWER() comparison
  // or COLLATE NOCASE if the column was defined that way (it probably wasn't).
  // Using LOWER() is safer for ad-hoc case insensitivity.
  const conds = ['lower(filename) = lower(?)'];
  const params = [filename];
  if (exclude_project_id != null) {
    conds.push('project_id != ?');
    params.push(exclude_project_id);
  }
  const where = `WHERE ${conds.join(' AND ')}`;
  const cacheKey = `photos:getGlobalByFilenameInsensitive:${conds.join(':')}`;
  const sql = `SELECT * FROM photos ${where} LIMIT 1`;
  const stmt = stmtCache.get(db, cacheKey, sql);
  return stmt.get(...params);
}

/**
 * Insert or update a photo record
 * @param {number} project_id - Project ID
 * @param {Object} photo - Photo data object
 * @returns {Object} Updated photo record
 */
function upsertPhoto(project_id, photo) {
  const db = getDb();
  const ts = nowISO();

  // Prefer project-scoped lookup by filename to avoid cross-project collisions
  const existing = getByProjectAndFilename(project_id, photo.filename) || getByManifestId(photo.manifest_id);

  if (existing) {
    const stmt = stmtCache.get(db, 'photos:upsert:update', `
      UPDATE photos SET
        filename = ?, basename = ?, ext = ?,
        updated_at = ?, date_time_original = ?,
        jpg_available = ?, raw_available = ?, other_available = ?,
        keep_jpg = ?, keep_raw = ?,
        thumbnail_status = ?, preview_status = ?,
        orientation = ?, meta_json = ?, visibility = ?
      WHERE id = ?
    `);
    stmt.run(
      photo.filename, photo.basename || null, photo.ext || null,
      ts, photo.date_time_original || null,
      photo.jpg_available ? 1 : 0, photo.raw_available ? 1 : 0, photo.other_available ? 1 : 0,
      photo.keep_jpg ? 1 : 0, photo.keep_raw ? 1 : 0,
      photo.thumbnail_status || null, photo.preview_status || null,
      photo.orientation ?? null, photo.meta_json || null,
      photo.visibility || 'private',
      existing.id
    );
    return getById(existing.id);
  } else {
    const stmt = stmtCache.get(db, 'photos:upsert:insert', `
      INSERT INTO photos (
        project_id, manifest_id, filename, basename, ext,
        created_at, updated_at, date_time_original,
        jpg_available, raw_available, other_available,
        keep_jpg, keep_raw, thumbnail_status, preview_status,
        orientation, meta_json, visibility
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      project_id, (photo.manifest_id || `${project_id}:${photo.filename}`), photo.filename, photo.basename || null, photo.ext || null,
      ts, ts, photo.date_time_original || null,
      photo.jpg_available ? 1 : 0, photo.raw_available ? 1 : 0, photo.other_available ? 1 : 0,
      photo.keep_jpg ? 1 : 0, photo.keep_raw ? 1 : 0,
      photo.thumbnail_status || null, photo.preview_status || null,
      photo.orientation ?? null, photo.meta_json || null,
      photo.visibility || 'private'
    );
    return getById(info.lastInsertRowid);
  }
}

/**
 * Update derivative generation status for a photo
 * @param {number} id - Photo ID
 * @param {Object} status - Status object
 * @param {string} [status.thumbnail_status] - Thumbnail generation status
 * @param {string} [status.preview_status] - Preview generation status
 * @returns {Object} Updated photo record
 */
function updateDerivativeStatus(id, { thumbnail_status, preview_status }) {
  const db = getDb();
  const sets = [];
  const params = [];

  if (thumbnail_status !== undefined) {
    sets.push('thumbnail_status = ?');
    params.push(thumbnail_status);
  }
  if (preview_status !== undefined) {
    sets.push('preview_status = ?');
    params.push(preview_status);
  }

  if (!sets.length) return getById(id);

  const cacheKey = `photos:updateDerivativeStatus:${sets.join(':')}`;
  const sql = `UPDATE photos SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`;
  params.push(nowISO(), id);
  const stmt = stmtCache.get(db, cacheKey, sql);
  stmt.run(...params);
  return getById(id);
}

/**
 * Update keep flags for a photo
 * @param {number} id - Photo ID
 * @param {Object} flags - Keep flags object
 * @param {boolean} flags.keep_jpg - Whether to keep JPG version
 * @param {boolean} flags.keep_raw - Whether to keep RAW version
 * @returns {Object} Updated photo record
 */
function updateKeepFlags(id, { keep_jpg, keep_raw }) {
  const db = getDb();
  const ts = nowISO();
  const stmt = stmtCache.get(db, 'photos:updateKeepFlags', 'UPDATE photos SET keep_jpg = ?, keep_raw = ?, updated_at = ? WHERE id = ?');
  stmt.run(keep_jpg ? 1 : 0, keep_raw ? 1 : 0, ts, id);
  return getById(id);
}

/**
 * Move a photo to a different project
 * @param {Object} options - Move options
 * @param {number} options.photo_id - Photo ID to move
 * @param {number} options.to_project_id - Target project ID
 */
function moveToProject({ photo_id, to_project_id }) {
  if (!photo_id || !to_project_id) {
    throw new Error('moveToProject requires photo_id and to_project_id');
  }

  const db = getDb();
  const row = getById(photo_id);
  if (!row) throw new Error('Photo not found');
  const manifest_id = `${to_project_id}:${row.filename}`;
  const keep_jpg = row.jpg_available ? 1 : 0;
  const keep_raw = row.raw_available ? 1 : 0;

  const ts = nowISO();
  const stmt = stmtCache.get(db, 'photos:moveToProject', 'UPDATE photos SET project_id = ?, manifest_id = ?, keep_jpg = ?, keep_raw = ?, updated_at = ? WHERE id = ?');
  stmt.run(to_project_id, manifest_id, keep_jpg, keep_raw, ts, photo_id);

  return getById(photo_id);
}

/**
 * Update visibility for a photo
 * @param {number} id - Photo ID
 * @param {string} visibility - New visibility value ('public' or 'private')
 * @returns {Object} Updated photo record
 */
function updateVisibility(id, visibility) {
  if (visibility !== 'public' && visibility !== 'private') {
    const err = new Error('visibility must be "public" or "private"');
    err.status = 400;
    throw err;
  }

  const db = getDb();
  const ts = nowISO();
  const stmt = stmtCache.get(db, 'photos:updateVisibility', 'UPDATE photos SET visibility = ?, updated_at = ? WHERE id = ?');
  stmt.run(visibility, ts, id);
  return getById(id);
}

/**
 * Remove a photo by ID
 * @param {number} id - Photo ID
 */
function removeById(id) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'photos:removeById', 'DELETE FROM photos WHERE id = ?');
  stmt.run(id);
}

/**
 * Count photos in a project
 * @param {number} project_id - Project ID
 * @returns {number} Photo count
 */
function countByProject(project_id) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'photos:countByProject', 'SELECT COUNT(*) as c FROM photos WHERE project_id = ?');
  return stmt.get(project_id).c;
}

function getPublicByFilename(filename) {
  if (!filename) return null;
  const db = getDb();
  const stmt = stmtCache.get(db, 'photos:getPublicByFilename', `
    SELECT ph.*, p.project_folder, p.project_name
    FROM photos ph
    JOIN projects p ON p.id = ph.project_id
    WHERE ph.filename = ?
      AND ph.visibility = 'public'
      AND (p.status IS NULL OR p.status != 'canceled')
    LIMIT 1
  `);
  return stmt.get(filename);
}

function getPublicByBasename(basename) {
  if (!basename) return null;
  const db = getDb();
  const normalized = String(basename).toLowerCase();
  const stmt = stmtCache.get(db, 'photos:getPublicByBasename', `
    SELECT ph.*, p.project_folder, p.project_name
    FROM photos ph
    JOIN projects p ON p.id = ph.project_id
    WHERE (
        (ph.basename IS NOT NULL AND lower(ph.basename) = ?)
        OR lower(ph.filename) = ?
        OR lower(ph.filename) LIKE (? || '.%')
      )
      AND ph.visibility = 'public'
      AND (p.status IS NULL OR p.status != 'canceled')
    ORDER BY ph.id DESC
    LIMIT 1
  `);
  return stmt.get(normalized, normalized, normalized);
}

function getAnyVisibilityByFilename(filename) {
  if (!filename) return null;
  const db = getDb();
  const stmt = stmtCache.get(db, 'photos:getAnyVisibilityByFilename', `
    SELECT ph.*, p.project_folder, p.project_name
    FROM photos ph
    JOIN projects p ON p.id = ph.project_id
    WHERE ph.filename = ?
      AND (p.status IS NULL OR p.status != 'canceled')
    ORDER BY ph.id DESC
    LIMIT 1
  `);
  return stmt.get(filename);
}

function getAnyVisibilityByBasename(basename) {
  if (!basename) return null;
  const db = getDb();
  const normalized = String(basename).toLowerCase();
  const stmt = stmtCache.get(db, 'photos:getAnyVisibilityByBasename', `
    SELECT ph.*, p.project_folder, p.project_name
    FROM photos ph
    JOIN projects p ON p.id = ph.project_id
    WHERE (
        (ph.basename IS NOT NULL AND lower(ph.basename) = ?)
        OR lower(ph.filename) = ?
        OR lower(ph.filename) LIKE (? || '.%')
      )
      AND (p.status IS NULL OR p.status != 'canceled')
    ORDER BY ph.id DESC
    LIMIT 1
  `);
  return stmt.get(normalized, normalized, normalized);
}

module.exports = {
  getById,
  getByManifestId,
  getByFilename,
  getByProjectAndFilename,
  getByProjectAndBasename,
  getGlobalByFilename,
  getGlobalByFilenameInsensitive,
  getPublicByFilename,
  getPublicByBasename,
  getAnyVisibilityByFilename,
  getAnyVisibilityByBasename,
  upsertPhoto,
  updateDerivativeStatus,
  updateKeepFlags,
  moveToProject,
  updateVisibility,
  removeById,
  countByProject
};
