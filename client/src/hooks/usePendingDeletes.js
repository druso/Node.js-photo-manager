import { useMemo } from 'react';

/**
 * Hook to calculate pending deletes for project mode
 * Extracts pending deletes calculation logic from App.jsx
 */
export function usePendingDeletes({
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

  const pendingDeleteTotals = isAllMode ? pendingDeletesAll : pendingDeletesProject;
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
