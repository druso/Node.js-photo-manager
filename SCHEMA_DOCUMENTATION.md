# Data Schema Documentation

This project treats the on-disk folder as the primary source of truth for photo availability. The normalized SQLite database mirrors disk state for fast queries, and the frontend caches/derives UI state from the DB.

Order of truth and reconciliation:

- Folder (disk) → SQL (DB) → Frontend (UI)
- Implication: during destructive operations we always modify the folder first (move/delete files), then reconcile the DB, and finally update the UI incrementally.

## Frontend Architecture (2025-09-28 Update)

The frontend has been extensively refactored for optimal maintainability and performance:

- **App.jsx Optimization**: Reduced from ~2,350 lines to 1,021 lines (57% reduction) through systematic extraction
- **Modular Hook System**: 20+ specialized React hooks handle state management, business logic, effects, and UI concerns
- **Component Extraction**: Modular UI components eliminate code duplication and improve reusability
- **Layout Stability**: Fixed header positioning and scroll behavior for consistent user experience
- **API Integration**: Enhanced `projectsApi.js` includes `getConfig()` function for configuration management
- **Pagination Improvements**: Implemented a global manager cache that persists PagedWindowManager instances across renders, ensuring consistent behavior between All Photos and Project views
  - **Mode-Specific Caching**: Separate caches for All Photos mode and each project folder
  - **Enhanced Manager Lifecycle**: Modified `ensureWindow` to check the cache before creating new instances
  - **Improved Reset Logic**: Updated `resetState` to reset manager state without destroying instances
  - **Sort Change Detection**: Added logic to detect sort changes and reset the appropriate manager

This architecture maintains full backward compatibility while significantly improving code organization, state persistence, and developer experience.

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
  - Cross-project conflict detection: `photosRepo.getGlobalByFilename()` queries by filename excluding a project_id to detect conflicts across projects

  Semantics of availability vs keep flags:
  - `jpg_available`, `raw_available`, `other_available`: reflect files actually present on disk (derived from folder state).
  - `keep_jpg`, `keep_raw`: user intent flags. By default they mirror availability and are automatically realigned
    during ingestion and `upload_postprocess` so that new variants don’t create spurious pending deletions.
  - Manual changes to `keep_*` are honored until either Commit (destructive) or Revert (non‑destructive) is invoked.

  Date semantics used by cross‑project APIs:
  - `taken_at := coalesce(date_time_original, created_at)` is the canonical timestamp for ordering and filtering in
    `GET /api/photos` and `GET /api/photos/locate-page`.
  - Date filters `date_from`/`date_to` operate on `taken_at`.

- `photo_public_hashes`
  - Purpose: stores Option A public asset hashes for each `photos.id`
  - Columns: `photo_id` (INTEGER PK/FK), `hash` (TEXT unique per row), `rotated_at` (TEXT ISO timestamp), `expires_at` (TEXT ISO timestamp)
  - Relationships: `photo_id` references `photos.id`; row deleted when a photo is made private or removed.
  - Generation: backend `publicAssetHashes.ensureHashForPhoto(photoId)` inserts/rotates hashes using defaults from `config.public_assets` (`hash_rotation_days` / `hash_ttl_days` with env overrides `PUBLIC_HASH_ROTATION_DAYS` / `PUBLIC_HASH_TTL_DAYS`).
  - Rotation: daily scheduler (`server/services/scheduler.js`) invokes `publicAssetHashes.rotateDueHashes()` to refresh hashes before expiry.
  - Consumption: asset routes validate the `hash` query parameter for anonymous requests; admins can stream assets without providing a hash.

### All Photos API (Cross-Project)

- All photos (paginated): `GET /api/photos`
  - Query params: `limit`, `cursor`, `before_cursor`, `date_from`, `date_to`, `file_type`, `keep_type`, `orientation`, `tags`, `visibility`, `include=tags`
  - Returns: `{ items: [...], total: number, unfiltered_total: number, next_cursor: string|null, prev_cursor: string|null }`
  - Filter params: same as project photos API
  - Tag filtering: `tags=portrait,-rejected` includes photos with 'portrait' tag and excludes those with 'rejected' tag
    - Positive tags (no prefix): photo must have ALL specified tags (AND logic)
    - Negative tags (with `-` prefix): photo must have NONE of the specified tags (NOT ANY logic)
  - Optional tag inclusion: `include=tags` adds a `tags: string[]` property to each item
  - `total`: count of photos matching current filters across all projects, `unfiltered_total`: total photos across all non-canceled projects
  - Default sort: `taken_at DESC, id DESC` for consistent pagination

