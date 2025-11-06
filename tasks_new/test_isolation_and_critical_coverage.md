# Test Isolation & Critical Coverage Expansion
**Created**: 2025-11-06  
**Status**: 📋 Planning  
**Priority**: P0 (Foundation) + P1 (Critical Gaps)

## Executive Summary

This task addresses two critical needs:
1. **Test Isolation**: Move all test operations to `.projects-test/` to prevent pollution of real data
2. **Critical Coverage**: Add missing tests for upload, pagination, bulk operations, and project lifecycle

## Problem Statement

### Current Issues
- ❌ Tests use production `.projects/` directory (risk of data pollution)
- ❌ No isolation between test runs and development work
- ❌ Critical business logic untested (uploads, pagination, bulk ops)
- ❌ Test fixtures (`test_content/`) not integrated into test suite

### Desired State
- ✅ All tests use isolated `.projects-test/` directory
- ✅ Real photo fixtures available for upload/processing tests
- ✅ Complete cleanup after every test run
- ✅ Critical endpoints fully tested
- ✅ Zero risk of test data polluting development work

---

## Phase 1: Test Isolation Infrastructure (P0)

### Objective
Refactor test infrastructure to use `.projects-test/` for complete isolation from production data.

### 1.1 Environment Variable Approach

**Strategy**: Use `NODE_ENV=test` to automatically switch to test directory

**Implementation**:
```javascript
// server/services/fsUtils.js
const PROJECTS_DIR = process.env.NODE_ENV === 'test' 
  ? path.join(__dirname, '..', '..', '.projects-test')
  : path.join(__dirname, '..', '..', '.projects');
```

**Benefits**:
- ✅ Automatic isolation when running `npm test`
- ✅ No code changes needed in tests
- ✅ Works for all file system operations
- ✅ Easy to verify isolation

### 1.2 Test Database Isolation

**Strategy**: Use separate SQLite database for tests

**Options**:
1. **In-memory database** (`:memory:`) - Fast but no persistence
2. **Separate file** (`photo_manager.test.db`) - Persistent, easier debugging
3. **Per-test database** - Maximum isolation, slower

**Recommendation**: Option 2 (separate file) for balance of speed and debuggability

**Implementation**:
```javascript
// server/services/db.js
const DB_PATH = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, '..', '..', 'photo_manager.test.db')
  : path.join(__dirname, '..', '..', 'photo_manager.db');
```

### 1.3 Test Fixtures Integration

**Strategy**: Copy `test_content/` files into test projects as needed

**Fixture Structure**:
```
test_content/
├── DSC02215.ARW (20MB, Sony RAW, portrait orientation)
├── DSC02215.JPG (14MB, paired with ARW)
├── DSC03890.ARW (21MB, Sony RAW, landscape orientation)
└── DSC03890.JPG (19MB, paired with ARW)
```

**Fixture Helper**:
```javascript
// server/tests/utils/testFixtures.js
const TEST_FIXTURES = {
  PORTRAIT_RAW: 'DSC02215.ARW',
  PORTRAIT_JPG: 'DSC02215.JPG',
  LANDSCAPE_RAW: 'DSC03890.ARW',
  LANDSCAPE_JPG: 'DSC03890.JPG',
};

async function copyFixtureToProject(fixtureName, projectFolder) {
  const src = path.join(__dirname, '..', '..', '..', 'test_content', fixtureName);
  const dest = path.join(PROJECTS_ROOT, projectFolder, fixtureName);
  await fs.copy(src, dest);
  return dest;
}

async function seedProjectWithFixtures(projectFolder, fixtures = []) {
  const projectPath = path.join(PROJECTS_ROOT, projectFolder);
  await fs.ensureDir(projectPath);
  
  const copiedFiles = [];
  for (const fixture of fixtures) {
    const dest = await copyFixtureToProject(fixture, projectFolder);
    copiedFiles.push(dest);
  }
  
  return copiedFiles;
}
```

### 1.4 Enhanced Cleanup

**Strategy**: Ensure complete cleanup of test directory and database

