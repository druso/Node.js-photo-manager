import { useEffect, useRef } from 'react';
import { listProjects, getConfig } from '../api/projectsApi';
import { fetchTaskDefinitions } from '../api/jobsApi';
import { listAllPendingDeletes } from '../api/allPhotosApi';
import { getSessionState, getLastProject, setLastProject } from '../utils/storage';

/**
 * Hook to handle app initialization logic
 * Extracts large initialization useEffect blocks from App.jsx
 */
export function useAppInitialization({
  // State setters
  setProjects,
  setConfig,
  setTaskDefs,
  setAllPendingDeletes,
  setSelectedProject,
  setIsAllMode,
  setViewMode,
  setSizeLevel,
  setFiltersCollapsed,
  setActiveFilters,
  setViewerState,
  setPendingSelectProjectRef,
  
  // Current state
  projects,
  selectedProject,
  config,
  isAllMode,
  activeFilters,
  
  // Refs
  uiPrefsLoadedRef,
  uiPrefsReadyRef,
  initialSavedYRef,
  windowScrollRestoredRef,
  prefsLoadedOnceRef,
  mainRef,
  pendingOpenRef,
  projectLocateTriedRef,
  
  // Other dependencies
  ALL_PROJECT_SENTINEL,
  DEBUG_PERSIST = false
}) {
  // Fetch all projects and config on component mount
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const data = await listProjects();
        setProjects(data || []);
      } catch (error) {
        console.error('Failed to fetch projects:', error);
        setProjects([]);
      }
    };

    const fetchConfig = async () => {
      try {
        const data = await getConfig();
        setConfig(data || {});
      } catch (error) {
        console.error('Failed to fetch config:', error);
        setConfig({});
      }
    };

    fetchProjects();
    fetchConfig();
  }, [setProjects, setConfig]);

  // Load task definitions once (client-side metadata)
  useEffect(() => {
    let alive = true;
    fetchTaskDefinitions()
      .then(d => { if (alive) setTaskDefs(d || {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, [setTaskDefs]);

  // Initialize All Photos or Project mode and deep-link viewer from URL
  useEffect(() => {
    try {
      const path = window.location?.pathname || '';
      const qs = window.location?.search || '';
      const params = new URLSearchParams(qs);
      
      // Check for All Photos mode
      if (path === '/all' || params.get('mode') === 'all') {
        setIsAllMode(true);
        return;
      }
      
      // Handle project-specific URLs and viewer deep links
      const match = path.match(/^\/project\/([^\/]+)(?:\/photo\/(.+))?$/);
      if (match) {
        const [, projectFolder, photoPath] = match;
        if (photoPath) {
          // Deep link to specific photo
          pendingOpenRef.current = {
            folder: decodeURIComponent(projectFolder),
            path: decodeURIComponent(photoPath)
          };
        }
        // Project will be selected when projects load
      }
    } catch (error) {
      console.error('Failed to parse URL:', error);
    }
  }, [setIsAllMode, pendingOpenRef]);

  // Persist All Photos mode
  useEffect(() => {
    try { 
      localStorage.setItem('all_mode', isAllMode ? '1' : '0'); 
    } catch {}
  }, [isAllMode]);

  // Load UI prefs from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('ui_prefs');
      if (!raw) { 
        if (DEBUG_PERSIST) console.debug('[persist] no ui_prefs found'); 
        uiPrefsReadyRef.current = true; 
        return; 
      }
      
      const prefs = JSON.parse(raw);
      if (DEBUG_PERSIST) console.debug('[persist] loaded ui_prefs:', prefs);
      
      if (prefs.viewMode) setViewMode(prefs.viewMode);
      if (prefs.sizeLevel) setSizeLevel(prefs.sizeLevel);
      if (typeof prefs.filtersCollapsed === 'boolean') setFiltersCollapsed(prefs.filtersCollapsed);
      if (prefs.activeFilters) setActiveFilters(prev => ({ ...prev, ...prefs.activeFilters }));
      
      uiPrefsLoadedRef.current = true;
    } catch (error) {
      if (DEBUG_PERSIST) console.debug('[persist] failed to load ui_prefs:', error);
    } finally {
      uiPrefsReadyRef.current = true;
    }
  }, [setViewMode, setSizeLevel, setFiltersCollapsed, setActiveFilters, uiPrefsLoadedRef, uiPrefsReadyRef, DEBUG_PERSIST]);

  // Apply UI defaults on config load (only if no saved UI prefs were found)
  useEffect(() => {
    if (!config) return;
    if (!uiPrefsLoadedRef.current) {
      if (config.ui?.default_view_mode === 'grid' || config.ui?.default_view_mode === 'table') {
        setViewMode(config.ui.default_view_mode);
      }
    }
  }, [config, setViewMode, uiPrefsLoadedRef]);

  // Remember last project (configurable)
  useEffect(() => {
    if (isAllMode) return;
    if (projects.length > 0 && !selectedProject) {
      // Prefer pending selection set by creation flow
      const pendingFolder = setPendingSelectProjectRef?.current;
      if (pendingFolder) {
        const pending = projects.find(p => p.folder === pendingFolder);
        if (pending) {
          setSelectedProject(pending);
          setPendingSelectProjectRef.current = null;
          return;
        }
      }
      
      // Fall back to last project or first project
      const remember = config?.ui?.remember_last_project !== false;
      if (remember) {
        const lastFolder = getLastProject();
        const lastProject = projects.find(p => p.folder === lastFolder);
        if (lastProject) {
          setSelectedProject(lastProject);
          return;
        }
      }
      
      // Default to first project
      if (projects[0]) {
        setSelectedProject(projects[0]);
      }
    }
  }, [projects, selectedProject, config, isAllMode, setSelectedProject, setPendingSelectProjectRef]);

  // Remember selected project (configurable)
  useEffect(() => {
    if (selectedProject && selectedProject.folder !== ALL_PROJECT_SENTINEL.folder) {
      const remember = config?.ui?.remember_last_project !== false;
      if (remember) {
        setLastProject(selectedProject.folder);
      }
    }
  }, [selectedProject, config, ALL_PROJECT_SENTINEL]);

  // Fetch pending deletions for All Photos mode
  useEffect(() => {
    if (!isAllMode) return;
    
    const fetchPendingDeletes = async () => {
      try {
        const range = activeFilters?.dateRange || {};
        const result = await listAllPendingDeletes({
          date_from: range.start || undefined,
          date_to: range.end || undefined,
          file_type: activeFilters?.fileType,
          orientation: activeFilters?.orientation,
        });
        setAllPendingDeletes({
          jpg: result.jpg || 0,
          raw: result.raw || 0,
          total: result.total || 0,
          byProject: new Set(result.byProject || []),
        });
      } catch (error) {
        console.debug('Failed to fetch pending deletions:', error);
        setAllPendingDeletes({ jpg: 0, raw: 0, total: 0, byProject: new Set() });
      }
    };

    fetchPendingDeletes();
  }, [isAllMode, activeFilters?.dateRange, activeFilters?.fileType, activeFilters?.orientation, setAllPendingDeletes]);

  // Persist and restore window scroll position (session-only)
  useEffect(() => {
    // Load saved Y for current session
    try {
      const st = getSessionState();
      if (st && typeof st.windowY === 'number') {
        initialSavedYRef.current = st.windowY;
      }
    } catch {}
  }, [initialSavedYRef]);

  // Re-apply saved window scroll once after initial content render
  useEffect(() => {
    if (windowScrollRestoredRef.current) return;
    if (initialSavedYRef.current == null) return;
    const y = initialSavedYRef.current;
    
    const restore = () => {
      try {
        window.scrollTo(0, y);
        windowScrollRestoredRef.current = true;
      } catch {}
    };
    
    // Try immediate, then with delays for content loading
    restore();
    setTimeout(restore, 50);
    setTimeout(restore, 200);
  }, [initialSavedYRef, windowScrollRestoredRef]);

  // Reset the project locate attempt guard on context changes
  useEffect(() => {
    if (pendingOpenRef.current) {
      projectLocateTriedRef.current = false;
    }
  }, [selectedProject?.folder, activeFilters?.dateRange, activeFilters?.fileType, activeFilters?.keepType, activeFilters?.orientation, pendingOpenRef, projectLocateTriedRef]);
}
