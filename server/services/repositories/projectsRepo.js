const { getDb } = require('../db');
const { makeProjectFolderName } = require('../../utils/projects');

function nowISO() { return new Date().toISOString(); }

function createProject({ project_name }) {
  const db = getDb();
  const ts = nowISO();

  // Use a transaction to insert a temporary unique folder, then update to canonical id-based folder (p<id>)
  const trx = db.transaction(() => {
    const tmpFolder = `__tmp__p${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const insert = db.prepare(`
      INSERT INTO projects (project_folder, project_name, created_at, updated_at, schema_version, status, archived_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL)
    `);
    const info = insert.run(tmpFolder, project_name, ts, ts, null);
    const id = info.lastInsertRowid;

    const folder = makeProjectFolderName(project_name, id);
    db.prepare(`UPDATE projects SET project_folder = ? WHERE id = ?`).run(folder, id);

    return getById(id);
  });

  return trx();
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

function setStatus(id, status) {
  const db = getDb();
  const ts = nowISO();
  db.prepare(`UPDATE projects SET status = ?, updated_at = ? WHERE id = ?`).run(status, ts, id);
  return getById(id);
}

function archive(id) {
  const db = getDb();
  const ts = nowISO();
  db.prepare(`UPDATE projects SET status = 'canceled', archived_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, id);
  return getById(id);
}

module.exports = {
  createProject,
  getById,
  getByFolder,
  list,
  updateName,
  touchById,
  remove,
  setStatus,
  archive,
};
