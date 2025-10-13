# Milestone 4 Progress: Admin UI for Shared Links Management

## 2025-10-11

- **Step 1.1 — Description support for grid views (complete)**: Added heading/description plumbing across `client/src/App.jsx`, `client/src/components/MainContentRenderer.jsx`, and `client/src/components/AllPhotosPane.jsx`. All Photos now surfaces shared link title/description; project heading uses project name while awaiting per-project descriptions.
- **Step 1.2 — `public_link_id` filtering (complete)**: Extended `buildAllPhotosWhere()` and `/api/photos` to accept `public_link_id`, resolved hashed keys in `server/routes/photos.js`, and threaded the filter through `useAllPhotosPagination.js`. Added `photosPublicLink.test.js` covering happy-path and 404 cases; updated `npm test` script to run sequentially, eliminating `SQLITE_BUSY` errors.
- **Step 1.3 — Public access to filtered grid (complete)**: Updated `server.js` auth gate to allow anonymous GET `/api/photos` calls when `public_link_id` is present, exporting `attachAdminToRequest()` so authenticated admins still get private visibility. Forced `visibility='public'` for anonymous requests in `server/routes/photos.js` (including locate endpoint) while keeping admin access intact. Expanded `photosPublicLink.test.js` to assert anonymous vs admin responses and added harness logic mirroring the new middleware behavior.

## 2025-10-12 - Phase 2: Shared Link Viewing Architecture

### Phase 1.1: Backend - Update `listSharedLinkPhotos()` (complete)
- **File**: `server/services/repositories/photoFiltering.js`
- Added `includePrivate` parameter (default: `false`) to `listSharedLinkPhotos()` function
- When `includePrivate = false`: WHERE clause includes `AND ph.visibility = 'public'` (public access)
- When `includePrivate = true`: WHERE clause omits visibility filter (admin access - all photos)
- Updated all three SQL queries to respect `includePrivate` flag:
  - Main photo fetch query
  - `hasMore` pagination check query
  - Total count query
- Updated JSDoc comment to document new parameter

### Phase 1.2: Backend - Add admin endpoint (complete)
- **File**: `server/routes/sharedLinks.js`
- Added `GET /shared/api/:hashedKey/admin` endpoint **before** public `/:hashedKey` route (order critical)
- Endpoint requires admin authentication via `attachAdminToRequest()`
- Returns 401 if not authenticated
- Calls `listSharedLinkPhotos()` with `includePrivate: true`
- Returns same response format as public endpoint: `{ id, title, description, photos, total, next_cursor, prev_cursor }`
- Added structured logging for admin access with `admin_id`
- Public endpoint unchanged - still returns only public photos

### Phase 1.3: Backend Tests (complete)
- **File**: `server/routes/__tests__/sharedLinks.test.js`
- Added 7 new tests for admin endpoint in "Shared Links Admin Endpoint" test suite:
  1. ✅ Admin endpoint returns all photos (public + private) with valid token
  2. ✅ Admin endpoint returns 401 without authentication
  3. ✅ Admin endpoint returns 401 with invalid token
  4. ✅ Admin endpoint returns 404 for non-existent link
  5. ✅ Admin endpoint pagination works correctly
  6. ✅ Public endpoint still returns only public photos (regression test)
  7. ✅ Admin endpoint returns correct total count
- All tests passing with `npm test`
- Tests verify:
  - Admin sees all photos (2 public + 1 private = 3 total)
  - Public endpoint unchanged (still returns only 2 public photos)
  - Authentication required (401 without token)
  - Pagination works for admin endpoint
  - Total counts accurate for both endpoints

## Phase 2: Frontend - Unified Shared Link Data Hook

### Phase 2.1: Create `useSharedLinkData` hook (complete)
- **File**: `client/src/hooks/useSharedLinkData.js`
- Created custom React hook for fetching shared link data
- **Key Features**:
  - Automatically detects auth status via `isAuthenticated` prop
  - Calls `/shared/api/:hash/admin` for authenticated users (all photos)
  - Calls `/shared/api/:hash` for public users (public photos only)
  - Handles pagination with `loadMore()` and `loadPrev()` methods
  - Returns: `photos`, `metadata`, `total`, `nextCursor`, `prevCursor`, `loading`, `error`
  - Includes `hasMore` and `hasPrev` convenience flags
  - Provides `reload()` method to reset to first page
