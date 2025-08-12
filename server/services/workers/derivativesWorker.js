const path = require('path');
const fs = require('fs-extra');
const { getConfig } = require('../config');
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
  const projectPath = path.join(__dirname, '..', '..', '..', '.projects', project.project_folder);

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

  for (const item of items) {
    if (item.status !== 'pending') continue;
    jobsRepo.updateItemStatus(item.id, { status: 'running' });
    try {
      const entry = all.find(p => p.id === item.photo_id || p.filename === item.filename);
      if (!entry) {
        jobsRepo.updateItemStatus(item.id, { status: 'skipped', message: 'photo not found' });
        continue;
      }
      const sourceFile = supportedSourcePath(projectPath, entry);
      if (!sourceFile) {
        photosRepo.updateDerivativeStatus(entry.id, {
          thumbnail_status: entry.thumbnail_status || 'failed',
          preview_status: entry.preview_status || 'failed',
        });
        jobsRepo.updateItemStatus(item.id, { status: 'skipped', message: 'no supported source' });
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
