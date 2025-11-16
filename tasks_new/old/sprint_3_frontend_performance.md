# Sprint 3: Frontend Performance Optimization

**Assignee**: Junior Developer  
**Estimated Effort**: 2-4 hours  
**Priority**: MEDIUM  
**Expected Impact**: 20-40% smaller bundle, faster page loads  
**Difficulty**: ⭐⭐⭐ (Medium-Hard)

---

## 📋 Overview

The frontend bundle size directly impacts initial page load time. Larger bundles mean slower downloads and longer parse times. This sprint focuses on analyzing and optimizing the bundle to improve user experience.

**Goals**:
1. Analyze current bundle size
2. Identify optimization opportunities
3. Implement code splitting
4. Add React.memo to heavy components
5. Measure improvements

---

## 🎯 Learning Objectives

By completing this sprint, you will learn:
1. How to analyze JavaScript bundle size
2. Code splitting techniques
3. React performance optimization
4. Tree shaking and dead code elimination
5. Dynamic imports

---

## 📚 Background Reading (20 minutes)

### Why Bundle Size Matters

**User Impact**:
- 1MB bundle on 3G = ~10 seconds download
- Large bundles = longer parse time
- Slower initial render
- Poor mobile experience

**Business Impact**:
- Slow sites = higher bounce rates
- Every 100ms delay = 1% conversion loss
- Mobile users especially affected

### Bundle Optimization Techniques

1. **Code Splitting**: Load code only when needed
2. **Tree Shaking**: Remove unused code
3. **React.memo**: Prevent unnecessary re-renders
4. **Dynamic Imports**: Load routes on demand
5. **Dependency Audit**: Replace heavy libraries

---

## 🛠️ Implementation Steps

### Step 1: Install Analysis Tools (10 minutes)

```bash
cd client
npm install --save-dev vite-bundle-visualizer
```

**Update `client/package.json`**:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "analyze": "vite-bundle-visualizer"
  }
}
```

---

### Step 2: Analyze Current Bundle (15 minutes)

```bash
cd client
npm run build
npm run analyze
```

This opens a visual treemap showing:
- Total bundle size
- Size of each dependency
- Which files are largest

**Take a screenshot** and note:
- Total bundle size: _____ KB
- Largest dependencies: _____
- Largest components: _____

**Common culprits**:
- `react-dom` (large but necessary)
- `@headlessui/react` (check if fully used)
- Large icon libraries (can we use fewer icons?)
- Moment.js or date libraries (can we use native Date?)

---

### Step 3: Add React.memo to Heavy Components (45 minutes)

React.memo prevents re-renders when props haven't changed. This is especially important for components that:
- Render many items (grids, lists)
- Have expensive calculations
- Are deeply nested

#### Component 1: PhotoGridView.jsx

**File**: `client/src/components/PhotoGridView.jsx`

❌ **Before**:
```javascript
export default function PhotoGridView({ photos, onPhotoClick, selectedPhotos, onPhotoSelect }) {
  // Heavy rendering logic
  return (
    <div className="photo-grid">
      {photos.map(photo => (
        <PhotoCard key={photo.id} photo={photo} />
      ))}
    </div>
  );
}
```

✅ **After**:
```javascript
import React from 'react';

function PhotoGridView({ photos, onPhotoClick, selectedPhotos, onPhotoSelect }) {
  // Heavy rendering logic
  return (
    <div className="photo-grid">
      {photos.map(photo => (
        <PhotoCard key={photo.id} photo={photo} />
      ))}
    </div>
  );
}

// Memo with custom comparison
export default React.memo(PhotoGridView, (prevProps, nextProps) => {
  // Only re-render if photos array reference changed
  // or selection changed
  return (
    prevProps.photos === nextProps.photos &&
    prevProps.selectedPhotos === nextProps.selectedPhotos
  );
});
```

#### Component 2: VirtualizedPhotoGrid.jsx

**File**: `client/src/components/VirtualizedPhotoGrid.jsx`

Same pattern:
```javascript
function VirtualizedPhotoGrid({ photos, viewMode, onPhotoClick, selectedPhotos }) {
  // Complex virtualization logic
  return (/* ... */);
}

