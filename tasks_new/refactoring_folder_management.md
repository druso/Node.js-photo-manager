# Folder Management Refactoring Plan

**Date**: 2025-10-09  
**Status**: Draft  
**Priority**: High - Architectural Change

---

## Executive Summary

This refactoring shifts the project folder naming strategy from ID-based (`p2`, `p3`) to **human-readable name-based** folders (`family memories`, `wedding 2024`). The filesystem becomes the **master source of truth**, with YAML manifests in each folder providing reconciliation metadata. This enables:

1. **User-friendly folder names** that match project names
2. **Automatic project discovery** from filesystem
3. **Intelligent project reconciliation** via manifest files
4. **Automatic folder renaming** when projects are renamed
5. **Conflict resolution** through duplicate detection and merging

---

## Core Design Principles

### 1. Filesystem as Master
- **Folder existence** determines project existence
- **Folder name** determines project name (unless overridden by manifest)
- Database is a **secondary index** for fast queries
- Reconciliation jobs sync DB ← Filesystem
- **No backward compatibility**: Old `p<id>` folders will be discovered and indexed as new projects

### 2. Manifest File Structure
Each project folder will contain a `.project.yaml` file:

```yaml
# .project.yaml
name: "Family Memories"
id: 42  # Database ID (for reconciliation)
created_at: "2025-10-09T10:00:00Z"
# Future extensions:
# description: "Summer vacation photos"
# tags: ["vacation", "family"]
# cover_photo: "IMG_1234"
```

**Format**: YAML for human readability and ease of manual editing

### 3. Folder Naming Rules
- **Base name**: Use project name directly (e.g., `Family Memories`)
- **Duplicate handling**: Append `(n)` suffix recursively
  - `Family Memories` → `Family Memories (2)` → `Family Memories (3)`
- **Character sanitization**: Replace filesystem-unsafe characters
  - `/` → `-`, `\` → `-`, `:` → `-`, `*` → `_`, `?` → `_`, `"` → `'`, `<>|` → `_`
- **Length limits**: Truncate to 255 characters (filesystem limit)
- **Case sensitivity**: Treat as case-insensitive on all platforms
- **No nested folders**: Only top-level folders in `.projects/` are scanned

### 4. Reconciliation Behavior
- **Discovery frequency**: Automatic scan every 5 minutes via scheduler
- **Manual trigger**: API endpoint available for on-demand scanning
- **Merge strategy**: Automatic merge when shared images detected (no user confirmation)
- **Conflict resolution**: Folder name always wins over manifest name if no DB match found

---

## Implementation Plan

### Phase 1: Foundation (Manifest & Naming)

#### 1.1 Create Manifest Management Module
**File**: `server/services/projectManifest.js`

```javascript
// Core functions:
- readManifest(projectFolder)      // Parse .project.yaml
- writeManifest(projectFolder, data) // Write .project.yaml
- validateManifest(data)           // Schema validation
- generateManifest(projectName, projectId) // Create new manifest
```

**Dependencies**: Install `js-yaml` for YAML parsing

#### 1.2 Update Folder Naming Utilities
**File**: `server/utils/projects.js`

```javascript
// Replace makeProjectFolderName(name, id) with:
- sanitizeFolderName(name)         // Clean unsafe characters
- generateUniqueFolderName(name)   // Handle (n) suffixes
- findNextAvailableName(baseName)  // Check filesystem for conflicts
```

#### 1.3 Update Database Schema
**Migration**: Add `manifest_version` column to `projects` table

```sql
ALTER TABLE projects ADD COLUMN manifest_version TEXT DEFAULT '1.0';
```

---

### Phase 2: Project Creation & Renaming

#### 2.1 Modify Project Creation Flow
**File**: `server/services/repositories/projectsRepo.js`

**Current behavior**:
```javascript
createProject({ project_name }) {
  // Creates folder as p<id>
  const folder = makeProjectFolderName(project_name, id); // Returns "p42"
}
```

