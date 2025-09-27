import { useState, useRef } from 'react';

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

  // View state
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'table'
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [sizeLevel, setSizeLevel] = useState('m'); // 's' | 'm' | 'l'

  // Photo viewer state
  const [viewerState, setViewerState] = useState({ isOpen: false, startIndex: 0, fromAll: false });
  const [viewerList, setViewerList] = useState(null);

  // Selection state
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());

  // Mode state
  const [isAllMode, setIsAllMode] = useState(false);

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

  return {
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

    // Mode state
    isAllMode,
    setIsAllMode,

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
