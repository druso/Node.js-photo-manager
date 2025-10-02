# URL-Based State Management Modernization

## Objective
Modernize state management to rely primarily on URL parameters, reducing redundant storage and making the application more shareable and bookmarkable.

## Current State Analysis

### URL Structure (Current)
- **All Photos**: `/all` or `/all/p15/DSC05134` (with project context)
- **Project**: `/p15` or `/p15/DSC05134` (with photo viewer)
- **Filters**: `?date_from=2024-01-01&date_to=2024-12-31&file_type=jpg&keep_type=keep&orientation=vertical`

### Storage (Current)
**localStorage (`ui_prefs`)**:
- `viewMode`: grid/list view
- `sizeLevel`: thumbnail size
- `filtersCollapsed`: whether filters panel is collapsed
- `activeFilters`: date range, file type, keep type, orientation

**sessionStorage (`session_ui_state`)**:
- `windowY`: window scroll position
- `mainY`: main content scroll position
- `viewer.isOpen`: whether viewer is open
- `viewer.startIndex`: viewer starting index
- `viewer.filename`: current photo filename
- `viewer.showInfo`: whether info panel is shown

## Proposed Changes

### 1. URL Structure (New)
```
# All Photos mode (no filters, no viewer)
/all

# All Photos mode with filters
/all?orientation=vertical&file_type=jpg

# All Photos mode with viewer open
/all/p15/DSC05134

# All Photos mode with viewer + filters + showInfo
/all/p15/DSC05134?orientation=vertical&showinfo=1

# Project mode (no filters, no viewer)
/p15

# Project mode with filters
/p15?orientation=vertical

# Project mode with viewer open
/p15/DSC05134

# Project mode with viewer + filters + showInfo
/p15/DSC05134?orientation=vertical&showinfo=1
```

### 2. localStorage (Simplified)
**Key**: `ui_prefs`
```json
{
  "viewMode": "grid" | "list",
  "sizeLevel": 0-4
}
```

**Removed**:
- `filtersCollapsed` - UI state, not worth persisting
- `activeFilters` - now derived from URL parameters

### 3. sessionStorage (Enhanced)
**Key**: `session_ui_state`
```json
{
  "windowY": number,
  "mainY": number,
  "pagination": {
    "all": {
      "headCursor": string,
      "tailCursor": string,
      "pages": [...]
    },
    "p15": {
      "headCursor": string,
      "tailCursor": string,
      "pages": [...]
    }
  }
}
```

**Removed**:
- `viewer.*` - all viewer state now in URL

## Implementation Plan

### Phase 1: URL Sync Enhancement
1. **Add `showinfo` parameter support**
   - Update `useUrlSync` to write `showinfo=1` when viewer info panel is open
   - Update URL parsing in `useAppInitialization` to read `showinfo` parameter
   - Update `PhotoViewer` to read from URL instead of sessionStorage

2. **Ensure viewer state is URL-only**
   - Remove `viewer` object from sessionStorage writes
   - Update viewer open/close to use URL navigation (pushState/replaceState)
   - Deep links already work, just need to ensure no sessionStorage fallback

### Phase 2: Storage Cleanup
1. **Update `storage.js`**
   - Remove `viewer` handling from `setSessionViewer`
   - Add pagination cursor helpers: `getSessionPagination`, `setSessionPagination`
   - Simplify `ui_prefs` schema (remove `filtersCollapsed`, `activeFilters`)

2. **Update `usePersistence.js`**
   - Remove `filtersCollapsed` and `activeFilters` from persistence logic
   - Keep only `viewMode` and `sizeLevel`

3. **Update `useAppInitialization.js`**
   - Parse all filter parameters from URL on mount
   - Parse `showinfo` parameter for viewer state
   - Remove localStorage fallback for filters

### Phase 3: Pagination Cursor Persistence
1. **Create pagination cursor helpers**
   - Add methods to save/restore PagedWindowManager state
   - Store cursors and page metadata in sessionStorage
   - Restore pagination state on page reload

