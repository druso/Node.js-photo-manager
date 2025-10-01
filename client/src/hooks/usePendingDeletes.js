import { useMemo } from 'react';

/**
 * Hook to calculate pending deletes for both All Photos and Project views
 * 
 * ARCHITECTURAL DECISION: SSE-Driven Pending Changes
 * Uses Server-Sent Events (SSE) to receive real-time updates about pending changes.
 * The backend sends boolean flags per project indicating if changes are pending.
 * 
 * This hook uses view.project_filter to determine the current view context.
 */
export function usePendingDeletes({
  // Unified view context
  view,
  
  // SSE data (real-time pending changes from backend)
  pendingChangesSSE,
  
  // Legacy properties (for backward compatibility)
  selectedProject,
  isAllMode
}) {
  // Use unified view context to determine which pending deletes to use
  const isAllPhotosView = view?.project_filter === null;
  
  // For All Photos: check if ANY project has pending changes
  const hasPendingDeletesAll = useMemo(() => {
    if (!pendingChangesSSE || typeof pendingChangesSSE !== 'object') return false;
    return Object.values(pendingChangesSSE).some(hasPending => hasPending === true);
  }, [pendingChangesSSE]);
  
  // For Project: check if THIS project has pending changes
  const hasPendingDeletesProject = useMemo(() => {
    if (!pendingChangesSSE || !selectedProject?.folder) return false;
    return pendingChangesSSE[selectedProject.folder] === true;
  }, [pendingChangesSSE, selectedProject?.folder]);
  
  // Determine if toolbar should show based on current view
  const hasPendingDeletes = (view !== undefined)
    ? (isAllPhotosView ? hasPendingDeletesAll : hasPendingDeletesProject)
    : (isAllMode ? hasPendingDeletesAll : hasPendingDeletesProject);
  
  // Count how many projects have pending changes (for All Photos mode)
  const pendingProjectsCount = useMemo(() => {
    if (!pendingChangesSSE || typeof pendingChangesSSE !== 'object') return 0;
    return Object.values(pendingChangesSSE).filter(hasPending => hasPending === true).length;
  }, [pendingChangesSSE]);
  
  // Debug logging (only in development)
  if (import.meta.env.DEV) {
    console.log('[usePendingDeletes]', {
      isAllPhotosView,
      selectedProject: selectedProject?.folder,
      hasPendingDeletes,
      pendingProjectsCount
    });
  }

  return {
    hasPendingDeletes,
    pendingProjectsCount,
    // Legacy return values (kept for compatibility, but not used with SSE)
    pendingDeleteTotals: { total: hasPendingDeletes ? 1 : 0 }
  };
}
