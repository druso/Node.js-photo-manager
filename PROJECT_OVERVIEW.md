# Project Overview: Node.js Photo Manager

## 1. Introduction

Welcome to the Node.js Photo Manager! This document provides a comprehensive overview of the project for new developers.

The application is a web-based photo management tool designed for amateur and professional photographers. It provides a simple way to upload, organize, and view photos from shoots. The long-term vision is to evolve this into a multi-user, online platform akin to Google Photos but with a focus on the needs of photo artists.

## 2. Core Concepts

## 2.a UX Principles (Golden Rules)

- Avoid hard refreshes of the photo list. Prefer incremental, in-place updates to preserve user context (scroll position, selection, open viewer). Perform a full refetch only as a last resort.
- Preserve continuity of interaction (don’t disrupt focus/selection unless the action explicitly requires it).
- Minimize flicker and network noise (respect missing states; no probing while pending; cache-bust final images only).

The application is built around a few key concepts:

*   **Projects**: A Project is the primary organizational unit, representing a collection of photos from a single event or shooting session. Think of it as an "album" or a specific shoot. A photo belongs to exactly one Project.

*   **Photo Ingestion**: This is the process of adding photos to the application. Users can drag-and-drop files or use an upload button. The backend analyzes files for conflicts (duplicates within project, cross-project conflicts, and format completion conflicts), presents conflict resolution options to users, then handles file storage, creates database records, and queues up post-processing tasks.

*   **Upload Conflict Handling**: The system provides two main options for handling conflicts during upload: (1) "Skip project duplicates" - when unchecked, existing images in the current project are overwritten; (2) "Move conflicting items into this project" - when enabled, images that exist in other projects are moved to the current project via background image_move tasks. Cross-project conflicts are never uploaded directly but are handled through the move pipeline to maintain data consistency.

*   **List and Viewer**: These are the main UI components for interacting with photos. The "List" view shows thumbnails of photos within a project, and the "Viewer" provides a full-size view of a single selected photo.

*   **Worker Pipeline**: To ensure the UI remains responsive, time-consuming tasks like generating thumbnails and previews are handled asynchronously by a background worker pipeline. The system includes specialized workers for image moves between projects, which update database records, move files and derivatives, and emit real-time SSE events to keep the UI synchronized. This system is designed to be extensible for future processing needs.

*   **Database**: While photo files (originals, raws, previews) are stored on the file system, all their metadata—such as project association, tags, timestamps, and file paths—is stored in a central SQLite database. The frontend application relies on this database for fast access to photo information.

## 3. Technology Stack

The application is built with modern, production-ready technologies:

### Frontend Dependencies
*   **React**: Component-based UI framework
*   **Vite**: Fast build tool and development server
*   **Tailwind CSS**: Utility-first CSS framework for styling
*   **PostCSS**: CSS processing and optimization

### Backend Dependencies
*   **Express.js**: Web application framework for Node.js
*   **better-sqlite3**: High-performance SQLite database driver
*   **Sharp**: High-performance image processing library
*   **Multer**: Middleware for handling multipart/form-data (file uploads)
*   **CORS**: Cross-Origin Resource Sharing middleware
*   **fs-extra**: Enhanced file system operations
*   **exif-parser**: EXIF metadata extraction from images
*   **archiver**: ZIP file creation for bulk downloads

### Development Tools
*   **nodemon**: Auto-restart development server on file changes
*   **Node.js v22**: JavaScript runtime (LTS version required). Use **nvm** with the provided `.nvmrc` (22): `nvm install && nvm use`.
*   **npm v10+**: Package manager

## 4. Architecture Overview

The application follows a classic client-server architecture.

### Frontend (`client/`)

The frontend is a modern single-page application (SPA) responsible for all user interactions.

*   **Technology**: Built with **React** and **Vite** for fast development and building (`vite.config.mjs`). Uses **Tailwind CSS** for styling.
    - Tailwind v4 migration: deprecated `bg-opacity-*` utilities were replaced with alpha color syntax (e.g., `bg-black/40`). Unintended top/bottom borders introduced by default borders were audited and disabled where necessary (e.g., replacing `border-b` with `border-b-0` on sticky headers).
*   **Source Code**: The main application logic resides in `client/src/`.
*   **Entry Point**: The main HTML file is `client/index.html`.
*   **Static Assets**: Public assets like fonts or icons are stored in `client/public/`.
*   **Key Components**: 
    *   `App.jsx`: Main application component with routing and state management
    *   `components/`: Reusable UI components (PhotoGrid, PhotoViewer, etc.)
    *   `api/`: API client modules for backend communication

### Backend (`server/`)

The backend is a Node.js application that exposes a RESTful API for the client.

