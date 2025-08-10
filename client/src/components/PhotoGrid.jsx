// DEPRECATED COMPONENT
// This legacy component previously relied on projectData.entries and old thumbnail endpoints.
// It has been replaced by PhotoGridView which uses the standardized `projectData.photos`
// and status-aware thumbnail handling. We keep this file as a thin wrapper to avoid
// breaking any existing imports while ensuring consistent behavior.

import React from 'react';
import PhotoGridView from './PhotoGridView';

const PhotoGrid = ({ projectData, projectFolder, onPhotoSelect, selectedPhotos, onToggleSelection, lazyLoadThreshold }) => {
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
};

export default PhotoGrid;
