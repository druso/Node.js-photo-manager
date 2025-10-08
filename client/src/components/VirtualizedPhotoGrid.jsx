import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { getSessionState, setSessionMainY } from '../utils/storage';
import Thumbnail from './Thumbnail';
import { computeAspectRatios, buildJustifiedRows, computeCumulativeHeights, getVisibleRowRange } from '../utils/gridVirtualization';

/**
 * VirtualizedPhotoGrid
 * - Custom row-based virtualization for a justified photo grid.
 * - Phase 1.2: core virtualization mechanics (visible range + spacers + dwell IO + pagination triggers).
 */
const VirtualizedPhotoGrid = ({
  projectData,
  projectFolder,
  onPhotoSelect,
  selectedPhotos,
  onToggleSelection,
  onEnterSelectionMode,
  lazyLoadThreshold = 100,
  sizeLevel = 's',
  photos: externalPhotos,
  hasMore,
  onLoadMore,
  hasPrev = false,
  onLoadPrev,
  dwellMs = 300,
  simplifiedMode = false,
  anchorIndex = null,
  onAnchored,
}) => {
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const bottomRef = useRef(null);
  const loadMoreGuardRef = useRef(0);
  const loadPrevGuardRef = useRef(0);
  const scrollAnchorRef = useRef(null);
  const isRestoringScrollRef = useRef(false); // Flag to prevent double anchor capture during restoration
  const expandVirtualizationRef = useRef(false); // Flag to expand virtualization range to preserve anchor
  const isLoadingPrevRef = useRef(false); // Flag to prevent multiple simultaneous load prev operations
  const isLoadingMoreRef = useRef(false); // Flag to prevent multiple simultaneous load more operations
  const [paginationStatus, setPaginationStatus] = useState('idle'); // 'idle' | 'loading_prev' | 'loading_more'
  const statusRef = useRef('idle');
  useEffect(() => { statusRef.current = paginationStatus; }, [paginationStatus]);
  const pendingLoadRef = useRef(null); // Store pending load operation details
  const restoreTriedRef = useRef(false);
  const saveThrottleRef = useRef(0);

  // Long-press handler for M2 selection mode
  // We'll handle this manually since we need to pass photo data
  const handleLongPress = useCallback((photo) => {
    if (onEnterSelectionMode) {
      onEnterSelectionMode(photo);
    }
  }, [onEnterSelectionMode]);

  // IO to lazily mark thumbnails visible after a dwell period
  const ioRef = useRef(null);
  const observedMapRef = useRef(new Map());
  const dwellTimersRef = useRef(new Map());
  const [visibleKeys, setVisibleKeys] = useState(() => new Set());
  const visibleKeysRef = useRef(visibleKeys);
  useEffect(() => { visibleKeysRef.current = visibleKeys; }, [visibleKeys]);

  // Observe container width (responsive)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cw = Math.floor(entry.contentRect.width);
        if (cw && cw !== containerWidth) setContainerWidth(cw);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerWidth]);

  // Track window scroll + viewport height
  useEffect(() => {
    const onScroll = () => setScrollTop(window.scrollY || document.documentElement.scrollTop || 0);
    const onResize = () => setViewportH(window.innerHeight || 0);
    onScroll();
    onResize();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // Throttled save of scroll position to session storage
  useEffect(() => {
    const now = Date.now();
    if (now - saveThrottleRef.current > 200) {
      saveThrottleRef.current = now;
      try { setSessionMainY(scrollTop); } catch {}
    }
  }, [scrollTop]);

  const sizeToTargetH = { s: 120, m: 180, l: 240 };
  const targetRowH = sizeToTargetH[sizeLevel] ?? sizeToTargetH.s;
  const gap = sizeLevel === 's' ? 2 : 4; // px

  // Source photos (do not slice; virtualization will handle visibility later)
  const photos = externalPhotos ?? projectData?.photos ?? [];
  const isEmpty = !photos || photos.length === 0;

  // Ratios and row layout
  const ratios = useMemo(() => computeAspectRatios(photos), [photos]);
  const rows = useMemo(() => buildJustifiedRows({ containerWidth, targetRowH, gap, ratios }), [containerWidth, targetRowH, gap, ratios]);
  const cumulativeHeights = useMemo(() => computeCumulativeHeights(rows, gap), [rows, gap]);
  const totalHeight = cumulativeHeights[cumulativeHeights.length - 1] || 0;

  // Visible row window - expand range during pagination to preserve anchor elements
  const [startRow, endRow] = useMemo(() => {
    const baseRange = getVisibleRowRange({ scrollTop, viewportHeight: viewportH, cumulativeHeights, overscan: 2 });
    
    // Expand virtualization during pagination to preserve anchor elements
    if (paginationStatus === 'loading_prev' || paginationStatus === 'loading_more') {
      const expandedOverscan = Math.max(15, Math.ceil(rows.length * 0.5));
      return getVisibleRowRange({ scrollTop, viewportHeight: viewportH, cumulativeHeights, overscan: expandedOverscan });
    }
    
    return baseRange;
  }, [scrollTop, viewportH, cumulativeHeights, rows.length, paginationStatus]);

  // Execute pending load operations after pagination status change has been rendered
  useEffect(() => {
    if (!pendingLoadRef.current) return;
    
    const pendingLoad = pendingLoadRef.current;
    pendingLoadRef.current = null; // Clear immediately to prevent re-execution
    
    // Now find anchor after virtualization has been expanded
    const anchor = findScrollAnchor(pendingLoad.mode);
    if (anchor) {
      scrollAnchorRef.current = anchor;
    }
    
    // Execute the load operation
    pendingLoad.loadFunction();
  }, [paginationStatus]);

  // Utility function to find visible photo element for scroll anchoring
  // mode: 'up' (top-most visible) or 'down' (bottom-most visible)
  const findScrollAnchor = (mode = 'up') => {
    const container = containerRef.current;
    if (!container) return null;

    const photoElements = container.querySelectorAll('[data-photo-key]');
    const viewportTop = window.scrollY || document.documentElement.scrollTop || 0;
    const viewportBottom = viewportTop + (window.innerHeight || 0);

    if (photoElements.length === 0) {
      return null;
    }

    let bestAnchor = null;
    let bestMetric = mode === 'up' ? Infinity : -Infinity;

    for (const element of photoElements) {
      const rect = element.getBoundingClientRect();
      const elementTop = rect.top + viewportTop;
      const elementBottom = elementTop + rect.height;

      // Find element that's at least partially visible in viewport
      if (elementBottom > viewportTop && elementTop < viewportBottom) {
        if (mode === 'up') {
          // Prefer elements closer to the top of the viewport
          const distanceFromViewportTop = Math.abs(rect.top);
          if (distanceFromViewportTop < bestMetric) {
            bestMetric = distanceFromViewportTop;
            bestAnchor = {
              key: element.getAttribute('data-photo-key'),
              mode: 'up',
              offsetFromTop: rect.top,
              elementTop: elementTop,
              originalPhotosCount: photos.length
            };
          }
        } else {
          // mode === 'down': prefer elements closer to bottom (largest rect.bottom)
          if (rect.bottom > bestMetric) {
            bestMetric = rect.bottom;
            bestAnchor = {
              key: element.getAttribute('data-photo-key'),
              mode: 'down',
              offsetFromBottom: (window.innerHeight || 0) - rect.bottom,
              elementBottom: rect.bottom + viewportTop,
              originalPhotosCount: photos.length
            };
          }
        }
      }
    }
    
    return bestAnchor;
  };

  // Utility function to restore scroll position to keep anchor element in same viewport position
  const restoreScrollAnchor = (anchor) => {
    if (!anchor || !anchor.key) return;

    const container = containerRef.current;
    if (!container) return;

    const element = container.querySelector(`[data-photo-key="${anchor.key}"]`);
    if (!element) {
      // Fallback: estimate scroll adjustment based on the number of photos that were added
      const currentPhotosCount = photos.length;
      const estimatedAddedPhotos = currentPhotosCount - (anchor.originalPhotosCount || currentPhotosCount);
      if (estimatedAddedPhotos > 0 && anchor.mode === 'up') {
        const avgPhotoHeight = totalHeight / rows.length || 200;
        const estimatedAddedHeight = (estimatedAddedPhotos / 4) * avgPhotoHeight;
        const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
        const newScrollY = Math.max(0, currentScrollY + estimatedAddedHeight);
        try {
          window.scrollTo({ top: newScrollY, behavior: 'instant' });
        } catch {
          try { window.scrollTo(0, newScrollY); } catch {}
        }
      }
      return;
    }

    const rect = element.getBoundingClientRect();
    
    if (anchor.mode === 'up') {
      // Restore top offset for upward pagination
      const currentTop = rect.top;
      const desiredTop = anchor.offsetFromTop;
      const scrollAdjustment = currentTop - desiredTop;

      if (Math.abs(scrollAdjustment) > 2) {
        const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
        const newScrollY = Math.max(0, currentScrollY + scrollAdjustment);
        try {
          window.scrollTo({ top: newScrollY, behavior: 'instant' });
        } catch {
          try { window.scrollTo(0, newScrollY); } catch {}
        }
      }
    } else {
      // Restore bottom offset for downward pagination
      const currentBottomOffset = (window.innerHeight || 0) - rect.bottom;
      const desiredBottomOffset = anchor.offsetFromBottom;
      const scrollAdjustment = desiredBottomOffset - currentBottomOffset;

      if (Math.abs(scrollAdjustment) > 2) {
        const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
        const newScrollY = Math.max(0, currentScrollY + scrollAdjustment);
        try {
          window.scrollTo({ top: newScrollY, behavior: 'instant' });
        } catch {
          try { window.scrollTo(0, newScrollY); } catch {}
        }
      }
    }
  };

  // Deep-link centering: scroll the target row (containing anchorIndex) to center of viewport
  useEffect(() => {
    if (anchorIndex == null || anchorIndex < 0) return;
    if (!Array.isArray(rows) || rows.length === 0) return;
    // find the row containing the anchor index
    let rowIdx = -1;
    let rowH = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!Array.isArray(r)) continue;
      for (let k = 0; k < r.length; k++) {
        if (r[k]?.idx === anchorIndex) {
          rowIdx = i;
          rowH = Math.round(r[k].h || 0);
          break;
        }
      }
      if (rowIdx !== -1) break;
    }
    if (rowIdx === -1) return;
    const rowTop = rowIdx > 0 ? (cumulativeHeights[rowIdx - 1] || 0) : 0;
    const rowHeight = rowH || Math.max(0, (cumulativeHeights[rowIdx] || 0) - rowTop);
    const vp = viewportH || window.innerHeight || 0;
    const desiredTop = Math.max(0, Math.round(rowTop + rowHeight / 2 - vp / 2));
    try {
      window.scrollTo({ top: desiredTop, behavior: 'instant' in window ? 'instant' : 'auto' });
    } catch {
      try { window.scrollTo(0, desiredTop); } catch {}
    }
    // notify that we anchored
    onAnchored && onAnchored();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorIndex, rows, cumulativeHeights, viewportH]);

  // Handle scroll anchoring after content changes (when new pages are loaded)
  useEffect(() => {
    if (!scrollAnchorRef.current) return;
    
    // Set flag to prevent new anchor captures during restoration
    isRestoringScrollRef.current = true;
    console.log('[ScrollAnchor] Starting restoration, blocking new anchor captures');
    
    // Restore scroll position to keep the anchor element in the same viewport position
    const anchor = scrollAnchorRef.current;
    
    // Wait for browser's next paint cycle to ensure new DOM elements are fully rendered
    // This prevents the race condition where we try to restore scroll before layout is complete
    const rafId = requestAnimationFrame(() => {
      // Double RAF to ensure we're after both layout AND paint
      const rafId2 = requestAnimationFrame(() => {
        restoreScrollAnchor(anchor);
        scrollAnchorRef.current = null; // Clear after use
        
        // Clear all flags and reset status after restoration completes
        setTimeout(() => {
          isRestoringScrollRef.current = false;
          expandVirtualizationRef.current = false;
          isLoadingPrevRef.current = false;
          isLoadingMoreRef.current = false;
          setPaginationStatus('idle');
        }, 100);
      });
      return () => cancelAnimationFrame(rafId2);
    });
    
    return () => cancelAnimationFrame(rafId);
  }, [photos.length, totalHeight]);

  // Session-based scroll restoration (only when no anchor is requested)
  useEffect(() => {
    if (restoreTriedRef.current) return;
    if (anchorIndex != null) return; // let deep-link anchoring take precedence
    restoreTriedRef.current = true;
    try {
      const st = getSessionState();
      const y = Number(st?.mainY) || 0;
      if (y > 0) {
        try {
          window.scrollTo({ top: y, behavior: 'instant' in window ? 'instant' : 'auto' });
        } catch {
          try { window.scrollTo(0, y); } catch {}
        }
      }
    } finally {
      restoreTriedRef.current = true;
    }
  }, [rows]);

  // Trigger load more when bottom content is close to viewport
  useEffect(() => {
    if (typeof onLoadMore !== 'function' || !hasMore) return;
    // If total content height is too short, auto-load
    const maybeLoad = () => {
      // Do not attempt to load-more while a pagination operation is in-flight
      if (statusRef.current !== 'idle') return;

      const root = document.documentElement;
      const contentH = (root && root.scrollHeight) || document.body.offsetHeight;
      // Only auto-load when content is shorter than the viewport AND the user is near the top
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      if (contentH <= window.innerHeight + 40 && y < 50) {
        const now = Date.now();
        if (now - loadMoreGuardRef.current > 500) {
          loadMoreGuardRef.current = now;
          onLoadMore();
        }
      }
    };
    const id = setTimeout(maybeLoad, 0);
    window.addEventListener('resize', maybeLoad, { passive: true });
    return () => { clearTimeout(id); window.removeEventListener('resize', maybeLoad); };
  }, [rows, hasMore, onLoadMore]);

  // Trigger load previous when near the top
  useEffect(() => {
    if (typeof onLoadPrev !== 'function' || !hasPrev) return;
    const maybeLoadPrev = () => {
      // Skip if not idle
      if (statusRef.current !== 'idle') return;
      
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      if (y <= 400) {
        const now = Date.now();
        if (now - loadPrevGuardRef.current > 500) {
          loadPrevGuardRef.current = now;
          
          // Set status to loading_prev and queue the load operation
          setPaginationStatus('loading_prev');
          isLoadingPrevRef.current = true;
          
          // Queue the load operation to execute after re-render
          pendingLoadRef.current = {
            type: 'prev',
            mode: 'up',
            loadFunction: onLoadPrev
          };
        }
      }
    };
    // Initial check in case we're already near top
    const id = setTimeout(maybeLoadPrev, 0);
    window.addEventListener('scroll', maybeLoadPrev, { passive: true });
    return () => { clearTimeout(id); window.removeEventListener('scroll', maybeLoadPrev); };
  }, [rows, hasPrev, onLoadPrev]);

  useEffect(() => {
    if (typeof onLoadMore !== 'function' || !hasMore) return;
    const el = bottomRef.current;
    if (!el) return;
    let obs;
    try {
      obs = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && statusRef.current === 'idle') {
            const now = Date.now();
            if (now - loadMoreGuardRef.current > 500) {
              loadMoreGuardRef.current = now;
              
              // Set status to loading_more and queue the load operation
              setPaginationStatus('loading_more');
              isLoadingMoreRef.current = true;
              
              // Queue the load operation to execute after re-render
              pendingLoadRef.current = {
                type: 'more',
                mode: 'down',
                loadFunction: onLoadMore
              };
            }
          }
        }
      }, { root: null, rootMargin: '200px 0px', threshold: 0.01 });
      obs.observe(el);
    } catch {}
    return () => { try { obs && obs.disconnect(); } catch {} };
  }, [hasMore, onLoadMore, totalHeight]);

  // Setup IntersectionObserver for dwell-based visibility of thumbnails
  useEffect(() => {
    if (ioRef.current) return; // init once
    ioRef.current = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const key = entry.target.getAttribute('data-key');
        if (!key || visibleKeysRef.current.has(key)) continue;
        if (entry.isIntersecting) {
          if (!dwellTimersRef.current.has(key)) {
            const tid = setTimeout(() => {
              setVisibleKeys(prev => { const next = new Set(prev); next.add(key); return next; });
              try { ioRef.current && ioRef.current.unobserve(entry.target); } catch (_) {}
              observedMapRef.current.delete(key);
              dwellTimersRef.current.delete(key);
            }, Math.max(0, Number(dwellMs) || 0));
            dwellTimersRef.current.set(key, tid);
          }
        } else {
          const tid = dwellTimersRef.current.get(key);
          if (tid) { clearTimeout(tid); dwellTimersRef.current.delete(key); }
        }
      }
    }, { root: null, rootMargin: '50px 0px', threshold: 0.01 });
    return () => {
      if (ioRef.current) { ioRef.current.disconnect(); ioRef.current = null; }
      for (const tid of dwellTimersRef.current.values()) clearTimeout(tid);
      dwellTimersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset visibility on project change
  useEffect(() => {
    setVisibleKeys(new Set());
    observedMapRef.current.clear();
    for (const tid of dwellTimersRef.current.values()) clearTimeout(tid);
    dwellTimersRef.current.clear();
  }, [projectFolder]);

  const observeCell = (el, key) => {
    if (!el || !ioRef.current || visibleKeysRef.current.has(key)) return;
    el.setAttribute('data-key', key);
    const existing = observedMapRef.current.get(key);
    if (existing) {
      if (existing !== el) {
        try { ioRef.current.unobserve(existing); } catch (_) {}
        observedMapRef.current.set(key, el);
        ioRef.current.observe(el);
      }
      return;
    }
    observedMapRef.current.set(key, el);
    ioRef.current.observe(el);
  };

  // Render only visible rows with spacers
  const topSpacer = cumulativeHeights[startRow] || 0;
  const renderedRows = rows.slice(startRow, endRow + 1);
  const bottomSpacer = Math.max(0, totalHeight - topSpacer - renderedRows.reduce((s, r, i) => s + (r?.[0]?.h || 0) + (i < renderedRows.length - 1 ? gap : 0), 0));

  return (
    <div ref={containerRef} className="w-full p-1 overflow-x-hidden" style={{ position: 'relative', minHeight: '40vh' }}>
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-gray-600">
          <div className="mb-3 text-gray-400" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-8 w-8">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
          </div>
          <p className="max-w-md">
            <span className="font-medium text-gray-800">Drop images anywhere on this page</span> to add them to the current project.
          </p>
        </div>
      ) : (
        <div className="w-full">
          {containerWidth > 0 && (
            <div className="relative">
              {/* Manual load previous button */}
              {hasPrev && (
                <div className="flex justify-center py-4">
                  <button
                    onClick={() => {
                      if (statusRef.current !== 'idle') return;
                      
                      const now = Date.now();
                      if (now - loadPrevGuardRef.current > 500) {
                        loadPrevGuardRef.current = now;
                        
                        // Set status to loading_prev and queue the load operation
                        setPaginationStatus('loading_prev');
                        isLoadingPrevRef.current = true;
                        
                        // Queue the load operation to execute after re-render
                        pendingLoadRef.current = {
                          type: 'prev',
                          mode: 'up',
                          loadFunction: () => onLoadPrev && onLoadPrev()
                        };
                      }
                    }}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                  >
                    Load Previous Photos
                  </button>
                </div>
              )}

              {/* Top spacer */}
              {topSpacer > 0 && <div style={{ height: topSpacer }} aria-hidden="true" />}

              {/* Rendered rows */}
              {renderedRows.map((rowItems, i) => (
                <div
                  key={startRow + i}
                  className="flex items-end mb-1"
                  style={{ gap, maxWidth: '100%' }}
                >
                  {rowItems.map(({ idx, w, h }, j) => {
                    const photo = photos[idx];
                    const isSelected = simplifiedMode
                      ? selectedPhotos?.has(`${photo.project_folder || projectFolder || 'pf'}::${photo.filename}`)
                      : selectedPhotos?.has(photo.filename);
                    const marginRight = j < rowItems.length - 1 ? gap : 0;
                    const key = `${photo.project_folder || projectFolder || 'pf'}::${photo.filename || `${photo.id}-${idx}`}`;
                    const visibility = (photo.visibility || 'private').toLowerCase();
                    const visibilityLabel = visibility === 'public' ? 'Public' : 'Private';
                    const visibilityStyles = visibility === 'public'
                      ? 'bg-green-500/80 text-white'
                      : 'bg-purple-600/85 text-white';

                    return (
                      <div
                        key={`${photo.project_folder || projectFolder || 'pf'}-${photo.id}-${photo.filename}`}
                        data-photo-key={key}
                        className={`relative bg-gray-200 overflow-hidden cursor-pointer group ${isSelected ? 'border-2 border-blue-600 ring-2 ring-blue-400' : 'border-0 ring-0'} transition-all flex-none`}
                        style={{ width: `${w}px`, height: `${Math.round(h)}px`, marginRight }}
                        onClick={(e) => {
                          // M2: If selections exist, tap toggles selection
                          // Otherwise, tap opens viewer
                          const hasSelections = selectedPhotos && selectedPhotos.size > 0;
                          if (hasSelections) {
                            onToggleSelection && onToggleSelection(photo);
                          } else {
                            // M1: Default click opens viewer
                            if (onPhotoSelect) {
                              onPhotoSelect(photo, photos);
                            }
                          }
                        }}
                        onTouchStart={(e) => {
                          // M2: Long-press detection for mobile
                          const timer = setTimeout(() => {
                            handleLongPress(photo);
                          }, 500);
                          e.currentTarget.dataset.longPressTimer = timer;
                        }}
                        onContextMenu={(e) => {
                          // Prevent context menu on long-press
                          e.preventDefault();
                          return false;
                        }}
                        onTouchEnd={(e) => {
                          // Cancel long-press timer
                          const timer = e.currentTarget.dataset.longPressTimer;
                          if (timer) {
                            clearTimeout(parseInt(timer));
                            delete e.currentTarget.dataset.longPressTimer;
                          }
                        }}
                        onTouchMove={(e) => {
                          // Cancel long-press on movement
                          const timer = e.currentTarget.dataset.longPressTimer;
                          if (timer) {
                            clearTimeout(parseInt(timer));
                            delete e.currentTarget.dataset.longPressTimer;
                          }
                        }}
                        ref={(el) => observeCell(el, key)}
                      >
                      {/* Gradient overlay for desktop hover - top 25% */}
                      <div className="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden sm:block" />

                      <span
                        className={`absolute top-2 right-2 z-10 px-2 py-0.5 text-xs font-semibold rounded-full shadow-sm flex items-center gap-1 ${visibilityStyles}`}
                        title={`Visibility: ${visibilityLabel}`}
                      >
                        {visibility === 'public' ? (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                            <path d="M12 4.5c-4.97 0-9 3.582-9 8s4.03 8 9 8 9-3.582 9-8-4.03-8-9-8Zm0 2c3.866 0 7 2.91 7 6s-3.134 6-7 6-7-2.91-7-6 3.134-6 7-6Zm0 2.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                            <path fillRule="evenodd" d="M3.53 2.47a.75.75 0 0 0-1.06 1.06l2.092 2.093C3.048 7.098 1.658 8.91 1.09 10.7a1.52 1.52 0 0 0 0 .6C2.163 14.228 6.322 18.5 12 18.5c1.53 0 2.973-.317 4.28-.882l4.19 4.192a.75.75 0 1 0 1.06-1.06l-18-18Zm9.164 10.224 2.612 2.611a3.75 3.75 0 0 1-2.35.695 3.75 3.75 0 0 1-3.75-3.75c0-.865.29-1.663.78-2.285l1.695 1.695a1.5 1.5 0 0 0 1.913 1.913Zm7.038-4.657-2.94 2.94a3.75 3.75 0 0 0-4.768-4.768l-2.533-2.533A10.47 10.47 0 0 1 12 5.5c5.678 0 9.837 4.272 10.91 7.2.085.236.085.364 0 .6a10.11 10.11 0 0 1-1.566 2.802l-2.612-2.612a3.73 3.73 0 0 0 .232-1.298 3.75 3.75 0 0 0-3.75-3.75c-.44 0-.865.077-1.255.218l2.49-2.49c.502.33.98.7 1.43 1.111Z" clipRule="evenodd" />
                          </svg>
                        )}
                        {visibilityLabel}
                      </span>
                      
                      {/* Selection toggle in top-left within gradient area */}
                      <button
                        type="button"
                        aria-label={isSelected ? 'Deselect photo' : 'Select photo'}
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          onToggleSelection && onToggleSelection(photo); 
                        }}
                        className={`absolute top-2 left-2 z-10 flex items-center justify-center h-10 w-10 rounded-full border transition shadow-md
                          ${isSelected
                            ? 'bg-blue-600 text-white border-blue-600 opacity-100'
                            : 'bg-white/90 text-gray-600 border-gray-300 opacity-0 sm:group-hover:opacity-100'}
                        `}
                      >
                        {isSelected ? (
                          // Check icon
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414L8.5 11.086l6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          // Empty circle (no check)
                          <span className="block h-5 w-5 rounded-full border-2 border-gray-400" />
                        )}
                      </button>

                      {visibleKeys.has(key) ? (
                        <Thumbnail
                          photo={photo}
                          projectFolder={photo.project_folder || projectFolder}
                          className="w-full h-full transition-opacity duration-200"
                          objectFit="cover"
                          rounded={false}
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-300 animate-pulse" aria-hidden="true" />
                      )}
                      
                      {/* Selection overlay - subtle blue tint when selected */}
                      {isSelected && (
                        <div className="absolute inset-0 bg-blue-500/25 pointer-events-none"></div>
                      )}
                    </div>
                  );
              })}
            </div>
          ))}

          {/* Bottom spacer */}
          {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} aria-hidden="true" />}

          {/* Manual load more button */}
          {hasMore && (
            <div className="flex justify-center py-4">
              <button
                onClick={() => {
                  // Respect the pagination state machine
                  if (statusRef.current !== 'idle') return;
                  const now = Date.now();
                  if (now - loadMoreGuardRef.current > 500) {
                    loadMoreGuardRef.current = now;
                    onLoadMore && onLoadMore();
                  }
                }}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
              >
                Load More Photos
              </button>
            </div>
          )}

          {/* Invisible sentinel positioned near the bottom of the content */}
          {hasMore && (
            <div
              ref={bottomRef}
              style={{ height: 1 }}
              aria-hidden="true"
            />
          )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VirtualizedPhotoGrid;
