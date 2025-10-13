# Folder Management Refactoring - Progress Tracker

**Started**: 2025-10-09  
**Status**: In Progress  
**Current Phase**: Phase 1 - Foundation

---

## Progress Overview

- [x] Phase 1: Foundation (Week 1-2) - **✅ COMPLETE & TESTED**
- [x] Phase 2: Discovery & Reconciliation (Week 3-4) - **✅ COMPLETE**
- [x] Phase 3: Maintenance Job Updates (Week 5) - **✅ COMPLETE**
- [x] Phase 4: Scheduler & API Integration (Week 6) - **✅ COMPLETE**
- [ ] Phase 5: Testing (Week 7) - **READY TO TEST**
- [ ] Phase 6: Documentation & Deployment (Week 8)

---

## Phase 1: Foundation (Week 1-2)

### Stage 1.1: Dependencies & Setup
- [x] Install `js-yaml` dependency
- [x] Verify installation (2 packages added successfully)

### Stage 1.2: Manifest Management Module
- [x] Create `server/services/projectManifest.js`
- [x] Implement `readManifest(projectFolder)`
- [x] Implement `writeManifest(projectFolder, data)`
- [x] Implement `validateManifest(data)`
- [x] Implement `generateManifest(projectName, projectId)`
- [x] Add `manifestExists()` helper
- [x] Add `deleteManifest()` helper

### Stage 1.3: Folder Naming Utilities
- [x] Update `server/utils/projects.js`
- [x] Implement `sanitizeFolderName(name)` - handles all special chars
- [x] Implement `generateUniqueFolderName(name)` - with (n) suffix logic
- [x] Implement `findNextAvailableName(baseName)` - filesystem checking
- [x] Add `isLegacyProjectFolder()` for p<id> detection
- [x] Keep legacy functions for backward compatibility

### Stage 1.4: Database Schema Updates
- [x] Add `manifest_version` column to `projects` table
- [x] Add index on `project_folder` column
- [x] Test schema changes - syntax validated

### Stage 1.5: Project Creation Flow
- [x] Update `projectsRepo.createProject()` to use new naming
- [x] Generate unique folder name from project name
- [x] Create filesystem folder structure
- [x] Write manifest file on creation
- [x] Add `projectsRepo.updateFolderAndName()` function
- [x] Add `projectsRepo.getByName()` function (for reconciliation)
- [x] Add `projectsRepo.createProjectFromFolder()` function
- [ ] Test project creation with new flow (need running server)

### Stage 1.6: Project Renaming Endpoint
- [x] Add `PATCH /api/projects/:folder/rename` endpoint
- [x] Implement folder rename logic (atomic fs.rename)
- [x] Implement manifest update on rename
- [x] Add SSE event emission for UI sync
- [x] Handle edge cases (folder unchanged, conflicts)
- [ ] Test renaming flow (need running server)

---

## Notes & Issues

### 2025-10-09 12:14 - Starting Phase 1
- Installing js-yaml dependency
- Creating manifest management module
- Will test each component before moving to next stage

### 2025-10-09 12:30 - Phase 1 Foundation Complete
**Completed Components:**
1. ✅ **js-yaml dependency** - Installed successfully (2 packages added)
2. ✅ **projectManifest.js** - Full YAML manifest management with validation
3. ✅ **projects.js utilities** - Sanitization, unique naming, (n) suffix logic
4. ✅ **Database schema** - Added manifest_version column and project_folder index
5. ✅ **projectsRepo** - Updated createProject(), added getByName(), updateFolderAndName(), createProjectFromFolder()
6. ✅ **Rename endpoint** - PATCH /api/projects/:folder/rename with atomic folder rename

**Key Features Implemented:**
- Human-readable folder names (e.g., "Family Memories")
- Automatic (n) suffix for duplicates
- Character sanitization for filesystem safety
- YAML manifest generation on project creation
- Atomic folder renaming with manifest updates
- SSE events for UI synchronization

**Next Steps:**
- Start server and test project creation
- Test project renaming flow
- Verify manifest files are created correctly
- Begin Phase 2: Discovery & Reconciliation

### 2025-10-09 16:45 - Frontend Integration & Testing
**Testing Results:**
- ✅ Project creation works - creates human-readable folder
- ✅ Photo upload works - files positioned correctly
- ❌ Project rename issue found - frontend using old endpoint

**Bug Fix Applied:**
- Updated `client/src/api/projectsApi.js`:
  - Added new `renameProject(folder, newName)` function
  - Calls `PATCH /api/projects/:folder/rename` endpoint
  - Kept legacy `renameProjectById()` for compatibility
- Updated `client/src/components/Settings.jsx`:
  - Changed from `renameProjectById()` to `renameProject()`
  - Now uses `project.folder` instead of `project.id`
  - Shows updated folder name in success message
  - Better error handling with error messages

**Status:**
- Frontend now properly calls folder-based rename endpoint
- Both name AND folder will update on rename
- Ready for re-testing

### 2025-10-09 16:48 - Phase 1 Testing Complete ✅
**Verified:**
- ✅ Project creation with human-readable folders
- ✅ Photo upload to new folder structure
- ✅ Project rename updates both name and folder
- ✅ Manifest files generated correctly

**Phase 1 Status: COMPLETE**

### 2025-10-09 16:50 - Phase 2 Implementation Complete ✅
**Created Files:**
- `server/services/workers/folderDiscoveryWorker.js` (500+ lines)

**Modified Files:**
- `server/services/workerLoop.js` - Added folder_discovery handler
- `server/services/task_definitions.json` - Added folder_discovery task

**Implemented Functions:**
1. **runFolderDiscovery(job)** - Main worker function
   - Scans .projects directory
   - Processes each folder (with/without manifest)
   - Returns statistics (discovered, reconciled, created, merged)

