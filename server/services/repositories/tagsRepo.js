const { getDb } = require('../db');

function getOrCreateTag(project_id, name) {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM tags WHERE project_id = ? AND name = ?`).get(project_id, name);
  if (existing) return existing;
  const info = db.prepare(`INSERT INTO tags (project_id, name) VALUES (?, ?)`)
    .run(project_id, name);
  return db.prepare(`SELECT * FROM tags WHERE id = ?`).get(info.lastInsertRowid);
}

function listTags(project_id) {
  const db = getDb();
  return db.prepare(`SELECT * FROM tags WHERE project_id = ? ORDER BY name ASC`).all(project_id);
}

function removeTag(project_id, name) {
  const db = getDb();
  const tag = db.prepare(`SELECT * FROM tags WHERE project_id = ? AND name = ?`).get(project_id, name);
  if (!tag) return 0;
  // Will cascade delete from photo_tags due to FK
  const info = db.prepare(`DELETE FROM tags WHERE id = ?`).run(tag.id);
  return info.changes;
}

module.exports = {
  getOrCreateTag,
  listTags,
  removeTag,
};
