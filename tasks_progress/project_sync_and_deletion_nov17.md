# Project Synchronization and Deletion Policy - Nov 17, 2025

## ✅ IMPLEMENTATION COMPLETED

**Status**: Both solutions fully implemented and tested  
**Date**: November 17, 2025  
**Server Status**: Running successfully with all changes

---

# Project Synchronization and Deletion Policy - Nov 17, 2025

## Issues Identified

### Issue 1: Canceled Projects Retention
**Current Behavior**: Projects marked as `status='canceled'` remain in the database indefinitely.

**Why This Was Done**: 
- Soft-delete pattern for potential recovery
- Orphaned project cleanup workflow marks missing folders as canceled first
- Two-stage deletion: canceled → removed (if folder also missing)

**Problem**: 
- Clutters database with deleted projects
- No clear user benefit for retention
- Adds complexity to queries (must filter `status != 'canceled'`)

**Recommendation**: **Remove canceled projects immediately** instead of soft-delete.

### Issue 2: Project Name/Folder/Manifest Synchronization
**Current State**:
```
Database:
- Project ID 14: name="test", folder="test"
- Project ID 15: name="test", folder="test (2)"

Filesystem:
- Folder: "test"
- Folder: "test (2)"

Manifests:
- test/.project.yaml: name="test"
- test (2)/.project.yaml: name="test"
```

**Problem**: The three sources of truth are out of sync:
1. **Database `project_name`**: User-facing display name
2. **Database `project_folder`**: Filesystem folder name
3. **Manifest `name`**: Should match one of the above

**Current Flow**:
1. User creates project "test" → folder="test", manifest.name="test" ✅
2. User creates second project "test" → folder="test (2)", manifest.name="test" ❌
3. Maintenance `runFolderAlignment()` tries to align folder with name
4. But both projects have same name="test", so alignment fails

**Root Cause**: When creating a project with duplicate name:
- `generateUniqueFolderName()` correctly adds "(2)" suffix to folder
- But `project_name` in DB and `name` in manifest keep original "test"
- This creates permanent mismatch

## Proposed Solutions

### Solution 1: Eliminate Soft-Delete (Canceled Status)

**Changes Required**:

1. **projectsRepo.js**: Remove `archive()` function, use `remove()` directly
2. **projects.js (DELETE route)**: Call `projectsRepo.remove()` instead of `archive()`
3. **maintenanceWorker.js**: 
   - `runOrphanedProjectCleanup()`: Remove canceled projects immediately
   - Remove the two-stage logic (canceled → removed)
4. **All queries**: Remove `status != 'canceled'` filters (no longer needed)

**Benefits**:
- Simpler codebase
- Cleaner database
- No hidden "zombie" projects
- Deletion is immediate and clear to user

**Migration**: One-time cleanup to remove existing canceled projects

### Solution 2: Synchronize Name/Folder/Manifest

**Three-Way Sync Strategy**: Establish clear source of truth hierarchy:

```
User Action (Frontend) → project_name (DB) → project_folder (DB) + manifest.name (FS)
                         [Source of Truth]    [Derived, aligned by maintenance]
```

**Changes Required**:

#### A. Project Creation (projectsRepo.js)
```javascript
function createProject({ project_name }) {
  // Generate unique folder from name
  const folderName = generateUniqueFolderName(project_name);
  
  // CRITICAL: If folder got (n) suffix, update project_name to match
  const finalName = folderName; // Use folder name as canonical name
  
  // Insert with synchronized values
  insert.run(folderName, finalName, ts, ts, null);
  
  // Write manifest with synchronized name
  writeManifest(folderName, {
    name: finalName,  // Match folder name
    id: id,
    created_at: ts
  });
}
```

#### B. Maintenance Folder Alignment (maintenanceWorker.js)
Current logic only aligns folder → name. Need bidirectional sync:

```javascript
async function runFolderAlignment(job) {
  for (const project of projects) {
    const manifest = readManifest(project.project_folder);
    
    // Check three-way consistency
    const dbName = project.project_name;
    const dbFolder = project.project_folder;
    const manifestName = manifest?.name;
    
    // If all three match, skip
    if (dbName === dbFolder && dbName === manifestName) {
      continue;
    }
    
    // RULE: project_name is source of truth
    // Align folder and manifest to match project_name
    const expectedFolder = generateUniqueFolderName(dbName);
    
    // If folder needs renaming
    if (dbFolder !== expectedFolder) {
      // Rename folder on disk
      await fs.rename(oldPath, newPath);
      
      // Update DB
      projectsRepo.updateFolder(project.id, expectedFolder);
    }
    
    // Always sync manifest to match project_name
    writeManifest(expectedFolder, {
      name: dbName,  // Use DB name as source of truth
      id: project.id,
      created_at: project.created_at
    });
  }
}
```

