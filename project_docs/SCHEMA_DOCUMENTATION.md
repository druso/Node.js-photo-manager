# Data Schema Documentation

This project treats the on-disk folder as the primary source of truth for photo availability. The normalized SQLite database mirrors disk state for fast queries, and the frontend caches/derives UI state from the DB.

Order of truth and reconciliation:

- Folder (disk) → SQL (DB) → Frontend (UI)
- Implication: during destructive operations we always modify the folder first (move/delete files), then reconcile the DB, and finally update the UI incrementally.

## Frontend Architecture

The frontend has been extensively refactored for optimal maintainability and performance:

- **App.jsx Optimization**: Reduced from ~2,350 lines to 1,021 lines (57% reduction) through systematic extraction
- **Modular Hook System**: 20+ specialized React hooks handle state management, business logic, effects, and UI concerns
- **Component Extraction**: Modular UI components eliminate code duplication and improve reusability
- **Layout Stability**: Fixed header positioning and scroll behavior for consistent user experience
- **API Integration**: Enhanced `projectsApi.js` includes `getConfig()` function for configuration management
- **Pagination System**: Global manager cache persists PagedWindowManager instances across renders, ensuring consistent behavior between All Photos and Project views

This architecture maintains full backward compatibility while significantly improving code organization and developer experience. For detailed frontend architecture information, see `PROJECT_OVERVIEW.md` → Frontend Architecture Achievements.

## SQLite Schema Overview

Tables and relationships:

- `projects`
  - Columns: `id` (INTEGER PK), `project_name` (TEXT), `project_folder` (TEXT UNIQUE), `created_at` (TEXT), `updated_at` (TEXT), `schema_version` (TEXT NULL), `status` (TEXT NULL), `archived_at` (TEXT NULL), `manifest_version` (TEXT DEFAULT '1.0')
  - `status`: when `'canceled'` the project is considered archived/soft-deleted and is hidden from frontend lists and detail endpoints. The row is retained for audit.
  - `archived_at`: timestamp when the project was soft-deleted.
  - `manifest_version`: version tag for the `.project.yaml` manifest stored alongside the project folder.
  - Indexes: `CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`, `CREATE INDEX IF NOT EXISTS idx_projects_folder ON projects(project_folder)`
  - `project_folder` format: sanitized, human-readable folder names derived from `project_name` (with `(n)` suffix resolution for duplicates). Only sanitized folder names are accepted.
  - **Maintenance-Based Folder Alignment**:
    - Rename API updates `project_name` immediately (non-blocking).
    - Hourly `folder_alignment` maintenance task detects mismatches between `project_name` and `project_folder` and renames folders atomically using `generateUniqueFolderName()` safeguards.
    - Safety checks skip missing sources or colliding targets, logging warnings instead of aborting the run.
    - Post-alignment, the worker updates the DB, rewrites the manifest, and emits `folder_renamed` SSE payloads so the UI refreshes live.
    - For detailed workflow, see `JOBS_OVERVIEW.md` → Project Rename & Folder Alignment.

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
  - `date_time_original` extraction follows EXIF fallback order `DateTimeOriginal → CreateDate → ModifyDate`. All harvested timestamps are preserved in `meta_json` for auditing.

- `photo_public_hashes`
  - Purpose: stores Option A public asset hashes for each `photos.id`
  - Columns: `photo_id` (INTEGER PK/FK), `hash` (TEXT unique per row), `rotated_at` (TEXT ISO timestamp), `expires_at` (TEXT ISO timestamp)
  - Relationships: `photo_id` references `photos.id`; row deleted when a photo is made private or removed.
  - Generation: backend `publicAssetHashes.ensureHashForPhoto(photoId)` inserts/rotates hashes using defaults from `config.public_assets` (`hash_rotation_days` / `hash_ttl_days` with env overrides `PUBLIC_HASH_ROTATION_DAYS` / `PUBLIC_HASH_TTL_DAYS`).
  - Hash format: 32-char URL-safe base64url string via `crypto.randomBytes(24).toString('base64url')`
  - Rotation: daily scheduler (`server/services/scheduler.js`) invokes `publicAssetHashes.rotateDueHashes()` to refresh hashes before expiry.
  - Consumption: asset routes validate the `hash` query parameter for anonymous requests; admins can stream assets without providing a hash.
  - Direct access: `GET /api/projects/image/:filename` returns JSON with fresh hash for public photos, 401 for private.
  - Frontend: `PublicHashContext` (`client/src/contexts/PublicHashContext.jsx`) manages hash lifecycle, caching fresh hashes and refreshing expired ones via `fetchPublicImageMetadata()`.

