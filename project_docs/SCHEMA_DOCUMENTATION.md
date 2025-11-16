# Data Schema Documentation

## Overview

This project treats the on-disk folder as the primary source of truth for photo availability. The SQLite database mirrors disk state for fast queries, and the frontend derives UI state from the DB.

**Order of truth**: Folder (disk) → SQL (DB) → Frontend (UI)

## SQLite Schema

### Core Tables

**projects**
- Columns: `id` (PK), `project_name`, `project_folder` (UNIQUE), `created_at`, `updated_at`, `status`, `archived_at`, `manifest_version`
- `status='canceled'` = archived/soft-deleted (hidden from UI)
- `project_folder` = sanitized, human-readable folder name with `(n)` suffix for duplicates
- Indexes: `status`, `project_folder`

**photos**
- Columns: `id` (PK), `project_id` (FK), `filename`, `basename`, `ext`, `date_time_original`, `jpg_available`, `raw_available`, `other_available`, `keep_jpg`, `keep_raw`, `thumbnail_status`, `preview_status`, `orientation`, `meta_json`
- Availability flags (`*_available`): reflect actual files on disk
- Keep flags (`keep_*`): user intent, default to availability
- `taken_at := coalesce(date_time_original, created_at)` for ordering/filtering
- Indexes: `filename`, `basename`, `ext`, `date_time_original`, `raw_available`, `orientation`

**tags** + **photo_tags**
- Tags scoped to projects: `(project_id, name)` UNIQUE
- Many-to-many via `photo_tags(photo_id, tag_id)` PK

**jobs** + **job_items**
- Async task queue with `scope` (`project`/`photo_set`/`global`)
- Two-lane priority system (priority lane for jobs ≥ threshold)
- Columns: `id`, `tenant_id`, `project_id` (nullable), `scope`, `type`, `status`, `priority`, `payload_json`, `progress_total`, `progress_done`, `heartbeat_at`
- Indexes: `(status, priority DESC, created_at ASC)`, `(tenant_id, status)`, `(scope, status)`

**public_links** + **photo_public_links**
- Shared galleries with hashed URLs (32-char base64url)
- `public_links(id, title, description, hashed_key, created_at, updated_at)`
- `photo_public_links(photo_id, public_link_id)` PK

**photo_public_hashes**
- Public asset hashes per photo (32-char base64url)
- Columns: `photo_id` (PK/FK), `hash` (UNIQUE), `rotated_at`, `expires_at`
- TTL: 28 days (configurable), rotation: 21 days

**derivative_cache**
- MD5-based caching for derivatives (regenerate only when source changes)
- Columns: `photo_id` (PK), `source_hash`, `source_size`, `thumbnail_meta`, `preview_meta`, `created_at`, `updated_at`

### Repositories

Data access through modular repositories:
- `projectsRepo.js` — Project CRUD
- `photosRepo.js` — Delegates to specialized modules:
  - `photoCrud.js` — Basic CRUD operations
  - `photoFiltering.js` — Filtering, sorting, listing
  - `photoPagination.js` — Pagination logic
  - `photoPendingOps.js` — Pending operations
  - `photoQueryBuilders.js` — SQL WHERE clause construction
- `tagsRepo.js`, `photoTagsRepo.js` — Tagging
- `jobsRepo.js` — Job queue operations
- `publicLinksRepo.js` — Shared link management

## API Endpoints

### Projects

**List/Create**
- `GET /api/projects` → `[{ id, name, folder, created_at, updated_at }, ...]`
- `POST /api/projects` → Create new project

**Project Details**
- `GET /api/projects/:folder` → `{ id, name, folder, photos: [...] }`
- `PATCH /api/projects/:folder/rename` → Update display name (folder aligned by maintenance)
- `DELETE /api/projects/:folder` → Soft-delete + enqueue `project_delete` task

**Project Photos (Paginated)**
- `GET /api/projects/:folder/photos`
- Query params: `limit`, `cursor`, `before_cursor`, `sort`, `dir`, `date_from`, `date_to`, `file_type`, `keep_type`, `orientation`, `tags`, `visibility`, `include=tags`
- Returns: `{ items, total, unfiltered_total, nextCursor, prevCursor }`

