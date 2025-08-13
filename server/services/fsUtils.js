const path = require('path');
const fs = require('fs-extra');
const { getConfig } = require('./config');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');

function ensureProjectDirs(projectFolder) {
  const projectPath = path.join(PROJECTS_DIR, projectFolder);
  fs.ensureDirSync(projectPath);
  fs.ensureDirSync(path.join(projectPath, '.thumb'));
  fs.ensureDirSync(path.join(projectPath, '.preview'));
  fs.ensureDirSync(path.join(projectPath, '.trash'));
  return projectPath;
}

function moveToTrash(projectFolder, relPath) {
  const projectPath = ensureProjectDirs(projectFolder);
  const src = path.join(projectPath, relPath);
  const dest = path.join(projectPath, '.trash', path.basename(relPath));
  if (!fs.existsSync(src)) return false;
  fs.moveSync(src, dest, { overwrite: true });
  return true;
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
    return null;
  }
}

module.exports = {
  PROJECTS_DIR,
  ensureProjectDirs,
  moveToTrash,
  listAcceptedFiles,
  statMtimeSafe,
  buildAcceptPredicate,
};
