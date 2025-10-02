# Milestone 2: Integration Steps

## Summary
Integrate selection mode state and long-press detection into the existing app architecture.

---

## Step 1: Add Selection Mode State to App.jsx ✅

Add state variable near other UI state (around line 86):

```jsx
const [selectionMode, setSelectionMode] = useState(false);
```

---

## Step 2: Add Selection Mode Handlers to App.jsx ✅

Add these handlers after other event handlers:

```jsx
// Enter selection mode (triggered by long-press)
const enterSelectionMode = useCallback((photo) => {
  setSelectionMode(true);
  // Select the photo that was long-pressed
  if (photo) {
    if (isAllMode) {
      handleToggleSelectionAll(photo);
    } else {
      handleToggleSelection(photo);
    }
  }
}, [isAllMode, handleToggleSelectionAll, handleToggleSelection]);

// Exit selection mode
const exitSelectionMode = useCallback(() => {
  setSelectionMode(false);
}, []);

// Clear all selections
const clearAllSelections = useCallback(() => {
  if (isAllMode) {
    setAllSelectedKeys(new Set());
  } else {
    setSelectedPhotos(new Set());
  }
}, [isAllMode, setAllSelectedKeys, setSelectedPhotos]);
```

---

## Step 3: Update MainContentRenderer Props ✅

Add selection mode props to MainContentRenderer:

```jsx
<MainContentRenderer
  // ... existing props
  selectionMode={selectionMode}
  onEnterSelectionMode={enterSelectionMode}
  // ... rest
/>
```

---

## Step 4: Update MainContentRenderer Component ✅

File: `client/src/components/MainContentRenderer.jsx`

Add props to function signature and pass through:

```jsx
const MainContentRenderer = ({
  // ... existing props
  selectionMode,
  onEnterSelectionMode,
  // ... rest
}) => {
  if (isAllMode) {
    return (
      <AllPhotosPane
        // ... existing props
        selectionMode={selectionMode}
        onEnterSelectionMode={onEnterSelectionMode}
      />
    );
  }

  if (selectedProject) {
    return (
      <PhotoDisplay
        // ... existing props
        selectionMode={selectionMode}
        onEnterSelectionMode={onEnterSelectionMode}
      />
    );
  }
  // ... rest
};
```

---

## Step 5: Update PhotoDisplay Component ✅

File: `client/src/components/PhotoDisplay.jsx`

Pass props through to PhotoGridView:

```jsx
<PhotoGridView 
  // ... existing props
  selectionMode={selectionMode}
  onEnterSelectionMode={onEnterSelectionMode}
  // ... rest
/>
```

---

## Step 6: Update AllPhotosPane Component ✅

File: `client/src/components/AllPhotosPane.jsx`

Similar to PhotoDisplay, pass props through.

---

## Step 7: Update PhotoGridView Component ✅

File: `client/src/components/PhotoGridView.jsx`

Already completed in M1! Just need to:
1. Import useLongPress hook
2. Add selectionMode and onEnterSelectionMode props
3. Update click handler to check selectionMode
4. Add long-press handlers

---

## Step 8: Render SelectionModeBanner in App.jsx ✅

Add near the top of the render, after UploadProvider:

```jsx
{selectionMode && (
  <SelectionModeBanner
    selectedCount={isAllMode ? allSelectedKeys.size : selectedPhotos.size}
    onExit={exitSelectionMode}
    onClearSelection={clearAllSelections}
  />
)}
```

---

## Step 9: Handle Edge Cases ✅

### Close viewer when entering selection mode
```jsx
const enterSelectionMode = useCallback((photo) => {
  setSelectionMode(true);
  // Close viewer if open
  if (viewerState.isOpen) {
    setViewerState({ isOpen: false, startIndex: -1 });
  }
  // ... rest
}, [/* deps */]);
```

### Exit selection mode on project change
```jsx
useEffect(() => {
  if (selectionMode && !isAllMode) {
    exitSelectionMode();
  }
}, [selectedProject?.folder, selectionMode, isAllMode, exitSelectionMode]);
```

---

## Testing Plan

### Manual Testing
1. **Mobile Chrome DevTools**
   - Open DevTools
   - Toggle device toolbar (Cmd+Shift+M)
   - Select mobile device (iPhone 12 Pro)
   - Test long-press on photo grid

2. **Physical Device**
   - Deploy to test server
   - Test on actual iOS/Android device

### Test Cases
- [ ] Long-press enters selection mode
- [ ] Banner shows correct count
- [ ] Taps toggle selection in mode
- [ ] Exit button works
- [ ] Clear button works
- [ ] Viewer closes on mode entry
- [ ] Mode exits on project change
- [ ] Desktop unaffected

---

## Files to Modify

1. ✅ `client/src/hooks/useLongPress.js` (created)
2. ✅ `client/src/components/SelectionModeBanner.jsx` (created)
3. ⏳ `client/src/App.jsx` (add state + handlers + render banner)
4. ⏳ `client/src/components/MainContentRenderer.jsx` (pass props)
5. ⏳ `client/src/components/PhotoDisplay.jsx` (pass props)
6. ⏳ `client/src/components/AllPhotosPane.jsx` (pass props)
7. ⏳ `client/src/components/PhotoGridView.jsx` (integrate long-press)

---

## Implementation Order

1. App.jsx state and handlers
2. MainContentRenderer prop passing
3. PhotoDisplay prop passing
4. AllPhotosPane prop passing
5. PhotoGridView integration
6. Test and iterate
