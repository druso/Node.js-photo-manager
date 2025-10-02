import React, { useState, useEffect, useCallback, useRef } from 'react';
import { updateKeep } from '../api/keepApi';
import { useToast } from '../ui/toast/ToastContext';

const PhotoViewer = ({
  projectData,
  projectFolder,
  startIndex,
  onClose,
  config,
  selectedPhotos,
  onToggleSelect,
  onKeepUpdated,
  onCurrentIndexChange,
  fromAllMode = false,
  onRequestMove,
  onShowInfoChange,
}) => {
  // All hooks are called at the top level, unconditionally.
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [zoomPercent, setZoomPercent] = useState(0); // 0 = Fit, 100 = Actual size, 200 = 2x
  const [position, setPosition] = useState({ x: 0, y: 0 });
  
  // Read showInfo from URL parameter or sessionStorage
  const [showInfo, setShowInfo] = useState(() => {
    try {
      // Check sessionStorage first (set by useAppInitialization)
      const fromStorage = sessionStorage.getItem('viewer_show_detail_from_url');
      if (fromStorage === '1') {
        sessionStorage.removeItem('viewer_show_detail_from_url');
        console.log('[PhotoViewer] Opening with detail panel from URL');
        return true;
      }
      
      // Fallback to checking URL directly
      const params = new URLSearchParams(window.location.search);
      return params.get('showdetail') === '1';
    } catch {
      return false;
    }
  });
  const containerRef = useRef(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [imageLoading, setImageLoading] = useState(true);
  const [usePreview, setUsePreview] = useState(true);
  const imgRef = useRef(null);
  const fallbackTriedRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef({ startX: 0, startY: 0, origX: 0, origY: 0 });
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 0 });
  // Removed image transition animations per request
  const pointerRef = useRef({ x: 0, y: 0 });
  const positionRef = useRef(position);
  const swipeRef = useRef({ active: false, startX: 0, startY: 0, lastX: 0, lastY: 0, startTime: 0 });
const toast = useToast();

