# Test Suite Expansion & Cleanup Plan

## Objective
Ensure `npm test` leaves no residual data while expanding automated coverage across critical backend routes and recent feature areas.

## Success Criteria
- All integration suites clean up database records and project filesystem entries they create.
- New coverage exists for project lifecycle routes, image-scoped bulk operations, global revert, uploads conflict handling, and SSE/job streaming safeguards.
- Queue/worker behavior is validated for priority handling and maintenance resilience.
- Initial frontend hook/component tests protect pagination and visibility logic.

## Milestones & Deliverables
1. **Cleanup Hardening (M1)**
   - Audit all current suites for tracked IDs and shared teardown helpers.
   - Extract common `seedProject/cleanupTestData` helpers into a shared test utility module.
   - Add CI check (pre/post snapshot) to detect leftover `.projects/user_0/*` or DB rows.
   - Deliverable: `server/tests/utils/dataFixtures.js`, CI script or npm task.

2. **Project Lifecycle Tests (M2)**
   - New integration suite covering `/api/projects` create/rename/archive/delete flows.
   - Assertions for manifest file contents, folder renames, and failure modes (duplicate names, invalid payloads).
   - Deliverable: `server/routes/__tests__/projectsLifecycle.test.js`.

3. **Image-Scoped Bulk Operations (M3)**
   - Add suites for `/api/photos/keep`, `/api/photos/tags/add`, `/api/photos/tags/remove`, `/api/photos/process`, `/api/photos/move` including dry-run and mixed project scenarios.
   - Validate DB mutations, job enqueues, and error handling.
   - Deliverable: `server/routes/__tests__/photosBulkActions.test.js`.

4. **Photo Pagination & SQL Validation (M4)**
   - Integration tests for `/api/photos` and `/api/projects/:folder/photos` covering forward/backward cursors, sort permutations, and filter combinations.
   - Unit tests for `photoPagination.js` cursor builders (ASC/DESC) and locate-page helpers.
   - Deliverable: `server/routes/__tests__/photosPagination.test.js`, `server/services/repositories/__tests__/photoPagination.test.js`.

5. **Commit/Revert Symmetry (M5)**
   - Extend commit suite to cover `/api/photos/revert-changes` (global + scoped) and pending-delete state resets.
   - Add regression tests for selection counts exposed via `/api/photos/pending-deletes` in All Photos mode.
   - Deliverable: updated `commitHandlers.test.js` (or new companion file).

6. **Uploads & Conflict Handling (M6)**
   - Integration tests for `/api/projects/:folder/upload` covering move-only (202), skip/overwrite branches, and SSE job creation.
   - Use temp upload directories and mock Sharp via dependency injection to avoid heavy processing.
   - Deliverable: `server/routes/__tests__/uploadsConflicts.test.js` plus fixture helpers.

7. **Worker & SSE Validation (M7)**
   - Unit tests for `jobsRepo.claimNext` priority thresholds and worker pipeline slot logic.
   - SSE endpoint tests ensuring global EventSource singleton prevents over-connection and payload schema remains stable.
   - Deliverable: `server/services/workers/__tests__/workerPipeline.test.js`, `server/routes/__tests__/jobsSse.test.js`.

8. **Frontend Hook/Component Tests (M8)**
   - Introduce Vite-friendly Jest/Vitest setup (if absent) for client tests.
   - Cover `useAllPhotosPagination` (cursor resets, bidirectional nav) and `useViewerSync` URL behavior.
   - Deliverable: `client/src/hooks/__tests__/useAllPhotosPagination.test.jsx`, shared test utilities.

9. **Testing Documentation (M9)**
   - Author `project_docs/TESTING_OVERVIEW.md` describing test taxonomy, cleanup expectations, and execution commands.
   - Cross-link from README and PROJECT_OVERVIEW so contributors can find coverage expectations.
   - Deliverable: new documentation page plus updated references.

## Dependencies & Notes
- Coordinate with CI to install any new dev dependencies (e.g., Vitest, React Testing Library).
- Ensure new suites reuse shared cleanup utilities to avoid regressions.
- Update PROJECT_OVERVIEW.md and SECURITY.md after implementation to reflect expanded coverage (per project rules).
- Ensure the new `project_docs/TESTING_OVERVIEW.md` stays current as milestones land.