*   **Technology**: Built with **Node.js** and **Express.js** for routing. Uses **Sharp** for image processing, **better-sqlite3** for database operations, and **Multer** for file uploads.
*   **Entry Point**: The main server file is `server.js`.
*   **API Routes (`server/routes/`)**: This directory defines all the API endpoints. Key files include:
    *   `uploads.js`: Handles file uploads with configurable file type filtering
    *   `projects.js`: Manages project creation, rename, and data retrieval
    *   `assets.js`: Serves photo assets (thumbnails, previews, originals, zip) with signed URLs for originals. All asset responses stream via `fs.createReadStream` and include `Cache-Control` and `ETag` headers enabling 304 revalidation. Originals and zip files are served with rate limiting to prevent abuse.
    *   `jobs.js`: Provides endpoints for the worker pipeline and Server-Sent Events
    *   `tags.js`: Manages photo tagging functionality
    *   `keep.js`: Handles keep/discard decisions for RAW vs JPG files
*   **Business Logic (`server/services/`)**: This directory contains the core application logic:
    *   `db.js`: SQLite database initialization with WAL mode and foreign keys
    *   `repositories/`: Data access layer (projects, photos, tags, jobs)
    *   **Worker Loop**: Background job processor with crash recovery and configuration sanity warnings (e.g., zero normal-lane slots)
    *   `workers/`: Individual worker implementations (derivatives generation)
    *   `events.js`: Event emitter for real-time job updates
*   **Utilities (`server/utils/`)**: Contains helper functions used across the backend.
    - File acceptance is centralized in `server/utils/acceptance.js` and driven by `config.json → uploader.accepted_files` (extensions, mime_prefixes).

#### Logging

- Backend logging is centralized via `server/utils/logger2.js` producing structured JSON lines.
- All routes, services, and workers log events with component (`cmp`), event (`evt`), and rich context (e.g., `project_id`, `project_folder`, `project_name`, `job_id`).
- Levels: `error`, `warn`, `info`, `debug`. Controlled by `LOG_LEVEL` (default `info`).
- Example event keys: `upload_failed`, `project_delete_failed`, `list_jobs_failed`, `config_sanity_normal_lane_zero`.

#### Project Folders (Fresh Start)

Projects are stored on disk under `<repoRoot>/.projects/<project_folder>/` where `project_folder` is always of the form `p<id>` (immutable and decoupled from the display name). Duplicate human names are allowed; uniqueness is enforced by `project_folder`. The numeric `id` is returned by all project APIs and should be used for renames; the folder never changes.
Filename normalization for asset endpoints preserves non-image suffixes (e.g., `.com` in `manage.kmail-lists.com`) and strips only known image/raw extensions (`jpg`, `jpeg`, `raw`, `arw`, `cr2`, `nef`, `dng`). Derivatives are named `<base>.jpg` in `.thumb/` and `.preview/`.

Utilities: see `server/utils/projects.js` for `makeProjectFolderName()`, `isCanonicalProjectFolder()`, and `parseProjectIdFromFolder()`.

On creation, the server ensures these subdirectories exist:
- `.thumb` for thumbnails
- `.preview` for previews
- `.trash` for temporary removals

### Database

The application uses **SQLite** with better-sqlite3 for data storage, providing ACID compliance and excellent performance for this use case.

*   **Core Tables**: `projects`, `photos`, `tags`, `photo_tags` (many-to-many)
*   **Job System**: `jobs` and `job_items` tables power the async worker pipeline
*   **Features**: WAL mode enabled, foreign key constraints, comprehensive indexing
*   **Storage**: Uses SQLite with WAL mode for ACID compliance and performance
*   **Data Access**: Repository pattern with dedicated modules in `server/services/repositories/`

Refer to `SCHEMA_DOCUMENTATION.md` for detailed table structures and relationships.

## 5. Key Features

### Photo Management
*   **Multi-format Support**: Handles JPG, PNG, TIFF, and various RAW formats (CR2, NEF, ARW, DNG)
*   **Project Organization**: Photos are organized into projects (albums/shoots)
*   **Metadata Extraction**: Automatic EXIF data parsing for timestamps, camera settings, etc.
*   **Keep/Discard System**: Deterministic handling of RAW+JPG pairs. By default, `keep_jpg` and `keep_raw` mirror actual file availability and are automatically realigned during uploads and post‑processing. Users can change intent and later Commit or Revert.
  - Preview Mode filters (`File types to keep`) now match only photos where keep flags are explicitly set: `any_kept` means `keep_jpg === true || keep_raw === true`; `none` means both flags are explicitly `false`.

### Image Processing
*   **Automatic Thumbnails**: Generated asynchronously for fast grid viewing
*   **Preview Generation**: High-quality previews for detailed viewing
*   **Configurable Quality**: Thumbnail and preview settings in configuration
*   **Orientation Handling**: Proper rotation based on EXIF orientation data

### User Interface
*   **Drag & Drop Upload**: Intuitive file upload with progress tracking
*   **Grid and Table Views**: Multiple viewing modes for photo browsing
*   **Full-screen Viewer**: Detailed photo viewing with zoom and navigation
*   **Keyboard Shortcuts**: Comprehensive keyboard navigation (see configuration)
    - Viewer behavior: planning a delete (keep none) no longer auto-advances; the viewer stays on the current image and shows a toast. When filters change the visible list, the current index is clamped to a valid photo instead of closing.
 *   **Real-time Updates**: Live job progress via Server-Sent Events
*   **Incremental Thumbnails (SSE)**: Pending thumbnails update via item-level SSE events; no client-side probing of asset URLs
  - Client requests encode both `:folder` and `:filename` to avoid failures with spaces/special characters (see `client/src/components/Thumbnail.jsx`).
  - Resilience: the thumbnail image performs one retry with a short cache-busting param when a load error occurs. If debug is enabled, it logs load/retry/fail events to the console.
  - Dev toggle for diagnostics: `localStorage.setItem('debugThumbs','1')` (or set `window.__DEBUG_THUMBS = true`) and reload to see `[thumb]` logs in DevTools.
*   **Lazy Loading (IntersectionObserver)**: The photo grid uses a single `IntersectionObserver` with a slight positive `rootMargin` and a short dwell to avoid flicker. Observation is rebound if a cell's DOM node changes across re-renders, and a ref‑backed visibility set prevents stale-closure misses. This eliminates random blank thumbnails while scrolling and reduces request bursts.
*   **Incremental Updates**: The grid updates incrementally to preserve context and avoid disruptive reloads.
*   **Optimistic Updates**: Keep/Tag/Revert/Commit actions update the UI immediately without a full data refetch, preserving browsing context.
*   **Scroll Preservation**: Grid/table and viewer preserve scroll position and context during incremental updates. Selection is maintained unless an action explicitly clears it.
*   **Layout Stability**: Thumbnail cells use constant border thickness; selection changes only color/ring, avoiding micro layout shifts that can nudge scroll.
 *   **Grid Lazy-Load Reset Policy**: The grid’s visible window only resets when changing projects (or lazy threshold), not on incremental data updates.
 *   **Scroll/Viewer Preservation**: Window/main scroll and open viewer are preserved across background refreshes and fallback refetches.
*   **Filter Panel UX**: The filters panel includes bottom actions: a gray "Close" button to collapse the panel, and a blue "Reset" button that becomes enabled only when at least one filter is active. Buttons share the full width (50% each) for clear mobile ergonomics.
*   **Filters Layout**: Within the panel, filters are organized for quicker scanning:
    - Row 0 (full width): Text search with suggestions
    - Row 1: Date taken (new popover range picker with two months + presets), Orientation
    - Row 2: File types available, File types to keep
  The date range picker is a single trigger button that opens a dual‑month popover with quick‑select presets (Today, Last 7 days, This month, etc.).

#### Session‑only UI State Persistence

*   **What persists within the tab session**: window scroll (`windowY`) and main list scroll (`mainY`). Stored under a single `sessionStorage` key: `session_ui_state`.
*   **Viewer state removed**: Viewer state (open/closed, current photo) is no longer persisted in session storage. The URL is the single source of truth for viewer state to prevent conflicts with deep linking.
*   **Restore behavior**: On reload, scroll positions are restored using a retry loop to account for layout timing.
*   **Reset behavior**: Session UI state is cleared only when switching to a different project during the same session. Initial project selection after a reload does not clear it.
*   **Removed legacy APIs**: Per‑project `localStorage` keys (e.g., `app_state::<folder>`) and their migration helpers were removed. Use `client/src/utils/storage.js → getSessionState()/setSessionState()/clearSessionState()` and the small helpers `setSessionWindowY()`, `setSessionMainY()`.

### Tagging System
*   **Flexible Tagging**: Add custom tags to photos for organization
*   **Tag Management**: Create, edit, and delete tags
*   **Many-to-many Relationships**: Photos can have multiple tags

### Background Processing
*   **Async Job Pipeline**: Non-blocking image processing
*   **Job Status Tracking**: Real-time progress monitoring
*   **Crash Recovery**: Automatic restart of failed jobs
*   **Extensible Workers**: Easy to add new processing tasks
*   **Deletion as Task**: Project deletion is handled via a high‑priority task (`project_delete`) to ensure fast cleanup and safe ordering.
*   **Archived Folder Scavenge**: A separate `project_scavenge` task runs for archived projects to remove leftover on‑disk folders if any remain after deletion.

### Security
*   **Signed URLs**: Secure access to photo assets with expiration
*   **File Type Validation**: Centralized server-side filtering via `server/utils/acceptance.js` (config-driven)
*   **CORS Protection**: Configurable cross-origin access controls
*   **Rate Limiting**:
    - Destructive endpoints (project rename/delete, commit/revert): 10 requests per 5 minutes per IP
    - Asset endpoints (configurable via `config.json → rate_limits`, with env overrides):
      - Thumbnails: default 600 rpm/IP (env: `THUMBNAIL_RATELIMIT_MAX`)
      - Previews: default 600 rpm/IP (env: `PREVIEW_RATELIMIT_MAX`)
      - Originals (`GET /file/:type/:filename`, `GET /image/:filename`): default 120 rpm/IP (env: `IMAGE_RATELIMIT_MAX`)
      - ZIP (`GET /files-zip/:filename`): default 30 rpm/IP (env: `ZIP_RATELIMIT_MAX`)
    - Implementation in `server/routes/assets.js`; defaults defined in `config.default.json`.

