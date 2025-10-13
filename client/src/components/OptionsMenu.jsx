import React, { useEffect, useRef, useState } from 'react';
// NOTE: This is the Options/Hamburger menu for global options like Settings, Create Project, and Processes.

export default function OptionsMenu({
  onOpenSettings,
  onOpenCreateProject,
  onOpenProcesses,
  onOpenSharedLinks,
  disabled = false,
  trigger = 'hamburger', // 'hamburger' | 'gear'
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    const handleDocClick = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, []);

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button
        type="button"
        disabled={disabled}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen(prev => !prev); }}
        className={`inline-flex justify-center items-center rounded-md border shadow-sm px-3 py-2 text-sm font-medium ${
          disabled ? 'bg-gray-200 text-gray-500 border-gray-300 cursor-not-allowed' : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300'
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Options"
      >
        {trigger === 'gear' ? (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path d="M11.983 1.907a1 1 0 00-1.966 0l-.088.528a7.968 7.968 0 00-1.638.948l-.5-.29a1 1 0 00-1.366.366l-.982 1.7a1 1 0 00.366 1.366l.5.289a8.06 8.06 0 000 1.897l-.5.289a1 1 0 00-.366 1.366l.982 1.7a1 1 0 001.366.366l.5-.289c.5.395 1.053.72 1.638.949l.088.527a1 1 0 001.966 0l.088-.528a7.968 7.968 0 001.638-.948l.5.29a1 1 0 001.366-.366l.982-1.7a1 1 0 00-.366-1.366l-.5-.289a8.06 8.06 0 000-1.897l.5-.289a1 1 0 00.366-1.366l-.982-1.7a1 1 0 00-1.366-.366l-.5.289a7.968 7.968 0 00-1.638-.949l-.088-.527zM10 12a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      {open && (
        <div
          className="origin-top-right absolute right-0 mt-2 w-64 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 p-2 z-50"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          role="menu"
        >
          <div className="py-1" role="none">
            <button
              onClick={() => { onOpenSettings && onOpenSettings(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
              role="menuitem"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M11.983 1.907a1 1 0 00-1.966 0l-.088.528a7.968 7.968 0 00-1.638.948l-.5-.29a1 1 0 00-1.366.366l-.982 1.7a1 1 0 00.366 1.366l.5.289a8.06 8.06 0 000 1.897l-.5.289a1 1 0 00-.366 1.366l.982 1.7a1 1 0 001.366.366l.5-.289c.5.395 1.053.72 1.638.949l.088.527a1 1 0 001.966 0l.088-.528a7.968 7.968 0 001.638-.948l.5.29a1 1 0 001.366-.366l.982-1.7a1 1 0 00-.366-1.366l-.5-.289a8.06 8.06 0 000-1.897l.5-.289a1 1 0 00.366-1.366l-.982-1.7a1 1 0 00-1.366-.366l-.5.289a7.968 7.968 0 00-1.638-.949l-.088-.527zM10 12a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
              <span>Settings</span>
            </button>
            {onOpenCreateProject && (
              <button
                onClick={() => { onOpenCreateProject && onOpenCreateProject(); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
                role="menuitem"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                <span>Create project</span>
              </button>
            )}
            {onOpenProcesses && (
              <button
                onClick={() => { onOpenProcesses && onOpenProcesses(); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
                role="menuitem"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M3 3h14v2H3V3zm0 6h14v2H3V9zm0 6h14v2H3v-2z" />
                </svg>
                <span>Processes</span>
              </button>
            )}
            {onOpenSharedLinks && (
              <button
                onClick={() => { onOpenSharedLinks && onOpenSharedLinks(); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
                role="menuitem"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
                </svg>
                <span>Shared Links</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
