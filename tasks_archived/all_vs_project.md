# All Photos vs Project Mode Distinctions

Each section captures logic that still treats the global `All Photos` experience differently from project-scoped workflows. Mark items as you eliminate the distinction.

## 1. App state exposure
### Description
`useAppState()` destructure exposes `isAllMode`, `showAllMoveModal`, and global selection state that drive All Photos–specific flows.
### Reference files
- `client/src/App.jsx:65-112`
### Notes
- [x] Addressed

  ## Implementation
  
  1. **Architectural Decision Documentation**:
     - Added clear documentation in `useAppState.js` stating that there is NO conceptual distinction between All Photos and Project views
     - Emphasized that a Project view is simply the All Photos view with a project filter applied
     - Added explicit guidance that any code treating these views differently should be refactored
  
  2. **Unified View Context**:
     - Added `view.project_filter` state (null = All Photos, string = specific project folder)
     - Created compatibility helpers to maintain backward compatibility during transition
     - Added `updateProjectFilter` and `updateIsAllMode` functions that keep both states in sync
  
  3. **Unified Selection Model**:
     - Created new `useUnifiedSelection.js` hook with a normalized selection model
     - Selection items use `PhotoRef` objects with `{ id, project_folder, filename }` shape
     - Added conversion helpers between unified and legacy selection formats
     - Maintained backward compatibility with existing selection state
  
  4. **Unified Modal State**:
     - Added `uiModals.move` state with `{ open, items, suggestedDestination }` shape
     - Created sync helpers to maintain compatibility with existing modal state
  
  5. **Backward Compatibility**:
     - Kept existing properties with deprecation warnings
     - Added derived getters and setters that maintain both old and new state formats
     - Ensured no breaking changes to existing functionality
  
  This implementation sets the foundation for eliminating the artificial distinction between All Photos and Project views while maintaining backward compatibility during the transition.
  
  - Analysis
    - Current coupling: `useAppState()` exposes `isAllMode`, `showAllMoveModal`, and separate selection stores (`selectedPhotos` for project, `allSelectedKeys` for All Photos). UI components branch on these to change behavior and API targets.
    - Why distinction exists: Historically, All Photos aggregated across projects with composite keys and different endpoints. To avoid accidental cross-project changes, the state separated selections and surfaced a dedicated All Photos move modal.
    - Resulting issues: Repeated branching across header, viewer, operations, upload, and keyboard layers; harder to reason about selection and move semantics; more props drilling and mode checks.

  - Proposed unification
    - Replace `isAllMode` with a single source of truth: `viewContext.project_filter` (null = All Photos; string = specific `project_folder`). Components should derive “mode” by checking if `project_filter` is null rather than reading a boolean flag.
    - Single selection model: `selection` is one array of `PhotoRef` with the normalized shape `{ id, project_folder, filename }` (id preferred when available per unified image-scoped endpoints). Remove `allSelectedKeys` vs `selectedPhotos` split.
    - Unified move modal trigger: Expose `ui.modals.move` state only, with payload `{ open, items: PhotoRef[], suggestedDestination?: project_folder }`. Remove `showAllMoveModal` and route all move actions through the same modal regardless of current `project_filter`.
    - State shape sketch (read-only excerpt):
      ```ts
      type ViewContext = { project_filter: string | null };
      type PhotoRef = { id?: string; project_folder: string; filename: string };
      type AppState = {
        view: ViewContext;
        selection: PhotoRef[];
        ui: {
          modals: { move: { open: boolean; items: PhotoRef[]; suggestedDestination?: string } };
        };
      };
      ```
    - Derivations: Components compute `const inProjectView = state.view.project_filter !== null` where needed; no dedicated `isAllMode` export.

  - API touchpoints to align
    - Selection-driven actions (commit/revert, tags, keep, move) already use unified image-scoped endpoints (see `server/routes/photosActions.js`). Frontend should always pass `photo_id` when available; fall back to `{ project_folder, filename }` only for legacy cases.
    - Refresh semantics: Replace `useAllPhotosRefresh()` exposure with a generic `useRefresh({ project_filter })` that reloads either global or scoped data using the same hook signature.

  - Migration plan (scoped to Item 1 only; no code yet)
    1. Update `useAppState.js` interface to add `view.project_filter` and `selection`, and deprecate `isAllMode`, `allSelectedKeys`, `selectedPhotos`, `showAllMoveModal` (kept temporarily with warnings for subsequent items to migrate).
    2. Update `client/src/App.jsx` consumers limited to the destructure sites listed (lines 65–112) to read `view.project_filter` and `selection` while leaving branching in downstream components for later items.
    3. Do not change behavior of downstream components in this step; only the exposure contract changes to enable subsequent unifications.

  - Risks / mitigations
    - Risk: Mixed selection shapes during transition. Mitigation: Normalize to `PhotoRef` at the selector boundary inside `useAppState` to keep consumers stable.
    - Risk: Accidental behavior change if `isAllMode` removal leaks. Mitigation: Keep `isAllMode` as a derived getter for one iteration (`isAllMode = view.project_filter === null`) until items 2–7 are migrated, then remove.

  - Acceptance criteria for Item 1
    - `useAppState()` exposes `view.project_filter` and unified `selection` without breaking current runtime.
    - No new branches added; all existing behavior remains intact pending later items.
    - Lint passes and type shape (JSDoc/TS typedefs if present) updated.

