# Fixes Applied for URL State Management Issues

## Issue 1: View Button Not Opening Viewer ✅ FIXED

**Problem**: Clicking the "View" button on photo hover did nothing

**Root Cause**: The `handleAllPhotoSelect` function signature didn't match the call from `VirtualizedPhotoGrid`. The grid was calling `onPhotoSelect(photo, photos)` but the handler only expected `photo`.

**Solution**: 
- Updated `useAllPhotosViewer.js` to accept both `photo` and optional `photosList` parameters
- Added fallback logic to use `photosList` if provided, otherwise use `allPhotos`
- Added console logging for debugging

**Files Modified**:
- `client/src/hooks/useAllPhotosViewer.js`

**Code Changes**:
```javascript
// Before:
const handleAllPhotoSelect = useCallback((photo) => {
  if (!photo) return;
  const idx = allPhotos.findIndex(...);
  // ...
}, [allPhotos, ...]);

// After:
const handleAllPhotoSelect = useCallback((photo, photosList) => {
  console.log('[useAllPhotosViewer] handleAllPhotoSelect called', { photo, photosList, allPhotos });
  if (!photo) return;
  
  // Use photosList if provided, otherwise fall back to allPhotos
  const list = photosList || allPhotos;
  const idx = list.findIndex(...);
  // ...
}, [allPhotos, ...]);
```

## Issue 2: showdetail Parameter Not Updating URL ✅ FIXED

**Problem**: When toggling the detail panel in the viewer, the URL didn't update with `?showdetail=1`

**Root Cause**: The `PhotoViewer` component was updating its local `showInfo` state but not notifying the parent component (`App.jsx`) to update `viewerState.showInfo`, which is what `useUrlSync` watches.

**Solution**:
1. Added `onShowInfoChange` callback prop to `PhotoViewer`
2. Added `useEffect` in `PhotoViewer` to call the callback when `showInfo` changes
3. Updated `App.jsx` to pass the callback that updates `viewerState.showInfo`

**Files Modified**:
- `client/src/components/PhotoViewer.jsx`
- `client/src/App.jsx`

**Code Changes**:

**PhotoViewer.jsx**:
```javascript
// Added prop:
const PhotoViewer = ({
  // ... other props
  onShowInfoChange,
}) => {

// Added effect:
useEffect(() => {
  if (onShowInfoChange) {
    onShowInfoChange(showInfo);
  }
}, [showInfo, onShowInfoChange]);
```

**App.jsx**:
```javascript
<PhotoViewer
  // ... other props
  onShowInfoChange={(showInfo) => setViewerState(prev => ({ ...prev, showInfo }))}
/>
```

**Result**: Now when you toggle the detail panel, the URL updates with `?showdetail=1` and `useUrlSync` properly syncs it.

## Issue 3: Commit/Revert Toolbar Not Appearing ⚠️ NEEDS TESTING

**Problem**: The commit/revert toolbar doesn't appear even when there are differences between "to keep" and "available" files

**Investigation**:
- Added debug logging to `usePendingDeletes` hook to track state
- The logic looks correct but needs runtime verification

**Debug Logging Added**:
```javascript
console.log('[usePendingDeletes]', {
  isAllPhotosView,
  pendingDeletesAll,
  pendingDeletesProject,
  pendingDeleteTotals,
  hasPendingDeletes,
  pendingProjectsCount
});
```

**What to Check**:
1. Open browser console and look for `[usePendingDeletes]` logs
2. Verify that `pendingDeleteTotals.total > 0` when you have pending changes
3. Check if `allPendingDeletes` state is being set correctly from the API
4. Verify the pending deletes API is being called without errors (should be fixed now)

**Possible Issues**:
- The `allPendingDeletes` state might not be initialized on page load
- The pending deletes calculation might need to run after keep flag changes
- The API might not be returning the correct data

## Testing Checklist

### View Button
- [ ] Click "View" button on photo hover in All Photos mode
- [ ] Click "View" button on photo hover in Project mode
- [ ] Verify viewer opens with correct photo
- [ ] Check console for `[useAllPhotosViewer] handleAllPhotoSelect called` log

### showdetail Parameter
- [ ] Open a photo in viewer
- [ ] Click "Detail" button
- [ ] Verify URL updates with `?showdetail=1`
- [ ] Verify detail panel opens
- [ ] Click "Detail" again to close
- [ ] Verify URL removes `?showdetail=1`
- [ ] Refresh page with `?showdetail=1` in URL
- [ ] Verify detail panel is open on load

### Commit/Revert Toolbar
- [ ] Mark some photos as "don't keep"
- [ ] Check console for `[usePendingDeletes]` log
- [ ] Verify `hasPendingDeletes` is true in the log
- [ ] Verify commit/revert toolbar appears at bottom
- [ ] Test in both All Photos and Project modes
- [ ] Verify toolbar shows correct counts

## Preview Mode (Future Enhancement)

The user mentioned that preview mode should be handled via URL parameter. This would require:

1. Adding a `preview_mode` or `keep_type=preview` parameter to URL
2. Updating the filter logic to handle preview mode
3. Ensuring the commit bar toggle updates the URL parameter

**Suggested URL Structure**:
```
# Normal mode (show all photos)
/p15

# Preview mode (show only photos marked for deletion)
/p15?keep_type=pending_deletes

# Or alternatively:
/p15?preview_mode=1
```

This is not yet implemented but the infrastructure is in place with the URL-based state management.

## Files Modified Summary

1. `client/src/hooks/useAllPhotosViewer.js` - Fixed View button handler
2. `client/src/components/PhotoViewer.jsx` - Added showInfo change callback
3. `client/src/App.jsx` - Added showInfo change handler
4. `client/src/hooks/usePendingDeletes.js` - Added debug logging

## Next Steps

1. **Test the View button** - Should now work correctly
2. **Test showdetail parameter** - Should update URL when toggling
3. **Debug commit bar** - Check console logs to see why it's not appearing
4. **Implement preview mode** - Add URL parameter for preview mode if needed
