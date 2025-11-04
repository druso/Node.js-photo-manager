# Shared Link Deep Linking Implementation

**Date:** 2025-01-04  
**Status:** ✅ Completed

## Problem Statement

Shared link viewer URLs were incorrectly navigating to project-specific URLs instead of maintaining the shared link context:

### Issues:
- **For admins:** URL became `/all/p15/DSC05110` instead of `/shared/{token}/DSC05110`
- **For public users:** URL stayed at `/shared/{token}/DSC05110` but didn't support deep linking
- **On close:** Users landed on wrong URLs instead of returning to `/shared/{token}`

### Expected Behavior:
- Any user should navigate to `/shared/{token}/{photo}` when opening a photo
- When exiting viewer, should return to `/shared/{token}`
- Deep links like `/shared/{token}/DSC05110` should work as entry points

## Implementation

### 1. Router Updates (`client/src/main.jsx`)
- Updated regex to match both `/shared/{token}` and `/shared/{token}/{photo}` patterns
- Extract optional `photoName` parameter for deep linking
- Pass `photoName` to both `App` and `SharedLinkPage` components

### 2. SharedLinkPage Component (`client/src/pages/SharedLinkPage.jsx`)
- Added `initialPhotoName` prop for deep linking
- Created `pendingOpenRef` to track deep link target
- Implemented deep linking effect with pagination support
- Added `handleCurrentIndexChange` to sync URL when navigating photos
- Updated `handleCloseViewer` to return to `/shared/{token}`
- Updated `handlePhotoSelect` to push `/shared/{token}/{photo}` URL

### 3. App Component (`client/src/App.jsx`)
- Added `initialPhotoName` prop
- Created `sharedDeepLinkRef` for shared link deep linking
- Implemented deep linking effect for authenticated users viewing shared links
- Passed `sharedLinkHash` to `useViewerSync` and `useAllPhotosViewer`

### 4. useViewerSync Hook (`client/src/hooks/useViewerSync.js`)
- Added `sharedLinkHash` parameter
- Updated `handleCloseViewer` to return to `/shared/{token}` in shared mode
- Updated `handleViewerIndexChange` to use `/shared/{token}/{photo}` format

### 5. useAllPhotosViewer Hook (`client/src/hooks/useAllPhotosViewer.js`)
- Added `sharedLinkHash` parameter
- Updated `handleAllPhotoSelect` to push `/shared/{token}/{photo}` URL in shared mode

## Technical Details

### URL Format
- **Grid view:** `/shared/{token}`
- **Photo viewer:** `/shared/{token}/{photoBasename}` (without extension)
- **Deep link entry:** `/shared/{token}/{photoBasename}`

### Deep Linking Logic
1. Router extracts `photoName` from URL
2. Component receives `initialPhotoName` prop
3. Effect searches for photo in loaded pages
4. If not found, continues loading more pages
5. Once found, opens viewer at correct index
6. If photo doesn't exist, clears pending state

### URL Synchronization
- **Opening photo:** `pushState` to `/shared/{token}/{photo}`
- **Navigating photos:** `replaceState` to update photo in URL
- **Closing viewer:** `pushState` to `/shared/{token}`

## Testing Checklist

- [ ] Public user opens shared link: `/shared/{token}`
- [ ] Public user clicks photo: URL becomes `/shared/{token}/{photo}`
- [ ] Public user navigates photos: URL updates with each photo
- [ ] Public user closes viewer: Returns to `/shared/{token}`
- [ ] Public user accesses deep link: `/shared/{token}/{photo}` opens viewer
- [ ] Admin opens shared link: `/shared/{token}` (not `/all`)
- [ ] Admin clicks photo: URL becomes `/shared/{token}/{photo}` (not `/all/p15/photo`)
- [ ] Admin navigates photos: URL stays in `/shared/{token}/{photo}` format
- [ ] Admin closes viewer: Returns to `/shared/{token}`
- [ ] Admin accesses deep link: `/shared/{token}/{photo}` opens viewer

## Files Modified

1. `client/src/main.jsx` - Router pattern matching
2. `client/src/pages/SharedLinkPage.jsx` - Deep linking and URL sync
3. `client/src/App.jsx` - Shared link deep linking for authenticated users
4. `client/src/hooks/useViewerSync.js` - Shared link URL handling
5. `client/src/hooks/useAllPhotosViewer.js` - Shared link photo selection

## Build Status

✅ Client build successful (no errors or warnings)

## Next Steps

1. Manual testing with both authenticated and public users
2. Update documentation (PROJECT_OVERVIEW.md, SCHEMA_DOCUMENTATION.md)
3. Add to SECURITY.md if relevant
