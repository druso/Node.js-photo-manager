const path = require('path');
const fs = require('fs-extra');
const { getConfig } = require('../config');
const { getProjectPath } = require('../fsUtils');
const projectsRepo = require('../repositories/projectsRepo');
const photosRepo = require('../repositories/photosRepo');
const jobsRepo = require('../repositories/jobsRepo');
const { generateDerivative } = require('../../utils/imageProcessing');
const { emitJobUpdate } = require('../events');

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
  const rawExts = ['raw','cr2','nef','arw','dng','raf','orf','rw2'];

  const existsAny = (base, exts) => {
    for (const e of exts) {
      const p1 = path.join(projectPath, `${base}.${e}`);
      const p2 = path.join(projectPath, `${base}.${e.toUpperCase()}`);
      if (fs.existsSync(p1) || fs.existsSync(p2)) return true;
    }
    return false;
  };

  for (const item of items) {
    // Stop if job was canceled mid-run
    const fresh = jobsRepo.getById(job.id);
    if (fresh && fresh.status === 'canceled') break;
    // Also stop if project just got canceled
    const p2 = projectsRepo.getById(job.project_id);
    if (!p2 || p2.status === 'canceled') break;
    if (item.status !== 'pending') continue;
    jobsRepo.updateItemStatus(item.id, { status: 'running' });
    try {
      const entry = all.find(p => p.id === item.photo_id || p.filename === item.filename);
      if (!entry) {
        jobsRepo.updateItemStatus(item.id, { status: 'skipped', message: 'photo not found' });
        // notify client immediately for item resolution
        emitJobUpdate({
          type: 'item',
          project_folder: project.project_folder,
          filename: item.filename || (entry && entry.filename),
          thumbnail_status: 'failed',
          preview_status: 'failed',
          updated_at: new Date().toISOString(),
        });
        continue;
      }
      // Recompute availability and align keep flags before derivative generation
      try {
        const jpgExists = existsAny(entry.filename, jpgExts);
        const rawExists = existsAny(entry.filename, rawExts);
        const otherExists = !jpgExists && !rawExists ? false : (entry.other_available ? true : false);
        // Upsert: ensure availability and keep flags reflect filesystem
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
      } catch (_) {
        // non-fatal
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
      } else {
        // Thumbnail
        if (effectiveForce || entry.thumbnail_status === 'pending' || entry.thumbnail_status === 'failed' || !entry.thumbnail_status) {
          try {
            const thumbPath = path.join(projectPath, '.thumb', `${entry.filename}.jpg`);
            await generateDerivative(sourceFile, thumbPath, { maxDim: Number(thumbCfg.maxDim) || 200, quality: Number(thumbCfg.quality) || 80 });
            photosRepo.updateDerivativeStatus(entry.id, { thumbnail_status: 'generated' });
          } catch (e) {
            photosRepo.updateDerivativeStatus(entry.id, { thumbnail_status: 'failed' });
          }
        }
        // Preview
        if (effectiveForce || entry.preview_status === 'pending' || entry.preview_status === 'failed' || !entry.preview_status) {
          try {
            const previewPath = path.join(projectPath, '.preview', `${entry.filename}.jpg`);
            await generateDerivative(sourceFile, previewPath, { maxDim: Number(prevCfg.maxDim) || 6000, quality: Number(prevCfg.quality) || 80 });
            photosRepo.updateDerivativeStatus(entry.id, { preview_status: 'generated' });
          } catch (e) {
            photosRepo.updateDerivativeStatus(entry.id, { preview_status: 'failed' });
          }
        }
        jobsRepo.updateItemStatus(item.id, { status: 'done' });
        // emit item-level update for UI without full refetch
        const updatedAt = new Date().toISOString();
        emitJobUpdate({
          type: 'item',
          project_folder: project.project_folder,
          filename: entry.filename,
          // we just wrote statuses to DB; reflect optimistic values
          thumbnail_status: 'generated',
          preview_status: 'generated',
          updated_at: updatedAt,
        });
      }
      done += 1;
      const updated = jobsRepo.updateProgress(job.id, { done });
      emitJobUpdate({ id: job.id, status: updated.status, progress_done: updated.progress_done, progress_total: updated.progress_total });
      onProgress && onProgress({ done, total: items.length });
    } catch (err) {
      jobsRepo.updateItemStatus(item.id, { status: 'failed', message: String(err.message || err) });
      done += 1;
      const updated = jobsRepo.updateProgress(job.id, { done });
      emitJobUpdate({ id: job.id, status: updated.status, progress_done: updated.progress_done, progress_total: updated.progress_total });
      onProgress && onProgress({ done, total: items.length });
    }
  }
}

module.exports = { runGenerateDerivatives };
