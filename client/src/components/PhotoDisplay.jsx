import React from 'react';
import PhotoGridView from './PhotoGridView';
import PhotoTableView from './PhotoTableView';

const PhotoDisplay = ({ viewMode, projectFolder, onPhotoSelect, projectData, selectedPhotos, onToggleSelection, lazyLoadThreshold }) => {
  if (viewMode === 'grid') {
    return (
      <PhotoGridView 
        projectData={projectData}
        projectFolder={projectFolder}
        onPhotoSelect={onPhotoSelect}
        selectedPhotos={selectedPhotos}
        onToggleSelection={onToggleSelection}
        lazyLoadThreshold={lazyLoadThreshold}
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
      />
    );
  }
};

export default PhotoDisplay;
