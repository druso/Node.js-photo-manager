---
Title: Improved Scrolling & Pagination Plan
Date: 2025-08-29
Owners: Frontend & Backend
Goal: Virtualized grid with smooth bidirectional pagination (down AND up), fully compatible with deep links and filters.
---

# Findings (Current State)

- __Infinite scroll is one‑directional (down only)__
  - `client/src/components/PhotoGridView.jsx` triggers `onLoadMore()` when near bottom. No mechanism to request previous pages when user scrolls up.
  - `visibleCount` fallback is local-only for preloaded lists; not applicable to server-backed pages.

- __All Photos paging & deep links__
  - `client/src/App.jsx` uses `listAllPhotos()` with `cursor` for forward pages and `locateAllPhotosPage()` to jump into a page containing a deep-linked photo.
  - After locate, client gets `res.items` and `res.next_cursor`; `res.prev_cursor` exists for locate but the normal `listAllPhotos()` API does not accept a "before" cursor to go upward.
  - Filters (`file_type`, `keep_type`, `orientation`, `date_from`, `date_to`) flow end-to-end and trigger reloads. Deep links use basename in URLs and are preserved when opening/closing viewer.

- __Project view paging__
  - Similar forward-only cursor via `listProjectPhotos()`.

- __Constraints to preserve__
  - Deep links must continue to work (URLs: `/all/:projectFolder/:name` and `/:projectFolder/:name`).
  - Filters must remain the single source of truth for loaded results and URL query params.
  - Viewer open/close should not disrupt grid position.

# Objectives

- __Virtualized rendering__: Windowed grid to reduce DOM/memory while maintaining justified layout look.
- __Bidirectional pagination__: Ability to load pages both after and before the current window, esp. when starting from a deep-linked mid-page entry (e.g., page 5) and scrolling up toward page 4/3.
- __State stability__: Maintain stable item keys and indices across appends/prepends so selection and viewer indices don’t drift.

# Proposed Design

## 1) Virtualized Justified Grid

- __Approach__
  - Use a windowing strategy on top of the existing justified layout. Keep custom justified rows; virtualize rows (row-level virtualization) using a small in-house window manager.


- __Row Virtualization Plan__
  - Compute justified rows as we do now, but only for a buffer window around the viewport (e.g., +/- N rows).
  - Maintain an index→row map and cumulative row heights to translate scroll Y → row range.
  - Render only rows within the window. Use an outer container with a fixed total height spacer (top and bottom paddings) to preserve scroll position.
  - Keep `IntersectionObserver` only for lazy image load inside the virtualized window.

- __Keys & selection__
  - Continue using composite keys: `${project_folder}::${filename}`.
  - Ensure keys remain stable even when rows are re-sliced.

- __Viewer compatibility__
  - Snapshot the current item list (windowed slice) when opening the viewer to prevent index drifting while new pages load.

## 3) Scroll Positioning & Restoration (Precise)

- __Goals__
  - Precisely center a specific photo in the viewport when deep-linking or when opening the viewer from a deep link.
  - Persist and restore scroll position across reloads using session storage while being compatible with virtualization and bidirectional paging.

- __State storage__
  - Reuse `sessionStorage` under key `session_ui_state` managed by `client/src/utils/storage.js`.
  - Persist `windowY` (overall page scroll) and `mainY` (scrollable grid container) on scroll with throttling.

- __Restoration algorithm (with virtualization)__
  - On grid mount:
    - Read saved `mainY`. If present and filters/route match, restore by setting container scrollTop to `mainY`.
    - Use cumulative row heights to derive initial visible row range; render with top/bottom spacers to land exactly at `mainY` without visible jump.
    - If the saved position falls inside unloaded pages (e.g., after refresh from a mid-list deep link), bootstrap via `locateAllPhotosPage()` and adjust top spacer to approximate `mainY` until exact rows materialize, then correct subtly (no animation) when the target row is computed.

- __Deep-link scroll-to-center__
  - After `locateAllPhotosPage()` loads the containing slice, attempt to find the target cell by key `${project_folder}::${filename}` (case-insensitive basename also supported per existing behavior in `App.jsx`).
  - If present, compute target cell’s center Y and set `container.scrollTop` so the cell is centered: `scrollTop = cellCenterY - viewportHeight/2`. Fallback to `element.scrollIntoView({ block: 'center' })` for simplicity when layout metrics aren’t ready.
  - Retry centering on next microtask/frame if the element is not yet rendered due to virtualization; give up after a small capped number of retries.

- __When opening viewer__
  - Ensure the grid centers the photo (same centering routine) before opening, so closing the viewer returns to a view where the focused photo remains centered.

