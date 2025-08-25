# All Photos View — Integrated Plan v2 (Supersedes previous sections)

This plan replaces and supersedes all previous sections in this file. It clarifies integration with the existing app, corrects the toggle placement/behavior, and eliminates duplicated implementations. We ONLY extend existing components with minimal props/flags. No new parallel objects or filter systems.

---

# All Photos View — Optimized v1 Brief (Authoritative)

Use this section as the single source of truth for v1. Everything below remains for context but is superseded by this brief.

## 0) Scope (v1)

- Minimal, fast cross‑project browsing.
- Filters: Date range only. Default server filter includes items with generated thumbnails (has_thumb=true).
- No selection, no batch actions, no table view, no uploads UX. Single‑photo “Move to project” only from viewer.

## 1) Routing (URL is the source of truth)

- `/all` → All Photos mode. Project selector is disabled in this route.
- `/projects/:folder` → Project mode (full features). Selector enabled.
- The “All Photos” toggle merely navigates between these routes and persists the last choice in `localStorage`. UI state (scroll/viewer) continues in `sessionStorage` via existing helpers in `client/src/App.jsx`.

## 2) Backend API (read‑only)

- Route: `GET /api/photos`
- Query params:
  - `limit` (default 100, max 200)
  - `cursor` (opaque keyset token)
  - `date_from?`, `date_to?`
  - `has_thumb?` (default true; filters `thumbnail_status='generated'`)
- Ordering: `COALESCE(date_time_original, created_at) DESC, id DESC`.
- Cursor encodes both fields: `{ coalesced_taken_iso, id }`. Null dates fall back to `created_at`.
- Exclude archived projects: join `projects.status <> 'canceled'`.
- Response item fields:
  - `id, project_id, project_folder, project_name, filename`
  - `thumbnail_status, preview_status`
  - `date_time_original, created_at, updated_at`
  - Optional alias `taken_at` returned as `COALESCE(date_time_original, created_at)` (documented; not a stored column).

Indexes (v1 pragmatic):
- Ensure indexes on `photos(date_time_original)`, `photos(created_at)`, and `photos(id)`.
- Order by the coalesced expression; verify performance with sample data. If needed later, consider a materialized computed column for `taken_at` and index `(taken_at DESC, id DESC)`.

## 3) Client

- New route `/all` rendering existing `client/src/components/PhotoGridView.jsx` with `simplifiedMode`.
- Filters UI: Date range only. No text search, Orientation, or File Types in v1.
- Grid behavior in `simplifiedMode`:
  - No selection overlays. Any click opens the viewer.
  - Pass `project_folder` per item to `Thumbnail.jsx`.
- Toggle next to project selector navigates between `/all` and the last `/projects/:folder`.

## 4) Viewer (reuse existing with a prop)

- Add `simplifiedMode` prop to the existing viewer component.
- Hide edit/keep/tag controls in simplified mode.
- Show basic metadata, project label, and:
  - Primary action: “Open in project” → `/projects/:folder?file=:filename` (auto‑opens full viewer there).
  - Single‑photo “Move to project” action lives here (not in the grid).

## 5) SSE (minimal)

- Reuse the singleton in `client/src/api/jobsApi.js`.
- In All Photos, subscribe only to `item_removed` and `item_moved` to keep `project_folder` and thumb URLs correct. Do not process general `item` updates.

## 6) Out of scope for v1 (defer to v2)

- Orientation and File Types filters (may add later via computed `is_portrait` and supporting indexes).
- Global drag‑and‑drop upload with project‑picker modal.
- Cross‑project text search and table view.

## 7) Repository and predicate reuse

- Add/centralize a small predicate builder in `server/services/repositories/photosRepo.js` so `/api/projects/:folder/photos` and `/api/photos` share date/has_thumb filter semantics and ordering logic, avoiding drift.

## 8) Definition of Done (v1)

