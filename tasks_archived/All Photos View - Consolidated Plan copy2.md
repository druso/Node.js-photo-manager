# All Photos View — Consolidated Plan (Authoritative)

This document supersedes:
- `new_tasks/All Photos View - Homepage Plan.md`
- `new_tasks/temp_plan.md`

It reflects the current implementation status and the remaining work to finish v1 of All Photos.

---

## 1) Current Status (Done)

- Backend
  - `/api/photos` implemented and mounted in `server.js` via `server/routes/photos.js`.
  - Keyset pagination over `taken_at := COALESCE(date_time_original, created_at) DESC, id DESC` with base64 cursor `{ taken_at, id }` in `photosRepo.listAll()`.
  - Fixed cursor decoding (URL-safe variants + padding) and SQL precedence for archived projects exclusion.
  - Disabled caching on the endpoint (`Cache-Control: no-store`).
  - Added granular debug logs around cursor parse, query, and page boundaries for diagnostics.

- Frontend
  - All Photos pagination now advances correctly. Added guards in `client/src/App.jsx`:
    - Synchronous reentrancy lock to avoid concurrent page loads.
    - Seen-cursor guard to prevent loops.
    - Stop conditions only on exhaustion or non-advancing cursor.
  - Disabled HTTP caching on the client for `/api/photos` (`fetch` with `{ cache: 'no-store' }`).
  - SSE: Implemented a singleton in `client/src/api/jobsApi.js` to prevent multiple `/api/jobs/stream` connections and 429s.

- Observability
  - Route-level request/response logs and repository-level cursor/query logs added for quick triage if pagination regresses.

---

## 2) Product Scope (v1)

- Use keyset-paginated All Photos grid across non-archived projects.
- Filtering: Date range only in v1 (no text search, no orientation/file-type filters yet).
- Selection affordances remain available in All Photos. Overlay "View" opens the project-scoped viewer; clicking the thumbnail can toggle selection.
- No edits in All Photos (keep/tag/commit/revert/rename/delete/download hidden).
- Single viewer is used everywhere; do not fork components. In All Photos, editing actions are simply hidden.
- SSE handling is minimal in All Photos: handle only `item_removed`/`item_moved` to keep `project_folder` and thumbnail URLs correct. Do not process general `item` updates.

---

## 4) Routing & Deep Links

- Routes
  - `/all` — All Photos mode.
  - `/projects/:folder` — Project mode.
- Deep link behavior
  - Opening a specific photo from All Photos should navigate to `/projects/:folder?file=:filename` and auto-open the full viewer there.
  - All Photos can accept a deep link to a specific photo and should first render the page containing the target, then open the full viewer on that exact item (no need to load all prior pages).
- Persistence
  - Mode/toggle in `localStorage`.
  - Scroll and viewer state in `sessionStorage` (existing helpers in `client/src/App.jsx`).
  - Toggle UI sits next to the Project selector; when on `/all` the selector is disabled/ignored; when navigating back to a project route the selector re-enables.

---

## 5) API Summary

- `GET /api/photos`
  - Query: `limit` (default 100, max 200), `cursor` (base64 `{ taken_at, id }`), `date_from?`, `date_to?`.
  - Sort: `taken_at DESC, id DESC`.
  - Response: `{ items: [...], next_cursor }`, with `project_folder`, `project_name`, `taken_at`, derivative statuses, and basic metadata.
  - Excludes archived projects (`p.status IS NULL OR p.status != 'canceled'`).
  - Caching disabled.
  - Date bounds (client → server):
    - `date_from`: `YYYY-MM-DDT00:00:00.000Z`
    - `date_to`: `YYYY-MM-DDT23:59:59.999Z` (inclusive day end)

---

## 6) Remaining Work

- Backend
  - [ ] (Deferred to post‑v1) Optional counts: `total_all` and `total_filtered` for UI summaries. Consider lightweight COUNTs gated behind a query flag if needed.

