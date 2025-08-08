import React, { useState, useEffect } from 'react';
import ProjectSelector from './components/ProjectSelector';
import PhotoUpload from './components/PhotoUpload';
import PhotoDisplay from './components/PhotoDisplay';
import PhotoTagger from './components/PhotoTagger';
import PhotoViewer from './components/PhotoViewer';
import Settings from './components/Settings';
import UniversalFilter from './components/UniversalFilter';
import './App.css';

function App() {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectData, setProjectData] = useState(null);
  const [activeTab, setActiveTab] = useState('upload'); // 'view', 'upload', 'tag'
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [config, setConfig] = useState(null);
  const [viewerState, setViewerState] = useState({ isOpen: false, startIndex: 0 });
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'table'
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [activeFilters, setActiveFilters] = useState({});

  // Fetch all projects on component mount
  useEffect(() => {
    fetchProjects();
    fetchConfig();
  }, []);

  // Remember last project
  useEffect(() => {
    if (projects.length > 0 && !selectedProject) {
      // Projects exist but none selected - try to load last project
      const lastProjectFolder = localStorage.getItem('druso-last-project');
      if (lastProjectFolder) {
        const lastProject = projects.find(p => p.folder === lastProjectFolder);
        if (lastProject) {
          handleProjectSelect(lastProject);
          return;
        }
      }
      // If no last project or it doesn't exist anymore, select the first one
      handleProjectSelect(projects[0]);
    }
  }, [projects, selectedProject]);

  // Remember selected project
  useEffect(() => {
    if (selectedProject) {
      localStorage.setItem('druso-last-project', selectedProject.folder);
    }
  }, [selectedProject]);

  // Fetch project data when a project is selected
  useEffect(() => {
    if (selectedProject) {
      fetchProjectData(selectedProject.folder);
    }
  }, [selectedProject]);

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects');
      const data = await response.json();
      setProjects(data);
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
  };

  const fetchProjectData = async (folder) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${folder}`);
      const data = await response.json();
      setProjectData(data);
      setActiveTab('view');
    } catch (error) {
      console.error('Error fetching project data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProjectCreate = async (projectName) => {
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: projectName }),
      });
      
      if (response.ok) {
        const newProject = await response.json();
        await fetchProjects(); // Refresh project list
        setSelectedProject(newProject.project);
      } else {
        const error = await response.json();
        alert(`Error creating project: ${error.error}`);
      }
    } catch (error) {
      console.error('Error creating project:', error);
      alert('Error creating project');
    }
  };

  const handlePhotosUploaded = () => {
    // Refresh project data after upload
    if (selectedProject) {
      fetchProjectData(selectedProject.folder);
    }
    fetchProjects(); // Refresh the project list to update photo counts
  };

  const handleTagsUpdated = () => {
    // Refresh project data after tagging
    if (selectedProject) {
      fetchProjectData(selectedProject.folder);
    }
  };

  const handleProjectSelect = (project) => {
    setSelectedProject(project);
    if (project) {
      fetchProjectData(project.folder);
    } else {
      setProjectData(null);
    }
  };

  const handlePhotoSelect = (photo, photoContext = null) => {
    // Use the provided context (filtered photos) or fall back to all project photos
    const photosToSearch = photoContext || projectData?.photos || [];
    
    const photoIndex = photosToSearch.findIndex(p => p.filename === photo.filename);
    
    if (photoIndex > -1) {
      setViewerState({ 
        isOpen: true, 
        startIndex: photoIndex,
        photoContext: photosToSearch // Store the context for the viewer
      });
    } else {
      console.error("Could not find the selected photo in the provided context.");
      setViewerState({ 
        isOpen: true, 
        startIndex: 0,
        photoContext: photosToSearch
      });
    }
  };

  const handleToggleSelection = (photo) => {
    const newSelection = new Set(selectedPhotos);
    if (newSelection.has(photo.filename)) {
      newSelection.delete(photo.filename);
    } else {
      newSelection.add(photo.filename);
    }
    setSelectedPhotos(newSelection);
  };

  const handleCloseViewer = () => {
    setViewerState({ isOpen: false, startIndex: 0 });
  };

  const handleProjectDeleted = () => {
    setSelectedProject(null);
    setProjectData(null);
    fetchProjects();
  };

  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/config');
      if (response.ok) {
        setConfig(await response.json());
      }
    } catch (error) {
      console.error('Error fetching config:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky Header Container */}
      <div className="sticky top-0 z-20 bg-gray-50">
        {/* Header */}
        <header className="bg-gray-100 shadow-sm border-b relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">
              Druso photo manager
            </h1>
            
            {/* Desktop Project Controls - Right Aligned */}
            <div className="hidden md:flex items-center space-x-3">
              <ProjectSelector 
                projects={projects}
                selectedProject={selectedProject}
                onProjectSelect={handleProjectSelect}
                onProjectCreate={handleProjectCreate}
              />
              
              {/* Settings Button */}
              {selectedProject && (
                <button 
                  onClick={() => setShowSettings(true)} 
                  className="p-2 text-gray-600 rounded-md hover:bg-gray-200 transition-colors"
                  title="Project settings"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              )}
            </div>
            
            {/* Mobile Hamburger Menu */}
            <div className="md:hidden">
              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="p-2 text-gray-600 rounded-md hover:bg-gray-200 transition-colors"
                title="Menu"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        
        {/* Mobile Menu Overlay */}
        {showMobileMenu && (
          <div className="absolute top-full left-0 right-0 bg-gray-100 border-t border-gray-200 shadow-lg z-50 md:hidden">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              <div className="space-y-4">
                <ProjectSelector 
                  projects={projects}
                  selectedProject={selectedProject}
                  onProjectSelect={handleProjectSelect}
                  onProjectCreate={handleProjectCreate}
                />
                
                {/* Mobile Settings Button */}
                {selectedProject && (
                  <button 
                    onClick={() => {
                      setShowSettings(true);
                      setShowMobileMenu(false);
                    }} 
                    className="flex items-center space-x-2 p-2 text-gray-600 rounded-md hover:bg-gray-200 transition-colors w-full text-left"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span>Project Settings</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Navigation Tabs */}
      {selectedProject && (
        <div className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <nav className="flex space-x-8" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('view')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'view'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                View Photos
              </button>
              <button
                onClick={() => setActiveTab('import')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'import'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Import Photos
              </button>
              <button
                onClick={() => setActiveTab('tag')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'tag'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Tag Photos
              </button>
            </nav>
          </div>
        </div>
      )}

      {/* Universal Filter */}
      {selectedProject && (
        <UniversalFilter
          projectData={projectData}
          onFilterChange={setActiveFilters}
          disabled={activeTab === 'import'}
          isCollapsed={filtersCollapsed}
          onToggleCollapse={() => setFiltersCollapsed(!filtersCollapsed)}
        />
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {!selectedProject ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md mx-auto px-4">
              <div className="text-6xl mb-6">📸</div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Welcome to Photo Importer & Tagger
              </h2>
              {projects.length === 0 ? (
                <div className="space-y-6">
                  <p className="text-gray-600 mb-6">
                    Get started by creating your first project
                  </p>
                  <div className="flex justify-center">
                    <ProjectSelector 
                      projects={projects}
                      selectedProject={selectedProject}
                      onProjectSelect={handleProjectSelect}
                      onProjectCreate={handleProjectCreate}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <p className="text-gray-600 mb-6">
                    Select a project to get started
                  </p>
                  <div className="flex justify-center">
                    <ProjectSelector 
                      projects={projects}
                      selectedProject={selectedProject}
                      onProjectSelect={handleProjectSelect}
                      onProjectCreate={handleProjectCreate}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-600">Loading project data...</span>
          </div>
        ) : (
          <div>
            {/* Project Info */}
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">
                {selectedProject.name}
              </h2>
              <div className="flex space-x-6 text-sm text-gray-600">
                <span>📁 {selectedProject.folder}</span>
                <span>📷 {selectedProject.photo_count} photos</span>
                <span>📅 Created {new Date(selectedProject.created_at).toLocaleDateString()}</span>
              </div>
            </div>

            {/* Tab Content */}
            {activeTab === 'view' && projectData && (
              <div>
                <div className="flex justify-end items-center mb-4">
                  <span className="text-sm mr-2">View as:</span>
                  <button 
                    onClick={() => setViewMode('grid')}
                    className={`px-3 py-1 text-sm rounded-md ${viewMode === 'grid' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}>
                      Grid
                  </button>
                  <button 
                    onClick={() => setViewMode('table')}
                    className={`px-3 py-1 text-sm rounded-md ml-2 ${viewMode === 'table' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}>
                      Table
                  </button>
                </div>

                <PhotoDisplay 
                  viewMode={viewMode}
                  projectData={projectData}
                  projectFolder={selectedProject.folder}
                  onPhotoSelect={(photo) => handlePhotoSelect(photo, projectData?.photos)}
                  onToggleSelection={handleToggleSelection}
                  selectedPhotos={selectedPhotos}
                />
              </div>
            )}

            {activeTab === 'upload' && (
              <PhotoUpload
                projectFolder={selectedProject.folder}
                onPhotosUploaded={handlePhotosUploaded}
              />
            )}

            {activeTab === 'tag' && projectData && (
              <PhotoTagger
                projectData={projectData}
                projectFolder={selectedProject.folder}
                onTagsUpdated={handleTagsUpdated}
                onPhotoSelect={handlePhotoSelect} /* This will be used for the hover-view button */
                onToggleSelection={handleToggleSelection}
                selectedPhotos={selectedPhotos}
                setSelectedPhotos={setSelectedPhotos} // Pass down the setter for bulk actions
                config={config}
              />
            )}
          </div>
        )}
      </main>

      {viewerState.isOpen && (
        <PhotoViewer 
          projectData={viewerState.photoContext ? { photos: viewerState.photoContext } : projectData}
          projectFolder={selectedProject.folder}
          startIndex={viewerState.startIndex}
          onClose={handleCloseViewer}
          config={config}
        />
      )}

      {showSettings && (
        <Settings 
          project={selectedProject}
          config={config}
          onConfigUpdate={setConfig}
          onProjectDelete={() => {
            setShowSettings(false);
            handleProjectDeleted();
          }}
          onClose={() => setShowSettings(false)} 
        />
      )}


    </div>
  );
}

export default App;