**Implementation**:
```javascript
// server/tests/utils/dataFixtures.js (updated)

function cleanupTestEnvironment() {
  const db = getDb();
  
  // 1. Clean database
  db.prepare('DELETE FROM photo_public_hashes').run();
  db.prepare('DELETE FROM photo_public_links').run();
  db.prepare('DELETE FROM public_links').run();
  db.prepare('DELETE FROM photo_tags').run();
  db.prepare('DELETE FROM job_items').run();
  db.prepare('DELETE FROM jobs').run();
  db.prepare('DELETE FROM photos').run();
  db.prepare('DELETE FROM projects').run();
  
  // 2. Clean file system
  const testProjectsRoot = path.join(__dirname, '..', '..', '..', '.projects-test');
  if (fs.existsSync(testProjectsRoot)) {
    fs.removeSync(testProjectsRoot);
  }
  fs.ensureDirSync(path.join(testProjectsRoot, 'user_0'));
}
```

### 1.5 CI/CD Integration

**Strategy**: Ensure tests run in isolation in CI environment

**GitHub Actions** (`.github/workflows/ci.yml`):
```yaml
- name: Run tests
  run: npm test
  env:
    NODE_ENV: test
    
- name: Verify test isolation
  run: |
    # Ensure .projects/ is untouched
    if [ -d ".projects/user_0" ] && [ "$(ls -A .projects/user_0)" ]; then
      echo "ERROR: Tests polluted .projects/ directory"
      exit 1
    fi
    
    # Ensure .projects-test/ was used
    if [ ! -d ".projects-test" ]; then
      echo "ERROR: Tests did not create .projects-test/"
      exit 1
    fi
```

### 1.6 Files to Modify

| File | Changes | Effort |
|------|---------|--------|
| `server/services/fsUtils.js` | Add `NODE_ENV` check for `PROJECTS_DIR` | 5 min |
| `server/services/db.js` | Add `NODE_ENV` check for DB path | 5 min |
| `server/tests/utils/dataFixtures.js` | Update `PROJECTS_ROOT` to use test dir | 10 min |
| `server/tests/utils/testFixtures.js` | **NEW FILE** - Fixture helpers | 30 min |
| `package.json` | Update test script to set `NODE_ENV=test` | 2 min |
| `.gitignore` | Add `.projects-test/` and `photo_manager.test.db` | 2 min |
| `.github/workflows/ci.yml` | Add isolation verification | 10 min |

**Total Effort**: ~1 hour

---

## Phase 2: Critical Coverage - Uploads (P0)

### Objective
Test the primary photo ingestion path with real fixtures and conflict handling.

### 2.1 Upload Basic Scenarios

**File**: `server/routes/__tests__/uploadsBasic.test.js`

**Test Cases**:
```javascript
describe('Photo Upload - Basic Scenarios', () => {
  // Setup: Create test project, copy fixtures
  
  test('upload new JPG creates photo record and enqueues derivative job', async () => {
    // Upload DSC02215.JPG
    // Assert: photo record created
    // Assert: generate_derivatives job enqueued
    // Assert: file copied to project folder
  });
  
  test('upload paired RAW+JPG creates single photo with both formats', async () => {
    // Upload DSC02215.ARW + DSC02215.JPG
    // Assert: single photo record
    // Assert: jpg_available=true, raw_available=true
    // Assert: both files in project folder
  });
  
  test('upload extracts EXIF metadata', async () => {
    // Upload DSC02215.JPG
    // Assert: date_time_original = '2025-07-18 09:18:44'
    // Assert: meta_json contains camera model, orientation, etc.
  });
  
  test('upload validates file types', async () => {
    // Upload invalid file (e.g., .txt)
    // Assert: 400 error
    // Assert: no photo record created
  });
  
  test('upload enforces file size limits', async () => {
    // Mock large file (>100MB)
    // Assert: 413 error
    // Assert: no photo record created
  });
});
```

**Estimated Tests**: 8-10 tests  
**Effort**: 3-4 hours

### 2.2 Upload Conflict Handling

**File**: `server/routes/__tests__/uploadsConflicts.test.js`

