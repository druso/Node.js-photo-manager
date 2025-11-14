{{ ... }}

This document summarizes the background job pipeline, supported job types, their options, and how key flows (file upload, maintenance, and change commit) use them.

- Source files: `server/services/workerLoop.js`, `server/services/scheduler.js`, `server/routes/uploads.js`, `server/routes/maintenance.js`, `server/routes/jobs.js`
- Repositories: `server/services/repositories/jobsRepo.js`
-## Related Docs

- `PROJECT_OVERVIEW.md`
- `SCHEMA_DOCUMENTATION.md`
- `tasks_progress/jobs_refactoring_progress.md`
- `tasks_progress/job_refactoring/REFACTORING_SUMMARY.md`
- `tasks_progress/job_refactoring_backwardcompatibilitynotes.md` (removal timeline for `scope` column)

## Pipeline Architecture (brief)

- **Two-lane worker pipeline** controlled by config:
  - Priority lane: jobs with `priority >= pipeline.priority_threshold`.
  - Normal Lane: all other jobs.
- **Key knobs** (see `config.json` / `config.default.json`):
  - `pipeline.max_parallel_jobs`, `pipeline.priority_lane_slots`, `pipeline.priority_threshold`
  - `pipeline.heartbeat_ms`, `pipeline.stale_seconds`, `pipeline.max_attempts_default`
{{ ... }}
- **Heartbeats, crash recovery** (`requeueStaleRunning`), and bounded retries (`max_attempts_default`) are handled by `workerLoop.js`.
- **Live job updates via SSE**: `GET /api/jobs/stream` (also item-level events from `derivativesWorker`).
- **Scope-aware jobs** (as of 2025-10-01): Jobs can operate on arbitrary photo subsets across projects via `scope` field.
- **Shared helpers**: Worker modules rely on `server/services/workers/shared/photoSetUtils.js` to resolve job targets, group items by project, and enforce payload limits consistently across `project`, `photo_set`, and `global` scopes.

Image Move emits realtime events too. See "Image Move" below for `item_removed` and `item_moved` semantics.

## Job Scopes (Cross-Project Support)

Jobs now support three scope types via the `scope` column:

- **`project`**: Traditional single-project operations (requires `project_id`)
- **`photo_set`**: Arbitrary photo collections, potentially spanning multiple projects (optional `project_id`)
- **`global`**: System-wide operations like maintenance (no `project_id`)

**Payload Limits**: All jobs enforce a maximum of 2,000 items per job. Larger batches are automatically chunked or rejected at the API level.

**Backward Compatibility**: Existing jobs without `scope` default to `'project'`. See `tasks_progress/job_refactoring_backwardcompatibilitynotes.md` for removal timeline.

## At a glance: Tasks → Steps and Priorities

### Project-Scoped Tasks

- **Upload Post-Process** (`upload_postprocess` task, scope: `project`)
  - `upload_postprocess` (90)
  - `manifest_check` (95)
  - `folder_check` (95)

- **Commit Changes** (`change_commit` task, scope: `project`)
  - `file_removal` (100)
  - `manifest_check` (95)
  - `folder_check` (95)
  - `manifest_cleaning` (80)

- **Maintenance** (`maintenance` task, scope: `project`)
  - `trash_maintenance` (100)
  - `manifest_check` (95)
  - `folder_check` (95)
  - `manifest_cleaning` (80)

- **Project Scavenge** (`project_scavenge` task, scope: `project`)
  - `project_scavenge` (100)

- **Delete Project** (`project_delete` task, scope: `project`)
  - `project_stop_processes` (100)
  - `project_delete_files` (100)
  - `project_cleanup_db` (95)

### Cross-Project Tasks (New)

- **Commit Changes (All Photos)** (`change_commit_all` task, scope: `photo_set`)
  - `file_removal` (100)
  - `manifest_check` (95)
  - `folder_check` (95)
  - `manifest_cleaning` (80)

- **Image Move** (`image_move` task, scope: `photo_set`)
  - `image_move_files` (95)
  - `manifest_check` (95)
  - `generate_derivatives` (90)

