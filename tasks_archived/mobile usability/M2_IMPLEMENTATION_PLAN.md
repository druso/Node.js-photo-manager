# Milestone 2: Mobile Selection Mode - Implementation Plan

## Overview
Add long-press detection to enter a dedicated "selection mode" on mobile devices, where taps toggle selection instead of opening the viewer.

---

## Components Created

### ✅ useLongPress Hook
**File:** `client/src/hooks/useLongPress.js`

**Features:**
- Configurable threshold (default 400ms)
- Movement detection (cancels if finger moves >10px)
- Callbacks for start, finish, cancel, and long-press
- Works with both touch and pointer events
- Proper cleanup and timer management

**Usage:**
```jsx
const longPressHandlers = useLongPress(() => {
  enterSelectionMode();
}, { threshold: 350 });

return <div {...longPressHandlers}>Press and hold</div>;
```

### ✅ SelectionModeBanner Component
**File:** `client/src/components/SelectionModeBanner.jsx`

**Features:**
- Fixed position at top of screen
- Shows selected count
- Exit button (X icon)
- Clear selection button
- Mobile-optimized touch targets
- Blue theme matching selection UI

---

## State Management

### App.jsx Changes Needed

1. **Add Selection Mode State**
```jsx
const [selectionMode, setSelectionMode] = useState(false);
```

2. **Enter Selection Mode Function**
```jsx
const enterSelectionMode = useCallback((photo) => {
  setSelectionMode(true);
  // Also select the photo that was long-pressed
  if (photo && onToggleSelection) {
    onToggleSelection(photo);
  }
}, [onToggleSelection]);
```

3. **Exit Selection Mode Function**
```jsx
const exitSelectionMode = useCallback(() => {
  setSelectionMode(false);
  // Optionally clear selections
  // setSelectedPhotos(new Set());
}, []);
```

4. **Clear Selection Function**
```jsx
const clearSelection = useCallback(() => {
  if (simplifiedMode) {
    setAllSelectedPhotos(new Set());
  } else {
    setSelectedPhotos(new Set());
  }
}, [simplifiedMode]);
```

---

## PhotoGridView.jsx Integration

### Changes Needed

1. **Add Props**
```jsx
const PhotoGridView = ({ 
  // ... existing props
  selectionMode = false,
  onEnterSelectionMode,
  // ... rest
}) => {
```

2. **Update Photo Cell Click Handler**
```jsx
onClick={(e) => {
  if (selectionMode) {
    // In selection mode: toggle selection
    if (onToggleSelection) {
      onToggleSelection(photo);
    }
  } else {
    // Normal mode: open viewer
    if (onPhotoSelect) {
      onPhotoSelect(photo, photos);
    }
  }
}}
```

3. **Add Long-Press Handler**
```jsx
const longPressHandlers = useLongPress(() => {
  // Enter selection mode and select this photo
  if (onEnterSelectionMode) {
    onEnterSelectionMode(photo);
  }
}, { 
  threshold: 350,
  onFinish: (e) => {
    // Short press: open viewer (if not in selection mode)
    if (!selectionMode && onPhotoSelect) {
      onPhotoSelect(photo, photos);
    }
  }
});
```

4. **Apply Handlers to Photo Cell**
```jsx
<div
  key={...}
  className={...}
  onClick={(e) => { /* handle based on selectionMode */ }}
  {...longPressHandlers}
  ref={(el) => observeCell(el, key)}
>
```

---

## App.jsx Integration

### Render SelectionModeBanner

```jsx
{selectionMode && (
  <SelectionModeBanner
    selectedCount={simplifiedMode ? allSelectedPhotos.size : selectedPhotos.size}
    onExit={exitSelectionMode}
    onClearSelection={clearSelection}
  />
)}
```

### Pass Props to PhotoGridView

```jsx
<PhotoGridView
  // ... existing props
  selectionMode={selectionMode}
  onEnterSelectionMode={enterSelectionMode}
  // ... rest
/>
```

