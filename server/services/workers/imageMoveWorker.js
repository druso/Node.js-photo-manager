const path = require('path');
const fs = require('fs-extra');
const projectsRepo = require('../repositories/projectsRepo');
const photosRepo = require('../repositories/photosRepo');
const jobsRepo = require('../repositories/jobsRepo');
const { getProjectPath } = require('../fsUtils');
const { emitJobUpdate } = require('../events');
const makeLogger = require('../../utils/logger2');
const log = makeLogger('imageMoveWorker');

async function moveIfExists(fpFrom, fpToDir) {
  if (!fpFrom) return false;
  if (await fs.pathExists(fpFrom)) {
    await fs.ensureDir(fpToDir);
    const fpTo = path.join(fpToDir, path.basename(fpFrom));
    await fs.move(fpFrom, fpTo, { overwrite: true });
    return true;
  }
  return false;
}

async function runImageMoveFiles(job) {
  // job has job_items with filenames to move into job.project_id (destination)
  const payload = job.payload_json || {};
  const destProject = projectsRepo.getById(job.project_id);
  if (!destProject) throw new Error('Destination project not found');
  const destPath = getProjectPath(destProject);
  log.info('move_job_started', { job_id: job.id, project_id: job.project_id, dest_folder: destProject.project_folder, items_total: (jobsRepo.listItems(job.id) || []).length });

  // Load or create items
  let items = jobsRepo.listItems(job.id);
  if (!items || items.length === 0) {
    // Nothing to do
    return;
  }

  // Track whether any derivative work is needed for the destination
  let needGenerateDerivatives = false;

  for (const item of items) {
    if (item.status !== 'pending') continue;
    jobsRepo.updateItemStatus(item.id, { status: 'running' });
    const filename = item.filename;
    try {
      log.debug('move_item_started', { job_id: job.id, filename });
      // Find global photo by filename outside destination
      const srcEntry = photosRepo.getGlobalByFilename(filename, { exclude_project_id: destProject.id });
      if (!srcEntry) {
        // Already in destination or missing; ensure DB consistency and mark done
        jobsRepo.updateItemStatus(item.id, { status: 'done', message: 'no source found; assumed already moved' });
        emitJobUpdate({ type: 'item', project_folder: destProject.project_folder, filename, updated_at: new Date().toISOString() });
        log.warn('move_item_no_source', { job_id: job.id, filename, dest_folder: destProject.project_folder });
        continue;
      }
      const srcProject = projectsRepo.getById(srcEntry.project_id);
      if (!srcProject) throw new Error('Source project not found');
      const srcPath = getProjectPath(srcProject);

      // Move originals (case-insensitive: try known exts)
      const tryExts = [];
      if (srcEntry.jpg_available) tryExts.push(...JPG_EXTS);
      if (srcEntry.raw_available) tryExts.push(...RAW_EXTS);
      if (srcEntry.other_available) {
        // best-effort: move any matching basename.* that isn't a derivative
        tryExts.push('.png', '.tif', '.tiff', '.webp');
      }
      let movedAny = false;
      for (const ext of tryExts) {
        for (const variant of [ext, ext.toUpperCase()]) {
          const from = path.join(srcPath, `${filename}${variant}`);
          const toDir = destPath;
          if (await moveIfExists(from, toDir)) {
            movedAny = true;
            log.debug('move_original_moved', { filename: `${filename}${variant}`, from: srcProject.project_folder, to: destProject.project_folder });
          }
        }
      }

      // Move derivatives if present; otherwise regeneration will be handled later
      const fromThumb = path.join(srcPath, '.thumb', `${filename}.jpg`);
      const toThumbDir = path.join(destPath, '.thumb');
      const fromPrev = path.join(srcPath, '.preview', `${filename}.jpg`);
      const toPrevDir = path.join(destPath, '.preview');
      const thumbMoved = await moveIfExists(fromThumb, toThumbDir);
      const prevMoved = await moveIfExists(fromPrev, toPrevDir);
      if (thumbMoved) log.debug('move_thumb_moved', { filename, from: srcProject.project_folder, to: destProject.project_folder });
      if (prevMoved) log.debug('move_preview_moved', { filename, from: srcProject.project_folder, to: destProject.project_folder });

      // Update DB: move to destination project and align keep flags
      const updated = photosRepo.moveToProject({ photo_id: srcEntry.id, to_project_id: destProject.id });
      log.debug('move_db_updated', { filename, photo_id: updated.id, from_project_id: srcProject.id, to_project_id: destProject.id });
      // Derivative statuses after move
      try {
        const nextThumb = thumbMoved
          ? 'generated'
          : (srcEntry.thumbnail_status === 'not_supported' ? 'not_supported' : 'pending');
        const nextPrev = prevMoved
          ? 'generated'
          : (srcEntry.preview_status === 'not_supported' ? 'not_supported' : 'pending');
        photosRepo.updateDerivativeStatus(updated.id, { thumbnail_status: nextThumb, preview_status: nextPrev });
        log.debug('move_derivative_status_set', { filename, thumbnail_status: nextThumb, preview_status: nextPrev });
        if (nextThumb === 'pending' || nextPrev === 'pending') needGenerateDerivatives = true;
      } catch (_) { /* non-fatal */ }

      // Emit SSE: item removed on source, item added/moved on destination
      const now = new Date().toISOString();
      emitJobUpdate({ type: 'item_removed', project_folder: srcProject.project_folder, filename, updated_at: now });
      emitJobUpdate({ type: 'item_moved', project_folder: destProject.project_folder, filename, thumbnail_status: thumbMoved ? 'generated' : (srcEntry.thumbnail_status === 'not_supported' ? 'not_supported' : 'pending'), preview_status: prevMoved ? 'generated' : (srcEntry.preview_status === 'not_supported' ? 'not_supported' : 'pending'), updated_at: now });
      log.debug('move_sse_emitted', { filename, src_folder: srcProject.project_folder, dest_folder: destProject.project_folder });

      // Enqueue manifest_check for source project to reconcile leftovers
      try {
        const tenant_id = job.tenant_id || 'user_0';
        jobsRepo.enqueue({ tenant_id, project_id: srcProject.id, type: 'manifest_check', payload: payload, priority: 95 });
        log.debug('enqueue_manifest_check_source', { src_folder: srcProject.project_folder });
      } catch (e) {
        log.warn('enqueue_manifest_check_source_failed', { error: e && e.message });
      }

      jobsRepo.updateItemStatus(item.id, { status: 'done' });
    } catch (err) {
      log.error('image_move_item_failed', { filename, error: err && err.message, stack: err && err.stack });
      jobsRepo.updateItemStatus(item.id, { status: 'failed', message: err && err.message });
    }
  }

  // Persist decision in job payload for orchestrator to use when advancing steps
  try {
    const payload = job.payload_json || {};
    const nextPayload = { ...payload, need_generate_derivatives: needGenerateDerivatives };
    jobsRepo.updatePayload(job.id, nextPayload);
    log.info('move_job_completed', { job_id: job.id, need_generate_derivatives: needGenerateDerivatives });
  } catch (e) {
    log.warn('update_payload_failed', { job_id: job && job.id, error: e && e.message });
  }
}

module.exports = { runImageMoveFiles };
