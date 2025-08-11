const { getDb } = require('../db');

function nowISO() { return new Date().toISOString(); }

function upsertPhoto(project_id, photo) {
  const db = getDb();
  const ts = nowISO();
  // Prefer project-scoped lookup by filename to avoid cross-project collisions.
  const existing = getByProjectAndFilename(project_id, photo.filename) || getByManifestId(photo.manifest_id);
  if (existing) {
    const stmt = db.prepare(`
      UPDATE photos SET
        filename = ?, basename = ?, ext = ?,
        updated_at = ?, date_time_original = ?,
        jpg_available = ?, raw_available = ?, other_available = ?,
        keep_jpg = ?, keep_raw = ?,
        thumbnail_status = ?, preview_status = ?,
        orientation = ?, meta_json = ?
      WHERE id = ?
    `);
    stmt.run(
      photo.filename, photo.basename || null, photo.ext || null,
      ts, photo.date_time_original || null,
      photo.jpg_available ? 1 : 0, photo.raw_available ? 1 : 0, photo.other_available ? 1 : 0,
      photo.keep_jpg ? 1 : 0, photo.keep_raw ? 1 : 0,
      photo.thumbnail_status || null, photo.preview_status || null,
      photo.orientation ?? null, photo.meta_json || null,
      existing.id
    );
    return getById(existing.id);
  } else {
    const stmt = db.prepare(`
      INSERT INTO photos (
        project_id, manifest_id, filename, basename, ext,
        created_at, updated_at, date_time_original,
        jpg_available, raw_available, other_available,
        keep_jpg, keep_raw, thumbnail_status, preview_status,
        orientation, meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      project_id, (photo.manifest_id || `${project_id}:${photo.filename}`), photo.filename, photo.basename || null, photo.ext || null,
      ts, ts, photo.date_time_original || null,
      photo.jpg_available ? 1 : 0, photo.raw_available ? 1 : 0, photo.other_available ? 1 : 0,
      photo.keep_jpg ? 1 : 0, photo.keep_raw ? 1 : 0,
      photo.thumbnail_status || null, photo.preview_status || null,
      photo.orientation ?? null, photo.meta_json || null
    );
    return getById(info.lastInsertRowid);
  }
}

function updateDerivativeStatus(id, { thumbnail_status, preview_status }) {
  const db = getDb();
  const sets = [];
  const params = [];
  if (thumbnail_status !== undefined) { sets.push('thumbnail_status = ?'); params.push(thumbnail_status); }
  if (preview_status !== undefined) { sets.push('preview_status = ?'); params.push(preview_status); }
  if (!sets.length) return getById(id);
  const sql = `UPDATE photos SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`;
  params.push(nowISO(), id);
  db.prepare(sql).run(...params);
  return getById(id);
}

function updateKeepFlags(id, { keep_jpg, keep_raw }) {
  const db = getDb();
  const ts = nowISO();
  db.prepare(`UPDATE photos SET keep_jpg = ?, keep_raw = ?, updated_at = ? WHERE id = ?`)
    .run(keep_jpg ? 1 : 0, keep_raw ? 1 : 0, ts, id);
  return getById(id);
}

function getById(id) {
  const db = getDb();
  return db.prepare(`SELECT * FROM photos WHERE id = ?`).get(id);
}

function getByManifestId(manifest_id) {
  if (!manifest_id) return null;
  const db = getDb();
  return db.prepare(`SELECT * FROM photos WHERE manifest_id = ?`).get(manifest_id);
}

function getByFilename(project_id, filename) {
  const db = getDb();
  return db.prepare(`SELECT * FROM photos WHERE project_id = ? AND filename = ?`).get(project_id, filename);
}

function getByProjectAndFilename(project_id, filename) {
  if (!project_id || !filename) return null;
  const db = getDb();
  return db.prepare(`SELECT * FROM photos WHERE project_id = ? AND filename = ?`).get(project_id, filename);
}

function listPaged({ project_id, sort = 'filename', dir = 'ASC', limit = 100, cursor = null }) {
  const db = getDb();
  const safeSort = ['filename', 'date_time_original', 'created_at', 'updated_at'].includes(sort) ? sort : 'filename';
  const safeDir = dir && dir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  // Simple OFFSET-like cursor for now (can switch to keyset later)
  let offset = 0;
  if (cursor) {
    const n = parseInt(cursor, 10);
    if (!isNaN(n) && n >= 0) offset = n;
  }
  const items = db.prepare(`
    SELECT * FROM photos WHERE project_id = ?
    ORDER BY ${safeSort} ${safeDir}, id ${safeDir}
    LIMIT ? OFFSET ?
  `).all(project_id, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) as c FROM photos WHERE project_id = ?`).get(project_id).c;
  const nextCursor = offset + items.length < total ? String(offset + items.length) : null;
  return { items, total, nextCursor };
}

function removeById(id) {
  const db = getDb();
  db.prepare(`DELETE FROM photos WHERE id = ?`).run(id);
}

function countByProject(project_id) {
  const db = getDb();
  return db.prepare(`SELECT COUNT(*) as c FROM photos WHERE project_id = ?`).get(project_id).c;
}

module.exports = {
  upsertPhoto,
  updateDerivativeStatus,
  updateKeepFlags,
  getById,
  getByManifestId,
  getByFilename,
  getByProjectAndFilename,
  listPaged,
  removeById,
  countByProject,
};
