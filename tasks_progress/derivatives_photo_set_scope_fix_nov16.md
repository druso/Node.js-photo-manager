# Derivatives Generation Photo-Set Scope Fix

**Date**: November 16, 2025  
**Issue**: Regenerate derivatives from Operations Menu failing with "Project not found for job"

## Root Cause

The `/api/photos/process` endpoint correctly creates jobs with:
- `scope: 'photo_set'` (image-centric, cross-project)
- `project_id: NULL` (no single project, operates on photo IDs)

However, the `derivativesWorker.js` was **only handling project-scoped jobs** and expected `job.project_id` to always be set. When it was NULL, it threw "Project not found for job" and failed immediately.

## The Problem

When users clicked "Regenerate" in the Operations Menu:
1. ✅ Client correctly sends `photo_id` array to `/api/photos/process`
2. ✅ Server correctly creates job with `scope: 'photo_set'` and `project_id: NULL`
3. ❌ Worker fails immediately: "Project not found for job"

**Failed Jobs**:
```
Job 232: generate_derivatives - failed - "Project not found for job"
Job 230: generate_derivatives - failed - "Project not found for job"  
Job 219: generate_derivatives - failed - "Project not found for job"
```

## The Fix

### File: `/server/services/workers/derivativesWorker.js`

**Changes**:
1. Added `photo_set` scope handling at the start of `runGenerateDerivatives()`
2. When `job.scope === 'photo_set'`:
   - Fetch all job items
   - Group photos by their `project_id` (determined from photo records)
   - Process each project's photos separately
   - Track progress across all projects
3. Created new `processProjectPhotos()` helper function for reusable project-level processing
4. Preserved original project-scoped logic for backward compatibility

**Key Logic**:
```javascript
if (job.scope === 'photo_set') {
  // Group items by project_id
  const photosByProject = {};
  for (const item of items) {
    const photo = photosRepo.getById(item.photo_id);
    if (!photo) continue;
    
    if (!photosByProject[photo.project_id]) {
      photosByProject[photo.project_id] = [];
    }
    photosByProject[photo.project_id].push({ item, photo });
  }
  
  // Process each project
  for (const [projectId, projectPhotos] of Object.entries(photosByProject)) {
    const project = projectsRepo.getById(Number(projectId));
    await processProjectPhotos({ job, project, projectPhotos, items, payload, onProgress });
  }
}
```

## Architecture Alignment

This fix aligns with the **image-centric philosophy**:
- ✅ Operations work on `photo_id` arrays, not project folders
- ✅ System automatically determines which projects are involved
- ✅ Jobs with `scope: 'photo_set'` have `project_id: NULL`
- ✅ Workers group photos by project internally when needed
- ✅ Cross-project operations work seamlessly

## Testing

To verify the fix:
1. Restart the server
2. Select photos with missing derivatives (e.g., DSC03260)
3. Click "Regenerate" in Operations Menu
4. Check job status - should process successfully
5. Verify derivatives are generated

## Status

- ✅ Bug identified
- ✅ Root cause analyzed  
- ✅ Fix implemented in `derivativesWorker.js`
- ✅ Photo-set scope handling added
- ✅ Backward compatibility maintained
- ⏳ Needs testing with real photos

## Related Files

- `/server/routes/photosActions.js` - Endpoint that creates photo_set jobs
- `/server/services/tasksOrchestrator.js` - Task orchestration
- `/server/services/task_definitions.json` - Task definitions with scopes
- `/client/src/components/OperationsMenu.jsx` - UI that triggers regeneration
- `/client/src/api/batchApi.js` - Client API for batch operations
