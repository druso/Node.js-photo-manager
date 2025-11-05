const path = require('path');
const fs = require('fs-extra');
const makeLogger = require('../../utils/logger2');
const log = makeLogger('folder-discovery');
const exifParser = require('exif-parser');

const projectsRepo = require('../repositories/projectsRepo');
const photosRepo = require('../repositories/photosRepo');
const jobsRepo = require('../repositories/jobsRepo');
const { readManifest, writeManifest } = require('../projectManifest');
const { ensureProjectDirs, PROJECTS_DIR, DEFAULT_USER, buildAcceptPredicate } = require('../fsUtils');
const { emitJobUpdate } = require('../events');

/**
 * Main folder discovery worker
 * Scans .projects directory and reconciles with database
 */
async function runFolderDiscovery(job) {
  log.info('folder_discovery_started', { job_id: job.id });
  
  try {
    // Ensure PROJECTS_DIR exists
    await fs.ensureDir(PROJECTS_DIR);
    
    // First, check for deleted folders and mark projects as canceled
    const allProjects = projectsRepo.list();
    let deleted = 0;
    
    for (const project of allProjects) {
      if (project.status === 'canceled') continue;
      
      const folderPath = path.join(PROJECTS_DIR, DEFAULT_USER, project.project_folder);
      if (!await fs.pathExists(folderPath)) {
        log.warn('folder_deleted_externally', {
          project_id: project.id,
          project_folder: project.project_folder,
          project_name: project.project_name
        });
        
        // Mark project as canceled (soft delete)
        projectsRepo.setStatus(project.id, 'canceled');
        deleted++;
        
        emitJobUpdate({
          type: 'project_folder_deleted',
          project_id: project.id,
          project_folder: project.project_folder,
          project_name: project.project_name
        });
      }
    }
    
    // Scan user folder for project folders
    const userDir = path.join(PROJECTS_DIR, DEFAULT_USER);
    await fs.ensureDir(userDir);
    
    const entries = await fs.readdir(userDir);
    let discovered = 0;
    let reconciled = 0;
    let created = 0;
    let merged = 0;
    
    for (const folderName of entries) {
      // Skip system folders, hidden folders, and db folder
      if (folderName.startsWith('.') || folderName === 'db') {
        continue;
      }
      
      const folderPath = path.join(userDir, folderName);
      
      // Check if folder still exists
      if (!await fs.pathExists(folderPath)) {
        continue;
      }
      
      const stat = await fs.stat(folderPath);
      
      if (!stat.isDirectory()) {
        continue;
      }
      
      discovered++;
      
      // Check if manifest exists
      const manifestPath = path.join(folderPath, '.project.yaml');
      const hasManifest = await fs.pathExists(manifestPath);
      
      if (hasManifest) {
        const result = await reconcileWithManifest(folderName, folderPath, job);
        if (result === 'reconciled') reconciled++;
        if (result === 'merged') merged++;
      } else {
        await createFromFolder(folderName, folderPath, null, job);
        created++;
      }
    }
    
    log.info('folder_discovery_complete', {
      job_id: job.id,
      discovered,
      reconciled,
      created,
      merged,
      deleted
    });
    
    return {
      discovered,
      reconciled,
      created,
      merged,
      deleted
    };
  } catch (err) {
    log.error('folder_discovery_failed', {
      job_id: job.id,
      error: err.message,
      stack: err.stack
    });
    throw err;
  }
}

/**
 * Reconcile a folder that has a manifest file
 */
