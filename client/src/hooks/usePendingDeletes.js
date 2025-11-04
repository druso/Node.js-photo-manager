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

  const sseData = useMemo(() => {
    if (!pendingChangesSSE || typeof pendingChangesSSE !== 'object') return null;
    const totals = pendingChangesSSE.totals;
    const projects = Array.isArray(pendingChangesSSE.projects) ? pendingChangesSSE.projects : null;
    const hasStructuredPayload = (totals && typeof totals === 'object') || projects;
    if (!hasStructuredPayload) return null;

    const normalizedTotals = {
      total: Number(totals?.total) || 0,
      jpg: Number(totals?.jpg) || 0,
      raw: Number(totals?.raw) || 0,
    };

    const projectTotals = {};
    const activeFolders = [];

    if (projects) {
      for (const entry of projects) {
        if (!entry || typeof entry.project_folder !== 'string') continue;
        const total = Number(entry.pending_total) || 0;
        const pendingJpg = Number(entry.pending_jpg) || 0;
        const pendingRaw = Number(entry.pending_raw) || 0;
        projectTotals[entry.project_folder] = {
          total,
          jpg: pendingJpg,
          raw: pendingRaw,
        };
        if (total > 0) {
          activeFolders.push(entry.project_folder);
        }
      }
    }

    return {
      totals: normalizedTotals,
      projectTotals,
      activeFolders,
    };
  }, [pendingChangesSSE]);

  const legacyFlags = useMemo(() => {
    if (!pendingChangesSSE || typeof pendingChangesSSE !== 'object') return null;
    if (sseData) return null;
    return pendingChangesSSE;
  }, [pendingChangesSSE, sseData]);

  const aggregateTotals = useMemo(() => {
    // Prioritize allPendingDeletes (can be force-reset) over SSE
    const source = allPendingDeletes || {};
    const hasExplicitData = source.total !== undefined || source.jpg !== undefined || source.raw !== undefined;
    
    if (hasExplicitData) {
      const set = source.byProject instanceof Set
        ? new Set(source.byProject)
        : new Set(Array.isArray(source.byProject) ? source.byProject : []);
      return {
        total: source.total ?? 0,
        jpg: source.jpg ?? 0,
        raw: source.raw ?? 0,
        byProject: set
      };
    }

    // Fall back to SSE data if allPendingDeletes is not set
    if (sseData) {
      return {
        total: sseData.totals.total,
        jpg: sseData.totals.jpg,
        raw: sseData.totals.raw,
        byProject: new Set(sseData.activeFolders),
      };
    }

    // Default to zero
    return {
      total: 0,
      jpg: 0,
      raw: 0,
      byProject: new Set()
    };
  }, [allPendingDeletes, sseData]);

  const projectTotals = useMemo(() => {
    if (sseData && selectedProject?.folder) {
      const entry = sseData.projectTotals[selectedProject.folder];
      if (!entry) {
        return {
          total: 0,
          jpg: 0,
          raw: 0,
          byProject: new Set(),
        };
      }
      return {
        total: entry.total,
        jpg: entry.jpg,
        raw: entry.raw,
        byProject: entry.total > 0 ? new Set([selectedProject.folder]) : new Set(),
      };
    }

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
  }, [sseData, projectPendingDeletes, selectedProject?.folder]);

  const hasPendingDeletesAllSse = useMemo(() => {
    if (sseData) {
      return sseData.totals.total > 0 || sseData.activeFolders.length > 0;
    }
    if (legacyFlags) {
      return Object.values(legacyFlags).some(Boolean);
    }
    return false;
  }, [sseData, legacyFlags]);

  const hasPendingDeletesProjectSse = useMemo(() => {
    if (!selectedProject?.folder) return false;
    if (sseData) {
      const entry = sseData.projectTotals[selectedProject.folder];
      return !!entry && entry.total > 0;
    }
    if (legacyFlags) {
      return legacyFlags[selectedProject.folder] === true;
    }
    return false;
  }, [sseData, legacyFlags, selectedProject?.folder]);

  const hasAggregatedAll = aggregateTotals.total > 0;
  const hasAggregatedProject = !!projectTotals && projectTotals.total > 0;

  // Prioritize aggregated totals (which can be force-reset) over SSE
  // Only fall back to SSE if aggregated totals are not available
  const hasPendingDeletes = (view !== undefined)
    ? (isAllPhotosView 
        ? (hasAggregatedAll || (aggregateTotals.total === 0 && aggregateTotals.byProject.size === 0 ? false : hasPendingDeletesAllSse))
        : (hasAggregatedProject || (projectTotals && projectTotals.total === 0 && projectTotals.byProject.size === 0 ? false : hasPendingDeletesProjectSse)))
    : (isAllMode 
        ? (hasAggregatedAll || (aggregateTotals.total === 0 && aggregateTotals.byProject.size === 0 ? false : hasPendingDeletesAllSse))
        : (hasAggregatedProject || (projectTotals && projectTotals.total === 0 && projectTotals.byProject.size === 0 ? false : hasPendingDeletesProjectSse)));

  const pendingProjectsCount = useMemo(() => {
    if (isAllPhotosView) {
      if (aggregateTotals.byProject.size > 0) return aggregateTotals.byProject.size;
      if (legacyFlags) {
        return Object.values(legacyFlags).filter(Boolean).length;
      }
      return 0;
    }
    if (projectTotals && projectTotals.byProject.size > 0) return projectTotals.byProject.size;
    if (legacyFlags && selectedProject?.folder) {
      return legacyFlags[selectedProject.folder] ? 1 : 0;
    }
    return 0;
  }, [aggregateTotals.byProject, isAllPhotosView, legacyFlags, projectTotals, selectedProject?.folder]);

  if (IS_DEV) {
    console.log('[usePendingDeletes]', {
      isAllPhotosView,
      selectedProject: selectedProject?.folder,
      hasPendingDeletes,
      pendingProjectsCount,
      aggregateTotals,
      projectTotals,
      sse: sseData,
      legacyFlags
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