Refer to `SECURITY.md` for detailed security implementation and best practices.

## 6. Key Workflows

### Photo Ingestion Flow

1.  **Upload**: The user uploads one or more image files via the client UI.
2.  **API Request**: The client sends the files to the `/api/uploads` endpoint on the server.
3.  **File Storage**: The server saves the original files to a designated storage location defined in the configuration.
4.  **Database Entry**: The server creates records for the new photos in the database, associating them with a project.
5.  **Job Queuing**: A new job is created and added to the `jobs` table in the database (e.g., `generate_previews`).

### Worker Pipeline Flow

1.  **Job Polling**: The `workerLoop.js` service periodically polls the `jobs` table for new, unprocessed jobs.
2.  **Job Execution**: When a new job is found, the worker executes the corresponding task (e.g., the thumbnail generation worker is called).
    - The pipeline has two lanes. Deletion steps run with priority ≥ threshold so they claim priority slots and run ahead of normal jobs.
3.  **Processing**: The worker generates the required assets (e.g., a JPEG preview and a smaller thumbnail) and saves them to the appropriate directory.
4.  **Update Database**: The paths to the newly generated assets are saved in the photo's database record.
5.  **Job Completion**: The job is marked as `completed` in the `jobs` table.

### Project Deletion Flow

1.  **UI Request**: The user initiates project deletion from the client UI.
2.  **API Request**: The client sends a `DELETE` request to the `/api/projects/:folder` endpoint on the server.
3.  **Soft Deletion**: The server sets the project status to `canceled` and archives it.
4.  **Job Queuing**: A new high-priority job (`project_delete`) is created and added to the `jobs` table in the database.
5.  **Worker Processing**: The worker executes the `project_delete` job, which includes the following steps:
    - `project_stop_processes`: Stops any ongoing processes for the project.
    - `project_delete_files`: Deletes the project files from the file system.
    - `project_cleanup_db`: Cleans up the project's database records.

### Maintenance Processes

Maintenance tasks keep the on‑disk state and the database in sync. They are implemented as high‑priority, idempotent jobs handled by the same worker loop.

Job types:

- `trash_maintenance`: Remove files in `.trash` older than 24h.
- `manifest_check`: Verify DB availability flags (`jpg_available`, `raw_available`) against files on disk and fix discrepancies.
- `folder_check`: Scan the project folder for untracked files; enqueue `upload_postprocess` only for newly discovered bases (not already present in the manifest); move unaccepted files to `.trash`.
  - `manifest_cleaning`: Delete rows where both JPG and RAW are unavailable. Emits `item_removed` events for per-item UI reconciliation.
  - `project_stop_processes`: High‑priority step that marks a project archived (`status='canceled'`) and cancels queued/running jobs.
  - `project_delete_files`: High‑priority step that deletes the project folder from `.projects/<project_folder>/`.
  - `project_cleanup_db`: Cleans related DB rows (`photos`, `tags`, `photo_tags`) while retaining the archived `projects` row for audit.

### Image Move Workflow

- Overview: Move selected images from their current project to a destination project while preserving derivatives when available and regenerating when missing.
- API entry (tasks-only): `POST /api/projects/:folder/jobs` with body `{"task_type":"image_move","items":["<base1>","<base2>"]}` where `:folder` is the destination (e.g., `p3`).
- Composition (see `server/services/task_definitions.json` → `image_move.steps`):
  1) `image_move_files` (95) — `server/services/workers/imageMoveWorker.js`
  2) `manifest_check` (95)
  3) `generate_derivatives` (90) if needed
- Behavior of `image_move_files`:
  - Moves originals (case-insensitive through known extensions) and any existing derivatives (`.thumb/<base>.jpg`, `.preview/<base>.jpg`).
  - Updates DB (`photosRepo.moveToProject()`), aligns derivative statuses to `generated` when a derivative moved, or `pending` when it must be regenerated (`not_supported` for RAW).
  - Emits SSE:
    - `item_removed` from the source project
    - `item_moved` in the destination with `thumbnail_status`/`preview_status`
  - Enqueues a `manifest_check` for the source project to reconcile leftovers.
- Uploads integration: `POST /api/projects/:folder/upload` with multipart field `reloadConflictsIntoThisProject=true` will auto-start `image_move` into `:folder` for uploaded bases that exist in other projects (see `server/routes/uploads.js`).
- See also: `JOBS_OVERVIEW.md` → Image Move for API and SSE details.

