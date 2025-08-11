import React, { useState, useEffect } from 'react';
import Thumbnail from './Thumbnail';

const PhotoGridView = ({ projectData, projectFolder, onPhotoSelect, selectedPhotos, onToggleSelection, lazyLoadThreshold = 100, sizeLevel = 's' }) => {
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

  // Grid sizing using explicit cell size with 1:2:3 ratio
  const sizeToCellPx = {
    s: 96,   // 1x
    m: 192,  // 2x
    l: 288,  // 3x
  };
  const cellPx = sizeToCellPx[sizeLevel] ?? sizeToCellPx.s;
  const gapClass = sizeLevel === 's' ? 'gap-px' : 'gap-1';
  const borderClass = 'border';

  return (
    <div 
      className={`grid ${gapClass} p-1`}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cellPx}px, 1fr))` }}
      onScroll={handleScroll}
    >
      {projectData.photos.slice(0, visibleCount).map((photo) => {
        const isSelected = selectedPhotos?.has(photo.filename);
        return (
        <div 
          key={`${photo.id}-${photo.filename}`}
          className={`relative bg-gray-200 rounded-none overflow-hidden cursor-pointer group aspect-square ${borderClass} ${isSelected ? 'border-2 border-blue-600 ring-2 ring-blue-400' : 'border-transparent'} transition-all`}
          onClick={() => onToggleSelection(photo)}
        >
          <Thumbnail
            photo={photo}
            projectFolder={projectFolder}
            className="w-full h-full group-hover:opacity-75 transition-all duration-300"
            rounded={false}
          />
          {isSelected && (
            <div className="absolute inset-0 bg-blue-500 bg-opacity-25 pointer-events-none"></div>
          )}
          <div className="absolute inset-0 bg-black bg-opacity-40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity p-1">
            <button 
              onClick={(e) => {
                e.stopPropagation(); // Prevent the div's onClick from firing
                onPhotoSelect(photo);
              }}
              className="mb-1 px-3 py-1.5 text-sm font-medium text-white bg-gray-800 bg-opacity-75 rounded-none hover:bg-opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white"
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