### Global Tasks (New)

- **Global Maintenance** (`maintenance_global` task, scope: `global`)
  - `trash_maintenance` (100)
  - `orphaned_project_cleanup` (99)
  - `duplicate_resolution` (98)
  - `folder_alignment` (96)
  - `manifest_check` (95)
  - `folder_check` (95)
  - `manifest_cleaning` (80)

- **Global Project Scavenge** (`project_scavenge_global` task, scope: `global`)
  - `project_scavenge` (100)

**Lane behavior**: Steps with priority ≥ `pipeline.priority_threshold` run in the priority lane and can preempt normal jobs. See `config.json` for `pipeline.priority_lane_slots` and `pipeline.priority_threshold`.

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
  - Purpose: periodic cleanup and management of `.trash` directory (TTL-based file removal).
  - Payload: none currently.

- orphaned_project_cleanup
  - Worker: `maintenanceWorker.runOrphanedProjectCleanup()`.
  - Purpose: detect and clean up projects whose folders no longer exist on disk.
  - Behavior:
    - For projects with missing folders:
      - Already `canceled`: Removes from database entirely
      - Active projects: Marks as `canceled` (preserves data, prevents display)
    - Emits SSE events: `project_removed` or `project_canceled`
  - Payload: none currently.
  - **Safety**: Two-phase approach (cancel first, remove on next run) prevents accidental data loss.

- duplicate_resolution
  - Worker: `maintenanceWorker.runDuplicateResolution()`.
  - Purpose: detect cross-project filename collisions and rename duplicates with deterministic `_duplicate{n}` suffixes; enqueues `upload_postprocess` for renamed files.
  - Payload: none currently.
  - **Critical**: Must run before `folder_check` to avoid creating duplicate DB records.

- manifest_check
  - Worker: `maintenanceWorker.runManifestCheck()`.
  - Purpose: reconcile database vs on-disk state (availability flags); ensures `.project.yaml` manifest exists and is correct.
  - Payload: none currently.
  - **Streaming behavior**: Uses cursor-based pagination to process photos in configurable chunks (default 2000, see `config.maintenance.manifest_check_chunk_size`). This prevents memory issues with large projects (50k+ photos) and enables real-time progress tracking via `jobsRepo.updateProgress()`. Yields to event loop between chunks with `setImmediate`.

- folder_check
  - Worker: `maintenanceWorker.runFolderCheck()`.
  - Purpose: scan project folder for untracked files; creates minimal DB records and enqueues `upload_postprocess` for metadata extraction and derivative generation; moves non-accepted files to `.trash`. Skips `.project.yaml` manifest files.
  - Payload: none currently.
  - **Delegation**: Does NOT extract metadata directly—delegates all photo ingestion to `upload_postprocess` pipeline.

- manifest_cleaning
  - Worker: `maintenanceWorker.runManifestCleaning()`.
  - Purpose: removes DB records for photos with no available files (`jpg_available=false AND raw_available=false`).
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
  - Purpose: delete the on-disk project folder `.projects/user_0/<project_folder>/`.
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

- folder_alignment (2025-11-04)
  - Worker: `maintenanceWorker.runFolderAlignment()`.
  - Purpose: Aligns project folder names with project display names during maintenance cycles.
  - Trigger: 
    - Runs hourly as part of `maintenance_global` task (priority 96)
    - Can process single project (`project_id` set) or all projects (global scope)
  - Safety checks:
    - Source folder must exist (skips if missing)
    - Target folder must not exist (skips if collision to avoid data loss)
  - Behavior:
    - Detects mismatches between `project_name` and `project_folder`
    - Generates expected folder name using `generateUniqueFolderName()`
    - Performs atomic `fs.rename()` operation
    - Updates database with new folder path
    - Rewrites `.project.yaml` manifest in new location
    - Emits SSE `folder_renamed` event for UI updates
  - Idempotent: Safe to retry; skips already-aligned folders
  - Payload: none currently (uses `project_id` and database state).

