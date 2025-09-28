import { useEffect } from 'react';
import { getLastProject } from '../utils/storage';

/**
 * Hook to handle switching between All Photos and Project views
 * 
 * ARCHITECTURAL DECISION: Unified View Context
 * There is NO conceptual distinction between "All Photos" and "Project" views.
 * A Project view is simply the All Photos view with a project filter applied.
 * 
 * This hook handles the transition between these views by updating the view.project_filter
 * and maintaining backward compatibility with isAllMode during the transition period.
 */
export function useModeSwitching({
  // New unified view context
  view,
  updateProjectFilter,
  selection,
  setSelection,
  
  // Legacy properties (for backward compatibility)
  isAllMode,
  projects,
  selectedProject,
  previousProjectRef,
  pendingSelectProjectRef,
  ALL_PROJECT_SENTINEL,
  setSelectedProject,
  setProjectData,
  setSelectedPhotos,
  registerActiveProject,
  clearAllSelection,
  handleProjectSelect,
}) {
  // Primary effect using unified view context
  useEffect(() => {
    const inAllPhotosView = view.project_filter === null;
    
    if (inAllPhotosView) {
      // Switching to All Photos view
      if (selectedProject && selectedProject.folder !== ALL_PROJECT_SENTINEL.folder) {
        previousProjectRef.current = selectedProject;
      }
      setSelectedProject(prev => (prev && prev.folder === ALL_PROJECT_SENTINEL.folder) ? prev : ALL_PROJECT_SENTINEL);
      setProjectData(null);
      setSelectedPhotos(new Set());
      registerActiveProject(null);
      
      // Clear selection in unified model
      setSelection([]);
      
      // Also clear legacy selection for backward compatibility
      clearAllSelection();
      pendingSelectProjectRef.current = null;
    } else {
      // Switching to Project view
      if (!selectedProject || selectedProject.folder === ALL_PROJECT_SENTINEL.folder) {
        const fallback = previousProjectRef.current
          || projects.find(p => p.folder === getLastProject())
          || projects[0]
          || null;
        if (fallback && fallback.folder !== ALL_PROJECT_SENTINEL.folder) {
          handleProjectSelect(fallback);
        } else {
          setSelectedProject(null);
          setProjectData(null);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.project_filter, projects]);
  
  // Backward compatibility effect for isAllMode during transition
  useEffect(() => {
    // This ensures that changes to isAllMode are reflected in view.project_filter
    // This can be removed once all code is migrated to use view.project_filter
    if (isAllMode && view.project_filter !== null) {
      updateProjectFilter(null);
    } else if (!isAllMode && view.project_filter === null) {
      // When switching from All Photos to Project view via isAllMode,
      // we need to set the project_filter to the selected project's folder
      if (selectedProject && selectedProject.folder !== ALL_PROJECT_SENTINEL.folder) {
        updateProjectFilter(selectedProject.folder);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAllMode]);
}
