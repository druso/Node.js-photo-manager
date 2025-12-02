const path = require('path');
const fs = require('fs-extra');
const { getConfig } = require('../config');
const { getProjectPath } = require('../fsUtils');
const projectsRepo = require('../repositories/projectsRepo');
const photosRepo = require('../repositories/photosRepo');
const jobsRepo = require('../repositories/jobsRepo');
const { emitJobUpdate } = require('../events');
const { getPool } = require('../imageProcessingPool');
const derivativeCache = require('../derivativeCache');
const makeLogger = require('../../utils/logger2');
const log = makeLogger('deriv-worker');

function supportedSourcePath(projectPath, entry) {
  const exts = ['.jpg', '.jpeg', '.png', '.tiff', '.webp'];
  for (const ext of exts) {
    for (const variant of [ext, ext.toUpperCase()]) {
      const p = path.join(projectPath, `${entry.filename}${variant}`);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

async function runGenerateDerivatives({ job, onProgress }) {
  // job.payload_json may contain { force?: boolean, filenames?: string[] }
  const payload = job.payload_json || {};

  // Handle photo_set scope: group photos by project and process each project
  if (job.scope === 'photo_set') {
    const items = jobsRepo.listItems(job.id);
    if (!items || items.length === 0) {
      log.warn('no_items_for_photo_set_job', { jobId: job.id });
      return;
    }

    // Group items by project_id
    const photosByProject = {};
    for (const item of items) {
      if (!item.photo_id) continue;
      const photo = photosRepo.getById(item.photo_id);
      if (!photo) continue;

      if (!photosByProject[photo.project_id]) {
        photosByProject[photo.project_id] = [];
      }
      photosByProject[photo.project_id].push({ item, photo });
    }

    // Process each project
    let totalDone = 0;
    const totalItems = items.length;

    for (const [projectId, projectPhotos] of Object.entries(photosByProject)) {
      const project = projectsRepo.getById(Number(projectId));
      if (!project || project.status === 'canceled') {
        log.warn('project_not_found_or_canceled', { projectId });
        // Mark items as skipped
        for (const { item } of projectPhotos) {
          jobsRepo.updateItemStatus(item.id, { status: 'skipped', message: 'project not found or canceled' });
          totalDone++;
        }
        continue;
      }

      // Process this project's photos
      const projectDone = await processProjectPhotos({
        job,
        project,
        projectPhotos: projectPhotos.map(p => p.photo),
        items: projectPhotos.map(p => p.item),
        payload,
        onProgress: (progress) => {
          totalDone = progress.done;
          const updated = jobsRepo.updateProgress(job.id, { done: totalDone });
          emitJobUpdate({
            id: job.id,
            status: updated.status,
            progress_done: updated.progress_done,
            progress_total: updated.progress_total
          });
          onProgress && onProgress({ done: totalDone, total: totalItems });
        }
      });
    }

    return;
  }

  // Original project-scoped logic
  const project = projectsRepo.getById(job.project_id);
  if (!project) throw new Error('Project not found for job');
  if (project.status === 'canceled') {
    // Project has been archived/canceled – do not process derivatives
    return;
  }
  const projectPath = getProjectPath(project);

  const cfg = getConfig();
  const thumbCfg = (cfg.processing && cfg.processing.thumbnail) || { maxDim: 200, quality: 80 };
  const prevCfg = (cfg.processing && cfg.processing.preview) || { maxDim: 6000, quality: 80 };

  // Determine candidates
  const all = photosRepo.listPaged({ project_id: project.id, limit: 100000, sort: 'filename', dir: 'ASC' }).items;
  const requested = Array.isArray(payload.filenames) && payload.filenames.length ? new Set(payload.filenames.map(s => String(s).toLowerCase())) : null;
  const effectiveForce = !!payload.force || !!requested;
  let baseCandidates = effectiveForce
    ? all.filter(e => e.thumbnail_status !== 'not_supported' || e.preview_status !== 'not_supported')
    : all.filter(e => (e.thumbnail_status === 'pending' || e.thumbnail_status === 'failed' || !e.thumbnail_status) || (e.preview_status === 'pending' || e.preview_status === 'failed' || !e.preview_status));
  const candidates = requested ? all.filter(e => requested.has(String(e.filename).toLowerCase())) : baseCandidates;

  // If no items pre-created, create job_items from candidates
  let items = jobsRepo.listItems(job.id);
  if (!items || items.length === 0) {
    const add = candidates.map(c => ({ filename: c.filename, photo_id: c.id }));
    const db = require('../db').getDb();
    const now = new Date().toISOString();
    const stmt = db.prepare(`INSERT INTO job_items (tenant_id, job_id, photo_id, filename, status, message, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?)`);
    for (const it of add) stmt.run(job.tenant_id, job.id, it.photo_id ?? null, it.filename ?? null, now, now);
    items = jobsRepo.listItems(job.id);
    jobsRepo.updateProgress(job.id, { total: items.length });
  }

  let done = items.filter(i => i.status === 'done').length;
  jobsRepo.updateProgress(job.id, { done });
  emitJobUpdate({ id: job.id, status: 'running', progress_done: done, progress_total: items.length });

  // Helper: compute availability by probing filesystem for known extensions
  const jpgExts = ['jpg', 'jpeg'];
  const rawExts = ['raw', 'cr2', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2'];

  const existsAny = (base, exts) => {
    for (const e of exts) {
      const p1 = path.join(projectPath, `${base}.${e}`);
      const p2 = path.join(projectPath, `${base}.${e.toUpperCase()}`);
      if (fs.existsSync(p1) || fs.existsSync(p2)) return true;
    }
    return false;
  };

  // Get worker pool (configurable via config.processing.workerCount)
  const workerCount = (cfg.processing && cfg.processing.workerCount) || 4;
  const pool = getPool(workerCount);

  // Process items in batches for parallel processing
  const batchSize = workerCount * 2; // Queue 2x workers to keep them busy
  const pendingItems = items.filter(i => i.status === 'pending');

  log.info('batch_processing_start', {
    total: items.length,
    pending: pendingItems.length,
    workerCount,
    batchSize
  });

  for (let i = 0; i < pendingItems.length; i += batchSize) {
    // Stop if job was canceled mid-run
    const fresh = jobsRepo.getById(job.id);
    if (fresh && fresh.status === 'canceled') {
      log.info('job_canceled', { jobId: job.id });
      break;
    }
    // Also stop if project just got canceled
    const p2 = projectsRepo.getById(job.project_id);
    if (!p2 || p2.status === 'canceled') {
      log.info('project_canceled', { projectId: job.project_id });
      break;
    }

    const batch = pendingItems.slice(i, i + batchSize);
    log.debug('processing_batch', { batchStart: i, batchSize: batch.length });

    // Process batch in parallel
    const batchPromises = batch.map(item => processItem({
      item,
      all,
      project,
      projectPath,
      effectiveForce,
      thumbCfg,
      prevCfg,
      jpgExts,
      rawExts,
      existsAny,
      pool
    }));

    const batchResults = await Promise.allSettled(batchPromises);

    // Update progress for completed batch
    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      if (result.status === 'rejected') {
        log.error('batch_item_error', {
          itemId: batch[j].id,
          error: result.reason?.message || String(result.reason)
        });
      }
      done += 1;
    }

    const updated = jobsRepo.updateProgress(job.id, { done });
    emitJobUpdate({
      id: job.id,
      status: updated.status,
      progress_done: updated.progress_done,
      progress_total: updated.progress_total
    });
    onProgress && onProgress({ done, total: items.length });
  }

  log.info('batch_processing_complete', { total: items.length, done });
}

/**
 * Process photos for a specific project (used by photo_set scope)
 */
async function processProjectPhotos({ job, project, projectPhotos, items, payload, onProgress }) {
  const projectPath = getProjectPath(project);
  const cfg = getConfig();
  const thumbCfg = (cfg.processing && cfg.processing.thumbnail) || { maxDim: 200, quality: 80 };
  const prevCfg = (cfg.processing && cfg.processing.preview) || { maxDim: 6000, quality: 80 };

  const effectiveForce = !!payload.force;
  const jpgExts = ['jpg', 'jpeg'];
  const rawExts = ['raw', 'cr2', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2'];

  const existsAny = (base, exts) => {
    for (const e of exts) {
      const p1 = path.join(projectPath, `${base}.${e}`);
      const p2 = path.join(projectPath, `${base}.${e.toUpperCase()}`);
      if (fs.existsSync(p1) || fs.existsSync(p2)) return true;
    }
    return false;
  };

  const workerCount = (cfg.processing && cfg.processing.workerCount) || 4;
  const pool = getPool(workerCount);
  const batchSize = workerCount * 2;

  let done = 0;
  const pendingItems = items.filter(i => i.status === 'pending');

  log.info('processing_project_photos', {
    projectId: project.id,
    projectFolder: project.project_folder,
    total: items.length,
    pending: pendingItems.length
  });

  for (let i = 0; i < pendingItems.length; i += batchSize) {
    // Stop if job was canceled
    const fresh = jobsRepo.getById(job.id);
    if (fresh && fresh.status === 'canceled') {
      log.info('job_canceled', { jobId: job.id });
      break;
    }

    const batch = pendingItems.slice(i, i + batchSize);
    const batchPromises = batch.map(item => processItem({
      item,
      all: projectPhotos,
      project,
      projectPath,
      effectiveForce,
      thumbCfg,
      prevCfg,
      jpgExts,
      rawExts,
      existsAny,
      pool
    }));

    const batchResults = await Promise.allSettled(batchPromises);

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      if (result.status === 'rejected') {
        log.error('batch_item_error', {
          itemId: batch[j].id,
          error: result.reason?.message || String(result.reason)
        });
      }
      done += 1;
    }

    onProgress && onProgress({ done, total: items.length });
  }

  return done;
}

/**
 * Process a single item (photo) with parallel worker pool.
 * This function is called for each item in a batch.
 */
async function processItem({
  item,
  all,
  project,
  projectPath,
  effectiveForce,
  thumbCfg,
  prevCfg,
  jpgExts,
  rawExts,
  existsAny,
  pool
}) {
  jobsRepo.updateItemStatus(item.id, { status: 'running' });

  try {
    const entry = all.find(p => p.id === item.photo_id || p.filename === item.filename);
    if (!entry) {
      jobsRepo.updateItemStatus(item.id, { status: 'skipped', message: 'photo not found' });
      emitJobUpdate({
        type: 'item',
        project_folder: project.project_folder,
        filename: item.filename,
        thumbnail_status: 'failed',
        preview_status: 'failed',
        updated_at: new Date().toISOString(),
      });
      return;
    }

    // Recompute availability and align keep flags before derivative generation
    try {
      const jpgExists = existsAny(entry.filename, jpgExts);
      const rawExists = existsAny(entry.filename, rawExts);
      const otherExists = !jpgExists && !rawExists ? false : (entry.other_available ? true : false);
      photosRepo.upsertPhoto(project.id, {
        manifest_id: entry.manifest_id,
        filename: entry.filename,
        basename: entry.basename || entry.filename,
        ext: entry.ext,
        date_time_original: entry.date_time_original,
        jpg_available: jpgExists,
        raw_available: rawExists,
        other_available: otherExists,
        keep_jpg: !!jpgExists,
        keep_raw: !!rawExists,
        thumbnail_status: entry.thumbnail_status,
        preview_status: entry.preview_status,
        orientation: entry.orientation,
        meta_json: entry.meta_json,
      });
    } catch (err) {
      log.warn('availability_update_failed', { photoId: entry.id, error: err.message });
    }

    const sourceFile = supportedSourcePath(projectPath, entry);
    if (!sourceFile) {
      photosRepo.updateDerivativeStatus(entry.id, {
        thumbnail_status: entry.thumbnail_status || 'failed',
        preview_status: entry.preview_status || 'failed',
      });
      jobsRepo.updateItemStatus(item.id, { status: 'skipped', message: 'no supported source' });
      emitJobUpdate({
        type: 'item',
        project_folder: project.project_folder,
        filename: entry.filename,
        thumbnail_status: entry.thumbnail_status || 'failed',
        preview_status: entry.preview_status || 'failed',
        updated_at: new Date().toISOString(),
      });
      return;
    }

    // If user explicitly requested regeneration (force), invalidate cache first
    // User-initiated regeneration means they may not be satisfied with cached derivatives
    if (effectiveForce) {
      derivativeCache.invalidate(entry.id);
      log.debug('cache_invalidated_force', { photoId: entry.id, filename: entry.filename });
    }

    // Calculate source file hash for caching
    let sourceHash;
    let sourceSize;
    try {
      const stats = fs.statSync(sourceFile);
      sourceSize = stats.size;
      sourceHash = await derivativeCache.calculateHash(sourceFile);
    } catch (err) {
      log.error('hash_calculation_failed', { photoId: entry.id, error: err.message });
      sourceHash = null;
    }

    // Check cache unless force is enabled
    const needsRegen = effectiveForce || !sourceHash ||
      derivativeCache.needsRegeneration(entry.id, sourceHash, sourceSize);

    if (!needsRegen) {
      // Cache hit - skip processing but update database status
      log.debug('cache_hit_skip', { photoId: entry.id, filename: entry.filename });

      // Update database to mark derivatives as generated (fixes bug where status stays 'pending')
      photosRepo.updateDerivativeStatus(entry.id, {
        thumbnail_status: 'generated',
        preview_status: 'generated',
      });

      jobsRepo.updateItemStatus(item.id, { status: 'done', message: 'cached' });
      emitJobUpdate({
        type: 'item',
        project_folder: project.project_folder,
        filename: entry.filename,
        thumbnail_status: 'generated',
        preview_status: 'generated',
        updated_at: new Date().toISOString(),
      });
      return;
    }

    // Build derivatives list
    const derivatives = [];

    if (effectiveForce || entry.thumbnail_status === 'pending' || entry.thumbnail_status === 'failed' || entry.thumbnail_status === 'missing' || !entry.thumbnail_status) {
      derivatives.push({
        type: 'thumbnail',
        width: Number(thumbCfg.maxDim) || 200,
        height: Number(thumbCfg.maxDim) || 200,
        quality: Number(thumbCfg.quality) || 80,
        outputPath: path.join(projectPath, '.thumb', `${entry.filename}.jpg`)
      });
    }

    if (effectiveForce || entry.preview_status === 'pending' || entry.preview_status === 'failed' || entry.preview_status === 'missing' || !entry.preview_status) {
      derivatives.push({
        type: 'preview',
        width: Number(prevCfg.maxDim) || 6000,
        height: Number(prevCfg.maxDim) || 6000,
        quality: Number(prevCfg.quality) || 80,
        outputPath: path.join(projectPath, '.preview', `${entry.filename}.jpg`)
      });
    }

    if (derivatives.length === 0) {
      // Nothing to process
      jobsRepo.updateItemStatus(item.id, { status: 'done', message: 'already generated' });
      return;
    }

    // Process with worker pool
    const task = { sourcePath: sourceFile, derivatives };
    const results = await pool.processImage(task);

    // Update database with results
    let thumbStatus = entry.thumbnail_status;
    let prevStatus = entry.preview_status;

    for (const result of results) {
      if (result.error) {
        log.error('derivative_generation_failed', {
          photoId: entry.id,
          type: result.type,
          error: result.error
        });
        if (result.type === 'thumbnail') thumbStatus = 'failed';
        if (result.type === 'preview') prevStatus = 'failed';
      } else {
        if (result.type === 'thumbnail') thumbStatus = 'generated';
        if (result.type === 'preview') prevStatus = 'generated';
      }
    }

    photosRepo.updateDerivativeStatus(entry.id, {
      thumbnail_status: thumbStatus,
      preview_status: prevStatus,
    });

    // Update cache with successful generation
    if (sourceHash && (thumbStatus === 'generated' || prevStatus === 'generated')) {
      const metadata = {
        thumbnail: results.find(r => r.type === 'thumbnail' && !r.error),
        preview: results.find(r => r.type === 'preview' && !r.error)
      };
      derivativeCache.updateCache(entry.id, sourceHash, sourceSize, metadata);
    }

    jobsRepo.updateItemStatus(item.id, { status: 'done' });

    // Emit item-level update for UI
    emitJobUpdate({
      type: 'item',
      project_folder: project.project_folder,
      filename: entry.filename,
      thumbnail_status: thumbStatus,
      preview_status: prevStatus,
      updated_at: new Date().toISOString(),
    });

  } catch (err) {
    log.error('item_processing_failed', {
      itemId: item.id,
      photoId: item.photo_id,
      error: err.message,
      stack: err.stack
    });
    jobsRepo.updateItemStatus(item.id, {
      status: 'failed',
      message: String(err.message || err)
    });
    throw err;
  }
}

module.exports = { runGenerateDerivatives };
