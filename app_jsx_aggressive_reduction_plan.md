# App.jsx Aggressive Size Reduction Plan

## Current Status: 1795 lines → Target: 800-1000 lines (60% reduction needed)

## Root Cause Analysis
Despite previous refactoring, App.jsx remains massive because we only extracted UI components but left the core business logic, state management, and effects in the main component.

## Aggressive Modularization Strategy

### Phase 1: State Management Extraction (400-500 lines reduction)
1. **Create `hooks/useAppState.js`** - Extract all useState declarations and basic state logic
2. **Create `hooks/usePhotoSelection.js`** - Consolidate all selection logic (project + all photos)
3. **Create `hooks/useFiltersAndSort.js`** - Extract filtering, sorting, and view mode state
4. **Create `hooks/useViewerState.js`** - Extract photo viewer state and navigation logic
5. **Create `hooks/useModalState.js`** - Extract all modal visibility state

### Phase 2: Business Logic Extraction (300-400 lines reduction)
1. **Create `services/ProjectDataService.js`** - Extract fetchProjectData and related logic
2. **Create `services/PhotoOperationsService.js`** - Extract photo operations (move, delete, etc.)
3. **Create `hooks/useProjectNavigation.js`** - Extract project switching and URL sync logic
4. **Create `hooks/usePhotoUpload.js`** - Extract upload-related logic and state

### Phase 3: Effect Logic Extraction (200-300 lines reduction)
1. **Create `hooks/useAppInitialization.js`** - Extract initialization effects and deep linking
2. **Create `hooks/usePersistence.js`** - Extract all localStorage/session persistence logic
3. **Create `hooks/useTaskNotifications.js`** - Extract task definition and notification logic

### Phase 4: Render Logic Extraction (200-300 lines reduction)
1. **Create `components/AppLayout.js`** - Extract main layout structure and conditional rendering
2. **Create `components/MainContent.js`** - Extract the core content area rendering logic
3. **Create `components/ModalsContainer.js`** - Extract all modal rendering logic

## Expected Final Structure (800-900 lines)
```javascript
function App() {
  // 50-100 lines: Hook calls and derived state
  const appState = useAppState();
  const photoSelection = usePhotoSelection();
  const filtersAndSort = useFiltersAndSort();
  // ... other hooks

  // 100-200 lines: Event handlers (simplified, delegating to services)
  const handleProjectSelect = (project) => {
    projectNavigation.selectProject(project);
  };
  // ... other handlers

  // 500-600 lines: Simplified JSX structure
  return (
    <AppLayout>
      <MainContent />
      <ModalsContainer />
    </AppLayout>
  );
}
```

## Implementation Priority
1. **High Impact**: State management extraction (Phase 1)
2. **Medium Impact**: Business logic extraction (Phase 2) 
3. **Low Impact**: Effect and render logic extraction (Phases 3-4)

## Success Metrics
- App.jsx: 800-1000 lines (current: 1795)
- Maintainability: Clear separation of concerns
- Testability: Business logic in testable services/hooks
- Reusability: Extracted hooks can be reused in other components
