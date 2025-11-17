import React from 'react';
import AllPhotosPane from './AllPhotosPane';
import PhotoDisplay from './PhotoDisplay';

const MainContentRenderer = ({
  // Mode and project state
  isAllMode,
  isSharedMode,
  selectedProject,
  projects,
  showEmptyDropHint = true,
  
  // View settings
  viewMode,
  sortKey,
  sortDir,
  sizeLevel,
  onSortChange,
  
  // All Photos props
  allPhotos,
  allNextCursor,
  allHasPrev,
  allGridAnchorIndex,
  loadAllMore,
  loadAllPrev,
  setAllGridAnchorIndex,
  handleAllPhotoSelect,
  handleToggleSelectionAll,
  allSelectedKeys,

  // Shared link props
  sharedPhotos,
  sharedTotal,
  sharedNextCursor,
  sharedPrevCursor,
  sharedLoadMore,
  sharedLoadPrev,
  sharedHasMore,
  sharedHasPrev,
  sharedLoading,

  // Project props
  filteredProjectData,
  sortedPagedPhotos,
  nextCursor,
  projectHasPrev,
  gridAnchorIndex,
  loadMore,
  loadPrev,
  handlePhotoSelect,
  handleToggleSelection,
  selectedPhotos,

  // Selection mode (M2)
  onEnterSelectionMode,

  // Config
  config = {},
}) => {
  // Shared mode takes precedence over all other modes
  if (isSharedMode) {
    console.log('[MainContentRenderer] Rendering shared mode:', {
      sharedPhotosLength: sharedPhotos?.length,
      sharedTotal,
      sharedLoading,
      sharedHasMore,
      sharedHasPrev,
    });
    
    return (
      <AllPhotosPane
        viewMode={viewMode}
        sortKey={sortKey}
        sortDir={sortDir}
        sizeLevel={sizeLevel}
        onSortChange={onSortChange}
        photos={sharedPhotos || []}
        hasMore={sharedHasMore}
        onLoadMore={sharedLoadMore}
        hasPrev={sharedHasPrev}
        onLoadPrev={sharedLoadPrev}
        anchorIndex={null}
        onAnchored={() => {}}
        lazyLoadThreshold={config?.photo_grid?.lazy_load_threshold ?? 100}
        dwellMs={config?.photo_grid?.dwell_ms ?? 300}
        eagerLoadBufferVh={config?.photo_grid?.eager_load_buffer_vh ?? 100}
        onPhotoSelect={handleAllPhotoSelect}
        onToggleSelection={handleToggleSelectionAll}
        selectedPhotos={allSelectedKeys}
        onEnterSelectionMode={onEnterSelectionMode}
        loading={sharedLoading}
        showEmptyDropHint={showEmptyDropHint}
      />
    );
  }

  if (isAllMode) {
    return (
      <AllPhotosPane
        viewMode={viewMode}
        sortKey={sortKey}
        sortDir={sortDir}
        sizeLevel={sizeLevel}
        onSortChange={onSortChange}
        photos={allPhotos}
        hasMore={!!allNextCursor}
        onLoadMore={loadAllMore}
        hasPrev={allHasPrev}
        onLoadPrev={loadAllPrev}
        anchorIndex={allGridAnchorIndex}
        onAnchored={() => setAllGridAnchorIndex(null)}
        lazyLoadThreshold={config?.photo_grid?.lazy_load_threshold ?? 100}
        dwellMs={config?.photo_grid?.dwell_ms ?? 300}
        eagerLoadBufferVh={config?.photo_grid?.eager_load_buffer_vh ?? 100}
        onPhotoSelect={handleAllPhotoSelect}
        onToggleSelection={handleToggleSelectionAll}
        selectedPhotos={allSelectedKeys}
        onEnterSelectionMode={onEnterSelectionMode}
        showEmptyDropHint={showEmptyDropHint}
      />
    );
  }

  if (selectedProject) {
    return (
      <PhotoDisplay
        viewMode={viewMode}
        projectData={filteredProjectData}
        projectFolder={selectedProject?.folder}
        onPhotoSelect={(photo) => handlePhotoSelect(photo, sortedPagedPhotos)}
        onToggleSelection={handleToggleSelection}
        onEnterSelectionMode={onEnterSelectionMode}
        selectedPhotos={selectedPhotos}
        lazyLoadThreshold={config?.photo_grid?.lazy_load_threshold ?? 100}
        dwellMs={config?.photo_grid?.dwell_ms ?? 300}
        eagerLoadBufferVh={config?.photo_grid?.eager_load_buffer_vh ?? 100}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortChange={onSortChange}
        sizeLevel={sizeLevel}
        photos={sortedPagedPhotos}
        hasMore={!!nextCursor}
        onLoadMore={loadMore}
        hasPrev={projectHasPrev}
        onLoadPrev={loadPrev}
        anchorIndex={gridAnchorIndex}
        onAnchored={() => setGridAnchorIndex(null)}
        showEmptyDropHint={showEmptyDropHint}
      />
    );
  }

  if (projects.length > 0) {
    return (
      <div className="mt-10 text-center text-gray-600">
        Select a project from the dropdown to begin.
      </div>
    );
  }

  return null;
};

export default MainContentRenderer;
