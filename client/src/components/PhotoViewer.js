import React, { useState, useEffect, useCallback } from 'react';

const PhotoViewer = ({ projectData, projectFolder, startIndex, onClose, config }) => {
  // All hooks are called at the top level, unconditionally.
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const photos = projectData?.photos || [];
  


  const nextPhoto = useCallback(() => {
    if (photos.length === 0) return;
    setCurrentIndex(prevIndex => (prevIndex + 1) % photos.length);
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, [photos.length]);

  const prevPhoto = useCallback(() => {
    if (photos.length === 0) return;
    setCurrentIndex(prevIndex => (prevIndex - 1 + photos.length) % photos.length);
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, [photos.length]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === (config?.keyboard_shortcuts?.next_photo || 'ArrowRight')) nextPhoto();
      else if (e.key === (config?.keyboard_shortcuts?.prev_photo || 'ArrowLeft')) prevPhoto();
      else if (e.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextPhoto, prevPhoto, onClose, config]);
  
  useEffect(() => {
    // Reset index if startIndex changes
    setCurrentIndex(startIndex);
  }, [startIndex]);

  // This effect handles closing the viewer if the data becomes invalid
  useEffect(() => {
    if (startIndex === -1 || !photos[currentIndex]) {
      onClose();
    }
  }, [photos, currentIndex, startIndex, onClose]);

  const handleWheel = (e) => {
    e.preventDefault();
    const newZoom = zoom - e.deltaY * 0.01;
    setZoom(Math.min(Math.max(0.5, newZoom), 5));
  };

  // Conditional rendering is handled here, after all hooks are called.
  if (startIndex === -1) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
        <div className="text-white text-lg">Error: Photo not found in project.</div>
        <button onClick={onClose} className="absolute top-4 right-4 text-white text-3xl">&times;</button>
      </div>
    );
  }

  const currentPhoto = photos[currentIndex];

  if (!currentPhoto) {
    // This can happen briefly if data is changing. The useEffect above will handle closing.
    return null;
  }

  const isRawFile = /\.(arw|cr2|nef|dng|raw)$/i.test(currentPhoto.filename);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center" onWheel={handleWheel}>
      <button onClick={onClose} className="absolute top-4 right-4 text-white text-4xl z-50">&times;</button>
      <button onClick={prevPhoto} className="absolute left-4 top-1/2 -translate-y-1/2 text-white text-4xl z-50 bg-black bg-opacity-30 p-2 rounded-full">&#10094;</button>
      <button onClick={nextPhoto} className="absolute right-4 top-1/2 -translate-y-1/2 text-white text-4xl z-50 bg-black bg-opacity-30 p-2 rounded-full">&#10095;</button>
      <div className="w-full h-full flex items-center justify-center overflow-hidden">
        {isRawFile ? (
          // RAW file placeholder
          <div className="flex flex-col items-center justify-center text-white">
            <svg className="w-32 h-32 mb-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
            </svg>
            <h3 className="text-2xl font-bold mb-2">RAW File</h3>
            <p className="text-lg opacity-75 mb-4">{currentPhoto.filename.split('.').pop().toUpperCase()} Format</p>
            <p className="text-sm opacity-50 text-center max-w-md">
              This is a RAW camera file. Preview is not available.<br/>
              Use your preferred RAW editor to view and process this image.
            </p>
          </div>
        ) : (
          // Regular image
          <>
            <img 
              src={`/api/projects/${projectFolder}/image/${currentPhoto.filename}`}
              alt={currentPhoto.filename}
              className="max-w-full max-h-full transition-transform duration-200"
              style={{ transform: `scale(${zoom}) translate(${position.x}px, ${position.y}px)` }}
              onError={(e) => {
                // Fallback if image fails to load
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'flex';
              }}
            />
            <div className="flex flex-col items-center justify-center text-white" style={{display: 'none'}}>
              <svg className="w-32 h-32 mb-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
              </svg>
              <h3 className="text-2xl font-bold mb-2">Image Not Available</h3>
              <p className="text-sm opacity-50 text-center max-w-md">
                Unable to load this image file.
              </p>
            </div>
          </>
        )}
      </div>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white bg-black bg-opacity-50 px-4 py-2 rounded-md">
        {currentPhoto.filename}
      </div>
    </div>
  );
};

export default PhotoViewer;
