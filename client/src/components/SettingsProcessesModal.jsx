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
      {/* Backdrop */}
      <div className="flex-1 bg-black/40" />
      {/* Right-docked drawer */}
      <aside
        className="ml-auto h-screen w-full md:w-[480px] lg:w-[560px] xl:w-[640px] bg-white shadow-xl border-l flex flex-col"
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
          <button className="text-gray-600 hover:text-black" onClick={onClose} aria-label="Close">&times;</button>
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
