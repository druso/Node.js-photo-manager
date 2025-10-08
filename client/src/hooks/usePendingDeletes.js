import { useMemo } from 'react';

const IS_DEV = Boolean(import.meta?.env?.DEV);

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
  
  // Aggregated totals (from pollable API / optimistic state)
  allPendingDeletes,

  // Per-project totals (when available)
  projectPendingDeletes,

  // Legacy properties (for backward compatibility)
  selectedProject,
  isAllMode
}) {
  const isAllPhotosView = view?.project_filter === null;

  const aggregateTotals = useMemo(() => {
    const source = allPendingDeletes || {};
    const set = source.byProject instanceof Set
      ? new Set(source.byProject)
      : new Set(Array.isArray(source.byProject) ? source.byProject : []);
    return {
      total: source.total ?? 0,
      jpg: source.jpg ?? 0,
      raw: source.raw ?? 0,
      byProject: set
    };
  }, [allPendingDeletes]);

  const projectTotals = useMemo(() => {
    if (!projectPendingDeletes || !selectedProject?.folder) return null;
    const entry = projectPendingDeletes[selectedProject.folder];
    if (!entry) {
      return {
        total: 0,
        jpg: 0,
        raw: 0,
        byProject: new Set()
      };
    }
    const total = entry.total ?? 0;
    const set = total > 0 ? new Set([selectedProject.folder]) : new Set();
    return {
      total,
      jpg: entry.jpg ?? 0,
      raw: entry.raw ?? 0,
      byProject: set
    };
  }, [projectPendingDeletes, selectedProject?.folder]);

  const hasPendingDeletesAllSse = useMemo(() => {
    if (!pendingChangesSSE || typeof pendingChangesSSE !== 'object') return false;
    return Object.values(pendingChangesSSE).some(Boolean);
  }, [pendingChangesSSE]);

  const hasPendingDeletesProjectSse = useMemo(() => {
    if (!pendingChangesSSE || !selectedProject?.folder) return false;
    return pendingChangesSSE[selectedProject.folder] === true;
  }, [pendingChangesSSE, selectedProject?.folder]);

  const hasAggregatedAll = aggregateTotals.total > 0;
  const hasAggregatedProject = !!projectTotals && projectTotals.total > 0;

  const hasPendingDeletes = (view !== undefined)
    ? (isAllPhotosView ? (hasAggregatedAll || hasPendingDeletesAllSse) : (hasAggregatedProject || hasPendingDeletesProjectSse))
    : (isAllMode ? (hasAggregatedAll || hasPendingDeletesAllSse) : (hasAggregatedProject || hasPendingDeletesProjectSse));

  const pendingProjectsCount = useMemo(() => {
    if (isAllPhotosView) {
      if (aggregateTotals.byProject.size > 0) return aggregateTotals.byProject.size;
      if (!pendingChangesSSE || typeof pendingChangesSSE !== 'object') return 0;
      return Object.values(pendingChangesSSE).filter(Boolean).length;
    }
    if (projectTotals && projectTotals.byProject.size > 0) return projectTotals.byProject.size;
    if (pendingChangesSSE && selectedProject?.folder) {
      return pendingChangesSSE[selectedProject.folder] ? 1 : 0;
    }
    return 0;
  }, [aggregateTotals.byProject, isAllPhotosView, pendingChangesSSE, projectTotals, selectedProject?.folder]);

  if (IS_DEV) {
    console.log('[usePendingDeletes]', {
      isAllPhotosView,
      selectedProject: selectedProject?.folder,
      hasPendingDeletes,
      pendingProjectsCount,
      aggregateTotals,
      projectTotals
    });
  }

  const pendingDeleteTotals = isAllPhotosView ? aggregateTotals : (projectTotals || {
    total: 0,
    jpg: 0,
    raw: 0,
    byProject: new Set()
  });

  return {
    hasPendingDeletes,
    pendingProjectsCount,
    pendingDeleteTotals
  };
}
