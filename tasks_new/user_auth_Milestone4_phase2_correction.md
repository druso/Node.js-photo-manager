# Shared Links Architecture - Simplified Implementation Plan

## Requirements Summary

### View Modes
1. **`/all`** - Admin only, all photos across projects
2. **`/project/:folder`** - Admin only, photos in specific project  
3. **`/shared/:hash`** - Public OR Admin, photos in shared link

### Shared Link Behavior
- **Admin view**: See ALL photos (public + private) in the shared link, with full controls (filters, selection, operations)
- **Public view**: See ONLY public photos in the shared link, with minimal controls (future: may add filters/sorting)
- **Exit behavior**: Admin clicking "Exit shared link" → navigate to `/sharedlinks` (management page)

### Security Principles
1. **Critical**: Public users MUST NOT see private photos
2. **Acceptable**: Public users MAY see public photos not in their specific shared link (low risk)

### Scalability Principles
- Public view features will expand over time (filters, sorting, etc.)
- Admin view features apply uniformly across `/all`, `/project`, `/shared` with minor UI differences
- Minimize code duplication between public and admin shared views

---

## Current State Analysis

### Backend
**File**: `server/routes/sharedLinks.js`
- ✅ Public endpoint: `GET /shared/api/:hashedKey`
- ✅ Returns: `{ id, title, description, photos[], total, next_cursor, prev_cursor }`
- ❌ **Issue**: Currently filters to `visibility = 'public'` only (line 377 in `photoFiltering.js`)
- ❌ **Missing**: No admin-aware endpoint that returns ALL photos (public + private) in shared link

**File**: `server/services/repositories/photoFiltering.js`
- Function: `listSharedLinkPhotos()`
- Current WHERE: `ppl.public_link_id = ? AND ph.visibility = 'public'`
- **Needs**: Optional parameter to include private photos for authenticated admins

### Frontend Routing
**File**: `client/src/main.jsx`
- ✅ `SharedLinkRoute` component handles `/shared/:hash`
- ✅ Renders `SharedLinkPage` for unauthenticated users
- ✅ Renders `App` for authenticated users
- ✅ Auth detection working correctly
- ❌ **Missing**: No `/sharedlinks` (or `/publiclinks`) management page route

**File**: `client/src/App.jsx`
- ❌ **Issue**: Admin shared view tries to use `/api/photos?public_link_id=...` (returns empty)
- ❌ **Issue**: Complex dual-flow logic with `sharedLinkIsAdminView` flag
- ❌ **Issue**: Project state conflicts with shared link state

**File**: `client/src/pages/SharedLinkPage.jsx`
- ✅ Public view working correctly
- ✅ Uses `/shared/api/:hash` endpoint
- ✅ Simple, clean implementation

**File**: Management page (missing)
- ❌ **Issue**: `/publiclinks` route may exist but is broken (lands on empty project)
- ❌ **Missing**: No working shared links management page
- **Needs**: Create `/sharedlinks` route and `SharedLinksPage` component

---

## Proposed Solution

### Phase 1: Backend - Add Admin Shared Link Endpoint

#### 1.1 Update `listSharedLinkPhotos()` function
**File**: `server/services/repositories/photoFiltering.js`

Add optional `includePrivate` parameter to allow admins to see all photos:
- When `includePrivate = false` (default): WHERE includes `AND ph.visibility = 'public'`
- When `includePrivate = true`: WHERE omits visibility filter, returns all photos in link

**Tests**:
- **File**: `server/services/repositories/__tests__/photoFiltering.test.js` (new)
- Test `listSharedLinkPhotos()` with `includePrivate: false` returns only public photos
- Test `listSharedLinkPhotos()` with `includePrivate: true` returns all photos (public + private)
- Test pagination cursors work correctly in both modes
- Test total count matches filtered results
- **Add to `npm test`**: Yes (auto-discovered by `node --test`)

#### 1.2 Add authenticated admin endpoint
**File**: `server/routes/sharedLinks.js`