- Backend: `/api/photos` with keyset pagination and date + has_thumb filters; excludes archived projects; returns fields listed above.
- Client: `/all` route uses `PhotoGridView` with `simplifiedMode`; Date filter only; thumbs pass `project_folder`.
- Viewer: `simplifiedMode` implemented; “Open in project” deep link auto‑opens full viewer; single‑photo Move action available only here.
- SSE: only `item_removed`/`item_moved` handled in All Photos.
- Persistence: toggle via `localStorage`, scroll/viewer via `sessionStorage`.
- Docs: update `PROJECT_OVERVIEW.md`, `SECURITY.md`, `SCHEMA_DOCUMENTATION.md`, `README.md` for the new endpoint, routing, and UX.

---

## A) Integration Model (No new objects)

- Project selector + All Projects toggle live side-by-side in the existing top bar (`client/src/App.jsx`).
  - Toggle UI: compact switch labeled “All” with an info tooltip “Show photos from all projects”. States: OFF (Project mode), ON (All Projects mode).
  - When ON → the project selector is disabled (grayed out) and ignored by routing.
  - When OFF → the user must pick a project; full project features are enabled.
- Reuse existing components; do not fork:
  - Grid: `client/src/components/PhotoGridView.jsx` with `simplifiedMode` when All Photos is ON.
  - Thumbnail: `client/src/components/Thumbnail.jsx` unchanged; it already supports `loading="lazy"` and retry.
  - Viewer: existing viewer component gains a `simplifiedMode` prop to hide edit/keep/tags and show only “Open in project”.
  - Filters panel: reuse current panel but hide non‑applicable filters when All Photos is ON (no duplicate filter code).
  - Action menu: reuse existing Operations menu; limit visible actions via a parameter (same component, different mode).
  - SSE: reuse singleton in `client/src/api/jobsApi.js`.

## B) UX Behavior by Mode

- Project mode (toggle OFF):
  - Project selector enabled. Full UI: filters, grid/table, action menu (all items), full viewer with edit/keep/tag.

- All Photos mode (toggle ON):
  - Project selector disabled.
  - Filters panel (reused component): reduced to Date range, Orientation, and File Types available. Remove text search and any heavy cross‑project filters.
  - Grid: `PhotoGridView` in `simplifiedMode`. No selection overlays; any click opens the viewer.
  - Action menu (same component): only “Move to” remains (invokes existing Image Move task). Hide others (keep/commit/revert/tag/rename/delete/download) via parameter.
  - Viewer: `simplifiedMode`; preview on demand, metadata basics, and a single button “Open in project” linking to `/projects/:folder?file=:filename`.
  - SSE: minimal reconcile for Image Move only (`item_removed` and `item_moved`) to keep `project_folder`/thumb URLs correct; no broad cross‑page reconcile.

## C) Routing & Persistence

- New route `/all` renders All Photos grid using existing grid component.
- App start:
  - If toggle was ON last session (`localStorage`), route to `/all` and keep selector disabled.
  - If toggle OFF and a project was previously selected, route to that project.
- State rules:
  - Preferences (toggle) → `localStorage`.
  - UI session state (scroll/viewer) → `sessionStorage` (reuse existing helpers).

## D) Backend API (Read‑only)

- `GET /api/photos` lists photos across non‑archived projects.
  - Query: `limit` (default 100, max 200), `cursor` (keyset `{taken_at,id}`), and the SAME filter names/semantics already supported by `GET /api/projects/:folder/photos` for Date range, Orientation, and File Types available. No new enum definitions on the client.
  - Sort: `taken_at DESC, id DESC`.
  - Response items include `project_id`, `project_folder`, `project_name`, statuses, `taken_at`, `updated_at`, and basic `metadata`.
  - Security: read‑only; asset streaming/rate limits unchanged (`server/routes/assets.js`).

## E) Phases (Execution Plan)

Phase A — Backend
1. Route: create `server/routes/photos.js` with validation and keyset pagination.
2. Repository: add `listAll({ limit, cursor, filters })` in `server/services/repositories/photosRepo.js`.
3. Indexes: ensure `idx_photos_taken_at_id (taken_at DESC, id DESC)`; consider defensive creation in `db.js`.
4. Wire in `server.js`; manual curl tests for pagination and filters.