## 2. Initialization and mode switching
### Description
`useAppInitialization()` and `useModeSwitching()` rely on `isAllMode` to restore session state, deep links, and preferred project when toggling between `/all` and project routes.
### Reference files
- `client/src/App.jsx:237-318`
### Notes
- [x] Addressed

  ## Implementation
  
  1. **Updated useModeSwitching.js**:
     - Refactored to use `view.project_filter` as the source of truth
     - Added backward compatibility with `isAllMode` during transition
     - Added explicit documentation about the unified view architecture
     - Implemented bidirectional sync between old and new state models
     - Added support for unified selection model
  
  2. **Updated useAppInitialization.js**:
     - Modified URL parsing to set `view.project_filter` based on routes
     - Updated localStorage persistence to use unified view context
     - Refactored project selection logic to use `view.project_filter`
     - Updated pending deletes fetching to check `view.project_filter === null`
     - Maintained backward compatibility with `isAllMode` during transition
  
  3. **Architectural Improvements**:
     - Eliminated conceptual distinction between views in initialization code
     - Made it explicit that All Photos is just a null project filter
     - Ensured deep linking works consistently in both views
     - Improved code readability with clear comments about the architecture
  
  This implementation ensures that initialization and mode switching use the unified view context while maintaining backward compatibility with existing code during the transition period.

## 3. Pending deletes and refresh hooks
### Description
`usePendingDeletes()` and `useAllPhotosRefresh()` compute All Photos totals while project-level pending delete data lives elsewhere.
### Reference files
- `client/src/App.jsx:403-437`
### Notes
- [x] Addressed

  ## Implementation
  
  1. **Updated usePendingDeletes.js**:
     - Refactored to use `view.project_filter` as the source of truth
     - Added backward compatibility with `isAllMode` during transition
     - Added explicit documentation about the unified view architecture
     - Improved code to gracefully handle both view contexts
  
  2. **Created usePhotoDataRefresh.js** (renamed from useAllPhotosRefresh.js):
     - Implemented a unified refresh function that works for both views
     - Added `refreshPhotoData()` that handles both All Photos and Project views
     - Maintained backward compatibility with `refreshAllPhotos()` during transition
     - Added support for refreshing project data when in Project view
  
  3. **Architectural Improvements**:
     - Eliminated conceptual distinction between views in data refresh logic
     - Made it explicit that All Photos is just a null project filter
     - Improved code organization with clear comments about the architecture
     - Created a more consistent API for refreshing data in both views
  
  This implementation ensures that pending deletes calculation and data refresh operations use the unified view context while maintaining backward compatibility with existing code during the transition period.

