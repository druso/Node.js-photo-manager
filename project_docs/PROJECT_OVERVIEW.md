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

*   **List and Viewer**: These are the main UI components for interacting with photos. The application provides two main views: "All Photos" (cross-project view) and "Project" view (single project). Both use virtualized grids for performance with large datasets and support server-side filtering by date range, file type, keep status, and orientation. The "Viewer" provides a full-size view of a single selected photo with keyboard navigation.

*   **Unified View Architecture**: There is NO conceptual distinction between "All Photos" and "Project" views. A Project view is simply the All Photos view with a project filter applied. This architectural principle is enforced throughout the codebase with a unified view context (`view.project_filter === null` for All Photos mode, or a project folder string for Project mode), unified selection model (`PhotoRef` objects), and unified modal states. The codebase has been fully refactored to use this single source of truth, eliminating duplicate code paths and ensuring consistent behavior across the application.

*   **Unified Filtering and Sorting System**: Both All Photos and Project views use identical server-side filtering and sorting with consistent "filtered of total" count displays. Active filters cover date range, file type availability (JPG/RAW), keep flags, orientation, and text search. Sorting supports three fields (date, filename, file_size) with both ascending and descending order. Sort parameters are synchronized with the URL (`?sort=name&dir=asc`) and persist across page reloads. When sort order changes, pagination resets to the first page and scroll position returns to top. Future iterations will extend filtering to tags and visibility once the corresponding UI ships.
*   **Cross-Project Visibility Operations (2025-10-07)**: The actions menu now supports previewing and applying visibility changes across both Project and All Photos contexts using the unified selection model. Bulk updates route through `useVisibilityMutation()` and call `POST /api/photos/visibility` introduces bulk visibility management with rate limiting. The handler in `server/routes/photosActions.js` revalidates payloads and emits SSE item updates to keep clients synchronized. Asset routes in `server/routes/assets.js` return 404 for private photos unless a valid admin JWT is supplied.

*   **Shared Links**: Shared links enable curated public galleries with full deep linking support. Current implementation:

    - **Server-side**: `public_links` schema tables, administrative APIs under `/api/public-links`, and `publicLinksRepo` helpers. Hashed key generation and management via CLI and admin UI.

    - **Client-side**: Dual-endpoint architecture with `/shared/:hashedKey` for public viewers and authenticated admin access. React hooks (`useSharedLinkData`) and pages (`SharedLinkPage.jsx`, `/sharedlinks` management view) provide full functionality.

    - **Deep Linking (2025-01-04)**: Full support for photo-level deep links with URL format `/shared/{token}/{photoBasename}`. Both authenticated and public users can:
      - Access shared galleries via `/shared/{token}`
      - Open specific photos via `/shared/{token}/{photo}` (works as entry point)
      - Navigate between photos with URL updates (`replaceState`)
      - Close viewer to return to `/shared/{token}` (`pushState`)
      - Deep links automatically paginate to find target photo if not in initial page
    
    - **URL Synchronization**: Router matches both `/shared/{token}` and `/shared/{token}/{photo}` patterns. `useViewerSync` and `useAllPhotosViewer` hooks handle URL updates for shared link mode, ensuring consistent behavior across authenticated and public access.

    - **Milestone 5 (Planned)**: A unified share modal will integrate with `UnifiedSelectionModal.jsx` to manage link membership, auto-promote shared photos to `visibility='public'`, and provide optimistic UI updates.

*   **Worker Pipeline**: To ensure the UI remains responsive, time-consuming tasks like generating thumbnails and previews are handled asynchronously by a background worker pipeline. Each job now carries an explicit `scope` (`project`, `photo_set`, or `global`) so workers can operate on single projects, arbitrary photo collections, or system-wide maintenance alike. Shared helpers in `server/services/workers/shared/photoSetUtils.js` resolve job targets and group photo sets per project, keeping filesystem access safe for cross-project operations. The system includes specialized workers for image moves between projects, which update database records, move files and derivatives, and emit real-time SSE events to keep the UI synchronized. The Processes panel consumes the tenant-wide `/api/jobs` endpoint so the admin can monitor every in-flight job across All Photos and Project contexts without switching filters. This system is designed to be extensible for future processing needs and the canonical job catalog lives in `JOBS_OVERVIEW.md`. **Photo-centric commits (2025‑10‑24)** now dispatch a single `change_commit_all` task containing per-photo job items aggregated across projects; the file removal worker consumes these `photo_set` batches, marking each job item by `photo_id` while still emitting project-level SSE updates.

*   **Database**: While photo files (originals, raws, previews) are stored on the file system, all their metadata—such as project association, tags, timestamps, and file paths—is stored in a central SQLite database. The frontend application relies on this database for fast access to photo information.

*   **Modular Repository Architecture**: The photo repository layer has been optimized into focused, single-responsibility modules to improve maintainability and testability. The main `photosRepo.js` serves as a clean interface that delegates to specialized modules: `photoCrud.js` for basic operations, `photoFiltering.js` for search and filtering, `photoPagination.js` for pagination logic, `photoPendingOps.js` for pending operations, and `photoQueryBuilders.js` for SQL construction utilities. This architecture reduces complexity while maintaining full backward compatibility.

