const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const exifParser = require('exif-parser');
const multer = require('multer');
const { getConfig } = require('../services/config');
const { generateDerivative } = require('../utils/imageProcessing');

// SQLite repositories (migration from manifest.json)
const projectsRepo = require('../services/repositories/projectsRepo');
const photosRepo = require('../services/repositories/photosRepo');

const router = express.Router();
// Ensure JSON bodies are parsed for this router (for subset processing requests)
router.use(express.json());

// In-memory progress store: { [folder]: { op: 'thumbnails'|'previews', total: number, processed: number, status: 'idle'|'running'|'completed'|'error', updatedAt: number } }
const progressStore = Object.create(null);

function setProgress(folder, payload) {
  progressStore[folder] = { ...(progressStore[folder] || {}), ...payload, updatedAt: Date.now() };
}

function clearProgress(folder) {
  progressStore[folder] = { op: null, total: 0, processed: 0, status: 'idle', updatedAt: Date.now() };
}

// Manifest service removed by SQL migration; routes now use repositories

// Resolve project directories relative to project root
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');
fs.ensureDirSync(PROJECTS_DIR);

// Multer setup (mirror server.js)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|tiff|tif|raw|cr2|nef|arw|dng/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || (file.mimetype && file.mimetype.startsWith('image/'));
    if (mimetype && extname) return cb(null, true);
    return cb(new Error('Only image files are allowed'));
  },
  limits: { fileSize: 100 * 1024 * 1024 }
});

// POST /api/projects/:folder/process (per-image: thumbnail then preview)
router.post('/:folder/process', async (req, res) => {
  try {
    const { folder } = req.params;
    const force = String(req.query.force || '').toLowerCase() === 'true';
    const requested = (req.body && Array.isArray(req.body.filenames) && req.body.filenames.length > 0)
      ? new Set(req.body.filenames)
      : null;
    // Build a case-insensitive lookup for requested filenames (schema stores base name in `filename`)
    const requestedLC = requested ? new Set(Array.from(requested).map(s => String(s).toLowerCase())) : null;
    const projectPath = path.join(PROJECTS_DIR, folder);
    if (!await fs.pathExists(projectPath)) return res.status(404).json({ error: 'Project not found' });
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const cfg = getConfig();
    const thumbCfg = (cfg.processing && cfg.processing.thumbnail) || { maxDim: 200, quality: 80 };
    const prevCfg = (cfg.processing && cfg.processing.preview) || { maxDim: 6000, quality: 80 };

    // Decide pending set from DB
    const all = photosRepo.listPaged({ project_id: project.id, limit: 100000, sort: 'filename', dir: 'ASC', cursor: null }).items;
    // If a subset is explicitly requested, process those regardless of current statuses (treat as force for the subset)
    const effectiveForce = force || !!requested;
    let baseCandidates = effectiveForce
      ? all.filter(e => e.thumbnail_status !== 'not_supported' || e.preview_status !== 'not_supported')
      : all.filter(e => (e.thumbnail_status === 'pending' || e.thumbnail_status === 'failed' || !e.thumbnail_status) || (e.preview_status === 'pending' || e.preview_status === 'failed' || !e.preview_status));
    const candidates = requestedLC ? all.filter(e => requestedLC.has(String(e.filename).toLowerCase())) : baseCandidates;

    console.log(`Per-image processing for ${candidates.length} images${requested ? ' (subset)' : ''}`);
    clearProgress(folder);
    setProgress(folder, { op: 'per-image', total: candidates.length, processed: 0, status: 'running' });

    let processedCount = 0;
    const results = [];

    const supportedExtensionsLower = ['.jpg', '.jpeg', '.png', '.tiff', '.webp'];

    for (const entry of candidates) {
      try {
        // Resolve a source file for this entry
        let sourceFile = null;
        const possibleFiles = supportedExtensionsLower.flatMap(ext => [
          `${entry.filename}${ext}`,
          `${entry.filename}${ext.toUpperCase()}`
        ]);
        for (const fileName of possibleFiles) {
          const filePath = path.join(projectPath, fileName);
          if (fs.existsSync(filePath)) { sourceFile = filePath; break; }
        }
        if (!sourceFile) {
          console.log(`No supported source file found for ${entry.filename}`);
          photosRepo.updateDerivativeStatus(entry.id, {
            thumbnail_status: entry.thumbnail_status || 'failed',
            preview_status: entry.preview_status || 'failed',
          });
          results.push({ filename: entry.filename, status: 'skipped_no_source' });
          continue;
        }

        // Thumbnail
        if (effectiveForce || entry.thumbnail_status === 'pending' || entry.thumbnail_status === 'failed' || !entry.thumbnail_status) {
          try {
            const thumbPath = path.join(projectPath, '.thumb', `${entry.filename}.jpg`);
            await generateDerivative(sourceFile, thumbPath, { maxDim: Number(thumbCfg.maxDim) || 200, quality: Number(thumbCfg.quality) || 80 });
            photosRepo.updateDerivativeStatus(entry.id, { thumbnail_status: 'generated' });
          } catch (te) {
            console.error(`Failed to generate thumbnail for ${entry.filename}:`, te);
            photosRepo.updateDerivativeStatus(entry.id, { thumbnail_status: 'failed' });
          }
        }

        // Preview
        if (effectiveForce || entry.preview_status === 'pending' || entry.preview_status === 'failed' || !entry.preview_status) {
          try {
            const previewPath = path.join(projectPath, '.preview', `${entry.filename}.jpg`);
            await generateDerivative(sourceFile, previewPath, { maxDim: Number(prevCfg.maxDim) || 6000, quality: Number(prevCfg.quality) || 80 });
            photosRepo.updateDerivativeStatus(entry.id, { preview_status: 'generated' });
          } catch (pe) {
            console.error(`Failed to generate preview for ${entry.filename}:`, pe);
            photosRepo.updateDerivativeStatus(entry.id, { preview_status: 'failed' });
          }
        }

        processedCount++;
        setProgress(folder, { processed: processedCount });
        results.push({ filename: entry.filename, status: 'processed' });
      } catch (err) {
        console.error(`Per-image processing failed for ${entry.filename}:`, err);
        results.push({ filename: entry.filename, status: 'failed', reason: err.message });
      }
    }

    setProgress(folder, { status: 'completed' });
    res.json({ message: `Processed ${processedCount} images`, processed: processedCount, total: candidates.length, results });
  } catch (err) {
    console.error('Error in per-image process:', err);
    const { folder } = req.params || {};
    if (folder) setProgress(folder, { status: 'error' });
    res.status(500).json({ error: 'Failed to process images' });
  }
});