- **Implementation Details**:
  - Uses `fetch()` with `credentials: 'include'` for cookie-based auth
  - Implements request deduplication with `fetchingRef`
  - Supports request cancellation with `AbortController`
  - Cleans up pending requests on unmount
  - Handles errors: 404 (not found), 401 (auth required), network errors
  - Supports append mode for pagination (append=true) or replace mode (append=false)
- **State Management**:
  - `photos`: Array of photo objects
  - `metadata`: `{ id, title, description }`
  - `total`: Total photo count
  - `nextCursor`, `prevCursor`: Pagination cursors
  - `loading`: Boolean loading state
  - `error`: Error object or null

### Phase 3.1: Integrate `useSharedLinkData` into App.jsx (complete)
- **File**: `client/src/App.jsx`
- **Removed complex dual data flow**:
  - ❌ Removed `sharedLinkIsAdminView` logic that called `/api/photos`
  - ❌ Removed `sharedLinkPhotos`, `sharedLinkTotal`, `sharedLinkNextCursor`, `sharedLinkPrevCursor`, `sharedLinkLoading` state variables
  - ❌ Removed complex `useEffect` hooks for shared link metadata fetching
  - ❌ Removed dual filter synchronization logic for admin vs public shared views
  - ❌ Removed `inSharedLinkMode` variable (replaced with `isSharedLinkMode`)
- **Added unified shared link handling**:
  - ✅ Added `const isSharedLinkMode = !!sharedLinkHash`
  - ✅ Integrated `useSharedLinkData` hook with `isAuthenticated` detection
  - ✅ Hook automatically calls correct endpoint based on auth status
  - ✅ Simplified shared mode effect to just clear project selection
- **Updated pagination hooks**:
  - ✅ `useProjectPagination`: Added `!isSharedLinkMode &&` to `isEnabled` condition
  - ✅ `useAllPhotosPagination`: Changed to `!isSharedLinkMode && view?.project_filter === null`
  - ✅ Both hooks now disabled when in shared mode