**New behavior**:
```javascript
createProject({ project_name }) {
  // 1. Generate unique folder name from project_name
  const folderName = generateUniqueFolderName(project_name);
  
  // 2. Create database record with folder name
  const project = insertProject({ project_name, project_folder: folderName });
  
  // 3. Create filesystem folder
  ensureProjectDirs(folderName);
  
  // 4. Write manifest file
  writeManifest(folderName, {
    name: project_name,
    id: project.id,
    created_at: project.created_at
  });
  
  return project;
}
```

#### 2.2 Implement Project Renaming
**File**: `server/routes/projects.js`

**New endpoint**: `PATCH /api/projects/:folder/rename`

```javascript
async function renameProject(req, res) {
  const { folder } = req.params;
  const { new_name } = req.body;
  
  // 1. Get current project
  const project = projectsRepo.getByFolder(folder);
  
  // 2. Generate new unique folder name
  const newFolder = generateUniqueFolderName(new_name);
  
  // 3. Rename filesystem folder
  fs.renameSync(
    path.join(PROJECTS_DIR, folder),
    path.join(PROJECTS_DIR, newFolder)
  );
  
  // 4. Update manifest
  writeManifest(newFolder, {
    name: new_name,
    id: project.id,
    created_at: project.created_at
  });
  
  // 5. Update database
  projectsRepo.updateFolderAndName(project.id, newFolder, new_name);
  
  // 6. Emit SSE event for UI update
  emitJobUpdate({ 
    type: 'project_renamed', 
    old_folder: folder, 
    new_folder: newFolder,
    new_name 
  });
  
  return res.json({ project: projectsRepo.getById(project.id) });
}
```

**Database update**:
```javascript
// Add to projectsRepo.js
function updateFolderAndName(id, project_folder, project_name) {
  const db = getDb();
  const ts = nowISO();
  db.prepare(`
    UPDATE projects 
    SET project_folder = ?, project_name = ?, updated_at = ? 
    WHERE id = ?
  `).run(project_folder, project_name, ts, id);
  return getById(id);
}
```

---

### Phase 3: Folder Discovery & Reconciliation

#### 3.1 Create Folder Discovery Job
**File**: `server/services/workers/folderDiscoveryWorker.js`

**Job type**: `folder_discovery` (priority: 95)

**Algorithm**:
```javascript
async function runFolderDiscovery(job) {
  // 1. Scan .projects directory for all folders
  const folders = await fs.readdir(PROJECTS_DIR);
  
  for (const folderName of folders) {
    // Skip system folders
    if (folderName.startsWith('.')) continue;
    
    const folderPath = path.join(PROJECTS_DIR, folderName);
    const stat = await fs.stat(folderPath);
    if (!stat.isDirectory()) continue;
    
    // 2. Check if manifest exists
    const manifestPath = path.join(folderPath, '.project.yaml');
    const hasManifest = await fs.pathExists(manifestPath);
    
    if (hasManifest) {
      await reconcileWithManifest(folderName, folderPath);
    } else {
      await createFromFolder(folderName, folderPath);
    }
  }
}
```

#### 3.2 Implement Manifest Reconciliation
**Function**: `reconcileWithManifest(folderName, folderPath)`

```javascript
async function reconcileWithManifest(folderName, folderPath) {
  // 1. Read manifest
  const manifest = await readManifest(folderName);
  
  // 2. Check if project exists in DB by ID
  let project = projectsRepo.getById(manifest.id);
  
  if (project) {
    // 3a. Project exists - check for conflicts
    if (project.project_folder !== folderName) {
      // Folder was renamed outside the app
      log.warn('folder_renamed_externally', {
        project_id: project.id,
        old_folder: project.project_folder,
        new_folder: folderName
      });
      
      // Update DB to match filesystem
      projectsRepo.updateFolderAndName(
        project.id, 
        folderName, 
        manifest.name || folderName
      );
    }
  } else {
    // 3b. Project doesn't exist - check by name
    project = projectsRepo.getByName(manifest.name);
    
    if (project) {
      // Project with same name exists - check for shared images
      const sharedImages = await findSharedImages(project.id, folderPath);
      
      if (sharedImages.length > 0) {
        // MERGE: Projects share images
        await mergeProjects(project.id, folderName, folderPath);
      } else {
        // SEPARATE: No shared images - create new project
        await createFromFolder(folderName, folderPath, manifest);
      }
    } else {
      // No conflict - create new project from manifest
      await createFromFolder(folderName, folderPath, manifest);
    }
  }
}
```

