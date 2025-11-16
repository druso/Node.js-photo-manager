import { useEffect, useRef } from 'react';
import { listProjects, getConfig } from '../api/projectsApi';
import { fetchTaskDefinitions } from '../api/jobsApi';
import { listAllPendingDeletes } from '../api/allPhotosApi';
import { getSessionState, getLastProject, setLastProject } from '../utils/storage';

function normalizeFolderCandidate(value) {
  if (!value) return '';
  return String(value)
    .trim()
    .toLowerCase()
    // Collapse consecutive whitespace for more resilient matching
    .replace(/\s+/g, ' ')
    // Drop trailing " (n)" suffix so duplicate projects can be matched
    .replace(/\s+\(\d+\)$/g, '')
    .trim();
}

/**
 * ARCHITECTURAL DECISION: Unified View Context
 * 
 * There is NO conceptual distinction between "All Photos" and "Project" views.
 * A Project view is simply the All Photos view with a project filter applied.
 * 
 * This hook uses view.project_filter (null = All Photos, string = specific project)
 * while maintaining backward compatibility with isAllMode during the transition.
 */

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
  setViewMode,
  setSizeLevel,
  setFiltersCollapsed,
  setActiveFilters,
  setViewerState,
  setPendingSelectProjectRef,
  setAllDeepLink,
  setSortKey,
  setSortDir,
  
  // Unified view context
  view,
  setView,
  updateProjectFilter,
  
  // Current state
  projects,
  selectedProject,
  config,
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
      
      // Parse filter parameters from URL
      const urlFilters = {};
      const dateFrom = params.get('date_from');
      const dateTo = params.get('date_to');
      if (dateFrom || dateTo) {
        urlFilters.dateRange = { start: dateFrom || '', end: dateTo || '' };
      }
      const fileType = params.get('file_type');
      if (fileType && fileType !== 'any') urlFilters.fileType = fileType;
      const keepType = params.get('keep_type');
      if (keepType && keepType !== 'any') urlFilters.keepType = keepType;
      const orientation = params.get('orientation');
      if (orientation && orientation !== 'any') urlFilters.orientation = orientation;
      
      // Apply URL filters if any were found
      if (Object.keys(urlFilters).length > 0) {
        setActiveFilters(prev => ({ ...prev, ...urlFilters }));
      }
      
      // Parse sort parameters from URL
      const urlSort = params.get('sort');
      const urlDir = params.get('dir');
      if (urlSort && (urlSort === 'name' || urlSort === 'date' || urlSort === 'size')) {
        setSortKey(urlSort);
      }
      if (urlDir && (urlDir === 'asc' || urlDir === 'desc')) {
        setSortDir(urlDir);
      }
      
      // Parse showdetail parameter for viewer - will be applied when viewer opens
      const showDetail = params.get('showdetail') === '1';
      if (showDetail) {
        console.log('[useAppInitialization] Found showdetail=1 in URL');
        // Store in sessionStorage so PhotoViewer can read it
        try {
          sessionStorage.setItem('viewer_show_detail_from_url', '1');
        } catch {}
      }
      
      // Check for All Photos mode
      if (path === '/all' || params.get('mode') === 'all') {
        // Set unified view context
        updateProjectFilter(null);
        return;
      }
      
      // Handle project-specific URLs and viewer deep links
      // First check for /project/folder pattern
      let match = path.match(/^\/project\/([^\/]+)(?:\/photo\/(.+))?$/);

      // If not found, check for direct /folder or /folder/filename pattern
      if (!match && path && path !== '/') {
        const withoutLeadingSlash = path.startsWith('/') ? path.slice(1) : path;
        if (withoutLeadingSlash) {
          const segments = withoutLeadingSlash.split('/');
          const [first, ...rest] = segments;

          if (first === 'all') {
            updateProjectFilter(null);

            const projectSegment = rest[0];
            const photoSegment = rest.slice(1).join('/') || undefined;

            if (projectSegment && photoSegment && typeof setAllDeepLink === 'function') {
              setAllDeepLink({
                folder: decodeURIComponent(projectSegment),
                filename: decodeURIComponent(photoSegment),
              });
            }

            // All-mode deep links fully handled
            return;
          }

          if (first) {
            const rawPhoto = rest.length ? rest.join('/') : undefined;
            match = [path, first, rawPhoto];
          }
        }
      }

      if (match) {
        const projectFolder = match[1] || '';
        const photoPath = match[2]; // May be undefined
        const decodedFolder = decodeURIComponent(projectFolder);

        if (decodedFolder) {
          // Set unified view context
          updateProjectFilter(decodedFolder);

          if (photoPath && pendingOpenRef?.current !== undefined) {
            // Deep link to specific photo
            pendingOpenRef.current = {
              folder: decodedFolder,
              filename: decodeURIComponent(photoPath)
            };
            if (projectLocateTriedRef?.current !== undefined) {
              projectLocateTriedRef.current = false;
            }
          }
        }
        // Project will be selected when projects load
      }
    } catch (error) {
      console.error('Failed to parse URL:', error);
    }
  }, [updateProjectFilter, pendingOpenRef]);

  // Persist view context
  useEffect(() => {
    try { 
      // Store using the unified view context
      const isAllPhotosView = view.project_filter === null;
      localStorage.setItem('all_mode', isAllPhotosView ? '1' : '0'); 
    } catch {}
  }, [view.project_filter]);

  // Load UI prefs from localStorage on mount (only viewMode and sizeLevel)
  // NOTE: filtersCollapsed and activeFilters are no longer persisted
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
      // filtersCollapsed and activeFilters are no longer loaded from localStorage
      
      uiPrefsLoadedRef.current = true;
    } catch (error) {
      if (DEBUG_PERSIST) console.debug('[persist] failed to load ui_prefs:', error);
    } finally {
      uiPrefsReadyRef.current = true;
    }
  }, [setViewMode, setSizeLevel, uiPrefsLoadedRef, uiPrefsReadyRef, DEBUG_PERSIST]);

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
    // Use unified view context to determine if we're in All Photos view
    const isAllPhotosView = view.project_filter === null;
    if (isAllPhotosView) return;
    
    if (projects.length > 0 && !selectedProject) {
      // First check if we have a project filter from the URL
      if (view.project_filter) {
        if (import.meta?.env?.DEV) {
          console.log('Looking for project from URL filter:', view.project_filter);
        }

        let projectFromUrl = projects.find(p => p.folder === view.project_filter);
        if (!projectFromUrl) {
          const normalizedTarget = normalizeFolderCandidate(view.project_filter);
          if (normalizedTarget) {
            projectFromUrl = projects.find(p => normalizeFolderCandidate(p.folder) === normalizedTarget);
            if (projectFromUrl && import.meta?.env?.DEV) {
              console.log('Matched project via normalized folder name:', projectFromUrl.folder);
            }
          }
        }

        if (projectFromUrl) {
          if (projectFromUrl.folder !== view.project_filter) {
            // Align unified view context and URL to the canonical folder name
            updateProjectFilter(projectFromUrl.folder);
            try {
              window.history.replaceState({}, '', `/${encodeURIComponent(projectFromUrl.folder)}`);
            } catch {}
          }

          if (import.meta?.env?.DEV) {
            console.log('Using project from URL:', projectFromUrl.folder);
          }
          setSelectedProject(projectFromUrl);
          return;
        }

        if (import.meta?.env?.DEV) {
          console.log('Project from URL not found in projects list');
        }
      }
      
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
  }, [projects, selectedProject, config, view.project_filter, setSelectedProject, setPendingSelectProjectRef]);

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
  // Debounced to prevent excessive API calls when filters change rapidly
  useEffect(() => {
    // Use unified view context to determine if we're in All Photos view
    const isAllPhotosView = view.project_filter === null;
    if (!isAllPhotosView) return;
    
    // Debounce: wait 500ms after last filter change before fetching
    const timeoutId = setTimeout(() => {
      const fetchPendingDeletes = async () => {
        try {
          const range = activeFilters?.dateRange || {};
          // Don't pass keep_type to pending deletes API - it has its own internal filter
          const result = await listAllPendingDeletes({
            date_from: range.start || undefined,
            date_to: range.end || undefined,
            file_type: activeFilters?.fileType !== 'any' ? activeFilters?.fileType : undefined,
            orientation: activeFilters?.orientation !== 'any' ? activeFilters?.orientation : undefined,
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
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [view.project_filter, activeFilters?.dateRange, activeFilters?.fileType, activeFilters?.orientation, setAllPendingDeletes]);

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
