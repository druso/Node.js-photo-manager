# Image Rendering Debug Guide

## Issue
Image not rendering on mobile, showing thumbnail (low-res) on desktop instead of preview

---

## What Should Happen

### URL Structure
When viewer opens, it should request:
```
/api/projects/p15/preview/DSC05104?v=2025-09-26T12%3A32%3A36.020Z
```

NOT:
```
/api/projects/p15/thumbnail/DSC05104?v=2025-09-26T12%3A32%3A36.020Z
```

### From Server Logs
Your logs show:
```
{"cmp":"assets","evt":"thumb_request","folder":"p15","filename":"DSC05104"...}
```

This means **thumbnails** are being requested, not **previews**!

---

## Root Cause Analysis

### Check 1: Is PhotoViewer using correct URL?

**File:** `client/src/components/PhotoViewer.jsx` line 511-513

```javascript
const imageSrc = usePreview
  ? `/api/projects/${encodeURIComponent(effectiveFolder)}/preview/${encodeURIComponent(currentPhoto.filename)}?v=${cacheV}`
  : `/api/projects/${encodeURIComponent(effectiveFolder)}/image/${encodeURIComponent(filenameWithExtForImage(currentPhoto))}?v=${cacheV}`;
```

This looks correct! It should be using `/preview/` endpoint.

### Check 2: Is usePreview set correctly?

**File:** `client/src/components/PhotoViewer.jsx` line 44

```javascript
const [usePreview, setUsePreview] = useState(true);
```

This is correct - defaults to `true`.

### Check 3: Is the image actually loading?

The image might be:
1. Loading but scaled to 0 (invisible)
2. Loading but positioned off-screen
3. Not loading at all (network error)
4. Loading thumbnail from cache instead of preview

---

## Debugging Steps

### Step 1: Check Network Tab
1. Open Chrome DevTools (F12)
2. Go to Network tab
3. Open photo viewer
4. Look for requests to `/preview/` or `/thumbnail/`
5. Check which one is actually being requested

### Step 2: Check Console for Errors
1. Open Console tab in DevTools
2. Look for any errors related to image loading
3. Check for CORS errors or 404s

### Step 3: Check Image Element
1. Right-click on viewer area
2. Inspect element
3. Find the `<img>` tag
4. Check its `src` attribute - should be `/preview/` not `/thumbnail/`
5. Check computed styles - look for `transform: scale(...)` value

### Step 4: Check Scale Value
Add temporary logging to PhotoViewer.jsx:

```javascript
// After line 500 (before return statement)
console.log('PhotoViewer Debug:', {
  imageSrc,
  usePreview,
  effectiveScale,
  naturalSize,
  zoomPercent,
  containerWidth: containerRef.current?.clientWidth,
  containerHeight: containerRef.current?.clientHeight
});
```

---

## Expected Behavior

### At Zoom 0% (Fit to Screen)
- `effectiveScale` should be between 0.1 and 1.0 (depending on image size)
- Image should be visible and fill viewport
- Transform should be: `translate3d(0px, 0px, 0) scale(0.5)` (example)

### On Mobile
- Container should have full width/height
- Image should scale to fit
- No part of image should be off-screen

### On Desktop
- Same as mobile but with more space
- Image should be crisp (preview quality, not thumbnail)

---

## Potential Issues

### Issue 1: Thumbnail Cache
**Problem:** Browser cached thumbnail URL, showing old thumbnail instead of preview

**Solution:**
1. Hard refresh: Ctrl+Shift+R (Chrome) or Cmd+Shift+R (Mac)
2. Clear cache: DevTools > Network > Disable cache checkbox
3. Check URL in Network tab to confirm `/preview/` is requested

### Issue 2: Scale Too Small
**Problem:** `effectiveScale` is very small (e.g., 0.01), making image invisible

**Solution:** Check `getFitScale()` calculation - might be returning wrong value

### Issue 3: Container Size Zero
**Problem:** Container has width/height of 0, causing scale calculation to fail

**Solution:** Check container ref and ensure it has proper dimensions

### Issue 4: Image Not Loading
**Problem:** Network error, CORS issue, or file not found

**Solution:** Check Network tab for 404 or 500 errors

---

## Latest Fix Applied

### Change Made (2025-10-02 10:33)

**File:** `client/src/components/PhotoViewer.jsx` line 584-592

```javascript
// Before:
className="max-w-full max-h-full"
style={{ transform: `...`, willChange: 'transform' }}

// After:
style={{ 
  maxWidth: '100%', 
  maxHeight: '100%',
  width: 'auto',
  height: 'auto',
  transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${effectiveScale})`, 
  willChange: 'transform',
  objectFit: 'contain'
}}
```

**Why:** 
- Moved constraints to inline style for better control
- Added `width: auto` and `height: auto` to let image size naturally
- Added `objectFit: contain` to ensure proper scaling
- All constraints in one place for easier debugging

---

## Testing Checklist

After fix:
- [ ] Hard refresh browser (Ctrl+Shift+R)
- [ ] Open DevTools Network tab
- [ ] Open photo viewer
- [ ] Verify URL shows `/preview/` not `/thumbnail/`
- [ ] Verify image loads and displays
- [ ] Check image is crisp (not blurry/pixelated)
- [ ] Test on mobile device
- [ ] Test zoom in/out
- [ ] Test pan when zoomed

---

## If Still Not Working

1. **Add console logging** to see actual values
2. **Check server logs** - are previews being generated?
3. **Check file system** - do preview files exist in `.projects/p15/.preview/`?
4. **Try different photo** - might be issue with specific file
5. **Check browser console** for JavaScript errors