*   **URL-Based State Management**: The application uses URLs as the primary source of truth for navigation state, making the application shareable and bookmarkable. URL parameters control filters (`date_from`, `date_to`, `file_type`, `keep_type`, `orientation`), viewer state (photo path in URL), and UI preferences (`showinfo=1` for info panel). localStorage stores only essential UI preferences (viewMode, sizeLevel), while sessionStorage handles scroll positions and pagination cursors. This architecture eliminates redundant state storage and provides a better user experience with shareable URLs.

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
    *   `App.jsx`: Highly optimized main orchestrator (~1.17k lines, reduced from ~2350 lines via systematic extraction)
    *   `hooks/`: Extensive collection of specialized React hooks for separation of concerns:
        - **State Management**: `useAppState.js`, `useFiltersAndSort.js`
        - **Business Logic**: `useProjectDataService.js`, `useEventHandlers.js`, `useProjectNavigation.js`
        - **Effects & Initialization**: `useAppInitialization.js`, `usePersistence.js`, `usePhotoDeepLinking.js`
        - **UI Logic**: `useScrollRestoration.js`, `useFilterCalculations.js`, `useCommitBarLayout.js`
        - **Feature-Specific**: `useAllPhotosPagination.js`, `useProjectSse.js`, `useViewerSync.js`, `useAllPhotosUploads.js`
        - **Mode Management**: `useModeSwitching.js` (handles transitions between All Photos and Project views), `usePendingDeletes.js`, `usePhotoDataRefresh.js`
    *   `components/`: Modular UI components extracted from App.jsx:
        - **Layout**: `MainContentRenderer.jsx`, `CommitRevertBar.jsx`
        - **Controls**: `SortControls.jsx` (eliminates 4x code duplication), `SelectionToolbar.jsx` (async "Select All" with confirmation dialogs)
        - **Modals**: `CommitModal.jsx`, `RevertModal.jsx`, `CreateProjectModal.jsx`
        - **Core**: `VirtualizedPhotoGrid.jsx`, `PhotoViewer.jsx`, etc.
        - **Selection**: `SelectionToolbar.jsx` implements intelligent "Select All" that fetches all filtered photo keys via `/api/photos/all-keys`, shows confirmation dialogs for large selections (>1000 photos), and provides loading states during async operations
    *   `services/`: Business logic services (`ProjectDataService.js`, `EventHandlersService.js`)
        - `EventHandlersService.js` consumes the canonical `filteredProjectData` computed from server-filtered results to keep viewer selections and project modals in sync without placeholder state.
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
    *   `auth/`: Authentication bootstrap helpers (`authConfig.js`, `initAuth.js`, `passwordUtils.js`, `tokenService.js`, `authCookieService.js`) enforce the fail-fast auth env contract and expose bcrypt/JWT/cookie utilities.
*   **Utilities (`server/utils/`)**: Contains helper functions used across the backend.
    - File acceptance is centralized in `server/utils/acceptance.js` and driven by `config.json → uploader.accepted_files` (extensions, mime_prefixes).
*   **Migrations (`server/services/migrations/`)**: Contains `runner.js` (ordered migration execution with dry-run support) and draft migration modules (`2025100401_add_photos_visibility.js`, `2025100402_create_public_links.js`, `2025100403_create_photo_public_links.js`) outlining upcoming visibility/shared-link schema changes.

#### Authentication Bootstrap (2025-10-04)

- **Fail-fast config**: `authConfig.js` validates `AUTH_ADMIN_BCRYPT_HASH`, `AUTH_JWT_SECRET_ACCESS`, `AUTH_JWT_SECRET_REFRESH`, and enforces `AUTH_BCRYPT_COST` bounds (8–14, default 12).
- **Startup guard**: `initAuth.js` runs before Express initialisation in `server.js`; failures log `auth_config_invalid` and exit to prevent misconfigured deployments.
- **Helper modules**:
  - `passwordUtils.js` handles bcrypt verification/hash generation.
  - `tokenService.js` issues/verifies 1 h access and 7 d refresh JWTs with issuer `photo-manager`, audience `photo-manager-admin`, and `role: 'admin'`.
  - `authCookieService.js` encapsulates SameSite=Strict HTTP-only cookie defaults with secure flag derived from `AUTH_COOKIE_SECURE`/`NODE_ENV`.
- **Testing**: Suites in `server/services/auth/__tests__/` (run via `npm test`) cover config success/error, password helpers, token lifecycle, and cookie behaviour.
- **Operator guidance**: `.env.example` & `README.md` document sample bcrypt hash generation and 256-bit secret rotation plus notes on adjusting `AUTH_BCRYPT_COST`.

#### Admin Authentication Rollout (2025-10-04)

- **Server endpoints**: `server/routes/auth.js` exposes `POST /api/auth/login` (password verification with `passwordUtils.verifyAdminPassword()`), `POST /api/auth/refresh` (rotates access token, re-issues cookies), and `POST /api/auth/logout` (clears cookies).
- **Middleware**: `server/middleware/authenticateAdmin.js` verifies access JWTs from `Authorization: Bearer` or the `pm_access_token` cookie via `tokenService.verifyAccessToken()` and blocks all `/api/*` routes except `/api/auth/*`. SSE entrypoints (`/api/sse/*`, `/api/jobs/stream`) chain through the same guard to prevent unauthenticated listeners.
- **Cookie contract**: `authCookieService.js` writes `pm_access_token` (HTTP-only, SameSite=Strict, path `/`, ~1 h TTL) and `pm_refresh_token` (HTTP-only, SameSite=Strict, path `/api/auth/refresh`, 7 d TTL). `AUTH_COOKIE_SECURE` or `NODE_ENV` control the `secure` flag. Logout and refresh flows clear/rotate both cookies to avoid leakage.
- **Frontend client**: `client/src/api/httpClient.js` centralises authenticated fetches (adds bearer token + `credentials: 'include'`). `client/src/api/authApi.js` wraps login/refresh/logout and synchronises the in-memory token cache.
- **SPA gating**: `client/src/auth/AuthContext.jsx` manages session state, schedules silent refresh ~30 s before expiry, and exposes `useAuth()`. `client/src/auth/LoginPage.jsx` provides the admin password form. `client/src/App.jsx` renders `AdminApp` only when `useAuth()` reports `status === 'authenticated'`; otherwise the login screen is shown. `client/src/main.jsx` wraps the entire React tree with `<AuthProvider>` so every API client and hook can rely on the shared auth context.
- **API integrations**: Core clients (`projectsApi`, `photosApi`, `allPhotosApi`, `keepApi`, `tagsApi`, `uploadsApi`) now import `authFetch()` so every administrative call automatically carries the access token and cookies.
- **Environment readiness**: Local development requires the Milestone 0 sample secrets (see `.env.example`). Without them `npm start`/`npm test` will exit early with `auth_config_invalid` events.

#### Migration Scaffolding (2025-10-04)

- `server/services/migrations/runner.js` discovers migration modules, sorts by `id`, and wraps `up` executions in transactions (supports `{ dryRun: true }`).
- Draft migrations (kept unapplied) implement `photos.visibility` (`TEXT NOT NULL DEFAULT 'private'`), `public_links` metadata, and `photo_public_links` join with supporting indexes.
- **Dry-run recipe**:
  ```js
  const path = require('path');
  const { getDb } = require('./server/services/db');
  const { MigrationRunner } = require('./server/services/migrations/runner');
  const db = getDb();
  const runner = new MigrationRunner({ db, migrationsDir: path.join(__dirname, 'server/services/migrations/migrations') });
  runner.runAll({ dryRun: false });
  ```
  Run from repo root once the base schema exists to validate drafts locally (leave unapplied in production until ready).

#### Logging