const photos = projectData?.photos || [];
const currentPhoto = photos[currentIndex];
  useEffect(() => {
    if (typeof onCurrentIndexChange === 'function') {
      onCurrentIndexChange(currentIndex, currentPhoto);
    }
  }, [currentIndex, currentPhoto, onCurrentIndexChange]);

  // Whenever the photo index or preview/full-res mode changes, show loading until onLoad
  useEffect(() => {
    setImageLoading(true);
  }, [currentIndex, usePreview]);

  // If the browser has the image cached, onLoad may not fire; clear spinner if complete
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setImageLoading(false);
    }
  }, [currentIndex, usePreview]);

  // Keep a ref in sync with position to avoid stale values inside event handlers
  useEffect(() => { positionRef.current = position; }, [position]);

  // Clamp position so image cannot go outside the screen
  const clampPosition = useCallback((x, y, scaleOverride=null) => {
    const el = containerRef.current;
    if (!el || !naturalSize.w || !naturalSize.h) return { x, y };
    const rect = el.getBoundingClientRect();
    const fit = getFitScale();
    // interpolate from fit (0%) up to 2x (200%)
    const s = scaleOverride ?? (fit + (2 - fit) * (zoomPercent / 200));
    const imgW = naturalSize.w * s;
    const imgH = naturalSize.h * s;
    const halfW = Math.max(0, (imgW - rect.width) / 2);
    const halfH = Math.max(0, (imgH - rect.height) / 2);
    const clampedX = Math.max(-halfW, Math.min(halfW, x));
    const clampedY = Math.max(-halfH, Math.min(halfH, y));
    return { x: clampedX, y: clampedY };
  }, [naturalSize, zoomPercent]);

  // Programmatic download helper
  const fetchAndSave = useCallback(async (url) => {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) {
        throw new Error(`Download failed: ${res.status} ${res.statusText}`);
      }
      const blob = await res.blob();
      // Try to extract filename from Content-Disposition
      const cd = res.headers.get('Content-Disposition') || '';
      let filename = currentPhoto?.filename || 'download';
      const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
      if (m) {
        filename = decodeURIComponent(m[1] || m[2] || filename);
      }
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      // Download error
      alert('Download failed. Please try again.');
    }
  }, [currentPhoto]);

  const nextPhoto = useCallback(() => {
    if (photos.length === 0) return;
    setCurrentIndex(prevIndex => (prevIndex + 1) % photos.length);
    setZoomPercent(0);
    setPosition({ x: 0, y: 0 });
    setUsePreview(true);
    fallbackTriedRef.current = false;
  }, [photos.length]);

  // Toasts handled globally via ToastProvider
  
  // showInfo is now managed via URL parameter (handled by useUrlSync in App.jsx)
  // Notify parent when showInfo changes so it can update the URL
  useEffect(() => {
    if (onShowInfoChange) {
      onShowInfoChange(showInfo);
    }
  }, [showInfo, onShowInfoChange]);
  
  // On mount, if showInfo is true, notify parent immediately
  useEffect(() => {
    if (showInfo && onShowInfoChange) {
      console.log('[PhotoViewer] Notifying parent of initial showInfo=true');
      onShowInfoChange(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resolveProjectFolder = useCallback(() => {
    if (projectFolder && projectFolder !== '__all__') return projectFolder;
    if (fromAllMode) return currentPhoto?.project_folder || null;
    return null;
  }, [projectFolder, fromAllMode, currentPhoto]);

  const applyKeep = useCallback(async (mode) => {
    // applyKeep invoked
    if (!currentPhoto) return;
    const targetFolder = resolveProjectFolder();
    if (!targetFolder) return;
    let target;
    let msg;
    if (mode === 'none') {
      target = { keep_jpg: false, keep_raw: false };
      msg = `${currentPhoto.filename} planned for delete`;
    } else if (mode === 'jpg_only') {
      target = { keep_jpg: true, keep_raw: false };
      msg = `Planned to keep only JPG for ${currentPhoto.filename}`;
    } else if (mode === 'raw_jpg') {
      target = { keep_jpg: true, keep_raw: true };
      msg = `Planned to keep JPG + RAW for ${currentPhoto.filename}`;
    } else {
      return;
    }
    try {
      const total = (projectData?.photos?.length || photos.length || 1);
      msg += ` • 1 of ${total}`;
      toast.show({ emoji: '📝', message: msg, variant: 'notification' });
      // Sending keep update
      await updateKeep(targetFolder, [{ filename: currentPhoto.filename, ...target }]);
      // notify parent to update in-memory data so lists/grid refresh without full reload
      onKeepUpdated && onKeepUpdated({ filename: currentPhoto.filename, ...target });
      // Keep update success
      // Do not auto-advance on delete; only show toast and stay on current index
    } catch (e) {
      // Viewer keep error
      alert(e.message || 'Failed to update keep flags');
    }
  }, [currentPhoto, resolveProjectFolder, toast, onKeepUpdated]);

  const prevPhoto = useCallback(() => {
    if (photos.length === 0) return;
    setCurrentIndex(prevIndex => (prevIndex - 1 + photos.length) % photos.length);
    setZoomPercent(0);
    setPosition({ x: 0, y: 0 });
    setUsePreview(true);
    fallbackTriedRef.current = false;
  }, [photos.length]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const ks = config?.keyboard_shortcuts || {};
      const keyNext = ks.next_photo || 'ArrowRight';
      const keyPrev = ks.prev_photo || 'ArrowLeft';
      const keyClose = ks.close_viewer || 'Escape';
      const keyToggleSelect = ks.toggle_select || 's';
      const keyToggleInfo = ks.toggle_info || 'i';
      const keyZoomIn = ks.zoom_in || '='; // '+' often reports as '=' without shift
      const keyZoomOut = ks.zoom_out || '-';
      const keyCancelKeep = ks.cancel_keep || 'Delete';
      const keyKeepJpg = ks.keep_jpg_only || 'j';
      const keyKeepRawJpg = ks.keep_raw_and_jpg || 'r';

      if (e.key === keyNext) {
        nextPhoto();
      } else if (e.key === keyPrev) {
        prevPhoto();
      } else if (e.key === keyClose) {
        onClose();
      } else if (e.key && e.key.toLowerCase() === String(keyToggleSelect).toLowerCase()) {
        const cur = photos[currentIndex];
        if (cur && onToggleSelect) onToggleSelect(cur);
      } else if (e.key && e.key.toLowerCase() === String(keyToggleInfo).toLowerCase()) {
        setShowInfo(v => !v);
      } else if (e.key === keyZoomIn) {
        setZoomPercent((z) => Math.min(200, z + 5));
      } else if (e.key === keyZoomOut) {
        setZoomPercent((z) => Math.max(0, z - 5));
        if (zoomPercent - 5 <= 0) setPosition({ x: 0, y: 0 });
      } else if (e.key === keyCancelKeep) {
        e.preventDefault();
        applyKeep('none');
      } else if (e.key && e.key.toLowerCase() === String(keyKeepJpg).toLowerCase()) {
        e.preventDefault();
        applyKeep('jpg_only');
      } else if (e.key && e.key.toLowerCase() === String(keyKeepRawJpg).toLowerCase()) {
        e.preventDefault();
        applyKeep('raw_jpg');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextPhoto, prevPhoto, onClose, config, photos, currentIndex, onToggleSelect, zoomPercent, fromAllMode]);

  // Lock body scroll/zoom while viewer open (must be before any conditional returns)
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevTouchAction = document.body.style.touchAction;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouchAction;
    };
  }, []);
  
  useEffect(() => {
    // Reset index if startIndex changes
    setCurrentIndex(startIndex);
  }, [startIndex]);

  // This effect handles closing the viewer if the data becomes invalid
  useEffect(() => {
    // If the viewer was opened with an invalid startIndex, close immediately
    if (startIndex === -1) {
      onClose();
      return;
    }
    // If the photo list is empty, close the viewer
    if (!photos || photos.length === 0) {
      onClose();
      return;
    }
    // If currentIndex is out of bounds after filtering, clamp to last valid index
    if (currentIndex >= photos.length) {
      setCurrentIndex(photos.length - 1);
      return;
    }
    // If current slot became undefined due to a transient update, clamp to a valid index
    if (!photos[currentIndex]) {
      const clamped = Math.max(0, Math.min(currentIndex, photos.length - 1));
      setCurrentIndex(clamped);
    }
  }, [photos, currentIndex, startIndex, onClose]);

  // Fit scale based on container and natural image size
  const getFitScale = () => {
    const el = containerRef.current;
    const img = imgRef.current;
    if (!el) return 1;
    
    // Use naturalWidth/Height from img element if available
    const imgW = img?.naturalWidth || naturalSize.w;
    const imgH = img?.naturalHeight || naturalSize.h;
    
    if (!imgW || !imgH) return 1;
    
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const scale = Math.min(cw / imgW, ch / imgH);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  };
  const getEffectiveScale = () => {
    const fit = getFitScale();
    if (zoomPercent === 0) return fit; // 0% = fit to screen
    // interpolate from fit (0%) to 2.0 (200%)
    return fit + (2 - fit) * (zoomPercent / 200);
  };

  const handleWheel = (e) => {
    // Prevent page scroll and browser zoom while viewer is active
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // pointer position inside container
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    pointerRef.current = { x: px, y: py };
    const delta = e.deltaY > 0 ? -5 : 5; // 5% per step
    setZoomPercent(prevZoom => {
      const next = Math.max(0, Math.min(200, prevZoom + delta));
      if (next === 0) { setPosition({ x: 0, y: 0 }); return 0; }
      // Reposition so zoom is focused on pointer using previous zoom and current positionRef
      const fit = getFitScale();
      const s1 = fit + (2 - fit) * (prevZoom / 200);
      const s2 = fit + (2 - fit) * (next / 200);
      const { x: posX, y: posY } = positionRef.current;
      const cx = rect.width / 2, cy = rect.height / 2;
      const imgX = (px - cx - posX) / s1;
      const imgY = (py - cy - posY) / s1;
      const nx = (px - cx) - imgX * s2;
      const ny = (py - cy) - imgY * s2;
      setPosition(clampPosition(nx, ny, s2));
      return next;
    });
  };

  // Touch: pinch to zoom and one-finger pan
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = (t1, t2) => Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    const isControlTouch = (ev) => ev.target.closest('[data-viewer-control="true"]');

    const onTouchStart = (ev) => {
      if (isControlTouch(ev)) {
        return;
      }
      ev.preventDefault();
      if (ev.touches.length === 2) {
        const cx = (ev.touches[0].clientX + ev.touches[1].clientX) / 2;
        const cy = (ev.touches[0].clientY + ev.touches[1].clientY) / 2;
        const rect = el.getBoundingClientRect();
        pointerRef.current = { x: cx - rect.left, y: cy - rect.top };
        pinchRef.current = { active: true, startDist: distance(ev.touches[0], ev.touches[1]), startZoom: zoomPercent };
        swipeRef.current.active = false;
      } else if (ev.touches.length === 1) {
        const touch = ev.touches[0];
        if (zoomPercent > 0) {
          setIsPanning(true);
          panRef.current = { startX: touch.clientX, startY: touch.clientY, origX: position.x, origY: position.y };
          swipeRef.current.active = false;
        } else {
          setIsPanning(false);
          swipeRef.current = {
            active: true,
            startX: touch.clientX,
            startY: touch.clientY,
            lastX: touch.clientX,
            lastY: touch.clientY,
            startTime: Date.now()
          };
        }
      }
    };
    const onTouchMove = (ev) => {
      if (isControlTouch(ev)) {
        return;
      }
      ev.preventDefault();
      if (pinchRef.current.active && ev.touches.length === 2) {
        const scale = distance(ev.touches[0], ev.touches[1]) / (pinchRef.current.startDist || 1);
        const target = Math.round(pinchRef.current.startZoom * scale);
        const px = pointerRef.current.x;
        const py = pointerRef.current.y;
        const next = Math.max(0, Math.min(200, target));
        if (next === 0) { setZoomPercent(0); setPosition({ x: 0, y: 0 }); return; }
        const fit = getFitScale();
        const { x: posX, y: posY } = positionRef.current;
        const s1 = fit + (2 - fit) * (zoomPercent / 200);
        const s2 = fit + (2 - fit) * (next / 200);
        const rect = el.getBoundingClientRect();
        const cx = rect.width / 2, cy = rect.height / 2;
        const imgX = (px - cx - posX) / s1;
        const imgY = (py - cy - posY) / s1;
        const nx = (px - cx) - imgX * s2;
        const ny = (py - cy) - imgY * s2;
        setPosition(clampPosition(nx, ny, s2));
        setZoomPercent(next);
      } else if (isPanning && ev.touches.length === 1) {
        const dx = ev.touches[0].clientX - panRef.current.startX;
        const dy = ev.touches[0].clientY - panRef.current.startY;
        const { x, y } = clampPosition(panRef.current.origX + dx, panRef.current.origY + dy);
        setPosition({ x, y });
      } else if (swipeRef.current.active && ev.touches.length === 1) {
        swipeRef.current.lastX = ev.touches[0].clientX;
        swipeRef.current.lastY = ev.touches[0].clientY;
      }
    };
    const onTouchEnd = () => {
      if (swipeRef.current.active) {
        const { startX, startY, lastX, lastY, startTime } = swipeRef.current;
        const dx = lastX - startX;
        const dy = lastY - startY;
        const dt = Date.now() - startTime;
        if (Math.abs(dx) > 60 && Math.abs(dy) < 80 && dt < 600) {
          if (dx > 0) {
            prevPhoto();
          } else {
            nextPhoto();
          }
        }
      }
      swipeRef.current.active = false;
      pinchRef.current.active = false;
      setIsPanning(false);
    };
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [zoomPercent, position, isPanning, nextPhoto, prevPhoto]);

  // Add a non-passive wheel listener so we can call preventDefault safely
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  // Mouse pan when zoomed beyond fit
  const onMouseDown = (e) => { if (zoomPercent <= 0) return; e.preventDefault(); setIsPanning(true); panRef.current = { startX: e.clientX, startY: e.clientY, origX: position.x, origY: position.y }; };
  const onMouseMove = (e) => { if (!isPanning) return; const dx = e.clientX - panRef.current.startX; const dy = e.clientY - panRef.current.startY; const { x, y } = clampPosition(panRef.current.origX + dx, panRef.current.origY + dy); setPosition({ x, y }); };
  const onMouseUp = () => setIsPanning(false);

  // Ensure pan ends even if mouseup occurs outside
  useEffect(() => {
    const endPan = () => setIsPanning(false);
    window.addEventListener('mouseup', endPan);
    window.addEventListener('mouseleave', endPan);
    return () => {
      window.removeEventListener('mouseup', endPan);
      window.removeEventListener('mouseleave', endPan);
    };
  }, []);

  // Helper: ensure filename with extension for full-res image requests
  const filenameWithExtForImage = useCallback((p) => {
    const fn = p?.filename || '';
    // if already has an extension, return as-is
    if (/\.[A-Za-z0-9]+$/.test(fn)) return fn;
    // if JPG is available, default to .jpg for full-res endpoint
    if (p?.jpg_available) return `${fn}.jpg`;
    return fn;
  }, []);

  // Ensure 0% zoom stays centered when toggling details: recenter now and after the panel slide completes
  useEffect(() => {
    if (zoomPercent === 0) {
      // immediate recenter
      setPosition(clampPosition(0, 0));
      // recenter again after the sidebar transition (~100ms) to account for new container size
      const t = setTimeout(() => {
        setPosition(clampPosition(0, 0));
      }, 140);
      return () => clearTimeout(t);
    }
  }, [showInfo, zoomPercent, clampPosition]);

  // Preload adjacent images according to config.viewer.preload_count (default 1)
  useEffect(() => {
    if (!photos.length) return;
    const preloadCount = Math.max(0, config?.viewer?.preload_count ?? 1);
    if (preloadCount === 0) return;
    const created = [];
    const makeUrl = (p) => {
      const rawOnly = !!p?.raw_available && !p?.jpg_available;
      if (rawOnly) return null; // nothing to preload for RAW-only placeholder
      const pf = fromAllMode ? (p?.project_folder || projectFolder) : projectFolder;
      const v = encodeURIComponent(String(p?.updated_at || p?.taken_at || p?.id || ''));
      return usePreview
        ? `/api/projects/${encodeURIComponent(pf)}/preview/${encodeURIComponent(p.filename)}?v=${v}`
        : `/api/projects/${encodeURIComponent(pf)}/image/${encodeURIComponent(filenameWithExtForImage(p))}?v=${v}`;
    };
    for (let offset = 1; offset <= preloadCount; offset++) {
      const nextIdx = (currentIndex + offset) % photos.length;
      const prevIdx = (currentIndex - offset + photos.length) % photos.length;
      const toPreload = [photos[nextIdx], photos[prevIdx]];
      for (const p of toPreload) {
        if (!p) continue;
        const url = makeUrl(p);
        if (!url) continue;
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        created.push(img);
      }
    }
    // Cleanup: abort any in-flight by clearing src
    return () => {
      for (const img of created) {
        try { img.src = ''; } catch (_) {}
      }
    };
  }, [currentIndex, photos, projectFolder, usePreview, config?.viewer?.preload_count, fromAllMode]);

  // Conditional rendering is handled here, after all hooks are called.
  if (startIndex === -1) {
    return (
      <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50">
        <div className="text-white text-lg">Error: Photo not found in project.</div>
        <button onClick={onClose} className="absolute top-4 right-4 text-white text-3xl">&times;</button>
      </div>
    );
  }

  if (!currentPhoto) {
    // This can happen briefly if data is changing. The useEffect above will handle closing.
    return null;
  }

  // RAW-only when we have a RAW but no JPG rendition available
  const isRawFile = !!currentPhoto?.raw_available && !currentPhoto?.jpg_available;
  const isSelected = !!selectedPhotos?.has && selectedPhotos.has(currentPhoto.filename);
  const onImgLoad = (e) => {
    setNaturalSize({ w: e.target.naturalWidth, h: e.target.naturalHeight });
  };
  const effectiveScale = getEffectiveScale();

  const handleBackdropClick = () => {
    onClose();
  };

  // moved: filenameWithExtForImage hook is defined above conditional returns

  // Determine image source: preview by default, toggle to full-res
  const effectiveFolder = fromAllMode ? (currentPhoto?.project_folder || projectFolder) : projectFolder;
  const cacheV = encodeURIComponent(String(currentPhoto?.updated_at || currentPhoto?.taken_at || currentPhoto?.id || currentIndex || '')); 
  const imageSrc = usePreview
    ? `/api/projects/${encodeURIComponent(effectiveFolder)}/preview/${encodeURIComponent(currentPhoto.filename)}?v=${cacheV}`
    : `/api/projects/${encodeURIComponent(effectiveFolder)}/image/${encodeURIComponent(filenameWithExtForImage(currentPhoto))}?v=${cacheV}`;
  // moved: preloading and recentering effects are defined above conditional returns


  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex" onClick={handleBackdropClick} style={{ overscrollBehavior: 'contain' }}>
      {/* Toolbar (right-aligned) - adjusted for mobile, ALWAYS on top */}
      <div className="absolute top-3 left-3 right-3 z-[60] flex items-center justify-between sm:justify-end pointer-events-none" onMouseDown={(e)=>e.stopPropagation()} onClick={(e)=>e.stopPropagation()} style={{ touchAction: 'auto' }}>
        {/* Left section: close button (mobile only) */}
        <div className="flex sm:hidden pointer-events-auto">
          <button onClick={onClose} className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-red-600 text-white shadow hover:bg-red-700" title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 11-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        
        {/* Right section: details + close (desktop) */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Detail toggle */}
          <button
            onClick={() => setShowInfo(v => !v)}
            title="Detail"
            className={`h-9 px-3 inline-flex items-center text-sm rounded-md shadow bg-white text-gray-900 hover:bg-gray-100 border ${showInfo ? 'font-semibold ring-2 ring-blue-500 border-blue-500' : 'border-transparent'}`}
          >
            Detail
          </button>
          {/* Close icon (desktop only) */}
          <button onClick={showInfo ? () => setShowInfo(false) : onClose} className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-md bg-red-600 text-white shadow hover:bg-red-700" title={showInfo ? "Close details" : "Close"}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 11-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      <div ref={containerRef} className={`flex-1 w-full h-full flex items-center justify-center relative ${isPanning ? 'cursor-grabbing' : (zoomPercent > 0 ? 'cursor-grab' : '')}`} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onClick={(e)=>{ if (e.target === e.currentTarget) onClose(); }} style={{ overflow: 'visible', touchAction: 'none' }}>
        {/* Prev/Next inside image container */}
        <button
          type="button"
          data-viewer-control="true"
          onClick={(e)=>{e.stopPropagation(); prevPhoto();}}
          onTouchEnd={(e)=>{ e.preventDefault(); e.stopPropagation(); prevPhoto(); }}
          onPointerDown={(e)=>{e.stopPropagation();}}
          onTouchStart={(e)=>{e.stopPropagation();}}
          className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 text-white text-3xl sm:text-4xl z-40 bg-black/40 p-2 rounded-full hover:bg-black/60"
          style={{ touchAction: 'manipulation', pointerEvents: 'auto' }}
        >&#10094;</button>
        <button
          type="button"
          data-viewer-control="true"
          onClick={(e)=>{e.stopPropagation(); nextPhoto();}}
          onTouchEnd={(e)=>{ e.preventDefault(); e.stopPropagation(); nextPhoto(); }}
          onPointerDown={(e)=>{e.stopPropagation();}}
          onTouchStart={(e)=>{e.stopPropagation();}}
          className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 text-white text-3xl sm:text-4xl z-40 bg-black/40 p-2 rounded-full hover:bg-black/60"
          style={{ touchAction: 'manipulation', pointerEvents: 'auto' }}
        >&#10095;</button>
        {/* Loading overlay while preview/full image is fetching */}
        {!isRawFile && imageLoading && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/25">
            <div className="flex flex-col items-center text-white">
              <span className="inline-block h-8 w-8 border-2 border-white border-t-transparent rounded-full animate-spin mb-3" />
              <span className="text-sm opacity-90">Loading…</span>
            </div>
          </div>
        )}
        {isRawFile ? (
          // RAW file placeholder
          <div className="flex flex-col items-center justify-center text-white" onMouseDown={(e)=>e.stopPropagation()} onClick={(e)=>e.stopPropagation()}>
            <svg className="w-32 h-32 mb-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
            </svg>
            <h3 className="text-2xl font-bold mb-2">RAW File</h3>
            <p className="text-lg opacity-75 mb-4">{currentPhoto.filename.split('.').pop().toUpperCase()} Format</p>
            <p className="text-sm opacity-50 text-center max-w-md">
              This is a RAW camera file. Preview is not available.<br/>
              Use your preferred RAW editor to view and process this image.
            </p>
          </div>
        ) : (
          // Regular image
          <>
            <img 
              key={imageSrc}
              ref={imgRef}
              src={imageSrc}
              alt={currentPhoto.filename}
              onLoad={(e)=>{ onImgLoad(e); setImageLoading(false); }}
              style={{ 
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: naturalSize.w ? `${naturalSize.w}px` : 'auto',
                height: naturalSize.h ? `${naturalSize.h}px` : 'auto',
                transform: `translate(-50%, -50%) translate3d(${position.x}px, ${position.y}px, 0) scale(${effectiveScale})`, 
                transformOrigin: 'center center',
                willChange: 'transform',
                maxWidth: 'none',
                maxHeight: 'none',
                pointerEvents: 'none',
                userSelect: 'none'
              }}
              onError={(e) => {
                // If preview fails, fallback to full-resolution once
                if (usePreview && !fallbackTriedRef.current) {
                  fallbackTriedRef.current = true;
                  setUsePreview(false);
                  return;
                }
                // Fallback if image still fails to load
                e.target.style.display = 'none';
                const fallback = e.target.parentElement?.nextElementSibling;
                if (fallback) fallback.style.display = 'flex';
                // Stop the loading overlay so UI doesn't get stuck
                setImageLoading(false);
              }}
            />
            <div className="flex flex-col items-center justify-center text-white" style={{display: 'none'}}>
              <svg className="w-32 h-32 mb-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
              </svg>
              <h3 className="text-2xl font-bold mb-2">Image Not Available</h3>
              <p className="text-sm opacity-50 text-center max-w-md">
                Unable to load this image file.
              </p>
            </div>
          </>
        )}

        {/* Bottom controls: moved inside image container so they stay centered over the image area */}
        <div className="absolute bottom-4 inset-x-0 flex justify-center text-white" onMouseDown={(e)=>e.stopPropagation()} onClick={(e)=>e.stopPropagation()} onPointerDown={(e)=>e.stopPropagation()} onTouchStart={(e)=>e.stopPropagation()} style={{ touchAction: 'manipulation', pointerEvents: 'auto' }}>
          <div className="bg-black/60 backdrop-blur px-3 py-2 rounded-md flex items-center gap-3 shadow-lg" style={{ pointerEvents: 'auto' }} data-viewer-control="true">
          <button className="px-2 py-1 text-xs rounded bg-white/90 text-gray-800" type="button" data-viewer-control="true" onClick={() => { setZoomPercent(0); setPosition({x:0,y:0}); }} onTouchEnd={(e)=>{ e.preventDefault(); e.stopPropagation(); setZoomPercent(0); setPosition({x:0,y:0}); }} title="Fit to screen" style={{ touchAction: 'manipulation', pointerEvents: 'auto' }}>Fit</button>
          <input
            type="range"
            min={0}
            max={200}
            step={1}
            value={zoomPercent}
            onChange={(e) => setZoomPercent(parseInt(e.target.value, 10))}
            onInput={(e) => setZoomPercent(parseInt(e.currentTarget.value, 10))}
            onPointerDown={(e)=>{ e.stopPropagation(); }}
            onTouchStart={(e)=>{ e.stopPropagation(); }}
            style={{ touchAction: 'manipulation', pointerEvents: 'auto' }}
            data-viewer-control="true"
          />
          <span className="text-xs">{zoomPercent}%</span>
          </div>
        </div>
      </div>
      {/* Toasts are rendered by the global ToastContainer */}

      {/* Detail sidebar (mobile: full screen overlay, desktop: side panel in flex) */}
      {showInfo && (
        <div
          className="fixed sm:relative inset-0 sm:inset-auto w-full sm:w-96 md:w-80 h-full bg-white text-gray-800 px-4 shadow-xl z-50 pt-16 pb-4 overflow-auto"
          aria-hidden={false}
          onMouseDown={(e)=>e.stopPropagation()}
          onClick={(e)=>e.stopPropagation()}
        >
          {/* Content moved inside conditional render */}
          {/* Project context */}
          {(currentPhoto?.project_folder || projectFolder) && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold mb-2">Project</h3>
              <div className="flex flex-col gap-2 bg-gray-50 rounded-md px-3 py-3 border">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate" title={currentPhoto?.project_name || currentPhoto?.project_folder || projectFolder}>
                      {currentPhoto?.project_name || currentPhoto?.project_folder || projectFolder}
                    </div>
                    <div className="text-xs text-gray-600 truncate" title={currentPhoto?.project_folder || projectFolder}>
                      {currentPhoto?.project_folder || projectFolder}
                    </div>
                  </div>
                  {typeof onRequestMove === 'function' && (
                    <button
                      onClick={() => onRequestMove(currentPhoto)}
                      className="h-8 px-3 inline-flex items-center text-sm rounded-md shadow bg-blue-600 text-white hover:bg-blue-700 border border-blue-600 flex-none"
                      title="Move photo to another project"
                    >
                      Move
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {/* Panel spacer top (after project block) */}
          <div className="mb-2"></div>
          {/* Keep actions expander (Plan) */}
          <details className="mb-4" open>
            <summary className="cursor-pointer text-sm font-semibold select-none">Plan</summary>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(() => {
                const hasJpg = !!currentPhoto?.jpg_available;
                const hasRaw = !!currentPhoto?.raw_available;
                const keepJ = currentPhoto?.keep_jpg !== false; // default true unless explicitly false
                const keepR = currentPhoto?.keep_raw === true;   // default false unless explicitly true
                const activeMode = (!keepJ && !keepR) ? 'none' : (keepJ && keepR ? 'raw_jpg' : 'jpg_only');

                const baseBtn = 'px-3 py-1.5 text-sm rounded-md border w-full';

                const delActive = activeMode === 'none';
                const delClass = `${baseBtn} ${delActive ? 'bg-white border-red-500 ring-2 ring-red-500 text-red-700' : 'bg-red-100 hover:bg-red-200 border-red-200'}`;

                const jpgDisabled = !hasJpg && hasRaw; // only RAW present
                const jpgActive = activeMode === 'jpg_only';
                const jpgClass = `${baseBtn} ${jpgActive ? 'bg-white border-blue-500 ring-2 ring-blue-500' : 'bg-gray-100 hover:bg-gray-200 border-gray-200'} ${jpgDisabled ? 'opacity-50 cursor-not-allowed' : ''}`;

                const bothDisabled = hasJpg && !hasRaw ? true : false; // only JPG present
                const bothActive = activeMode === 'raw_jpg';
                const bothClass = `${baseBtn} ${bothActive ? 'bg-white border-blue-500 ring-2 ring-blue-500' : 'bg-gray-100 hover:bg-gray-200 border-gray-200'} ${bothDisabled ? 'opacity-50 cursor-not-allowed' : ''}`;

                return (
                  <>
                    <button
                      onClick={() => applyKeep('none')}
                      className={delClass}
                      title="Plan: Delete"
                    >Delete</button>
                    <button
                      onClick={() => { if (!jpgDisabled) applyKeep('jpg_only'); }}
                      disabled={jpgDisabled}
                      className={jpgClass}
                      title={jpgDisabled ? 'Not available: only RAW present' : 'Plan: Keep JPG only'}
                    >JPG</button>
                    <button
                      onClick={() => { if (!bothDisabled) applyKeep('raw_jpg'); }}
                      disabled={bothDisabled}
                      className={bothClass}
                      title={bothDisabled ? 'Not available: only JPG present' : 'Plan: Keep JPG + RAW'}
                    >JPG+RAW</button>
                  </>
                );
              })()}
              
              <div className="col-span-3 text-xs text-gray-500">
                {(() => {
                  const ks = config?.keyboard_shortcuts || {};
                  const del = ks.cancel_keep || 'Delete';
                  const j = ks.keep_jpg_only || 'j';
                  const r = ks.keep_raw_and_jpg || 'r';
                  return `Shortcuts: ${del} = Delete, ${j} = JPG, ${r} = JPG+RAW`;
                })()}
              </div>
            </div>
          </details>
          {/* Quality section */}
          {!isRawFile && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold mb-2">Quality</h3>
              <div className="flex items-center gap-3 select-none bg-gray-50 rounded-md px-3 py-2">
                <span className="text-sm">High Quality</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!usePreview}
                  onClick={() => { setUsePreview(prev => !prev); setImageLoading(true); fallbackTriedRef.current = false; }}
                  title="Toggle High Quality"
                  className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors focus:outline-none ${!usePreview ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${!usePreview ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                {imageLoading && (
                  <svg className="animate-spin h-4 w-4 text-gray-600" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                  </svg>
                )}
              </div>
            </div>
          )}
          {/* Tags as labels */}
          {Array.isArray(currentPhoto.tags) && currentPhoto.tags.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1">
              {currentPhoto.tags.map((t) => (
                <span key={t} className="inline-flex items-center px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-xs">{t}</span>
              ))}
            </div>
          )}
          {/* Metadata first */}
          <div className="mb-4">
            <h3 className="text-sm font-semibold mb-2">Metadata</h3>
            <div className="text-xs space-y-1">
              {(() => {
                const meta = currentPhoto.metadata || currentPhoto.exif || {};
                const entries = Object.entries(meta);
                if (!entries.length) return <div className="text-gray-500">No metadata</div>;
                const fmtDate = (v) => { const d = new Date(v); return isNaN(d.getTime()) ? String(v) : d.toLocaleString(); };
                return entries.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-gray-600 break-all">{k}</span>
                    <span className="text-right break-all">{/date/i.test(k) ? fmtDate(v) : String(v)}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
          {/* Primary */}
          <div className="mb-2">
            <h3 className="text-sm font-semibold mb-2">Primary</h3>
            <div className="text-xs space-y-1">
              <div className="flex justify-between gap-2"><span className="text-gray-600">filename</span><span className="text-right break-all">{String(currentPhoto.filename)}</span></div>
              {currentPhoto.created_at && (
                <div className="flex justify-between gap-2"><span className="text-gray-600">created_at</span><span className="text-right break-all">{new Date(currentPhoto.created_at).toLocaleString()}</span></div>
              )}
              {currentPhoto.updated_at && (
                <div className="flex justify-between gap-2"><span className="text-gray-600">updated_at</span><span className="text-right break-all">{new Date(currentPhoto.updated_at).toLocaleString()}</span></div>
              )}
            </div>
          </div>
          {/* Other details collapsed */}
          <details className="mt-2">
            <summary className="cursor-pointer text-sm font-semibold select-none">More details</summary>
            <div className="mt-2 text-xs space-y-1">
              {Object.entries(currentPhoto).filter(([k]) => !['tags','metadata','exif','filename','created_at','updated_at'].includes(k)).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span className="text-gray-600 break-all">{k}</span>
                  <span className="text-right break-all">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                </div>
              ))}
            </div>
          </details>
          {/* Download collapsed expander with clear CTAs */}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold select-none">Download</summary>
            <div className="mt-2 flex flex-col gap-2">
              <button
                className={`w-full px-4 py-2 rounded-md text-white ${currentPhoto.jpg_available ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-not-allowed'}`}
                disabled={!currentPhoto.jpg_available}
                title={currentPhoto.jpg_available ? 'Download JPG' : 'JPG not available'}
                onClick={async () => {
                const r = await fetch(`/api/projects/${encodeURIComponent(projectFolder)}/download-url`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filename: currentPhoto.filename, type: 'jpg' })
                });
                const { url } = await r.json();
                await fetchAndSave(url);
              }}
              >Download JPG</button>
              <button
                className={`w-full px-4 py-2 rounded-md text-white ${currentPhoto.raw_available ? 'bg-gray-900 hover:bg-black' : 'bg-gray-300 cursor-not-allowed'}`}
                disabled={!currentPhoto.raw_available}
                title={currentPhoto.raw_available ? 'Download RAW' : 'RAW not available'}
                onClick={async () => {
                const r = await fetch(`/api/projects/${encodeURIComponent(projectFolder)}/download-url`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filename: currentPhoto.filename, type: 'raw' })
                });
                const { url } = await r.json();
                await fetchAndSave(url);
              }}
              >Download RAW</button>
              <button
                className={`w-full px-4 py-2 rounded-md border ${ (currentPhoto.jpg_available || currentPhoto.raw_available) ? 'bg-white hover:bg-gray-50' : 'bg-gray-100 cursor-not-allowed'}`}
                disabled={!(currentPhoto.jpg_available || currentPhoto.raw_available)}
                title={(currentPhoto.jpg_available || currentPhoto.raw_available) ? 'Download all available as ZIP' : 'No files available to download'}
                onClick={async () => {
                const r = await fetch(`/api/projects/${encodeURIComponent(projectFolder)}/download-url`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filename: currentPhoto.filename, type: 'zip' })
                });
                const { url } = await r.json();
                await fetchAndSave(url);
              }}
              >Download All (ZIP)</button>
            </div>
          </details>
          
          {/* Filename area: chip + clickable filename badge (toggle selection) */}
          <div className="absolute bottom-4 right-4 flex items-center gap-2" onMouseDown={(e)=>e.stopPropagation()} onClick={(e)=>e.stopPropagation()}>
            {isSelected && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] leading-none bg-blue-100 text-blue-800 border border-blue-200 select-none shadow">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M2.25 12a9.75 9.75 0 1119.5 0 9.75 9.75 0 01-19.5 0zm14.03-2.28a.75.75 0 10-1.06-1.06l-4.72 4.72-1.69-1.69a.75.75 0 10-1.06 1.06l2.22 2.22c.3.3.79.3 1.06 0l5.25-5.25z" clipRule="evenodd" />
                </svg>
                Selected
              </span>
            )}
            <button
              className={`text-white bg-black/60 px-4 py-2 rounded-md text-xs select-none cursor-pointer border ${isSelected ? 'border-blue-500' : 'border-transparent'} shadow-lg`}
              onClick={(e)=>{ e.stopPropagation(); if (onToggleSelect) onToggleSelect(currentPhoto); }}
              title={isSelected ? 'Click to unselect' : 'Click to select'}
            >
              {currentPhoto.filename}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PhotoViewer;
