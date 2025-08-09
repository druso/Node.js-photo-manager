const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const exifParser = require('exif-parser');
const multer = require('multer');

const router = express.Router();

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

        // thumbnail status
        if (fileType === 'jpg' || entry.thumbnail_status === 'failed') {
          entry.thumbnail_status = thumbnailStatus;
        }

        entry.updated_at = getCurrentTimestamp();
        const validation = validatePhotoEntry(entry);
        if (!validation.valid) console.error(`Updated photo entry validation failed for ${originalName}:`, validation.errors);
      } else {
        entry = createDefaultPhotoEntry(originalName, fileType, metadata);
        entry.thumbnail_status = thumbnailStatus;
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
  try {
    const { folder } = req.params;
    const projectPath = path.join(PROJECTS_DIR, folder);
    if (!await fs.pathExists(projectPath)) return res.status(404).json({ error: 'Project not found' });

    const manifest = await loadManifest(projectPath);
    if (!manifest) return res.status(404).json({ error: 'Project manifest not found' });

    const pendingEntries = manifest.entries.filter(entry => entry.thumbnail_status === 'pending' || entry.thumbnail_status === 'failed' || !entry.thumbnail_status);
    console.log(`Generating thumbnails for ${pendingEntries.length} images`);

    let processedCount = 0;
    const results = [];

    for (const entry of pendingEntries) {
      try {
        // Find a supported file format for this entry
        const supportedExtensionsLower = ['.jpg', '.jpeg', '.png', '.tiff', '.webp'];
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
          entry.thumbnail_status = 'failed';
          results.push({ filename: entry.filename, status: 'failed', reason: 'No supported source file' });
          continue;
        }

        const thumbPath = path.join(projectPath, '.thumb', `${entry.filename}.jpg`);
        await fs.ensureDir(path.dirname(thumbPath));
        const sharpImage = sharp(sourceFile);
        await sharpImage.rotate().resize(200, 200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(thumbPath);

        entry.thumbnail_status = 'generated';
        processedCount++;
        results.push({ filename: entry.filename, status: 'generated' });
      } catch (err) {
        console.error(`Failed to generate thumbnail for ${entry.filename}:`, err);
        entry.thumbnail_status = 'failed';
        results.push({ filename: entry.filename, status: 'failed', reason: err.message });
      }
    }

    await saveManifest(projectPath, manifest);
    res.json({ message: `Generated ${processedCount} thumbnails`, processed: processedCount, total: pendingEntries.length, results });
  } catch (err) {
    console.error('Error generating thumbnails:', err);
    res.status(500).json({ error: 'Failed to generate thumbnails' });
  }
});

module.exports = router;