async function reconcileWithManifest(folderName, folderPath, job) {
  try {
    // Read manifest
    const manifest = readManifest(folderName);
    
    if (!manifest) {
      log.warn('manifest_unreadable', { folder: folderName });
      
      // Check if project already exists by folder name
      const existingProject = projectsRepo.getByFolder(folderName);
      
      if (existingProject) {
        // Project exists but manifest is corrupted/missing - regenerate manifest
        log.info('regenerating_manifest_for_existing_project', {
          project_id: existingProject.id,
          project_folder: folderName,
          project_name: existingProject.project_name
        });
        
        writeManifest(folderName, {
          name: existingProject.project_name,
          id: existingProject.id,
          created_at: existingProject.created_at
        });
        
        return 'reconciled';
      }
      
      // No existing project - treat as folder without manifest
      await createFromFolder(folderName, folderPath, null, job);
      return 'created';
    }
    
    // Check if project exists in DB by ID
    let project = projectsRepo.getById(manifest.id);
    
    if (project) {
      // Project exists - check if folder matches
      if (project.project_folder !== folderName) {
        // Check if this is a pending rename completion
        if (project.pending_folder_rename && project.desired_folder === folderName) {
          // Discovery found the target folder - complete the pending rename
          log.info('pending_rename_completed_by_discovery', {
            project_id: project.id,
            old_folder: project.project_folder,
            new_folder: folderName,
            manifest_name: manifest.name
          });
          
          // Update folder and clear pending rename flag
          projectsRepo.updateFolder(project.id, folderName);
          projectsRepo.clearPendingRename(project.id);
          
          // Update manifest to remove pending_folder field
          writeManifest(folderName, {
            name: manifest.name || project.project_name,
            id: project.id,
            created_at: project.created_at
          });
          
          // Emit SSE event for UI update
          emitJobUpdate({
            type: 'folder_renamed',
            project_id: project.id,
            old_folder: project.project_folder,
            new_folder: folderName
          });
          
          return 'reconciled';
        }
        
        // Normal case: folder was renamed outside the app
        if (!project.pending_folder_rename) {
          log.warn('folder_renamed_externally', {
            project_id: project.id,
            old_folder: project.project_folder,
            new_folder: folderName,
            manifest_name: manifest.name
          });
          
          // Update DB to match filesystem (filesystem is master)
          projectsRepo.updateFolderAndName(
            project.id,
            folderName,
            manifest.name || folderName
          );
          
          log.info('project_reconciled', {
            project_id: project.id,
            folder: folderName
          });
        } else {
          // Pending rename but folder doesn't match desired_folder
          log.warn('folder_mismatch_with_pending_rename', {
            project_id: project.id,
            db_folder: project.project_folder,
            desired_folder: project.desired_folder,
            found_folder: folderName
          });
          
          // Update DB to match filesystem (filesystem is master)
          projectsRepo.updateFolderAndName(
            project.id,
            folderName,
            manifest.name || folderName
          );
          projectsRepo.clearPendingRename(project.id);
        }
      }
      
      return 'reconciled';
    } else {
      // Project doesn't exist by ID - check by name
      project = projectsRepo.getByName(manifest.name);
      
      if (project) {
        // Project with same name exists - check for shared images
        const sharedImages = await findSharedImages(project.id, folderPath);
        
        if (sharedImages.length > 0) {
          // MERGE: Projects share images
          log.info('merging_projects', {
            target_project_id: project.id,
            target_folder: project.project_folder,
            source_folder: folderName,
            shared_images: sharedImages.length
          });
          
          await mergeProjects(project.id, folderName, folderPath, job);
          return 'merged';
        } else {
          // SEPARATE: No shared images - create new project
          log.info('no_shared_images_creating_separate', {
            existing_project_id: project.id,
            existing_folder: project.project_folder,
            new_folder: folderName
          });
          
          await createFromFolder(folderName, folderPath, manifest, job);
          return 'created';
        }
      } else {
        // No conflict - create new project from manifest
        await createFromFolder(folderName, folderPath, manifest, job);
        return 'created';
      }
    }
  } catch (err) {
    log.error('reconcile_failed', {
      folder: folderName,
      error: err.message
    });
    throw err;
  }
}

/**
 * Create a new project from a discovered folder
 */
