# Jobs Refactoring: Tasks, Tagging, and UX

Author: Cascade
Status: Proposed (implementation-ready)  
Scope: Backend + Frontend + Docs  
Goal: Introduce a high-level Task concept that groups Jobs, expose a user-facing "file removal" job for commit, tag job origins for frontend filtering, add friendly labels + success toasts, and prevent folder_check from re-enqueuing unnecessary work.

---

## Executive Summary

- Define Tasks (user intents) grouping one or more Jobs (atomic worker units). Examples: `change_commit` task groups `file_removal` then maintenance jobs; `upload_processing` task groups `upload_postprocess` (and optionally `generate_derivatives`).
- Add a new user-facing `file_removal` job used by `POST /commit-changes`.
- Tag each job with `source: 'user' | 'maintenance'` and Task metadata `task_id`, `task_type` for grouping and filtering.
- Add config to hide maintenance jobs in the frontend by default while still showing the Task.
- Add user-friendly labels and success toasts for user-facing Tasks/Jobs.
- Already-fixed: `folder_check` only enqueues `upload_postprocess` for newly discovered bases (not all files).

No backward-compat constraints (pre-GA). We will make schema/API changes directly.

---

## Definitions

- Task (new): A high-level user intent that spans one or more Jobs.
  - Examples: `change_commit`, `upload_processing`.
- Job (existing): An atomic unit executed by the worker loop.
  - Examples: `file_removal` (new), `upload_postprocess`, `generate_derivatives`, `manifest_check`, `folder_check`, `trash_maintenance`, `manifest_cleaning`.

---

## Current Architecture (key references)

- Worker loop: `server/services/workerLoop.js`
- Workers: `server/services/workers/`
  - `derivativesWorker.js`
  - `maintenanceWorker.js`
- Jobs repo: `server/services/repositories/jobsRepo.js`
- DB DDL + migrations: `server/services/db.js`
- Routes
  - Uploads: `server/routes/uploads.js`
  - Jobs API + SSE: `server/routes/jobs.js`
  - Maintenance + commit/revert: `server/routes/maintenance.js`
- Client
  - Jobs API: `client/src/api/jobsApi.js`
  - Processes UI: `client/src/components/ProcessesPanel.jsx`
  - Toast infra (planned): global provider/hook per memory
- Docs
  - Overview: `PROJECT_OVERVIEW.md`
  - Schema: `SCHEMA_DOCUMENTATION.md`
  - Jobs overview: `jobs overview.md`

---

## Proposed Architecture Changes

### 1) Schema extensions (Phase 1)

- Extend `jobs` table with:
  - `source TEXT NOT NULL DEFAULT 'maintenance'`  
    Allowed: `'user' | 'maintenance'`.
  - `task_id TEXT`  
    A UUID string grouping multiple jobs.
  - `task_type TEXT`  
    Examples: `'change_commit' | 'upload_processing'`.

Implementation: in `server/services/db.js` migration section, add `ensureColumn` for the three columns.

### 2) New job type: file_removal

- Add worker file: `server/services/workers/fileRemovalWorker.js`
  - `async function runFileRemoval({ job })`:
    - Move non-kept JPG/RAW to `.trash`, delete JPG derivatives (mirror existing commit inline logic in `server/routes/maintenance.js`).
    - Update SQLite rows appropriately.
    - On completion, enqueue reconciliation jobs (with same `task_id`, `source: 'maintenance'`):
      - `manifest_check` (95)
      - `folder_check` (95)
      - `manifest_cleaning` (80)
- Update dispatcher: `server/services/workerLoop.js`
  - Handle `job.type === 'file_removal'` → `runFileRemoval()` with progress updates and SSE events.

### 3) Commit route uses file_removal task

- Modify `POST /api/projects/:folder/commit-changes` in `server/routes/maintenance.js`:
  - Compute the workset (non-kept JPG/RAW to remove).  
    Alternative: delegate discovery to worker; simpler: enqueue `file_removal` without payload; the worker computes from DB.
  - Generate `task_id` (UUID) and set `task_type: 'change_commit'`, `source: 'user'`.
  - Enqueue `file_removal` with that task metadata; return `202 { job }`.
  - Remove direct inline file moves and direct enqueue of maintenance jobs (they will be done by the worker).