Add new route **BEFORE** the public route (order matters):
- Route: `GET /shared/api/:hashedKey/admin`
- Auth: Requires admin authentication via `attachAdminToRequest`
- Returns: Same format as public endpoint, but with `includePrivate: true`
- Error: 401 if not authenticated

**Critical**: Route order matters - admin route must be registered first to match `/shared/api/:hash/admin` before the generic `/:hashedKey` pattern catches it.

**Tests**:
- **File**: `server/routes/__tests__/sharedLinks.test.js` (extend existing)
- Test `GET /shared/api/:hash/admin` with valid admin token returns all photos (public + private)
- Test `GET /shared/api/:hash/admin` without token returns 401
- Test `GET /shared/api/:hash/admin` with invalid token returns 401
- Test `GET /shared/api/:hash` (public endpoint) still returns only public photos
- Test pagination works on admin endpoint
- Test admin endpoint returns correct total count
- **Add to `npm test`**: Already included (existing test file)

---

### Phase 2: Frontend - Unified Shared Link Data Hook

#### 2.1 Create `useSharedLinkData` hook
**New File**: `client/src/hooks/useSharedLinkData.js`

**Purpose**: Single hook for fetching shared link data, works for both public and admin users

**Key features**:
- Detects auth status and calls appropriate endpoint (`/shared/api/:hash` vs `/shared/api/:hash/admin`)
- Handles pagination (loadMore, loadPrev)
- Returns: photos, metadata, total, cursors, loading, error
- Uses `authFetch` to include credentials for admin endpoint

**Tests**:
- **File**: `client/src/hooks/__tests__/useSharedLinkData.test.js` (new)
- Test hook calls `/shared/api/:hash` when `isAuthenticated: false`
- Test hook calls `/shared/api/:hash/admin` when `isAuthenticated: true`
- Test pagination (loadMore, loadPrev) updates state correctly
- Test error handling (404, 401, network errors)
- Test loading states
- Mock `authFetch` to verify correct endpoints and credentials
- **Add to `npm test`**: No (frontend tests run separately with `npm run test` in client/)

---

### Phase 3: Frontend - Simplify App.jsx Shared Link Handling

#### 3.1 Remove dual data flow complexity
**File**: `client/src/App.jsx`

**Remove**:
- `sharedLinkIsAdminView` logic that calls `/api/photos`
- `sharedLinkPhotos` state (replaced by hook)
- Complex filter synchronization for shared links

**Add**:
- `const isSharedLinkMode = !!sharedLinkHash`
- Use `useSharedLinkData` hook when `sharedLinkHash` is present
- Disable normal pagination hooks when `isSharedLinkMode` is true

**Tests**:
- **Manual testing required**:
  - Admin visits `/shared/:hash` → sees grid with photos, full controls
  - Public user visits `/shared/:hash` → sees grid with only public photos, minimal controls
  - Admin can filter/select photos in shared mode
  - No console errors or 401s
  - Network tab shows correct endpoint calls (`/shared/api/:hash/admin` for admin)
- **Regression testing**:
  - Navigate to `/all` → normal pagination works
  - Navigate to `/project/:folder` → normal pagination works
  - Switch between views → no state leaks
- **Add to `npm test`**: No (manual QA)

**Key changes**:
```javascript
// Detect shared mode
const isSharedLinkMode = !!sharedLinkHash;

// Use shared link data hook
const {
  photos: sharedPhotos,
  metadata: sharedMetadata,
  total: sharedTotal,
  // ... other returns
} = useSharedLinkData({
  hashedKey: sharedLinkHash,
  isAuthenticated,
});

// Disable normal pagination when in shared mode
const allPaginationEnabled = !isSharedLinkMode && view?.project_filter === null;
const projectPaginationEnabled = !isSharedLinkMode && view?.project_filter !== null;
```

#### 3.2 Clear project state on shared link mount

```javascript
useEffect(() => {
  if (!isSharedLinkMode) return;
  
  // Clear project selection
  setSelectedProject(null);
  
  // Set view to "all" mode (project_filter = null)
  updateProjectFilter(null);
  
  // Optionally clear filters
  setActiveFilters({
    textSearch: '',
    dateRange: { start: '', end: '' },
    fileType: 'any',
    orientation: 'any',
    keepType: 'any',
    visibility: 'any',
  });
}, [isSharedLinkMode, updateProjectFilter, setSelectedProject, setActiveFilters]);
```