**Test Cases**:
```javascript
describe('Photo Upload - Conflict Resolution', () => {
  
  test('duplicate within project: skip=ON overwrites existing photo', async () => {
    // 1. Upload DSC02215.JPG
    // 2. Upload DSC02215.JPG again with skip=false
    // Assert: photo record updated
    // Assert: file overwritten
  });
  
  test('duplicate within project: skip=OFF skips upload', async () => {
    // 1. Upload DSC02215.JPG
    // 2. Upload DSC02215.JPG again with skip=true
    // Assert: photo record unchanged
    // Assert: file not overwritten
  });
  
  test('cross-project conflict: move=ON returns 202 and enqueues image_move job', async () => {
    // 1. Upload DSC02215.JPG to project A
    // 2. Upload DSC02215.JPG to project B with move=true
    // Assert: 202 response
    // Assert: image_move job enqueued
    // Assert: no direct file upload
  });
  
  test('cross-project conflict: move=OFF skips upload', async () => {
    // 1. Upload DSC02215.JPG to project A
    // 2. Upload DSC02215.JPG to project B with move=false
    // Assert: 200 response
    // Assert: conflict reported in response
    // Assert: photo remains in project A
  });
  
  test('format completion: upload RAW when JPG exists', async () => {
    // 1. Upload DSC02215.JPG
    // 2. Upload DSC02215.ARW
    // Assert: single photo record
    // Assert: raw_available=true
    // Assert: both files exist
  });
  
  test('analyze-files endpoint returns conflict preview', async () => {
    // 1. Upload DSC02215.JPG to project A
    // 2. POST /api/projects/projectB/analyze-files with DSC02215.JPG
    // Assert: conflict detected
    // Assert: conflict type = 'cross_project'
    // Assert: source project identified
  });
});
```

**Estimated Tests**: 10-12 tests  
**Effort**: 4-5 hours

### 2.3 Upload Integration

**File**: `server/routes/__tests__/uploadsIntegration.test.js`

**Test Cases**:
```javascript
describe('Photo Upload - Integration', () => {
  
  test('upload triggers derivative generation and SSE events', async () => {
    // Mock SSE listener
    // Upload DSC02215.JPG
    // Assert: job_created event emitted
    // Assert: item event emitted when processing completes
  });
  
  test('upload with multipart errors returns 400', async () => {
    // Send malformed multipart request
    // Assert: 400 error
    // Assert: no photo record created
  });
  
  test('concurrent uploads to same project are handled safely', async () => {
    // Upload 2 different files simultaneously
    // Assert: both photos created
    // Assert: no race conditions
  });
});
```

**Estimated Tests**: 5-6 tests  
**Effort**: 2-3 hours

**Total Upload Tests**: 23-28 tests  
**Total Effort**: 9-12 hours

---

## Phase 3: Critical Coverage - Pagination (P1)

### Objective
Test bidirectional cursor-based pagination with sorting and filtering.

### 3.1 All Photos Pagination

**File**: `server/routes/__tests__/photosPaginationAll.test.js`

**Test Cases**:
```javascript
describe('All Photos Pagination', () => {
  // Setup: Create 3 projects with 10 photos each (30 total)
  
  test('forward pagination returns correct pages', async () => {
    // GET /api/photos?limit=10
    // Assert: 10 photos returned
    // Assert: next_cursor present
    // Assert: prev_cursor null
    
    // GET /api/photos?limit=10&cursor={next_cursor}
    // Assert: next 10 photos
    // Assert: no overlap with page 1
  });
  
  test('backward pagination returns correct pages', async () => {
    // Navigate to page 3
    // GET /api/photos?limit=10&before_cursor={cursor}
    // Assert: page 2 photos
    // Assert: prev_cursor present
  });
  
  test('pagination with sort=date DESC', async () => {
    // GET /api/photos?limit=10&sort=date&dir=desc
    // Assert: photos ordered by date descending
    // Assert: cursor-based pagination works
  });
  
  test('pagination with filters', async () => {
    // GET /api/photos?limit=10&file_type=jpg&keep_type=jpg_only
    // Assert: only JPG-only photos returned
    // Assert: unfiltered_total includes all photos
    // Assert: pagination cursors work with filters
  });
  
  test('last page has no next_cursor', async () => {
    // Navigate to last page
    // Assert: next_cursor is null
    // Assert: photos.length <= limit
  });
  
  test('invalid cursor returns 400', async () => {
    // GET /api/photos?cursor=invalid
    // Assert: 400 error
  });
});
```

**Estimated Tests**: 10-12 tests  
**Effort**: 3-4 hours

### 3.2 Project Pagination

**File**: `server/routes/__tests__/photosPaginationProject.test.js`

**Test Cases**:
```javascript
describe('Project Photos Pagination', () => {
  // Setup: Create project with 50 photos
  
  test('project pagination works identically to all photos', async () => {
    // GET /api/projects/{folder}/photos?limit=10
    // Assert: same behavior as /api/photos
  });
  
  test('project pagination respects project boundary', async () => {
    // Create 2 projects with photos
    // GET /api/projects/project1/photos
    // Assert: only project1 photos returned
  });
  
  test('sort changes reset pagination', async () => {
    // GET /api/projects/{folder}/photos?sort=name&dir=asc
    // Change to sort=date&dir=desc
    // Assert: pagination resets to page 1
  });
});
```