#### 3.3 Implement Folder-Only Creation
**Function**: `createFromFolder(folderName, folderPath, existingManifest?)`

```javascript
async function createFromFolder(folderName, folderPath, existingManifest = null) {
  // 1. Determine project name
  const projectName = existingManifest?.name || folderName;
  
  // 2. Create database record
  const project = projectsRepo.createProjectFromFolder({
    project_name: projectName,
    project_folder: folderName
  });
  
  // 3. Generate manifest if it doesn't exist
  if (!existingManifest) {
    await writeManifest(folderName, {
      name: projectName,
      id: project.id,
      created_at: project.created_at
    });
  }
  
  // 4. Discover and index photos
  await discoverPhotosInFolder(project.id, folderPath);
  
  // 5. Enqueue post-processing
  const photos = photosRepo.listPaged({ project_id: project.id, limit: 10000 });
  if (photos.items.length > 0) {
    jobsRepo.enqueueWithItems({
      tenant_id: job.tenant_id,
      project_id: project.id,
      type: 'upload_postprocess',
      items: photos.items.map(p => ({ filename: p.filename })),
      priority: 90
    });
  }
  
  log.info('project_discovered', {
    project_id: project.id,
    project_folder: folderName,
    project_name: projectName,
    photo_count: photos.items.length
  });
}
```

#### 3.4 Implement Shared Image Detection
**Function**: `findSharedImages(projectId, folderPath)`

```javascript
async function findSharedImages(projectId, folderPath) {
  // 1. Get all photos in the existing project
  const existingPhotos = photosRepo.listPaged({ 
    project_id: projectId, 
    limit: 100000 
  });
  const existingFilenames = new Set(
    existingPhotos.items.map(p => p.filename.toLowerCase())
  );
  
  // 2. Scan folder for image files
  const { isAccepted } = buildAcceptPredicate();
  const entries = await fs.readdir(folderPath);
  const sharedImages = [];
  
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    
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
```

#### 3.5 Implement Project Merging
**Function**: `mergeProjects(targetProjectId, sourceFolderName, sourceFolderPath)`

```javascript
async function mergeProjects(targetProjectId, sourceFolderName, sourceFolderPath) {
  const targetProject = projectsRepo.getById(targetProjectId);
  const targetPath = ensureProjectDirs(targetProject.project_folder);
  
  log.info('merging_projects', {
    target_project_id: targetProjectId,
    target_folder: targetProject.project_folder,
    source_folder: sourceFolderName
  });
  
  // 1. Discover all photos in source folder
  const { isAccepted } = buildAcceptPredicate();
  const entries = await fs.readdir(sourceFolderPath);
  const movedFiles = [];
  const skippedFiles = [];
  
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    
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
  
  // 2. Update database records for moved files
  for (const filename of movedFiles) {
    const basename = path.parse(filename).name;
    
    // Create or update photo record in target project
    photosRepo.upsertPhoto(targetProjectId, {
      filename: basename,
      basename: basename,
      ext: path.extname(filename).toLowerCase().replace(/^\./, ''),
      date_time_original: null,
      jpg_available: true, // Will be corrected by manifest_check
      raw_available: false,
      other_available: false,
      keep_jpg: true,
      keep_raw: false,
      thumbnail_status: null,
      preview_status: null,
      orientation: null,
      meta_json: null
    });
  }
  
  // 3. Remove source folder (after successful merge)
  await fs.remove(sourceFolderPath);
  
  // 4. Enqueue reconciliation jobs for target project
  jobsRepo.enqueue({
    tenant_id: 1,
    project_id: targetProjectId,
    type: 'manifest_check',
    priority: 95
  });
  
  jobsRepo.enqueueWithItems({
    tenant_id: 1,
    project_id: targetProjectId,
    type: 'upload_postprocess',
    items: movedFiles.map(f => ({ filename: path.parse(f).name })),
    priority: 90
  });
  
  log.info('merge_complete', {
    target_project_id: targetProjectId,
    source_folder: sourceFolderName,
    moved_files: movedFiles.length,
    skipped_files: skippedFiles.length
  });
}
```