---

## Behavior Flow

### Normal Mode (Desktop & Mobile)
1. User taps photo → Opens viewer
2. User taps selection circle → Toggles selection
3. Desktop: Hover shows gradient + circle

### Selection Mode (Mobile Only)
1. User long-presses photo (350ms)
2. Selection mode activates
3. Banner appears at top
4. Photo that was long-pressed becomes selected
5. Subsequent taps toggle selection (don't open viewer)
6. User taps "X" or "Done" → Exits selection mode
7. Returns to normal mode (tap-to-open)

---

## Edge Cases to Handle

### 1. Selection Mode + Viewer
- **Issue**: What if viewer is open when entering selection mode?
- **Solution**: Close viewer when entering selection mode

### 2. Selection Mode + Navigation
- **Issue**: What if user switches projects while in selection mode?
- **Solution**: Exit selection mode on project change

### 3. Selection Mode + Filters
- **Issue**: What if user changes filters while in selection mode?
- **Solution**: Keep selection mode active, selections persist

### 4. Desktop Long-Press
- **Issue**: Should desktop support long-press?
- **Solution**: No - desktop has hover + click circle. Long-press is mobile-only.

### 5. Empty Selection Exit
- **Issue**: Should exiting selection mode clear selections?
- **Solution**: No - preserve selections. User can clear explicitly.

---

## Responsive Considerations

### Mobile (< 640px)
- Long-press enabled
- Selection banner visible
- No hover effects
- Selection circle hidden unless selected

### Desktop (≥ 640px)
- Long-press disabled (or ignored)
- No selection banner
- Hover effects active
- Selection circle visible on hover

### Implementation
```jsx
// Only enable long-press on mobile
const isMobile = window.innerWidth < 640;
const longPressHandlers = isMobile ? useLongPress(...) : {};
```

Or use CSS media query approach:
```jsx
// Always attach handlers, but only show banner on mobile
<SelectionModeBanner className="block sm:hidden" ... />
```

---

## Testing Checklist

### Mobile Selection Mode
- [ ] Long-press (350ms) enters selection mode
- [ ] Banner appears with correct count
- [ ] Long-pressed photo becomes selected
- [ ] Subsequent taps toggle selection
- [ ] Taps don't open viewer in selection mode
- [ ] Exit button returns to normal mode
- [ ] Clear button clears all selections
- [ ] Selection circle visible for selected items

### Desktop Behavior (Unchanged)
- [ ] Long-press doesn't trigger selection mode
- [ ] Hover shows gradient + circle
- [ ] Click photo opens viewer
- [ ] Click circle toggles selection
- [ ] No selection banner appears

### Edge Cases
- [ ] Viewer closes when entering selection mode
- [ ] Selection mode exits on project change
- [ ] Selections persist across filter changes
- [ ] Banner count updates when selections change
- [ ] Works in both All Photos and Project modes

---

## Performance Considerations

- Long-press timer cleanup on unmount
- Movement detection threshold (10px) prevents false triggers
- Banner only renders when in selection mode
- No impact on lazy loading or pagination

---

## Accessibility

- Banner has proper ARIA labels
- Exit button has aria-label="Exit selection mode"
- Selected count announced to screen readers
- Keyboard shortcuts still work
- Focus management when entering/exiting mode

---

## Files to Modify

1. ✅ `client/src/hooks/useLongPress.js` (created)
2. ✅ `client/src/components/SelectionModeBanner.jsx` (created)
3. ⏳ `client/src/App.jsx` (add state + handlers)
4. ⏳ `client/src/components/PhotoGridView.jsx` (integrate long-press)

---

## Next Steps

1. Modify App.jsx to add selection mode state
2. Update PhotoGridView.jsx to use long-press hook
3. Test on mobile device or Chrome DevTools device emulation
4. Verify all edge cases
5. Update documentation