- `public_links`
  - Purpose: stores shared link metadata for public photo galleries
  - Columns: `id` (TEXT PK, UUID), `title` (TEXT NOT NULL), `description` (TEXT), `hashed_key` (TEXT NOT NULL UNIQUE), `created_at` (TEXT), `updated_at` (TEXT)
  - Indexes: `idx_public_links_hashed_key` on `hashed_key` for fast lookup
  - Hashed key: 32-char URL-safe base64url string generated via `crypto.randomBytes(24).toString('base64url')`
  - Access: `publicLinksRepo.getByHashedKey(hashedKey)` for public access, `publicLinksRepo.getById(id)` for admin operations

- `photo_public_links`
  - Purpose: many-to-many junction table linking photos to shared links
  - Columns: `photo_id` (INTEGER FK), `public_link_id` (TEXT FK), `created_at` (TEXT), PK(photo_id, public_link_id)
  - Relationships: `photo_id` references `photos.id`, `public_link_id` references `public_links.id`; cascade deletes on both
  - Indexes: `idx_photo_public_links_photo_id`, `idx_photo_public_links_link_id` for efficient queries
  - Access: `publicLinksRepo.associatePhotos(linkId, photoIds)`, `publicLinksRepo.removePhoto(linkId, photoId)`

### All Photos API (Cross-Project)

**Primary Endpoint:** `GET /api/photos`

**Query Parameters:**
- Pagination: `limit`, `cursor`, `before_cursor`
- Filters: `date_from`, `date_to`, `file_type`, `keep_type`, `orientation`, `tags`, `visibility`
- Sorting: `sort` (filename|date_time_original|file_size), `dir` (ASC|DESC)
- Options: `include=tags`, `public_link_id`

**Returns:** `{ items: [...], total: number, unfiltered_total: number, next_cursor: string|null, prev_cursor: string|null }`

**Key Behaviors:**
- Server-side sorting with cursor-based pagination (cursors are sort-order specific)
- Tag filtering: `tags=portrait,-rejected` includes photos with 'portrait' tag and excludes those with 'rejected' tag
  - Positive tags (no prefix): photo must have ALL specified tags (AND logic)
  - Negative tags (with `-` prefix): photo must have NONE of the specified tags (NOT ANY logic)
- Optional tag inclusion: `include=tags` adds a `tags: string[]` property to each item
- Public link filter: `public_link_id=<hashedKey>` filters to photos associated with the referenced shared link
- `total`: count of photos matching current filters across all projects
- `unfiltered_total`: total photos across all non-canceled projects
- Default sort: `taken_at DESC, id DESC` for consistent pagination

- Locate photo page: `GET /api/photos/locate-page`
  - Query params: `filename` or `name`, plus same filter params as above
  - Returns: page containing the specified photo with surrounding items
  - Used for deep-linking to specific photos in filtered views