---

### Phase 4: Update Existing Jobs

#### 4.1 Update `manifest_check`
**File**: `server/services/workers/maintenanceWorker.js`

**Add manifest validation**:
```javascript
async function runManifestCheck(job) {
  const project = projectsRepo.getById(job.project_id);
  if (!project) throw new Error('Project not found');
  
  const projectPath = ensureProjectDirs(project.project_folder);
  
  // NEW: Verify manifest exists and is valid
  const manifestPath = path.join(projectPath, '.project.yaml');
  if (!fs.existsSync(manifestPath)) {
    log.warn('manifest_missing', { 
      project_id: project.id, 
      project_folder: project.project_folder 
    });
    
    // Regenerate manifest
    await writeManifest(project.project_folder, {
      name: project.project_name,
      id: project.id,
      created_at: project.created_at
    });
  } else {
    // Validate manifest matches DB
    const manifest = await readManifest(project.project_folder);
    if (manifest.id !== project.id) {
      log.warn('manifest_id_mismatch', {
        project_id: project.id,
        manifest_id: manifest.id,
        project_folder: project.project_folder
      });
      // Regenerate with correct ID
      await writeManifest(project.project_folder, {
        name: project.project_name,
        id: project.id,
        created_at: project.created_at
      });
    }
  }
  
  // Continue with existing photo availability checks...
  const { jpg, raw, other } = splitExtSets();
  // ... rest of existing logic
}
```

#### 4.2 Update `folder_check`
**File**: `server/services/workers/maintenanceWorker.js`

**Add to beginning of function**:
```javascript
async function runFolderCheck(job) {
  const project = projectsRepo.getById(job.project_id);
  if (!project) throw new Error('Project not found');
  
  const projectPath = ensureProjectDirs(project.project_folder);
  
  // NEW: Ensure manifest exists
  const manifestPath = path.join(projectPath, '.project.yaml');
  if (!fs.existsSync(manifestPath)) {
    await writeManifest(project.project_folder, {
      name: project.project_name,
      id: project.id,
      created_at: project.created_at
    });
  }
  
  // Continue with existing folder scanning logic...
  const { isAccepted, acceptedExtensions } = buildAcceptPredicate();
  // ... rest of existing logic
}
```

---

### Phase 5: Scheduler & API Integration

#### 5.1 Add Folder Discovery Task
**File**: `server/services/task_definitions.json`

```json
{
  "folder_discovery": {
    "label": "Folder Discovery",
    "user_relevant": false,
    "scope": "global",
    "steps": [
      { "type": "folder_discovery", "priority": 95 },
      { "type": "manifest_check", "priority": 95 },
      { "type": "folder_check", "priority": 95 }
    ]
  }
}
```

#### 5.2 Update Scheduler
**File**: `server/services/scheduler.js`

**Add periodic folder discovery**:
```javascript
// Run folder discovery every 5 minutes
setInterval(async () => {
  try {
    const job = jobsRepo.enqueue({
      tenant_id: 1,
      project_id: null,
      type: 'folder_discovery',
      priority: 95,
      payload: { source: 'scheduler' }
    });
    log.info('scheduled_folder_discovery', { job_id: job.id });
  } catch (err) {
    log.error('folder_discovery_schedule_failed', { error: err.message });
  }
}, 5 * 60 * 1000);
```

