import React from 'react';
import PhotoGridView from './PhotoGridView';
import PhotoTableView from './PhotoTableView';

const PhotoDisplay = ({ viewMode, projectFolder, onPhotoSelect, projectData, selectedPhotos, onToggleSelection, lazyLoadThreshold, sortKey, sortDir, onSortChange, sizeLevel, photos, hasMore, onLoadMore, dwellMs, simplifiedMode = false }) => {
  if (viewMode === 'grid') {
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