**Estimated Tests**: 6-8 tests  
**Effort**: 2-3 hours

**Total Pagination Tests**: 16-20 tests  
**Total Effort**: 5-7 hours

---

## Phase 4: Critical Coverage - Bulk Operations (P1)

### Objective
Test image-scoped bulk operations across projects with dry-run support.

### 4.1 Bulk Tag Operations

**File**: `server/routes/__tests__/photosBulkTags.test.js`

**Test Cases**:
```javascript
describe('Bulk Tag Operations', () => {
  
  test('POST /api/photos/tags/add adds tags to multiple photos', async () => {
    // Create 3 photos
    // POST /api/photos/tags/add { photo_ids: [...], tags: ['portrait', 'outdoor'] }
    // Assert: all photos have new tags
    // Assert: existing tags preserved
  });
  
  test('POST /api/photos/tags/remove removes tags from multiple photos', async () => {
    // Create photos with tags
    // POST /api/photos/tags/remove { photo_ids: [...], tags: ['portrait'] }
    // Assert: specified tags removed
    // Assert: other tags preserved
  });
  
  test('bulk tag operations work across projects', async () => {
    // Create photos in 2 different projects
    // Add tags to both
    // Assert: tags added to photos in both projects
  });
  
  test('dry_run=true previews changes without applying', async () => {
    // POST /api/photos/tags/add?dry_run=true
    // Assert: response shows what would change
    // Assert: no actual changes made
  });
  
  test('invalid photo_id returns error', async () => {
    // POST /api/photos/tags/add { photo_ids: [999999] }
    // Assert: 400 or 404 error
  });
});
```

**Estimated Tests**: 8-10 tests  
**Effort**: 2-3 hours

### 4.2 Bulk Keep Operations

**File**: `server/routes/__tests__/photosBulkKeep.test.js`

**Test Cases**:
```javascript
describe('Bulk Keep Operations', () => {
  
  test('POST /api/photos/keep updates keep flags', async () => {
    // Create photos with paired RAW+JPG
    // POST /api/photos/keep { photo_ids: [...], keep_jpg: true, keep_raw: false }
    // Assert: keep flags updated
  });
  
  test('bulk keep works across projects', async () => {
    // Create photos in multiple projects
    // Update keep flags
    // Assert: all updated correctly
  });
  
  test('dry_run previews keep changes', async () => {
    // POST /api/photos/keep?dry_run=true
    // Assert: preview returned
    // Assert: no changes applied
  });
});
```

**Estimated Tests**: 6-8 tests  
**Effort**: 2 hours

### 4.3 Bulk Move Operations

**File**: `server/routes/__tests__/photosBulkMove.test.js`

**Test Cases**:
```javascript
describe('Bulk Move Operations', () => {
  
  test('POST /api/photos/move enqueues image_move jobs', async () => {
    // Create photos in project A
    // POST /api/photos/move { photo_ids: [...], dest_folder: 'projectB' }
    // Assert: image_move jobs enqueued
    // Assert: 202 response
  });
  
  test('bulk move validates destination project exists', async () => {
    // POST /api/photos/move { dest_folder: 'nonexistent' }
    // Assert: 400 error
  });
  
  test('dry_run previews move operation', async () => {
    // POST /api/photos/move?dry_run=true
    // Assert: preview shows source/dest
    // Assert: no jobs enqueued
  });
});
```

**Estimated Tests**: 5-6 tests  
**Effort**: 2 hours

### 4.4 Bulk Process Operations

**File**: `server/routes/__tests__/photosBulkProcess.test.js`

**Test Cases**:
```javascript
describe('Bulk Process Operations', () => {
  
  test('POST /api/photos/process enqueues derivative jobs', async () => {
    // Create photos
    // POST /api/photos/process { photo_ids: [...] }
    // Assert: generate_derivatives jobs enqueued
  });
  
  test('force=true reprocesses existing derivatives', async () => {
    // Create photos with derivatives
    // POST /api/photos/process?force=true
    // Assert: jobs enqueued even with existing derivatives
  });
});
```

**Estimated Tests**: 4-5 tests  
**Effort**: 1-2 hours

**Total Bulk Operations Tests**: 23-29 tests  
**Total Effort**: 7-10 hours

---