#### 5.3 Add Manual Trigger Endpoint
**File**: `server/routes/maintenance.js`

**Add API endpoint for manual folder discovery**:
```javascript
router.post('/discover-folders', authenticateAdmin, async (req, res) => {
  try {
    const job = jobsRepo.enqueue({
      tenant_id: 1,
      project_id: null,
      type: 'folder_discovery',
      priority: 95,
      payload: { source: 'manual', triggered_by: req.user?.id }
    });
    
    log.info('manual_folder_discovery_triggered', { 
      job_id: job.id,
      triggered_by: req.user?.id 
    });
    
    res.json({ 
      success: true, 
      job_id: job.id,
      message: 'Folder discovery job enqueued' 
    });
  } catch (err) {
    log.error('manual_folder_discovery_failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});
```

---

### Phase 6: Legacy Folder Handling

#### 6.1 No Active Migration Required
**Strategy**: Old `p<id>` folders are treated as new discoveries

**Behavior**:
- Old folders without manifests will be discovered by `folder_discovery` job
- They will be indexed as new projects with folder name as project name (e.g., "p42")
- Users can manually rename these projects via the UI, which will trigger folder rename
- No data loss - all photos will be indexed and processed normally

#### 6.2 Optional: Bulk Rename Utility (For Admin Convenience)
**File**: `server/routes/maintenance.js`

**Add optional endpoint to rename old-style folders**:
```javascript
router.post('/rename-legacy-folders', authenticateAdmin, async (req, res) => {
  try {
    const projects = projectsRepo.list();
    const renamed = [];
    
    for (const project of projects) {
      // Only process old p<id> format folders
      if (project.project_folder.match(/^p\d+$/)) {
        const newFolder = generateUniqueFolderName(project.project_name);
        
        const oldPath = path.join(PROJECTS_DIR, project.project_folder);
        const newPath = path.join(PROJECTS_DIR, newFolder);
        
        if (fs.existsSync(oldPath)) {
          await fs.rename(oldPath, newPath);
          
          await writeManifest(newFolder, {
            name: project.project_name,
            id: project.id,
            created_at: project.created_at
          });
          
          projectsRepo.updateFolderAndName(
            project.id, 
            newFolder, 
            project.project_name
          );
          
          renamed.push({
            id: project.id,
            old_folder: project.project_folder,
            new_folder: newFolder
          });
          
          log.info('legacy_folder_renamed', {
            project_id: project.id,
            old_folder: project.project_folder,
            new_folder: newFolder
          });
        }
      }
    }
    
    res.json({ 
      success: true, 
      renamed_count: renamed.length,
      renamed_projects: renamed 
    });
  } catch (err) {
    log.error('legacy_rename_failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});
```

**Note**: This endpoint is optional and only for convenience. The system will work fine without running it.

---

## Testing Strategy

### Unit Tests
1. **Folder naming utilities**
   - Test sanitization of unsafe characters
   - Test duplicate name resolution `(n)` suffix
   - Test edge cases (empty names, very long names, unicode)

2. **Manifest operations**
   - Test YAML read/write
   - Test validation
   - Test corruption handling

3. **Reconciliation logic**
   - Test shared image detection
   - Test merge scenarios
   - Test conflict resolution

### Integration Tests
1. **Project creation**
   - Create project with various names
   - Verify folder and manifest created
   - Verify database consistency

2. **Project renaming**
   - Rename project
   - Verify folder renamed
   - Verify manifest updated
   - Verify database updated

3. **Folder discovery**
   - Create folder manually
   - Run discovery job
   - Verify project created in DB
   - Verify manifest generated

4. **Project merging**
   - Create two folders with shared images
   - Run discovery
   - Verify merge occurred
   - Verify no data loss

