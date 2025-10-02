import React from 'react';

/**
 * SelectionModeBanner - Mobile selection mode UI banner
 * 
 * Displays when user enters selection mode via long-press on mobile.
 * Shows selected count and provides exit button.
 * 
 * @param {number} selectedCount - Number of currently selected items
 * @param {Function} onExit - Callback to exit selection mode
 * @param {Function} onClearSelection - Optional callback to clear all selections
 */
const SelectionModeBanner = ({ selectedCount, onClearSelection }) => {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-blue-600 text-white shadow-lg">
      <div className="flex items-center justify-between px-4 py-3">
        {/* Left: Selected count */}
        <div className="flex flex-col">
          <span className="text-lg font-semibold">
            {selectedCount} {selectedCount === 1 ? 'item' : 'items'} selected
          </span>
          <span className="text-xs text-blue-100">
            Tap photos to select/deselect
          </span>
        </div>

        {/* Right: Clear selection button */}
        <button
          onClick={onClearSelection}
          className="px-4 py-2 text-sm font-medium rounded-md bg-blue-700 hover:bg-blue-800 active:bg-blue-900 transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  );
};

export default SelectionModeBanner;
