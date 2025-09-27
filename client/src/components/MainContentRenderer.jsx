import React from 'react';
import AllPhotosPane from './AllPhotosPane';
import PhotoDisplay from './PhotoDisplay';

const MainContentRenderer = ({
  // Mode and project state
  isAllMode,
  selectedProject,
  projects,
  
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
  
  // Project props
  filteredProjectData,
  sortedPagedPhotos,
  nextCursor,
  projectHasPrev,
  gridAnchorIndex,
  loadMore,
  loadPrev,
  setGridAnchorIndex,
  handlePhotoSelect,
  handleToggleSelection,
  selectedPhotos,
  
  // Config
  config
}) => {
  if (isAllMode) {
    return (
      <>
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
          onPhotoSelect={handleAllPhotoSelect}
          onToggleSelection={handleToggleSelectionAll}
          selectedPhotos={allSelectedKeys}
        />
      </>
    );
  }

  if (selectedProject) {
    return (
      <>
        <PhotoDisplay
          viewMode={viewMode}
          projectData={filteredProjectData}
          projectFolder={selectedProject?.folder}
          onPhotoSelect={(photo) => handlePhotoSelect(photo, sortedPagedPhotos)}
          onToggleSelection={handleToggleSelection}
          selectedPhotos={selectedPhotos}
          lazyLoadThreshold={config?.photo_grid?.lazy_load_threshold ?? 100}
          dwellMs={config?.photo_grid?.dwell_ms ?? 300}
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
        />
      </>
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