export default React.memo(VirtualizedPhotoGrid, (prevProps, nextProps) => {
  return (
    prevProps.photos === nextProps.photos &&
    prevProps.viewMode === nextProps.viewMode &&
    prevProps.selectedPhotos === nextProps.selectedPhotos
  );
});
```

#### Component 3: Thumbnail.jsx

**File**: `client/src/components/Thumbnail.jsx`

```javascript
function Thumbnail({ photo, size, onClick }) {
  // Image loading logic
  return (/* ... */);
}

export default React.memo(Thumbnail, (prevProps, nextProps) => {
  // Only re-render if photo ID changed
  return prevProps.photo.id === nextProps.photo.id;
});
```

#### Component 4: PhotoViewer.jsx

**File**: `client/src/components/PhotoViewer.jsx`

```javascript
function PhotoViewer({ photo, onClose, onNext, onPrev }) {
  // Full-screen viewer logic
  return (/* ... */);
}

export default React.memo(PhotoViewer, (prevProps, nextProps) => {
  return prevProps.photo?.id === nextProps.photo?.id;
});
```

---

### Step 4: Implement Code Splitting (60 minutes)

Code splitting loads routes/components only when needed, reducing initial bundle size.

#### Split 1: Settings Modal

**File**: `client/src/App.jsx`

❌ **Before**:
```javascript
import SettingsProcessesModal from './components/SettingsProcessesModal';

function App() {
  return (
    <>
      {showSettings && <SettingsProcessesModal onClose={...} />}
    </>
  );
}
```

✅ **After**:
```javascript
import React, { lazy, Suspense } from 'react';

// Lazy load the settings modal
const SettingsProcessesModal = lazy(() => import('./components/SettingsProcessesModal'));

function App() {
  return (
    <>
      {showSettings && (
        <Suspense fallback={<div>Loading...</div>}>
          <SettingsProcessesModal onClose={...} />
        </Suspense>
      )}
    </>
  );
}
```

**Why this helps**: Settings modal is only used occasionally, so don't load it initially.

#### Split 2: Photo Viewer

**File**: `client/src/App.jsx`

```javascript
const PhotoViewer = lazy(() => import('./components/PhotoViewer'));

function App() {
  return (
    <>
      {viewerState.open && (
        <Suspense fallback={<div className="viewer-loading">Loading viewer...</div>}>
          <PhotoViewer photo={...} onClose={...} />
        </Suspense>
      )}
    </>
  );
}
```

#### Split 3: Shared Links Page

**File**: `client/src/pages/SharedLinksPage.jsx`

This is a separate route, perfect for code splitting:

```javascript
// In your router setup
import { lazy, Suspense } from 'react';

const SharedLinksPage = lazy(() => import('./pages/SharedLinksPage'));

function Router() {
  return (
    <Routes>
      <Route path="/" element={<App />} />
      <Route 
        path="/sharedlinks" 
        element={
          <Suspense fallback={<div>Loading...</div>}>
            <SharedLinksPage />
          </Suspense>
        } 
      />
    </Routes>
  );
}
```

---

### Step 5: Optimize Dependencies (30 minutes)

#### Check for Unused Imports

Run this command to find unused dependencies:
```bash
cd client
npx depcheck
```

**Common unused dependencies**:
- Old testing libraries
- Unused UI components
- Duplicate packages

**Remove unused packages**:
```bash
npm uninstall <package-name>
```

#### Replace Heavy Dependencies

**Example**: If using `moment.js` (large), replace with native `Date` or `date-fns` (smaller):

❌ **Before** (moment.js = 67KB):
```javascript
import moment from 'moment';
const formatted = moment(date).format('YYYY-MM-DD');
```

✅ **After** (native Date = 0KB):
```javascript
const formatted = new Date(date).toISOString().split('T')[0];
```

---

### Step 6: Enable Production Optimizations (15 minutes)

**File**: `client/vite.config.js`

Ensure these optimizations are enabled:

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Minify code
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.log in production
        drop_debugger: true
      }
    },
    // Split chunks for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunk for React and large libraries
          vendor: ['react', 'react-dom'],
          // UI components chunk
          ui: ['@headlessui/react']
        }
      }
    },
    // Increase chunk size warning limit if needed
    chunkSizeWarningLimit: 1000
  }
});
```