## Phase 5: Critical Coverage - Project Lifecycle (P1)

### Objective
Test project CRUD operations and folder management.

### 5.1 Project Creation

**File**: `server/routes/__tests__/projectsCreate.test.js`

**Test Cases**:
```javascript
describe('Project Creation', () => {
  
  test('POST /api/projects creates project with unique folder', async () => {
    // POST /api/projects { name: 'Test Project' }
    // Assert: project created
    // Assert: folder name is sanitized slug
    // Assert: folder exists on file system
  });
  
  test('duplicate project names get (n) suffix', async () => {
    // Create 'Test Project'
    // Create 'Test Project' again
    // Assert: second project has folder 'test-project--p{id}'
  });
  
  test('project creation requires authentication', async () => {
    // POST /api/projects without auth
    // Assert: 401 error
  });
});
```

**Estimated Tests**: 5-6 tests  
**Effort**: 1-2 hours

### 5.2 Project Updates

**File**: `server/routes/__tests__/projectsUpdate.test.js`

**Test Cases**:
```javascript
describe('Project Updates', () => {
  
  test('PATCH /api/projects/:folder updates project metadata', async () => {
    // Create project
    // PATCH /api/projects/{folder} { name: 'New Name' }
    // Assert: name updated
    // Assert: folder name unchanged (stable)
  });
  
  test('archive/unarchive changes status', async () => {
    // PATCH /api/projects/{folder} { status: 'archived' }
    // Assert: status updated
    // Assert: project hidden from default list
  });
  
  test('cannot update canceled project', async () => {
    // Create project, set status='canceled'
    // PATCH /api/projects/{folder}
    // Assert: 400 or 403 error
  });
});
```

**Estimated Tests**: 6-8 tests  
**Effort**: 2 hours

### 5.3 Project Deletion

**File**: `server/routes/__tests__/projectsDelete.test.js`

**Test Cases**:
```javascript
describe('Project Deletion', () => {
  
  test('DELETE /api/projects/:folder enqueues deletion job', async () => {
    // Create project with photos
    // DELETE /api/projects/{folder}
    // Assert: project_deletion job enqueued
    // Assert: project status set to 'canceled'
  });
  
  test('deletion job removes photos and files', async () => {
    // Create project with photos
    // Trigger deletion
    // Execute deletion job
    // Assert: photos deleted from DB
    // Assert: folder removed from file system
  });
  
  test('cannot delete already canceled project', async () => {
    // Create project, set status='canceled'
    // DELETE /api/projects/{folder}
    // Assert: 400 error
  });
});
```

**Estimated Tests**: 5-6 tests  
**Effort**: 2-3 hours

**Total Project Lifecycle Tests**: 16-20 tests  
**Total Effort**: 5-7 hours

---

## Phase 6: Documentation & Polish

### 6.1 Testing Documentation

**File**: `project_docs/TESTING_OVERVIEW.md`

**Contents**:
```markdown
# Testing Overview

## Running Tests
npm test                    # Run all tests
npm test -- --test-name-pattern="upload"  # Run specific suite

## Test Isolation
- Tests use `.projects-test/` directory
- Tests use `photo_manager.test.db` database
- Complete cleanup after each test
- Real photo fixtures in `test_content/`

## Writing Tests
- Use `createFixtureTracker()` for cleanup
- Use `seedProjectWithFixtures()` for real photos
- Use `withAuthEnv()` for environment isolation
- Follow existing patterns in `__tests__/` directories

## Test Fixtures
- DSC02215.ARW/JPG: Portrait orientation, 20MB/14MB
- DSC03890.ARW/JPG: Landscape orientation, 21MB/19MB

## Coverage Expectations
- Security boundaries: 100%
- CRUD operations: 90%+
- Business logic: 80%+
- Edge cases: 70%+

## CI Integration
- Tests run on every PR
- Isolation verified automatically
- Coverage reports generated
```

**Effort**: 1-2 hours

### 6.2 Update Existing Documentation

**Files to Update**:
- `project_docs/PROJECT_OVERVIEW.md` - Add testing section
- `project_docs/SCHEMA_DOCUMENTATION.md` - Reference test coverage
- `README.md` - Add testing instructions
- `project_docs/SECURITY.md` - Note test isolation security

**Effort**: 1 hour

### 6.3 Add Coverage Reporting

**Implementation**:
```bash
npm install --save-dev c8
```

