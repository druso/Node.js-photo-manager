const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const makeLogger = require('../utils/logger2');
const log = makeLogger('uploads');
const exifParser = require('exif-parser');
const multer = require('multer');
const { buildAcceptPredicate } = require('../utils/acceptance');
const jobsRepo = require('../services/repositories/jobsRepo');
const tasksOrchestrator = require('../services/tasksOrchestrator');

// SQLite repositories (migration from manifest.json)
const projectsRepo = require('../services/repositories/projectsRepo');
const photosRepo = require('../services/repositories/photosRepo');

const router = express.Router();
// Ensure JSON bodies are parsed for this router (for subset processing requests)
router.use(express.json());

// Resolve project directories relative to project root
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PROJECTS_DIR = path.join(PROJECT_ROOT, '.projects');
fs.ensureDirSync(PROJECTS_DIR);

// Multer setup using configurable accept list (single-source in server/utils/acceptance.js)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const accept = buildAcceptPredicate();
    const ok = accept(file.originalname, file.mimetype);
    if (ok) return cb(null, true);
    return cb(new Error('Only accepted image files are allowed'));
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

// POST /api/projects/:folder/process (per-image: thumbnail then preview)
router.post('/:folder/process', async (req, res) => {
  try {
    const { folder } = req.params;
    const force = String(req.query.force || '').toLowerCase() === 'true';
    const projectPath = path.join(PROJECTS_DIR, folder);
    if (!await fs.pathExists(projectPath)) return res.status(404).json({ error: 'Project not found' });
    const project = projectsRepo.getByFolder(folder);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const payload = { force, filenames: Array.isArray(req.body?.filenames) ? req.body.filenames : undefined };
    const tenant_id = 'user_0';
    const job = jobsRepo.enqueue({ tenant_id, project_id: project.id, type: 'generate_derivatives', payload, progress_total: null });
    return res.status(202).json({ job });
  } catch (err) {
    log.error('enqueue_generate_derivatives_failed', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name, error: err && err.message, stack: err && err.stack });
    return res.status(500).json({ error: 'Failed to enqueue derivatives job' });
  }
});

