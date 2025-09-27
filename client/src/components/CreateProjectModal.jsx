import React, { useState } from 'react';

const CreateProjectModal = ({ isOpen, onClose, onCreateProject }) => {
  const [newProjectName, setNewProjectName] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    
    await onCreateProject(name);
    setNewProjectName('');
    onClose();
  };

  const handleClose = () => {
    setNewProjectName('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 border-b">
            <h3 className="text-lg font-semibold">Create new project</h3>
          </div>
          <div className="px-6 py-4 space-y-3">
            <label className="block">
              <span className="text-gray-700">Project name</span>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="e.g. Family Trip 2025"
                autoFocus
              />
            </label>
          </div>
          <div className="px-6 py-4 border-t-0 flex justify-end gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300"
              onClick={handleClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={!newProjectName.trim()}
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateProjectModal;
