---
Title: Client-Side Unification Plan (All vs Project Views)
Status: In Progress
Owner: Frontend
Last-Updated: 2025-09-26
---

# Objective
Make Project view essentially All view pre-filtered by project. Differences should be limited to context affordances (e.g., upload entry point).

# Current Status (2025-09-26)
- **SSE parity foundation**: Project-specific SSE flow extracted into `client/src/hooks/useProjectSse.js`, mirroring All Photos item updates without bloating `App.jsx`.
- **Viewer URL sync modularized**: `client/src/hooks/useViewerSync.js` controls deep-link pushes, close handling, and viewer data assembly for both contexts.
- **All Photos upload flow isolated**: Drag/drop + project hand-off lives in `client/src/hooks/useAllPhotosUploads.js`, leaving `App.jsx` to orchestrate.
- **App.jsx role**: File remains large but now primarily coordinates hooks/components; legacy project pagination has been removed in favor of the shared `useProjectPagination()` wrapper exported from `useAllPhotosPagination`.

# Immediate Next Steps
- **Selection unification**: Normalize project selection to the same composite key strategy as All Photos until photo_id endpoints land.
- **Modal/commit manager**: Move commit/revert/move modal toggles and handlers into a dedicated hook/component.
- **Route helper consolidation**: Introduce shared helpers for parsing and pushing `/all` and `/:folder` routes, replacing ad-hoc window history code.

# Objective
Make Project view essentially All view pre-filtered by project. Differences should be limited to context affordances (e.g., upload entry point).
s, viewer.
- **Image-scoped actions**: use new backend endpoints so UI does not branch on project.
- **URL is source of truth**; **session-only UI state** persists scroll only.

# Key Client Files
- `client/src/App.jsx` (orchestration)
- `client/src/hooks/`: `usePhotoPager.js`, `useProjectPagination.js`, `useAllPhotosUploads.js`, `useProjectSse.js`, `useViewerSync.js`
- `components/`: `PhotoDisplay.jsx`, `PhotoGridView.jsx`, `VirtualizedPhotoGrid.jsx`, `PhotoTableView.jsx`, `PhotoViewer.jsx`, `UniversalFilter.jsx`, `OperationsMenu.jsx`
- `upload/`: `UploadContext.jsx`, `GlobalDragDrop.jsx`, `ProjectSelectionModal.jsx`

# Unification Targets
- **UT1 Actions**: Identical Actions menu in both modes using image-scoped APIs (keep, process, move, tags).
- **UT2 Pagination/State**: Single hook for All/Project paging.
- **UT3 Filters**: Same filter shape/behavior; Project = All + project filter.
- **UT4 Selection**: Use `photo_id` as the sole selection key in both modes (no composite keys).
- **UT5 Deep Links**: Same route parsing and viewer opening.
- **UT6 Counts**: Same “filtered of total” across modes.
- **UT7 Shortcuts/UX**: Same keyboard and list/grid behavior.
- **UT8 Viewer parity**: The viewer in All view has the exact same controls/shortcuts/metadata panels as in Project view, including open-in-project flow and keep/tag interactions.

# Planned Changes
- **C1 usePhotoPager hook**
  - _Status_: **Planned**. Current stop-gap lives in `useAllPhotosPagination` + legacy project paging. Converge onto shared hook after project pagination extraction.
  - **C2 Selection normalization**
  - Use `photo_id` arrays in both modes. Provide adapters only where legacy filename arrays are still required (e.g., existing project-scoped uploads/jobs UI).
  - **C3 OperationsMenu → image-scoped**
  - Call the new image-scoped endpoints (`/api/photos/tags/add|remove`, `/api/photos/keep`, `/api/photos/process`, `/api/photos/move`); remove project-branching/batching; enable tags in All view.
- **C4 Optional tags in lists**
  - Support `?include=tags` for chips/filtering (off by default).
- **C5 Route helpers**
  - Extract parse/push helpers to `utils/routes.js` for `/all` and `/:project` links.
  - **C6 Viewer controller (optional)**
  - _Status_: **Completed** via `useViewerSync` (2025-09-25).
  - **C7 SSE parity**
  - _Status_: **In Progress**. Backend emits item updates; frontend now centralizes project-stream handling in `useProjectSse`. All Photos SSE remains TODO.
