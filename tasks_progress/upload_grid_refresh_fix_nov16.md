# Upload Grid Refresh Fix

**Date**: November 16, 2025  
**Issue**: After upload completes, the project grid doesn't refresh and shows empty content

## Root Cause

The upload process works in two stages:
1. **Upload Phase**: Files are uploaded to the server (handled by `UploadContext`)
2. **Processing Phase**: Background job processes the uploaded files (`manifest_check` task)

**The Problem**:
- `UploadContext` calls `onCompleted()` immediately after the upload XHR completes
- This triggers `handlePhotosUploaded()` which calls `fetchProjectData()`
- However, the background `manifest_check` job hasn't finished yet
- The grid refreshes but shows empty because photos aren't in the database yet
- User is stuck looking at an empty project window

## The Flow

### Before Fix:
```
1. User uploads files
2. XHR completes → onCompleted() called
3. handlePhotosUploaded() → fetchProjectData() (too early!)
4. Grid refreshes with empty data
5. Background job processes files (user doesn't see results)
6. Photos are added to database (but grid not refreshed)
```

### After Fix:
```
1. User uploads files
2. XHR completes → onCompleted() called
3. handlePhotosUploaded() → fetchProjectData() (still early, but okay)
4. Grid shows loading/empty state
5. Background job processes files
6. SSE 'upload' task completion event received
7. useProjectSse refreshes project data automatically
8. Grid updates with newly uploaded photos ✅
```

## The Fix

### File 1: `/client/src/hooks/useProjectSse.js`

**Added automatic grid refresh when upload task completes**:

```javascript
// Refresh project data after upload-related tasks complete
// This ensures the grid shows newly uploaded photos
if (ttype === 'upload_postprocess' && evt.status === 'completed') {
  try {
    await fetchProjectDataRef.current?.(selectedProject.folder);
  } catch (error) {
    console.debug('[SSE] post-upload refresh failed', error);
  }
}
```

**Location**: Lines 242-250, inside the task completion handler

**Important**: The task type is `upload_postprocess`, not `upload`. This matches the task definition in `/server/services/task_definitions.json`.

### File 2: `/client/src/services/ProjectNavigationService.js`

**Added detailed logging to debug URL update issues**:

```javascript
// Sync URL to project base when not in All Photos mode
try {
  if (this.view?.project_filter !== null && project?.folder) {
    const pending = this.pendingOpenRef.current;
    const isPendingDeepLink = !!(pending && pending.folder === project.folder);
    if (!isPendingDeepLink) {
      const newUrl = `/${encodeURIComponent(project.folder)}`;
      console.log('[ProjectNav] Updating URL to:', newUrl, { 
        projectFolder: project.folder,
        currentUrl: window.location.pathname,
        viewFilter: this.view?.project_filter
      });
      window.history.pushState({}, '', newUrl);
    }
  }
} catch (err) {
  console.error('[ProjectNav] URL update failed:', err);
}
```

**Location**: Lines 99-126, inside `handleProjectSelect()`

**Purpose**: Helps debug URL update issues when creating new projects and switching from All Photos view

**How it works**:
1. SSE hook already listens to `job_update` events
2. When a task completes, it checks if `task_type === 'upload'`
3. If upload task completed successfully, it calls `fetchProjectData()`
4. Grid refreshes with the newly processed photos

## Technical Details

### SSE Event Flow:
```
Server → SSE 'job_update' event → useProjectSse hook → Check task_type
  ↓
task_type === 'upload' && status === 'completed'
  ↓
fetchProjectData(selectedProject.folder)
  ↓
Grid updates with new photos
```

### Why This Works:
- **Timing**: Refresh happens AFTER the background job completes
- **Automatic**: No user action required
- **Reliable**: Uses existing SSE infrastructure
- **Efficient**: Only refreshes when upload tasks complete, not on every job event

### Task Types That Trigger Refresh:
- `upload` - File upload and manifest check task

### Other Task Types (No Refresh):
- `generate_derivatives` - Already has item-level SSE updates
- `change_commit` - Already handled by commit/revert logic
- `image_move` - Already has item-level SSE updates

## Testing

To verify the fix:
1. **Upload files** to a project
2. **Watch the grid** - should show loading state initially
3. **Wait for upload to complete** - toast notification appears
4. **Grid automatically refreshes** - newly uploaded photos appear
5. **No manual refresh needed** - everything happens automatically

### Expected Behavior:
- ✅ Upload completes → Toast notification
- ✅ Grid refreshes automatically
- ✅ Newly uploaded photos visible
- ✅ No empty project window
- ✅ No manual page refresh needed

## Alternative Approaches Considered

### 1. Delay initial refresh
**Rejected**: Would require guessing how long the job takes

### 2. Poll for completion
**Rejected**: Inefficient, SSE already provides real-time updates

### 3. Refresh on every job event
**Rejected**: Too many unnecessary refreshes, poor performance

### 4. Use manifest_changed event
**Rejected**: Upload task completion is more reliable signal

## Status

- ✅ Bug identified
- ✅ Root cause analyzed
- ✅ Fix implemented in `useProjectSse.js`
- ✅ Client rebuilt successfully
- ⏳ Needs testing with actual uploads

## Related Files

- `/client/src/hooks/useProjectSse.js` - SSE event handling and grid refresh
- `/client/src/upload/UploadContext.jsx` - Upload process management
- `/client/src/services/EventHandlersService.js` - `handlePhotosUploaded()` callback
- `/server/services/task_definitions.json` - Task type definitions
- `/server/routes/uploads.js` - Upload endpoint and job creation

## Notes

- The initial `handlePhotosUploaded()` call is still useful for immediate UI feedback
- The SSE-triggered refresh ensures the grid updates once processing completes
- This pattern can be extended to other task types if needed
- The 400ms delay in the toast handler ensures all jobs in the task are checked