- All photo keys (for "Select All"): `GET /api/photos/all-keys`
  - Query params: same filter params as `/api/photos` (`date_from`, `date_to`, `file_type`, `keep_type`, `orientation`, `tags`, `visibility`, `public_link_id`, `sort_by`, `sort_dir`)
  - Returns: `{ keys: string[], total: number }` where keys are in format `"project_folder::filename"`
  - Lightweight query returning only photo identifiers without metadata
  - Used by frontend "Select All" to select all filtered photos across pagination
  - No pagination - returns all matching keys in a single response
  - Performance: ~200KB for 10,000 photos, <200ms query time
  - Public link filter behaves like the list endpoint: anonymous requests with `public_link_id` are clamped to public visibility, while admins see full results.

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
  - `photoFiltering.js` - Filtering, sorting, and listing operations (listAll, listProjectFiltered)
    - Supports dynamic ORDER BY with sort-direction aware cursor calculations
    - Maps frontend sort keys (name/date/size) to database columns (filename/date_time_original/file_size)
    - Correctly calculates prevCursor based on sort direction (DESC: newer items, ASC: older items)
  - `photoPagination.js` - Pagination logic (locateProjectPage, locateAllPage, listPaged)
  - `photoPendingOps.js` - Pending operations (deletes, mismatches)
  - `photoQueryBuilders.js` - SQL WHERE clause construction utilities
- `server/services/repositories/tagsRepo.js`
- `server/services/repositories/photoTagsRepo.js`
- `server/services/repositories/publicLinksRepo.js` - Shared link management (create, update, delete, associate photos)

### Shared Links API (2025-10-08 to 2025-10-12 Updates)

**Admin Endpoints** (require authentication via `authenticateAdmin` middleware):

- `GET /api/public-links` - List all shared links with photo counts
- `POST /api/public-links` - Create new shared link (rate limited: 10 req/5min)
  - Body: `{ title: string, description?: string }`
  - Returns: Created link with auto-generated UUID and 32-char hashed key
- `GET /api/public-links/:id` - Get specific shared link details
- `PATCH /api/public-links/:id` - Update title/description (Milestone 4 Phase 2: changed from PUT to PATCH)
  - Body: `{ title?: string, description?: string }`
- `POST /api/public-links/:id/regenerate` - Regenerate hashed key (rate limited: 5 req/5min, Milestone 4 Phase 2: endpoint path corrected)
  - Invalidates old key, generates new 32-char base64url key
- `DELETE /api/public-links/:id` - Delete shared link (cascade removes photo associations)
- `POST /api/public-links/:id/photos` - Associate photos with shared link
  - Body: `{ photo_ids: number[] }`
- `DELETE /api/public-links/:id/photos/:photoId` - Remove photo from shared link
- `GET /api/public-links/:id/photos` - Get all photos in link (admin view, includes private)

**Public Endpoints** (no authentication required):

- `GET /shared/api/:hashedKey` - Get shared link with public photos only (rate limited: 30 req/min)
  - Query params: `limit`, `cursor`, `before_cursor` for pagination
  - Returns: `{ id, title, description, photos: [...], total, next_cursor, prev_cursor }`
  - Only returns photos with `visibility = 'public'`
  - Photos include `public_hash` and `public_hash_expires_at` for asset URL construction
  - 404 if link not found or invalid key format
- `GET /shared/api/:hashedKey/admin` - Get shared link with all photos (Milestone 4 Phase 2: new admin endpoint)
  - Requires authentication via `authenticateAdmin` middleware
  - Query params: `limit`, `cursor`, `before_cursor` for pagination
  - Returns all photos (public + private) in the shared link
  - Uses same `listSharedLinkPhotos()` function with `includePrivate: true`
  - **IMPORTANT**: Route must be registered BEFORE the generic `/:hashedKey` route in `sharedLinks.js`
- `GET /shared/api/:hashedKey/photo/:photoId` - Get specific photo in shared link context
  - Validates photo is public and belongs to the link
  - 404 if photo not found, private, or not in link

**Asset Access for Public Photos**:

- Public asset routes require `?hash=<hash>` query parameter for anonymous requests:
  - `GET /api/projects/:folder/thumbnail/:filename?hash=<hash>`
  - `GET /api/projects/:folder/preview/:filename?hash=<hash>`
  - `GET /api/projects/:folder/image/:filename?hash=<hash>`