Phase B — Client
1. Toggle + Selector integration (App bar):
   - Place the compact “All” toggle immediately next to the Project selector in `client/src/App.jsx`.
   - When ON: disable selector and route to `/all`.
   - Persist toggle in `localStorage` (existing pattern).
2. All Photos page:
   - Implement `AllPhotosPage.jsx` using existing `PhotoGridView`.
   - Reduced filters: Date range, Orientation, File Types available (hide other filter controls; do not create new filter state/objects).
   - Infinite scroll reuses existing grid lazy‑load/observer patterns.
3. Grid behavior:
   - Add `simplifiedMode` to `PhotoGridView` to remove selection overlays and treat click as “open viewer”.
   - Pass `projectFolder` from each item; `Thumbnail.jsx` continues to resolve URLs.
4. Viewer behavior:
   - Add `simplifiedMode` prop to existing viewer to hide edit/keep/tag controls and show one button: “Open in project”.
   - Deep link `/projects/:folder?file=:filename` auto‑opens the full viewer with full features.
5. Action menu restrictions:
   - In All Photos mode, show only “Move to”. Use the same Action menu component with a parameter (e.g., `mode="allPhotos"`) that controls visible actions. Hook to existing Image Move tasks endpoint via `jobsApi`.
6. SSE minimal reconcile for Image Move:
   - Subscribe via SSE singleton. Handle `item_removed` (drop from source if visible) and `item_moved` (upsert into destination with new `project_folder` and derivative statuses). No full reload.

Phase C — QA & Docs
1. Pagination correctness: `next_cursor` advances; no offset queries.
2. Filters: combinations of Date range, Orientation, and File Types behave and use the same semantics as the project photos endpoint; indexes support these where applicable.
3. Performance: large datasets (e.g., 50k rows) scroll smoothly; memory bounded.
4. Assets: thumbs yield 200/304 with `ETag`; minimal 404s; `updated_at` cache‑bust verified.
5. Navigation: All Photos → viewer → Open in project → full viewer; back navigation intact.
6. SSE move scenarios: grid updates correctly without reload on `item_removed`/`item_moved`.
7. Accessibility: alt text, keyboard navigation, aria labels.
8. Docs: update `PROJECT_OVERVIEW.md` (All Photos integration), `README.md` (Key Feature), `SECURITY.md` (read‑only endpoint), `SCHEMA_DOCUMENTATION.md` (indexes; future orientation flag if added).

## F) Guardrails (Enforcement)

- Do NOT duplicate filter code or create a parallel filter state. Hide irrelevant controls in All Photos; reuse existing filter state wiring (date, orientation, file types available) and existing option lists; do not redefine enums in the client.
- Do NOT fork the viewer or grid; add `simplifiedMode` props only.
- Do NOT add new localStorage keys for ephemeral UI; continue using `sessionStorage` for scroll/viewer.
- Do NOT introduce new lazy‑loading utilities; reuse `PhotoGridView.jsx` IntersectionObserver.
- Action menu uses the same component; with `mode="allPhotos"`, it exposes ONLY “Move to”. Future enhancements to Move (UX) apply to both views automatically. Adding Tagging later would expand what `mode="allPhotos"` permits without forking the component.

---

# All Photos View — Homepage Plan

## 1) Project Overview

This initiative adds a scalable cross‑project “All Photos” browsing experience and makes it the homepage. It provides a fast, thumb‑first grid across all non‑archived projects with minimal interactions and a simplified viewer, linking to the full project view for advanced functions.

- Codebase context:
  - Frontend SPA under `client/` using React/Vite/Tailwind.
  - Backend under `server/` (Express + SQLite via better‑sqlite3).
  - Asset endpoints stream files with ETag/Cache‑Control and rate limits (`server/routes/assets.js`).
  - Real‑time updates via a singleton SSE client (`client/src/api/jobsApi.js`) to prevent 429s (see PROJECT_OVERVIEW.md → Real‑time Features).

