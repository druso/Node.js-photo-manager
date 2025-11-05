# Eager Loading Buffer Implementation

**Date Started**: 2025-01-05  
**Date Completed**: 2025-01-05  
**Status**: ✅ Implemented - Ready for Testing

## Problem Statement

Users experience visible "pop-in" of images during slow scrolling because:
1. **Virtualization**: Images only start rendering when they enter the visible viewport
2. **Pagination**: Next page only loads when user gets very close to the end of current data

This creates a jarring experience where images appear suddenly at the edges of the screen.

## Solution: Extended Off-Screen Buffer

Implement aggressive buffering for both virtualization and pagination:

### 1. Virtualization Buffer
- **Current**: `rootMargin: '50px 0px'` (50px above/below viewport)
- **New**: `rootMargin: '100vh 0px'` (100% viewport height above/below)
- **Effect**: Images start rendering when they're 1 full screen away from visibility

### 2. Pagination Buffer  
- **Current**: `rootMargin: '200px 0px'` (200px before end)
- **New**: `rootMargin: '100vh 0px'` (1 full viewport height before end)
- **Effect**: Next page loads when user is still 1 full screen away from the end

### 3. Load Previous Buffer
- **Current**: Triggers at `y <= 400` (400px from top)
- **New**: Triggers at `y <= window.innerHeight` (1 full viewport height from top)
- **Effect**: Previous page loads when user is 1 full screen from the top

## Implementation Details

### Files to Modify
1. `/client/src/components/VirtualizedPhotoGrid.jsx`
   - Line 503: IntersectionObserver for thumbnail visibility (virtualization)
   - Line 475: IntersectionObserver for bottom sentinel (pagination forward)
   - Line 425: Scroll threshold for load previous (pagination backward)

### Changes

#### Change 1: Thumbnail Visibility (Virtualization)
```javascript
// Before:
{ root: null, rootMargin: '50px 0px', threshold: 0.01 }

// After:
{ root: null, rootMargin: '100vh 0px', threshold: 0.01 }
```

#### Change 2: Load More Trigger (Forward Pagination)
```javascript
// Before:
{ root: null, rootMargin: '200px 0px', threshold: 0.01 }

// After:
{ root: null, rootMargin: '100vh 0px', threshold: 0.01 }
```

#### Change 3: Load Previous Trigger (Backward Pagination)
```javascript
// Before:
if (y <= 400) {

// After:
const viewportHeight = window.innerHeight || 0;
if (y <= viewportHeight) {
```

## Benefits

1. **Seamless Scrolling**: Images fully loaded before user sees them
2. **No Visual Hitches**: Pagination happens completely off-screen
3. **Better UX**: Smooth, uninterrupted browsing experience
4. **Adaptive**: Buffer scales with viewport size (mobile vs desktop)

## Trade-offs

1. **More Network Requests**: Images load earlier (but this is the goal)
2. **Higher Memory Usage**: More images rendered simultaneously
3. **More CPU Usage**: More thumbnails being decoded at once

These trade-offs are acceptable for the improved user experience.

## Testing Plan

1. **Slow Scroll Test**: Scroll slowly and verify no images "pop in" at edges
2. **Fast Scroll Test**: Scroll quickly and verify smooth experience
3. **Mobile Test**: Test on mobile devices with smaller viewports
4. **Desktop Test**: Test on large monitors with tall viewports
5. **Network Throttling**: Test with slow 3G to verify buffer is sufficient

## Success Criteria

- ⏳ No visible image "pop-in" during slow scrolling (needs user testing)
- ⏳ Pagination happens completely off-screen (needs user testing)
- ⏳ Smooth experience on both mobile and desktop (needs user testing)
- ⏳ No performance degradation or memory issues (needs user testing)

## Implementation Status

### ✅ Completed Changes

1. **VirtualizedPhotoGrid.jsx Line 505**: Updated thumbnail visibility IntersectionObserver
   - Changed `rootMargin` from `'50px 0px'` to `'100vh 0px'`
   - Images now start loading when 1 full viewport away

2. **VirtualizedPhotoGrid.jsx Line 477**: Updated load-more IntersectionObserver
   - Changed `rootMargin` from `'200px 0px'` to `'100vh 0px'`
   - Next page loads when 1 full viewport away from end

3. **VirtualizedPhotoGrid.jsx Line 425-427**: Updated load-previous scroll threshold
   - Changed from fixed `400px` to dynamic `window.innerHeight`
   - Previous page loads when 1 full viewport away from top
   - Added comment explaining eager loading behavior

### ✅ Build Verification
- Client build passes successfully
- No TypeScript/ESLint errors
- Bundle size: 503.21 kB (minimal increase)

### 🐛 Bug Fix (2025-01-05)
**Issue**: `IntersectionObserver` threw syntax error: "rootMargin must be specified in pixels or percent"
**Cause**: Used `100vh` units which are not supported by IntersectionObserver API
**Fix**: Calculate viewport height dynamically in pixels: `const viewportHeightPx = window.innerHeight || 0`
**Result**: All three IntersectionObserver instances now use calculated pixel values

### ⚙️ Configuration Support (2025-01-05)
**Feature**: Made buffer size configurable via `config.json`
**Config Key**: `photo_grid.eager_load_buffer_vh` (default: 100)
**Implementation**:
- Added `eagerLoadBufferVh` prop to `VirtualizedPhotoGrid.jsx`
- Prop flows through `PhotoDisplay.jsx` → `MainContentRenderer.jsx`
- Buffer calculated as: `bufferPx = (window.innerHeight * eagerLoadBufferVh) / 100`
- Updated both `config.json` and `config.default.json`

**Usage Examples**:
- `50` = half viewport height buffer (less aggressive, lower memory)
- `100` = full viewport height buffer (default, balanced)
- `150` = 1.5x viewport height buffer (very aggressive, highest quality)
- `200` = 2x viewport height buffer (maximum preloading)

## Documentation Updates

### ✅ Updated Files
1. **PROJECT_OVERVIEW.md** - Added eager loading buffer note to "Virtualized Grid & Pagination Model" section
2. **README.md** - Updated "Robust Lazy-loading Grid" feature description with buffer details

## Notes

- The 100vh buffer is a starting point and can be adjusted based on testing
- Could make this configurable via props if different use cases need different buffers
- Monitor performance metrics after deployment
- Dev servers running at http://localhost:3000 for testing