- Locate photo page: `GET /api/photos/locate-page`
  - Query params: `filename` or `name`, plus same filter params as above
  - Returns: page containing the specified photo with surrounding items
  - Used for deep-linking to specific photos in filtered views

- `tags`
  - Columns: `id`, `project_id` (FK), `name`, `UNIQUE(project_id, name)`
  - Semantics: Tags are scoped to projects. The same tag name can exist in multiple projects.
  - Access: `tagsRepo.getOrCreateTag(project_id, name)` ensures a tag exists and returns its ID.

- `photo_tags` (many-to-many)
  - Columns: `photo_id` (FK), `tag_id` (FK), PK(photo_id, tag_id)
  - Relationships: Each photo can have multiple tags, and each tag can be applied to multiple photos.
  - Access: 
    - `photoTagsRepo.addTagToPhoto(photo_id, tag_id)` adds a tag to a photo
    - `photoTagsRepo.removeTagFromPhoto(photo_id, tag_id)` removes a tag from a photo
    - `photoTagsRepo.listTagsForPhoto(photo_id)` gets all tags for a single photo
    - `photoTagsRepo.listTagsForPhotos(photo_ids)` efficiently fetches tags for multiple photos in a batch
    - `photoTagsRepo.listPhotosForTag(tag_id)` gets all photos with a specific tag

Data access is through repository modules:

- `server/services/repositories/projectsRepo.js`
- `server/services/repositories/photosRepo.js` (modular interface delegating to specialized modules)
  - `photoCrud.js` - Basic CRUD operations (get, upsert, update, delete)
  - `photoFiltering.js` - Filtering and listing operations (listAll, listProjectFiltered)
  - `photoPagination.js` - Pagination logic (locateProjectPage, locateAllPage, listPaged)
  - `photoPendingOps.js` - Pending operations (deletes, mismatches)
  - `photoQueryBuilders.js` - SQL WHERE clause construction utilities
- `server/services/repositories/tagsRepo.js`
- `server/services/repositories/photoTagsRepo.js`

Notes:

- Foreign keys and WAL are enabled in `server/services/db.js`.
- Routes (`projects.js`, `uploads.js`, `assets.js`, `tags.js`, `keep.js`) exclusively use repositories.

### Authentication Configuration (2025-10-04 Update)

- `server/services/auth/authConfig.js` defines the startup contract for authentication secrets:
  - `AUTH_ADMIN_BCRYPT_HASH` — required bcrypt hash of the universal admin password (must match `/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/`).
  - `AUTH_JWT_SECRET_ACCESS` and `AUTH_JWT_SECRET_REFRESH` — required 256-bit (32-byte) secrets for signing 1 h access and 7 d refresh JWTs respectively.
  - `AUTH_BCRYPT_COST` — optional integer between 8 and 14 (default 12) allowing operators to tune bcrypt work factor.
- `server/services/auth/initAuth.js` invokes `ensureAuthConfig()` during boot; misconfiguration logs `auth_config_invalid` via `logger2` and terminates the process to prevent running without secrets.
- Supporting helpers:
  - `passwordUtils.js` verifies plaintext passwords using the configured hash and can mint new hashes with the active cost.
  - `tokenService.js` issues/verifies JWTs with issuer `photo-manager`, audience `photo-manager-admin`, and an embedded `role: 'admin'` claim; mismatched token types throw descriptive errors.
  - `authCookieService.js` centralises HTTP-only cookie defaults (SameSite Strict, secure flag derived from `AUTH_COOKIE_SECURE`/`NODE_ENV`, scoped paths for refresh vs access tokens).
- Tests under `server/services/auth/__tests__/` cover config parsing, password helpers, token lifecycle, and cookie behaviour (`npm test`).

### Migration Scaffolding (Draft – Milestone 0)

- `server/services/migrations/runner.js` loads migration modules from `server/services/migrations/migrations/`, sorts by `id`, and wraps each `up` execution in a transaction (`runner.runAll({ dryRun: true|false })`).
- Draft migrations (not auto-applied yet) capture planned schema extensions:
  - `2025100401_add_photos_visibility.js` adds `photos.visibility TEXT NOT NULL DEFAULT 'private'` for public/private filtering.
  - `2025100402_create_public_links.js` creates `public_links` (`id`, `project_id`, `title`, `description`, `hashed_key`, `expires_at`, timestamps) with indexes on `project_id` and `hashed_key`.
  - `2025100403_create_photo_public_links.js` adds the join table linking photos to shared links with composite primary key plus lookup indexes.
