const path = require('path');
const fs = require('fs-extra');
const makeLogger = require('../../utils/logger2');
const log = makeLogger('maintenance');
const config = require('../config');
const projectsRepo = require('../repositories/projectsRepo');
const photosRepo = require('../repositories/photosRepo');
const jobsRepo = require('../repositories/jobsRepo');
const { MANIFEST_FILENAME } = require('../projectManifest');
const { emitJobUpdate } = require('../events');
const { ensureProjectDirs, statMtimeSafe, buildAcceptPredicate, moveToTrash } = require('../fsUtils');

function splitExtSets() {
  const { acceptedExtensions } = buildAcceptPredicate();
  const lower = new Set([...acceptedExtensions].map(e => String(e).toLowerCase()));
  const jpg = new Set(['jpg', 'jpeg']);
  const knownRaw = new Set(['raw', 'cr2', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2']);
  const raw = new Set();
  const other = new Set();
  for (const e of lower) {
    if (jpg.has(e)) continue;
    if (knownRaw.has(e)) raw.add(e); else other.add(e);
  }
  return { jpg, raw, other };
}

function listActiveProjects() {
  return projectsRepo.list();
}

function getProjectsForJob(job) {
  if (job.project_id) {
    const project = projectsRepo.getById(job.project_id);
    if (!project) throw new Error('Project not found');
    return [project];
  }
  return listActiveProjects();
}

function projectLogContext(project) {
  return {
    project_id: project.id,
    project_folder: project.project_folder,
    project_name: project.project_name,
  };
}

async function fileExistsForBase(projectPath, base, extensions) {
  for (const ext of extensions) {
    const candidatePath = path.join(projectPath, `${base}${ext}`);
    if (await fs.pathExists(candidatePath)) {
      return true;
    }
    // Also guard against uppercase extensions
    if (ext.toUpperCase() !== ext) {
      const upperPath = path.join(projectPath, `${base}${ext.toUpperCase()}`);
      if (await fs.pathExists(upperPath)) {
        return true;
      }
    }
  }
  return false;
}

async function findAvailableDuplicateBase({ base, project, projectPath, extensions }) {
  let suffix = 1;
  while (true) {
    const candidateBase = `${base}_duplicate${suffix}`;
    const dbConflict = photosRepo.getGlobalByFilename(candidateBase);
    const projectConflict = photosRepo.getByProjectAndFilename(project.id, candidateBase);
    const diskConflict = await fileExistsForBase(projectPath, candidateBase, extensions);
    if (!dbConflict && !projectConflict && !diskConflict) {
      return candidateBase;
    }
    suffix += 1;
  }
}

function getTaskPayload(job) {
  if (job && job.payload_json && job.payload_json.task_id && job.payload_json.task_type) {
    const { task_id, task_type, source } = job.payload_json;
    return { task_id, task_type, source: source || 'system' };
  }
  return null;
}

function enqueuePostprocess(job, project, bases, logEvent) {
  if (!bases || bases.length === 0) return null;
  const taskPayload = getTaskPayload(job);
  const items = bases.map(base => ({ filename: base }));
  try {
    const result = jobsRepo.enqueueWithItems({
      tenant_id: job.tenant_id,
      project_id: project.id,
      type: 'upload_postprocess',
      payload: taskPayload,
      items,
      priority: 90,
      scope: 'project',
    });
    const jobIds = Array.isArray(result) ? result.map(j => j && j.id).filter(Boolean) : result && result.id;
    log.info(logEvent, { ...projectLogContext(project), job_id: jobIds, items: bases.length });
    return result;
  } catch (err) {
    log.error('enqueue_postprocess_failed', { ...projectLogContext(project), error: err.message, items: bases.length });
    return null;
  }
}


async function runTrashMaintenance(job) {
  const projects = getProjectsForJob(job);
  let totalDeleted = 0;
  for (const project of projects) {
    try {
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
          log.warn('trash_maintenance_failed', { ...projectLogContext(project), entry: name, error: e.message });
        }
      }
      totalDeleted += deleted;
      log.info('trash_maintenance_done', { ...projectLogContext(project), deleted_files: deleted });
    } catch (err) {
      log.error('trash_maintenance_project_failed', { ...projectLogContext(project), error: err.message });
    }
  }
  if (projects.length > 1) {
    log.info('trash_maintenance_global_summary', { projects_processed: projects.length, total_deleted: totalDeleted });
  }
}