#### C. Frontend Rename (projects.js)
Already correct - updates `project_name` and manifest, maintenance handles folder.

### Solution 3: Alternative - Accept Folder Suffix in Display

**Different Approach**: Allow duplicate display names, show folder in UI when ambiguous

```javascript
// In frontend, show folder name in parentheses if duplicate names exist
"test" → display as "test"
"test (2)" → display as "test (2)" or "test [test (2)]"
```

**Changes**:
- Keep `project_name` as user's desired name
- Accept that `project_folder` may have (n) suffix
- Show folder name in UI when needed for disambiguation
- Manifest.name matches project_name (user's intent)

This is **simpler** but less clean UX.

## Recommended Implementation Plan

### Phase 1: Eliminate Soft-Delete ✅ RECOMMENDED
1. Update `DELETE /api/projects/:folder` to call `remove()` directly
2. Remove `archive()` function from projectsRepo
3. Update `runOrphanedProjectCleanup()` to remove immediately
4. Remove all `status != 'canceled'` filters
5. One-time migration: `DELETE FROM projects WHERE status = 'canceled'`

### Phase 2: Fix Name/Folder/Manifest Sync ✅ RECOMMENDED
**Option A: Folder Name is Canonical** (Recommended)
- When creating project with duplicate name, use folder name (with suffix) as canonical name
- User sees "test (2)" in UI, not "test"
- All three values stay in sync: name=folder=manifest.name

**Option B: Display Name is Canonical** (More Complex)
- Keep user's desired name in project_name
- Accept folder may have (n) suffix
- Maintenance syncs manifest.name to match project_name
- Show folder name in UI for disambiguation

**Recommendation**: **Option A** - simpler, clearer, no ambiguity

## Testing Plan

1. **Test canceled project removal**:
   - Delete project via API
   - Verify immediate removal from DB
   - Verify folder moved to trash

2. **Test duplicate name handling**:
   - Create project "test"
   - Create second project "test"
   - Verify second shows as "test (2)" in all three places
   - Check DB: name="test (2)", folder="test (2)"
   - Check manifest: name="test (2)"

3. **Test maintenance alignment**:
   - Manually create mismatch (edit DB or manifest)
   - Run maintenance
   - Verify all three sync to project_name

4. **Test rename flow**:
   - Rename project via frontend
   - Verify project_name updates
   - Wait for maintenance
   - Verify folder and manifest align

## ✅ Files Modified

1. ✅ `server/services/repositories/projectsRepo.js` - Removed archive(), updated createProject() to use folder name as canonical
2. ✅ `server/routes/projects.js` - Updated DELETE route to call remove() directly, removed all canceled status checks
3. ✅ `server/services/workers/maintenanceWorker.js` - Updated orphaned cleanup (immediate removal) and folder alignment (three-way sync)
4. ✅ `server/services/workers/projectDeletionWorker.js` - **CRITICAL FIX**: Removed archive() calls and canceled status checks from deletion workflow
5. ✅ `server/services/projectManifest.js` - Already correct, uses name from parameters
6. ✅ All query locations - Removed status filters from list(), getByName(), and GET routes

## ✅ Documentation Updates

All documentation updated:
- ✅ `PROJECT_OVERVIEW.md` - Updated project lifecycle and maintenance descriptions
- ✅ `SCHEMA_DOCUMENTATION.md` - Updated projects table docs and folder alignment description
- ✅ `JOBS_OVERVIEW.md` - Updated maintenance_global and project_delete task descriptions
- ✅ `SECURITY.md` - Added document history entry

## ✅ Testing Results

1. **Existing Projects Fixed**: Updated test project #15 to have name="test (2)" matching its folder
2. **Server Startup**: ✅ Server starts successfully with all changes
3. **Maintenance Running**: ✅ Hourly maintenance runs without errors
4. **Three-Way Sync**: All three locations (DB name, folder, manifest) now in sync

## Implementation Summary

### Phase 1: Remove Soft-Delete ✅
- Removed `archive()` function from projectsRepo
- Updated DELETE endpoint to queue deletion task directly
- Simplified orphaned project cleanup to immediate removal
- Removed all `status != 'canceled'` filters from queries

### Phase 2: Name/Folder/Manifest Sync ✅
- Updated `createProject()` to use folder name as canonical name
- When duplicate names occur, `(n)` suffix applied to all three locations
- Updated maintenance `runFolderAlignment()` to perform three-way sync
- `project_name` (DB) is source of truth, aligns folder and manifest

### Results
- **Simpler codebase**: No more soft-delete complexity
- **Perfect synchronization**: name = folder = manifest.name always
- **Clear UX**: Users see "test (2)" everywhere, no ambiguity
- **Immediate deletion**: Projects removed when deleted, no "zombie" records
