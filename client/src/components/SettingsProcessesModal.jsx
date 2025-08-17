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
  onProjectRenamed,
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
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40 animate-fadeIn" onClick={onClose} />
      {/* Right-docked drawer */}
      <aside
        className="ml-auto h-screen w-full md:w-[480px] lg:w-[560px] xl:w-[640px] bg-white shadow-xl border-l flex flex-col animate-slideInRightFade"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with tabs, New, and Close aligned in one row */}
        <div className="flex items-center px-4 py-3 border-b">
          <div className="flex items-center gap-2">
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
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 text-sm"
              onClick={() => onOpenCreateProject?.()}
              title="Create new project"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New
            </button>
            <button
              onClick={onClose}
              aria-label="Close options"
              title="Close options"
              className="inline-flex items-center justify-center rounded-md border shadow-sm px-3 py-1.5 text-sm font-medium bg-white text-gray-700 hover:bg-gray-50 border-gray-300"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
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
                onProjectRenamed={onProjectRenamed}
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