2. **Update `useAllPhotosPagination.js`**
   - Save pagination state to sessionStorage on updates
   - Restore pagination state on mount
   - Use mode-specific keys (`all`, `p15`, etc.)

### Phase 4: Code Updates
1. **Remove all `filtersCollapsed` persistence**
   - Keep as React state only
   - Default to `false` (expanded) on mount

2. **Derive `activeFilters` from URL**
   - Parse URL parameters in `useAppInitialization`
   - Set `activeFilters` state from URL
   - No localStorage fallback

3. **Update viewer state management**
   - Remove all sessionStorage reads/writes for viewer
   - Use URL as single source of truth
   - Update `PhotoViewer` component accordingly

### Phase 5: Documentation
1. **Update PROJECT_OVERVIEW.md**
   - Document new URL-based state management approach
   - Explain storage simplification
   - Update state management section

2. **Update SCHEMA_DOCUMENTATION.md**
   - Document URL parameter schema
   - Update storage schema documentation
   - Add pagination cursor format

3. **Update README.md**
   - Highlight URL-based navigation
   - Mention shareable/bookmarkable URLs

## Benefits

1. **Shareable URLs**: Users can share exact application state via URL
2. **Bookmarkable**: Browser bookmarks capture full application state
3. **Simpler State Management**: Less redundancy between URL and storage
4. **Better Browser Integration**: Back/forward buttons work naturally
5. **Reduced Storage Footprint**: Less data stored in localStorage/sessionStorage
6. **Clearer Architecture**: Single source of truth for most state

## Migration Strategy

1. **Backward Compatibility**: Old localStorage keys will be ignored, no migration needed
2. **Graceful Degradation**: If URL parameters are missing, use sensible defaults
3. **Progressive Enhancement**: New features (showinfo) work immediately with URL support

## Testing Checklist

- [x] URL updates correctly when opening/closing viewer
- [x] `showdetail` parameter toggles info panel correctly (renamed from `showinfo`)
- [x] Filters persist in URL across navigation
- [ ] Pagination cursors restore correctly after page reload (helpers in place, not yet implemented)
- [x] localStorage only stores `viewMode` and `sizeLevel`
- [x] sessionStorage only stores scroll positions and pagination cursors
- [x] Back/forward buttons work correctly
- [x] Shared URLs open with correct state
- [x] Deep links work for both All Photos and Project modes

## Status: ✅ COMPLETED (2025-09-30)

All phases completed except pagination cursor persistence (Phase 3), which has helper infrastructure in place but is not yet fully implemented.

### Completed Work:
- ✅ Phase 1: URL Sync Enhancement - `showdetail` parameter implemented and working
- ✅ Phase 2: Storage Cleanup - localStorage simplified, viewer state removed from sessionStorage
- ⚠️ Phase 3: Pagination Cursor Persistence - Helpers exist but not yet wired up
- ✅ Phase 4: Code Updates - All filter and viewer state derived from URL
- ✅ Phase 5: Documentation - PROJECT_OVERVIEW.md, SCHEMA_DOCUMENTATION.md, and SECURITY.md updated

### Additional Features Implemented:
- ✅ Real-time Pending Changes SSE - Toolbar visibility driven by Server-Sent Events
- ✅ Multi-tab synchronization for commit/revert toolbar
- ✅ Instant feedback when marking photos for deletion

### Known Issues Fixed:
- ✅ View button regression resolved
- ✅ showdetail parameter persistence fixed
- ✅ Maximum update depth error resolved
- ✅ SSE SQL query corrected (project_folder join)

### Files Modified:
- `client/src/hooks/useUrlSync.js` - URL parameter management
- `client/src/hooks/useAppInitialization.js` - URL parsing and state initialization
- `client/src/components/PhotoViewer.jsx` - showdetail parameter support
- `client/src/hooks/usePendingChangesSSE.js` - NEW: SSE connection management
- `client/src/hooks/usePendingDeletes.js` - Updated to use SSE data
- `server/routes/sse.js` - NEW: Pending changes SSE endpoint
- `server/routes/keep.js` - Broadcasts SSE updates on keep flag changes
