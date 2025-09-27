import React, { useMemo } from 'react';

function AllPhotosControls({ viewMode, onViewModeChange }) {
  const viewButtons = useMemo(() => (
    <div className="flex space-x-2">
      <button
        onClick={() => onViewModeChange('grid')}
        className={`px-2.5 py-1.5 rounded-md ${viewMode === 'grid' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}
        title="Gallery view"
        aria-label="Gallery view"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M3 3h6v6H3V3zm8 0h6v6H11V3zM3 11h6v6H3v-6zm8 6h6v-6H11v6z" />
        </svg>
      </button>
      <button
        onClick={() => onViewModeChange('table')}
        className={`px-2.5 py-1.5 rounded-md ${viewMode === 'table' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}
        title="Details view"
        aria-label="Details view"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M3 5h14v2H3V5zm0 4h14v2H3V9zm0 4h14v2H3v-2z" />
        </svg>
      </button>
    </div>
  ), [viewMode, onViewModeChange]);

  return (
    <div className="flex items-center gap-2 transition-all duration-150 ease-out transform opacity-100 scale-100 animate-fadeInScale">
      {viewButtons}
    </div>
  );
}

export default AllPhotosControls;