- __During pagination__
  - When prepending earlier pages, increase top spacer equivalently to inserted content height to avoid scroll jump (anchor scrolling). When dropping far pages, increase/decrease opposite spacer to keep `scrollTop` stable.

## 2) Bidirectional Pagination Model

- __API evolution (recommended)__
  - Extend All-Photos and Project endpoints to support backward paging.
    - Add optional `before_cursor` (string) param to fetch items immediately "before" a cursor in the current sort (DESC by taken_at/id for All; current sort for Project).
    - Continue returning `next_cursor` for forward and add `prev_cursor` when applicable.
  - Reuse existing `locateAllPhotosPage()` for deep links; it already returns both `nextCursor` and `prevCursor`. From that starting slice, the UI can navigate up using `before_cursor = prevCursor`.
  - Backward-compat: If `before_cursor` is absent, behavior remains unchanged.

- __Client state manager__
  - Maintain a __paged window__ data structure:
    - `pages`: ordered map of pageIndex → { items, next_cursor, prev_cursor }.
    - `anchor`: the deep-link starting page index (e.g., 0), with ability to prepend earlier pages at negative indices and append later pages at positive indices.
    - `itemsIndex`: a synthesized view that concatenates pages in order for rendering.
  - On scroll near top: if `pages[minIndex].prev_cursor` exists and not loading, request `before_cursor` to prepend the previous page and update indices. Keep a max pages limit and drop far-away pages to bound memory.
  - On scroll near bottom: use `next_cursor` as today.

- __Stability & dedupe__
  - Continue dedupe using a `seenKeys` Set across the whole window.
  - When truncating far pages, adjust the top/bottom spacers to preserve visual scroll position.

## 3) URL, Filters, and Deep Links

- __URL as source of truth__
  - Preserve current behavior in `App.jsx`: parse filters from URL; push state on selection/viewer actions; avoid updating URL during deep-link resolution (`suppressUrlRef`).

- __Deep-link bootstrap__
  - Stay with `locateAllPhotosPage()` to seed a mid-list page. Initialize `pages` with:
    - `pages[0] = locate.items`, `next_cursor = locate.nextCursor`, `prev_cursor = locate.prevCursor`.
    - Immediately allow "scroll up" to use `prev_cursor`.

- __Filter changes__
  - Any filter/sort change resets `pages` and window; API re-queried with new params.

## 4) Performance & UX

- __Placeholders & dwell__
  - Keep the current dwell-based lazy image reveal within visible cells.

- __Preload buffer__
  - When idle, prefetch one page ahead (both directions if cursors exist) to eliminate perceived gaps.

- __Error handling__
  - If a before/next cursor request fails, keep the window intact; show a lightweight inline retry affordance near the edge.

# Incremental Implementation Plan

## Phase 1: Core Virtualization Infrastructure

### Step 1.1: Create VirtualizedPhotoGrid Component Foundation
- [ ] Create `client/src/components/VirtualizedPhotoGrid.jsx` with basic structure
- [ ] Implement row height calculation utilities in `client/src/utils/gridVirtualization.js`
- [ ] Add cumulative height mapping for Y→row translation
- [ ] Create spacer components (top/bottom) for scroll position preservation

**🛑 STOP FOR USER TESTING:**
Test that the new component renders without breaking existing grid layout. Verify:
- Grid still displays photos in justified rows
- No visual regressions in spacing or alignment
- Component accepts same props as original PhotoGridView

### Step 1.2: Implement Basic Row Virtualization
- [ ] Add viewport detection and visible row range calculation
- [ ] Implement windowed rendering (only render visible + buffer rows)
- [ ] Add top/bottom spacers to maintain total scroll height
- [ ] Preserve existing IntersectionObserver for lazy loading within visible window

**🛑 STOP FOR USER TESTING:**
Test virtualization with large photo sets (500+ photos). Verify:
- DOM node count significantly reduced (check DevTools Elements tab)
- Smooth scrolling performance maintained
- No flickering or layout jumps during scroll
- Lazy loading still works for visible images

### Step 1.3: Integrate Virtualization with Existing Grid
- [ ] Replace `PhotoGridView` usage in `client/src/App.jsx` with `VirtualizedPhotoGrid`
- [ ] Ensure All Photos and Project views both use virtualized grid
- [ ] Maintain existing prop interfaces and event handlers
- [ ] Add feature flag `ENABLE_VIRTUALIZATION` for rollback capability

**🛑 STOP FOR USER TESTING:**
Full regression test of existing functionality:
- All Photos view loads and scrolls correctly
- Project view loads and scrolls correctly
- Photo selection works across virtualized boundaries
- Viewer opening/closing maintains grid position

