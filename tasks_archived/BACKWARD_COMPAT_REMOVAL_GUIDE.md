# Backward Compatibility Removal Guide

**Quick Reference for Removing Backward Compatibility Code**

---

## Quick Search Commands

### Find All Backward Compatibility Code
```bash
# Search for backward compatibility comments
grep -r "BACKWARD COMPATIBILITY" server/

# Search for fallback patterns
grep -r "|| 'project'" server/

# Search for DEFAULT in schema
grep -r "DEFAULT 'project'" server/
```

### Expected Results
You should find **8 locations** across **3 files**:
1. `server/services/db.js` - 4 locations
2. `server/services/repositories/jobsRepo.js` - 2 locations
3. `server/services/tasksOrchestrator.js` - 2 locations

---

## Removal Order (By Phase)

### Phase 1: Database Migration Complete
**When**: After all production databases have scope column and correct FK

**Remove**:
1. `db.js` Line 180: `fixJobItemsForeignKey(db);` call
2. `db.js` Lines 183-230: Entire `fixJobItemsForeignKey()` function
3. `db.js` Line 150: `ensureColumn` for scope

**Test**:
```sql
-- Verify scope column exists
SELECT scope, COUNT(*) FROM jobs GROUP BY scope;

-- Verify FK is correct
SELECT sql FROM sqlite_master WHERE type='table' AND name='job_items';
-- Should reference "jobs", not "jobs_legacy"
```

---

### Phase 2: Old Jobs Processed
**When**: After all jobs with NULL scope are completed

**Remove**:
1. `jobsRepo.js` Line 22: Change `row.scope || 'project'` to just `row.scope`
2. `tasksOrchestrator.js` Line 86: Change `job.scope || 'project'` to just `job.scope`

**Test**:
```sql
-- Should return 0
SELECT COUNT(*) FROM jobs WHERE scope IS NULL;
```

**Code Changes**:
```javascript
// Before
scope: row.scope || 'project',

// After
scope: row.scope,
```

---

### Phase 3: Code Refactored
**When**: After all callers pass explicit scope

**Remove**:
1. `jobsRepo.js` Lines 70-73: Scope auto-detection
2. `tasksOrchestrator.js` Lines 22-25: Scope auto-detection
3. `db.js` Line 107: Remove `DEFAULT 'project'` (keep `NOT NULL`)

**Make scope required**:
```javascript
// jobsRepo.js - enqueue()
function enqueue({ tenant_id, project_id = null, type, payload = null, progress_total = null, priority = 0, scope }) {
  // scope is now required, no default
  if (!scope) throw new Error('scope is required');
  // ... rest of function
}

// tasksOrchestrator.js - startTask()
const effectiveScope = scope || def.scope;
if (!effectiveScope) throw new Error('Task definition missing scope');
```

**Schema Change**:
```sql
-- Remove DEFAULT but keep NOT NULL
-- This requires recreating the table (SQLite limitation)
-- Or just leave it - DEFAULT doesn't hurt, just unnecessary
```

---

### Phase 4: Validation
**When**: After all changes deployed and tested

**Verify**:
- [ ] No `|| 'project'` fallbacks in code
- [ ] All `enqueue()` calls pass explicit scope
- [ ] All task definitions have scope field
- [ ] No jobs with NULL scope in database
- [ ] All tests passing
- [ ] Production monitoring shows no errors

**Final Cleanup**:
- [ ] Delete `job_refactoring_backwardcompatibilitynotes.md`
- [ ] Delete `BACKWARD_COMPAT_REMOVAL_GUIDE.md` (this file)
- [ ] Update documentation to remove "backward compatibility" mentions

---

## Verification Checklist

### Before Starting Removal
```bash
# Count backward compat locations (should be 8)
grep -c "BACKWARD COMPATIBILITY" server/services/db.js
grep -c "BACKWARD COMPATIBILITY" server/services/repositories/jobsRepo.js
grep -c "BACKWARD COMPATIBILITY" server/services/tasksOrchestrator.js

# Check for old jobs
sqlite3 .projects/db/user_0.sqlite "SELECT COUNT(*) FROM jobs WHERE scope IS NULL;"
```