## 2) Objectives

- Provide a fast All Photos page listing images across all non‑archived projects.
- Make All Photos the default homepage when no specific project is selected.
- Keep the page light: thumbs only by default, infinite scroll, minimal interactions.
- Include a simplified full‑screen viewer (no edit/keep/tags), with a clear link to open the photo in its project context.
- Maintain existing per‑project workflows unchanged.

## 3) Scope & Non‑Goals

- In Scope:
  - New paginated API to fetch photos across projects.
  - New client route/page for All Photos with infinite scroll.
  - Simplified viewer for cross‑project browsing.
  - Routing: homepage → All Photos; clicking a photo can jump to the project page anchored to that file.
- Out of Scope (v1):
  - Editing (keep/discard, tagging, rename) in All Photos.
  - Table view for All Photos.
  - Heavy cross‑project filtering (complex tag joins). Start with light filters.

## 4) UX Overview

- Homepage = All Photos grid.
- Grid: justified rows, lazy images, predictable row heights (reuse `PhotoGridView.jsx`).
- Interactions in All Photos:
  - No checkboxes/selection overlays, no table view, no uploads bar.
  - Click item → open simplified viewer. Viewer shows basic info and a button: “Open in project”.
  - Optional: from grid, alternatively navigate directly to project route with a deep link to the file.
- Filters (v1): Date range only, plus a default filter `has_thumb=true` for speed. Filename text search is intentionally removed. Orientation filter is deferred; when added later it will use a computed orientation (e.g., `is_portrait := height > width`) with an index for cheap filtering.
- Mode toggle next to project selector:
  - A UI toggle labeled “All Photos”. When ON → All Photos mode. When OFF → Project mode (requires selecting a project).
  - All Photos mode effects:
    - Action menu hidden/disabled (no edits, no batch actions).
    - Opening an image uses the simplified viewer (see Client Changes below).
    - Table view is not available.
    - Drag-and-drop uploads are allowed but prompt a modal to pick/create a project before upload starts.
  - Project mode effects:
    - Once a project is selected, all full controls are available (viewer with edits, actions menu, table view).
  - Persistence: remember last mode across sessions using `localStorage` and restore it on load.

## 4.5) Development Ground Rules — Build on Existing Infrastructure

- Avoid duplication. Before adding any new filter, storage key, caching layer, or lazy-loading logic, first audit and reuse existing code:
  - Lazy loading and grid: `client/src/components/PhotoGridView.jsx` (IntersectionObserver, dwell timers, justified rows)
  - Thumbnails and retry/caching behavior: `client/src/components/Thumbnail.jsx` (loading="lazy", retry logic)
  - Router/state persistence: `client/src/App.jsx` (sessionStorage for scroll/viewer, localStorage for preferences)
  - Asset streaming and cache validators: `server/routes/assets.js` (ETag/Cache-Control, streaming)
  - Realtime (SSE) singleton: `client/src/api/jobsApi.js`
- Storage rules:
  - Use `sessionStorage` for ephemeral UI state restoration (scroll position, viewer open/photo id) — do not reintroduce legacy per-project localStorage keys.
  - Use `localStorage` only for durable preferences (e.g., `allPhotosMode`).
- Pagination:
  - Use keyset pagination consistently. Do not introduce offset-based pagination.
- Documentation-first:
  - Cross-link updates in `PROJECT_OVERVIEW.md`, `README.md`, `SECURITY.md`, `SCHEMA_DOCUMENTATION.md`. Keep this plan updated as a live tracker (fill Owner/Status/Refs/Notes below as you progress).

## 5) Backend Changes