### 4) Job tagging: source + task metadata

- Update repository API: `server/services/repositories/jobsRepo.js`
  - `enqueue({ ..., source = 'maintenance', task_id = null, task_type = null, ... })`
  - `enqueueWithItems({ ..., source = 'maintenance', task_id = null, task_type = null, ... })`
  - Persist into `jobs` columns.
- Set `source: 'user'` for:
  - `file_removal` (commit), `upload_postprocess` (post-upload), `generate_derivatives` (manual/process endpoint), any jobs created via `POST /projects/:folder/jobs` from the UI.
- Set `source: 'maintenance'` for scheduler and manual maintenance enqueues.

### 5) Config: include/exclude maintenance jobs in UI

- Add `ui.include_maintenance_jobs` in `config.default.json` with default `false` (and respect overrides in `config.json`).
- API: `GET /api/projects/:folder/jobs`
  - Add query `show_maintenance=true|false` (optional). If absent, default to server config.
  - Filter by `source` when listing.
- SSE: continue emitting all job updates. The client filters maintenance jobs when hidden.

### 6) SSE payloads carry task/source

- `server/services/events.js` (emitter) and usage in workers/loop should include `source`, `task_id`, `task_type` in job update messages.
- Existing item-level events from `derivativesWorker` remain unchanged; add `task_id`/`task_type` if available (optional but nice).

### 7) Frontend: Task-first UX

- Group jobs by `task_id` in `client/src/components/ProcessesPanel.jsx`.
  - If `task_id` present: render as a single Task row with aggregate progress, expandable to child jobs.
  - If absent (older jobs), treat job as a standalone Task.
- Filtering:
  - Respect `ui.include_maintenance_jobs` or panel toggle; hide maintenance jobs by default.
  - Still show the Task row for user-initiated actions, even if child maintenance jobs are hidden.
- Labels:
  - Add `client/src/utils/jobLabels.js` mapping:
    - `file_removal` → "Removing files"
    - `upload_postprocess` → "Processing uploads"
    - `generate_derivatives` → "Generating thumbnails and previews"
    - Fallback: humanize job.type
  - Task labels:
    - `change_commit` → "Commit changes"
    - `upload_processing` → "Upload processing"
- Success toasts:
  - Integrate with the global ToastProvider (per memory):
    - When Task transitions to `completed`:
      - `change_commit` → "Files removed"
      - `upload_processing` → "Upload processing completed"
    - Guard with a seen-IDs set to prevent duplicates.

### 8) Docs updates

- `jobs overview.md`: add `file_removal` and Task model; reflect tagging and filtering.
- `PROJECT_OVERVIEW.md`: integrate the Jobs Overview content as a section; update commit and upload flows to reference Tasks.
- `SCHEMA_DOCUMENTATION.md`: document new `jobs` columns, SSE event fields, API filters.
- `SECURITY.md`: minor note that visibility is client-side only; back end still emits SSE. Ensure rate limiting on `commit-changes` remains.

---

## Step-by-Step Implementation Plan

1) Schema migration (`server/services/db.js`)
- Add columns if missing:
```js
ensureColumn(db, 'jobs', 'source', "ALTER TABLE jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'maintenance'");
ensureColumn(db, 'jobs', 'task_id', "ALTER TABLE jobs ADD COLUMN task_id TEXT");
ensureColumn(db, 'jobs', 'task_type', "ALTER TABLE jobs ADD COLUMN task_type TEXT");
```

2) Repo API (`server/services/repositories/jobsRepo.js`)
- Extend `enqueue` and `enqueueWithItems` signatures to accept `source`, `task_id`, `task_type`.
- Persist new fields on insert; ensure they are returned by getters.

3) New worker (`server/services/workers/fileRemovalWorker.js`)
- Implement `runFileRemoval({ job })`:
  - For each photo where `keep_jpg === false && jpg_available === true` → move JPG variants to `.trash`, delete derivatives, update DB availability.
  - For RAW similarly when `keep_raw === false && raw_available === true`.
  - Maintain `progress_total`/`progress_done`; emit job updates via events.
  - On completion: enqueue `manifest_check` (95), `folder_check` (95), `manifest_cleaning` (80) with same `task_id` and `source: 'maintenance'`.