async function ensureManifest(project) {
  const projectPath = ensureProjectDirs(project.project_folder);
  const { readManifest, writeManifest } = require('../projectManifest');
  const manifestPath = path.join(projectPath, '.project.yaml');

  if (!await fs.pathExists(manifestPath)) {
    log.warn('manifest_missing', projectLogContext(project));
    writeManifest(project.project_folder, {
      name: project.project_name,
      id: project.id,
      created_at: project.created_at,
    });
    log.info('manifest_regenerated', projectLogContext(project));
    return projectPath;
  }

  const manifest = readManifest(project.project_folder);
  if (manifest && manifest.id !== project.id) {
    log.warn('manifest_id_mismatch', { ...projectLogContext(project), manifest_id: manifest.id });
    writeManifest(project.project_folder, {
      name: project.project_name,
      id: project.id,
      created_at: project.created_at,
    });
    log.info('manifest_corrected', projectLogContext(project));
  }
  return projectPath;
}

async function runManifestCheck(job) {
  const CHUNK_SIZE = config.maintenance?.manifest_check_chunk_size || 2000;
  const projects = getProjectsForJob(job);
  let totalChanged = 0;

  for (const project of projects) {
    try {
      const projectPath = await ensureManifest(project);
      const { jpg, raw, other } = splitExtSets();

      let cursor = null;
      let changed = 0;
      let processed = 0;

      // Stream through photos using cursor-based pagination
      do {
        const page = photosRepo.listPaged({
          project_id: project.id,
          limit: CHUNK_SIZE,
          cursor: cursor,
          sort: 'date_time_original',
          dir: 'DESC'
        });

        // Process this chunk
        for (const p of page.items) {
          const base = p.filename;
          const jpgExists = [...jpg].some(e =>
            fs.existsSync(path.join(projectPath, `${base}.${e}`)) ||
            fs.existsSync(path.join(projectPath, `${base}.${e.toUpperCase()}`)));
          const rawExists = [...raw].some(e =>
            fs.existsSync(path.join(projectPath, `${base}.${e}`)) ||
            fs.existsSync(path.join(projectPath, `${base}.${e.toUpperCase()}`)));
          const otherExists = [...other].some(e =>
            fs.existsSync(path.join(projectPath, `${base}.${e}`)) ||
            fs.existsSync(path.join(projectPath, `${base}.${e.toUpperCase()}`)));

          if ((!!p.jpg_available) !== jpgExists ||
            (!!p.raw_available) !== rawExists ||
            (!!p.other_available) !== otherExists) {
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
            log.warn('manifest_check_corrected', {
              ...projectLogContext(project),
              filename: base,
              jpg: jpgExists,
              raw: rawExists,
              other: otherExists
            });
            changed++;
          }
          processed++;
        }

        // Update job progress
        if (job.id && page.total) {
          jobsRepo.updateProgress(job.id, { done: processed, total: page.total });
        }

        // Move to next page
        cursor = page.nextCursor;

        // Yield to event loop between chunks
        await new Promise(resolve => setImmediate(resolve));

      } while (cursor);

      totalChanged += changed;
      log.info('manifest_check_summary', {
        ...projectLogContext(project),
        updated_rows: changed,
        total_processed: processed
      });

      if (changed > 0) {
        emitJobUpdate({
          type: 'manifest_changed',
          project_folder: project.project_folder,
          changed
        });
      }
    } catch (err) {
      log.error('manifest_check_project_failed', {
        ...projectLogContext(project),
        error: err.message
      });
    }
  }

  if (projects.length > 1) {
    log.info('manifest_check_global_summary', {
      projects_processed: projects.length,
      total_changed: totalChanged
    });
  }
}