- Backend logging is centralized via `server/utils/logger2.js` producing structured JSON lines.
- All routes, services, and workers log events with component (`cmp`), event (`evt`), and rich context (e.g., `project_id`, `project_folder`, `project_name`, `job_id`).
- Levels: `error`, `warn`, `info`, `debug`. Controlled by `LOG_LEVEL` (default `info`).
- Example event keys: `upload_failed`, `project_delete_failed`, `list_jobs_failed`, `config_sanity_normal_lane_zero`.

#### Project Folders (Fresh Start)

Projects are stored on disk under `<repoRoot>/.projects/user_0/<project_folder>/` where `project_folder` is a sanitized, human-readable slug generated by `generateUniqueFolderName()` at creation time. The helper ensures filesystem-safe characters, trims length, and appends `(n)` suffixes to de-duplicate titles automatically. The `user_0` folder provides user-scoped isolation and enables future multi-user support. Duplicate human names are allowed; uniqueness is enforced by `project_folder`. Legacy installs may still have canonical `p<id>` folders, and the maintenance pipeline continues to support them during the transition.

Path resolution is centralized in `server/services/fsUtils.js` via `getProjectPath(folder, user='user_0')` which returns `.projects/user_0/<folder>/`. All routes and workers use this function to ensure consistent path handling regardless of whether the folder is a legacy `p<id>` or the new human-readable form.

#### Filesystem Layout & Storage

- **SQLite databases** live under `<repoRoot>/.db/` with one file per user (for example `user_0.sqlite`). The location is derived from `DB_DIR` in `server/services/db.js` and is created automatically when the server boots if it does not yet exist.
- **Project content** is rooted at `<repoRoot>/.projects/<user>/`. Today only `DEFAULT_USER = 'user_0'` is active, but the folder structure is already user-scoped for future multi-user support (`server/services/fsUtils.js`).
- **Per-project structure** is enforced by `ensureProjectDirs()` and includes the `.thumb/`, `.preview/`, `.trash/`, and `.project.yaml` entries. Missing directories are created on demand before any writes.
- **Manifests (`.project.yaml`)** capture `{ name, id, created_at, version }` for each project. They are written during project creation and kept in sync by maintenance jobs (see below) using `writeManifest()` in `server/services/projectManifest.js`.

#### Folder Discovery & Maintenance Cadence

The scheduler (`server/services/scheduler.js`) enqueues a global `folder_discovery` job on a configurable cadence so the system can pick up folders that appear outside of the UI. The interval defaults to 5 minutes (`folder_discovery.interval_minutes` in `config.default.json`) and can be overridden in `config.json` for development (often set to 1 minute). Each run:

1. Scans `.projects/<user>/` for folders while skipping internal directories such as `.thumb`, `.preview`, and `.trash`.
2. Reconciles manifests by regenerating `.project.yaml` if missing or outdated.
3. Creates new projects for previously unseen folders and queues derivative generation for any new files.

Hourly maintenance tasks (`maintenance_global`) still handle derivative reconciliation, manifest validation, duplicate detection, and trash cleanup in the background, keeping the filesystem and database in lockstep.

#### Migration Notes & Troubleshooting

- The current layout is a **fresh-start design** with no backward-compatibility layer. Legacy installs that stored the database inside `.projects/` are not supported; folder discovery will re-index everything into the new structure instead of running migration scripts.
- Typical filesystem issues and recovery steps:
  - **Database not found** → ensure `.db/user_0.sqlite` exists; the server creates it on startup when permissions allow.
  - **Projects not discovered** → confirm new folders live inside `.projects/user_0/` and wait for the discovery interval (or restart the server to trigger an immediate run).
  - **Thumbnail/preview 404s** → verify the photo was indexed; discovery plus `upload_postprocess` regenerate derivatives automatically.

Filename normalization for asset endpoints preserves non-image suffixes (e.g., `.com` in `manage.kmail-lists.com`) and strips only known image/raw extensions (`jpg`, `jpeg`, `raw`, `arw`, `cr2`, `nef`, `dng`). Derivatives are named `<base>.jpg` in `.thumb/` and `.preview/`.

Utilities: see `server/utils/projects.js` for `makeProjectFolderName()`, `isCanonicalProjectFolder()`, and `parseProjectIdFromFolder()`.

On creation, the server ensures these subdirectories exist:
- `.thumb` for thumbnails
- `.preview` for previews
- `.trash` for temporary removals
- `.project.yaml` manifest file containing project metadata (name, id, created_at, version)

**Manifest Lifecycle**: The `.project.yaml` file is generated during project creation and maintained by the maintenance pipeline. It serves as the source of truth for reconciling filesystem state with the database during folder discovery and maintenance operations. The manifest is:
- Generated by `projectManifest.writeManifest()` during project creation
- Validated and repaired by `maintenanceWorker.runManifestCheck()` if missing or corrupted
- Preserved during `maintenanceWorker.runFolderCheck()` (skipped in file scans)
- Used by `folderDiscoveryWorker` to reconcile external folder additions
- Updated automatically when project names change or folders are aligned

#### Project Rename & Folder Alignment (2025-11-04)

**Architecture Principle**: Maintenance-Driven Consistency

The project rename system uses a simple, maintenance-driven approach that separates display name updates from folder operations:

**Rename API** (`PATCH /api/projects/:folder/rename`)
- Updates `project_name` immediately in database (ACID transaction)
- Updates `.project.yaml` manifest with new name so the manifest matches the latest display value
- Returns success immediately - no blocking operations
- Rate limited: 10 requests per 5 minutes per IP

- Runs hourly as part of `maintenance_global` task (priority 96)
- Detects mismatches between `project_name` and `project_folder`
- Generates expected folder name using `generateUniqueFolderName()`
- Prefers keeping the existing sanitized folder when already aligned; only legacy `p<id>` or externally renamed folders are moved
- Performs atomic `fs.rename()` operation with safety checks:
  - Source folder must exist (skips if missing)
  - Target folder must not exist (skips if collision)
- Updates database: `project_folder` → new aligned folder
- Rewrites manifest in new location
- Emits SSE event: `{ type: "folder_renamed", project_id, old_folder, new_folder }`

**Consistency Guarantees**:
- ✅ Display name updates are immediate and transactional (ACID)
- ✅ Freshly created projects already receive sanitized folder names
- ✅ Folder alignment happens automatically during maintenance for legacy or externally modified folders
- ✅ No blocking operations during rename API calls
- ✅ All operations are idempotent and retry-safe
- ✅ Handles external folder changes gracefully

**User Experience**:
- Immediate feedback: Project name changes instantly in UI
- Background processing: Folder rename happens during next maintenance cycle (hourly)
- No downtime: Project continues working with old folder until alignment completes
- SSE updates: UI refreshes automatically when folder rename completes

