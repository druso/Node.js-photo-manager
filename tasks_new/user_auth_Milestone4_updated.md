# Milestone 4: Shared Links — Admin Management UI & Public Viewing

- **Reference**: `tasks_new/user_auth.md`, `tasks_new/user_auth_project_overview.md`, `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md`
- **Purpose**: Enable public sharing of photos via shared links that work for both public users and admins. Provide admins with an in-app interface to create, edit, regenerate, and delete shared links, and manage photo assignments.
- **Outcome**: 
  - `/shared/:hashedKey` displays photos in a **filtered grid view** (reusing existing All Photos grid component)
  - Public users see only public photos; admins see all photos with private ones having a gray overlay
  - `/publiclinks` admin page lists shared links with CRUD actions
  - Admin workflows for assigning/removing photos via modal/UI components

## Architecture Principle
**CRITICAL**: A shared link is NOT a separate viewer component. It is simply the **All Photos grid with a `public_link_id` filter applied**. This means:
- Reuse the existing `AllPhotosPane` component and pagination logic
- Add `public_link_id` as a filter parameter (like `date_from`, `file_type`, etc.)
- The backend filters photos using `WHERE ph.id IN (SELECT photo_id FROM public_link_photos WHERE public_link_id = ?)`
- No special code paths, no duplicate logic, just a filter

## Step-by-step plan

### Phase 1: Grid Component Enhancement (Foundation)
- **Step 1.1 — Add description support to grid views**
  - Modify `AllPhotosPane` and `ProjectPane` to display an optional description field above the photo grid
  - Add description to the header area (below title, above filters)
  - Style consistently across all grid views (All Photos, Project, Shared Link)
  - **Tests**: Manual verification that description renders correctly

- **Step 1.2 — Add public_link_id filter support**
  - Backend: Add `public_link_id` parameter to `/api/photos` endpoint
  - Backend: In `photoQueryBuilders.js`, add WHERE clause: `ph.id IN (SELECT photo_id FROM public_link_photos WHERE public_link_id = ?)`
  - Backend: In photos route, look up public link by hash to get UUID before filtering
  - Frontend: Add `public_link_id` to `buildFilterParams()` in `useAllPhotosPagination.js`
  - **Tests**: API test verifying filter returns correct photos; manual test with shared link

- **Step 1.3 — Public access to filtered grid**
  - Update auth middleware in `server.js` to allow public access to `/api/photos` when `public_link_id` query param is present
  - Ensure public users can only see photos where `visibility = 'public'`
  - **Tests**: Test as unauthenticated user accessing `/api/photos?public_link_id=UUID`

### Phase 2: Shared Link Routing & UI
- **Step 2.1 — Shared link routing**
  - Update `main.jsx` router to handle `/shared/:hashedKey` route
  - Pass `hashedKey` as prop to `App` component
  - In `App.jsx`, detect shared link mode and set `activeFilters.public_link_id = hashedKey`
  - Switch to All Photos view (`view.project_filter = null`)
  - **Tests**: Navigate to `/shared/:key` and verify grid loads with filter applied

- **Step 2.2 — Shared link UI customization**
  - Hide project selector when in shared link mode
  - Show "Shared Link" title and description (fetched from public_links table)
  - For admins: Show "Back to Public Links" button
  - For admins: Apply gray overlay to private photos in the grid
  - Hide admin-only UI elements for public users (commit bar, action menu, etc.)
  - **Tests**: Manual verification as both admin and public user

### Phase 3: Admin Management Interface
- **Step 3.1 — Admin routing & navigation**
  - Add protected route `/publiclinks` in SPA, accessible from settings hamburger menu
  - Ensure route guard requires admin context from Milestone 1
  - **Tests**: Manual check navigation appears only for admins; unauthorized access redirects to login

- **Step 3.2 — Shared links list view**
  - Build `PublicLinksPage` component fetching `GET /api/public-links`
  - Display: Title, Description, hashed key, clickable link to `/shared/:hashedKey`, photo count
  - Include actions: edit, regenerate key, delete
  - **Tests**: Component tests verifying loading/empty/error states; manual QA

- **Step 3.3 — Create/Edit shared link modal**
  - Implement modal allowing admins to set Title/Description
  - Use endpoints: `POST /api/public-links`, `PATCH /api/public-links/:id`
  - On save, refresh list and show success toast
  - **Tests**: Integration tests verifying form validation and API interactions