async function runFolderCheck(job) {
  const projects = getProjectsForJob(job);
  let totalCreated = 0;
  for (const project of projects) {
    try {
      const projectPath = await ensureManifest(project);
      const { isAccepted } = buildAcceptPredicate();
      const { jpg, raw } = splitExtSets();
      const entries = await fs.readdir(projectPath);
      const skip = new Set(['.thumb', '.preview', '.trash', MANIFEST_FILENAME]);
      const discoveredBases = new Map();

      for (const name of entries) {
        if (skip.has(name)) continue;
        const full = path.join(projectPath, name);
        const st = await fs.stat(full);
        if (!st.isFile()) continue;
        const ext = path.extname(name).toLowerCase().replace(/^\./, '');
        const base = path.parse(name).name;
        if (isAccepted(name, '')) {
          const rec = discoveredBases.get(base) || { jpg: false, raw: false, other: false, files: [] };
          if (jpg.has(ext)) {
            rec.jpg = true;
            rec.files.push({ type: 'jpg', path: full, ext });
          } else if (raw.has(ext)) {
            rec.raw = true;
            rec.files.push({ type: 'raw', path: full, ext });
          } else {
            rec.other = true;
            rec.files.push({ type: 'other', path: full, ext });
          }
          discoveredBases.set(base, rec);
        } else {
          try {
            moveToTrash(project.project_folder, name);
            log.warn('folder_check_moved_to_trash', { ...projectLogContext(project), entry: name });
          } catch (e) {
            log.warn('folder_check_trash_move_failed', { ...projectLogContext(project), entry: name, error: e.message });
          }
        }
      }

      const toProcess = [];
      let createdCount = 0;
      for (const [base, availability] of discoveredBases.entries()) {
        const existing = photosRepo.getByProjectAndFilename(project.id, base);
        if (!existing) {
          const primaryFile = availability.files && availability.files[0];
          photosRepo.upsertPhoto(project.id, {
            filename: base,
            basename: base,
            ext: primaryFile ? primaryFile.ext : null,
            date_time_original: null,
            jpg_available: !!availability.jpg,
            raw_available: !!availability.raw,
            other_available: !!availability.other,
            keep_jpg: !!availability.jpg,
            keep_raw: !!availability.raw,
            thumbnail_status: null,
            preview_status: null,
            orientation: null,
            meta_json: null,
          });
          toProcess.push(base);
          createdCount++;
        }
      }

      if (toProcess.length) {
        enqueuePostprocess(job, project, toProcess, 'folder_check_enqueued_postprocess');
      }
      totalCreated += createdCount;
      if (createdCount > 0) {
        emitJobUpdate({ type: 'manifest_changed', project_folder: project.project_folder, created: createdCount });
      }
    } catch (err) {
      log.error('folder_check_project_failed', { ...projectLogContext(project), error: err.message });
    }
  }
  if (projects.length > 1) {
    log.info('folder_check_global_summary', { projects_processed: projects.length, total_created: totalCreated });
  }
}

async function runManifestCleaning(job) {
  const projects = getProjectsForJob(job);
  let totalRemoved = 0;
  for (const project of projects) {
    try {
      const page = photosRepo.listPaged({ project_id: project.id, limit: 100000 });
      let removed = 0;
      const removedFilenames = [];
      for (const p of page.items) {
        if (!p.jpg_available && !p.raw_available) {
          photosRepo.removeById(p.id);
          removed++;
          removedFilenames.push(p.filename);
          emitJobUpdate({ type: 'item_removed', project_folder: project.project_folder, filename: p.filename });
        }
      }
      totalRemoved += removed;
      log.info('manifest_cleaning_summary', { ...projectLogContext(project), removed_rows: removed });
      if (removed > 0) {
        emitJobUpdate({ type: 'manifest_changed', project_folder: project.project_folder, removed, removed_filenames: removedFilenames });
      }
    } catch (err) {
      log.error('manifest_cleaning_project_failed', { ...projectLogContext(project), error: err.message });
    }
  }
  if (projects.length > 1) {
    log.info('manifest_cleaning_global_summary', { projects_processed: projects.length, total_removed: totalRemoved });
  }
}

