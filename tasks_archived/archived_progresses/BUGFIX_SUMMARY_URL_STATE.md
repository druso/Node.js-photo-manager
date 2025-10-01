# Bug Fixes for URL State Management

## Issues Identified and Fixed

### 1. ✅ Renamed `showinfo` to `showdetail`
**Problem**: Parameter name was confusing
**Solution**: Renamed throughout codebase
- `useUrlSync.js`: Changed parameter from `showinfo` to `showdetail`
- `useAppInitialization.js`: Updated URL parsing to look for `showdetail`
- `PhotoViewer.jsx`: Updated to read `showdetail` parameter

**Files Modified**:
- `client/src/hooks/useUrlSync.js`
- `client/src/hooks/useAppInitialization.js`
- `client/src/components/PhotoViewer.jsx`

### 2. ✅ Fixed Pending Deletes API 500 Error
**Problem**: When applying filters via URL, the `keep_type` parameter was being passed to the `/api/photos/pending-deletes` endpoint, causing a 500 error. The API expects `keep_type=pending_deletes` internally but was receiving filter values like `keep_type=keep` or `keep_type=discard`.

**Root Cause**: The `activeFilters` object now includes values parsed from URL parameters, and these were being blindly passed to the `listAllPendingDeletes()` function.

**Solution**: 
1. Added explicit filtering to exclude invalid values
2. Only pass `file_type` and `orientation` if they're not 'any'
3. Never pass `keep_type` from activeFilters to the pending deletes API

**Files Modified**:
- `client/src/hooks/useAppInitialization.js`
- `client/src/hooks/usePhotoDataRefresh.js`
- `client/src/hooks/useAllPhotosRefresh.js`

**Code Changes**:
```javascript
// Before (causing 500 error):
const result = await listAllPendingDeletes({
  date_from: range.start || undefined,
  date_to: range.end || undefined,
  file_type: activeFilters?.fileType,
  orientation: activeFilters?.orientation,
});

// After (fixed):
const result = await listAllPendingDeletes({
  date_from: range.start || undefined,
  date_to: range.end || undefined,
  file_type: activeFilters?.fileType !== 'any' ? activeFilters?.fileType : undefined,
  orientation: activeFilters?.orientation !== 'any' ? activeFilters?.orientation : undefined,
});
```

### 3. ⚠️ Viewer Opening Issue (Needs Investigation)
**Problem**: The "View" button on mouseover of an image no longer opens the viewer
**Status**: Requires further investigation
**Likely Cause**: The viewer state management might have been affected by URL state changes

**Next Steps**:
1. Check if `onPhotoSelect` handler is being called correctly
2. Verify viewer state is being set properly
3. Check if URL navigation is working for viewer deep links
4. Test the viewer opening flow end-to-end

### 4. ⚠️ Commit/Revert Bar Not Appearing (Needs Investigation)
**Problem**: The edit/commit changes bar no longer appears when there are pending changes
**Status**: Requires further investigation
**Likely Cause**: The pending deletes state might not be updating correctly after the API fix

**Next Steps**:
1. Verify `allPendingDeletes` state is being set correctly
2. Check if `hasPendingDeletes` calculation is working
3. Verify the commit bar visibility logic
4. Test with actual pending changes

## Testing Checklist

- [x] `showdetail` parameter renamed throughout
- [x] Pending deletes API no longer receives invalid `keep_type` values
- [x] Filters can be applied without causing 500 errors
- [ ] Viewer opens when clicking "View" button on hover
- [ ] Commit/revert bar appears when there are pending changes
- [ ] `showdetail=1` parameter shows info panel in viewer
- [ ] URL updates correctly when toggling info panel

## Remaining Issues

1. **Viewer Opening**: The "View" button click handler needs investigation
2. **Commit Bar Visibility**: Pending deletes state calculation needs verification
3. **Pagination Cursor Persistence**: Not yet implemented (helpers are in place)

## Files Modified Summary

1. `client/src/hooks/useUrlSync.js` - Renamed showinfo to showdetail
2. `client/src/hooks/useAppInitialization.js` - Fixed pending deletes API call, renamed parameter
3. `client/src/hooks/usePhotoDataRefresh.js` - Fixed pending deletes API call
4. `client/src/hooks/useAllPhotosRefresh.js` - Fixed pending deletes API call
5. `client/src/components/PhotoViewer.jsx` - Updated to read showdetail parameter
