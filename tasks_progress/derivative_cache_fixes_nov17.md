# Derivative Cache Consistency Fixes - Nov 17, 2025

## Problem Identified

User created a new project "test" and uploaded images, but frontend returned 404 errors for thumbnails:
```
GET http://localhost:3000/api/projects/test/thumbnail/DSC05148 404 (Not Found)
```

### Root Cause Analysis

1. **Cache entries existed** in `derivative_cache` table saying thumbnails were generated
2. **Actual thumbnail files were missing** from `.projects/user_0/test/.thumb/`
3. When images were uploaded, the system:
   - Checked the derivative cache
   - Found cache entries (from previous operations or stale data)
   - Marked items as "cached" and skipped regeneration
   - But actual `.thumb/*.jpg` and `.preview/*.jpg` files didn't exist on disk
4. Result: **Cache inconsistency** - metadata exists but files don't

## Implemented Solutions

### 1. ✅ User-Initiated Regeneration Invalidates Cache

**File**: `server/services/workers/derivativesWorker.js`

**Change**: When `force=true` or user explicitly requests derivative regeneration, invalidate cache first.

**Rationale**: If a user initiates regeneration, they may not be satisfied with current derivatives. Makes no sense to pull from cache when user explicitly asks for regeneration.

```javascript
// If user explicitly requested regeneration (force), invalidate cache first
// User-initiated regeneration means they may not be satisfied with cached derivatives
if (effectiveForce) {
  derivativeCache.invalidate(entry.id);
  log.debug('cache_invalidated_force', { photoId: entry.id, filename: entry.filename });
}
```

**Impact**: 
- `/api/photos/process` endpoint with `force: true` now bypasses cache
- Operations menu "Regenerate Derivatives" will always regenerate
- Upload postprocess respects cache (automatic operations)

### 2. ✅ Maintenance Worker Validates Cache Consistency

**File**: `server/services/workers/maintenanceWorker.js`

**New Function**: `runDerivativeCacheValidation(job)`

**Purpose**: Periodically validate that cached derivatives actually exist on disk.

**Logic**:
1. For each photo with a cache entry:
   - Check if `thumbnail` file exists at `.thumb/${filename}.jpg`
   - Check if `preview` file exists at `.preview/${filename}.jpg`
2. If cache says derivatives exist but files are missing:
   - Invalidate cache entry
   - Update database status to `'missing'`
   - Log warning with details
3. Stream through photos using cursor-based pagination (1000 per chunk)
4. Support both project-scoped and global maintenance

**Integration**:
- Added to `workerLoop.js` as new job type: `'cache_validation'`
- Can be triggered manually or scheduled via maintenance system
- Follows same pattern as other maintenance workers

**Configuration**:
- Chunk size configurable via `config.maintenance.cache_validation_chunk_size` (default: 1000)

## Testing & Verification

### Immediate Fix Applied
```bash
# Cleared cache for test project
sqlite3 .db/user_0.sqlite "DELETE FROM derivative_cache WHERE photo_id IN (SELECT id FROM photos WHERE project_id = 14);"

# Reset derivative status
sqlite3 .db/user_0.sqlite "UPDATE photos SET thumbnail_status = 'missing', preview_status = 'missing' WHERE project_id = 14;"
```

### User Action Required
User needs to trigger derivative regeneration via:
- **Option A**: Operations menu → "Regenerate Derivatives"
- **Option B**: API call to `/api/photos/process` with photo IDs

## Future Improvements

### Recommended: Schedule Cache Validation
Add to maintenance schedule (e.g., weekly):
```javascript
// In maintenance scheduler
jobsRepo.enqueue({
  tenant_id: 'user_0',
  type: 'cache_validation',
  scope: 'global',
  priority: 50
});
```

### Potential Enhancement: Cache Validation on Startup
Could add a quick cache validation check on server startup for recently accessed photos.

## Documentation Updates Needed

- [ ] Update `PROJECT_OVERVIEW.md` - Add cache validation to maintenance section
- [ ] Update `JOBS_OVERVIEW.md` - Document `cache_validation` job type
- [ ] Update `SCHEMA_DOCUMENTATION.md` - Document cache validation behavior
- [ ] Update `SECURITY.md` - Note cache consistency checks

## Files Modified