- New route: `GET /api/photos` in `server/routes/photos.js`
  - Purpose: list photos across non‑archived projects.
  - Query params:
    - `limit` (default 100, max 200) — per‑page size for infinite scroll
    - `cursor` (opaque; keyset token encoding `{taken_at,id}`)
    - Filters: `date_from`, `date_to`, `has_thumb` (default true)
  - Response:
    ```json
    {
      "items": [
        {
          "id": 123,
          "project_id": 7,
          "project_folder": "p7",
          "project_name": "Client Shoot",
          "filename": "IMG_0001.jpg",
          "thumbnail_status": "generated|pending|failed",
          "preview_status": "generated|pending|failed",
          "taken_at": "2024-05-01T10:00:00Z",
          "updated_at": "2024-05-01T10:01:00Z",
          "metadata": { "ExifImageWidth": 4000, "ExifImageHeight": 3000, "Orientation": 1 }
        }
      ],
      "next_cursor": "base64(taken_at,id)"
    }
    ```
  - Sorting: `taken_at DESC, id DESC`.
  - Security: read‑only metadata; relies on existing asset rate limiting.
- Repository: add `listAll({ limit, cursor, filters })` in `server/services/repositories/photosRepo.js` using keyset pagination.
- Indexes (SQLite):
  - `CREATE INDEX IF NOT EXISTS idx_photos_taken_at_id ON photos(taken_at DESC, id DESC);`
  - Consider: `idx_photos_thumbnail_status`. No filename index in v1 (text search removed).
  - Future: if/when adding orientation filter, store a computed field (e.g., `is_portrait` boolean) and index it: `CREATE INDEX IF NOT EXISTS idx_photos_is_portrait ON photos(is_portrait);`.
- Exclude archived projects: JOIN `projects.status <> 'canceled'`.

## 6) Client Changes

- New page: `client/src/components/AllPhotosPage.jsx`
  - Calls `GET /api/photos` with `limit` and optional `cursor`.
  - Manages `items`, `nextCursor`, `isLoading`, `hasMore`.
  - Near‑bottom infinite scroll appends pages.
  - Renders grid with `PhotoGridView` while passing per‑item `project_folder`.
- Routing: `client/src/App.jsx`
  - Add `/all` route → `AllPhotosPage`.
  - Make homepage redirect to `/all` when no `project_folder` selected.
- Global mode toggle (next to project selector):
  - Component exposes an `allPhotosMode` boolean in app state (e.g., context/store).
  - When `allPhotosMode=true`, route to `/all` and hide/disable action menus and table view in nav/toolbars.
  - When `allPhotosMode=false`, require a project selection; once selected, enable full controls.
  - Persist `allPhotosMode` in `localStorage`; on app start, read and apply. Also persist and restore scroll position and viewer state (extend existing preservation in `client/src/App.jsx`).
- Grid adjustments: `client/src/components/PhotoGridView.jsx`
  - When rendering each item, pass `projectFolder={photo.project_folder}` to `Thumbnail`.
  - Introduce `simplifiedMode` (boolean). In All Photos: hide overlays/selection, and treat any thumbnail click as “open viewer” (no selection behavior).
- Thumbnail fallback: `client/src/components/Thumbnail.jsx`
  - If `projectFolder` prop is missing, use `photo.project_folder` when present.
- Simplified viewer: `client/src/components/AllPhotosViewer.jsx`
  - Minimal UI: shows preview (on demand), filename, taken_at, and an “Open in project” link to `/projects/:folder?file=:filename`.
  - No keep/tag/edit actions.
  - Project page behavior on deep link: when `?file=` is present, auto‑open the full viewer with that photo selected, not just scroll‑and‑highlight.
  - The full viewer should display the project label (folder/name) prominently for context.
  - Reuse the existing viewer component by adding a `simplifiedMode` prop to render a reduced control set without duplicating code.
- Upload flow in All Photos mode:
  - Allow drag-and-drop anywhere; intercept drop when `allPhotosMode=true`.
  - Show a modal to choose an existing project or create a new one before upload starts (default: no preselection).
  - Create-project form collects Name only. Folder slug/ID remains internal and not exposed.
  - After choice, proceed with existing upload pipeline targeting the chosen project.

## 7) Features intentionally removed in All Photos

