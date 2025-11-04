import React, { useMemo, useState } from 'react';
import { listAllPhotoKeys } from '../api/allPhotosApi';

function SelectionToolbar({
  isAllMode,
  allPhotos,
  allSelectedKeys,
  onAllSelectAll,
  onAllClearSelection,
  filteredProjectPhotos,
  selectedPhotos,
  onProjectToggleSelect,
  activeFilters,
  allTotal,
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const allModeMarkup = useMemo(() => {
    if (!isAllMode) return null;
    const visibleCount = Array.isArray(allPhotos) ? allPhotos.length : 0;
    const selectedCount = allSelectedKeys instanceof Set ? allSelectedKeys.size : 0;
    const totalFiltered = allTotal || 0;
    const allSelected = totalFiltered > 0 && selectedCount === totalFiltered;

    const handleToggle = async () => {
      if (isLoading) return;
      
      if (allSelected || selectedCount > 0) {
        // Clear selection
        onAllClearSelection();
        setError(null);
        return;
      }

      // Select all filtered photos
      try {
        // Show confirmation for large selections
        if (totalFiltered > 1000) {
          const confirmed = window.confirm(
            `This will select ${totalFiltered.toLocaleString()} photos matching your current filters. Continue?`
          );
          if (!confirmed) return;
        }

        setIsLoading(true);
        setError(null);

        // Fetch all photo keys matching current filters
        const result = await listAllPhotoKeys({
          date_from: activeFilters?.dateRange?.start,
          date_to: activeFilters?.dateRange?.end,
          file_type: activeFilters?.fileType,
          keep_type: activeFilters?.keepType,
          orientation: activeFilters?.orientation,
          tags: activeFilters?.tags,
          visibility: activeFilters?.visibility,
          public_link_id: activeFilters?.publicLinkId,
        });

        // Convert keys to minimal photo objects
        const photoObjects = result.keys.map(key => {
          const [project_folder, filename] = key.split('::');
          return { project_folder, filename };
        });

        onAllSelectAll(photoObjects);
      } catch (err) {
        console.error('Failed to select all photos:', err);
        setError(err.message || 'Failed to select all photos');
      } finally {
        setIsLoading(false);
      }
    };

    return (
      <>
        <button
          onClick={handleToggle}
          disabled={isLoading || totalFiltered === 0}
          className="text-sm text-blue-600 hover:underline disabled:text-gray-400 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Selecting...' : (allSelected || selectedCount > 0) ? 'Deselect All' : 'Select All'}
        </button>
        <span className="text-sm text-gray-600">
          {isLoading ? `Selecting ${totalFiltered.toLocaleString()} photos...` : `${selectedCount} selected`}
        </span>
        {error && (
          <span className="text-sm text-red-600" title={error}>
            ⚠️ Error
          </span>
        )}
      </>
    );
  }, [isAllMode, allPhotos, allSelectedKeys, onAllClearSelection, onAllSelectAll, activeFilters, allTotal, isLoading, error]);

  const projectModeMarkup = useMemo(() => {
    if (isAllMode) return null;
    const photos = Array.isArray(filteredProjectPhotos) ? filteredProjectPhotos : [];
    const total = photos.length;
    const selectedCount = selectedPhotos instanceof Set ? selectedPhotos.size : 0;
    const allSelected = total > 0 && selectedCount === total;

    const handleToggle = () => {
      if (!total) return;
      if (allSelected) {
        onProjectToggleSelect(new Set());
      } else {
        onProjectToggleSelect(new Set(photos.map(p => p.filename)));
      }
    };

    return (
      <>
        <button
          onClick={handleToggle}
          className="text-sm text-blue-600 hover:underline"
        >
          {allSelected ? 'Deselect All' : 'Select All'}
        </button>
        <span className="text-sm text-gray-600">{selectedCount} selected</span>
      </>
    );
  }, [isAllMode, filteredProjectPhotos, selectedPhotos, onProjectToggleSelect]);

  return (
    <div className="flex items-center gap-3">
      {allModeMarkup || projectModeMarkup}
    </div>
  );
}

export default SelectionToolbar;