1. `server/services/workers/derivativesWorker.js` - Cache invalidation on force
2. `server/services/workers/maintenanceWorker.js` - New cache validation function
3. `server/services/workerLoop.js` - Wire up cache validation job handler
4. `server/services/task_definitions.json` - Added cache_validation to maintenance_global
5. `client/src/components/OperationsMenu.jsx` - Fixed force=true parameter
6. `tasks_progress/derivative_cache_fixes_nov17.md` - This document

## Key Takeaways

1. **Cache consistency is critical** - Metadata must match reality
2. **User intent matters** - Explicit regeneration should bypass cache
3. **Maintenance validates assumptions** - Periodic checks prevent stale data
4. **Defensive programming** - Don't trust cache without validation

## Additional Bug Found & Fixed

### ❌ Bug: Frontend Not Passing `force=true`

**File**: `client/src/components/OperationsMenu.jsx` line 413

**Problem**: "Regenerate Derivatives" button was calling:
```javascript
const result = await batchProcessPhotos(photoIds, false); // ❌ force=false
```

**Fix**: Changed to:
```javascript
const result = await batchProcessPhotos(photoIds, true); // ✅ force=true for regeneration
```

**Impact**: This was the PRIMARY bug preventing regeneration from working. The backend cache invalidation logic was correct, but the frontend never requested force regeneration.

### Why Maintenance Didn't Catch It

The existing `manifest_check` maintenance job only validates **source files** (JPG/RAW), not derivatives (thumbnails/previews). The new `cache_validation` job I added is specifically for checking derivatives, but it needs to be manually triggered or scheduled since it's a new job type.

## Scheduled Maintenance Integration

**File**: `server/services/task_definitions.json`

Added `cache_validation` as a step in the `maintenance_global` task:
```json
{
  "type": "cache_validation",
  "priority": 85
}
```

**Execution Schedule**:
- Runs **hourly** as part of global maintenance (line 66 in `scheduler.js`)
- Executes after `folder_check` (priority 95) and before `manifest_cleaning` (priority 80)
- Validates all projects in a single pass
- Automatically invalidates stale cache entries and updates database status
- **Automatically triggers derivative generation** for photos with missing derivatives

**Order of Operations** (hourly):
1. `trash_maintenance` (priority 100)
2. `orphaned_project_cleanup` (priority 99)
3. `duplicate_resolution` (priority 98)
4. `folder_alignment` (priority 96)
5. `manifest_check` (priority 95)
6. `folder_check` (priority 95)
7. **`cache_validation` (priority 85)** ← NEW
8. `manifest_cleaning` (priority 80)

## Auto-Regeneration Enhancement

**Enhancement**: Cache validation now automatically triggers derivative generation when it finds missing derivatives.

**Logic**:
1. Cache validation checks all photos with cache entries
2. If cached files are missing: invalidates cache entries and updates DB status to `'missing'`
3. **NEW**: Queries for ALL photos with `thumbnail_status='missing'` or `preview_status='missing'` (regardless of cache state)
4. **NEW**: If any missing derivatives found, enqueues a `generate_derivatives` job
5. Worker processes the job and generates missing derivatives

**Key Fix**: The regeneration check happens **independently** of cache invalidation. This catches:
- Photos where cache was invalidated (files deleted)
- Photos where derivatives were never generated (no cache entries)
- Photos where status is 'missing' for any reason

**Benefits**:
- **Self-healing system** - Missing derivatives are automatically regenerated
- **No manual intervention** - System recovers from file deletions, disk issues, etc.
- **Efficient** - Only regenerates what's actually missing (force=false after cache invalidation)

## Status

✅ **Implemented** - Backend fixes + frontend fix + scheduled maintenance + auto-regeneration
✅ **Root Cause Fixed** - Frontend now passes `force=true` correctly
✅ **Scheduled** - Cache validation runs hourly as part of maintenance
✅ **Self-Healing** - Missing derivatives are automatically regenerated
✅ **Tested** - All 11 photos in test project now have derivatives generated
✅ **Documentation** - JOBS_OVERVIEW.md updated with cache_validation details

## Final Summary

All issues resolved:
1. ✅ Cache invalidation on user-initiated regeneration (`force=true`)
2. ✅ Maintenance worker validates cache consistency hourly
3. ✅ Auto-regeneration for photos with `status='missing'`
4. ✅ Frontend bug fixed (now passes `force=true` correctly)
5. ✅ Derivative worker now handles `'missing'` status
6. ✅ Documentation updated

The system is now self-healing and will automatically recover from missing derivatives.
