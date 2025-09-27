import { getProject } from '../api/projectsApi';
import { getSessionState } from '../utils/storage';

/**
 * Service for handling project data operations
 * Extracted from App.jsx to reduce component size
 */
export class ProjectDataService {
  constructor({
    setLoading,
    setProjectData,
    resetProjectPagination,
    setViewerState,
    mainRef,
    viewerState
  }) {
    this.setLoading = setLoading;
    this.setProjectData = setProjectData;
    this.resetProjectPagination = resetProjectPagination;
    this.setViewerState = setViewerState;
    this.mainRef = mainRef;
    this.viewerState = viewerState;
  }

  async fetchProjectData(projectFolder) {
    // Capture UI state to restore after data updates
    const savedWindowY = (() => {
      const live = window.scrollY || window.pageYOffset || 0;
      try {
        const st = getSessionState();
        return (st && typeof st.windowY === 'number') ? st.windowY : live;
      } catch { return live; }
    })();
    
    const mainEl = this.mainRef.current;
    const savedMainY = (() => {
      const live = mainEl ? mainEl.scrollTop : 0;
      try {
        const st = getSessionState();
        return (st && typeof st.mainY === 'number') ? st.mainY : live;
      } catch { return live; }
    })();
    
    const savedViewer = (() => {
      try { 
        const st = getSessionState(); 
        return (st && st.viewer) ? st.viewer : (this.viewerState || { isOpen: false }); 
      }
      catch { return this.viewerState || { isOpen: false }; }
    })();

    this.setLoading(true);
    try {
      const data = await getProject(projectFolder);
      this.setProjectData(data);
      // Kick off initial paginated load (do not await to keep UI responsive)
      try { this.resetProjectPagination(); } catch {}
    } catch (error) {
      // Error fetching project data
      console.error('Failed to fetch project data:', error);
    } finally {
      // Restore scroll and viewer context on next frame(s); retry a couple frames for layout settle
      try {
        requestAnimationFrame(() => {
          try { window.scrollTo(0, savedWindowY); } catch {}
          if (mainEl) { try { mainEl.scrollTop = savedMainY; } catch {} }
          if (savedViewer && savedViewer.isOpen) {
            this.setViewerState(prev => ({ ...(prev || {}), ...savedViewer, isOpen: true }));
          }
          // second tick in case images/layout shift
          requestAnimationFrame(() => {
            try { window.scrollTo(0, savedWindowY); } catch {}
            if (mainEl) { try { mainEl.scrollTop = savedMainY; } catch {} }
          });
        });
      } catch {}
      this.setLoading(false);
    }
  }
}

/**
 * Hook to use the ProjectDataService
 */
export function useProjectDataService({
  setLoading,
  setProjectData,
  resetProjectPagination,
  setViewerState,
  mainRef,
  viewerState
}) {
  const service = new ProjectDataService({
    setLoading,
    setProjectData,
    resetProjectPagination,
    setViewerState,
    mainRef,
    viewerState
  });

  return {
    fetchProjectData: service.fetchProjectData.bind(service)
  };
}
