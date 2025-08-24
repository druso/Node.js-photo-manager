const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const makeLogger = require('../utils/logger2');
const log = makeLogger('assets');
const { rateLimit } = require('../utils/rateLimit');
const { signPayload, verifyToken } = require('../utils/signedUrl');
const projectsRepo = require('../services/repositories/projectsRepo');
const photosRepo = require('../services/repositories/photosRepo');
const { baseFromParam, resolveOriginalPath, guessContentTypeFromExt } = require('../utils/assetPaths');
const { getConfig } = require('../services/config');

const router = express.Router();

// Configurable rate limits (per-IP, per-process). Allow env overrides for quick dev tweaks.
function readLimits() {
  try {
    const cfg = getConfig();
    const rl = (cfg && cfg.rate_limits) || {};
    return {
      thumbnailPerMinute: Number(process.env.THUMBNAIL_RATELIMIT_MAX || rl.thumbnail_per_minute || 600),
      previewPerMinute: Number(process.env.PREVIEW_RATELIMIT_MAX || rl.preview_per_minute || 600),
      imagePerMinute: Number(process.env.IMAGE_RATELIMIT_MAX || rl.image_per_minute || 120),
      zipPerMinute: Number(process.env.ZIP_RATELIMIT_MAX || rl.zip_per_minute || 30),
    };
  } catch (_) {
    return { thumbnailPerMinute: 600, previewPerMinute: 600, imagePerMinute: 120, zipPerMinute: 30 };
  }
}
const RATE_LIMITS = readLimits();

// Paths
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');

function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'jpg';
  if (['.raw', '.cr2', '.nef', '.arw', '.dng'].includes(ext)) return 'raw';
  return 'other';
}

// Signed URL config (kept simple for local use). To disable enforcement set env REQUIRE_SIGNED_DOWNLOADS=false
const REQUIRE_SIGNED = process.env.REQUIRE_SIGNED_DOWNLOADS !== 'false';
const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || 'dev-download-secret-change-me';

function buildSignedUrl(folder, type, filename, ttlMs = 2 * 60 * 1000) {
  const exp = Date.now() + ttlMs;
  const jti = crypto.randomBytes(8).toString('hex');
  const payload = { f: folder, t: type, n: filename, exp, jti };
  const token = signPayload(payload, DOWNLOAD_SECRET);
  if (type === 'zip') {
    return `/api/projects/${encodeURIComponent(folder)}/files-zip/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`;
  }
  return `/api/projects/${encodeURIComponent(folder)}/file/${encodeURIComponent(type)}/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`;
}

function requireValidToken(req, res, next) {
  if (!REQUIRE_SIGNED) return next();
  const { folder } = req.params;
  const { token } = req.query;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  const v = verifyToken(String(token), DOWNLOAD_SECRET);
  if (!v.ok) return res.status(401).json({ error: 'Invalid token', reason: v.reason });
  const { f, t, n } = v.payload || {};
  const routeType = req.params.type || (req.path.includes('/files-zip/') ? 'zip' : null);
  const routeFilename = req.params.filename;
  if (f !== folder || n !== routeFilename || (routeType && t !== routeType)) {
    return res.status(401).json({ error: 'Token does not match request' });
  }
  return next();
}

function computeETagForFile(fp) {
  try {
    const stat = fs.statSync(fp);
    // Weak ETag based on size + mtime
    return `W/"${stat.size}-${Number(stat.mtimeMs).toString(16)}"`;
  } catch (_) {
    return null;
  }
}

function setCacheHeadersOn200(res) {
  res.setHeader('Cache-Control', 'public, max-age=60');
}

function setNegativeCacheHeaders(res) {
  // avoid stale negatives; let client revalidate soon
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
}

// GET /api/projects/:folder/thumbnail/:filename
// Limit: configurable (default 600/min/IP)
router.get('/:folder/thumbnail/:filename', rateLimit({ windowMs: 60 * 1000, max: RATE_LIMITS.thumbnailPerMinute }), (req, res) => {
  const { folder, filename } = req.params;
  const base = baseFromParam(filename);
  const thumbPath = path.join(PROJECTS_DIR, folder, '.thumb', `${base}.jpg`);
  log.info('thumb_request', { folder, filename, base, thumbPath, exists: fs.existsSync(thumbPath) });
  if (fs.existsSync(thumbPath)) {
    const etag = computeETagForFile(thumbPath);
    if (etag && req.headers['if-none-match'] === etag) {
      setCacheHeadersOn200(res);
      return res.status(304).end();
    }
    setCacheHeadersOn200(res);
    if (etag) res.setHeader('ETag', etag);
    try {
      res.setHeader('Content-Type', 'image/jpeg');
      const stream = fs.createReadStream(thumbPath);
      stream.on('error', (err) => {
        log.error('thumb_stream_error', { folder, filename, resolved: path.resolve(thumbPath), error: err && err.message, stack: err && err.stack });
        if (!res.headersSent) {
          setNegativeCacheHeaders(res);
          res.status(500).end();
        } else {
          try { res.destroy(); } catch (_) {}
        }
      });
      return stream.pipe(res);
    } catch (err) {
      log.error('thumb_stream_exception', { folder, filename, resolved: path.resolve(thumbPath), error: err && err.message, stack: err && err.stack });
      setNegativeCacheHeaders(res);
      return res.status(500).json({ error: 'Failed to stream thumbnail' });
    }
  }
  setNegativeCacheHeaders(res);
  return res.status(404).json({ error: 'Thumbnail not found' });
});

