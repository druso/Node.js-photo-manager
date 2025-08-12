# Node.js Photo Manager

This is a photo management application with a Node.js backend and a React (Vite) frontend.

## Getting Started

### Prerequisites

- Node.js (v22 LTS required)
- npm (v10 or newer)

### Installation

1.  **Backend Dependencies:**
    Navigate to the project's root directory and run:
    ```bash
    npm install
    ```

2.  **Frontend Dependencies:**
    Navigate to the `client` directory and run:
    ```bash
    cd client
    npm install
    ```

### Running the Application

You need to have two terminals open to run both the backend and frontend servers concurrently.

1.  **Start the Backend Server:**
    In the project's root directory, run one of:
    ```bash
    npm start         # plain Node (recommended during testing)
    # or
    npm run dev       # nodemon auto-restarts on backend file changes
    ```
    The backend runs on `http://localhost:5000`.

2.  **Start the Frontend (Vite) Dev Server:**
    In a separate terminal, navigate to the `client` directory and run:
    ```bash
    npm run dev       # Vite dev server on http://localhost:3000
    ```
    Additional scripts:
    ```bash
    npm run build     # production build to dist/
    npm run preview   # preview the production build on http://localhost:3000
    ```
    The Vite dev server proxies `/api/*` to `http://localhost:5000` as configured in `client/vite.config.js`.

## Data Storage (SQLite)

- The backend now uses SQLite via `better-sqlite3` instead of manifest.json.
- DB file location: `server/services/db.js` controls initialization; the DB is created in the project data directory (see that file for details).
- Repositories:
  - `server/services/repositories/projectsRepo.js`
  - `server/services/repositories/photosRepo.js`
  - `server/services/repositories/tagsRepo.js`
  - `server/services/repositories/photoTagsRepo.js`
- WAL and foreign keys are enabled. Tables: `projects`, `photos`, `tags`, `photo_tags` with appropriate indexes and FKs.
- For schema details and API usage, see `SQL MIGRATION PLAN.md` and the repository modules above.

## Security

This project uses short‑lived signed URLs for downloads by default. For details, configuration, and future hardening guidance (auth and packaging), see [`SECURITY.md`](SECURITY.md).

## Background Jobs (Queue) Overview

The app processes work asynchronously using a durable, SQLite‑backed queue. This powers tasks like scanning, thumbnail and preview generation, and future processors.

- __Core pieces__
  - `server/services/db.js` — DB init, WAL + FKs.
  - `server/services/repositories/jobsRepo.js` — CRUD for `jobs` and `job_items`.
  - `server/services/workerLoop.js` — long‑running loop that picks next job, runs workers, updates progress, emits SSE.
  - `server/services/workers/derivativesWorker.js` — example worker generating thumbnails/previews.
  - `server/services/events.js` — in‑process emitter for job updates; SSE subscribes to this.

- __SSE live updates__
  - Endpoint: `GET /api/jobs/stream` (see `server/routes/jobs.js`).
  - Emits JSON events containing job fields (status, progress, etc.).
  - Frontend subscribes in `client/src/api/jobsApi.js` and merges events in `ProcessesPanel.jsx` and `App.jsx` to refresh UI.

- __Job API endpoints__ (see `server/routes/jobs.js`)
  - `POST /api/projects/:folder/jobs` → enqueue a job.
  - `GET /api/projects/:folder/jobs` → list jobs for project (filters: status, type, limit/offset).
  - `GET /api/jobs/:id` → job detail (includes `items_summary`).
  - `GET /api/jobs/stream` → Server‑Sent Events for live updates.

- __Upload processing entry point__
  - After a successful upload `POST /api/projects/:folder/upload` (`server/routes/uploads.js`), the server enqueues an `upload_postprocess` job with the uploaded basenames.
  - Manual/forced derivatives are triggered via `POST /api/projects/:folder/process`, which enqueues a `generate_derivatives` job.
  - Worker dispatch for both types is handled in `server/services/workerLoop.js`, delegating to `server/services/workers/derivativesWorker.js`.

- __UI__
  - Unified right‑docked panel (`SettingsProcessesModal.jsx`) with tabs for Settings and Processes.
  - Processes tab shows live job list with progress; on terminal states it refreshes to reflect ordering and completion.
  - `App.jsx` triggers a project data refresh on job completion so new thumbnails/previews appear.

### Reliability (Phase 4)

- __Heartbeat__: while a job is running, the worker updates `jobs.heartbeat_at` every `pipeline.heartbeat_ms`.
- __Stale detection__: jobs stuck in `running` with expired heartbeat are re‑queued (`pipeline.stale_seconds`).
- __Retry__: jobs track `attempts` and honor `max_attempts_default` (or per‑job `max_attempts`). On failure, they requeue until attempts reach the limit, then become `failed` with `error_message/last_error_at`.
- __Crash recovery__: on each loop tick, stale `running` jobs are requeued automatically.

