const path = require('path');
const { getConfig } = require('../services/config');

/**
 * Build a file acceptance predicate based on config (uploader.accepted_files).
 * Falls back to a safe default set if config is unavailable.
 *
 * @returns {(filename: string, mimetype?: string) => boolean}
 */
function buildAcceptPredicate() {
  try {
    const cfg = getConfig();
    const exts = (cfg?.uploader?.accepted_files?.extensions || []).map(e => String(e).toLowerCase());
    const prefixes = (cfg?.uploader?.accepted_files?.mime_prefixes || []).map(p => String(p).toLowerCase());

    return (filename, mimetype) => {
      const ext = path.extname(filename).toLowerCase().replace(/^\./, '');
      const extOk = exts.length === 0 ? true : exts.includes(ext);
      const mt = (mimetype || '').toLowerCase();
      const mimeOk = prefixes.length === 0 ? true : prefixes.some(p => mt.startsWith(p));
      return extOk && (mimeOk || mt === '');
    };
  } catch (_) {
    // Fallback to common image/RAW types
    const fallback = new Set(['jpg','jpeg','png','tif','tiff','raw','cr2','nef','arw','dng']);
    return (filename, mimetype) => {
      const ext = path.extname(filename).toLowerCase().replace(/^\./, '');
      return fallback.has(ext) || (mimetype && mimetype.toLowerCase().startsWith('image/'));
    };
  }
}

module.exports = {
  buildAcceptPredicate,
};
