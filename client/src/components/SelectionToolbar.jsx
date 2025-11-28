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
  onSelectBatch,
  onDeselectBatch,
  activeFilters,
  allTotal,
  projectTotal,
  projectFolder,
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Unified selection logic
  const handleToggle = async () => {
    if (isLoading) return;

    // Determine context
    const folder = projectFolder || (Array.isArray(filteredProjectPhotos) && filteredProjectPhotos.length > 0 ? filteredProjectPhotos[0].project_folder : null);
    const isProjectContext = !!folder && !isAllMode;

    // Determine total count for context
    const total = isProjectContext
      ? (typeof projectTotal === 'number' ? projectTotal : (Array.isArray(filteredProjectPhotos) ? filteredProjectPhotos.length : 0))
      : (allTotal || 0);

    // Determine currently selected count in context
    let currentSelectedCount = 0;
    if (isProjectContext) {
      if (selectedPhotos instanceof Set) {
        for (const key of selectedPhotos) {
          if (key.startsWith(folder + '::')) {
            currentSelectedCount++;
          }
        }
      }
    } else {
      currentSelectedCount = allSelectedKeys instanceof Set ? allSelectedKeys.size : 0;
    }

    // Determine if "All Selected"
    let isAllSelectedInContext = false;
    if (total > 0) {
      isAllSelectedInContext = currentSelectedCount >= total;
    } else if (isProjectContext) {
      // Fallback for project mode if total is 0
      const photosInCurrentView = Array.isArray(filteredProjectPhotos) ? filteredProjectPhotos : [];
      isAllSelectedInContext = photosInCurrentView.length > 0 && currentSelectedCount >= photosInCurrentView.length;
    }

    if (isAllSelectedInContext || currentSelectedCount > 0) {
      // Deselect All
      if (isProjectContext) {
        if (onDeselectBatch && folder) {
          const keysToRemove = [];
          if (selectedPhotos instanceof Set) {
            for (const key of selectedPhotos) {
              if (key.startsWith(folder + '::')) {
                keysToRemove.push(key);
              }
            }
          }
          onDeselectBatch(keysToRemove);
        }
      } else {
        onAllClearSelection();
      }
      setError(null);
      return;
    }

    // Select All
    try {
      setIsLoading(true);
      setError(null);

      const filters = {
        date_from: activeFilters?.dateRange?.start,
        date_to: activeFilters?.dateRange?.end,
        file_type: activeFilters?.fileType,
        keep_type: activeFilters?.keepType,
        orientation: activeFilters?.orientation,
        tags: activeFilters?.tags,
        visibility: activeFilters?.visibility,
        public_link_id: activeFilters?.publicLinkId,
      };

      if (isProjectContext) {
        filters.project_folder = folder;
      }

      console.log('[SelectionToolbar] Fetching all keys with filters:', filters);
      const result = await listAllPhotoKeys(filters);
      console.log('[SelectionToolbar] listAllPhotoKeys result:', result);

      const buildPhotoFromKey = (key) => {
        if (typeof key !== 'string') return null;
        const [project_folder, filename] = key.split('::');
        if (!project_folder || !filename) return null;
        return { project_folder, filename };
      };

      let photoObjects = Array.isArray(result?.items) && result.items.length
        ? result.items.map(item => ({
          id: item.id,
          project_id: item.project_id,
          project_folder: item.project_folder,
          project_name: item.project_name,
          filename: item.filename,
          keep_jpg: item.keep_jpg,
          keep_raw: item.keep_raw,
          visibility: item.visibility,
          jpg_available: item.jpg_available,
          raw_available: item.raw_available,
          file_size: item.file_size,
          taken_at: item.taken_at,
        })).filter(Boolean)
        : null;

      if (!photoObjects || photoObjects.length === 0) {
        console.log('[SelectionToolbar] No items found, falling back to keys');
        photoObjects = Array.isArray(result?.keys)
          ? result.keys.map(buildPhotoFromKey).filter(Boolean)
          : [];
      }

      // Show confirmation for large selections only if in All Mode and selecting
      if (!isProjectContext && photoObjects.length > 1000) {
        const confirmed = window.confirm(
          `This will select ${photoObjects.length.toLocaleString()} photos matching your current filters. Continue?`
        );
        if (!confirmed) {
          setIsLoading(false);
          return;
        }
      }

      console.log('[SelectionToolbar] Calling selection handler with count:', photoObjects.length);

      if (isProjectContext) {
        if (onSelectBatch) {
          onSelectBatch(photoObjects);
        }
      } else {
        onAllSelectAll(photoObjects);
      }
    } catch (err) {
      console.error('Failed to select all photos:', err);
      setError(err.message || 'Failed to select all photos');
    } finally {
      setIsLoading(false);
    }
  };

  // Render logic
  const renderContent = () => {
    // Determine context
    const folder = projectFolder || (Array.isArray(filteredProjectPhotos) && filteredProjectPhotos.length > 0 ? filteredProjectPhotos[0].project_folder : null);
    const isProjectContext = !!folder && !isAllMode;

    // Determine total count for context
    const total = isProjectContext
      ? (typeof projectTotal === 'number' ? projectTotal : (Array.isArray(filteredProjectPhotos) ? filteredProjectPhotos.length : 0))
      : (allTotal || 0);

    // Determine currently selected count in context
    let currentSelectedCount = 0;
    if (isProjectContext) {
      if (selectedPhotos instanceof Set) {
        for (const key of selectedPhotos) {
          if (key.startsWith(folder + '::')) {
            currentSelectedCount++;
          }
        }
      }
    } else {
      currentSelectedCount = allSelectedKeys instanceof Set ? allSelectedKeys.size : 0;
    }

    let label = isLoading ? 'Selecting...' : (currentSelectedCount > 0) ? 'Deselect All' : 'Select All';
    let countLabel = isLoading ? `Selecting ${total.toLocaleString()} photos...` : `${currentSelectedCount} selected`;
    let isDisabled = isLoading || total === 0;

    return (
      <>
        <button
          onClick={handleToggle}
          disabled={isDisabled}
          className="text-sm text-blue-600 hover:underline disabled:text-gray-400 disabled:cursor-not-allowed"
        >
          {label}
        </button>
        <span className="text-sm text-gray-600">
          {countLabel}
        </span>
        {error && (
          <span className="text-sm text-red-600" title={error}>
            ⚠️ Error
          </span>
        )}
      </>
    );
  };

  return (
    <div className="flex items-center gap-3">
      {renderContent()}
    </div>
  );
}

export default SelectionToolbar;
