const path = require('path');
const fs = require('fs-extra');
const projectsRepo = require('../repositories/projectsRepo');
const photosRepo = require('../repositories/photosRepo');
const { ensureProjectDirs, removeDerivatives } = require('../fsUtils');
const { emitJobUpdate } = require('../events');

function extVariants(name, exts) {
  const out = [];
  for (const e of exts) {
    out.push(`${name}.${e}`);
    out.push(`${name}.${e.toUpperCase()}`);
  }
  return out;
}

async function runFileRemoval(job) {
  const payload = job.payload_json || {};
  const project = projectsRepo.getById(job.project_id);
  if (!project) throw new Error('Project not found for job');
  const projectPath = ensureProjectDirs(project.project_folder);

  const page = photosRepo.listPaged({ project_id: project.id, limit: 100000 });
  const requested = Array.isArray(payload.filenames) && payload.filenames.length ? new Set(payload.filenames.map(s => String(s).toLowerCase())) : null;

  const jpgExts = new Set(['jpg','jpeg']);
  const rawExts = new Set(['raw','cr2','nef','arw','dng','raf','orf','rw2']);

  for (const p of page.items) {
    if (requested && !requested.has(String(p.filename).toLowerCase())) continue;

    let jpgChanged = false;
    let rawChanged = false;

    // Remove JPGs if not kept and currently available
    if (!p.keep_jpg && p.jpg_available) {
      const candidates = extVariants(p.filename, jpgExts);
      for (const c of candidates) {
        const full = path.join(projectPath, c);
        if (fs.existsSync(full)) {
          try { fs.moveSync(full, path.join(projectPath, '.trash', path.basename(full)), { overwrite: true }); } catch {}
        }
      }
      // Remove derivatives and mark missing
      try { removeDerivatives(project.project_folder, p.filename); } catch {}
      photosRepo.upsertPhoto(project.id, {
        manifest_id: p.manifest_id,
        filename: p.filename,
        basename: p.basename || p.filename,
        ext: p.ext,
        date_time_original: p.date_time_original,
        jpg_available: false,
        raw_available: !!p.raw_available,
        other_available: !!p.other_available,
        keep_jpg: !!p.keep_jpg,
        keep_raw: !!p.keep_raw,
        thumbnail_status: 'missing',
        preview_status: 'missing',
        orientation: p.orientation,
        meta_json: p.meta_json,
      });
      jpgChanged = true;
    }

    // Remove RAWs if not kept and currently available
    if (!p.keep_raw && p.raw_available) {
      const candidates = extVariants(p.filename, rawExts);
      for (const c of candidates) {
        const full = path.join(projectPath, c);
        if (fs.existsSync(full)) {
          try { fs.moveSync(full, path.join(projectPath, '.trash', path.basename(full)), { overwrite: true }); } catch {}
        }
      }
      photosRepo.upsertPhoto(project.id, {
        manifest_id: p.manifest_id,
        filename: p.filename,
        basename: p.basename || p.filename,
        ext: p.ext,
        date_time_original: p.date_time_original,
        jpg_available: !!p.jpg_available,
        raw_available: false,
        other_available: !!p.other_available,
        keep_jpg: !!p.keep_jpg,
        keep_raw: !!p.keep_raw,
        thumbnail_status: p.thumbnail_status,
        preview_status: p.preview_status,
        orientation: p.orientation,
        meta_json: p.meta_json,
      });
      rawChanged = true;
    }

    // Emit item-level SSE when something changed, prioritizing immediate UI update
    if (jpgChanged || rawChanged) {
      const updatedAt = new Date().toISOString();
      emitJobUpdate({
        type: 'item',
        project_folder: project.project_folder,
        filename: p.filename,
        thumbnail_status: jpgChanged ? 'missing' : (p.thumbnail_status || null),
        preview_status: jpgChanged ? 'missing' : (p.preview_status || null),
        updated_at: updatedAt,
      });
    }
  }
}

module.exports = { runFileRemoval };
