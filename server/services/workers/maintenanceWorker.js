const path = require('path');
const fs = require('fs-extra');
const { getConfig } = require('../config');
const projectsRepo = require('../repositories/projectsRepo');
const photosRepo = require('../repositories/photosRepo');
const jobsRepo = require('../repositories/jobsRepo');
const { ensureProjectDirs, PROJECTS_DIR, statMtimeSafe, buildAcceptPredicate, moveToTrash } = require('../fsUtils');

function splitExtSets() {
  const { acceptedExtensions } = buildAcceptPredicate();
  const lower = new Set([...acceptedExtensions].map(e => String(e).toLowerCase()));
  const jpg = new Set(['jpg', 'jpeg']);
  const knownRaw = new Set(['raw','cr2','nef','arw','dng','raf','orf','rw2']);
  const raw = new Set();
  const other = new Set();
  for (const e of lower) {
    if (jpg.has(e)) continue;
    if (knownRaw.has(e)) raw.add(e); else other.add(e);
  }
  return { jpg, raw, other };
}

async function runTrashMaintenance(job) {
  const project = projectsRepo.getById(job.project_id);
  if (!project) throw new Error('Project not found');
  const projectPath = ensureProjectDirs(project.project_folder);
  const trashPath = path.join(projectPath, '.trash');
  await fs.ensureDir(trashPath);
  const items = await fs.readdir(trashPath);
  const now = Date.now();
  const ttlMs = 24 * 60 * 60 * 1000; // 24h
  let deleted = 0;
  for (const name of items) {
    const full = path.join(trashPath, name);
    try {
      const st = await fs.stat(full);
      if (st.isFile()) {
        const age = now - st.mtimeMs;
        if (age >= ttlMs) { await fs.remove(full); deleted++; }
      } else if (st.isDirectory()) {
        // Clean nested entries as well
        const m = statMtimeSafe(full) || new Date(0);
        if (now - m.getTime() >= ttlMs) { await fs.remove(full); deleted++; }
      }
    } catch (e) {
      console.warn('[trash_maintenance] failed', name, e.message);
    }
  }
  console.log(`[trash_maintenance] project ${project.id} deleted ${deleted} files`);
}

async function runManifestCheck(job) {
  const project = projectsRepo.getById(job.project_id);
  if (!project) throw new Error('Project not found');
  const projectPath = ensureProjectDirs(project.project_folder);
  const { jpg, raw, other } = splitExtSets();
  const page = photosRepo.listPaged({ project_id: project.id, limit: 100000 });
  let changed = 0;
  for (const p of page.items) {
    const base = p.filename;
    // compute availability
    const jpgExists = [...jpg].some(e => fs.existsSync(path.join(projectPath, `${base}.${e}`)) || fs.existsSync(path.join(projectPath, `${base}.${e.toUpperCase()}`)));
    const rawExists = [...raw].some(e => fs.existsSync(path.join(projectPath, `${base}.${e}`)) || fs.existsSync(path.join(projectPath, `${base}.${e.toUpperCase()}`)));
    const otherExists = [...other].some(e => fs.existsSync(path.join(projectPath, `${base}.${e}`)) || fs.existsSync(path.join(projectPath, `${base}.${e.toUpperCase()}`)));
    if ((!!p.jpg_available) !== jpgExists || (!!p.raw_available) !== rawExists || (!!p.other_available) !== otherExists) {
      photosRepo.upsertPhoto(project.id, {
        manifest_id: p.manifest_id,
        filename: p.filename,
        basename: p.basename || p.filename,
        ext: p.ext,
        date_time_original: p.date_time_original,
        jpg_available: jpgExists,
        raw_available: rawExists,
        other_available: otherExists,
        keep_jpg: !!p.keep_jpg,
        keep_raw: !!p.keep_raw,
        thumbnail_status: p.thumbnail_status,
        preview_status: p.preview_status,
        orientation: p.orientation,
        meta_json: p.meta_json,
      });
      console.warn(`[manifest_check] corrected availability for ${base}: jpg=${jpgExists} raw=${rawExists} other=${otherExists}`);
      changed++;
    }
  }
  console.log(`[manifest_check] project ${project.id} updated rows: ${changed}`);
}

async function runFolderCheck(job) {
  const project = projectsRepo.getById(job.project_id);
  if (!project) throw new Error('Project not found');
  const projectPath = ensureProjectDirs(project.project_folder);
  const { isAccepted, acceptedExtensions } = buildAcceptPredicate();
  const { jpg, raw } = splitExtSets();
  const entries = await fs.readdir(projectPath);
  const skip = new Set(['.thumb', '.preview', '.trash']);
  const discoveredBases = new Map(); // base -> { jpg, raw, other }

  for (const name of entries) {
    if (skip.has(name)) continue;
    const full = path.join(projectPath, name);
    const st = await fs.stat(full);
    if (!st.isFile()) continue;
    const ext = path.extname(name).toLowerCase().replace(/^\./, '');
    const base = path.parse(name).name;
    if (isAccepted(name, '')) {
      const rec = discoveredBases.get(base) || { jpg: false, raw: false, other: false };
      if (jpg.has(ext)) rec.jpg = true; else if (raw.has(ext)) rec.raw = true; else rec.other = true;
      discoveredBases.set(base, rec);
    } else {
      // Not accepted -> move to trash
      try { moveToTrash(project.project_folder, name); console.warn('[folder_check] moved to .trash:', name); } catch (e) { console.warn('[folder_check] failed trash move', name, e.message); }
    }
  }

  const toProcess = [];
  for (const [base, availability] of discoveredBases.entries()) {
    const existing = photosRepo.getByProjectAndFilename(project.id, base);
    if (!existing) {
      // Upsert minimal record so downstream processing can proceed uniformly
      photosRepo.upsertPhoto(project.id, {
        filename: base,
        basename: base,
        ext: null,
        date_time_original: null,
        jpg_available: !!availability.jpg,
        raw_available: !!availability.raw,
        other_available: !!availability.other,
        keep_jpg: true,
        keep_raw: false,
        thumbnail_status: null,
        preview_status: null,
        orientation: null,
        meta_json: null,
      });
    }
    // Schedule derivative generation for discovered base
    toProcess.push({ filename: base });
  }

  if (toProcess.length) {
    const job2 = jobsRepo.enqueueWithItems({ tenant_id: job.tenant_id, project_id: project.id, type: 'upload_postprocess', payload: { filenames: toProcess.map(i => i.filename) }, items: toProcess, priority: 90 });
    console.log(`[folder_check] enqueued upload_postprocess job ${job2.id} for ${toProcess.length} items`);
  }
}

async function runManifestCleaning(job) {
  const project = projectsRepo.getById(job.project_id);
  if (!project) throw new Error('Project not found');
  const page = photosRepo.listPaged({ project_id: project.id, limit: 100000 });
  let removed = 0;
  for (const p of page.items) {
    if (!p.jpg_available && !p.raw_available) {
      photosRepo.removeById(p.id);
      removed++;
    }
  }
  console.log(`[manifest_cleaning] project ${project.id} removed rows: ${removed}`);
}

module.exports = {
  runTrashMaintenance,
  runManifestCheck,
  runFolderCheck,
  runManifestCleaning,
};