- **Updated UI controls**:
  - ✅ Upload button and options menu: Show only when `isAuthenticated` (not based on shared mode)
  - ✅ "Exit shared link" button: Show only when `isAuthenticated` (public users don't see it)
  - ✅ Project selector bar: Shows for shared mode with simplified logic
- **Passed shared data to MainContentRenderer**:
  - ✅ Added `isSharedMode` prop
  - ✅ Added all shared link data props: `sharedPhotos`, `sharedTotal`, `sharedNextCursor`, `sharedPrevCursor`
  - ✅ Added shared link methods: `sharedLoadMore`, `sharedLoadPrev`, `sharedHasMore`, `sharedHasPrev`, `sharedLoading`
- **Result**:
  - Eliminated ~70 lines of complex dual-flow logic
  - Single source of truth for shared link data (the hook)
  - Cleaner separation: hook handles data, App.jsx handles UI
  - Ready for Phase 4 (MainContentRenderer integration)

## Phase 4: Frontend - Update MainContentRenderer

### Phase 4.1: Add shared mode rendering (complete)
- **File**: `client/src/components/MainContentRenderer.jsx`
- **Added new props** (9 props for shared link support):
  - `isSharedMode`: Boolean flag to detect shared mode
  - `sharedPhotos`: Array of photo objects from hook
  - `sharedTotal`: Total photo count
  - `sharedNextCursor`, `sharedPrevCursor`: Pagination cursors
  - `sharedLoadMore`, `sharedLoadPrev`: Pagination methods
  - `sharedHasMore`, `sharedHasPrev`: Boolean flags
  - `sharedLoading`: Loading state
- **Added shared mode rendering branch**:
  - ✅ Checks `isSharedMode` **first** (takes precedence over all/project modes)
  - ✅ Renders `AllPhotosPane` component with shared data
  - ✅ Uses `sharedPhotos` instead of `allPhotos`
  - ✅ Uses `sharedHasMore`/`sharedHasPrev` for pagination buttons
  - ✅ Uses `sharedLoadMore`/`sharedLoadPrev` for pagination actions
  - ✅ Passes `sharedLoading` to show loading state
  - ✅ Reuses existing selection handlers (`handleAllPhotoSelect`, `handleToggleSelectionAll`, `allSelectedKeys`)
  - ✅ Reuses existing config for lazy loading and dwell time
- **Rationale**:
  - Reuses `AllPhotosPane` component (no duplication)
  - Shared mode behaves like "All Photos" but with different data source
  - Selection, viewer, and all other features work identically
- **Result**:
  - Shared link photos now render in grid
  - Pagination works (Load More/Load Prev buttons)
  - Ready for manual testing

### Phase 4.2: Bug Fixes (complete)
- **Issue 1**: Hardcoded `limit: 50` in App.jsx
  - **Fix**: Changed to `limit: 100` to match `DEFAULT_LIMIT` from `useAllPhotosPagination`
  - **Impact**: Consistent page size across all views
- **Issue 2**: Admin sees no images in shared link view
  - **Root Cause 1**: `fetchData` in useEffect dependency array caused infinite loop
  - **Problem**: `fetchData` depends on `isAuthenticated`, so when it changes, `fetchData` is recreated, triggering effect again, which aborts previous fetch
  - **Fix 1**: Removed `fetchData` from deps, added only actual dependencies: `[hashedKey, isAuthenticated, limit]`
  - **Root Cause 2**: React Strict Mode runs effects twice, cleanup aborted second fetch
  - **Problem**: First effect starts fetch, cleanup aborts it, second effect sees `fetchingRef.current = true` and skips
  - **Fix 2**: Reset `fetchingRef.current = false` in cleanup function
  - **Impact**: Hook now works reliably in both dev (Strict Mode) and production
- **Build**: ✅ Successful (468.64 kB)
- **Testing**: ✅ Admin sees all photos (public + private), public users see only public photos

## Phase 5: Frontend - Conditional UI Controls

### Phase 5.1: Hide admin controls for public users (complete)
- **File**: `client/src/App.jsx`
- **Implementation** (lines 757-837):
  - ✅ **Upload button**: `isAuthenticated && !isSharedLinkMode` (line 782)
    - Hidden in shared mode AND for public users
    - Visible for admin in `/all` and `/project/:folder`
  - ✅ **Operations menu**: `isAuthenticated` (line 792)
    - Shows for authenticated users (including shared mode)
    - Hidden for public users
  - ✅ **Selection toolbar**: `isAuthenticated` (line 758)
    - Shows for authenticated users when selections exist
    - Hidden for public users
  - ✅ **Login button**: `!isAuthenticated` (line 824)
    - Shows for public users to allow login
    - Redirects to `/` (login page)
  - ✅ **Header**: Always visible with "Druso Photo Manager" title (line 776)
  - ✅ **"Exit shared link" button**: `isAuthenticated` in shared mode (line 821)
- **Current behavior**:
  - **Public users**: See header + login button, photo grid, no admin controls
  - **Admin users**: See all controls (upload when not in shared mode, options, selection)
- **Testing**: ✅ Manual testing required
  - Public user at `/shared/:hash` → Header visible, login button, no upload/options/selection
  - Admin at `/shared/:hash` → Header, options menu (no upload), selection toolbar
  - Admin at `/all` → Header, upload button, options menu, selection toolbar
  - Admin at `/project/:folder` → Header, upload button, options menu, selection toolbar
- **Build**: ✅ Successful (469.26 kB)

### Phase 5.2: Add header to SharedLinkPage for public users (complete)
- **File**: `client/src/pages/SharedLinkPage.jsx`
- **Issue**: Public users viewing `/shared/:hash` were rendered by `SharedLinkPage.jsx`, not `App.jsx`
  - `main.jsx` routes unauthenticated users to `SharedLinkPage` component
  - This component had no app header or login button
- **Implementation** (lines 104-133):
  - ✅ Added app header with "Druso Photo Manager" title (line 107-109)
  - ✅ Added login button for public users (line 112-122)
  - ✅ Kept shared link title and description below header (line 126-131)
  - ✅ Header is sticky (`sticky top-0 z-20`)
- **Result**: Public users now see consistent header across all pages
- **Build**: ✅ Successful (469.97 kB)

### Phase 5.3: Unify grid component for public and admin users (complete)
- **File**: `client/src/pages/SharedLinkPage.jsx`
- **Issue**: Public users had a custom simple grid, admin users had `AllPhotosPane` with virtualization/pagination
  - Code duplication (~40 lines of custom grid code)
  - Inconsistent UX (different grid styles, no pagination for public)
  - Missing features: virtualization, lazy loading, proper pagination
- **Solution**: Replace custom grid with `AllPhotosPane` component
  - ✅ Removed custom `map()` grid (lines 137-152 deleted)
  - ✅ Added `AllPhotosPane` component (lines 105-125)
  - ✅ Reused `useSharedLinkData` hook (already implemented)
  - ✅ Disabled admin features for public: sorting, selection
- **Benefits**:
  - **Code reuse**: Single grid component for all users
  - **Consistent UX**: Same grid style, spacing, hover effects
  - **Better performance**: Virtualization, lazy loading, pagination
  - **Maintainability**: Changes to grid affect all users equally
- **Result**: Public and admin users now see identical grid with same features
- **Build**: ✅ Successful (468.68 kB) - Actually smaller due to code removal!

## Phase 6: Create Shared Links Management Page

### Phase 6.1: Investigation of `/publiclinks` route (complete)
- **Investigation Results**:
  - ❌ No `/publiclinks` or `/sharedlinks` route exists in `client/src/main.jsx`
  - ❌ No frontend component for shared links management exists
  - ✅ Backend API exists at `/api/public-links` (requires authentication)
  - ✅ Backend router: `server/routes/publicLinks.js`
  
- **Backend API Endpoints Found** (`/api/public-links`):
  - `GET /` - List all public links (with photo counts)
  - `POST /` - Create a new public link (requires title, optional description)
  - `GET /:id` - Get specific public link details
  - `PUT /:id` - Update public link (title, description)
  - `DELETE /:id` - Delete public link
  - `POST /:id/regenerate-key` - Regenerate hashed key
  - `POST /:id/photos` - Add photos to link
  - `DELETE /:id/photos/:photoId` - Remove photo from link
  
- **Why `/publiclinks` "lands on empty project"**:
  - The route doesn't exist in frontend router
  - `main.jsx` Router catches all non-`/shared/:hash` routes and sends them to `ProtectedApp`
  - `ProtectedApp` renders `App.jsx` which likely treats unknown paths as empty project
  
- **Next Steps**:
  - Create frontend API client for management endpoints
  - Create SharedLinksManagement component
  - Add route to `main.jsx` for `/sharedlinks`
  - Component should list, create, edit, delete shared links

### Phase 6.2: Create SharedLinksPage component and routing (complete)
- **Files Created**:
  1. **`client/src/api/sharedLinksManagementApi.js`** (152 lines)
     - API client for all management endpoints
     - Functions: `listSharedLinks`, `createSharedLink`, `updateSharedLink`, `deleteSharedLink`, `regenerateKey`, `addPhotosToLink`, `removePhotoFromLink`
     - All requests include `credentials: 'include'` for authentication
  
  2. **`client/src/pages/SharedLinksPage.jsx`** (550+ lines)
     - Full-featured management page
     - Components: `SharedLinksPage`, `LinkCard`, `CreateLinkModal`, `EditLinkModal`, `DeleteConfirmModal`
     - Features implemented:
       - ✅ List all shared links with photo counts
       - ✅ Create new links (modal with title + description)
       - ✅ Edit existing links (modal)
       - ✅ Delete links (confirmation modal)
       - ✅ Preview links (opens in new tab)
       - ✅ Copy link to clipboard
       - ✅ Regenerate key (security feature)
       - ✅ Empty state with call-to-action
       - ✅ Loading states for all operations
       - ✅ Toast notifications for all actions
  
  3. **`client/src/main.jsx`** (updated)
     - Added `/sharedlinks` route (line 91-97)
     - Created `ProtectedSharedLinksPage` component (line 108-135)
     - Route requires authentication (redirects to login if not authenticated)

- **UI/UX Features**:
  - **Card-based layout**: 3-column grid on large screens, responsive
  - **Action buttons**: Preview, Copy, Edit, Regenerate Key, Delete
  - **Modals**: Create, Edit, Delete confirmation
  - **Stats**: Photo count displayed on each card
  - **Empty state**: Helpful message when no links exist
  - **Toast feedback**: Success/error messages for all operations

- **Security**:
  - ✅ Route protected by authentication
  - ✅ All API calls include credentials
  - ✅ Regenerate key feature for compromised links
  - ✅ Delete confirmation to prevent accidents

- **Build**: ✅ Successful (483.36 kB)
- **Testing**: Manual testing required (see Phase 6.2 plan)
