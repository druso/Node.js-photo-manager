const express = require('express');
const { Server } = require('tus-node-server');
const { FileStore } = require('tus-node-server');
const path = require('path');
const fs = require('fs-extra');
const exifParser = require('exif-parser');
const makeLogger = require('../utils/logger2');
const log = makeLogger('tus-uploads');

const projectsRepo = require('../services/repositories/projectsRepo');
const photosRepo = require('../services/repositories/photosRepo');
const tasksOrchestrator = require('../services/tasksOrchestrator');
const { getProjectPath } = require('../services/fsUtils');
const { buildAcceptPredicate } = require('../utils/acceptance');

const router = express.Router();

// Temporary upload directory for tus chunks
// Use same parent as .projects to ensure write permissions in Docker
const UPLOADS_TEMP_DIR = path.join(__dirname, '../../.projects/.uploads-temp');

// Ensure directory exists when first upload is attempted, not at module load
function ensureTempDir() {
    try {
        if (!fs.existsSync(UPLOADS_TEMP_DIR)) {
            fs.mkdirSync(UPLOADS_TEMP_DIR, { recursive: true });
            log.info('tus_temp_dir_created', { dir: UPLOADS_TEMP_DIR });
        }
    } catch (err) {
        log.error('tus_temp_dir_creation_failed', {
            dir: UPLOADS_TEMP_DIR,
            error: err?.message
        });
        throw err;
    }
}

// Helper function to get file type
function getFileType(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (['.jpg', '.jpeg'].includes(ext)) return 'jpg';
    if (['.raw', '.cr2', '.nef', '.arw', '.dng'].includes(ext)) return 'raw';
    return 'other';
}

// Helper function to extract EXIF metadata
async function extractExifMetadata(filePath) {
    try {
        const buffer = await fs.readFile(filePath);
        const parser = exifParser.create(buffer);
        const result = parser.parse();

        if (result && result.tags) {
            const captureTimestamp = result.tags.DateTimeOriginal || result.tags.CreateDate || result.tags.ModifyDate || null;

            const metadata = {
                date_time_original: captureTimestamp ? new Date(captureTimestamp * 1000).toISOString() : null,
                create_date: result.tags.CreateDate || null,
                modify_date: result.tags.ModifyDate || null,
                camera_model: result.tags.Model || null,
                camera_make: result.tags.Make || null,
                make: result.tags.Make || null,
                model: result.tags.Model || null,
                exif_image_width: result.tags.ExifImageWidth || null,
                exif_image_height: result.tags.ExifImageHeight || null,
                orientation: result.tags.Orientation || null
            };

            // Remove null values
            Object.keys(metadata).forEach(k => metadata[k] === null && delete metadata[k]);
            return metadata;
        }
    } catch (err) {
        log.warn('exif_extraction_failed', { file: path.basename(filePath), error: err?.message });
    }
    return {};
}

// Batch processing for upload post-processing tasks
// This prevents creating a separate job for every single file, while still
// allowing processing to start during the upload (not waiting for all files).
const BATCH_SIZE = 10;
const BATCH_TIMEOUT = 5000; // 5 seconds
const batchBuffer = {}; // { [projectId]: { items: [], timer: null } }

function flushBatch(projectId) {
    const buffer = batchBuffer[projectId];
    if (!buffer || buffer.items.length === 0) return;

    // Clear timer if it exists
    if (buffer.timer) {
        clearTimeout(buffer.timer);
        buffer.timer = null;
    }

    const itemsToProcess = [...buffer.items];
    buffer.items = []; // Reset buffer immediately

    try {
        tasksOrchestrator.startTask({
            project_id: projectId,
            type: 'upload_postprocess',
            source: 'tus_upload',
            items: itemsToProcess
        });
        log.info('tus_postprocess_batch_queued', {
            project_id: projectId,
            count: itemsToProcess.length,
            items: itemsToProcess.slice(0, 3) // Log first few
        });
    } catch (err) {
        log.error('tus_postprocess_batch_failed', {
            project_id: projectId,
            count: itemsToProcess.length,
            error: err?.message
        });
    }
}

function addToBatch(projectId, filename) {
    if (!batchBuffer[projectId]) {
        batchBuffer[projectId] = { items: [], timer: null };
    }

    const buffer = batchBuffer[projectId];
    buffer.items.push(filename);

    // If buffer full, flush immediately
    if (buffer.items.length >= BATCH_SIZE) {
        flushBatch(projectId);
    }
    // If timer not running, start it
    else if (!buffer.timer) {
        buffer.timer = setTimeout(() => {
            flushBatch(projectId);
        }, BATCH_TIMEOUT);
    }
}