// GET /api/projects/:folder/preview/:filename
// Limit: configurable (default 600/min/IP)
router.get('/:folder/preview/:filename', rateLimit({ windowMs: 60 * 1000, max: RATE_LIMITS.previewPerMinute }), (req, res) => {
  const { folder, filename } = req.params;
  const base = baseFromParam(filename);
  const prevPath = path.join(PROJECTS_DIR, folder, '.preview', `${base}.jpg`);
  log.info('preview_request', { folder, filename, base, prevPath, exists: fs.existsSync(prevPath) });
  if (fs.existsSync(prevPath)) {
    const etag = computeETagForFile(prevPath);
    if (etag && req.headers['if-none-match'] === etag) {
      setCacheHeadersOn200(res);
      return res.status(304).end();
    }
    setCacheHeadersOn200(res);
    if (etag) res.setHeader('ETag', etag);
    try {
      res.setHeader('Content-Type', 'image/jpeg');
      const stream = fs.createReadStream(prevPath);
      stream.on('error', (err) => {
        log.error('preview_stream_error', { folder, filename, resolved: path.resolve(prevPath), error: err && err.message, stack: err && err.stack });
        if (!res.headersSent) {
          setNegativeCacheHeaders(res);
          res.status(500).end();
        } else {
          try { res.destroy(); } catch (_) {}
        }
      });
      return stream.pipe(res);
    } catch (err) {
      log.error('preview_stream_exception', { folder, filename, resolved: path.resolve(prevPath), error: err && err.message, stack: err && err.stack });
      setNegativeCacheHeaders(res);
      return res.status(500).json({ error: 'Failed to stream preview' });
    }
  }
  setNegativeCacheHeaders(res);
  return res.status(404).json({ error: 'Preview not found' });
});

// GET /api/projects/:folder/file/:type/:filename -> force specific type (raw|jpg)
router.get('/:folder/file/:type/:filename', rateLimit({ windowMs: 60 * 1000, max: RATE_LIMITS.imagePerMinute }), requireValidToken, async (req, res) => {
  const { folder, type } = req.params;
  const filenameParam = req.params.filename;
  const projectPath = path.join(PROJECTS_DIR, folder);
  try {
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const base = baseFromParam(filenameParam); // normalize only for disk paths
    const entry = photosRepo.getByProjectAndFilename(project.id, filenameParam); // lookup uses full filename
    if (!entry) return res.status(404).json({ error: 'Photo not found' });

    if (!['jpg', 'raw'].includes(type)) {
      return res.status(400).json({ error: 'Unsupported type. Use raw or jpg.' });
    }

    const chosenFile = resolveOriginalPath({ projectPath, base, prefer: type, entry });
    if (!chosenFile || !fs.existsSync(chosenFile)) return res.status(404).json({ error: 'Requested file not found' });

    // Stream with headers
    const etag = computeETagForFile(chosenFile);
    if (etag && req.headers['if-none-match'] === etag) {
      setCacheHeadersOn200(res);
      return res.status(304).end();
    }
    setCacheHeadersOn200(res);
    if (etag) res.setHeader('ETag', etag);
    res.setHeader('Content-Type', guessContentTypeFromExt(chosenFile));
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(chosenFile)}"`);
    try {
      const stream = fs.createReadStream(chosenFile);
      stream.on('error', (err) => {
        log.error('original_stream_error', { project_folder: folder, filename: filenameParam, type, resolved: path.resolve(chosenFile), error: err && err.message, stack: err && err.stack });
        if (!res.headersSent) {
          setNegativeCacheHeaders(res);
          res.status(500).end();
        } else {
          try { res.destroy(); } catch (_) {}
        }
      });
      return stream.pipe(res);
    } catch (err) {
      log.error('original_stream_exception', { project_folder: folder, filename: filenameParam, type, resolved: path.resolve(chosenFile), error: err && err.message, stack: err && err.stack });
      setNegativeCacheHeaders(res);
      return res.status(500).json({ error: 'Failed to stream file' });
    }
  } catch (err) {
    log.error('serve_specific_file_error', { project_folder: folder, filename: filenameParam, type, error: err && err.message, stack: err && err.stack });
    return res.status(500).json({ error: 'Failed to serve file' });
  }
});

