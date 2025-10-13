# Milestone 5 Progress: Photo → Link Assignment

**Status**: 🚀 **READY TO START**  
**Prerequisites**: ✅ Milestone 4 Phase 2 Complete  
**Date**: October 12, 2025

---

## Overview

Milestone 5 adds the ability for admins to assign photos to shared links directly from the photo grid and action menus. This completes the shared links workflow by allowing admins to:
- Select photos in All Photos or Project views
- Add them to existing shared links or create new ones
- View which links a photo belongs to
- Remove photos from links

The UX mirrors the existing "Move to..." workflow for consistency.

---

## What Milestone 4 Delivered (Your Foundation)

### Backend Infrastructure ✅
1. **Dual-Endpoint Architecture**:
   - `GET /shared/api/:hashedKey` - Public endpoint (only public photos)
   - `GET /shared/api/:hashedKey/admin` - Admin endpoint (all photos)
   - Both use `listSharedLinkPhotos()` with conditional `includePrivate` parameter

2. **Repository Functions** (`server/services/repositories/publicLinksRepo.js`):
   - `create({ title, description })` - Create new shared link
   - `update(id, { title, description })` - Update link metadata
   - `delete(id)` - Delete link (cascades to photo associations)
   - `regenerateKey(id)` - Generate new hashed key
   - **`addPhotos(linkId, photoIds)`** - ✅ Already exists! Associate photos with link
   - **`removePhoto(linkId, photoId)`** - ✅ Already exists! Remove photo from link
   - `getById(id)` - Get link by ID
   - `getByHashedKey(hashedKey)` - Get link by public hash
   - `listAll()` - List all links with photo counts
   - `getPhotoCount(linkId)` - Count photos in link

3. **API Endpoints** (`server/routes/publicLinks.js`):
   - `POST /api/public-links/:id/photos` - ✅ Already exists! Add photos to link
   - `DELETE /api/public-links/:id/photos/:photoId` - ✅ Already exists! Remove photo from link
   - All endpoints protected by `authenticateAdmin` middleware
   - Rate limiting in place (10 req/5min for creation, 5 req/5min for key regeneration)

4. **Security**:
   - ✅ All 63 automated tests pass
   - ✅ Public endpoint never returns private photos (verified by tests)
   - ✅ Admin endpoint requires authentication (verified by tests)
   - ✅ Route order correct (admin before public in `sharedLinks.js`)

### Frontend Infrastructure ✅
1. **Data Layer**:
   - `useSharedLinkData` hook - Fetches shared link data with auto-endpoint selection
   - `client/src/api/sharedLinksManagementApi.js` - API client with all CRUD functions
   - **`addPhotosToLink(id, photoIds)`** - ✅ Already exists!
   - **`removePhotoFromLink(id, photoId)`** - ✅ Already exists!

2. **UI Components**:
   - `SharedLinksPage.jsx` - Full CRUD management interface at `/sharedlinks`
   - `SharedLinkPage.jsx` - Public viewing page (uses `AllPhotosPane`)
   - `AllPhotosPane` - Unified grid component for all users
   - Selection system works in All Photos and Project views

3. **Routing**:
   - `/sharedlinks` - Management page (authenticated)
   - `/shared/:hashedKey` - Public/admin viewing page
   - "Exit shared link" button navigates to `/sharedlinks`

4. **State Management**:
   - `isSharedLinkMode` detection in `App.jsx`
   - Unified selection model (`PhotoRef` objects)
   - Selection works across All Photos and Project views

---

## What You Need to Build

### Step 1: Action Menu Integration

**Goal**: Add "Share..." option to photo action menus

**Files to Modify**:
- `client/src/components/PhotoActionsMenu.jsx` (or wherever action menu is defined)
- Similar to existing "Move to..." option

**Implementation**:
```javascript
// Add new menu item
<button onClick={() => onShare(selectedPhotos)}>
  <ShareIcon />
  Share...
</button>
```

**Handler**: Create `handleShare()` function that:
1. Opens modal with list of shared links
2. Allows multi-select of existing links
3. Provides "Create New Link" option
4. Shows which links photo already belongs to

---

### Step 2: Share Modal Component

**Goal**: Create modal for assigning photos to shared links

**New File**: `client/src/components/ShareModal.jsx`

**Features**:
1. **List existing shared links**:
   - Fetch from `GET /api/public-links`
   - Show title, description, photo count
   - Checkbox for each link
   - Indicate which links already contain selected photos

2. **Create new link**:
   - Inline form or nested modal
   - Title (required) + description (optional)
   - Auto-select newly created link

3. **Batch operations**:
   - Add selected photos to multiple links at once
   - API calls: `POST /api/public-links/:id/photos` with `{ photo_ids: [1, 2, 3] }`

4. **Loading states**:
   - Show spinner while fetching links
   - Disable buttons during API calls
   - Toast notifications for success/errors

**API Client Functions** (already exist in `sharedLinksManagementApi.js`):
```javascript
import { 
  listSharedLinks,
  createSharedLink,
  addPhotosToLink 
} from '../api/sharedLinksManagementApi';
```

