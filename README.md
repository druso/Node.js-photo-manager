# Node.js Photo Manager

A modern web-based photo management application designed for photographers. Upload, organize, and view your photos with automatic thumbnail generation, tagging, and project-based organization.

## What is this?

This application helps photographers manage their photo collections by:
- **Organizing photos into projects** (shoots, events, albums)
- **Supporting multiple formats** (JPG, PNG, TIFF, RAW files like CR2, NEF, ARW, DNG)
- **Automatic processing** (thumbnail and preview generation)
- **Tagging system** for easy organization and searching
- **Keep/discard workflow** for managing RAW+JPG pairs
- **Real-time progress tracking** for background

## Technology

- **Frontend**: React with Vite and Tailwind CSS
  - **Highly Optimized Architecture**: Main App.jsx reduced from ~2,350 to 1,021 lines (57% reduction) through systematic extraction
  - **Modular Hook System**: 20+ specialized React hooks for separation of concerns and reusability
  - **Component Extraction**: Modular UI components (MainContentRenderer, CommitRevertBar, SortControls, etc.)
  - **Layout Stability**: Fixed header positioning and horizontal scroll prevention for optimal UX
- Tailwind CSS v4 note: deprecated `bg-opacity-*` utilities have been migrated to the new alpha color syntax (e.g., `bg-black/40`). If you add new styles, prefer `color/opacity` notation over legacy opacity utilities.
- **Backend**: Node.js with Express and SQLite
- **Image Processing**: Sharp library for high-performance processing
- **Project folders**: canonical format `p<id>` (immutable). See `server/utils/projects.js` for `makeProjectFolderName()`, `isCanonicalProjectFolder()`, and `parseProjectIdFromFolder()`.
- **Modular Architecture**: Both frontend and backend use modular architecture:
  - **Frontend**: Specialized hooks, services, and components for maintainability
  - **Backend**: Repository layer optimized into focused modules (photosRepo.js delegates to specialized photoCrud, photoFiltering, photoPagination, photoPendingOps, and photoQueryBuilders modules)

## API Quick Reference

- **Projects**
  - `GET /api/projects` — list
  - `POST /api/projects` — create
  - `PATCH /api/projects/:id` — rename (display name only)
  - `DELETE /api/projects/:folder` — archive and queue deletion task (folder is canonical `p<id>`)
- **Project details**
  - `GET /api/projects/:folder` — metadata
  - `GET /api/projects/:folder/photos` — paginated photos
    - Query: `?limit&cursor&before_cursor&sort=filename|date_time_original|created_at|updated_at&dir=ASC|DESC&date_from&date_to&file_type&keep_type&orientation`
    - Returns: `{ items, total, unfiltered_total, nextCursor, prevCursor, limit, sort, dir }`
- **Uploads & Processing**
  - `POST /api/projects/:folder/analyze-files` — analyze files for conflicts before upload
    - Returns: `{ imageGroups, conflicts, completion_conflicts, summary }`
    - Detects: duplicates within project, cross-project conflicts, format completion conflicts
  - `POST /api/projects/:folder/upload` — upload files
    - Flags (multipart fields parsed as strings "true"/"false", default false):
      - `overwriteInThisProject` — overwrite existing files in the same project
      - `reloadConflictsIntoThisProject` — detect cross‑project conflicts and enqueue `image_move` into `:folder`
  - `POST /api/projects/:folder/process` — queue derivative generation
- **Assets**
  - `GET /api/projects/:folder/thumbnail/:filename` — thumbnail (public)
  - `GET /api/projects/:folder/preview/:filename` — preview (public)
  - `POST /api/projects/:folder/download-url` — mint signed URL
  - `GET /api/projects/:folder/file/:type/:filename` — download original (token)
  - `GET /api/projects/:folder/files-zip/:filename` — download ZIP (token)
- **Realtime Jobs**
  - `GET /api/jobs/stream` — SSE stream
  - `GET /api/jobs` — list jobs (admin/dev)

- **All Photos (cross-project)**
  - `GET /api/photos` — paginated list across all non-archived projects
    - Query: `?limit&cursor&before_cursor&date_from&date_to&file_type&keep_type&orientation&tags&include=tags`
      - `limit`: default 200, max 300
      - `file_type`: `any|jpg_only|raw_only|both`
      - `keep_type`: `any|any_kept|jpg_only|raw_jpg|none`
      - `orientation`: `any|vertical|horizontal`
      - `tags`: comma-separated list of tags to filter by (e.g., `portrait,-rejected`)
      - `include=tags`: optionally include tag names for each photo
    - Returns: `{ items, total, unfiltered_total, next_cursor, prev_cursor, limit, date_from, date_to }`
    - Headers: `Cache-Control: no-store`
  - `GET /api/photos/locate-page` — locate and return the page that contains a specific photo
    - Required: `project_folder`, and one of `filename` (with extension) or `name` (basename)
    - Optional: `limit(1-300)`, `date_from`, `date_to`, `file_type`, `keep_type`, `orientation`, `tags`, `include=tags`
    - Returns: `{ items, position, page_index, idx_in_items, next_cursor, prev_cursor, target, limit, date_from?, date_to? }`
    - Notes: 404 if not found/filtered out; 409 if basename is ambiguous; Cache-Control: `no-store`; rate limit: 60 req/min per IP

