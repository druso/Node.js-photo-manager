# Milestone 3: Shared Links — Public Viewing & Core Backend

- **Reference**: `tasks_new/user_auth.md`, `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md`
- **Purpose**: Deliver the backend + public-facing experience for shared links so unauthenticated users can view curated sets of public photos via `/shared/:hashedKey`. Admin workflows remain manual (DB-level) until Milestone 4 introduces UI management.
- **Outcome**: Shared link records exist, APIs resolve links by hashed key, public pages render gallery-like view containing only public photos mapped to that link (private photos omitted). Admins can seed links via API or scripts; public users cannot navigate outside the link context.

## Step-by-step plan
- **Step 1 — Execute shared-link migrations**
  - Apply migrations from Milestone 0 adding `public_links` and `photo_public_links` tables with necessary indexes.
  - Seed test data to validate relationships; ensure foreign keys enforce photo/link integrity.
  - **Tests**: Migration apply/rollback on dev DB; repository unit tests covering CRUD for new tables.

- **Step 2 — Repository & service layer**
  - Implement `publicLinksRepo.js` with methods: `create`, `getByHashedKey`, `list`, `associatePhotos`, `removePhoto`, etc.
  - Extend `photosRepo` (or dedicated service) to query photos by shared link, filtering for `visibility = 'public'`.
  - **Tests**: Unit tests for repository methods, ensuring private photos excluded even if linked.

- **Step 3 — Shared link API endpoints**
  - Create dedicated router `server/routes/publicLinks.js` mounted at `app.use('/api/public-links', requireAdmin, adminRouter)` for admin CRUD and `app.use('/shared/api', publicRouter)` (or similar) for public fetches. Document this split so auth wiring is explicit.
  - Admin endpoints: `POST /api/public-links`, `PATCH /api/public-links/:id`, `POST /api/public-links/:id/photos`, `DELETE /api/public-links/:id`, `POST /api/public-links/:id/regenerate` (all behind `requireAdmin`).
  - Public endpoint: `GET /shared/api/links/:hashedKey` (or chosen mount) returning metadata + public photos, automatically filtering out private ones.
  - **Tests**: Supertest coverage for all endpoints, verifying auth requirements and data filtering.

- **Step 4 — Public shared link page**
  - Create dedicated frontend route `/shared/:hashedKey` served outside admin layout (lightweight page with viewer + grid components reused as possible).
  - Fetch shared link data via new API, render `Title`, `Description`, and photo grid limited to public photos.
  - Handle empty/invalid links → show 404 page.
  - **Tests**: Component/unit tests for fetch states; manual QA verifying proper rendering and 404 handling.

- **Step 5 — Viewer integration**
  - Ensure shared link page reuses existing `PhotoViewer` with limited controls (no admin-only buttons).
  - Confirm deep linking works within shared context (`/shared/:hashedKey/:photoName` optional) leveraging existing deep link utilities.
  - **Tests**: Manual verification navigating between grid and viewer; optional automated tests for URL handling.

- **Step 6 — Asset access alignment**
  - Confirm asset routes used by shared link page rely on Milestone 2 visibility enforcement (only public photos accessible) and the Option A policy: rotating hashed asset URLs with rate limiting. Ensure the hash regeneration job invalidates stale public downloads and document caching headers.
  - **Tests**: Integration tests fetching thumbnails/previews while unauthenticated through shared link flow, verifying hash-based access and rate-limit responses.

- **Step 7 — Hardening & guarding**
  - Enforce rate limiting / 404 for missing hashed keys.
  - Ensure hashed key generation (for admin creation) uses secure random generator (e.g., `crypto.randomBytes`).
  - **Tests**: Unit test hashed key length/entropy; security review for potential leakage.

## Acceptance criteria
- `/shared/:hashedKey` route renders shared gallery, gracefully handles empty or invalid links, and omits private photos.
- Viewer operates within shared link context without exposing admin controls.
- test suite covers repositories, endpoints, and shared-link UI components; manual QA confirms end-to-end flow with seeded data.

## Post-milestone documentation
- Update `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md` (include router mount points and schema usage), `SECURITY.md` (document public asset exposure, rotating hash policy, and rate limiting), and `README.md` to describe shared link tables, endpoints, hashed key behavior, and the public viewing flow.