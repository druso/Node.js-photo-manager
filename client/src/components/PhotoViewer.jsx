import React, { useState, useEffect, useCallback, useRef } from 'react';
import { updateKeep } from '../api/keepApi';

const PhotoViewer = ({ projectData, projectFolder, startIndex, onClose, config, selectedPhotos, onToggleSelect, onKeepUpdated, previewModeEnabled, onCurrentIndexChange }) => {
  // All hooks are called at the top level, unconditionally.
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [zoomPercent, setZoomPercent] = useState(0); // 0 = Fit, 100 = Actual size, 200 = 2x
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [showInfo, setShowInfo] = useState(() => sessionStorage.getItem('viewer_show_info') === '1');
  const containerRef = useRef(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [usePreview, setUsePreview] = useState(true);
  const [imageLoading, setImageLoading] = useState(true);
  const fallbackTriedRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef({ startX: 0, startY: 0, origX: 0, origY: 0 });
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 0 });
  // Removed image transition animations per request
  const pointerRef = useRef({ x: 0, y: 0 });
  const positionRef = useRef(position);
  const [toast, setToast] = useState({ visible: false, text: '' });
  const toastTimerRef = useRef(null);

  const photos = projectData?.photos || [];
  const currentPhoto = photos[currentIndex];

  // Notify parent of current index and photo changes for persistence
  useEffect(() => {
    if (typeof onCurrentIndexChange === 'function') {
      onCurrentIndexChange(currentIndex, currentPhoto);
    }
  }, [currentIndex, currentPhoto, onCurrentIndexChange]);

  // Whenever the photo index or preview/full-res mode changes, show loading until onLoad
  useEffect(() => {
    setImageLoading(true);
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
      console.error('Download error:', err);
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

  const showToast = useCallback((text) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast({ visible: true, text });
    toastTimerRef.current = setTimeout(() => {
      setToast(prev => ({ ...prev, visible: false }));
      toastTimerRef.current = null;
    }, 1200);
  }, []);

  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);
  
  // Persist Details panel visibility for single-tab session
  useEffect(() => {
    sessionStorage.setItem('viewer_show_info', showInfo ? '1' : '0');
  }, [showInfo]);

  const applyKeep = useCallback(async (mode) => {
    console.log('applyKeep invoked with mode:', mode);
    if (!currentPhoto || !projectFolder) return;
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
      if (previewModeEnabled) msg += ' • Preview mode ON';
      showToast(msg);
      console.log('Sending keep update for', currentPhoto.filename, target);
      await updateKeep(projectFolder, [{ filename: currentPhoto.filename, ...target }]);
      // notify parent to update in-memory data so lists/grid refresh without full reload
      onKeepUpdated && onKeepUpdated({ filename: currentPhoto.filename, ...target });
      console.log('Keep update success');
      // In preview mode, if we cancelled (both false), advance so the current disappears and we keep navigating
      if (previewModeEnabled && target.keep_jpg === false && target.keep_raw === false) {
        nextPhoto();
      }
    } catch (e) {
      console.error('Viewer keep error:', e);
      alert(e.message || 'Failed to update keep flags');
    }
  }, [currentPhoto, projectFolder, showToast, onKeepUpdated, previewModeEnabled, nextPhoto]);

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
  }, [nextPhoto, prevPhoto, onClose, config, photos, currentIndex, onToggleSelect, zoomPercent]);

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
    if (startIndex === -1 || !photos[currentIndex]) {
      onClose();
    }
  }, [photos, currentIndex, startIndex, onClose]);

  // Fit scale based on container and natural image size
  const getFitScale = () => {
    const el = containerRef.current;
    if (!el || !naturalSize.w || !naturalSize.h) return 1;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const scale = Math.min(cw / naturalSize.w, ch / naturalSize.h);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  };
  const getEffectiveScale = () => {
    const fit = getFitScale();
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
    const onTouchStart = (ev) => {
      ev.preventDefault();
      if (ev.touches.length === 2) {
        const cx = (ev.touches[0].clientX + ev.touches[1].clientX) / 2;
        const cy = (ev.touches[0].clientY + ev.touches[1].clientY) / 2;
        const rect = el.getBoundingClientRect();
        pointerRef.current = { x: cx - rect.left, y: cy - rect.top };
        pinchRef.current = { active: true, startDist: distance(ev.touches[0], ev.touches[1]), startZoom: zoomPercent };
      } else if (ev.touches.length === 1) {
        setIsPanning(true);
        panRef.current = { startX: ev.touches[0].clientX, startY: ev.touches[0].clientY, origX: position.x, origY: position.y };
      }
    };
    const onTouchMove = (ev) => {
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
      }
    };
    const onTouchEnd = () => { pinchRef.current.active = false; setIsPanning(false); };
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
  }, [zoomPercent, position, isPanning]);

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

  // Conditional rendering is handled here, after all hooks are called.
  if (startIndex === -1) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
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
  const onImgLoad = (e) => setNaturalSize({ w: e.target.naturalWidth, h: e.target.naturalHeight });
  const effectiveScale = getEffectiveScale();

  const handleBackdropClick = () => {
    onClose();
  };

  // Determine image source: preview by default, toggle to full-res
  const imageSrc = usePreview
    ? `/api/projects/${encodeURIComponent(projectFolder)}/preview/${encodeURIComponent(currentPhoto.filename)}`
    : `/api/projects/${encodeURIComponent(projectFolder)}/image/${encodeURIComponent(currentPhoto.filename)}`;

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
      return usePreview
        ? `/api/projects/${encodeURIComponent(projectFolder)}/preview/${encodeURIComponent(p.filename)}`
        : `/api/projects/${encodeURIComponent(projectFolder)}/image/${encodeURIComponent(p.filename)}`;
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
  }, [currentIndex, photos, projectFolder, usePreview, config?.viewer?.preload_count]);


  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex" onClick={handleBackdropClick} style={{ overscrollBehavior: 'contain', touchAction: 'none' }}>
      {/* Toolbar (right-aligned) */}
      <div className="absolute top-3 left-3 right-3 z-50 flex items-center justify-end pointer-events-none" onMouseDown={(e)=>e.stopPropagation()} onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Detail toggle (same height as close) */}
          <button
            onClick={() => setShowInfo(v => !v)}
            title="Detail"
            className={`h-9 px-3 inline-flex items-center text-sm rounded-md shadow bg-white text-gray-900 hover:bg-gray-100 border ${showInfo ? 'font-semibold ring-2 ring-blue-500 border-blue-500' : 'border-transparent'}`}
          >
            Detail
          </button>
          {/* Close icon at far right. If details open, this closes details; otherwise closes viewer */}
          {showInfo ? (
            <button onClick={() => setShowInfo(false)} className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-gray-200 text-gray-800 shadow hover:bg-gray-300" title="Close details">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 11-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
              </svg>
            </button>
          ) : (
            <button onClick={onClose} className="h-9 w-9 inline-flex items-center justify-center rounded-md bg-red-600 text-white shadow hover:bg-red-700" title="Close">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 11-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div ref={containerRef} className={`flex-1 h-full flex items-center justify-center overflow-hidden relative ${isPanning ? 'cursor-grabbing' : (zoomPercent > 0 ? 'cursor-grab' : '')}`} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onClick={(e)=>{ if (e.target === e.currentTarget) onClose(); }}>
        {/* Prev/Next inside image container so they don't overlap right-side slider/sidebar */}
        <button onClick={(e)=>{e.stopPropagation(); prevPhoto();}} className="absolute left-4 top-1/2 -translate-y-1/2 text-white text-4xl z-40 bg-black bg-opacity-40 p-2 rounded-full hover:bg-opacity-60">&#10094;</button>
        <button onClick={(e)=>{e.stopPropagation(); nextPhoto();}} className="absolute right-4 top-1/2 -translate-y-1/2 text-white text-4xl z-40 bg-black bg-opacity-40 p-2 rounded-full hover:bg-opacity-60">&#10095;</button>
        {/* Loading overlay while preview/full image is fetching */}
        {!isRawFile && imageLoading && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black bg-opacity-25">
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
              src={imageSrc}
              alt={currentPhoto.filename}
              onLoad={(e)=>{ onImgLoad(e); setImageLoading(false); }}
              className="max-w-none"
              style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${effectiveScale})`, willChange: 'transform' }}
              onMouseDown={(e)=>{ e.stopPropagation(); onMouseDown(e); }}
              onClick={(e)=> e.stopPropagation()}
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
        <div className="absolute bottom-4 inset-x-0 flex justify-center text-white" onMouseDown={(e)=>e.stopPropagation()} onClick={(e)=>e.stopPropagation()}>
          <div className="bg-black bg-opacity-60 backdrop-blur px-3 py-2 rounded-md flex items-center gap-3 shadow-lg">
          <button className="px-2 py-1 text-xs rounded bg-white bg-opacity-90 text-gray-800" onClick={() => { setZoomPercent(0); setPosition({x:0,y:0}); }} title="Fit to screen">Fit</button>
          <input type="range" min={0} max={200} step={1} value={zoomPercent} onChange={(e) => setZoomPercent(parseInt(e.target.value, 10))} />
          <span className="text-xs">{zoomPercent}%</span>
          </div>
        </div>
      </div>
      {/* Toast notification */}
      <div
        className={`pointer-events-none fixed bottom-6 right-6 transition-all duration-200 z-50 ${toast.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}
      >
        <div className="px-4 py-3 rounded-lg bg-black bg-opacity-85 text-white text-base shadow-lg border-2 border-blue-400">
          {toast.text}
        </div>
      </div>

      {/* Detail sidebar (mobile + desktop) */}
      <div
        className={
          `h-full ${showInfo ? 'w-full sm:w-96 md:w-80 bg-white text-gray-800 px-4 border-l shadow-xl translate-x-0 pointer-events-auto' : 'w-0 sm:w-0 md:w-0 bg-transparent text-transparent px-0 translate-x-full pointer-events-none'} pt-4 md:pt-16 pb-4 overflow-auto transform transition-all duration-100 ease-out`
        }
        aria-hidden={!showInfo}
        onMouseDown={(e)=>e.stopPropagation()}
        onClick={(e)=>e.stopPropagation()}
      >
          {/* Panel spacer top (no header or title now) */}
          <div className="mb-2"></div>
          {/* Keep actions expander (above Quality) */}
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
                      title="Plan: Delete (hide in preview mode)"
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
              <div className="flex items-center gap-3 select-none bg-gray-50 rounded-md border px-3 py-2">
                <span className="text-sm">High Quality</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!usePreview}
                  onClick={() => { setUsePreview(prev => !prev); setImageLoading(true); fallbackTriedRef.current = false; }}
                  title="Toggle High Quality"
                  className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors focus:outline-none ${!usePreview ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${!usePreview ? 'translate-x-6' : 'translate-x-1'}`} />
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
        </div>
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
          className={`text-white bg-black bg-opacity-60 px-4 py-2 rounded-md text-xs select-none cursor-pointer border ${isSelected ? 'border-blue-500' : 'border-transparent'} shadow-lg`}
          onClick={(e)=>{ e.stopPropagation(); if (onToggleSelect) onToggleSelect(currentPhoto); }}
          title={isSelected ? 'Click to unselect' : 'Click to select'}
        >
          {currentPhoto.filename}
        </button>
      </div>
    </div>
  );
};

export default PhotoViewer;