- folder_discovery
  - Worker: `folderDiscoveryWorker.runFolderDiscovery()`.
  - Purpose: automatically discover and index project folders in `.projects/user_0/`; reconcile with database state.
  - Reconciliation scenarios:
    1. New folder found → creates project record
    2. External rename detected → updates DB to match filesystem
    3. Missing folder → logs warning (project remains in DB)
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

### Folder Discovery

- Purpose: Automatically discover and index project folders that appear in `.projects/user_0/` (e.g., from external file copies, backups, or manual organization).
- Trigger: Scheduled hourly via `server/services/scheduler.js` → `folder_discovery` job.
- Worker: `server/services/workers/folderDiscoveryWorker.js`

**Discovery Process**:

1. **Scan for folders** in `.projects/user_0/` (skips hidden folders and `db`)
2. **Check for manifest** (`.project.yaml`):
   - **Has manifest**: Reconcile with database
     - If project ID exists: update folder name if renamed
     - If project ID missing but name exists: check for shared images
       - **Shared images found**: Merge projects (move files, extract metadata, enqueue `upload_postprocess`)
       - **No shared images**: Create separate project
   - **No manifest**: Create new project from folder
3. **Extract metadata** from discovered images:
   - Uses `exif-parser` to extract EXIF data (date, orientation, camera info)
   - Same process as upload flow for consistency
   - Prefers JPG files for metadata extraction
4. **Index photos** in database with full metadata
5. **Check derivatives**:
   - If thumbnails/previews missing: enqueue `upload_postprocess` job
   - Reuses existing task infrastructure
6. **Generate manifest** if missing (`.project.yaml` with project ID and name)

**Merge Logic**:
- When projects share images, files are moved to the existing project
- Metadata extracted from all moved files
- Source folder removed after successful merge
- `manifest_check` and `upload_postprocess` jobs enqueued for reconciliation

**Benefits**:
- ✅ Full metadata extraction (same as upload)
- ✅ Reuses existing `upload_postprocess` task
- ✅ Automatic derivative generation
- ✅ Handles external folder additions gracefully
- ✅ Detects and merges duplicate projects

### Maintenance

- **Scheduler model** (see `server/services/scheduler.js`):
  - Kicks off the `maintenance_global` task hourly for system-wide reconciliation across all active (non‑archived) projects.
  - Separately kicks off the `project_scavenge` task hourly for archived projects to clean up leftover folders.
- **Task composition** (see `server/services/task_definitions.json` → `maintenance_global.steps`):
  - `trash_maintenance` (priority 100) - Clean `.trash` directories
  - `orphaned_project_cleanup` (priority 99) - Remove projects whose folders no longer exist on disk
  - `duplicate_resolution` (priority 98) - Rename cross-project filename collisions with `_duplicate{n}` suffix
  - `folder_alignment` (priority 96) - Align project folder names with display names
  - `manifest_check` (priority 95) - Reconcile DB vs filesystem, ensure `.project.yaml` exists
  - `folder_check` (priority 95) - Discover new files, create minimal records, enqueue `upload_postprocess`
  - `manifest_cleaning` (priority 80) - Remove orphaned photo records (no JPG or RAW available)
- **Pipeline delegation**: `folder_check` creates minimal photo records (null metadata/derivatives) and delegates all ingestion to `upload_postprocess`, which handles EXIF extraction and derivative generation via `derivativesWorker`.
- **Manifest lifecycle**: `.project.yaml` files are generated/repaired by `manifest_check` and preserved by `folder_check` (skipped during file scans).
- **Manual triggering**: maintenance flows can be initiated via `server/routes/maintenance.js` where applicable.
- **Lane behavior**: high priorities (>= threshold, default 90) run in the priority lane to keep reconciliation snappy even if normal jobs are long-running.

### Change Commit (Commit/Revert Toolbar)

- Commit Changes (Project-scoped)
  - Endpoint: `POST /api/projects/:folder/commit-changes`
  - Behavior:
    - For each photo in the specified project: moves non-kept JPG/RAW files to `.trash` (derivatives removed immediately for JPGs).
    - Updates DB availability/keep flags accordingly.
    - Enqueues reconciliation jobs: `manifest_check` (95), `folder_check` (95), `manifest_cleaning` (80).
    - Emits SSE: `item_removed` for each deleted photo, `manifest_changed` with `removed_filenames`.
  - Rate limit: 10 req/5 min/IP.

