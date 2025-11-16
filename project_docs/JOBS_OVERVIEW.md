# Jobs Overview

**Canonical reference** for the background job pipeline, supported job types, and workflow integration.

## Pipeline Architecture

**Two-Lane System**:
- **Priority Lane**: Jobs with `priority >= pipeline.priority_threshold` (default 90)
- **Normal Lane**: All other jobs

**Configuration** (`config.json`):
- `pipeline.max_parallel_jobs` — Total concurrent jobs
- `pipeline.priority_lane_slots` — Dedicated priority slots
- `pipeline.priority_threshold` — Priority cutoff (default 90)
- `pipeline.heartbeat_ms` — Heartbeat interval
- `pipeline.stale_seconds` — Stale job timeout
- `pipeline.max_attempts_default` — Retry limit

**Features**:
- Heartbeat monitoring + crash recovery
- Bounded retries with exponential backoff
- Live updates via SSE (`/api/sse/stream`)
- Scope-aware execution (`project`/`photo_set`/`global`)
- Parallel image processing (4 worker threads, MD5 caching)

## Job Scopes

**`project`**: Single-project operations (requires `project_id`)
- Examples: `upload_postprocess`, `change_commit`, `maintenance`
- Operates on photos within one project folder
- Job payload includes project context

**`photo_set`**: Arbitrary photo collections across projects (optional `project_id`)
- Examples: `image_move`, `change_commit_all`
- Can operate on photos from multiple projects
- Job payload includes list of photo IDs
- Worker enumerates affected projects

**`global`**: System-wide operations (no `project_id`)
- Examples: `maintenance_global`, `folder_discovery`, `project_scavenge_global`
- Operates across all projects or system resources
- Worker enumerates all active projects
- Includes scheduled maintenance tasks

**Payload Limits**: Max 2,000 items per job. Larger batches auto-chunked or rejected at API level.

## Task Definitions

### Project-Scoped Tasks

**upload_postprocess** (scope: `project`)
- Steps: `upload_postprocess` (90), `manifest_check` (95), `folder_check` (95)
- Purpose: Post-upload derivative generation and reconciliation

**change_commit** (scope: `project`)
- Steps: `file_removal` (100), `manifest_check` (95), `folder_check` (95), `manifest_cleaning` (80)
- Purpose: Apply pending deletions for single project

**maintenance** (scope: `project`)
- Steps: `trash_maintenance` (100), `manifest_check` (95), `folder_check` (95), `manifest_cleaning` (80)
- Purpose: Per-project maintenance

**project_delete** (scope: `project`)
- Steps: `project_stop_processes` (100), `project_delete_files` (100), `project_cleanup_db` (95)
- Purpose: Orchestrated project deletion

### Cross-Project Tasks

**change_commit_all** (scope: `photo_set`)
- Steps: `file_removal` (100), `manifest_check` (95), `folder_check` (95), `manifest_cleaning` (80)
- Purpose: Apply pending deletions across multiple projects

**image_move** (scope: `photo_set`)
- Steps: `image_move_files` (95), `manifest_check` (95), `generate_derivatives` (90)
- Purpose: Move photos between projects

### Global Tasks

**maintenance_global** (scope: `global`)
- Steps: `trash_maintenance` (100), `orphaned_project_cleanup` (99), `duplicate_resolution` (98), `folder_alignment` (96), `manifest_check` (95), `folder_check` (95), `manifest_cleaning` (80)
- Purpose: System-wide hourly maintenance
- Trigger: Scheduled hourly via `scheduler.js`

**project_scavenge_global** (scope: `global`)
- Steps: `project_scavenge` (100)
- Purpose: Clean up archived project folders
- Trigger: Scheduled hourly via `scheduler.js`

**folder_discovery** (scope: `global`)
- Purpose: Discover and index new project folders in `.projects/user_0/`
- Trigger: Scheduled every 5 minutes (configurable)

## Job Types

### Derivative Generation

**generate_derivatives**
- Worker: `derivativesWorker.runGenerateDerivatives()`
- Purpose: Generate thumbnails and previews
- Payload: `{ force?: boolean, filenames?: string[] }`
- Features: Parallel processing (4 threads), MD5 caching, progressive JPEG

**upload_postprocess**
- Worker: `derivativesWorker.runGenerateDerivatives()` (itemized)
- Purpose: Post-upload processing
- Payload: `{ filenames: string[] }` (enqueued with items)

### Maintenance

**trash_maintenance**
- Worker: `maintenanceWorker.runTrashMaintenance()`
- Purpose: Clean `.trash` directories (24h TTL)

**orphaned_project_cleanup**
- Worker: `maintenanceWorker.runOrphanedProjectCleanup()`
- Purpose: Remove projects with missing folders
- Behavior: Cancel active projects, delete already-canceled projects
- Emits: `project_removed` or `project_canceled` SSE events

