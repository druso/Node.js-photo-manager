# Tasks and Jobs Orchestration

Author: Cascade
Status: Approved plan (ready to implement)
Scope: Backend + Frontend + Docs

Goal: Introduce first-class Tasks to orchestrate ordered Jobs, drive user relevancy at the task level, and fix inconsistencies around upload processing and commit changes. Ensure JPG removal updates manifest/UI immediately (thumbnail/preview statuses set to "missing").

---

## Core Principles

- __Task-first__: A Task is a user/system intent composed of ordered Jobs. Three core tasks:
  - `upload_postprocess` (Upload): update manifest and generate derivatives after files are uploaded.
  - `change_commit` (Commit changes): remove files, then run reconciliation (manifest/folder checks, cleaning) to align quickly.
  - `maintenance` (Maintenance): scheduler-initiated reconciliation to keep consistency.
- __Task-level user relevancy__: The UI filters by `task.user_relevant` instead of per-job `source`. All jobs in a user task are visible in that task group by default.
- __Orchestrated sequencing__: A Task definition enumerates steps (jobs) and priorities, executed in order.
- __Idempotency__: Workers compute work from DB as needed (e.g., `file_removal`).
- __Immediate UI correctness__: After JPG removal, set `thumbnail_status` and `preview_status` to `missing` and emit item-level SSE so the UI stops rendering removed assets.

---

## Execution Plan (post-revert)

All changes below are planned to be (re)implemented after the revert. Treat every item as actionable work.

- __Re-add file removal flow__
  - Implement `file_removal` worker and wire dispatch in `workerLoop`.
  - Commit route enqueues `file_removal` as a user task with `{ task_id, task_type: 'change_commit', source: 'user' }`.

- __Enrich SSE events__
  - Include `source`, `task_id`, and `task_type` on job SSEs.
  - Emit item-level SSE for derivatives work; keep thumbnail probing disabled; ensure cache-busting on final images.

- __Two-lane worker pipeline__
  - Reinstate priority + normal lanes; config keys `pipeline.priority_lane_slots`, `pipeline.priority_threshold`.

- __Tasks orchestrator + definitions__
  - Add lightweight `tasksOrchestrator.js` and `task_definitions.json`.
  - Orchestrate steps for `upload_postprocess`, `change_commit`, and `maintenance`.

- __Upload flow as a Task__
  - Immediately start `upload_postprocess` Task after successful upload; first step itemizes uploaded basenames; then `manifest_check` → `folder_check`.

- __Commit flow details__
  - In `file_removal`, when JPGs are removed, set `thumbnail_status`/`preview_status` to `missing` and emit item-level SSE.
  - Afterward enqueue reconciliation steps within same `task_id`: `manifest_check`, `folder_check`, `manifest_cleaning`.

- __Frontend Processes panel__
  - Group by `task_id`, default to user-relevant tasks, show all jobs within user tasks, and display completion toasts.

- __Optional config/UI__
  - Toggle to include/exclude maintenance tasks; server supports `?show_maintenance=true|false`.


---

## Phase 1 (This sprint): Orchestrate with Definitions + Keep Jobs Table

We will keep job orchestration in code + a `task_definitions.json` file and continue to store jobs in `jobs`. We'll introduce a lightweight orchestrator that advances through steps. A persistent `tasks` table comes in Phase 2.

### Task Definitions (config file)

`server/services/task_definitions.json`:
```json
{
  "upload_postprocess": {
    "label": "Upload Post-Process",
    "user_relevant": true,
    "steps": [
      { "type": "upload_postprocess", "priority": 90 },
      { "type": "manifest_check", "priority": 95 },
      { "type": "folder_check", "priority": 95 }
    ]
  },
  "change_commit": {
    "label": "Commit Changes",
    "user_relevant": true,
    "steps": [
      { "type": "file_removal", "priority": 100 },
      { "type": "manifest_check", "priority": 95 },
      { "type": "folder_check", "priority": 95 },
      { "type": "manifest_cleaning", "priority": 80 }
    ]
  },
  "maintenance": {
    "label": "Maintenance",
    "user_relevant": false,
    "steps": [
      { "type": "manifest_check", "priority": 95 },
      { "type": "folder_check", "priority": 95 },
      { "type": "manifest_cleaning", "priority": 80 }
    ]
  }
}
```

### Orchestrator (lightweight)

- `tasksOrchestrator.js` exports:
  - `startTask({ project_id, type, label?, user_relevant?, source })` → returns `{ task_id, type }`; enqueues first step with `task_id`.
  - `onJobCompleted(job)` → looks up definition by `job.task_type` and enqueues next step with same `task_id` until done.
- Until Phase 2, task state is ephemeral (steps advance via `jobs` completions). We still include `task_id`/`task_type` on jobs and SSE.

Implementation tip: Wire `onJobCompleted(job)` from `workerLoop` after a job transitions to `completed`.

### Upload flow (trigger immediately after upload)

- In `server/routes/uploads.js`, after successful save of at least one file:
  - `startTask({ type: 'upload_postprocess', source: 'user', project_id })`.
  - First step runs `upload_postprocess` with items (uploaded basenames), then `manifest_check`, then `folder_check`.

### Change commit

