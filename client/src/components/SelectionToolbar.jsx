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

    // Determine current state for UI logic (Select All vs Deselect All)
    let currentSelectedCount = 0;
    let isAllSelectedInContext = false; // Refers to whether all *currently filtered/visible* items are selected

    if (isAllMode) {
      const totalFiltered = allTotal || 0;
      currentSelectedCount = allSelectedKeys instanceof Set ? allSelectedKeys.size : 0;
      isAllSelectedInContext = totalFiltered > 0 && currentSelectedCount === totalFiltered;
    } else {
      // Project mode
      const folder = projectFolder || (Array.isArray(filteredProjectPhotos) && filteredProjectPhotos.length > 0 ? filteredProjectPhotos[0].project_folder : null);
      const total = typeof projectTotal === 'number' ? projectTotal : (Array.isArray(filteredProjectPhotos) ? filteredProjectPhotos.length : 0);

      if (folder) {
        if (selectedPhotos instanceof Set) {
          for (const key of selectedPhotos) {
            if (key.startsWith(folder + '::')) {
              currentSelectedCount++;
            }
          }
        }
        // Heuristic: if we have selected all known photos (total), or if we have selected all visible photos
        // Ideally we want to know if currentSelectedCount === total
        if (total > 0) {
          isAllSelectedInContext = currentSelectedCount >= total;
        } else {
          // Fallback to visible check if total is 0 (shouldn't happen if disabled correctly)
          const photosInCurrentView = Array.isArray(filteredProjectPhotos) ? filteredProjectPhotos : [];
          isAllSelectedInContext = photosInCurrentView.length > 0 && currentSelectedCount >= photosInCurrentView.length;
        }
      }
    }

    if (isAllSelectedInContext || currentSelectedCount > 0) {
      // Deselect All
      if (isAllMode) {
        onAllClearSelection();
      } else {
        // Project mode deselect
        const folder = projectFolder || (Array.isArray(filteredProjectPhotos) && filteredProjectPhotos.length > 0 ? filteredProjectPhotos[0].project_folder : null);

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

      // Add project_folder filter if in project mode
      if (!isAllMode) {
        const folder = projectFolder || (Array.isArray(filteredProjectPhotos) && filteredProjectPhotos.length > 0 ? filteredProjectPhotos[0].project_folder : null);
        if (folder) {
          filters.project_folder = folder;
        }
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
      if (isAllMode && photoObjects.length > 1000) {
        const confirmed = window.confirm(
          `This will select ${photoObjects.length.toLocaleString()} photos matching your current filters. Continue?`
        );
        if (!confirmed) {
          setIsLoading(false);
          return;
        }
      }

      console.log('[SelectionToolbar] Calling selection handler with count:', photoObjects.length);

      if (isAllMode) {
        onAllSelectAll(photoObjects);
      } else {
        if (onSelectBatch) {
          onSelectBatch(photoObjects);
        }
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
    let label = 'Select All';
    let countLabel = '';
    let isDisabled = false;

    if (isAllMode) {
      const selectedCount = allSelectedKeys instanceof Set ? allSelectedKeys.size : 0;
      const totalFiltered = allTotal || 0;
      const allSelected = totalFiltered > 0 && selectedCount === totalFiltered;

      label = isLoading ? 'Selecting...' : (allSelected || selectedCount > 0) ? 'Deselect All' : 'Select All';
      countLabel = isLoading ? `Selecting ${totalFiltered.toLocaleString()} photos...` : `${selectedCount} selected`;
      isDisabled = isLoading || totalFiltered === 0;
    } else {
      // Project mode
      const folder = projectFolder || (Array.isArray(filteredProjectPhotos) && filteredProjectPhotos.length > 0 ? filteredProjectPhotos[0].project_folder : null);
      const total = typeof projectTotal === 'number' ? projectTotal : (Array.isArray(filteredProjectPhotos) ? filteredProjectPhotos.length : 0);

      let currentSelectedCount = 0;
      if (folder && selectedPhotos instanceof Set) {
        for (const key of selectedPhotos) {
          if (key.startsWith(folder + '::')) {
            currentSelectedCount++;
          }
        }
      }

      // For project mode, if any photos from this project are selected, show "Deselect All"
      label = isLoading ? 'Selecting...' : (currentSelectedCount > 0) ? 'Deselect All' : 'Select All';
      countLabel = `${currentSelectedCount} selected`;
      isDisabled = isLoading || total === 0;
    }

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
