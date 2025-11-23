# Test Coverage Analysis - November 17, 2025

## Current Test Coverage

### ✅ Well-Covered Areas
1. **Routes/API Endpoints**:
   - Projects CRUD (create, update, delete endpoints)
   - Photos pagination (all, project, filtered)
   - Bulk operations (tags, keep, move, process)
   - Uploads (basic, conflicts, integration)
   - Auth routes and middleware
   - Public/shared links
   - Asset visibility

2. **Repositories**:
   - Jobs repository (basic operations, priority lanes)
   - Photo CRUD operations
   - Prepared statements cache

3. **Utilities**:
   - Project name generation and validation
   - Auth services (tokens, cookies, passwords)

### ❌ Missing Critical Test Coverage

#### 1. **Project Deletion Worker** (`projectDeletionWorker.js`)
**Functions with NO tests**:
- `runProjectStopProcesses()` - Cancels all jobs for a project
- `runProjectDeleteFiles()` - Removes project folder from filesystem
- `runProjectCleanupDb()` - Removes all DB records (photos, tags, project)

**Why this matters**:
- These are destructive operations that permanently delete data
- Errors here could leave orphaned data or fail to clean up properly
- The transaction logic in `runProjectCleanupDb()` needs verification
- File deletion errors need proper handling

**What should be tested**:
- ✅ Successfully deletes project with photos and tags
- ✅ Handles missing project gracefully
- ✅ Handles filesystem errors (permission denied, disk full)
- ✅ Transaction rollback on DB errors
- ✅ Proper cleanup of all related records (photos, tags, photo_tags)
- ✅ Handles already-deleted filesystem paths

#### 2. **Maintenance Worker** (`maintenanceWorker.js`)
**Functions with NO tests** (8 critical functions):

**a) `runTrashMaintenance()`**
- Deletes files marked for deletion
- Moves files to trash folder
- **Risk**: Could delete wrong files or fail to clean up

**b) `runManifestCheck()`**
- Syncs manifest.json with database
- Processes 2000 photos at a time
- **Risk**: Data inconsistency between manifest and DB

**c) `runFolderCheck()`**
- Discovers new files on disk
- Creates DB records for orphaned files
- Handles cross-project duplicates
- **Risk**: Could create duplicate records or miss files

**d) `runManifestCleaning()`**
- Removes DB records for missing files
- **Risk**: Could delete valid records if filesystem is temporarily unavailable

**e) `runDuplicateResolution()`**
- Renames duplicate files across projects
- **Risk**: Could corrupt filenames or lose files

**f) `runFolderAlignment()`**
- Three-way sync: project_name (DB) ↔ folder ↔ manifest
- Renames folders and updates manifests
- **Risk**: Could break project references or lose data

**g) `runOrphanedProjectCleanup()`**
- **IMMEDIATE DELETION** of projects whose folders don't exist
- **Risk**: Could delete projects during temporary filesystem issues (network mount, permissions)

**h) `runDerivativeCacheValidation()`**
- Validates cached derivatives exist on disk
- Invalidates stale cache entries
- **Risk**: Could invalidate valid cache or miss stale entries

**Why this matters**:
- These run automatically on schedule (hourly)
- They make destructive changes to filesystem and database
- Bugs could cause data loss or corruption
- Cross-project operations are complex and error-prone

**What should be tested**:
- ✅ Each function with valid data
- ✅ Each function with missing/corrupted data
- ✅ Error handling (filesystem errors, DB errors)
- ✅ Cross-project duplicate detection
- ✅ Transaction rollback behavior
- ✅ Proper logging of operations
- ✅ Scope handling (project vs global)

#### 3. **Other Workers**
**Also missing tests**:
- `derivativesWorker.js` - Image processing and thumbnail generation
- `fileRemovalWorker.js` - File deletion operations
- `folderDiscoveryWorker.js` - Auto-discovery of new projects
- `imageMoveWorker.js` - Moving photos between projects
- `projectScavengeWorker.js` - Cleanup of archived projects