#### 3.3 Update UI rendering logic

**Grid heading**:
```javascript
const gridHeading = isSharedLinkMode
  ? (sharedMetadata.title || 'Shared Gallery')
  : isAllMode
    ? 'All Photos'
    : (selectedProject?.name || selectedProject?.folder || '');
```

**Breadcrumb/Project selector**:
```javascript
{(selectedProject || view?.project_filter === null || isSharedLinkMode) && (
  <div className="bg-white border-b-0 relative">
    {isSharedLinkMode ? (
      // Shared link breadcrumb
      <div className="flex items-center gap-3">
        <div className="text-sm text-gray-600">
          Viewing shared link: <span className="font-semibold">{sharedMetadata.title || sharedLinkHash}</span>
        </div>
        <button onClick={() => window.location.href = '/sharedlinks'}>
          Exit shared link
        </button>
      </div>
    ) : (
      // Normal project selector
      // ... existing code
    )}
  </div>
)}
```

---

### Phase 4: Frontend - Update MainContentRenderer

#### 4.1 Add shared mode rendering
**File**: `client/src/components/MainContentRenderer.jsx`

**Add new props**:
- `isSharedMode`
- `sharedPhotos`
- `sharedTotal`
- `sharedNextCursor`
- `sharedPrevCursor`
- `sharedLoadMore`
- `sharedLoadPrev`
- `handleSharedPhotoSelect`
- `handleToggleSelectionShared`
- `selectedSharedPhotos`

**Add rendering branch** (takes precedence over all/project):
```javascript
if (isSharedMode) {
  return (
    <AllPhotosPane
      viewMode={viewMode}
      sortKey={sortKey}
      sortDir={sortDir}
      sizeLevel={sizeLevel}
      onSortChange={onSortChange}
      photos={sharedPhotos}
      hasMore={!!sharedNextCursor}
      onLoadMore={sharedLoadMore}
      hasPrev={!!sharedPrevCursor}
      onLoadPrev={sharedLoadPrev}
      // ... other props
    />
  );
}
```

**Rationale**: Reuse `AllPhotosPane` component for shared mode - it already handles grid rendering, pagination, selection, etc.

**Tests**:
- **Manual testing required**:
  - Shared mode renders grid correctly
  - Photos display with correct thumbnails
  - Pagination buttons appear when `hasMore` or `hasPrev` is true
  - Load more/prev buttons work correctly
  - Selection works (if admin)
  - Photo viewer opens on click
- **Component tests** (optional):
  - **File**: `client/src/components/__tests__/MainContentRenderer.test.jsx` (new or extend)
  - Test `isSharedMode` renders `AllPhotosPane` with correct props
  - Test shared mode takes precedence over all/project modes
- **Add to `npm test`**: No (frontend tests run separately)

---

### Phase 5: Frontend - Conditional UI Controls

#### 5.1 Hide admin controls for public users
**File**: `client/src/App.jsx`

Wrap admin-only UI elements:

```javascript
// Upload button - hide in shared mode and for public users
{isAuthenticated && !isSharedLinkMode && (
  <UploadButton /* ... */ />
)}

// Operations menu - show for authenticated users (including shared mode)
{isAuthenticated && (
  <OperationsMenu /* ... */ />
)}

// Selection toolbar - show for authenticated users
{isAuthenticated && (
  <SelectionToolbar /* ... */ />
)}

// Filters - available for both, but may be hidden for public in future
<FilterPanel /* ... */ />
```

**Note**: Public users currently see minimal UI. In the future, we can selectively enable filters/sorting for public shared links by removing the `isAuthenticated` check for those specific controls.

**Tests**:
- **Manual testing required**:
  - Public user visits `/shared/:hash` → no upload button, no operations menu, no selection toolbar
  - Admin visits `/shared/:hash` → operations menu visible, selection toolbar visible (when selections exist)
  - Admin visits `/all` → upload button visible
  - Admin visits `/project/:folder` → upload button visible
  - Filter panel visible for both public and admin (may change in future)
