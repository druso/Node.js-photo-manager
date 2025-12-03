const path = require('path');
const fs = require('fs-extra');

// Known extensions
const JPG_EXTS = ['.jpg', '.jpeg'];
const RAW_EXTS = ['.cr2', '.nef', '.arw', '.dng', '.raw'];

// Only strip known photo extensions; do not strip arbitrary TLD-like suffixes (e.g., .com)
function baseFromParam(name) {
  try {
    const ext = (path.extname(name) || '').toLowerCase();
    const known = new Set(['.jpg', '.jpeg', '.raw', '.arw', '.cr2', '.nef', '.dng', '.webp']);
    if (known.has(ext)) {
      return path.basename(name, ext);
    }
    return name;
  } catch (_) {
    return name;
  }
}

function resolveOriginalPath({ projectPath, base, prefer, entry }) {
  // If entry is provided and ext matches preference, try it first
  const tryOrder = [];
  if (prefer === 'jpg') {
    if (entry && JPG_EXTS.includes((entry.ext || '').toLowerCase())) {
      tryOrder.push((entry.ext || '').toLowerCase());
    }
    for (const e of JPG_EXTS) if (!tryOrder.includes(e)) tryOrder.push(e);
  } else if (prefer === 'raw') {
    if (entry && RAW_EXTS.includes((entry.ext || '').toLowerCase())) {
      tryOrder.push((entry.ext || '').toLowerCase());
    }
    for (const e of RAW_EXTS) if (!tryOrder.includes(e)) tryOrder.push(e);
  } else {
    return null;
  }
  // Fast path: exact-case matches
  for (const ext of tryOrder) {
    const fp = path.join(projectPath, `${base}${ext}`);
    if (fs.existsSync(fp)) return fp;
  }
  // Slow path: case-insensitive scan (handles .JPG vs .jpg on case-sensitive FS)
  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true });
    const baseLower = String(base || '').toLowerCase();
    const allow = new Set(tryOrder); // already lower-cased extensions
    for (const dirent of entries) {
      if (!dirent.isFile()) continue;
      const name = dirent.name;
      const ext = (path.extname(name) || '').toLowerCase();
      if (!allow.has(ext)) continue;
      const bn = path.basename(name, path.extname(name));
      if (bn.toLowerCase() === baseLower) {
        return path.join(projectPath, name);
      }
    }
  } catch (_) {
    // ignore directory read errors; fall through
  }
  return null;
}

function guessContentTypeFromExt(fp) {
  const ext = (path.extname(fp) || '').toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  // We purposefully do not set RAW-specific types; fall back to octet-stream
  return 'application/octet-stream';
}

module.exports = {
  baseFromParam,
  resolveOriginalPath,
  guessContentTypeFromExt,
  JPG_EXTS,
  RAW_EXTS,
  resolvePhotoPath,
};

/**
 * Resolve the absolute path to a photo file, checking for existence with extension variants.
 * This is the canonical way to find a photo's source file on disk.
 * 
 * @param {string} projectPath - Absolute path to project folder
 * @param {Object} photo - Photo object with filename and ext
 * @returns {Promise<string|null>} Absolute path to photo file or null if not found
 */
async function resolvePhotoPath(projectPath, photo) {
  if (!projectPath || !photo || !photo.filename) return null;

  // Try exact match first (if ext is known)
  if (photo.ext) {
    const p1 = path.join(projectPath, `${photo.filename}.${photo.ext}`);
    if (await fs.pathExists(p1)) return p1;

    // Try uppercase
    const p2 = path.join(projectPath, `${photo.filename}.${photo.ext.toUpperCase()}`);
    if (await fs.pathExists(p2)) return p2;

    // Try lowercase
    const p3 = path.join(projectPath, `${photo.filename}.${photo.ext.toLowerCase()}`);
    if (await fs.pathExists(p3)) return p3;
  }

  // Fallback: try common extensions if ext is missing or not found
  // Combined list of supported extensions
  const commonExts = [
    'jpg', 'jpeg', 'png', 'webp', 'tiff', 'tif', // Common image formats
    'raw', 'cr2', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2' // RAW formats
  ];

  for (const ext of commonExts) {
    const p1 = path.join(projectPath, `${photo.filename}.${ext}`);
    if (await fs.pathExists(p1)) return p1;
    const p2 = path.join(projectPath, `${photo.filename}.${ext.toUpperCase()}`);
    if (await fs.pathExists(p2)) return p2;
  }

  return null;
}