**package.json**:
```json
{
  "scripts": {
    "test": "NODE_ENV=test node --test --test-concurrency=1",
    "test:coverage": "NODE_ENV=test c8 --reporter=html --reporter=text node --test --test-concurrency=1",
    "test:watch": "NODE_ENV=test node --test --watch"
  }
}
```

**Effort**: 30 minutes

---

## Implementation Timeline

### Week 1: Foundation (Phase 1 + Phase 2)
- **Day 1**: Test isolation infrastructure (1 hour)
- **Day 2-3**: Upload basic scenarios (4 hours)
- **Day 4-5**: Upload conflict handling (5 hours)

**Deliverables**: 
- ✅ Test isolation complete
- ✅ 23-28 upload tests
- ✅ Real fixtures integrated

### Week 2: Critical Coverage (Phase 3 + Phase 4)
- **Day 1-2**: Pagination tests (7 hours)
- **Day 3-4**: Bulk operations tests (10 hours)

**Deliverables**:
- ✅ 16-20 pagination tests
- ✅ 23-29 bulk operation tests

### Week 3: Lifecycle & Polish (Phase 5 + Phase 6)
- **Day 1-2**: Project lifecycle tests (7 hours)
- **Day 3**: Documentation (3 hours)

**Deliverables**:
- ✅ 16-20 project lifecycle tests
- ✅ TESTING_OVERVIEW.md
- ✅ Coverage reporting

---

## Success Criteria

### Test Isolation
- ✅ All tests use `.projects-test/` directory
- ✅ Zero pollution of `.projects/` directory
- ✅ Complete cleanup after every test run
- ✅ CI verification of isolation

### Test Coverage
- ✅ 78 existing tests (baseline)
- ✅ +78-97 new tests (target: 156-175 total)
- ✅ ~70% code coverage (from ~40%)
- ✅ 100% pass rate maintained

### Critical Paths Covered
- ✅ Upload & conflict resolution (P0)
- ✅ Pagination (P1)
- ✅ Bulk operations (P1)
- ✅ Project lifecycle (P1)

### Documentation
- ✅ TESTING_OVERVIEW.md created
- ✅ All major docs updated
- ✅ Coverage reporting enabled

---

## Risk Assessment

### Low Risk ✅
- Test isolation (well-defined, low complexity)
- Fixture integration (straightforward file copying)
- Documentation (no code changes)

### Medium Risk ⚠️
- Upload testing (requires multipart handling, Sharp mocking)
- Pagination testing (complex cursor logic)
- Bulk operations (cross-project complexity)

### Mitigation Strategies
1. **Start with isolation** - Foundation must be solid
2. **Use real fixtures** - Avoid mocking Sharp where possible
3. **Test incrementally** - One endpoint at a time
4. **Verify cleanup** - Check `.projects-test/` after each run
5. **CI integration** - Catch issues early

---

## Dependencies

### Required
- ✅ Node.js 22 (already installed)
- ✅ Test fixtures in `test_content/` (already present)
- ✅ Existing test infrastructure (already built)

### Optional
- ⏳ `c8` for coverage reporting (to be installed)
- ⏳ CI/CD pipeline updates (to be configured)

---

## Estimated Total Effort

| Phase | Effort | Priority |
|-------|--------|----------|
| Phase 1: Test Isolation | 1 hour | P0 |
| Phase 2: Upload Tests | 9-12 hours | P0 |
| Phase 3: Pagination Tests | 5-7 hours | P1 |
| Phase 4: Bulk Operations | 7-10 hours | P1 |
| Phase 5: Project Lifecycle | 5-7 hours | P1 |
| Phase 6: Documentation | 3-4 hours | P2 |
| **TOTAL** | **30-41 hours** | **~1 week** |

**Timeline**: 3 weeks with focused effort (1-2 hours/day)

---

## Next Steps

1. **Review & Approve** this plan
2. **Phase 1**: Implement test isolation (1 hour)
3. **Verify isolation**: Run existing tests, check `.projects-test/` created
4. **Phase 2**: Start with upload basic tests
5. **Iterate**: Complete one phase before moving to next

---

## Notes

- All new tests follow existing patterns from `dataFixtures.js`
- Real photo fixtures enable authentic testing (EXIF, Sharp processing)
- Test isolation prevents any risk to production data
- Incremental approach allows early validation of infrastructure
- Coverage will increase from ~40% to ~70% (target met)

---

**Status**: 📋 Ready for implementation  
**Approval Required**: Yes  
**Estimated Completion**: 3 weeks from start
