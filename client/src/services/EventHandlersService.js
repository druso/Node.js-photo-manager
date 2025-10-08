import { createProject } from '../api/projectsApi';

/**
 * Service for handling app event handlers
 * Extracted from App.jsx to reduce component size
 */
export class EventHandlersService {
  constructor({
    // State setters
    setProjects,
    setSelectedProject,
    setProjectData,
    setSelectedPhotos,
    setViewerState,
    setViewerList,
    setPendingSelectProjectRef,
    
    // Current state
    selectedProject,
    projectData,
    filteredProjectData,
    
    // Functions
    fetchProjectData,
    
    // Constants
    ALL_PROJECT_SENTINEL
  }) {
    this.setProjects = setProjects;
    this.setSelectedProject = setSelectedProject;
    this.setProjectData = setProjectData;
    this.setSelectedPhotos = setSelectedPhotos;
    this.setViewerState = setViewerState;
    this.setViewerList = setViewerList;
    this.setPendingSelectProjectRef = setPendingSelectProjectRef;
    this.selectedProject = selectedProject;
    this.projectData = projectData;
    this.filteredProjectData = filteredProjectData;
    this.fetchProjectData = fetchProjectData;
    this.ALL_PROJECT_SENTINEL = ALL_PROJECT_SENTINEL;
  }

  async handleProjectCreate(projectName) {
    try {
      const created = await createProject(projectName);
      const createdFolder = created?.project?.folder || created?.folder || created?.project_folder;
      if (!createdFolder) {
        console.error('Project creation response missing folder:', created);
        return;
      }
      
      // Add to projects list
      const newProject = {
        id: created?.project?.id || created?.id,
        folder: createdFolder,
        name: projectName,
        ...created?.project
      };
      
      this.setProjects(prev => [...prev, newProject]);
      
      // Set as pending selection (will be picked up by project selection effect)
      this.setPendingSelectProjectRef(createdFolder);
    } catch (error) {
      console.error('Failed to create project:', error);
      throw error;
    }
  }

  handlePhotosUploaded() {
    const currentFolder = this.selectedProject?.folder;
    if (currentFolder && currentFolder !== this.ALL_PROJECT_SENTINEL.folder) {
      const reload = this.fetchProjectData(currentFolder);
      Promise.resolve(reload)
        .catch(() => {})
        .finally(() => {
          // Additional cleanup if needed
        });
    }
  }

  handleTagsUpdated() {
    if (this.selectedProject) {
      this.fetchProjectData(this.selectedProject.folder);
    }
  }

  handleKeepBulkUpdated(updates) {
    // updates: [{ filename, keep_jpg, keep_raw }]
    this.setProjectData(prev => {
      if (!prev || !Array.isArray(prev.photos)) return prev;
      const updatedPhotos = prev.photos.map(photo => {
        const update = updates.find(u => u.filename === photo.filename);
        return update ? { ...photo, ...update } : photo;
      });
      return { ...prev, photos: updatedPhotos };
    });
  }

  handleTagsBulkUpdated(updates) {
    // updates: [{ filename, tags }]
    this.setProjectData(prev => {
      if (!prev || !Array.isArray(prev.photos)) return prev;
      const updatedPhotos = prev.photos.map(photo => {
        const update = updates.find(u => u.filename === photo.filename);
        return update ? { ...photo, tags: update.tags } : photo;
      });
      return { ...prev, photos: updatedPhotos };
    });
  }

  handleProjectDeleted() {
    // Force page refresh to ensure clean state after project deletion
    window.location.reload();
  }

  handleProjectRenamed(updated) {
    if (!updated || updated.id == null) return;
    this.setProjects(prev => prev.map(p => (p.id === updated.id ? { ...p, name: updated.name } : p)));
    this.setSelectedProject(prev => {
      if (!prev || prev.id !== updated.id) return prev;
      return { ...prev, name: updated.name };
    });
  }

  handlePhotoSelect(photo, photoContext = null) {
    const photos = Array.isArray(photoContext)
      ? photoContext
      : Array.isArray(this.filteredProjectData?.photos)
        ? this.filteredProjectData.photos
        : Array.isArray(this.projectData?.photos)
          ? this.projectData.photos
          : null;

    if (!Array.isArray(photos) || !photo) return;

    const startIndex = photos.findIndex(p => p?.filename === photo.filename);
    if (startIndex === -1) return;
    
    this.setViewerState({
      isOpen: true,
      startIndex,
      fromAll: false
    });
    this.setViewerList(photos);
  }

  handleKeepUpdated({ filename, keep_jpg, keep_raw }) {
    this.setProjectData(prev => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        photos: prev.photos.map(p => 
          p.filename === filename ? { ...p, keep_jpg, keep_raw } : p
        )
      };
      return updated;
    });
  }

  handleToggleSelection(photo) {
    this.setSelectedPhotos(prev => {
      const newSelection = new Set(prev);
      const photoId = photo.filename; // Use filename as unique identifier
      if (newSelection.has(photoId)) {
        newSelection.delete(photoId);
      } else {
        newSelection.add(photoId);
      }
      return newSelection;
    });
  }
}

/**
 * Hook to use the EventHandlersService
 */
export function useEventHandlers({
  // State setters
  setProjects,
  setSelectedProject,
  setProjectData,
  setSelectedPhotos,
  setViewerState,
  setViewerList,
  setPendingSelectProjectRef,
  
  // Current state
  selectedProject,
  projectData,
  filteredProjectData,
  
  // Functions
  fetchProjectData,
  
  // Constants
  ALL_PROJECT_SENTINEL
}) {
  const service = new EventHandlersService({
    setProjects,
    setSelectedProject,
    setProjectData,
    setSelectedPhotos,
    setViewerState,
    setViewerList,
    setPendingSelectProjectRef,
    selectedProject,
    projectData,
    filteredProjectData,
    fetchProjectData,
    ALL_PROJECT_SENTINEL
  });

  return {
    handleProjectCreate: service.handleProjectCreate.bind(service),
    handlePhotosUploaded: service.handlePhotosUploaded.bind(service),
    handleTagsUpdated: service.handleTagsUpdated.bind(service),
    handleKeepBulkUpdated: service.handleKeepBulkUpdated.bind(service),
    handleTagsBulkUpdated: service.handleTagsBulkUpdated.bind(service),
    handleProjectDeleted: service.handleProjectDeleted.bind(service),
    handleProjectRenamed: service.handleProjectRenamed.bind(service),
    handlePhotoSelect: service.handlePhotoSelect.bind(service),
    handleKeepUpdated: service.handleKeepUpdated.bind(service),
    handleToggleSelection: service.handleToggleSelection.bind(service)
  };
}
