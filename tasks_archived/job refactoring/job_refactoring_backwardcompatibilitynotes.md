# Job Refactoring Backward Compatibility Notes

**Created**: 2025-10-01  
**Purpose**: Document all backward compatibility code that can be removed in future versions

---

## Overview

This document tracks all code added for backward compatibility during the jobs refactoring. These sections maintain compatibility with existing jobs, task definitions, and API calls, but can be removed once all jobs have been migrated to the new scope-aware system.

**Removal Timeline**: After all existing jobs are completed and the system has been running scope-aware for at least one maintenance cycle.

---

## Database Schema

### File: `server/services/db.js`

#### Line 105: Default scope value
```javascript
scope TEXT NOT NULL DEFAULT 'project',
```

**Why**: Existing jobs in the database don't have a scope column. The DEFAULT ensures they're treated as project-scoped.

**Removal**: After schema migration is complete and all old jobs are processed, the DEFAULT can be removed (but keep NOT NULL).

**Location**: Line 105 in CREATE TABLE statement

---

#### Lines 144: Scope column migration
```javascript
// Add scope column for cross-project job support (defaults to 'project' for backward compatibility)
ensureColumn(db, 'jobs', 'scope', "ALTER TABLE jobs ADD COLUMN scope TEXT NOT NULL DEFAULT 'project'");
```

**Why**: Adds scope column to existing databases without breaking old jobs.

**Removal**: After all production databases have been migrated, this line can be removed.

**Location**: Line 144

---

#### Lines 175-219: Foreign key migration function
```javascript
function fixJobItemsForeignKey(db) {
  try {
    // Check if job_items has the old foreign key reference to jobs_legacy
    const tableInfo = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='job_items'`).get();
    if (tableInfo && tableInfo.sql && tableInfo.sql.includes('jobs_legacy')) {
      // ... migration code ...
    }
  } catch (e) {
    // Log but don't fail - this is a best-effort migration
  }
}
```

**Why**: Fixes legacy foreign key references from old migration attempts.

**Removal**: After all production databases have been migrated, this entire function and its call can be removed.

**Location**: Lines 175-219

**Call site**: Line 172 (`fixJobItemsForeignKey(db);`)

---

## Repository Layer

### File: `server/services/repositories/jobsRepo.js`

#### Line 19: Scope fallback in rowToJob
```javascript
scope: row.scope || 'project',
```

**Why**: Old jobs might not have scope column, default to 'project'.

**Removal**: After all old jobs are processed, change to just `row.scope` (will fail if null, which is desired).

**Location**: Line 19

---

#### Lines 55-56: Scope auto-detection in enqueue
```javascript
// Auto-detect scope if not provided: 'project' if project_id exists, 'photo_set' otherwise
const effectiveScope = scope || (project_id ? 'project' : 'photo_set');
```

**Why**: Allows old code to call enqueue without specifying scope.

**Removal**: After all callers are updated to explicitly pass scope, make `scope` a required parameter.

**Location**: Lines 55-56

**Impact**: Will require updating all `enqueue()` calls to explicitly pass scope parameter.

---

## Task Orchestrator

### File: `server/services/tasksOrchestrator.js`

#### Line 23: Scope auto-detection from definition
```javascript
// Determine scope from definition or parameter
const effectiveScope = scope || def.scope || (project_id ? 'project' : 'photo_set');
```

**Why**: Allows old task definitions without scope field to still work.

**Removal**: After all task definitions have scope field, simplify to:
```javascript
const effectiveScope = scope || def.scope;
if (!effectiveScope) throw new Error('Task definition missing scope');
```

**Location**: Line 23

---

#### Line 81: Scope fallback in onJobCompleted
```javascript
const scope = job.scope || 'project';
```

**Why**: Old jobs might not have scope, default to 'project'.

**Removal**: After all old jobs are processed, change to just `job.scope` (will fail if null).

**Location**: Line 81

---

## Task Definitions

### File: `server/services/task_definitions.json`

#### All existing tasks have explicit scope
```json
{
  "upload_postprocess": {
    "scope": "project",  // ← Explicit for clarity
    ...
  }
}
```

**Why**: Makes scope explicit for all tasks, even those that were always project-scoped.

**Removal**: These should stay - they're not backward compatibility, they're explicit configuration.

**Location**: Throughout file

**Note**: NOT for removal - this is the new standard.

---

## Worker Layer

### File: `server/services/workers/shared/photoSetUtils.js`

#### Lines 77-84: Project scope handling in resolveJobTargets
```javascript
case 'project':
  // Traditional project-scoped job
  if (!job.project_id) {
    throw new Error('Project-scoped job missing project_id');
  }
