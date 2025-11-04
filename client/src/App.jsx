import React, { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { listProjects, getProject, createProject } from './api/projectsApi';
import { locateProjectPhotosPage } from './api/photosApi';
import { listAllPendingDeletes } from './api/allPhotosApi';
import { getSharedLink } from './api/sharedLinksApi';
import { getLinksForPhoto } from './api/sharedLinksManagementApi';
import ProjectSelector from './components/ProjectSelector';
import PhotoDisplay from './components/PhotoDisplay';
import OperationsMenu from './components/OperationsMenu';
// OptionsMenu removed: hamburger opens unified panel directly
import SettingsProcessesModal from './components/SettingsProcessesModal';
import { fetchTaskDefinitions } from './api/jobsApi';
import PhotoViewer from './components/PhotoViewer';
import ErrorBoundary from './components/ErrorBoundary';
// Settings rendered via SettingsProcessesModal
import UniversalFilter from './components/UniversalFilter';
import SelectionToolbar from './components/SelectionToolbar';
import ViewModeControls from './components/ViewModeControls';
import AllPhotosPane from './components/AllPhotosPane';
import useAllPhotosViewer from './hooks/useAllPhotosViewer';
import useAllPhotosSelection from './hooks/useAllPhotosSelection';
import useAllPhotosUploads from './hooks/useAllPhotosUploads';
import useProjectSse from './hooks/useProjectSse';
import useViewerSync from './hooks/useViewerSync';
import { usePhotoDeepLinking } from './hooks/usePhotoDeepLinking';
import { useScrollRestoration } from './hooks/useScrollRestoration';
import { useFilterCalculations } from './hooks/useFilterCalculations';
import { useModeSwitching } from './hooks/useModeSwitching';
import { usePendingDeletes } from './hooks/usePendingDeletes';
import { usePendingChangesSSE } from './hooks/usePendingChangesSSE';
import { usePhotoDataRefresh } from './hooks/usePhotoDataRefresh';
import { useCommitBarLayout } from './hooks/useCommitBarLayout';
import { UploadProvider } from './upload/UploadContext';
import UploadConfirmModal from './components/UploadConfirmModal';
import BottomUploadBar from './components/BottomUploadBar';
import GlobalDragDrop from './components/GlobalDragDrop';
import './App.css';
import { useToast } from './ui/toast/ToastContext';
import UnifiedSelectionModal from './components/UnifiedSelectionModal';
import ProjectSelectionModal from './components/ProjectSelectionModal';
import UploadHandler from './components/UploadHandler';
import { getSessionState, setSessionWindowY, setSessionMainY, getLastProject, setLastProject } from './utils/storage';
import useAllPhotosPagination, { stripKnownExt, useProjectPagination } from './hooks/useAllPhotosPagination';
import UploadButton from './components/UploadButton';
import { PublicHashProvider } from './contexts/PublicHashContext';
import { useAuth } from './auth/AuthContext';

// New modular components
import SortControls from './components/SortControls';
import CommitRevertBar from './components/CommitRevertBar';
import CommitModal from './components/CommitModal';
import RevertModal from './components/RevertModal';
import CreateProjectModal from './components/CreateProjectModal';
import MainContentRenderer from './components/MainContentRenderer';
import SelectionModeBanner from './components/SelectionModeBanner';

// New hooks
import { useCommitRevert } from './hooks/useCommitRevert';
import { useUrlSync } from './hooks/useUrlSync';
import { useAppState } from './hooks/useAppState';
import { useFiltersAndSort } from './hooks/useFiltersAndSort';
import { useProjectDataService } from './services/ProjectDataService';
import { useAppInitialization } from './hooks/useAppInitialization';
import { usePersistence } from './hooks/usePersistence';
import { useEventHandlers } from './services/EventHandlersService';
import { usePhotoFiltering } from './hooks/usePhotoFiltering';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useProjectNavigation } from './services/ProjectNavigationService';
import { useSharedLinkData } from './hooks/useSharedLinkData';

const ALL_PROJECT_SENTINEL = Object.freeze({ folder: '__all__', name: 'All Photos' });