4) Worker loop (`server/services/workerLoop.js`)
- Import `runFileRemoval` and add dispatch for `job.type === 'file_removal'` with the same heartbeat/progress/complete semantics.
- Ensure `emitJobUpdate` includes `source`, `task_id`, `task_type` in payload.

5) Commit route (`server/routes/maintenance.js`)
- Replace inline file move logic with enqueue of `file_removal`:
  - Generate `task_id` (UUID), set `task_type: 'change_commit'`, `source: 'user'`.
  - `jobsRepo.enqueue({ type: 'file_removal', source: 'user', task_id, task_type: 'change_commit', ... })`
  - Return `202 { job }`.

6) Upload routes (`server/routes/uploads.js`)
- When enqueuing `upload_postprocess` after upload, and `generate_derivatives` via `/process`, attach `source: 'user'` and a new `task_id`/`task_type: 'upload_processing'` for the batch.
- If subset processing is requested, share same Task.

7) Scheduler & maintenance routes
- Ensure all enqueues there set `source: 'maintenance'`.
- If/when they belong to a Task (optional), they can inherit an existing `task_id`—but default is none.

8) Jobs API (`server/routes/jobs.js`)
- Support `show_maintenance=true|false` query (default from config) to filter by `source`.
- Include `source`, `task_id`, `task_type` in response objects.

9) SSE events (`server/services/events.js` + emitters)
- Ensure every `emitJobUpdate` includes `source`, `task_id`, `task_type` when available.
- Optionally include these in item-level events from `derivativesWorker`.

10) Frontend: Processes panel
- Group by `task_id`; if null, treat single job as a Task.
- Filter maintenance jobs based on config/toggle.
- Render friendly labels using `client/src/utils/jobLabels.js`.
- Show progress “(done/total)” when available.

11) Frontend: Toasts
- On Task completion (transition to `completed`), show success toast:
  - `change_commit` → "Files removed"
  - `upload_processing` → "Upload processing completed"
- Integrate with the global ToastProvider and ensure queuing/stack behavior (per prior toast memory).

12) Documentation
- Update `jobs overview.md` (add `file_removal`, Task model, tagging, filtering, toasts).
- Fold key parts into `PROJECT_OVERVIEW.md` (new “Background processing” section or expand existing).
- Update `SCHEMA_DOCUMENTATION.md` with new columns and API.
- Security note in `SECURITY.md` (CORS/rate limit remain; visibility is client concern).

13) QA & Verification
- Unit test `fileRemovalWorker` on edge cases (uppercase extensions, missing files, idempotency).
- Manual test flows:
  - Commit with a single deletion → see `file_removal` Task; maintenance hidden unless enabled.
  - Upload + process → single Task with grouped jobs; toasts on completion.
  - Scheduler enqueues → hidden by default; no user toasts.
- Ensure SSE stream remains stable and client grouping is robust when some jobs lack `task_id`.

---

## Open Questions
- Should `file_removal` compute workset entirely from DB at runtime (simpler) or accept explicit filenames from the route payload? Recommendation: compute at runtime for idempotency.
- Do we need a separate `tasks` table (Phase 2) for persistent aggregation and `GET /tasks`? Not required now.

---

## Time & Complexity (rough)
- Schema + repo + SSE wiring: 0.5–1d
- New worker + loop dispatch + commit route refactor: 0.5–1d
- Upload/process tagging with tasks: 0.25d
- Frontend grouping/filtering/labels/toasts: 0.75–1d
- Docs & QA: 0.5d
Total: ~2.5–3.75 days

---

## Notes & Recent Changes Already Done
- `folder_check` has been fixed to enqueue `upload_postprocess` only for newly discovered bases (see `server/services/workers/maintenanceWorker.js`).
- `PROJECT_OVERVIEW.md` and `SCHEMA_DOCUMENTATION.md` have been updated to reflect that change.
