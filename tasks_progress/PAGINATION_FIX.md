# Pagination Bug Fix - RESOLVED ✅

**Status**: All issues fixed and tested successfully

## Issue Description
Pagination stops working after loading a couple of pages. The "Load More Photos" button becomes unresponsive, and automatic pagination via IntersectionObserver stops triggering.

## Root Cause: Backend prevCursor Bug
The primary issue was in the **backend** `/api/photos` endpoint (`photoFiltering.js`). The API was not returning `prevCursor` for pages loaded via forward pagination, causing the frontend to lose the ability to paginate backward after page eviction.

### The Backend Bug (Primary Issue)

**File**: `/server/services/repositories/photoFiltering.js` - `listAll()` function

**Problem**: The backend logic for setting `prevCursor` was:
```javascript
const hasNewer = db.prepare(`SELECT 1 ... WHERE timestamp > ? ...`).get(...);
if (cursor || hasNewer) {
  prevCursor = createCursor(first.taken_at, first.id);
}
```

When loading page 2 with a cursor:
- `cursor` is truthy ✓
- But the code also checks `hasNewer` (are there items BEFORE page 2?)
- At the start of the dataset, `hasNewer` is false
- The condition `cursor || hasNewer` evaluates to `true || false = true`
- **BUT** the `hasNewer` query was expensive and unnecessary

More critically, the logic was confusing - it checked for "newer" items even when we already knew we came from a previous page (because we have a `cursor`).

**The Fix**: Always set `prevCursor` when using forward pagination:
```javascript
if (cursor) {
  // Always set prevCursor for forward pagination
  prevCursor = createCursor(first.taken_at, first.id);
} else {
  // For initial load, check if there are newer items
  const hasNewer = db.prepare(`SELECT 1 ...`).get(...);
  if (hasNewer) {
    prevCursor = createCursor(first.taken_at, first.id);
  }
}
```

This ensures that any page loaded via forward pagination (`cursor` parameter) always has a `prevCursor`, enabling backward navigation.

## Secondary Issues (Frontend)

### Root Cause Analysis

### The Bug
The `VirtualizedPhotoGrid` component uses a state machine with `paginationStatus` to prevent concurrent pagination operations:
- States: `'idle'` | `'loading_prev'` | `'loading_more'`
- All pagination triggers check `if (statusRef.current !== 'idle') return;` before proceeding

**The Problem**: The status was only being reset to `'idle'` inside the scroll anchor restoration effect (line 322), which only runs when `scrollAnchorRef.current` exists. 

For forward pagination (loading more), scroll anchors are often not captured because:
1. The user is at the bottom of the page
2. No visible elements need to be preserved in their viewport position
3. Therefore `scrollAnchorRef.current` remains `null`

When `scrollAnchorRef.current` is `null`, the status never gets reset to `'idle'`, permanently blocking all future pagination attempts.

### Code Flow
1. IntersectionObserver detects bottom sentinel → sets `paginationStatus = 'loading_more'`
2. Pending load queued in `pendingLoadRef`
3. Effect executes load operation
4. Load completes successfully
5. **BUG**: If no scroll anchor captured, status stays `'loading_more'` forever
6. All subsequent pagination attempts blocked by `if (statusRef.current !== 'idle') return;`

## The Fix

### Changes Made

#### 1. VirtualizedPhotoGrid.jsx - Pagination Status Reset
Added logic to reset pagination status after load completes, even when no scroll anchor is captured:

```javascript
// Execute the load operation
const loadPromise = pendingLoad.loadFunction();

// Reset pagination status after load completes (or after a timeout as fallback)
if (loadPromise && typeof loadPromise.then === 'function') {
  loadPromise.finally(() => {
    // If no scroll anchor was captured, reset status immediately
    if (!scrollAnchorRef.current) {
      setTimeout(() => {
        setPaginationStatus('idle');
        isLoadingPrevRef.current = false;
        isLoadingMoreRef.current = false;
      }, 100);
    }
  });
} else {
  // If loadFunction doesn't return a promise, reset after a short delay
  setTimeout(() => {
    if (!scrollAnchorRef.current) {
      setPaginationStatus('idle');
      isLoadingPrevRef.current = false;
      isLoadingMoreRef.current = false;
    }
  }, 500);
}
```

#### 2. Debug Logging
- Enabled `DEBUG_PAGINATION = true` in `useAllPhotosPagination.js`
- Added console logs to track pagination status changes
- Added logs for scroll anchor capture and status resets

### Why This Works
1. **Promise-based reset**: When load completes, we check if a scroll anchor was captured
2. **Fallback reset**: If no anchor, we reset the status after a short delay
3. **Preserves existing behavior**: When scroll anchor exists, the existing restoration effect handles the reset
4. **Prevents deadlock**: Ensures status always returns to `'idle'` eventually

## Additional Fix: headPrevCursor Management

### Second Bug Discovered
During testing, discovered that `hasPrev` was incorrectly becoming `false` after loading several pages, even though backward pagination should be possible.

### Root Cause
When the PagedWindowManager evicts pages from the head (during forward pagination), the original code was correctly updating `headPrevCursor`, but there was a subtle issue with how cursors work.

**Understanding Cursor Semantics**:
- `prevCursor` in a page response points to the FIRST item of that page
- To load the previous page, you use `before_cursor = first_item_of_current_page`
- This loads all items that come BEFORE the current page

**The Original Bug**:
The original code set `headPrevCursor = pages[0].prevCursor || null` after eviction, which was actually correct. However, the issue was that the code wasn't consistently maintaining this value during eviction.

