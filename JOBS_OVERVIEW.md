# Jobs Overview

This document summarizes the background job pipeline, supported job types, their options, and how key flows (file upload, maintenance, and change commit) use them.

- Source files: `server/services/workerLoop.js`, `server/services/scheduler.js`, `server/routes/uploads.js`, `server/routes/maintenance.js`, `server/routes/jobs.js`
- Repositories: `server/services/repositories/jobsRepo.js`
- Related docs: `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md`

## Pipeline Architecture (brief)

- Two-lane worker pipeline controlled by config:
  - Priority lane: jobs with `priority >= pipeline.priority_threshold`.
  - Normal lane: all other jobs.
- Key knobs (see `config.json` / `config.default.json`):
  - `pipeline.max_parallel_jobs`, `pipeline.priority_lane_slots`, `pipeline.priority_threshold`
  - `pipeline.heartbeat_ms`, `pipeline.stale_seconds`, `pipeline.max_attempts_default`
- Heartbeats, crash recovery (`requeueStaleRunning`), and bounded retries (`max_attempts_default`) are handled by `workerLoop.js`.
- Live job updates via SSE: `GET /api/jobs/stream` (also item-level events from `derivativesWorker`).

Image Move emits realtime events too. See "Image Move" below for `item_removed` and `item_moved` semantics.

## At a glance: Tasks → Steps and Priorities

- Upload Post-Process (`upload_postprocess` task)
  - `upload_postprocess` (90)
  - `manifest_check` (95)
  - `folder_check` (95)

- Commit Changes (`change_commit` task)
  - `file_removal` (100)
  - `manifest_check` (95)
  - `folder_check` (95)
  - `manifest_cleaning` (80)

- Maintenance (`maintenance` task)
  - `trash_maintenance` (100)
  - `manifest_check` (95)
  - `folder_check` (95)
  - `manifest_cleaning` (80)

- Project Scavenge (`project_scavenge` task)
  - `project_scavenge` (100)

- Delete Project (`project_delete` task)
  - `project_stop_processes` (100)
  - `project_delete_files` (100)
  - `project_cleanup_db` (95)

Lane behavior: steps with priority ≥ `pipeline.priority_threshold` run in the priority lane and can preempt normal jobs. See `config.json` for `pipeline.priority_lane_slots` and `pipeline.priority_threshold`.

## Supported Job Types

- generate_derivatives
  - Worker: `derivativesWorker` via `runGenerateDerivatives()`.
  - Purpose: generate thumbnails and previews for photos (whole project or subset).
  - Payload options: `{ force?: boolean, filenames?: string[] }`.

- upload_postprocess
  - Worker: `derivativesWorker` via `runGenerateDerivatives()` (itemized execution).
  - Purpose: post-upload processing for the uploaded filenames.
  - Payload options: `{ filenames: string[] }` (enqueued with items via `enqueueWithItems`).

- trash_maintenance
  - Worker: `maintenanceWorker.runTrashMaintenance()`.
  - Purpose: periodic cleanup and management of `.trash` directory.
  - Payload: none currently.

- manifest_check
  - Worker: `maintenanceWorker.runManifestCheck()`.
  - Purpose: reconcile database vs on-disk state (idempotent).
  - Payload: none currently.

- folder_check
  - Worker: `maintenanceWorker.runFolderCheck()`.
  - Purpose: scan project folder for untracked files; enqueue `upload_postprocess` for accepted ones; move others to `.trash`.
  - Payload: none currently.

- manifest_cleaning
  - Worker: `maintenanceWorker.runManifestCleaning()`.
  - Purpose: periodic manifest/database cleanup.
  - Payload: none currently.

- project_scavenge
  - Worker: `projectScavengeWorker.runProjectScavenge()`.
  - Purpose: remove leftover on-disk folders for archived projects (`projects.status='canceled'`). Best‑effort, idempotent.
  - Payload: none currently.

- file_removal
  - Worker: `fileRemovalWorker.runFileRemoval()`.
  - Purpose: remove non-kept originals/derivatives during Commit; idempotent and safe to retry.
  - Payload: carries task metadata (bound to the `change_commit` task step).

- project_stop_processes (part of task `project_delete`)
  - Worker: `projectDeletionWorker.stopProcesses()`.
  - Purpose: mark project archived (`status='canceled'`) and cancel queued/running jobs for the project.
  - Payload: carries task metadata.

- project_delete_files (part of task `project_delete`)
  - Worker: `projectDeletionWorker.deleteFiles()`.
  - Purpose: delete the on-disk project folder `.projects/<project_folder>/`.
  - Payload: carries task metadata.

- project_cleanup_db (part of task `project_delete`)
  - Worker: `projectDeletionWorker.cleanupDb()`.
  - Purpose: cleanup related DB rows (`photos`, `tags`, `photo_tags`), retain `projects` row (archived).
  - Payload: carries task metadata.

- image_move_files (part of task `image_move`)
  - Worker: `imageMoveWorker.runImageMoveFiles()`.
  - Purpose: move one or more images (and their derivatives when present) from their current project to a destination project.
  - Trigger: orchestrated via the `image_move` task. Typical sources:
    - Client operations menu (move selected photos)
    - Uploads route when `reloadConflictsIntoThisProject=true` detects cross‑project conflicts (see `server/routes/uploads.js`).
  - Payload options: provided via task orchestration; individual filenames are carried as `job_items` with `filename` set to the base name (no extension).

Note: Any other `type` will be failed by `workerLoop` as Unknown.

## How Flows Use the Jobs

### File Upload

- Endpoint: `POST /api/projects/:folder/upload`
- Behavior:
  - Saves incoming files to the project directory.
  - Updates/creates corresponding photo records in SQLite (availability, metadata, keep flags aligned to availability on upload).
  - Enqueues `upload_postprocess` with items for each uploaded basename:
    - `jobsRepo.enqueueWithItems({ type: 'upload_postprocess', payload: { filenames }, items: filenames.map(fn => ({ filename: fn })) })`.
- Optional processing entry point: `POST /api/projects/:folder/process`
  - Enqueues `generate_derivatives` (whole project or subset via `payload.filenames`; `payload.force` supported).
- UI/Realtime:
  - SSE item-level updates emitted as `{ type: 'item', project_folder, filename, thumbnail_status, preview_status, updated_at }` while processing proceeds.

### Maintenance

- Scheduler model (see `server/services/scheduler.js`):
  - Kicks off the `maintenance` task hourly for each active (non‑archived) project.
  - Separately kicks off the `project_scavenge` task hourly for archived projects to clean up leftover folders.
- Task composition (see `server/services/task_definitions.json` → `maintenance.steps`):
  - `trash_maintenance` (priority 100)
  - `manifest_check` (priority 95)
  - `folder_check` (priority 95)
  - `manifest_cleaning` (priority 80)
- Manual triggering: maintenance flows can be initiated via `server/routes/maintenance.js` where applicable.
- Lane behavior: high priorities (>= threshold, default 90) run in the priority lane to keep reconciliation snappy even if normal jobs are long-running.

### Change Commit (Commit/Revert Toolbar)

- Commit Changes
  - Endpoint: `POST /api/projects/:folder/commit-changes`
  - Behavior:
    - For each photo: moves non-kept JPG/RAW files to `.trash` (derivatives removed immediately for JPGs).
    - Updates DB availability/keep flags accordingly.
    - Enqueues reconciliation jobs (high priority) to bring system fully consistent:
      - `manifest_check` (95), `folder_check` (95), `manifest_cleaning` (80).
  - Effect: downstream SSE/refreshes reflect file moves and cleaned state; maintenance runs quickly in priority lane.

- Revert Changes
  - Endpoint: `POST /api/projects/:folder/revert-changes`
  - Behavior: resets intent (`keep_jpg`/`keep_raw`) to current availability for all photos (non-destructive, no jobs needed).
  - UI: client updates state optimistically; no heavy background processing triggered.

### Image Move

- Endpoint (tasks-only): `POST /api/projects/:folder/jobs` with `{"task_type":"image_move","items":["<base1>","<base2>"]}`
  - `:folder` is the destination project folder (e.g., `p3`).
  - The task composes steps from `server/services/task_definitions.json`:
    1) `image_move_files` (95) — moves originals and any existing derivatives; updates DB and derivative statuses; emits SSE.
    2) `manifest_check` (95) — on the destination, to reconcile availability if needed; a separate `manifest_check` is also enqueued for the source by the worker.
    3) `generate_derivatives` (90) — runs if any derivative was missing and marked `pending` by the move.
- SSE events (from `imageMoveWorker`):
  - `{ type: "item_removed", project_folder: <source>, filename, updated_at }` — remove from source UI lists.
  - `{ type: "item_moved", project_folder: <dest>, filename, thumbnail_status, preview_status, updated_at }` — add/update in destination with derivative statuses set to `generated` if a derivative was moved, `pending` if it must be regenerated, or `not_supported` for RAW.
- Uploads integration: when posting to `POST /api/projects/:folder/upload` with multipart field `reloadConflictsIntoThisProject=true`, the server detects uploaded bases that exist in other projects and auto‑starts `image_move` into the current `:folder` for those bases.

## API Contract (Tasks-only)

- `POST /api/projects/:folder/jobs`
  - Tasks-only API: requires `task_type` in the JSON body.
  - Optional: `items` array for per-file itemization when applicable (e.g., uploaded filenames).
  - Returns: `{ task }` with task metadata (accepted, queued steps, etc.).
  - Supported `task_type` values include: `upload_postprocess`, `change_commit`, `maintenance`, `project_delete`, `project_scavenge`, and `image_move`.
- `GET /api/tasks/definitions`
  - Returns task labels, user-relevant flags, and composed steps used by the client UI.
  - Source: `server/services/task_definitions.json`.

Client helper: see `client/src/api/jobsApi.js` for UI calls and the SSE singleton used to consume `GET /api/jobs/stream` updates.

## Observability

- List jobs: `GET /api/projects/:folder/jobs` (filters: `status`, `type`).
- Job detail: `GET /api/jobs/:id` (includes items summary).
- SSE stream: `GET /api/jobs/stream` for real-time updates.
  - Dev-only client logs: the `client/src/api/jobsApi.js` SSE client logs `[SSE] ...` only when running under Vite dev (`import.meta.env.DEV`). Production builds do not log these messages.

## Project Deletion Task

- Endpoint: `DELETE /api/projects/:folder`
  - Performs a soft-delete (`projects.status='canceled'`, `archived_at` set) and enqueues the high-priority `project_delete` task so the UI removal is immediate while cleanup runs asynchronously.

- Task steps (see `server/services/task_definitions.json` → `project_delete.steps`):
  1) `project_stop_processes` — priority 100
     - Marks project archived and cancels queued/running jobs for the project.
  2) `project_delete_files` — priority 100
     - Deletes on-disk folder `.projects/<project_folder>/`.
  3) `project_cleanup_db` — priority 95
     - Cleans related DB rows (`photos`, `tags`, `photo_tags`) while retaining the archived `projects` row.

- Lane behavior: priorities ≥ threshold (default 90) run in the priority lane, ensuring deletion tasks preempt normal jobs.