Scheduler (`server/services/scheduler.js`) cadence:

- Hourly kickoff of the unified `maintenance` task for active (non‑archived) projects only. This task encapsulates:
  - `trash_maintenance` (priority 100)
  - `manifest_check` (95)
  - `folder_check` (95)
  - `manifest_cleaning` (80)
- Hourly kickoff of `project_scavenge` for archived projects to remove any leftover `.projects/<project_folder>/` directories.
  See `server/services/scheduler.js` and the canonical jobs catalog in `JOBS_OVERVIEW.md`.

Manual reconciliation endpoints:

- `POST /api/projects/:folder/commit-changes`
  - Moves non‑kept files to `.trash` based on `keep_jpg`/`keep_raw` flags
  - Deletes generated derivatives for JPGs moved to `.trash` (removes `.thumb/<base>.jpg` and `.preview/<base>.jpg` immediately)
  - Updates DB availability flags accordingly
  - Enqueues reconciliation jobs (`manifest_check`, `folder_check`, `manifest_cleaning`) as defined in the canonical jobs catalog (`JOBS_OVERVIEW.md`)
  - Emits incremental SSE (`item_removed`, `manifest_changed` with `removed_filenames`) for UI reconciliation
  - See implementation in `server/routes/maintenance.js`
- `POST /api/projects/:folder/revert-changes`
  - Non‑destructive. Resets `keep_jpg := jpg_available` and `keep_raw := raw_available` for all photos in the project.
  - Clears any pending destructive actions without moving files.
  - See implementation in `server/routes/maintenance.js`

Client behavior after reconciliation endpoints:

- After a successful `POST /revert-changes`, the client optimistically updates in-memory photo state to set `keep_jpg`/`keep_raw` from availability, avoiding a full refetch and preserving scroll/selection.
- After a successful `POST /commit-changes`, the UI updates incrementally and avoids disruptive full-list reloads.

## 7. Getting Started

### Prerequisites
*   **Node.js v22 LTS** (required - check with `node --version`)
*   **npm v10+** (check with `npm --version`)
*   **Git** (for cloning and version control)

### Step-by-Step Setup

1.  **Clone and Navigate**:
    ```bash
    git clone <repository-url>
    cd Node.js-photo-manager
    ```

2.  **Install Backend Dependencies**:
    ```bash
    npm install
    ```

3.  **Install Frontend Dependencies**:
    ```bash
    cd client
    npm install
    cd ..
    ```

4.  **Configuration Setup**:
    ```bash
    cp config.default.json config.json
    ```
    Edit `config.json` to customize:
    - File storage paths
    - Database location (auto-created)
    - Upload file type restrictions
    - Processing settings

5.  **Database Initialization**:
    The SQLite database is automatically created on first run. No manual migration needed.

6.  **Start Development Servers**:
    
    **Terminal 1 - Backend**:
    ```bash
    npm run dev  # Auto-restart on changes
    # or npm start for production mode
    ```
    Backend runs on `http://localhost:5000`
    
    **Terminal 2 - Frontend**:
    ```bash
    cd client
    npm run dev
    ```
    Frontend runs on `http://localhost:5173`

7.  **Verify Setup**:
    - Open `http://localhost:5173` in your browser
    - Create a new project
    - Upload a test image
    - Check that thumbnails generate automatically

### Build for Production
```bash
npm run build  # Builds client to client/dist/
```

## 8. Configuration

The application's behavior is controlled by the `config.json` file (not in source control).

### Key Configuration Sections

#### File Upload Settings
```json
"uploader": {
  "accepted_files": {
    "extensions": ["jpg", "jpeg", "png", "tif", "tiff", "raw", "cr2", "nef", "arw", "dng"],
    "mime_prefixes": ["image/"]
  }
}
```

#### Image Processing
```json
"processing": {
  "thumbnail": { "maxDim": 200, "quality": 80 },
  "preview": { "maxDim": 6000, "quality": 80 }
}
```

#### Worker Pipeline
```json
"pipeline": {
  "max_parallel_jobs": 1,
  "max_parallel_items_per_job": 1,
  "heartbeat_ms": 1000,
  "stale_seconds": 60,
  "max_attempts_default": 3,
  "priority_lane_slots": 1,
  "priority_threshold": 90
}
```

- The worker loop runs two lanes: a priority lane (jobs with `priority >= priority_threshold`) and a normal lane. Priority lane has its own slots (`priority_lane_slots`) so lightweight maintenance jobs are not blocked by long-running normal jobs.

#### Keyboard Shortcuts
```json
"keyboard_shortcuts": {
  "next_photo": "ArrowRight",
  "prev_photo": "ArrowLeft",
  "zoom_in": "=",
  "zoom_out": "-",
  "view_grid": "g",
  "view_table": "t",
  "toggle_filters": "f",
  "keep_jpg_only": "j",
  "keep_raw_and_jpg": "r"
}
```