---

### Step 3: Audit Functionality

**Goal**: Show which links a photo belongs to

**Options**:
1. **Photo Info Panel**: Add "Shared Links" section showing all links
2. **Context Menu**: Add "View Shared Links" option
3. **Hover Tooltip**: Show link count on photo thumbnail

**New API Endpoint** (needs to be created):
```javascript
// Backend: server/routes/publicLinks.js
GET /api/photos/:photoId/links
// Returns: [{ id, title, hashed_key, created_at }, ...]
```

**Repository Function** (needs to be created):
```javascript
// server/services/repositories/publicLinksRepo.js
getLinksForPhoto(photoId) {
  return db.prepare(`
    SELECT pl.id, pl.title, pl.description, pl.hashed_key, pl.created_at
    FROM public_links pl
    INNER JOIN photo_public_links ppl ON pl.id = ppl.public_link_id
    WHERE ppl.photo_id = ?
    ORDER BY pl.created_at DESC
  `).all(photoId);
}
```

---

### Step 4: Remove from Link

**Goal**: Allow removing photos from shared links

**UI Options**:
1. **In Share Modal**: Show "Remove" button for links photo already belongs to
2. **In Photo Info Panel**: Show "Remove from [Link Name]" button
3. **Bulk Operation**: Select multiple photos, remove from specific link

**API Call** (already exists):
```javascript
import { removePhotoFromLink } from '../api/sharedLinksManagementApi';

// Usage
await removePhotoFromLink(linkId, photoId);
```

---

## Code Reuse Opportunities

### 1. Modal Pattern
Look at existing modals for reference:
- `CreateProjectModal.jsx` - Form with validation
- `CommitModal.jsx` - Confirmation with preview
- `DeleteConfirmModal.jsx` (in `SharedLinksPage.jsx`) - Confirmation pattern

### 2. Selection Handling
Reuse existing selection logic:
- `useSelection.js` hook (if exists)
- `PhotoRef` objects for cross-project selection
- Selection state in `App.jsx`

### 3. API Client Pattern
Follow existing pattern in `sharedLinksManagementApi.js`:
```javascript
export async function myNewFunction(params) {
  const res = await fetch('/api/endpoint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // Important for auth!
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Operation failed');
  }
  return res.json();
}
```

### 4. Toast Notifications
Use existing toast system:
```javascript
import { useToast } from '../ui/toast/ToastContext';

const toast = useToast();
toast.show({
  emoji: '✅',
  message: 'Photos added to shared link',
  variant: 'success',
});
```

---

## Testing Strategy

### Backend Tests
Add to `server/routes/__tests__/publicLinks.test.js`:
```javascript
describe('Photo Assignment', () => {
  it('adds multiple photos to link', async () => {
    // Test POST /api/public-links/:id/photos
  });
  
  it('removes photo from link', async () => {
    // Test DELETE /api/public-links/:id/photos/:photoId
  });
  
  it('gets links for photo', async () => {
    // Test GET /api/photos/:photoId/links
  });
});
```

### Frontend Tests (Manual QA)
1. Select photos in All Photos view → Share → Add to existing link
2. Select photos in Project view → Share → Create new link
3. Select photos already in link → Share → Shows checkmarks
4. View photo info → Shows shared links section
5. Remove photo from link → Confirmation → Success toast
6. Bulk operation: Add 10 photos to 3 links simultaneously

---

## Security Considerations

### ✅ Already Handled by Milestone 4
- All `/api/public-links/*` endpoints require authentication
- Rate limiting in place
- Public endpoint never exposes private photos
- Asset URLs use hash-based validation

### ⚠️ New Considerations for Milestone 5
1. **Validate photo ownership**: Ensure admin can only add photos they have access to
2. **Batch size limits**: Limit number of photos per request (e.g., max 200)
3. **Rate limiting**: Consider adding rate limits to new endpoints
4. **Audit logging**: Log photo additions/removals for forensics

---

## API Endpoints Summary

### ✅ Already Exist (Ready to Use)
- `GET /api/public-links` - List all links
- `POST /api/public-links` - Create link
- `PATCH /api/public-links/:id` - Update link
- `DELETE /api/public-links/:id` - Delete link
- `POST /api/public-links/:id/regenerate` - Regenerate key
- `POST /api/public-links/:id/photos` - Add photos to link ⭐
- `DELETE /api/public-links/:id/photos/:photoId` - Remove photo ⭐

### 🆕 Need to Create
- `GET /api/photos/:photoId/links` - Get links for photo (for audit functionality)

---

## File Structure Reference

```
server/
├── routes/
│   ├── publicLinks.js          ✅ Exists - Add GET /api/photos/:photoId/links
│   └── __tests__/
│       └── publicLinks.test.js ✅ Exists - Add new tests
├── services/
│   └── repositories/
│       └── publicLinksRepo.js  ✅ Exists - Add getLinksForPhoto()

client/
├── src/
│   ├── api/
│   │   └── sharedLinksManagementApi.js ✅ Exists - All functions ready
│   ├── components/
│   │   ├── PhotoActionsMenu.jsx        🆕 Modify - Add "Share..." option
│   │   └── ShareModal.jsx              🆕 Create - Main modal component
│   └── hooks/
│       └── useSharePhotos.js           🆕 Create - Share logic hook (optional)
```

