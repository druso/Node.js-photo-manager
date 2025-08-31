import React from 'react';

const ProjectSelectionModal = ({ isOpen, projects, onSelect, onCancel }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Target Project</h3>
          <p className="text-sm text-gray-600 mb-4">
            Choose which project to upload the files to:
          </p>
          
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {projects.map((project) => (
              <button
                key={project.folder}
                onClick={() => onSelect(project)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-100 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <div className="font-medium text-gray-900">{project.name}</div>
                <div className="text-xs text-gray-500">{project.folder}</div>
              </button>
            ))}
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectSelectionModal;
