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
- Tailwind CSS v4 note: deprecated `bg-opacity-*` utilities have been migrated to the new alpha color syntax (e.g., `bg-black/40`). If you add new styles, prefer `color/opacity` notation over legacy opacity utilities.
- **Backend**: Node.js with Express and SQLite
- **Image Processing**: Sharp library for high-performance processing

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
- **Drag & Drop Upload**: Intuitive file upload interface
- **Keyboard Shortcuts**: Fast navigation and actions
- **Secure Asset Serving**: Signed URLs for photo access; destructive endpoints are rate-limited

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
  - Dev defaults include: `http://localhost:{5173,3000,5000}` and `http://127.0.0.1:{5173,3000,5000}` (see `server.js`).

### Logging

- Backend uses structured JSON logs via `server/utils/logger2.js`. Levels: `error`, `warn`, `info`, `debug`.
- Each entry includes component (`cmp`), event (`evt`), and context (e.g., `project_id`, `project_folder`, `project_name`).
- **`LOG_LEVEL`** (default: `info`) controls verbosity.
- SSE limits for DoS hardening:
  - **`SSE_MAX_CONN_PER_IP`** (default: `2`)
  - **`SSE_IDLE_TIMEOUT_MS`** (default set in code)

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
