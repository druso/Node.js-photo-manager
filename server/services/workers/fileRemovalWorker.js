const path = require('path');
const fs = require('fs-extra');
const projectsRepo = require('../repositories/projectsRepo');
const photosRepo = require('../repositories/photosRepo');
const jobsRepo = require('../repositories/jobsRepo');
const { ensureProjectDirs, removeDerivatives } = require('../fsUtils');
const { emitJobUpdate } = require('../events');
const { groupItemsByProject } = require('./shared/photoSetUtils');

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

  const jobItems = jobsRepo.listItems(job.id) || [];
  const requestedPhotoIds = new Set();
  const itemIdByPhotoId = new Map();
  const itemIdByFilename = new Map();
  const handledJobItemIds = new Set();

  for (const item of jobItems) {
    if (item.photo_id != null) {
      const idNum = Number(item.photo_id);
      if (Number.isFinite(idNum)) {
        requestedPhotoIds.add(idNum);
        itemIdByPhotoId.set(idNum, item.id);
      }
    }
    if (item.filename) {
      const key = String(item.filename).toLowerCase();
      itemIdByFilename.set(key, item.id);
    }
  }

  let requestedSet = null;
  let requestedOriginalByLower = null;
  if (Array.isArray(payload.filenames) && payload.filenames.length) {
    requestedOriginalByLower = new Map();
    requestedSet = new Set();
    for (const rawName of payload.filenames) {
      const original = String(rawName);
      const lower = original.toLowerCase();
      requestedOriginalByLower.set(lower, original);
      requestedSet.add(lower);
    }
  }

  const jpgExts = new Set(['jpg','jpeg']);
  const rawExts = new Set(['raw','cr2','nef','arw','dng','raf','orf','rw2']);

  const hasFilenameFilter = requestedSet != null;
  const hasIdFilter = requestedPhotoIds.size > 0;

  const addJobItemError = (itemId, message) => {
    if (!itemId) return;
    handledJobItemIds.add(itemId);
    jobsRepo.updateItemStatus(itemId, { status: 'failed', message });
  };

  const markJobItem = (itemId, status, message = null) => {
    if (!itemId) return;
    handledJobItemIds.add(itemId);
    jobsRepo.updateItemStatus(itemId, { status, message });
  };

  const markItem = (photo, status, message = null) => {
    const lower = String(photo.filename).toLowerCase();
    const itemId = itemIdByPhotoId.get(photo.id) ?? itemIdByFilename.get(lower) ?? photo.job_item_id ?? null;
    if (itemId) {
      markJobItem(itemId, status, message);
    }
  };

  const collectProjectPhotos = (project, { allowFallback = false } = {}) => {
    const photosById = new Map();

    const register = (photo, sourceItemId = null) => {
      if (!photo || photo.project_id !== project.id) {
        if (sourceItemId) addJobItemError(sourceItemId, 'Photo not found in target project');
        return;
      }
      const existing = photosById.get(photo.id);
      if (!existing) {
        photosById.set(photo.id, photo);
      }
    };

    // First prefer explicit photo IDs
    for (const photoId of requestedPhotoIds) {
      const photo = photosRepo.getById(photoId);
      const itemId = itemIdByPhotoId.get(photoId) ?? null;
      if (photo) {
        register(photo, itemId);
      } else if (itemId) {
        addJobItemError(itemId, 'Photo not found');
      }
    }

    // Next, resolve filenames scoped to this project
    if (requestedSet && requestedOriginalByLower) {
      for (const lowerName of requestedSet) {
        const originalName = requestedOriginalByLower.get(lowerName) || lowerName;
        const photo = photosRepo.getByProjectAndFilename(project.id, originalName);
        const itemId = itemIdByFilename.get(lowerName) ?? null;
        if (photo) {
          register(photo, itemId);
        } else if (itemId) {
          addJobItemError(itemId, 'Photo not found');
        }
      }
    }

    if (!photosById.size && allowFallback) {
      const page = photosRepo.listPaged({ project_id: project.id, limit: 100000 });
      for (const photo of page.items) {
        register(photo);
      }
    }

    return Array.from(photosById.values());
  };

  let projectGroups;
  if (job.scope === 'photo_set') {
    const grouped = await groupItemsByProject(jobItems);
    projectGroups = grouped
      .filter(entry => entry && entry.project)
      .map(entry => ({
        project: entry.project,
        photos: (entry.photos || []).map(photo => ({
          ...photo,
          job_item_id: photo.job_item_id ?? null,
        })),
      }));
  } else {
    const project = projectsRepo.getById(job.project_id);
    if (!project) throw new Error('Project not found for job');
    const photos = collectProjectPhotos(project, { allowFallback: true });
    projectGroups = [{ project, photos }];
  }

  for (const entry of projectGroups) {
    const { project } = entry;
    const projectPath = ensureProjectDirs(project.project_folder);
    const photos = Array.isArray(entry.photos) && entry.photos.length > 0
      ? entry.photos
      : collectProjectPhotos(project, { allowFallback: true });

    for (const p of photos) {
      if (hasFilenameFilter && !requestedSet?.has(String(p.filename).toLowerCase())) continue;
      if (hasIdFilter && !requestedPhotoIds.has(Number(p.id))) continue;

      let jpgChanged = false;
      let rawChanged = false;

      if (!p.keep_jpg && p.jpg_available) {
        const candidates = extVariants(p.filename, jpgExts);
        for (const c of candidates) {
          const full = path.join(projectPath, c);
          if (fs.existsSync(full)) {
            try { fs.moveSync(full, path.join(projectPath, '.trash', path.basename(full)), { overwrite: true }); } catch {}
          }
        }
        try { removeDerivatives(project.project_folder, p.filename); } catch {}
        jpgChanged = true;
      }

      if (!p.keep_raw && p.raw_available) {
        const candidates = extVariants(p.filename, rawExts);
        for (const c of candidates) {
          const full = path.join(projectPath, c);
          if (fs.existsSync(full)) {
            try { fs.moveSync(full, path.join(projectPath, '.trash', path.basename(full)), { overwrite: true }); } catch {}
          }
        }
        rawChanged = true;
      }

      const now = new Date().toISOString();

      if (!p.keep_jpg && !p.keep_raw) {
        try {
          photosRepo.removeById(p.id);
        } catch (err) {
          addJobItemError(itemIdByPhotoId.get(p.id) ?? null, err?.message || 'Failed to delete photo record');
          continue;
        }

        emitJobUpdate({
          type: 'item_removed',
          project_folder: project.project_folder,
          filename: p.filename,
          photo_id: p.id,
          updated_at: now,
        });

        markItem(p, 'completed');
        continue;
      }

      if (jpgChanged || rawChanged) {
        photosRepo.upsertPhoto(project.id, {
          manifest_id: p.manifest_id,
          filename: p.filename,
          basename: p.basename || p.filename,
          ext: p.ext,
          date_time_original: p.date_time_original,
          jpg_available: jpgChanged ? false : !!p.jpg_available,
          raw_available: rawChanged ? false : !!p.raw_available,
          other_available: !!p.other_available,
          keep_jpg: !!p.keep_jpg,
          keep_raw: !!p.keep_raw,
          thumbnail_status: jpgChanged ? 'missing' : (p.thumbnail_status || null),
          preview_status: jpgChanged ? 'missing' : (p.preview_status || null),
          orientation: p.orientation,
          meta_json: p.meta_json,
        });

        emitJobUpdate({
          type: 'item',
          project_folder: project.project_folder,
          filename: p.filename,
          thumbnail_status: jpgChanged ? 'missing' : (p.thumbnail_status || null),
          preview_status: jpgChanged ? 'missing' : (p.preview_status || null),
          updated_at: now,
          photo_id: p.id,
        });
      }

      markItem(p, 'completed');
    }
  }

  // Mark any job items that were not handled as failed to surface issues
  for (const item of jobItems) {
    if (!handledJobItemIds.has(item.id)) {
      jobsRepo.updateItemStatus(item.id, { status: 'failed', message: 'No matching photo processed' });
    }
  }
}

module.exports = { runFileRemoval };
