const { getDb } = require('../db');

function nowISO() { return new Date().toISOString(); }

function createProject({ project_folder, project_name, schema_version = null }) {
  const db = getDb();
  const ts = nowISO();
  const stmt = db.prepare(`
    INSERT INTO projects (project_folder, project_name, created_at, updated_at, schema_version)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(project_folder, project_name, ts, ts, schema_version);
  return getById(info.lastInsertRowid);
}

function getById(id) {
  const db = getDb();
  return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
}

function getByFolder(project_folder) {
  const db = getDb();
  return db.prepare(`SELECT * FROM projects WHERE project_folder = ?`).get(project_folder);
}

function list() {
  const db = getDb();
  return db.prepare(`SELECT * FROM projects ORDER BY updated_at DESC`).all();
}

function updateName(id, project_name) {
  const db = getDb();
  const ts = nowISO();
  db.prepare(`UPDATE projects SET project_name = ?, updated_at = ? WHERE id = ?`).run(project_name, ts, id);
  return getById(id);
}

function touchById(id) {
  const db = getDb();
  const ts = nowISO();
  db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(ts, id);
}

function remove(id) {
  const db = getDb();
  db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
}

module.exports = {
  createProject,
  getById,
  getByFolder,
  list,
  updateName,
  touchById,
  remove,
};