### All Photos (Cross-Project)

**List**
- `GET /api/photos`
- Query params: Same as project photos
- Returns: `{ items, total, unfiltered_total, next_cursor, prev_cursor }`
- Default sort: `taken_at DESC, id DESC`

**Locate Photo**
- `GET /api/photos/locate-page`
- Required: `project_folder` + (`filename` or `name`)
- Optional: Same filters as list endpoint
- Returns: `{ items, position, page_index, idx_in_items, next_cursor, prev_cursor, target }`

**Select All Keys**
- `GET /api/photos/all-keys`
- Query params: Same filters as list endpoint
- Returns: `{ keys: string[], total: number }`
- Keys format: `"project_folder::filename"`
- No pagination (returns all matching keys)

**Pending Deletes**
- `GET /api/photos/pending-deletes`
- Query params: `date_from`, `date_to`, `file_type`, `orientation` (ignores `keep_type`)
- Returns: `{ jpg, raw, total, byProject: [...] }`

### Batch Operations (Image-Scoped)

All batch endpoints:
- Max 2,000 items per request
- Support `dry_run=true`
- Return partial failure details

**Tags**
- `POST /api/photos/tags/add` — `{ items: [{ photo_id, tags: [...] }] }`
- `POST /api/photos/tags/remove` — Same shape

**Keep Flags**
- `POST /api/photos/keep` — `{ items: [{ photo_id, keep_jpg?, keep_raw? }] }`

**Processing**
- `POST /api/photos/process` — `{ items: [{ photo_id }], force? }`
- Returns: `{ job_count, job_ids, ... }` (202 Accepted)

**Move**
- `POST /api/photos/move` — `{ items: [{ photo_id }], dest_folder }`
- Returns: `{ job_count, job_ids, destination_project, ... }` (202 Accepted)

### Commit/Revert

**Project-Scoped**
- `POST /api/projects/:folder/commit-changes` — Apply pending deletions
- `POST /api/projects/:folder/revert-changes` — Reset keep flags (non-destructive)

**Global**
- `POST /api/photos/commit-changes` — `{ projects?: [...] }` (optional targeting)
- `POST /api/photos/revert-changes` — `{ projects?: [...] }` (optional targeting)

All commit/revert endpoints rate-limited: 10 req/5 min/IP

### Assets

**Thumbnails/Previews**
- `GET /api/projects/:folder/thumbnail/:filename`
- `GET /api/projects/:folder/preview/:filename`
- Public photos require `?hash=<hash>` for anonymous access
- Admin requests bypass hash check

**Originals**
- `POST /api/projects/:folder/download-url` — Mint signed URL
- `GET /api/projects/:folder/file/:type/:filename` — Download (requires token)
- `GET /api/projects/:folder/image/:filename` — Full-resolution image

### Shared Links

**Admin Endpoints** (require authentication)
- `GET /api/public-links` — List all shared links
- `POST /api/public-links` — Create link (rate limited: 10 req/5 min)
- `GET /api/public-links/:id` — Get link details
- `PATCH /api/public-links/:id` — Update title/description
- `POST /api/public-links/:id/regenerate` — Regenerate hashed key (rate limited: 5 req/5 min)
- `DELETE /api/public-links/:id` — Delete link
- `POST /api/public-links/:id/photos` — Associate photos
- `DELETE /api/public-links/:id/photos/:photoId` — Remove photo

**Public Endpoints** (no authentication)
- `GET /shared/api/:hashedKey` — Get shared link (public photos only, rate limited: 30 req/min)
- `GET /shared/api/:hashedKey/admin` — Get shared link (all photos, requires auth)
- `GET /shared/api/:hashedKey/photo/:photoId` — Get specific photo

### Jobs

- `GET /api/jobs` — List all jobs for tenant
- `GET /api/jobs/:id` — Job details with items summary
- `POST /api/projects/:folder/jobs` — Enqueue task (requires `task_type`)
- `GET /api/tasks/definitions` — Task labels and composed steps

### Real-Time Events

