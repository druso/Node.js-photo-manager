import React, { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { listProjects, getProject, createProject } from './api/projectsApi';
import { locateProjectPhotosPage } from './api/photosApi';
import { listAllPendingDeletes } from './api/allPhotosApi';
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
import { usePhotoDataRefresh } from './hooks/usePhotoDataRefresh';
import { useCommitBarLayout } from './hooks/useCommitBarLayout';
import { UploadProvider } from './upload/UploadContext';
import UploadConfirmModal from './components/UploadConfirmModal';
import BottomUploadBar from './components/BottomUploadBar';
import GlobalDragDrop from './components/GlobalDragDrop';
import './App.css';
import { useToast } from './ui/toast/ToastContext';
import MovePhotosModal from './components/MovePhotosModal';
import ProjectSelectionModal from './components/ProjectSelectionModal';
import UploadHandler from './components/UploadHandler';
import { getSessionState, setSessionWindowY, setSessionMainY, getLastProject, setLastProject } from './utils/storage';
import useAllPhotosPagination, { stripKnownExt, useProjectPagination } from './hooks/useAllPhotosPagination';
import UploadButton from './components/UploadButton';

// New modular components
import SortControls from './components/SortControls';
import CommitRevertBar from './components/CommitRevertBar';
import CommitModal from './components/CommitModal';
import RevertModal from './components/RevertModal';
import CreateProjectModal from './components/CreateProjectModal';
import MainContentRenderer from './components/MainContentRenderer';

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

const ALL_PROJECT_SENTINEL = Object.freeze({ folder: '__all__', name: 'All Photos' });

function App() {
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
    showMoveModal, setShowMoveModal,
    showAllMoveModal, setShowAllMoveModal,
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

  const isAllMode = view?.project_filter === null;

  const stickyHeaderRef = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(160);
  const [loading, setLoading] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [optionsTab, setOptionsTab] = useState('settings');
  const [showCreateProject, setShowCreateProject] = useState(false);

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
    isEnabled: view?.project_filter !== null && (!!selectedProject?.folder || !!view?.project_filter),
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
    isEnabled: view?.project_filter === null,
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
  });

  // Project navigation service (must come before useModeSwitching)
  const { handleProjectSelect, toggleAllMode } = useProjectNavigation({
    // Unified view context
    view,
    updateProjectFilter,
    
    // State setters
    setSelectedProject, setProjectData, setSelectedPhotos,
    
    // Current state
    selectedProject, activeFilters,
    
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
    pendingOpenRef,
  });

  // Toggle selection for All Photos mode (composite key to avoid collisions across projects)
  const handleToggleSelectionAll = useCallback((photo) => {
    toggleAllSelection(photo);
  }, [toggleAllSelection]);




  // Map UI sort to API sort fields
  // When target project is loaded, open the viewer at the desired photo.
  // First attempt project-scoped locate-page for precise paging + index; fall back to sequential pagination.
  // Photo deep linking logic extracted to custom hook
  usePhotoDeepLinking({
    pendingOpenRef,
    selectedProject,
    projectData,
    pagedPhotos,
    nextCursor,
    loadingMore,
    projects,
    handleProjectSelect,
    projectLocateTriedRef,
    setViewerList,
    setViewerState,
    setGridAnchorIndex,
    applyProjectPage
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
    uiPrefsReady, viewMode, sizeLevel, filtersCollapsed, activeFilters,
    
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
    projectData,
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





  // Pending destructive actions: assets available but marked not to keep
  // Pending deletes calculations extracted to custom hook
  const {
    pendingDeletesProject,
    pendingDeletesAll,
    pendingDeleteTotals,
    hasPendingDeletes,
    pendingProjectsCount
  } = usePendingDeletes({
    // Unified view context
    view,
    
    // Legacy properties (for backward compatibility)
    projectData,
    selectedProject,
    allPendingDeletes,
  });

  // Photo data refresh logic extracted to custom hook
  const { refreshPhotoData, refreshAllPhotos } = usePhotoDataRefresh({
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
    toast
  });

  useUrlSync({
    isAllMode,
    selectedProject,
    activeFilters
  });

  const commitDescription = isAllMode
    ? 'This will move files marked not to keep into each affected project\'s .trash folder.'
    : 'This will move files marked not to keep into the project\'s .trash folder.';

  const revertDescription = isAllMode
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
  const filteredProjectData = projectData ? {
    ...projectData,
    photos: sortedPhotos
  } : null;

  // Event handlers service
  const {
    handleProjectCreate,
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
    
    // Constants
    ALL_PROJECT_SENTINEL
  });

  const {
    viewerPhotos,
    viewerKey,
    handleCloseViewer,
    handleViewerIndexChange,
  } = useViewerSync({
    isAllMode,
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
  });

  // Session viewer restoration removed - URL is single source of truth

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
  }, [filtersCollapsed, viewMode, isAllMode, hasPendingDeletes, showOptionsModal, hasActiveFilters, hasAllSelection, hasProjectSelection]);

  




  return (
    <UploadProvider
      projectFolder={!isAllMode && selectedProject?.folder ? selectedProject.folder : null}
      onCompleted={handlePhotosUploaded}
    >
      <div className="bg-gray-50 overflow-x-hidden">
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
                <UploadButton
                  isAllMode={isAllMode}
                  selectedProject={selectedProject}
                  allProjectFolder={ALL_PROJECT_SENTINEL.folder}
                  openProjectSelection={openProjectSelection}
                />
                {showOptionsModal ? (
                  <button
                    onClick={() => setShowOptionsModal(false)}
                    className="inline-flex items-center justify-center rounded-md border shadow-sm px-3 py-2 text-sm font-medium bg-white text-gray-700 hover:bg-gray-50 border-gray-300"
                    title="Close options"
                    aria-label="Close options"
                  >
                    {/* X icon sized exactly like hamburger (h-5 w-5) */}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                ) : (
                  <button
                    onClick={() => { setOptionsTab('settings'); setShowOptionsModal(true); }}
                    className="inline-flex items-center justify-center rounded-md border shadow-sm px-3 py-2 text-sm font-medium bg-white text-gray-700 hover:bg-gray-50 border-gray-300"
                    title="Options"
                    aria-label="Options"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
          
          {/* Mobile menu overlay removed; Actions menu used across devices */}
        </header>

        {/* Project selector bar (replaces tabs) */}
        {(selectedProject || isAllMode) && (
          <div className="bg-white border-b-0 relative">
            <div className="w-full px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  {/* All toggle checkbox */}
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
                  {/* Project selector (disabled in All Photos view with placeholder) */}
                  <ProjectSelector
                    projects={projects}
                    selectedProject={view?.project_filter === null ? null : selectedProject}
                    onProjectSelect={handleProjectSelect}
                    disabled={view?.project_filter === null}
                    placeholderLabel="All Projects"
                  />
                </div>
                <div className="flex items-center gap-2">
                  {/* Filters button (restored) */}
                  <button
                    onClick={() => setFiltersCollapsed(prev => !prev)}
                    className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium border shadow-sm bg-white text-gray-700 hover:bg-gray-50 border-gray-300"
                    title={filtersCollapsed ? 'Show filters' : 'Hide filters'}
                    aria-expanded={filtersCollapsed ? 'false' : 'true'}
                    aria-controls="filters-panel"
                  >
                    <span className="hidden sm:inline">Filters</span>
                    {/* Mobile funnel icon with overlaid badge */}
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
                    {/* Chevron */}
                    <svg className={`h-4 w-4 transition-transform ${filtersCollapsed ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {/* Count next to Filters: consistent format for both All Photos and Project modes */}
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
                  {/* Clear filters button */}
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

              {/* Photo Count moved next to Filters */}
              <div className="px-4 pb-2" />
            </div>

            {/* Unified Controls Bar (part of sticky header) */}
            <div className="px-4 py-2 bg-white border-t-0">
              <div className="flex items-center justify-between gap-3">
                {/* Left: Selection + recap */}
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
                  // Unified view context
                  selection={selection}
                  setSelection={setSelection}
                />

                {/* Right: View toggle + Operations */}
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
                          setAllSelectedKeys={replaceAllSelection}
                          config={config}
                          trigger="label"
                          onRequestMove={() => setShowAllMoveModal(true)}
                          // Unified view context
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
                          // Unified view context
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
                    // Unified view context - same sort controls for both views
                    viewType={view?.project_filter === null ? 'all' : 'project'}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Move photos modal */}
        <MovePhotosModal
              open={showMoveModal}
              onClose={(res) => {
                setShowMoveModal(false);
                if (res && res.moved) {
                  // Optimistically remove moved items from current source project's UI
                  // Use selectedPhotos (Set of filenames) to filter from projectData and pagedPhotos
                  const toRemove = new Set(Array.from(selectedPhotos || []));
                  if (toRemove.size > 0) {
                    setProjectData(prev => {
                      if (!prev || !Array.isArray(prev.photos)) return prev;
                      const photos = prev.photos.filter(p => !toRemove.has(p.filename));
                      return { ...prev, photos };
                    });
                    mutatePagedPhotos(prev => Array.isArray(prev) ? prev.filter(p => !toRemove.has(p.filename)) : prev);
                  }
                  // Clear selection after updating UI
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

            {/* Move photos modal — All Photos mode */}
            <MovePhotosModal
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
                  // Clear All Photos selection after updating UI
                  appStateClearAllSelection();
                }
              }}
              // In All mode we allow selecting any destination (no single source folder)
              sourceFolder={''}
              // Map composite keys → filenames and dedupe
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

            {/* Filters Panel */}
            {!filtersCollapsed && (
              <div className="bg-white border-t-0 animate-slideDownFade">
                <UniversalFilter
                  projectData={projectData}
                  filters={activeFilters}
                  onFilterChange={setActiveFilters}
                  disabled={loading}
                  isAllMode={isAllMode}
                  onClose={() => setFiltersCollapsed(true)}
                />
              </div>
            )}
          </div>
      </div>
      
      {/* Spacer for fixed header */}
      <div className="flex-shrink-0" style={{ height: headerHeight || 0 }} aria-hidden="true"></div>
      
      {/* Empty state when there are no projects */}
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
      {/* Revert confirmation modal */}
      <RevertModal
        isOpen={showRevertModal}
        onClose={() => setShowRevertModal(false)}
        onConfirm={() => confirmRevertChanges(pendingDeleteTotals)}
        isReverting={reverting}
        revertDescription={revertDescription}
      />
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-gray-600">Loading project data...</span>
        </div>
      ) : (
        <div className="w-full px-4 sm:px-6 lg:px-8 pt-2 pb-8" ref={mainRef}>
          <MainContentRenderer
            isAllMode={isAllMode}
            selectedProject={selectedProject}
            projects={projects}
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
            config={config}
          />
        </div>
      )}
      {/* Commit confirmation modal */}
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
            fromAllMode={!!(isAllMode || viewerState.fromAll)}
            onRequestMove={(photo) => {
              const sourceFolder = photo?.project_folder || selectedProject?.folder || '';
              const filename = photo?.filename;
              if (!filename) return;
              if (isAllMode || viewerState.fromAll) {
                setViewerState(prev => ({ ...(prev || {}), isOpen: false }));
                replaceAllSelection(new Set([`${sourceFolder}::${filename}`]));
                setShowAllMoveModal(true);
              } else {
                setViewerState(prev => ({ ...(prev || {}), isOpen: false }));
                setSelectedPhotos(new Set([filename]));
                setShowMoveModal(true);
              }
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
          onOpenCreateProject={() => { setShowCreateProject(true); setShowOptionsModal(false); }}
          onProjectRenamed={handleProjectRenamed}
          initialTab={optionsTab}
          onClose={() => setShowOptionsModal(false)}
        />
      )}
      {/* Create Project Modal */}
      <CreateProjectModal
        isOpen={showCreateProject}
        onClose={() => {
          setShowCreateProject(false);
          setShowOptionsModal(false);
        }}
        onCreateProject={async (name) => {
          await handleProjectCreate(name);
          setShowCreateProject(false);
          setShowOptionsModal(false);
        }}
      />

      {/* Global upload UI */}
      <UploadConfirmModal />
      <BottomUploadBar />
      <UploadHandler 
        selectedProject={selectedProject} 
        pendingUpload={pendingUpload}
        onUploadStarted={clearPendingUpload}
      />
      {(selectedProject?.folder || isAllMode) && (
        <GlobalDragDrop
          onFilesDroppedInAllView={isAllMode ? handleFilesDroppedInAllView : (files) => {
            if (!selectedProject?.folder) return;
            openProjectSelection(files, selectedProject);
          }}
        />
      )}

      {/* Project selection modal for uploads from All view */}
      <ProjectSelectionModal
        isOpen={showProjectSelection}
        projects={projects}
        initialProject={initialProject}
        onSelect={handleUploadProjectSelection}
        onCancel={handleProjectSelectionCancel}
      />
      {/* Persistent bottom bar for pending commit/revert */}
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
    </UploadProvider>
  );
}
export default App;