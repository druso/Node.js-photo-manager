# Toolbar Implementation Plan - Backend-Driven Pending Deletes

## Problem Statement

The current toolbar visibility logic is flawed because it only checks photos loaded in memory (`projectData.photos`), which may not include all photos in the project due to pagination. We need a backend-driven solution that checks ALL photos.

## Solution: Backend API for Pending Deletes Count

### Backend Implementation

#### 1. New Endpoint for Project Pending Deletes

**File**: `server/routes/projectsActions.js` (or similar)

**Endpoint**: `GET /api/projects/:folder/pending-deletes`

**SQL Query**:
```sql
SELECT 
  COUNT(CASE WHEN jpg_available = 1 AND keep_jpg = 0 THEN 1 END) as jpg_count,
  COUNT(CASE WHEN raw_available = 1 AND keep_raw = 0 THEN 1 END) as raw_count,
  COUNT(CASE WHEN (jpg_available = 1 AND keep_jpg = 0) OR (raw_available = 1 AND keep_raw = 0) THEN 1 END) as total_count
FROM photos
WHERE project_folder = ?
```

**Response**:
```json
{
  "jpg": 2,
  "raw": 4,
  "total": 6,
  "project_folder": "p15"
}
```

#### 2. Update Existing All Photos Endpoint

The `/api/photos/pending-deletes` endpoint already exists and works correctly. No changes needed.

### Frontend Implementation

#### 1. Update `usePendingDeletes` Hook

**Current Problem**: Calculates from in-memory photos
**Solution**: Call backend API instead

```javascript
// For Project mode:
const pendingDeletesProject = useMemo(() => {
  // Don't calculate from projectData.photos
  // Instead, this will be fetched via API
  return projectPendingDeletesFromApi || { jpg: 0, raw: 0, total: 0, byProject: new Set() };
}, [projectPendingDeletesFromApi]);
```

#### 2. Add API Call in `useAppInitialization` or New Hook

```javascript
// Fetch pending deletes for current project
useEffect(() => {
  if (!selectedProject?.folder) return;
  
  const fetchProjectPendingDeletes = async () => {
    try {
      const result = await fetch(`/api/projects/${encodeURIComponent(selectedProject.folder)}/pending-deletes`);
      const data = await result.json();
      setProjectPendingDeletes(data);
    } catch (error) {
      console.error('Failed to fetch project pending deletes:', error);
      setProjectPendingDeletes({ jpg: 0, raw: 0, total: 0 });
    }
  };
  
  fetchProjectPendingDeletes();
}, [selectedProject?.folder]);
```

#### 3. Refresh After Keep Flag Changes

**In PhotoViewer or wherever keep flags are updated**:

```javascript
const handleKeepUpdated = async (photo, updates) => {
  // Update keep flags
  await updateKeep(photo, updates);
  
  // Refresh pending deletes count
  if (selectedProject?.folder) {
    const result = await fetch(`/api/projects/${encodeURIComponent(selectedProject.folder)}/pending-deletes`);
    const data = await result.json();
    setProjectPendingDeletes(data);
  } else {
    // All Photos mode
    const result = await listAllPendingDeletes(...);
    setAllPendingDeletes(result);
  }
  
  // Refresh photo data
  refreshPhotoData();
};
```

## Implementation Steps

### Phase 1: Backend API (30 minutes)
1. Create `/api/projects/:folder/pending-deletes` endpoint
2. Implement SQL query to count mismatches
3. Test endpoint with curl/Postman

### Phase 2: Frontend State (20 minutes)
1. Add `projectPendingDeletes` state to App.jsx
2. Create API call in useAppInitialization or new hook
3. Update `usePendingDeletes` to use API data instead of calculation

### Phase 3: Refresh Logic (20 minutes)
1. Find where keep flags are updated (likely in PhotoViewer or event handlers)
2. Add pending deletes refresh after keep flag changes
3. Test that toolbar appears/disappears correctly

### Phase 4: Testing (20 minutes)
1. Test in Project mode - mark photos as don't keep, verify toolbar appears
2. Test in All Photos mode - verify existing logic still works
3. Test pagination - verify toolbar shows even when marked photos are not in current page
4. Test refresh - verify counts update after keep flag changes

## Preview Mode (Future Enhancement)

Once the toolbar is working, preview mode can be added:

**URL Parameter**: `?keep_type=pending_deletes` or `?preview_mode=1`

**Backend**: Filter photos to only show those with mismatches:
```sql
WHERE (jpg_available = 1 AND keep_jpg = 0) OR (raw_available = 1 AND keep_raw = 0)
```

**Frontend**: 
- Add toggle button in toolbar
- Update URL when toggled
- Filter photos based on URL parameter

## Benefits of This Approach

1. **Accurate**: Checks ALL photos in database, not just loaded ones
2. **Simple**: Single SQL query, no complex client-side logic
3. **Performant**: COUNT query is fast, even with many photos
4. **Consistent**: Same approach for both All Photos and Project modes
5. **Maintainable**: Clear separation between backend (data) and frontend (UI)

## Files to Modify

### Backend
- `server/routes/projectsActions.js` (or create new file)
- `server/routes/index.js` (register new route)

### Frontend
- `client/src/api/projectsApi.js` (add API function)
- `client/src/hooks/usePendingDeletes.js` (use API data)
- `client/src/hooks/useAppInitialization.js` (add API call)
- `client/src/App.jsx` (add state for project pending deletes)
- Find and update keep flag change handlers

## Estimated Time

- Backend: 30 minutes
- Frontend: 60 minutes
- Testing: 20 minutes
- **Total**: ~2 hours

## Next Steps

1. Review this plan
2. Implement backend endpoint first
3. Test backend endpoint
4. Implement frontend changes
5. Test end-to-end