- **Visual regression testing** (optional):
  - Screenshot comparison of public vs admin shared link views
- **Add to `npm test`**: No (manual QA)

---

### Phase 6: Create Shared Links Management Page

#### 6.1 Investigate and fix existing `/publiclinks` route
**Investigation needed**:
- Check if `/publiclinks` route exists in `main.jsx` or `App.jsx`
- Determine why it "lands on empty project"
- Likely causes:
  - Route exists but renders wrong component
  - Component exists but has broken data fetching
  - URL routing conflict with project routes

#### 6.2 Rename to `/sharedlinks` and create proper component
**File**: `client/src/main.jsx`

Add route (or fix existing):
```javascript
if (path === '/sharedlinks') {
  return (
    <AuthProvider>
      <ProtectedApp showSharedLinksPage={true} />
    </AuthProvider>
  );
}
```

**New File**: `client/src/pages/SharedLinksPage.jsx`

**Purpose**: Admin page to manage all shared links

**Features**:
- List all created shared links (fetch from `/api/public-links`)
- Click to preview (navigate to `/shared/:hash`)
- Delete/edit links (title, description)
- Create new links
- Show link stats (photo count, created date)
- Copy link to clipboard

**API Integration**:
- `GET /api/public-links` - List all links
- `POST /api/public-links` - Create new link
- `PATCH /api/public-links/:id` - Update link
- `DELETE /api/public-links/:id` - Delete link

**Note**: This page is **admin-only** and should be accessible from the hamburger menu.

**Tests**:
- **Manual testing required**:
  - Navigate to `/sharedlinks` → page loads, shows list of links
  - Create new link → appears in list
  - Edit link title/description → updates immediately
  - Delete link → removed from list, confirmation dialog shown
  - Click preview → navigates to `/shared/:hash`
  - Copy link button → copies full URL to clipboard
  - Public user cannot access `/sharedlinks` (redirected to login or 403)
- **Backend API tests** (already exist):
  - **File**: `server/routes/__tests__/publicLinks.test.js` (existing)
  - Tests for GET, POST, PATCH, DELETE already implemented
- **Add to `npm test`**: Backend tests already included

---

## Implementation Checklist

### Backend
- [ ] Update `listSharedLinkPhotos()` to accept `includePrivate` parameter
- [ ] Update WHERE clause to conditionally filter by visibility
- [ ] Update total count query to match WHERE clause
- [ ] **Write tests**: Create `server/services/repositories/__tests__/photoFiltering.test.js`
- [ ] **Run tests**: `npm test` (auto-discovers new test file)
- [ ] Add `/shared/api/:hashedKey/admin` endpoint with auth check
- [ ] Ensure route order is correct (admin before public)
- [ ] **Write tests**: Extend `server/routes/__tests__/sharedLinks.test.js` with admin endpoint tests
- [ ] **Run tests**: `npm test` (verifies admin endpoint auth, public endpoint unchanged)

### Frontend - Data Layer
- [ ] Create `useSharedLinkData` hook
- [ ] Implement endpoint selection based on auth status
- [ ] Implement pagination (loadMore, loadPrev)
- [ ] **Write tests** (optional): Create `client/src/hooks/__tests__/useSharedLinkData.test.js`
- [ ] **Run tests** (optional): `cd client && npm test` (if frontend test suite exists)
- [ ] **Manual test**: Verify hook calls correct endpoint based on auth status (check Network tab)

### Frontend - App.jsx Integration
- [ ] Add `isSharedLinkMode` detection
- [ ] Integrate `useSharedLinkData` hook
- [ ] Disable `useAllPhotosPagination` when `isSharedLinkMode` is true
- [ ] Disable `useProjectPagination` when `isSharedLinkMode` is true
- [ ] Clear project state on shared link mount
- [ ] Update grid heading logic
- [ ] Update breadcrumb/project selector UI
- [ ] Wire shared data to `MainContentRenderer`
- [ ] Add selection handlers for shared mode
- [ ] **Manual test**: Admin visits `/shared/:hash` → grid renders, full controls visible
- [ ] **Manual test**: Public visits `/shared/:hash` → grid renders, minimal controls
- [ ] **Manual test**: Network tab shows `/shared/api/:hash/admin` for admin
- [ ] **Regression test**: Navigate to `/all` and `/project` → normal pagination works