### End-to-End Tests
1. **Full workflow**
   - Create project via UI
   - Rename project via UI
   - Manually add folder to filesystem
   - Verify auto-discovery
   - Verify UI updates

---

## Rollout Plan

### Stage 1: Foundation (Week 1-2)
- [ ] Install `js-yaml` dependency
- [ ] Implement manifest management module (`server/services/projectManifest.js`)
- [ ] Update folder naming utilities (`server/utils/projects.js`)
- [ ] Add `manifest_version` column to `projects` table
- [ ] Add `project_folder` index to database
- [ ] Update project creation flow in `projectsRepo.js`
- [ ] Implement project renaming endpoint (`PATCH /api/projects/:folder/rename`)
- [ ] Add `updateFolderAndName()` to `projectsRepo.js`

### Stage 2: Discovery & Reconciliation (Week 3-4)
- [ ] Create `folderDiscoveryWorker.js` with `runFolderDiscovery()`
- [ ] Implement `reconcileWithManifest()` function
- [ ] Implement `createFromFolder()` function
- [ ] Implement `findSharedImages()` function
- [ ] Implement `mergeProjects()` function
- [ ] Implement `discoverPhotosInFolder()` helper
- [ ] Add `folder_discovery` task to `task_definitions.json`
- [ ] Register worker in `workerLoop.js`

### Stage 3: Maintenance Job Updates (Week 5)
- [ ] Update `runManifestCheck()` to validate/regenerate manifests
- [ ] Update `runFolderCheck()` to ensure manifests exist
- [ ] Add manifest validation to both jobs
- [ ] Test updated jobs with new folder structure

### Stage 4: Scheduler & API (Week 6)
- [ ] Add folder discovery to scheduler (5-minute interval)
- [ ] Add `POST /api/maintenance/discover-folders` endpoint
- [ ] Add optional `POST /api/maintenance/rename-legacy-folders` endpoint
- [ ] Test scheduler integration
- [ ] Test manual trigger endpoint

### Stage 5: Testing (Week 7)
- [ ] Unit tests for folder naming utilities
- [ ] Unit tests for manifest operations
- [ ] Integration tests for project creation/renaming
- [ ] Integration tests for folder discovery
- [ ] Integration tests for project merging
- [ ] End-to-end tests for full workflow
- [ ] Performance testing with 100+ projects
- [ ] Unicode and special character testing

### Stage 6: Documentation & Deployment (Week 8)
- [ ] Update PROJECT_OVERVIEW.md
- [ ] Update SCHEMA_DOCUMENTATION.md
- [ ] Update JOBS_OVERVIEW.md
- [ ] Update README.md
- [ ] Update SECURITY.md
- [ ] Deploy to production
- [ ] Monitor discovery job logs
- [ ] Verify all existing projects continue working

---

## Risks & Mitigations

### Risk 1: Folder Name Conflicts
**Mitigation**: 
- Robust `(n)` suffix algorithm with recursive checking
- Case-insensitive conflict detection across all platforms
- Extensive testing of edge cases (unicode, special chars, long names)
- Automatic resolution without user intervention

### Risk 2: Performance Impact
**Mitigation**:
- Discovery job runs every 5 minutes (not continuously)
- Skip system folders (`.thumb`, `.preview`, `.trash`)
- Optimize shared image detection with Set-based lookups
- Limit batch sizes in photo processing jobs
- Add database indexes on `project_folder` column

### Risk 3: Manifest Corruption
**Mitigation**:
- YAML validation before every write operation
- Automatic regeneration from DB if manifest is missing or invalid
- Log all manifest operations for audit trail
- Graceful fallback to folder name if manifest unreadable

### Risk 4: Concurrent Modifications
**Mitigation**:
- Database transactions for all folder/name updates
- SSE events to sync UI immediately after changes
- Retry logic for failed filesystem operations
- Atomic folder rename operations

