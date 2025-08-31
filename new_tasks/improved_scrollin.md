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

- __Phase 1: Virtualization (front-end only)__
  - Introduce a `VirtualizedPhotoGrid` (new component) that wraps the justified layout with row virtualization and spacers.
  - Keep current forward-only pagination; no API changes.
  - Keep All/Project mode behaviors and deep links intact.
  - Metrics: DOM node count vs. items; memory and FPS while scrolling.
  - Add precise scroll restore using session storage and cumulative row heights; implement center-on-open for deep links.

- __Phase 2: Bidirectional pagination__
  - Backend: add `before_cursor` support to All Photos and Project list endpoints; return both `prev_cursor` and `next_cursor`.
  - Client: add the paged window manager with prepend/append support; integrate with virtualization window.
  - Bootstrap from `locateAllPhotosPage()` for deep links; wire `prev_cursor` immediately.

- __Phase 3: Polish__
  - Smooth scroll anchoring across page inserts/removals; ensure no jump when prepending pages.
  - Add idle prefetch (one page in each available direction).
  - Add test coverage.
  - Add tests for scroll restore across reloads and deep-link center-on-open.

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
