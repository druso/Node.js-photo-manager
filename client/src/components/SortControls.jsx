import React from 'react';

const SortControls = ({ sortKey, sortDir, onSortChange, className = "" }) => {
  return (
    <div className={`flex items-center gap-2 mb-2 px-1 ${className}`}>
      <span className="text-xs text-gray-500 mr-2">Sort:</span>
      <button
        onClick={() => onSortChange('date')}
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
        onClick={() => onSortChange('name')}
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