async function runDuplicateResolution(job) {
  const projects = getProjectsForJob(job);
  const { isAccepted } = buildAcceptPredicate();
  let totalRenamed = 0;

  for (const project of projects) {
    try {
      const projectPath = await ensureManifest(project);
      const entries = await fs.readdir(projectPath);
      const skip = new Set(['.thumb', '.preview', '.trash']);
      const baseGroups = new Map();

      for (const name of entries) {
        if (skip.has(name)) continue;
        const full = path.join(projectPath, name);
        const st = await fs.stat(full);
        if (!st.isFile()) continue;
        if (!isAccepted(name, '')) continue;

        const base = path.parse(name).name;
        if (!baseGroups.has(base)) baseGroups.set(base, []);
        baseGroups.get(base).push(name);
      }

      let renamedInProject = 0;
      const renamedBases = new Set();
      for (const [base, filenames] of baseGroups.entries()) {
        const existingInProject = photosRepo.getByProjectAndFilename(project.id, base);
        if (existingInProject) continue;

        const existingElsewhere = photosRepo.getGlobalByFilename(base, { exclude_project_id: project.id });
        if (!existingElsewhere) continue;

        const extensions = filenames.map(name => path.extname(name));
        const candidateBase = await findAvailableDuplicateBase({ base, project, projectPath, extensions });
        let renameFailures = 0;

        for (const oldName of filenames) {
          const ext = path.extname(oldName);
          const newName = `${candidateBase}${ext}`;
          const oldPath = path.join(projectPath, oldName);
          const newPath = path.join(projectPath, newName);
          try {
            await fs.move(oldPath, newPath, { overwrite: false });
            renamedInProject++;
            totalRenamed++;
            renamedBases.add(candidateBase);
            log.info('duplicate_resolution_renamed', { ...projectLogContext(project), old_filename: oldName, new_filename: newName, conflict_project_id: existingElsewhere.project_id });
          } catch (err) {
            renameFailures++;
            log.error('duplicate_resolution_rename_failed', { ...projectLogContext(project), old_filename: oldName, new_filename: newName, error: err.message });
          }
        }

        if (renameFailures > 0) {
          log.warn('duplicate_resolution_partial_failure', { ...projectLogContext(project), basename: base, attempted: filenames.length, failures: renameFailures });
        }
      }

      if (renamedInProject > 0) {
        if (renamedBases.size > 0) {
          enqueuePostprocess(job, project, [...renamedBases], 'duplicate_resolution_enqueued_postprocess');
        }
        log.info('duplicate_resolution_project_summary', { ...projectLogContext(project), files_renamed: renamedInProject });
      }
    } catch (err) {
      log.error('duplicate_resolution_project_failed', { ...projectLogContext(project), error: err.message });
    }
  }

  if (projects.length > 1) {
    log.info('duplicate_resolution_global_summary', { projects_processed: projects.length, total_renamed: totalRenamed });
  }
}

/**
 * Align folder names with project names
 * Three-way sync: project_name (DB) is source of truth, aligns folder and manifest
 * Also syncs manifest.name if it doesn't match project_name
 */