```

**Why**: Validates that project-scoped jobs have project_id (enforces contract).

**Removal**: This should stay - it's validation, not backward compatibility.

**Location**: Lines 77-84

**Note**: NOT for removal - this is proper validation.

---

## Scheduler

### File: `server/services/scheduler.js`

#### Lines 8-16: Global maintenance (replaces per-project loop)
```javascript
function startMaintenanceForActiveProjects() {
  // Use global maintenance task instead of per-project loops
  try {
    tasksOrchestrator.startTask({ type: 'maintenance_global', source: 'maintenance', scope: 'global' });
  } catch (e) {
    // ...
  }
}
```

**Why**: New implementation using global scope.

**Removal**: This should stay - it's the new design, not backward compatibility.

**Location**: Lines 8-16

**Note**: NOT for removal - this is the new architecture.

---

## Summary of Removable Code

### High Priority (Remove After Migration)
1. **db.js Line 144**: `ensureColumn` for scope (after all DBs migrated)
2. **db.js Lines 175-219**: `fixJobItemsForeignKey` function (after all DBs migrated)
3. **db.js Line 172**: Call to `fixJobItemsForeignKey(db)` (after all DBs migrated)

### Medium Priority (Remove After Old Jobs Processed)
4. **jobsRepo.js Line 19**: `|| 'project'` fallback in rowToJob
5. **tasksOrchestrator.js Line 81**: `|| 'project'` fallback in onJobCompleted

### Low Priority (Remove After Code Refactor)
6. **jobsRepo.js Lines 55-56**: Scope auto-detection (make scope required)
7. **tasksOrchestrator.js Line 23**: Scope auto-detection from definition
8. **db.js Line 105**: DEFAULT 'project' in schema (keep NOT NULL, remove DEFAULT)

---

## Removal Checklist

### Phase 1: Immediate (After All DBs Migrated)
- [ ] Verify all production databases have scope column
- [ ] Verify all production databases have correct job_items FK
- [ ] Remove `fixJobItemsForeignKey` function
- [ ] Remove `ensureColumn` call for scope
- [ ] Test on staging environment

### Phase 2: After Old Jobs Complete
- [ ] Verify no jobs exist with NULL scope
- [ ] Verify no jobs exist without scope column
- [ ] Remove `|| 'project'` fallbacks in rowToJob
- [ ] Remove `|| 'project'` fallback in onJobCompleted
- [ ] Test on staging environment

### Phase 3: After Code Refactor
- [ ] Update all enqueue() calls to pass explicit scope
- [ ] Update all startTask() calls to pass explicit scope
- [ ] Make scope a required parameter in enqueue()
- [ ] Make scope validation stricter in orchestrator
- [ ] Remove DEFAULT from scope column in schema
- [ ] Test on staging environment

### Phase 4: Validation
- [ ] Run full regression test suite
- [ ] Monitor production for errors
- [ ] Update documentation
- [ ] Remove this file (backward compatibility complete!)

---

## Testing Strategy

### Before Removal
```javascript
// Test that old jobs still work
const oldJob = { id: 1, type: 'test', /* no scope field */ };
const processed = rowToJob(oldJob);
assert.equal(processed.scope, 'project'); // Should default
```

### After Removal
```javascript
// Test that scope is required
const oldJob = { id: 1, type: 'test', /* no scope field */ };
assert.throws(() => rowToJob(oldJob)); // Should fail
```

---

## Migration Commands

### Check for Old Jobs
```sql
-- Check for jobs without scope (should be 0 after migration)
SELECT COUNT(*) FROM jobs WHERE scope IS NULL;

-- Check for old foreign key references
SELECT sql FROM sqlite_master WHERE type='table' AND name='job_items';
-- Should reference "jobs", not "jobs_legacy"
```

### Verify Migration Complete
```sql
-- All jobs should have scope
SELECT scope, COUNT(*) FROM jobs GROUP BY scope;

-- Should show: project, photo_set, global (no NULL)
```

---

## Rollback Plan

If issues arise after removing backward compatibility code:

1. **Restore from Git**: `git revert <commit-hash>`
2. **Re-add fallbacks**: Add back `|| 'project'` defaults
3. **Re-run migration**: Ensure all jobs have scope
4. **Investigate**: Find jobs that still need old code path
5. **Fix root cause**: Update those jobs/callers
6. **Retry removal**: After fixing root cause

---

## Notes

- All backward compatibility code is marked with comments containing "backward compatibility"
- Search codebase for `|| 'project'` to find fallback code
- Search codebase for `DEFAULT 'project'` to find schema defaults
- This document should be deleted once all backward compatibility code is removed

---

## Related Documents

- `tasks_progress/jobs_refactoring_progress.md` - Main progress tracking
- `tasks_progress/REFACTORING_SUMMARY.md` - Complete refactoring summary
- `tasks_progress/QUICK_REFERENCE.md` - Developer reference
- `tasks_new/jobs_refactoring.md` - Original plan
