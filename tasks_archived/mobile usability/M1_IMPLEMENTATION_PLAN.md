# Milestone 1: Interaction Foundation - Implementation Plan

## Current State Analysis

### PhotoGridView.jsx Current Behavior (lines 286-343)
```jsx
onClick={() => {
  // Phase 1 behavior:
  // - simplifiedMode (All Photos): clicking toggles selection
  // - project mode: clicking toggles selection; viewer opens only via overlay button
  onToggleSelection && onToggleSelection(photo);
}}
```

**Issues:**
1. Entire photo area toggles selection
2. Separate "View" button required to open viewer
3. Not mobile-friendly (first tap selects, not opens)

### Current Overlay Structure
- Selection circle: top-left, opacity-0 until hover
- "View" button: center overlay, opacity-0 until hover
- Both rely on `:group-hover` which doesn't work on touch devices

---

## Target Behavior

### Desktop
1. **Hover state**: Gradient darken in top ~25% of thumbnail
2. **Selection circle**: Always visible when selected, visible on hover when not selected, positioned in gradient area
3. **Click behavior**:
   - Clicking selection circle → toggles selection
   - Clicking anywhere else on photo → opens viewer
4. **Visual feedback**: Selected photos show checkmark even without hover

### Mobile
1. **No hover state**: Clean thumbnails without overlays
2. **Single tap**: Opens viewer immediately (Milestone 1 only; long-press comes in M2)
3. **Selection circle**: Only visible when photo is selected
4. **Temporary behavior**: For M1, tapping circle still toggles selection (long-press mode comes in M2)

---

## Implementation Steps

### Step 1: Update CSS Classes and Overlay Structure

**Current overlay (lines 332-342):**
```jsx
<div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity p-2 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
  <button onClick={(e) => { e.stopPropagation(); onPhotoSelect && onPhotoSelect(photo, photos); }}>
    View
  </button>
</div>
```

**New structure:**
- Remove full-overlay "View" button
- Add gradient overlay in top 25% only
- Reposition selection circle to top-left within gradient
- Make selection circle larger (40px minimum touch target)

### Step 2: Refactor Click Handlers

**Current (line 286-291):**
```jsx
onClick={() => {
  onToggleSelection && onToggleSelection(photo);
}}
```

**New:**
```jsx
onClick={(e) => {
  // Default: open viewer
  if (onPhotoSelect) {
    onPhotoSelect(photo, photos);
  }
}}
```

**Selection circle handler:**
```jsx
onClick={(e) => {
  e.stopPropagation(); // Prevent viewer from opening
  if (onToggleSelection) {
    onToggleSelection(photo);
  }
}}
```

### Step 3: Update Selection Circle Styling

**Current (lines 295-316):**
- Position: `absolute top-1 left-1`
- Size: `h-6 w-6` (24px - too small for touch)
- Visibility: `opacity-0 group-hover:opacity-100` (not visible when selected without hover)

**New:**
- Position: `absolute top-2 left-2` (within gradient area)
- Size: `h-10 w-10` (40px - proper touch target)
- Visibility: Always visible when selected, visible on hover when not selected
- Add subtle shadow for visibility

### Step 4: Add Gradient Overlay

**New element (desktop only):**
```jsx
{/* Gradient overlay for desktop hover - top 25% */}
<div className="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden sm:block" />
```

### Step 5: Update Selection Visual Feedback

**Current (line 329-331):**
```jsx
{isSelected && (
  <div className="absolute inset-0 bg-blue-500/25 pointer-events-none"></div>
)}
```

**Keep this** - provides good visual feedback for selected state

---

## Code Changes

### PhotoGridView.jsx Changes

1. **Line 284-343**: Complete refactor of photo cell structure
2. **Add gradient overlay** (desktop only, hidden on mobile)
3. **Reposition and resize selection circle**
4. **Update click handlers**: photo → viewer, circle → selection
5. **Update selection circle visibility logic**

### Responsive Considerations

- Use `hidden sm:block` for desktop-only gradient overlay
- Use `sm:h-10 sm:w-10` for larger selection circle on desktop
- Mobile gets minimal UI: just the photo and selection indicator when selected

---

## Testing Criteria

### Desktop
- ✅ Hover shows gradient in top 25% of thumbnail
- ✅ Selection circle visible and clickable (≥40px)
- ✅ Clicking photo opens viewer
- ✅ Clicking circle toggles selection
- ✅ Selected photos show checkmark without hover

### Mobile
- ✅ Tap on photo opens viewer
- ✅ No hover artifacts
- ✅ Selection circle visible only when selected
- ✅ Tapping circle toggles selection

---

## Next Steps After M1

1. **Milestone 2**: Add long-press detection for mobile selection mode
2. **Milestone 3**: Add swipe navigation in viewer
3. **Milestone 4**: Integration testing and documentation