function App({ sharedLinkHash = null, initialPhotoName = null }) {
  const { isAuthenticated } = useAuth();
  // Get app state with unified view context
  const {
    // Unified view context
    view, setView, updateProjectFilter, selection, setSelection,
    
    // Legacy properties (for backward compatibility)
    projects, setProjects,
    selectedProject, setSelectedProject,
    projectData, setProjectData,
    allPhotos: appStateAllPhotos, setAllPhotos,
    allSelectedKeys: appStateAllSelectedKeys, setAllSelectedKeys,
    toggleAllSelection: appStateToggleAllSelection, clearAllSelection: appStateClearAllSelection,
    registerActiveProject: appStateRegisterActiveProject,
    activeProject, setActiveProject,
    config, setConfig,
    viewerState, setViewerState,
    viewerList, setViewerList,
    viewMode, setViewMode,
    selectedPhotos, setSelectedPhotos,
    filtersCollapsed, setFiltersCollapsed,
    sizeLevel, setSizeLevel,
    taskDefs, setTaskDefs,
    notifiedTasksRef,
    previousProjectRef,
    sharedLinkInfo,
    setSharedLinkInfo,
    showMoveModal, setShowMoveModal,
    showAllMoveModal, setShowAllMoveModal,
    showShareModal, setShowShareModal,
    allPendingDeletes, setAllPendingDeletes,
    uiPrefsReady, setUiPrefsReady,
    // Refs
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
    commitBarRef
  } = useAppState();
  
  const filtersAndSort = useFiltersAndSort();
  const {
    activeFilters, setActiveFilters,
    sortKey, setSortKey,
    sortDir, setSortDir,
    toggleSort
  } = filtersAndSort;

  // Shared link mode detection
  const isSharedLinkMode = !!sharedLinkHash;
  const isAllMode = view?.project_filter === null;

  // Use shared link data hook when in shared mode
  const {
    photos: sharedPhotos,
    metadata: sharedMetadata,
    total: sharedTotal,
    nextCursor: sharedNextCursor,
    prevCursor: sharedPrevCursor,
    loading: sharedLoading,
    error: sharedError,
    loadMore: sharedLoadMore,
    loadPrev: sharedLoadPrev,
    hasMore: sharedHasMore,
    hasPrev: sharedHasPrev,
  } = useSharedLinkData({
    hashedKey: sharedLinkHash,
    isAuthenticated,
    limit: 100, // Match DEFAULT_LIMIT from useAllPhotosPagination
  });

  // Legacy compatibility: keep sharedLinkInfo for existing UI code
  const sharedLinkMeta = isSharedLinkMode 
    ? { title: sharedMetadata.title, description: sharedMetadata.description }
    : (sharedLinkInfo ?? { title: null, description: null });

  const gridHeading = isSharedLinkMode
    ? (sharedLinkMeta.title || 'Shared Gallery')
    : isAllMode
      ? 'All Photos'
      : (selectedProject?.name || selectedProject?.folder || '');
  const gridDescription = isSharedLinkMode ? (sharedLinkMeta.description || null) : null;

  const stickyHeaderRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(160);
  const [loading, setLoading] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [optionsTab, setOptionsTab] = useState('settings');
  const [showCreateProject, setShowCreateProject] = useState(false);
  
  // Share modal: track current links for pre-selection and photos to share
  const [currentPhotoLinks, setCurrentPhotoLinks] = useState([]);
  const [photosToShare, setPhotosToShare] = useState([]);

  const exitSharedLink = useCallback(() => {
    try {
      // Exit to shared links management page
      window.location.assign('/sharedlinks');
    } catch {
      window.location.href = '/all';
    }
  }, [view?.project_filter]);

  // Shared link mode: clear project selection and set view to "all" mode
  useEffect(() => {
    if (!isSharedLinkMode) {
      // Clear legacy sharedLinkInfo when exiting shared mode
      setSharedLinkInfo({ title: null, description: null });
      return;
    }

    // In shared mode: clear project selection and set to "all" view
    setShowOptionsModal(false);
    updateProjectFilter(null);
    setSelectedProject(null);
    
    // Clear filters to default values
    setActiveFilters({
      textSearch: '',
      dateRange: { start: '', end: '' },
      fileType: 'any',
      orientation: 'any',
      keepType: 'any',
      visibility: 'any',
      tags: undefined,
    });
    
    // Update legacy sharedLinkInfo for backward compatibility
    setSharedLinkInfo({
      title: sharedMetadata.title || null,
      description: sharedMetadata.description || null,
    });
  }, [isSharedLinkMode, sharedMetadata.title, sharedMetadata.description, updateProjectFilter, setSelectedProject, setActiveFilters, setSharedLinkInfo]);

  // Project pagination hook (must come before ProjectDataService)
  const {
    photos: pagedPhotos,
    total: pagedTotal,
    unfilteredTotal: pagedUnfilteredTotal,
    nextCursor,
    hasPrev: projectHasPrev,
    loadingMore,
    gridAnchorIndex,
    setGridAnchorIndex,
    loadInitial: loadProjectInitial,
    loadMore,
    loadPrev,
    mutatePhotos: mutatePagedPhotos,
    applyExternalPage: applyProjectPage,
    resetState: resetProjectPagination,
  } = useProjectPagination({
    activeFilters,
    projectFolder: selectedProject?.folder || view?.project_filter || null,
    sortKey,
    sortDir,
    isEnabled: !isSharedLinkMode && view?.project_filter !== null && (!!selectedProject?.folder || !!view?.project_filter),
  });

  // Project data service for business logic
  const { fetchProjectData } = useProjectDataService({
    setLoading,
    setProjectData,
    resetProjectPagination,
    setViewerState,
    mainRef,
    viewerState
  });
  // Use the existing selection functions from useAllPhotosSelection
  // but avoid variable name conflicts with our unified view context
  const {
    selectedKeys: allSelectedKeys,
    selectedPhotos: allSelectedPhotos, // NEW: Map<key, photo> with full objects
    replaceSelection: replaceAllSelection,
    clearSelection: clearAllSelection,
    toggleSelection: toggleAllSelection,
    selectAllFromPhotos: selectAllAllPhotos,
  } = useAllPhotosSelection();

  // Use the existing allPhotos from useAllPhotosPagination
  // but avoid variable name conflicts with our unified view context
  const {
    photos: allPhotos,
    total: allTotal,
    unfilteredTotal: allUnfilteredTotal,
    nextCursor: allNextCursor,
    hasPrev: allHasPrev,
    loadingMore: allLoadingMore,
    gridAnchorIndex: allGridAnchorIndex,
    loadInitial: loadAllInitial,
    loadMore: loadAllMore,
    loadPrev: loadAllPrev,
    setGridAnchorIndex: setAllGridAnchorIndex,
    setDeepLinkTarget: setAllDeepLink,
    mutatePhotos: mutateAllPhotos,
    deepLinkRef: allDeepLinkRef,
  } = useAllPhotosPagination({
    activeFilters,
    isEnabled: !isSharedLinkMode && view?.project_filter === null,
    sortKey,
    sortDir,
    onResolveDeepLink: ({ index, items }) => {
      setViewerList(items);
      setViewerState({ isOpen: true, startIndex: index, fromAll: true });
      setAllGridAnchorIndex(index);
      suppressUrlRef.current = { disabled: true };
      setTimeout(() => {
        suppressUrlRef.current = null;
      }, 100);
    },
  });

  // Commit and revert flows - now handled by custom hook

  // Reset the project locate attempt guard on new deep link or context changes
  useEffect(() => {
    if (pendingOpenRef.current) {
      projectLocateTriedRef.current = false;
    }
  }, [selectedProject?.folder, activeFilters?.dateRange, activeFilters?.fileType, activeFilters?.keepType, activeFilters?.orientation]);

  // Project navigation service (must come before useModeSwitching)
  const { handleProjectSelect, toggleAllMode } = useProjectNavigation({
    // Unified view context
    view,
    updateProjectFilter,
    
    // State setters
    setSelectedProject, setProjectData, setSelectedPhotos,
    
    // Current state
    selectedProject, activeFilters, projects,
    
    // Refs
    previousProjectRef, windowScrollRestoredRef, initialSavedYRef, pendingOpenRef,
    
    // Functions
    registerActiveProject: appStateRegisterActiveProject, fetchProjectData, clearAllSelection: appStateClearAllSelection,
    
    // Constants
    ALL_PROJECT_SENTINEL
  });

  // Mode switching logic extracted to custom hook
  useModeSwitching({
    // Unified view context
    view,
    updateProjectFilter,
    selection,
    setSelection,
    
    // Legacy properties (for backward compatibility)
    projects,
    selectedProject,
    previousProjectRef,
    pendingSelectProjectRef,
    ALL_PROJECT_SENTINEL,
    setSelectedProject,
    setProjectData,
    setSelectedPhotos,
    registerActiveProject: appStateRegisterActiveProject,
    clearAllSelection: appStateClearAllSelection,
    handleProjectSelect,
  });


  // All Photos pagination

  const {
    handleAllPhotoSelect,
  } = useAllPhotosViewer({
    allPhotos,
    activeFilters,
    setViewerList,
    setViewerState,
    projects,
    handleProjectSelect,
    sharedLinkHash,
  });

  // Toggle selection for All Photos mode (composite key to avoid collisions across projects)
  const handleToggleSelectionAll = useCallback((photo) => {
    toggleAllSelection(photo);
  }, [toggleAllSelection]);

  // Handle showInfo changes from PhotoViewer
  const handleShowInfoChange = useCallback((showInfo) => {
    setViewerState(prev => ({ ...prev, showInfo }));
  }, [setViewerState]);


  // Map UI sort to API sort fields
  // When target project is loaded, open the viewer at the desired photo.
  // First attempt project-scoped locate-page for precise paging + index; fall back to sequential pagination.
  // Photo deep linking logic extracted to custom hook
  usePhotoDeepLinking({
    // Common parameters for both modes
    pendingOpenRef,
    viewerState,
    activeFilters,
    projectLocateTriedRef,
    setViewerList,
    setViewerState,
    
    // Project mode parameters
    selectedProject,
    projectData,
    pagedPhotos,
    nextCursor,
    loadingMore,
    loadMore,
    setGridAnchorIndex,
    applyProjectPage,
    
    // All Photos mode parameters
    allPhotos,
    allDeepLinkRef,
    allNextCursor: allNextCursor,
    allLoadingMore: allLoadingMore,
    loadAllMore,
    setAllGridAnchorIndex
  });


  const DEBUG_PERSIST = false; // set true to see console logs
  // Toast offset for commit/revert bar
  const toast = useToast();

  // Initialize app and handle persistence
  useAppInitialization({
    // State setters
    setProjects, setConfig, setTaskDefs, setAllPendingDeletes,
    setSelectedProject, setViewMode, setSizeLevel,
    setFiltersCollapsed, setActiveFilters, setViewerState,
    setPendingSelectProjectRef: (ref) => { pendingSelectProjectRef.current = ref; },
    setAllDeepLink,
    setSortKey, setSortDir,
    
    // Unified view context
    view,
    setView,
    updateProjectFilter,
    
    // Current state
    projects, selectedProject, config, activeFilters,
    
    // Refs
    uiPrefsLoadedRef, uiPrefsReadyRef, initialSavedYRef,
    windowScrollRestoredRef, prefsLoadedOnceRef, mainRef,
    pendingOpenRef, projectLocateTriedRef,
    
    // Constants
    ALL_PROJECT_SENTINEL, DEBUG_PERSIST
  });

  usePersistence({
    // State
    uiPrefsReady, viewMode, sizeLevel,
    
    // Refs
    uiPrefsReadyRef, prefsLoadedOnceRef, mainRef,
    
    // Config
    DEBUG_PERSIST
  });

  // Photo filtering and sorting
  const {
    filterPhotoPredicate,
    getFilteredPhotos,
    filteredPhotos,
    sortedPhotos,
    filteredPagedPhotos,
    sortedPagedPhotos,
    compareBySort
  } = usePhotoFiltering({
    activeFilters,
    sortKey,
    sortDir,
    projectData: selectedProject?.summary,
    pagedPhotos
  });


  // Keyboard shortcuts
  useKeyboardShortcuts({
    config,
    viewerState,
    toggleAllMode,
    setFiltersCollapsed,
    setShowOptionsModal,
    setShowCreateProject
  });





  // Connect to SSE stream for real-time pending changes updates
  const { pendingChanges, connected: sseConnected } = usePendingChangesSSE();
  
  // Pending destructive actions: assets available but marked not to keep
  // Pending deletes calculations extracted to custom hook (now using SSE data)
  const {
    pendingDeleteTotals,
    hasPendingDeletes,
    pendingProjectsCount
  } = usePendingDeletes({
    // Unified view context
    view,
    
    // SSE data (real-time pending changes from backend)
    pendingChangesSSE: pendingChanges,
    
    // Aggregated totals (from pollable API / optimistic state)
    allPendingDeletes,
    
    // Per-project totals (when available)
    projectPendingDeletes: projectData?.pending_deletes,
    
    // Legacy properties (for backward compatibility)
    selectedProject,
  });

  // Photo data refresh logic extracted to custom hook
  const { refreshPhotoData, refreshAllPhotos, refreshPendingDeletes } = usePhotoDataRefresh({
    // Unified view context
    view,
    
    // Data loading functions
    loadAllInitial,
    loadProjectData: fetchProjectData,
    
    // Legacy properties (for backward compatibility)
    activeFilters,
    setAllPendingDeletes,
    selectedProject
  });

  useEffect(() => {
    if (!pendingChanges) return;

    const totals = pendingChanges.totals || {};
    const projectSummaries = Array.isArray(pendingChanges.projects) ? pendingChanges.projects : [];
    const photoEntries = Array.isArray(pendingChanges.photos) ? pendingChanges.photos : [];
    const previewFilterEnabled = activeFilters?.keepType === 'any_kept';

    if (totals || projectSummaries.length || pendingChanges.flags) {
      const total = Number(totals.total) || 0;
      const jpg = Number(totals.jpg) || 0;
      const raw = Number(totals.raw) || 0;
      const nextByProject = new Set();

      for (const entry of projectSummaries) {
        if (!entry || typeof entry.project_folder !== 'string') continue;
        const pendingTotal = Number(entry.pending_total) || 0;
        if (pendingTotal > 0) nextByProject.add(entry.project_folder);
      }

      if (!projectSummaries.length && pendingChanges.flags && typeof pendingChanges.flags === 'object') {
        for (const [folder, hasPending] of Object.entries(pendingChanges.flags)) {
          if (hasPending && typeof folder === 'string' && folder.length) {
            nextByProject.add(folder);
          }
        }
      }

      setAllPendingDeletes(prev => {
        const prevTotal = prev?.total ?? 0;
        const prevJpg = prev?.jpg ?? 0;
        const prevRaw = prev?.raw ?? 0;
        const prevSet = prev?.byProject instanceof Set ? prev.byProject : new Set(Array.isArray(prev?.byProject) ? prev.byProject : []);
        const sameTotals = prevTotal === total && prevJpg === jpg && prevRaw === raw;
        let sameProjects = prevSet.size === nextByProject.size;
        if (sameProjects) {
          for (const folder of nextByProject) {
            if (!prevSet.has(folder)) {
              sameProjects = false;
              break;
            }
          }
        }
        if (sameTotals && sameProjects) {
          return prev;
        }
        return {
          total,
          jpg,
          raw,
          byProject: nextByProject,
        };
      });
    }

    const updatesById = new Map();
    if (photoEntries.length) {
    for (const entry of photoEntries) {
      if (!entry || typeof entry.photo_id !== 'number') continue;
      updatesById.set(entry.photo_id, {
        keep_jpg: entry.keep_jpg === true,
        keep_raw: entry.keep_raw === true,
        project_id: entry.project_id ?? null,
      });
    }

    }

    const selectedProjectId = selectedProject?.id ?? null;

    setProjectData(prev => {
      if (!prev || selectedProjectId == null) return prev;

      let changed = false;
      let photos = prev.photos;

      if (Array.isArray(prev.photos) && updatesById.size) {
        const nextUpdates = new Map();
        for (const [photoId, payload] of updatesById.entries()) {
          if (payload.project_id === selectedProjectId) {
            nextUpdates.set(photoId, payload);
          }
        }
        if (nextUpdates.size) {
          photos = prev.photos.map(photo => {
            if (!photo || typeof photo.id !== 'number') return photo;
            const update = nextUpdates.get(photo.id);
            if (!update) return photo;
            const keepJpg = update.keep_jpg;
            const keepRaw = update.keep_raw;
            if (photo.keep_jpg === keepJpg && photo.keep_raw === keepRaw) return photo;
            changed = true;
            return { ...photo, keep_jpg: keepJpg, keep_raw: keepRaw };
          });
        }
      }

      let nextPendingDeletes = prev.pending_deletes;
      if (Array.isArray(projectSummaries)) {
        const summary = projectSummaries.find(entry => entry && entry.project_id === selectedProjectId);
        if (summary) {
          const updatedEntry = {
            total: Number(summary.pending_total) || 0,
            jpg: Number(summary.pending_jpg) || 0,
            raw: Number(summary.pending_raw) || 0,
          };
          const folder = selectedProject?.folder;
          if (folder) {
            const current = prev.pending_deletes && prev.pending_deletes[folder];
            const same = current && current.total === updatedEntry.total && current.jpg === updatedEntry.jpg && current.raw === updatedEntry.raw;
            if (!same) {
              nextPendingDeletes = {
                ...(prev.pending_deletes || {}),
                [folder]: updatedEntry,
              };
            }
          }
        }
      }

      if (!changed && nextPendingDeletes === prev.pending_deletes) return prev;
      const next = { ...prev };
      if (changed) next.photos = photos;
      if (nextPendingDeletes !== prev.pending_deletes) next.pending_deletes = nextPendingDeletes;
      return next;
    });

    if (updatesById.size) {
      mutatePagedPhotos(prev => {
        if (!Array.isArray(prev) || !prev.length) return prev;
        let changed = false;
        const mapped = prev.map(photo => {
          if (!photo || typeof photo.id !== 'number') return photo;
          const update = updatesById.get(photo.id);
          if (!update) return photo;
          const keepJpg = update.keep_jpg;
          const keepRaw = update.keep_raw;
          if (photo.keep_jpg === keepJpg && photo.keep_raw === keepRaw) return photo;
          changed = true;
          return { ...photo, keep_jpg: keepJpg, keep_raw: keepRaw };
        });
        let next = mapped;
        if (previewFilterEnabled) {
          const filtered = mapped.filter(item => item && (item.keep_jpg === true || item.keep_raw === true));
          if (filtered.length !== mapped.length) {
            next = filtered;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }

    if (updatesById.size) {
      mutateAllPhotos(prev => {
        if (!Array.isArray(prev) || !prev.length) return prev;
        let changed = false;
        const mapped = prev.map(photo => {
          if (!photo || typeof photo.id !== 'number') return photo;
          const update = updatesById.get(photo.id);
          if (!update) return photo;
          const keepJpg = update.keep_jpg;
          const keepRaw = update.keep_raw;
          if (photo.keep_jpg === keepJpg && photo.keep_raw === keepRaw) return photo;
          changed = true;
          return { ...photo, keep_jpg: keepJpg, keep_raw: keepRaw };
        });
        let next = mapped;
        if (previewFilterEnabled) {
          const filtered = mapped.filter(item => item && (item.keep_jpg === true || item.keep_raw === true));
          if (filtered.length !== mapped.length) {
            next = filtered;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [pendingChanges, setAllPendingDeletes, mutatePagedPhotos, mutateAllPhotos, setProjectData, selectedProject, activeFilters?.keepType]);


  // Use custom hooks for commit/revert and URL sync
  const {
    showCommitModal,
    setShowCommitModal,
    committing,
    showRevertModal,
    setShowRevertModal,
    reverting,
    handleCommitChanges,
    openRevertConfirm,
    confirmCommitChanges,
    confirmRevertChanges,
    commitOpenerElRef,
    revertOpenerElRef
  } = useCommitRevert({
    // Unified view context
    view,
    
    // Data refresh functions
    refreshPhotoData,
    
    // Legacy properties (for backward compatibility)
    selectedProject,
    activeFilters,
    setProjectData,
    mutatePagedPhotos,
    mutateAllPhotos,
    refreshAllPhotos,
    fetchProjectData,
    toast,
    setAllPendingDeletes
  });

  useUrlSync({
    view,
    selectedProject,
    activeFilters,
    viewerState,
    sortKey,
    sortDir
  });

  const commitDescription = view?.project_filter === null
    ? 'This will move files marked not to keep into each affected project\'s .trash folder.'
    : 'This will move files marked not to keep into the project\'s .trash folder.';

  const revertDescription = view?.project_filter === null
    ? 'This will reset all keep flags to match actual file availability across affected projects.'
    : 'This will reset all keep flags to match the actual file availability in the project.';

  // Commit bar layout logic extracted to custom hook
  useCommitBarLayout({
    hasPendingDeletes,
    commitBarRef,
    toast,
    pendingDeleteTotals
  });



  // Re-apply saved window scroll once after initial content render
  // Scroll restoration logic extracted to custom hook
  useScrollRestoration({
    windowScrollRestoredRef,
    initialSavedYRef,
    mainRef,
    projectData,
    config
  });






  // Removed premature restore: we restore after photos are available below

  useProjectSse({
    selectedProject,
    projectData,
    pagedPhotos,
    setProjectData,
    mutatePagedPhotos,
    fetchProjectData,
    toast,
    taskDefs,
    notifiedTasksRef,
    committing,
  });
  
  // All Photos filtering is handled server-side, so we don't need client-side filtering
  // The loaded photos (allPhotos) are already filtered by the backend based on active filters
  const filteredProjectData = useMemo(() => {
    if (!selectedProject?.summary) return null;
    return {
      summary: selectedProject.summary,
      photos: sortedPagedPhotos,
      counts: projectData?.counts,
      recent_activity: projectData?.recent_activity,
      links: projectData?.links
    };
  }, [selectedProject?.summary, sortedPagedPhotos, projectData?.counts, projectData?.recent_activity, projectData?.links]);

  // Event handlers service
  const {
    handleProjectCreate,
    handleProjectSelection,
    handleSharedLinkHash,
    handlePhotosUploaded,
    handleTagsUpdated,
    handleKeepBulkUpdated,
    handleTagsBulkUpdated,
    handleProjectDeleted,
    handleProjectRenamed,
    handlePhotoSelect,
    handleKeepUpdated,
    handleToggleSelection
  } = useEventHandlers({
    // State setters
    setProjects, setSelectedProject, setProjectData, setSelectedPhotos,
    setViewerState, setViewerList,
    setPendingSelectProjectRef: (ref) => { pendingSelectProjectRef.current = ref; },
    
    // Current state
    selectedProject, projectData, filteredProjectData,
    
    // Functions
    fetchProjectData,
    refreshPendingDeletes,
    mutatePagedPhotos,
    mutateAllPhotos,
    
    // Constants
    ALL_PROJECT_SENTINEL
  });

  const {
    pendingUpload,
    showProjectSelection,
    initialProject,
    handleFilesDroppedInAllView,
    handleProjectSelection: handleUploadProjectSelection,
    handleProjectSelectionCancel,
    clearPendingUpload,
    openProjectSelection,
    registerActiveProject,
  } = useAllPhotosUploads({
    onProjectChosen: (project, files) => {
      if (!project?.folder) return null;
      handleProjectSelect(project);
      return { files, targetProject: project };
    },
    onProjectCreate: handleProjectCreate,
  });

  // Selection mode handlers for M2 (must be after useEventHandlers)
  const enterSelectionMode = useCallback((photo) => {
    // Close viewer if open
    if (viewerState.isOpen) {
      setViewerState({ isOpen: false, startIndex: -1 });
    }
    // Select the photo that was long-pressed
    if (photo) {
      const isAllMode = view?.project_filter === null;
      if (isAllMode) {
        handleToggleSelectionAll(photo);
      } else {
        handleToggleSelection(photo);
      }
    }
  }, [view?.project_filter, viewerState.isOpen, handleToggleSelectionAll, handleToggleSelection, setViewerState]);

  const clearAllSelections = useCallback(() => {
    const isAllMode = view?.project_filter === null;
    if (isAllMode) {
      clearAllSelection();
    } else {
      setSelectedPhotos(new Set());
    }
  }, [view?.project_filter, clearAllSelection, setSelectedPhotos]);

  // Clear project selections when switching to a different project view
  useEffect(() => {
    if (view?.project_filter === null) return;
    setSelectedPhotos(new Set());
  }, [view?.project_filter, selectedProject?.folder, setSelectedPhotos]);

  const {
    viewerPhotos,
    viewerKey,
    handleCloseViewer,
    handleViewerIndexChange,
  } = useViewerSync({
    isAllMode: view?.project_filter === null,
    viewerState,
    setViewerState,
    viewerList,
    setViewerList,
    allPhotos,
    filteredProjectData,
    projectData,
    selectedProject,
    activeFilters,
    allDeepLinkRef,
    suppressUrlRef,
    sharedLinkHash,
  });

  // Session viewer restoration removed - URL is single source of truth

  // Shared link deep linking: Open viewer if initialPhotoName is provided
  const sharedDeepLinkRef = useRef(initialPhotoName ? { filename: initialPhotoName } : null);
  useEffect(() => {
    if (!isSharedLinkMode || !sharedDeepLinkRef.current || !sharedPhotos.length || viewerState.isOpen) return;

    const targetFilename = sharedDeepLinkRef.current.filename;
    const targetLower = targetFilename.toLowerCase();
    
    // Find photo by filename or basename (without extension)
    const index = sharedPhotos.findIndex(p => {
      const fn = (p.filename || '').toLowerCase();
      if (fn === targetLower) return true;
      const base = fn.replace(/\.[^/.]+$/, '');
      return base === targetLower;
    });

    if (index >= 0) {
      console.log('[App] Shared link deep link found photo at index', index);
      setViewerList(sharedPhotos);
      setViewerState({ isOpen: true, startIndex: index });
      sharedDeepLinkRef.current = null;
    } else if (!sharedHasMore && !sharedLoading) {
      // Photo not found and no more pages to load
      console.warn('[App] Shared link deep link photo not found:', targetFilename);
      sharedDeepLinkRef.current = null;
    } else if (sharedHasMore && !sharedLoading) {
      // Continue loading more pages to find the photo
      sharedLoadMore();
    }
  }, [isSharedLinkMode, sharedPhotos, sharedHasMore, sharedLoading, sharedLoadMore, viewerState.isOpen, setViewerList, setViewerState]);

  // Filter calculations extracted to custom hook
  const { activeFilterCount, hasActiveFilters } = useFilterCalculations(activeFilters);

  const hasAllSelection = allSelectedKeys instanceof Set && allSelectedKeys.size > 0;
  const hasProjectSelection = selectedPhotos instanceof Set && selectedPhotos.size > 0;

  useLayoutEffect(() => {
    const el = stickyHeaderRef.current;
    if (!el) return;

    const updateHeight = () => {
      const rect = el.getBoundingClientRect();
      if (!rect) return;
      setHeaderHeight(rect.height);
    };

    updateHeight();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateHeight());
      observer.observe(el);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, [filtersCollapsed, viewMode, view?.project_filter, hasPendingDeletes, showOptionsModal, hasActiveFilters, hasAllSelection, hasProjectSelection]);

  




  return (
    <PublicHashProvider
      mutateAllPhotos={mutateAllPhotos}
      mutateProjectPhotos={mutatePagedPhotos}
      setProjectData={setProjectData}
    >
      <UploadProvider
        projectFolder={view?.project_filter !== null && selectedProject?.folder ? selectedProject.folder : null}
        onCompleted={handlePhotosUploaded}
      >
        <div className="bg-gray-50 overflow-x-hidden">
          {/* Selection Mode Banner (M2) - Show only for authenticated users when selections exist */}
          {isAuthenticated && (() => {
            const isAllMode = view?.project_filter === null;
            const count = isAllMode ? allSelectedKeys.size : selectedPhotos.size;
            return count > 0 ? (
              <SelectionModeBanner
                selectedCount={count}
                onClearSelection={clearAllSelections}
              />
            ) : null;
          })()}

          {/* Sticky Header Container */}
          <div className="fixed top-0 left-0 right-0 z-20 bg-gray-50" ref={stickyHeaderRef}>
            {/* Header */}
            <header className="bg-gray-100 shadow-none border-b-0 relative">
              <div className="w-full px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center py-4">
                  <h1 className="text-2xl font-bold text-gray-900">
                    Druso Photo Manager
                  </h1>

                  {/* Right Controls: Upload (+) and Options (hamburger) */}
                  <div className="flex items-center space-x-2">
                    {/* Upload button - hide in shared mode and for public users */}
                    {isAuthenticated && !isSharedLinkMode && (
                      <UploadButton
                        isAllMode={view?.project_filter === null}
                        selectedProject={selectedProject}
                        allProjectFolder={ALL_PROJECT_SENTINEL.folder}
                        openProjectSelection={openProjectSelection}
                      />
                    )}
                    
                    {/* Operations menu - show for authenticated users (including shared mode) */}
                    {isAuthenticated && (
                      <>
                        {showOptionsModal ? (
                          <button
                            onClick={() => setShowOptionsModal(false)}
                            className="inline-flex items-center justify-center rounded-md border shadow-sm px-3 py-2 text-sm font-medium bg-white text-gray-700 hover:bg-gray-50 border-gray-300"
                            title="Close options"
                            aria-label="Close options"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                            </svg>
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setOptionsTab('settings');
                              setShowOptionsModal(true);
                            }}
                            className="inline-flex items-center justify-center rounded-md border shadow-sm px-3 py-2 text-sm font-medium bg-white text-gray-700 hover:bg-gray-50 border-gray-300"
                            title="Options"
                            aria-label="Options"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                            </svg>
                          </button>
                        )}
                      </>
                    )}
                    
                    {/* Public user menu - show login option */}
                    {!isAuthenticated && (
                      <button
                        onClick={() => window.location.href = '/'}
                        className="inline-flex items-center gap-2 rounded-md border shadow-sm px-3 py-2 text-sm font-medium bg-white text-gray-700 hover:bg-gray-50 border-gray-300"
                        title="Login"
                        aria-label="Login"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                        </svg>
                        Login
                      </button>
                    )}
                  </div>
                </div>
                {gridHeading ? (
                  <div className="pb-3 space-y-1">
                    <h2 className="text-lg font-semibold text-gray-900">{gridHeading}</h2>
                    {gridDescription ? (
                      <p className="text-sm text-gray-600 whitespace-pre-line">{gridDescription}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </header>

            {/* Project selector bar (replaces tabs) */}
            {(selectedProject || view?.project_filter === null || isSharedLinkMode) && (
              <div className="bg-white border-b-0 relative">
                <div className="w-full px-4 sm:px-6 lg:px-8">
                  <div className="flex items-center justify-between py-2">
                    {isSharedLinkMode ? (
                      <div className="flex items-center gap-3">
                        <div className="text-sm text-gray-600">
                          Viewing shared link: <span className="font-semibold text-gray-900">{sharedLinkMeta.title || sharedLinkHash}</span>
                        </div>
                        {isAuthenticated && (
                          <button
                            onClick={exitSharedLink}
                            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
                            </svg>
                            Exit shared link
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <label className="inline-flex items-center gap-2 text-sm text-gray-700 select-none">
                          <input
                            type="checkbox"
                            checked={view?.project_filter === null}
                            onChange={toggleAllMode}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            aria-label="Toggle All Photos mode"
                          />
                          <span>All</span>
                        </label>
                        <ProjectSelector
                          projects={projects}
                          selectedProject={view?.project_filter === null ? null : selectedProject}
                          onProjectSelect={handleProjectSelect}
                          disabled={view?.project_filter === null}
                          placeholderLabel="All Projects"
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setFiltersCollapsed(prev => !prev)}
                        className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium border shadow-sm bg-white text-gray-700 hover:bg-gray-50 border-gray-300"
                        title={filtersCollapsed ? 'Show filters' : 'Hide filters'}
                        aria-expanded={filtersCollapsed ? 'false' : 'true'}
                        aria-controls="filters-panel"
                      >
                        <span className="hidden sm:inline">Filters</span>
                        <span className="relative sm:hidden inline-flex">
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                          </svg>
                          {activeFilterCount > 0 && (
                            <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[0.9rem] h-4 px-[0.2rem] text-[10px] font-semibold rounded-full bg-blue-600 text-white ring-2 ring-white">
                              {activeFilterCount}
                            </span>
                          )}
                        </span>
                        <svg className={`h-4 w-4 transition-transform ${filtersCollapsed ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <span className="text-sm text-gray-600 whitespace-nowrap">
                        {view?.project_filter === null ? (
                          hasActiveFilters ? (
                            <>
                              <span className="font-medium">{allTotal}</span> of {allUnfilteredTotal} images
                            </>
                          ) : (
                            <>
                              {allUnfilteredTotal} images
                            </>
                          )
                        ) : (
                          hasActiveFilters ? (
                            <>
                              <span className="font-medium">{pagedTotal}</span> of {pagedUnfilteredTotal} images
                            </>
                          ) : (
                            <>
                              {pagedUnfilteredTotal} images
                            </>
                          )
                        )}
                      </span>
                      {hasActiveFilters && (
                        <button
                          onClick={() => setActiveFilters({
                            textSearch: '',
                            dateRange: { start: '', end: '' },
                            fileType: 'any',
                            orientation: 'any',
                            keepType: 'any'
                          })}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400 leading-none"
                          title="Clear all filters"
                          aria-label="Clear all filters"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                          </svg>
                          <span>Clear</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="px-4 pb-2" />
                </div>

                <div className="px-4 py-2 bg-white border-t-0">
                  <div className="flex items-center justify-between gap-3">
                    <SelectionToolbar
                      isAllMode={view?.project_filter === null}
                      allPhotos={allPhotos}
                      allSelectedKeys={allSelectedKeys}
                      onAllSelectAll={selectAllAllPhotos}
                      onAllClearSelection={clearAllSelection}
                      filteredProjectPhotos={filteredProjectData?.photos}
                      selectedPhotos={selectedPhotos}
                      onProjectToggleSelect={setSelectedPhotos}
                      onTagsUpdated={handleTagsUpdated}
                      onKeepBulkUpdated={handleKeepBulkUpdated}
                      onTagsBulkUpdated={handleTagsBulkUpdated}
                      selection={selection}
                      setSelection={setSelection}
                      activeFilters={activeFilters}
                      allTotal={allTotal}
                    />

                    <div className="flex items-center gap-2">
                      <ViewModeControls
                        viewMode={viewMode}
                        onViewModeChange={setViewMode}
                        sizeLevel={sizeLevel}
                        onSizeLevelChange={setSizeLevel}
                        hasSelection={(view?.project_filter === null) ? hasAllSelection : hasProjectSelection}
                        operationsMenu={(view?.project_filter === null)
                          ? (
                            <OperationsMenu
                              allMode
                              allSelectedKeys={allSelectedKeys}
                              allSelectedPhotos={allSelectedPhotos}
                              setAllSelectedKeys={replaceAllSelection}
                              config={config}
                              trigger="label"
                              onRequestMove={() => setShowAllMoveModal(true)}
                              onRequestShare={() => setShowShareModal(true)}
                              selection={selection}
                              setSelection={setSelection}
                            />
                          )
                          : selectedProject ? (
                            <OperationsMenu
                              projectFolder={selectedProject.folder}
                              projectData={filteredProjectData}
                              selectedPhotos={selectedPhotos}
                              setSelectedPhotos={setSelectedPhotos}
                              onTagsUpdated={handleTagsUpdated}
                              onKeepBulkUpdated={handleKeepBulkUpdated}
                              onTagsBulkUpdated={handleTagsBulkUpdated}
                              config={config}
                              trigger="label"
                              onRequestMove={() => setShowMoveModal(true)}
                              onRequestShare={() => setShowShareModal(true)}
                              selection={selection}
                              setSelection={setSelection}
                            />
                          ) : null}
                      />
                    </div>
                  </div>
                  {viewMode === 'grid' && (
                    <div className="mt-2">
                      <SortControls
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSortChange={toggleSort}
                        viewType={view?.project_filter === null ? 'all' : 'project'}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <UnifiedSelectionModal
            mode="move"
            open={showMoveModal}
            onClose={(res) => {
              setShowMoveModal(false);
              if (res && res.moved) {
                const toRemove = new Set(Array.from(selectedPhotos || []));
                if (toRemove.size > 0) {
                  setProjectData(prev => {
                    if (!prev || !Array.isArray(prev.photos)) return prev;
                    const photos = prev.photos.filter(p => !toRemove.has(p.filename));
                    return { ...prev, photos };
                  });
                  mutatePagedPhotos(prev => Array.isArray(prev) ? prev.filter(p => !toRemove.has(p.filename)) : prev);
                }
                setSelectedPhotos(new Set());
              }
            }}
            sourceFolder={selectedProject ? selectedProject.folder : ''}
            selectedFilenames={Array.from(selectedPhotos || [])}
            selectedProjectSummaries={(() => {
              const folder = selectedProject?.folder ? [selectedProject.folder] : [];
              return folder.map(f => ({ folder: f, count: selectedPhotos?.size || 0 }));
            })()}
          />

          <UnifiedSelectionModal
            mode="move"
            open={showAllMoveModal}
            onClose={(res) => {
              setShowAllMoveModal(false);
              if (res && res.moved) {
                const dest = res.destFolder;
                const movedKeys = new Set(Array.from(allSelectedKeys || []));
                if (movedKeys.size > 0) {
                  mutateAllPhotos(prev => {
                    if (!Array.isArray(prev)) return prev;
                    return prev.map(p => {
                      const key = `${p.project_folder}::${p.filename}`;
                      return movedKeys.has(key)
                        ? { ...p, project_folder: dest }
                        : p;
                    });
                  });
                }
                appStateClearAllSelection();
              }
            }}
            sourceFolder={''}
            selectedFilenames={Array.from(allSelectedKeys || []).map(k => {
              const idx = k.indexOf('::');
              return idx >= 0 ? k.slice(idx + 2) : k;
            })}
            selectedProjectSummaries={Array.from(allSelectedKeys || []).reduce((acc, key) => {
              const idx = key.indexOf('::');
              const folder = idx >= 0 ? key.slice(0, idx) : '';
              if (!folder) return acc;
              const existing = acc.find(item => item.folder === folder);
              if (existing) {
                existing.count += 1;
              } else {
                acc.push({ folder, count: 1 });
              }
              return acc;
            }, [])}
          />

          <UnifiedSelectionModal
            mode="share"
            open={showShareModal}
            onClose={(res) => {
              setShowShareModal(false);
              setCurrentPhotoLinks([]);
              const sharedPhotos = photosToShare;
              setPhotosToShare([]);
              
              // Clear selections and update visibility after successful share
              if (res && res.shared) {
                // Update visibility to public for shared photos (optimistic update)
                if (sharedPhotos.length > 0) {
                  const photoIds = sharedPhotos.map(p => p.id).filter(Boolean);
                  
                  // Update All Photos view
                  if (view?.project_filter === null) {
                    mutateAllPhotos(prev => {
                      if (!Array.isArray(prev)) return prev;
                      return prev.map(photo => 
                        photoIds.includes(photo.id) 
                          ? { ...photo, visibility: 'public' }
                          : photo
                      );
                    });
                    appStateClearAllSelection();
                  } else {
                    // Update Project view
                    setProjectData(prev => {
                      if (!prev || !Array.isArray(prev.photos)) return prev;
                      return {
                        ...prev,
                        photos: prev.photos.map(photo =>
                          photoIds.includes(photo.id)
                            ? { ...photo, visibility: 'public' }
                            : photo
                        )
                      };
                    });
                    mutatePagedPhotos(prev => {
                      if (!Array.isArray(prev)) return prev;
                      return prev.map(photo =>
                        photoIds.includes(photo.id)
                          ? { ...photo, visibility: 'public' }
                          : photo
                      );
                    });
                    setSelectedPhotos(new Set());
                  }
                } else {
                  // No photos to update, just clear selection
                  if (view?.project_filter === null) {
                    appStateClearAllSelection();
                  } else {
                    setSelectedPhotos(new Set());
                  }
                }
              }
            }}
            selectedPhotos={photosToShare.length > 0 ? photosToShare : (() => {
              // Collect selected photos with their IDs
              if (view?.project_filter === null) {
                // All Photos mode - use allSelectedPhotos Map
                if (allSelectedPhotos && allSelectedPhotos instanceof Map) {
                  return Array.from(allSelectedPhotos.values());
                }
                // Fallback to allPhotos list
                const keys = Array.from(allSelectedKeys || []);
                const photosList = Array.isArray(allPhotos) ? allPhotos : [];
                const map = new Map(photosList.map(photo => {
                  const key = `${photo.project_folder || ''}::${photo.filename}`;
                  return [key, photo];
                }));
                return keys.map(k => map.get(k)).filter(Boolean);
              } else {
                // Project mode - use selectedPhotos Set
                const photos = Array.isArray(projectData?.photos) ? projectData.photos : [];
                return Array.from(selectedPhotos || [])
                  .map(filename => photos.find(p => p.filename === filename))
                  .filter(Boolean);
              }
            })()}
            currentLinkIds={currentPhotoLinks}
          />

          <div className="flex-shrink-0" style={{ height: headerHeight || 0 }} aria-hidden="true" />

          {!filtersCollapsed && (
            <div id="filters-panel" className="bg-white border-t-0 animate-slideDownFade">
              <UniversalFilter
                projectData={projectData}
                filters={activeFilters}
                onFilterChange={setActiveFilters}
                disabled={loading}
                isAllMode={view?.project_filter === null}
                onClose={() => setFiltersCollapsed(true)}
              />
            </div>
          )}

          {projects.length === 0 && (
            <div className="w-full px-4 sm:px-6 lg:px-8">
              <div className="max-w-xl mx-auto mt-10 bg-white border rounded-lg shadow-sm p-6 text-center">
                <div className="text-4xl mb-2">📁</div>
                <h2 className="text-xl font-semibold mb-2">No projects yet</h2>
                <p className="text-gray-600 mb-4">Create your first project to start importing and managing photos.</p>
                <button
                  onClick={() => setShowCreateProject(true)}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
                >
                  Create project
                </button>
              </div>
            </div>
          )}

          <RevertModal
            isOpen={showRevertModal}
            onClose={() => setShowRevertModal(false)}
            onConfirm={() => confirmRevertChanges(pendingDeleteTotals)}
            isReverting={reverting}
            revertDescription={revertDescription}
          />

          {loading ? (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
              <span className="ml-3 text-gray-600">Loading project data...</span>
            </div>
          ) : (
            <div className="w-full px-4 sm:px-6 lg:px-8 pt-2 pb-8" ref={mainRef}>
              <MainContentRenderer
                isAllMode={view?.project_filter === null}
                isSharedMode={isSharedLinkMode}
                selectedProject={selectedProject}
                projects={projects}
                config={config}
                viewMode={viewMode}
                sortKey={sortKey}
                sortDir={sortDir}
                sizeLevel={sizeLevel}
                onSortChange={toggleSort}
                allPhotos={allPhotos}
                allNextCursor={allNextCursor}
                allHasPrev={allHasPrev}
                allGridAnchorIndex={allGridAnchorIndex}
                loadAllMore={loadAllMore}
                loadAllPrev={loadAllPrev}
                setAllGridAnchorIndex={setAllGridAnchorIndex}
                handleAllPhotoSelect={handleAllPhotoSelect}
                handleToggleSelectionAll={handleToggleSelectionAll}
                allSelectedKeys={allSelectedKeys}
                sharedPhotos={sharedPhotos}
                sharedTotal={sharedTotal}
                sharedNextCursor={sharedNextCursor}
                sharedPrevCursor={sharedPrevCursor}
                sharedLoadMore={sharedLoadMore}
                sharedLoadPrev={sharedLoadPrev}
                sharedHasMore={sharedHasMore}
                sharedHasPrev={sharedHasPrev}
                sharedLoading={sharedLoading}
                filteredProjectData={filteredProjectData}
                sortedPagedPhotos={sortedPagedPhotos}
                nextCursor={nextCursor}
                projectHasPrev={projectHasPrev}
                gridAnchorIndex={gridAnchorIndex}
                loadMore={loadMore}
                loadPrev={loadPrev}
                setGridAnchorIndex={setGridAnchorIndex}
                handlePhotoSelect={handlePhotoSelect}
                handleToggleSelection={handleToggleSelection}
                selectedPhotos={selectedPhotos}
                onEnterSelectionMode={enterSelectionMode}
              />
            </div>
          )}

          <CommitModal
            isOpen={showCommitModal}
            onClose={() => setShowCommitModal(false)}
            onConfirm={() => confirmCommitChanges(pendingDeleteTotals)}
            isCommitting={committing}
            pendingDeleteTotals={pendingDeleteTotals}
            commitDescription={commitDescription}
          />

          {viewerState.isOpen && (
            <ErrorBoundary>
              <PhotoViewer
                key={viewerKey}
                projectData={{ photos: viewerPhotos }}
                projectFolder={selectedProject?.folder}
                startIndex={Number.isFinite(viewerState.startIndex) ? viewerState.startIndex : -1}
                onClose={handleCloseViewer}
                config={config}
                selectedPhotos={selectedPhotos}
                onToggleSelect={handleToggleSelection}
                onKeepUpdated={handleKeepUpdated}
                onCurrentIndexChange={handleViewerIndexChange}
                fromAllMode={!!(view?.project_filter === null || viewerState.fromAll)}
                onShowInfoChange={handleShowInfoChange}
                onRequestMove={(photo) => {
                  const sourceFolder = photo?.project_folder || selectedProject?.folder || '';
                  const filename = photo?.filename;
                  if (!filename) return;
                  if (view?.project_filter === null || viewerState.fromAll) {
                    setViewerState(prev => ({ ...(prev || {}), isOpen: false }));
                    replaceAllSelection(new Set([`${sourceFolder}::${filename}`]));
                    setShowAllMoveModal(true);
                  } else {
                    setViewerState(prev => ({ ...(prev || {}), isOpen: false }));
                    setSelectedPhotos(new Set([filename]));
                    setShowMoveModal(true);
                  }
                }}
                onRequestShare={async (photo) => {
                  if (!photo) return;
                  
                  // Load current links for this photo
                  if (photo.id) {
                    try {
                      const links = await getLinksForPhoto(photo.id);
                      setCurrentPhotoLinks((links || []).map(l => l.id));
                    } catch (err) {
                      console.error('Failed to load current links:', err);
                      setCurrentPhotoLinks([]);
                    }
                  } else {
                    setCurrentPhotoLinks([]);
                  }
                  
                  // Set the photos to share directly
                  setPhotosToShare([photo]);
                  
                  // Close viewer and open share modal with single photo
                  setViewerState(prev => ({ ...(prev || {}), isOpen: false }));
                  // Set selection to this single photo
                  if (view?.project_filter === null || viewerState.fromAll) {
                    const sourceFolder = photo?.project_folder || selectedProject?.folder || '';
                    replaceAllSelection(new Set([`${sourceFolder}::${photo.filename}`]));
                  } else {
                    setSelectedPhotos(new Set([photo.filename]));
                  }
                  setShowShareModal(true);
                }}
              />
            </ErrorBoundary>
          )}

          {showOptionsModal && (
            <SettingsProcessesModal
              project={selectedProject}
              projectFolder={selectedProject?.folder}
              config={config}
              onConfigUpdate={setConfig}
              onProjectDelete={() => {
                setShowOptionsModal(false);
                handleProjectDeleted();
              }}
              onOpenCreateProject={() => {
                setShowCreateProject(true);
                setShowOptionsModal(false);
              }}
              onProjectRenamed={handleProjectRenamed}
              initialTab={optionsTab}
              onClose={() => setShowOptionsModal(false)}
            />
          )}

          <CreateProjectModal
            isOpen={showCreateProject}
            onClose={() => {
              setShowCreateProject(false);
              setShowOptionsModal(false);
            }}
            onCreateProject={async (name) => {
              const created = await handleProjectCreate(name);
              if (created?.folder) {
                toast.show({
                  emoji: '📁',
                  message: `Project "${created.name || name}" created`,
                  variant: 'success',
                });
                pendingSelectProjectRef.current = created.folder;
                updateProjectFilter(created.folder);
              }
              setShowCreateProject(false);
              setShowOptionsModal(false);
            }}
          />

          <UploadConfirmModal />
          <BottomUploadBar />
          <UploadHandler
            selectedProject={selectedProject}
            pendingUpload={pendingUpload}
            onUploadStarted={clearPendingUpload}
          />

          {(selectedProject?.folder || view?.project_filter === null) && (
            <GlobalDragDrop
              onFilesDroppedInAllView={view?.project_filter === null ? handleFilesDroppedInAllView : (files) => {
                if (!selectedProject?.folder) return;
                openProjectSelection(files, selectedProject);
              }}
            />
          )}

          <ProjectSelectionModal
            isOpen={showProjectSelection}
            projects={projects}
            initialProject={initialProject}
            onSelect={handleUploadProjectSelection}
            onCancel={handleProjectSelectionCancel}
          />

          {hasPendingDeletes && (
            <CommitRevertBar
              ref={commitBarRef}
              pendingDeleteTotals={pendingDeleteTotals}
              activeFilters={activeFilters}
              onFilterChange={setActiveFilters}
              onRevert={openRevertConfirm}
              onCommit={handleCommitChanges}
            />
          )}
        </div>
      </UploadProvider>
    </PublicHashProvider>
  );
}
export default App;