import React from 'react';
import PhotoDisplay from './PhotoDisplay';

function AllPhotosPane({
  viewMode,
  sortKey,
  sortDir,
  sizeLevel,
  onSortChange,
  photos,
  hasMore,
  onLoadMore,
  hasPrev,
  onLoadPrev,
  anchorIndex,
  onAnchored,
  lazyLoadThreshold,
  dwellMs,
  onPhotoSelect,
  onToggleSelection,
  selectedPhotos,
  onEnterSelectionMode,
}) {
  return (
    <PhotoDisplay
      viewMode={viewMode}
      projectData={null}
      projectFolder={undefined}
      onPhotoSelect={onPhotoSelect}
      onToggleSelection={onToggleSelection}
      onEnterSelectionMode={onEnterSelectionMode}
      selectedPhotos={selectedPhotos}
      lazyLoadThreshold={lazyLoadThreshold}
      dwellMs={dwellMs}
      sortKey={sortKey}
      sortDir={sortDir}
      onSortChange={onSortChange}
      sizeLevel={sizeLevel}
      photos={photos}
      hasMore={hasMore}
      onLoadMore={onLoadMore}
      hasPrev={hasPrev}
      onLoadPrev={onLoadPrev}
      anchorIndex={anchorIndex}
      onAnchored={onAnchored}
    />
  );
}

export default AllPhotosPane;
