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

- Scheduled in `server/services/scheduler.js` for each project:
  - `trash_maintenance` (priority 100, hourly)
  - `manifest_check` (priority 95, every 6h)
  - `folder_check` (priority 95, every 6h)
  - `manifest_cleaning` (priority 80, daily)
- Can also be triggered manually via `server/routes/maintenance.js`.
- Lane behavior:
  - High priorities (>= threshold, default 90) run in the priority lane ensuring quick reconciliation independent of long-running normal jobs.

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

## Generic API / Client Helper

- REST: `POST /api/projects/:folder/jobs` → enqueue any job type, optionally with `payload.filenames` to create `job_items`.
- Client: `client/src/api/jobsApi.js` → `enqueueJob(folder, { type, payload })`.

## Observability

- List jobs: `GET /api/projects/:folder/jobs` (filters: `status`, `type`).
- Job detail: `GET /api/jobs/:id` (includes items summary).
- SSE stream: `GET /api/jobs/stream` for real-time updates.
