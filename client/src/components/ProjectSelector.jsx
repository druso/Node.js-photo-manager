import React, { useRef } from 'react';
import { useUpload } from '../upload/UploadContext';

const ProjectSelector = ({ projects, selectedProject, onProjectSelect }) => {
  const fileInputRef = useRef(null);
  const { actions: uploadActions } = useUpload();

  const handleImportClick = () => {
    if (!selectedProject) {
      alert('Select a project first.');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFilesChosen = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      uploadActions.startAnalyze(files);
      // reset input so same file can be reselected later
      e.target.value = '';
    }
  };

  return (
    <div className="flex items-center space-x-4">
      {/* Project Dropdown */}
      <div className="relative">
        <select
          value={selectedProject?.folder || ''}
          onChange={(e) => {
            const project = projects.find(p => p.folder === e.target.value);
            onProjectSelect(project || null);
          }}
          disabled={projects.length === 0}
          className={`block w-64 pl-3 pr-10 py-2 text-base border border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md ${
            projects.length === 0 ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''
          }`}
        >
          {projects.length === 0 ? (
            <option value="">No projects available</option>
          ) : (
            projects.map((project) => (
              <option key={project.folder} value={project.folder}>
                {project.name} ({project.photo_count} photos)
              </option>
            ))
          )}
        </select>
      </div>

      {/* Add (+) Button */}
      <button
        onClick={handleImportClick}
        className={`p-2 rounded-md transition-colors border ${
          selectedProject
            ? 'bg-blue-500 text-white hover:bg-blue-600 border-blue-600'
            : 'bg-gray-200 text-gray-400 border-gray-300 cursor-not-allowed'
        }`}
        title="Add images to project"
        disabled={!selectedProject}
      >
        {/* Plus icon */}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
      </button>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.jpg,.jpeg,.png,.heic,.raw"
        multiple
        className="hidden"
        onChange={handleFilesChosen}
      />
    </div>
  );
};

export default ProjectSelector;
