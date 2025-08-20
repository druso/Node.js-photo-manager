import React from 'react';

const ProjectSelector = ({ projects, selectedProject, onProjectSelect }) => {
  // Inline import button removed per UX update; import available via other UI.

  return (
    <div className="flex items-center">
      {/* Project Dropdown */}
      <div className="relative">
        <select
          id="projectSelector"
          name="projectSelector"
          value={selectedProject?.folder || ''}
          onChange={(e) => {
            const project = projects.find(p => p.folder === e.target.value);
            onProjectSelect(project || null);
          }}
          disabled={projects.length === 0}
          title={selectedProject ? `${selectedProject.name} (${selectedProject.photo_count} photos)` : ''}
          aria-label="Select project"
          className={`block w-32 sm:w-64 pl-2 pr-6 sm:pl-3 sm:pr-10 py-1.5 sm:py-2 border border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-xs sm:text-sm rounded-md truncate ${
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
    </div>
  );
};

export default ProjectSelector;