- **Step 3.4 — Regenerate hashed key**
  - Add button per row to regenerate via `POST /api/public-links/:id/regenerate`
  - Display confirmation dialog warning about access revocation
  - Update list on success
  - **Tests**: Backend route test; frontend test confirming new key shown

- **Step 3.5 — Delete shared link**
  - Add delete action with confirmation modal calling `DELETE /api/public-links/:id`
  - On success, remove from list and show toast
  - **Tests**: Backend + frontend tests verifying deletion and state update

### Phase 4: Photo Assignment Workflows
- **Step 4.1 — Share button in action menu**
  - Add "Share to Link" button in `OperationsMenu` (appears when photos are selected)
  - Opens modal similar to "Move to Project" modal
  - Shows list of existing shared links with checkboxes
  - Allow creating new shared link inline
  - On confirm, call `POST /api/public-links/:id/photos` with photo IDs
  - **Tests**: Manual test selecting photos and sharing to link

- **Step 4.2 — Photo viewer shared link management**
  - In `PhotoViewer` detail panel, add "Shared Links" section (admin only)
  - Show list of shared links this photo belongs to
  - Allow adding to new links or removing from existing ones
  - **Tests**: Manual test in photo viewer

- **Step 4.3 — Photo assignment modal from public links page**
  - From `/publiclinks`, allow clicking "Manage Photos" for a link
  - Opens modal showing all photos with checkboxes indicating assignment
  - Highlight private photos with warning icon
  - Allow bulk add/remove via `POST/DELETE /api/public-links/:id/photos`
  - **Tests**: UI tests verifying assignment updates

### Phase 5: Polish & Security
- **Step 5.1 — Private photo indicators**
  - In admin view of shared links, apply gray overlay to private photos
  - Add tooltip explaining "Private - only visible to admins"
  - Ensure public users never see private photos in shared links
  - **Tests**: Manual verification as admin and public user

- **Step 5.2 — 404 handling**
  - Return 404 for non-existent shared link hashes
  - Show user-friendly error page
  - **Tests**: Navigate to `/shared/invalid-hash`

- **Step 5.3 — Permissions & audit logging**
  - Ensure all admin routes use `authenticateAdmin` middleware
  - Log key events: link creation, regeneration, deletion, photo assignment changes
  - **Tests**: Review logs during manual QA

## Acceptance criteria
- **Shared link viewing**:
  - `/shared/:hashedKey` displays photos using the standard grid component with `public_link_id` filter
  - Public users see only public photos; admins see all photos with private ones grayed out
  - Description displays above the grid if set
  - No authentication required for public users
  - Admin-only UI elements hidden for public users

- **Admin management**:
  - `/publiclinks` route accessible only to authenticated admins via hamburger menu
  - List view shows all shared links with title, description, link, photo count, and actions
  - Create/edit modal allows setting title and description
  - Regenerate key works with confirmation dialog
  - Delete works with confirmation dialog
  - Photo assignment modal allows managing membership with private-photo warnings

- **Technical**:
  - All actions persist correctly via backend APIs
  - UI reflects updates without full-page reloads
  - No code duplication - shared links reuse existing grid components
  - Public access properly gated by middleware
  - Automated and manual tests cover all workflows

## Post-milestone documentation
- Update `PROJECT_OVERVIEW.md` with shared link architecture (filtered grid approach)
- Update `SCHEMA_DOCUMENTATION.md` with:
  - Router mount points: `server/routes/publicLinks.js`
  - API endpoints and parameters
  - Database schema for `public_links` and `public_link_photos` tables
- Update `SECURITY.md` with:
  - Public access patterns
  - Private photo visibility rules
  - Auth middleware exceptions
- Update `README.md` with:
  - Shared link feature overview
  - Admin workflows
  - Public user experience

## Key Implementation Notes
1. **No separate viewer component** - shared links are just filtered grids
2. **Filter-based approach** - `public_link_id` is treated like any other filter (date, file type, etc.)
3. **Reuse existing code** - leverage `AllPhotosPane`, `useAllPhotosPagination`, and existing grid logic
4. **Public access** - middleware allows `/api/photos?public_link_id=X` without auth
5. **Private photo handling** - backend filters by visibility for public users; frontend shows gray overlay for admins