## Phase 2: Scroll Position Management

### Step 2.1: Implement Session-Based Scroll Restoration
- [ ] Extend `client/src/utils/storage.js` with scroll position persistence
- [ ] Add throttled scroll position saving (mainY for grid container)
- [ ] Implement scroll restoration on grid mount with virtualization compatibility
- [ ] Handle edge cases: filter changes, route changes, page refreshes

**🛑 STOP FOR USER TESTING:**
Test scroll position persistence:
- Navigate away and back - scroll position restored
- Refresh page - scroll position restored
- Change filters - scroll resets appropriately
- Switch between All/Project views - positions maintained separately

### Step 2.2: Implement Precise Deep-Link Centering
- [ ] Add photo centering utilities in `client/src/utils/scrollUtils.js`
- [ ] Implement `scrollToPhotoCenter()` function with viewport calculation
- [ ] Integrate centering with `locateAllPhotosPage()` flow
- [ ] Add retry mechanism for virtualization timing issues
- [ ] Handle both filename and basename matching (existing behavior)

**🛑 STOP FOR USER TESTING:**
Test deep-link centering:
- Direct URL to specific photo centers it in viewport
- Opening viewer from deep-link maintains centering
- Closing viewer returns to centered position
- Works in both All Photos and Project views

## Phase 3: Bidirectional Pagination Backend

### Step 3.1: Extend All Photos API for Backward Pagination
- [ ] Modify `server/routes/photos.js` - add `before_cursor` parameter support
- [ ] Update `server/services/repositories/photosRepo.js` - implement backward cursor logic
- [ ] Ensure `prev_cursor` is returned in responses when applicable
- [ ] Maintain backward compatibility (existing clients unaffected)

**🛑 STOP FOR USER TESTING:**
Test API extensions with curl/Postman:
- Forward pagination still works identically
- `before_cursor` parameter returns correct previous page
- `prev_cursor` and `next_cursor` both present in responses
- Edge cases: first page, last page, invalid cursors

### Step 3.2: Extend Project Photos API for Backward Pagination
- [ ] Modify `server/routes/projects.js` - add `before_cursor` parameter support
- [ ] Update project-specific photo listing logic
- [ ] Ensure consistent cursor behavior between All Photos and Project views
- [ ] Test with different project sorting options

**🛑 STOP FOR USER TESTING:**
Test Project API backward pagination:
- Works with all existing project sort orders
- Cursor behavior consistent with All Photos API
- Project-specific filters work with bidirectional pagination

## Phase 4: Bidirectional Pagination Frontend

### Step 4.1: Create Paged Window Manager
- [ ] Create `client/src/utils/pagedWindowManager.js` with core data structure
- [ ] Implement `pages` map with negative/positive indices around anchor
- [ ] Add `itemsIndex` synthesis for rendering
- [ ] Implement page append/prepend with deduplication
- [ ] Add memory management (drop far pages, adjust spacers)

**🛑 STOP FOR USER TESTING:**
Unit test the window manager:
- Pages can be appended and prepended correctly
- Item synthesis maintains correct order
- Deduplication works with composite keys
- Memory limits respected (old pages dropped)

### Step 4.2: Integrate Window Manager with All Photos
- [ ] Replace linear array state in `client/src/App.jsx` with paged window
- [ ] Implement scroll-triggered backward pagination (near top edge)
- [ ] Maintain existing forward pagination behavior
- [ ] Bootstrap from `locateAllPhotosPage()` with both cursors available

**🛑 STOP FOR USER TESTING:**
Test All Photos bidirectional scrolling:
- Scroll down loads more pages (existing behavior maintained)
- Scroll up from mid-list loads previous pages
- Deep links work and allow scrolling in both directions
- Performance remains smooth with large datasets

### Step 4.3: Integrate Window Manager with Project Views
- [ ] Apply same paged window pattern to project photo lists
- [ ] Ensure project-specific sorting works with bidirectional pagination
- [ ] Maintain existing project view behaviors and filters

**🛑 STOP FOR USER TESTING:**
Test Project view bidirectional scrolling:
- Same bidirectional behavior as All Photos
- Project filters work correctly
- Project sorting maintained
- Deep links within projects work

## Phase 5: Advanced Features & Polish

### Step 5.1: Implement Smooth Scroll Anchoring
- [ ] Add scroll position preservation during page prepends
- [ ] Implement spacer height adjustments to prevent jumps
- [ ] Handle virtualization window shifts during pagination
- [ ] Add smooth transitions for better UX