### Frontend - MainContentRenderer
- [ ] Add shared mode props
- [ ] Add shared mode rendering branch (before all/project checks)
- [ ] **Manual test**: Grid renders correctly with shared data
- [ ] **Manual test**: Pagination works (load more, load prev)
- [ ] **Manual test**: Selection works (admin only)
- [ ] **Manual test**: Photo viewer opens on click

### Frontend - UI Controls
- [ ] Wrap upload button with `isAuthenticated && !isSharedLinkMode`
- [ ] Wrap operations menu with `isAuthenticated`
- [ ] Wrap selection toolbar with `isAuthenticated`
- [ ] **Manual test**: Public view hides admin controls (no upload, no operations, no selection)
- [ ] **Manual test**: Admin view shows all controls (operations, selection when active)
- [ ] **Manual test**: Filter panel visible for both (may change in future)

### Frontend - Shared Links Management
- [ ] Investigate existing `/publiclinks` route (if any)
- [ ] Fix or remove broken `/publiclinks` implementation
- [ ] Create `/sharedlinks` route in `main.jsx`
- [ ] Create `SharedLinksPage` component
- [ ] Implement list view of shared links (fetch from `/api/public-links`)
- [ ] Implement create functionality (modal or inline form)
- [ ] Implement edit functionality (title, description)
- [ ] Implement delete functionality (with confirmation)
- [ ] Add copy link button
- [ ] Add link to hamburger menu
- [ ] Wire "Exit shared link" button to navigate to `/sharedlinks`
- [ ] **Manual test**: Navigate to `/sharedlinks` → page loads, shows list
- [ ] **Manual test**: Create new link → appears in list
- [ ] **Manual test**: Edit link → updates immediately
- [ ] **Manual test**: Delete link → removed from list, confirmation shown
- [ ] **Manual test**: Click preview → navigates to `/shared/:hash`
- [ ] **Manual test**: Copy link → copies full URL to clipboard
- [ ] **Manual test**: Public user cannot access `/sharedlinks`
- [ ] **Backend tests**: Already exist in `server/routes/__tests__/publicLinks.test.js`

### Testing - Public User (Manual QA)
- [ ] Visit `/shared/:hash` → sees only public photos
- [ ] Verify minimal UI (no upload, no operations, no selection)
- [ ] Verify grid renders correctly
- [ ] Verify pagination works (if more than 100 photos)
- [ ] Verify no console errors or 401s
- [ ] Network tab shows `/shared/api/:hash` (not `/shared/api/:hash/admin`)
- [ ] Cannot access `/sharedlinks` management page

### Testing - Admin User (Manual QA)
- [ ] Visit `/shared/:hash` → sees all photos (public + private)
- [ ] Verify full UI (filters, selection, operations)
- [ ] Verify grid renders correctly
- [ ] Verify pagination works
- [ ] Verify can select photos
- [ ] Verify can apply filters
- [ ] Verify operations menu works
- [ ] Click "Exit shared link" → navigates to `/sharedlinks`
- [ ] Navigate to `/all` → normal pagination works
- [ ] Navigate to `/project` → normal pagination works
- [ ] No console errors or 401s
- [ ] Network tab shows `/shared/api/:hash/admin` (not `/shared/api/:hash`)
- [ ] Private photos in shared link have visual indicator (grey shade)

### Testing - Security (Automated + Manual)
- [ ] **Automated**: `npm test` runs `sharedLinks.test.js` verifying public endpoint NEVER returns private photos
- [ ] **Automated**: `npm test` runs `sharedLinks.test.js` verifying admin endpoint requires authentication (401 without)
- [ ] **Manual**: Asset URLs for private photos use proper hash validation (check Network tab)
- [ ] **Manual**: Public users cannot access `/sharedlinks` management page (redirected or 403)
- [ ] **Manual**: Public users cannot access `/shared/api/:hash/admin` (401 error)