---

## Implementation Order

1. **Backend First** (1-2 hours):
   - Add `getLinksForPhoto()` to `publicLinksRepo.js`
   - Add `GET /api/photos/:photoId/links` to `publicLinks.js`
   - Write tests

2. **Frontend Data Layer** (1-2 hours):
   - Add `getLinksForPhoto()` to `sharedLinksManagementApi.js`
   - Create `useSharePhotos.js` hook (optional, for state management)

3. **UI Components** (3-4 hours):
   - Create `ShareModal.jsx` component
   - Add "Share..." to action menus
   - Add shared links section to photo info panel

4. **Testing & Polish** (2-3 hours):
   - Manual QA testing
   - Fix edge cases
   - Add loading states and error handling
   - Update documentation

**Total Estimate**: 7-11 hours

---

## Key Architectural Decisions from Milestone 4

### 1. Code Reuse Over Duplication
- Single `AllPhotosPane` component for all users
- Single `useSharedLinkData` hook for both endpoints
- Unified selection model across views

### 2. Security First
- Always validate authentication server-side
- Never trust client-side checks alone
- Use automated tests to verify security invariants

### 3. Consistent UX Patterns
- Modals for complex operations
- Toast notifications for feedback
- Loading states for async operations
- Confirmation dialogs for destructive actions

### 4. Scalability
- Server-side pagination for large datasets
- Rate limiting to prevent abuse
- Efficient SQL queries with proper indexes

---

## Questions to Consider

1. **Batch Operations**: Should we allow adding photos to multiple links at once? (Recommended: Yes, for efficiency)

2. **Visual Indicators**: How should we show which photos are in shared links?
   - Badge on thumbnail?
   - Icon in corner?
   - Highlight in selection mode?

3. **Audit UI**: Where should "View Shared Links" functionality live?
   - Photo info panel? (Recommended)
   - Context menu?
   - Both?

4. **Removal Confirmation**: Should removing a photo from a link require confirmation?
   - Probably yes, to prevent accidents

5. **Empty State**: What should Share modal show when no links exist?
   - Prompt to create first link
   - Show "Create New Link" button prominently

---

## Success Criteria

### Functional Requirements ✅
- [ ] Admin can select photos and add them to existing shared links
- [ ] Admin can create new shared link while sharing photos
- [ ] Admin can see which links a photo belongs to
- [ ] Admin can remove photos from shared links
- [ ] Batch operations work (multiple photos, multiple links)
- [ ] All operations show proper loading states and feedback

### Non-Functional Requirements ✅
- [ ] All automated tests pass
- [ ] No console errors or warnings
- [ ] Responsive design works on mobile
- [ ] Operations complete in < 2 seconds
- [ ] Error handling covers all edge cases

### Documentation ✅
- [ ] Update `PROJECT_OVERVIEW.md` with Milestone 5 changes
- [ ] Update `SCHEMA_DOCUMENTATION.md` with new endpoint
- [ ] Update `SECURITY.md` with security assessment
- [ ] Add inline code comments for complex logic

---

## Resources

### Existing Code to Reference
- `client/src/pages/SharedLinksPage.jsx` - Modal patterns, API usage
- `client/src/api/sharedLinksManagementApi.js` - API client pattern
- `server/routes/publicLinks.js` - Endpoint implementation pattern
- `server/routes/__tests__/publicLinks.test.js` - Test patterns

### Documentation
- `PROJECT_OVERVIEW.md` - Architecture overview
- `SCHEMA_DOCUMENTATION.md` - API reference
- `SECURITY.md` - Security guidelines
- `tasks_progress/user_auth/user_auth_Milestone4_phase2_CHECKLIST.md` - What was completed

---

## Notes from Milestone 4 Developer

1. **Route Order Matters**: Admin routes must come before public routes in Express to avoid collisions.

2. **Authentication Check**: Always use `credentials: 'include'` in fetch calls for authenticated endpoints.

3. **Error Handling**: Backend returns `{ error: 'message' }` format. Frontend should handle this consistently.

4. **Toast System**: Use `useToast()` hook for all user feedback. It's already set up and works great.

5. **Selection System**: `PhotoRef` objects work across All Photos and Project views. Don't reinvent the wheel.

6. **Testing**: Automated tests are your friend. Write them as you go, not after.

7. **Build Time**: `npm run build` takes ~2 seconds. Build often to catch errors early.

8. **Code Style**: Follow existing patterns. Consistency > cleverness.

---

## Good Luck! 🚀

You have a solid foundation from Milestone 4. The backend infrastructure is ready, the API client functions exist, and the UI patterns are established. Focus on creating a great UX for the Share modal and you'll be done in no time!

If you have questions, refer to the existing code first. The patterns are consistent throughout the codebase.

**Remember**: Test as you go, commit often, and don't hesitate to refactor if something feels wrong.