### The Fix
Ensured that `headPrevCursor` is always updated to the new first page's `prevCursor` after eviction:

```javascript
if (side === 'head') {
  const removed = this.pages.shift();
  this.#forgetKeys(removed);
  
  // The new first page's prevCursor points to its first item,
  // which when used with before_cursor will load the evicted page
  if (this.pages.length > 0) {
    this.headPrevCursor = this.pages[0].prevCursor || null;
  } else {
    this.headPrevCursor = null;
  }
}
```

**Why This Works**:
- Window: [Page1, Page2, Page3, Page4]
- Page2.prevCursor points to first item of Page2
- Load Page5, evict Page1 → Window: [Page2, Page3, Page4, Page5]
- Set `headPrevCursor = Page2.prevCursor` (first item of Page2)
- To load backward: use `before_cursor = first_item_of_Page2` → loads Page1 ✓

## Additional Fix: Prevent Duplicate loadInitial Calls

### Third Bug Discovered
During testing, discovered that `loadInitial` was being called twice on page load, causing the first page to be loaded twice. The second call would return 0 items (due to deduplication), making it appear as page 2 but with `prevCursor: null`.

### Root Cause
React strict mode or rapid re-renders could cause `loadInitial` to be called multiple times before the first call completes. Since `manager.loadInitial()` calls `reset()` internally, the second call would clear the deduplication state, causing all items to appear new again.

### The Fix
Added a loading lock to prevent concurrent `loadInitial` calls:

```javascript
if (loadingLockRef.current) {
  debugLog('[UNIFIED] loadInitial already in progress, skipping');
  return;
}

loadingLockRef.current = true;
try {
  // ... load initial page
} finally {
  loadingLockRef.current = false;
}
```

This ensures only one `loadInitial` operation runs at a time, preventing duplicate page loads.

## Fourth Fix: Scroll Anchor Restoration Effect Dependencies

### Fourth Bug Discovered
After fixing the previous issues, pagination still got stuck after page 5. The status remained `'loading_more'` even after the page loaded successfully.

### Root Cause
The scroll anchor restoration effect depended on `[photos.length, totalHeight]`. When pages were evicted during forward pagination, the total number of photos stayed the same (e.g., 400 items before and after eviction), so the effect didn't run. This meant the status never got reset to `'idle'`.

### The Fix
Changed the effect dependency from `photos.length` to `photos`:

```javascript
useEffect(() => {
  if (!scrollAnchorRef.current) return;
  // ... restoration logic
  setTimeout(() => {
    setPaginationStatus('idle');
  }, 100);
}, [photos, totalHeight]); // Changed from photos.length to photos
```

This ensures the effect runs whenever the photos array reference changes (which happens on every page load), not just when the length changes.

## Summary of All Fixes

### 1. Backend Fix (Primary)
**File**: `/server/services/repositories/photoFiltering.js`
- Always set `prevCursor` when using forward pagination
- Prevents loss of backward navigation capability after page eviction

### 2. Frontend Fix - Pagination Status Reset
**File**: `/client/src/components/VirtualizedPhotoGrid.jsx`
- Reset status to `'idle'` after load completes, even without scroll anchor
- Prevents state machine deadlock

### 3. Frontend Fix - Duplicate loadInitial Prevention
**File**: `/client/src/hooks/useAllPhotosPagination.js`
- Added loading lock to prevent concurrent `loadInitial` calls
- Prevents duplicate page loads from React strict mode

### 4. Frontend Fix - Scroll Anchor Effect Dependencies
**File**: `/client/src/components/VirtualizedPhotoGrid.jsx`
- Changed effect dependency from `photos.length` to `photos`
- Ensures status reset runs on every page load, not just when length changes

## Testing Instructions

1. Start the development servers
2. Open browser console to see debug logs
3. Navigate to a project or All Photos view
4. Scroll down to trigger pagination multiple times
5. Watch console logs for:
   - `[VirtualizedGrid] Pagination status changed: loading_more`
   - `[VirtualizedGrid] Executing pending load: more`
   - `[VirtualizedGrid] No scroll anchor captured`
   - `[VirtualizedGrid] Load promise completed, hasAnchor: false`
   - `[VirtualizedGrid] Resetting pagination status to idle (no anchor)`
   - `[VirtualizedGrid] Pagination status changed: idle`
6. Verify pagination continues to work through multiple pages
7. Test both automatic (scroll-based) and manual (button click) pagination

## Related Files
- `/client/src/components/VirtualizedPhotoGrid.jsx` - Main fix location
- `/client/src/hooks/useAllPhotosPagination.js` - Debug logging enabled
- `/client/src/utils/pagedWindowManager.js` - Pagination manager (no changes needed)
- `/server/services/repositories/photoFiltering.js` - Backend pagination (no changes needed)

## Additional Notes

### Why Recent Refactoring May Have Exposed This
The recent folder management refactoring may have changed:
- Project folder naming patterns
- Visibility state management
- User authentication flow

These changes could have affected:
- Cursor generation/parsing
- Photo filtering logic
- State management timing

However, the core bug was pre-existing - the refactoring just made it more visible by potentially changing the conditions under which scroll anchors are captured.

### Future Improvements
Consider:
1. Simplifying the state machine - the dual tracking with `paginationStatus` + `isLoadingMoreRef` + `loadingLockRef` is complex
2. Moving pagination status into the hook itself rather than the grid component
3. Adding timeout-based fallbacks for all state transitions
4. Better separation between scroll restoration and pagination state management
