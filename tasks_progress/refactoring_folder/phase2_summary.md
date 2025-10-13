# Phase 2 Discovery & Reconciliation - Implementation Summary

**Date**: 2025-10-09  
**Status**: ✅ Complete (Code Implementation)  
**Testing Status**: ⏳ Pending Manual Trigger

---

## Overview

Phase 2 implements the automatic folder discovery and reconciliation system. This enables the application to automatically detect folders in `.projects`, reconcile them with the database, and intelligently merge projects that share images.

---

## Files Created

### 1. `/server/services/workers/folderDiscoveryWorker.js` (500+ lines)
**Purpose**: Automatic folder discovery and reconciliation worker

**Main Function:**
- `runFolderDiscovery(job)` - Scans .projects directory and processes all folders

**Reconciliation Functions:**
- `reconcileWithManifest(folderName, folderPath, job)` - Handle folders with manifests
- `createFromFolder(folderName, folderPath, existingManifest, job)` - Create new projects
- `discoverPhotosInFolder(projectId, folderPath)` - Index photos in folder
- `findSharedImages(projectId, folderPath)` - Detect shared images between projects
- `mergeProjects(targetProjectId, sourceFolderName, sourceFolderPath, job)` - Merge projects

**Features:**
- Comprehensive error handling and logging
- SSE event emission for UI updates
- Automatic post-processing job enqueueing
- Statistics tracking (discovered, reconciled, created, merged)

---

## Files Modified

### 1. `/server/services/workerLoop.js`
**Changes**: Added folder_discovery job handler

**New Handler:**
```javascript
if (job.type === 'folder_discovery') {
  await runFolderDiscovery(job);
  stopHeartbeat();
  jobsRepo.complete(job.id);
  // ... emit SSE and orchestrate
}
```

### 2. `/server/services/task_definitions.json`
**Changes**: Added folder_discovery task definition

**New Task:**
```json
{
  "folder_discovery": {
    "label": "Folder Discovery",
    "user_relevant": false,
    "scope": "global",
    "steps": [
      { "type": "folder_discovery", "priority": 95 }
    ]
  }
}
```

---

## Implementation Details

### Folder Discovery Flow

```
1. Scan .projects directory
   ↓
2. For each folder:
   ├─ Has manifest? → reconcileWithManifest()
   └─ No manifest? → createFromFolder()
   ↓
3. Return statistics
```

### Manifest Reconciliation Flow

```
1. Read manifest file
   ↓
2. Check DB by manifest.id
   ├─ Found? → Check folder name matches
   │           ├─ Matches? → Done (reconciled)
   │           └─ Different? → Update DB (external rename)
   └─ Not found? → Check DB by manifest.name
                   ├─ Found? → Check for shared images
                   │           ├─ Shared? → mergeProjects()
                   │           └─ Not shared? → createFromFolder()
                   └─ Not found? → createFromFolder()
```

### Project Merging Flow

```
1. Get target project from DB
   ↓
2. Scan source folder for files
   ↓
3. For each file:
   ├─ Exists in target? → Skip (log warning)
   └─ New? → Move to target + create DB record
   ↓
4. Remove source folder
   ↓
5. Enqueue reconciliation jobs
   ↓
6. Emit SSE events
```

---

## Key Algorithms

### 1. Photo Discovery Algorithm
```javascript
// Scan folder and categorize files
for (const entry of entries) {
  if (skip.has(entry)) continue;
  
  const ext = path.extname(entry).toLowerCase();
  const base = path.parse(entry).name;
  
  if (isAccepted(entry)) {
    // Categorize as jpg/raw/other
    const rec = discoveredBases.get(base) || { jpg: false, raw: false, other: false };
    if (jpgExts.has(ext)) rec.jpg = true;
    else if (rawExts.has(ext)) rec.raw = true;
    else rec.other = true;
    discoveredBases.set(base, rec);
  }
}

// Create photo records
for (const [base, availability] of discoveredBases.entries()) {
  photosRepo.upsertPhoto(projectId, {
    filename: base,
    jpg_available: !!availability.jpg,
    raw_available: !!availability.raw,
    other_available: !!availability.other,
    keep_jpg: !!availability.jpg,
    keep_raw: !!availability.raw,
    // ... other fields
  });
}
```

### 2. Shared Image Detection Algorithm
```javascript
// Get existing project photos
const existingPhotos = photosRepo.listPaged({ project_id, limit: 100000 });
const existingFilenames = new Set(
  existingPhotos.items.map(p => p.filename.toLowerCase())
);

// Scan folder and check for matches
for (const entry of entries) {
  if (isAccepted(entry)) {
    const basename = path.parse(entry).name;
    if (existingFilenames.has(basename.toLowerCase())) {
      sharedImages.push(basename);
    }
  }
}
```

### 3. File Merging Algorithm
```javascript
for (const entry of entries) {
  if (isAccepted(entry)) {
    const targetFilePath = path.join(targetPath, entry);
    
    if (await fs.pathExists(targetFilePath)) {
      // Skip duplicate
      skippedFiles.push(entry);
      log.warn('merge_skip_duplicate', { filename: entry });
    } else {
      // Move file
      await fs.move(sourcePath, targetFilePath);
      movedFiles.push(entry);
      
      // Create DB record
      photosRepo.upsertPhoto(targetProjectId, { ... });
    }
  }
}

// Remove source folder after successful merge
await fs.remove(sourceFolderPath);
```

