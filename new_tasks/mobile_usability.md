---
description: mobile interaction + selection refresh
---

# Mobile & Touch Usability Workplan

## Objectives
- **Unify interactions** across desktop and mobile so the grid and viewer behave predictably regardless of input type (mouse, touch, pen).
- **Support touch-first gestures**: single tap to open, swipe to navigate, long-press to enter selection mode, with smooth transitions back to browse mode.
- **Preserve power-user flows** on desktop by refining hover affordances and ensuring keyboard shortcuts continue to work.
- **Document responsibilities** for future work, including code surfaces (`client/src/components/PhotoGridView.jsx`, `client/src/components/PhotoViewer.jsx`, `client/src/App.jsx`, related hooks) and QA expectations.

## Current State Summary
- **Desktop grid** (`PhotoGridView.jsx`): hover darkens entire image, shows “View” button overlay and small selection circle. Clicking the button opens the viewer; clicking anywhere else toggles selection.
- **Mobile grid**: touch triggers the same `onClick` toggle logic, so first tap selects instead of opening. No long-press detection. Hover-dependent affordances (darken overlay, selection circle) are unreliable on touch devices.
- **Viewer** (`PhotoViewer.jsx`): supports pinch zoom and pan, but no swipe navigation gestures. `touchAction: none` blocks natural scrolling and tap-to-close vertical gestures.

## Target Interaction Model

### Desktop Grid
- **Hover state**: apply a gradient darken limited to the top ~25% of the thumbnail. Reveal a persistent selection circle within that gradient.
- **Click behavior**: clicking the circle toggles selection; clicking anywhere else on the photo opens the viewer immediately.
- **Selection visibility**: keep the checkmark visible (filled circle) even when not hovering; provide a subtle outline so selection status is obvious.

### Mobile Grid
- **Default mode**: single tap opens the viewer. No hover overlays are assumed.
- **Long press**: press-and-hold (~350–400 ms) activates “selection mode”. In this mode:
  - The pressed photo becomes selected.
  - All subsequent taps on photos toggle selection instead of opening.
  - A header/banner appears showing the number of selected items and a clear exit control.
- **Exiting selection mode**: explicit “Done”/“Cancel” button or clearing all selections returns to browse mode (tap-to-open resumes).

### Viewer (Desktop & Mobile)
- **Swipe navigation**: add horizontal swipe gestures to `PhotoViewer.jsx` to trigger `nextPhoto()`/`prevPhoto()` with velocity/threshold handling. Maintain pinch/zoom and pan interactions.
- **Tap behavior**: single tap toggles UI chrome (toolbars/details). Provide larger tap targets for close/move actions.
- **TouchAction handling**: relax to `touch-action: pan-y` when zoom is at fit to permit swipe-to-close or scroll gestures. Consider optional vertical swipe/down gesture to dismiss.

## Implementation Plan

### Milestone 1 — Interaction Foundation
- **Desktop hover refresh**: update grid cell CSS to render gradient overlays; move selection circle into the gradient region and expand hitbox to ≥40 px.
- **Tap routing**: refactor `onToggleSelection`/`onPhotoSelect` wiring so default click opens viewer. Ensure composite keys in All Photos mode continue to map correctly.
- **State modeling**: introduce a `selectionMode` flag in the relevant hooks/state (likely `useAllPhotosPagination` or a new hook) with shared logic for desktop and mobile.

### Milestone 2 — Mobile Selection Mode
- **Long-press detection**: add reusable hook (e.g., `useLongPress`) to grid cells; switch behavior to selection mode when triggered.
- **Selection mode UI**: surface top/bottom banners with actions (commit, move, clear) sized for touch. Integrate with existing bulk actions so pathways stay consistent.
- **Accessibility**: ensure ARIA states and keyboard shortcuts (desktop) remain functional; selection circle must stay reachable via keyboard focus.

### Milestone 3 — Viewer Gesture Enhancements
- **Swipe navigation**: implement horizontal gesture detection with cancelation when pinch/zoom active; provide subtle animation during transitions.
- **Tap-to-open vs tap-to-dismiss**: differentiate between single taps (toggle chrome) and background tap to close; ensure keyboard shortcuts continue to work on desktop.
- **Safe-area & layout**: adjust viewer toolbar placement and padding to respect mobile safe areas (iOS notch, Android gesture bar).

### Milestone 4 — Integration & QA
- **Cross-mode testing**: validate flows on desktop, iOS Safari, Android Chrome (physical or simulator). Use Chrome DevTools device emulation for initial checks.
- **Regression coverage**: verify bulk selection, move modal, tagging, keep actions, and SSE updates while in selection mode.
- **Documentation updates**: once implemented, reflect interaction changes in `PROJECT_OVERVIEW.md`, `README.md`, and relevant UI docs.

## Risks & Mitigations
- **Gesture conflicts**: swipe navigation must not interfere with pinch/zoom; mitigate via gesture state machine and thresholds.
- **Event handling complexity**: unify pointer/touch events, preferring PointerEvents where supported. Provide fallbacks for iOS Safari quirks.
- **State divergence**: ensure selection mode state syncs across All Photos and Project views; add unit tests for the new hooks.

## Verification Checklist
- **Desktop**: hover shows gradient, circle selectable, regular click opens viewer, keyboard shortcuts unaffected.
- **Mobile**: tap opens viewer when not in selection mode; long press enters selection mode; selection banner visible; exit returns to tap-to-open behavior.
- **Viewer**: swipe left/right changes photo; pinch zoom and pan continue to work; vertical swipe or close button exits cleanly; safe areas observed.

## Follow-up Documentation
- Update UX sections in `PROJECT_OVERVIEW.md` and `README.md` with the new interaction models.
- Add mobile gesture notes to `SCHEMA_DOCUMENTATION.md` UX appendix (selection state handling).
- Consider a dev guide snippet describing the selection mode state machine and reusable hooks.