- Admin requests (valid JWT) bypass hash requirement
- Invalid/missing/expired hash returns 401/404
- Hash validation via `publicAssetHashes.validateHash(photoId, providedHash)`

**Frontend Routes**:

- `/sharedlinks` - Admin management page (Milestone 4 Phase 2: renamed from `/publiclinks`)
  - Rendered by `SharedLinksPage.jsx` component
  - Requires authentication (wrapped in `ProtectedSharedLinksPage` in `main.jsx`)
  - Full CRUD interface with card-based layout:
    - Create new shared links (modal with title + description)
    - Edit existing links (modal)
    - Delete links (confirmation modal with warning)
    - Regenerate hashed keys (invalidates old URL)
    - Copy share URLs to clipboard
    - Preview links (opens in new tab)
  - Icon-only actions: 📋 Copy, ✏️ Edit, 🔄 Regenerate, 🗑️ Delete (with tooltips)
  - Header with "Druso Photo Manager" title and "All Photos" navigation button
  - "Exit shared link" button in shared link view navigates here
- `/shared/:hashedKey` - Public/Admin shared link page with deep linking support
  - **Routing** in `client/src/main.jsx`:
    - Matches pattern: `/shared/:hashedKey` and `/shared/:hashedKey/:photoName`
    - Regex: `/^\/shared\/([a-zA-Z0-9_-]{32})(?:\/(.+))?$/`
    - Extracts `hashedKey` (32-char base64url) and optional `photoName` for deep linking
    - Passes both to `SharedLinkRoute` component
  - **Public users** (unauthenticated): Rendered by `SharedLinkPage.jsx`
    - Uses `useSharedLinkData` hook with `isAuthenticated: false`
    - Calls `/shared/api/:hashedKey` endpoint (public photos only)
    - Displays header with "Druso Photo Manager" + Login button
    - Shows photo grid using `AllPhotosPane` component (same as admin)
    - No admin controls (no upload, no operations menu, no selection)
    - **Deep linking**: Accepts `initialPhotoName` prop to auto-open viewer
  - **Admin users** (authenticated): Rendered by `App.jsx` with `sharedLinkHash` and `initialPhotoName` props
    - Uses `useSharedLinkData` hook with `isAuthenticated: true`
    - Calls `/shared/api/:hashedKey/admin` endpoint (all photos including private)
    - Shows full UI with operations menu and selection capabilities
    - Upload button hidden in shared mode (`isAuthenticated && !isSharedLinkMode`)
    - "Exit shared link" button navigates to `/sharedlinks`
    - **Deep linking**: Accepts `initialPhotoName` prop to auto-open viewer
  - **URL Synchronization** (2025-01-04):
    - Opening photo: `pushState` to `/shared/{token}/{photoBasename}`
    - Navigating photos: `replaceState` to update photo in URL
    - Closing viewer: `pushState` to `/shared/{token}`
    - Deep links paginate automatically to find target photo
  - Both views use identical `AllPhotosPane` grid component for consistency
  - Integrates `PhotoViewer` with `isPublicView={true}` for public users
  - No authentication required for public access

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
  - Notes: `folder` is the canonical folder slug (sanitized human-readable form). Only properly sanitized folder names are accepted.

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
  - The worker loop implements two lanes with separate capacity: a priority lane (claims with `priority >= threshold`) and a normal lane.
  - Source of truth: `server/services/db.js` (DDL), repositories in `server/services/repositories/jobsRepo.js`.
  - Worker loop: `server/services/workerLoop.js` dispatches by `job.type` to worker modules under `server/services/workers/`, using shared helpers in `server/services/workers/shared/photoSetUtils.js` to resolve targets based on scope.
  - Claiming: `jobsRepo.claimNext({ minPriority?, maxPriority? })` lets the worker select from a priority range (used by the two lanes).
  - Tenant-wide listing: the admin API `GET /api/jobs` returns all jobs for the authenticated tenant (`DEFAULT_USER` in single-tenant deployments) and is now the canonical source consumed by the Processes panel in both Project and All Photos contexts.

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
  - `project_delete_files` (priority 100): removes the on-disk folder `.projects/user_0/<project_folder>/`.
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

