# Pagination Implementation - Critical Details

**Last Updated**: 2025-10-09

This document describes critical implementation details for the pagination system that must be maintained to ensure proper functionality.

## Overview

The application uses a sophisticated pagination system with:
- Windowed page management (`PagedWindowManager`)
- Bidirectional cursor-based pagination
- Scroll anchoring for stable UX
- Page eviction to manage memory

## Critical Implementation Requirements

### 1. Backend: Always Return prevCursor for Forward Pagination

**File**: `/server/services/repositories/photoFiltering.js`
**Function**: `listAll()`

**Requirement**: The backend must **always** return `prevCursor` when a `cursor` parameter is present (forward pagination), regardless of whether newer items exist.

**Why**: When pages are evicted from the window during forward pagination, the `PagedWindowManager` needs the `prevCursor` to enable backward navigation. Without it, `hasPrev` becomes false and users can't navigate backward.

**Implementation**:
```javascript
// CORRECT - Always set prevCursor when using forward pagination
if (cursor) {
  prevCursor = createCursor(first.taken_at, first.id);
} else {
  // For initial load, check if there are newer items
  const hasNewer = db.prepare(`SELECT 1 ...`).get(...);
  if (hasNewer) {
    prevCursor = createCursor(first.taken_at, first.id);
  }
}

// INCORRECT - Don't check hasNewer when cursor is present
if (cursor || hasNewer) {
  prevCursor = createCursor(first.taken_at, first.id);
}
```

### 2. Frontend: Prevent Duplicate loadInitial Calls

**File**: `/client/src/hooks/useAllPhotosPagination.js`
**Function**: `loadInitial()`

**Requirement**: Use a loading lock to prevent concurrent `loadInitial` calls.

**Why**: React strict mode or rapid re-renders can cause `loadInitial` to be called multiple times. Since `manager.loadInitial()` calls `reset()` internally, the second call clears deduplication state, causing all items to appear new again and resulting in duplicate page loads.

**Implementation**:
```javascript
const loadInitial = useCallback(async () => {
  // Prevent concurrent loadInitial calls
  if (loadingLockRef.current) {
    return;
  }
  
  loadingLockRef.current = true;
  try {
    // ... load initial page
  } finally {
    loadingLockRef.current = false;
  }
}, [...]);
```

### 3. Frontend: Dual-Path Pagination Status Reset

**File**: `/client/src/components/VirtualizedPhotoGrid.jsx`

**Requirement**: The pagination status must reset to `'idle'` through two different paths depending on whether a scroll anchor was captured.

**Why**: The status machine blocks pagination when status is not `'idle'`. If the status never resets, pagination becomes permanently blocked.

**Implementation**:

**Path 1 - No Scroll Anchor Captured**:
```javascript
// In the pending load execution effect
if (loadPromise && typeof loadPromise.then === 'function') {
  loadPromise.finally(() => {
    if (!scrollAnchorRef.current) {
      setTimeout(() => {
        setPaginationStatus('idle');
        isLoadingPrevRef.current = false;
        isLoadingMoreRef.current = false;
      }, 100);
    }
  });
}
```

**Path 2 - Scroll Anchor Captured**:
```javascript
// In the scroll anchor restoration effect
useEffect(() => {
  if (!scrollAnchorRef.current) return;
  
  // ... restoration logic
  setTimeout(() => {
    setPaginationStatus('idle');
    isLoadingPrevRef.current = false;
    isLoadingMoreRef.current = false;
  }, 100);
}, [photos, totalHeight]); // Critical: depends on photos, not photos.length
```

### 4. Frontend: Scroll Anchor Effect Dependencies

**File**: `/client/src/components/VirtualizedPhotoGrid.jsx`

**Requirement**: The scroll anchor restoration effect must depend on `[photos, totalHeight]`, NOT `[photos.length, totalHeight]`.

**Why**: When pages are evicted during forward pagination, the total number of photos can stay the same (e.g., 400 items before and after eviction). If the effect depends on `photos.length`, it won't run, and the status won't reset to `'idle'`, permanently blocking pagination.

**Implementation**:
```javascript
// CORRECT
useEffect(() => {
  if (!scrollAnchorRef.current) return;
  // ... restoration and status reset
}, [photos, totalHeight]);

// INCORRECT - Won't trigger when length stays constant
useEffect(() => {
  if (!scrollAnchorRef.current) return;
  // ... restoration and status reset
}, [photos.length, totalHeight]);
```

## Bug History

### October 2025: Pagination Stops After 4-5 Pages

**Symptoms**: 
- Pagination stopped working after loading 4-5 pages
- IntersectionObserver and "Load More" button became unresponsive
- Status stuck in `'loading_more'` state

**Root Causes**:
1. Backend not returning `prevCursor` for forward pagination
2. Duplicate `loadInitial` calls from React strict mode
3. Status not resetting when no scroll anchor captured
4. Scroll anchor effect not triggering when `photos.length` unchanged

**Resolution**: All four issues fixed as documented above.

**Reference**: See `/tasks_progress/PAGINATION_FIX.md` for detailed analysis and fix documentation.

## Testing Checklist

When modifying pagination code, verify:

- [ ] Backend returns `prevCursor` for all paginated requests (not just initial load)
- [ ] `loadInitial` cannot be called concurrently
- [ ] Pagination status resets to `'idle'` after every load operation
- [ ] Scroll anchor restoration effect runs on every page load
- [ ] Pagination works continuously through large datasets (1000+ items)
- [ ] Both forward and backward pagination work correctly
- [ ] Page eviction maintains proper cursor state
- [ ] `hasPrev` remains true after eviction during forward pagination

## Related Files

### Backend
- `/server/services/repositories/photoFiltering.js` - Pagination logic for All Photos
- `/server/services/repositories/photoQueryBuilders.js` - Cursor creation/parsing

### Frontend
- `/client/src/hooks/useAllPhotosPagination.js` - All Photos pagination hook
- `/client/src/hooks/useProjectPagination.js` - Project pagination hook
- `/client/src/components/VirtualizedPhotoGrid.jsx` - Grid with scroll anchoring
- `/client/src/utils/pagedWindowManager.js` - Windowed page manager

### Documentation
- `/tasks_progress/PAGINATION_FIX.md` - Detailed bug fix documentation
- `/tasks_progress/PAGINATION_FIX_SUMMARY.md` - Executive summary
- `/project_docs/PROJECT_OVERVIEW.md` - Overall architecture (see "Virtualized Grid & Pagination Model")