- Commit Changes (Global)
  - Endpoint: `POST /api/photos/commit-changes`
  - Behavior:
    - Operates across multiple projects with pending deletions.
    - Accepts optional `{ projects: ["p1", "p2"] }` body to target specific projects.
    - If no projects specified, automatically detects all projects with pending deletions.
    - For each affected project: moves non-kept JPG/RAW files to `.trash`, updates DB, enqueues reconciliation jobs.
    - Emits SSE events per project: `item_removed`, `manifest_changed`.
  - Rate limit: 10 req/5 min/IP.

- Revert Changes (Project-scoped)
  - Endpoint: `POST /api/projects/:folder/revert-changes`
  - Behavior: resets `keep_jpg := jpg_available` and `keep_raw := raw_available` for all photos in the specified project.
  - Non-destructive (no files moved).
  - Rate limit: 10 req/5 min/IP.

- Revert Changes (Global)
  - Endpoint: `POST /api/photos/revert-changes`
  - Behavior:
    - Operates across multiple projects with keep mismatches.
    - Accepts optional `{ projects: ["p1", "p2"] }` body to target specific projects.
    - If no projects specified, automatically detects all projects with keep mismatches.
    - Resets `keep_jpg := jpg_available` and `keep_raw := raw_available` for affected photos.
  - Non-destructive (no files moved).
  - Rate limit: 10 req/5 min/IP.

- Pending Deletes Summary
  - Endpoint: `GET /api/photos/pending-deletes`
  - Behavior: returns aggregated pending deletion counts across all projects.
  - Response: `{ jpg: number, raw: number, total: number, byProject: string[] }`
  - Supports filtering by date range, file type, and orientation (ignores `keep_type` so counts are independent of preview mode filters).
  - The All Photos UI fetches this endpoint directly (see `listAllPendingDeletes()`), ensuring the commit/revert toolbar reflects cross-project totals even when the paginated list is filtered.

### Image Move

- Endpoint (tasks-only): `POST /api/projects/:folder/jobs` with `{"task_type":"image_move","items":["<base1>","<base2>"]}`
  - `:folder` is the destination project folder (e.g., `p3`).
    1) `image_move_files` (95) — moves originals and any existing derivatives; updates DB and derivative statuses; emits SSE.
    2) `manifest_check` (95) — on the destination, to reconcile availability if needed; a separate `manifest_check` is also enqueued for the source by the worker.
    3) `generate_derivatives` (90) — runs if any derivative was missing and marked `pending` by the move.
- SSE events (from `imageMoveWorker`):
  - `{ type: "item_removed", project_folder: <source>, filename, updated_at }` — remove from source UI lists.
  - `{ type: "item_moved", project_folder: <dest>, filename, thumbnail_status, preview_status, updated_at }` — add/update in destination with derivative statuses set to `generated` if a derivative was moved, `pending` if it must be regenerated, or `not_supported` for RAW.
- Uploads integration: when posting to `POST /api/projects/:folder/upload` with multipart field `reloadConflictsIntoThisProject=true`, the server detects uploaded bases that exist in other projects and auto‑starts `image_move` into the current `:folder` for those bases.

### Project Rename & Folder Alignment (2025-11-04)

**Maintenance-Driven Consistency**: Simple, Non-Blocking Approach

- **Endpoint**: `PATCH /api/projects/:folder/rename`
  - Body: `{ new_name: string }`
  - Rate limit: 10 req/5 min/IP

**Rename API (Immediate, Non-Blocking)**
- Updates `project_name` immediately in database (ACID transaction)
- Updates `.project.yaml` manifest with new name
- Returns success immediately - no blocking operations
- No jobs enqueued, no flags set

**Folder Alignment (Automatic, Hourly)**
- Runs as part of `maintenance_global` task (priority 96)
- Detects mismatches between `project_name` and `project_folder`
- Generates expected folder name using `generateUniqueFolderName()`
- Safety checks:
  - Source folder must exist (skips if missing)
  - Target folder must not exist (skips if collision)
