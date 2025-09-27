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
import AllPhotosControls from './components/AllPhotosControls';
import ProjectViewControls from './components/ProjectViewControls';
import AllPhotosPane from './components/AllPhotosPane';
import useAllPhotosViewer from './hooks/useAllPhotosViewer';
import useAllPhotosSelection from './hooks/useAllPhotosSelection';
import useAllPhotosUploads from './hooks/useAllPhotosUploads';
import useProjectSse from './hooks/useProjectSse';
import useViewerSync from './hooks/useViewerSync';
import { UploadProvider } from './upload/UploadContext';
import { useUpload } from './upload/UploadContext';
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

const ALL_PROJECT_SENTINEL = Object.freeze({ folder: '__all__', name: 'All Photos' });

function App() {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectData, setProjectData] = useState(null);
  const [activeTab, setActiveTab] = useState('view');
  const [loading, setLoading] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [optionsTab, setOptionsTab] = useState('settings'); // 'settings' | 'processes'
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [config, setConfig] = useState(null);
  const [viewerState, setViewerState] = useState({ isOpen: false, startIndex: 0, fromAll: false });
  // When opening viewer (esp. from All -> project), pin the exact list used to compute the index
  const [viewerList, setViewerList] = useState(null);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'table'
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [activeFilters, setActiveFilters] = useState({
    textSearch: '',
    dateRange: { start: '', end: '' }, // Only date_time_original field is used
    fileType: 'any', // any | jpg_only | raw_only | both
    orientation: 'any',
    keepType: 'any' // any | none | jpg_only | raw_jpg
  });
  // Sorting state: key: 'date' | 'name' | other (for table)
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc' (date newest first by default)
  // Grid/table preview size: 's' | 'm' | 'l'
  const [sizeLevel, setSizeLevel] = useState('m');
  // Task definitions and completion notifications
  const [taskDefs, setTaskDefs] = useState(null);
  const notifiedTasksRef = useRef(new Set());

  const [isAllMode, setIsAllMode] = useState(false);
  const previousProjectRef = useRef(null);

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
    projectFolder: selectedProject?.folder,
    sortKey,
    sortDir,
    isEnabled: !isAllMode && !!selectedProject?.folder,
  });
  const {
    selectedKeys: allSelectedKeys,
    replaceSelection: replaceAllSelection,
    clearSelection: clearAllSelection,
    toggleSelection: toggleAllSelection,
    selectAllFromPhotos: selectAllAllPhotos,
  } = useAllPhotosSelection();
  const suppressUrlRef = useRef(null);
  const pendingOpenRef = useRef(null);
  const projectLocateTriedRef = useRef(false);
  const pendingSelectProjectRef = useRef(null);

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
    isEnabled: isAllMode,
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

  // Commit and revert flows
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [committing, setCommitting] = useState(false);
  // Track the opener to restore focus when modal closes
  const commitOpenerElRef = useRef(null);

  // Reset the project locate attempt guard on new deep link or context changes
  useEffect(() => {
    if (pendingOpenRef.current) {
      projectLocateTriedRef.current = false;
    }
  }, [selectedProject?.folder, activeFilters?.dateRange, activeFilters?.fileType, activeFilters?.keepType, activeFilters?.orientation]);
  // Revert modal state
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [reverting, setReverting] = useState(false);
  const revertOpenerElRef = useRef(null);
  // Move modal state
  const [showMoveModal, setShowMoveModal] = useState(false);
  // All Photos mode: Move modal state
  const [showAllMoveModal, setShowAllMoveModal] = useState(false);

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
      setIsAllMode(false);
      return { files, targetProject: project };
    },
  });

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

  const handleCommitChanges = () => {
    // In All Photos mode we still allow commit using the selected project context, but the modal is scoped to the active dataset.
    if (!isAllMode && !selectedProject) return;
    // Save current focus to restore later
    try { commitOpenerElRef.current = document.activeElement; } catch {}
    setShowCommitModal(true);
  };

  // All Photos pagination

  const {
    handleAllPhotoSelect,
  } = useAllPhotosViewer({
    allPhotos,
    activeFilters,
    setViewerList,
    setViewerState,
    setIsAllMode,
    projects,
    handleProjectSelect,
    pendingOpenRef,
  });

  // Toggle selection for All Photos mode (composite key to avoid collisions across projects)
  const handleToggleSelectionAll = useCallback((photo) => {
    toggleAllSelection(photo);
  }, [toggleAllSelection]);



  // Initialize All Photos or Project mode and deep-link viewer from URL (takes precedence over session/last project)
  useEffect(() => {
    try {
      const path = window.location?.pathname || '';
      const qs = window.location?.search || '';
      const params = new URLSearchParams(qs);
      const initialFrom = params.get('date_from') || '';
      const initialTo = params.get('date_to') || '';
      const initialFileType = params.get('file_type') || '';
      const initialKeepType = params.get('keep_type') || '';
      const initialOrientation = params.get('orientation') || '';
      if (initialFrom || initialTo) {
        setActiveFilters(prev => ({
          ...prev,
          dateRange: { start: initialFrom || '', end: initialTo || '' }
        }));
      }
      if (initialFileType || initialKeepType || initialOrientation) {
        setActiveFilters(prev => ({
          ...prev,
          fileType: initialFileType || prev.fileType,
          keepType: initialKeepType || prev.keepType,
          orientation: initialOrientation || prev.orientation,
        }));
      }
      if (path === '/') {
        setIsAllMode(true);
        try {
          const qp = new URLSearchParams();
          if (initialFrom) qp.set('date_from', initialFrom);
          if (initialTo) qp.set('date_to', initialTo);
          if (initialFileType) qp.set('file_type', initialFileType);
          if (initialKeepType) qp.set('keep_type', initialKeepType);
          if (initialOrientation) qp.set('orientation', initialOrientation);
          const search = qp.toString();
          window.history.replaceState({}, '', `/all${search ? `?${search}` : ''}`);
        } catch {}
        return;
      }
      if (path === '/all') { setIsAllMode(true); return; }
      // match /all/:projectFolder/:filename
      const m = path.match(/^\/all\/(.+?)\/(.+)$/);
      if (m) {
        const folder = decodeURIComponent(m[1]);
        const filename = decodeURIComponent(m[2]);
        setIsAllMode(true);
        setAllDeepLink({ folder, filename });
        return;
      }
      // match /:projectFolder or /:projectFolder/:filename (exclude /all)
      const m2 = path.match(/^\/(?!all$)([^/]+)(?:\/([^/]+))?$/);
      if (m2) {
        const folder = decodeURIComponent(m2[1]);
        const filename = m2[2] ? decodeURIComponent(m2[2]) : null;
        setIsAllMode(false);
        // Drive initial project selection via pendingSelectProjectRef so it wins over last-project
        pendingSelectProjectRef.current = folder;
        if (filename) {
          // Open in viewer after project/photos load
          pendingOpenRef.current = { folder, filename };
          // Reset filters to ensure deep-linked target is included (drop conflicting filters)
          setActiveFilters(prev => ({
            ...prev,
            dateRange: { start: '', end: '' },
            fileType: 'any',
            keepType: 'any',
            orientation: 'any',
          }));
          // Session viewer state removed - URL is source of truth
        }
        return;
      }
      const saved = localStorage.getItem('all_mode');
      if (saved === '1') setIsAllMode(true);
    } catch {}
  }, []);

  // Persist All Photos mode
  useEffect(() => {
    try { localStorage.setItem('all_mode', isAllMode ? '1' : '0'); } catch {}
  }, [isAllMode]);

  // Map UI sort to API sort fields
  // When target project is loaded, open the viewer at the desired photo.
  // First attempt project-scoped locate-page for precise paging + index; fall back to sequential pagination.
  useEffect(() => {
    const pending = pendingOpenRef.current;
    if (!pending) return;
    if (!selectedProject || selectedProject.folder !== pending.folder) return;
    const targetNameRaw = String(pending.filename || '').trim();
    if (!targetNameRaw) return;
    const targetLower = targetNameRaw.toLowerCase();
    const isTarget = (p) => {
      if (!p) return false;
      const fn = (p.filename || '').toLowerCase();
      if (fn === targetLower) return true;
      const base = (p.basename ? String(p.basename) : String(p.filename || ''))
        .toLowerCase()
        .replace(/\.[^/.]+$/, '');
      return base === targetLower;
    };

    // Prefer efficient locate-page once per deep link
    if (!projectLocateTriedRef.current) {
      projectLocateTriedRef.current = true;
      (async () => {
        try {
          const range = activeFilters?.dateRange || {};
          const hasDot = /\.[A-Za-z0-9]+$/.test(String(targetNameRaw));
          const maybeName = (targetNameRaw || '').replace(/\.[^/.]+$/, '');
          const res = await locateProjectPhotosPage(selectedProject.folder, {
            filename: hasDot ? targetNameRaw : undefined,
            name: !hasDot ? maybeName : undefined,
            limit: 100,
            date_from: range.start || undefined,
            date_to: range.end || undefined,
            file_type: activeFilters?.fileType,
            keep_type: activeFilters?.keepType,
            orientation: activeFilters?.orientation,
          });
          const items = Array.isArray(res.items) ? res.items : [];
          applyProjectPage({
            items,
            nextCursor: res.next_cursor ?? null,
            prevCursor: res.prev_cursor ?? null,
            hasPrev: Boolean(res.prev_cursor),
            total: res.total,
            unfilteredTotal: res.unfiltered_total,
          });

          const startIndex = Number.isFinite(res.idx_in_items) && res.idx_in_items >= 0 ? res.idx_in_items : -1;
          if (startIndex >= 0 && items[startIndex]) {
            setViewerList(items.slice());
            setViewerState({ isOpen: true, startIndex });
            // Ask grid to center the located item row
            setGridAnchorIndex(startIndex);
            // Push canonical project deep-link URL with current filters
            try {
              const nameForUrl = (items[startIndex]?.basename) || (items[startIndex]?.filename || '').replace(/\.[^/.]+$/, '');
              if (selectedProject?.folder && nameForUrl) {
                // Canonical URL without filters (basename only)
                window.history.pushState({}, '', `/${encodeURIComponent(selectedProject.folder)}/${encodeURIComponent(nameForUrl)}`);
              }
            } catch {}
            pendingOpenRef.current = null;
            return; // handled via locate
          }
        } catch (e) {
          // locate failed; fall back to existing sequential logic
        }
      })();
    }

    const fullList = Array.isArray(projectData?.photos) ? projectData.photos : null;
    const idxFull = Array.isArray(fullList) ? fullList.findIndex(isTarget) : -1;
    const idxPaged = Array.isArray(pagedPhotos) ? pagedPhotos.findIndex(isTarget) : -1;

    // Open viewer once (prefer full list for complete navigation)
    if (!viewerState?.isOpen && idxFull >= 0) {
      setViewerList(fullList);
      setViewerState({ isOpen: true, startIndex: idxFull });
      setGridAnchorIndex(idxFull);
      // Session viewer state removed - URL is source of truth
      try {
        const nameForUrl = (fullList[idxFull]?.basename) || (fullList[idxFull]?.filename || '').replace(/\.[^/.]+$/, '');
        if (selectedProject?.folder && nameForUrl) {
          // Canonical URL without filters
          window.history.pushState({}, '', `/${encodeURIComponent(selectedProject.folder)}/${encodeURIComponent(nameForUrl)}`);
        }
      } catch {}
    }

    // Ensure grid pagination loads until the target photo is present
    if (idxPaged < 0) {
      if (nextCursor && !loadingMore) {
        loadMore();
      }
      return; // keep pending until item appears or no more pages
    }
    // Target now present in paged grid; we can clear pending
    pendingOpenRef.current = null;
  }, [selectedProject, projectData, pagedPhotos, nextCursor, loadingMore, loadMore, viewerState, activeFilters?.dateRange, activeFilters?.fileType, activeFilters?.keepType, activeFilters?.orientation]);

  const confirmCommitChanges = async () => {
    if (!selectedProject) return;
    setCommitting(true);
    try {
      // Optimistic hide: mark pending deletions as missing immediately to avoid 404s
      const applyOptimisticCommit = (list) => {
        const base = Array.isArray(list) ? list : [];
        const result = [];
        for (const p of base) {
          const willRemoveJpg = !!p.jpg_available && p.keep_jpg === false;
          const willRemoveRaw = !!p.raw_available && p.keep_raw === false;
          if (!willRemoveJpg && !willRemoveRaw) {
            result.push(p);
            continue;
          }
          const next = { ...p };
          if (willRemoveJpg) {
            next.jpg_available = false;
            next.thumbnail_status = 'missing';
            next.preview_status = 'missing';
          }
          if (willRemoveRaw) {
            next.raw_available = false;
          }
          if (!next.jpg_available && !next.raw_available) {
            continue;
          }
          result.push(next);
        }
        return result;
      };

      setProjectData(prev => {
        if (!prev || !Array.isArray(prev.photos)) return prev;
        const photos = applyOptimisticCommit(prev.photos);
        return { ...prev, photos };
      });
      mutatePagedPhotos(prev => applyOptimisticCommit(prev));
      mutateAllPhotos(prev => applyOptimisticCommit(prev));

      await toast.promise(
        (async () => {
          const targetProjects = Array.from(pendingDeleteTotals.byProject || []);
          const endpoint = isAllMode ? '/api/photos/commit-changes' : `/api/projects/${encodeURIComponent(selectedProject.folder)}/commit-changes`;
          const body = (isAllMode && targetProjects.length) ? { projects: targetProjects } : undefined;
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (isAllMode) {
            const data = await res.json().catch(() => ({}));
            const queued = Array.isArray(data.projects) ? data.projects.length : 0;
            if (!queued) {
              // If nothing queued, refetch to undo optimistic removal
              await refreshAllPhotos();
            }
          }
          // No full refetch here; rely on optimistic updates + SSE reconciliation
        })(),
        {
          pending: { emoji: '🗑️', message: 'Committing…', variant: 'info' },
          success: { emoji: '✅', message: 'Committed pending deletions', variant: 'success' },
          error:   { emoji: '⚠️', message: 'Commit failed', variant: 'error' }
        }
      );
      setShowCommitModal(false);
    } catch (e) {
      // Commit changes failed
      // Revert optimistic changes by refetching on failure
      if (selectedProject && !isAllMode) {
        try { await fetchProjectData(selectedProject.folder); } catch {}
      } else {
        await refreshAllPhotos();
      }
    } finally {
      setCommitting(false);
    }
  };

  // Refs
  const mainRef = useRef(null);
  const initialSavedYRef = useRef(null);
  const windowScrollRestoredRef = useRef(false);
  const prefsLoadedOnceRef = useRef(false);
  const viewerRestoredRef = useRef(false);
  const DEBUG_PERSIST = false; // set true to see console logs
  // Session-only persistence: single key handled by storage helpers

  // Track if UI prefs were loaded so config defaults don't overwrite them
  const uiPrefsLoadedRef = useRef(false);
  // Track readiness to persist, to avoid saving defaults before load completes
  const uiPrefsReadyRef = useRef(false);
  const [uiPrefsReady, setUiPrefsReady] = useState(false);
  // Toast offset for commit/revert bar
  const toast = useToast();
  const commitBarRef = useRef(null);

  // Load task definitions once (client-side metadata)
  useEffect(() => {
    let alive = true;
    fetchTaskDefinitions()
      .then(d => { if (alive) setTaskDefs(d || {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // A11y: commit modal focus trap
  const commitModalRef = useRef(null);
  useEffect(() => {
    if (!showCommitModal) return;
    const modal = commitModalRef.current;
    if (!modal) return;
    const previouslyFocused = document.activeElement;
    const focusable = modal.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const onKeyDown = (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      if (e.key === 'Escape') setShowCommitModal(false);
    };
    first && first.focus();
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (commitOpenerElRef.current && document.contains(commitOpenerElRef.current)) {
        try { commitOpenerElRef.current.focus(); } catch {}
      } else if (previouslyFocused) {
        try { previouslyFocused.focus(); } catch {}
      }
    };
  }, [showCommitModal]);

  // A11y: revert modal focus trap
  const revertModalRef = useRef(null);
  useEffect(() => {
    if (!showRevertModal) return;
    const modal = revertModalRef.current;
    if (!modal) return;
    const previouslyFocused = document.activeElement;
    const focusable = modal.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const onKeyDown = (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      if (e.key === 'Escape') setShowRevertModal(false);
    };
    first && first.focus();
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (revertOpenerElRef.current && document.contains(revertOpenerElRef.current)) {
        try { revertOpenerElRef.current.focus(); } catch {}
      } else if (previouslyFocused) {
        try { previouslyFocused.focus(); } catch {}
      }
    };
  }, [showRevertModal]);

  // Restore focus to the opener when modal closes
  useEffect(() => {
    if (!showCommitModal && commitOpenerElRef.current) {
      try { commitOpenerElRef.current.focus(); } catch {}
      commitOpenerElRef.current = null;
    }
  }, [showCommitModal]);

  // Pending destructive actions: assets available but marked not to keep
  const pendingDeletesProject = useMemo(() => {
    const photos = projectData?.photos || [];
    let jpg = 0, raw = 0;
    for (const p of photos) {
      if (p.jpg_available && p.keep_jpg === false) jpg++;
      if (p.raw_available && p.keep_raw === false) raw++;
    }
    const total = jpg + raw;
    const byProject = new Set();
    if (total > 0 && selectedProject?.folder) {
      byProject.add(selectedProject.folder);
    }
    return { jpg, raw, total, byProject };
  }, [projectData, selectedProject?.folder]);

  // Separate state for All Photos pending deletions (independent of filtered view)
  const [allPendingDeletes, setAllPendingDeletes] = useState({ jpg: 0, raw: 0, total: 0, byProject: new Set() });

  // Fetch pending deletions for All Photos mode (ignores keep_type filter)
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
  }, [isAllMode, activeFilters?.dateRange, activeFilters?.fileType, activeFilters?.orientation]);

  const pendingDeletesAll = allPendingDeletes;

  const pendingDeleteTotals = isAllMode ? pendingDeletesAll : pendingDeletesProject;
  const hasPendingDeletes = pendingDeleteTotals.total > 0;
  const pendingProjectsCount = pendingDeleteTotals.byProject ? pendingDeleteTotals.byProject.size : 0;

  const refreshAllPhotos = useCallback(async () => {
    if (!isAllMode) return;
    try {
      await loadAllInitial();
      // Also refresh pending deletions count
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
    } catch {
      // best effort
    }
  }, [isAllMode, loadAllInitial, activeFilters?.dateRange, activeFilters?.fileType, activeFilters?.orientation]);

  const commitDescription = isAllMode
    ? 'This will move files marked not to keep into each affected project\'s .trash folder.'
    : 'This will move files marked not to keep into the project\'s .trash folder.';

  const revertDescription = isAllMode
    ? 'This will reset all keep flags to match actual file availability across affected projects.'
    : 'This will reset all keep flags to match the actual file availability in the project.';

  // Reserve space for the commit/revert bottom bar so toasts don't overlap it
  useLayoutEffect(() => {
    if (!hasPendingDeletes) {
      toast.clearOffset('commit-revert-bar');
      return;
    }
    const el = commitBarRef.current;
    if (!el) return;
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      toast.setOffset('commit-revert-bar', h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      toast.clearOffset('commit-revert-bar');
    };
  }, [toast, hasPendingDeletes, pendingDeleteTotals.total]);

  // Load UI prefs from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('ui_prefs');
      if (!raw) { if (DEBUG_PERSIST) console.debug('[persist] no ui_prefs found'); uiPrefsReadyRef.current = true; setUiPrefsReady(true); return; }
      const prefs = JSON.parse(raw);
      if (prefs.viewMode) { if (DEBUG_PERSIST) console.debug('[persist] load viewMode', prefs.viewMode); setViewMode(prefs.viewMode); }
      if (prefs.sizeLevel) { if (DEBUG_PERSIST) console.debug('[persist] load sizeLevel', prefs.sizeLevel); setSizeLevel(prefs.sizeLevel); }
      if (typeof prefs.filtersCollapsed === 'boolean') setFiltersCollapsed(prefs.filtersCollapsed);
      if (prefs.activeFilters && typeof prefs.activeFilters === 'object') {
        if (DEBUG_PERSIST) console.debug('[persist] load activeFilters', prefs.activeFilters);
        setActiveFilters(prev => ({ ...prev, ...prefs.activeFilters }));
      }
      if (prefs.activeTab) {
        const coerced = prefs.activeTab === 'upload' ? 'view' : prefs.activeTab;
        if (coerced === 'view') { if (DEBUG_PERSIST) console.debug('[persist] load activeTab', coerced); setActiveTab(coerced); }
      }
      uiPrefsLoadedRef.current = true;
      uiPrefsReadyRef.current = true;
      setUiPrefsReady(true);
    } catch (e) {
      // Failed to load ui_prefs
      uiPrefsReadyRef.current = true;
      setUiPrefsReady(true);
    }
  }, []);

  // Persist UI prefs when they change
  useEffect(() => {
    if (!uiPrefsReadyRef.current || !uiPrefsReady) return; // wait until load attempt completes
    try {
      const toSave = {
        viewMode,
        sizeLevel,
        filtersCollapsed,
        activeFilters,
        activeTab,
      };
      if (DEBUG_PERSIST) console.debug('[persist] save ui_prefs', toSave);
      localStorage.setItem('ui_prefs', JSON.stringify(toSave));
    } catch (e) {
      // Failed to save ui_prefs
    }
  }, [uiPrefsReady, viewMode, sizeLevel, filtersCollapsed, activeFilters, activeTab]);

  // Ensure we save once after readiness even if no user changes yet
  useEffect(() => {
    if (!uiPrefsReady) return;
    if (prefsLoadedOnceRef.current) return;
    prefsLoadedOnceRef.current = true;
    try {
      const exists = localStorage.getItem('ui_prefs');
      if (!exists) {
        const toSave = { viewMode, sizeLevel, filtersCollapsed, activeFilters, activeTab };
        if (DEBUG_PERSIST) console.debug('[persist] initial write ui_prefs', toSave);
        localStorage.setItem('ui_prefs', JSON.stringify(toSave));
      }
    } catch (e) {
      // Failed initial save ui_prefs
    }
  }, [uiPrefsReady]);

  // Persist and restore window scroll position (session-only)
  useEffect(() => {
    // Load saved Y for current session
    try {
      const st = getSessionState();
      if (st && typeof st.windowY === 'number') initialSavedYRef.current = st.windowY;
    } catch {}
    const onScroll = () => {
      try { setSessionWindowY(window.scrollY || window.pageYOffset || 0); } catch {}
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Re-apply saved window scroll once after initial content render
  useEffect(() => {
    if (windowScrollRestoredRef.current) return;
    if (initialSavedYRef.current == null) return;
    if (activeTab !== 'view') return;
    const y = initialSavedYRef.current;
    let attempts = 0;
    const maxAttempts = 5;
    const apply = () => {
      attempts++;
      try { window.scrollTo(0, y); } catch {}
      // If not yet applied (layout not ready), try again shortly
      if (Math.abs((window.scrollY || window.pageYOffset || 0) - y) > 1 && attempts < maxAttempts) {
        setTimeout(() => requestAnimationFrame(apply), 30);
      }
    };
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(apply);
      (window.__raf2 ||= []).push(raf2);
    });
    (window.__raf1 ||= []).push(raf1);
    return () => {
      if (window.__raf1) { window.__raf1.forEach(id => cancelAnimationFrame(id)); window.__raf1 = []; }
      if (window.__raf2) { window.__raf2.forEach(id => cancelAnimationFrame(id)); window.__raf2 = []; }
    };
  }, [activeTab, projectData, config]);

  // Persist and restore main scroll position (session-only)
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    // restore
    try {
      const st = getSessionState();
      if (st && typeof st.mainY === 'number') {
        const target = st.mainY || 0;
        el.scrollTop = target;
        // small retry to ensure it sticks after layout/content paint
        let count = 0;
        const max = 4;
        const retry = () => {
          if (Math.abs(el.scrollTop - target) <= 1 || count >= max) return;
          count++;
          requestAnimationFrame(() => setTimeout(() => { el.scrollTop = target; retry(); }, 20));
        };
        retry();
      }
    } catch {}
    const onScroll = () => {
      try { setSessionMainY(el.scrollTop || 0); } catch {}
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const toggleSort = (key) => {
    if (sortKey === key) {
      // Flip direction when clicking the active sort
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      // Change key and set default direction
      setSortKey(key);
      setSortDir(key === 'date' ? 'desc' : 'asc');
    }
  };

  // Fetch all projects on component mount
  useEffect(() => {
    fetchProjects();
    fetchConfig();
  }, []);

  // Apply UI defaults on config load (only if no saved UI prefs were found)
  useEffect(() => {
    if (!config) return;
    if (!uiPrefsLoadedRef.current) {
      if (config.ui?.default_view_mode === 'grid' || config.ui?.default_view_mode === 'table') {
        setViewMode(config.ui.default_view_mode);
      }
      if (typeof config.ui?.filters_collapsed_default === 'boolean') {
        setFiltersCollapsed(config.ui.filters_collapsed_default);
      }
    }
  }, [config]);

  // Remember last project (configurable)
  useEffect(() => {
    if (isAllMode) return;
    if (projects.length > 0 && !selectedProject) {
      // Prefer pending selection set by creation flow
      const pendingFolder = pendingSelectProjectRef.current;
      if (pendingFolder) {
        const pending = projects.find(p => p.folder === pendingFolder);
        if (pending) {
          handleProjectSelect(pending);
          pendingSelectProjectRef.current = null;
          return;
        }
      }
      const remember = config?.ui?.remember_last_project !== false;
      if (remember) {
        const lastProjectFolder = getLastProject();
        if (lastProjectFolder) {
          const lastProject = projects.find(p => p.folder === lastProjectFolder);
          if (lastProject) {
            handleProjectSelect(lastProject);
            return;
          }
        }
      }
      // If not remembering or not found, select the first one
      handleProjectSelect(projects[0]);
    }
  }, [projects, selectedProject, config, isAllMode]);

  // Remember selected project (configurable)
  useEffect(() => {
    if (selectedProject && selectedProject.folder !== ALL_PROJECT_SENTINEL.folder) {
      const remember = config?.ui?.remember_last_project !== false;
      if (remember) {
        setLastProject(selectedProject.folder);
      }
    }
  }, [selectedProject, config]);

  const fetchProjects = async () => {
    try {
      const data = await listProjects();
      setProjects(data);
    } catch (error) {
      // Error fetching projects
    }
  };

  const fetchProjectData = async (projectFolder) => {
    // Capture UI state to restore after data updates
    const savedWindowY = (() => {
      const live = window.scrollY || window.pageYOffset || 0;
      try {
        const st = getSessionState();
        return (st && typeof st.windowY === 'number') ? st.windowY : live;
      } catch { return live; }
    })();
    const mainEl = mainRef.current;
    const savedMainY = (() => {
      const live = mainEl ? mainEl.scrollTop : 0;
      try {
        const st = getSessionState();
        return (st && typeof st.mainY === 'number') ? st.mainY : live;
      } catch { return live; }
    })();
    const savedViewer = (() => {
      try { const st = getSessionState(); return (st && st.viewer) ? st.viewer : (viewerState || { isOpen: false }); }
      catch { return viewerState || { isOpen: false }; }
    })();

    setLoading(true);
    try {
      const data = await getProject(projectFolder);
      setProjectData(data);
      // Kick off initial paginated load (do not await to keep UI responsive)
      try { resetProjectPagination(); } catch {}
    } catch (error) {
      // Error fetching project data
    } finally {
      // Restore scroll and viewer context on next frame(s); retry a couple frames for layout settle
      try {
        requestAnimationFrame(() => {
          try { window.scrollTo(0, savedWindowY); } catch {}
          if (mainEl) { try { mainEl.scrollTop = savedMainY; } catch {} }
          if (savedViewer && savedViewer.isOpen) {
            setViewerState(prev => ({ ...(prev || {}), ...savedViewer, isOpen: true }));
          }
          // second tick in case images/layout shift
          requestAnimationFrame(() => {
            try { window.scrollTo(0, savedWindowY); } catch {}
            if (mainEl) { try { mainEl.scrollTop = savedMainY; } catch {} }
          });
        });
      } catch {}
      setLoading(false);
    }
  };

  // Session viewer persistence removed - URL is single source of truth

  // Removed premature restore: we restore after photos are available below
  function handleProjectSelect(project) {
    // Handle null/invalid project selection (e.g., dropdown placeholder)
    if (!project || !project.folder) {
      setSelectedProject(null);
      registerActiveProject(null);
      setProjectData(null);
      setSelectedPhotos(new Set());
      return;
    }
    if (project.folder === ALL_PROJECT_SENTINEL.folder) {
      setIsAllMode(true);
      return;
    }
    // Clear session state only when switching away from an already selected project
    // Avoid clearing on initial selection after a reload (selectedProject is null then)
    const isSwitchingToDifferent = !!(selectedProject?.folder && selectedProject.folder !== project.folder);
    if (isSwitchingToDifferent) {
      try { clearSessionState(); } catch {}
      windowScrollRestoredRef.current = false;
      initialSavedYRef.current = null;
    }
    setSelectedProject(project);
    previousProjectRef.current = project;
    registerActiveProject(project);
    fetchProjectData(project.folder);
    setSelectedPhotos(new Set()); // Clear selection when switching projects
    // Sync URL to project base when not in All Photos mode, unless we are in a pending deep link open
    try {
      if (!isAllMode && project?.folder) {
        const pending = pendingOpenRef.current;
        const isPendingDeepLink = !!(pending && pending.folder === project.folder);
        if (!isPendingDeepLink) {
          window.history.pushState({}, '', `/${encodeURIComponent(project.folder)}`);
        }
      }
    } catch {}
  }

  // Toggle All Photos mode and sync URL
  const toggleAllMode = useCallback(() => {
    setIsAllMode(prev => {
      const next = !prev;
      try {
        if (next) {
          const range = (activeFilters?.dateRange) || {};
          const qp = new URLSearchParams();
          if (range.start) qp.set('date_from', range.start);
          if (range.end) qp.set('date_to', range.end);
          if (activeFilters?.fileType && activeFilters.fileType !== 'any') qp.set('file_type', activeFilters.fileType);
          if (activeFilters?.keepType && activeFilters.keepType !== 'any') qp.set('keep_type', activeFilters.keepType);
          if (activeFilters?.orientation && activeFilters.orientation !== 'any') qp.set('orientation', activeFilters.orientation);
          const search = qp.toString();
          window.history.pushState({}, '', `/all${search ? `?${search}` : ''}`);
        } else {
          if (selectedProject?.folder) {
            window.history.pushState({}, '', `/${encodeURIComponent(selectedProject.folder)}`);
          } else {
            window.history.pushState({}, '', '/');
          }
        }
      } catch {}
      return next;
    });
    // Clear selections when switching modes
    setSelectedPhotos(new Set());
    clearAllSelection();
  }, [selectedProject, activeFilters?.dateRange, clearAllSelection]);

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

  const handleProjectCreate = async (projectName) => {
    try {
      const created = await createProject(projectName);
      const createdFolder = created?.project?.folder || created?.folder || created?.project_folder;
      if (createdFolder) {
        // set BEFORE updating projects to beat the effect race
        pendingSelectProjectRef.current = createdFolder;
        // also persist immediately so remember-last-project points to the new one
        try { setLastProject(createdFolder); } catch {}
      }
      // Refresh and select the created project from the latest list
      const latest = await listProjects();
      setProjects(latest);
      const toSelect = createdFolder ? latest.find(p => p.folder === createdFolder) : null;
      if (toSelect) {
        handleProjectSelect(toSelect);
      } else if (latest.length > 0) {
        // fallback: try last in list
        handleProjectSelect(latest[latest.length - 1]);
      }
    } catch (error) {
      // Error creating project
    }
  };

  const handlePhotosUploaded = () => {
    const currentFolder = selectedProject?.folder;
    if (currentFolder && currentFolder !== ALL_PROJECT_SENTINEL.folder) {
      const reload = fetchProjectData(currentFolder);
      Promise.resolve(reload)
        .catch(() => {})
        .finally(() => {
          if (typeof loadProjectInitial === 'function') {
            loadProjectInitial().catch(() => {});
          }
        });
    } else if (typeof loadAllInitial === 'function') {
      loadAllInitial().catch(() => {});
    }
  };

  const handleTagsUpdated = () => {
    if (selectedProject) {
      fetchProjectData(selectedProject.folder);
    }
  };

  // Optimistic bulk updates to avoid full refetches after actions
  const handleKeepBulkUpdated = useCallback((updates) => {
    // updates: [{ filename, keep_jpg, keep_raw }]
    setProjectData(prev => {
      if (!prev || !Array.isArray(prev.photos)) return prev;
      const byName = new Map(updates.map(u => [u.filename, u]));
      const photos = prev.photos.map(p => {
        const u = byName.get(p.filename);
        return u ? { ...p, keep_jpg: u.keep_jpg, keep_raw: u.keep_raw } : p;
      });
      return { ...prev, photos };
    });
    mutatePagedPhotos(prev => {
      const base = Array.isArray(prev) ? prev.slice() : [];
      const byName = new Map(updates.map(u => [u.filename, u]));
      return base.map(p => {
        const u = byName.get(p.filename);
        return u ? { ...p, keep_jpg: u.keep_jpg, keep_raw: u.keep_raw } : p;
      });
    });
  }, []);

  const handleTagsBulkUpdated = useCallback((updates) => {
    // updates: [{ filename, tags }]
    setProjectData(prev => {
      if (!prev || !Array.isArray(prev.photos)) return prev;
      const byName = new Map(updates.map(u => [u.filename, u]));
      const photos = prev.photos.map(p => {
        const u = byName.get(p.filename);
        return u ? { ...p, tags: Array.isArray(u.tags) ? u.tags : (p.tags || []) } : p;
      });
      return { ...prev, photos };
    });
  }, []);

  const handleProjectDeleted = () => {
    // Force page refresh to ensure clean state after project deletion
    window.location.reload();
  };

  const handleProjectRenamed = (updated) => {
    if (!updated || updated.id == null) return;
    setProjects(prev => prev.map(p => (p.id === updated.id ? { ...p, name: updated.name } : p)));
    setSelectedProject(prev => {
      if (!prev) return prev;
      if (prev.id === updated.id) return { ...prev, name: updated.name };
      return prev;
    });
    setProjectData(prev => {
      if (!prev) return prev;
      // server getProject uses project_name field
      return { ...prev, project_name: updated.name };
    });
  };

  const handlePhotoSelect = (photo, photoContext = null) => {
    if (!projectData?.photos) return;
    
    const photos = photoContext || filteredProjectData?.photos || projectData.photos;
    const photoIndex = photos.findIndex(p => p.filename === photo.filename);
    
    setViewerState({
      isOpen: true,
      startIndex: photoIndex >= 0 ? photoIndex : 0
    });
    // Session viewer state removed - URL is source of truth
    // push deep link: /:projectFolder/:basename
    if (selectedProject?.folder && photo?.filename) {
      try { 
        const range = (activeFilters?.dateRange) || {};
        const qp = new URLSearchParams();
        if (range.start) qp.set('date_from', range.start);
        if (range.end) qp.set('date_to', range.end);
        if (activeFilters?.fileType && activeFilters.fileType !== 'any') qp.set('file_type', activeFilters.fileType);
        if (activeFilters?.keepType && activeFilters.keepType !== 'any') qp.set('keep_type', activeFilters.keepType);
        if (activeFilters?.orientation && activeFilters.orientation !== 'any') qp.set('orientation', activeFilters.orientation);
        const search = qp.toString();
        const nameForUrl = (photo.basename) || (photo.filename || '').replace(/\.[^/.]+$/, '');
        window.history.pushState({}, '', `/${encodeURIComponent(selectedProject.folder)}/${encodeURIComponent(nameForUrl)}${search ? `?${search}` : ''}`);
      } catch {}
    }
  };

  // Update in-memory keep flags when viewer changes them
  const handleKeepUpdated = ({ filename, keep_jpg, keep_raw }) => {
    setProjectData(prev => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        photos: prev.photos.map(p => p.filename === filename ? { ...p, keep_jpg, keep_raw } : p)
      };
      return updated;
    });
  };

  // Sync URL query with filters when in All mode (preserve current /all path and filename if any)
  useEffect(() => {
    if (!isAllMode) return;
    try {
      const path = window.location?.pathname || '/all';
      const keepPath = path.startsWith('/all') ? path : '/all';
      const range = (activeFilters?.dateRange) || {};
      const qp = new URLSearchParams();
      if (range.start) qp.set('date_from', range.start);
      if (range.end) qp.set('date_to', range.end);
      if (activeFilters?.fileType && activeFilters.fileType !== 'any') qp.set('file_type', activeFilters.fileType);
      if (activeFilters?.keepType && activeFilters.keepType !== 'any') qp.set('keep_type', activeFilters.keepType);
      if (activeFilters?.orientation && activeFilters.orientation !== 'any') qp.set('orientation', activeFilters.orientation);
      const search = qp.toString();
      const target = `${keepPath}${search ? `?${search}` : ''}`;
      const current = `${path}${window.location?.search || ''}`;
      if (target !== current) {
        window.history.replaceState({}, '', target);
      }
    } catch {}
  }, [isAllMode, activeFilters?.dateRange?.start, activeFilters?.dateRange?.end, activeFilters?.fileType, activeFilters?.keepType, activeFilters?.orientation]);

  // Sync URL query with filters when in Project mode as well
  useEffect(() => {
    if (isAllMode) return;
    try {
      const basePath = selectedProject?.folder ? `/${encodeURIComponent(selectedProject.folder)}` : (window.location?.pathname || '/');
      // Preserve filename segment if present
      const path = window.location?.pathname || basePath;
      const keepPath = path.startsWith('/') ? path : basePath;
      const range = (activeFilters?.dateRange) || {};
      const qp = new URLSearchParams();
      if (range.start) qp.set('date_from', range.start);
      if (range.end) qp.set('date_to', range.end);
      if (activeFilters?.fileType && activeFilters.fileType !== 'any') qp.set('file_type', activeFilters.fileType);
      if (activeFilters?.keepType && activeFilters.keepType !== 'any') qp.set('keep_type', activeFilters.keepType);
      if (activeFilters?.orientation && activeFilters.orientation !== 'any') qp.set('orientation', activeFilters.orientation);
      const search = qp.toString();
      const target = `${keepPath}${search ? `?${search}` : ''}`;
      const current = `${path}${window.location?.search || ''}`;
      if (target !== current) {
        window.history.replaceState({}, '', target);
      }
    } catch {}
  }, [isAllMode, selectedProject?.folder, activeFilters?.dateRange?.start, activeFilters?.dateRange?.end, activeFilters?.fileType, activeFilters?.keepType, activeFilters?.orientation]);

  const handleToggleSelection = (photo) => {
    setSelectedPhotos(prev => {
      const newSelection = new Set(prev);
      const photoId = photo.filename; // Use filename as unique identifier
      
      if (newSelection.has(photoId)) {
        newSelection.delete(photoId);
      } else {
        newSelection.add(photoId);
      }
      
      return newSelection;
    });
  };

  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/config');
      if (response.ok) {
        setConfig(await response.json());
      }
    } catch (error) {
      // Error fetching config
    }
  };

  // Filter helper used for both full project list (table) and paged list (grid)
  const filterPhotoPredicate = (photo, index = 0) => {
      // Text search filter
      if (activeFilters.textSearch) {
        const searchTerm = activeFilters.textSearch.toLowerCase();
        const matchesFilename = photo.filename?.toLowerCase().includes(searchTerm);
        const matchesTags = photo.tags?.some(tag => tag.toLowerCase().includes(searchTerm));
        const matchesMetadata = photo.metadata && Object.values(photo.metadata).some(value => 
          typeof value === 'string' && value.toLowerCase().includes(searchTerm)
        );
        
        if (!matchesFilename && !matchesTags && !matchesMetadata) { return false; }
      }
      
      // Date range filter (only uses date_time_original field)
      if (activeFilters.dateRange?.start || activeFilters.dateRange?.end) {
        const photoDate = photo.date_time_original;
        if (photoDate) {
          const date = new Date(photoDate).toISOString().split('T')[0];
          
          if (activeFilters.dateRange.start && date < activeFilters.dateRange.start) { return false; }
          if (activeFilters.dateRange.end && date > activeFilters.dateRange.end) { return false; }
        }
      }
      
      // File type filter
      if (activeFilters.fileType && activeFilters.fileType !== 'any') {
        const hasJpg = !!photo.jpg_available;
        const hasRaw = !!photo.raw_available;
        if (activeFilters.fileType === 'jpg_only' && !(hasJpg && !hasRaw)) return false;
        if (activeFilters.fileType === 'raw_only' && !(hasRaw && !hasJpg)) return false;
        if (activeFilters.fileType === 'both' && !(hasJpg && hasRaw)) return false;
      }

      // Keep-type filter (based on planned keep flags)
      if (activeFilters.keepType && activeFilters.keepType !== 'any') {
        // Only count explicitly set flags as kept
        const kj = photo.keep_jpg === true;
        const kr = photo.keep_raw === true;
        if (activeFilters.keepType === 'any_kept' && !(kj || kr)) return false;
        if (activeFilters.keepType === 'none' && !(photo.keep_jpg === false && photo.keep_raw === false)) return false;
        if (activeFilters.keepType === 'jpg_only' && !(kj === true && kr === false)) return false;
        if (activeFilters.keepType === 'raw_jpg' && !(kj === true && kr === true)) return false;
      }
      
      // Orientation filter
      if (activeFilters.orientation && activeFilters.orientation !== 'any') {
        const width = photo.metadata?.exif_image_width || photo.metadata?.ExifImageWidth || photo.metadata?.ImageWidth;
        const height = photo.metadata?.exif_image_height || photo.metadata?.ExifImageHeight || photo.metadata?.ImageHeight;
        const orientation = photo.metadata?.orientation || photo.metadata?.Orientation || 1;
        
        // Debug logging removed
        
        if (width && height) {
          // Determine actual orientation considering EXIF rotation
          let actuallyVertical, actuallyHorizontal;
          
          // EXIF orientation values: 1=normal, 6=90°CW, 8=90°CCW, 3=180°
          if (orientation === 6 || orientation === 8) {
            // Image is rotated 90°, so dimensions are swapped
            actuallyVertical = width > height;  // Swapped!
            actuallyHorizontal = height > width; // Swapped!
          } else {
            // Normal orientation or 180° rotation (dimensions not swapped)
            actuallyVertical = height > width;
            actuallyHorizontal = width > height;
          }
          
          // Final orientation determination complete
          
          if (activeFilters.orientation === 'vertical' && !actuallyVertical) return false;
          if (activeFilters.orientation === 'horizontal' && !actuallyHorizontal) return false;
        } else {
          // If no width/height data, exclude from orientation filtering
          return false;
        }
      }
      
      return true;
  };

  // Filter photos based on active filters (full list; used by table and legacy flows)
  const getFilteredPhotos = () => {
    if (!projectData?.photos) return [];
    return projectData.photos.filter((p, i) => filterPhotoPredicate(p, i));
  };

  // Get filtered photos for display
  const filteredPhotos = getFilteredPhotos();
  
  // All Photos filtering is handled server-side, so we don't need client-side filtering
  // The loaded photos (allPhotos) are already filtered by the backend based on active filters

  // Sort filtered photos (stable) with useMemo for performance
  const compareBySort = useCallback((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'name') {
        return a.filename.localeCompare(b.filename) * dir;
      }
      if (sortKey === 'date') {
        const ad = a.metadata?.date_time_original || a.date_time_original || '';
        const bd = b.metadata?.date_time_original || b.date_time_original || '';
        // Compare ISO-like strings; fallback to filename to stabilize
        const cmp = (ad === bd ? 0 : (ad > bd ? 1 : -1)) * dir;
        if (cmp !== 0) return cmp;
        return a.filename.localeCompare(b.filename) * dir;
      }
      // Table-specific keys
      if (sortKey === 'filetypes') {
        const aval = (a.raw_available ? 2 : 0) + (a.jpg_available ? 1 : 0);
        const bval = (b.raw_available ? 2 : 0) + (b.jpg_available ? 1 : 0);
        if (aval !== bval) return (aval - bval) * (sortDir === 'asc' ? 1 : -1);
        return a.filename.localeCompare(b.filename) * dir;
      }
      if (sortKey === 'tags') {
        const at = a.tags?.length || 0;
        const bt = b.tags?.length || 0;
        if (at !== bt) return (at - bt) * (sortDir === 'asc' ? 1 : -1);
        return a.filename.localeCompare(b.filename) * dir;
      }
      return 0;
    }, [sortKey, sortDir]);

  const sortedPhotos = useMemo(() => {
    const arr = [...filteredPhotos];
    arr.sort(compareBySort);
    return arr;
  }, [filteredPhotos, compareBySort]);

  // Apply filters/sorting to the paginated list for grid view
  const filteredPagedPhotos = useMemo(() => {
    return (pagedPhotos || []).filter((p, i) => filterPhotoPredicate(p, i));
  }, [pagedPhotos, activeFilters]);

  const sortedPagedPhotos = useMemo(() => {
    const arr = [...filteredPagedPhotos];
    arr.sort(compareBySort);
    return arr;
  }, [filteredPagedPhotos, compareBySort]);
  const filteredProjectData = projectData ? {
    ...projectData,
    photos: sortedPhotos
  } : null;

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

  // Active filter count for badge
  const activeFilterCount = (
    (activeFilters.textSearch ? 1 : 0) +
    (activeFilters.dateRange?.start ? 1 : 0) +
    (activeFilters.dateRange?.end ? 1 : 0) +
    (activeFilters.fileType && activeFilters.fileType !== 'any' ? 1 : 0) +
    (activeFilters.keepType && activeFilters.keepType !== 'any' ? 1 : 0) +
    (activeFilters.orientation && activeFilters.orientation !== 'any' ? 1 : 0)
  );

  const hasActiveFilters = !!(
    (activeFilters.textSearch && activeFilters.textSearch.trim()) ||
    activeFilters.dateRange?.start ||
    activeFilters.dateRange?.end ||
    (activeFilters.fileType && activeFilters.fileType !== 'any') ||
    (activeFilters.keepType && activeFilters.keepType !== 'any') ||
    (activeFilters.orientation && activeFilters.orientation !== 'any')
  );

  

  const openRevertConfirm = () => {
    if (!selectedProject) return;
    try { revertOpenerElRef.current = document.activeElement; } catch {}
    setShowRevertModal(true);
  };

  const confirmRevertChanges = async () => {
    if (!selectedProject) return;
    setReverting(true);
    try {
      await toast.promise(
        (async () => {
          const targetProjects = Array.from(pendingDeleteTotals.byProject || []);
          const endpoint = isAllMode ? '/api/photos/revert-changes' : `/api/projects/${encodeURIComponent(selectedProject.folder)}/revert-changes`;
          const body = (isAllMode && targetProjects.length) ? { projects: targetProjects } : undefined;
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          // Optimistically reflect revert: keep flags back to availability
          setProjectData(prev => {
            if (!prev || !Array.isArray(prev.photos)) return prev;
            const photos = prev.photos.map(p => ({
              ...p,
              keep_jpg: !!p.jpg_available,
              keep_raw: !!p.raw_available,
            }));
            return { ...prev, photos };
          });
          mutatePagedPhotos(prev => {
            if (!Array.isArray(prev)) return prev;
            return prev.map(p => ({
              ...p,
              keep_jpg: !!p.jpg_available,
              keep_raw: !!p.raw_available,
            }));
          });
          mutateAllPhotos(prev => {
            if (!Array.isArray(prev)) return prev;
            return prev.map(p => ({
              ...p,
              keep_jpg: !!p.jpg_available,
              keep_raw: !!p.raw_available,
            }));
          });
          if (isAllMode) {
            await refreshAllPhotos();
          }
        })(),
        {
          pending: { emoji: '↩️', message: 'Reverting…', variant: 'info' },
          success: { emoji: '✅', message: 'Reverted keep flags to availability', variant: 'success' },
          error:   { emoji: '⚠️', message: 'Revert failed', variant: 'error' }
        }
      );
      setShowRevertModal(false);
    } catch (e) {
      // Revert changes failed
      if (isAllMode) {
        await refreshAllPhotos();
      }
    } finally {
      setReverting(false);
    }
  };

  // Keyboard shortcuts: use config.keyboard_shortcuts with sensible defaults
  useEffect(() => {
    const onKeyDown = (e) => {
      // Ignore when typing or with modifiers
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!selectedProject) return;

      const ks = config?.keyboard_shortcuts || {};
      const keyGrid = ks.view_grid || 'g';
      const keyTable = ks.view_table || 't';
      const keyToggleFilters = ks.toggle_filters || 'f';
      const keySelectAll = ks.select_all || 'a';

      if (e.key === keyGrid) {
        setViewMode('grid');
      } else if (e.key === keyTable) {
        setViewMode('table');
      } else if (e.key === keyToggleFilters) {
        setFiltersCollapsed(prev => !prev);
      } else if (e.key === keySelectAll) {
        // Toggle select all on filtered set
        if (activeTab === 'view' && filteredProjectData?.photos) {
          setSelectedPhotos(prev => {
            const all = filteredProjectData.photos.map(p => p.filename);
            if (prev.size === all.length) return new Set();
            return new Set(all);
          });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedProject, activeTab, filteredProjectData, setViewMode, setSelectedPhotos, setFiltersCollapsed, config]);

  // Lightweight upload button using UploadContext; disabled when no project selected
  const UploadButton = ({ disabled }) => {
    const { actions } = useUpload();
    const inputRef = useRef(null);
    const onPick = () => {
      if (disabled) return;
      if (inputRef.current) inputRef.current.click();
    };
    const onChange = (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        if (isAllMode) {
          openProjectSelection(files);
        } else if (selectedProject?.folder && selectedProject.folder !== ALL_PROJECT_SENTINEL.folder) {
          openProjectSelection(files, selectedProject);
        } else {
          actions.startAnalyze(files);
        }
      }
      // reset so selecting the same files again still triggers change
      e.target.value = '';
    };
    const isDisabled = isAllMode ? false : !selectedProject || selectedProject.folder === ALL_PROJECT_SENTINEL.folder;

    return (
      <>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.raw,.cr2,.nef,.arw,.dng,.tiff,.tif"
          className="hidden"
          onChange={onChange}
        />
        <button
          onClick={onPick}
          disabled={disabled || isDisabled}
          className={`inline-flex items-center justify-center px-3 py-2 rounded-md ${(disabled || isDisabled) ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
          title={(disabled || isDisabled) ? 'Select a project to enable uploads' : 'Upload photos'}
          aria-label="Upload photos"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        </button>
      </>
    );
  };

  return (
    <UploadProvider projectFolder={!isAllMode && selectedProject?.folder ? selectedProject.folder : null} onCompleted={handlePhotosUploaded}>
    <div className="min-h-screen bg-gray-50" ref={mainRef}>
      {/* Sticky Header Container */}
      <div className="sticky top-0 z-20 bg-gray-50">
        {/* Header */}
        <header className="bg-gray-100 shadow-none border-b-0 relative">
          <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <h1 className="text-2xl font-bold text-gray-900">
                Druso Photo Manager
              </h1>
              
              {/* Right Controls: Upload (+) and Options (hamburger) */}
              <div className="flex items-center space-x-2">
                <UploadButton disabled={false} />
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
                      checked={!!isAllMode}
                      onChange={toggleAllMode}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      aria-label="Toggle All Photos mode"
                    />
                    <span>All</span>
                  </label>
                  {/* Project selector (disabled in All mode with placeholder) */}
                  <ProjectSelector 
                    projects={projects}
                    selectedProject={isAllMode ? null : selectedProject}
                    onProjectSelect={handleProjectSelect}
                    disabled={isAllMode}
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
                    {isAllMode ? (
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
            {activeTab === 'view' && (
              <div className="px-4 py-2 bg-white border-t-0">
                <div className="flex items-center justify-between gap-3">
                  {/* Left: Selection + recap */}
                  <SelectionToolbar
                    isAllMode={isAllMode}
                    allPhotos={allPhotos}
                    allSelectedKeys={allSelectedKeys}
                    onAllSelectAll={selectAllAllPhotos}
                    onAllClearSelection={clearAllSelection}
                    filteredProjectPhotos={filteredProjectData?.photos}
                    selectedPhotos={selectedPhotos}
                    onProjectToggleSelect={setSelectedPhotos}
                  />

                  {/* Right: View toggle + Operations */}
                  <div className="flex items-center gap-2">
                    {isAllMode ? (
                      <>
                        <AllPhotosControls
                          viewMode={viewMode}
                          onViewModeChange={setViewMode}
                        />
                        <div className="transition-all duration-150 ease-out transform opacity-100 scale-100 animate-fadeInScale">
                          <OperationsMenu
                            allMode
                            allSelectedKeys={allSelectedKeys}
                            setAllSelectedKeys={replaceAllSelection}
                            config={config}
                            trigger="label"
                            onRequestMove={() => setShowAllMoveModal(true)}
                          />
                        </div>
                      </>
                    ) : (
                      <ProjectViewControls
                        viewMode={viewMode}
                        onViewModeChange={setViewMode}
                        sizeLevel={sizeLevel}
                        onSizeLevelChange={setSizeLevel}
                        selectedProject={selectedProject}
                        selectedPhotos={selectedPhotos}
                        setSelectedPhotos={setSelectedPhotos}
                        filteredProjectData={filteredProjectData}
                        onTagsUpdated={handleTagsUpdated}
                        onKeepBulkUpdated={handleKeepBulkUpdated}
                        onTagsBulkUpdated={handleTagsBulkUpdated}
                        config={config}
                        onRequestMove={() => setShowMoveModal(true)}
                      />
                    )}
                  </div>
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
                  clearAllSelection();
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
        )}
      </div>
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
      {showRevertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="presentation">
          <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={() => setShowRevertModal(false)} />
          <div
            ref={revertModalRef}
            className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="revert-modal-title"
            aria-describedby="revert-modal-desc"
            aria-busy={reverting ? 'true' : 'false'}
          >
            <div className="px-6 py-4 border-b">
              <h3 id="revert-modal-title" className="text-lg font-semibold">Revert keep flags</h3>
            </div>
            <div className="px-6 py-4 space-y-2">
              <p id="revert-modal-desc" className="text-sm text-gray-700">{revertDescription}</p>
            </div>
            <div className="px-6 py-4 border-t-0 flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300"
                onClick={() => setShowRevertModal(false)}
                disabled={reverting}
                aria-label="Cancel revert"
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-md bg-gray-600 text-white hover:bg-gray-700 disabled:opacity-50"
                onClick={confirmRevertChanges}
                disabled={reverting}
                aria-disabled={reverting ? 'true' : 'false'}
                aria-label="Confirm revert keep flags"
              >
                {reverting ? 'Reverting…' : 'Revert'}
              </button>
            </div>
          </div>
        </div>
      )}
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-gray-600">Loading project data...</span>
        </div>
      ) : (
        <div className="w-full px-4 sm:px-6 lg:px-8 pt-2 pb-8">


          {activeTab === 'view' && (
            <div>
              {isAllMode ? (
                <>
                  {viewMode === 'grid' && (
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <span className="text-xs text-gray-500 mr-2">Sort:</span>
                      <button
                        onClick={() => toggleSort('date')}
                        className={`text-sm px-2 py-1 rounded ${sortKey === 'date' ? 'font-semibold bg-gray-100' : 'text-gray-700 hover:bg-gray-100'}`}
                        title="Sort by date"
                      >
                        Date {sortKey === 'date' && (sortDir === 'asc' ? '▲' : '▼')}
                      </button>
                      <button
                        onClick={() => toggleSort('name')}
                        className={`text-sm px-2 py-1 rounded ${sortKey === 'name' ? 'font-semibold bg-gray-100' : 'text-gray-700 hover:bg-gray-100'}`}
                        title="Sort by name"
                      >
                        Name {sortKey === 'name' && (sortDir === 'asc' ? '▲' : '▼')}
                      </button>
                    </div>
                  )}
                  <AllPhotosPane
                    viewMode={viewMode}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    sizeLevel={sizeLevel}
                    onSortChange={toggleSort}
                    photos={allPhotos}
                    hasMore={!!allNextCursor}
                    onLoadMore={loadAllMore}
                    hasPrev={allHasPrev}
                    onLoadPrev={loadAllPrev}
                    anchorIndex={allGridAnchorIndex}
                    onAnchored={() => setAllGridAnchorIndex(null)}
                    lazyLoadThreshold={config?.photo_grid?.lazy_load_threshold ?? 100}
                    dwellMs={config?.photo_grid?.dwell_ms ?? 300}
                    onPhotoSelect={handleAllPhotoSelect}
                    onToggleSelection={handleToggleSelectionAll}
                    selectedPhotos={allSelectedKeys}
                  />
                </>
              ) : selectedProject ? (
                <>
                  {viewMode === 'grid' && (
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <span className="text-xs text-gray-500 mr-2">Sort:</span>
                      <button
                        onClick={() => toggleSort('date')}
                        className={`text-sm px-2 py-1 rounded ${sortKey === 'date' ? 'font-semibold bg-gray-100' : 'text-gray-700 hover:bg-gray-100'}`}
                        title="Sort by date"
                      >
                        Date {sortKey === 'date' && (sortDir === 'asc' ? '▲' : '▼')}
                      </button>
                      <button
                        onClick={() => toggleSort('name')}
                        className={`text-sm px-2 py-1 rounded ${sortKey === 'name' ? 'font-semibold bg-gray-100' : 'text-gray-700 hover:bg-gray-100'}`}
                        title="Sort by name"
                      >
                        Name {sortKey === 'name' && (sortDir === 'asc' ? '▲' : '▼')}
                      </button>
                    </div>
                  )}
                  <PhotoDisplay 
                    viewMode={viewMode}
                    projectData={filteredProjectData}
                    projectFolder={selectedProject?.folder}
                    onPhotoSelect={(photo) => handlePhotoSelect(photo, sortedPagedPhotos)}
                    onToggleSelection={handleToggleSelection}
                    selectedPhotos={selectedPhotos}
                    lazyLoadThreshold={config?.photo_grid?.lazy_load_threshold ?? 100}
                    dwellMs={config?.photo_grid?.dwell_ms ?? 300}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSortChange={toggleSort}
                    sizeLevel={sizeLevel}
                    photos={sortedPagedPhotos}
                    hasMore={!!nextCursor}
                    onLoadMore={loadMore}
                    hasPrev={projectHasPrev}
                    onLoadPrev={loadPrev}
                    anchorIndex={gridAnchorIndex}
                    onAnchored={() => setGridAnchorIndex(null)}
                  />
                </>
              ) : (
                projects.length > 0 && (
                  <div className="mt-10 text-center text-gray-600">Select a project from the dropdown to begin.</div>
                )
              )}
            </div>
          )}
        </div>
      )}
      {/* Commit confirmation modal */}
      {showCommitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="presentation">
          <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={() => setShowCommitModal(false)} />
          <div
            ref={commitModalRef}
            className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="commit-modal-title"
            aria-describedby="commit-modal-desc"
            aria-busy={committing ? 'true' : 'false'}
          >
            <div className="px-6 py-4 border-b">
              <h3 id="commit-modal-title" className="text-lg font-semibold">Commit pending deletions</h3>
            </div>
            <div className="px-6 py-4 space-y-2">
              <p id="commit-modal-desc" className="text-sm text-gray-700">{commitDescription}</p>
              <div className="text-sm text-gray-600">
                <div>Total pending: <span className="font-medium">{pendingDeleteTotals.total}</span></div>
                <div className="text-xs">JPG: {pendingDeleteTotals.jpg} · RAW: {pendingDeleteTotals.raw}</div>
                {pendingProjectsCount > 0 && (
                  <div className="text-xs">Projects affected: {pendingProjectsCount}</div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t-0 flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300"
                onClick={() => setShowCommitModal(false)}
                disabled={committing}
                aria-label="Cancel commit"
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                onClick={confirmCommitChanges}
                disabled={committing || pendingDeleteTotals.total === 0}
                aria-disabled={committing || pendingDeleteTotals.total === 0 ? 'true' : 'false'}
                aria-label="Confirm commit pending deletions"
              >
                {committing ? 'Committing…' : 'Commit'}
              </button>
            </div>
          </div>
        </div>
      )}

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
      {showCreateProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowCreateProject(false)} />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const name = newProjectName.trim();
                if (!name) return;
                await handleProjectCreate(name);
                setActiveTab('view');
                setShowCreateProject(false);
                setShowOptionsModal(false);
                setNewProjectName('');
              }}
            >
              <div className="px-6 py-4 border-b">
                <h3 className="text-lg font-semibold">Create new project</h3>
              </div>
              <div className="px-6 py-4 space-y-3">
                <label className="block">
                  <span className="text-gray-700">Project name</span>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="e.g. Family Trip 2025"
                    autoFocus
                  />
                </label>
              </div>
              <div className="px-6 py-4 border-t-0 flex justify-end gap-2">
                <button
                  type="button"
                  className="px-4 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300"
                  onClick={() => { setShowCreateProject(false); setNewProjectName(''); }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  disabled={!newProjectName.trim()}
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
        <div ref={commitBarRef} className="fixed bottom-0 inset-x-0 z-30">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-3 rounded-lg shadow-lg border bg-white">
              <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-3 text-sm" aria-live="polite">
                  <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800">
                    Pending deletions: {pendingDeleteTotals.total}
                  </span>
                  <span className="text-xs text-gray-600">JPG: {pendingDeleteTotals.jpg} · RAW: {pendingDeleteTotals.raw}</span>
                  {pendingProjectsCount > 1 && (
                    <span className="text-xs text-gray-600">Projects: {pendingProjectsCount}</span>
                  )}
                </div>
                <div className="w-full grid grid-cols-3 gap-2 sm:w-auto sm:flex sm:items-center">
                  {/* Preview Mode toggle switch - syncs with keepType any_kept */}
                  <div className="w-full flex items-center gap-2">
                    <span className="text-sm text-gray-700 select-none">Preview Mode</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={activeFilters.keepType === 'any_kept'}
                      onClick={() => setActiveFilters(prev => ({ ...prev, keepType: (prev.keepType === 'any_kept' ? 'any' : 'any_kept') }))}
                      className={`${activeFilters.keepType === 'any_kept' ? 'bg-blue-600' : 'bg-gray-200'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                      title="Toggle preview of photos that will be kept (JPG-only or RAW+JPG)"
                    >
                      <span
                        aria-hidden="true"
                        className={`${activeFilters.keepType === 'any_kept' ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                      />
                    </button>
                  </div>
                  <button
                    onClick={openRevertConfirm}
                    className="w-full px-3 py-2 rounded-md border text-sm bg-white text-gray-700 hover:bg-gray-50 border-gray-300 whitespace-nowrap"
                    title="Revert keep flags to match actual file availability"
                    aria-label="Revert changes to match file availability"
                  >
                    Revert Changes
                  </button>
                  <button
                    onClick={handleCommitChanges}
                    className="w-full px-3 py-2 rounded-md text-sm bg-red-600 text-white hover:bg-red-700"
                    title="Move unkept available files to .trash"
                    aria-label={`Commit ${pendingDeleteTotals.total} pending deletions`}
                  >
                    Commit ({pendingDeleteTotals.total})
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </UploadProvider>
  );
}

export default App;
