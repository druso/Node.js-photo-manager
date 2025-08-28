# Data Schema Documentation

This project treats the on-disk folder as the primary source of truth for photo availability. The normalized SQLite database mirrors disk state for fast queries, and the frontend caches/derives UI state from the DB.

Order of truth and reconciliation:

- Folder (disk) → SQL (DB) → Frontend (UI)
- Implication: during destructive operations we always modify the folder first (move/delete files), then reconcile the DB, and finally update the UI incrementally.

## SQLite Schema Overview

Tables and relationships:

- `projects`
  - Columns: `id` (INTEGER PK), `project_name` (TEXT), `project_folder` (TEXT UNIQUE), `created_at` (TEXT), `updated_at` (TEXT), `schema_version` (TEXT NULL), `status` (TEXT NULL), `archived_at` (TEXT NULL)
  - `status`: when `'canceled'` the project is considered archived/soft-deleted and is hidden from frontend lists and detail endpoints. The row is retained for audit.
  - `archived_at`: timestamp when the project was soft-deleted.
  - Indexes: `CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`
  - `project_folder` format: `p<id>` (canonical on-disk folder; immutable, decoupled from display name)

- `photos`
  - Columns (selected): `id`, `project_id` (FK), `filename`, `basename`, `ext`, `created_at`, `updated_at`,
    `date_time_original`, `jpg_available`, `raw_available`, `other_available`, `keep_jpg`, `keep_raw`,
    `thumbnail_status`, `preview_status`, `orientation`, `meta_json`
  - Indexes: filename, basename, ext, date, raw_available, orientation

  Semantics of availability vs keep flags:
  - `jpg_available`, `raw_available`, `other_available`: reflect files actually present on disk (derived from folder state).
  - `keep_jpg`, `keep_raw`: user intent flags. By default they mirror availability and are automatically realigned
    during ingestion and `upload_postprocess` so that new variants don’t create spurious pending deletions.
  - Manual changes to `keep_*` are honored until either Commit (destructive) or Revert (non‑destructive) is invoked.

  Date semantics used by cross‑project APIs:
  - `taken_at := coalesce(date_time_original, created_at)` is the canonical timestamp for ordering and filtering in
    `GET /api/photos` and `GET /api/photos/locate-page`.
  - Date filters `date_from`/`date_to` operate on `taken_at`.

- `tags`
  - Columns: `id`, `project_id` (FK), `name`, `UNIQUE(project_id, name)`

- `photo_tags` (many-to-many)
  - Columns: `photo_id` (FK), `tag_id` (FK), PK(photo_id, tag_id)

Data access is through repository modules:

- `server/services/repositories/projectsRepo.js`
- `server/services/repositories/photosRepo.js`
- `server/services/repositories/tagsRepo.js`
- `server/services/repositories/photoTagsRepo.js`

Notes:

- Foreign keys and WAL are enabled in `server/services/db.js`.
- Routes (`projects.js`, `uploads.js`, `assets.js`, `tags.js`, `keep.js`) exclusively use repositories.

### Project API Response Shapes

Project-related endpoints return consistent shapes including the immutable numeric `id` and canonical `project_folder`:

- List projects: `GET /api/projects`
  - Returns: `[{ id, name, folder, created_at, updated_at }, ...]`
  - Notes: `folder` is the canonical `p<id>`; `name` is the display name.

- Project detail: `GET /api/projects/:folder`
  - Returns: `{ id, name, folder, created_at, updated_at, photos: [...] }`
  - The `photos` array contains the full photo objects as documented in this file.

- Rename project: `PATCH /api/projects/:id`
  - Payload: `{ name: string }`
  - Returns: `{ message, project: { id?, name, folder, created_at, updated_at } }`
  - Behavior: updates only the display name; `folder` remains `p<id>` and does not change.

### Optional Helper: parseProjectIdFromFolder(folder)

An optional utility function that parses the numeric project id from a canonical folder string `p<id>`. It simplifies cases where only the folder is known but the `id` is desired for logging or quick lookups. See implementation in `server/utils/projects.js`.

Example behavior:
```js
parseProjectIdFromFolder('p12') // => 12
```

### Async Jobs (Queue)

Durable background jobs are stored in two tables: `jobs` and `job_items`.