async function createFromFolder(folderName, folderPath, existingManifest, job) {
  try {
    // Determine project name
    const projectName = existingManifest?.name || folderName;
    
    // Create database record
    const project = projectsRepo.createProjectFromFolder({
      project_name: projectName,
      project_folder: folderName
    });
    
    log.info('project_created_from_folder', {
      project_id: project.id,
      project_folder: folderName,
      project_name: projectName
    });
    
    // Generate manifest if it doesn't exist
    if (!existingManifest) {
      writeManifest(folderName, {
        name: projectName,
        id: project.id,
        created_at: project.created_at
      });
    }
    
    // Discover and index photos in folder
    const photoCount = await discoverPhotosInFolder(project.id, folderPath);
    
    log.info('photos_discovered', {
      project_id: project.id,
      project_folder: folderName,
      photo_count: photoCount
    });
    
    // Check if thumbnails/previews need generation
    if (photoCount > 0) {
      const photos = photosRepo.listPaged({ project_id: project.id, limit: 10000 });
      const thumbDir = path.join(folderPath, '.thumb');
      const previewDir = path.join(folderPath, '.preview');
      
      // Check if derivative folders exist and have files
      const thumbExists = await fs.pathExists(thumbDir);
      const previewExists = await fs.pathExists(previewDir);
      
      let needsProcessing = false;
      
      if (!thumbExists || !previewExists) {
        // Folders don't exist - need processing
        needsProcessing = true;
        log.info('derivative_folders_missing', {
          project_id: project.id,
          thumb_exists: thumbExists,
          preview_exists: previewExists
        });
      } else {
        // Check if all photos have derivatives
        for (const photo of photos.items) {
          const thumbPath = path.join(thumbDir, `${photo.filename}.jpg`);
          const previewPath = path.join(previewDir, `${photo.filename}.jpg`);
          
          if (!await fs.pathExists(thumbPath) || !await fs.pathExists(previewPath)) {
            needsProcessing = true;
            break;
          }
        }
      }
      
      if (needsProcessing) {
        // Enqueue post-processing for derivative generation
        jobsRepo.enqueueWithItems({
          tenant_id: job.tenant_id,
          project_id: project.id,
          type: 'upload_postprocess',
          items: photos.items.map(p => ({ filename: p.filename })),
          priority: 90,
          payload: {
            source: 'folder_discovery',
            task_id: job.payload_json?.task_id,
            task_type: job.payload_json?.task_type
          }
        });
        
        log.info('postprocess_enqueued', {
          project_id: project.id,
          photo_count: photoCount,
          reason: 'missing_derivatives'
        });
      } else {
        log.info('derivatives_complete', {
          project_id: project.id,
          photo_count: photoCount
        });
      }
    }
    
    // Emit SSE event
    emitJobUpdate({
      type: 'project_discovered',
      project_id: project.id,
      project_folder: folderName,
      project_name: projectName,
      photo_count: photoCount
    });
    
    return project;
  } catch (err) {
    log.error('create_from_folder_failed', {
      folder: folderName,
      error: err.message
    });
    throw err;
  }
}

/**
 * Extract EXIF metadata from an image file
 * Prefers DateTimeOriginal, falls back to CreateDate, then ModifyDate
 */
async function extractMetadata(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    const parser = exifParser.create(buffer);
    const result = parser.parse();
    
    if (result && result.tags) {
      // Prefer DateTimeOriginal (when photo was taken), fall back to CreateDate, then ModifyDate
      const captureTimestamp = result.tags.DateTimeOriginal || result.tags.CreateDate || result.tags.ModifyDate || null;
      
      const metadata = {
        date_time_original: captureTimestamp,
        create_date: result.tags.CreateDate || null,
        modify_date: result.tags.ModifyDate || null,
        orientation: result.tags.Orientation || null,
        camera_make: result.tags.Make || null,
        make: result.tags.Make || null,
        model: result.tags.Model || null,
        exif_image_width: result.tags.ExifImageWidth || null,
        exif_image_height: result.tags.ExifImageHeight || null
      };
      
      // Remove null values
      Object.keys(metadata).forEach(k => metadata[k] === null && delete metadata[k]);
      
      return {
        date_time_original: captureTimestamp ? new Date(captureTimestamp * 1000).toISOString() : null,
        orientation: metadata.orientation || null,
        meta_json: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null
      };
    }
  } catch (err) {
    log.warn('metadata_extraction_failed', {
      file: path.basename(filePath),
      error: err.message
    });
  }
  
  return {
    date_time_original: null,
    orientation: null,
    meta_json: null
  };
}

/**
 * Discover photos in a folder and create database records with metadata
 */
