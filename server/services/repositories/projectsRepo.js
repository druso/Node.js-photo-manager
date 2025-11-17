const { getDb } = require('../db');
const stmtCache = require('./preparedStatements');
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
    
    // IMPORTANT: Use folder name as canonical name to keep everything in sync
    // If user creates "test" twice, second becomes "test (2)" everywhere
    const canonicalName = folderName;
    
    const insert = stmtCache.get(db, 'projects:create', `
      INSERT INTO projects (project_folder, project_name, created_at, updated_at, schema_version, status, archived_at, manifest_version)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, '1.0')
    `);
    const info = insert.run(folderName, canonicalName, ts, ts, null);
    const id = info.lastInsertRowid;

    const project = getById(id);
    
    // Create filesystem folder structure
    ensureProjectDirs(folderName);
    
    // Write manifest file with canonical name (matches folder)
    writeManifest(folderName, {
      name: canonicalName,
      id: id,
      created_at: ts
    });

    return project;
  });

  return trx();
}

function getById(id) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'projects:getById', 'SELECT * FROM projects WHERE id = ?');
  return stmt.get(id);
}

function getByFolder(project_folder) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'projects:getByFolder', 'SELECT * FROM projects WHERE project_folder = ?');
  return stmt.get(project_folder);
}

function list() {
  const db = getDb();
  const stmt = stmtCache.get(db, 'projects:list', 'SELECT * FROM projects ORDER BY updated_at DESC');
  return stmt.all();
}

function updateName(id, project_name) {
  const db = getDb();
  const ts = nowISO();
  const stmt = stmtCache.get(db, 'projects:updateName', 'UPDATE projects SET project_name = ?, updated_at = ? WHERE id = ?');
  stmt.run(project_name, ts, id);
  return getById(id);
}

function touchById(id) {
  const db = getDb();
  const ts = nowISO();
  const stmt = stmtCache.get(db, 'projects:touchById', 'UPDATE projects SET updated_at = ? WHERE id = ?');
  stmt.run(ts, id);
}

function remove(id) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'projects:remove', 'DELETE FROM projects WHERE id = ?');
  stmt.run(id);
}

function setStatus(id, status) {
  const db = getDb();
  const ts = nowISO();
  const stmt = stmtCache.get(db, 'projects:setStatus', 'UPDATE projects SET status = ?, updated_at = ? WHERE id = ?');
  stmt.run(status, ts, id);
  return getById(id);
}

function getByName(project_name) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'projects:getByName', "SELECT * FROM projects WHERE project_name = ?");
  return stmt.get(project_name);
}

function updateFolderAndName(id, project_folder, project_name) {
  const db = getDb();
  const ts = nowISO();
  const stmt = stmtCache.get(db, 'projects:updateFolderAndName', `
    UPDATE projects 
    SET project_folder = ?, project_name = ?, updated_at = ? 
    WHERE id = ?
  `);
  stmt.run(project_folder, project_name, ts, id);
  return getById(id);
}

function createProjectFromFolder({ project_name, project_folder }) {
  const db = getDb();
  const ts = nowISO();
  
  const insert = stmtCache.get(db, 'projects:createFromFolder', `
    INSERT INTO projects (project_folder, project_name, created_at, updated_at, schema_version, status, archived_at, manifest_version)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, '1.0')
  `);
  const info = insert.run(project_folder, project_name, ts, ts, null);
  const id = info.lastInsertRowid;
  
  return getById(id);
}

// ---- Folder Update Function (used by maintenance) ----

function updateFolder(id, project_folder) {
  const db = getDb();
  const ts = nowISO();
  const stmt = stmtCache.get(db, 'projects:updateFolder', `
    UPDATE projects 
    SET project_folder = ?, 
        updated_at = ? 
    WHERE id = ?
  `);
  stmt.run(project_folder, ts, id);
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
  createProjectFromFolder,
  updateFolder, // Used by maintenance for folder alignment
};
