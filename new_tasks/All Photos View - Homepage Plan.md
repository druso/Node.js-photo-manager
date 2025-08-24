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
1. Create `server/routes/photos.js` with validation and response shape.
2. Add `listAll(...)` to `server/services/repositories/photosRepo.js` (keyset SQL; archived projects excluded).
3. Create indexes (if not present) during DB init or via defensive `CREATE INDEX IF NOT EXISTS` in `db.js`.
4. Wire the route in `server.js`.
5. Manual test `GET /api/photos?limit=5` and with cursors/filters.

Phase B — Client
1. Create `AllPhotosPage.jsx` with infinite scroll and light toolbar (filters: date range + has_thumb toggle only).
2. Add route in `App.jsx`: `/all` → `AllPhotosPage`; redirect homepage to `/all` when no project selected.
3. Add a global “All Photos” toggle component next to the project selector; wire `allPhotosMode` to routing and toolbar visibility; persist to `localStorage`.
4. Update `PhotoGridView.jsx` to pass `projectFolder={photo.project_folder}` and support `simplifiedMode` (all clicks open viewer; no selection/overlays in All Photos).
5. Make `Thumbnail.jsx` robust to use `photo.project_folder` if `projectFolder` prop is missing.
6. Implement simplified mode in the existing viewer component via a `simplifiedMode` prop; include “Open in project” and show project label.
7. Ensure deep link to `/projects/:folder?file=:filename` auto‑opens the full viewer for that photo (select + open viewer, and scroll grid as needed under the hood); persist/restore scroll/viewer on reload.
8. Implement upload modal flow in All Photos: choose/create project (no default selection; create uses Name only), then hand off to existing upload pipeline.

Phase C — QA & Polish
1. Test pagination: scrolling loads in batches; `next_cursor` behavior correct.
2. Test filters: q/date/orientation/has_thumb combinations; ensure indexes used.
3. Test performance with large datasets (simulate 50k rows): memory stable, smooth scroll.
4. Test assets: thumbs load with cache‑busting via `updated_at`; rate limits respected.
5. Test navigation: from All Photos → simplified viewer → Open in project; back navigation intact.
6. Accessibility: images have alt, buttons are keyboard navigable, aria labels present.
7. Docs: update `PROJECT_OVERVIEW.md`, `README.md`, `SECURITY.md` accordingly.

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

- Grid: `client/src/components/PhotoGridView.jsx`
- Thumbnail: `client/src/components/Thumbnail.jsx`
- App/router: `client/src/App.jsx`
- SSE client: `client/src/api/jobsApi.js` (singleton already implemented)
- Assets: `server/routes/assets.js`
- Repos: `server/services/repositories/photosRepo.js`
- Docs: `PROJECT_OVERVIEW.md`, `README.md`, `SECURITY.md`