async function discoverPhotosInFolder(projectId, folderPath) {
  const { isAccepted } = buildAcceptPredicate();
  const entries = await fs.readdir(folderPath);
  const skip = new Set(['.thumb', '.preview', '.trash', '.project.yaml']);
  
  const discoveredBases = new Map(); // base -> { jpg, raw, other, files: [] }
  
  for (const entry of entries) {
    if (skip.has(entry)) continue;
    
    const fullPath = path.join(folderPath, entry);
    const stat = await fs.stat(fullPath);
    
    if (!stat.isFile()) continue;
    
    const ext = path.extname(entry).toLowerCase().replace(/^\./, '');
    const base = path.parse(entry).name;
    
    if (isAccepted(entry, '')) {
      const rec = discoveredBases.get(base) || { jpg: false, raw: false, other: false, files: [] };
      
      // Categorize by extension
      const jpgExts = new Set(['jpg', 'jpeg']);
      const rawExts = new Set(['raw', 'cr2', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2']);
      
      if (jpgExts.has(ext)) {
        rec.jpg = true;
        rec.files.push({ path: fullPath, type: 'jpg', ext });
      } else if (rawExts.has(ext)) {
        rec.raw = true;
        rec.files.push({ path: fullPath, type: 'raw', ext });
      } else {
        rec.other = true;
        rec.files.push({ path: fullPath, type: 'other', ext });
      }
      
      discoveredBases.set(base, rec);
    }
  }
  
  // Create photo records with metadata extraction
  for (const [base, availability] of discoveredBases.entries()) {
    // Extract metadata from JPG if available, otherwise try other files
    let metadata = { date_time_original: null, orientation: null, meta_json: null };
    
    // Prefer JPG for metadata extraction
    const jpgFile = availability.files.find(f => f.type === 'jpg');
    if (jpgFile) {
      metadata = await extractMetadata(jpgFile.path);
    } else {
      // Try other supported formats (not RAW)
      const otherFile = availability.files.find(f => f.type === 'other');
      if (otherFile) {
        metadata = await extractMetadata(otherFile.path);
      }
    }
    
    // Check if derivatives already exist
    const thumbPath = path.join(folderPath, '.thumb', `${base}.jpg`);
    const previewPath = path.join(folderPath, '.preview', `${base}.jpg`);
    const hasThumbnail = await fs.pathExists(thumbPath);
    const hasPreview = await fs.pathExists(previewPath);
    
    // Get the first file's extension for the record
    const firstFile = availability.files[0];
    
    photosRepo.upsertPhoto(projectId, {
      filename: base,
      basename: base,
      ext: firstFile ? firstFile.ext : null,
      date_time_original: metadata.date_time_original,
      jpg_available: !!availability.jpg,
      raw_available: !!availability.raw,
      other_available: !!availability.other,
      keep_jpg: !!availability.jpg,
      keep_raw: !!availability.raw,
      thumbnail_status: hasThumbnail ? 'generated' : null,
      preview_status: hasPreview ? 'generated' : null,
      orientation: metadata.orientation,
      meta_json: metadata.meta_json
    });
  }
  
  return discoveredBases.size;
}

/**
 * Find images shared between an existing project and a folder
 */
async function findSharedImages(projectId, folderPath) {
  // Get all photos in the existing project
  const existingPhotos = photosRepo.listPaged({
    project_id: projectId,
    limit: 100000
  });
  
  const existingFilenames = new Set(
    existingPhotos.items.map(p => p.filename.toLowerCase())
  );
  
  // Scan folder for image files
  const { isAccepted } = buildAcceptPredicate();
  const entries = await fs.readdir(folderPath);
  const skip = new Set(['.thumb', '.preview', '.trash', '.project.yaml']);
  const sharedImages = [];
  
  for (const entry of entries) {
    if (skip.has(entry)) continue;
    
    const fullPath = path.join(folderPath, entry);
    const stat = await fs.stat(fullPath);
    
    if (!stat.isFile()) continue;
    
    if (isAccepted(entry, '')) {
      const basename = path.parse(entry).name;
      if (existingFilenames.has(basename.toLowerCase())) {
        sharedImages.push(basename);
      }
    }
  }
  
  return sharedImages;
}

/**
 * Merge a source folder into an existing target project
 */
async function mergeProjects(targetProjectId, sourceFolderName, sourceFolderPath, job) {
  const targetProject = projectsRepo.getById(targetProjectId);
  const targetPath = ensureProjectDirs(targetProject.project_folder);
  
  log.info('merging_projects_started', {
    target_project_id: targetProjectId,
    target_folder: targetProject.project_folder,
    source_folder: sourceFolderName
  });
  
  // Discover all photos in source folder
  const { isAccepted } = buildAcceptPredicate();
  const entries = await fs.readdir(sourceFolderPath);
  const skip = new Set(['.thumb', '.preview', '.trash', '.project.yaml']);
  const movedFiles = [];
  const skippedFiles = [];
  
  for (const entry of entries) {
    if (skip.has(entry)) continue;
    
    const sourcePath = path.join(sourceFolderPath, entry);
    const stat = await fs.stat(sourcePath);
    
    if (!stat.isFile()) continue;
    
    if (isAccepted(entry, '')) {
      const targetFilePath = path.join(targetPath, entry);
      
      // Check if file already exists in target
      if (await fs.pathExists(targetFilePath)) {
        skippedFiles.push(entry);
        log.warn('merge_skip_duplicate', {
          source_folder: sourceFolderName,
          target_folder: targetProject.project_folder,
          filename: entry
        });
      } else {
        // Move file to target project
        await fs.move(sourcePath, targetFilePath);
        movedFiles.push(entry);
      }
    }
  }
  
  // Update database records for moved files with metadata extraction
  for (const filename of movedFiles) {
    const basename = path.parse(filename).name;
    const ext = path.extname(filename).toLowerCase().replace(/^\./, '');
    
    // Determine file type
    const jpgExts = new Set(['jpg', 'jpeg']);
    const rawExts = new Set(['raw', 'cr2', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2']);
    
    const isJpg = jpgExts.has(ext);
    const isRaw = rawExts.has(ext);
    
    // Extract metadata from the file (now in target location)
    const targetFilePath = path.join(targetPath, filename);
    let metadata = { date_time_original: null, orientation: null, meta_json: null };
    
    if (isJpg || (!isJpg && !isRaw)) {
      // Extract metadata from JPG or other supported formats
      metadata = await extractMetadata(targetFilePath);
    }
    
    // Check if derivatives already exist in target folder
    const thumbPath = path.join(targetPath, '.thumb', `${basename}.jpg`);
    const previewPath = path.join(targetPath, '.preview', `${basename}.jpg`);
    const hasThumbnail = await fs.pathExists(thumbPath);
    const hasPreview = await fs.pathExists(previewPath);
    
    // Create or update photo record in target project
    photosRepo.upsertPhoto(targetProjectId, {
      filename: basename,
      basename: basename,
      ext: ext,
      date_time_original: metadata.date_time_original,
      jpg_available: isJpg,
      raw_available: isRaw,
      other_available: !isJpg && !isRaw,
      keep_jpg: isJpg,
      keep_raw: isRaw,
      thumbnail_status: hasThumbnail ? 'generated' : null,
      preview_status: hasPreview ? 'generated' : null,
      orientation: metadata.orientation,
      meta_json: metadata.meta_json
    });
  }
  
  // Remove source folder (after successful merge)
  try {
    await fs.remove(sourceFolderPath);
    log.info('source_folder_removed', {
      source_folder: sourceFolderName
    });
  } catch (err) {
    log.warn('source_folder_removal_failed', {
      source_folder: sourceFolderName,
      error: err.message
    });
  }
  
  // Enqueue reconciliation jobs for target project
  jobsRepo.enqueue({
    tenant_id: job.tenant_id,
    project_id: targetProjectId,
    type: 'manifest_check',
    priority: 95,
    payload: {
      source: 'merge',
      task_id: job.payload_json?.task_id,
      task_type: job.payload_json?.task_type
    }
  });
  
  // Enqueue post-processing for moved files
  if (movedFiles.length > 0) {
    jobsRepo.enqueueWithItems({
      tenant_id: job.tenant_id,
      project_id: targetProjectId,
      type: 'upload_postprocess',
      items: movedFiles.map(f => ({ filename: path.parse(f).name })),
      priority: 90,
      payload: {
        source: 'merge',
        task_id: job.payload_json?.task_id,
        task_type: job.payload_json?.task_type
      }
    });
  }
  
  log.info('merge_complete', {
    target_project_id: targetProjectId,
    source_folder: sourceFolderName,
    moved_files: movedFiles.length,
    skipped_files: skippedFiles.length
  });
  
  // Emit SSE event
  emitJobUpdate({
    type: 'projects_merged',
    target_project_id: targetProjectId,
    target_folder: targetProject.project_folder,
    source_folder: sourceFolderName,
    moved_files: movedFiles.length,
    skipped_files: skippedFiles.length
  });
}

module.exports = {
  runFolderDiscovery
};
