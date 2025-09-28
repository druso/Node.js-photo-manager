import React from 'react';

/**
 * ARCHITECTURAL DECISION: Unified View Context
 * 
 * There is NO conceptual distinction between "All Photos" and "Project" views.
 * A Project view is simply the All Photos view with a project filter applied.
 * 
 * This component uses the same sort controls for both views, with the viewType
 * parameter used for analytics or view-specific behavior if needed.
 */
const SortControls = ({ sortKey, sortDir, onSortChange, viewType = 'all', className = "" }) => {
  // Debug logging
  const handleSortChange = (key) => {
    console.log(`[UNIFIED] Sort changed in ${viewType} view:`, key);
    onSortChange(key);
  };
  return (
    <div className={`flex items-center gap-2 mb-2 px-1 ${className}`}>
      <span className="text-xs text-gray-500 mr-2">Sort:</span>
      <button
        onClick={() => handleSortChange('date')}
        className={`text-sm px-2 py-1 rounded ${
          sortKey === 'date' 
            ? 'font-semibold bg-gray-100' 
            : 'text-gray-700 hover:bg-gray-100'
        }`}
        title="Sort by date"
      >
        Date {sortKey === 'date' && (sortDir === 'asc' ? '▲' : '▼')}
      </button>
      <button
        onClick={() => handleSortChange('name')}
        className={`text-sm px-2 py-1 rounded ${
          sortKey === 'name' 
            ? 'font-semibold bg-gray-100' 
            : 'text-gray-700 hover:bg-gray-100'
        }`}
        title="Sort by name"
      >
        Name {sortKey === 'name' && (sortDir === 'asc' ? '▲' : '▼')}
      </button>
    </div>
  );
};

export default SortControls;
