const path = require('path');
const fs = require('fs-extra');
const makeLogger = require('../../utils/logger2');
const log = makeLogger('maintenance');
const { getConfig } = require('../config');
const projectsRepo = require('../repositories/projectsRepo');
const photosRepo = require('../repositories/photosRepo');
const jobsRepo = require('../repositories/jobsRepo');
const { emitJobUpdate } = require('../events');
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
      log.warn('trash_maintenance_failed', { project_id: project.id, project_folder: project.project_folder, project_name: project.name, entry: name, error: e.message });
    }
  }
  log.info('trash_maintenance_done', { project_id: project.id, project_folder: project.project_folder, project_name: project.name, deleted_files: deleted });
}

async function runManifestCheck(job) {
  const project = projectsRepo.getById(job.project_id);
  if (!project) throw new Error('Project not found');
  const projectPath = ensureProjectDirs(project.project_folder);
  
  // NEW: Verify manifest exists and is valid
  const { readManifest, writeManifest } = require('../projectManifest');
  const manifestPath = path.join(projectPath, '.project.yaml');
  
  if (!fs.existsSync(manifestPath)) {
    log.warn('manifest_missing', { 
      project_id: project.id, 
      project_folder: project.project_folder 
    });
    
    // Regenerate manifest
    writeManifest(project.project_folder, {
      name: project.project_name,
      id: project.id,
      created_at: project.created_at
    });
    
    log.info('manifest_regenerated', {
      project_id: project.id,
      project_folder: project.project_folder
    });
  } else {
    // Validate manifest matches DB
    const manifest = readManifest(project.project_folder);
    if (manifest && manifest.id !== project.id) {
      log.warn('manifest_id_mismatch', {
        project_id: project.id,
        manifest_id: manifest.id,
        project_folder: project.project_folder
      });
      
      // Regenerate with correct ID
      writeManifest(project.project_folder, {
        name: project.project_name,
        id: project.id,
        created_at: project.created_at
      });
      
      log.info('manifest_corrected', {
        project_id: project.id,
        project_folder: project.project_folder
      });
    }
  }
  
  // Continue with existing photo availability checks
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
      log.warn('manifest_check_corrected', { project_id: project.id, project_folder: project.project_folder, project_name: project.name, filename: base, jpg: jpgExists, raw: rawExists, other: otherExists });
      changed++;
    }
  }
  log.info('manifest_check_summary', { project_id: project.id, project_folder: project.project_folder, project_name: project.name, updated_rows: changed });
  if (changed > 0) {
    emitJobUpdate({ type: 'manifest_changed', project_folder: project.project_folder, changed });
  }
}

async function runFolderCheck(job) {
  const project = projectsRepo.getById(job.project_id);
  if (!project) throw new Error('Project not found');
  const projectPath = ensureProjectDirs(project.project_folder);
  
  // NEW: Ensure manifest exists
  const { readManifest, writeManifest } = require('../projectManifest');
  const manifestPath = path.join(projectPath, '.project.yaml');
  
  if (!fs.existsSync(manifestPath)) {
    writeManifest(project.project_folder, {
      name: project.project_name,
      id: project.id,
      created_at: project.created_at
    });
    
    log.info('manifest_created_by_folder_check', {
      project_id: project.id,
      project_folder: project.project_folder
    });
  }
  
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
      try {
        moveToTrash(project.project_folder, name);
        log.warn('folder_check_moved_to_trash', { project_id: project.id, project_folder: project.project_folder, project_name: project.name, entry: name });
      } catch (e) {
        log.warn('folder_check_trash_move_failed', { project_id: project.id, project_folder: project.project_folder, project_name: project.name, entry: name, error: e.message });
      }
    }
  }

  const toProcess = [];
  let createdCount = 0;
  for (const [base, availability] of discoveredBases.entries()) {
    const existing = photosRepo.getByProjectAndFilename(project.id, base);
    if (!existing) {
      // New base discovered on disk but not in manifest: create minimal row and schedule processing
      photosRepo.upsertPhoto(project.id, {
        filename: base,
        basename: base,
        ext: null,
        date_time_original: null,
        jpg_available: !!availability.jpg,
        raw_available: !!availability.raw,
        other_available: !!availability.other,
        // keep flags default to availability
        keep_jpg: !!availability.jpg,
        keep_raw: !!availability.raw,
        thumbnail_status: null,
        preview_status: null,
        orientation: null,
        meta_json: null,
      });
      // Only enqueue postprocess for truly new bases
      toProcess.push({ filename: base });
      createdCount++;
    } else {
      // Existing record present: do not enqueue here. Availability corrections are handled by manifest_check; orphan cleanup by manifest_cleaning.
    }
  }

  if (toProcess.length) {
    const taskPayload = job.payload_json && job.payload_json.task_id && job.payload_json.task_type
      ? { task_id: job.payload_json.task_id, task_type: job.payload_json.task_type, source: job.payload_json.source || 'system' }
      : null;
    const job2 = jobsRepo.enqueueWithItems({
      tenant_id: job.tenant_id,
      project_id: project.id,
      type: 'upload_postprocess',
      payload: taskPayload,
      items: toProcess,
      priority: 90,
    });
    log.info('folder_check_enqueued_postprocess', { project_id: project.id, project_folder: project.project_folder, project_name: project.name, job_id: job2.id, items: toProcess.length });
  }
  if (createdCount > 0) {
    emitJobUpdate({ type: 'manifest_changed', project_folder: project.project_folder, created: createdCount });
  }
}

async function runManifestCleaning(job) {
  const project = projectsRepo.getById(job.project_id);
  if (!project) throw new Error('Project not found');
  const page = photosRepo.listPaged({ project_id: project.id, limit: 100000 });
  let removed = 0;
  const removedFilenames = [];
  for (const p of page.items) {
    if (!p.jpg_available && !p.raw_available) {
      photosRepo.removeById(p.id);
      removed++;
      removedFilenames.push(p.filename);
      // Emit targeted removal event so frontend can update in-place
      emitJobUpdate({ type: 'item_removed', project_folder: project.project_folder, filename: p.filename });
    }
  }
  log.info('manifest_cleaning_summary', { project_id: project.id, project_folder: project.project_folder, project_name: project.name, removed_rows: removed });
  if (removed > 0) {
    emitJobUpdate({ type: 'manifest_changed', project_folder: project.project_folder, removed, removed_filenames: removedFilenames });
  }
}

module.exports = {
  runTrashMaintenance,
  runManifestCheck,
  runFolderCheck,
  runManifestCleaning,
};