## Risk Assessment

### 🔴 HIGH RISK (No Tests)
1. **Project Deletion** - Permanent data loss if bugs exist
2. **Orphaned Project Cleanup** - Immediate deletion without soft-delete
3. **Folder Alignment** - Could break project references
4. **Duplicate Resolution** - Could corrupt or lose files

### 🟡 MEDIUM RISK (No Tests)
1. **Trash Maintenance** - Could delete wrong files
2. **Manifest Check/Cleaning** - Data inconsistency
3. **Folder Check** - Could create duplicates or miss files
4. **File Removal** - Destructive operations

### 🟢 LOW RISK (Existing Tests)
1. **API Endpoints** - Well covered
2. **Repositories** - Basic operations tested
3. **Auth** - Comprehensive coverage

## Recommendations

### Priority 1: Critical Destructive Operations
Create test files:
1. `server/services/workers/__tests__/projectDeletionWorker.test.js`
   - Test all 3 functions with various scenarios
   - Mock filesystem and database operations
   - Verify transaction behavior

2. `server/services/workers/__tests__/maintenanceWorker.test.js`
   - Focus on `runOrphanedProjectCleanup()` first (immediate deletion)
   - Then `runFolderAlignment()` (renames folders)
   - Then `runDuplicateResolution()` (renames files)

### Priority 2: Data Integrity Operations
3. `server/services/workers/__tests__/fileRemovalWorker.test.js`
4. Add tests for `runManifestCheck()` and `runFolderCheck()`

### Priority 3: Other Workers
5. Tests for remaining workers (derivatives, image move, etc.)

## Test Strategy

### For Worker Tests:
```javascript
// Example structure
describe('Project Deletion Worker', () => {
  let fixtures;
  
  beforeEach(() => {
    fixtures = createFixtureTracker();
  });
  
  afterEach(() => {
    fixtures.cleanup();
  });
  
  test('runProjectCleanupDb removes all related records', async () => {
    // Create project with photos and tags
    const project = fixtures.createProject('Test Project');
    const photo = fixtures.createPhoto(project.id, 'test.jpg');
    fixtures.createTag(project.id, 'test-tag');
    fixtures.addPhotoTag(photo.id, 'test-tag');
    
    // Run cleanup
    await runProjectCleanupDb({ id: 1, project_id: project.id });
    
    // Verify everything is deleted
    assert.equal(projectsRepo.getById(project.id), undefined);
    assert.equal(photosRepo.getById(photo.id), undefined);
    // ... etc
  });
  
  test('runProjectDeleteFiles handles missing folder gracefully', async () => {
    const project = fixtures.createProject('Missing Folder');
    // Don't create filesystem folder
    
    // Should not throw
    await runProjectDeleteFiles({ id: 1, project_id: project.id });
  });
});
```

### Key Testing Principles:
1. **Isolation**: Each test should clean up after itself
2. **Fixtures**: Use `createFixtureTracker()` for test data
3. **Mocking**: Mock filesystem operations where appropriate
4. **Error Cases**: Test both success and failure paths
5. **Transactions**: Verify rollback behavior on errors

## Current Status
- **Total Test Files**: 29
- **Worker Test Files**: 1 (only jobsRepo.test.js)
- **Missing Worker Tests**: 7 workers with 0 tests
- **Critical Functions Untested**: ~15+ destructive operations

## Conclusion
The API layer is well-tested, but the **worker layer has almost no test coverage**. This is concerning because:
1. Workers perform destructive operations (delete files, remove DB records)
2. Workers run automatically on schedule
3. Bugs in workers could cause data loss or corruption
4. The most dangerous operations (immediate deletion) have zero tests

**Recommendation**: Add worker tests before deploying to production, starting with the highest-risk operations (project deletion, orphaned cleanup, folder alignment).
