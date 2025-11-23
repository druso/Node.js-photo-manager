# Worker Tests Implementation Plan

## Overview
Implement comprehensive test coverage for the worker layer, focusing on destructive operations that currently have zero tests. This addresses a critical gap where automated background jobs perform permanent deletions and data modifications without test verification.

## Current State
- **API Layer**: Well tested (29 test files)
- **Worker Layer**: Only 1 test file (jobsRepo.test.js)
- **Missing**: Tests for 7 workers with ~15+ destructive operations
- **Risk**: High - workers run automatically and perform permanent deletions

## Priority 1: Critical Destructive Operations

### 1.1 Project Deletion Worker Tests
**File**: `server/services/workers/__tests__/projectDeletionWorker.test.js`

**Functions to Test**:
- `runProjectStopProcesses(job)` - Cancels all jobs for a project
- `runProjectDeleteFiles(job)` - Removes project folder from filesystem
- `runProjectCleanupDb(job)` - Removes all DB records (photos, tags, project)

**Test Cases**:

```javascript
describe('Project Deletion Worker', { concurrency: false }, () => {
  
  describe('runProjectStopProcesses', () => {
    test('cancels all jobs for the project');
    test('handles missing project gracefully');
    test('logs cancellation failures but continues');
  });
  
  describe('runProjectDeleteFiles', () => {
    test('deletes project folder and all contents');
    test('handles already-deleted folder gracefully');
    test('handles permission errors');
    test('handles filesystem errors and bubbles them up for retry');
    test('logs all operations');
  });
  
  describe('runProjectCleanupDb', () => {
    test('deletes all photo_tags for project photos');
    test('deletes all tags for project');
    test('deletes all photos for project');
    test('deletes the project record');
    test('executes all deletions in a transaction');
    test('handles missing project gracefully');
    test('continues on individual delete failures (logged warnings)');
    test('bubbles up transaction errors for retry');
  });
  
  describe('integration', () => {
    test('full deletion flow: stop -> delete files -> cleanup DB');
    test('handles project with photos, tags, and active jobs');
    test('handles project with no photos');
    test('handles project with missing filesystem folder');
  });
});
```

**Estimated Effort**: 4-6 hours

---

### 1.2 Orphaned Project Cleanup Tests
**File**: `server/services/workers/__tests__/maintenanceWorker.test.js` (Part 1)

**Function to Test**:
- `runOrphanedProjectCleanup(job)` - **IMMEDIATE DELETION** of projects whose folders don't exist

**Test Cases**:

```javascript
describe('Maintenance Worker - Orphaned Project Cleanup', () => {
  
  test('removes project when folder does not exist');
  test('preserves project when folder exists');
  test('handles multiple projects (some orphaned, some valid)');
  test('handles filesystem permission errors gracefully');
  test('handles temporary filesystem unavailability (should NOT delete)');
  test('removes all related records (photos, tags, photo_tags)');
  test('logs all operations with project context');
  test('works in project scope (single project)');
  test('works in global scope (all projects)');
  test('continues on per-project errors in global scope');
  test('provides summary logging for global scope');
});
```

**Critical Edge Cases**:
- Network-mounted folders temporarily unavailable
- Permission denied vs truly missing folder
- Race conditions (folder deleted during check)

**Estimated Effort**: 3-4 hours

---

### 1.3 Folder Alignment Tests
**File**: `server/services/workers/__tests__/maintenanceWorker.test.js` (Part 2)

**Function to Test**:
- `runFolderAlignment(job)` - Three-way sync: project_name (DB) ↔ folder ↔ manifest

**Test Cases**:

```javascript
describe('Maintenance Worker - Folder Alignment', () => {
  
  test('renames folder to match project_name');
  test('updates manifest.name to match project_name');
  test('handles folder rename conflicts (generates unique name)');
  test('handles missing manifest file');
  test('handles missing project folder');
  test('preserves photos during folder rename');
  test('updates projectsRepo with new folder name');
  test('handles filesystem errors during rename');
  test('handles manifest write errors');
  test('works in project scope');
  test('works in global scope');
  test('continues on per-project errors in global scope');
  test('logs all operations');
});
```

**Critical Edge Cases**:
- Folder rename conflicts (target already exists)
- Partial failures (folder renamed but manifest update fails)
- Photos in flight during rename

**Estimated Effort**: 4-5 hours

---

## Priority 2: Data Integrity Operations

### 2.1 Duplicate Resolution Tests
**File**: `server/services/workers/__tests__/maintenanceWorker.test.js` (Part 3)

**Function to Test**:
- `runDuplicateResolution(job)` - Renames duplicate files across projects

**Test Cases**:

```javascript
describe('Maintenance Worker - Duplicate Resolution', () => {
  
  test('detects cross-project duplicates by filename');
  test('renames duplicate files with _duplicate1 suffix');
  test('increments suffix for multiple duplicates (_duplicate2, etc)');
  test('updates database records with new filenames');
  test('preserves original file in first project');
  test('handles filesystem rename errors');
  test('handles database update errors');
  test('skips non-accepted file types');
  test('works in project scope');
  test('works in global scope');
  test('logs all operations');
});
```

**Estimated Effort**: 3-4 hours

---

### 2.2 Manifest and Folder Check Tests
**File**: `server/services/workers/__tests__/maintenanceWorker.test.js` (Part 4)

**Functions to Test**:
- `runManifestCheck(job)` - Syncs manifest.json with database
- `runFolderCheck(job)` - Discovers new files on disk
- `runManifestCleaning(job)` - Removes DB records for missing files

**Test Cases**:

```javascript
describe('Maintenance Worker - Manifest Operations', () => {
  
  describe('runManifestCheck', () => {
    test('syncs manifest with database (adds missing photos)');
    test('processes photos in chunks (2000 per batch)');
    test('handles missing manifest file');
    test('handles corrupted manifest file');
    test('updates photo metadata from manifest');
    test('works in project and global scope');
  });
  
  describe('runFolderCheck', () => {
    test('discovers new files on disk');
    test('creates database records for orphaned files');
    test('detects cross-project duplicates (logs warning, skips)');
    test('skips non-accepted file types');
    test('handles filesystem read errors');
    test('works in project and global scope');
  });
  
  describe('runManifestCleaning', () => {
    test('removes DB records for missing files');
    test('preserves records for existing files');
    test('handles filesystem check errors gracefully');
    test('works in project and global scope');
  });
});
```

**Estimated Effort**: 5-6 hours

---

### 2.3 Trash Maintenance Tests
**File**: `server/services/workers/__tests__/maintenanceWorker.test.js` (Part 5)

**Function to Test**:
- `runTrashMaintenance(job)` - Deletes files marked for deletion

**Test Cases**:

```javascript
describe('Maintenance Worker - Trash Maintenance', () => {
  
  test('deletes files marked with keep_thumbnail=false and keep_preview=false');
  test('preserves files with keep_thumbnail=true or keep_preview=true');
  test('moves files to trash folder before deletion');
  test('handles missing files gracefully');
  test('handles filesystem errors');
  test('updates database after successful deletion');
  test('works in project and global scope');
  test('logs all operations');
});
```

**Estimated Effort**: 2-3 hours

---

### 2.4 Derivative Cache Validation Tests
**File**: `server/services/workers/__tests__/maintenanceWorker.test.js` (Part 6)

**Function to Test**:
- `runDerivativeCacheValidation(job)` - Validates cached derivatives exist on disk

**Test Cases**:

```javascript
describe('Maintenance Worker - Cache Validation', () => {
  
  test('validates cached derivatives exist on disk');
  test('invalidates cache entries for missing files');
  test('preserves cache entries for existing files');
  test('processes photos in chunks (1000 per batch)');
  test('handles filesystem errors gracefully');
  test('works in project and global scope');
  test('logs validation summary');
});
```

**Estimated Effort**: 2-3 hours

---

## Priority 3: Other Workers

### 3.1 File Removal Worker Tests
**File**: `server/services/workers/__tests__/fileRemovalWorker.test.js`

**Function to Test**:
- `runFileRemoval(job)` - Removes files marked for deletion

**Test Cases**:
- Similar to trash maintenance but for immediate removal
- Test transaction behavior
- Test error handling

**Estimated Effort**: 2-3 hours

---

### 3.2 Image Move Worker Tests
**File**: `server/services/workers/__tests__/imageMoveWorker.test.js`

**Function to Test**:
- `runImageMoveFiles(job)` - Moves photos between projects

**Test Cases**:
- Test successful move
- Test conflict handling
- Test database updates
- Test filesystem errors

**Estimated Effort**: 3-4 hours

---

### 3.3 Derivatives Worker Tests
**File**: `server/services/workers/__tests__/derivativesWorker.test.js`

**Function to Test**:
- `runGenerateDerivatives(job)` - Generates thumbnails and previews

**Test Cases**:
- Test thumbnail generation
- Test preview generation
- Test various image formats
- Test error handling

**Estimated Effort**: 3-4 hours

---

### 3.4 Folder Discovery Worker Tests
**File**: `server/services/workers/__tests__/folderDiscoveryWorker.test.js`

**Function to Test**:
- `runFolderDiscovery(job)` - Auto-discovers new projects

**Test Cases**:
- Test discovery of new folders
- Test skipping existing projects
- Test invalid folder names

**Estimated Effort**: 2-3 hours

---

### 3.5 Project Scavenge Worker Tests
**File**: `server/services/workers/__tests__/projectScavengeWorker.test.js`

**Function to Test**:
- `runProjectScavenge(job)` - Cleans up archived projects

