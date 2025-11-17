const { getDb } = require('../db');
const stmtCache = require('./preparedStatements');

function mapRow(row) {
  if (!row) return null;
  return {
    photo_id: row.photo_id,
    hash: row.hash,
    rotated_at: row.rotated_at,
    expires_at: row.expires_at,
  };
}

function getByPhotoId(photoId) {
  if (!photoId) return null;
  const db = getDb();
  const stmt = stmtCache.get(db, 'photoPublicHashes:getByPhotoId', 'SELECT photo_id, hash, rotated_at, expires_at FROM photo_public_hashes WHERE photo_id = ?');
  const row = stmt.get(photoId);
  return mapRow(row);
}

function upsertHash({ photo_id, hash, rotated_at, expires_at }) {
  if (!photo_id || !hash || !rotated_at || !expires_at) {
    throw new Error('upsertHash requires photo_id, hash, rotated_at, and expires_at');
  }
  const db = getDb();
  const stmt = stmtCache.get(db, 'photoPublicHashes:upsert', `
    INSERT INTO photo_public_hashes (photo_id, hash, rotated_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(photo_id) DO UPDATE SET
      hash = excluded.hash,
      rotated_at = excluded.rotated_at,
      expires_at = excluded.expires_at
  `);
  stmt.run(photo_id, hash, rotated_at, expires_at);
  return getByPhotoId(photo_id);
}

function deleteForPhoto(photoId) {
  if (!photoId) return;
  const db = getDb();
  const stmt = stmtCache.get(db, 'photoPublicHashes:delete', 'DELETE FROM photo_public_hashes WHERE photo_id = ?');
  stmt.run(photoId);
}

function listExpiring(beforeIso) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'photoPublicHashes:listExpiring', `
      SELECT photo_id, hash, rotated_at, expires_at
      FROM photo_public_hashes
      WHERE expires_at <= ?
    `);
  return stmt.all(beforeIso).map(mapRow);
}

module.exports = {
  getByPhotoId,
  upsertHash,
  deleteForPhoto,
  listExpiring,
};
