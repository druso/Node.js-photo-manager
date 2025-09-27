import { useCallback } from 'react';
import { listAllPendingDeletes } from '../api/allPhotosApi';

/**
 * Hook to handle refreshing All Photos data
 * Extracts refreshAllPhotos function from App.jsx
 */
export function useAllPhotosRefresh({
  isAllMode,
  loadAllInitial,
  activeFilters,
  setAllPendingDeletes
}) {
  const refreshAllPhotos = useCallback(async () => {
    if (!isAllMode) return;
    try {
      await loadAllInitial();
      // Also refresh pending deletions count
      const range = activeFilters?.dateRange || {};
      const result = await listAllPendingDeletes({
        date_from: range.start || undefined,
        date_to: range.end || undefined,
        file_type: activeFilters?.fileType,
        orientation: activeFilters?.orientation,
      });
      setAllPendingDeletes({
        jpg: result.jpg || 0,
        raw: result.raw || 0,
        total: result.total || 0,
        byProject: new Set(result.byProject || []),
      });
    } catch {
      // best effort
    }
  }, [isAllMode, loadAllInitial, activeFilters?.dateRange, activeFilters?.fileType, activeFilters?.orientation, setAllPendingDeletes]);

  return { refreshAllPhotos };
}