- No table view.
- No edits (keep/discard, tagging, rename, commit/revert).
- No selection checkboxes and no multi‑select actions.
- No uploads UI.
- No cross‑page SSE reconcile (keep page light); rely on reload or manual refresh.
- Exception (minimal): listen only to Image Move SSE for correctness, not for general reconcile.
  - Handle `item_removed` (remove from source if present) and `item_moved` (add/update for destination) to avoid stale `project_folder` and broken thumbnail URLs in the grid.
  - Do not run heavy diff/reload; update only the affected items in memory.

## 8) Performance Considerations

- Default `has_thumb=true` to minimize placeholders and asset 404s.
- Keyset pagination to bound memory and keep scrolling smooth.
- Maintain justified grid with stable row heights (existing `PhotoGridView.jsx`).
- `<img loading="lazy">` already present in `Thumbnail.jsx`.
- Avoid heavy filters in v1; add FTS or indexes before enabling contains searches.

## 9) Security Notes

- Endpoint returns metadata only; assets continue using existing streaming + rate limits in `server/routes/assets.js`.
- CORS and per‑IP caps unchanged. SSE singleton remains (no extra fan‑in on this page).
- Docs to update: `SECURITY.md` — list the new endpoint and note protections.

## 10) Documentation Updates (per repo rules)

- `PROJECT_OVERVIEW.md` — API Overview: add `GET /api/photos` (keyset pagination, filters). Frontend: All Photos page.
- `README.md` — Key Features: All Photos browsing across projects; homepage behavior.
- `SECURITY.md` — Endpoints & Protections: add the new endpoint; note reliance on existing asset throttling.

## 11) Step‑by‑Step Plan

Phase A — Backend
1. [ ] Create `server/routes/photos.js` with validation and response shape.
   - Owner: ____
   - Status: todo | in_progress | done
   - Refs: `server/routes/assets.js` (ETag/Cache-Control patterns), `PROJECT_OVERVIEW.md` (API guidelines)
   - Notes: ____
2. [ ] Add `listAll(...)` to `server/services/repositories/photosRepo.js` (keyset SQL; archived projects excluded).
   - Owner: ____
   - Status: todo | in_progress | done
   - Refs: `SCHEMA_DOCUMENTATION.md` (photos table fields), index `idx_photos_taken_at_id`
   - Notes: Ensure `ORDER BY taken_at DESC, id DESC`. Cursor encodes `{taken_at,id}`.
3. [ ] Create indexes (if not present) during DB init or via defensive `CREATE INDEX IF NOT EXISTS` in `db.js`.
   - Owner: ____
   - Status: todo | in_progress | done
   - Refs: `SCHEMA_DOCUMENTATION.md` (indexes), this plan §5
   - Notes: Consider future `is_portrait`.
4. [ ] Wire the route in `server.js`.
   - Owner: ____
   - Status: todo | in_progress | done
   - Refs: Express 5 routing conventions (see `PROJECT_OVERVIEW.md` upgrade notes)
   - Notes: ____
5. [ ] Manual test `GET /api/photos?limit=5` and with cursors/filters.
   - Owner: ____
   - Status: todo | in_progress | done
   - Refs: `curl_status.txt`, `curl_out.json`
   - Notes: Verify `next_cursor` advances and `has_thumb=true` default.

Phase B — Client
1. [ ] Create `AllPhotosPage.jsx` with infinite scroll and light toolbar (filters: date range + has_thumb only).
   - Owner: ____
   - Status: todo | in_progress | done
   - Refs: `client/src/components/PhotoGridView.jsx` (infinite scroll trigger), `client/src/App.jsx` (state persistence)
   - Notes: Reuse existing infinite scroll utilities; avoid duplicating observers.
2. [ ] Add route in `App.jsx`: `/all` → `AllPhotosPage`; redirect homepage to `/all` when no project selected.
   - Owner: ____
   - Status: todo | in_progress | done
   - Refs: Router setup in `client/src/App.jsx`
   - Notes: Maintain SSE singleton behavior.