**duplicate_resolution**
- Worker: `maintenanceWorker.runDuplicateResolution()`
- Purpose: Rename cross-project filename collisions with `_duplicate{n}` suffix
- **Critical**: Must run before `folder_check`

**manifest_check**
- Worker: `maintenanceWorker.runManifestCheck()`
- Purpose: Reconcile DB vs filesystem, ensure `.project.yaml` exists
- Features: Cursor-based pagination (2000 photos/chunk), streaming progress

**folder_check**
- Worker: `maintenanceWorker.runFolderCheck()`
- Purpose: Discover untracked files, create DB records, enqueue `upload_postprocess`
- Behavior: Moves non-accepted files to `.trash`, skips `.project.yaml`

**manifest_cleaning**
- Worker: `maintenanceWorker.runManifestCleaning()`
- Purpose: Remove DB records for photos with no available files

**folder_alignment**
- Worker: `maintenanceWorker.runFolderAlignment()`
- Purpose: Align project folder names with display names
- Trigger: Hourly as part of `maintenance_global` (priority 96)
- Safety: Skips missing sources or colliding targets
- Emits: `folder_renamed` SSE event

**folder_discovery**
- Worker: `folderDiscoveryWorker.runFolderDiscovery()`
- Purpose: Auto-discover project folders in `.projects/user_0/`
- Reconciliation: Creates new projects, updates renamed folders, logs missing folders
- Features: Metadata extraction, derivative generation, manifest creation

### File Operations

**file_removal**
- Worker: `fileRemovalWorker.runFileRemoval()`
- Purpose: Remove non-kept originals/derivatives during commit
- Idempotent and safe to retry

**image_move_files**
- Worker: `imageMoveWorker.runImageMoveFiles()`
- Purpose: Move images and derivatives between projects
- Emits: `item_removed` (source), `item_moved` (destination) SSE events
- Derivative handling: Moves existing derivatives, marks missing as `pending`

### Project Deletion

**project_stop_processes**
- Worker: `projectDeletionWorker.stopProcesses()`
- Purpose: Mark project archived, cancel queued/running jobs

**project_delete_files**
- Worker: `projectDeletionWorker.deleteFiles()`
- Purpose: Delete on-disk project folder

**project_cleanup_db**
- Worker: `projectDeletionWorker.cleanupDb()`
- Purpose: Clean DB rows (photos, tags, photo_tags), retain archived project row

**project_scavenge**
- Worker: `projectScavengeWorker.runProjectScavenge()`
- Purpose: Remove leftover folders for archived projects
- Idempotent, best-effort

## Workflow Integration

### File Upload Flow

1. User uploads files via UI
2. Backend saves files, creates DB records
3. Enqueues `upload_postprocess` task with items
4. Worker generates derivatives with parallel processing
5. SSE events update UI in real-time

**Endpoint**: `POST /api/projects/:folder/upload`

### Folder Discovery Flow

1. Scheduled hourly scan of `.projects/user_0/`
2. Check for `.project.yaml` manifest
3. Reconcile with database (create/update/merge projects)
4. Extract EXIF metadata from discovered images
5. Index photos in database
6. Enqueue `upload_postprocess` for missing derivatives

**Trigger**: `scheduler.js` → `folder_discovery` job (every 5 minutes)

### Maintenance Flow

**Hourly Tasks**:
- `maintenance_global` — System-wide reconciliation
- `project_scavenge_global` — Clean archived project folders

**Task Composition** (see `task_definitions.json`):
1. `trash_maintenance` (100) — Clean `.trash`
2. `orphaned_project_cleanup` (99) — Remove orphaned projects
3. `duplicate_resolution` (98) — Rename duplicates
4. `folder_alignment` (96) — Align folder names
5. `manifest_check` (95) — Reconcile DB ↔ filesystem
6. `folder_check` (95) — Discover new files
7. `manifest_cleaning` (80) — Remove orphaned records

**Scheduler**: `server/services/scheduler.js`

### Commit/Revert Flow

**Project-Scoped**:
- `POST /api/projects/:folder/commit-changes` — Apply pending deletions
- `POST /api/projects/:folder/revert-changes` — Reset keep flags (non-destructive)

**Global**:
- `POST /api/photos/commit-changes` — `{ projects?: [...] }` (optional targeting)
- `POST /api/photos/revert-changes` — `{ projects?: [...] }` (optional targeting)

**Commit Behavior**:
- Moves non-kept files to `.trash`
- Deletes derivatives for JPGs
- Removes DB records when both `keep_jpg` and `keep_raw` cleared
- Enqueues reconciliation jobs per project
- Emits `item_removed`, `manifest_changed` SSE events

**Rate Limit**: 10 req/5 min/IP

### Image Move Flow

**Endpoint**: `POST /api/projects/:folder/jobs` with `task_type: "image_move"`