Config keys in `config.json` → `pipeline`:

```json
{
  "pipeline": {
    "max_parallel_jobs": 1,
    "max_parallel_items_per_job": 1,
    "heartbeat_ms": 1000,
    "stale_seconds": 60,
    "max_attempts_default": 3
  }
}
```

### Adding a New Job Type (Developer Guide)

1. __Define the worker__
   - Create `server/services/workers/<yourWorker>.js` exporting an async `run(job, jobsRepo, emit)` that:
     - Iterates items (if any) and updates `progress_done/total` via `jobsRepo.updateProgress(id, done, total)`.
     - Emits `emitJobUpdate({ id, status, progress_* ... })` at key points.
     - Sets final status to `completed` or `failed`.

2. __Register dispatch__
   - In `server/services/workerLoop.js`, route `job.type` to your worker.

3. __Enqueue__
   - From the frontend, call `POST /api/projects/:folder/jobs` with `{ type: 'your_type', payload: { ... } }`.
   - If your job operates per‑file, pass `payload.filenames` to create `job_items` automatically.

4. __Reflect fields to UI (optional)__
   - Extend `ProcessesPanel.jsx` render logic for your job type (labels, badges).
   - If it affects thumbnails/previews, ensure `App.jsx` refresh trigger covers your status.

5. __Schema changes (if needed)__
   - If you need job‑specific columns, prefer adding to `job_items.payload_json` or `jobs.payload_json` first.
   - For structural DB changes, update `server/services/db.js`, repositories, and `SCHEMA_DOCUMENTATION.md`.

### Debugging Checklist

- __SSE not updating__
  - Check `/api/jobs/stream` with `curl -i`; should return `text/event-stream` and a `data: {"type":"hello"}`.
  - Verify `server/routes/jobs.js` has `router.get('/jobs/:id(\\d+)')` so it doesn’t catch `/jobs/stream`.
  - Confirm Vite proxy forwards `/api` to `:5000` (`client/vite.config.mjs`).

- __Jobs not progressing__
  - Inspect server logs: worker loop prints actions when starting jobs.
  - Inspect DB with `sqlite3` to view `jobs`/`job_items` status and progress fields.
  - Ensure `emitJobUpdate` is called in workers and `workerLoop` on state transitions.

- __Thumbnails/preview not appearing__
  - Confirm files on disk: `.projects/<folder>/.thumb/<filename>.jpg` and `.preview/`.
  - Check `photos.thumbnail_status`/`preview_status` in DB for `generated` vs `pending/failed`.

### References

- `WORKER PIPELINE.md` — overall pipeline design, schema and phases.
- `SCHEMA_DOCUMENTATION.md` — DB schema including job tables.

## CI

- GitHub Actions workflow: `.github/workflows/ci.yml`
- Uses Node 22, runs `npm ci`, and performs a production audit (`npm audit --omit=dev`).
- Ensure local development matches CI by using Node 22. You can use nvm:
  ```bash
  nvm install 22
  nvm use 22
  ```

## Frontend (Vite) Note

- Frontend uses Vite with `@vitejs/plugin-react`.
- Entry point: `client/index.html` -> `src/main.jsx` -> `src/App.jsx` and components (`.jsx`).
- Dev server: `http://localhost:3000` with proxy to backend on `http://localhost:5000`.
- If you see JSX parse overlays, ensure JSX files use `.jsx` and clear Vite cache: `rm -rf client/node_modules/.vite`.

## Schema Documentation

The legacy manifest.json schema is retained in [`SCHEMA_DOCUMENTATION.md`](SCHEMA_DOCUMENTATION.md) for reference, but the application now uses a normalized SQLite schema. See the new "SQLite Schema Overview" section in that document and `SQL MIGRATION PLAN.md`.

## Troubleshooting

- **Port 5000 in use**: kill old processes
  ```bash
  lsof -i :5000 -t | xargs -r kill
  lsof -i :5000 -t | xargs -r kill -9
  pkill -f "nodemon|node server.js" || true
  ```
- **Vite cache issues**: clear and restart
  ```bash
  rm -rf client/node_modules/.vite
  (cd client && npm run dev)
  ```

## Frontend Manual Test Checklist

- __Projects list__: can list, create, select, and delete projects.
- __Upload__: select JPG/RAW files and upload; list updates without reload.
- __Derivatives__: after upload, click process (if present) and verify thumbnails/previews load.
- __Tags__: add/remove tags and check they persist on refresh.
- __Keep flags__: toggle keep_jpg/keep_raw and verify state persists.

If the frontend dev server is running on `http://localhost:3000` and backend on `http://localhost:5000`, the UI should function end-to-end without extra configuration.