- `jobs`
  - Columns: `id`, `tenant_id`, `project_id` (FK), `type`, `status`, `created_at`, `started_at`, `finished_at`,
    `progress_total`, `progress_done`, `payload_json`, `error_message`, `worker_id`, `heartbeat_at`,
    `attempts`, `max_attempts`, `last_error_at`, `priority`.
  - Indexes: `(project_id, created_at DESC)`, `(status)`, `(tenant_id, created_at DESC)`, `(tenant_id, status)`, `(status, priority DESC, created_at ASC)`.
  - Status values: `queued`, `running`, `completed`, `failed`, `canceled`.
  - Progress: `progress_total` and `progress_done` are nullable; workers should set both (or leave null for indeterminate).
  - Payload: arbitrary JSON (stringified) for worker‑specific params.

  - Priority: higher `priority` values are claimed first; ties break on oldest `created_at`.
    The worker loop implements two lanes with separate capacity: a priority lane (claims with `priority >= threshold`) and a normal lane.
    See `pipeline.priority_lane_slots` and `pipeline.priority_threshold` in configuration.

- `job_items`
  - Columns: `id`, `tenant_id`, `job_id` (FK), `photo_id` (FK nullable), `filename`, `status`, `message`,
    `created_at`, `updated_at`.
  - Indexes: `(job_id)`, `(tenant_id)`.
  - Use when a job processes multiple files so you can report per‑item progress and summaries.

- Source of truth: `server/services/db.js` (DDL), repositories in `server/services/repositories/jobsRepo.js`.
- Worker loop: `server/services/workerLoop.js` dispatches by `job.type` to worker modules under `server/services/workers/`.
- Claiming: `jobsRepo.claimNext({ minPriority?, maxPriority? })` lets the worker select from a priority range (used by the two lanes).
- Events/SSE: `server/services/events.js` provides `emitJobUpdate` and `onJobUpdate`; `server/routes/jobs.js` exposes `GET /api/jobs/stream`.

#### Project Deletion as Task

- New task `project_delete` orchestrates deletion via three high-priority steps:
  - `project_stop_processes` (priority 100): marks project `status='canceled'`, cancels queued/running jobs for the project.
  - `project_delete_files` (priority 100): removes the on-disk folder `.projects/<project_folder>/`.
  - `project_cleanup_db` (priority 95): cleans related DB rows (`photos`, `tags`, `photo_tags`) while retaining the `projects` row as archive.
- Frontend calls `DELETE /api/projects/:folder`; the route performs the soft-delete and enqueues this task so the UI removal is immediate while cleanup runs asynchronously.

#### Maintenance Jobs

High‑priority, idempotent maintenance jobs operate per project:

- `trash_maintenance`: remove files in `.trash` older than 24h
- `manifest_check`: reconcile DB availability flags with files on disk
- `folder_check`: scan project folder for untracked files; enqueue `upload_postprocess` for accepted ones; move others to `.trash`
- `manifest_cleaning`: delete photo rows with no JPG or RAW available
- `project_scavenge`: single-step task that removes leftover on-disk folders for archived projects (`projects.status='canceled'`).

Scheduling: `server/services/scheduler.js` triggers a unified hourly `maintenance` task for active (non-archived) projects only, and `project_scavenge` hourly for archived projects to clean up leftover project folders.

#### Job Lifecycle

1. Enqueue: `jobsRepo.enqueue()` or `enqueueWithItems()` (when filenames are provided) from `POST /api/projects/:folder/jobs`.
2. Worker Loop picks the next `queued` job, sets `running`, `started_at`, `worker_id`, and `heartbeat_at`.
3. Worker updates `progress_*` and may update `job_items.status/message` while sending heartbeats.
4. On error: increment `attempts`; if `< max_attempts` requeue; otherwise set `failed`, `error_message`, `last_error_at`.
5. On completion: set `completed` + `finished_at`.
6. Crash recovery: stale `running` (expired `heartbeat_at`) are requeued automatically by the loop.
7. SSE events are emitted on state transitions and significant progress.

#### Example SSE item payload

The jobs stream (`GET /api/jobs/stream`) emits item-level updates while derivatives are generated and other tasks progress. A typical payload:

```json
{
  "type": "item",
  "project_folder": "p12",
  "filename": "IMG_0001.CR2",
  "statuses": {
    "thumb": "done",
    "preview": "processing"
  }
}
```

- `type: "item"` marks a per-asset update.
- `project_folder` and `filename` uniquely identify the asset.
- `statuses` conveys derivative states; the client updates `projectData.photos` in-place and preserves scroll/viewer state.

#### Image Move: DB and SSE Semantics

- Task/Step: `image_move` task includes `image_move_files` (see `server/services/task_definitions.json`). Worker implementation: `server/services/workers/imageMoveWorker.js`.

- DB effects for each moved base filename:
  - Update `photos.project_id` from source to destination project.
  - Availability flags (`jpg_available`, `raw_available`, `other_available`) remain truthful to files on disk after the move.
  - Derivative status alignment:
    - `thumbnail_status`/`preview_status` set to `generated` if the corresponding derivative file was moved.
    - Set to `pending` if the derivative does not exist at destination and must be regenerated by the subsequent `generate_derivatives` step.
    - RAW-only assets set both to `not_supported`.
  - Source reconciliation: the worker enqueues a `manifest_check` for the source project to correct any lingering availability mismatches.

