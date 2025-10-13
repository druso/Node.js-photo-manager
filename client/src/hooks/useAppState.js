import { useState, useRef, useMemo } from 'react';

/**
 * ARCHITECTURAL DECISION: Unified View Context
 * 
 * There is NO conceptual distinction between "All Photos" and "Project" views.
 * A Project view is simply the All Photos view with a project filter applied.
 * 
 * - Use view.project_filter (null = All Photos, string = specific project)
 * - Use unified selection model with PhotoRef objects
 * - Use unified modal states
 * 
 * IMPORTANT: Any code that treats these views differently should be refactored.
 * If you encounter branching based on "isAllMode" or separate handling for
 * All Photos vs Project views, please eliminate this distinction.
 */

/**
 * Core application state management hook
 * Extracts all basic state declarations from App.jsx
 */
export function useAppState() {
  // Project and data state
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectData, setProjectData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState(null);

  // Modal visibility state
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [optionsTab, setOptionsTab] = useState('settings'); // 'settings' | 'processes'
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showAllMoveModal, setShowAllMoveModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  // View state
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'table'
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [sizeLevel, setSizeLevel] = useState('m'); // 's' | 'm' | 'l'

  // Photo viewer state
  const [viewerState, setViewerState] = useState({ isOpen: false, startIndex: 0, fromAll: false });
  const [viewerList, setViewerList] = useState(null);

  // Selection state
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [allSelectedKeys, setAllSelectedKeys] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false); // M2: Long-press selection mode
  
  // Selection helpers
  const clearAllSelection = useMemo(() => () => {
    setAllSelectedKeys(new Set());
  }, []);
  
  const toggleAllSelection = useMemo(() => (key, force) => {
    setAllSelectedKeys(prev => {
      const next = new Set(prev);
      if (force === true || (force === undefined && !next.has(key))) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  // Unified view context
  const [view, setView] = useState({
    project_filter: null // null = All Photos, string = specific project folder
  });

  // Unified selection model
  const [selection, setSelection] = useState([]);

  // Unified modal state
  const [uiModals, setUiModals] = useState({
    move: {
      open: false,
      items: [],
      suggestedDestination: null
    }
  });

  // Shared link context (populated when viewing /shared/:hash)
  const [sharedLinkInfo, setSharedLinkInfo] = useState({
    title: null,
    description: null,
  });

  // Task and notification state
  const [taskDefs, setTaskDefs] = useState(null);
  const notifiedTasksRef = useRef(new Set());

  // All Photos pending deletions state (independent of filtered view)
  const [allPendingDeletes, setAllPendingDeletes] = useState({ 
    jpg: 0, 
    raw: 0, 
    total: 0, 
    byProject: new Set() 
  });

  // UI preferences state
  const [uiPrefsReady, setUiPrefsReady] = useState(false);

  // Refs for state management
  const previousProjectRef = useRef(null);
  const suppressUrlRef = useRef(null);
  const pendingOpenRef = useRef(null);
  const projectLocateTriedRef = useRef(false);
  const pendingSelectProjectRef = useRef(null);
  const mainRef = useRef(null);
  const initialSavedYRef = useRef(null);
  const windowScrollRestoredRef = useRef(false);
  const prefsLoadedOnceRef = useRef(false);
  const viewerRestoredRef = useRef(false);
  const uiPrefsLoadedRef = useRef(false);
  const uiPrefsReadyRef = useRef(false);
  const commitBarRef = useRef(null);

  const updateProjectFilter = useMemo(() => (newFilter) => {
    setView(prev => ({ ...prev, project_filter: newFilter }));
  }, []);
  
  // Active project tracking
  const [activeProject, setActiveProject] = useState(null);
  const registerActiveProject = useMemo(() => (project) => {
    setActiveProject(project);
  }, []);

  // Sync legacy selection state with unified selection
  const syncSelectionFromLegacy = useMemo(() => () => {
    if (view.project_filter === null) {
      // All Photos mode - convert from allSelectedKeys format
      // This would be handled in App.jsx where allSelectedKeys is defined
    } else {
      // Project mode - convert from selectedPhotos format
      const newSelection = Array.from(selectedPhotos).map(filename => ({
        project_folder: view.project_filter,
        filename
      }));
      setSelection(newSelection);
    }
  }, [selectedPhotos, view.project_filter]);

  // Sync move modal state
  const syncMoveModalState = useMemo(() => () => {
    const isOpen = showMoveModal || showAllMoveModal;
    if (isOpen !== uiModals.move.open) {
      setUiModals(prev => ({
        ...prev,
        move: {
          ...prev.move,
          open: isOpen
        }
      }));
    }
  }, [showMoveModal, showAllMoveModal, uiModals.move.open]);

  return {
    // New unified state
    view,
    setView,
    updateProjectFilter,
    selection,
    setSelection,
    uiModals,
    setUiModals,
    sharedLinkInfo,
    setSharedLinkInfo,

    // Project and data state
    projects,
    setProjects,
    selectedProject,
    setSelectedProject,
    projectData,
    setProjectData,
    loading,
    setLoading,
    config,
    setConfig,

    // Modal visibility state
    showOptionsModal,
    setShowOptionsModal,
    optionsTab,
    setOptionsTab,
    showCreateProject,
    setShowCreateProject,
    showMoveModal,
    setShowMoveModal,
    showAllMoveModal,
    setShowAllMoveModal,
    showShareModal,
    setShowShareModal,

    // View state
    viewMode,
    setViewMode,
    filtersCollapsed,
    setFiltersCollapsed,
    sizeLevel,
    setSizeLevel,

    // Photo viewer state
    viewerState,
    setViewerState,
    viewerList,
    setViewerList,

    // Selection state
    selectedPhotos,
    setSelectedPhotos,
    allSelectedKeys,
    setAllSelectedKeys,
    selectionMode,
    setSelectionMode,
    clearAllSelection,
    toggleAllSelection,
    
    // Active project tracking
    activeProject,
    setActiveProject,
    registerActiveProject,

    // Mode state
    // Task and notification state
    taskDefs,
    setTaskDefs,
    notifiedTasksRef,

    // All Photos pending deletions state
    allPendingDeletes,
    setAllPendingDeletes,

    // UI preferences state
    uiPrefsReady,
    setUiPrefsReady,

    // Refs
    previousProjectRef,
    suppressUrlRef,
    pendingOpenRef,
    projectLocateTriedRef,
    pendingSelectProjectRef,
    mainRef,
    initialSavedYRef,
    windowScrollRestoredRef,
    prefsLoadedOnceRef,
    viewerRestoredRef,
    uiPrefsLoadedRef,
    uiPrefsReadyRef,
    commitBarRef,
  };
}