## 4. Commit/Revert service integration
### Description
`useCommitRevert()` receives `isAllMode` to select `/api/photos/*` endpoints, adjust payloads, and refresh All Photos data.
### Reference files
- `client/src/App.jsx:430-468`
- `client/src/hooks/useCommitRevert.js:5-176`
### Notes
- [x] Addressed

  ## Implementation
  
  1. **Updated useCommitRevert.js**:
     - Refactored to use `view.project_filter` as the source of truth
     - Added backward compatibility with `isAllMode` during transition
     - Added explicit documentation about the unified view architecture
     - Implemented consistent endpoint selection based on view context
  
  2. **Unified Data Refresh**:
     - Added support for the unified `refreshPhotoData()` function
     - Maintained backward compatibility with legacy refresh functions
     - Ensured consistent behavior across both views
     - Improved error handling to use the appropriate refresh function
  
  3. **API Integration**:
     - Used the same unified image-scoped endpoints for both views
     - Maintained consistent payload structure for both views
     - Leveraged existing global endpoints from `photosActions.js`
     - Ensured optimistic updates work consistently in both views
  
  4. **Architectural Improvements**:
     - Eliminated conceptual distinction between views in commit/revert operations
     - Made it explicit that All Photos is just a null project filter
     - Improved code organization with clear comments about the architecture
     - Ensured consistent user experience across both views
  
  This implementation ensures that commit/revert operations use the unified view context while maintaining backward compatibility with existing code during the transition period.

## 5. Header and toolbar rendering
### Description
Sticky header toggles the All Photos checkbox, disables the project selector, adjusts counts, and wires the unified `ViewModeControls` differently per mode.
### Reference files
- `client/src/App.jsx:565-773`
### Notes
- [x] Addressed

  ## Implementation
  
  1. **Updated All Toggle Checkbox**:
     - Changed from checking `isAllMode` to checking `view?.project_filter === null`
     - Maintained backward compatibility with existing event handlers
     - Added explicit comments about the unified view architecture
  
  2. **Updated Project Selector**:
     - Changed from using `isAllMode` to using `view?.project_filter === null`
     - Updated the disabled state to use the unified view context
     - Improved the placeholder label for clarity
  
  3. **Updated Photo Count Display**:
     - Changed from checking `isAllMode` to checking `view?.project_filter === null`
     - Maintained the consistent format for both views
     - Ensured the "filtered of total" format works correctly in both views
  
  4. **Updated SelectionToolbar**:
     - Added unified selection model properties (`selection`, `setSelection`)
     - Changed from using `isAllMode` to using `view?.project_filter === null`
     - Maintained backward compatibility with existing selection handlers
  
  5. **Updated ViewModeControls**:
     - Changed from using `isAllMode` to using `view?.project_filter === null`
     - Added unified selection model properties to both operation menus
     - Maintained backward compatibility with existing operation handlers
  
  This implementation ensures that the header and toolbar rendering use the unified view context while maintaining backward compatibility with existing code during the transition period.

## 6. Sort controls data flow
### Description
`SortControls` composition remains shared, but upstream props differ based on All Photos vs project data sources.
### Reference files
- `client/src/App.jsx:773-779`
### Notes
- [x] Addressed

  ## Implementation
  
  1. **Updated SortControls Component**:
     - Added `viewType` parameter to distinguish between All Photos and Project views
     - Added architectural decision documentation about unified view context
     - Added debug logging to help with troubleshooting
  
  2. **Updated App.jsx**:
     - Modified SortControls usage to pass `viewType` based on unified view context
     - Used `view?.project_filter === null ? 'all' : 'project'` to determine the view type
     - Maintained the same sort controls for both views for consistency
  
  3. **Unified Sort Behavior**:
     - Both All Photos and Project views now use the same sort controls
     - The sort controls work identically in both views
     - Added logging to track sort changes in different views
  
  This implementation ensures that the sort controls use the unified view context while maintaining backward compatibility with existing code during the transition period.

## 7. Main content renderer branching
### Description
`MainContentRenderer` selects `AllPhotosPane` or `PhotoDisplay` according to `isAllMode`.
### Reference files
- `client/src/App.jsx:875-907`
- `client/src/components/MainContentRenderer.jsx:47-113`
### Notes
- [x] Addressed

## 8. Viewer behavior and move modal
### Description
`PhotoViewer` closing/move logic uses `isAllMode` to open global move modal, translate composite keys, and respect All Photos sentinel folder.
### Reference files
- `client/src/App.jsx:963-1003`
- `client/src/components/PhotoViewer.jsx:35-310`
### Notes
- [x] Addressed

