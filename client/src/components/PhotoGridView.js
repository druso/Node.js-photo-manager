import React, { useState, useEffect } from 'react';

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
        const isRawFile = /\.(arw|cr2|nef|dng|raw)$/i.test(photo.filename);
        
        // Check if thumbnail is available (avoid 404 errors)
        const hasThumbnail = photo.thumbnail_status === 'generated';
        const thumbnailPending = photo.thumbnail_status === 'pending';
        const thumbnailFailed = photo.thumbnail_status === 'failed';
        
        return (
        <div 
          key={`${photo.id}-${photo.filename}`}
          className={`relative bg-gray-200 rounded-lg overflow-hidden cursor-pointer group aspect-square border-4 ${isSelected ? 'border-blue-500' : 'border-transparent'} transition-all`}
          onClick={() => onToggleSelection(photo)}
        >
          {isRawFile || !hasThumbnail ? (
            // RAW file or missing thumbnail placeholder
            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-300 text-gray-600">
              <svg className="w-12 h-12 mb-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
              </svg>
              {isRawFile ? (
                <>
                  <span className="text-xs font-medium">RAW</span>
                  <span className="text-xs opacity-75">{photo.filename.split('.').pop().toUpperCase()}</span>
                </>
              ) : thumbnailPending ? (
                <>
                  <span className="text-xs font-medium">PROCESSING</span>
                  <span className="text-xs opacity-75">Thumbnail...</span>
                </>
              ) : thumbnailFailed ? (
                <>
                  <span className="text-xs font-medium">NO PREVIEW</span>
                  <span className="text-xs opacity-75">Failed</span>
                </>
              ) : (
                <>
                  <span className="text-xs font-medium">NO PREVIEW</span>
                  <span className="text-xs opacity-75">Available</span>
                </>
              )}
            </div>
          ) : (
            // Regular image thumbnail (only load if thumbnail exists)
            <img 
              src={`/api/projects/${projectFolder}/thumbnail/${photo.filename}`}
              alt={photo.filename}
              className="w-full h-full object-cover group-hover:opacity-75 transition-all duration-300"
              loading="lazy"
            />
          )}
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