- **Image-scoped Endpoints (Universal)**
  - `POST /api/photos/tags/add` — add tags to photos by photo_id
    - Body: `{ items: [{ photo_id: number, tags: string[] }], dry_run?: boolean }`
    - Returns: `{ updated: number, errors?: [...], dry_run?: {...} }`
  - `POST /api/photos/tags/remove` — remove tags from photos by photo_id
    - Body: Same shape as add endpoint
    - Returns: Same shape as add endpoint
  - `POST /api/photos/keep` — update keep flags for photos by photo_id
    - Body: `{ items: [{ photo_id: number, keep_jpg?: boolean, keep_raw?: boolean }], dry_run?: boolean }`
    - Returns: `{ updated: number, errors?: [...], dry_run?: {...} }`
    - Behavior: Updates keep flags and emits SSE events
  - `POST /api/photos/process` — process derivatives for photos by photo_id
    - Body: `{ items: [{ photo_id: number }], dry_run?: boolean, force?: boolean }`
    - Returns: `{ message: 'Processing queued', job_count: number, job_ids: [...], errors?: [...] }`
    - Status: 202 Accepted
  - `POST /api/photos/move` — move photos to a different project by photo_id
    - Body: `{ items: [{ photo_id: number }], dest_folder: string, dry_run?: boolean }`
    - Returns: `{ message: 'Move queued', job_count: number, job_ids: [...], destination_project: {...}, errors?: [...] }`
    - Status: 202 Accepted

## Quick Start

### Prerequisites
- **Node.js v22 LTS** (required)
- **npm v10+**
- Recommended: **nvm** (Node Version Manager). This repo includes `.nvmrc` set to `22`.

### Installation & Setup

1. **Use Node 22 with nvm (recommended)**:
   ```bash
   # one-time install (if not installed)
   curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
   export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
   
   # per-shell usage in this repo
   nvm install   # reads .nvmrc (22)
   nvm use
   node -v && npm -v
   ```

2. **Install dependencies**:
   ```bash
   npm install
   cd client && npm install && cd ..
   ```

3. **Configure the application**:
   ```bash
   cp config.default.json config.json
   # Edit config.json if needed (optional for basic usage)
   ```

4. **Start the application** (requires 2 terminals):
   
   **Terminal 1 - Backend Logs**: Structured JSON lines from `npm run dev`. Pipe to `jq` for readability:
   ```bash
   npm run dev 2>&1 | jq -r '.'
   ```
   
   **Terminal 2 - Frontend**:
   ```bash
   cd client && npm run dev
   ```

5. **Open your browser** to `http://localhost:5173`

### First Steps
1. Create a new project
2. Upload some photos (drag & drop or click to select)
3. Watch thumbnails generate automatically
4. Add tags and organize your photos

### Production Build
```bash
npm run build  # Builds frontend to client/dist/
```
This project uses **Vite 7** on the client. The Docker image copies `client/dist/` into `public/` so the backend can serve it.
Tip: In development, the Vite dev server runs on `5173`; the backend runs on `5000`.

## Key Features

- **Project-based Organization**: Group photos by shoot, event, or any logical grouping
- **Multi-format Support**: JPG, PNG, TIFF, and RAW files (CR2, NEF, ARW, DNG)
- **Automatic Processing**: Background thumbnail and preview generation
- **Tagging System**: Add custom tags for easy organization
- **Keep/Discard Workflow**: Manage RAW+JPG pairs efficiently
- **Real-time Updates**: Live progress tracking for all background tasks
  - The client uses a singleton `EventSource` (see `client/src/api/jobsApi.js → openJobStream()`) shared across UI consumers to avoid multiple parallel connections and 429s from the server's per‑IP cap.
  - SSE events reconcile keep flag changes immediately. The client normalizes filenames (strips known photo extensions) so updates apply whether the DB stored filenames with or without extensions.