## 9. Drag-and-drop uploads
### Description
`GlobalDragDrop` dispatches dropped files differently when in All Photos mode, prompting for destination.
### Reference files
- `client/src/App.jsx:1015-1030`
- `client/src/components/GlobalDragDrop.jsx:8-90`
### Notes
- [x] Addressed

## 10. Viewer synchronization
### Description
`useViewerSync()` maintains separate data sources and deep-link handling when `isAllMode` is true.
### Reference files
- `client/src/hooks/useViewerSync.js:1-210`
### Notes
- [x] Addressed

## 11. Initialization side effects
### Description
Startup logic inspects the URL to set `isAllMode` and fetch initial data accordingly.
### Reference files
- `client/src/hooks/useAppInitialization.js:15-120`
### Notes
- [x] Addressed

## 12. Mode toggling hook
### Description
`useModeSwitching()` keeps a previous-project reference, manages the All Photos checkbox, and clears project state when entering `/all`.
### Reference files
- `client/src/hooks/useModeSwitching.js:6-90`
### Notes
- [x] Addressed

## 13. Navigation helpers
### Description
`ProjectNavigationService` conditionally calls `toggleAllMode` or `handleProjectSelect` while switching between contexts.
### Reference files
- `client/src/services/ProjectNavigationService.js:12-110`
### Notes
- [x] Addressed

## 14. URL synchronization
### Description
`useUrlSync()` updates query params/history differently for All Photos vs project routes.
### Reference files
- `client/src/hooks/useUrlSync.js:10-120`
### Notes
- [x] Addressed

## 15. All Photos refresh helper
### Description
`useAllPhotosRefresh()` encapsulates server refresh for the global list; there is no equivalent hook for project refresh.
### Reference files
- `client/src/hooks/useAllPhotosRefresh.js:6-70`
### Notes
- [x] Addressed

## 16. Pending delete aggregation
### Description
`usePendingDeletes()` tracks All Photos pending deletes separately from project-level totals.
### Reference files
- `client/src/hooks/usePendingDeletes.js:9-85`
### Notes
- [x] Addressed

## 17. Shared app state
### Description
`useAppState()` stores project selection (`selectedPhotos`), All Photos selection (`allSelectedKeys`), and the mode flag.
### Reference files
- `client/src/hooks/useAppState.js:33-120`
### Notes
- [x] Addressed

## 18. Selection toolbar
### Description
`SelectionToolbar` renders different select-all controls via `isAllMode`.
### Reference files
- `client/src/components/SelectionToolbar.jsx:13-72`
### Notes
- [x] Addressed

## 19. Filter panel behavior
### Description
`UniversalFilter` hides or disables controls (e.g., tagging) when `isAllMode` is true.
### Reference files
- `client/src/components/UniversalFilter.jsx:40-190`
### Notes
- [x] Addressed

## 20. Upload button flow
### Description
`UploadButton` prompts for a target project when invoked from All Photos.
### Reference files
- `client/src/components/UploadButton.jsx:24-120`
### Notes
- [x] Addressed

## 21. Project selection modal
### Description
Modal primarily serves All Photos uploads to pick a destination project.
### Reference files
- `client/src/components/ProjectSelectionModal.jsx:10-140`
### Notes
- [x] Addressed

## 22. Upload handler logic
### Description
`UploadHandler` enforces project selection when All Photos uploads occur.
### Reference files
- `client/src/components/UploadHandler.jsx:15-120`
### Notes
- [x] Addressed

## 23. Operations menu branching
### Description
`OperationsMenu` uses `allMode` flag to batch selections and disable tagging in All Photos mode.
### Reference files
- `client/src/components/OperationsMenu.jsx:20-288`
### Notes
- [x] Addressed

## 24. All Photos API module
### Description
Dedicated API functions exist solely for All Photos pagination/filtering.
### Reference files
- `client/src/api/allPhotosApi.js:10-140`
### Notes
- [x] Addressed - Fixed pagination issues by implementing a global manager cache that persists PagedWindowManager instances across renders, ensuring consistent behavior between All Photos and Project views

## 25. Keyboard shortcuts
### Description
`useKeyboardShortcuts()` binds keys differently when `isAllMode` is active (e.g., toggling All Photos mode).
### Reference files
- `client/src/hooks/useKeyboardShortcuts.js:20-140`
### Notes
- [x] Addressed