---

## ✅ Testing Checklist

### Build Analysis
- [ ] Run `npm run build` successfully
- [ ] Run `npm run analyze` and review bundle
- [ ] Compare before/after bundle sizes
- [ ] Verify no errors in build output

### Functionality Testing
- [ ] App loads correctly
- [ ] Settings modal opens (lazy loaded)
- [ ] Photo viewer opens (lazy loaded)
- [ ] All routes work
- [ ] No console errors

### Performance Testing
1. [ ] Open DevTools Network tab
2. [ ] Hard refresh (Cmd+Shift+R / Ctrl+Shift+R)
3. [ ] Measure:
   - Initial bundle size
   - Time to interactive
   - Lazy chunks load correctly

### Before/After Comparison

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Total bundle size | _____ KB | _____ KB | _____ % |
| Initial load time | _____ ms | _____ ms | _____ % |
| Time to interactive | _____ ms | _____ ms | _____ % |

---

## 📊 Success Criteria

- [ ] Bundle size reduced by 20-40%
- [ ] React.memo added to 4+ heavy components
- [ ] Code splitting implemented for 3+ components
- [ ] No functionality regressions
- [ ] Build completes without warnings
- [ ] All tests pass

---

## 🐛 Common Pitfalls

### Pitfall 1: Breaking React.memo with Inline Functions

**Problem**: Inline functions create new references on every render

```javascript
// ❌ BAD - onClick creates new function every time
<PhotoCard 
  photo={photo} 
  onClick={() => handleClick(photo.id)} 
/>

// ✅ GOOD - Use useCallback
const handleClick = useCallback((id) => {
  // handle click
}, []);

<PhotoCard 
  photo={photo} 
  onClick={handleClick} 
/>
```

### Pitfall 2: Lazy Loading Critical Components

**Problem**: Don't lazy load components needed immediately

```javascript
// ❌ BAD - Header is always visible
const Header = lazy(() => import('./Header'));

// ✅ GOOD - Only lazy load occasional components
const SettingsModal = lazy(() => import('./SettingsModal'));
```

### Pitfall 3: Missing Suspense Boundary

**Problem**: Lazy components need Suspense wrapper

```javascript
// ❌ BAD - Will crash
const Settings = lazy(() => import('./Settings'));
<Settings />

// ✅ GOOD - Wrapped in Suspense
<Suspense fallback={<div>Loading...</div>}>
  <Settings />
</Suspense>
```

---

## 🎓 Learning Resources

- [Vite Bundle Analyzer](https://github.com/btd/rollup-plugin-visualizer)
- [React.memo Documentation](https://react.dev/reference/react/memo)
- [Code Splitting in React](https://react.dev/reference/react/lazy)
- [Web Performance Optimization](https://web.dev/performance/)

---

## 📝 Submission Checklist

Before marking this sprint as complete:

- [ ] Analyzed bundle with vite-bundle-visualizer
- [ ] Added React.memo to 4+ components
- [ ] Implemented code splitting for 3+ components
- [ ] Optimized vite.config.js
- [ ] Documented before/after metrics
- [ ] All tests pass
- [ ] Committed with message: "perf: optimize frontend bundle size by 20-40%"
- [ ] Created PR with bundle analysis screenshots

---

## 🆘 Need Help?

If you get stuck:
1. Check bundle visualizer to identify largest files
2. Test one optimization at a time
3. Use React DevTools Profiler to measure re-renders
4. Ask senior developer to review React.memo implementations

**Estimated Time**: 2-4 hours  
**Actual Time**: _____ hours (fill this in when done)

---

## 📈 Impact Metrics

After completing this sprint:
- **20-40% smaller** initial bundle
- **Faster page loads** especially on mobile
- **Better user experience** with reduced wait times
- **Improved SEO** from faster load times

**Excellent work!** 🎉
