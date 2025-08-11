const { getDb } = require('../db');

function addTagToPhoto(photo_id, tag_id) {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) VALUES (?, ?)`).run(photo_id, tag_id);
}

function removeTagFromPhoto(photo_id, tag_id) {
  const db = getDb();
  db.prepare(`DELETE FROM photo_tags WHERE photo_id = ? AND tag_id = ?`).run(photo_id, tag_id);
}

function listTagsForPhoto(photo_id) {
  const db = getDb();
  return db.prepare(`
    SELECT t.* FROM tags t
    JOIN photo_tags pt ON pt.tag_id = t.id
    WHERE pt.photo_id = ?
    ORDER BY t.name ASC
  `).all(photo_id);
}

function listPhotosForTag(tag_id) {
  const db = getDb();
  return db.prepare(`
    SELECT p.* FROM photos p
    JOIN photo_tags pt ON pt.photo_id = p.id
    WHERE pt.tag_id = ?
    ORDER BY p.filename ASC
  `).all(tag_id);
}

module.exports = {
  addTagToPhoto,
  removeTagFromPhoto,
  listTagsForPhoto,
  listPhotosForTag,
};