- Frontend
  - [ ] Pagination: ensure infinite scroll forward continues to fetch the next page using existing guards (`allSeenCursorsRef`, `allLoadingLockRef`) and dedupe by `project_folder::filename`.
  - [ ] Deep link: when the URL targets a photo not in the first page, fetch pages sequentially until the page containing the target is rendered; then open the full project-scoped viewer focused on that image.
  - [ ] Reduce All Photos toolbar to essentials; Filters dropdown shows Date only in v1.
  - [ ] Unified viewer flow: a single viewer is used everywhere. Grid overlay shows "View" and opens the project-scoped viewer directly; selection behaviors remain available in All Photos when items are selected.
  - [ ] SSE (All Photos): subscribe via the existing singleton in `client/src/api/jobsApi.js` and handle only `item_removed` and `item_moved` events to keep thumbnails and project references correct.

- QA
  - [ ] Pagination: verify cursor advancement, no duplicate pages, stable ordering across loads.
  - [ ] Filters: verify date range boundaries (day start/end) and that results match expectations.
  - [ ] Deep link: direct `/all/:folder/:filename` first renders the page containing the target, then opens the viewer on that exact item; no preloading of all prior pages.
  - [ ] Viewer (unified): overlay "View" opens the project-scoped viewer; selection affordances remain in All Photos and action controls appear when selected.
  - [ ] Toggle behavior: on `/all`, project selector is disabled; on project routes, it is enabled and functional.
  - [ ] SSE (minimal in All Photos): only `item_removed`/`item_moved` are processed; no 429s; thumbnails/project folder stay consistent. Confirm singleton connection remains 1.

- Docs (after final verification per repo rules)
  - [ ] Update `PROJECT_OVERVIEW.md`, `README.md`, `SCHEMA_DOCUMENTATION.md`, `SECURITY.md` to include: `/api/photos`, deep-link behavior, and SSE singleton note.

---

## Implementation Steps (for developer)

These steps reference the tasks in "Remaining Work" and use the existing QA list for full validation. Each step includes a minimal UI test you can run while developing.

1) Baseline sanity (no code changes)
- Verify `/all` loads and paginates; one SSE connection active.
- Test: Open `/all`, scroll to load extra pages; Network shows `GET /api/photos` with `cache: no-store`; only one EventStream connection.

2) Deep link finalize — App.jsx
- Use existing `/all/:folder/:filename` parsing. On initial load, fetch pages sequentially until the page containing the target photo is rendered (do not preload all prior pages). After that page is rendered, open the project-scoped viewer focused on the exact target item.
- Test: Visit `/all/<folder>/<filename>`; the grid first renders the page containing the target, then the viewer opens on that exact item; further scroll continues to paginate normally.

3) Date-only toolbar in All Photos — UniversalFilter/parent
- When `isAllMode`, render only Date range; keep request day bounds as already defined in API Summary.
- Test: On `/all`, only Date controls visible; changing range alters results; Network shows `date_from`/`date_to`.

4) Unified viewer flow — PhotoGridView.jsx + PhotoViewer.jsx + App.jsx
- Keep a single viewer. Grid overlay button always shows "View" and opens the project-scoped viewer directly; clicking thumbnail can continue to toggle selection in All Photos. Ensure selection action controls appear when items are selected.
- Test: In `/all`, overlay "View" opens the project-scoped viewer; selection affordances remain available; in project routes, behavior is consistent.

5) Selection affordances in All Photos — grid/thumbnail owner
- Ensure selection state/UI remains in `/all` and action affordances appear when items are selected. Overlay "View" still opens the viewer.
- Test: In `/all`, selecting items shows action controls; overlay "View" opens viewer; in project routes, click/overlay behaviors remain as designed.

6) SSE minimal handling in All Photos — App.jsx
- Subscribe via existing singleton; handle only `item_removed` and `item_moved` to keep the grid accurate.
- Test: While on `/all`, move an item between projects → row reflects new project; remove assets → row disappears; still one SSE connection, no 429s.

7) QA + docs (final)
- Run the full QA list in Remaining Work; then update docs noted there.
- Test: Confirm each QA bullet passes before marking done.

---

## 7) Technical Notes & References