- **Dry-run usage**:
  ```js
  const path = require('path');
  const { getDb } = require('./server/services/db');
  const { MigrationRunner } = require('./server/services/migrations/runner');
  const db = getDb();
  const runner = new MigrationRunner({ db, migrationsDir: path.join(__dirname, 'server/services/migrations/migrations') });
  runner.runAll({ dryRun: false });
  ```
  Execute from repo root after the base schema is initialised to inspect migration effects locally; keep drafts unapplied in production until rollout plans are approved.

### Project API Response Shapes

Project-related endpoints return consistent shapes including the immutable numeric `id` and canonical `project_folder`:

- List projects: `GET /api/projects`
  - Returns: `[{ id, name, folder, created_at, updated_at }, ...]`
  - Notes: `folder` is the canonical `p<id>`; `name` is the display name.

- Project detail: `GET /api/projects/:folder`
  - Returns: `{ id, name, folder, created_at, updated_at, photos: [...] }`
  - The `photos` array contains the full photo objects as documented in this file.

- Project photos (paginated): `GET /api/projects/:folder/photos`
  - Query params: `limit`, `cursor`, `before_cursor`, `sort`, `dir`, `date_from`, `date_to`, `file_type`, `keep_type`, `orientation`, `tags`, `visibility`, `include=tags`
  - Returns: `{ items: [...], total: number, unfiltered_total: number, nextCursor: string|null, prevCursor: string|null }`
  - Filter params: `file_type` (jpg_only|raw_only|both|any), `keep_type` (any_kept|jpg_only|raw_jpg|none|any), `orientation` (vertical|horizontal|any)
  - Tag filtering: `tags=portrait,-rejected` includes photos with 'portrait' tag and excludes those with 'rejected' tag (same semantics as All Photos)
  - Optional tag inclusion: `include=tags` adds a `tags: string[]` property to each item
  - `total`: count of photos matching current filters, `unfiltered_total`: total photos in project

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
  - Columns: `id`, `tenant_id`, `project_id` (INTEGER FK nullable), `scope` (TEXT, default `'project'`), `type`, `status`, `created_at`, `started_at`, `finished_at`,
    `progress_total`, `progress_done`, `payload_json`, `error_message`, `worker_id`, `heartbeat_at`,
    `attempts`, `max_attempts`, `last_error_at`, `priority`.
  - `scope` indicates how a job should be resolved: `'project'`, `'photo_set'`, or `'global'`. When `project_id` is null the job must be treated as cross-project/global by workers.
  - Foreign key constraint uses `ON DELETE SET NULL` so legacy rows with a project reference remain valid during refactors.
  - Indexes: `(project_id, created_at DESC)`, `(status)`, `(tenant_id, created_at DESC)`, `(tenant_id, status)`, `(status, priority DESC, created_at ASC)`, plus new scope-focused indexes `idx_jobs_scope_status` and `idx_jobs_tenant_scope` to keep cross-project queries fast.
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
- Worker loop: `server/services/workerLoop.js` dispatches by `job.type` to worker modules under `server/services/workers/`, using shared helpers in `server/services/workers/shared/photoSetUtils.js` to resolve targets based on scope.
- Claiming: `jobsRepo.claimNext({ minPriority?, maxPriority? })` lets the worker select from a priority range (used by the two lanes).
- Events/SSE: `server/services/events.js` provides `emitJobUpdate` and `onJobUpdate`; `server/routes/jobs.js` exposes `GET /api/jobs/stream`.

#### Project Deletion as Task

- New task `project_delete` orchestrates deletion via three high-priority steps:
  - `project_stop_processes` (priority 100): marks project `status='canceled'`, cancels queued/running jobs for the project.
  - `project_delete_files` (priority 100): removes the on-disk folder `.projects/<project_folder>/`.
  - `project_cleanup_db` (priority 95): cleans related DB rows (`photos`, `tags`, `photo_tags`) while retaining the `projects` row as archive.
- Frontend calls `DELETE /api/projects/:folder`; the route performs the soft-delete and enqueues this task so the UI removal is immediate while cleanup runs asynchronously.

#### Maintenance Jobs

High‑priority, idempotent maintenance jobs still operate per project but are orchestrated via scope-aware tasks:

- `trash_maintenance`: remove files in `.trash` older than 24h
- `manifest_check`: reconcile DB availability flags with files on disk
- `folder_check`: scan project folder for untracked files; enqueue `upload_postprocess` for accepted ones; move others to `.trash`
- `manifest_cleaning`: delete photo rows with no JPG or RAW available
- `project_scavenge`: single-step task that removes leftover on-disk folders for archived projects (`projects.status='canceled'`).

