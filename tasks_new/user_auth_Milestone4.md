# Milestone 4: Shared Links — Admin Management UI

- **Reference**: `tasks_new/user_auth.md`, `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md`
- **Purpose**: Provide admins with an in-app interface to create, edit, regenerate, and delete shared links, and manage photo assignments without touching the database directly.
- **Outcome**: `/publiclinks` admin page lists shared links with CRUD actions, linking to `/shared/:hashedKey`; admin workflows for assigning/removing photos are available via modal/UI components.

## Step-by-step plan
- **Step 1 — Admin routing & navigation**
  - Add protected route `/publiclinks` in SPA, accessible from settings hamburger menu per spec.
  - Ensure route guard requires admin context from Milestone 1.
  - **Tests**: Manual check navigation appears only for admins; unauthorized access redirects to login.

- **Step 2 — Shared links list view**
  - Build `PublicLinksPage` component fetching `GET /api/public-links` (admin endpoint from Milestone 3 or extend to support listing).
  - Display Title, Description, hashed key, link to open public page, counts of associated photos.
  - Include actions: edit, regenerate key, delete.
  - **Tests**: Component tests verifying loading/empty/error states; manual QA.

- **Step 3 — Create/Edit shared link modal**
  - Implement modal allowing admins to set Title/Description and optionally initial photo assignments.
  - Use admin router endpoints defined in Milestone 3 (`POST /api/public-links`, `PATCH /api/public-links/:id`) mounted via `server/routes/publicLinks.js`.
  - On save, refresh list and show success toast.
  - **Tests**: Integration tests (React Testing Library) verifying form validation and API interactions.

- **Step 4 — Regenerate hashed key**
  - Add button per row to regenerate hashed key via `POST /api/public-links/:id/regenerate` (exposed by the same admin router).
  - Display confirmation dialog warning about access revocation; update list on success.
  - **Tests**: Supertest for backend route; frontend component test confirming new key shown.

- **Step 5 — Delete shared link**
  - Add delete action with confirmation modal calling `DELETE /api/public-links/:id` from the shared links router.
  - On success, remove from list and show toast.
  - **Tests**: Backend + frontend tests verifying deletion and state update.

- **Step 6 — Photo assignment modal**
  - Reuse or extend modal from Milestone 5 plan (share button). For Milestone 4, provide UI to review assigned photos when accessed from list/detail page.
  - Fetch associated photos via admin router endpoints (e.g., `GET /api/public-links/:id/photos`) returning metadata including private markers.
  - Allow deselection/removal of photos via `DELETE /api/public-links/:id/photos`; warn that private photos remain visible only to admins.
  - **Tests**: UI tests verifying removal updates list; backend tests for association removal route.

- **Step 7 — Public vs private indicators**
  - In admin view, differentiate private photos in shared link list (gray overlay per spec).
  - Provide quick filter/search for links by title/description.
  - **Tests**: Manual UI review ensuring clarity.

- **Step 8 — Permissions & audit logging**
  - Ensure all admin routes reuse `requireAdmin` middleware and log key events (creation, regeneration, deletion) using centralized logger.
  - **Tests**: Review logs during manual QA; optional automated tests checking middleware coverage.

## Acceptance criteria
- `/publiclinks` route accessible only to authenticated admins via navigation.
- Photo assignment modal allows managing membership, displaying private-photo warnings.
- All actions persist correctly via backend APIs; UI reflects updates without full-page reloads.
- Automated and manual tests cover list view, modals, and backend endpoints.

## Post-milestone documentation
- Update `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md` (include router mount points: `server/routes/publicLinks.js`), `SECURITY.md`, and `README.md` describing admin shared link management workflows, endpoints, and UI access points.