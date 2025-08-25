const path = require('path');
const fs = require('fs-extra');

// Known extensions
const JPG_EXTS = ['.jpg', '.jpeg'];
const RAW_EXTS = ['.cr2', '.nef', '.arw', '.dng', '.raw'];

// Only strip known photo extensions; do not strip arbitrary TLD-like suffixes (e.g., .com)
function baseFromParam(name) {
  try {
    const ext = (path.extname(name) || '').toLowerCase();
    const known = new Set(['.jpg', '.jpeg', '.raw', '.arw', '.cr2', '.nef', '.dng']);
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
};