**Unified SSE Endpoint**
- `GET /api/sse/stream?channels=jobs,pending-changes`
- Supports multiple channel subscriptions in single connection
- Event types: `connected`, `job_completed`, `job_started`, `job_failed`, `job_update`, `pending_changes_state`, `item`, `item_removed`, `item_moved`, `manifest_changed`, `folder_renamed`

**Legacy Endpoints** (deprecated but functional)
- `GET /api/jobs/stream` — Job updates only
- `GET /api/sse/pending-changes` — Pending changes only

## Authentication

**Required Environment Variables**:
- `AUTH_ADMIN_BCRYPT_HASH` — Bcrypt hash of admin password
- `AUTH_JWT_SECRET_ACCESS` — 256-bit secret for 1h access tokens
- `AUTH_JWT_SECRET_REFRESH` — 256-bit secret for 7d refresh tokens
- `AUTH_BCRYPT_COST` — Optional (8-14, default 12)

**Endpoints**:
- `POST /api/auth/login` — Password verification, returns JWT + cookies
- `POST /api/auth/refresh` — Rotate access token
- `POST /api/auth/logout` — Clear cookies

**Middleware**: `authenticateAdmin` protects all `/api/*` routes except `/api/auth/*`

**Cookies**:
- `pm_access_token` — HTTP-only, SameSite=Strict, ~1h TTL
- `pm_refresh_token` — HTTP-only, SameSite=Strict, path `/api/auth/refresh`, 7d TTL

## Performance Optimizations

**Prepared Statement Caching** (Sprint 1)
- 92% faster queries (13.39x speedup)
- Centralized cache in `preparedStatements.js`
- 100% hit rate for repeated queries
- Dynamic cache keys for variable WHERE clauses

**Parallel Image Processing** (Sprint 5)
- Worker thread pool with configurable size (default 4)
- `imageProcessingPool.js` manages job distribution
- `imageWorker.js` runs Sharp operations in isolated threads
- MD5-based derivative caching (skip unchanged sources)
- Automatic worker recreation on crash
- Batch processing with per-image error isolation
- 40-50% faster processing, 30-50% lower CPU usage

**HTTP Compression** (Sprint 6)
- Level 6 compression with 1KB threshold
- 60-80% bandwidth reduction on JSON/HTML/CSS/JS
- Smart filtering: excludes already-compressed images (JPEG, PNG, WebP)
- Applies to: API responses, HTML, CSS, JavaScript
- Debug override: `x-no-compression: 1` request header
- Minimal CPU overhead (~2-5% increase)

**Unified SSE** (Sprint 3)
- Single connection per user (was 2-4)
- 75% memory reduction
- HMR-safe client singleton

**Request Batching** (Sprint 4)
- 90%+ fewer API calls for bulk operations
- 50 photos = 1 API call (was 50)
- <1s operation time (was 5-10s)

## Filesystem Layout

**Database**: `.db/user_0.sqlite` (separate from project content)

**Projects**: `.projects/user_0/<project_folder>/`
- `.thumb/` — Thumbnails
- `.preview/` — Previews
- `.trash/` — Temporary removals (24h TTL)
- `.project.yaml` — Manifest (name, id, created_at, version)

**Folder Alignment**: Hourly maintenance task aligns `project_folder` with `project_name` using `generateUniqueFolderName()`. Emits `folder_renamed` SSE event.

## Testing

**Test Infrastructure**:
- Node.js built-in test runner (`npm test`)
- Serial execution (`--test-concurrency=1`)
- Isolation: `.projects-test/user_0/` + `.db/photo_manager.test.db`
- Helpers: `createFixtureTracker()`, `withAuthEnv()`, `createTestServer()`
- Coverage: `npm run test:coverage` (HTML + text)

See `TESTING_OVERVIEW.md` for complete test harness documentation.

## Related Documentation

- **[PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)** — Architecture and core concepts
- **[JOBS_OVERVIEW.md](./JOBS_OVERVIEW.md)** — Job catalog and task definitions
- **[README.md](../README.md)** — Quick start guide
- **[SECURITY.md](../SECURITY.md)** — Security implementation