#### UI Preferences
```json
"ui": {
  "default_view_mode": "grid",
  "filters_collapsed_default": true,
  "remember_last_project": true
}
```

See `config.default.json` for the complete configuration template with all available options.

## 9. API Overview

The backend exposes a comprehensive REST API for all frontend operations:

### Core Endpoints
*   **Projects**: `GET/POST/DELETE /api/projects` - Project management
*   **Projects (Rename)**: `PATCH /api/projects/:id` - Update project display name only (folder remains `p<id>`)
*   **Photos (Paginated)**: `GET /api/projects/:folder/photos` - Paginated photos for a project. Query: `?limit=250&cursor=0&sort=filename|date_time_original|created_at|updated_at&dir=ASC|DESC`. Returns: `{ items, total, nextCursor, limit, sort, dir }`.
*   **Uploads**: `POST /api/projects/:folder/upload` - File upload with progress
*   **Processing**: `POST /api/projects/:folder/process` - Queue thumbnail/preview generation
*   **Analysis**: `POST /api/projects/:folder/analyze-files` - Pre-upload file analysis
*   **Assets**: 
    *   `GET /api/projects/:folder/thumbnail/:filename` - Thumbnail serving (no token)
    *   `GET /api/projects/:folder/preview/:filename` - Preview serving (no token)
    *   `POST /api/projects/:folder/download-url` - Mint signed URLs for originals
    *   `GET /api/projects/:folder/file/:type/:filename` - Download originals (requires token)
    *   `GET /api/projects/:folder/files-zip/:filename` - Download ZIP (requires token)
    
#### Dev Tips: Paginated Photos

Example:

```bash
curl -s "http://localhost:3000/api/projects/p123/photos?limit=100&cursor=0&sort=filename&dir=ASC" | jq .
```

Response shape:

```json
{
  "items": [ { "filename": "IMG_0001.JPG", "jpg_available": true, ... } ],
  "total": 1245,
  "nextCursor": 100,
  "limit": 100,
  "sort": "filename",
  "dir": "ASC"
}
```
    Notes:
    - `:filename` may include non-image suffixes (e.g., `.com`). The server strips only known image/raw extensions and maps to `<base>.jpg` under `.thumb/` or `.preview/`.
    - All assets (thumbnails, previews, originals, zip) are streamed using `fs.createReadStream`. Responses include short-lived `Cache-Control` and `ETag`; clients may receive 304 on revalidation.
    - Originals lookup: deterministic first, tolerant fallback. The server first attempts an exact DB match and then falls back to the base name (extension stripped) for `/image/:filename`, `/file/:type/:filename`, `/files-zip/:filename`, and when minting `/download-url`. On disk, resolution prefers a fast path of exact-case candidates and, if not found, performs a constrained case-insensitive scan within the project folder to match the base name against allowed extensions (e.g., `.jpg`/`.jpeg` or RAW sets). This eliminates 404s from case/extension mismatches while keeping scope limited to the project directory.
    - Client behavior: the viewer may still append `.jpg` for cache-busting and clarity, but it’s no longer required to avoid 404s; the server will resolve either form.
*   **Jobs**: `GET/POST /api/projects/:folder/jobs` - Background job management
*   **Tags**: `PUT /api/projects/:folder/tags` - Batch tag updates
*   **Keep**: `PUT /api/projects/:folder/keep` - RAW/JPG keep decisions (intent)
*   **Reconcile**:
    * `POST /api/projects/:folder/commit-changes` - Apply current intent by moving non‑kept files to `.trash`
    * `POST /api/projects/:folder/revert-changes` - Reset intent to current availability (non‑destructive)
*   **Config**: `GET/POST /api/config`, `POST /api/config/restore` - Configuration management

#### Configuration lifecycle (merge behavior)

- The server merges missing keys from `config.default.json` into your `config.json` on boot and when handling `POST /api/config` (see `server/services/config.js`).
- If new defaults are introduced, they will be appended to `config.json` on first run after upgrade. This persistence is expected and helps keep config current.