// Configure tus server
const tusServer = new Server({
    path: '/files',
    datastore: new FileStore({
        directory: UPLOADS_TEMP_DIR
    }),
    // Cloudflare-friendly settings
    maxSize: 100 * 1024 * 1024, // 100MB max file size
    respectForwardedHeaders: true,

    // Metadata validation
    namingFunction: (req) => {
        // Generate unique filename for the tus upload
        const metadata = req.upload?.metadata || {};
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        return `upload-${timestamp}-${random}`;
    },

    // Called when upload is complete
    onUploadFinish: async (req, res, upload) => {
        const metadata = upload.metadata || {};
        const filename = metadata.filename;
        const projectFolder = metadata.projectFolder;

        log.info('tus_upload_finished', {
            filename,
            projectFolder,
            size: upload.size,
            uploadId: upload.id
        });

        try {
            // Validate project exists
            if (!projectFolder) {
                throw new Error('Missing projectFolder in upload metadata');
            }

            const project = projectsRepo.getByFolder(projectFolder);
            if (!project) {
                throw new Error(`Project not found: ${projectFolder}`);
            }

            const projectPath = getProjectPath(projectFolder);
            if (!await fs.pathExists(projectPath)) {
                throw new Error(`Project path does not exist: ${projectPath}`);
            }

            // Validate filename
            if (!filename) {
                throw new Error('Missing filename in upload metadata');
            }

            const sanitizedName = path.basename(filename);
            if (!sanitizedName || sanitizedName === '.' || sanitizedName === '..') {
                throw new Error('Invalid filename');
            }

            // Validate file type
            const accept = buildAcceptPredicate();
            const filetype = metadata.filetype || '';
            if (!accept(sanitizedName, filetype)) {
                throw new Error('File type not accepted');
            }

            // Get file info
            const originalName = path.parse(sanitizedName).name;
            const ext = path.extname(sanitizedName).toLowerCase();
            const fileType = getFileType(sanitizedName);
            const isRawFile = /\.(arw|cr2|nef|dng|raw)$/i.test(ext);

            // Check for cross-project conflicts
            const crossProjectPhoto = photosRepo.getGlobalByFilename(originalName, { exclude_project_id: project.id });
            if (crossProjectPhoto) {
                throw new Error(`File exists in another project: ${originalName}`);
            }

            // Move file from temp location to project directory
            const tempFilePath = upload.storage.path;
            const finalFilePath = path.join(projectPath, sanitizedName);

            await fs.move(tempFilePath, finalFilePath, { overwrite: true });
            log.info('tus_file_moved', { from: tempFilePath, to: finalFilePath });

            // Extract EXIF metadata (only for non-RAW files)
            let exifMetadata = {};
            if (!isRawFile) {
                exifMetadata = await extractExifMetadata(finalFilePath);
            }

            // Determine derivative status
            const thumbnailStatus = isRawFile ? 'not_supported' : 'pending';
            const previewStatus = isRawFile ? 'not_supported' : 'pending';

            // Check if photo already exists in this project
            const existing = photosRepo.getByProjectAndFilename(project.id, originalName);

            // Compute merged availability
            const jpgAvailable = existing ? (existing.jpg_available || fileType === 'jpg') : (fileType === 'jpg');
            const rawAvailable = existing ? (existing.raw_available || fileType === 'raw') : (fileType === 'raw');
            const otherAvailable = existing ? (existing.other_available || fileType === 'other') : (fileType === 'other');

            // Upsert photo record
            const photoPayload = {
                manifest_id: existing?.manifest_id || undefined,
                filename: originalName,
                basename: originalName,
                ext: ext ? ext.replace(/^\./, '') : null,
                date_time_original: exifMetadata.date_time_original || existing?.date_time_original || null,
                jpg_available: jpgAvailable,
                raw_available: rawAvailable,
                other_available: otherAvailable,
                keep_jpg: !!jpgAvailable,
                keep_raw: !!rawAvailable,
                thumbnail_status: (fileType === 'jpg' || (existing && existing.thumbnail_status === 'failed')) ? thumbnailStatus : (existing?.thumbnail_status || null),
                preview_status: (fileType === 'jpg' || (existing && existing.preview_status === 'failed')) ? previewStatus : (existing?.preview_status || null),
                orientation: exifMetadata.orientation ?? existing?.orientation ?? null,
                meta_json: Object.keys(exifMetadata).length ? JSON.stringify(exifMetadata) : (existing?.meta_json || null),
            };

            photosRepo.upsertPhoto(project.id, photoPayload);
            log.info('tus_photo_upserted', { project_id: project.id, filename: originalName });

            // Queue post-processing (batched)
            try {
                addToBatch(project.id, originalName);
            } catch (err) {
                log.warn('tus_postprocess_queue_failed', {
                    project_id: project.id,
                    filename: originalName,
                    error: err?.message
                });
            }

            // Clean up tus metadata file if it exists
            try {
                const metadataPath = `${tempFilePath}.json`;
                if (await fs.pathExists(metadataPath)) {
                    await fs.remove(metadataPath);
                }
            } catch (err) {
                log.warn('tus_metadata_cleanup_failed', { error: err?.message });
            }

        } catch (err) {
            log.error('tus_upload_finish_failed', {
                filename,
                projectFolder,
                error: err?.message,
                stack: err?.stack
            });

            // Clean up temp file on error
            try {
                if (upload.storage?.path && await fs.pathExists(upload.storage.path)) {
                    await fs.remove(upload.storage.path);
                }
            } catch (cleanupErr) {
                log.warn('tus_temp_cleanup_failed', { error: cleanupErr?.message });
            }

            throw err;
        }
    },

    // Called on upload creation
    onUploadCreate: (req, res, upload) => {
        const metadata = upload.metadata || {};
        log.info('tus_upload_created', {
            filename: metadata.filename,
            projectFolder: metadata.projectFolder,
            size: upload.size,
            uploadId: upload.id
        });
    },

    // Called on each chunk received
    onIncomingRequest: (req, res, next) => {
        // Log chunk progress (optional, can be verbose)
        if (req.method === 'PATCH') {
            const uploadLength = req.headers['upload-length'];
            const uploadOffset = req.headers['upload-offset'];
            if (uploadLength && uploadOffset) {
                const percent = ((parseInt(uploadOffset) / parseInt(uploadLength)) * 100).toFixed(1);
                log.debug('tus_chunk_received', {
                    uploadId: req.url.split('/').pop(),
                    offset: uploadOffset,
                    length: uploadLength,
                    percent: `${percent}%`
                });
            }
        }
        next();
    }
});

// Mount tus server on all HTTP methods
// tus server handles its own internal routing, so we just need to pass all requests
router.use((req, res) => {
    // Ensure temp directory exists on first request
    ensureTempDir();
    tusServer.handle(req, res);
});

module.exports = router;
