import React from 'react';
import PhotoGridView from './PhotoGridView';
import PhotoTableView from './PhotoTableView';

const PhotoDisplay = ({ viewMode, projectFolder, onPhotoSelect, projectData, selectedPhotos, onToggleSelection, lazyLoadThreshold, sortKey, sortDir, onSortChange, sizeLevel }) => {
  if (viewMode === 'grid') {
    return (
      <PhotoGridView 
        projectData={projectData}
        projectFolder={projectFolder}
        onPhotoSelect={onPhotoSelect}
        selectedPhotos={selectedPhotos}
        onToggleSelection={onToggleSelection}
        lazyLoadThreshold={lazyLoadThreshold}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortChange={onSortChange}
        sizeLevel={sizeLevel}
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