### Real-time Features
*   **Server-Sent Events**: `GET /api/jobs/stream` - Live job and item updates
*   **Job Status**: Real-time notifications for thumbnail generation, uploads, etc.
*   **Client SSE Singleton**: The client uses a single shared `EventSource` managed in `client/src/api/jobsApi.js` (`openJobStream()`) to avoid exceeding server per‑IP limits and to reduce resource usage.
    - The singleton instance is persisted on `globalThis/window` so it survives Vite HMR reloads during development.
    - Multiple UI consumers subscribe via listeners; an unsubscribe closes the stream after a short idle grace period when no listeners remain.
    - Dev tips: close duplicate tabs and hard‑refresh if you see 429s; optionally raise `SSE_MAX_CONN_PER_IP` in local env if hot‑reload briefly opens parallel connections.
    - SSE specifics: server sends a heartbeat every 25s and closes idle streams after a default of 5 minutes. Override via env: `SSE_MAX_CONN_PER_IP` (default 2), `SSE_IDLE_TIMEOUT_MS`.
    - Item updates now include keep flag changes. The `PUT /api/projects/:folder/keep` route emits `type: "item"` with `keep_jpg`/`keep_raw` so the client can reconcile preview/filters without a page refresh. The client normalizes filenames (strips known photo extensions) so SSE events reconcile correctly whether the DB stored a filename with or without an extension.
    - Grid sync: the paginated grid state (`pagedPhotos`) is kept in sync with optimistic actions (commit/revert/keep changes) and SSE `item`, `item_removed`, and `manifest_changed` events so preview mode reflects changes immediately without page refresh.
    - Dev-only logs: `[SSE] ...` messages from the client are printed only in Vite dev mode (`import.meta.env.DEV`). Production builds suppress these logs.

### All Photos (cross-project)

*   `GET /api/photos` — Keyset-paginated list across all non-archived projects
    - Query: `?limit&cursor&date_from&date_to&file_type&keep_type&orientation`
      - `limit`: default 200, max 300
      - `file_type`: `any|jpg_only|raw_only|both`
      - `keep_type`: `any|any_kept|jpg_only|raw_jpg|none`
      - `orientation`: `any|vertical|horizontal`
    - Returns: `{ items, next_cursor, limit, date_from, date_to }`
    - Headers: `Cache-Control: no-store`

*   `GET /api/photos/locate-page` — Locate and return the page that contains a specific photo
    - Required: `project_folder` and one of `filename` (full, with extension) or `name` (basename without extension)
    - Optional: `limit` (1–300, default 100), `date_from`, `date_to`, `file_type`, `keep_type`, `orientation`
    - Returns: `{ items, position, page_index, idx_in_items, next_cursor, prev_cursor, target, limit, date_from?, date_to? }`
    - Behavior:
      - Resolves the target within the filtered global set, ordered by `taken_at DESC, id DESC`
      - For basename collisions, deterministically chooses: filters-passing candidates first, then JPG/JPEG extension, then highest ID (newest)
      - Computes rank (`position`) and fetches the containing page slice (`page_index`, `idx_in_items`)
      - Cursors are compatible with `GET /api/photos`
    - Errors:
      - `400` invalid parameters
      - `404` not found or filtered out by the provided filters
      - `409` ambiguous basename when `name` matches multiple files (use `filename` to disambiguate)
      - `500` server error
    - Headers: `Cache-Control: no-store`; rate-limited at 60 req/min per IP

#### Deep Link Stability

*   **URL as source of truth**: Deep links like `/all/p6/DSC02415` reliably open the exact target photo without redirects
*   **Session storage conflicts resolved**: Removed viewer state persistence that was overriding deep link targets
*   **Deterministic backend resolution**: The `locate-page` API resolves basename collisions predictably
*   **Client URL suppression**: Brief URL update blocking during deep link resolution prevents premature redirects

### Endpoint Notes (validation & CORS)

- `PUT /api/projects/:folder/keep`
  - Body: `{ updates: [{ filename, keep_jpg?, keep_raw? }] }`
  - Filename normalization: accepts base name with or without extension. Server maps `IMG_0001.jpg` → base `IMG_0001`.
  - Validation: `updates` must be an array; otherwise 400.
  - Response: `{ updated_count }` counts only items where a flag actually changed.

- `POST /api/projects/:folder/analyze-files`
  - Body: `{ files: [{ name, type, size? }] }`
  - Validation: `files` must be an array; otherwise 400.

- CORS behavior
  - Allowlist controlled by `ALLOWED_ORIGINS` (comma‑separated). Dev defaults include localhost/127.0.0.1 on ports 3000/5000/5173.
  - Denied Origins return 403 (Forbidden).

### Response Formats
*   All endpoints return JSON responses
*   Consistent error handling with HTTP status codes
*   Pagination support for large datasets

#### Project Entities

All project-related responses include the project `id`:

- `GET /api/projects` → `[{ id, name, folder, created_at, updated_at }, ...]`
- `GET /api/projects/:folder` → `{ id, name, folder, created_at, updated_at, photos: [...] }`
- `PATCH /api/projects/:id` → `{ message, project: { name, folder, created_at, updated_at } }`

Notes:

- `id` is immutable and used to address rename operations.
- `folder` is canonical (`p<id>`) and immutable (does not change on rename).

## 10. Development Workflow

### Common Development Tasks

#### Adding New Features
1.  **Backend**: Add routes in `server/routes/`, business logic in `server/services/`
2.  **Database**: Update repositories in `server/services/repositories/`
3.  **Frontend**: Add components in `client/src/components/`, API calls in `client/src/api/`
4.  **Configuration**: Update `config.default.json` for new settings

#### Working with the Database
*   **Direct Access**: SQLite file located in project data directory
*   **Queries**: Use repository pattern, avoid direct SQL in routes
*   **Schema Changes**: Update repository modules and add migration logic

