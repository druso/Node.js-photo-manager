import { useState } from 'react';

/**
 * Filters and sorting state management hook
 * Extracts filtering, sorting, and related state from App.jsx
 */
export function useFiltersAndSort() {
  // Active filters state
  const [activeFilters, setActiveFilters] = useState({
    textSearch: '',
    dateRange: { start: '', end: '' }, // Only date_time_original field is used
    fileType: 'any', // any | jpg_only | raw_only | both
    orientation: 'any', // any | landscape | portrait | square
    keepType: 'any' // any | none | jpg_only | raw_jpg
  });

  // Sorting state: key: 'date' | 'name' | other (for table)
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc' (date newest first by default)

  // Helper function to check if any filters are active
  const hasActiveFilters = () => {
    return (
      activeFilters.textSearch ||
      activeFilters.dateRange.start ||
      activeFilters.dateRange.end ||
      (activeFilters.fileType && activeFilters.fileType !== 'any') ||
      (activeFilters.orientation && activeFilters.orientation !== 'any') ||
      (activeFilters.keepType && activeFilters.keepType !== 'any')
    );
  };

  // Helper function to reset all filters
  const resetFilters = () => {
    setActiveFilters({
      textSearch: '',
      dateRange: { start: '', end: '' },
      fileType: 'any',
      orientation: 'any',
      keepType: 'any'
    });
  };

  // Helper function to update a specific filter
  const updateFilter = (filterKey, value) => {
    setActiveFilters(prev => ({
      ...prev,
      [filterKey]: value
    }));
  };

  // Helper function to update date range filter
  const updateDateRange = (start, end) => {
    setActiveFilters(prev => ({
      ...prev,
      dateRange: { start, end }
    }));
  };

  // Toggle sort function
  const toggleSort = (key) => {
    if (sortKey === key) {
      // Flip direction when clicking the active sort
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      // Change key and set default direction
      setSortKey(key);
      setSortDir(key === 'date' ? 'desc' : 'asc');
    }
  };

  return {
    // Filter state
    activeFilters,
    setActiveFilters,
    
    // Sort state
    sortKey,
    setSortKey,
    sortDir,
    setSortDir,
    
    // Helper functions
    hasActiveFilters,
    resetFilters,
    updateFilter,
    updateDateRange,
    toggleSort,
  };
}
