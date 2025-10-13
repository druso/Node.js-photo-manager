import React, { useState, useEffect } from 'react';
import { deleteProject, renameProjectById } from '../api/projectsApi';
import { useUpload } from '../upload/UploadContext';
import { authFetch } from '../api/httpClient';

const Settings = ({ project, config, onConfigUpdate, onProjectDelete, onProjectRenamed, onClose, onOpenCreateProject, embedded = false }) => {
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [localConfig, setLocalConfig] = useState(null);
  const [openSection, setOpenSection] = useState('manage'); // only one open at a time
  const [regenLoading, setRegenLoading] = useState(false);
  const [renameValue, setRenameValue] = useState(project?.name || '');
  const [renaming, setRenaming] = useState(false);
  const { actions: uploadActions } = useUpload();

  useEffect(() => {
    // Deep copy config to local state to avoid direct mutation
    if (config) {
      const copy = JSON.parse(JSON.stringify(config));
      // Ensure ui exists with defaults when missing
      copy.ui = copy.ui || { default_view_mode: 'grid', filters_collapsed_default: true, remember_last_project: true };
      // Ensure viewer defaults
      copy.viewer = copy.viewer || { preload_count: 1 };
      // Ensure photo_grid defaults
      copy.photo_grid = copy.photo_grid || {};
      if (typeof copy.photo_grid.lazy_load_threshold !== 'number') copy.photo_grid.lazy_load_threshold = 100;
      if (typeof copy.photo_grid.page_size !== 'number') copy.photo_grid.page_size = 100;
      // Ensure processing defaults
      copy.processing = copy.processing || {};
      copy.processing.thumbnail = copy.processing.thumbnail || { maxDim: 200, quality: 80 };
      copy.processing.preview = copy.processing.preview || { maxDim: 6000, quality: 80 };
      // Ensure new keyboard shortcuts exist
      copy.keyboard_shortcuts = copy.keyboard_shortcuts || {};
      if (!('next_photo' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.next_photo = 'ArrowRight';
      if (!('prev_photo' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.prev_photo = 'ArrowLeft';
      if (!('zoom_in' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.zoom_in = '=';
      if (!('zoom_out' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.zoom_out = '-';
      if (!('view_grid' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.view_grid = 'g';
      if (!('view_table' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.view_table = 't';
      if (!('toggle_filters' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.toggle_filters = 'f';
      if (!('select_all' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.select_all = 'a';
      if (!('toggle_select' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.toggle_select = 's';
      if (!('close_viewer' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.close_viewer = 'Escape';
      if (!('toggle_info' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.toggle_info = 'i';
      if (!('cancel_keep' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.cancel_keep = 'Delete';
      if (!('keep_jpg_only' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.keep_jpg_only = 'j';
      if (!('keep_raw_and_jpg' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.keep_raw_and_jpg = 'r';
      setLocalConfig(copy);
    }
  }, [config]);

  // Keep rename input synced with the selected project
  useEffect(() => {
    setRenameValue(project?.name || '');
  }, [project?.name]);

  const handleConfigChange = (category, key, value) => {
    setLocalConfig(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [key]: value,
      },
    }));
  };

  const handleProcessingChange = (type, key, value) => {
    setLocalConfig(prev => ({
      ...prev,
      processing: {
        ...prev.processing,
        [type]: {
          ...prev.processing?.[type],
          [key]: value,
        }
      }
    }));
  };

  const handleRegenerateAll = async () => {
    if (!project) {
      alert('Open a project to regenerate.');
      return;
    }
    if (!window.confirm('Force regenerate thumbnails and previews for this project? This may take a while.')) return;
    try {
      setRegenLoading(true);
      // Use per-image processing via global upload controller. This triggers the bottom progress bar.
      await uploadActions.startProcess({ thumbnails: true, previews: true, force: true });
      // Completion toast is handled by the bottom bar; optional alert removed.
    } catch (err) {
      console.error('Regeneration failed:', err);
      alert('Regeneration failed. See console for details.');
    } finally {
      setRegenLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    try {
      const response = await authFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(localConfig),
      });
      if (response.ok) {
        const updatedConfig = await response.json();
        onConfigUpdate(updatedConfig);
        alert('Settings saved successfully!');
        onClose();
      } else {
        alert('Failed to save settings.');
      }
    } catch (error) {
      console.error('Error saving config:', error);
      alert('An error occurred while saving settings.');
    }
  };

  const handleRenameProject = async () => {
    if (!project?.id) { alert('No project selected'); return; }
    const name = (renameValue || '').trim();
    if (!name) { alert('Project name cannot be empty'); return; }
    if (name === project.name) { return; }
    try {
      setRenaming(true);
      const res = await renameProjectById(project.id, name);
      const updated = res?.project ? { id: project.id, name: res.project.name, folder: res.project.folder } : { id: project.id, name, folder: project.folder };
      if (typeof onProjectRenamed === 'function') onProjectRenamed(updated);
      alert('Project renamed successfully.');
    } catch (e) {
      console.error('Rename failed', e);
      alert('Failed to rename project.');
    } finally {
      setRenaming(false);
    }
  };

  const handleRestoreDefaults = async () => {
    if (window.confirm('Are you sure you want to restore default settings? This will save immediately.')) {
      try {
        const response = await authFetch('/api/config/restore', { method: 'POST' });
        if (response.ok) {
          const updatedConfig = await response.json();
          onConfigUpdate(updatedConfig);
          // Normalize to ensure all sections exist in local UI
          const copy = JSON.parse(JSON.stringify(updatedConfig));
          copy.ui = copy.ui || { default_view_mode: 'grid', filters_collapsed_default: true, remember_last_project: true };
          copy.viewer = copy.viewer || { preload_count: 1 };
          copy.processing = copy.processing || {};
          copy.processing.thumbnail = copy.processing.thumbnail || { maxDim: 200, quality: 80 };
          copy.processing.preview = copy.processing.preview || { maxDim: 6000, quality: 80 };
          copy.keyboard_shortcuts = copy.keyboard_shortcuts || {};
          if (!('next_photo' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.next_photo = 'ArrowRight';
          if (!('prev_photo' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.prev_photo = 'ArrowLeft';
          if (!('zoom_in' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.zoom_in = '=';
          if (!('zoom_out' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.zoom_out = '-';
          if (!('view_grid' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.view_grid = 'g';
          if (!('view_table' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.view_table = 't';
          if (!('toggle_filters' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.toggle_filters = 'f';
          if (!('select_all' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.select_all = 'a';
          if (!('toggle_select' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.toggle_select = 's';
          if (!('close_viewer' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.close_viewer = 'Escape';
          if (!('toggle_info' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.toggle_info = 'i';
          if (!('cancel_keep' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.cancel_keep = 'Delete';
          if (!('keep_jpg_only' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.keep_jpg_only = 'j';
          if (!('keep_raw_and_jpg' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.keep_raw_and_jpg = 'r';
          copy.photo_grid = copy.photo_grid || {};
          if (typeof copy.photo_grid.lazy_load_threshold !== 'number') copy.photo_grid.lazy_load_threshold = 100;
          if (typeof copy.photo_grid.page_size !== 'number') copy.photo_grid.page_size = 100;
          setLocalConfig(copy);
          alert('Default settings restored.');
        } else {
          alert('Failed to restore defaults.');
        }
      } catch (error) {
        console.error('Error restoring config:', error);
        alert('An error occurred while restoring settings.');
      }
    }
  };

  const handleDeleteProject = async () => {
    if (!project?.name || !project?.id) { alert('No project selected'); return; }
    if (deleteConfirmText !== project.name) {
      alert(`Please type the project name "${project.name}" to confirm deletion.`);
      return;
    }

    try {
      await deleteProject(project.id);
      alert('Project deleted successfully.');
      onProjectDelete();
      setShowDeleteModal(false);
      setDeleteConfirmText('');
    } catch (error) {
      // Error deleting project
      // error may contain server message in error.message
      alert(`An error occurred while deleting the project. ${error?.message || ''}`);
    }
  };

  if (!localConfig) {
    return embedded ? (
      <div className="p-4">Loading settings...</div>
    ) : (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
          <p>Loading settings...</p>
        </div>
      </div>
    );
  }

  // Sidebar layout with single-open accordions
  if (embedded) {
    return (
      <div className="space-y-4 relative">
        {/* Manage Project */}
        {project && (
          <section>
            <button
              className={`w-full flex items-center justify-between px-0 py-3 text-left ${openSection==='manage' ? 'bg-gray-50' : ''}`}
              onClick={() => setOpenSection(prev => prev === 'manage' ? null : 'manage')}
            >
              <span className="font-medium">Manage Project</span>
              <span className="text-sm text-gray-500">{openSection==='manage' ? '▲' : '▼'}</span>
            </button>
            {openSection === 'manage' && (
              <div className="pb-4 space-y-3">
                <label className="block">
                  <span className="text-gray-700">Project name</span>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRenameProject}
                    disabled={renaming || !renameValue.trim() || renameValue.trim() === project.name}
                    className={`px-4 py-2 rounded-md text-white ${renaming ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
                  >
                    {renaming ? 'Renaming…' : 'Save name'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDeleteConfirmText(''); setShowDeleteModal(true); }}
                    className="ml-auto px-4 py-2 rounded-md text-white bg-red-600 hover:bg-red-700"
                  >
                    Delete project
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
        {/* The rest of the sections reuse existing content below */}
        {/* Image Preprocessing */}
        <section>
          <button
            className={`w-full flex items-center justify-between px-0 py-3 text-left ${openSection==='image_preprocessing' ? 'bg-gray-50' : ''}`}
            onClick={() => setOpenSection(prev => prev === 'image_preprocessing' ? null : 'image_preprocessing')}
          >
            <span className="font-medium">Image Preprocessing</span>
            <span className="text-sm text-gray-500">{openSection==='image_preprocessing' ? '▲' : '▼'}</span>
          </button>
          {openSection === 'image_preprocessing' && (
            <div className="pb-4 space-y-6">
              <div>
                <h3 className="text-sm font-semibold mb-2">Thumbnails</h3>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-gray-700">Max Dimension (px)</span>
                    <input type="number" min={1} value={localConfig.processing.thumbnail.maxDim}
                      onChange={(e)=>handleProcessingChange('thumbnail','maxDim', parseInt(e.target.value,10)||0)}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                  </label>
                  <label className="block">
                    <span className="text-gray-700">JPEG Quality</span>
                    <input type="number" min={1} max={100} value={localConfig.processing.thumbnail.quality}
                      onChange={(e)=>handleProcessingChange('thumbnail','quality', Math.max(1, Math.min(100, parseInt(e.target.value,10)||0)))}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                  </label>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-2">Previews</h3>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-gray-700">Max Dimension (px)</span>
                    <input type="number" min={1} value={localConfig.processing.preview.maxDim}
                      onChange={(e)=>handleProcessingChange('preview','maxDim', parseInt(e.target.value,10)||0)}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                  </label>
                  <label className="block">
                    <span className="text-gray-700">JPEG Quality</span>
                    <input type="number" min={1} max={100} value={localConfig.processing.preview.quality}
                      onChange={(e)=>handleProcessingChange('preview','quality', Math.max(1, Math.min(100, parseInt(e.target.value,10)||0)))}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                  </label>
                </div>
              </div>
              <div className="pt-2 border-t-0" />
              <div className="space-y-2">
                <p className="text-sm text-gray-700">Generate or re-generate derived images for the current project.</p>
                <button
                  onClick={handleRegenerateAll}
                  disabled={regenLoading || !project}
                  className={`px-4 py-2 rounded-md text-white ${regenLoading ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                  {regenLoading ? 'Regenerating…' : 'Regenerate thumbnails & previews'}
                </button>
              </div>
            </div>
          )}
        </section>
        {/* Other */}
        <section>
          <button
            className={`w-full flex items-center justify-between px-0 py-3 text-left ${openSection==='other' ? 'bg-gray-50' : ''}`}
            onClick={() => setOpenSection(prev => prev === 'other' ? null : 'other')}
          >
            <span className="font-medium">Other</span>
            <span className="text-sm text-gray-500">{openSection==='other' ? '▲' : '▼'}</span>
          </button>
          {openSection === 'other' && (
            <div className="pb-4 space-y-4">
              {/* Keep Defaults removed: keep flags now default to actual file availability */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">General</h3>
                <label className="block">
                  <span className="text-gray-700">Grid Pagination Threshold (px)</span>
                  <input type="number" value={localConfig.photo_grid.lazy_load_threshold}
                    onChange={(e) => handleConfigChange('photo_grid', 'lazy_load_threshold', parseInt(e.target.value, 10) || 0)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                </label>
                <label className="block">
                  <span className="text-gray-700">Grid Page Size</span>
                  <input type="number" min={1} value={localConfig.photo_grid.page_size}
                    onChange={(e) => handleConfigChange('photo_grid', 'page_size', Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                </label>
                <label className="block">
                  <span className="text-gray-700">Viewer Preload Count</span>
                  <input type="number" min={0} max={10} value={localConfig.viewer?.preload_count ?? 1}
                    onChange={(e) => handleConfigChange('viewer', 'preload_count', Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                  <span className="block text-xs text-gray-500 mt-1">Number of next/previous images to preload in the fullscreen viewer.</span>
                </label>
              </div>
            </div>
          )}
        </section>
        {/* UI Preferences */}
        <section>
          <button
            className={`w-full flex items-center justify-between px-0 py-3 text-left ${openSection==='ui' ? 'bg-gray-50' : ''}`}
            onClick={() => setOpenSection(prev => prev === 'ui' ? null : 'ui')}
          >
            <span className="font-medium">UI Preferences</span>
            <span className="text-sm text-gray-500">{openSection==='ui' ? '▲' : '▼'}</span>
          </button>
          {openSection === 'ui' && (
            <div className="pb-4 space-y-3">
              <label className="block">
                <span className="text-gray-700">Default View Mode</span>
                <select value={localConfig.ui?.default_view_mode || 'grid'}
                  onChange={(e) => handleConfigChange('ui', 'default_view_mode', e.target.value)}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md">
                  <option value="grid">Grid</option>
                  <option value="table">Table</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!localConfig.ui?.filters_collapsed_default}
                  onChange={(e) => handleConfigChange('ui', 'filters_collapsed_default', e.target.checked)} />
                <span className="text-gray-700">Collapse filters by default</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={localConfig.ui?.remember_last_project !== false}
                  onChange={(e) => handleConfigChange('ui', 'remember_last_project', e.target.checked)} />
                <span className="text-gray-700">Remember last opened project</span>
              </label>
            </div>
          )}
        </section>
        {/* Keyboard Shortcuts */}
        <section>
          <button
            className={`w-full flex items-center justify-between px-0 py-3 text-left ${openSection==='shortcuts' ? 'bg-gray-50' : ''}`}
            onClick={() => setOpenSection(prev => prev === 'shortcuts' ? null : 'shortcuts')}
          >
            <span className="font-medium">Keyboard Shortcuts</span>
            <span className="text-sm text-gray-500">{openSection==='shortcuts' ? '▲' : '▼'}</span>
          </button>
          {openSection === 'shortcuts' && (
            <div className="pb-4 space-y-2">
              {Object.entries(localConfig.keyboard_shortcuts || {}).map(([key, val]) => (
                <label key={key} className="block">
                  <span className="text-gray-700 capitalize">{key.replace(/_/g,' ')}</span>
                  <input type="text" value={val} onChange={(e)=>handleConfigChange('keyboard_shortcuts', key, e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                </label>
              ))}
            </div>
          )}
        </section>
        {/* Save/Restore */}
        <div className="pt-4 flex items-center justify-end gap-2">
          <button className="px-4 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300" onClick={handleRestoreDefaults}>Restore Defaults</button>
          <button className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700" onClick={handleSaveConfig}>Save Settings</button>
        </div>
        {/* Delete Confirmation Modal (embedded) */}
        {showDeleteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowDeleteModal(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-900">Delete project</h3>
              <p className="mt-2 text-sm text-gray-700">This action is irreversible. It will permanently delete the project folder, including all photos and metadata.</p>
              <label htmlFor="delete-confirm-embedded" className="mt-4 block text-sm font-medium text-gray-700">
                Type the project name "{project?.name}" to confirm:
              </label>
              <input
                id="delete-confirm-embedded"
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button className="px-4 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300" onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}>Cancel</button>
                <button
                  onClick={handleDeleteProject}
                  disabled={deleteConfirmText !== project?.name}
                  className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Delete permanently
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40" onClick={onClose} />
      {/* Right sidebar */}
      <aside className="w-full max-w-md h-full bg-white shadow-xl border-l flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-xl font-semibold">Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800" aria-label="Close">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-2">
            {/* Manage Project */}
            {project && (
              <section>
                <button
                  className={`w-full flex items-center justify-between px-4 py-3 text-left ${openSection==='manage' ? 'bg-gray-50' : ''}`}
                  onClick={() => setOpenSection(prev => prev === 'manage' ? null : 'manage')}
                >
                  <span className="font-medium">Manage Project</span>
                  <span className="text-sm text-gray-500">{openSection==='manage' ? '▲' : '▼'}</span>
                </button>
                {openSection === 'manage' && (
                  <div className="px-4 pb-4 space-y-3">
                    <label className="block">
                      <span className="text-gray-700">Project name</span>
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleRenameProject}
                        disabled={renaming || !renameValue.trim() || renameValue.trim() === project.name}
                        className={`px-4 py-2 rounded-md text-white ${renaming ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
                      >
                        {renaming ? 'Renaming…' : 'Save name'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setDeleteConfirmText(''); setShowDeleteModal(true); }}
                        className="ml-auto px-4 py-2 rounded-md text-white bg-red-600 hover:bg-red-700"
                      >
                        Delete project
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Image Preprocessing (processing + maintenance) */}
            <section>
              <button
                className={`w-full flex items-center justify-between px-4 py-3 text-left ${openSection==='image_preprocessing' ? 'bg-gray-50' : ''}`}
                onClick={() => setOpenSection(prev => prev === 'image_preprocessing' ? null : 'image_preprocessing')}
              >
                <span className="font-medium">Image Preprocessing</span>
                <span className="text-sm text-gray-500">{openSection==='image_preprocessing' ? '▲' : '▼'}</span>
              </button>
              {openSection === 'image_preprocessing' && (
                <div className="px-4 pb-4 space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Thumbnails</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-gray-700">Max Dimension (px)</span>
                        <input type="number" min={1} value={localConfig.processing.thumbnail.maxDim}
                          onChange={(e)=>handleProcessingChange('thumbnail','maxDim', parseInt(e.target.value,10)||0)}
                          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                      </label>
                      <label className="block">
                        <span className="text-gray-700">JPEG Quality</span>
                        <input type="number" min={1} max={100} value={localConfig.processing.thumbnail.quality}
                          onChange={(e)=>handleProcessingChange('thumbnail','quality', Math.max(1, Math.min(100, parseInt(e.target.value,10)||0)))}
                          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                      </label>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Previews</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-gray-700">Max Dimension (px)</span>
                        <input type="number" min={1} value={localConfig.processing.preview.maxDim}
                          onChange={(e)=>handleProcessingChange('preview','maxDim', parseInt(e.target.value,10)||0)}
                          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                      </label>
                      <label className="block">
                        <span className="text-gray-700">JPEG Quality</span>
                        <input type="number" min={1} max={100} value={localConfig.processing.preview.quality}
                          onChange={(e)=>handleProcessingChange('preview','quality', Math.max(1, Math.min(100, parseInt(e.target.value,10)||0)))}
                          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                      </label>
                    </div>
                  </div>

                  <div className="pt-2 border-t-0" />
                  <div className="space-y-2">
                    <p className="text-sm text-gray-700">Generate or re-generate derived images for the current project.</p>
                    <button
                      onClick={handleRegenerateAll}
                      disabled={regenLoading || !project}
                      className={`px-4 py-2 rounded-md text-white ${regenLoading ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
                    >
                      {regenLoading ? 'Regenerating…' : 'Regenerate thumbnails & previews'}
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Maintenance removed: merged into Image Preprocessing */}

            {/* Other (moved Keep Defaults here and placed at end) */}
            <section>
              <button
                className={`w-full flex items-center justify-between px-4 py-3 text-left ${openSection==='other' ? 'bg-gray-50' : ''}`}
                onClick={() => setOpenSection(prev => prev === 'other' ? null : 'other')}
              >
                <span className="font-medium">Other</span>
                <span className="text-sm text-gray-500">{openSection==='other' ? '▲' : '▼'}</span>
              </button>
              {openSection === 'other' && (
                <div className="px-4 pb-4 space-y-4">
                  {/* Keep Defaults removed: keep flags now default to actual file availability */}
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold">General</h3>
                    <label className="block">
                      <span className="text-gray-700">Grid Pagination Threshold (px)</span>
                      <input type="number" value={localConfig.photo_grid.lazy_load_threshold}
                        onChange={(e) => handleConfigChange('photo_grid', 'lazy_load_threshold', parseInt(e.target.value, 10) || 0)}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                    </label>
                    <label className="block">
                      <span className="text-gray-700">Grid Page Size</span>
                      <input type="number" min={1} value={localConfig.photo_grid.page_size}
                        onChange={(e) => handleConfigChange('photo_grid', 'page_size', Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                    </label>
                    <label className="block">
                      <span className="text-gray-700">Viewer Preload Count</span>
                      <input type="number" min={0} max={10} value={localConfig.viewer?.preload_count ?? 1}
                        onChange={(e) => handleConfigChange('viewer', 'preload_count', Math.max(0, parseInt(e.target.value, 10) || 0))}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md" />
                      <span className="block text-xs text-gray-500 mt-1">Number of next/previous images to preload in the fullscreen viewer.</span>
                    </label>
                  </div>
                </div>
              )}
            </section>

            {/* UI Preferences */}
            <section>
              <button
                className={`w-full flex items-center justify-between px-4 py-3 text-left ${openSection==='ui' ? 'bg-gray-50' : ''}`}
                onClick={() => setOpenSection(prev => prev === 'ui' ? null : 'ui')}
              >
                <span className="font-medium">UI Preferences</span>
                <span className="text-sm text-gray-500">{openSection==='ui' ? '▲' : '▼'}</span>
              </button>
              {openSection === 'ui' && (
                <div className="px-4 pb-4 space-y-3">
                  <label className="block">
                    <span className="text-gray-700">Default View Mode</span>
                    <select value={localConfig.ui?.default_view_mode || 'grid'}
                      onChange={(e) => handleConfigChange('ui', 'default_view_mode', e.target.value)}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md">
                      <option value="grid">Grid</option>
                      <option value="table">Table</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!localConfig.ui?.filters_collapsed_default}
                      onChange={(e) => handleConfigChange('ui', 'filters_collapsed_default', e.target.checked)} />
                    <span className="text-gray-700">Collapse filters by default</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={localConfig.ui?.remember_last_project !== false}
                      onChange={(e) => handleConfigChange('ui', 'remember_last_project', e.target.checked)} />
                    <span className="text-gray-700">Remember last opened project</span>
                  </label>
                </div>
              )}
            </section>

            {/* Keyboard Shortcuts */}
            <section>
              <button
                className={`w-full flex items-center justify-between px-4 py-3 text-left ${openSection==='shortcuts' ? 'bg-gray-50' : ''}`}
                onClick={() => setOpenSection(prev => prev === 'shortcuts' ? null : 'shortcuts')}
              >
                <span className="font-medium">Keyboard Shortcuts</span>
                <span className="text-sm text-gray-500">{openSection==='shortcuts' ? '▲' : '▼'}</span>
              </button>
              {openSection === 'shortcuts' && (
                <div className="px-4 pb-4 grid grid-cols-2 gap-4">
                  {Object.entries(localConfig.keyboard_shortcuts).map(([key, value]) => (
                    <label key={key} className="block">
                      <span className="text-gray-700 capitalize">{key.replace(/_/g, ' ')}</span>
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => handleConfigChange('keyboard_shortcuts', key, e.target.value)}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </label>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t-0 px-4 py-3 flex justify-between items-center">
          <button onClick={handleRestoreDefaults} className="px-3 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">
            Restore Defaults
          </button>
          <button onClick={handleSaveConfig} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
            Save & Close
          </button>
        </div>
        {/* Delete Confirmation Modal (non-embedded) */}
        {showDeleteModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={() => setShowDeleteModal(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative bg-white rounded-lg shadow-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-900">Delete project</h3>
              <p className="mt-2 text-sm text-gray-700">This action is irreversible. It will permanently delete the project folder, including all photos and metadata.</p>
              <label htmlFor="delete-confirm" className="mt-4 block text-sm font-medium text-gray-700">
                Type the project name "{project?.name}" to confirm:
              </label>
              <input
                id="delete-confirm"
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button className="px-4 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300" onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}>Cancel</button>
                <button
                  onClick={handleDeleteProject}
                  disabled={deleteConfirmText !== project?.name}
                  className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Delete permanently
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};

export default Settings;