**Task Steps**:
1. `image_move_files` (95) — Move originals + derivatives, update DB
2. `manifest_check` (95) — Reconcile destination (+ separate check for source)
3. `generate_derivatives` (90) — Regenerate missing derivatives

**SSE Events**:
- `{ type: "item_removed", project_folder: <source>, filename }` — Remove from source UI
- `{ type: "item_moved", project_folder: <dest>, filename, thumbnail_status, preview_status }` — Add to destination

**Upload Integration**: When `reloadConflictsIntoThisProject=true`, server auto-starts `image_move` for cross-project conflicts.

### Project Rename & Folder Alignment

**Rename API**: `PATCH /api/projects/:folder/rename`
- Body: `{ new_name: string }`
- Behavior: Updates `project_name` immediately (non-blocking)
- Updates `.project.yaml` manifest
- Returns success immediately

**Folder Alignment** (Automatic, Hourly):
- Runs as part of `maintenance_global` (priority 96)
- Detects mismatches between `project_name` and `project_folder`
- Generates expected folder using `generateUniqueFolderName()`
- Performs atomic `fs.rename()`
- Updates database, rewrites manifest
- Emits `folder_renamed` SSE event

**Consistency Guarantees**:
- ✅ Display name updates are immediate (ACID)
- ✅ Folder alignment happens automatically during maintenance
- ✅ No blocking operations during rename API
- ✅ All operations idempotent and retry-safe

**Rate Limit**: 10 req/5 min/IP

## Cross-Project API Endpoints

All endpoints enforce max 2,000 items per request:

**Photo Operations**:
- `POST /api/photos/tags/add` — `{ items: [{ photo_id, tags }], dry_run? }`
- `POST /api/photos/tags/remove` — Same shape
- `POST /api/photos/keep` — `{ items: [{ photo_id, keep_jpg?, keep_raw? }], dry_run? }`
- `POST /api/photos/process` — `{ items: [{ photo_id }], force?, dry_run? }`
- `POST /api/photos/move` — `{ items: [{ photo_id }], dest_folder, dry_run? }`

**Commit/Revert**:
- `POST /api/photos/commit-changes` — `{ projects?: [...] }`
- `POST /api/photos/revert-changes` — `{ projects?: [...] }`

**Payload Validation**: Requests exceeding 2,000 items return 400 with error message.

## API Contract

**Tasks-Only API**: `POST /api/projects/:folder/jobs`
- Requires: `task_type` in JSON body
- Optional: `items` array for per-file itemization
- Returns: `{ task }` with metadata
- Supported task types: `upload_postprocess`, `change_commit`, `maintenance`, `project_delete`, `project_scavenge`, `image_move`

**Task Definitions**: `GET /api/tasks/definitions`
- Returns task labels, user-relevant flags, composed steps
- Source: `server/services/task_definitions.json`

## Observability

**List Jobs**: `GET /api/projects/:folder/jobs` (filters: `status`, `type`)

**Job Detail**: `GET /api/jobs/:id` (includes items summary)

**SSE Stream**: `GET /api/sse/stream?channels=jobs,pending-changes`
- Real-time updates for job progress, item-level changes, pending deletions
- Event types: `job_started`, `job_completed`, `job_failed`, `job_update`, `item`, `item_removed`, `item_moved`, `manifest_changed`, `folder_renamed`

**Dev Logging**: Client logs `[SSE] ...` only in Vite dev mode (`import.meta.env.DEV`)

## Project Deletion Task

**Endpoint**: `DELETE /api/projects/:folder`
- Performs soft-delete (`status='canceled'`, `archived_at` set)
- Enqueues high-priority `project_delete` task
- UI removal immediate, cleanup runs async

**Task Steps**:
1. `project_stop_processes` (100) — Archive project, cancel jobs
2. `project_delete_files` (100) — Delete on-disk folder
3. `project_cleanup_db` (95) — Clean DB rows, retain archived project row

**Lane Behavior**: Priorities ≥ threshold run in priority lane, ensuring deletion preempts normal jobs.

## Implementation Files

- Worker Loop: `server/services/workerLoop.js`
- Scheduler: `server/services/scheduler.js`
- Task Definitions: `server/services/task_definitions.json`
- Workers: `server/services/workers/` (derivatives, maintenance, imageMove, projectDeletion, projectScavenge, folderDiscovery)
- Repository: `server/services/repositories/jobsRepo.js`
- Routes: `server/routes/jobs.js`, `server/routes/uploads.js`, `server/routes/maintenance.js`

## Related Documentation

- **[PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)** — Architecture and core concepts
- **[SCHEMA_DOCUMENTATION.md](./SCHEMA_DOCUMENTATION.md)** — Database schema and API contracts
- **[README.md](../README.md)** — Quick start guide
- **[SECURITY.md](../SECURITY.md)** — Security implementation
