import React, { useEffect, useMemo, useState } from 'react';
import { listProjects, createProject } from '../api/projectsApi';
import { startTask } from '../api/jobsApi';
import { useToast } from '../ui/toast/ToastContext';

export default function MovePhotosModal({
  open,
  onClose,
  sourceFolder,
  selectedFilenames,
  selectedProjectSummaries = [],
}) {
  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState(null);
  const [loading, setLoading] = useState(false);
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
      } catch (_) {}
    })();
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelection(null);
      setCreating(false);
      setLoading(false);
      return;
    }
    setSelection(null);
    setQuery('');
  }, [open]);

  const exclusionSet = useMemo(() => {
    const set = new Set();
    if (sourceFolder) set.add(sourceFolder);
    (selectedProjectSummaries || []).forEach(info => {
      if (info?.folder) set.add(info.folder);
    });
    return set;
  }, [sourceFolder, selectedProjectSummaries]);

  const normalizedQuery = query.trim().toLowerCase();

  const availableProjects = useMemo(() => {
    const pool = Array.isArray(projects) ? projects.filter(p => !exclusionSet.has(p.folder)) : [];
    if (!normalizedQuery) {
      return pool.slice(0, 20);
    }
    return pool
      .filter(project => {
        const name = (project.name || '').toLowerCase();
        const folder = (project.folder || '').toLowerCase();
        return name.includes(normalizedQuery) || folder.includes(normalizedQuery);
      })
      .slice(0, 20);
  }, [projects, exclusionSet, normalizedQuery]);

  const exactMatch = useMemo(() => {
    if (!normalizedQuery) return null;
    return (Array.isArray(projects) ? projects : []).find(project => {
      if (exclusionSet.has(project.folder)) return false;
      const name = (project.name || '').toLowerCase();
      const folder = (project.folder || '').toLowerCase();
      return normalizedQuery === name || normalizedQuery === folder;
    }) || null;
  }, [projects, normalizedQuery, exclusionSet]);

  const projectNameMap = useMemo(() => {
    const map = new Map();
    (projects || []).forEach(project => {
      map.set(project.folder, project.name || project.folder);
    });
    return map;
  }, [projects]);

  const selectedProjectsLabel = useMemo(() => {
    if (!Array.isArray(selectedProjectSummaries) || selectedProjectSummaries.length === 0) return '';
    return selectedProjectSummaries
      .map(({ folder, count }) => {
        if (!folder) return null;
        const displayName = projectNameMap.get(folder) || folder;
        const countValue = typeof count === 'number' ? count : 0;
        return `${displayName} (${countValue})`;
      })
      .filter(Boolean)
      .join(', ');
  }, [selectedProjectSummaries, projectNameMap]);

  const hasSelection = selection != null;
  const confirmLabel = hasSelection || exactMatch ? (loading ? 'Moving…' : 'Confirm') : (creating ? 'Creating…' : 'Create project');
  const confirmDisabled = loading || creating || (!hasSelection && !exactMatch && !query.trim()) || ((selectedFilenames?.length || 0) === 0);

  const handleSuggestionClick = (project) => {
    setSelection(project);
    setQuery(project.name || project.folder || '');
  };

  const handleClearSelection = () => {
    setSelection(null);
    setQuery('');
  };

  const performMove = async (folder) => {
    if (!folder) return;
    setLoading(true);
    try {
      await startTask(folder, { task_type: 'image_move', items: selectedFilenames });
      toast.show({ emoji: '📦', message: `Moving ${selectedFilenames.length} photo(s) → ${folder}`, variant: 'notification' });
      onClose && onClose({ moved: true, destFolder: folder });
    } catch (e) {
      toast.show({ emoji: '⚠️', message: 'Failed to start move', variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if ((selectedFilenames?.length || 0) === 0 || confirmDisabled) return;
    if (selection) {
      await performMove(selection.folder);
      return;
    }
    if (exactMatch) {
      setSelection(exactMatch);
      await performMove(exactMatch.folder);
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const res = await createProject(trimmed);
      const proj = res && res.project;
      if (!proj || !proj.folder) throw new Error('Invalid create response');
      setProjects(prev => {
        const next = Array.isArray(prev) ? [...prev] : [];
        next.push({ name: proj.name, folder: proj.folder, created_at: proj.created_at, updated_at: proj.updated_at, photo_count: proj.photo_count ?? 0 });
        return next;
      });
      setSelection(proj);
      setQuery(proj.name || proj.folder || '');
      await performMove(proj.folder);
    } catch (e) {
      toast.show({ emoji: '⚠️', message: `Failed to create project${e?.message ? `: ${e.message}` : ''}`, variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => onClose && onClose({ canceled: true })} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="p-5 space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Move photos</h3>
            <p className="text-sm text-gray-700">
              Select a destination project. {selectedFilenames?.length || 0} selected
              {selectedProjectsLabel ? ` from projects: ${selectedProjectsLabel}` : '.'}
            </p>
          </div>

          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelection(null);
              }}
              placeholder="Type to search or create"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading || creating}
              autoFocus
            />
            {selection && (
              <button
                type="button"
                onClick={handleClearSelection}
                className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600"
                aria-label="Clear selection"
                disabled={loading || creating}
              >
                ×
              </button>
            )}
          </div>

          {selection && (
            <div className="border border-blue-200 bg-blue-50 rounded-md px-3 py-2 text-sm">
              <div className="font-medium text-blue-800">{selection.name || selection.folder}</div>
              <div className="text-xs text-blue-700">{selection.folder}</div>
            </div>
          )}

          {!selection && (
            <div className="border border-gray-200 rounded-md max-h-48 overflow-y-auto divide-y">
              {availableProjects.length > 0 ? (
                availableProjects.map(project => (
                  <button
                    type="button"
                    key={project.folder}
                    onClick={() => handleSuggestionClick(project)}
                    className="w-full px-3 py-2 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    disabled={loading || creating}
                  >
                    <div className="text-sm font-medium text-gray-900">{project.name || project.folder}</div>
                    <div className="text-xs text-gray-500">{project.folder}</div>
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-sm text-gray-500">
                  {query.trim().length === 0 ? 'Start typing to see suggestions.' : `No projects found. Press Confirm to create “${query.trim()}”.`}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => onClose && onClose({ canceled: true })}
              className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
              disabled={loading || creating}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={confirmDisabled}
              className={`px-4 py-2 rounded-md ${confirmDisabled ? 'bg-blue-300 text-white cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
