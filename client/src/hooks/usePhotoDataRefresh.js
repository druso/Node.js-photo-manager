import { useCallback } from 'react';
import { listAllPendingDeletes } from '../api/allPhotosApi';

/**
 * Hook to handle refreshing photo data for both All Photos and Project views
 * 
 * ARCHITECTURAL DECISION: Unified View Context
 * There is NO conceptual distinction between "All Photos" and "Project" views.
 * A Project view is simply the All Photos view with a project filter applied.
 * 
 * This hook uses view.project_filter to determine the current view context
 * while maintaining backward compatibility with isAllMode during transition.
 */
export function usePhotoDataRefresh({
  // Unified view context
  view,
  
  // Data loading functions
  loadAllInitial,
  loadProjectData,
  
  // Legacy properties (for backward compatibility)
  isAllMode,
  activeFilters,
  setAllPendingDeletes,
  selectedProject
}) {
  /**
   * Refresh photo data based on the current view context
   */
  const refreshPhotoData = useCallback(async () => {
    // Use unified view context to determine which data to refresh
    const isAllPhotosView = view?.project_filter === null;
    
    // For backward compatibility, fall back to isAllMode if view context is not available
    const shouldRefreshAllPhotos = (view !== undefined) ? isAllPhotosView : isAllMode;
    
    try {
      if (shouldRefreshAllPhotos) {
        // Refresh All Photos data
        await loadAllInitial();
        
        // Also refresh pending deletions count
        const range = activeFilters?.dateRange || {};
        // Don't pass keep_type to pending deletes API - it has its own internal filter
        const result = await listAllPendingDeletes({
          date_from: range.start || undefined,
          date_to: range.end || undefined,
          file_type: activeFilters?.fileType !== 'any' ? activeFilters?.fileType : undefined,
          orientation: activeFilters?.orientation !== 'any' ? activeFilters?.orientation : undefined,
        });
        setAllPendingDeletes({
          jpg: result.jpg || 0,
          raw: result.raw || 0,
          total: result.total || 0,
          byProject: new Set(result.byProject || []),
        });
      } else if (selectedProject?.folder) {
        // Refresh Project data
        await loadProjectData(selectedProject.folder);
      }
    } catch (error) {
      console.debug('Error refreshing photo data:', error);
      // best effort
    }
  }, [
    view?.project_filter,
    isAllMode,
    loadAllInitial,
    loadProjectData,
    activeFilters?.dateRange,
    activeFilters?.fileType,
    activeFilters?.orientation,
    setAllPendingDeletes,
    selectedProject?.folder
  ]);
  
  // For backward compatibility
  const refreshAllPhotos = useCallback(async () => {
    if (!isAllMode) return;
    await refreshPhotoData();
  }, [isAllMode, refreshPhotoData]);

  /**
   * Refresh only pending deletes count (lighter weight than full refresh)
   */
  const refreshPendingDeletes = useCallback(async () => {
    try {
      const range = activeFilters?.dateRange || {};
      const result = await listAllPendingDeletes({
        date_from: range.start || undefined,
        date_to: range.end || undefined,
        file_type: activeFilters?.fileType !== 'any' ? activeFilters?.fileType : undefined,
        orientation: activeFilters?.orientation !== 'any' ? activeFilters?.orientation : undefined,
      });
      setAllPendingDeletes({
        jpg: result.jpg || 0,
        raw: result.raw || 0,
        total: result.total || 0,
        byProject: new Set(result.byProject || []),
      });
    } catch (error) {
      console.debug('Error refreshing pending deletes:', error);
    }
  }, [
    activeFilters?.dateRange,
    activeFilters?.fileType,
    activeFilters?.orientation,
    setAllPendingDeletes
  ]);

  return { 
    refreshPhotoData,
    refreshAllPhotos, // For backward compatibility
    refreshPendingDeletes
  };
}

export default usePhotoDataRefresh;