- On Commit, the system immediately removes photo rows whose `keep_*` flags have both been cleared:
  1) Move non-kept files to `.trash` and remove JPG derivatives.
  2) Delete the corresponding DB record right away and emit `item_removed` SSE so clients drop thumbnails without waiting for maintenance.
  3) For partial removals (e.g., RAW only), update DB availability flags to reflect the remaining assets.
- Scheduled maintenance (`manifest_check`, `folder_check`, `manifest_cleaning`) still runs as a safeguard, but zombie rows are now eliminated during the original commit workflow.
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
- `GET /api/photos/all-keys` — lightweight query returning all photo keys matching filters (returns `{ keys: string[], total: number }`; used for "Select All" functionality; no pagination)
- `GET /api/photos/pending-deletes` — aggregated pending deletion counts across all projects (supports date/file/orientation filters; returns `{ jpg, raw, total, byProject }`; ignores `keep_type` and always reports counts independent of the paginated grid filters)
- POST `/api/photos/commit-changes` — global commit across multiple projects. When no `{ projects }` override is supplied the backend aggregates all pending deletions, produces per-project summaries, and queues a single `change_commit_all` task with `{ photo_id, filename? }` job items (auto-chunked at 2k items per job).
- POST `/api/photos/revert-changes` — global revert across multiple projects (accepts optional `{ projects }` body)
### Payload Validation & Job Items

- All cross-project photo endpoints enforce the shared `MAX_ITEMS_PER_JOB` guardrail (currently 2,000 items). Validation lives in `server/routes/photosActions.js`; when clients exceed the limit they receive a `400` with guidance to reduce batch size. Internal orchestrators pass `autoChunk: true` to `jobsRepo.enqueueWithItems()` so large operations are split into compliant job batches. For commit flows the orchestrator injects `{ photo_id, filename }` records so downstream workers (e.g., `file_removal`) can reconcile job items back to project context even when the job scope is `photo_set`.

## Test Infrastructure Snapshot

Backend suites live alongside routes and repositories (`server/routes/__tests__`, `server/services/__tests__`). They run with Node.js' built-in test runner via `npm test` using serial execution (`--test-concurrency=1`).

- Temporary projects are created under `.projects-test/user_0/` and cleaned with `createFixtureTracker()` to ensure isolation
- SQLite test database lives at `.db/photo_manager.test.db` with WAL mode enabled; cleanup performs `wal_checkpoint(TRUNCATE)` before deletion
- Authentication helpers (`withAuthEnv`, `issueAccessToken`) provide isolated JWT/bcrypt material for suites
- Express harness helper `createTestServer()` wires up admin auth middleware, orchestrator stubs, and fixture cleanup for API suites
- Bulk suites stub `tasksOrchestrator.startTask` + `jobsRepo` to capture payloads without running workers
- Coverage tooling: `npm run test:coverage` (HTML + text) and `npm run test:coverage:ci` (text-summary) wrap the runner with c8 instrumentation.
- Full guidance (running tests, helper catalog, coverage expectations, CI behavior) lives in `project_docs/TESTING_OVERVIEW.md`

The SQLite database is located at `.db/user_0.sqlite` (separate from project content) and is automatically created on first run. Projects are stored in `.projects/user_0/<project_folder>/` with user-scoped isolation.

---

## Related Documentation

- `./PROJECT_OVERVIEW.md` — Architecture, core concepts, and development workflow
- `./JOBS_OVERVIEW.md` — Job catalog, task definitions, and workflow compositions
- `./SECURITY.md` — Security implementation and best practices
- `../README.md` — Quick start guide and API reference
