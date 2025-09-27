import React, { useMemo } from 'react';

function SelectionToolbar({
  isAllMode,
  allPhotos,
  allSelectedKeys,
  onAllSelectAll,
  onAllClearSelection,
  filteredProjectPhotos,
  selectedPhotos,
  onProjectToggleSelect,
}) {
  const allModeMarkup = useMemo(() => {
    if (!isAllMode) return null;
    const total = Array.isArray(allPhotos) ? allPhotos.length : 0;
    const selectedCount = allSelectedKeys instanceof Set ? allSelectedKeys.size : 0;
    const allSelected = total > 0 && selectedCount === total;

    const handleToggle = () => {
      if (!total) return;
      if (allSelected) {
        onAllClearSelection();
      } else {
        onAllSelectAll(allPhotos);
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
  }, [isAllMode, allPhotos, allSelectedKeys, onAllClearSelection, onAllSelectAll]);

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