**Implementation Files**:
- API: `server/routes/projects.js` (endpoint: `PATCH /api/projects/:folder/rename`)
- Maintenance Worker: `server/services/workers/maintenanceWorker.js` (`runFolderAlignment()`)
- Task Definition: `server/services/task_definitions.json` (`maintenance_global` includes `folder_alignment`)
- Worker Loop: `server/services/workerLoop.js` (registered handler)
- Repository: `server/services/repositories/projectsRepo.js` (`updateFolder()` function)

### Database

The application uses **SQLite** with better-sqlite3 for data storage, providing ACID compliance and excellent performance for this use case.

*   **Core Tables**: `projects`, `photos`, `tags`, `photo_tags` (many-to-many)
*   **Job System**: `jobs` and `job_items` tables power the async worker pipeline
*   **Features**: WAL mode enabled, foreign key constraints, comprehensive indexing
*   **Storage**: Uses SQLite with WAL mode for ACID compliance and performance
*   **Data Access**: Repository pattern with dedicated modules in `server/services/repositories/`

Refer to `SCHEMA_DOCUMENTATION.md` for detailed table structures and relationships.

## 5. Frontend Architecture Achievements

### App.jsx Optimization (2025-09-27)

The main App.jsx component underwent extensive refactoring to improve maintainability, testability, and performance:

#### **Size Reduction**
- **Original Size**: ~2,350 lines (monolithic component)
- **Final Size**: 1,021 lines (57% reduction)
- **Target Achievement**: ✅ Within optimal range of 800-1000 lines

#### **Systematic Extraction Phases**
1. **State Management**: Extracted all useState/useRef declarations to `useAppState.js` and `useFiltersAndSort.js` (legacy `isAllMode` flag removed; `useAppState()` now relies solely on `view.project_filter`).
2. **Business Logic Services**: Created `ProjectDataService.js`, `EventHandlersService.js`, `ProjectNavigationService.js`
3. **Effects & Initialization**: Moved large useEffect blocks to `useAppInitialization.js`, `usePersistence.js`
4. **Complex Logic**: Extracted photo filtering, keyboard shortcuts, deep linking, scroll restoration
5. **UI Components**: Created modular components (`MainContentRenderer.jsx`, `CommitRevertBar.jsx`, etc.)

#### **New Custom Hooks Created**
- **`usePhotoDeepLinking.js`**: Complex photo viewer deep linking logic (~97 lines)
- **`useScrollRestoration.js`**: Window and main scroll restoration (~52 lines)
- **`useFilterCalculations.js`**: Active filter count and status calculations (~17 lines)
- **`useModeSwitching.js`**: All Photos vs Project mode switching (~27 lines)
- **`usePendingDeletes.js`**: Pending deletes calculations and state (~14 lines)
- **`useAllPhotosRefresh.js`**: All Photos refresh functionality (~22 lines)
- **`useCommitBarLayout.js`**: Commit bar layout and toast offset logic (~21 lines)

#### **Layout Fixes Applied**
- **Fixed Header Issue**: Resolved sticky header not working by switching from `position: sticky` to `position: fixed` with proper spacing
- **Horizontal Scroll Fix**: Added `overflow-x-hidden` to prevent unwanted horizontal scrolling
- **Content Spacing**: Proper spacer div placement to prevent content overlap with fixed header

#### **Pagination Improvements (2025-09-28)**
- **Global Manager Cache**: Implemented a module-level cache that persists PagedWindowManager instances across renders
- **Mode-Specific Caching**: Separate caches for All Photos mode and each project folder
- **Enhanced Manager Lifecycle**: Modified `ensureWindow` to check the cache before creating new instances
- **Improved Reset Logic**: Updated `resetState` to reset manager state without destroying instances
- **Sort Change Detection**: Added logic to detect sort changes and reset the appropriate manager
- **Consistent Behavior**: Both All Photos and Project views now use the same pagination code path with identical behavior

#### **Critical Pagination Invariants (see `PAGINATION_IMPLEMENTATION.md` for full context)**

- **Backend cursors** &mdash; `photoFiltering.listAll()` must always emit a `prev_cursor` whenever the client provides a `cursor`, ensuring backward navigation remains available even after window eviction during forward paging. @server/services/repositories/photoFiltering.js#134-388
- **Initial load lock** &mdash; `useAllPhotosPagination.loadInitial()` guards against concurrent executions (e.g., Strict Mode double invokes) with a `loadingLockRef`, preserving dedupe state inside `PagedWindowManager`. @client/src/hooks/useAllPhotosPagination.js#232-277
- **Dual status reset paths** &mdash; `VirtualizedPhotoGrid` resets pagination status in both the pending-load effect and the scroll-anchor restoration effect so pagination never stays stuck in a loading state. @client/src/components/VirtualizedPhotoGrid.jsx#148-371
- **Scroll-anchor dependencies** &mdash; The restoration effect depends on `[photos, totalHeight]` (not just `photos.length`), guaranteeing it runs when eviction keeps list length steady. @client/src/components/VirtualizedPhotoGrid.jsx#148-371

> **Tip**: The deep-dive checklist and bug history live in `project_docs/PAGINATION_IMPLEMENTATION.md`. Treat that file as the source of truth when touching pagination logic.

#### **Architecture Improvements**
- **Better Separation of Concerns**: Complex logic isolated into focused, reusable hooks
- **Enhanced Reusability**: Hooks can be reused across components and tested independently
- **Improved Testability**: Extracted logic is easier to unit test in isolation
- **Better Maintainability**: Smaller, focused files are easier to understand and modify
- **Performance Optimization**: Better memoization opportunities and reduced re-renders
- **State Persistence**: Critical state now persists across renders for improved reliability

#### **Code Quality**
- All hooks follow React best practices with proper dependency arrays
- Consistent naming conventions and clear documentation
- No functionality regressions - all features preserved
- Build passes successfully with all optimizations
- Comprehensive logging for easier debugging

## 6. Key Features

