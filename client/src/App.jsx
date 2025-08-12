import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { listProjects, getProject, createProject } from './api/projectsApi';
import ProjectSelector from './components/ProjectSelector';
import PhotoDisplay from './components/PhotoDisplay';
import OperationsMenu from './components/OperationsMenu';
// OptionsMenu removed: hamburger opens unified panel directly
import SettingsProcessesModal from './components/SettingsProcessesModal';
import { openJobStream } from './api/jobsApi';
import PhotoViewer from './components/PhotoViewer';
// Settings rendered via SettingsProcessesModal
import UniversalFilter from './components/UniversalFilter';
import { UploadProvider } from './upload/UploadContext';
import UploadConfirmModal from './components/UploadConfirmModal';
import BottomUploadBar from './components/BottomUploadBar';
import GlobalDragDrop from './components/GlobalDragDrop';
import './App.css';

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
    previewMode: false
  });
  // Sorting state: key: 'date' | 'name' | other (for table)
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc' (date newest first by default)
  // Grid/table preview size: 's' | 'm' | 'l'
  const [sizeLevel, setSizeLevel] = useState('m');


  // Refs
  const mainRef = useRef(null);
  const initialSavedYRef = useRef(null);
  const prefsLoadedOnceRef = useRef(false);
  const viewerRestoredRef = useRef(false);
  const DEBUG_PERSIST = false; // set true to see console logs

  // Track if UI prefs were loaded so config defaults don't overwrite them
  const uiPrefsLoadedRef = useRef(false);
  // Track readiness to persist, to avoid saving defaults before load completes
  const uiPrefsReadyRef = useRef(false);
  const [uiPrefsReady, setUiPrefsReady] = useState(false);
  // When creating a new project, remember which one to auto-select after the projects list refreshes
  const pendingSelectProjectRef = useRef(null);

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

  // Persist and restore window scroll position (single-tab session)
  useEffect(() => {
    const savedY = sessionStorage.getItem('window_scroll_y');
    if (savedY) {
      initialSavedYRef.current = parseInt(savedY, 10) || 0;
    }
    const onScroll = () => {
      sessionStorage.setItem('window_scroll_y', String(window.scrollY || window.pageYOffset || 0));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    const onLoad = () => {
      if (initialSavedYRef.current != null) {
        try { window.scrollTo(0, initialSavedYRef.current); } catch {}
      }
    };
    window.addEventListener('load', onLoad, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Re-apply saved window scroll after content renders (e.g., photos list ready)
  useEffect(() => {
    if (initialSavedYRef.current == null) return;
    if (activeTab !== 'view') return;
    // defer to next paint to ensure layout is ready
    const y = initialSavedYRef.current;
    let raf1 = requestAnimationFrame(() => {
      let raf2 = requestAnimationFrame(() => {
        try { window.scrollTo(0, y); } catch {}
      });
      // store id so cleanup can cancel
      (window.__raf2 ||= []).push(raf2);
    });
    (window.__raf1 ||= []).push(raf1);
    return () => {
      if (window.__raf1) { window.__raf1.forEach(id => cancelAnimationFrame(id)); window.__raf1 = []; }
      if (window.__raf2) { window.__raf2.forEach(id => cancelAnimationFrame(id)); window.__raf2 = []; }
    };
  }, [activeTab, projectData, config]);

  // (moved below filteredProjectData declaration to avoid TDZ)
  // Persist and restore main scroll position (single-tab session)
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    // restore
    const saved = sessionStorage.getItem('main_scroll_top');
    if (saved) {
      try { el.scrollTop = parseInt(saved, 10) || 0; } catch {}
    }
    const onScroll = () => {
      sessionStorage.setItem('main_scroll_top', String(el.scrollTop));
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
      if (typeof config.ui?.preview_mode_default === 'boolean') {
        setActiveFilters(prev => ({ ...prev, previewMode: config.ui.preview_mode_default }));
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
        const lastProjectFolder = localStorage.getItem('druso-last-project');
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
        localStorage.setItem('druso-last-project', selectedProject.folder);
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
    setLoading(true);
    try {
      const data = await getProject(projectFolder);
      setProjectData(data);
    } catch (error) {
      console.error('Error fetching project data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProjectSelect = (project) => {
    // Handle null/invalid project selection (e.g., dropdown placeholder)
    if (!project || !project.folder) {
      setSelectedProject(null);
      setProjectData(null);
      setSelectedPhotos(new Set());
      return;
    }
    
    setSelectedProject(project);
    fetchProjectData(project.folder);
    setSelectedPhotos(new Set()); // Clear selection when switching projects
  };

  // Auto-refresh thumbnails when any job completes (e.g., generate_derivatives/upload_postprocess)
  useEffect(() => {
    const close = openJobStream((evt) => {
      if (evt && evt.status === 'completed' && selectedProject) {
        fetchProjectData(selectedProject.folder);
      }
    });
    return () => close && close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject]);

  const handleProjectCreate = async (projectName) => {
    try {
      const created = await createProject(projectName);
      const createdFolder = created?.project?.folder || created?.folder || created?.project_folder;
      if (createdFolder) {
        // set BEFORE updating projects to beat the effect race
        pendingSelectProjectRef.current = createdFolder;
        // also persist immediately so remember-last-project points to the new one
        try { localStorage.setItem('druso-last-project', createdFolder); } catch {}
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

  const handleProjectDeleted = () => {
    // Force page refresh to ensure clean state after project deletion
    window.location.reload();
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
      sessionStorage.setItem('viewer_open', '1');
      if (photo?.filename) sessionStorage.setItem('viewer_filename', photo.filename);
      sessionStorage.setItem('viewer_index', String(photoIndex >= 0 ? photoIndex : 0));
    } catch {}
  };

  const handleCloseViewer = () => {
    setViewerState({ isOpen: false, startIndex: 0 });
    try { sessionStorage.setItem('viewer_open', '0'); } catch {}
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
      sessionStorage.setItem('viewer_index', String(idx));
      if (photo?.filename) sessionStorage.setItem('viewer_filename', photo.filename);
      sessionStorage.setItem('viewer_open', '1');
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

  // Filter photos based on active filters
  const getFilteredPhotos = () => {
    if (!projectData?.photos) return [];
    
    return projectData.photos.filter((photo, index) => {
      // Preview mode: hide cancelled items where both keeps are false
      if (activeFilters.previewMode) {
        const kj = photo.keep_jpg !== false; // treat missing as true by default unless explicitly false
        const kr = photo.keep_raw === true;  // treat missing as false by default unless explicitly true
        if (!kj && !kr) return false;
      }
      // Text search filter
      if (activeFilters.textSearch) {
        const searchTerm = activeFilters.textSearch.toLowerCase();
        const matchesFilename = photo.filename?.toLowerCase().includes(searchTerm);
        const matchesTags = photo.tags?.some(tag => tag.toLowerCase().includes(searchTerm));
        const matchesMetadata = photo.metadata && Object.values(photo.metadata).some(value => 
          typeof value === 'string' && value.toLowerCase().includes(searchTerm)
        );
        
        if (!matchesFilename && !matchesTags && !matchesMetadata) {
          return false;
        }
      }
      
      // Date range filter (only uses date_time_original field)
      if (activeFilters.dateRange?.start || activeFilters.dateRange?.end) {
        const photoDate = photo.date_time_original;
        if (photoDate) {
          const date = new Date(photoDate).toISOString().split('T')[0];
          
          if (activeFilters.dateRange.start && date < activeFilters.dateRange.start) {
            return false;
          }
          
          if (activeFilters.dateRange.end && date > activeFilters.dateRange.end) {
            return false;
          }
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
    });
  };

  // Get filtered photos for display
  const filteredPhotos = getFilteredPhotos();

  // Sort filtered photos (stable) with useMemo for performance
  const sortedPhotos = useMemo(() => {
    const arr = [...filteredPhotos];
    const compare = (a, b) => {
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
    };
    arr.sort(compare);
    return arr;
  }, [filteredPhotos, sortKey, sortDir]);
  const filteredProjectData = projectData ? {
    ...projectData,
    photos: sortedPhotos
  } : null;

  // Restore viewer state (open and index/filename) once filtered photos are ready
  useEffect(() => {
    if (activeTab !== 'view') return;
    const photos = filteredProjectData?.photos || projectData?.photos;
    if (!photos || photos.length === 0) return;
    if (viewerRestoredRef.current) return;
    let shouldOpen = false;
    try { shouldOpen = sessionStorage.getItem('viewer_open') === '1'; } catch {}
    if (!shouldOpen) return;
    let idx = 0;
    let fname = null;
    try { fname = sessionStorage.getItem('viewer_filename') || null; } catch {}
    if (fname) {
      const found = photos.findIndex(p => p.filename === fname);
      if (found >= 0) idx = found; else {
        try { const storedIdx = parseInt(sessionStorage.getItem('viewer_index') || '0', 10); idx = isNaN(storedIdx) ? 0 : Math.min(Math.max(storedIdx, 0), photos.length - 1); } catch {}
      }
    } else {
      try { const storedIdx = parseInt(sessionStorage.getItem('viewer_index') || '0', 10); idx = isNaN(storedIdx) ? 0 : Math.min(Math.max(storedIdx, 0), photos.length - 1); } catch {}
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
    (activeFilters.orientation && activeFilters.orientation !== 'any' ? 1 : 0) +
    (activeFilters.previewMode ? 1 : 0)
  );

  const hasActiveFilters = !!(
    (activeFilters.textSearch && activeFilters.textSearch.trim()) ||
    activeFilters.dateRange?.start ||
    activeFilters.dateRange?.end ||
    (activeFilters.fileType && activeFilters.fileType !== 'any') ||
    (activeFilters.orientation && activeFilters.orientation !== 'any') ||
    activeFilters.previewMode
  );

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

  return (
    <UploadProvider projectFolder={selectedProject?.folder} onCompleted={handlePhotosUploaded}>
    <div className="min-h-screen bg-gray-50" ref={mainRef}>
      {/* Sticky Header Container */}
      <div className="sticky top-0 z-20 bg-gray-50">
        {/* Header */}
        <header className="bg-gray-100 shadow-sm border-b relative">
          <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <h1 className="text-2xl font-bold text-gray-900">
                Druso Photo Manager
              </h1>
              
              {/* Right Controls: Create project + Panel (hamburger opens panel) */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowCreateProject(true)}
                  className="inline-flex items-center justify-center px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  title="Create project"
                  aria-label="Create project"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                </button>
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
              </div>
            </div>
          </div>
          
          {/* Mobile menu overlay removed; Actions menu used across devices */}
        </header>

        {/* Project selector bar (replaces tabs) */}
        {selectedProject && (
          <div className="bg-white border-b relative">
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
                        previewMode: false
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
              <div className="px-4 py-2 bg-white border-t">
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
                    <div className="flex space-x-2">
                      {/* Gallery (grid) icon */}
                      <button
                        onClick={() => setViewMode('grid')}
                        className={`px-2.5 py-1.5 rounded-md ${
                          viewMode === 'grid' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
                        }`}
                        title="Gallery view"
                        aria-label="Gallery view"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M3 3h6v6H3V3zm8 0h6v6h-6V3zM3 11h6v6H3v-6zm8 6v-6h6v6h-6z" />
                        </svg>
                      </button>
                      {/* Details (table/list) icon */}
                      <button
                        onClick={() => setViewMode('table')}
                        className={`px-2.5 py-1.5 rounded-md ${
                          viewMode === 'table' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
                        }`}
                        title="Details view"
                        aria-label="Details view"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M3 5h14v2H3V5zm0 4h14v2H3V9zm0 4h14v2H3v-2z" />
                        </svg>
                      </button>

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
                    {/* Restore Actions menu in controls bar */}
                    {selectedProject && (
                      <div className="flex items-center gap-2">
                        {/* Actions (selected items) */}
                        <OperationsMenu
                          projectFolder={selectedProject.folder}
                          projectData={filteredProjectData}
                          selectedPhotos={selectedPhotos}
                          setSelectedPhotos={setSelectedPhotos}
                          onTagsUpdated={handleTagsUpdated}
                          config={config}
                          previewModeEnabled={activeFilters.previewMode}
                          trigger="label"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            {/* Universal Filter Dropdown (view tab only) */}
            {!filtersCollapsed && (
              <div className="absolute top-full left-0 right-0 bg-white border-b shadow-lg z-40">
                {/* Constrain height on small screens and allow scrolling of content while keeping footer visible */}
                <div className="flex flex-col max-h-[70vh] sm:max-h-[60vh]">
                  <div className="overflow-y-auto p-4">
                    <UniversalFilter
                      projectData={projectData}
                      filters={activeFilters}
                      onFilterChange={(newFilters) => {
                        setActiveFilters(newFilters);
                        if (newFilters.previewMode) {
                          setProjectData(filteredProjectData);
                        }
                      }}
                      disabled={false}
                    />
                  </div>
                  <div className="border-t bg-white p-3">
                    <button
                      onClick={() => setFiltersCollapsed(true)}
                      className="w-full py-2 px-3 text-sm rounded-md bg-gray-200 hover:bg-gray-300 text-gray-800"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {!selectedProject ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-md mx-auto px-4">
              <div className="text-6xl mb-6">📸</div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Welcome to Druso Photo Manager
              </h2>
              {projects.length === 0 ? (
                <div className="space-y-6">
                  <p className="text-gray-600 mb-6">
                    Get started by creating your first project
                  </p>
                  <button
                    onClick={() => setShowCreateProject(true)}
                    className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    create a new project
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  <p className="text-gray-600 mb-6">
                    Select a project to get started
                  </p>
                  <div className="flex justify-center">
                    <ProjectSelector 
                      projects={projects}
                      selectedProject={selectedProject}
                      onProjectSelect={handleProjectSelect}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : loading ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-600">Loading project data...</span>
          </div>
        ) : (
          <div className="w-full px-4 sm:px-6 lg:px-8 pt-2 pb-8">


            {activeTab === 'view' && (
              <div>
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
                  projectFolder={selectedProject.folder}
                  onPhotoSelect={(photo) => handlePhotoSelect(photo, sortedPhotos)}
                  onToggleSelection={handleToggleSelection}
                  selectedPhotos={selectedPhotos}
                  lazyLoadThreshold={config?.photo_grid?.lazy_load_threshold ?? 100}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSortChange={toggleSort}
                  sizeLevel={sizeLevel}
                />
              </div>
            )}

            {/* Tag tab removed; tagging via OperationsMenu */}
          </div>
        )}
      </main>

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
          previewModeEnabled={activeFilters.previewMode}
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
              <div className="px-6 py-4 border-t flex justify-end gap-2">
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
    </div>
    </UploadProvider>
  );
}

export default App;
