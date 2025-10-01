---
title: Image Move & Upload Conflict Handling — Finish Work Task
owner: <assign>
priority: High
status: Planned
last_updated: 2025-08-25
---

# Objective

Deliver robust cross-project image move and upload conflict handling with a clear UX and consistent backend workflow.

- Prevent silent duplication across projects (optional, configurable).
- Provide upload dialog options for conflict resolution.
- Trigger the `image_move` pipeline from upload when requested.
- Ensure SSE updates keep the UI consistent during moves and derivatives.

References:
- Jobs catalog: [JOBS_OVERVIEW.md](cci:7://file:///home/druso/code/Node.js%20photo%20manager/JOBS_OVERVIEW.md:0:0-0:0) (see `image_move_files`)
- System overview: [PROJECT_OVERVIEW.md](cci:7://file:///home/druso/code/Node.js%20photo%20manager/PROJECT_OVERVIEW.md:0:0-0:0) (Image Move workflow + Real-time features)
- Schema and SSE: [SCHEMA_DOCUMENTATION.md](cci:7://file:///home/druso/code/Node.js%20photo%20manager/SCHEMA_DOCUMENTATION.md:0:0-0:0) (Image Move DB/SSE semantics)
- Server routes: [server/routes/uploads.js](cci:7://file:///home/druso/code/Node.js%20photo%20manager/server/routes/uploads.js:0:0-0:0), [server/routes/projects.js](cci:7://file:///home/druso/code/Node.js%20photo%20manager/server/routes/projects.js:0:0-0:0) (if present)
- Workers: [server/services/workers/imageMoveWorker.js](cci:7://file:///home/druso/code/Node.js%20photo%20manager/server/services/workers/imageMoveWorker.js:0:0-0:0)
- Task defs: [server/services/task_definitions.json](cci:7://file:///home/druso/code/Node.js%20photo%20manager/server/services/task_definitions.json:0:0-0:0)
- SSE client: [client/src/api/jobsApi.js](cci:7://file:///home/druso/code/Node.js%20photo%20manager/client/src/api/jobsApi.js:0:0-0:0)
- Upload UI: [client/src/components/PhotoUpload.jsx](cci:7://file:///home/druso/code/Node.js%20photo%20manager/client/src/components/PhotoUpload.jsx:0:0-0:0)

# Current State

- Backend:
  - Upload route `POST /api/projects/:folder/upload` parses flags:
    - `overwriteInThisProject` (boolean string)
    - `reloadConflictsIntoThisProject` (boolean string)
  - When `reloadConflictsIntoThisProject=true`, cross-project conflicts are detected and an `image_move` job is enqueued for the destination project.
  - DB has no global uniqueness constraint (conflicts are handled in app logic).
- Frontend:
  - Upload flow exists in [PhotoUpload.jsx](cci:7://file:///home/druso/code/Node.js%20photo%20manager/client/src/components/PhotoUpload.jsx:0:0-0:0).
  - Skip-duplicates flow exists.
  - Work remaining: ensure UI exposes both flags and UX communicates outcomes; verify request payload wiring; make sure SSE updates are handled (moved items, derivative statuses) without double-fetching regressions.

# Deliverables

1) UI/UX: Upload Dialog Options and Messaging
- Add two checkboxes in the confirmation step of [client/src/components/PhotoUpload.jsx](cci:7://file:///home/druso/code/Node.js%20photo%20manager/client/src/components/PhotoUpload.jsx:0:0-0:0):
  - overwriteInThisProject (default OFF)
  - reloadConflictsIntoThisProject (default OFF)
- UX text:
  - Overwrite: “Overwrite existing in this project”
  - Reload conflicts: “Reload conflicts into this project (move items that exist in other projects)”
  - Helper note: “When enabled, cross-project conflicts detected during analysis will be moved here via the image_move task after upload.”
- Wire both flags into the `FormData` in the upload request (multipart keys exactly as above).
- Keep “Skip duplicate files” toggle behavior for within-project duplicates; ensure its copy reflects interaction with overwrite:
  - If overwriteInThisProject=true, Skip duplicates should be visually de-emphasized or explained (overwrite will replace duplicates).

2) Backend: Validation and Safety Nets
- Confirm [server/routes/uploads.js](cci:7://file:///home/druso/code/Node.js%20photo%20manager/server/routes/uploads.js:0:0-0:0):
  - Parses flags from `req.body` and lowercases the boolean strings.
  - When `reloadConflictsIntoThisProject=true`, identifies cross-project conflicts and enqueues `image_move` with payload including the destination project id and the conflict items. Ensure it tolerates mixed uploads (some files new, some conflicts).
  - When `overwriteInThisProject=true`, the per-file storage logic replaces existing content in the current project while preserving DB metadata expectations (e.g., derivative status reset as needed).
- Ensure [server/services/workers/imageMoveWorker.js](cci:7://file:///home/druso/code/Node.js%20photo%20manager/server/services/workers/imageMoveWorker.js:0:0-0:0):
  - Updates `photos.project_id` (and any relevant derivative state alignment) per [SCHEMA_DOCUMENTATION.md](cci:7://file:///home/druso/code/Node.js%20photo%20manager/SCHEMA_DOCUMENTATION.md:0:0-0:0).
  - Emits SSE item-level events:
    - Source project: `item_removed` for the moved basename/filename (include `project_folder`).
    - Destination project: `item_moved` or `item` update reflecting final state and derivative statuses.
- Add guards and clear error messages:
  - If a move target already contains a conflicting variant that cannot be reconciled, skip that item and log a warning for the UI to expose (SSE or response payload).
  - Respect the two-lane worker pipeline priority rules when enqueueing moves from uploads (documented threshold).

3) SSE and Client State Updates
- [client/src/api/jobsApi.js](cci:7://file:///home/druso/code/Node.js%20photo%20manager/client/src/api/jobsApi.js:0:0-0:0) provides a global SSE EventSource singleton; verify only one connection is active during upload + move.
- Ensure the client correctly handles SSE for:
  - `item_removed`: remove from in-memory `projectData.photos` of the source project only when that source is in current view or cached. If not in view, ignore gracefully.
  - `item_moved`/`item`: add/update the destination project’s in-memory photo list and trigger re-render efficiently (no full refetch unless needed).
- Avoid scroll/state regressions:
  - Keep the “viewer and scroll state preservation” logic intact during item-level updates (see [client/src/App.jsx](cci:7://file:///home/druso/code/Node.js%20photo%20manager/client/src/App.jsx:0:0-0:0) notes).
- Developer logging:
  - Retain dev-only SSE console logs to trace during QA (not in production builds).

4) Testing Plan

Manual QA Matrix:
- Scenarios
  - A) Both flags OFF: Upload new files only; duplicates in current project are skipped if “Skip duplicates” ON.
  - B) Overwrite ON, Reload OFF: Existing in current project are overwritten; no cross-project moves.
  - C) Overwrite OFF, Reload ON: Cross-project conflicts are moved into the current project; current-project duplicates are skipped based on “Skip duplicates”.
  - D) Both ON: Overwrite local duplicates and move cross-project conflicts.
- Edge Cases
  - Same basename across 3+ projects: ensure moves consolidate into target project, de-dupe tasks per basename.
  - Format completion: when only missing variants are uploaded, verify generation and status updates.
  - Large batches (1000+ files): ensure pipeline backpressure and SSE rate limits aren’t exceeded. Monitor server caps.
  - Interrupted uploads: partial files must not trigger inconsistent move states.
  - Concurrent uploads for same target: ensure idempotent behavior and no races in move worker (e.g., unique queue item per basename per target).
- Observability
  - Monitor server logs for the upload POSTs, enqueued `image_move` jobs, worker logs per move, and SSE event counts.
  - Inspect the response payload `flags` echo and any `warnings`.
- Smoke Tests (curl)
  - POST multipart with:
    - photos[]=... files
    - overwriteInThisProject=true|false
    - reloadConflictsIntoThisProject=true|false
  - Verify `200` and flags echoed; then verify DB changes and assets on disk where relevant.

5) Performance and Limits
- Confirm that `image_move` enqueues into the normal or priority lane per `pipeline.priority_threshold` (see `config.json` and docs). Moves triggered by uploads may be considered priority if UX requires fast surfacing.
- Ensure the SSE server connection cap is not exceeded (singleton already in place). Keep dev guidance from `README.md` regarding MAX_SSE_PER_IP and HMR.

6) Security and Safety
- Confirm inputs are validated:
  - Accept only expected flags, sanitize filenames, and verify project folder mapping.
- Ensure no path traversal in asset handling.
- Rate limiting: verify upload route respects global rate limits; ensure move enqueueing can’t be abused for amplification.
- Update `SECURITY.md` if changes impact rate limits or move enqueueing protections.

7) Documentation Updates (post-implementation)
- [PROJECT_OVERVIEW.md](cci:7://file:///home/druso/code/Node.js%20photo%20manager/PROJECT_OVERVIEW.md:0:0-0:0):
  - Upload flow update: new flags, decision tree, cross-project conflict resolution path.
  - Image Move workflow: reinforce SSE events and derivatives status semantics.
- [SCHEMA_DOCUMENTATION.md](cci:7://file:///home/druso/code/Node.js%20photo%20manager/SCHEMA_DOCUMENTATION.md:0:0-0:0):
  - Note any additional indexes or constraints considered; reiterate global uniqueness is not enforced by DB, only by app logic.
  - SSE payload examples for `item_removed` and destination `item` update.
- [JOBS_OVERVIEW.md](cci:7://file:///home/druso/code/Node.js%20photo%20manager/JOBS_OVERVIEW.md:0:0-0:0):
  - Ensure `image_move_files` and the composed `image_move` are accurately documented with triggers from upload (flag-driven).
- `README.md`:
  - Add a short “Upload Options” section for users.
  - Reference dev-only SSE logs for debugging.

# Technical Details and Pointers

- Upload route: [server/routes/uploads.js](cci:7://file:///home/druso/code/Node.js%20photo%20manager/server/routes/uploads.js:0:0-0:0)
  - Flag parsing snippet should be:
    - `const overwriteInThisProject = String(req.body?.overwriteInThisProject ?? 'false').toLowerCase() === 'true';`
    - `const reloadConflictsIntoThisProject = String(req.body?.reloadConflictsIntoThisProject ?? 'false').toLowerCase() === 'true';`
  - Conflict detection: build a set of basenames from uploaded files and query across projects to find conflicts.
  - Task enqueueing: [tasksOrchestrator.startTask({ project_id, type: 'image_move', source: 'upload', items })](cci:1://file:///home/druso/code/Node.js%20photo%20manager/server/services/tasksOrchestrator.js:16:0-31:1)

- Worker: [server/services/workers/imageMoveWorker.js](cci:7://file:///home/druso/code/Node.js%20photo%20manager/server/services/workers/imageMoveWorker.js:0:0-0:0)
  - Steps from [server/services/task_definitions.json](cci:7://file:///home/druso/code/Node.js%20photo%20manager/server/services/task_definitions.json:0:0-0:0): `image_move_files`, `manifest_check`, `generate_derivatives`.
  - DB updates: set `photos.project_id` to target, align derivative statuses to pending/generation as appropriate.
  - SSE:
    - Emit to source: `event: item_removed`, payload includes `project_folder`, `filename`/`basename`.
    - Emit to target: `event: item` or `item_moved` with updated fields, including `project_folder`.

- Client SSE: [client/src/api/jobsApi.js](cci:7://file:///home/druso/code/Node.js%20photo%20manager/client/src/api/jobsApi.js:0:0-0:0)
  - Ensure only one EventSource (global singleton).
  - Route events to update in-memory collections. Avoid full refetch unless necessary.

- Upload UI: [client/src/components/PhotoUpload.jsx](cci:7://file:///home/druso/code/Node.js%20photo%20manager/client/src/components/PhotoUpload.jsx:0:0-0:0)
  - Confirm the confirmation step renders both checkboxes and `FormData` includes both keys.
  - Ensure the “Skip duplicate files” toggle communicates interaction with overwrite.

# Acceptance Criteria

- UI shows two options and sends correct flags.
- Upload route:
  - Overwrites within project when requested.
  - Enqueues `image_move` when reload conflicts is ON, with correct item set.
- Worker moves items between projects, emits SSE that:
  - Removes item from source project view.
  - Adds/updates item in destination project with correct derivative statuses.
- No duplicate SSE connections; UI updates without losing scroll/viewer state.
- QA matrix passes for A–D scenarios and edge cases.
- Docs updated in [PROJECT_OVERVIEW.md](cci:7://file:///home/druso/code/Node.js%20photo%20manager/PROJECT_OVERVIEW.md:0:0-0:0), [SCHEMA_DOCUMENTATION.md](cci:7://file:///home/druso/code/Node.js%20photo%20manager/SCHEMA_DOCUMENTATION.md:0:0-0:0), [JOBS_OVERVIEW.md](cci:7://file:///home/druso/code/Node.js%20photo%20manager/JOBS_OVERVIEW.md:0:0-0:0), and `README.md`.
- No security regressions; rate limiting and input validation remain effective.

# Rollback Plan

- Feature flags can be hidden on the client (checkboxes) if issues arise.
- Keep existing upload path (both flags OFF) functioning as before.
- Disable `image_move` enqueueing from uploads via a server-side config toggle if needed.

# Task Breakdown

- UI/UX: 0.5–1 day
- Backend validation and small fixes: 0.5 day
- SSE and state verification: 0.5 day
- QA + edge cases: 0.5–1 day
- Documentation updates: 0.5 day

# Post-Completion Checklist

- [ ] All acceptance criteria met.
- [ ] Docs updated and cross-linked.
- [ ] `SECURITY.md` notes updated if needed.
- [ ] Smoke tests with all flag combinations completed.
- [ ] One-liner dev notes added to `new_tasks/Upgrade Progress.md` (if used in this repo).