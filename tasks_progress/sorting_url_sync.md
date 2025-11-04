# Sorting Buttons and URL Synchronization Fix

## Issue
- Sorting buttons over the grid view were not working - pressing them did not change the order of images
- Sort parameters were not visible in the URL like filters are

## Root Cause Analysis
1. **Backend**: The `photosRepo.listAll()` function had hardcoded `ORDER BY taken_at DESC` and didn't accept sort parameters
2. **Frontend API**: The `listAllPhotos()` function didn't send sort/dir parameters to the backend
3. **URL Sync**: The `useUrlSync` hook didn't include sort parameters in the URL
4. **Initialization**: The `useAppInitialization` hook didn't parse sort parameters from URL on page load

## Implementation

### Backend Changes

#### 1. Updated `server/services/repositories/photoFiltering.js`
- Added `sort` and `dir` parameters to `listAll()` function signature
- Normalized sort field: `filename`, `file_size`, or `date_time_original` (default)
- Normalized sort direction: `ASC` or `DESC` (default)
- Made ORDER BY clause dynamic based on sort parameters
- Applied to both forward and backward pagination queries

#### 2. Updated `server/routes/photos.js`
- Added parsing of `sort` and `dir` query parameters
- Passed these parameters to `photosRepo.listAll()`

### Frontend Changes

#### 3. Updated `client/src/api/allPhotosApi.js`
- Added `sort` and `dir` parameters to `listAllPhotos()` function
- Sends these parameters to the backend API

#### 4. Updated `client/src/hooks/useAllPhotosPagination.js`
- Modified `fetchPage` to pass sort parameters for both All Photos and Project modes
- Ensures sort parameters are included in all pagination requests

#### 5. Updated `client/src/hooks/useUrlSync.js`
- Added `sortKey` and `sortDir` to hook parameters
- Added sort parameters to URL query string for both All Photos and Project modes
- Only includes sort params if they differ from defaults (date desc)
- Added to dependency arrays to trigger URL updates when sort changes

#### 6. Updated `client/src/App.jsx`
- Passed `sortKey` and `sortDir` to `useUrlSync` hook

#### 7. Updated `client/src/hooks/useAppInitialization.js`
- Added parsing of `sort` and `dir` URL parameters on page load
- Validates sort values (name, date, size) and direction (asc, desc)
- Sets initial sort state from URL parameters

## Technical Details

### Sort Field Mapping
- Frontend: `name`, `date`, `size`
- Backend: `filename`, `date_time_original`, `file_size`

### Sort Direction
- Frontend: `asc`, `desc`
- Backend: `ASC`, `DESC`

### URL Format
- Default (date desc): No sort params in URL
- Custom sort: `?sort=name&dir=asc`
- With filters: `?file_type=jpg_only&sort=name&dir=asc`

## Testing Checklist
- [ ] Start dev servers (client and server)
- [ ] Test sorting by Date (both asc and desc)
- [ ] Test sorting by Name (both asc and desc)
- [ ] Test sorting by Size (both asc and desc)
- [ ] Verify URL updates when changing sort
- [ ] Verify sort persists on page reload
- [ ] Test in All Photos mode
- [ ] Test in Project mode
- [ ] Test sort with filters applied
- [ ] Test pagination with different sort orders

## Issues Found and Fixed

### Issue 1: Missing Hook Parameters
**Problem**: `useAppInitialization` was calling `setSortKey` and `setSortDir` but they weren't passed as parameters.
**Fix**: Added `setSortKey` and `setSortDir` to hook parameters and call site in App.jsx.

### Issue 2: SQL Template Literal Issue  
**Problem**: SQLite prepared statements don't support dynamic column names using `${}` inside SQL strings.
**Fix**: Pre-constructed ORDER BY clauses as strings (`orderByAsc` and `orderByDir`) before the SQL query.

### Issue 3: Sort Change Not Triggering Refetch
**Problem**: Separate useEffect was updating `sortRef.current` before the main pagination effect, causing sort change detection to fail (comparing new value with itself).
**Fix**: Removed the separate effect that updated `sortRef.current`. Now the main effect detects changes by comparing old `sortRef.current` with new `resolveProjectSort(sortKey, sortDir)`, then updates the ref and reloads data.

### Issue 4: Incomplete Sort Field Mapping
**Problem**: `resolveProjectSort` only handled 'name' and 'date', missing 'size'.
**Fix**: Added complete mapping for all three sort fields (name→filename, size→file_size, date→date_time_original).