### After Phase 1
```bash
# Should find 0 results
grep -r "fixJobItemsForeignKey" server/

# Should find 0 results for ensureColumn scope
grep "ensureColumn.*scope" server/services/db.js
```

### After Phase 2
```bash
# Should find 0 results
grep "row.scope || 'project'" server/
grep "job.scope || 'project'" server/
```

### After Phase 3
```bash
# Should find 0 results
grep "|| 'project'" server/
grep "effectiveScope = scope ||" server/
```

### Final Verification
```bash
# Should find 0 results
grep -r "BACKWARD COMPATIBILITY" server/
grep -r "TODO.*backward" server/
```

---

## Rollback Procedures

### If Issues Found After Phase 1
```bash
git revert <commit-hash>
# Re-run migration
# Investigate why some DBs weren't migrated
```

### If Issues Found After Phase 2
```javascript
// Add back fallbacks temporarily
scope: row.scope || 'project',
const scope = job.scope || 'project';

// Find and fix jobs with NULL scope
// Then retry removal
```

### If Issues Found After Phase 3
```javascript
// Add back auto-detection temporarily
const effectiveScope = scope || def.scope || (project_id ? 'project' : 'photo_set');

// Update all callers to pass explicit scope
// Then retry removal
```

---

## Common Issues

### Issue: Jobs with NULL scope still exist
**Solution**: Wait for them to complete or manually update:
```sql
UPDATE jobs SET scope = 'project' WHERE scope IS NULL AND project_id IS NOT NULL;
UPDATE jobs SET scope = 'photo_set' WHERE scope IS NULL AND project_id IS NULL;
```

### Issue: Foreign key constraint errors
**Solution**: Run fixJobItemsForeignKey migration again:
```javascript
// In db.js, temporarily re-enable the function
fixJobItemsForeignKey(db);
```

### Issue: Callers not passing scope
**Solution**: Find all callers and update:
```bash
# Find all enqueue calls
grep -r "jobsRepo.enqueue" server/

# Find all startTask calls
grep -r "tasksOrchestrator.startTask" server/

# Update each to pass explicit scope
```

---

## Timeline Estimate

### Phase 1: Immediate (After DB Migration)
- **Duration**: 1 day
- **Risk**: Low (migration is automatic)
- **Rollback**: Easy (git revert)

### Phase 2: After Old Jobs Complete
- **Duration**: 1-2 weeks (wait for jobs to complete)
- **Risk**: Low (only affects old jobs)
- **Rollback**: Easy (add back fallbacks)

### Phase 3: After Code Refactor
- **Duration**: 2-4 weeks (update all callers)
- **Risk**: Medium (requires code changes)
- **Rollback**: Medium (need to update callers again)

### Phase 4: Validation
- **Duration**: 1 week (monitoring)
- **Risk**: Low (just verification)
- **Rollback**: N/A (no changes)

**Total Estimated Time**: 4-7 weeks

---

## Success Criteria

### Phase 1 Complete
- ✅ All databases have scope column
- ✅ All databases have correct job_items FK
- ✅ No migration errors in logs
- ✅ Tests passing

### Phase 2 Complete
- ✅ No jobs with NULL scope
- ✅ No fallback code for scope
- ✅ Tests passing
- ✅ No production errors

### Phase 3 Complete
- ✅ All callers pass explicit scope
- ✅ No auto-detection code
- ✅ Tests passing
- ✅ No production errors

### Phase 4 Complete
- ✅ All backward compat code removed
- ✅ Documentation updated
- ✅ Production stable for 1+ week
- ✅ This document deleted

---

## Related Documents

- `job_refactoring_backwardcompatibilitynotes.md` - Detailed tracking
- `jobs_refactoring_progress.md` - Overall progress
- `REFACTORING_SUMMARY.md` - Complete summary