### Photo Management
*   **Multi-format Support**: Handles JPG, PNG, TIFF, and various RAW formats (CR2, NEF, ARW, DNG)
*   **Project Organization**: Photos are organized into projects (albums/shoots)
*   **Metadata Extraction**: Automatic EXIF data parsing for timestamps, camera settings, etc. Timestamp extraction uses a fallback hierarchy: `DateTimeOriginal` (preferred - actual capture time) → `CreateDate` → `ModifyDate` → database `created_at` (ingestion time). All available EXIF timestamp fields are preserved in `meta_json` for audit purposes.
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
*   **Full-screen Viewer**: Detailed photo viewing with zoom and navigation. Backed by `useViewerSync()` so URLs remain the source of truth for deep links in All Photos and Project contexts. Mobile gestures include pinch-to-zoom, swipe navigation, and a touch-friendly zoom slider.
  - Public assets are fetched through `PublicHashContext` so preview/full-resolution images use cached hashes when fresh, refreshing metadata only when the hash expires. Private photos automatically use signed project endpoints.
*   **Long-Press Selection Mode (Mobile)**: Holding on any grid photo enters selection mode, auto-displaying a banner with live counts. Taps toggle selection while active, and clearing selections hides the banner.
*   **Keyboard Shortcuts**: Comprehensive keyboard navigation (see configuration)
    - Viewer behavior: planning a delete (keep none) no longer auto-advances; the viewer stays on the current image and shows a toast. When filters change the visible list, the current index is clamped to a valid photo instead of closing.
*   **Real-time Updates**: Live job progress via Server-Sent Events
*   **Incremental Thumbnails (SSE)**: Pending thumbnails update via item-level SSE events managed by `useProjectSse()`; no client-side probing of asset URLs
  - Client requests encode both `:folder` and `:filename` to avoid failures with spaces/special characters (see `client/src/components/Thumbnail.jsx`).
  - Resilience: the thumbnail image performs one retry with a short cache-busting param when a load error occurs. If debug is enabled, it logs load/retry/fail events to the console.
  - Public photos resolve thumbnail URLs through `PublicHashContext` and `ensurePublicAssets()` so hashed asset URLs are reused across grid, table, and viewer surfaces without redundant metadata fetches. Private photos fall back to the authenticated thumbnail endpoint automatically.
  - Dev toggle for diagnostics: `localStorage.setItem('debugThumbs','1')` (or set `window.__DEBUG_THUMBS = true`) and reload to see `[thumb]` logs in DevTools.
  - Option A lifecycle: `PublicHashProvider` relies on the backend `photo_public_hashes` table. Hashes have a default 28‑day TTL (`public_assets.hash_ttl_days`) and rotate every 21 days (`public_assets.hash_rotation_days`) via `scheduler.js`. Override cadence with `PUBLIC_HASH_TTL_DAYS` / `PUBLIC_HASH_ROTATION_DAYS` env vars. Admin visibility toggles (`photosRepo.updateVisibility()`) seed or clear hashes automatically.
*   **Lazy Loading (IntersectionObserver)**: The photo grid uses a single `IntersectionObserver` with a slight positive `rootMargin` and a short dwell to avoid flicker. Observation is rebound if a cell's DOM node changes across re-renders, and a ref‑backed visibility set prevents stale-closure misses. This eliminates random blank thumbnails while scrolling and reduces request bursts.
*   **Incremental Updates**: The grid updates incrementally to preserve context and avoid disruptive reloads.
*   **Optimistic Updates**: Keep/Tag/Revert/Commit actions update the UI immediately without a full data refetch, preserving browsing context.
*   **Scroll Preservation**: Grid/table and viewer preserve scroll position and context during incremental updates. Selection is maintained unless an action explicitly clears it. Long-press selection mode respects this preservation by exiting automatically once all selections are cleared.
*   **Layout Stability**: Thumbnail cells use constant border thickness; selection changes only color/ring, avoiding micro layout shifts that can nudge scroll.
 *   **Grid Lazy-Load Reset Policy**: The grid’s visible window only resets when changing projects (or lazy threshold), not on incremental data updates.
 *   **Scroll/Viewer Preservation**: Window/main scroll and open viewer are preserved across background refreshes and fallback refetches.
 *   **Active Project Sentinel**: `client/src/App.jsx` keeps an `ALL_PROJECT_SENTINEL` entry representing “All Photos.” Entering this mode clears `projectData`, resets local selection, and pauses per-project pagination while `previousProjectRef` remembers the prior folder so the UI restores it when exiting All mode.
 *   **Upload Routing**: `useAllPhotosUploads()` tracks the active project via `registerActiveProject()` and opens `ProjectSelectionModal` whenever uploads start without a concrete target. The header `UploadButton` defers to this hook—All Photos mode always prompts for a destination, while project mode preselects the current folder but still allows quick re-targeting.
 *   **Typeahead Project Picker**: `ProjectSelectionModal.jsx` and `MovePhotosModal.jsx` share the typeahead UX. The move modal receives `selectedProjectSummaries` from `client/src/App.jsx` so it can exclude origin folders and display per-project selection counts (e.g., “Project A (5), Project B (2)”) before launching the move task.
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
*   **Public Asset Hashing (Option A)**: Public photos use rotating hashed URLs for secure anonymous access
    - Hash generation: `crypto.randomBytes(24).toString('base64url')` creates 32-char URL-safe tokens
    - Storage: `photo_public_hashes` table tracks hash, rotation timestamp, and expiry per photo
    - Lifecycle: Hashes auto-generated when `visibility='public'`, cleared when toggled to private
    - Rotation: Daily scheduler job (`server/services/scheduler.js`) rotates expiring hashes
    - TTL: Configurable via `config.public_assets.hash_ttl_days` (default 28 days) or env `PUBLIC_HASH_TTL_DAYS`
    - Validation: Asset routes require valid hash for anonymous requests; admins bypass hash check
    - Direct access: `GET /api/projects/image/:filename` returns viewer metadata with fresh hashes for public photos
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
    - Scope drives execution: `project` jobs operate on a single project, `photo_set` jobs iterate over grouped photo subsets, and `global` jobs run system-wide reconciliation.
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

Maintenance tasks keep the on‑disk state and the database in sync. They are implemented as high‑priority, idempotent jobs handled by the same worker loop and scheduled through scope-aware tasks.

Job types:

- `trash_maintenance`: Remove files in `.trash` older than 24h (TTL-based cleanup).
- `duplicate_resolution`: Detect cross-project filename collisions and rename duplicates with deterministic `_duplicate{n}` suffixes; enqueues `upload_postprocess` for renamed files. **Must run before `folder_check`** to avoid duplicate DB records.
- `manifest_check`: Verify DB availability flags (`jpg_available`, `raw_available`) against files on disk and fix discrepancies. Ensures `.project.yaml` manifest exists and is correct.
- `folder_check`: Scan the project folder for untracked files; creates minimal DB records (null metadata/derivatives) and enqueues `upload_postprocess` for metadata extraction and derivative generation; moves unaccepted files to `.trash`. **Skips `.project.yaml` manifest files.** Delegates all photo ingestion to the `upload_postprocess` pipeline.
- `manifest_cleaning`: Delete rows where both JPG and RAW are unavailable. Emits `item_removed` events for per-item UI reconciliation.
  - `project_stop_processes`: High‑priority step that marks a project archived (`status='canceled'`) and cancels queued/running jobs.
  - `project_delete_files`: High‑priority step that deletes the project folder from `.projects/user_0/<project_folder>/`.
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