- Performs atomic `fs.rename()` operation
- Updates database: `project_folder` → aligned folder name
- Rewrites manifest in new location
- Emits SSE event: `{ type: "folder_renamed", project_id, old_folder, new_folder }`

**Consistency Guarantees**:
- ✅ Display name updates are immediate and transactional (ACID)
- ✅ Folder alignment happens automatically during maintenance
- ✅ No blocking operations during rename API calls
- ✅ All operations are idempotent and retry-safe
- ✅ Handles external folder changes gracefully

**User Experience**:
- Immediate feedback: Project name changes instantly in UI
- Background processing: Folder rename happens during next maintenance cycle (hourly)
- No downtime: Project continues working with old folder until alignment completes
- SSE updates: UI refreshes automatically when folder rename completes

---

## Cross-Project API Endpoints (New)

The following endpoints accept photo_id lists and enforce payload size limits:

### Photo Operations
- **`POST /api/photos/tags/add`** - Add tags to photos (max 2,000 items)
  - Body: `{ items: [{ photo_id, tags: [...] }], dry_run?: boolean }`
  - Returns: `{ updated: number, errors?: [...] }`

- **`POST /api/photos/tags/remove`** - Remove tags from photos (max 2,000 items)
  - Body: `{ items: [{ photo_id, tags: [...] }], dry_run?: boolean }`
  - Returns: `{ updated: number, errors?: [...] }`

- **`POST /api/photos/keep`** - Update keep flags (max 2,000 items)
  - Body: `{ items: [{ photo_id, keep_jpg?: boolean, keep_raw?: boolean }], dry_run?: boolean }`
  - Returns: `{ updated: number, errors?: [...] }`
  - Emits SSE item-level updates for real-time UI sync

- **`POST /api/photos/process`** - Generate derivatives (max 2,000 items)
  - Body: `{ items: [{ photo_id }], force?: boolean, dry_run?: boolean }`
  - Returns: `{ task_id: string, job_count: number, job_ids: [...], chunked?: boolean, errors?: [...] }`
  - Uses single `photo_set`-scoped task for all photos (optimized, no per-project fan-out)

- **`POST /api/photos/move`** - Move photos between projects (max 2,000 items)
  - Body: `{ items: [{ photo_id }], dest_folder: string, dry_run?: boolean }`
  - Returns: `{ job_count: number, job_ids: [...], destination_project: {...}, errors?: [...] }`
  - Groups photos by source project and enqueues per-project image_move jobs

### Commit/Revert Operations
- **`POST /api/photos/commit-changes`** - Commit pending deletions across projects
  - Body: `{ projects?: [...], project_folders?: [...] }` (optional selectors)
  - Returns: `{ queued_projects: number, projects: [...], skipped?: [...] }`
  - Fans out to per-project `change_commit` tasks

- **`POST /api/photos/revert-changes`** - Revert keep flag mismatches across projects
  - Body: `{ projects?: [...], project_folders?: [...] }` (optional selectors)
  - Returns: `{ queued_projects: number, projects: [...], skipped?: [...] }`
  - Fans out to per-project revert operations

### Payload Validation
All endpoints enforce a **maximum of 2,000 items per request**. Requests exceeding this limit return:
```json
{
  "error": "Payload contains X items, exceeding maximum of 2000. Please reduce the batch size or split into multiple requests."
}
```

**Status Code**: 400 Bad Request

**Note**: Internal callers (workers, orchestrator) can use `autoChunk: true` in `jobsRepo.enqueueWithItems()` to automatically split large batches into multiple jobs.

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
     - Deletes on-disk folder `.projects/user_0/<project_folder>/`.
  3) `project_cleanup_db` — priority 95
     - Cleans related DB rows (`photos`, `tags`, `photo_tags`) while retaining the archived `projects` row.

- Lane behavior: priorities ≥ threshold (default 90) run in the priority lane, ensuring deletion tasks preempt normal jobs.
