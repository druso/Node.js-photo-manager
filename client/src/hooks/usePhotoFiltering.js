import { useMemo, useCallback } from 'react';

/**
 * Hook for photo filtering and sorting logic
 * Extracts complex filtering and sorting logic from App.jsx
 */
export function usePhotoFiltering({ 
  activeFilters, 
  sortKey, 
  sortDir, 
  projectData, 
  pagedPhotos 
}) {
  // Filter helper used for both full project list (table) and paged list (grid)
  const filterPhotoPredicate = useCallback((photo, index = 0) => {
    // Text search filter
    if (activeFilters.textSearch) {
      const searchTerm = activeFilters.textSearch.toLowerCase();
      const matchesFilename = photo.filename?.toLowerCase().includes(searchTerm);
      const matchesTags = photo.tags?.some(tag => tag.toLowerCase().includes(searchTerm));
      const matchesMetadata = photo.metadata && Object.values(photo.metadata).some(value => 
        typeof value === 'string' && value.toLowerCase().includes(searchTerm)
      );
      
      if (!matchesFilename && !matchesTags && !matchesMetadata) { 
        return false; 
      }
    }
    
    // Date range filter (only uses date_time_original field)
    if (activeFilters.dateRange?.start || activeFilters.dateRange?.end) {
      const photoDate = photo.date_time_original;
      if (photoDate) {
        const date = new Date(photoDate).toISOString().split('T')[0];
        if (activeFilters.dateRange.start && date < activeFilters.dateRange.start) {
          return false;
        }
        if (activeFilters.dateRange.end && date > activeFilters.dateRange.end) {
          return false;
        }
      } else if (activeFilters.dateRange.start || activeFilters.dateRange.end) {
        // Photo has no date but filter requires one
        return false;
      }
    }
    
    // File type filter
    if (activeFilters.fileType && activeFilters.fileType !== 'any') {
      const hasJpg = photo.jpg_available;
      const hasRaw = photo.raw_available;
      
      if (activeFilters.fileType === 'jpg_only' && !hasJpg) return false;
      if (activeFilters.fileType === 'raw_only' && !hasRaw) return false;
      if (activeFilters.fileType === 'both' && (!hasJpg || !hasRaw)) return false;
    }
    
    // Orientation filter
    if (activeFilters.orientation && activeFilters.orientation !== 'any') {
      const width = photo.metadata?.width || photo.width || 0;
      const height = photo.metadata?.height || photo.height || 0;
      
      if (width > 0 && height > 0) {
        const ratio = width / height;
        const isLandscape = ratio > 1.1;
        const isPortrait = ratio < 0.9;
        const isSquare = !isLandscape && !isPortrait;
        
        if (activeFilters.orientation === 'landscape' && !isLandscape) return false;
        if (activeFilters.orientation === 'portrait' && !isPortrait) return false;
        if (activeFilters.orientation === 'square' && !isSquare) return false;
      }
    }
    
    // Keep type filter
    if (activeFilters.keepType && activeFilters.keepType !== 'any') {
      const keepJpg = photo.keep_jpg;
      const keepRaw = photo.keep_raw;
      
      if (activeFilters.keepType === 'none' && (keepJpg !== false || keepRaw !== false)) return false;
      if (activeFilters.keepType === 'jpg_only' && (keepJpg !== true || keepRaw !== false)) return false;
      if (activeFilters.keepType === 'raw_jpg' && (keepJpg !== true || keepRaw !== true)) return false;
    }

    // Visibility filter
    if (activeFilters.visibility && activeFilters.visibility !== 'any') {
      const visibility = (photo.visibility || 'private').toLowerCase();
      if (visibility !== activeFilters.visibility) return false;
    }
    
    return true;
  }, [activeFilters]);

  // Filter photos based on active filters (full list; used by table and legacy flows)
  const getFilteredPhotos = useCallback(() => {
    if (!projectData?.photos) return [];
    return projectData.photos.filter((p, i) => filterPhotoPredicate(p, i));
  }, [projectData?.photos, filterPhotoPredicate]);

  const filteredPhotos = useMemo(() => getFilteredPhotos(), [getFilteredPhotos]);

  // Sort comparison function
  const compareBySort = useCallback((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'name') {
      return a.filename.localeCompare(b.filename) * dir;
    }
    if (sortKey === 'date') {
      const aDate = a.date_time_original || a.date_created || '';
      const bDate = b.date_time_original || b.date_created || '';
      if (aDate && bDate) {
        return (new Date(aDate) - new Date(bDate)) * dir;
      }
      if (aDate && !bDate) return -1 * dir;
      if (!aDate && bDate) return 1 * dir;
      return 0;
    }
    if (sortKey === 'size') {
      const aSize = a.file_size || 0;
      const bSize = b.file_size || 0;
      return (aSize - bSize) * dir;
    }
    return 0;
  }, [sortKey, sortDir]);

  // Sort filtered photos (stable) with useMemo for performance
  const sortedPhotos = useMemo(() => {
    const arr = [...filteredPhotos];
    arr.sort(compareBySort);
    return arr;
  }, [filteredPhotos, compareBySort]);

  // Apply filters/sorting to the paginated list for grid view
  const filteredPagedPhotos = useMemo(() => {
    return (pagedPhotos || []).filter((p, i) => filterPhotoPredicate(p, i));
  }, [pagedPhotos, filterPhotoPredicate]);

  const sortedPagedPhotos = useMemo(() => {
    const arr = [...filteredPagedPhotos];
    arr.sort(compareBySort);
    return arr;
  }, [filteredPagedPhotos, compareBySort]);

  return {
    filterPhotoPredicate,
    getFilteredPhotos,
    filteredPhotos,
    sortedPhotos,
    filteredPagedPhotos,
    sortedPagedPhotos,
    compareBySort
  };
}