- Client
  - `client/src/App.jsx` — paging guards, scroll/viewer persistence.
  - `client/src/components/PhotoGridView.jsx` — infinite scroll and row layout.
  - `client/src/api/allPhotosApi.js` — fetch options (no-store), cursor passing.
  - `client/src/api/jobsApi.js` — SSE singleton to avoid 429s.
- Server
  - `server/routes/photos.js` — endpoint and response shape.
  - `server/services/repositories/photosRepo.js` — `listAll()` keyset pagination and logging.
- Docs
  - `PROJECT_OVERVIEW.md`, `SECURITY.md`, `SCHEMA_DOCUMENTATION.md`, `README.md`.

---

## 8) Acceptance Criteria (v1)

- All Photos grid loads via keyset pagination and infinite scroll.
- Date range filter works and matches server semantics.
- Deep links to specific photos first render the page containing the target, then open the viewer on that exact item (without loading all prior pages).
- Jump to project view works (`/projects/:folder?file=:filename`) with full viewer features.
- SSE remains single-connection; no 429s.
- Documentation updated as per repo rules once testing confirms behavior.
- Unified viewer flow: overlay "View" opens the project-scoped viewer; editing actions are hidden in All Photos; selection affordances visible when items are selected.

## 9) Operational Plan & Ownership

### Owner and timeline

- Owner: Cascade
- Start: 2025-08-26 (UTC)
- Milestones (targets):
  - M1 — Deep link finalize (App.jsx): 2025-08-27
  - M2 — Date-only toolbar (Filters): 2025-08-27
  - M3 — Unified viewer + selection (Grid/Viewer): 2025-08-28
  - M4 — SSE minimal handling (App.jsx): 2025-08-28
  - M5 — QA + Docs: 2025-08-29

### Execution checklist (files to touch)



- [ ] 4) Unified viewer flow — single viewer across modes
  - Files: `client/src/components/PhotoGridView.jsx`, `client/src/components/PhotoViewer.jsx`, `client/src/App.jsx`
  - Behavior: Grid overlay button shows "View" and opens project-scoped viewer; clicking thumbnail can still toggle selection in All Photos. Do not fork components.


- [ ] 6) SSE minimal handling in All Photos — reconcile only moves/removals
  - Files: `client/src/App.jsx` (subscription wiring), `client/src/api/jobsApi.js` (existing singleton)
  - Events handled: `item_removed` → remove from All Photos list; `item_moved` → update `project_folder` and any dependent URLs for the item.

- [ ] 7) QA + Docs — run QA bullets and update docs
  - Files: `PROJECT_OVERVIEW.md`, `README.md`, `SCHEMA_DOCUMENTATION.md`, `SECURITY.md`

### Technical specifics

- Dedupe key for items: `${project_folder}::${filename}`. Maintain a `Set` to skip duplicates while paginating.
- Found-target paging: Loop `GET /api/photos?cursor=...` until the page containing the target is rendered; stop early once found. Do not preload prior pages.
- Date bounds: Use inclusive day bounds as defined (`date_from: YYYY-MM-DDT00:00:00.000Z`, `date_to: YYYY-MM-DDT23:59:59.999Z`).
- SSE: Use the global singleton `openJobStream()` from `client/src/api/jobsApi.js`. In All Photos mode, only handle `item_removed`/`item_moved` and ignore general `item` updates to minimize churn.
- UI state: Continue preserving window/main scroll and viewer state per existing `sessionStorage` helpers; lazy-load window should not reset on incremental updates.

### Risks & mitigations

- Duplicate pages or cursor loops → Guard with `allSeenCursorsRef` and a reentrancy lock (already present).
- SSE 429s during dev → Singleton is already implemented; avoid multiple subscriptions; confirm only one active EventSource.
- Scroll/viewer disruption → Use existing preservation utilities in `client/src/App.jsx`; apply changes incrementally.

### Definition of Done

- All Acceptance Criteria in section 8 pass on manual QA.
- Docs updated per repo rules (Overview, README, Schema, Security).
- One SSE connection confirmed in DevTools. No duplicate items in All Photos across pagination.
