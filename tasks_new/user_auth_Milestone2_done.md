# Milestone 2: Public/Private Image System

- **Reference**: `tasks_new/user_auth.md`, `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md`
- **Purpose**: Extend the data model and APIs to support per-photo visibility, enabling public access to specific photos via direct URLs while keeping galleries locked behind admin auth.
- **Outcome**: Admins can toggle photo visibility; asset-serving logic respects visibility; public users (unauthenticated) can fetch a public photo if they have its direct link, but cannot browse lists or see private assets.

## Step-by-step plan
- **Step 1 — Apply schema migrations**
  - Execute migrations drafted in Milestone 0: add `photos.visibility` (default `'private'`).
  - Backfill existing rows to `'private'` using SQL update.
  - Ensure repositories (`photosRepo`, pagination modules) load/store the new column.
  - **Tests**: Migration apply/rollback on dev DB; unit tests verifying repository includes visibility field.

- **Step 2 — API updates for visibility control**
  - Extend relevant endpoints (`photos`, `projects/:folder/photos`) to return `visibility` field.
  - Add admin-only endpoint(s) to update visibility (`PATCH /api/photos/:id/visibility` or batch operations in existing action menu endpoint).
  - Ensure filtering APIs accept optional `visibility` filter per spec (e.g., admin filter panel addition).
  - **Tests**: Supertest coverage for visibility update, ensure unauthorized requests rejected.

- **Step 3 — Frontend admin controls**
  - Update selection action menus and photo detail panel to toggle visibility (similar to existing keep/tag actions).
  - Introduce new filter UI for `visibility` within filters panel (public/private/both) per user brief.
  - **Tests**: React component tests or manual verification toggling visibility and seeing state reflected.

- **Step 4 — Asset authorization & public download policy**
  - Update `server/routes/assets.js` (thumbnails, previews, originals) to allow unauthenticated access only when `visibility === 'public'`.
  - Adopt Option A: bypass `REQUIRE_SIGNED_DOWNLOADS` for public assets by embedding a hashed token in the asset URL/key. Generate a new hash for each public photo every few weeks (configurable job) so previously shared URLs expire.
  - Implement rate limiting to cap repeat downloads per shared link and monitor abuse; private assets continue to require admin auth and signed URLs when the flag is enabled.
  - **Tests**: Integration tests fetching assets with/without auth, verifying visibility enforcement, hash rotation handling, and rate limit responses.

- **Step 5 — Direct photo access route**
  - Implement `/image/:filename` fallback per spec: if photo is public, render viewer-compatible payload; otherwise redirect to login.
  - Ensure router resolves by basename or filename per existing deep-linking logic (`usePhotoDeepLinking`).
  - **Tests**: Manual QA hitting direct URL for public/private photos; automated tests ensuring 404 for missing photo, 401 for private.

- **Step 6 — Public user experience constraints**
  - Verify that unauthenticated users cannot access list endpoints (`/api/photos`, `/api/projects/*`) even if photos are public.
  - Ensure login prompt displays when a public user hits restricted routes.
  - **Tests**: Integration tests confirming 401 for lists without auth.

- **Step 7 — UI indicators**
  - In admin UI, visually mark public photos (e.g., badge) and ensure private ones show default styling.
  - In viewer detail, display visibility status and allow toggle for admins.
  - **Tests**: UI/UX review to confirm clarity.

## Acceptance criteria
- Database includes `photos.visibility` with default `'private'`; admin UI reflects and can change visibility.
- Asset endpoints serve public photos without auth using rotating hashed URLs, enforce rate limits, and reject private ones for public users.
- Direct `/image/:filename` access returns public photo viewer context; private photos prompt login.
- Filter panel supports visibility filter for admins; public users have no gallery access.
- Automated tests cover migrations, API updates, asset access, hash rotation, and unauthorized access cases.

## Post-milestone documentation
- Update `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md`, `SECURITY.md` (include Option A public-asset risk model, hash rotation cadence, and rate limiting), and `README.md` to document the visibility field, new admin controls, asset access rules, and updated filters.
