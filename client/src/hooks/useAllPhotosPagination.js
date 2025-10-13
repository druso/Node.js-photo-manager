import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PagedWindowManager from '../utils/pagedWindowManager';
import { listAllPhotos, locateAllPhotosPage } from '../api/allPhotosApi';
import { locateProjectPhotosPage } from '../api/photosApi';

const DEBUG_PAGINATION = false;
const debugLog = (...args) => {
  if (!DEBUG_PAGINATION) return;
  console.log(...args);
};

// Utility shared across App: normalize filenames by stripping known photo extensions
export function stripKnownExt(name) {
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
}

const DEFAULT_LIMIT = 100;
const DEFAULT_MAX_PAGES = 4;

function buildFilterParams(activeFilters) {
  const range = activeFilters?.dateRange || {};
  const visibility = typeof activeFilters?.visibility === 'string' && activeFilters.visibility !== 'any'
    ? activeFilters.visibility
    : undefined;
  const publicLinkId = activeFilters?.publicLinkId;
  return {
    date_from: range.start || undefined,
    date_to: range.end || undefined,
    file_type: activeFilters?.fileType && activeFilters.fileType !== 'any' ? activeFilters.fileType : undefined,
    keep_type: activeFilters?.keepType && activeFilters.keepType !== 'any' ? activeFilters.keepType : undefined,
    orientation: activeFilters?.orientation && activeFilters.orientation !== 'any' ? activeFilters.orientation : undefined,
    tags: activeFilters?.tags,
    visibility,
    public_link_id: typeof publicLinkId === 'string' && publicLinkId.length ? publicLinkId : undefined,
  };
}

function resolveProjectSort(sortKey, sortDir) {
  const key = sortKey === 'name' ? 'filename' : 'date_time_original';
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  return { field: key, direction: dir };
}

