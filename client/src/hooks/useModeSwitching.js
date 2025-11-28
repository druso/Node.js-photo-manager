import { useEffect, useRef } from 'react';

/**
 * Hook to handle switching between All Photos and Project views.
 *
 * A Project view is simply the All Photos view with a project filter applied.
 * This hook manages the state transitions when switching between views.
 */
export function useModeSwitching({
  // Unified view context
  view,
  updateProjectFilter,
  selection,
  setSelection,

  // Project state
  projects,
  selectedProject,
  previousProjectRef,
  pendingSelectProjectRef,
  ALL_PROJECT_SENTINEL,
  setSelectedProject,
  setProjectData,
  // setSelectedPhotos removed
  registerActiveProject,
  clearAllSelection,
  handleProjectSelect,
}) {
  // Remember which folder we're trying to load while projects are still fetching
  const pendingFolderRef = useRef(null);
  const prevViewRef = useRef(view?.project_filter);

  // Track the folder we're trying to load
  useEffect(() => {
    pendingFolderRef.current = view?.project_filter;
  }, [view?.project_filter]);

  // Main effect to handle view switching
  useEffect(() => {
    // Skip if view hasn't changed to avoid unnecessary updates
    if (prevViewRef.current === view?.project_filter) return;
    prevViewRef.current = view?.project_filter;

    // All Photos mode
    if (view?.project_filter === null) {
      // Only update if not already in All Photos mode
      if (selectedProject?.folder !== ALL_PROJECT_SENTINEL.folder) {
        previousProjectRef.current = selectedProject;
        setSelectedProject(ALL_PROJECT_SENTINEL);
        setProjectData(null);
        // setSelectedPhotos removed
        registerActiveProject(null);

        // Clear selections
        if (selection?.length > 0) {
          setSelection([]);
        }
        clearAllSelection();
      }

      // Always clear these refs
      pendingSelectProjectRef.current = null;
      pendingFolderRef.current = null;
      return;
    }

    // Project mode - handle folder change
    const targetFolder = view.project_filter;

    // Skip if already on the target project
    if (selectedProject?.folder === targetFolder) {
      pendingFolderRef.current = null;
      return;
    }

    // Find the target project in the projects list
    const targetProject = projects.find(p => p.folder === targetFolder);
    if (targetProject) {
      // Project found, select it
      handleProjectSelect(targetProject);
      pendingFolderRef.current = null;
      return;
    }

    // Projects list hasn't delivered this folder yet—keep it pending
    pendingFolderRef.current = targetFolder;
  }, [
    view?.project_filter,
    projects,
    selectedProject,
    selection,
    ALL_PROJECT_SENTINEL,
    setSelectedProject,
    setProjectData,
    // setSelectedPhotos removed
    registerActiveProject,
    setSelection,
    clearAllSelection,
    pendingSelectProjectRef,
    handleProjectSelect,
  ]);
}