import React, { useEffect, useState } from 'react';
import Settings from './Settings';
import ProcessesPanel from './ProcessesPanel';

export default function SettingsProcessesModal({
  project,
  projectFolder,
  config,
  onConfigUpdate,
  onProjectDelete,
  onOpenCreateProject,
  initialTab = 'settings', // 'settings' | 'processes'
  onClose,
}) {
  const [tab, setTab] = useState(initialTab);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      {/* Fixed Close at top-right matching hamburger position and size */}
      <button
        onClick={onClose}
        aria-label="Close options"
        title="Close options"
        className="fixed top-4 right-4 sm:right-6 lg:right-8 inline-flex items-center justify-center rounded-md border shadow-sm px-3 py-2 text-sm font-medium bg-white text-gray-700 hover:bg-gray-50 border-gray-300 z-[60]"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      {/* Backdrop */}
      <div className="flex-1 bg-black/40 animate-fadeIn" />
      {/* Right-docked drawer */}
      <aside
        className="ml-auto h-screen w-full md:w-[480px] lg:w-[560px] xl:w-[640px] bg-white shadow-xl border-l flex flex-col animate-slideInRightFade"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with tabs and Close */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-3">
            <button
              className={`px-3 py-1.5 rounded text-sm ${tab==='settings' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-800'}`}
              onClick={() => setTab('settings')}
            >
              Settings
            </button>
            <button
              className={`px-3 py-1.5 rounded text-sm ${tab==='processes' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-800'}`}
              onClick={() => setTab('processes')}
            >
              Processes
            </button>
          </div>
          <div aria-hidden="true"></div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {tab === 'settings' ? (
            <div className="p-4">
              <Settings
                project={project}
                config={config}
                onConfigUpdate={onConfigUpdate}
                onProjectDelete={onProjectDelete}
                onClose={onClose}
                onOpenCreateProject={onOpenCreateProject}
                embedded
              />
            </div>
          ) : (
            <div className="p-4">
              <ProcessesPanel projectFolder={projectFolder} embedded />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