async function runFolderAlignment(job) {
  const { generateUniqueFolderName } = require('../../utils/projects');
  const { writeManifest, readManifest } = require('../projectManifest');
  const { getProjectPath } = require('../fsUtils');

  const projects = getProjectsForJob(job);
  let totalAligned = 0;

  for (const project of projects) {
    try {
      const dbName = project.project_name;
      const dbFolder = project.project_folder;

      // Read manifest to check three-way consistency
      const manifest = readManifest(dbFolder);
      const manifestName = manifest?.name;

      // Check if all three are in sync
      const allInSync = (dbName === dbFolder && dbName === manifestName);

      if (allInSync) {
        continue; // Perfect sync, nothing to do
      }

      // Generate expected folder name from project name (source of truth)
      const expectedFolder = generateUniqueFolderName(dbName);

      const oldPath = getProjectPath(dbFolder);
      const newPath = getProjectPath(expectedFolder);

      // Safety checks
      if (!await fs.pathExists(oldPath)) {
        log.warn('folder_alignment_source_missing', {
          ...projectLogContext(project),
          expected_folder: expectedFolder,
          note: 'Source folder does not exist, skipping'
        });
        continue;
      }

      // If folder needs renaming
      let folderRenamed = false;
      if (dbFolder !== expectedFolder) {
        if (await fs.pathExists(newPath)) {
          log.warn('folder_alignment_target_exists', {
            ...projectLogContext(project),
            expected_folder: expectedFolder,
            note: 'Target folder already exists, skipping folder rename'
          });
        } else {
          // Perform atomic rename
          await fs.rename(oldPath, newPath);

          // Update database
          projectsRepo.updateFolder(project.id, expectedFolder);

          folderRenamed = true;

          log.info('folder_renamed', {
            project_id: project.id,
            project_name: dbName,
            old_folder: dbFolder,
            new_folder: expectedFolder
          });

          // Emit SSE event for UI update
          emitJobUpdate({
            type: 'folder_renamed',
            project_id: project.id,
            old_folder: dbFolder,
            new_folder: expectedFolder,
            project_name: dbName
          });
        }
      }

      // Always sync manifest to match project_name (source of truth)
      const finalFolder = folderRenamed ? expectedFolder : dbFolder;
      writeManifest(finalFolder, {
        name: dbName,  // Use DB name as canonical
        id: project.id,
        created_at: project.created_at
      });

      if (manifestName !== dbName) {
        log.info('manifest_name_synced', {
          project_id: project.id,
          folder: finalFolder,
          old_manifest_name: manifestName,
          new_manifest_name: dbName
        });
      }

      totalAligned++;

    } catch (err) {
      log.error('folder_alignment_failed', {
        ...projectLogContext(project),
        error: err.message,
        stack: err.stack
      });
    }
  }

  if (projects.length > 1) {
    log.info('folder_alignment_global_summary', {
      projects_processed: projects.length,
      total_aligned: totalAligned
    });
  }
}

/**
 * Clean up orphaned projects
 * Detects projects whose folders no longer exist on disk and removes them immediately
 */
async function runOrphanedProjectCleanup(job) {
  const { getProjectPath } = require('../fsUtils');
  const projects = getProjectsForJob(job);
  let totalRemoved = 0;

  for (const project of projects) {
    try {
      const projectPath = getProjectPath(project.project_folder);
      const folderExists = await fs.pathExists(projectPath);

      if (!folderExists) {
        // Folder missing - remove project from database immediately
        log.info('orphaned_project_removing', {
          ...projectLogContext(project),
          reason: 'Folder does not exist'
        });

        projectsRepo.remove(project.id);
        totalRemoved++;

        emitJobUpdate({
          type: 'project_removed',
          project_id: project.id,
          project_folder: project.project_folder,
          reason: 'orphaned'
        });
      }
    } catch (err) {
      log.error('orphaned_project_cleanup_failed', {
        ...projectLogContext(project),
        error: err.message
      });
    }
  }

  if (projects.length > 1) {
    log.info('orphaned_project_cleanup_summary', {
      projects_checked: projects.length,
      removed: totalRemoved
    });
  } else if (totalRemoved > 0) {
    log.info('orphaned_project_cleanup_summary', {
      removed: totalRemoved
    });
  }
}

/**
 * Validate derivative cache consistency
 * Checks if cached derivatives actually exist on disk and invalidates stale cache entries
 */
