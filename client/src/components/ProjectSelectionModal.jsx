import React, { useMemo, useState, useEffect } from 'react';

const ProjectSelectionModal = ({
  isOpen,
  projects,
  initialProject,
  onSelect,
  onCancel,
}) => {
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState(initialProject || null);

  useEffect(() => {
    if (isOpen) {
      setSelection(initialProject || null);
      setQuery(initialProject ? initialProject.name || initialProject.folder || '' : '');
    } else {
      setSelection(null);
      setQuery('');
    }
  }, [initialProject, isOpen]);

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!Array.isArray(projects)) return [];
    if (!normalizedQuery) return projects.slice(0, 20);
    return projects
      .filter(project => {
        const name = (project.name || '').toLowerCase();
        const folder = (project.folder || '').toLowerCase();
        return name.includes(normalizedQuery) || folder.includes(normalizedQuery);
      })
      .slice(0, 20);
  }, [projects, normalizedQuery]);

  const exactMatch = useMemo(() => {
    if (!normalizedQuery) return null;
    return (projects || []).find(project => {
      const name = (project.name || '').toLowerCase();
      const folder = (project.folder || '').toLowerCase();
      return normalizedQuery === name || normalizedQuery === folder;
    }) || null;
  }, [projects, normalizedQuery]);

  const handleConfirm = () => {
    if (selection) {
      onSelect && onSelect(selection, { mode: 'existing' });
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) return;
    onSelect && onSelect({ name: trimmed, folder: trimmed }, { mode: 'create' });
  };

  const handleClearSelection = () => {
    setSelection(null);
    setQuery('');
  };

  const handleSuggestionClick = (project) => {
    setSelection(project);
    setQuery(project.name || project.folder || '');
  };

  const confirmLabel = selection ? 'Confirm' : (exactMatch ? 'Confirm' : 'Create project');
  const confirmDisabled = !selection && !query.trim();

  const renderNoResults = !selection && filtered.length === 0 && query.trim().length > 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="p-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Select target project</h3>
            <p className="text-sm text-gray-600 mt-1">
              Start typing a project name or ID to find an existing one or create a new project.
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
              autoFocus
            />
            {selection && (
              <button
                type="button"
                onClick={handleClearSelection}
                className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600"
                aria-label="Clear selection"
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
              {filtered.map(project => (
                <button
                  type="button"
                  key={project.folder}
                  onClick={() => handleSuggestionClick(project)}
                  className="w-full px-3 py-2 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <div className="text-sm font-medium text-gray-900">{project.name}</div>
                  <div className="text-xs text-gray-500">{project.folder}</div>
                </button>
              ))}
              {renderNoResults && (
                <div className="px-3 py-2 text-sm text-gray-500">No projects found. Press Enter to create “{query.trim()}”.</div>
              )}
              {!renderNoResults && filtered.length === 0 && (
                <div className="px-3 py-2 text-sm text-gray-500">Start typing to see suggestions.</div>
              )}
            </div>
          )}

          <div className="flex justify-between items-center pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirmDisabled}
              className={`px-4 py-2 rounded-md text-white ${confirmDisabled ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectSelectionModal;