3. [ ] Add a global “All Photos” toggle component next to the project selector; wire `allPhotosMode` to routing and toolbar visibility; persist to `localStorage`.
   - Owner: ____
   - Status: todo | in_progress | done
   - Refs: UI prefs pattern in `client/src/App.jsx`
   - Notes: Do not store ephemeral UI in localStorage.
4. [ ] Update `PhotoGridView.jsx` to pass `projectFolder={photo.project_folder}` and support `simplifiedMode` (all clicks open viewer; no selection/overlays in All Photos).
   - Owner: ____
   - Status: todo | in_progress | done
   - Refs: Existing `PhotoGridView.jsx` props and selection logic
   - Notes: Respect existing dwell timers to avoid flicker.
5. [ ] Make `Thumbnail.jsx` robust to use `photo.project_folder` if `projectFolder` prop is missing.
   - Owner: ____
   - Status: todo | in_progress | done
   - Refs: `client/src/components/Thumbnail.jsx`
   - Notes: Keep retry logic and `loading="lazy"` intact.
6. [ ] Implement simplified mode in the existing viewer component via a `simplifiedMode` prop; include “Open in project” and show project label.
   - Owner: ____
   - Status: todo | in_progress | done
   - Refs: Current viewer component
   - Notes: Do not fork the viewer; render reduced controls via prop.
7. [ ] Ensure deep link to `/projects/:folder?file=:filename` auto‑opens the full viewer for that photo; persist/restore scroll/viewer on reload.
   - Owner: ____
   - Status: todo | in_progress | done
   - Refs: Session restoration logic in `client/src/App.jsx`
   - Notes: Use sessionStorage for restoration.
8. [ ] Implement upload modal flow in All Photos: choose/create project (no default selection; Name only), then hand off to existing upload pipeline.
   - Owner: ____
   - Status: todo | in_progress | done
   - Refs: Existing upload components/services
   - Notes: Stay on All Photos after upload; show toast with link to project.
9. [ ] Subscribe to SSE move events in All Photos and minimally reconcile.
   - Owner: ____
   - Status: todo | in_progress | done
   - Refs: `client/src/api/jobsApi.js` (SSE singleton), `JOBS_OVERVIEW.md` → Image Move, `PROJECT_OVERVIEW.md` → Image Move Workflow
   - Notes: Handle `item_removed` by removing the item if it matches; handle `item_moved` by upserting with the new `project_folder` and derivative statuses. Do not trigger a full reload.

Phase C — QA & Polish
1. [ ] Test pagination: scrolling loads in batches; `next_cursor` behavior correct.
   - Notes: Verify no offset queries; ensure keyset continuation is stable across updates.
2. [ ] Test filters: date range and has_thumb combinations; ensure indexes used.
   - Notes: Confirm default `has_thumb=true` reduces 404s.
3. [ ] Test performance with large datasets (simulate 50k rows): memory stable, smooth scroll.
   - Notes: Observe GC/memory in DevTools; ensure bounded list states.
4. [ ] Test assets: thumbs load with cache validators (ETag) and `updated_at` cache-busting; rate limits respected.
   - Notes: Expect 200/304 patterns; minimal 404s.
5. [ ] Test navigation: All Photos → simplified viewer → Open in project; back navigation intact.
   - Notes: Deep link opens full viewer on project page.
6. [ ] State persistence: reload restores mode (localStorage) and scroll/viewer (sessionStorage) without stale state leaks.
   - Notes: Verify retry loops on restore and no duplication of storage keys.
7. [ ] Caching & retry: `Thumbnail.jsx` retry behavior and lazy loading operate as expected.
   - Notes: No duplicate requests; observer thresholds correct.
8. [ ] Accessibility: images have alt, buttons are keyboard navigable, aria labels present.
9. [ ] Live move scenarios: moving items between projects updates All Photos grid via SSE without reload.
   - Notes: Source project emits `item_removed` (All Photos removes if currently visible). Destination emits `item_moved` (All Photos updates/updates `project_folder`; thumbs continue loading without 404s).