### Risk 5: Merge Conflicts
**Mitigation**:
- Skip duplicate files during merge (don't overwrite)
- Log all skipped files for manual review
- Automatic cleanup of source folder only after successful merge
- Enqueue reconciliation jobs after merge to verify integrity

---

## Documentation Updates

### Files to Update
1. **PROJECT_OVERVIEW.md**
   - Update "Projects" section with new folder naming
   - Document manifest file structure
   - Explain discovery and reconciliation process

2. **SCHEMA_DOCUMENTATION.md**
   - Update `projects` table documentation
   - Add manifest file schema
   - Document folder naming rules

3. **JOBS_OVERVIEW.md**
   - Add `folder_discovery` job documentation
   - Update `manifest_check` behavior
   - Update `folder_check` behavior

4. **README.md**
   - Update project folder structure
   - Add migration instructions
   - Document manual folder creation workflow

5. **SECURITY.md**
   - Add security considerations for manifest files
   - Document folder name sanitization
   - Add notes on filesystem access patterns

---

## Future Enhancements

### Phase 7: Extended Manifest (Future)
- Add `description` field
- Add `tags` array
- Add `cover_photo` field
- Add `settings` object (sort preferences, view mode, etc.)

### Phase 8: UI Improvements (Future)
- Drag-and-drop folder import
- Bulk project merge UI
- Conflict resolution wizard
- Folder rename preview

### Phase 9: Advanced Features (Future)
- Project templates
- Folder watching (inotify/fswatch)
- Symbolic link support
- Network folder support

---

## Success Criteria

- ✅ New projects created with human-readable folder names
- ✅ Project renaming updates folders automatically
- ✅ Manual folder creation auto-discovered within 5 minutes
- ✅ Manifest files generated for all new projects
- ✅ Old `p<id>` folders discovered and indexed as projects
- ✅ Project merging works correctly when shared images detected
- ✅ Duplicate folder names handled with `(n)` suffix
- ✅ All existing functionality preserved
- ✅ Manual trigger endpoint works (`POST /api/maintenance/discover-folders`)
- ✅ All tests passing (unit, integration, e2e)
- ✅ Documentation updated (5 files)
- ✅ No performance degradation with 100+ projects

---

## Implementation Notes

### Key Technical Decisions
1. **No backward compatibility layer**: Old folders are simply rediscovered as new projects
2. **YAML manifest format**: Human-readable and easily editable
3. **Automatic merging**: No user confirmation needed when shared images detected
4. **5-minute discovery interval**: Balance between responsiveness and performance
5. **No nested folder support**: Only top-level folders in `.projects/` are scanned
6. **Case-insensitive naming**: Prevents conflicts across different filesystems

### Critical Implementation Details
1. **Atomic operations**: All folder renames must be atomic to prevent partial state
2. **Transaction safety**: Database updates must be wrapped in transactions
3. **SSE events**: Emit events after all operations to keep UI synchronized
4. **Idempotent jobs**: All reconciliation jobs must be safe to run multiple times
5. **Graceful degradation**: System must work even if manifests are missing/corrupted

### Performance Considerations
1. **Batch processing**: Discovery job processes folders in batches, not all at once
2. **Efficient lookups**: Use Set-based operations for shared image detection
3. **Database indexes**: Add index on `project_folder` for fast lookups
4. **Skip system folders**: Don't scan `.thumb`, `.preview`, `.trash` directories
5. **Limit photo queries**: Use pagination when listing photos (max 100,000 per query)

### Testing Strategy
1. **Unit tests**: Focus on folder naming, manifest I/O, validation logic
2. **Integration tests**: Test full workflows (create, rename, discover, merge)
3. **Edge cases**: Unicode names, very long names, special characters, case conflicts
4. **Performance tests**: Verify system handles 100+ projects efficiently
5. **Failure scenarios**: Test manifest corruption, filesystem errors, concurrent operations

This is a **major architectural change** that fundamentally shifts how projects are managed. The implementation should be done incrementally with thorough testing at each stage. The new system provides much better user experience (human-readable folders) and enables powerful features like automatic project discovery and intelligent merging.