- **Robust Lazy-loading Grid**: Smooth thumbnail loading with no random blanks
  - The photo grid uses a single `IntersectionObserver` with a small positive root margin and a short dwell to avoid flicker.
  - It rebinds observation when DOM nodes change across re-renders and uses a ref-backed visibility set to avoid stale-closure misses.
  - Diagnostics: enable `localStorage.setItem('debugThumbs','1')` to log thumbnail load/retry/fail events from `client/src/components/Thumbnail.jsx`.
  - Developer note: the UI employs a windowed pager (`client/src/utils/pagedWindowManager.js`) with bidirectional keyset pagination (`cursor`/`before_cursor`) and head/tail eviction. Server responses include `total` and `unfiltered_total` so the UI can render "filtered of total" consistently across All Photos and Project views. `useProjectPagination()` / `useAllPhotosPagination()` strip `"any"` sentinel filter values before calling the APIs and expose `mutatePagedPhotos()` / `mutateAllPhotos()` to keep optimistic updates in sync.

### Deep-linking and Viewer Anchoring

- URLs are the source of truth for the open viewer target. Supported formats:
  - All Photos: `/all/:projectFolder/:name` where `:name` is basename without extension.
  - Project view: `/:projectFolder/:name` (basename without extension).
- The client resolves deep links efficiently using `GET /api/photos/locate-page` which returns the page containing the target and `idx_in_items`.
- The viewer opens at the exact `idx_in_items` and the virtualized grid centers that row using an anchor index.
- If locate-page fails (404/409 or filtered out), the client falls back to sequential pagination until the target photo is present in the window.
- Pending delete totals in All Photos mode come from `listAllPendingDeletes()` so the commit/revert toolbar reflects the true cross-project totals even when the grid is filtered.
- Basename resolution is tolerant: the backend deterministically handles extension/case differences and filter inclusion.
- During deep-link resolution, URL updates are temporarily suppressed to avoid premature route changes; normal URL updates resume after the viewer stabilizes.
- **Drag & Drop Upload**: Intuitive file upload interface
- **Keyboard Shortcuts**: Fast navigation and actions
- **Secure Asset Serving**: Signed URLs for photo access; destructive endpoints are rate-limited
  - Originals resolution is case-insensitive with a constrained scan fallback: the server first tries exact-case candidates, then scans the project folder to match the base name against allowed extensions (e.g., `.jpg`/`.jpeg` or RAW sets). This prevents 404s when on‑disk extensions or casing differ (e.g., `.JPG`).

### Session-only UI State

- The client persists UI state only for the duration of a browser tab session using a single `sessionStorage` key `session_ui_state`.
- Persisted within session: window scroll (`windowY`) and main list scroll (`mainY`). Viewer state is no longer persisted; the URL is the single source of truth for deep links and current photo.
- Restore uses a resilient retry loop.
- State is cleared only when switching to a different project during the same session. Initial project selection after a reload does not clear it.
- Legacy per-project `localStorage` APIs and migrations were removed. Use `client/src/utils/storage.js → getSessionState()/setSessionState()/clearSessionState()` and helpers `setSessionWindowY()`, `setSessionMainY()`.

## Maintenance

- Background maintenance keeps disk and database in sync via a unified hourly `maintenance` task per project, which encapsulates: `trash_maintenance` (100), `manifest_check` (95), `folder_check` (95), `manifest_cleaning` (80).
- Manual reconciliation: `POST /api/projects/:folder/commit-changes` moves non‑kept files to `.trash` and enqueues the reconciliation steps. See the canonical jobs catalog in `JOBS_OVERVIEW.md`.
- Worker pipeline uses two lanes: a priority lane (maintenance, deletion) and a normal lane. Keys: `pipeline.priority_lane_slots`, `pipeline.priority_threshold`. See details in `PROJECT_OVERVIEW.md`.

## Common Issues

**Port 5000 already in use**:
```bash
lsof -i :5000 -t | xargs -r kill
```

**Frontend cache issues**:
```bash
rm -rf client/node_modules/.vite
cd client && npm run dev
```

**Node.js version issues**: Ensure you're using Node.js v22 LTS

## Environment Variables

- **`REQUIRE_SIGNED_DOWNLOADS`** (default: `true`) - Controls token verification for file downloads
- File acceptance is centralized in `server/utils/acceptance.js` and driven by `config.json` → `uploader.accepted_files` (extensions, mime_prefixes)
- **`DOWNLOAD_SECRET`** - HMAC secret for signed URLs (change in production)
- **`ALLOWED_ORIGINS`** - Comma-separated list of allowed CORS origins (e.g. `http://localhost:3000,https://app.example.com`).
- **`THUMBNAIL_RATELIMIT_MAX`**, **`PREVIEW_RATELIMIT_MAX`**, **`IMAGE_RATELIMIT_MAX`**, **`ZIP_RATELIMIT_MAX`** - Asset rate limits (per IP per minute); see `config.json` → `rate_limits` for defaults.