10. [ ] Docs updated per checklist; cross-links added.

## 12) Testing Checklist

- Backend API
  - Returns correct shape; enforces limit caps; next_cursor advances; filters applied.
  - Excludes archived projects; handles empty result pages.
- Client
  - Initial load renders quickly; lazy loads next pages; no layout thrash.
  - Thumbnail URLs correctly use `project_folder` per item.
  - Simplified viewer loads preview only when opened; link to project works.
  - In All Photos, any thumbnail click opens the viewer (no selection state).
  - Mode toggle persists across reload (localStorage), and the app restores mode, scroll position, and viewer state.
  - No table view or edit UI present in All Photos.
- Performance
  - Network panel shows batched pages; images mostly 200/304 with minimal 404s.
  - Memory growth bounded while scrolling.
- Security
  - CORS and rate limits unaffected; no new writable endpoints.

## 13) Definition of Done (DoD)

- Feature completeness
  - `/api/photos` implements keyset pagination, date range + has_thumb filters, returns required fields including `project_folder` and `project_name`.
  - `/all` route exists; All Photos grid infinite-scrolls and uses `simplifiedMode`.
  - Global “All Photos” toggle works, persists in localStorage, and gates UI (no table/edits in All Photos).
  - Simplified viewer shows preview on demand, project label, and “Open in project”; deep-link auto-opens full viewer on the project page.
  - Uploads in All Photos trigger the project-pick/create modal; uploads proceed to chosen project.
- Performance and UX
  - Scrolling remains smooth with large datasets; images lazy-load; memory growth bounded.
  - All Photos grid click opens viewer (no selection state).
  - Mode, scroll position, and viewer state restore after reload.
- Documentation (mandatory)
  - Project docs updated as per checklist below.

## 14) Documentation Checklist (mandatory)

- `PROJECT_OVERVIEW.md`
  - Add/describe `GET /api/photos` endpoint, keyset pagination, filters, and response shape.
  - Frontend changes: All Photos page, global toggle behavior, simplified viewer, deep link semantics.
  - Upload flow in All Photos (project-pick/create modal) and how it integrates with existing pipeline.
- `README.md`
  - New Key Feature: All Photos browse as homepage or via toggle.
  - Quick-start or usage notes for the toggle and simplified viewer.
- `SECURITY.md`
  - List the new read-only endpoint under Endpoints & Protections.
  - Note that asset protections/rate-limits unchanged; no new write endpoints.
  - Any relevant notes about SSE usage remaining single-connection.
- `SCHEMA_DOCUMENTATION.md`
  - Note any added computed fields (future: `is_portrait`) and indexes used by All Photos queries.
- `JOBS_OVERVIEW.md`
  - Only if upload flow or job priorities are affected; otherwise, confirm no changes.
- Cross-link the above where relevant (consistent with repo standards).

## 15) Open Questions / Areas for Clarification

- Result ordering: default `taken_at DESC, id DESC` — confirm this matches user expectation for “latest first”.
- Page size: default 100, max 200 — confirm acceptable.

## 16) Resources & References

- Grid & infinite scroll: `client/src/components/PhotoGridView.jsx` (IntersectionObserver, dwell timers)
- Thumbnails: `client/src/components/Thumbnail.jsx` (lazy load, retry)
- App/router & state: `client/src/App.jsx` (sessionStorage for scroll/viewer, localStorage for preferences)
- SSE client: `client/src/api/jobsApi.js` (singleton already implemented)
- Assets streaming: `server/routes/assets.js` (ETag/Cache-Control)
- Repository: `server/services/repositories/photosRepo.js`
- Docs: `PROJECT_OVERVIEW.md`, `README.md`, `SECURITY.md`, `SCHEMA_DOCUMENTATION.md`, `JOBS_OVERVIEW.md`

Warning: Do not create new localStorage keys for ephemeral UI or duplicate pagination/lazy-load utilities. Reuse existing helpers and patterns cited above.
