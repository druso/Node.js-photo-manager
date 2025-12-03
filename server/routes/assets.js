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
const { ensureHashForPhoto, getActiveHash, validateHash } = require('../services/publicAssetHashes');
const { baseFromParam, resolveOriginalPath, guessContentTypeFromExt } = require('../utils/assetPaths');
const { getConfig } = require('../services/config');
const { getProjectPath } = require('../services/fsUtils');
const { verifyAccessToken } = require('../services/auth/tokenService');
const { ACCESS_COOKIE_NAME } = require('../services/auth/authCookieService');

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

function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'jpg';
  if (['.raw', '.cr2', '.nef', '.arw', '.dng'].includes(ext)) return 'raw';
  return 'other';
}

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || !value) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}

function extractCookieToken(req) {
  const cookies = req.cookies || {};
  const raw = cookies[ACCESS_COOKIE_NAME];
  if (!raw || typeof raw !== 'string') return null;
  return raw.trim() || null;
}

function getOptionalAdmin(req) {
  try {
    const headerToken = extractBearerToken(req);
    const cookieToken = extractCookieToken(req);
    const token = headerToken || cookieToken;
    if (!token) return null;
    const decoded = verifyAccessToken(token);
    if (decoded.role !== 'admin') return null;
    return {
      id: decoded.sub || 'admin',
      role: decoded.role,
      tokenId: decoded.jti || null,
    };
  } catch (_err) {
    return null;
  }
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

router.get('/image/:filename', async (req, res) => {
  try {
    const rawName = req.params.filename;
    if (!rawName) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    const normalized = String(rawName).trim();
    const hasExtension = /\.[A-Za-z0-9]+$/.test(normalized);
    const slug = hasExtension ? normalized : normalized.replace(/\.[^/.]+$/, '');

    let record = photosRepo.getAnyVisibilityByFilename(normalized);
    if (!record && !hasExtension) {
      record = photosRepo.getAnyVisibilityByBasename(slug);
    }

    if (!record) {
      setNegativeCacheHeaders(res);
      return res.status(404).json({ error: 'Photo not found' });
    }

    if ((record.visibility || 'private') !== 'public') {
      setNegativeCacheHeaders(res);
      return res.status(401).json({ error: 'Authentication required', visibility: record.visibility || 'private' });
    }

    const hashRecord = ensureHashForPhoto(record.id);
    const baseName = record.basename || record.filename;
    const response = {
      photo: {
        id: record.id,
        project_id: record.project_id,
        project_folder: record.project_folder,
        project_name: record.project_name,
        filename: record.filename,
        basename: record.basename || null,
        visibility: record.visibility || 'private',
        updated_at: record.updated_at,
        date_time_original: record.date_time_original,
        jpg_available: !!record.jpg_available,
        preview_available: !!record.preview_status && record.preview_status !== 'missing',
        hash: hashRecord.hash,
        hash_expires_at: hashRecord.expires_at,
      },
      assets: {
        thumbnail_url: `/api/projects/${encodeURIComponent(record.project_folder)}/thumbnail/${encodeURIComponent(baseName)}?hash=${encodeURIComponent(hashRecord.hash)}`,
        preview_url: `/api/projects/${encodeURIComponent(record.project_folder)}/preview/${encodeURIComponent(record.filename)}?hash=${encodeURIComponent(hashRecord.hash)}`,
        image_url: `/api/projects/${encodeURIComponent(record.project_folder)}/image/${encodeURIComponent(record.filename)}?hash=${encodeURIComponent(hashRecord.hash)}`,
      },
    };

    res.setHeader('Cache-Control', 'no-store');
    return res.json(response);
  } catch (err) {
    log.error('public_image_lookup_failed', { error: err && err.message, stack: err && err.stack });
    return res.status(500).json({ error: 'Failed to resolve image link' });
  }
});

function computeETagForFile(fp) {
  try {
    const stat = fs.statSync(fp);
    // Weak ETag based on size + mtime
    return `W/"${stat.size}-${Number(stat.mtimeMs).toString(16)}"`;
  } catch (_) {
    return null;
  }
}

function setCacheHeadersOn200(req, res) {
  try {
    const hasVersion = !!(req && req.query && typeof req.query.v !== 'undefined');
    if (hasVersion) {
      // With deterministic versioned URLs, we can cache aggressively
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=60');
    }
  } catch (_) {
    res.setHeader('Cache-Control', 'public, max-age=60');
  }
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
  const projectPath = getProjectPath(folder);
  const thumbPath = path.join(projectPath, '.thumb', `${base}.webp`);
  log.info('thumb_request', { folder, filename, base, thumbPath, exists: fs.existsSync(thumbPath) });
  const admin = getOptionalAdmin(req);
  if (fs.existsSync(thumbPath)) {
    const project = projectsRepo.getByFolder(folder);
    if (!project) {
      setNegativeCacheHeaders(res);
      return res.status(404).json({ error: 'Project not found' });
    }
    let entry = photosRepo.getByProjectAndFilename(project.id, filename);
    if (!entry && base && base !== filename) {
      entry = photosRepo.getByProjectAndBasename(project.id, base);
    }
    if (!entry) {
      setNegativeCacheHeaders(res);
      return res.status(404).json({ error: 'Photo not found' });
    }
    const isPublic = (entry.visibility || 'private') === 'public';
    let hashRecord = null;
    if (!isPublic && !admin) {
      setNegativeCacheHeaders(res);
      return res.status(404).json({ error: 'Thumbnail not found' });
    }
    if (isPublic) {
      if (admin) {
        hashRecord = getActiveHash(entry.id) || ensureHashForPhoto(entry.id);
      } else {
        const providedHash = typeof req.query?.hash === 'string' ? req.query.hash : null;
        const validation = validateHash(entry.id, providedHash);
        if (!validation.ok) {
          setNegativeCacheHeaders(res);
          return res.status(401).json({ error: 'Public hash invalid', reason: validation.reason });
        }
        hashRecord = validation.record;
      }
    }
    const etag = computeETagForFile(thumbPath);
    if (etag && req.headers['if-none-match'] === etag) {
      setCacheHeadersOn200(req, res);
      return res.status(304).end();
    }
    setCacheHeadersOn200(req, res);
    if (etag) res.setHeader('ETag', etag);
    try {
      res.setHeader('Content-Type', 'image/webp');
      if (hashRecord) {
        res.setHeader('X-Public-Hash', hashRecord.hash);
        res.setHeader('X-Public-Hash-Expires-At', hashRecord.expires_at);
      }
      const stream = fs.createReadStream(thumbPath);
      stream.on('error', (err) => {
        log.error('thumb_stream_error', { folder, filename, resolved: path.resolve(thumbPath), error: err && err.message, stack: err && err.stack });
        if (!res.headersSent) {
          setNegativeCacheHeaders(res);
          res.status(500).end();
        } else {
          try {
            res.destroy();
          } catch (destroyErr) {
            log.debug('response_destroy_failed', { error: destroyErr.message });
          }
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
  const projectPath = getProjectPath(folder);
  const prevPath = path.join(projectPath, '.preview', `${base}.webp`);
  log.info('preview_request', { folder, filename, base, prevPath, exists: fs.existsSync(prevPath) });
  const admin = getOptionalAdmin(req);
  if (fs.existsSync(prevPath)) {
    const project = projectsRepo.getByFolder(folder);
    if (!project) {
      setNegativeCacheHeaders(res);
      return res.status(404).json({ error: 'Project not found' });
    }
    let entry = photosRepo.getByProjectAndFilename(project.id, filename);
    if (!entry && base && base !== filename) {
      entry = photosRepo.getByProjectAndBasename(project.id, base);
    }
    if (!entry) {
      setNegativeCacheHeaders(res);
      return res.status(404).json({ error: 'Photo not found' });
    }
    const isPublic = (entry.visibility || 'private') === 'public';
    let hashRecord = null;
    if (!isPublic && !admin) {
      setNegativeCacheHeaders(res);
      return res.status(404).json({ error: 'Preview not found' });
    }
    if (isPublic) {
      if (admin) {
        hashRecord = getActiveHash(entry.id) || ensureHashForPhoto(entry.id);
      } else {
        const providedHash = typeof req.query?.hash === 'string' ? req.query.hash : null;
        const validation = validateHash(entry.id, providedHash);
        if (!validation.ok) {
          setNegativeCacheHeaders(res);
          return res.status(401).json({ error: 'Public hash invalid', reason: validation.reason });
        }
        hashRecord = validation.record;
      }
    }
    const etag = computeETagForFile(prevPath);
    if (etag && req.headers['if-none-match'] === etag) {
      setCacheHeadersOn200(req, res);
      return res.status(304).end();
    }
    setCacheHeadersOn200(req, res);
    if (etag) res.setHeader('ETag', etag);
    try {
      res.setHeader('Content-Type', 'image/webp');
      if (hashRecord) {
        res.setHeader('X-Public-Hash', hashRecord.hash);
        res.setHeader('X-Public-Hash-Expires-At', hashRecord.expires_at);
      }
      const stream = fs.createReadStream(prevPath);
      stream.on('error', (err) => {
        log.error('preview_stream_error', { folder, filename, resolved: path.resolve(prevPath), error: err && err.message, stack: err && err.stack });
        if (!res.headersSent) {
          setNegativeCacheHeaders(res);
          res.status(500).end();
        } else {
          try {
            res.destroy();
          } catch (destroyErr) {
            log.debug('response_destroy_failed', { error: destroyErr.message });
          }
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
  const projectPath = getProjectPath(folder);
  try {
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const base = baseFromParam(filenameParam); // normalize only for disk paths
    // Try exact filename first, then fallback to base (without extension)
    let entry = photosRepo.getByProjectAndFilename(project.id, filenameParam);
    const triedExact = !!entry;
    if (!entry && base && base !== filenameParam) {
      entry = photosRepo.getByProjectAndBasename(project.id, base);
    }
    log.info('file_lookup', { project_folder: folder, type, filename: filenameParam, base, tried_exact: triedExact, found: !!entry });
    if (!entry) return res.status(404).json({ error: 'Photo not found' });

    if (!['jpg', 'raw'].includes(type)) {
      return res.status(400).json({ error: 'Unsupported type. Use raw or jpg.' });
    }

    const chosenFile = resolveOriginalPath({ projectPath, base, prefer: type, entry });
    log.info('file_resolve', { project_folder: folder, type, filename: filenameParam, base, chosen: chosenFile ? path.resolve(chosenFile) : null });
    if (!chosenFile || !fs.existsSync(chosenFile)) return res.status(404).json({ error: 'Requested file not found' });

    // Stream with headers
    const etag = computeETagForFile(chosenFile);
    if (etag && req.headers['if-none-match'] === etag) {
      setCacheHeadersOn200(req, res);
      return res.status(304).end();
    }
    setCacheHeadersOn200(req, res);
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
          try {
            res.destroy();
          } catch (destroyErr) {
            log.debug('response_destroy_failed', { error: destroyErr.message });
          }
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
  const { folder } = req.params;
  const { filename, type, ttlMs } = req.body || {};
  try {
    if (!filename || !type || !['jpg', 'raw', 'zip'].includes(type)) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    // Optionally verify the file exists in manifest for safety
    const projectPath = getProjectPath(folder);
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const base = baseFromParam(filename);
    // Try exact filename first, then fallback to base (without extension)
    let entry = photosRepo.getByProjectAndFilename(project.id, filename);
    const triedExact = !!entry;
    if (!entry && base && base !== filename) {
      entry = photosRepo.getByProjectAndBasename(project.id, base);
    }
    log.info('download_url_lookup', { project_folder: folder, filename, base, tried_exact: triedExact, found: !!entry });
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
  const projectPath = getProjectPath(folder);
  try {
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const base = baseFromParam(filenameParam); // normalize only for disk paths
    // Try exact filename first, then fallback to base (without extension)
    let entry = photosRepo.getByProjectAndFilename(project.id, filenameParam);
    const triedExact = !!entry;
    if (!entry && base && base !== filenameParam) {
      entry = photosRepo.getByProjectAndBasename(project.id, base);
    }
    log.info('zip_lookup', { project_folder: folder, filename: filenameParam, base, tried_exact: triedExact, found: !!entry });
    if (!entry) return res.status(404).json({ error: 'Photo not found' });

    const jpgPath = resolveOriginalPath({ projectPath, base, prefer: 'jpg', entry });
    const rawPath = resolveOriginalPath({ projectPath, base, prefer: 'raw', entry });
    log.info('zip_resolve', { project_folder: folder, filename: filenameParam, base, jpg: jpgPath ? path.resolve(jpgPath) : null, raw: rawPath ? path.resolve(rawPath) : null });
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
  const projectPath = getProjectPath(folder);

  try {
    const project = projectsRepo.getByFolder(folder);
    if (!project) { setNegativeCacheHeaders(res); return res.status(404).json({ error: 'Project not found' }); }
    const base = baseFromParam(filename);
    // Try exact filename first, then fallback to base (without extension)
    let entry = photosRepo.getByProjectAndFilename(project.id, filename);
    const triedExact = !!entry;
    if (!entry && base && base !== filename) {
      entry = photosRepo.getByProjectAndBasename(project.id, base);
    }
    log.info('image_lookup', { project_folder: folder, filename, base, tried_exact: triedExact, found: !!entry });
    if (!entry) { setNegativeCacheHeaders(res); return res.status(404).json({ error: 'Photo not found' }); }

    const admin = getOptionalAdmin(req);
    const isPublic = (entry.visibility || 'private') === 'public';
    let hashRecord = null;
    if (!isPublic && !admin) {
      setNegativeCacheHeaders(res);
      return res.status(404).json({ error: 'JPG file not found on disk' });
    }
    if (isPublic) {
      if (admin) {
        hashRecord = getActiveHash(entry.id) || ensureHashForPhoto(entry.id);
      } else {
        const providedHash = typeof req.query?.hash === 'string' ? req.query.hash : null;
        const validation = validateHash(entry.id, providedHash);
        if (!validation.ok) {
          setNegativeCacheHeaders(res);
          return res.status(401).json({ error: 'Public hash invalid', reason: validation.reason });
        }
        hashRecord = validation.record;
      }
    }

    if (!entry.jpg_available) {
      // Do not attempt to stream RAW here; viewer should fallback to preview for RAW-only
      log.info('image_request_no_jpg', { folder, filename, base });
      setNegativeCacheHeaders(res);
      return res.status(404).json({ error: 'Full-res JPG not available' });
    }

    const jpgPath = resolveOriginalPath({ projectPath, base, prefer: 'jpg', entry });
    log.info('image_resolve', { project_folder: folder, filename, base, jpg: jpgPath ? path.resolve(jpgPath) : null });
    if (!jpgPath) { setNegativeCacheHeaders(res); return res.status(404).json({ error: 'JPG file not found on disk' }); }

    const etag = computeETagForFile(jpgPath);
    if (etag && req.headers['if-none-match'] === etag) {
      setCacheHeadersOn200(req, res);
      return res.status(304).end();
    }
    setCacheHeadersOn200(req, res);
    if (etag) res.setHeader('ETag', etag);
    try {
      res.setHeader('Content-Type', 'image/jpeg');
      if (hashRecord) {
        res.setHeader('X-Public-Hash', hashRecord.hash);
        res.setHeader('X-Public-Hash-Expires-At', hashRecord.expires_at);
      }
      const stream = fs.createReadStream(jpgPath);
      stream.on('error', (err) => {
        log.error('image_stream_error', { folder, filename, base, resolved: path.resolve(jpgPath), error: err && err.message, stack: err && err.stack });
        if (!res.headersSent) {
          setNegativeCacheHeaders(res);
          res.status(500).end();
        } else {
          try {
            res.destroy();
          } catch (destroyErr) {
            log.debug('response_destroy_failed', { error: destroyErr.message });
          }
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