#### Image Processing
*   **Workers**: Add new workers in `server/services/workers/`
*   **Job Types**: Register new job types in `workerLoop.js`
*   **Processing**: Use Sharp library for image manipulation

#### Testing Uploads
*   **File Types**: Test with various formats (JPG, RAW, TIFF)
*   **Large Files**: Verify progress tracking and timeout handling
*   **Error Cases**: Test invalid file types, disk space issues

### Debugging Tips
*   **Backend Logs**: Structured JSON lines from `npm run dev`. Pipe to `jq` for readability:
```bash
npm run dev 2>&1 | jq -r '.'
```
*   **Frontend Logs**: Use browser developer tools
*   **Database**: Use SQLite browser tools to inspect data
*   **Jobs**: Monitor job status in the Processes panel
*   **File System**: Check configured storage paths for generated assets

## 11. Project Structure Details

### Frontend Structure (`client/`)
```
client/
├── src/
│   ├── App.jsx              # Main application component
│   ├── components/          # Reusable UI components
│   │   ├── PhotoGrid.jsx    # Grid view for photos
│   │   ├── PhotoViewer.jsx  # Full-screen photo viewer
│   │   ├── UploadArea.jsx   # Drag & drop upload interface
│   │   └── ProcessesPanel.jsx # Job monitoring UI
│   ├── api/                 # Backend API client modules
│   │   ├── projectsApi.js   # Project-related API calls
│   │   ├── uploadsApi.js    # Upload functionality
│   │   └── jobsApi.js       # Job monitoring and SSE
│   └── upload/              # Upload-specific utilities
├── public/                  # Static assets
├── dist/                    # Production build output
└── vite.config.mjs         # Vite configuration
```

### Backend Structure (`server/`)
```
server/
├── routes/                  # API endpoint definitions
├── services/
│   ├── repositories/        # Data access layer
│   │   ├── projectsRepo.js  # Project CRUD operations
│   │   ├── photosRepo.js    # Photo metadata management
│   │   ├── tagsRepo.js      # Tag management
│   │   └── jobsRepo.js      # Job queue operations
│   ├── workers/             # Background job processors
│   │   └── derivativesWorker.js # Thumbnail/preview generation
│   │   └── maintenanceWorker.js # Manifest/folder checks and cleaning (emits item_removed)
│   ├── db.js               # Database initialization
│   ├── workerLoop.js       # Job processing engine
│   └── events.js           # Event emitter for SSE
└── utils/                  # Shared utilities
```

## 12. Troubleshooting

### Common Issues

#### "Cannot find module" errors
*   **Solution**: Run `npm install` in both root and `client/` directories
*   **Check**: Node.js version compatibility (v22 required)

#### Upload failures
*   **Check**: File type restrictions in `config.json`
*   **Check**: Disk space and write permissions
*   **Check**: File size limits (default: no limit, but check system)

#### Thumbnails not generating
*   **Check**: Worker loop is running (should see console output)
*   **Check**: Sharp library installation (native dependencies)
*   **Check**: Source image file accessibility

#### Database errors
*   **Check**: Write permissions for database directory
*   **Check**: SQLite file not corrupted (backup and recreate if needed)
*   **Check**: Foreign key constraint violations

#### Frontend not connecting to backend
*   **Check**: Backend running on port 5000
*   **Check**: CORS configuration in server
*   **Check**: Vite proxy configuration in `client/vite.config.mjs`

### Performance Issues
*   **Large Projects**: Consider pagination settings
*   **Slow Thumbnails**: Adjust processing quality settings
*   **Memory Usage**: Monitor Sharp memory usage with large images
*   **Database Performance**: Check indexing on frequently queried columns

### Getting Help
*   **Documentation**: Check `README.md`, `SCHEMA_DOCUMENTATION.md`, `SECURITY.md`
*   **Configuration**: Review `config.default.json` for all options
*   **Logs**: Enable verbose logging for debugging
*   **Community**: Check project issues and discussions

---

## Summary

This Node.js Photo Manager provides a comprehensive solution for photo organization with modern web technologies. The architecture supports scalability through its async job system, provides excellent user experience with real-time updates, and maintains security through signed URLs and proper validation.

Key strengths:
- **Responsive UI** with real-time job progress
- **Robust background processing** with crash recovery
- **Flexible configuration** for various use cases
- **Extensible architecture** for future enhancements
- **Production-ready** security and performance features

For detailed information on specific subsystems, refer to the dedicated documentation files mentioned throughout this overview.

### Related Links

- `./JOBS_OVERVIEW.md` — Job catalog (types, priorities, lanes) and task compositions used by Upload, Commit, Maintenance, and Project Deletion flows

Notes:
- Destructive endpoints above (PATCH rename, DELETE project, POST commit-changes) are rate-limited at 10 req/5 min/IP.
