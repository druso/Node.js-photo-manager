import React, { forwardRef } from 'react';

const CommitRevertBar = forwardRef(({ 
  pendingDeleteTotals, 
  activeFilters, 
  onFilterChange, 
  onRevert, 
  onCommit 
}, ref) => {
  const pendingProjectsCount = pendingDeleteTotals.byProject ? pendingDeleteTotals.byProject.size : 0;

  return (
    <div ref={ref} className="fixed bottom-0 inset-x-0 z-30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-3 rounded-lg shadow-lg border bg-white">
          <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-3 text-sm" aria-live="polite">
              <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800">
                Pending deletions: {pendingDeleteTotals.total}
              </span>
              <span className="text-xs text-gray-600">
                JPG: {pendingDeleteTotals.jpg} · RAW: {pendingDeleteTotals.raw}
              </span>
              {pendingProjectsCount > 1 && (
                <span className="text-xs text-gray-600">Projects: {pendingProjectsCount}</span>
              )}
            </div>
            <div className="w-full grid grid-cols-3 gap-2 sm:w-auto sm:flex sm:items-center">
              {/* Preview Mode toggle switch - syncs with keepType any_kept */}
              <div className="w-full flex items-center gap-2">
                <span className="text-sm text-gray-700 select-none">Preview Mode</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={activeFilters.keepType === 'any_kept'}
                  onClick={() => onFilterChange(prev => ({ 
                    ...prev, 
                    keepType: (prev.keepType === 'any_kept' ? 'any' : 'any_kept') 
                  }))}
                  className={`${
                    activeFilters.keepType === 'any_kept' ? 'bg-blue-600' : 'bg-gray-200'
                  } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                  title="Toggle preview of photos that will be kept (JPG-only or RAW+JPG)"
                >
                  <span
                    aria-hidden="true"
                    className={`${
                      activeFilters.keepType === 'any_kept' ? 'translate-x-5' : 'translate-x-0'
                    } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                  />
                </button>
              </div>
              <button
                onClick={onRevert}
                className="w-full px-3 py-2 rounded-md border text-sm bg-white text-gray-700 hover:bg-gray-50 border-gray-300 whitespace-nowrap"
                title="Revert keep flags to match actual file availability"
                aria-label="Revert changes to match file availability"
              >
                Revert Changes
              </button>
              <button
                onClick={onCommit}
                className="w-full px-3 py-2 rounded-md text-sm bg-red-600 text-white hover:bg-red-700"
                title="Move unkept available files to .trash"
                aria-label={`Commit ${pendingDeleteTotals.total} pending deletions`}
              >
                Commit ({pendingDeleteTotals.total})
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

CommitRevertBar.displayName = 'CommitRevertBar';

export default CommitRevertBar;
