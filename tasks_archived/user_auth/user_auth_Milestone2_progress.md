# Milestone 2 Progress Notes

- **[Auth foundations in place]** Milestone 1 delivered `server/routes/auth.js`, `server/middleware/authenticateAdmin.js`, and the gated SPA (`client/src/auth/AuthContext.jsx`, `client/src/App.jsx`). All `/api/*` and SSE endpoints now require admin auth. Review summary in `PROJECT_OVERVIEW.md` (Admin Authentication Rollout) and `SECURITY.md` (Authentication Rollout 2025-10-04).

- **[Environment requirements]** Backend will exit with `auth_config_invalid` unless `AUTH_ADMIN_BCRYPT_HASH`, `AUTH_JWT_SECRET_ACCESS`, and `AUTH_JWT_SECRET_REFRESH` are provided. For local work export the sample values from `.env.example`; for staging/prod coordinate new secrets with ops. `AUTH_COOKIE_SECURE` defaults to `NODE_ENV !== 'development'.`

- **[Frontend state]** `client/src/api/httpClient.js` holds the in-memory access token and adds bearer headers; remember to use `authFetch()` for any new client APIs. Silent refresh triggers ~30 s before expiry via `AuthContext`.

- **[Testing status]** `npm test` currently covers auth config, password utils, token service, and cookie helpers. Integration tests for `/api/auth/*`, auth middleware, and SSE guards are still TODO (planned for Milestone 2). Expect to extend `server/services/auth/__tests__/` or add `tests/integration/auth.test.js` using `supertest`.

- **[Docs & Ops]** README quick start now documents the login flow; SECURITY.md lists the completed Auth Ops checklist. Coordinate any changes with these files plus `PROJECT_OVERVIEW.md`.

- **[2025-10-07 visibility backend status]** Backend work finished. `photosRepo.listAll()/listProjectFiltered()` plus locate endpoints now accept/return `visibility`, `/api/photos/visibility` handles bulk updates with `dry_run`, and `server/routes/assets.js` only streams private thumbnails/previews/full JPGs for authenticated admins while keeping public assets open. Added `server/routes/__tests__/assetsVisibility.test.js` to cover public/ private asset access and the visibility mutation endpoint; `npm test` passes.

- **[2025-10-07 visibility frontend progress]** `client/src/components/UniversalFilter.jsx`, `client/src/hooks/useAllPhotosPagination.js`, and `client/src/hooks/usePhotoFiltering.js` now recognize the `visibility` filter across All Photos and project views. Visibility badges render in both `client/src/components/VirtualizedPhotoGrid.jsx` and `client/src/components/PhotoTableView.jsx`. `client/src/hooks/useVisibilityMutation.js` plus `client/src/components/OperationsMenu.jsx` expose admin preview/apply controls for project selections; All Photos bulk wiring remains in progress.

- **[2025-10-07 verification]** `npm test` passes after fixing `server/routes/__tests__/photosVisibilityFilters.test.js` to seed canonical folders. Coverage includes the new visibility endpoint/dry-run flows.

- **[2025-10-07 next steps]** Finish wiring visibility actions in All Photos mode (translate `allSelectedKeys` → `photo_id` payloads, refresh caches via `mutateAllPhotos`/`mutatePagedPhotos`). After UI completion, update `PROJECT_OVERVIEW.md`, `README.md`, and `SECURITY.md` per rollout checklist and add Supertest coverage for signed download flows.

- **[2025-10-07 visibility rollout complete]** All Photos mode now pipes `allSelectedKeys` through `useVisibilityMutation()` for preview/apply. `OperationsMenu.jsx` clears unified selections, syncs caches via `handleVisibilityBulkUpdated()`, and surfaces toast feedback (dry-run, success, errors) using the unified toast API. `npm test` remains green.

- **[2025-10-07 public access note]** Public visibility relaxes asset streaming in `server/routes/assets.js` (thumbnails/previews) but API routes stay admin-gated via `authenticateAdmin`. Anonymous viewers still need either minted signed URLs or a future public portal.

- **[2025-10-07 remaining follow-ups]** Add Supertest coverage for signed download flows and evaluate exposing read-only public galleries once access model is defined. Documentation sweep completed (PROJECT_OVERVIEW.md, README.md, SECURITY.md updated with visibility controls and admin constraints).

- **[Milestone 2 focus suggestions]**
  - Formalize login rate limiting and failed-attempt telemetry.
  - Add protected-route integration tests and end-to-end smoke covering login → refresh → logout.
  - Evaluate refresh token rotation/blacklist story (currently stateless).
  - Begin planning multi-user expansion (roles/permissions) if in scope; align with existing unified view architecture.

- **[Open follow-ups]** Remaining API modules using raw `fetch` should migrate to `authFetch()` (see TODO list in Milestone 1 summary). Confirm SSE `openJobStream()` handles 401 responses gracefully.