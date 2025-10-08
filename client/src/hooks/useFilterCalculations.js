import { useMemo } from 'react';

/**
 * Hook to calculate active filter count and status
 * Extracts filter calculation logic from App.jsx
 */
export function useFilterCalculations(activeFilters) {
  // Active filter count for badge
  const activeFilterCount = useMemo(() => (
    (activeFilters.textSearch ? 1 : 0) +
    (activeFilters.dateRange?.start ? 1 : 0) +
    (activeFilters.dateRange?.end ? 1 : 0) +
    (activeFilters.fileType && activeFilters.fileType !== 'any' ? 1 : 0) +
    (activeFilters.keepType && activeFilters.keepType !== 'any' ? 1 : 0) +
    (activeFilters.orientation && activeFilters.orientation !== 'any' ? 1 : 0) +
    (activeFilters.visibility && activeFilters.visibility !== 'any' ? 1 : 0)
  ), [activeFilters]);

  const hasActiveFilters = useMemo(() => !!(
    (activeFilters.textSearch && activeFilters.textSearch.trim()) ||
    activeFilters.dateRange?.start ||
    activeFilters.dateRange?.end ||
    (activeFilters.fileType && activeFilters.fileType !== 'any') ||
    (activeFilters.keepType && activeFilters.keepType !== 'any') ||
    (activeFilters.orientation && activeFilters.orientation !== 'any') ||
    (activeFilters.visibility && activeFilters.visibility !== 'any')
  ), [activeFilters]);

  return {
    activeFilterCount,
    hasActiveFilters
  };
}