// Small helper
function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (['.jpg', '.jpeg'].includes(ext)) return 'jpg';
  if (['.raw', '.cr2', '.nef', '.arw', '.dng'].includes(ext)) return 'raw';
  return 'other';
}

// POST /api/projects/:folder/upload
router.post('/:folder/upload', upload.array('photos'), async (req, res) => {
  try {
    const { folder } = req.params;
    const projectPath = path.join(PROJECTS_DIR, folder);
    if (!await fs.pathExists(projectPath)) return res.status(404).json({ error: 'Project not found' });
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const uploadedFiles = [];

    for (const file of req.files) {
      const originalName = path.parse(file.originalname).name;
      const ext = path.extname(file.originalname).toLowerCase();
      const fileType = getFileType(file.originalname);

      // Save original file
      const filePath = path.join(projectPath, file.originalname);
      await fs.writeFile(filePath, file.buffer);

      // Defer thumbnail generation
      const isRawFile = /\.(arw|cr2|nef|dng|raw)$/i.test(ext);
      console.log(`Deferring thumbnail generation for ${file.originalname} (RAW: ${isRawFile})`);

      // Extract EXIF for non-RAW
      let metadata = {};
      if (!isRawFile) {
        try {
          const parser = exifParser.create(file.buffer);
          const result = parser.parse();
          if (result && result.tags) {
            metadata = {
              date_time_original: result.tags.DateTimeOriginal ? new Date(result.tags.DateTimeOriginal * 1000).toISOString() : null,
              camera_model: result.tags.Model || null,
              camera_make: result.tags.Make || null,
              make: result.tags.Make || null,
              model: result.tags.Model || null,
              exif_image_width: result.tags.ExifImageWidth || null,
              exif_image_height: result.tags.ExifImageHeight || null,
              orientation: result.tags.Orientation || null
            };
            Object.keys(metadata).forEach(k => metadata[k] === null && delete metadata[k]);
          }
        } catch (err) {
          console.error(`EXIF parsing error for ${file.originalname}:`, err.message);
        }
      }

      // Thumbnail status
      const thumbnailStatus = isRawFile ? 'not_supported' : 'pending';
      const previewStatus = isRawFile ? 'not_supported' : 'pending';

      // Upsert into SQLite repository
      const existing = photosRepo.getByProjectAndFilename(project.id, originalName);
      const keepDefaults = (() => {
        try { const cfg = getConfig(); return (cfg && cfg.keep_defaults) || { jpg: true, raw: false }; } catch (_) { return { jpg: true, raw: false }; }
      })();

      const photoPayload = {
        manifest_id: existing?.manifest_id || undefined,
        filename: originalName,
        basename: originalName,
        ext: ext ? ext.replace(/^\./, '') : null,
        date_time_original: metadata.date_time_original || existing?.date_time_original || null,
        jpg_available: existing ? (existing.jpg_available || fileType === 'jpg') : (fileType === 'jpg'),
        raw_available: existing ? (existing.raw_available || fileType === 'raw') : (fileType === 'raw'),
        other_available: existing ? (existing.other_available || fileType === 'other') : (fileType === 'other'),
        keep_jpg: existing ? !!existing.keep_jpg : !!keepDefaults.jpg,
        keep_raw: existing ? !!existing.keep_raw : !!keepDefaults.raw,
        thumbnail_status: (fileType === 'jpg' || (existing && existing.thumbnail_status === 'failed')) ? thumbnailStatus : (existing?.thumbnail_status || null),
        preview_status: (fileType === 'jpg' || (existing && existing.preview_status === 'failed')) ? previewStatus : (existing?.preview_status || null),
        orientation: metadata.orientation ?? existing?.orientation ?? null,
        meta_json: Object.keys(metadata).length ? JSON.stringify(metadata) : (existing?.meta_json || null),
      };
      photosRepo.upsertPhoto(project.id, photoPayload);

      uploadedFiles.push({ filename: file.originalname, size: file.size, type: fileType });
    }

    res.json({ message: `Successfully uploaded ${uploadedFiles.length} files`, files: uploadedFiles });
  } catch (err) {
    console.error('Error uploading files:', err);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});

// POST /api/projects/:folder/analyze-files
router.post('/:folder/analyze-files', async (req, res) => {
  try {
    const { folder } = req.params;
    const { files } = req.body;
    const projectPath = path.join(PROJECTS_DIR, folder);
    if (!await fs.pathExists(projectPath)) return res.status(404).json({ error: 'Project not found' });
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const imageGroups = {};

    for (const file of files) {
      const baseName = path.parse(file.name).name;
      const ext = path.extname(file.name).toLowerCase();
      if (!imageGroups[baseName]) {
        imageGroups[baseName] = {
          baseName,
          files: [],
          hasJpg: false,
          hasRaw: false,
          analysis: []
        };
      }
      imageGroups[baseName].files.push(file);
      if (/\.(jpe?g)$/i.test(ext)) imageGroups[baseName].hasJpg = true;
      if (/\.(arw|cr2|nef|dng|raw)$/i.test(ext)) imageGroups[baseName].hasRaw = true;

      const existing = photosRepo.getByProjectAndFilename(project.id, baseName);
      if (existing) {
        const hasCompletion = (existing.raw_available && /\.(jpe?g)$/i.test(ext)) || (existing.jpg_available && /\.(arw|cr2|nef|dng|raw)$/i.test(ext));
        if (hasCompletion) {
          imageGroups[baseName].isNew = false;
          imageGroups[baseName].hasConflict = true;
          imageGroups[baseName].conflictType = 'completion';
        } else {
          imageGroups[baseName].isNew = false;
          imageGroups[baseName].hasConflict = true;
          imageGroups[baseName].conflictType = 'duplicate';
        }
      } else {
        imageGroups[baseName].analysis.push(`New image ${baseName}`);
        imageGroups[baseName].isNew = true;
        imageGroups[baseName].hasConflict = false;
      }
    }

    const summary = {
      totalImages: Object.keys(imageGroups).length,
      totalFiles: files.length,
      newImages: Object.values(imageGroups).filter(g => g.isNew).length,
      conflictImages: Object.values(imageGroups).filter(g => g.hasConflict).length,
      completionImages: Object.values(imageGroups).filter(g => g.conflictType === 'completion').length,
      duplicateImages: Object.values(imageGroups).filter(g => g.conflictType === 'duplicate').length
    };

    console.log(`Analysis complete: ${summary.totalImages} images, ${summary.newImages} new, ${summary.completionImages} completions, ${summary.duplicateImages} duplicates`);

    res.json({ success: true, imageGroups, summary, analysis: 'File analysis completed successfully' });
  } catch (err) {
    console.error('Error analyzing files:', err);
    res.status(500).json({ error: 'Failed to analyze files' });
  }
});

// POST /api/projects/:folder/generate-thumbnails
router.post('/:folder/generate-thumbnails', async (req, res) => {
  const { folder } = req.params;
  console.warn('[DEPRECATED] /generate-thumbnails called. Returning 410. Prefer /process (per-image).');
  clearProgress(folder);
  return res.status(410).json({ error: 'Deprecated: use /api/projects/:folder/process' });
});

// POST /api/projects/:folder/generate-previews
router.post('/:folder/generate-previews', async (req, res) => {
  return res.status(410).json({ error: 'Deprecated: use /api/projects/:folder/process' });
});

// GET /api/projects/:folder/progress
router.get('/:folder/progress', async (req, res) => {
  const { folder } = req.params;
  const p = progressStore[folder] || { op: null, total: 0, processed: 0, status: 'idle', updatedAt: Date.now() };
  res.json(p);
});

module.exports = router;