- SSE events emitted per item:
  - Source project removal:
    ```json
    { "type": "item_removed", "project_folder": "p1", "filename": "IMG_0001" }
    ```
  - Destination project addition/update with derivative statuses:
    ```json
    {
      "type": "item_moved",
      "project_folder": "p3",
      "filename": "IMG_0001",
      "thumbnail_status": "generated|pending|not_supported",
      "preview_status": "generated|pending|not_supported"
    }
    ```
  - The client consumes these on the same `GET /api/jobs/stream` channel and updates source/destination collections incrementally without a full reload.

#### Typical Queries

List latest jobs for a project:

```sql
SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50;
```

Count items by status for a job:

```sql
SELECT status, COUNT(*) AS c FROM job_items WHERE job_id = ? GROUP BY status;
```

Find running jobs and stale heartbeats (for future recovery):

```sql
SELECT * FROM jobs WHERE status = 'running' AND (strftime('%s','now') - strftime('%s', heartbeat_at)) > 60;
```

#### Extending the Schema

- Prefer placing worker‑specific parameters in `jobs.payload_json` or `job_items.message`/`filename` before adding columns.
- If you need structural changes:
  - Update DDL in `server/services/db.js`.
  - Add read/write methods in `server/services/repositories/jobsRepo.js`.
  - Update `workerLoop` and workers accordingly.
  - Document the change here (new columns, allowed values, indices).

#### Frontend Expectations

- Avoid hard refreshes of the photo list. Prefer incremental, in-place updates to preserve user context. See `PROJECT_OVERVIEW.md` → “UX Principles (Golden Rules)”.

### Destructive Ordering (Commit Changes)

- On Commit, the system ensures the folder is the first point of change:
  1) Move non-kept files to `.trash` and remove JPG derivatives.
  2) Update DB availability flags via `manifest_check`/`folder_check`.
  3) Remove DB rows with no assets via `manifest_cleaning`.
- This ordering guarantees that the DB never claims availability for files that no longer exist, and the frontend reflects changes incrementally without hard refreshes.

---

### Session-only UI State (Client)

- The client persists transient UI state for the current browser tab session only, under a single `sessionStorage` key `session_ui_state`.
- Contents: `windowY`, `mainY`, and `viewer` object (`open`, `index`, `filename`, `showInfo`).
- Restore strategy: scroll positions restored via retry loop after layout; viewer state restored after photos load to avoid races.
- Reset rule: session UI state is cleared when switching to a different project during the same session; initial project selection after reload does not clear it.
- Removed: legacy per-project `localStorage` APIs and migration code. Use `client/src/utils/storage.js → getSessionState()`, `setSessionState()`, `clearSessionState()`, plus helpers `setSessionWindowY()`, `setSessionMainY()`, `setSessionViewer()`.

---

### On‑Disk Layout for Derivatives (Still used for files on disk)

- Thumbnails: `<project>/.thumb/<filename>.jpg`
- Previews: `<project>/.preview/<filename>.jpg`

Deletions:

- When JPG originals are moved to `.trash` via Commit (`POST /api/projects/:folder/commit-changes`), corresponding derivatives are deleted immediately (not moved to `.trash`).
- `folder_check` moves only unaccepted files to `.trash` and does not remove derivatives; only accepted files ever have derivatives.

### Related Backend Endpoints

- POST `/api/projects/:folder/process` — queue thumbnail/preview generation (supports optional `{ force, filenames[] }` payload)
- GET `/api/projects/:folder/thumbnail/:filename` → serves generated thumbnail JPG
- GET `/api/projects/:folder/preview/:filename` → serves generated preview JPG
- GET `/api/photos` — keyset‑paginated list across all non‑archived projects (supports `limit`, `cursor`, `date_from`, `date_to`, `file_type`, `keep_type`, `orientation`)
- GET `/api/photos/locate-page` — locate a specific photo and return its containing page (requires `project_folder` and `filename` or `name`; returns `{ items, position, page_index, idx_in_items, next_cursor, prev_cursor, target }`)

See implementations in `server/routes/uploads.js` and `server/routes/assets.js`.

## Database File Location

The SQLite database is located at `.projects/db/user_0.sqlite` and is automatically created on first run.

---

## Related Links

- `./PROJECT_OVERVIEW.md` — Architecture, workflows, API overview
- `./SECURITY.md` — Protections, gaps, and prioritized interventions
- `./JOBS_OVERVIEW.md` — Job catalog and how flows use them
