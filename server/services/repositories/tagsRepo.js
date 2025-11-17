const { getDb } = require('../db');
const stmtCache = require('./preparedStatements');

function getOrCreateTag(project_id, name) {
  const db = getDb();
  const selectStmt = stmtCache.get(db, 'tags:getByProjectAndName', 'SELECT * FROM tags WHERE project_id = ? AND name = ?');
  const existing = selectStmt.get(project_id, name);
  if (existing) return existing;
  const insertStmt = stmtCache.get(db, 'tags:insert', 'INSERT INTO tags (project_id, name) VALUES (?, ?)');
  const info = insertStmt.run(project_id, name);
  const getByIdStmt = stmtCache.get(db, 'tags:getById', 'SELECT * FROM tags WHERE id = ?');
  return getByIdStmt.get(info.lastInsertRowid);
}

function getByName(project_id, name) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'tags:getByProjectAndName', 'SELECT * FROM tags WHERE project_id = ? AND name = ?');
  return stmt.get(project_id, name);
}

function listTags(project_id) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'tags:listByProject', 'SELECT * FROM tags WHERE project_id = ? ORDER BY name ASC');
  return stmt.all(project_id);
}

function removeTag(project_id, name) {
  const db = getDb();
  const selectStmt = stmtCache.get(db, 'tags:getByProjectAndName', 'SELECT * FROM tags WHERE project_id = ? AND name = ?');
  const tag = selectStmt.get(project_id, name);
  if (!tag) return 0;
  // Will cascade delete from photo_tags due to FK
  const deleteStmt = stmtCache.get(db, 'tags:deleteById', 'DELETE FROM tags WHERE id = ?');
  const info = deleteStmt.run(tag.id);
  return info.changes;
}

module.exports = {
  getOrCreateTag,
  getByName,
  listTags,
  removeTag,
};
