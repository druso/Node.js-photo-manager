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

    // Current state
    selectedProject,
    activeFilters,
    projects,

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
    this.selectedProject = selectedProject;
    this.activeFilters = activeFilters;
    this.projects = projects;
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
      if (this.clearAllSelection) this.clearAllSelection();
      return;
    }

    if (project.folder === this.ALL_PROJECT_SENTINEL.folder) {
      // Update unified view context - set project_filter to null for All Photos view
      this.updateProjectFilter(null);
      return;
    }

    // Update unified view context - set project_filter to the selected project folder
    this.updateProjectFilter(project.folder);

    // Clear session state only when switching away from an already selected project
    // Avoid clearing on initial selection after a reload (selectedProject is null then)
    const isSwitchingToDifferent = !!(this.selectedProject?.folder && this.selectedProject.folder !== project.folder);
    if (isSwitchingToDifferent) {
      try { clearSessionState(); } catch { }
      this.windowScrollRestoredRef.current = false;
      this.initialSavedYRef.current = null;
    }

    this.setSelectedProject(project);
    this.previousProjectRef.current = project;
    this.registerActiveProject(project);
    this.fetchProjectData(project.folder);
    if (this.clearAllSelection) this.clearAllSelection(); // Clear selection when switching projects

    // Sync URL to project base, unless we are in a pending deep link open
    // Note: We use project.folder directly instead of checking view.project_filter
    // because the state update from updateProjectFilter() above is async
    try {
      if (project?.folder) {
        const pending = this.pendingOpenRef.current;
        const isPendingDeepLink = !!(pending && pending.folder === project.folder);
        if (!isPendingDeepLink) {
          const newUrl = `/${encodeURIComponent(project.folder)}`;
          console.log('[ProjectNav] Updating URL to:', newUrl, {
            projectFolder: project.folder,
            currentUrl: window.location.pathname
          });
          window.history.pushState({}, '', newUrl);
        } else {
          console.log('[ProjectNav] Skipping URL update (pending deep link):', {
            projectFolder: project.folder,
            pending
          });
        }
      } else {
        console.log('[ProjectNav] Skipping URL update (no project folder):', {
          projectFolder: project?.folder
        });
      }
    } catch (err) {
      console.error('[ProjectNav] URL update failed:', err);
    }
  }

  toggleAllMode() {
    const currentlyAll = this.view?.project_filter === null;
    const nextIsAll = !currentlyAll;

    console.log('[toggle] Current state:', {
      currentlyAll,
      nextIsAll,
      currentView: this.view,
      selectedProject: this.selectedProject,
      previousProject: this.previousProjectRef.current
    });

    try {
      if (nextIsAll) {
        // Switching TO All Photos mode
        this.updateProjectFilter(null);

        // Remember previous project for when we switch back
        if (this.selectedProject && this.selectedProject.folder !== this.ALL_PROJECT_SENTINEL.folder) {
          this.previousProjectRef.current = this.selectedProject;
        }

        // Set URL to /all with any active filters
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
        // Switching FROM All Photos mode

        // Use previous project if available, otherwise use first project in list
        let targetProject = this.previousProjectRef.current;

        // If no previous project is stored, use the first available project
        if (!targetProject && this.projects && this.projects.length > 0) {
          targetProject = this.projects[0];
          console.log('[toggle] No previous project, using first available:', targetProject);
        }

        const targetFolder = targetProject?.folder || null;
        console.log('[toggle] Switching to project mode with target:', targetProject);

        // If we have a valid project, select it directly
        if (targetProject) {
          this.handleProjectSelect(targetProject);
        } else {
          // Otherwise just update the filter
          this.updateProjectFilter(targetFolder);
        }

        // Update URL
        if (targetFolder) {
          window.history.pushState({}, '', `/${encodeURIComponent(targetFolder)}`);
        } else {
          window.history.pushState({}, '', '/');
        }
      }
    } catch (error) {
      console.error('Error toggling All Photos mode:', error);
    }

    if (this.clearAllSelection) this.clearAllSelection();
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
  // setSelectedPhotos removed

  // Current state
  selectedProject,
  activeFilters,
  projects,

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
    // setSelectedPhotos removed
    selectedProject,
    activeFilters,
    projects,
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
