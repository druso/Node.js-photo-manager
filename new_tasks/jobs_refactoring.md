---
description: Job pipeline refactor for cross-project workflows
---

# Background & Current Constraints

- **Pipeline enforces `project_id`**: `server/services/tasksOrchestrator.js` requires a `project_id` when calling `jobsRepo.enqueue()` or `jobsRepo.enqueueWithItems()`, making every task inherently project-scoped.
- **Workers assume single-project context**: Core workers such as `server/services/workers/derivativesWorker.js`, `maintenanceWorker.js`, and `fileRemovalWorker.js` immediately resolve `projectsRepo.getById(job.project_id)` and operate only within one project directory.
- **Scheduler loops per project**: `server/services/scheduler.js` enumerates projects and launches maintenance tasks individually (`startTask({ project_id: p.id, type: 'maintenance' })`), preventing unified jobs that span multiple scopes.
- **“Global” commit/revert fans out**: Even cross-project endpoints (`server/routes/projectCommitHandlers.js` & `/api/photos/*`) expand into per-project `change_commit` tasks, preserving the coupling rather than introducing true global execution.

These behaviors make the "All Photos" surface rely on project iterations, complicating future flows that must operate on arbitrary photo sets or across multiple projects. The upcoming refactor will replace the current project-scoped design entirely; no legacy compatibility shims will be preserved.

# Refactor Goals

1. Allow jobs to operate on arbitrary photo subsets (possibly spanning projects) without instantiating one task per project.
2. Remove project-scoped assumptions from the pipeline entirely; project will become an optional attribute on any job.
3. Deliver clear, modernized API contracts (backend + frontend) that embrace the new scope model, accepting endpoint changes as needed.

# Workplan with Milestones & Tests

## Milestone 1 — Schema & Repository Overhaul

- **Tasks**
  - Extend or rebuild the `jobs` table so `project_id` is optional and prefer storing explicit `targets` (photo IDs, project IDs, or both) in `payload_json`.
  - Update `jobsRepo.enqueue()` / `enqueueWithItems()` to use the new structure and drop mandatory project constraints.
  - Introduce `scope` metadata (e.g., `'photo_set'`, `'project'`, `'global'`) at the repository level to drive worker dispatch.
- **Tests**
  - Unit: `jobsRepo.enqueue()` with `scope='photo_set'` and no `project_id` persists payload and is claimable.
  - Integration: enqueue a dummy `photo_set` task via an express route (temporary harness) and verify `workerLoop` claims/executes it without project context.

## Milestone 2 — Worker Rewrite for Scope-Agnostic Processing

- **Tasks**
  - Build shared utilities (e.g., `server/services/workers/shared/photoSetUtils.js`) that map incoming targets to `{ project_id, photo_ids[] }` batches when filesystem access requires grouping.
  - Rewrite `runGenerateDerivatives()`, `runFileRemoval()`, maintenance routines, and any other workers to operate purely on the supplied targets, without assuming `job.project_id` exists.
  - Remove legacy branches; ensure every worker gracefully handles mixed-project inputs using the new utilities.
- **Tests**
  - Unit: shared utility groups multi-project payloads correctly (and handles single-project cases transparently).
  - Integration: simulate cross-project derivative and commit jobs; confirm results for every targeted photo and absence of project-specific assumptions.

## Milestone 3 — Task Definitions & Orchestration Rewrite

- **Tasks**
  - Replace `server/services/task_definitions.json` with scope-aware definitions and remove assumptions about initial project-only steps.
  - Overhaul `tasksOrchestrator.startTask()` / `onJobCompleted()` to pass the same payload between steps regardless of scope; eliminate `project_id` requirements.
  - Define new task types (e.g., `change_commit_all`, `maintenance_global`) that encapsulate cross-project behavior in one task instead of fan-out.
- **Tests**
  - Integration: start each scope type (project, photo_set, global) and confirm orchestration advances with the redesigned payload.
  - Functional: ensure no fallback to per-project fan-out occurs by checking number of jobs created per task.

## Milestone 4 — Endpoint & API Realignment (Server)

- **Tasks**
  - Redesign `/api/photos/commit-changes`, `/api/photos/revert-changes`, `/api/photos/process`, and related routes to accept explicit photo ID lists or filter descriptors, enqueueing a single scope-aware task.
  - Remove legacy per-project endpoints if redundant; consolidate around the new API surface.
  - Update `server/routes/uploads.js`, `photosActions.js`, `maintenance.js`, and any other route to use the rewritten orchestration.
- **Tests**
  - Integration: hit each endpoint with mixed-project inputs and validate that a single task/job lifecycle handles the request end-to-end.
  - Contract: ensure error handling and validation messages reflect the new API semantics (e.g., unknown photo IDs, oversized payloads).

## Milestone 5 — Client Updates & Endpoint Migration

- **Tasks**
  - Audit `client/src/api/jobsApi.js`, `client/src/api/allPhotosApi.js`, `client/src/api/projectsApi.js`, and UI entry points ([App.jsx](cci:7://file:///home/druso/code/Node.js%20photo%20manager/client/src/App.jsx:0:0-0:0), commit/revert toolbar, upload flows, move modal).
  - Switch client calls to the new endpoints/payloads, removing code paths that referenced project-scoped APIs only.
  - Ensure SSE handling (`jobsApi` singleton) and UI state interpret scope-aware job updates (new event metadata, aggregated progress) correctly.
  - **IMPORTANT**: Integrate with the unified view context architecture:
    - Use `view.project_filter` instead of `isAllMode` to determine current view
    - Leverage the unified selection model with `PhotoRef` objects for consistent job targeting
    - Ensure job progress updates work consistently in both All Photos and Project views

# Open Questions / Follow-ups

- Do we need per-tenant scoping parallel to the new photo-set scope? (`jobsRepo` already stores `tenant_id`; verify requirements.)
- Should we introduce job batching limits (e.g., max photos per job) to prevent extremely large payloads?
- Decide how maintenance scheduling should operate in the new model (centralized photo-set runs vs project-level batching) and remove redundant scheduler loops.
- How should job progress updates be displayed in the unified view context?
- Should job scoping align with the unified view context (i.e., using `project_filter` as a scope identifier)?

## Milestone 6 — Documentation & Final Validation

- **Tasks**
  - Update `JOBS_OVERVIEW.md`, `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md`, `README.md`, and affected workflows to describe the new scope-first design and retired endpoints.
  - Add release notes in `SECURITY.md` addressing rate limits, payload validation, and SSE behavior under the new model.
  - Provide migration notes or one-time scripts to clean up existing queue rows/jobs to the new format.
- **Tests**
  - Final regression: run automated suites and targeted manual verification across all flows (upload, commit, revert, maintenance, image move) using the new endpoints.
  - Documentation review: confirm cross-links and workflow instructions match the refactored API surface.

# Open Questions / Follow-ups

- Do we need per-tenant scoping parallel to the new photo-set scope? (`jobsRepo` already stores `tenant_id`; verify requirements.)
- Should we introduce job batching limits (e.g., max photos per job) to prevent extremely large payloads?
- Decide how maintenance scheduling should operate in the new model (centralized photo-set runs vs project-level batching) and remove redundant scheduler loops.