### Logging

- Backend uses structured JSON logs via `server/utils/logger2.js`. Levels: `error`, `warn`, `info`, `debug`.
- Each entry includes component (`cmp`), event (`evt`), and context (e.g., `project_id`, `project_folder`, `project_name`).
- **`LOG_LEVEL`** (default: `info`) controls verbosity.
- SSE limits for DoS hardening:
  - **`SSE_MAX_CONN_PER_IP`** (default: `2`)
  - **`SSE_IDLE_TIMEOUT_MS`** (default set in code)

#### Asset Rate Limits (per IP per minute)

- These have config defaults in `config.json → rate_limits` and can be overridden via env:
  - `THUMBNAIL_RATELIMIT_MAX` (default 600)
  - `PREVIEW_RATELIMIT_MAX` (default 600)
  - `IMAGE_RATELIMIT_MAX` (default 120) — applies to originals endpoints
  - `ZIP_RATELIMIT_MAX` (default 30)
  - See implementation in `server/routes/assets.js` and defaults in `config.default.json`.

### Dev tips for SSE 429s

- The client implements a global SSE singleton that survives Vite HMR via `globalThis/window`. If you still see transient 429s during hot reloads:
  - Close duplicate browser tabs and hard-refresh the active one.
  - Optionally raise `SSE_MAX_CONN_PER_IP=3` locally during development.
  - Check the server logs for active connection counts in `server/routes/jobs.js`.

See [SECURITY.md](SECURITY.md) for detailed security configuration.

### Config merging behavior

- On boot and on `POST /api/config`, the server merges missing keys from `config.default.json` into your `config.json` and persists them (see `server/services/config.js`).
- This keeps `config.json` up-to-date with new defaults; if you track `config.json` in backups or audits, expect benign key additions over time.

## Documentation

- **[PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)** - Comprehensive developer guide with architecture, API details, and development workflow
- **[SCHEMA_DOCUMENTATION.md](SCHEMA_DOCUMENTATION.md)** - Database schema and data structure details
- **[SECURITY.md](SECURITY.md)** - Security implementation and best practices
  - Note: see “Notes for Security Analysis Team” re: maintenance jobs and `.trash` handling
- **[JOBS_OVERVIEW.md](JOBS_OVERVIEW.md)** - Job types, options, and how file upload/maintenance/commit flows use them
- Tip: File type acceptance helper lives in `server/utils/acceptance.js`; destructive endpoints (project rename/delete, commit/revert) are rate limited (10 req/5 min/IP)

Logging v2: All backend routes/workers use the structured logger. See `PROJECT_OVERVIEW.md` → Logging for details.

## Contributing

For development setup, architecture details, API documentation, and contribution guidelines, see [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md).

## Containerization

This repo includes production-ready container packaging.

**Build image**:

```bash
docker build -t nodejs-photo-manager:local .
```

**Run with Docker**:

```bash
docker run --rm -it \
  -p 5000:5000 \
  -e NODE_ENV=production \
  -e PORT=5000 \
  -e ALLOWED_ORIGINS=http://localhost:3000 \
  -e DOWNLOAD_SECRET=dev-change-me \
  -v $(pwd)/.projects:/app/.projects \
  -v $(pwd)/config.json:/app/config.json \
  nodejs-photo-manager:local
```

Open http://localhost:5000

**Run with docker-compose**:

```bash
docker compose up --build
```

See `docker-compose.yml` for environment and volumes.

### Image details

- Multi-stage build on `node:22-bookworm-slim`.
- Installs `libvips` for `sharp` and toolchain for `better-sqlite3`.
- Builds client (`client/dist`) and copies it into `public/` so the backend can serve it.

### Environment variables

- `PORT` (default 5000)
- `ALLOWED_ORIGINS` (comma-separated CORS allowlist)
- `DOWNLOAD_SECRET` (must be strong in production)
- `REQUIRE_SIGNED_DOWNLOADS` (default true)
- `SSE_MAX_CONN_PER_IP`, `SSE_IDLE_TIMEOUT_MS`

### Volumes

- `.projects` persisted to keep user data outside the container
- `config.json` bind-mounted for runtime configuration

### Production notes

- Set a strong `DOWNLOAD_SECRET` and strict `ALLOWED_ORIGINS`.
- Prefer running as a non-root user (image defaults to `node`).
- Optionally enable read-only root FS and tmpfs for `/tmp`.
- Frontend can be served by the Node app or a reverse proxy; expose port 5000.