- Hourly kickoff of a single global `maintenance_global` task (scope `global`). This fans out to `trash_maintenance` (priority 100), `duplicate_resolution` (95), `manifest_check` (95), `folder_check` (95), and `manifest_cleaning` (80) inside the pipeline without looping over projects in the scheduler itself.
- Hourly kickoff of `project_scavenge_global` (scope `global`) for archived projects to remove any leftover `.projects/user_0/<project_folder>/` directories.
  See `server/services/scheduler.js` and the canonical jobs catalog in `JOBS_OVERVIEW.md`.

- `POST /api/projects/:folder/commit-changes` (project-scoped)
  - Moves non‑kept files to `.trash` based on `keep_jpg`/`keep_raw` flags for the specified project
  - See implementation in `server/routes/maintenance.js`
- `POST /api/projects/:folder/revert-changes` (project-scoped)
  - Non‑destructive. Resets `keep_jpg := jpg_available` and `keep_raw := raw_available` for all photos in the specified project
  - See implementation in `server/routes/maintenance.js`
- `POST /api/photos/commit-changes` (global)
  - Moves non‑kept files to `.trash` across multiple projects based on `keep_jpg`/`keep_raw` flags
  - Accepts optional `{ projects: ["p1", "p2"] }` body to target specific projects; if omitted, operates on all projects with pending deletions
  - Deletes generated derivatives for JPGs moved to `.trash` (removes `.thumb/<base>.jpg` and `.preview/<base>.jpg` immediately)
  - Removes photo rows from SQLite as soon as both `keep_jpg` and `keep_raw` are cleared, emitting `item_removed` SSE so the UI drops thumbnails without waiting for maintenance
  - Updates the database (for partial removals) and still enqueues reconciliation jobs per project as a safety net
  - Emits incremental SSE (`item_removed`, `manifest_changed` with `removed_filenames`) for UI reconciliation
  - See implementation in `server/routes/photosActions.js`
- `POST /api/photos/revert-changes` (global)
  - Non‑destructive. Resets `keep_jpg := jpg_available` and `keep_raw := raw_available` across multiple projects
  - Accepts optional `{ projects: ["p1", "p2"] }` body to target specific projects; if omitted, operates on all projects with keep mismatches
  - Clears any pending destructive actions without moving files
  - See implementation in `server/routes/photosActions.js`
- `GET /api/photos/pending-deletes` (global summary)
  - Returns aggregated pending deletion counts across all projects: `{ jpg, raw, total, byProject: ["p1", "p2"] }`
  - Supports the same filters as `/api/photos` (date range, file type, orientation) but ignores `keep_type` and always reports pending deletes regardless of the grid’s filtered view
  - The All Photos UI invokes this endpoint directly (see `listAllPendingDeletes()` in `client/src/api/allPhotosApi.js`) so the commit/revert toolbar stays accurate even when the paginated list is constrained by filters
  - See implementation in `server/routes/photosActions.js`

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
*   **Projects (Rename)**: `PATCH /api/projects/:folder/rename` - Updates project display name; maintenance will align folder automatically
*   **Photos (Paginated)**: `GET /api/projects/:folder/photos` - Paginated photos for a project.
     - Query: `?limit&cursor&before_cursor&sort=filename|date_time_original|created_at|updated_at&dir=ASC|DESC&date_from&date_to&file_type&keep_type&orientation`
     - Returns: `{ items, total, unfiltered_total, nextCursor, prevCursor, limit, sort, dir }`
*   **Uploads**: `POST /api/projects/:folder/upload` - File upload with progress
*   **Processing**: `POST /api/projects/:folder/process` - Queue thumbnail/preview generation
*   **Analysis**: `POST /api/projects/:folder/analyze-files` - Pre-upload file analysis
*   **Assets**: 
    *   `GET /api/projects/:folder/thumbnail/:filename` - Thumbnail serving (honors `photos.visibility`; public assets stream without auth, private assets require admin session)
    *   `GET /api/projects/:folder/preview/:filename` - Preview serving (same visibility rules as thumbnails)
    *   `POST /api/projects/:folder/download-url` - Mint signed URLs for originals
    *   `GET /api/projects/:folder/file/:type/:filename` - Download originals (requires token)
    *   `GET /api/projects/:folder/files-zip/:filename` - Download ZIP (requires token)
    
#### Dev Tips: Paginated Photos

Example:

```bash
curl -s "http://localhost:5000/api/projects/p123/photos?limit=100&cursor=0&sort=filename&dir=ASC" | jq .
```

Response shape:

```json
{
  "items": [ { "filename": "IMG_0001.JPG", "jpg_available": true, ... } ],
  "total": 1245,
  "unfiltered_total": 2650,
  "nextCursor": "eyJ0YWtlbl9hdCI6ICIyMDI1LTA5LTIzVDEyOjAwOjAwWiIsICJpZCI6IDEyMzQ1fQ==",
  "prevCursor": "eyJ0YWtlbl9hdCI6ICIyMDI1LTA5LTIzVDEzOjAwOjAwWiIsICJpZCI6IDEyMzQwfQ==",
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
    * `POST /api/projects/:folder/commit-changes` - Apply current intent by moving non‑kept files to `.trash` (project-scoped)
    * `POST /api/projects/:folder/revert-changes` - Reset intent to current availability (project-scoped, non‑destructive)
    * `POST /api/photos/commit-changes` - Apply current intent across multiple projects (global)
    * `POST /api/photos/revert-changes` - Reset intent to current availability across multiple projects (global, non‑destructive)
    * `GET /api/photos/pending-deletes` - Get aggregated pending deletion counts across all projects
*   **Config**: `GET/POST /api/config`, `POST /api/config/restore` - Configuration management

#### Configuration lifecycle (merge behavior)

- The server merges missing keys from `config.default.json` into your `config.json` on boot and when handling `POST /api/config` (see `server/services/config.js`).
- If new defaults are introduced, they will be appended to `config.json` on first run after upgrade. This persistence is expected and helps keep config current.

### Real-time Features

#### Job Updates SSE
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

#### Pending Changes SSE
*   **Real-time Toolbar Updates**: `GET /api/sse/pending-changes` - Live pending changes status per project
*   **Purpose**: Drives commit/revert toolbar visibility in real-time across all browser tabs
*   **Architecture**: Server-Sent Events stream that broadcasts boolean flags per project indicating if pending changes exist (mismatches between availability and keep flags)
*   **Data Format**: `{ "p15": true, "p7": false, ... }` where `true` indicates the project has photos marked for deletion
*   **Auth Guard**: The route is protected by the shared `authenticateAdmin` middleware (`server.js`) so only authenticated admins can subscribe. The frontend opens the stream with `EventSourcePolyfill` (`client/src/hooks/usePendingChangesSSE.js`) which attaches the bearer token and `withCredentials` for cookie fallback, keeping behaviour consistent with the rest of the admin APIs.
*   **Trigger**: Automatically broadcasts updates when keep flags are modified via `PUT /api/projects/:folder/keep`
*   **Client Integration**: 
    - Frontend hook `usePendingChangesSSE()` maintains connection and state
    - `usePendingDeletes()` hook consumes SSE data to determine toolbar visibility
    - All Photos mode: Toolbar shows if ANY project has pending changes
    - Project mode: Toolbar shows if THAT specific project has pending changes
*   **Benefits**: Instant feedback, multi-tab synchronization, no polling overhead, simplified client logic

### All Photos (cross-project)

*   `GET /api/photos` — Keyset-paginated list across all non-archived projects
    - Query: `?limit&cursor&date_from&date_to&file_type&keep_type&orientation&tags&include=tags`
      - `limit`: default 200, max 300
      - `file_type`: `any|jpg_only|raw_only|both`
      - `keep_type`: `any|any_kept|jpg_only|raw_jpg|none`
      - `orientation`: `any|vertical|horizontal`
      - `tags`: comma-separated list of tags to filter by (e.g., `portrait,-rejected` includes photos with 'portrait' tag and excludes those with 'rejected' tag)
      - `include=tags`: optionally include tag names for each photo
    - Returns: `{ items, total, unfiltered_total, next_cursor, prev_cursor, limit, date_from, date_to }`
    - Headers: `Cache-Control: no-store`

*   `GET /api/photos/locate-page` — Locate and return the page that contains a specific photo
    - Required: `project_folder` and one of `filename` (full, with extension) or `name` (basename without extension)
    - Optional: `limit` (1–300, default 100), `date_from`, `date_to`, `file_type`, `keep_type`, `orientation`, `tags`, `include=tags`
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

*   `GET /api/photos/all-keys` — Get all photo keys matching filters (for "Select All" functionality)
    - Query: Same filter parameters as `/api/photos` (`date_from`, `date_to`, `file_type`, `keep_type`, `orientation`, `tags`, `visibility`, `public_link_id`, `sort_by`, `sort_dir`)
    - Returns: `{ keys: string[], total: number }`
      - `keys`: Array of composite keys in format `"project_folder::filename"`
      - `total`: Total count of matching photos
    - Behavior:
      - Lightweight query returning only photo identifiers without metadata
      - Used by frontend "Select All" to select all filtered photos across pagination
      - Reuses existing filter logic from `listAll()` for consistency
      - No pagination - returns all matching keys in a single response
    - Performance: ~200KB response for 10,000 photos, <200ms query time
    - Headers: `Cache-Control: no-store`; rate-limited at 60 req/min per IP

### Image-scoped Endpoints (Universal)

These endpoints operate on photos by their unique `photo_id` regardless of which project they belong to, enabling cross-project operations:

*   `POST /api/photos/tags/add` — Add tags to photos
    - Body: `{ items: [{ photo_id: number, tags: string[] }], dry_run?: boolean }`
    - Returns: `{ updated: number, errors?: Array<{ photo_id, error }>, dry_run?: { updated: number, per_item?: any[] } }`
    - Behavior: Creates missing tags in each photo's project context and associates them with the photo

*   `POST /api/photos/tags/remove` — Remove tags from photos
    - Body: Same shape as add endpoint
    - Returns: Same shape as add endpoint
    - Behavior: Removes tag associations without deleting the tags themselves

*   `POST /api/photos/keep` — Update keep flags for photos
    - Body: `{ items: [{ photo_id: number, keep_jpg?: boolean, keep_raw?: boolean }], dry_run?: boolean }`
    - Returns: `{ updated: number, errors?: [...], dry_run?: {...} }`
    - Behavior: Updates keep flags and emits SSE `type: "item"` events with updated values

*   `POST /api/photos/process` — Process derivatives for photos
    - Body: `{ items: [{ photo_id: number }], dry_run?: boolean, force?: boolean }`
    - Returns: `{ message: 'Processing queued', job_count: number, job_ids: string[], errors?: [...] }`
    - Behavior: Groups photos by project and enqueues `generate_derivatives` jobs
    - Status: 202 Accepted

*   `POST /api/photos/move` — Move photos to a different project
    - Body: `{ items: [{ photo_id: number }], dest_folder: string, dry_run?: boolean }`
    - Returns: `{ message: 'Move queued', job_count: number, job_ids: string[], destination_project: {...}, errors?: [...] }`
    - Behavior: Groups photos by source project and enqueues `image_move` jobs
    - Status: 202 Accepted

#### Deep Link Stability

*   **URL as source of truth**: Deep links like `/all/p6/DSC02415` reliably open the exact target photo without redirects
*   **Session storage conflicts resolved**: Removed viewer state persistence that was overriding deep link targets
*   **Deterministic backend resolution**: The `locate-page` API resolves basename collisions predictably
*   **Client URL suppression**: Brief URL update blocking during deep link resolution prevents premature redirects

### Virtualized Grid & Pagination Model

The grid is built for very large datasets with stable scroll and bidirectional pagination.

- **Virtualized rows**: `client/src/components/VirtualizedPhotoGrid.jsx` computes justified rows based on measured container width and per-item aspect ratios derived from EXIF metadata. This eliminates layout shifts and minimizes overdraw. Cells are lazily hydrated using a single `IntersectionObserver` with a short dwell to avoid flicker. **Eager loading buffer (2025-01-05)**: The grid uses configurable off-screen buffers (default: 1 full viewport height) to ensure images and pagination load well before visibility, providing seamless scrolling with no visible "pop-in" effects. Buffer size is controlled via `config.json` (`photo_grid.eager_load_buffer_vh`, default: 100).
- **Pagination strategy**: The client uses a windowed pager (`client/src/utils/pagedWindowManager.js`) that keeps a small number of pages in memory and evicts from head/tail as you scroll. It supports both forward (`cursor`) and backward (`before_cursor`) keyset pagination and automatically updates outer cursors when pages are added or evicted.
- **Scroll anchoring & guards**: `VirtualizedPhotoGrid.jsx` captures a visible cell before pagination (`findScrollAnchor`) and restores it after new data renders, combining double `requestAnimationFrame` with `restoreScrollAnchor()` so the viewport stays stable. A lightweight state machine (`paginationStatus`, `pendingLoadRef`, guard refs) gates `onLoadPrev`/`onLoadMore`, while manual “Load Previous/More” buttons provide accessible fallbacks alongside the intersection-observed sentinel.
- **Cursors**: The server returns base64 cursors encoding `{ taken_at, id }` in DESC order by `taken_at := coalesce(date_time_original, created_at), id`. Responses include both `nextCursor`/`prevCursor` (project) and `next_cursor`/`prev_cursor` (all-photos) depending on endpoint.
- **Server-side filtering**: Both All Photos and Project views accept identical filters: `date_from`, `date_to`, `file_type`, `keep_type`, `orientation`. The backend returns both `total` (filtered) and `unfiltered_total` so the UI can render "X of Y" consistently.
- **Shared pagination hooks**: `client/src/hooks/useProjectPagination.js` and `client/src/hooks/useAllPhotosPagination.js` turn UI state into API calls, stripping `"any"` sentinel values before sending filters. They expose `mutatePagedPhotos()` / `mutateAllPhotos()` so optimistic keep/move/commit flows stay in sync without full reloads.
- **Deep links**: The All Photos locate API (`GET /api/photos/locate-page`) returns the exact page containing a target along with `idx_in_items`. The client opens the viewer at that index and centers the target row in the grid. When locate fails, the client falls back to sequential paging until the target enters the window.
- **State preservation**: Scroll positions and open viewer are preserved across background updates and refetches. See “Session-only UI State Persistence” for details.

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
- `PATCH /api/projects/:folder/rename` → `{ message, project: { name, folder, created_at, updated_at } }`

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
│   ├── App.jsx              # Optimized main component (~1175 lines, 57% reduction)
│   ├── components/          # Modular UI components
│   │   ├── VirtualizedPhotoGrid.jsx # Custom virtualization + justified grid
│   │   ├── PhotoViewer.jsx  # Full-screen photo viewer
│   │   ├── MainContentRenderer.jsx # Centralized photo display logic
│   │   ├── CommitRevertBar.jsx # Bottom persistent bar
│   │   ├── SortControls.jsx # Reusable sort buttons
│   │   ├── CommitModal.jsx  # Commit confirmation modal
│   │   ├── RevertModal.jsx  # Revert confirmation modal
│   │   ├── CreateProjectModal.jsx # Project creation modal
│   │   ├── UploadArea.jsx   # Drag & drop upload interface
│   │   └── ProcessesPanel.jsx # Job monitoring UI
│   ├── hooks/               # Specialized React hooks (20+ hooks)
│   │   ├── useAppState.js   # Centralized state management
│   │   ├── useAppInitialization.js # App initialization logic
│   │   ├── usePhotoDeepLinking.js # Photo viewer deep linking
│   │   ├── useScrollRestoration.js # Scroll position management
│   │   ├── useModeSwitching.js # All Photos vs Project mode
│   │   ├── useFilterCalculations.js # Active filter calculations
│   │   ├── useCommitBarLayout.js # Commit bar layout logic
│   │   ├── usePendingDeletes.js # Pending deletes calculations
│   │   ├── useAllPhotosRefresh.js # All Photos refresh logic
│   │   ├── useCommitRevert.js # Commit/revert operations
│   │   ├── useUrlSync.js    # URL synchronization
│   │   └── ... (additional specialized hooks)
│   ├── services/            # Business logic services
│   │   ├── ProjectDataService.js # Project data operations
│   │   └── EventHandlersService.js # Event handling logic
│   ├── api/                 # Backend API client modules
│   │   ├── projectsApi.js   # Project-related API calls (includes getConfig)
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
│   │   ├── photosRepo.js    # Photo metadata management (modular interface)
│   │   ├── photoCrud.js     # Photo CRUD operations module
│   │   ├── photoFiltering.js # Photo filtering and listing module
│   │   ├── photoPagination.js # Photo pagination logic module
│   │   ├── photoPendingOps.js # Photo pending operations module
│   │   ├── photoQueryBuilders.js # SQL query construction utilities
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

## Testing

### Test Suite

The project includes comprehensive tests using Node.js' built-in test runner:
- **Location**: `server/routes/__tests__/` and `server/services/__tests__/`
- **Run**: `npm test`
- **Coverage**: 63/63 tests passing (100%)

### Test Infrastructure

**Database Configuration**:
- Uses same database as development (`.db/user_0.sqlite`)
- `busy_timeout = 30000` (30 seconds) to handle concurrent operations
- `wal_autocheckpoint = 100` for frequent WAL checkpoints
- Tests run sequentially (`concurrency: false`) to avoid race conditions

**Test Cleanup**:
- Shared fixture tracker (`server/tests/utils/dataFixtures.js`) registers created projects, public links, and filesystem folders.
- `fixtures.cleanup()` centralizes teardown for DB rows and `.projects/user_0/*` folders with retry logic (5 attempts, exponential backoff) to handle `SQLITE_BUSY`/`SQLITE_BUSY_SNAPSHOT` errors.
- Cleanup runs on demand within suites (before reseeding) and in final `after()` hooks; suites retain a 100 ms `afterEach()` delay to avoid lock contention.
- WAL checkpoint (`db.pragma('wal_checkpoint(TRUNCATE)')`) executes inside the shared cleanup helper before deletion.

**Test Data**:
- Projects created with unique names: `Test Project ${Date.now() + Math.random()}`
- Folders placed in `.projects/user_0/` (user-scoped)
- Fixture tracker automatically removes all tracked folders after tests complete

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- server/routes/__tests__/publicLinks.test.js

# Check for remaining test folders
ls -la .projects/user_0/ | grep "Test Project"
```

### Test Best Practices

1. **Always track created resources** in `createdData` arrays
2. **Use unique names** to avoid collisions between tests
3. **Clean up in teardown** via `after()` and `afterEach()` hooks
4. **Handle SQLITE_BUSY** with retry logic and delays
5. **Run sequentially** for database-heavy test suites

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
