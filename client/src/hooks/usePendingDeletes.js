import { useMemo } from 'react';

/**
 * Hook to calculate pending deletes for both All Photos and Project views
 * 
 * ARCHITECTURAL DECISION: Unified View Context
 * There is NO conceptual distinction between "All Photos" and "Project" views.
 * A Project view is simply the All Photos view with a project filter applied.
 * 
 * This hook uses view.project_filter to determine the current view context
 * while maintaining backward compatibility with isAllMode during transition.
 */
export function usePendingDeletes({
  // Unified view context
  view,
  
  // Legacy properties (for backward compatibility)
  projectData,
  selectedProject,
  allPendingDeletes,
  isAllMode
}) {
  // Pending destructive actions: assets available but marked not to keep
  const pendingDeletesProject = useMemo(() => {
    const photos = projectData?.photos || [];
    let jpg = 0, raw = 0;
    for (const p of photos) {
      if (p.jpg_available && p.keep_jpg === false) jpg++;
      if (p.raw_available && p.keep_raw === false) raw++;
    }
    const total = jpg + raw;
    const byProject = new Set();
    if (total > 0 && selectedProject?.folder) {
      byProject.add(selectedProject.folder);
    }
    return { jpg, raw, total, byProject };
  }, [projectData, selectedProject?.folder]);

  // Separate state for All Photos pending deletions (independent of filtered view)
  const pendingDeletesAll = allPendingDeletes;

  // Use unified view context to determine which pending deletes to use
  const isAllPhotosView = view?.project_filter === null;
  
  // For backward compatibility, fall back to isAllMode if view context is not available
  const pendingDeleteTotals = (view !== undefined) 
    ? (isAllPhotosView ? pendingDeletesAll : pendingDeletesProject)
    : (isAllMode ? pendingDeletesAll : pendingDeletesProject);
  const hasPendingDeletes = pendingDeleteTotals.total > 0;
  const pendingProjectsCount = pendingDeleteTotals.byProject ? pendingDeleteTotals.byProject.size : 0;

  return {
    pendingDeletesProject,
    pendingDeletesAll,
    pendingDeleteTotals,
    hasPendingDeletes,
    pendingProjectsCount
  };
}