- `POST /api/projects/:folder/commit-changes` → `startTask({ type: 'change_commit', source: 'user', project_id })`.
- Steps:
  - `file_removal` (worker computes work from DB). When removing JPGs: set `thumbnail_status` and `preview_status` to `missing` and emit item-level SSE.
  - `manifest_check`, `folder_check`, `manifest_cleaning`.

### Maintenance

- Scheduler uses `startTask({ type: 'maintenance', source: 'maintenance', project_id })` to run reconciliation steps.

### Two-lane pipeline compatibility

- Steps carry `priority` and will respect the two-lane pipeline (priority lane first) already in place per config.

---

## Phase 2: Persistent Tasks Table and /tasks API

Add durable aggregation and task-level SSE.

### Table `tasks` (instances)

- Columns: `id (uuid)`, `tenant_id`, `project_id`, `type`, `label`, `user_relevant (bool)`, `source ('user'|'maintenance')`, `status ('queued'|'running'|'completed'|'failed'|'canceled')`, `step_index`, `created_at`, `started_at`, `finished_at`.
- Jobs reference `task_id`; job `source` becomes deprecated (derive from task).

### API

- `POST /api/projects/:folder/tasks { type }` → start task.
- `GET /api/projects/:folder/tasks` → list with filters (`type`, `status`, `user_relevant`).
- SSE: emit `task_update` events: `{ id, type, label, status, step_index, user_relevant }`.

---

## Backend Changes (Phase 1)

- __Jobs schema__: already extended (`source`, `task_id`, `task_type`). Keep writing these; UI will pivot to tasks later.
- __Orchestrator__: add `server/services/tasksOrchestrator.js`, wire into uploads/commit/scheduler routes and job completion.
- __fileRemovalWorker__: when removing JPGs, set `thumbnail_status='missing'`, `preview_status='missing'`; emit item-level SSE mirroring derivatives worker; ensure `updated_at` changes for cache-busting.

---

## Step-by-Step for Next Developer (Do This Next)

1) __Create definitions file__ `server/services/task_definitions.json`
   - Use the JSON shown above (three tasks, with priorities).

2) __Add orchestrator__ `server/services/tasksOrchestrator.js`
   - Expose `startTask({ project_id, type, source })` and `onJobCompleted(job)`.
   - Read definitions, enqueue first/next job with `{ task_id, task_type: type, source }` and step `priority`.

3) __Wire orchestrator entry points__
   - `server/routes/uploads.js`: after at least one file saved, call `startTask('upload_postprocess')` with items (filenames) on the first step via `enqueueWithItems`.
   - `server/routes/maintenance.js` Commit: replace direct enqueue (if any remains) with `startTask('change_commit')`.
   - `server/services/workerLoop.js`: after marking a job `completed`, call `tasksOrchestrator.onJobCompleted(job)` to enqueue the next step if any.

4) __fileRemovalWorker enhancements__ `server/services/workers/fileRemovalWorker.js`
   - After moving JPG originals to `.trash`, delete their derivatives; set `thumbnail_status='missing'` and `preview_status='missing'` in DB and emit item-level SSE for each affected basename.
   - Ensure idempotency when files already missing; log items and continue.

5) __Jobs API filter (optional)__ `server/routes/jobs.js`
   - Support `?show_maintenance=true|false` (default false in server config) to filter by `source`.

6) __Frontend grouping + toasts__
   - `client/src/components/ProcessesPanel.jsx`: group rows by `task_id`, show task label from `task_type` mapping, collapse child maintenance by default for user tasks.
   - Toasts (use existing provider): on task completion (`all child jobs completed` within a `task_id` group) show:
     - `change_commit`: "Files removed"
     - `upload_postprocess`: "Upload processing completed"

7) __Config__
   - `config.default.json`: optional `ui.include_maintenance_jobs` (default false). Keep server default consistent.

8) __QA__
   - Upload a few files → verify upload task starts automatically and runs steps in order.
   - Mark JPGs non-keep and Commit → verify derivatives removed and statuses set to `missing`; UI updates via SSE.
   - Confirm two-lane priorities are honored.

Note: __Do not modify__ `SCHEMA_DOCUMENTATION.md` or `PROJECT_OVERVIEW.md` in this branch; documentation updates can follow after merge.

---

## Frontend Changes (Phase 1)

- __ProcessesPanel__: group strictly by `task_id`. If the group has any user-relevant task (via `task_type` known list or via future `/tasks`), show all jobs in that task by default even if some are maintenance.
- __Filtering__: default is show user-relevant tasks; toggle to include maintenance shows all tasks.
- __Toasts__: on user task completion:
  - `change_commit`: "Files removed"
  - `upload_postprocess`: "Upload processing completed"

---

## QA Checklist

- `fileRemovalWorker` sets statuses to `missing` and emits item-level SSE; DB updated idempotently.
- Upload triggers a task immediately after upload success; steps run in order.
- Commit triggers a task; follow-ups run and are visible within the same task group.
- Two-lane priorities respected per step definitions.
- UI groups by task and filters by task-level relevancy.

---


## Decisions (finalized)

- Status for removed JPG derivatives: `missing` (thumbnail and preview).
- Upload task trigger: immediately after the upload action succeeds.
- Phase 1 uses definitions + orchestrator; Phase 2 adds a persistent `tasks` table and `/tasks` API.
