# All Photos vs Project Mode Distinctions

Each section captures logic that still treats the global `All Photos` experience differently from project-scoped workflows. Mark items as you eliminate the distinction.

## 1. App state exposure
### Description
`useAppState()` destructure exposes `isAllMode`, `showAllMoveModal`, and global selection state that drive All Photos–specific flows.
### Reference files
- `client/src/App.jsx:65-112`
### Notes
- [ ] Addressed

## 2. Initialization and mode switching
### Description
`useAppInitialization()` and `useModeSwitching()` rely on `isAllMode` to restore session state, deep links, and preferred project when toggling between `/all` and project routes.
### Reference files
- `client/src/App.jsx:237-318`
### Notes
- [ ] Addressed

## 3. Pending deletes and refresh hooks
### Description
`usePendingDeletes()` and `useAllPhotosRefresh()` compute All Photos totals while project-level pending delete data lives elsewhere.
### Reference files
- `client/src/App.jsx:403-437`
### Notes
- [ ] Addressed

## 4. Commit/Revert service integration
### Description
`useCommitRevert()` receives `isAllMode` to select `/api/photos/*` endpoints, adjust payloads, and refresh All Photos data.
### Reference files
- `client/src/App.jsx:430-468`
- `client/src/hooks/useCommitRevert.js:5-176`
### Notes
- [ ] Addressed

## 5. Header and toolbar rendering
### Description
Sticky header toggles the All Photos checkbox, disables the project selector, adjusts counts, and wires the unified `ViewModeControls` differently per mode.
### Reference files
- `client/src/App.jsx:565-773`
### Notes
- [ ] Addressed

## 6. Sort controls data flow
### Description
`SortControls` composition remains shared, but upstream props differ based on All Photos vs project data sources.
### Reference files
- `client/src/App.jsx:773-779`
### Notes
- [ ] Addressed

## 7. Main content renderer branching
### Description
`MainContentRenderer` selects `AllPhotosPane` or `PhotoDisplay` according to `isAllMode`.
### Reference files
- `client/src/App.jsx:875-907`
- `client/src/components/MainContentRenderer.jsx:47-113`
### Notes
- [ ] Addressed

## 8. Viewer behavior and move modal
### Description
`PhotoViewer` closing/move logic uses `isAllMode` to open global move modal, translate composite keys, and respect All Photos sentinel folder.
### Reference files
- `client/src/App.jsx:963-1003`
- `client/src/components/PhotoViewer.jsx:35-310`
### Notes
- [ ] Addressed

## 9. Drag-and-drop uploads
### Description
`GlobalDragDrop` dispatches dropped files differently when in All Photos mode, prompting for destination.
### Reference files
- `client/src/App.jsx:1015-1030`
- `client/src/components/GlobalDragDrop.jsx:8-90`
### Notes
- [ ] Addressed

## 10. Viewer synchronization
### Description
`useViewerSync()` maintains separate data sources and deep-link handling when `isAllMode` is true.
### Reference files
- `client/src/hooks/useViewerSync.js:1-210`
### Notes
- [ ] Addressed

## 11. Initialization side effects
### Description
Startup logic inspects the URL to set `isAllMode` and fetch initial data accordingly.
### Reference files
- `client/src/hooks/useAppInitialization.js:15-120`
### Notes
- [ ] Addressed

## 12. Mode toggling hook
### Description
`useModeSwitching()` keeps a previous-project reference, manages the All Photos checkbox, and clears project state when entering `/all`.
### Reference files
- `client/src/hooks/useModeSwitching.js:6-90`
### Notes
- [ ] Addressed

## 13. Navigation helpers
### Description
`ProjectNavigationService` conditionally calls `toggleAllMode` or `handleProjectSelect` while switching between contexts.
### Reference files
- `client/src/services/ProjectNavigationService.js:12-110`
### Notes
- [ ] Addressed

## 14. URL synchronization
### Description
`useUrlSync()` updates query params/history differently for All Photos vs project routes.
### Reference files
- `client/src/hooks/useUrlSync.js:10-120`
### Notes
- [ ] Addressed

## 15. All Photos refresh helper
### Description
`useAllPhotosRefresh()` encapsulates server refresh for the global list; there is no equivalent hook for project refresh.
### Reference files
- `client/src/hooks/useAllPhotosRefresh.js:6-70`
### Notes
- [ ] Addressed

## 16. Pending delete aggregation
### Description
`usePendingDeletes()` tracks All Photos pending deletes separately from project-level totals.
### Reference files
- `client/src/hooks/usePendingDeletes.js:9-85`
### Notes
- [ ] Addressed

## 17. Shared app state
### Description
`useAppState()` stores project selection (`selectedPhotos`), All Photos selection (`allSelectedKeys`), and the mode flag.
### Reference files
- `client/src/hooks/useAppState.js:33-120`
### Notes
- [ ] Addressed

## 18. Selection toolbar
### Description
`SelectionToolbar` renders different select-all controls via `isAllMode`.
### Reference files
- `client/src/components/SelectionToolbar.jsx:13-72`
### Notes
- [ ] Addressed

## 19. Filter panel behavior
### Description
`UniversalFilter` hides or disables controls (e.g., tagging) when `isAllMode` is true.
### Reference files
- `client/src/components/UniversalFilter.jsx:40-190`
### Notes
- [ ] Addressed

## 20. Upload button flow
### Description
`UploadButton` prompts for a target project when invoked from All Photos.
### Reference files
- `client/src/components/UploadButton.jsx:24-120`
### Notes
- [ ] Addressed

## 21. Project selection modal
### Description
Modal primarily serves All Photos uploads to pick a destination project.
### Reference files
- `client/src/components/ProjectSelectionModal.jsx:10-140`
### Notes
- [ ] Addressed

## 22. Upload handler logic
### Description
`UploadHandler` enforces project selection when All Photos uploads occur.
### Reference files
- `client/src/components/UploadHandler.jsx:15-120`
### Notes
- [ ] Addressed

## 23. Operations menu branching
### Description
`OperationsMenu` uses `allMode` flag to batch selections and disable tagging in All Photos mode.
### Reference files
- `client/src/components/OperationsMenu.jsx:20-288`
### Notes
- [ ] Addressed

## 24. All Photos API module
### Description
Dedicated API functions exist solely for All Photos pagination/filtering.
### Reference files
- `client/src/api/allPhotosApi.js:10-140`
### Notes
- [ ] Addressed

## 25. Keyboard shortcuts
### Description
`useKeyboardShortcuts()` binds keys differently when `isAllMode` is active (e.g., toggling All Photos mode).
### Reference files
- `client/src/hooks/useKeyboardShortcuts.js:20-140`
### Notes
- [ ] Addressed
