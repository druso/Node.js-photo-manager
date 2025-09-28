import { clearSessionState } from '../utils/storage';

/**
 * Service for handling project navigation and mode switching
 * Extracted from App.jsx to reduce component size
 * 
 * ARCHITECTURAL DECISION: Unified View Context
 * There is NO conceptual distinction between "All Photos" and "Project" views.
 * A Project view is simply the All Photos view with a project filter applied.
 * 
 * This service has been updated to use the unified view context while maintaining
 * backward compatibility with the legacy isAllMode flag during the transition period.
 */
export class ProjectNavigationService {
  constructor({
    // Unified view context
    view,
    updateProjectFilter,
    
    // State setters
    setSelectedProject,
    setProjectData,
    setSelectedPhotos,
    setIsAllMode,
    
    // Current state
    selectedProject,
    isAllMode,
    activeFilters,
    
    // Refs
    previousProjectRef,
    windowScrollRestoredRef,
    initialSavedYRef,
    pendingOpenRef,
    
    // Functions
    registerActiveProject,
    fetchProjectData,
    clearAllSelection,
    
    // Constants
    ALL_PROJECT_SENTINEL
  }) {
    // Unified view context
    this.view = view;
    this.updateProjectFilter = updateProjectFilter;
    
    // Legacy properties
    this.setSelectedProject = setSelectedProject;
    this.setProjectData = setProjectData;
    this.setSelectedPhotos = setSelectedPhotos;
    this.setIsAllMode = setIsAllMode;
    this.selectedProject = selectedProject;
    this.isAllMode = isAllMode;
    this.activeFilters = activeFilters;
    this.previousProjectRef = previousProjectRef;
    this.windowScrollRestoredRef = windowScrollRestoredRef;
    this.initialSavedYRef = initialSavedYRef;
    this.pendingOpenRef = pendingOpenRef;
    this.registerActiveProject = registerActiveProject;
    this.fetchProjectData = fetchProjectData;
    this.clearAllSelection = clearAllSelection;
    this.ALL_PROJECT_SENTINEL = ALL_PROJECT_SENTINEL;
  }

  handleProjectSelect(project) {
    // Handle null/invalid project selection (e.g., dropdown placeholder)
    if (!project || !project.folder) {
      this.setSelectedProject(null);
      this.registerActiveProject(null);
      this.setProjectData(null);
      this.setSelectedPhotos(new Set());
      return;
    }
    
    if (project.folder === this.ALL_PROJECT_SENTINEL.folder) {
      // Update unified view context - set project_filter to null for All Photos view
      this.updateProjectFilter(null);
      this.setIsAllMode(true);
      return;
    }
    
    // Update unified view context - set project_filter to the selected project folder
    this.updateProjectFilter(project.folder);
    
    // Clear session state only when switching away from an already selected project
    // Avoid clearing on initial selection after a reload (selectedProject is null then)
    const isSwitchingToDifferent = !!(this.selectedProject?.folder && this.selectedProject.folder !== project.folder);
    if (isSwitchingToDifferent) {
      try { clearSessionState(); } catch {}
      this.windowScrollRestoredRef.current = false;
      this.initialSavedYRef.current = null;
    }
    
    this.setSelectedProject(project);
    this.previousProjectRef.current = project;
    this.registerActiveProject(project);
    this.fetchProjectData(project.folder);
    this.setSelectedPhotos(new Set()); // Clear selection when switching projects
    
    // Sync URL to project base when not in All Photos mode, unless we are in a pending deep link open
    try {
      if (!this.isAllMode && project?.folder) {
        const pending = this.pendingOpenRef.current;
        const isPendingDeepLink = !!(pending && pending.folder === project.folder);
        if (!isPendingDeepLink) {
          window.history.pushState({}, '', `/${encodeURIComponent(project.folder)}`);
        }
      }
    } catch {}
  }

  toggleAllMode() {
    this.setIsAllMode(prev => {
      const next = !prev;
      try {
        if (next) {
          // Update unified view context - set project_filter to null for All Photos view
          this.updateProjectFilter(null);
          
          const range = (this.activeFilters?.dateRange) || {};
          const qp = new URLSearchParams();
          if (range.start) qp.set('date_from', range.start);
          if (range.end) qp.set('date_to', range.end);
          if (this.activeFilters?.fileType && this.activeFilters.fileType !== 'any') qp.set('file_type', this.activeFilters.fileType);
          if (this.activeFilters?.keepType && this.activeFilters.keepType !== 'any') qp.set('keep_type', this.activeFilters.keepType);
          if (this.activeFilters?.orientation && this.activeFilters.orientation !== 'any') qp.set('orientation', this.activeFilters.orientation);
          const search = qp.toString();
          window.history.pushState({}, '', `/all${search ? `?${search}` : ''}`);
        } else {
          // Update unified view context - set project_filter to the selected project folder
          this.updateProjectFilter(this.selectedProject?.folder || null);
          
          if (this.selectedProject?.folder) {
            window.history.pushState({}, '', `/${encodeURIComponent(this.selectedProject.folder)}`);
          } else {
            window.history.pushState({}, '', '/');
          }
        }
      } catch {}
      return next;
    });
    
    // Clear selections when switching modes
    this.setSelectedPhotos(new Set());
    this.clearAllSelection();
  }
}

/**
 * Hook to use the ProjectNavigationService
 * 
 * ARCHITECTURAL DECISION: Unified View Context
 * There is NO conceptual distinction between "All Photos" and "Project" views.
 * A Project view is simply the All Photos view with a project filter applied.
 */
export function useProjectNavigation({
  // Unified view context
  view,
  updateProjectFilter,
  
  // State setters
  setSelectedProject,
  setProjectData,
  setSelectedPhotos,
  setIsAllMode,
  
  // Current state
  selectedProject,
  isAllMode,
  activeFilters,
  
  // Refs
  previousProjectRef,
  windowScrollRestoredRef,
  initialSavedYRef,
  pendingOpenRef,
  
  // Functions
  registerActiveProject,
  fetchProjectData,
  clearAllSelection,
  
  // Constants
  ALL_PROJECT_SENTINEL
}) {
  const service = new ProjectNavigationService({
    // Unified view context
    view,
    updateProjectFilter,
    
    // Legacy properties
    setSelectedProject,
    setProjectData,
    setSelectedPhotos,
    setIsAllMode,
    selectedProject,
    isAllMode,
    activeFilters,
    previousProjectRef,
    windowScrollRestoredRef,
    initialSavedYRef,
    pendingOpenRef,
    registerActiveProject,
    fetchProjectData,
    clearAllSelection,
    ALL_PROJECT_SENTINEL
  });

  return {
    handleProjectSelect: service.handleProjectSelect.bind(service),
    toggleAllMode: service.toggleAllMode.bind(service)
  };
}