- **C8 Commit/Revert bar in All view**
  - Surface the commit bar in All view when any project has pending deletions.
  - Provide a project selector within the bar (or per-project tabs) to scope the commit/revert operation to the chosen project.
  - Counts display per selected project; actions operate via image-scoped or project-scoped endpoints under the hood.

- **API usage**
  - All Photos: `GET /api/photos?limit&cursor&before_cursor&date_from&date_to&file_type&keep_type&orientation&tags&include=tags`
  - Project Photos: `GET /api/projects/:folder/photos?...&tags&include=tags`
  - Locate (All): `GET /api/photos/locate-page?...&tags&include=tags`
  - Image-scoped actions:
    - Add tags: `POST /api/photos/tags/add` → `{ items: [{ photo_id, tags: string[] }], dry_run? }`
    - Remove tags: `POST /api/photos/tags/remove` → same shape
    - Keep flags: `POST /api/photos/keep` → `{ items: [{ photo_id, keep_jpg?, keep_raw? }], dry_run? }`
    - Process: `POST /api/photos/process` → `{ items: [{ photo_id }], force?, dry_run? }`
    - Move: `POST /api/photos/move` → `{ items: [{ photo_id }], dest_folder, dry_run? }`

- **New/updated client modules**
  - `client/src/hooks/usePhotoPager.js` (new): shared pager for All/Project; supports `tags` and `include=tags`.
  - `client/src/api/allPhotosApi.js`: add `list()` and `locatePage()` with `tags`/`include`.
  - `client/src/api/projectsApi.js`: extend list to accept `tags`/`include`.
  - `client/src/api/photosActionsApi.js` (new): wrappers for image-scoped endpoints above.

- **UI changes**
  - Selection model: store arrays of `photo_id` only.
  - `OperationsMenu`: call image-scoped endpoints; add a Dry‑Run checkbox and preview counts.
  - Filters: add a `tags` input using syntax `portrait,-rejected`; when tag chips/filter visible, request with `include=tags`.
  - Viewer: on deep links use locate APIs with filters; open at `idx_in_items`.
  - SSE: handle `item` updates (keep flags) and `item_moved` (update `project_folder` and collections).

# Context-Aware Differences (kept)
- Commit/Revert bar is available in both All and Project views. In All view, it explicitly scopes to a chosen project when multiple projects have pending deletions.
- Upload: Project → direct; All → prompt project selection first.

# Rollout Steps
- **R1 Hook**: implement `usePhotoPager`, swap `App.jsx` pagination to it (parity with existing behavior). Include filter parity and optional `include=tags`.
- **R2 Actions**: switch `OperationsMenu` to image-scoped endpoints; add Dry‑Run support in dialogs; wire SSE reconciliation.
- **R3 Tags in lists**: enable tag chips and tag editor in All view; unify with Project view. Add `tags` filter UI shared by both.
- **R4 Locate flow**: adopt `GET /api/photos/locate-page` with passthrough filters; open viewer at `idx_in_items` and center anchor row.
- **R5 Route helpers**: centralize URL/query management including filters (`tags`, `include`) and cursors.
- **R6 Polish**: keyboard shortcuts parity; commit bar in All view with per‑project scoping.

# Test Checklist
- Filters parity; counts “X of Y” in both modes.
- Pagination forward/backward + deep-link anchor correctness.
- Selection toggling across pages.
- Actions (keep, process, move, tag) in both modes.
- Viewer open/index navigation and Open-in-Project flow.
- SSE updates reflected; All view move updates `project_folder`.
- Tag filters functional: `portrait,-rejected` semantics (AND for positive, NOT ANY for negative).
- `include=tags` works: tag chips render when requested; payload size remains acceptable.
- Upload: All prompts project; Project direct.

# Acceptance
- Project view == All view + project filter.
- Actions identical; backend image-scoped APIs used.
- Pagination, deep links, selection, counts indistinguishable across modes.
 - Viewer parity across views; Commit/Revert bar accessible in All view with per-project scoping.
