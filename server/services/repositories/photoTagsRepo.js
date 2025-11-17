const { getDb } = require('../db');
const stmtCache = require('./preparedStatements');

function addTagToPhoto(photo_id, tag_id) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'photoTags:add', 'INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) VALUES (?, ?)');
  stmt.run(photo_id, tag_id);
}

function removeTagFromPhoto(photo_id, tag_id) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'photoTags:remove', 'DELETE FROM photo_tags WHERE photo_id = ? AND tag_id = ?');
  stmt.run(photo_id, tag_id);
}

function listTagsForPhoto(photo_id) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'photoTags:listForPhoto', `
    SELECT t.* FROM tags t
    JOIN photo_tags pt ON pt.tag_id = t.id
    WHERE pt.photo_id = ?
    ORDER BY t.name ASC
  `);
  return stmt.all(photo_id);
}

/**
 * Efficiently fetch tags for multiple photos in a single query
 * @param {number[]} photo_ids - Array of photo IDs to fetch tags for
 * @returns {Object} - Map of photo_id -> string[] tag names
 */
function listTagsForPhotos(photo_ids) {
  if (!Array.isArray(photo_ids) || !photo_ids.length) return {};
  
  const db = getDb();
  // SQLite has a limit on the number of parameters, so we'll chunk the query if needed
  const CHUNK_SIZE = 100;
  const result = {};
  
  // Initialize empty arrays for all requested photo_ids
  photo_ids.forEach(id => { result[id] = []; });
  
  // Process in chunks to avoid parameter limits
  for (let i = 0; i < photo_ids.length; i += CHUNK_SIZE) {
    const chunk = photo_ids.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    
    const cacheKey = `photoTags:listForPhotos:${chunk.length}`;
    const sql = `
      SELECT pt.photo_id, t.name 
      FROM photo_tags pt
      JOIN tags t ON pt.tag_id = t.id
      WHERE pt.photo_id IN (${placeholders})
      ORDER BY t.name ASC
    `;
    const stmt = stmtCache.get(db, cacheKey, sql);
    const rows = stmt.all(...chunk);
    
    // Group by photo_id
    rows.forEach(row => {
      if (!result[row.photo_id]) {
        result[row.photo_id] = [];
      }
      result[row.photo_id].push(row.name);
    });
  }
  
  return result;
}

function listPhotosForTag(tag_id) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'photoTags:listPhotosForTag', `
    SELECT p.* FROM photos p
    JOIN photo_tags pt ON pt.photo_id = p.id
    WHERE pt.tag_id = ?
    ORDER BY p.filename ASC
  `);
  return stmt.all(tag_id);
}

module.exports = {
  addTagToPhoto,
  removeTagFromPhoto,
  listTagsForPhoto,
  listTagsForPhotos,
  listPhotosForTag,
};
