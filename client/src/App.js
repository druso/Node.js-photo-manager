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
  const [activeTab, setActiveTab] = useState('view');
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [config, setConfig] = useState(null);
  const [viewerState, setViewerState] = useState({ isOpen: false, startIndex: 0 });
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'table'
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [activeFilters, setActiveFilters] = useState({
    textSearch: '',
    dateRange: { start: '', end: '' }, // Only date_time_original field is used
    rawAvailable: false,
    orientation: 'any'
  });

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

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects');
      if (response.ok) {
        const data = await response.json();
        setProjects(data);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
  };

  const fetchProjectData = async (projectFolder) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectFolder}`);
      if (response.ok) {
        const data = await response.json();
        setProjectData(data);
      }
    } catch (error) {
      console.error('Error fetching project data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProjectSelect = (project) => {
    // Handle null/invalid project selection (e.g., dropdown placeholder)
    if (!project || !project.folder) {
      setSelectedProject(null);
      setProjectData(null);
      setSelectedPhotos(new Set());
      return;
    }
    
    setSelectedProject(project);
    fetchProjectData(project.folder);
    setSelectedPhotos(new Set()); // Clear selection when switching projects
  };

  const handleProjectCreate = async (projectName) => {
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName }),
      });
      
      if (response.ok) {
        const newProject = await response.json();
        await fetchProjects();
        handleProjectSelect(newProject);
      }
    } catch (error) {
      console.error('Error creating project:', error);
    }
  };

  const handlePhotosUploaded = () => {
    if (selectedProject) {
      fetchProjectData(selectedProject.folder);
    }
  };

  const handleTagsUpdated = () => {
    if (selectedProject) {
      fetchProjectData(selectedProject.folder);
    }
  };

  const handleProjectDeleted = () => {
    // Force page refresh to ensure clean state after project deletion
    window.location.reload();
  };

  const handlePhotoSelect = (photo, photoContext = null) => {
    if (!projectData?.photos) return;
    
    const photos = photoContext || projectData.photos;
    const photoIndex = photos.findIndex(p => p.filename === photo.filename);
    
    setViewerState({
      isOpen: true,
      startIndex: photoIndex >= 0 ? photoIndex : 0,
      photoContext: photoContext
    });
  };

  const handleCloseViewer = () => {
    setViewerState({ isOpen: false, startIndex: 0 });
  };

  const handleToggleSelection = (photo) => {
    setSelectedPhotos(prev => {
      const newSelection = new Set(prev);
      const photoId = photo.filename; // Use filename as unique identifier
      
      if (newSelection.has(photoId)) {
        newSelection.delete(photoId);
      } else {
        newSelection.add(photoId);
      }
      
      return newSelection;
    });
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

  // Filter photos based on active filters
  const getFilteredPhotos = () => {
    if (!projectData?.photos) return [];
    
    return projectData.photos.filter((photo, index) => {
      // Text search filter
      if (activeFilters.textSearch) {
        const searchTerm = activeFilters.textSearch.toLowerCase();
        const matchesFilename = photo.filename?.toLowerCase().includes(searchTerm);
        const matchesTags = photo.tags?.some(tag => tag.toLowerCase().includes(searchTerm));
        const matchesMetadata = photo.metadata && Object.values(photo.metadata).some(value => 
          typeof value === 'string' && value.toLowerCase().includes(searchTerm)
        );
        
        if (!matchesFilename && !matchesTags && !matchesMetadata) {
          return false;
        }
      }
      
      // Date range filter (only uses date_time_original field)
      if (activeFilters.dateRange?.start || activeFilters.dateRange?.end) {
        const photoDate = photo.date_time_original;
        if (photoDate) {
          const date = new Date(photoDate).toISOString().split('T')[0];
          
          if (activeFilters.dateRange.start && date < activeFilters.dateRange.start) {
            return false;
          }
          
          if (activeFilters.dateRange.end && date > activeFilters.dateRange.end) {
            return false;
          }
        }
      }
      
      // Raw available filter (boolean only - no "Any" state)
      if (activeFilters.rawAvailable === true) {
        if (!photo.raw_available) {
          return false;
        }
      }
      
      // Orientation filter
      if (activeFilters.orientation && activeFilters.orientation !== 'any') {
        const width = photo.metadata?.exif_image_width || photo.metadata?.ExifImageWidth || photo.metadata?.ImageWidth;
        const height = photo.metadata?.exif_image_height || photo.metadata?.ExifImageHeight || photo.metadata?.ImageHeight;
        const orientation = photo.metadata?.orientation || photo.metadata?.Orientation || 1;
        
        // Debug logging - remove this after fixing
        if (index === 0) { // Debug first photo only
          console.log('Orientation filter debug for:', photo.filename);
          console.log('Available metadata keys:', Object.keys(photo.metadata || {}));
          console.log('EXIF orientation value:', orientation);
          console.log('Raw dimensions:', { width, height });
        }
        
        if (width && height) {
          // Determine actual orientation considering EXIF rotation
          let actuallyVertical, actuallyHorizontal;
          
          // EXIF orientation values: 1=normal, 6=90°CW, 8=90°CCW, 3=180°
          if (orientation === 6 || orientation === 8) {
            // Image is rotated 90°, so dimensions are swapped
            actuallyVertical = width > height;  // Swapped!
            actuallyHorizontal = height > width; // Swapped!
          } else {
            // Normal orientation or 180° rotation (dimensions not swapped)
            actuallyVertical = height > width;
            actuallyHorizontal = width > height;
          }
          
          console.log('Final orientation determination:', {
            actuallyVertical,
            actuallyHorizontal,
            orientationValue: orientation
          });
          
          if (activeFilters.orientation === 'vertical' && !actuallyVertical) return false;
          if (activeFilters.orientation === 'horizontal' && !actuallyHorizontal) return false;
        } else {
          // If no width/height data, exclude from orientation filtering
          return false;
        }
      }
      
      return true;
    });
  };

  // Get filtered photos for display
  const filteredPhotos = getFilteredPhotos();
  const filteredProjectData = projectData ? {
    ...projectData,
    photos: filteredPhotos
  } : null;

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
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 616 0z" />
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
          <div className="bg-white border-b relative">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center">
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
                    onClick={() => setActiveTab('upload')}
                    className={`py-4 px-1 border-b-2 font-medium text-sm ${
                      activeTab === 'upload'
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
                
                {/* Filter Button */}
                <button
                  onClick={() => setFiltersCollapsed(!filtersCollapsed)}
                  disabled={activeTab === 'upload'}
                  className={`flex items-center space-x-2 py-4 px-3 text-sm font-medium transition-colors ${
                    activeTab === 'upload'
                      ? 'text-gray-400 cursor-not-allowed'
                      : 'text-gray-700 hover:text-gray-900'
                  }`}
                >
                  {/* Desktop Filter Button */}
                  <span className="hidden sm:inline">Filters</span>
                  {/* Mobile Filter Icon */}
                  <svg className="h-5 w-5 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                  </svg>
                  {/* Active Filter Indicator - Notification Dot */}
                  {(activeFilters.textSearch || 
                    activeFilters.dateRange?.start || 
                    activeFilters.dateRange?.end || 
                    activeFilters.rawAvailable === true || 
                    activeFilters.orientation !== 'any') && (
                    <>
                      {/* Desktop: Show "Active" text */}
                      <span className="hidden sm:inline bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                        Active
                      </span>
                      {/* Mobile: Show notification dot */}
                      <span className="sm:hidden w-2 h-2 bg-blue-500 rounded-full"></span>
                    </>
                  )}
                  {/* Chevron */}
                  <svg className={`h-4 w-4 transition-transform ${filtersCollapsed ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              
              {/* Photo Count */}
              <div className="px-4 pb-2 flex justify-end">
                <p className="text-xs text-gray-500">
                  {filteredPhotos.length === (projectData?.photos?.length || 0) ? (
                    `${projectData?.photos?.length || 0} photos`
                  ) : (
                    <>
                      <span className="font-bold">{filteredPhotos.length}</span> of {projectData?.photos?.length || 0} photos
                    </>
                  )}
                </p>
              </div>
            </div>
            
            {/* Universal Filter Dropdown */}
            {!filtersCollapsed && (
              <div className="absolute top-full left-0 right-0 bg-white border-b shadow-lg z-40">
                <UniversalFilter
                  projectData={projectData}
                  filters={activeFilters}
                  onFilterChange={setActiveFilters}
                  disabled={activeTab === 'upload'}
                />
              </div>
            )}
          </div>
        )}
      </div>

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
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-2 pb-8">


            {activeTab === 'view' && (
              <div>
                {/* View Mode Toggle */}
                <div className="flex justify-between items-center mb-6">
                  <div className="flex space-x-2">
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`px-4 py-2 text-sm font-medium rounded-md ${
                        viewMode === 'grid'
                          ? 'bg-blue-100 text-blue-700'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Grid
                    </button>
                    <button
                      onClick={() => setViewMode('table')}
                      className={`px-4 py-2 text-sm font-medium rounded-md ${
                        viewMode === 'table'
                          ? 'bg-blue-100 text-blue-700'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Table
                    </button>
                  </div>
                </div>

                <PhotoDisplay 
                  viewMode={viewMode}
                  projectData={filteredProjectData}
                  projectFolder={selectedProject.folder}
                  onPhotoSelect={(photo) => handlePhotoSelect(photo, filteredPhotos)}
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
                projectData={filteredProjectData}
                projectFolder={selectedProject.folder}
                onTagsUpdated={handleTagsUpdated}
                onPhotoSelect={handlePhotoSelect}
                onToggleSelection={handleToggleSelection}
                selectedPhotos={selectedPhotos}
                setSelectedPhotos={setSelectedPhotos}
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
