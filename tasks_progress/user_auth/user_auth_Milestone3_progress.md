# Milestone 2 Handoff Notes for Milestone 3 Developer

- **[Core deliverable]** Unified visibility management is complete across both Project and All Photos modes. `client/src/components/OperationsMenu.jsx` now pipes selections into `useVisibilityMutation()` for dry-run previews and bulk apply, while `client/src/App.jsx` merges `handleVisibilityBulkUpdated()` results into cached photo lists (`mutatePagedPhotos`, `mutateAllPhotos`).

- **[Admin access model]** Public assets remain limited to thumbnails/previews. All listings, mutations, and visibility updates stay behind `server/middleware/authenticateAdmin.js`. No public gallery yet; plan remains to explore read-only exposure in Milestone 3.

- **[Backend status]** `POST /api/photos/visibility` is live with dry-run support, SSE updates, and tests covering positive/negative paths (`server/routes/__tests__/assetsVisibility.test.js`). `server/routes/assets.js` now checks `photos.visibility` before streaming derivatives, returning 404 for private items without admin JWTs.

- **[Frontend UX]** Toasts are centralized via `client/src/ui/toast/ToastContext.jsx`. Visibility flows use `toast.show()` for warnings, previews, successes, and errors. Any new UI surface should call `toast.show({ emoji, message, variant })` for consistency.

- **[Documentation]** `PROJECT_OVERVIEW.md`, `README.md`, and `SECURITY.md` document the visibility rollout, admin gating, and the cross-project actions menu. Keep them in sync if Milestone 3 extends public access or adjusts API payloads.

- **[Testing]** `npm test` passes; suites cover visibility backend behavior, asset gating, auth flows, and token utilities. Next step is Supertest coverage for signed download URLs and potential public asset scenarios once requirements land.

- **[Known follow-ups]**
  - Add integration tests for `/api/photos/visibility` when called with large batches and invalid IDs.
  - Confirm rate limiting for visibility mutations is sufficient once multi-user auth is scoped.

- **[Operational reminders]** Environment boot still requires `AUTH_ADMIN_BCRYPT_HASH`, `AUTH_JWT_SECRET_ACCESS`, `AUTH_JWT_SECRET_REFRESH`, and a non-default `DOWNLOAD_SECRET`. Sample values remain in `.env.example`; ensure new environments override them before deployment.

- **[Hand-off pointer]** Milestone 2 notes in `tasks_progress/user_auth/user_auth_Milestone2_progress.md` capture backend details and verification history if deeper context is needed.