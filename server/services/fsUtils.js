const path = require('path');
const fs = require('fs-extra');
const { getConfig } = require('./config');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PROJECTS_DIR = process.env.NODE_ENV === 'test'
  ? path.join(PROJECT_ROOT, '.projects-test')
  : path.join(PROJECT_ROOT, '.projects');
const DEFAULT_USER = 'user_0';

function ensureUserRoot(user = DEFAULT_USER) {
  const userRoot = path.join(PROJECTS_DIR, user);
  fs.ensureDirSync(userRoot);
  return userRoot;
}

/**
 * Get the absolute path to a project folder
 * Centralized function to ensure consistent path resolution
 * @param {string|object} projectOrFolder - Project object or folder name
 * @returns {string} Absolute path to project folder
 */
function getProjectPath(projectOrFolder, user = DEFAULT_USER) {
  const projectFolder = typeof projectOrFolder === 'string' 
    ? projectOrFolder 
    : projectOrFolder?.project_folder;
  
  if (!projectFolder) {
    throw new Error('Invalid project or folder name');
  }
  
  const userRoot = ensureUserRoot(user);
  return path.join(userRoot, projectFolder);
}

function ensureProjectDirs(projectFolder, user = DEFAULT_USER) {
  const projectPath = getProjectPath(projectFolder, user);
  fs.ensureDirSync(projectPath);
  fs.ensureDirSync(path.join(projectPath, '.thumb'));
  fs.ensureDirSync(path.join(projectPath, '.preview'));
  fs.ensureDirSync(path.join(projectPath, '.trash'));
  return projectPath;
}

function moveToTrash(projectFolder, relPath, user = DEFAULT_USER) {
  const projectPath = ensureProjectDirs(projectFolder, user);
  const src = path.join(projectPath, relPath);
  const dest = path.join(projectPath, '.trash', path.basename(relPath));
  if (!fs.existsSync(src)) return false;
  fs.moveSync(src, dest, { overwrite: true });
  return true;
}

function removeDerivatives(projectFolder, baseName) {
  const projectPath = ensureProjectDirs(projectFolder);
  const thumb = path.join(projectPath, '.thumb', `${baseName}.jpg`);
  const preview = path.join(projectPath, '.preview', `${baseName}.jpg`);
  try { if (fs.existsSync(thumb)) fs.removeSync(thumb); } catch (_) {}
  try { if (fs.existsSync(preview)) fs.removeSync(preview); } catch (_) {}
}

function buildAcceptPredicate() {
  try {
    const cfg = getConfig();
    const exts = (cfg?.uploader?.accepted_files?.extensions || []).map(e => String(e).toLowerCase());
    const prefixes = (cfg?.uploader?.accepted_files?.mime_prefixes || []).map(p => String(p).toLowerCase());
    const set = new Set(exts);
    return {
      isAccepted(filename, mimetype) {
        const ext = path.extname(filename).toLowerCase().replace(/^\./, '');
        const mt = (mimetype || '').toLowerCase();
        const extOk = set.size === 0 ? true : set.has(ext);
        const mimeOk = prefixes.length === 0 ? true : prefixes.some(p => mt.startsWith(p));
        return extOk && (mimeOk || mt === '');
      },
      acceptedExtensions: set,
    };
  } catch (_) {
    const fallback = new Set(['jpg','jpeg','png','tif','tiff','raw','cr2','nef','arw','dng']);
    return {
      isAccepted(filename, _mimetype) {
        const ext = path.extname(filename).toLowerCase().replace(/^\./, '');
        return fallback.has(ext);
      },
      acceptedExtensions: fallback,
    };
  }
}

function listAcceptedFiles(projectFolder, acceptPredicate) {
  const projectPath = ensureProjectDirs(projectFolder);
  const skip = new Set(['.thumb', '.preview', '.trash']);
  const files = [];
  const entries = fs.readdirSync(projectPath);
  for (const entry of entries) {
    if (skip.has(entry)) continue;
    const full = path.join(projectPath, entry);
    const stat = fs.statSync(full);
    if (stat.isFile()) {
      if (!acceptPredicate || acceptPredicate(entry)) files.push(entry);
    }
  }
  return files;
}

function statMtimeSafe(fullPath) {
  try {
    const st = fs.statSync(fullPath);
    return st.mtime;
  } catch (_) {
  }
}

module.exports = {
  PROJECTS_DIR,
  DEFAULT_USER,
  ensureUserRoot,
  getProjectPath,
  ensureProjectDirs,
  moveToTrash,
  removeDerivatives,
  statMtimeSafe,
  buildAcceptPredicate,
};
