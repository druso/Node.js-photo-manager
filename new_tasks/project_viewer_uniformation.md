# Project Viewer Uniformation

## Overview
Currently, the All Photos view and Project view have different behaviors and capabilities. This task aims to unify them so that Project view is essentially "All Photos pre-filtered by project" with additional project-specific features.

## Current State Analysis

### All Photos View
- ✅ Server-side filtering and pagination
- ✅ Consistent "filtered of total" count display
- ✅ Date range, file type, keep type, orientation filters
- ❌ Limited actions: only "Move to project"
- ❌ No project-specific features

### Project View  
- ✅ Server-side filtering and pagination (recently implemented)
- ✅ Consistent "filtered of total" count display (recently implemented)
- ✅ Date range, file type, keep type, orientation filters (recently implemented)
- ✅ Project-specific actions and viewer features
- ✅ Additional metadata and operations

## Uniformation Goals

### 1. Unified Core Behavior
Both views should have identical:
- Filtering logic and UI
- Pagination behavior
- Count display format
- Keyboard shortcuts
- Grid/list view options
- Photo viewer navigation

### 2. Context-Aware Features
Project view should add (not replace):
- Project-specific actions in context menus
- Additional metadata fields
- Project management operations
- Bulk operations within project scope

### 3. Technical Architecture
- Single shared photo grid component
- Single shared filtering component  
- Single shared photo viewer component
- Context-aware action providers
- Unified state management

## Implementation Plan

### Phase 1: Component Unification
- [ ] Extract shared `PhotoGrid` component
- [ ] Extract shared `PhotoFilters` component
- [ ] Extract shared `PhotoViewer` component
- [ ] Create context-aware action system

### Phase 2: State Management Unification
- [ ] Unified photo loading hooks
- [ ] Unified filtering state
- [ ] Unified pagination state
- [ ] Context-aware data fetching

### Phase 3: Feature Parity
- [ ] Add all filtering options to both views
- [ ] Ensure identical keyboard shortcuts
- [ ] Unified photo selection behavior
- [ ] Consistent drag & drop behavior

### Phase 4: Context-Aware Enhancements
- [ ] Project-specific actions in Project view
- [ ] Enhanced metadata display in Project view
- [ ] Project management features
- [ ] Bulk operations scoped to context

## Technical Considerations

### API Consistency
Both views should use similar API patterns:
- `/api/photos` for All Photos (current)
- `/api/projects/{folder}/photos` for Project view (current)
- Both return identical response formats
- Both support identical filter parameters

### Component Architecture
```
PhotoManager
├── PhotoFilters (shared)
├── PhotoGrid (shared)
│   ├── PhotoCard (shared)
│   └── VirtualizedGrid (shared)
├── PhotoViewer (shared)
├── ActionProvider (context-aware)
│   ├── AllPhotosActions
│   └── ProjectActions
└── StateManager (unified)
```

### State Structure
```javascript
{
  photos: [], // Current photo list
  total: 0, // Filtered count
  unfilteredTotal: 0, // Total count
  filters: {}, // Active filters
  pagination: {}, // Cursor state
  context: 'all' | 'project', // Current context
  projectData: {}, // Project-specific data
  selection: [], // Selected photos
  viewer: {} // Viewer state
}
```

## Benefits

1. **Consistent UX**: Users get identical experience across views
2. **Reduced Complexity**: Single codebase for photo management
3. **Easier Maintenance**: Changes apply to both views automatically
4. **Enhanced Features**: Project view gets all All Photos improvements
5. **Better Testing**: Single set of components to test

## Migration Strategy

1. **Backward Compatibility**: Ensure existing functionality continues working
2. **Incremental Migration**: Move components one at a time
3. **Feature Flags**: Allow switching between old/new implementations
4. **Thorough Testing**: Test both contexts extensively
5. **User Feedback**: Gather feedback during migration

## Success Criteria

- [ ] Both views have identical core behavior
- [ ] Project view retains all current project-specific features
- [ ] All Photos view gains any missing features from Project view
- [ ] Code duplication eliminated
- [ ] Performance maintained or improved
- [ ] User experience improved or maintained

## Estimated Effort
- **Phase 1**: 2-3 days (component extraction)
- **Phase 2**: 2-3 days (state unification)  
- **Phase 3**: 1-2 days (feature parity)
- **Phase 4**: 1-2 days (context enhancements)
- **Testing & Polish**: 1-2 days

**Total**: 7-12 days depending on complexity and testing requirements.
