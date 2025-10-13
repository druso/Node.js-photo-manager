# Pagination Debug Guide

## Current Issue
After loading several pages (e.g., 400 items = 4 pages), `hasPrev` becomes `false` even though backward pagination should be possible.

## Debug Logs Enabled
1. `useAllPhotosPagination.js`: `DEBUG_PAGINATION = true`
2. `pagedWindowManager.js`: `IS_DEV = true`
3. `VirtualizedPhotoGrid.jsx`: Console logs for status changes

## What to Look For

### 1. Initial Page Load
```
[PagedWindow] Received next page with cursors: { prevCursor: null, nextCursor: '...', itemCount: 100 }
[PagedWindow] Current state before adding page: { pagesCount: 0, headPrevCursor: null, tailNextCursor: null }
```
- First page should have `prevCursor: null` (nothing before it)
- `headPrevCursor` should be `null` initially

### 2. Subsequent Page Loads
```
[PagedWindow] Received next page with cursors: { prevCursor: '...', nextCursor: '...', itemCount: 100 }
[PagedWindow] Current state before adding page: { pagesCount: 1, headPrevCursor: null, tailNextCursor: '...' }
```
- Pages 2+ should have non-null `prevCursor`
- `headPrevCursor` should remain `null` until eviction happens

### 3. Eviction (when pages.length > maxPages)
```
[PagedWindow] Before eviction: { pagesCount: 5, headPrevCursor: null, maxPages: 4 }
[PagedWindow] Evicted page 1. Current window: [2, 3, 4, 5]
[PagedWindow] After head eviction, headPrevCursor = '...'
[PagedWindow] After eviction: { pagesCount: 4, headPrevCursor: '...', firstPagePrevCursor: '...' }
```
- **CRITICAL**: After eviction, `headPrevCursor` should equal `firstPagePrevCursor`
- Both should be non-null (pointing to the first item of the new first page)

### 4. The Bug Symptom
If you see:
```
[PagedWindow] After eviction: { pagesCount: 4, headPrevCursor: null, firstPagePrevCursor: '...' }
```
This means `headPrevCursor` is not being set correctly during eviction.

## Expected Cursor Flow

### Page Structure
- Page 1: `prevCursor: null`, `nextCursor: cursor_to_page_2`
- Page 2: `prevCursor: first_item_of_page_2`, `nextCursor: cursor_to_page_3`
- Page 3: `prevCursor: first_item_of_page_3`, `nextCursor: cursor_to_page_4`
- Page 4: `prevCursor: first_item_of_page_4`, `nextCursor: cursor_to_page_5`

### After Loading Page 5 and Evicting Page 1
- Window: [Page 2, Page 3, Page 4, Page 5]
- `headPrevCursor` should be `Page2.prevCursor` (first item of Page 2)
- To load backward: use `before_cursor = first_item_of_page_2` → loads Page 1

## Possible Issues

### Issue 1: prevCursor Not Being Returned by API
If logs show:
```
[PagedWindow] Received next page with cursors: { prevCursor: null, nextCursor: '...', itemCount: 100 }
```
For pages 2+, then the backend is not returning `prevCursor` correctly.

### Issue 2: Eviction Not Updating headPrevCursor
If logs show:
```
[PagedWindow] After eviction: { headPrevCursor: null, firstPagePrevCursor: 'eyJ...' }
```
Then the eviction logic is not updating `headPrevCursor` from the first page.

### Issue 3: Page prevCursor Being Lost
If the first page's `prevCursor` is null after eviction, then the page object itself is not storing the cursor correctly.

## Testing Steps

1. Reload the page with console open
2. Scroll down to trigger pagination
3. Watch for the logs above
4. Look for the point where `headPrevCursor` becomes or stays `null` when it shouldn't
5. Share the relevant logs showing the issue

## Files Modified for Debugging
- `/client/src/hooks/useAllPhotosPagination.js` - Line 6: `DEBUG_PAGINATION = true`
- `/client/src/utils/pagedWindowManager.js` - Line 5: `IS_DEV = true`
- `/client/src/components/VirtualizedPhotoGrid.jsx` - Added console.log statements
