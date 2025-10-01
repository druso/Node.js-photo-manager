---
Title: Universal Tagging Design Note
Status: Draft
Owner: Engineering
Last-Updated: 2025-09-23
---

# Universal Tagging across All and Project Views

## Current State
- Tags are managed via project-scoped endpoints and tables.
  - Client API: `client/src/api/tagsApi.js#updateTags(projectFolder, updates)`
  - Server route: `server/routes/tags.js` implements `PUT /api/projects/:folder/tags`.
  - Repo layer: `tagsRepo`, `photoTagsRepo` associate tags to a photo within a project context (photo row joined to project).
- UI behavior
  - Project view (`App.jsx` → `<OperationsMenu />`) can tag selected images in that project.
  - All Photos view does not currently expose tagging because the selection spans multiple projects and the existing API expects the full desired tag set per (project, filename). We do not load current tags in the All Photos list response.
- Data returned by All Photos endpoints (`GET /api/photos`, `GET /api/photos/locate-page`) generally excludes tag lists to keep payloads lightweight.

## Problem
- In All Photos, selections can span multiple projects.
- The current tag API is project-scoped and requires the full desired tag list per photo (idempotent replacement). Without the current tag state per photo, we risk unintentionally deleting tags when applying changes.
- This leads to inconsistent capabilities between All Photos and Project views.

## Objective
- Make tagging universal and consistent across both views:
  - Allow applying tag operations to any selection regardless of project.
  - Avoid requiring the client to fetch current tag lists just to safely add/remove tags.
  - Keep network payloads efficient for large cross-project selections.

## Proposed Direction

### 1) Introduce Image-Scoped, Delta-Based Tag APIs
- New endpoints independent of project routing, operating on image identifiers directly.
- Identifier options:
  - Preferred: `photo_id` (stable primary key from the `photos` table).
  - Backward-compatible composite key: `{ project_folder, filename }`.
- Endpoints (batch, atomic per photo):
  - `POST /api/photos/tags/add` → `{ items: Array<{ photo_id | { project_folder, filename }, tags: string[] }> }`
  - `POST /api/photos/tags/remove` → same shape as add
  - `POST /api/photos/tags/set` (optional) → replace-set semantics for advanced UIs
- Server behavior: resolve each image, perform add/remove without needing the full tag list from client.
- Response: `{ updated: number, errors?: Array<{ key, error }>} `

Benefits:
- Works across projects in a single request.
- Client can safely perform add/remove without fetching existing tags.
- Enables a unified `OperationsMenu` in All Photos and Project views.

### 2) Return Minimal Tag Info in Listings (Optional Phase)
- Extend list endpoints to optionally include tag names per item when `?include=tags`:
  - `GET /api/photos?include=tags`
  - `GET /api/projects/:folder/photos?include=tags`
- Keep off by default; gated by `limit` and `include=tags` to control payload sizes.
- Enables tag chips in grids/tables and live filtering by tag in the future.

### 3) Image-Scoped Operations Beyond Tags (Future Consolidation)
- Consider transitioning other actions to image-scoped batch endpoints:
  - Keep flags: `POST /api/photos/keep` with `{ items: [{ key, keep_jpg, keep_raw }] }`
  - Regeneration: `POST /api/photos/process` with `{ items: [{ key }], force?: boolean }`
  - Moves: `POST /api/photos/move` with `{ items: [{ key }], dest_folder }`
- The server can internally route to current project-aware services using `photo_id`.
- Project-scoped routes remain as convenience wrappers for project-local UIs but are no longer required by the unified Actions menu.

## Data Model Considerations
- Tags today are associated with photos (which are already tied to a single project). Making APIs image-scoped preserves current relational model; no schema change required.
- Ensure tag name uniqueness scope: per project vs global.
  - Recommendation: keep tag names per project for now (current behavior) but allow batch ops to target multiple projects. The API will resolve and create tags in the corresponding project context.
  - Optional future: introduce global tag dictionary if cross-project tag taxonomy is desired.

## Client Changes (High-Level)
- `OperationsMenu.jsx`
  - All Photos mode: enable tag add/remove using new delta-based endpoints with photo identifiers gathered from selection.
- `allPhotosApi.js` / listing components
  - Optionally pass `include=tags` when the UI needs to render or filter by tags.
- `UploadContext` unaffected.

## Server Changes (High-Level)
- New routes under `server/routes/photosTags.js` (or extend `routes/photos.js`):
  - `POST /api/photos/tags/add`
  - `POST /api/photos/tags/remove`
- Validation & rate limiting similar to `routes/tags.js`.
- Repository helpers to resolve by `photo_id` or `(project_folder, filename)` and apply tag mutations without replacing the entire set.

## Backward Compatibility
- Keep existing `PUT /api/projects/:folder/tags` for project-local UIs.
- Introduce new image-scoped endpoints; gradually update client to prefer them in All Photos and (optionally) Project views.

## Open Questions
- Should we normalize on `photo_id` at the API boundary to simplify resolution and logging?
- Do we want to support tag filters in list endpoints soon (`?tags=portrait,-rejected`)?
- Should we add a dry-run flag for large batch operations to preview impact?

## Acceptance Criteria
- All Photos Actions menu can add/remove tags on cross-project selections without fetching current tag lists.
- Project view tagging continues to work as before (or migrates to delta API without regressions).
- Documentation updated: `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md`, and `README.md` reflecting the new endpoints once implemented.

---

# Decisions (Confirmed 2025-09-23)

