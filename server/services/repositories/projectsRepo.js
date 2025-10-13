const { getDb } = require('../db');
const { generateUniqueFolderName } = require('../../utils/projects');
const { ensureProjectDirs } = require('../fsUtils');
const { writeManifest } = require('../projectManifest');

function nowISO() { return new Date().toISOString(); }

function createProject({ project_name }) {
  const db = getDb();
  const ts = nowISO();

  // Use a transaction to create project with human-readable folder name
  const trx = db.transaction(() => {
    // Generate unique folder name from project name
    const folderName = generateUniqueFolderName(project_name);
    
    const insert = db.prepare(`
      INSERT INTO projects (project_folder, project_name, created_at, updated_at, schema_version, status, archived_at, manifest_version)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, '1.0')
    `);
    const info = insert.run(folderName, project_name, ts, ts, null);
    const id = info.lastInsertRowid;

    const project = getById(id);
    
    // Create filesystem folder structure
    ensureProjectDirs(folderName);
    
    // Write manifest file
    writeManifest(folderName, {
      name: project_name,
      id: id,
      created_at: ts
    });

    return project;
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

function getByName(project_name) {
  const db = getDb();
  return db.prepare(`SELECT * FROM projects WHERE project_name = ? AND (status IS NULL OR status != 'canceled')`).get(project_name);
}

function updateFolderAndName(id, project_folder, project_name) {
  const db = getDb();
  const ts = nowISO();
  db.prepare(`
    UPDATE projects 
    SET project_folder = ?, project_name = ?, updated_at = ? 
    WHERE id = ?
  `).run(project_folder, project_name, ts, id);
  return getById(id);
}

function createProjectFromFolder({ project_name, project_folder }) {
  const db = getDb();
  const ts = nowISO();
  
  const insert = db.prepare(`
    INSERT INTO projects (project_folder, project_name, created_at, updated_at, schema_version, status, archived_at, manifest_version)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, '1.0')
  `);
  const info = insert.run(project_folder, project_name, ts, ts, null);
  const id = info.lastInsertRowid;
  
  return getById(id);
}

module.exports = {
  createProject,
  getById,
  getByFolder,
  getByName,
  list,
  updateName,
  updateFolderAndName,
  touchById,
  remove,
  setStatus,
  archive,
  createProjectFromFolder,
};
