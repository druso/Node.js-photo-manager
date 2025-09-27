import React, { useCallback, useMemo } from 'react';

function ViewModeControls({
  viewMode,
  onViewModeChange,
  sizeLevel,
  onSizeLevelChange,
  hasSelection,
  operationsMenu = null,
}) {
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

  const cycleSizeLevel = useCallback(() => {
    onSizeLevelChange((prev) => {
      if (prev === 's') return 'm';
      if (prev === 'm') return 'l';
      return 's';
    });
  }, [onSizeLevelChange]);

  return (
    <div className="flex items-center gap-3 transition-all duration-150 ease-out transform opacity-100 scale-100 animate-fadeInScale">
      {viewButtons}
      {hasSelection && operationsMenu ? (
        <div className="transition-all duration-150 ease-out transform opacity-100 scale-100 animate-fadeInScale">
          {operationsMenu}
        </div>
      ) : (
        <>
          <div className="ml-2 hidden md:inline-flex rounded-md overflow-hidden border">
            <button
              className={`px-2 py-1 text-sm ${sizeLevel === 's' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
              onClick={() => onSizeLevelChange('s')}
              title="Small previews"
              aria-label="Small previews"
            >
              S
            </button>
            <button
              className={`px-2 py-1 text-sm border-l ${sizeLevel === 'm' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
              onClick={() => onSizeLevelChange('m')}
              title="Medium previews"
              aria-label="Medium previews"
            >
              M
            </button>
            <button
              className={`px-2 py-1 text-sm border-l ${sizeLevel === 'l' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
              onClick={() => onSizeLevelChange('l')}
              title="Large previews"
              aria-label="Large previews"
            >
              L
            </button>
          </div>
          <button
            className="ml-2 md:hidden px-2.5 py-1 text-xs rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300"
            onClick={cycleSizeLevel}
            title="Change preview size"
            aria-label="Change preview size"
          >
            Size {sizeLevel.toUpperCase()}
          </button>
        </>
      )}
    </div>
  );
}

export default ViewModeControls;
