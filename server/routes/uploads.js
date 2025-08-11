const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const exifParser = require('exif-parser');
const multer = require('multer');
const { getConfig } = require('../services/config');
const { generateDerivative } = require('../utils/imageProcessing');

const router = express.Router();

// In-memory progress store: { [folder]: { op: 'thumbnails'|'previews', total: number, processed: number, status: 'idle'|'running'|'completed'|'error', updatedAt: number } }
const progressStore = Object.create(null);

function setProgress(folder, payload) {
  progressStore[folder] = { ...(progressStore[folder] || {}), ...payload, updatedAt: Date.now() };
}

function clearProgress(folder) {
  progressStore[folder] = { op: null, total: 0, processed: 0, status: 'idle', updatedAt: Date.now() };
}

// Services
const {
  loadManifest,
  saveManifest,
  validatePhotoEntry,
  createDefaultPhotoEntry,
  getCurrentTimestamp
} = require('../services/manifest');

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
    const projectPath = path.join(PROJECTS_DIR, folder);
    if (!await fs.pathExists(projectPath)) return res.status(404).json({ error: 'Project not found' });

    const manifest = await loadManifest(projectPath);
    if (!manifest) return res.status(404).json({ error: 'Project manifest not found' });

    const cfg = getConfig();
    const thumbCfg = (cfg.processing && cfg.processing.thumbnail) || { maxDim: 200, quality: 80 };
    const prevCfg = (cfg.processing && cfg.processing.preview) || { maxDim: 6000, quality: 80 };

    // Decide pending set
    const candidates = force
      ? manifest.entries.filter(e => e.thumbnail_status !== 'not_supported' || e.preview_status !== 'not_supported')
      : manifest.entries.filter(e => (e.thumbnail_status === 'pending' || e.thumbnail_status === 'failed' || !e.thumbnail_status) || (e.preview_status === 'pending' || e.preview_status === 'failed' || !e.preview_status));

    console.log(`Per-image processing for ${candidates.length} images`);
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
          entry.thumbnail_status = entry.thumbnail_status || 'failed';
          entry.preview_status = entry.preview_status || 'failed';
          results.push({ filename: entry.filename, status: 'skipped_no_source' });
          continue;
        }

        // Thumbnail
        if (force || entry.thumbnail_status === 'pending' || entry.thumbnail_status === 'failed' || !entry.thumbnail_status) {
          try {
            const thumbPath = path.join(projectPath, '.thumb', `${entry.filename}.jpg`);
            await generateDerivative(sourceFile, thumbPath, { maxDim: Number(thumbCfg.maxDim) || 200, quality: Number(thumbCfg.quality) || 80 });
            entry.thumbnail_status = 'generated';
          } catch (te) {
            console.error(`Failed to generate thumbnail for ${entry.filename}:`, te);
            entry.thumbnail_status = 'failed';
          }
        }

        // Preview
        if (force || entry.preview_status === 'pending' || entry.preview_status === 'failed' || !entry.preview_status) {
          try {
            const previewPath = path.join(projectPath, '.preview', `${entry.filename}.jpg`);
            await generateDerivative(sourceFile, previewPath, { maxDim: Number(prevCfg.maxDim) || 6000, quality: Number(prevCfg.quality) || 80 });
            entry.preview_status = 'generated';
          } catch (pe) {
            console.error(`Failed to generate preview for ${entry.filename}:`, pe);
            entry.preview_status = 'failed';
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

    await saveManifest(projectPath, manifest);
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

    const manifest = await loadManifest(projectPath);
    if (!manifest) return res.status(404).json({ error: 'Project manifest not found' });

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

      // Update or create manifest entry
      let entry = manifest.entries.find(e => e.filename === originalName);
      if (entry) {
        // flags
        if (fileType === 'jpg') entry.jpg_available = true;
        else if (fileType === 'raw') entry.raw_available = true;
        else entry.other_available = true;

        // metadata precedence
        if (Object.keys(metadata).length > 0) {
          if (fileType === 'jpg' || !entry.metadata || Object.keys(entry.metadata).length === 0) {
            entry.metadata = { ...entry.metadata, ...metadata };
          }
        }

        // thumbnail/preview status
        if (fileType === 'jpg' || entry.thumbnail_status === 'failed') {
          entry.thumbnail_status = thumbnailStatus;
        }
        if (fileType === 'jpg' || entry.preview_status === 'failed') {
          entry.preview_status = previewStatus;
        }

        entry.updated_at = getCurrentTimestamp();
        const validation = validatePhotoEntry(entry);
        if (!validation.valid) console.error(`Updated photo entry validation failed for ${originalName}:`, validation.errors);
      } else {
        entry = createDefaultPhotoEntry(originalName, fileType, metadata);
        // Apply config keep defaults for new entries
        try {
          const cfg = getConfig();
          const kd = (cfg && cfg.keep_defaults) || { jpg: true, raw: false };
          entry.keep_jpg = !!kd.jpg;
          entry.keep_raw = !!kd.raw;
        } catch (e) {
          // Fallbacks already set by defaults; non-fatal
          console.warn('Warning: failed to read keep_defaults from config:', e.message);
        }
        entry.thumbnail_status = thumbnailStatus;
        entry.preview_status = previewStatus;
        const validation = validatePhotoEntry(entry);
        if (!validation.valid) {
          console.error(`New photo entry validation failed for ${originalName}:`, validation.errors);
          throw new Error(`Cannot create invalid photo entry: ${validation.errors.join(', ')}`);
        }
        manifest.entries.push(entry);
      }

      uploadedFiles.push({ filename: file.originalname, size: file.size, type: fileType });
    }

    await saveManifest(projectPath, manifest);
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

    const manifest = await loadManifest(projectPath);
    if (!manifest) return res.status(404).json({ error: 'Project manifest not found' });

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

      const existing = manifest.entries.find(e => e.filename === baseName);
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