- API identifier: normalize on `photo_id` only at the API boundary. No compatibility path for `{ project_folder, filename }` is required at this stage (fresh start; test-only).
- Tag taxonomy: start fresh. Keep current schema (tags per project, `UNIQUE(project_id, name)`), but there is no legacy data to migrate.
- Dry-run support: add optional `dry_run=true` to bulk endpoints to preview impact without applying changes.
- Tag filters: extend listings to accept `tags` parameter soon (e.g., `?tags=portrait,-rejected`). Semantics: include photos with all positive tags; exclude photos that have any negative tags.

---

# Implementation Plan

## Phase 1: Image-scoped Tag + Keep (Delta-Based)

- New router `server/routes/photosActions.js` registered under `/api`.
- Endpoints (photo_id only):
  - `POST /api/photos/tags/add`  → `{ items: Array<{ photo_id: number, tags: string[] }>, dry_run?: boolean }`
  - `POST /api/photos/tags/remove` → same shape
  - `POST /api/photos/keep` → `{ items: Array<{ photo_id: number, keep_jpg?: boolean, keep_raw?: boolean }>, dry_run?: boolean }`
- Behavior:
  - Tag add: create missing per-project tags via `tagsRepo.getOrCreateTag(project_id, name)`, then `photoTagsRepo.addTagToPhoto(photo_id, tag_id)`.
  - Tag remove: if tag exists in that project, `photoTagsRepo.removeTagFromPhoto(photo_id, tag_id)`.
  - Keep: `photosRepo.updateKeepFlags(photo_id, { keep_jpg?, keep_raw? })` and emit SSE `type: "item"` with updated flags.
  - Dry-run: compute `would_add`, `would_remove`, `would_update` counts per photo; do not mutate DB.
  - Response: `{ updated: number, errors?: Array<{ photo_id, error }>, dry_run?: { summary, per_item? } }`.

## Phase 2: Optional Tag Inclusion in Listings

- Extend list endpoints to optionally include tag names when `include=tags`:
  - `GET /api/photos?include=tags`
  - `GET /api/projects/:folder/photos?include=tags`
- Server attaches `tags: string[]` per item using `photo_id` batched lookup across page items.

## Phase 3: Additional Image-Scoped Actions

- `POST /api/photos/process` → queue derivative generation for provided `photo_id`s. Optional `{ force?: boolean }`.
- `POST /api/photos/move` → `{ items: Array<{ photo_id: number }>, dest_folder: string, dry_run?: boolean }` leverages existing `image_move` orchestration; supports dry-run counts.
- These wrap existing project-aware workers by grouping items per destination/source where needed.

## Phase 4: Tag Filters on Listings

- Add `tags` query param to `GET /api/photos` and `GET /api/projects/:folder/photos`:
  - Syntax: comma-separated list where names without prefix are required, and names with leading `-` are exclusions.
  - Semantics: photo must contain all required tags and none of the excluded tags (per photo’s project context).
  - Implementation: join `photo_tags`/`tags` with aggregated checks; optimize with temp table or `IN` list and grouped HAVING conditions.

---

# API Specifications (Draft)

1) POST `/api/photos/tags/add`
   - Body: `{ items: [{ photo_id: number, tags: string[] }], dry_run?: boolean }`
   - Response: `{ updated: number, errors?: Array<{ photo_id, error }>, dry_run?: { updated: number, per_item?: any[] } }`

2) POST `/api/photos/tags/remove`
   - Body/Response: same as add.

3) POST `/api/photos/keep`
   - Body: `{ items: [{ photo_id: number, keep_jpg?: boolean, keep_raw?: boolean }], dry_run?: boolean }`
   - Response: `{ updated: number, errors?: Array<{ photo_id, error }>, dry_run?: { updated: number, per_item?: any[] } }`
   - SSE: emits `type: "item"` for each non-dry-run update.

4) GET `/api/photos` (extended)
   - Query: existing filters + `include=tags?` + `tags?=portrait,-rejected` (Phase 4)

5) GET `/api/projects/:folder/photos` (extended)
   - Query: existing filters + `include=tags?` + `tags?=portrait,-rejected` (Phase 4)

6) POST `/api/photos/process` (Phase 3)
7) POST `/api/photos/move` (Phase 3)

---

# Client Changes (High-Level)

- All Photos `OperationsMenu` enables Tag Add/Remove using `photo_id`s, no need to fetch current tags for safety.
- `client/src/api/allPhotosApi.js`: add helpers `addTags(items)`, `removeTags(items)`, `updateKeep(items)`.
- Optional: when rendering tag chips or building tag-based filters, pass `include=tags` to list APIs.

---

# Tracking Checklist (live)

- [x] Phase 1 — Server: create `server/routes/photosActions.js` with endpoints for tags add/remove and keep; wire in `server.js`.
- [ ] Phase 1 — Tests/manual: exercise cross-project selections in All Photos; confirm SSE keep updates.
- [ ] Phase 1 — Client: add API helpers; enable tagging in All Photos menu.
- [x] Phase 1 — Docs: update `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md`, `README.md`.
- [x] Phase 2 — Server: `include=tags` in list endpoints; efficient batch fetch.
- [ ] Phase 2 — Client: render optional tag chips; (optional) quick tag editor.
- [x] Phase 3 — Server: process/move wrappers (image-scoped) with dry-run; reuse workers.
- [ ] Phase 3 — Client: integrate when needed.
- [x] Phase 4 — Server: `tags` filter in listings.
- [ ] Phase 4 — Client: expose tag filters in UI.
- [x] Final — Update all overview docs and `SECURITY.md` noted changes.

Notes:
- This file is the single source of truth for this initiative and will be updated at each step.