---

## SSE Events Emitted

### 1. project_discovered
```javascript
{
  type: 'project_discovered',
  project_id: 42,
  project_folder: 'New Project',
  project_name: 'New Project',
  photo_count: 150
}
```

### 2. projects_merged
```javascript
{
  type: 'projects_merged',
  target_project_id: 42,
  target_folder: 'Family Photos',
  source_folder: 'Family Photos (2)',
  moved_files: 50,
  skipped_files: 10
}
```

---

## Job Enqueueing

### After Folder Discovery:
```javascript
// Enqueue post-processing for discovered photos
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
```

### After Project Merge:
```javascript
// Enqueue manifest check
jobsRepo.enqueue({
  tenant_id: job.tenant_id,
  project_id: targetProjectId,
  type: 'manifest_check',
  priority: 95,
  payload: { source: 'merge', ... }
});

// Enqueue post-processing for moved files
jobsRepo.enqueueWithItems({
  tenant_id: job.tenant_id,
  project_id: targetProjectId,
  type: 'upload_postprocess',
  items: movedFiles.map(f => ({ filename: path.parse(f).name })),
  priority: 90,
  payload: { source: 'merge', ... }
});
```

---

## Error Handling

### Graceful Degradation:
1. **Unreadable manifest** → Treat as folder without manifest
2. **Missing project in DB** → Create new project
3. **Merge failure** → Log error, continue with other folders
4. **Source folder removal failure** → Log warning, continue

### Comprehensive Logging:
- `folder_discovery_started` - Job start
- `manifest_unreadable` - Manifest parsing failed
- `folder_renamed_externally` - External rename detected
- `merging_projects` - Merge initiated
- `merge_skip_duplicate` - Duplicate file skipped
- `source_folder_removed` - Source folder deleted
- `merge_complete` - Merge finished
- `folder_discovery_complete` - Job complete with statistics

---

## Testing Requirements

### Manual Testing Needed:

#### Test 1: New Folder Discovery
1. Create folder manually: `.projects/Test Discovery/`
2. Add photos to folder
3. Trigger folder_discovery job
4. Verify project created in DB
5. Verify manifest generated
6. Verify photos indexed
7. Verify post-processing enqueued

#### Test 2: Manifest Reconciliation
1. Create project via UI: "Test Project"
2. Rename folder externally: `Test Project` → `Test Project Renamed`
3. Trigger folder_discovery job
4. Verify DB updated with new folder name
5. Verify project still accessible

#### Test 3: Project Merging
1. Create project via UI: "Merge Test"
2. Add photo: `IMG_001.jpg`
3. Create folder manually: `.projects/Merge Test 2/`
4. Copy same photo to new folder: `IMG_001.jpg`
5. Trigger folder_discovery job
6. Verify projects merged
7. Verify source folder removed
8. Verify no duplicate photos

#### Test 4: No Shared Images
1. Create project via UI: "Project A"
2. Add photo: `IMG_001.jpg`
3. Create folder manually: `.projects/Project A 2/`
4. Add different photo: `IMG_002.jpg`
5. Trigger folder_discovery job
6. Verify separate projects created
7. Verify both projects exist

---

## Performance Considerations

### Current Implementation:
- **Folder scan**: O(n) where n = folders in .projects
- **Photo discovery**: O(m) where m = files in folder
- **Shared image detection**: O(p) where p = photos in existing project
- **Database queries**: Indexed on project_folder, filename

### Limits:
- Max photos per project: 100,000 (for shared image detection)
- No pagination in folder scan (assumes reasonable folder count)

### Optimizations Applied:
- Set-based lookups for shared images (O(1) per check)
- Skip system folders early
- Single DB transaction per project creation
- Batch photo record creation

---

## Security Considerations

### Filesystem Safety:
- All operations within PROJECTS_DIR
- No path traversal possible
- Atomic file moves
- Source folder only removed after successful merge

### Database Safety:
- Parameterized queries
- Transaction safety
- Foreign key constraints
- Duplicate handling

### Input Validation:
- Folder names sanitized
- File extensions validated
- Manifest validation
- Graceful error handling

---

## Next Steps

### Phase 3: Maintenance Job Updates
- Update `runManifestCheck()` to validate manifests
- Update `runFolderCheck()` to ensure manifests exist
- Test updated jobs with new folder structure

### Phase 4: Scheduler & API Integration
- Add folder discovery to scheduler (5-minute interval)
- Create manual trigger endpoint
- Test scheduler integration

### Phase 5: Testing
- Write unit tests for all functions
- Write integration tests
- Performance testing with 100+ projects
- Edge case testing

---

## Summary

Phase 2 successfully implements a comprehensive folder discovery and reconciliation system:

- ✅ Automatic folder scanning
- ✅ Manifest-based reconciliation
- ✅ External rename detection
- ✅ Intelligent project merging
- ✅ Photo indexing
- ✅ Post-processing integration
- ✅ SSE event emission
- ✅ Comprehensive logging

The system is ready for testing and Phase 3 implementation can begin once manual testing is complete.