Scheduling: `server/services/scheduler.js` now kicks off a single hourly `maintenance_global` task (scope `global`) that fans out to these steps inside the worker pipeline, plus an hourly `project_scavenge_global` task to purge archived project folders. See `JOBS_OVERVIEW.md` for canonical task definitions.

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

### Pending Changes SSE Stream

**Endpoint**: `GET /api/sse/pending-changes`

**Purpose**: Real-time notification of pending changes (mismatches between availability and keep flags) across all projects.

**Implementation**: `server/routes/sse.js`

**Data Format**:
```json
{
  "p15": true,
  "p7": false
}
```

**Behavior**:
- Sends initial state on connection
- Broadcasts updates when keep flags are modified via `PUT /api/projects/:folder/keep`
- Sends keepalive messages every 30 seconds
- Query checks for mismatches: `(jpg_available = 1 AND keep_jpg = 0) OR (raw_available = 1 AND keep_raw = 0)`
- Joins `photos` with `projects` table to get `project_folder` names

**Client Usage**:
- Hook: `client/src/hooks/usePendingChangesSSE.js` maintains EventSource connection
- Consumer: `client/src/hooks/usePendingDeletes.js` determines toolbar visibility
- All Photos mode: Shows toolbar if ANY project has `true`
- Project mode: Shows toolbar if current project has `true`

**Benefits**:
- Instant toolbar updates across all browser tabs
- No polling overhead
- Multi-tab synchronization
- Simplified client state management

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
- Contents: `windowY`, `mainY`. Viewer state is no longer persisted; the URL is the single source of truth for deep links and current photo.
- Restore strategy: scroll positions restored via retry loop after layout.
- Reset rule: session UI state is cleared when switching to a different project during the same session; initial project selection after reload does not clear it.
- Removed: legacy per-project `localStorage` APIs and migration code. Use `client/src/utils/storage.js → getSessionState()`, `setSessionState()`, `clearSessionState()`, plus helpers `setSessionWindowY()`, `setSessionMainY()`.

---

### On‑Disk Layout for Derivatives (Still used for files on disk)

- Thumbnails: `<project>/.thumb/<filename>.jpg`
- Previews: `<project>/.preview/<filename>.jpg`

Deletions:

- When JPG originals are moved to `.trash` via Commit (`POST /api/projects/:folder/commit-changes`), corresponding derivatives are deleted immediately (not moved to `.trash`).
- `folder_check` moves only unaccepted files to `.trash` and does not remove derivatives; only accepted files ever have derivatives.

### Related Backend Endpoints

- POST `/api/projects/:folder/process` — queue thumbnail/preview generation (supports optional `{ force, filenames[] }` payload)
- GET `/api/projects/:folder/thumbnail/:filename` → serves generated thumbnail JPG (streams without auth only when `photos.visibility === 'public'`; private assets require an authenticated admin session)
- `GET /api/projects/:folder/preview/:filename` → serves generated preview JPG (same visibility gate as thumbnails)
- `GET /api/photos` — keyset‑paginated list across all non‑archived projects (supports `limit`, `cursor`, `before_cursor`, `date_from`, `date_to`, `file_type`, `keep_type`, `orientation`, `tags`, `include=tags`)
- `GET /api/photos/locate-page` — locate a specific photo and return its containing page (requires `project_folder` and `filename` or `name`; accepts the same optional filters as `/api/photos`, including `tags` and `include=tags`; returns `{ items, position, page_index, idx_in_items, next_cursor, prev_cursor, target }` and guarantees the target is within the filtered result set)
- `GET /api/photos/pending-deletes` — aggregated pending deletion counts across all projects (supports date/file/orientation filters; returns `{ jpg, raw, total, byProject }`; ignores `keep_type` and always reports counts independent of the paginated grid filters)
- POST `/api/photos/commit-changes` — global commit across multiple projects (accepts optional `{ projects }` body)
- POST `/api/photos/revert-changes` — global revert across multiple projects (accepts optional `{ projects }` body)
### Payload Validation

- All cross-project photo endpoints enforce the shared `MAX_ITEMS_PER_JOB` guardrail (currently 2,000 items). Validation lives in `server/routes/photosActions.js`; when clients exceed the limit they receive a `400` with guidance to reduce batch size. Internal orchestrators may pass `autoChunk: true` to `jobsRepo.enqueueWithItems()` so large operations are split into compliant job batches.

The SQLite database is located at `.projects/db/user_0.sqlite` and is automatically created on first run.

---

## Related Links

- `./PROJECT_OVERVIEW.md` — Architecture, workflows, API overview
- `./SECURITY.md` — Protections, gaps, and prioritized interventions
- `./JOBS_OVERVIEW.md` — Job catalog and how flows use them