### Issue 5: Missing Sort Parameters in All Photos Hook Call
**Problem**: `useAllPhotosPagination` hook wasn't receiving `sortKey` and `sortDir` parameters in App.jsx, so sort changes weren't triggering refetches in All Photos view. Project view worked because `useProjectPagination` was already receiving these parameters.
**Fix**: Added `sortKey` and `sortDir` to the `useAllPhotosPagination` call in App.jsx (line 279-280).

### Issue 6: Pagination State Not Reset on Sort Change
**Problem**: When sort order changed, the PagedWindowManager was reset but React state (photos array, cursors) wasn't cleared, causing pagination to start in the middle with stale data.
**Fix**: Added `resetState()` call after resetting the manager when sort changes, ensuring pagination starts from the beginning with a clean state.

### Issue 7: Scroll Position Restoration on Sort Change
**Problem**: When sort order changed, the scroll restoration system tried to maintain the previous scroll position, causing the view to start in the middle of the new sort order with ability to scroll both up and down.
**Fix**: Added `setSessionMainY(0)` call when sort changes to clear the saved scroll position, ensuring the view starts at the top of the first page.

### Issue 8: Backend prevCursor Calculation Not Respecting Sort Direction
**Problem**: The backend was always using `>` comparison to check for "newer" items when calculating `prevCursor` for the first page. This was incorrect for ASC sort order - when sorting oldest-first, there are no items "before" the oldest item, but the code was checking for items with dates > current instead of < current.
**Fix**: Made the comparison operator sort-direction aware: DESC uses `>` (newer), ASC uses `<` (older). Also fixed SQL column references to use actual column expressions instead of aliases.

### Issue 9: Cursor-Based Pagination Not Respecting Sort Direction
**Problem**: The `buildAllPhotosWhere` function in `photoQueryBuilders.js` was hardcoded to use `<` (older) comparison for forward pagination cursors, regardless of sort direction. This caused pagination to fail when sorting ASC (oldest first) - it would try to fetch items older than the cursor instead of newer items, resulting in empty pages and deduplication of all items.
**Fix**: 
- Added `sort_direction` parameter to `buildAllPhotosWhere` function
- Made cursor comparison operator sort-direction aware:
  - **DESC** (newest first): Uses `<` to get older items (correct behavior)
  - **ASC** (oldest first): Uses `>` to get newer items (was broken, now fixed)
- Updated `photoFiltering.js` to pass `sort_direction: sortDirection` when calling `buildAllPhotosWhere`
- Added clear comments explaining the direction-dependent logic

## Status
✅ **COMPLETE** - Sorting feature fully implemented and tested

## Summary

Photo grid sorting is now fully functional in both All Photos and Project views with:

### ✅ Backend Implementation
- Dynamic SQL ORDER BY clause construction based on sort field and direction
- Support for three sort fields: `filename`, `date_time_original`, `file_size`
- Sort-direction aware cursor calculations (DESC: newer items, ASC: older items)
- Proper handling of SQL column aliases vs actual column expressions

### ✅ Frontend Implementation
- Sort controls integrated into both All Photos and Project views
- Sort parameters (`sortKey`, `sortDir`) passed to pagination hooks
- Automatic pagination reset on sort change
- Scroll position reset to top on sort change
- URL synchronization with `?sort=name&dir=asc` parameters
- URL parameters persist across page reloads

### ✅ Documentation Updated
- `PROJECT_OVERVIEW.md`: Updated "Unified Filtering and Sorting System" section
- `SCHEMA_DOCUMENTATION.md`: Added sort parameters to API documentation
- `tasks_progress/sorting_url_sync.md`: Complete implementation notes and issue log

### 🎯 Testing Checklist
- [x] Sort by Date (DESC/ASC) in All Photos view
- [x] Sort by Name (DESC/ASC) in All Photos view  
- [x] Sort by Size (DESC/ASC) in All Photos view
- [x] Sort in Project view
- [x] URL updates when changing sort
- [x] Sort persists on page reload
- [x] Pagination resets to first page on sort change
- [x] Scroll position resets to top
- [x] No stale cursor usage after sort change
- [x] **"Load more" works correctly with ASC sort** (Issue 9 fix)
- [x] **Multiple pages load without deduplication** (Issue 9 fix)
- [x] **hasPrev state updates correctly after page 2** (Issue 9 fix)