**Test Cases**:
- Test cleanup of archived projects
- Test preservation of active projects

**Estimated Effort**: 2-3 hours

---

## Testing Infrastructure

### Test Utilities Needed

**1. Worker Test Helpers** (`server/services/workers/__tests__/workerTestUtils.js`):
```javascript
// Mock filesystem operations
function mockFs() { ... }

// Mock job objects
function createMockJob(type, project_id, payload) { ... }

// Verify filesystem state
function assertFileExists(path) { ... }
function assertFileNotExists(path) { ... }

// Verify database state
function assertProjectExists(id) { ... }
function assertProjectNotExists(id) { ... }
```

**2. Fixture Extensions** (extend existing `dataFixtures.js`):
```javascript
// Create project with files on disk
function createProjectWithFiles(name, files) { ... }

// Create project with photos and tags
function createProjectWithPhotos(name, photoCount) { ... }

// Create orphaned project (DB only, no folder)
function createOrphanedProject(name) { ... }
```

---

## Test Execution Strategy

### Phase 1: Critical Operations (Week 1)
1. Project Deletion Worker (Day 1-2)
2. Orphaned Project Cleanup (Day 2-3)
3. Folder Alignment (Day 3-4)

### Phase 2: Data Integrity (Week 2)
4. Duplicate Resolution (Day 1)
5. Manifest Operations (Day 2-3)
6. Trash Maintenance (Day 3)
7. Cache Validation (Day 4)

### Phase 3: Remaining Workers (Week 3)
8. File Removal Worker (Day 1)
9. Image Move Worker (Day 2)
10. Derivatives Worker (Day 3)
11. Folder Discovery Worker (Day 4)
12. Project Scavenge Worker (Day 4)

---

## Success Criteria

### Coverage Metrics
- ✅ All worker functions have at least 1 test
- ✅ All destructive operations have error case tests
- ✅ All transaction logic has rollback tests
- ✅ All filesystem operations have error handling tests

### Quality Metrics
- ✅ Tests are isolated (no cross-test dependencies)
- ✅ Tests clean up after themselves
- ✅ Tests use fixtures for test data
- ✅ Tests verify both success and failure paths
- ✅ Tests verify logging output

### Risk Reduction
- ✅ High-risk operations (immediate deletion) fully tested
- ✅ Data integrity operations verified
- ✅ Error handling paths validated
- ✅ Transaction behavior confirmed

---

## Estimated Total Effort

| Priority | Component | Effort |
|----------|-----------|--------|
| P1 | Project Deletion Worker | 4-6 hours |
| P1 | Orphaned Project Cleanup | 3-4 hours |
| P1 | Folder Alignment | 4-5 hours |
| P2 | Duplicate Resolution | 3-4 hours |
| P2 | Manifest Operations | 5-6 hours |
| P2 | Trash Maintenance | 2-3 hours |
| P2 | Cache Validation | 2-3 hours |
| P3 | File Removal Worker | 2-3 hours |
| P3 | Image Move Worker | 3-4 hours |
| P3 | Derivatives Worker | 3-4 hours |
| P3 | Folder Discovery Worker | 2-3 hours |
| P3 | Project Scavenge Worker | 2-3 hours |
| Infrastructure | Test utilities & fixtures | 4-6 hours |
| **Total** | | **40-54 hours** |

**Timeline**: 2-3 weeks with dedicated focus

---

## Implementation Notes

### Key Principles
1. **Test destructive operations first** - highest risk
2. **Mock filesystem where appropriate** - avoid actual file I/O in most tests
3. **Use real database** - SQLite in-memory for speed
4. **Verify logging** - ensure operations are observable
5. **Test error paths** - not just happy path

### Common Patterns
```javascript
// Standard worker test structure
describe('Worker Name', { concurrency: false }, () => {
  let fixtures;
  
  beforeEach(() => {
    fixtures = createFixtureTracker();
  });
  
  afterEach(() => {
    fixtures.cleanup();
  });
  
  test('operation succeeds with valid data', async () => {
    // Arrange
    const project = fixtures.createProject('Test');
    const job = { id: 1, project_id: project.id };
    
    // Act
    await workerFunction(job);
    
    // Assert
    assert.equal(/* expected state */);
  });
  
  test('operation handles errors gracefully', async () => {
    // Test error path
  });
});
```

---

## Next Steps

1. **Review this plan** with team
2. **Set up test infrastructure** (utilities, fixtures)
3. **Start with Priority 1** (most critical)
4. **Run tests in CI/CD** pipeline
5. **Update documentation** as tests are added

---

## References

- Current test coverage analysis: `tasks_progress/test_coverage_analysis_nov17.md`
- Existing test examples: `server/routes/__tests__/`
- Worker implementations: `server/services/workers/`
- Jobs overview: `project_docs/JOBS_OVERVIEW.md`
