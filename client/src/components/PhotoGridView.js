import React, { useState, useEffect } from 'react';
import Thumbnail from './Thumbnail';

const PhotoGridView = ({ projectData, projectFolder, onPhotoSelect, selectedPhotos, onToggleSelection, lazyLoadThreshold = 100 }) => {
  const [visibleCount, setVisibleCount] = useState(lazyLoadThreshold);

  useEffect(() => {
    setVisibleCount(lazyLoadThreshold);
  }, [projectData, lazyLoadThreshold]);

  const handleScroll = (e) => {
    const bottom = e.target.scrollHeight - e.target.scrollTop === e.target.clientHeight;
    if (bottom) {
      setVisibleCount(prevCount => Math.min(prevCount + lazyLoadThreshold, projectData.photos.length));
    }
  };

  if (!projectData || !projectData.photos || projectData.photos.length === 0) {
    return <p className="text-center text-gray-500 py-8">No photos in this project yet.</p>;
  }

  return (
    <div 
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-4"
      onScroll={handleScroll}
    >
      {projectData.photos.slice(0, visibleCount).map((photo) => {
        const isSelected = selectedPhotos?.has(photo.filename);
        return (
        <div 
          key={`${photo.id}-${photo.filename}`}
          className={`relative bg-gray-200 rounded-lg overflow-hidden cursor-pointer group aspect-square border-4 ${isSelected ? 'border-blue-500' : 'border-transparent'} transition-all`}
          onClick={() => onToggleSelection(photo)}
        >
          <Thumbnail
            photo={photo}
            projectFolder={projectFolder}
            className="w-full h-full group-hover:opacity-75 transition-all duration-300"
            rounded={false}
          />
          <div className="absolute inset-0 bg-black bg-opacity-40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity p-2">
            <button 
              onClick={(e) => {
                e.stopPropagation(); // Prevent the div's onClick from firing
                onPhotoSelect(photo);
              }}
              className="mb-2 px-4 py-2 text-sm font-medium text-white bg-gray-800 bg-opacity-75 rounded-lg hover:bg-opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white"
            >
              View
            </button>
            <p className="text-white text-xs text-center truncate w-full">{photo.filename}</p>
          </div>
        </div>
      )})}
    </div>
  );
};

export default PhotoGridView;
