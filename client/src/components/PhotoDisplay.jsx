import React from 'react';
import PhotoGridView from './PhotoGridView';
import VirtualizedPhotoGrid from './VirtualizedPhotoGrid';
import PhotoTableView from './PhotoTableView';

const ENABLE_VIRTUALIZATION = true; // Feature flag: toggle to roll out/rollback virtualization

const PhotoDisplay = ({ viewMode, projectFolder, onPhotoSelect, projectData, selectedPhotos, onToggleSelection, lazyLoadThreshold, sortKey, sortDir, onSortChange, sizeLevel, photos, hasMore, onLoadMore, dwellMs, simplifiedMode = false, anchorIndex = null, onAnchored, hasPrev = false, onLoadPrev }) => {
  if (viewMode === 'grid') {
    if (ENABLE_VIRTUALIZATION) {
      return (
        <VirtualizedPhotoGrid
          projectData={projectData}
          projectFolder={projectFolder}
          onPhotoSelect={onPhotoSelect}
          selectedPhotos={selectedPhotos}
          onToggleSelection={onToggleSelection}
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
    }
    return (
      <PhotoGridView 
        projectData={projectData}
        projectFolder={projectFolder}
        onPhotoSelect={onPhotoSelect}
        selectedPhotos={selectedPhotos}
        onToggleSelection={onToggleSelection}
        lazyLoadThreshold={lazyLoadThreshold}
        dwellMs={dwellMs}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortChange={onSortChange}
        sizeLevel={sizeLevel}
        photos={photos}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        simplifiedMode={simplifiedMode}
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