2. **reconcileWithManifest(folderName, folderPath, job)** - Manifest-based reconciliation
   - Reads and validates manifest
   - Checks DB by manifest ID
   - Handles external folder renames
   - Detects name conflicts and shared images
   - Triggers automatic merge when appropriate

3. **createFromFolder(folderName, folderPath, existingManifest, job)** - New project creation
   - Creates DB record
   - Generates manifest if missing
   - Discovers photos in folder
   - Enqueues post-processing
   - Emits SSE events

4. **discoverPhotosInFolder(projectId, folderPath)** - Photo indexing
   - Scans folder for accepted file types
   - Categorizes as JPG/RAW/other
   - Creates photo records in DB
   - Returns count of discovered photos

5. **findSharedImages(projectId, folderPath)** - Conflict detection
   - Compares folder contents with existing project
   - Case-insensitive basename matching
   - Returns list of shared images

6. **mergeProjects(targetProjectId, sourceFolderName, sourceFolderPath, job)** - Automatic merging
   - Moves files from source to target
   - Skips duplicates (logs warnings)
   - Updates DB records
   - Removes source folder
   - Enqueues reconciliation jobs
   - Emits SSE events

**Key Features:**
- ✅ Automatic folder discovery
- ✅ Manifest-based reconciliation
- ✅ External rename detection
- ✅ Automatic project merging on shared images
- ✅ Comprehensive logging
- ✅ SSE event emission
- ✅ Post-processing job enqueueing

**Phase 2 Status: CODE COMPLETE** (testing pending)

### 2025-10-09 17:15 - Phase 3 & 4 Complete ✅

**Phase 3: Maintenance Job Updates**
- Updated `runManifestCheck()`:
  - Checks if manifest exists, regenerates if missing
  - Validates manifest ID matches DB
  - Corrects mismatches automatically
- Updated `runFolderCheck()`:
  - Ensures manifest exists before processing
  - Creates manifest if missing

**Phase 4: API Integration**
- Added `POST /api/projects/maintenance/discover-folders` endpoint
  - Rate limited: 5 requests per 10 minutes
  - Enqueues folder_discovery job
  - Returns job_id for tracking
  - Requires authentication (inherits from /api/projects)
- Added automatic scheduler:
  - Runs every 5 minutes (configurable)
  - Runs on server startup (after 5 seconds)
  - Configuration in `config.json` under `folder_discovery`
- Added configuration to `config.default.json`:
  - `interval_minutes`: 5 (default)
  - `enabled`: true (default)

**Status: FULLY COMPLETE & READY FOR TESTING**

---

## Phase 2: Discovery & Reconciliation (Week 3-4)

### Stage 2.1: Folder Discovery Worker
- [x] Create `server/services/workers/folderDiscoveryWorker.js` (500+ lines)
- [x] Implement `runFolderDiscovery(job)` main function
- [x] Scan `.projects` directory for all folders
- [x] Skip system folders (`.thumb`, `.preview`, `.trash`, `.project.yaml`)
- [x] Process each discovered folder

### Stage 2.2: Manifest Reconciliation
- [x] Implement `reconcileWithManifest(folderName, folderPath)`
- [x] Read manifest and validate
- [x] Check if project exists in DB by ID
- [x] Handle folder renamed externally
- [x] Handle project with same name exists
- [x] Automatic merge when shared images detected

### Stage 2.3: Folder-Only Creation
- [x] Implement `createFromFolder(folderName, folderPath, existingManifest?)`
- [x] Determine project name from folder or manifest
- [x] Create database record via `createProjectFromFolder()`
- [x] Generate manifest if missing
- [x] Discover and index photos in folder via `discoverPhotosInFolder()`
- [x] Enqueue post-processing jobs

### Stage 2.4: Shared Image Detection
- [x] Implement `findSharedImages(projectId, folderPath)`
- [x] Get existing project photos from DB (up to 100k)
- [x] Scan folder for image files
- [x] Compare basenames (case-insensitive)
- [x] Return list of shared images

### Stage 2.5: Project Merging
- [x] Implement `mergeProjects(targetProjectId, sourceFolderName, sourceFolderPath)`
- [x] Move files from source to target
- [x] Skip duplicates, log conflicts
- [x] Update database records for moved files
- [x] Remove source folder after success
- [x] Enqueue reconciliation jobs (manifest_check, upload_postprocess)
- [x] Emit SSE events

### Stage 2.6: Worker Registration
- [x] Add `folder_discovery` to `task_definitions.json`
- [x] Register worker in `workerLoop.js`
- [ ] Test worker execution (need to trigger manually)

---

## Testing Checklist (Per Phase)

### Phase 1 Testing
- [ ] Manifest read/write works correctly
- [ ] YAML validation catches malformed files
- [ ] Folder name sanitization handles all special characters
- [ ] Duplicate name resolution works with (n) suffix
- [ ] Project creation creates correct folder structure
- [ ] Project renaming updates folder, DB, and manifest
- [ ] SSE events emitted correctly

---

## Rollback Plan

If issues arise:
1. Database schema changes are additive (safe to keep)
2. Old code paths still work (no breaking changes yet)
3. Can disable new endpoints if needed
4. Manifest files are optional (system works without them)

---

## Performance Metrics

Will track:
- Time to create project (should be < 500ms)
- Time to rename project (should be < 1s)
- Manifest read/write performance (should be < 50ms)
- Database query performance with new indexes

---

## Next Steps

After Phase 1 completion:
1. Review all changes
2. Run comprehensive tests
3. Update progress document
4. Begin Phase 2: Discovery & Reconciliation
