import React, { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { listProjects, getProject, createProject } from './api/projectsApi';
import { listProjectPhotos } from './api/photosApi';
import ProjectSelector from './components/ProjectSelector';
import PhotoDisplay from './components/PhotoDisplay';
import OperationsMenu from './components/OperationsMenu';
// OptionsMenu removed: hamburger opens unified panel directly
import SettingsProcessesModal from './components/SettingsProcessesModal';
import { openJobStream, fetchTaskDefinitions, listJobs } from './api/jobsApi';
import PhotoViewer from './components/PhotoViewer';
// Settings rendered via SettingsProcessesModal
import UniversalFilter from './components/UniversalFilter';
import { UploadProvider } from './upload/UploadContext';
import { useUpload } from './upload/UploadContext';
import UploadConfirmModal from './components/UploadConfirmModal';
import BottomUploadBar from './components/BottomUploadBar';
import GlobalDragDrop from './components/GlobalDragDrop';
import './App.css';
import { useToast } from './ui/toast/ToastContext';
import MovePhotosModal from './components/MovePhotosModal';
import { getSessionState, setSessionWindowY, setSessionMainY, setSessionViewer, clearSessionState, getLastProject, setLastProject } from './utils/storage';

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
  const [viewerState, setViewerState] = useState({ isOpen: false, startIndex: 0 });
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

  // Backend pagination state for grid view
  const [pagedPhotos, setPagedPhotos] = useState([]);
  const [pagedTotal, setPagedTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Commit and revert flows
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [committing, setCommitting] = useState(false);
  // Track the opener to restore focus when modal closes
  const commitOpenerElRef = useRef(null);
  // Revert modal state
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [reverting, setReverting] = useState(false);
  const revertOpenerElRef = useRef(null);
  // Move modal state
  const [showMoveModal, setShowMoveModal] = useState(false);

  const handleCommitChanges = () => {
    if (!selectedProject) return;
    // Save current focus to restore later
    try { commitOpenerElRef.current = document.activeElement; } catch {}
    setShowCommitModal(true);
  };

  // Normalize filenames: strip known photo extensions for tolerant comparisons
  const stripKnownExt = useCallback((name) => {
    try {
      const s = String(name || '');
      const m = s.match(/\.[A-Za-z0-9]+$/);
      if (!m) return s;
      const ext = m[0].toLowerCase();
      const known = new Set(['.jpg', '.jpeg', '.raw', '.arw', '.cr2', '.nef', '.dng']);
      return known.has(ext) ? s.slice(0, -ext.length) : s;
    } catch {
      return String(name || '');
    }
  }, []);

  // Map UI sort to API sort fields
  const resolveApiSort = useCallback(() => {
    const apiSort = (sortKey === 'date') ? 'date_time_original' : (sortKey === 'name' ? 'filename' : 'date_time_original');
    const apiDir = (sortDir === 'asc') ? 'ASC' : 'DESC';
    return { apiSort, apiDir };
  }, [sortKey, sortDir]);

  const loadFirstPage = useCallback(async (folder) => {
    if (!folder) return;
    const { apiSort, apiDir } = resolveApiSort();
    try {
      const res = await listProjectPhotos(folder, { sort: apiSort, dir: apiDir });
      setPagedPhotos(res.items || []);
      setPagedTotal(res.total || 0);
      setNextCursor(res.nextCursor ?? null);
    } catch (e) {
      console.warn('Failed to load first page', e);
      setPagedPhotos([]);
      setPagedTotal(0);
      setNextCursor(null);
    }
  }, [resolveApiSort]);

  const loadMore = useCallback(async () => {
    if (!selectedProject || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { apiSort, apiDir } = resolveApiSort();
      const res = await listProjectPhotos(selectedProject.folder, { cursor: nextCursor, sort: apiSort, dir: apiDir });
      setPagedPhotos(prev => prev.concat(res.items || []));
      setPagedTotal(res.total || pagedTotal);
      setNextCursor(res.nextCursor ?? null);
    } catch (e) {
      console.warn('Failed to load more photos', e);
    } finally {
      setLoadingMore(false);
    }
  }, [selectedProject, nextCursor, loadingMore, resolveApiSort, pagedTotal]);

  // Reset and reload first page when project or sort changes
  useEffect(() => {
    if (!selectedProject) return;
    setPagedPhotos([]);
    setPagedTotal(0);
    setNextCursor(null);
    // Debounce slightly to allow projectData to settle
    const id = setTimeout(() => { loadFirstPage(selectedProject.folder); }, 0);
    return () => clearTimeout(id);
  }, [selectedProject, sortKey, sortDir, loadFirstPage]);

  const confirmCommitChanges = async () => {
    if (!selectedProject) return;
    setCommitting(true);
    try {
      // Optimistic hide: mark pending deletions as missing immediately to avoid 404s
      setProjectData(prev => {
        if (!prev || !Array.isArray(prev.photos)) return prev;
        const photos = [];
        for (const p of prev.photos) {
          const willRemoveJpg = !!p.jpg_available && p.keep_jpg === false;
          const willRemoveRaw = !!p.raw_available && p.keep_raw === false;
          if (!willRemoveJpg && !willRemoveRaw) { photos.push(p); continue; }
          const next = { ...p };
          if (willRemoveJpg) {
            next.jpg_available = false;
            next.thumbnail_status = 'missing';
            next.preview_status = 'missing';
          }
          if (willRemoveRaw) {
            next.raw_available = false;
          }
          // If both assets will be gone, drop from list immediately
          if (!next.jpg_available && !next.raw_available) {
            // skip push → remove from list
          } else {
            photos.push(next);
          }
        }
        return { ...prev, photos };
      });
      // Keep paginated grid in sync with optimistic commit
      setPagedPhotos(prev => {
        if (!Array.isArray(prev)) return prev;
        const result = [];
        for (const p of prev) {
          const willRemoveJpg = !!p.jpg_available && p.keep_jpg === false;
          const willRemoveRaw = !!p.raw_available && p.keep_raw === false;
          if (!willRemoveJpg && !willRemoveRaw) { result.push(p); continue; }
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
            // remove entirely
          } else {
            result.push(next);
          }
        }
        return result;
      });

      await toast.promise(
        (async () => {
          const res = await fetch(`/api/projects/${encodeURIComponent(selectedProject.folder)}/commit-changes`, { method: 'POST' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
      console.error('Commit changes failed', e);
      // Revert optimistic changes by refetching on failure
      if (selectedProject) {
        try { await fetchProjectData(selectedProject.folder); } catch {}
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
  // When creating a new project, remember which one to auto-select after the projects list refreshes
  const pendingSelectProjectRef = useRef(null);
  // Toast offset for commit/revert bar
  const toast = useToast();
  const commitBarRef = useRef(null);
  // Track whether SSE stream is connected (to reduce fallback polling)
  const sseReadyRef = useRef(false);

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
  const pendingDeletes = useMemo(() => {
    const photos = projectData?.photos || [];
    let jpg = 0, raw = 0;
    for (const p of photos) {
      if (p.jpg_available && p.keep_jpg === false) jpg++;
      if (p.raw_available && p.keep_raw === false) raw++;
    }
    return { jpg, raw, total: jpg + raw };
  }, [projectData]);

  // Reserve space for the commit/revert bottom bar so toasts don't overlap it
  useLayoutEffect(() => {
    if (!selectedProject || !pendingDeletes || pendingDeletes.total <= 0) {
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
  }, [toast, selectedProject, pendingDeletes?.total]);

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
      console.warn('Failed to load ui_prefs', e);
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
      console.warn('Failed to save ui_prefs', e);
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
      console.warn('Failed initial save ui_prefs', e);
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

  // Keyboard shortcuts moved below filteredProjectData definition to avoid TDZ

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
  }, [projects, selectedProject, config]);

  // Remember selected project (configurable)
  useEffect(() => {
    if (selectedProject) {
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
      console.error('Error fetching projects:', error);
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
      try { loadFirstPage(projectFolder); } catch {}
    } catch (error) {
      console.error('Error fetching project data:', error);
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

  // Persist viewer state (session-only). Avoid overwriting saved session state on initial mount
  useEffect(() => {
    // If we haven't restored yet and current state isn't explicitly open, skip the initial write
    if (!viewerRestoredRef.current && !(viewerState && viewerState.isOpen)) return;
    try { setSessionViewer(viewerState || { isOpen: false }); } catch {}
  }, [viewerState]);

  // Removed premature restore: we restore after photos are available below

  const handleProjectSelect = (project) => {
    // Handle null/invalid project selection (e.g., dropdown placeholder)
    if (!project || !project.folder) {
      setSelectedProject(null);
      setProjectData(null);
      setSelectedPhotos(new Set());
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
    fetchProjectData(project.folder);
    setSelectedPhotos(new Set()); // Clear selection when switching projects
  };

  // Auto-refresh and fine-grained updates via SSE
  useEffect(() => {
    const close = openJobStream((evt) => {
      // Any message implies SSE is active
      sseReadyRef.current = true;

      // 0) Manifest changes: prefer incremental updates, no hard refetch
      if (evt && evt.type === 'manifest_changed' && selectedProject && evt.project_folder === selectedProject.folder) {
        if (Array.isArray(evt.removed_filenames) && evt.removed_filenames.length) {
          const toRemove = new Set(evt.removed_filenames);
          setProjectData(prev => {
            if (!prev || !Array.isArray(prev.photos)) return prev;
            const photos = prev.photos.filter(p => !toRemove.has(p.filename));
            return { ...prev, photos };
          });
          setPagedPhotos(prev => Array.isArray(prev) ? prev.filter(p => !toRemove.has(p.filename)) : prev);
        }
        return;
      }

      // 1) Item-level updates without full refetch
      if (evt && evt.type === 'item' && selectedProject && evt.project_folder === selectedProject.folder) {
        setProjectData(prev => {
          if (!prev || !Array.isArray(prev.photos)) return prev;
          const target = String(evt.filename || '');
          const targetBase = stripKnownExt(target);
          const idx = prev.photos.findIndex(p => (p.filename === target) || (stripKnownExt(p.filename) === targetBase));
          if (idx === -1) return prev;
          const updated = { ...prev.photos[idx] };
          if (evt.thumbnail_status) updated.thumbnail_status = evt.thumbnail_status;
          if (evt.preview_status) updated.preview_status = evt.preview_status;
          // Also reconcile keep flags if present
          if (typeof evt.keep_jpg === 'boolean') updated.keep_jpg = evt.keep_jpg;
          if (typeof evt.keep_raw === 'boolean') updated.keep_raw = evt.keep_raw;
          if (evt.updated_at) updated.updated_at = evt.updated_at;
          const photos = prev.photos.slice();
          photos[idx] = updated;
          return { ...prev, photos };
        });
        // Mirror update into paginated grid
        setPagedPhotos(prev => {
          if (!Array.isArray(prev)) return prev;
          const target = String(evt.filename || '');
          const targetBase = stripKnownExt(target);
          const idx = prev.findIndex(p => (p.filename === target) || (stripKnownExt(p.filename) === targetBase));
          if (idx === -1) return prev;
          const updated = { ...prev[idx] };
          if (evt.thumbnail_status) updated.thumbnail_status = evt.thumbnail_status;
          if (evt.preview_status) updated.preview_status = evt.preview_status;
          if (typeof evt.keep_jpg === 'boolean') updated.keep_jpg = evt.keep_jpg;
          if (typeof evt.keep_raw === 'boolean') updated.keep_raw = evt.keep_raw;
          if (evt.updated_at) updated.updated_at = evt.updated_at;
          const next = prev.slice();
          next[idx] = updated;
          return next;
        });
        return; // handled
      }

      // 1b) Item removed: drop from list in-place (tolerant to extension differences)
      if (evt && evt.type === 'item_removed' && selectedProject && evt.project_folder === selectedProject.folder) {
        try { console.debug('[SSE] item_removed received', { evt, selectedFolder: selectedProject.folder }); } catch {}
        const fname = String(evt.filename || '');
        const base = stripKnownExt(fname);
        setProjectData(prev => {
          if (!prev || !Array.isArray(prev.photos)) return prev;
          const before = prev.photos.length;
          const photos = prev.photos.filter(p => p.filename !== fname && stripKnownExt(p.filename) !== base);
          try { console.debug('[SSE] item_removed projectData updated', { before, after: photos.length, removed: before - photos.length, fname, base }); } catch {}
          return { ...prev, photos };
        });
        setPagedPhotos(prev => {
          if (!Array.isArray(prev)) return prev;
          const before = prev.length;
          const next = prev.filter(p => p.filename !== fname && stripKnownExt(p.filename) !== base);
          try { console.debug('[SSE] item_removed pagedPhotos updated', { before, after: next.length, removed: before - next.length }); } catch {}
          return next;
        });
        return; // handled
      }

      // 1c) Item moved into this project: update if exists (tolerant match), else soft refetch
      if (evt && evt.type === 'item_moved' && selectedProject && evt.project_folder === selectedProject.folder) {
        try { console.debug('[SSE] item_moved received', { evt, selectedFolder: selectedProject.folder }); } catch {}
        const fname = String(evt.filename || '');
        const base = stripKnownExt(fname);
        // Determine presence before updating state to avoid relying on side-effects inside setState
        const existsInProjectData = Array.isArray(projectData?.photos)
          ? projectData.photos.findIndex(p => p.filename === fname || stripKnownExt(p.filename) === base) !== -1
          : false;
        const existsInPaged = Array.isArray(pagedPhotos)
          ? pagedPhotos.findIndex(p => p.filename === fname || stripKnownExt(p.filename) === base) !== -1
          : false;

        setProjectData(prev => {
          if (!prev || !Array.isArray(prev.photos)) return prev;
          const idx = prev.photos.findIndex(p => p.filename === fname || stripKnownExt(p.filename) === base);
          if (idx === -1) return prev;
          const updated = { ...prev.photos[idx] };
          if (evt.thumbnail_status) updated.thumbnail_status = evt.thumbnail_status;
          if (evt.preview_status) updated.preview_status = evt.preview_status;
          if (typeof evt.keep_jpg === 'boolean') updated.keep_jpg = evt.keep_jpg;
          if (typeof evt.keep_raw === 'boolean') updated.keep_raw = evt.keep_raw;
          if (evt.updated_at) updated.updated_at = evt.updated_at;
          const photos = prev.photos.slice();
          photos[idx] = updated;
          try { console.debug('[SSE] item_moved projectData updatedInPlace', { idx, fname, base }); } catch {}
          return { ...prev, photos };
        });
        setPagedPhotos(prev => {
          if (!Array.isArray(prev)) return prev;
          const idx = prev.findIndex(p => p.filename === fname || stripKnownExt(p.filename) === base);
          if (idx === -1) return prev;
          const updated = { ...prev[idx] };
          if (evt.thumbnail_status) updated.thumbnail_status = evt.thumbnail_status;
          if (evt.preview_status) updated.preview_status = evt.preview_status;
          const next = prev.toSpliced ? prev.toSpliced(idx, 1, updated) : (() => { const n = prev.slice(); n[idx] = updated; return n; })();
          try { console.debug('[SSE] item_moved pagedPhotos updatedInPlace', { idx }); } catch {}
          return next;
        });
        // If it wasn't present in either list, it's a new arrival; do a light refetch
        if (!existsInProjectData && !existsInPaged) {
          try { console.debug('[SSE] item_moved not found in-place; light refetch'); fetchProjectData(selectedProject.folder); } catch {}
        }
        return; // handled
      }

      // 2) Task completion toasts (user-relevant tasks only)
      if (evt && selectedProject && evt.payload_json && evt.payload_json.task_id && evt.payload_json.task_type && (evt.status === 'completed' || evt.status === 'failed')) {
        const tid = evt.payload_json.task_id;
        const ttype = evt.payload_json.task_type;
        const meta = taskDefs?.[ttype];
        const userRelevant = meta ? (meta.user_relevant !== false) : true;
        if (userRelevant && !notifiedTasksRef.current.has(tid)) {
          // Debounce-check: after a short delay, fetch jobs and see if any for this task are still running/queued
          setTimeout(async () => {
            try {
              const { jobs } = await listJobs(selectedProject.folder, { limit: 100 });
              const sameTask = (jobs || []).filter(j => j?.payload_json?.task_id === tid);
              const anyActive = sameTask.some(j => j.status === 'running' || j.status === 'queued');
              if (anyActive) return; // not done yet
              const anyFailed = sameTask.some(j => j.status === 'failed');
              const label = meta?.label || ttype;
              if (anyFailed) {
                toast.show({ emoji: '⚠️', message: `${label} failed`, variant: 'error' });
              } else {
                toast.show({ emoji: '✅', message: `${label} completed`, variant: 'success' });
              }
              notifiedTasksRef.current.add(tid);
            } catch (_) {}
          }, 400);
        }
      }

      // 3) Do not refetch on job completion; rely on item/item_removed + manifest_changed handling
    });
    return () => close();
  }, [selectedProject, taskDefs, stripKnownExt]);

  // Fallback polling: while any thumbnail is pending and SSE not yet delivering, periodically refetch
  useEffect(() => {
    if (!selectedProject) return;
    if (committing) return; // avoid refetch during commit
    const photos = projectData?.photos || [];
    const anyPending = photos.some(p => p && (p.thumbnail_status === 'pending' || !p.thumbnail_status));
    if (!anyPending) return;
    if (sseReadyRef.current) return; // SSE active; rely on item-level updates instead
    const id = setInterval(() => {
      fetchProjectData(selectedProject.folder);
    }, 3000);
    return () => clearInterval(id);
  }, [selectedProject, projectData, committing]);

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
      console.error('Error creating project:', error);
    }
  };

  const handlePhotosUploaded = () => {
    if (selectedProject) {
      fetchProjectData(selectedProject.folder);
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
    setPagedPhotos(prev => {
      if (!Array.isArray(prev)) return prev;
      const byName = new Map(updates.map(u => [u.filename, u]));
      return prev.map(p => {
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
    try {
      setSessionViewer({
        isOpen: true,
        startIndex: photoIndex >= 0 ? photoIndex : 0,
        filename: photo?.filename || undefined,
      });
    } catch {}
  };

  const handleCloseViewer = () => {
    setViewerState({ isOpen: false, startIndex: 0 });
    try { setSessionViewer({ isOpen: false }); } catch {}
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

  // Stable callback to persist current viewer index/filename during navigation
  const handleViewerIndexChange = useCallback((idx, photo) => {
    try {
      setSessionViewer({
        isOpen: true,
        startIndex: Number(idx) || 0,
        filename: photo?.filename || undefined,
      });
    } catch {}
  }, []);

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
      console.error('Error fetching config:', error);
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
        
        // Debug logging - remove this after fixing
        if (index === 0) { // Debug first photo only
          console.log('Orientation filter debug for:', photo.filename);
          console.log('Available metadata keys:', Object.keys(photo.metadata || {}));
          console.log('EXIF orientation value:', orientation);
          console.log('Raw dimensions:', { width, height });
        }
        
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
          
          console.log('Final orientation determination:', {
            actuallyVertical,
            actuallyHorizontal,
            orientationValue: orientation
          });
          
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

  // Restore viewer state (open and index/filename) once filtered photos are ready from session state
  useEffect(() => {
    if (activeTab !== 'view') return;
    const photos = filteredProjectData?.photos || projectData?.photos;
    if (!photos || photos.length === 0) return;
    if (viewerRestoredRef.current) return;
    const st = getSessionState();
    const v = st?.viewer;
    if (!v || !v.isOpen) return;
    let idx = Number.isFinite(v.startIndex) ? v.startIndex : 0;
    if (v.filename) {
      const found = photos.findIndex(p => p.filename === v.filename);
      if (found >= 0) idx = found; else idx = Math.min(Math.max(idx, 0), photos.length - 1);
    } else {
      idx = Math.min(Math.max(idx, 0), photos.length - 1);
    }
    viewerRestoredRef.current = true;
    setViewerState({ isOpen: true, startIndex: idx });
  }, [activeTab, filteredProjectData, projectData]);

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
          const res = await fetch(`/api/projects/${encodeURIComponent(selectedProject.folder)}/revert-changes`, { method: 'POST' });
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
          setPagedPhotos(prev => {
            if (!Array.isArray(prev)) return prev;
            return prev.map(p => ({
              ...p,
              keep_jpg: !!p.jpg_available,
              keep_raw: !!p.raw_available,
            }));
          });
        })(),
        {
          pending: { emoji: '↩️', message: 'Reverting…', variant: 'info' },
          success: { emoji: '✅', message: 'Reverted keep flags to availability', variant: 'success' },
          error:   { emoji: '⚠️', message: 'Revert failed', variant: 'error' }
        }
      );
      setShowRevertModal(false);
    } catch (e) {
      console.error('Revert changes failed', e);
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
        actions.startAnalyze(files);
      }
      // reset so selecting the same files again still triggers change
      e.target.value = '';
    };
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
          disabled={disabled}
          className={`inline-flex items-center justify-center px-3 py-2 rounded-md ${disabled ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
          title={disabled ? 'Select a project to enable uploads' : 'Upload photos'}
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
    <UploadProvider projectFolder={selectedProject?.folder} onCompleted={handlePhotosUploaded}>
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
                <UploadButton disabled={!selectedProject} />
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
        {selectedProject && (
          <div className="bg-white border-b-0 relative">
            <div className="w-full px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center">
                  <ProjectSelector 
                    projects={projects}
                    selectedProject={selectedProject}
                    onProjectSelect={handleProjectSelect}
                  />
                </div>
                
                {/* Filters cluster: toggle + counts + clear */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFiltersCollapsed(!filtersCollapsed)}
                    className={`flex items-center gap-2 py-2 px-2 sm:py-3 sm:px-3 text-sm font-medium transition-colors text-gray-700 hover:text-gray-900`}
                    disabled={loading}
                  >
                    {/* Desktop label with small badge */}
                    <span className="hidden sm:inline relative">
                      Filters
                      {activeFilterCount > 0 && (
                        <span className="absolute -top-2 -right-3 inline-flex items-center justify-center min-w-[1rem] h-4 px-[0.25rem] text-[10px] font-semibold rounded-full bg-blue-100 text-blue-800">
                          {activeFilterCount}
                        </span>
                      )}
                    </span>
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
                  {/* Count next to Filters: e.g., 8 of 65 */}
                  <span className="text-sm text-gray-600 whitespace-nowrap">
                    {hasActiveFilters ? (
                      <>
                        <span className="font-medium">{filteredPhotos.length}</span> of {projectData?.photos?.length || 0}
                      </>
                    ) : (
                      <>
                        {projectData?.photos?.length || 0} images
                      </>
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
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        if (!filteredProjectData?.photos?.length) return;
                        if (selectedPhotos.size === filteredProjectData.photos.length) {
                          setSelectedPhotos(new Set());
                        } else {
                          setSelectedPhotos(new Set(filteredProjectData.photos.map(e => e.filename)));
                        }
                      }}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      {selectedPhotos.size === filteredProjectData?.photos?.length ? 'Deselect All' : 'Select All'}
                    </button>
                    <span className="text-sm text-gray-600">{selectedPhotos.size} selected</span>
                  </div>

                  {/* Right: View toggle + Operations */}
                  <div className="flex items-center gap-2">
                    {selectedPhotos.size === 0 ? (
                      <div key="controls" className="flex items-center gap-2 transition-all duration-150 ease-out transform opacity-100 scale-100 animate-fadeInScale">
                        <div className="flex space-x-2">
                          {/* Gallery (grid) icon */}
                          <button
                            onClick={() => setViewMode('grid')}
                            className={`px-2.5 py-1.5 rounded-md ${viewMode === 'grid' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}
                            title="Gallery view"
                            aria-label="Gallery view"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M3 3h6v6H3V3zm8 0h6v6H11V3zM3 11h6v6H3v-6zm8 6h6v-6H11v6z" />
                            </svg>
                          </button>
                          {/* Details (table/list) icon */}
                          <button
                            onClick={() => setViewMode('table')}
                            className={`px-2.5 py-1.5 rounded-md ${viewMode === 'table' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}
                            title="Details view"
                            aria-label="Details view"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M3 5h14v2H3V5zm0 4h14v2H3V9zm0 4h14v2H3v-2z" />
                            </svg>
                          </button>
                        </div>
                        {/* Size control: s/m/l */}
                        {selectedProject && (
                          <div className="ml-2 hidden md:inline-flex rounded-md overflow-hidden border">
                            <button
                              className={`px-2 py-1 text-sm ${sizeLevel === 's' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
                              onClick={() => setSizeLevel('s')}
                              title="Small previews"
                              aria-label="Small previews"
                            >
                              S
                            </button>
                            <button
                              className={`px-2 py-1 text-sm border-l ${sizeLevel === 'm' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
                              onClick={() => setSizeLevel('m')}
                              title="Medium previews"
                              aria-label="Medium previews"
                            >
                              M
                            </button>
                            <button
                              className={`px-2 py-1 text-sm border-l ${sizeLevel === 'l' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
                              onClick={() => setSizeLevel('l')}
                              title="Large previews"
                              aria-label="Large previews"
                            >
                              L
                            </button>
                          </div>
                        )}
                        {/* Mobile: single size cycle button */}
                        {selectedProject && (
                          <button
                            className="ml-2 md:hidden px-2.5 py-1 text-xs rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300"
                            onClick={() => setSizeLevel(prev => (prev === 's' ? 'm' : prev === 'm' ? 'l' : 's'))}
                            title="Change preview size"
                            aria-label="Change preview size"
                          >
                            Size {sizeLevel.toUpperCase()}
                          </button>
                        )}
                      </div>
                    ) : (
                      selectedProject && (
                        <div key="actions" className="transition-all duration-150 ease-out transform opacity-100 scale-100 animate-fadeInScale">
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
                          />
                        </div>
                      )
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
                    setPagedPhotos(prev => Array.isArray(prev) ? prev.filter(p => !toRemove.has(p.filename)) : prev);
                  }
                  // Clear selection after updating UI
                  setSelectedPhotos(new Set());
                }
              }}
              sourceFolder={selectedProject ? selectedProject.folder : ''}
              selectedFilenames={Array.from(selectedPhotos || [])}
            />

            {/* Filters Panel */}
            {!filtersCollapsed && (
              <div className="bg-white border-t-0 animate-slideDownFade">
                <UniversalFilter
                  projectData={projectData}
                  filters={activeFilters}
                  onFilterChange={setActiveFilters}
                  disabled={loading}
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
              <p id="revert-modal-desc" className="text-sm text-gray-700">This will reset all keep flags to match the actual file availability in the project.</p>
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
              {/* If no project selected, show a gentle prompt */}
              {!selectedProject && projects.length > 0 && (
                <div className="mt-10 text-center text-gray-600">Select a project from the dropdown to begin.</div>
              )}
              {selectedProject && (
                <>
                {/* Grid sorting controls */}
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
              />
              </>
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
              <p id="commit-modal-desc" className="text-sm text-gray-700">This will move files marked not to keep into the project's .trash folder.</p>
              <div className="text-sm text-gray-600">
                <div>Total pending: <span className="font-medium">{pendingDeletes.total}</span></div>
                <div className="text-xs">JPG: {pendingDeletes.jpg} · RAW: {pendingDeletes.raw}</div>
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
                disabled={committing || pendingDeletes.total === 0}
                aria-disabled={committing || pendingDeletes.total === 0 ? 'true' : 'false'}
                aria-label="Confirm commit pending deletions"
              >
                {committing ? 'Committing…' : 'Commit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewerState.isOpen && (
        <PhotoViewer 
          projectData={filteredProjectData || projectData}
          projectFolder={selectedProject?.folder}
          startIndex={viewerState.startIndex}
          onClose={handleCloseViewer}
          config={config}
          selectedPhotos={selectedPhotos}
          onToggleSelect={handleToggleSelection}
          onKeepUpdated={handleKeepUpdated}
          onCurrentIndexChange={handleViewerIndexChange}
        />
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
      {selectedProject?.folder && <GlobalDragDrop />}
      {/* Persistent bottom bar for pending commit/revert */}
      {selectedProject && pendingDeletes.total > 0 && (
        <div ref={commitBarRef} className="fixed bottom-0 inset-x-0 z-30">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-3 rounded-lg shadow-lg border bg-white">
              <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-3 text-sm" aria-live="polite">
                  <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800">
                    Pending deletions: {pendingDeletes.total}
                  </span>
                  <span className="text-xs text-gray-600">JPG: {pendingDeletes.jpg} · RAW: {pendingDeletes.raw}</span>
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
                    aria-label={`Commit ${pendingDeletes.total} pending deletions`}
                  >
                    Commit ({pendingDeletes.total})
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