// POST /api/projects/:folder/upload
router.post('/:folder/upload', async (req, res) => {
  // Invoke multer programmatically to catch validation errors and respond 400
  upload.array('photos')(req, res, async (err) => {
    if (err) {
      const msg = err.message || 'Only accepted image files are allowed';
      return res.status(400).json({ error: msg });
    }
    try {
      const { folder } = req.params;
      const projectPath = path.join(PROJECTS_DIR, folder);
      if (!await fs.pathExists(projectPath)) return res.status(404).json({ error: 'Project not found' });
      const project = projectsRepo.getByFolder(folder);
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const uploadedFiles = [];
      const basenames = [];
      const perFileErrors = [];
      const accept = buildAcceptPredicate();

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      for (const file of req.files) {
        try {
          // Sanitize filename to prevent path traversal
          const sanitizedName = path.basename(file.originalname);
          if (!sanitizedName || sanitizedName === '.' || sanitizedName === '..') {
            perFileErrors.push({ filename: file.originalname, error: 'Invalid filename' });
            continue;
          }

          // Defensive check: ensure file passes acceptance rules
          if (!accept(sanitizedName, file.mimetype)) {
            perFileErrors.push({ filename: sanitizedName, error: 'File type not accepted' });
            continue;
          }

          if (!file.buffer || file.buffer.length === 0) {
            perFileErrors.push({ filename: sanitizedName, error: 'Empty file' });
            continue;
          }
          const originalName = path.parse(sanitizedName).name;
          const ext = path.extname(sanitizedName).toLowerCase();
          const fileType = getFileType(sanitizedName);

          // Save original file
          const filePath = path.join(projectPath, sanitizedName);
          await fs.writeFile(filePath, file.buffer);

          // Defer thumbnail generation
          const isRawFile = /\.(arw|cr2|nef|dng|raw)$/i.test(ext);
          log.debug('defer_thumbnail_generation', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name, filename: sanitizedName, is_raw: isRawFile });

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
              log.warn('exif_parse_failed', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name, filename: sanitizedName, error: err && err.message });
              perFileErrors.push({ filename: sanitizedName, error: 'EXIF parsing failed' });
            }
          }

          // Thumbnail status
          const thumbnailStatus = isRawFile ? 'not_supported' : 'pending';
          const previewStatus = isRawFile ? 'not_supported' : 'pending';

          // Upsert into SQLite repository
          const existing = photosRepo.getByProjectAndFilename(project.id, originalName);

          // Compute merged availability after this upload
          const jpgAvailable = existing ? (existing.jpg_available || fileType === 'jpg') : (fileType === 'jpg');
          const rawAvailable = existing ? (existing.raw_available || fileType === 'raw') : (fileType === 'raw');
          const otherAvailable = existing ? (existing.other_available || fileType === 'other') : (fileType === 'other');

          const photoPayload = {
            manifest_id: existing?.manifest_id || undefined,
            filename: originalName,
            basename: originalName,
            ext: ext ? ext.replace(/^\./, '') : null,
            date_time_original: metadata.date_time_original || existing?.date_time_original || null,
            jpg_available: jpgAvailable,
            raw_available: rawAvailable,
            other_available: otherAvailable,
            // keep flags ALWAYS align to availability on upload
            keep_jpg: !!jpgAvailable,
            keep_raw: !!rawAvailable,
            thumbnail_status: (fileType === 'jpg' || (existing && existing.thumbnail_status === 'failed')) ? thumbnailStatus : (existing?.thumbnail_status || null),
            preview_status: (fileType === 'jpg' || (existing && existing.preview_status === 'failed')) ? previewStatus : (existing?.preview_status || null),
            orientation: metadata.orientation ?? existing?.orientation ?? null,
            meta_json: Object.keys(metadata).length ? JSON.stringify(metadata) : (existing?.meta_json || null),
          };
          photosRepo.upsertPhoto(project.id, photoPayload);

          uploadedFiles.push({ filename: sanitizedName, size: file.size, type: fileType });
          basenames.push(originalName);
        } catch (fileErr) {
          log.error('file_process_error', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name, filename: file.originalname, error: fileErr && fileErr.message, stack: fileErr && fileErr.stack });
          perFileErrors.push({ filename: file.originalname, error: fileErr.message || 'Processing failed' });
        }
      }

      // Check if any files were successfully uploaded
      if (uploadedFiles.length === 0) {
        const errorMsg = perFileErrors.length > 0 
          ? `No valid files uploaded. Errors: ${perFileErrors.map(e => `${e.filename}: ${e.error}`).join('; ')}`
          : 'No valid files uploaded';
        return res.status(400).json({ error: errorMsg, perFileErrors });
      }

      // Start orchestrated post-process task with filenames
      try {
        tasksOrchestrator.startTask({ project_id: project.id, type: 'upload_postprocess', source: 'upload', items: basenames });
      } catch (e) {
        log.warn('start_upload_postprocess_failed', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name, error: e && e.message });
      }

      const response = { 
        message: `Successfully uploaded ${uploadedFiles.length} files`, 
        files: uploadedFiles 
      };
      if (perFileErrors.length > 0) {
        response.warnings = perFileErrors;
      }
      res.status(201).json(response);
    } catch (err) {
      log.error('upload_failed', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name, error: err && err.message, stack: err && err.stack });
      res.status(500).json({ error: 'Failed to upload files' });
    }
  });
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
    const accept = buildAcceptPredicate();
    const accepted = [];
    const rejected = [];

    for (const file of files) {
      const baseName = path.parse(file.name).name;
      const ext = path.extname(file.name).toLowerCase();
      // Drop non-accepted files from analysis
      if (!accept(file.name, file.type)) {
        rejected.push({ name: file.name, reason: 'not accepted by uploader rules' });
        continue;
      }
      accepted.push(file);
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
      totalFiles: accepted.length,
      newImages: Object.values(imageGroups).filter(g => g.isNew).length,
      conflictImages: Object.values(imageGroups).filter(g => g.hasConflict).length,
      completionImages: Object.values(imageGroups).filter(g => g.conflictType === 'completion').length,
      duplicateImages: Object.values(imageGroups).filter(g => g.conflictType === 'duplicate').length,
      rejectedFiles: rejected.length
    };

    log.info('analyze_files_summary', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name, total_images: summary.totalImages, new_images: summary.newImages, completion_images: summary.completionImages, duplicate_images: summary.duplicateImages, rejected_files: summary.rejectedFiles });

    res.json({ success: true, imageGroups, summary, rejected });
  } catch (err) {
    log.error('analyze_files_failed', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name, error: err && err.message, stack: err && err.stack });
    res.status(500).json({ error: 'Failed to analyze files' });
  }
});

module.exports = router;
