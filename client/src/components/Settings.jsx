import React, { useState, useEffect } from 'react';
import { deleteProject } from '../api/projectsApi';
import { generateThumbnails, generatePreviews } from '../api/uploadsApi';

const Settings = ({ project, config, onConfigUpdate, onProjectDelete, onClose }) => {
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [localConfig, setLocalConfig] = useState(null);
  const [openSection, setOpenSection] = useState('delete'); // only one open at a time
  const [regenLoading, setRegenLoading] = useState(false);

  useEffect(() => {
    // Deep copy config to local state to avoid direct mutation
    if (config) {
      const copy = JSON.parse(JSON.stringify(config));
      // Ensure ui exists with defaults when missing
      copy.ui = copy.ui || { default_view_mode: 'grid', filters_collapsed_default: true, remember_last_project: true };
      if (copy.ui.preview_mode_default === undefined) copy.ui.preview_mode_default = false;
      // Ensure viewer defaults
      copy.viewer = copy.viewer || { preload_count: 1 };
      // Ensure processing defaults
      copy.processing = copy.processing || {};
      copy.processing.thumbnail = copy.processing.thumbnail || { maxDim: 200, quality: 80 };
      copy.processing.preview = copy.processing.preview || { maxDim: 6000, quality: 80 };
      // Ensure keep defaults
      copy.keep_defaults = copy.keep_defaults || { jpg: true, raw: false };
      // Ensure new keyboard shortcuts exist
      copy.keyboard_shortcuts = copy.keyboard_shortcuts || {};
      if (!('cancel_keep' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.cancel_keep = 'Delete';
      if (!('keep_jpg_only' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.keep_jpg_only = 'j';
      if (!('keep_raw_and_jpg' in copy.keyboard_shortcuts)) copy.keyboard_shortcuts.keep_raw_and_jpg = 'r';
      setLocalConfig(copy);
    }
  }, [config]);

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
      const thumb = await generateThumbnails(project.folder, { force: true });
      const prev = await generatePreviews(project.folder, { force: true });
      alert(`Regeneration complete. Thumbnails: ${thumb.processed}/${thumb.total}. Previews: ${prev.processed}/${prev.total}.`);
    } catch (err) {
      console.error('Regeneration failed:', err);
      alert('Regeneration failed. See console for details.');
    } finally {
      setRegenLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    try {
      const response = await fetch('/api/config', {
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

  const handleRestoreDefaults = async () => {
    if (window.confirm('Are you sure you want to restore default settings? This will save immediately.')) {
      try {
        const response = await fetch('/api/config/restore', { method: 'POST' });
        if (response.ok) {
          const updatedConfig = await response.json();
          onConfigUpdate(updatedConfig);
          // Normalize to ensure all sections exist in local UI
          const copy = JSON.parse(JSON.stringify(updatedConfig));
          copy.ui = copy.ui || { default_view_mode: 'grid', filters_collapsed_default: true, remember_last_project: true };
          if (copy.ui.preview_mode_default === undefined) copy.ui.preview_mode_default = false;
          copy.viewer = copy.viewer || { preload_count: 1 };
          copy.processing = copy.processing || {};
          copy.processing.thumbnail = copy.processing.thumbnail || { maxDim: 200, quality: 80 };
          copy.processing.preview = copy.processing.preview || { maxDim: 6000, quality: 80 };
          copy.keep_defaults = copy.keep_defaults || { jpg: true, raw: false };
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
    if (deleteConfirmText !== 'i am sure') {
      alert('Please type "i am sure" to confirm deletion.');
      return;
    }

    try {
      await deleteProject(project.folder);
      alert('Project deleted successfully.');
      onProjectDelete();
    } catch (error) {
      console.error('Error deleting project:', error);
      // error may contain server message in error.message
      alert(`An error occurred while deleting the project. ${error?.message || ''}`);
    }
  };

  if (!localConfig) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
          <p>Loading settings...</p>
        </div>
      </div>
    );
  }

  // Sidebar layout with single-open accordions
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
          <div className="divide-y">
            {/* Keep Defaults */}
            <section>
              <button
                className={`w-full flex items-center justify-between px-4 py-3 text-left ${openSection==='keep_defaults' ? 'bg-gray-50' : ''}`}
                onClick={() => setOpenSection(prev => prev === 'keep_defaults' ? null : 'keep_defaults')}
              >
                <span className="font-medium">Keep Defaults</span>
                <span className="text-sm text-gray-500">{openSection==='keep_defaults' ? '▲' : '▼'}</span>
              </button>
              {openSection === 'keep_defaults' && (
                <div className="px-4 pb-4 space-y-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!localConfig.keep_defaults?.jpg}
                      onChange={(e) => handleConfigChange('keep_defaults', 'jpg', e.target.checked)}
                    />
                    <span className="text-gray-700">Keep JPG by default</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!localConfig.keep_defaults?.raw}
                      onChange={(e) => handleConfigChange('keep_defaults', 'raw', e.target.checked)}
                    />
                    <span className="text-gray-700">Keep RAW by default</span>
                  </label>
                  <p className="text-xs text-gray-500">Defaults used for newly added photos during ingestion.</p>
                </div>
              )}
            </section>
            {/* Delete Project - first */}
            {project && (
              <section>
                <button
                  className={`w-full flex items-center justify-between px-4 py-3 text-left ${openSection==='delete' ? 'bg-red-50' : ''}`}
                  onClick={() => setOpenSection(prev => prev === 'delete' ? null : 'delete')}
                >
                  <span className="text-red-600 font-medium">Delete Project</span>
                  <span className="text-sm text-gray-500">{openSection==='delete' ? '▲' : '▼'}</span>
                </button>
                {openSection === 'delete' && (
                  <div className="px-4 pb-4">
                    <p className="text-sm text-gray-700">
                      This action is irreversible. It will permanently delete the project folder, including all photos and metadata.
                    </p>
                    <div className="mt-4">
                      <label htmlFor="delete-confirm" className="block text-sm font-medium text-gray-700">
                        To confirm, please type "i am sure" below:
                      </label>
                      <input
                        id="delete-confirm"
                        type="text"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                      <button
                        onClick={handleDeleteProject}
                        disabled={deleteConfirmText !== 'i am sure'}
                        className="mt-2 w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Delete Project Permanently
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

                  <div className="pt-2 border-t" />
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

            {/* General */}
            <section>
              <button
                className={`w-full flex items-center justify-between px-4 py-3 text-left ${openSection==='general' ? 'bg-gray-50' : ''}`}
                onClick={() => setOpenSection(prev => prev === 'general' ? null : 'general')}
              >
                <span className="font-medium">General</span>
                <span className="text-sm text-gray-500">{openSection==='general' ? '▲' : '▼'}</span>
              </button>
              {openSection === 'general' && (
                <div className="px-4 pb-4 space-y-2">
                  <label className="block">
                    <span className="text-gray-700">Lazy Load Threshold</span>
                    <input
                      type="number"
                      value={localConfig.photo_grid.lazy_load_threshold}
                      onChange={(e) => handleConfigChange('photo_grid', 'lazy_load_threshold', parseInt(e.target.value, 10) || 0)}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </label>
                  <label className="block">
                    <span className="text-gray-700">Viewer Preload Count</span>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={localConfig.viewer?.preload_count ?? 1}
                      onChange={(e) => handleConfigChange('viewer', 'preload_count', Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                    <span className="block text-xs text-gray-500 mt-1">Number of next/previous images to preload in the fullscreen viewer.</span>
                  </label>
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
                    <select
                      value={localConfig.ui?.default_view_mode || 'grid'}
                      onChange={(e) => handleConfigChange('ui', 'default_view_mode', e.target.value)}
                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      <option value="grid">Grid</option>
                      <option value="table">Table</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!localConfig.ui?.filters_collapsed_default}
                      onChange={(e) => handleConfigChange('ui', 'filters_collapsed_default', e.target.checked)}
                    />
                    <span className="text-gray-700">Collapse filters by default</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={localConfig.ui?.remember_last_project !== false}
                      onChange={(e) => handleConfigChange('ui', 'remember_last_project', e.target.checked)}
                    />
                    <span className="text-gray-700">Remember last opened project</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!localConfig.ui?.preview_mode_default}
                      onChange={(e) => handleConfigChange('ui', 'preview_mode_default', e.target.checked)}
                    />
                    <span className="text-gray-700">Preview mode enabled by default</span>
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
        <div className="border-t px-4 py-3 flex justify-between items-center">
          <button onClick={handleRestoreDefaults} className="px-3 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">
            Restore Defaults
          </button>
          <button onClick={handleSaveConfig} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
            Save & Close
          </button>
        </div>
      </aside>
    </div>
  );
};

export default Settings;
