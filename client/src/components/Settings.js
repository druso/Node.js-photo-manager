import React, { useState, useEffect } from 'react';

const Settings = ({ project, config, onConfigUpdate, onProjectDelete, onClose }) => {
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [localConfig, setLocalConfig] = useState(null);

  useEffect(() => {
    // Deep copy config to local state to avoid direct mutation
    if (config) {
      setLocalConfig(JSON.parse(JSON.stringify(config)));
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
      const response = await fetch(`/api/projects/${project.folder}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        alert('Project deleted successfully.');
        onProjectDelete();
      } else {
        const errorData = await response.json();
        alert(`Failed to delete project: ${errorData.error}`);
      }
    } catch (error) {
      console.error('Error deleting project:', error);
      alert('An error occurred while deleting the project.');
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800">&times;</button>
        </div>

        <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-4">
          {/* General Settings */}
          <div>
            <h3 className="text-lg font-semibold">General</h3>
            <div className="mt-2 space-y-2">
              <label className="block">
                <span className="text-gray-700">Lazy Load Threshold</span>
                <input 
                  type="number"
                  value={localConfig.photo_grid.lazy_load_threshold}
                  onChange={(e) => handleConfigChange('photo_grid', 'lazy_load_threshold', parseInt(e.target.value, 10) || 0)}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </label>
            </div>
          </div>

          {/* Keyboard Shortcuts */}
          <div className="border-t pt-4">
            <h3 className="text-lg font-semibold">Keyboard Shortcuts</h3>
            <div className="mt-2 grid grid-cols-2 gap-4">
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
          </div>

          {/* Project Deletion */}
          {project && (
            <div className="border-t pt-4">
              <h3 className="text-lg font-semibold text-red-600">Delete Project</h3>
              <p className="text-sm text-gray-600 mt-1">
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
        </div>

        <div className="border-t pt-4 mt-6 flex justify-end space-x-2">
          <button onClick={handleRestoreDefaults} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">
            Restore Defaults
          </button>
          <button onClick={handleSaveConfig} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
