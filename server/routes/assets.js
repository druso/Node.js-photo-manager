const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { rateLimit } = require('../utils/rateLimit');
const { signPayload, verifyToken } = require('../utils/signedUrl');
const projectsRepo = require('../services/repositories/projectsRepo');
const photosRepo = require('../services/repositories/photosRepo');

const router = express.Router();

// Paths
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');
fs.ensureDirSync(PROJECTS_DIR);

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
// Limit: 60 requests per minute per IP
router.get('/:folder/thumbnail/:filename', rateLimit({ windowMs: 60 * 1000, max: 60 }), (req, res) => {
  const { folder, filename } = req.params;
  const thumbPath = path.join(PROJECTS_DIR, folder, '.thumb', `${filename}.jpg`);
  if (fs.existsSync(thumbPath)) {
    const etag = computeETagForFile(thumbPath);
    if (etag && req.headers['if-none-match'] === etag) {
      setCacheHeadersOn200(res);
      return res.status(304).end();
    }
    setCacheHeadersOn200(res);
    if (etag) res.setHeader('ETag', etag);
    return res.sendFile(path.resolve(thumbPath));
  }
  setNegativeCacheHeaders(res);
  return res.status(404).json({ error: 'Thumbnail not found' });
});

// GET /api/projects/:folder/preview/:filename
// Limit: 60 requests per minute per IP
router.get('/:folder/preview/:filename', rateLimit({ windowMs: 60 * 1000, max: 60 }), (req, res) => {
  const { folder, filename } = req.params;
  const prevPath = path.join(PROJECTS_DIR, folder, '.preview', `${filename}.jpg`);
  if (fs.existsSync(prevPath)) {
    const etag = computeETagForFile(prevPath);
    if (etag && req.headers['if-none-match'] === etag) {
      setCacheHeadersOn200(res);
      return res.status(304).end();
    }
    setCacheHeadersOn200(res);
    if (etag) res.setHeader('ETag', etag);
    return res.sendFile(path.resolve(prevPath));
  }
  setNegativeCacheHeaders(res);
  return res.status(404).json({ error: 'Preview not found' });
});

// GET /api/projects/:folder/file/:type/:filename -> force specific type (raw|jpg)
router.get('/:folder/file/:type/:filename', requireValidToken, async (req, res) => {
  const { folder, type } = req.params;
  const filenameParam = req.params.filename;
  const projectPath = path.join(PROJECTS_DIR, folder);
  try {
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const base = path.parse(filenameParam).name; // normalize
    const entry = photosRepo.getByProjectAndFilename(project.id, base);
    if (!entry) return res.status(404).json({ error: 'Photo not found' });

    const files = await fs.readdir(projectPath);
    let chosenFile = null;
    if (type === 'jpg') {
      const jpg = files.find(f => path.parse(f).name === base && getFileType(f) === 'jpg');
      if (jpg) chosenFile = path.join(projectPath, jpg);
    } else if (type === 'raw') {
      const raw = files.find(f => path.parse(f).name === base && getFileType(f) === 'raw');
      if (raw) chosenFile = path.join(projectPath, raw);
    } else {
      return res.status(400).json({ error: 'Unsupported type. Use raw or jpg.' });
    }

    if (!chosenFile || !fs.existsSync(chosenFile)) return res.status(404).json({ error: 'Requested file not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(chosenFile)}"`);
    return res.sendFile(path.resolve(chosenFile));
  } catch (err) {
    console.error('Assets router: error serving specific file:', err);
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
    const base = path.parse(filename).name;
    const entry = photosRepo.getByProjectAndFilename(project.id, base);
    if (!entry) return res.status(404).json({ error: 'Photo not found' });
    const url = buildSignedUrl(folder, type, filename, typeof ttlMs === 'number' ? ttlMs : undefined);
    return res.json({ url });
  } catch (err) {
    console.error('download-url error:', err);
    return res.status(500).json({ error: 'Failed to mint download URL' });
  }
});

// GET /api/projects/:folder/files-zip/:filename -> zip all related files (jpg + raw if present)
router.get('/:folder/files-zip/:filename', requireValidToken, async (req, res) => {
  const { folder } = req.params;
  const filenameParam = req.params.filename;
  const projectPath = path.join(PROJECTS_DIR, folder);
  try {
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const base = path.parse(filenameParam).name; // normalize
    const entry = photosRepo.getByProjectAndFilename(project.id, base);
    if (!entry) return res.status(404).json({ error: 'Photo not found' });

    const files = await fs.readdir(projectPath);
    const candidates = files.filter(f => path.parse(f).name === base && ['jpg', 'raw'].includes(getFileType(f)));
    if (!candidates.length) return res.status(404).json({ error: 'No related files found to zip' });

    // Lazy-require archiver to avoid cost if endpoint unused
    const archiver = require('archiver');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);
    for (const f of candidates) {
      archive.file(path.join(projectPath, f), { name: f });
    }
    archive.finalize();
  } catch (err) {
    console.error('Assets router: error creating zip:', err);
    return res.status(500).json({ error: 'Failed to create zip' });
  }
});

// GET /api/projects/:folder/image/:filename
router.get('/:folder/image/:filename', async (req, res) => {
  const { folder, filename } = req.params;
  const projectPath = path.join(PROJECTS_DIR, folder);

  try {
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const photoEntry = photosRepo.getByProjectAndFilename(project.id, filename);
    if (!photoEntry) return res.status(404).json({ error: 'Photo not found' });

    let imagePath = null;
    const files = await fs.readdir(projectPath);

    if (photoEntry.jpg_available) {
      const jpgFile = files.find(f => path.parse(f).name === filename && getFileType(f) === 'jpg');
      if (jpgFile) imagePath = path.join(projectPath, jpgFile);
    }

    if (!imagePath && photoEntry.raw_available) {
      const rawFile = files.find(f => path.parse(f).name === filename && getFileType(f) === 'raw');
      if (rawFile) imagePath = path.join(projectPath, rawFile);
    }

    if (imagePath && fs.existsSync(imagePath)) {
      return res.sendFile(path.resolve(imagePath));
    }
    return res.status(404).json({ error: 'Image file not found on disk' });
  } catch (err) {
    console.error('Assets router: error serving image:', err);
    return res.status(500).json({ error: 'Failed to serve image' });
  }
});

module.exports = router;