// POST /api/projects/:folder/download-url  -> { filename, type: 'jpg'|'raw'|'zip', ttlMs? } => { url }
router.post('/:folder/download-url', express.json(), async (req, res) => {
  try {
    const { folder } = req.params;
    const { filename, type, ttlMs } = req.body || {};
    if (!filename || !type || !['jpg', 'raw', 'zip'].includes(type)) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    // Optionally verify the file exists in manifest for safety
    const projectPath = path.join(PROJECTS_DIR, folder);
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const base = baseFromParam(filename);
    const entry = photosRepo.getByProjectAndFilename(project.id, filename);
    if (!entry) return res.status(404).json({ error: 'Photo not found' });
    const url = buildSignedUrl(folder, type, filename, typeof ttlMs === 'number' ? ttlMs : undefined);
    return res.json({ url });
  } catch (err) {
    log.error('download_url_error', { project_folder: folder, filename, type, error: err && err.message, stack: err && err.stack });
    return res.status(500).json({ error: 'Failed to mint download URL' });
  }
});

// GET /api/projects/:folder/files-zip/:filename -> zip all related files (jpg + raw if present)
router.get('/:folder/files-zip/:filename', rateLimit({ windowMs: 60 * 1000, max: RATE_LIMITS.zipPerMinute }), requireValidToken, async (req, res) => {
  const { folder } = req.params;
  const filenameParam = req.params.filename;
  const projectPath = path.join(PROJECTS_DIR, folder);
  try {
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const base = baseFromParam(filenameParam); // normalize only for disk paths
    const entry = photosRepo.getByProjectAndFilename(project.id, filenameParam); // lookup uses full filename
    if (!entry) return res.status(404).json({ error: 'Photo not found' });

    const jpgPath = resolveOriginalPath({ projectPath, base, prefer: 'jpg', entry });
    const rawPath = resolveOriginalPath({ projectPath, base, prefer: 'raw', entry });
    const candidates = [jpgPath, rawPath].filter(Boolean);
    if (!candidates.length) return res.status(404).json({ error: 'No related files found to zip' });

    // Lazy-require archiver to avoid cost if endpoint unused
    const archiver = require('archiver');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);
    for (const filePath of candidates) {
      archive.file(filePath, { name: path.basename(filePath) });
    }
    archive.finalize();
  } catch (err) {
    log.error('create_zip_error', { project_folder: folder, filename: filenameParam, error: err && err.message, stack: err && err.stack });
    return res.status(500).json({ error: 'Failed to create zip' });
  }
});

// GET /api/projects/:folder/image/:filename  -> streams full-res JPG (no RAW here)
router.get('/:folder/image/:filename', rateLimit({ windowMs: 60 * 1000, max: RATE_LIMITS.imagePerMinute }), async (req, res) => {
  const { folder, filename } = req.params;
  const projectPath = path.join(PROJECTS_DIR, folder);

  try {
    const project = projectsRepo.getByFolder(folder);
    if (!project) { setNegativeCacheHeaders(res); return res.status(404).json({ error: 'Project not found' }); }
    const base = baseFromParam(filename);
    const entry = photosRepo.getByProjectAndFilename(project.id, filename); // lookup uses full filename
    if (!entry) { setNegativeCacheHeaders(res); return res.status(404).json({ error: 'Photo not found' }); }

    if (!entry.jpg_available) {
      // Do not attempt to stream RAW here; viewer should fallback to preview for RAW-only
      log.info('image_request_no_jpg', { folder, filename, base });
      setNegativeCacheHeaders(res);
      return res.status(404).json({ error: 'Full-res JPG not available' });
    }

    const jpgPath = resolveOriginalPath({ projectPath, base, prefer: 'jpg', entry });
    if (!jpgPath) { setNegativeCacheHeaders(res); return res.status(404).json({ error: 'JPG file not found on disk' }); }

    const etag = computeETagForFile(jpgPath);
    if (etag && req.headers['if-none-match'] === etag) {
      setCacheHeadersOn200(res);
      return res.status(304).end();
    }
    setCacheHeadersOn200(res);
    if (etag) res.setHeader('ETag', etag);
    try {
      res.setHeader('Content-Type', 'image/jpeg');
      const stream = fs.createReadStream(jpgPath);
      stream.on('error', (err) => {
        log.error('image_stream_error', { folder, filename, base, resolved: path.resolve(jpgPath), error: err && err.message, stack: err && err.stack });
        if (!res.headersSent) {
          setNegativeCacheHeaders(res);
          res.status(500).end();
        } else {
          try { res.destroy(); } catch (_) {}
        }
      });
      return stream.pipe(res);
    } catch (err) {
      log.error('image_stream_exception', { folder, filename, base, resolved: path.resolve(jpgPath), error: err && err.message, stack: err && err.stack });
      setNegativeCacheHeaders(res);
      return res.status(500).json({ error: 'Failed to stream image' });
    }
  } catch (err) {
    log.error('serve_image_error', { project_folder: folder, filename, error: err && err.message, stack: err && err.stack });
    setNegativeCacheHeaders(res);
    return res.status(500).json({ error: 'Failed to serve image' });
  }
});

module.exports = router;