function usePhotoPagination({
  mode,
  activeFilters,
  isEnabled,
  onResolveDeepLink,
  projectFolder,
  sortKey = 'date',
  sortDir = 'desc',
}) {
  // Log hook initialization for debugging
  debugLog(`[UNIFIED] usePhotoPagination initialized with mode: ${mode}`, {
    projectFolder,
    isEnabled,
    hasActiveFilters: !!activeFilters
  });
  const [photos, setPhotos] = useState([]);
  const [total, setTotal] = useState(0);
  const [unfilteredTotal, setUnfilteredTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasPrev, setHasPrev] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [gridAnchorIndex, setGridAnchorIndex] = useState(null);

  const windowRef = useRef(null);
  const seenKeysRef = useRef(new Set());
  const seenCursorsRef = useRef(new Set());
  const lastCursorRef = useRef(null);
  const loadingLockRef = useRef(false);
  const deepLinkRef = useRef(null);
  const locateTriedRef = useRef(false);
  const folderRef = useRef(mode === 'project' ? projectFolder ?? null : null);
  const sortRef = useRef(resolveProjectSort(sortKey, sortDir));

  useEffect(() => {
    folderRef.current = mode === 'project' ? (projectFolder ?? null) : null;
  }, [mode, projectFolder]);

  useEffect(() => {
    sortRef.current = resolveProjectSort(sortKey, sortDir);
  }, [sortKey, sortDir]);

  const makeItemKey = useCallback((item) => {
    const folder = mode === 'project'
      ? (folderRef.current || item.project_folder || '')
      : (item.project_folder || folderRef.current || '');
    return `${folder}::${item.filename}`;
  }, [mode]);

  const setDeepLinkTarget = useCallback((payload) => {
    if (!payload) {
      deepLinkRef.current = null;
      locateTriedRef.current = false;
      return;
    }
    deepLinkRef.current = payload;
    locateTriedRef.current = false;
  }, []);

  const resetState = useCallback(() => {
    debugLog(`[UNIFIED] Resetting state for mode: ${mode}`);
    
    // Reset React state
    setPhotos([]);
    setTotal(0);
    setUnfilteredTotal(0);
    setNextCursor(null);
    setHasPrev(false);
    setGridAnchorIndex(null);
    setLoadingMore(false);
    
    // Reset local ref but keep global instance
    if (windowRef.current) {
      debugLog('[UNIFIED] Resetting local PagedWindowManager reference');
      
      // Reset the manager's internal state if it exists
      if (windowRef.current.reset && typeof windowRef.current.reset === 'function') {
        debugLog('[UNIFIED] Resetting PagedWindowManager internal state');
        windowRef.current.reset();
      }
      
      // Don't null out windowRef.current as we want to keep using the cached instance
      // Instead, we'll rely on ensureWindow to get the right instance
    }
    
    seenKeysRef.current = new Set();
    seenCursorsRef.current = new Set();
    lastCursorRef.current = null;
    loadingLockRef.current = false;
    
    // Don't reset deepLinkRef here as it might be needed after state reset
    debugLog('[UNIFIED] State reset complete');
  }, [mode]);

  const ensureWindow = useCallback(() => {
    // Check for existing manager in the global cache first
    if (mode === 'all' && managerInstances.all) {
      debugLog('[UNIFIED] Using cached All Photos PagedWindowManager');
      windowRef.current = managerInstances.all;
      return windowRef.current;
    } else if (mode === 'project' && projectFolder && managerInstances.project[projectFolder]) {
      debugLog(`[UNIFIED] Using cached Project PagedWindowManager for ${projectFolder}`);
      windowRef.current = managerInstances.project[projectFolder];
      return windowRef.current;
    }
    
    // Create new manager if not in cache
    if (!windowRef.current) {
      debugLog(`[UNIFIED] Creating new PagedWindowManager for mode: ${mode}`);
      windowRef.current = new PagedWindowManager({
        limit: DEFAULT_LIMIT,
        maxPages: DEFAULT_MAX_PAGES,
        keyOf: (it) => makeItemKey(it),
        fetchPage: async ({ cursor, before_cursor, limit, extra }) => {
          const filters = extra?.filters || {};
          const sort = extra?.sort || sortRef.current;
          const params = { limit, ...filters };
          
          if (cursor) params.cursor = cursor;
          if (before_cursor) params.before_cursor = before_cursor;
          
          // Log pagination request for debugging
          debugLog(`[UNIFIED] Fetching page for mode: ${mode}`, { 
            cursor, 
            before_cursor, 
            projectFolder: folderRef.current 
          });
          
          let res;
          if (mode === 'project') {
            const folder = folderRef.current;
            if (!folder) {
              debugLog('[UNIFIED] No folder selected for project mode');
              return { items: [], nextCursor: null, prevCursor: null, total: 0, unfiltered_total: 0 };
            }
            
            // Always use project_folder parameter for consistency
            params.project_folder = folder;
            if (sort?.field) params.sort = sort.field;
            if (sort?.direction) params.dir = sort.direction;
            
            // Use the same API for both modes to ensure consistent behavior
            res = await listAllPhotos(params);
          } else {
            // All photos mode
            res = await listAllPhotos(params);
          }
          
          // Log response cursors for debugging
          debugLog(`[UNIFIED] API response for ${mode} mode:`, { 
            nextCursor: res.next_cursor, 
            prevCursor: res.prev_cursor,
            itemCount: res.items?.length || 0,
            total: res.total,
            unfiltered_total: res.unfiltered_total
          });
          
          return {
            items: res.items || [],
            nextCursor: res.next_cursor ?? null,
            prevCursor: res.prev_cursor ?? null,
            total: res.total,
            unfiltered_total: res.unfiltered_total,
          };
        },
      });
      
      // Store in global cache for persistence
      if (mode === 'all') {
        managerInstances.all = windowRef.current;
      } else if (mode === 'project' && projectFolder) {
        managerInstances.project[projectFolder] = windowRef.current;
      }
    }
    return windowRef.current;
  }, [makeItemKey, mode, projectFolder]);

  const loadInitial = useCallback(async () => {
    debugLog(`[UNIFIED] loadInitial called for mode: ${mode}`, { 
      isEnabled, 
      projectFolder: mode === 'project' ? folderRef.current : 'N/A',
      loadingLock: loadingLockRef.current
    });
    
    // Prevent concurrent loadInitial calls
    if (loadingLockRef.current) {
      debugLog('[UNIFIED] loadInitial already in progress, skipping');
      return;
    }
    
    if (!isEnabled) return;
    if (mode === 'project' && !folderRef.current) {
      debugLog('[UNIFIED] No folder selected for project mode, resetting state');
      resetState();
      return;
    }
    
    loadingLockRef.current = true;
    try {
      const filters = buildFilterParams(activeFilters);
      const manager = ensureWindow();
      debugLog('[UNIFIED] Calling manager.loadInitial');
      
      const page = await manager.loadInitial({ filters, sort: sortRef.current });
      debugLog('[UNIFIED] manager.loadInitial returned:', { 
        hasItems: Array.isArray(page?.items), 
        itemCount: page?.items?.length || 0,
        nextCursor: page?.nextCursor,
        prevCursor: page?.prevCursor
      });
      
      const snap = manager.snapshot();
      seenKeysRef.current = new Set();
      seenCursorsRef.current = new Set();
      lastCursorRef.current = null;
      
      for (const it of page.items || []) {
        seenKeysRef.current.add(makeItemKey(it));
      }
      
      const flattened = snap.pages.flatMap(p => p.items);
      setPhotos(flattened);
      setTotal(Number.isFinite(page?.total) ? Number(page.total) : flattened.length);
      setUnfilteredTotal(Number.isFinite(page?.unfiltered_total) ? Number(page.unfiltered_total) : Number(page?.total) || flattened.length);
      setNextCursor(snap.tailNextCursor);
      setHasPrev(!!snap.headPrevCursor);
      
      debugLog('[UNIFIED] Updated state after loadInitial:', { 
        photoCount: flattened.length,
        nextCursor: snap.tailNextCursor,
        hasPrev: !!snap.headPrevCursor,
        total: Number.isFinite(page?.total) ? Number(page.total) : flattened.length
      });
    } finally {
      loadingLockRef.current = false;
    }
  }, [activeFilters, ensureWindow, isEnabled, makeItemKey, mode, resetState]);

  const loadMore = useCallback(async () => {
    if (!isEnabled || !nextCursor || loadingMore) return;
    if (mode === 'project' && !folderRef.current) return;
    if (loadingLockRef.current) return;
    
    debugLog(`[UNIFIED] loadMore called for mode: ${mode}`, { 
      nextCursor, 
      windowExists: !!windowRef.current,
      projectFolder: folderRef.current
    });
    
    loadingLockRef.current = true;
    setLoadingMore(true);
    try {
      const manager = windowRef.current;
      if (!manager) {
        debugLog('[UNIFIED] No manager available for loadMore');
        return;
      }
      
      const filters = buildFilterParams(activeFilters);
      const currentCursor = nextCursor;
      lastCursorRef.current = currentCursor;
      
      if (seenCursorsRef.current.has(currentCursor)) {
        debugLog('[UNIFIED] Cursor already seen, skipping:', currentCursor);
        return;
      }
      
      seenCursorsRef.current.add(currentCursor);
      debugLog('[UNIFIED] Calling manager.loadNext with cursor:', currentCursor);
      
      const page = await manager.loadNext({ filters, sort: sortRef.current });
      debugLog('[UNIFIED] manager.loadNext returned:', page ? 'page object' : 'null');
      
      const snap = manager.snapshot();
      if (page && Array.isArray(page.items)) {
        debugLog(`[UNIFIED] Received ${page.items.length} items in new page`);
        for (const it of page.items) {
          seenKeysRef.current.add(makeItemKey(it));
        }
      }
      
      setPhotos(snap.pages.flatMap(p => p.items));
      setTotal(Number.isFinite(page?.total) ? Number(page.total) : total);
      setUnfilteredTotal(Number.isFinite(page?.unfiltered_total) ? Number(page.unfiltered_total) : unfilteredTotal);
      setNextCursor(snap.tailNextCursor);
      setHasPrev(!!snap.headPrevCursor);
      
      console.log('[UNIFIED] Updated state after loadMore:', { 
        newNextCursor: snap.tailNextCursor,
        newHasPrev: !!snap.headPrevCursor,
        totalItems: snap.pages.flatMap(p => p.items).length
      });
    } finally {
      setLoadingMore(false);
      loadingLockRef.current = false;
    }
  }, [activeFilters, isEnabled, loadingMore, makeItemKey, mode, nextCursor, total, unfilteredTotal]);

  const loadPrev = useCallback(async () => {
    if (!isEnabled || loadingMore) return;
    if (mode === 'project' && !folderRef.current) return;
    
    debugLog(`[UNIFIED] loadPrev called for mode: ${mode}`, { 
      windowExists: !!windowRef.current,
      projectFolder: folderRef.current
    });
    
    const manager = windowRef.current;
    if (!manager) {
      debugLog('[UNIFIED] No manager available for loadPrev');
      return;
    }
    
    const snapBefore = manager.snapshot();
    if (!snapBefore.headPrevCursor) {
      debugLog('[UNIFIED] No headPrevCursor available for loadPrev');
      return;
    }
    
    debugLog('[UNIFIED] Starting loadPrev with headPrevCursor:', snapBefore.headPrevCursor);
    
    setLoadingMore(true);
    try {
      const filters = buildFilterParams(activeFilters);
      const page = await manager.loadPrev({ filters, sort: sortRef.current });
      debugLog('[UNIFIED] manager.loadPrev returned:', page ? 'page object' : 'null');
      
      const snap = manager.snapshot();
      if (page && Array.isArray(page.items)) {
        debugLog(`[UNIFIED] Received ${page.items.length} items in prev page`);
        for (const it of page.items) {
          seenKeysRef.current.add(makeItemKey(it));
        }
      }
      
      setPhotos(snap.pages.flatMap(p => p.items));
      setTotal(Number.isFinite(page?.total) ? Number(page.total) : total);
      setUnfilteredTotal(Number.isFinite(page?.unfiltered_total) ? Number(page.unfiltered_total) : unfilteredTotal);
      
      // Ensure both cursors are properly updated
      setNextCursor(snap.tailNextCursor);
      setHasPrev(!!snap.headPrevCursor);
      
      // Clear seen cursors to avoid issues with bidirectional navigation
      seenCursorsRef.current.clear();
      
      console.log('[UNIFIED] Updated state after loadPrev:', { 
        newNextCursor: snap.tailNextCursor,
        newHeadPrevCursor: snap.headPrevCursor,
        totalItems: snap.pages.flatMap(p => p.items).length
      });
    } finally {
      setLoadingMore(false);
    }
  }, [activeFilters, isEnabled, loadingMore, makeItemKey, mode, total, unfilteredTotal]);

  useEffect(() => {
    debugLog(`[UNIFIED] Main effect triggered for mode: ${mode}`, { 
      isEnabled, 
      projectFolder: mode === 'project' ? projectFolder : 'N/A',
      activeFilters: activeFilters ? 'present' : 'none'
    });
    
    if (!isEnabled) {
      debugLog('[UNIFIED] Not enabled, resetting state');
      resetState();
      return;
    }
    
    if (mode === 'project' && !projectFolder) {
      debugLog('[UNIFIED] Project mode but no folder selected, resetting state');
      resetState();
      return;
    }
    
    // Update folder reference
    if (mode === 'project') {
      folderRef.current = projectFolder;
    } else {
      folderRef.current = null;
    }
    
    // Check if we need to reset the manager due to filter/sort changes
    const shouldResetManager = (
      // Always reset when sort changes
      sortRef.current.field !== resolveProjectSort(sortKey, sortDir).field ||
      sortRef.current.direction !== resolveProjectSort(sortKey, sortDir).direction
    );
    
    if (shouldResetManager) {
      debugLog('[UNIFIED] Sort changed, resetting manager state');
      sortRef.current = resolveProjectSort(sortKey, sortDir);
      
      // Reset the appropriate manager in the global cache
      if (mode === 'project' && projectFolder) {
        managerInstances.resetManager('project', projectFolder);
      } else if (mode === 'all') {
        managerInstances.resetManager('all');
      }
    }
    
    let canceled = false;
    (async () => {
      try {
        if (DEBUG_PAGINATION || import.meta?.env?.DEV) {
          console.log(`[UNIFIED] Initializing ${mode} mode pagination`);
        }
        await loadInitial();
      } catch (error) {
        if (import.meta?.env?.DEV) {
          console.error('[UNIFIED] Error in loadInitial:', error);
        }
        if (!canceled) {
          resetState();
        }
      }
    })();
    
    return () => {
      canceled = true;
      debugLog('[UNIFIED] Effect cleanup triggered');
    };
  }, [
    isEnabled, 
    projectFolder, 
    mode, 
    activeFilters?.dateRange?.start, 
    activeFilters?.dateRange?.end, 
    activeFilters?.fileType, 
    activeFilters?.keepType, 
    activeFilters?.orientation, 
    activeFilters?.publicLinkId,
    activeFilters?.tags, 
    loadInitial, 
    resetState,
    // Add sortKey and sortDir to dependencies to ensure pagination resets when sort changes
    sortKey,
    sortDir
  ]);

  useEffect(() => {
    if (mode !== 'all') return;
    if (!isEnabled) return;
    const target = deepLinkRef.current;
    if (!target) return;
    if (!photos.length) return;

    const targetLower = String(target.filename || '').toLowerCase();
    const isTarget = (p) => {
      if (!p || p.project_folder !== target.folder) return false;
      const fn = (p.filename || '').toLowerCase();
      if (fn === targetLower) return true;
      const base = (p.basename ? String(p.basename) : String(p.filename || ''))
        .toLowerCase()
        .replace(/\.[^/.]+$/, '');
      return base === targetLower;
    };

    const idx = photos.findIndex(isTarget);
    if (idx >= 0) {
      onResolveDeepLink?.({ index: idx, items: photos.slice(), fromLocate: false });
      setGridAnchorIndex(idx);
      deepLinkRef.current = null;
      locateTriedRef.current = false;
      return;
    }

    if (!locateTriedRef.current) {
      locateTriedRef.current = true;
      (async () => {
        try {
          const filters = buildFilterParams(activeFilters);
          const maybeName = stripKnownExt(target.filename || '');
          const hasDot = /\.[A-Za-z0-9]+$/.test(String(target.filename || ''));
          const res = await locateAllPhotosPage({
            project_folder: target.folder,
            filename: hasDot ? String(target.filename) : undefined,
            name: !hasDot ? String(maybeName) : undefined,
            limit: DEFAULT_LIMIT,
            ...filters,
          });
          const items = Array.isArray(res.items) ? res.items : [];
          seenKeysRef.current = new Set();
          seenCursorsRef.current = new Set();
          lastCursorRef.current = null;
          for (const it of items) {
            seenKeysRef.current.add(makeItemKey(it));
          }
          setPhotos(items);
          setNextCursor(res.next_cursor ?? null);
          const startIndex = Number.isFinite(res.idx_in_items) && res.idx_in_items >= 0 ? res.idx_in_items : -1;
          if (startIndex >= 0 && items[startIndex]) {
            onResolveDeepLink?.({ index: startIndex, items: items.slice(), fromLocate: true });
            setGridAnchorIndex(startIndex);
            deepLinkRef.current = null;
          }
        } catch {
          await loadInitial();
        }
      })();
      return;
    }

    if (nextCursor && !loadingMore) {
      loadMore();
    }
  }, [photos, nextCursor, loadingMore, loadMore, loadInitial, activeFilters, isEnabled, mode, onResolveDeepLink, makeItemKey]);

  const mutatePhotos = useCallback((updater) => {
    setPhotos(prev => {
      const prevArray = Array.isArray(prev) ? prev : [];
      const next = updater(prevArray.slice());
      if (!Array.isArray(next)) return prev;
      const nextKeys = new Set();
      for (const it of next) {
        if (it && it.filename) {
          nextKeys.add(makeItemKey(it));
        }
      }
      seenKeysRef.current = nextKeys;
      return next;
    });
  }, [makeItemKey]);

  const applyExternalPage = useCallback(({ items, nextCursor: next, prevCursor, hasPrev: hasPrevValue, total: totalVal, unfilteredTotal: unfilteredVal } = {}) => {
    const arr = Array.isArray(items) ? items : [];
    const nextKeys = new Set();
    for (const it of arr) {
      if (it && it.filename) {
        nextKeys.add(makeItemKey(it));
      }
    }
    seenKeysRef.current = nextKeys;
    seenCursorsRef.current = new Set();
    lastCursorRef.current = null;
    windowRef.current = null;
    setPhotos(arr.slice());
    setNextCursor(next ?? null);
    if (typeof hasPrevValue === 'boolean') {
      setHasPrev(hasPrevValue);
    } else {
      setHasPrev(prevCursor ? true : false);
    }
    if (Number.isFinite(totalVal)) {
      setTotal(Number(totalVal));
    } else {
      setTotal(arr.length);
    }
    if (Number.isFinite(unfilteredVal)) {
      setUnfilteredTotal(Number(unfilteredVal));
    } else {
      setUnfilteredTotal(arr.length);
    }
    setLoadingMore(false);
  }, [makeItemKey]);

  return useMemo(() => ({
    photos,
    total,
    unfilteredTotal,
    nextCursor,
    hasPrev,
    loadingMore,
    gridAnchorIndex,
    loadInitial,
    loadMore,
    loadPrev,
    setGridAnchorIndex,
    setDeepLinkTarget,
    resetState,
    deepLinkRef,
    mutatePhotos,
    applyExternalPage,
  }), [photos, total, unfilteredTotal, nextCursor, hasPrev, loadingMore, gridAnchorIndex, loadInitial, loadMore, loadPrev, setDeepLinkTarget, resetState, mutatePhotos, applyExternalPage]);
}

// Create stable manager instances that persist across hook recreations
// This object lives outside React's lifecycle and persists across renders
const managerInstances = {
  all: null,
  project: {},
  // Helper method to reset a specific manager
  resetManager: function(mode, projectFolder) {
    if (import.meta?.env?.DEV) {
      console.log(`[UNIFIED] Resetting manager for ${mode}${projectFolder ? ': ' + projectFolder : ''}`);
    }
    if (mode === 'all') {
      if (this.all && this.all.reset) {
        this.all.reset();
      }
    } else if (mode === 'project' && projectFolder && this.project[projectFolder]) {
      if (this.project[projectFolder].reset) {
        this.project[projectFolder].reset();
      }
    }
  }
};

export function useAllPhotosPagination(options) {
  return usePhotoPagination({ mode: 'all', ...options });
}

export function useProjectPagination(options) {
  return usePhotoPagination({ mode: 'project', ...options });
}

export default useAllPhotosPagination;
