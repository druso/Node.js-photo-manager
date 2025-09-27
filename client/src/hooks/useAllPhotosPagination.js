import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PagedWindowManager from '../utils/pagedWindowManager';
import { listAllPhotos, locateAllPhotosPage } from '../api/allPhotosApi';
import { locateProjectPhotosPage } from '../api/photosApi';

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
  return {
    date_from: range.start || undefined,
    date_to: range.end || undefined,
    file_type: activeFilters?.fileType && activeFilters.fileType !== 'any' ? activeFilters.fileType : undefined,
    keep_type: activeFilters?.keepType && activeFilters.keepType !== 'any' ? activeFilters.keepType : undefined,
    orientation: activeFilters?.orientation && activeFilters.orientation !== 'any' ? activeFilters.orientation : undefined,
    tags: activeFilters?.tags,
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
    setPhotos([]);
    setTotal(0);
    setUnfilteredTotal(0);
    setNextCursor(null);
    setHasPrev(false);
    setGridAnchorIndex(null);
    setLoadingMore(false);
    windowRef.current = null;
    seenKeysRef.current = new Set();
    seenCursorsRef.current = new Set();
    lastCursorRef.current = null;
    loadingLockRef.current = false;
  }, []);

  const ensureWindow = useCallback(() => {
    if (!windowRef.current) {
      windowRef.current = new PagedWindowManager({
        limit: DEFAULT_LIMIT,
        maxPages: DEFAULT_MAX_PAGES,
        keyOf: (it) => makeItemKey(it),
        fetchPage: async ({ cursor, before_cursor, limit, extra }) => {
          const filters = extra?.filters || {};
          const sort = extra?.sort || sortRef.current;
          const params = { limit, ...filters };
          if (mode === 'project') {
            const folder = folderRef.current;
            if (!folder) {
              return { items: [], nextCursor: null, prevCursor: null, total: 0, unfiltered_total: 0 };
            }
            params.project_folder = folder;
            if (sort?.field) params.sort = sort.field;
            if (sort?.direction) params.dir = sort.direction;
          }
          if (cursor) params.cursor = cursor;
          if (before_cursor) params.before_cursor = before_cursor;
          const res = await listAllPhotos(params);
          return {
            items: res.items || [],
            nextCursor: res.next_cursor ?? null,
            prevCursor: res.prev_cursor ?? null,
            total: res.total,
            unfiltered_total: res.unfiltered_total,
          };
        },
      });
    }
    return windowRef.current;
  }, [makeItemKey, mode]);

  const loadInitial = useCallback(async () => {
    if (!isEnabled) return;
    if (mode === 'project' && !folderRef.current) {
      resetState();
      return;
    }
    const filters = buildFilterParams(activeFilters);
    const manager = ensureWindow();
    const page = await manager.loadInitial({ filters, sort: sortRef.current });
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
  }, [activeFilters, ensureWindow, isEnabled, makeItemKey, mode, resetState]);

  const loadMore = useCallback(async () => {
    if (!isEnabled || !nextCursor || loadingMore) return;
    if (mode === 'project' && !folderRef.current) return;
    if (loadingLockRef.current) return;
    loadingLockRef.current = true;
    setLoadingMore(true);
    try {
      const manager = windowRef.current;
      if (!manager) return;
      const filters = buildFilterParams(activeFilters);
      const currentCursor = nextCursor;
      lastCursorRef.current = currentCursor;
      if (seenCursorsRef.current.has(currentCursor)) return;
      seenCursorsRef.current.add(currentCursor);
      const page = await manager.loadNext({ filters, sort: sortRef.current });
      const snap = manager.snapshot();
      if (page && Array.isArray(page.items)) {
        for (const it of page.items) {
          seenKeysRef.current.add(makeItemKey(it));
        }
      }
      setPhotos(snap.pages.flatMap(p => p.items));
      setTotal(Number.isFinite(page?.total) ? Number(page.total) : total);
      setUnfilteredTotal(Number.isFinite(page?.unfiltered_total) ? Number(page.unfiltered_total) : unfilteredTotal);
      setNextCursor(snap.tailNextCursor);
      setHasPrev(!!snap.headPrevCursor);
    } finally {
      setLoadingMore(false);
      loadingLockRef.current = false;
    }
  }, [activeFilters, isEnabled, loadingMore, makeItemKey, mode, nextCursor, total, unfilteredTotal]);

  const loadPrev = useCallback(async () => {
    if (!isEnabled || loadingMore) return;
    if (mode === 'project' && !folderRef.current) return;
    const manager = windowRef.current;
    if (!manager) return;
    const snapBefore = manager.snapshot();
    if (!snapBefore.headPrevCursor) return;
    setLoadingMore(true);
    try {
      const filters = buildFilterParams(activeFilters);
      const page = await manager.loadPrev({ filters, sort: sortRef.current });
      const snap = manager.snapshot();
      if (page && Array.isArray(page.items)) {
        for (const it of page.items) {
          seenKeysRef.current.add(makeItemKey(it));
        }
      }
      setPhotos(snap.pages.flatMap(p => p.items));
      setTotal(Number.isFinite(page?.total) ? Number(page.total) : total);
      setUnfilteredTotal(Number.isFinite(page?.unfiltered_total) ? Number(page.unfiltered_total) : unfilteredTotal);
      setNextCursor(snap.tailNextCursor);
      setHasPrev(!!snap.headPrevCursor);
      seenCursorsRef.current.clear();
    } finally {
      setLoadingMore(false);
    }
  }, [activeFilters, isEnabled, loadingMore, makeItemKey, mode, total, unfilteredTotal]);

  useEffect(() => {
    if (!isEnabled) {
      resetState();
      return;
    }
    if (mode === 'project' && !projectFolder) {
      resetState();
      return;
    }
    let canceled = false;
    (async () => {
      try {
        await loadInitial();
      } catch {
        if (!canceled) {
          resetState();
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, [isEnabled, projectFolder, mode, activeFilters?.dateRange?.start, activeFilters?.dateRange?.end, activeFilters?.fileType, activeFilters?.keepType, activeFilters?.orientation, activeFilters?.tags, loadInitial, resetState]);

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

export function useAllPhotosPagination(options) {
  return usePhotoPagination({ mode: 'all', ...options });
}

export function useProjectPagination(options) {
  return usePhotoPagination({ mode: 'project', ...options });
}

export default useAllPhotosPagination;
