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
  for (const ext of tryOrder) {
    const fp = path.join(projectPath, `${base}${ext}`);
    if (fs.existsSync(fp)) return fp;
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