**🛑 STOP FOR USER TESTING:**
Test scroll anchoring:
- No visible jumps when scrolling up loads previous pages
- Scroll position feels natural and predictable
- Virtualization doesn't cause layout shifts

### Step 5.2: Add Idle Prefetching
- [ ] Implement idle detection utilities
- [ ] Add prefetch logic for next/previous pages when user is idle
- [ ] Respect memory limits and user bandwidth
- [ ] Add configuration options for prefetch behavior

**🛑 STOP FOR USER TESTING:**
Test prefetching behavior:
- Pages load proactively during idle periods
- No impact on active scrolling performance
- Memory usage remains bounded
- Works well on slower connections

### Step 5.3: Error Handling & Recovery
- [ ] Add retry mechanisms for failed page loads
- [ ] Implement graceful degradation when cursors become invalid
- [ ] Add user-visible error states with retry options
- [ ] Handle network interruptions gracefully

**🛑 STOP FOR USER TESTING:**
Test error scenarios:
- Network failures show appropriate error states
- Retry mechanisms work correctly
- Invalid cursors handled gracefully
- App remains functional during partial failures

## Phase 6: Testing & Documentation

### Step 6.1: Comprehensive Testing Suite
- [ ] Add unit tests for virtualization utilities
- [ ] Add integration tests for paged window manager
- [ ] Add E2E tests for deep-link scenarios
- [ ] Add performance benchmarks and regression tests

**🛑 STOP FOR USER TESTING:**
Run full test suite and verify:
- All tests pass consistently
- Performance benchmarks meet targets
- No regressions in existing functionality

### Step 6.2: Update Documentation
- [ ] Update `PROJECT_OVERVIEW.md` with virtualization details
- [ ] Document new API parameters in `SCHEMA_DOCUMENTATION.md`
- [ ] Add troubleshooting guide for common issues
- [ ] Update `README.md` with performance improvements

**🛑 STOP FOR USER TESTING:**
Review documentation:
- Technical details are accurate and complete
- User-facing changes are clearly explained
- Troubleshooting guides are helpful

## Phase 7: Production Readiness

### Step 7.1: Performance Optimization
- [ ] Profile and optimize critical rendering paths
- [ ] Implement memory leak detection and prevention
- [ ] Add performance monitoring and metrics
- [ ] Optimize for mobile devices and slower hardware

**🛑 STOP FOR USER TESTING:**
Performance validation:
- Memory usage stable over extended use
- Smooth performance on target devices
- No memory leaks detected
- Metrics show improvement over baseline

### Step 7.2: Feature Flag Management & Rollout
- [ ] Implement comprehensive feature flags for gradual rollout
- [ ] Add monitoring and rollback procedures
- [ ] Create deployment checklist and validation steps
- [ ] Plan phased rollout strategy

**🛑 STOP FOR USER TESTING:**
Final validation:
- Feature flags work correctly
- Rollback procedures tested
- Production deployment ready
- All acceptance criteria met

# Risks & Mitigations

- __Index drift while paginating__: Snapshot list on viewer open; use stable keys and avoid in-place reordering of visible slice.
- __URL/desync during deep-link resolution__: Continue using `suppressUrlRef` pattern already present in `App.jsx`.
- __Filter/sort changes mid-scroll__: Centralize reset logic; cancel inflight requests; clear window state and refetch.

# Required Code Touch Points

- Client:
  - `client/src/components/PhotoGridView.jsx` → factor out into/around `VirtualizedPhotoGrid` with row windowing, spacers, and top/bottom edge triggers.
  - `client/src/App.jsx` → replace linear arrays with paged-window manager for All and (optionally) Project views.
  - Add small utility for cumulative heights per row for fast Y→row mapping.

- Server:
  - All Photos list route and Project list route: accept `before_cursor`, return `prev_cursor` (backward-compatible).
  - Maintain existing `locateAllPhotosPage()`; it already returns `prevCursor`/`nextCursor`.

# Testing Matrix

- __Deep links__
  - Open at mid-list (All + Project). Scroll up to load earlier page; scroll down to load later page. Ensure the deep-linked photo remains visible and selection works.

- __Filters/Sort__
  - Change any filter or sort; window resets; deep link still opens correctly with new constraints.

- __Performance__
  - Large datasets: verify low DOM node count, stable FPS, and no memory ballooning.

- __Accessibility__
  - Keyboard navigation across virtualized rows; focus does not get trapped or lost.

# Rollback Strategy

- Keep the original `PhotoGridView` behind a feature flag (`VIRTUAL_GRID=false`) to revert quickly.
- API additions are additive; clients can continue using forward-only cursor if needed.