async function runDerivativeCacheValidation(job) {
  const derivativeCache = require('../derivativeCache');
  const { getProjectPath } = require('../fsUtils');
  const CHUNK_SIZE = config.maintenance?.cache_validation_chunk_size || 1000;

  const projects = getProjectsForJob(job);
  let totalValidated = 0;
  let totalInvalidated = 0;

  for (const project of projects) {
    try {
      const projectPath = getProjectPath(project.project_folder);
      const thumbDir = path.join(projectPath, '.thumb');
      const previewDir = path.join(projectPath, '.preview');

      let cursor = null;
      let projectInvalidated = 0;
      let projectValidated = 0;

      // Stream through photos using cursor-based pagination
      do {
        const page = photosRepo.listPaged({
          project_id: project.id,
          limit: CHUNK_SIZE,
          cursor: cursor,
          sort: 'id',
          dir: 'ASC'
        });

        // Check each photo's cache entry
        for (const photo of page.items) {
          const cached = derivativeCache.getCached(photo.id);
          if (!cached) {
            projectValidated++;
            continue; // No cache entry, nothing to validate
          }

          // Check if cached derivatives actually exist on disk
          let thumbExists = false;
          let previewExists = false;

          if (cached.thumbnail) {
            const thumbPath = path.join(thumbDir, `${photo.filename}.jpg`);
            thumbExists = await fs.pathExists(thumbPath);
          }

          if (cached.preview) {
            const previewPath = path.join(previewDir, `${photo.filename}.jpg`);
            previewExists = await fs.pathExists(previewPath);
          }

          // If cache says derivatives exist but they don't, invalidate cache
          const cacheInvalid = (cached.thumbnail && !thumbExists) || (cached.preview && !previewExists);

          if (cacheInvalid) {
            derivativeCache.invalidate(photo.id);
            projectInvalidated++;

            // Also update database status to reflect missing derivatives
            const updates = {};
            if (cached.thumbnail && !thumbExists) {
              updates.thumbnail_status = 'missing';
            }
            if (cached.preview && !previewExists) {
              updates.preview_status = 'missing';
            }

            if (Object.keys(updates).length > 0) {
              photosRepo.updateDerivativeStatus(photo.id, updates);
            }

            log.warn('cache_invalidated_missing_files', {
              ...projectLogContext(project),
              photo_id: photo.id,
              filename: photo.filename,
              thumb_missing: cached.thumbnail && !thumbExists,
              preview_missing: cached.preview && !previewExists
            });
          } else {
            projectValidated++;
          }
        }

        // Update job progress
        if (job.id && page.total) {
          jobsRepo.updateProgress(job.id, {
            done: projectValidated + projectInvalidated,
            total: page.total
          });
        }

        // Move to next page
        cursor = page.nextCursor;

        // Yield to event loop between chunks
        await new Promise(resolve => setImmediate(resolve));

      } while (cursor);

      totalValidated += projectValidated;
      totalInvalidated += projectInvalidated;

      // Check for photos with missing derivatives (regardless of cache invalidation)
      // This catches cases where derivatives were never generated or manually deleted
      let missingPhotos = [];
      try {
        missingPhotos = photosRepo.listPaged({
          project_id: project.id,
          limit: 10000,
          sort: 'id',
          dir: 'ASC'
        }).items.filter(p =>
          p.thumbnail_status === 'missing' || p.preview_status === 'missing'
        );
      } catch (err) {
        log.error('cache_validation_missing_check_failed', {
          ...projectLogContext(project),
          error: err.message
        });
      }

      log.info('cache_validation_summary', {
        ...projectLogContext(project),
        validated: projectValidated,
        invalidated: projectInvalidated,
        missing_derivatives: missingPhotos.length
      });

      if (projectInvalidated > 0) {
        emitJobUpdate({
          type: 'cache_validated',
          project_folder: project.project_folder,
          invalidated: projectInvalidated
        });
      }

      // Trigger derivative generation for photos with missing derivatives
      if (missingPhotos.length > 0) {
        try {
          const photoIds = missingPhotos.map(p => p.id);
          const derivJob = jobsRepo.enqueueWithItems({
            tenant_id: job.tenant_id,
            project_id: null,
            type: 'generate_derivatives',
            payload: {
              task_id: `cache-regen-${project.id}`,
              task_type: 'generate_derivatives',
              source: 'maintenance',
              force: false
            },
            items: photoIds.map(id => ({ photo_id: id })),
            priority: 85,
            scope: 'photo_set',
          });

          log.info('cache_validation_triggered_regen', {
            ...projectLogContext(project),
            photo_count: missingPhotos.length,
            job_id: Array.isArray(derivJob) ? derivJob[0]?.id : derivJob?.id
          });
        } catch (err) {
          log.error('cache_validation_regen_failed', {
            ...projectLogContext(project),
            error: err.message
          });
        }
      }
    } catch (err) {
      log.error('cache_validation_project_failed', {
        ...projectLogContext(project),
        error: err.message
      });
    }
  }

  if (projects.length > 1) {
    log.info('cache_validation_global_summary', {
      projects_processed: projects.length,
      total_validated: totalValidated,
      total_invalidated: totalInvalidated
    });
  }
}