---

## Security Verification

### Critical Checks
1. ✅ Public endpoint (`/shared/api/:hash`) NEVER returns private photos
2. ✅ Admin endpoint (`/shared/api/:hash/admin`) requires authentication
3. ✅ Asset URLs for private photos in shared links use proper hash validation
4. ✅ Public users cannot access `/sharedlinks` management page

### Acceptable Risks
- Public users MAY see public photos not in their specific shared link (if they guess URLs)
- This is acceptable per security principles - focus is preventing private photo leaks

---

## Scalability Considerations

### Code Reuse
- ✅ `useSharedLinkData` hook works for both public and admin
- ✅ `AllPhotosPane` component reused for shared mode rendering
- ✅ Filter/sort logic can be shared across all modes
- ✅ Selection/operations logic can be shared across all modes

### Future Enhancements
- Public view can easily add filters by passing filter params to hook
- Public view can add sorting by updating hook to accept sort params
- Admin shared view automatically gets new features added to all/project views
- Minimal code changes needed to add new shared link features

---

## Final Review Questions

1. **Does this approach satisfy all requirements?**
   - ✅ Admin sees all photos (public + private) in shared link
   - ✅ Public sees only public photos in shared link
   - ✅ Admin has full controls (filters, selection, operations)
   - ✅ Exit navigates to `/sharedlinks`
   - ✅ Security: private photos never leak to public
   - ✅ Scalability: code reuse maximized, easy to extend

2. **Is this simpler than the current approach?**
   - ✅ Single data source per user type (no dual flow)
   - ✅ Clear separation: hook handles data, App handles UI
   - ✅ No complex `sharedLinkIsAdminView` branching
   - ✅ Reuses existing components (`AllPhotosPane`)

3. **Are there any edge cases or risks?**
   - ⚠️ Route order in `sharedLinks.js` is critical (admin before public)
   - ⚠️ Need to ensure `authFetch` properly sends credentials for admin endpoint
   - ⚠️ Need to test pagination cursors work correctly for both endpoints
   - ⚠️ Need to ensure asset URLs work for private photos in admin shared view

4. **What's the migration path?**
   - Phase 1: Backend changes (non-breaking, adds new endpoint)
   - Phase 2: Frontend hook (independent, can be tested separately)
   - Phase 3-5: Frontend App.jsx changes (can be done incrementally)
   - Phase 6: New management page (independent feature)
   - Can deploy backend first, then frontend in stages

---

## Bridge to Milestone 5

This plan completes **Milestone 4 Phase 2** and sets up the foundation for **Milestone 5**:

### What Milestone 4 Phase 2 Delivers
1. ✅ Admin can view shared links with all photos (public + private)
2. ✅ Public users see only public photos in shared links
3. ✅ Shared links work as a distinct view mode (alongside `/all` and `/project`)
4. ✅ Management page at `/sharedlinks` to list/create/edit/delete links

### What Milestone 5 Will Add
1. **Action menu integration**: "Share" button in photo selection menu
2. **Viewer detail controls**: "Add to public link" and "Audit public links" buttons
3. **Batch operations**: Assign multiple photos to multiple links
4. **Modal UX**: Reuse "Move to..." style modal for link selection
5. **Optimistic updates**: UI updates without full refetch

### Key Difference
- **Milestone 4**: Admin can VIEW and MANAGE shared links (list, create, edit, delete)
- **Milestone 5**: Admin can ASSIGN/REMOVE photos to/from shared links from anywhere in the app

---

## Approval Checkpoint

**Ready to proceed with implementation?**

Please review the plan above and confirm:
1. ✅ Backend approach (admin endpoint + `includePrivate` flag)
2. ✅ Frontend approach (unified hook + simplified App.jsx)
3. ✅ UI approach (conditional controls + breadcrumb)
4. ✅ Security model (public endpoint filters, admin endpoint requires auth)
5. ✅ Exit behavior (navigate to `/sharedlinks`)
6. ✅ Management page investigation and fix/creation

Once approved, we'll implement in the order listed above.