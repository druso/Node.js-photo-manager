# Upload Refresh Fix - November 16, 2024

## Issue
After uploading images to a project, the project grid did not update with the new images unless the page was manually refreshed.

## Root Cause
The `handlePhotosUploaded` function in `EventHandlersService.js` had a logic bug on line 79-80:

```javascript
// BEFORE (buggy):
const currentFolder = this.projects?.find(p => p.folder === this.ALL_PROJECT_SENTINEL.folder)?.folder;
if (currentFolder && currentFolder !== this.ALL_PROJECT_SENTINEL.folder) {
```

This was trying to find the ALL_PROJECT_SENTINEL folder in the projects list and then checking if it's NOT the ALL_PROJECT_SENTINEL, which would always fail. The function never actually refreshed the current project.

## Solution
Fixed the function to use the currently selected project instead:

```javascript
// AFTER (fixed):
const currentFolder = this.selectedProject?.folder;
if (currentFolder && currentFolder !== this.ALL_PROJECT_SENTINEL.folder) {
```

### Changes Made:
1. **EventHandlersService constructor**: Added `selectedProject` parameter to the constructor
2. **handlePhotosUploaded method**: Changed to use `this.selectedProject?.folder` instead of the buggy logic
3. **useEventHandlers hook**: Updated to pass `selectedProject` to the service

## Files Modified
- `/client/src/services/EventHandlersService.js`
  - Line 19: Added `selectedProject` to constructor parameters
  - Line 40: Store `selectedProject` in instance
  - Lines 80-90: Fixed `handlePhotosUploaded` logic
  - Line 256: Pass `selectedProject` when creating service instance

## Testing
- ✅ Build passes successfully
- ✅ No TypeScript/ESLint errors
- ✅ Logic now correctly identifies current project and triggers refresh

## Expected Behavior
When an upload completes:
1. `UploadProvider` calls `onCompleted` callback
2. `onCompleted` is wired to `handlePhotosUploaded`
3. `handlePhotosUploaded` now correctly identifies the current project folder
4. `fetchProjectData` is called with the correct folder
5. Project grid updates automatically with new images

## Impact
- **User Experience**: Users no longer need to manually refresh the page after uploading images
- **Code Quality**: Fixed a logic bug that was preventing proper state updates
- **Backward Compatibility**: No breaking changes, purely a bug fix
