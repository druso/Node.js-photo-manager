# Debugging Session - URL State Management Issues

## Current Status

### Issue 1: View Button Still Not Working ⚠️ NEEDS INVESTIGATION

**Added Debug Logging**:
- Added console.log in VirtualizedPhotoGrid when View button is clicked
- Will show if `onPhotoSelect` is defined and what photo is being passed

**Next Steps**:
1. Click the View button
2. Check console for: `[VirtualizedPhotoGrid] View button clicked`
3. Check if `onPhotoSelect` is true or false
4. If false, the handler is not being passed down correctly

**Possible Root Causes**:
- The handler chain might be broken somewhere
- `handleAllPhotoSelect` might not be defined in the right scope
- The component might be re-rendering and losing the handler

### Issue 2: Pending Deletes Toolbar ⚠️ PARTIALLY FIXED

**Problem Identified**: 
From your console log, I can see:
```javascript
{
  isAllPhotosView: false,           // You're in Project mode
  pendingDeletesAll: {              // All Photos has 6 pending (2 jpg, 4 raw)
    jpg: 2, raw: 4, total: 6, 
    byProject: Set(1)
  },
  pendingDeletesProject: {          // But Project mode shows 0 pending
    jpg: 0, raw: 0, total: 0, 
    byProject: Set(0)
  },
  pendingDeleteTotals: {            // So total is 0
    jpg: 0, raw: 0, total: 0, 
    byProject: Set(0)
  },
  hasPendingDeletes: false          // And toolbar doesn't show
}
```

**Root Cause**: The `pendingDeletesProject` calculation is checking `projectData?.photos` but this might be:
1. The filtered/paged photos, not all photos in the project
2. Not including the photos you marked as don't keep
3. Not being updated after you change keep flags

**What I Changed**:
1. Removed the infinite console.log spam
2. Added targeted logging only when pending deletes are found
3. Fixed the dependency array to use `projectData?.photos` instead of `projectData`

**What You Need to Check**:
1. When you mark a photo as "don't keep", does `projectData.photos` get updated?
2. Are you looking at a filtered view that excludes the photos you marked?
3. Is the photo you marked in the current page of photos loaded?

**The Real Issue**: 
The toolbar calculation is based on the photos currently loaded in memory (`projectData.photos`), but if you're using pagination, those photos might not be in the current page. We need to either:
- Calculate pending deletes from ALL photos in the project (via API call)
- Or refresh the current page after changing keep flags

### Issue 3: showdetail Parameter Disappearing ⚠️ NEEDS INVESTIGATION

**Added Debug Logging**:
- Added console.log when useUrlSync updates the URL
- Will show what `viewerState` looks like when the URL is updated

**Possible Root Causes**:
1. `viewerState.showInfo` is not being set when you toggle the detail panel
2. The `useUrlSync` effect is running before `viewerState.showInfo` is updated
3. Multiple effects are racing and overwriting each other

**What to Check**:
1. Toggle the detail panel
2. Look for console logs: `[useUrlSync] Project - Updating URL`
3. Check what `viewerState` shows in the log
4. See if `viewerState.showInfo` is true or false

## Recommended Fixes

### For View Button:
If the console shows `onPhotoSelect: false`, we need to trace back through the component tree to find where the handler is being lost.

### For Pending Deletes Toolbar:
The current approach is flawed because it only checks loaded photos. We should:

**Option A (Simple)**: Call the pending deletes API after every keep flag change
```javascript
// In handleKeepUpdated or wherever keep flags are changed
await updateKeep(...);
// Then refresh pending deletes
const result = await listAllPendingDeletes(...);
setAllPendingDeletes(result);
```

**Option B (Better)**: Make pending deletes calculation work on ALL photos, not just loaded ones
- For Project mode: Call an API endpoint that counts mismatches for the project
- For All Photos mode: Use the existing `allPendingDeletes` state

### For showdetail Parameter:
We need to ensure the state update chain works:
1. User clicks "Detail" button
2. PhotoViewer updates local `showInfo` state
3. PhotoViewer calls `onShowInfoChange(showInfo)`
4. App.jsx updates `viewerState.showInfo`
5. useUrlSync sees the change and updates URL

If any step fails, the URL won't update.

## Testing Instructions

### Test View Button:
1. Hover over a photo
2. Click the "View" button
3. Check console for `[VirtualizedPhotoGrid] View button clicked`
4. Report what you see

### Test Pending Deletes:
1. Go to a project view
2. Open a photo in the viewer
3. Mark it as "don't keep" (both JPG and RAW)
4. Close the viewer
5. Check console for `[usePendingDeletes] Project has pending deletes:`
6. Check if toolbar appears
7. If not, check what `projectData.photos` contains (you can add a console.log)

### Test showdetail:
1. Open a photo in the viewer
2. Click "Detail" button
3. Check console for `[useUrlSync]` logs
4. Check what `viewerState` shows
5. Check if URL has `?showdetail=1`
6. If it appears then disappears, note the timing

## Files Modified in This Session

1. `client/src/components/VirtualizedPhotoGrid.jsx` - Added debug logging for View button
2. `client/src/hooks/usePendingDeletes.js` - Removed infinite loop, added targeted logging
3. `client/src/hooks/useUrlSync.js` - Added debug logging for URL updates

## Next Steps

Based on your testing results, we'll need to:
1. Fix the handler chain for the View button
2. Implement proper pending deletes calculation (probably via API)
3. Debug the state update timing for showdetail parameter
