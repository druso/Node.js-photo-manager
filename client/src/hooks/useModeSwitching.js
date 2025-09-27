import { useEffect } from 'react';
import { getLastProject } from '../utils/storage';

/**
 * Hook to handle switching between All Photos and Project modes
 * Extracts mode switching logic from App.jsx
 */
export function useModeSwitching({
  isAllMode,
  projects,
  selectedProject,
  previousProjectRef,
  pendingSelectProjectRef,
  ALL_PROJECT_SENTINEL,
  setSelectedProject,
  setProjectData,
  setSelectedPhotos,
  registerActiveProject,
  clearAllSelection,
  handleProjectSelect,
}) {
  useEffect(() => {
    if (isAllMode) {
      if (selectedProject && selectedProject.folder !== ALL_PROJECT_SENTINEL.folder) {
        previousProjectRef.current = selectedProject;
      }
      setSelectedProject(prev => (prev && prev.folder === ALL_PROJECT_SENTINEL.folder) ? prev : ALL_PROJECT_SENTINEL);
      setProjectData(null);
      setSelectedPhotos(new Set());
      registerActiveProject(null);
      clearAllSelection();
      pendingSelectProjectRef.current = null;
    } else {
      if (!selectedProject || selectedProject.folder === ALL_PROJECT_SENTINEL.folder) {
        const fallback = previousProjectRef.current
          || projects.find(p => p.folder === getLastProject())
          || projects[0]
          || null;
        if (fallback && fallback.folder !== ALL_PROJECT_SENTINEL.folder) {
          handleProjectSelect(fallback);
        } else {
          setSelectedProject(null);
          setProjectData(null);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAllMode, projects]);
}
