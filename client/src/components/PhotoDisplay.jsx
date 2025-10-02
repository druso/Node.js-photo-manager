import React from 'react';
import VirtualizedPhotoGrid from './VirtualizedPhotoGrid';
import PhotoTableView from './PhotoTableView';

/**
 * PhotoDisplay - Main photo display component
 * 
 * NOTE: This component previously supported both VirtualizedPhotoGrid and PhotoGridView.
 * PhotoGridView.jsx has been REMOVED as virtualization is now the only grid implementation.
 * All grid-related changes should be made to VirtualizedPhotoGrid.jsx.
 */
const PhotoDisplay = ({ viewMode, projectFolder, onPhotoSelect, projectData, selectedPhotos, onToggleSelection, onEnterSelectionMode, lazyLoadThreshold, sortKey, sortDir, onSortChange, sizeLevel, photos, hasMore, onLoadMore, dwellMs, simplifiedMode = false, anchorIndex = null, onAnchored, hasPrev = false, onLoadPrev }) => {
  if (viewMode === 'grid') {
    return (
      <VirtualizedPhotoGrid
        projectData={projectData}
        projectFolder={projectFolder}
        onPhotoSelect={onPhotoSelect}
        selectedPhotos={selectedPhotos}
        onToggleSelection={onToggleSelection}
        onEnterSelectionMode={onEnterSelectionMode}
        lazyLoadThreshold={lazyLoadThreshold}
        dwellMs={dwellMs}
        sizeLevel={sizeLevel}
        photos={photos}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        hasPrev={hasPrev}
        onLoadPrev={onLoadPrev}
        simplifiedMode={simplifiedMode}
        anchorIndex={anchorIndex}
        onAnchored={onAnchored}
      />
    );
  } else {
    return (
      <PhotoTableView 
        projectData={projectData}
        projectFolder={projectFolder}
        onPhotoSelect={onPhotoSelect}
        selectedPhotos={selectedPhotos}
        onToggleSelection={onToggleSelection}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortChange={onSortChange}
        sizeLevel={sizeLevel}
      />
    );
  }
};

export default PhotoDisplay;
