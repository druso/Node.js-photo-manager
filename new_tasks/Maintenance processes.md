# Maintenance Processes (Per Project)

This document defines the maintenance functions to run per project, how they map to durable jobs, priorities, schedules, and developer implementation steps.

## Overview

Maintenance functions are implemented as high‑priority, idempotent jobs in the existing SQLite‑backed queue (`jobs`, `job_items`). They run per project and operate on the on‑disk project folder plus the DB state.

Jobs:
- trash_maintenance
- manifest_check
- folder_check
- manifest_cleaning
- commit_changes (user‑invoked endpoint that triggers the other three)

## Paths and Sources of Truth

- Project folders root: `server/routes/*` use `PROJECTS_DIR = <repoRoot>/.projects/`.
- Per project folder: `/.projects/<project_folder>/` as returned by `projectsRepo.getByFolder()`.
- DB schema: `server/services/db.js` tables `projects`, `photos`, `jobs`, `job_items`.
- Accepted file types: `config.json → uploader.accepted_files` (extensions + mime_prefixes).

## Job Specifications

### 1) trash_maintenance
- Ensure `.trash/` exists under the project folder.
- Delete files with `mtime >= 24h` (hourly run; batch traversal, no per‑file timers).
- Priority: highest. Schedule: hourly. Idempotent.
- Logging: console summary: deleted count; errors per file but continue.

### 2) manifest_check
- For each photo row (`photos`), recompute `jpg_available`, `raw_available`, `other_available` by checking existence of files on disk under the project dir:
  - JPG: `<basename>.jpg|jpeg`
  - RAW: any supported RAW extension in config
  - OTHER: any accepted non‑jpg/non‑raw
- If mismatch, update the row; print an alert per change.
- Priority: high. Schedule: every 6h. Idempotent.

### 3) folder_check
- Scan the project folder for files not accounted for in `photos` by `basename`.
- If accepted image by uploader rules:
  - Enqueue the same path used after uploads: `jobsRepo.enqueueWithItems(type: 'upload_postprocess', payload: { filenames })` so processing is uniform.
- If not accepted, move to `.trash/` and log an alert with reason.
- Priority: high. Schedule: every 6h (stagger from manifest_check). Idempotent.

### 4) manifest_cleaning
- Delete photo rows where both `jpg_available = 0` AND `raw_available = 0`.
- Priority: medium‑high. Schedule: daily.
- Log: count of removed rows.

### 5) commit_changes (endpoint‑initiated)
- API: `POST /api/projects/:folder/commit-changes`
- For each photo:
  - If `keep_jpg = 0` and `jpg_available = 1`, move the JPG file to `.trash/` and set `jpg_available = 0`.
  - If `keep_raw = 0` and `raw_available = 1`, move the RAW file to `.trash/` and set `raw_available = 0`.
- Persist updates in a transaction per batch.
- After committing, enqueue high‑priority `manifest_check`, `folder_check`, `manifest_cleaning` for the same project to reconcile.
- Response: `{ batchJobId?, enqueued: [...], updatedCount }` (if implemented as a job, return job id; otherwise return a simple JSON summary and separate enqueues).

## Scheduling

- Use the existing worker and queue; add a lightweight scheduler that enqueues jobs per project at intervals:
  - trash_maintenance: hourly
  - manifest_check: every 6h
  - folder_check: every 6h (offset by +30m vs manifest_check)
  - manifest_cleaning: daily
- Tag jobs: `maintenance`, `project:<id>`.
- Set highest priority by picking maintenance jobs first in `jobsRepo.claimNext()` (e.g., sort by priority column if added; otherwise, encode via `type` ordering or enqueue timestamp).

## Developer Tasks (Step‑by‑Step)

1. Schema/Repo
   - Add optional `priority` INTEGER to `jobs` and index `(status, priority DESC, created_at ASC)`.
   - Update `jobsRepo.enqueue*(...)` to default maintenance jobs to high priority.

2. Worker Dispatch
   - Create `server/services/workers/maintenanceWorker.js` exporting:
     - `runTrashMaintenance(job, ctx)`
     - `runManifestCheck(job, ctx)`
     - `runFolderCheck(job, ctx)`
     - `runManifestCleaning(job, ctx)`
   - In `workerLoop.js`, route job.type to the above.

3. Shared Utilities
   - Add `server/services/fsUtils.js` with helpers:
     - `ensureProjectDirs(projectFolder)` (creates `.thumb`, `.preview`, `.trash`).
     - `moveToTrash(projectFolder, relPath)` using `fs.rename` within same device.
     - `listAcceptedFiles(projectFolder, acceptPredicate)`.
     - `statMtimeSafe(fullPath)`.

4. Config
   - Reuse `getConfig()` for accepted types. Add `maintenance` config if needed (e.g., deletion threshold hours, schedules).

5. Routes
   - Add `server/routes/maintenance.js` with `POST /api/projects/:folder/commit-changes`.
   - Inside: resolve project by folder via `projectsRepo.getByFolder`, execute commit logic in a service, then enqueue the three maintenance jobs.

6. Scheduling
   - Add `server/services/scheduler.js` (in‑process interval) to periodically enqueue maintenance jobs for every project.
   - Optional: persist next‑run timestamps to avoid duplicate enqueues across restarts.

7. Logging/Alerts
   - Use console + SSE job updates; include counts of changes/moves/deletes.

8. Tests
   - Unit test each worker with a temp directory, fake DB rows, and verify state transitions and file operations.

## Acceptance Criteria
- Endpoints exist and enqueue jobs correctly; jobs visible in Processes UI.
- Re‑running jobs is safe and yields the same end state.
- Non‑accepted files are quarantined in `.trash/`, and `.trash` is cleaned within 24h.
- `keep_*` flags are respected by `commit_changes` and reflected in DB.
