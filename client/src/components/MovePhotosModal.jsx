import React, { useEffect, useMemo, useState } from 'react';
import { listProjects, createProject } from '../api/projectsApi';
import { startTask } from '../api/jobsApi';
import { useToast } from '../ui/toast/ToastContext';

export default function MovePhotosModal({
  open,
  onClose,
  sourceFolder,
  selectedFilenames,
}) {
  const [projects, setProjects] = useState([]);
  const [destFolder, setDestFolder] = useState('');
  const [loading, setLoading] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const list = await listProjects();
        if (!alive) return;
        setProjects(list || []);
        const firstOther = (list || []).find(p => p.folder !== sourceFolder);
        setDestFolder(firstOther ? firstOther.folder : '');
      } catch (_) {}
    })();
    return () => { alive = false; };
  }, [open, sourceFolder]);

  const otherProjects = useMemo(
    () => (projects || []).filter(p => p.folder !== sourceFolder),
    [projects, sourceFolder]
  );

  const canConfirm = open && !loading && !creating && destFolder && selectedFilenames && selectedFilenames.length > 0;

  const canCreate = creatingNew && !creating && (newProjectName?.trim().length > 0);

  const doCreateProject = async () => {
    if (!canCreate) return;
    setCreating(true);
    try {
      const res = await createProject(newProjectName.trim());
      const proj = res && res.project;
      if (!proj || !proj.folder) throw new Error('Invalid create response');
      // update local list and select it
      setProjects(prev => {
        const next = Array.isArray(prev) ? [...prev] : [];
        next.push({ name: proj.name, folder: proj.folder, created_at: proj.created_at, updated_at: proj.updated_at, photo_count: proj.photo_count ?? 0 });
        return next;
      });
      setDestFolder(proj.folder);
      setCreatingNew(false);
      setNewProjectName('');
      toast.show({ emoji: '🆕', message: `Project created: ${proj.name || proj.folder}`, variant: 'success' });
    } catch (e) {
      toast.show({ emoji: '⚠️', message: `Failed to create project${e?.message ? `: ${e.message}` : ''}` , variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const doMove = async () => {
    if (!canConfirm) return;
    setLoading(true);
    try {
      await startTask(destFolder, { task_type: 'image_move', items: selectedFilenames });
      toast.show({ emoji: '📦', message: `Moving ${selectedFilenames.length} photo(s) → ${destFolder}`, variant: 'notification' });
      onClose && onClose({ moved: true, destFolder });
    } catch (e) {
      toast.show({ emoji: '⚠️', message: 'Failed to start move', variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => onClose && onClose({ canceled: true })} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Move photos</h3>
          <p className="text-sm text-gray-700 mb-4">Select a destination project. {selectedFilenames?.length || 0} selected.</p>
          <label className="block text-sm text-gray-700 mb-4">
            Destination project
            {otherProjects.length > 0 && !creatingNew && (
              <select
                className="mt-1 block w-full border rounded-md p-2"
                value={destFolder}
                onChange={(e) => setDestFolder(e.target.value)}
              >
                {otherProjects.map(p => (
                  <option key={p.folder} value={p.folder}>{p.name || p.folder}</option>
                ))}
              </select>
            )}
            {(otherProjects.length === 0 || creatingNew) && (
              <div className="mt-1">
                <input
                  type="text"
                  className="block w-full border rounded-md p-2"
                  placeholder="New project name"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">We'll create a new project and move your photos there.</p>
              </div>
            )}
          </label>

          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              className="text-sm text-blue-700 hover:underline disabled:text-gray-400"
              onClick={() => {
                setCreatingNew(v => !v);
                setNewProjectName('');
              }}
              disabled={loading || creating}
            >
              {creatingNew || otherProjects.length === 0 ? 'Select existing instead' : 'Create new project…'}
            </button>
            {creatingNew || otherProjects.length === 0 ? (
              <button
                type="button"
                className={`text-sm px-3 py-1 rounded-md ${canCreate ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
                onClick={doCreateProject}
                disabled={!canCreate}
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={() => onClose && onClose({ canceled: true })}
              className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
              disabled={loading || creating}
            >
              Cancel
            </button>
            <button
              onClick={doMove}
              disabled={!canConfirm}
              className={`px-4 py-2 rounded-md ${canConfirm ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
            >
              Move
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