/**
 * Migrate all derivatives to WebP
 * Scans for existing JPG derivatives and queues regeneration (which converts to WebP and deletes JPG)
 */
async function runWebPMigration(job) {
  const { getProjectPath } = require('../fsUtils');
  const projects = getProjectsForJob(job);
  let totalQueued = 0;

  for (const project of projects) {
    try {
      const projectPath = getProjectPath(project.project_folder);
      const thumbDir = path.join(projectPath, '.thumb');
      const previewDir = path.join(projectPath, '.preview');

      // Get all photos
      const page = photosRepo.listPaged({ project_id: project.id, limit: 100000 });
      const toRegenerate = [];

      for (const p of page.items) {
        const thumbJpg = path.join(thumbDir, `${p.filename}.jpg`);
        const previewJpg = path.join(previewDir, `${p.filename}.jpg`);

        // Check if legacy JPGs exist
        const hasLegacy = (await fs.pathExists(thumbJpg)) || (await fs.pathExists(previewJpg));

        // Also check if WebP is missing (in case of partial migration)
        const thumbWebP = path.join(thumbDir, `${p.filename}.webp`);
        const previewWebP = path.join(previewDir, `${p.filename}.webp`);
        const missingWebP = (!await fs.pathExists(thumbWebP)) || (!await fs.pathExists(previewWebP));

        if (hasLegacy || missingWebP) {
          toRegenerate.push({ filename: p.filename, photo_id: p.id });
        }
      }

      if (toRegenerate.length > 0) {
        jobsRepo.enqueueWithItems({
          tenant_id: job.tenant_id,
          project_id: project.id,
          type: 'generate_derivatives',
          payload: {
            task_id: `webp-migration-${project.id}`,
            task_type: 'generate_derivatives',
            source: 'maintenance',
            force: true // Force regeneration to ensure WebP creation and JPG cleanup
          },
          items: toRegenerate,
          priority: 50,
          scope: 'project',
          autoChunk: true
        });

        totalQueued += toRegenerate.length;
        log.info('webp_migration_queued', {
          ...projectLogContext(project),
          count: toRegenerate.length
        });

        emitJobUpdate({
          type: 'migration_queued',
          project_folder: project.project_folder,
          count: toRegenerate.length
        });
      }

    } catch (err) {
      log.error('webp_migration_project_failed', {
        ...projectLogContext(project),
        error: err.message
      });
    }
  }

  if (projects.length > 1) {
    log.info('webp_migration_global_summary', {
      projects_processed: projects.length,
      total_queued: totalQueued
    });
  }
}

module.exports = {
  runTrashMaintenance,
  runManifestCheck,
  runFolderCheck,
  runManifestCleaning,
  runDuplicateResolution,
  runFolderAlignment,
  runOrphanedProjectCleanup,
  runDerivativeCacheValidation,
  runWebPMigration
};
