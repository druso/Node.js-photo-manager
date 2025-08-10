import React, { useState, useEffect, useCallback, useRef } from 'react';

const PhotoViewer = ({ projectData, projectFolder, startIndex, onClose, config, selectedPhotos, onToggleSelect }) => {
  // All hooks are called at the top level, unconditionally.
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [zoomPercent, setZoomPercent] = useState(0); // 0 = Fit, 100 = Actual size
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [showInfo, setShowInfo] = useState(false);
  const containerRef = useRef(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [usePreview, setUsePreview] = useState(true);
  const [imageLoading, setImageLoading] = useState(true);
  const fallbackTriedRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef({ startX: 0, startY: 0, origX: 0, origY: 0 });
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 0 });
  const pointerRef = useRef({ x: 0, y: 0 });
  const positionRef = useRef(position);

  const photos = projectData?.photos || [];
  const currentPhoto = photos[currentIndex];

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
    const s = scaleOverride ?? (fit + (1 - fit) * (zoomPercent / 100));
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
        setZoomPercent((z) => Math.min(100, z + 5));
      } else if (e.key === keyZoomOut) {
        setZoomPercent((z) => Math.max(0, z - 5));
        if (zoomPercent - 5 <= 0) setPosition({ x: 0, y: 0 });
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
    // interpolate from fit (0%) to actual 1.0 (100%)
    return fit + (1 - fit) * (zoomPercent / 100);
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
      const next = Math.max(0, Math.min(100, prevZoom + delta));
      if (next === 0) { setPosition({ x: 0, y: 0 }); return 0; }
      // Reposition so zoom is focused on pointer using previous zoom and current positionRef
      const fit = getFitScale();
      const s1 = fit + (1 - fit) * (prevZoom / 100);
      const s2 = fit + (1 - fit) * (next / 100);
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
        const next = Math.max(0, Math.min(100, target));
        if (next === 0) { setZoomPercent(0); setPosition({ x: 0, y: 0 }); return; }
        const fit = getFitScale();
        const { x: posX, y: posY } = positionRef.current;
        const s1 = fit + (1 - fit) * (zoomPercent / 100);
        const s2 = fit + (1 - fit) * (next / 100);
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

  const isRawFile = /\.(arw|cr2|nef|dng|raw)$/i.test(currentPhoto.filename);
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



  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex" onClick={handleBackdropClick} style={{ overscrollBehavior: 'contain', touchAction: 'none' }}>
      {/* Toolbar */}
      <div className="absolute top-3 left-3 right-3 z-50 flex items-center justify-between pointer-events-none" onMouseDown={(e)=>e.stopPropagation()} onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-center gap-2 pointer-events-auto">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md bg-red-600 text-white shadow hover:bg-red-700" title="Close">Close</button>
          <button onClick={() => setShowInfo(v => !v)} title="Info" className="px-3 py-1.5 text-sm rounded-md bg-white text-gray-900 shadow hover:bg-gray-100">Info</button>
          <button onClick={() => onToggleSelect && onToggleSelect(currentPhoto)} title="Toggle selected (S)" className={`px-3 py-1.5 text-sm rounded-md shadow ${isSelected ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-white text-gray-900 hover:bg-gray-100'}`}>{isSelected ? 'Selected' : 'Select'}</button>
          {!isRawFile && (
            <div className="flex items-center gap-3 select-none bg-white text-gray-900 rounded-md shadow px-3 py-1.5">
              <span className="text-sm">High Res</span>
              <button
                type="button"
                role="switch"
                aria-checked={!usePreview}
                onClick={() => { setUsePreview(prev => !prev); setImageLoading(true); fallbackTriedRef.current = false; }}
                onMouseDown={(e)=>e.stopPropagation()}
                title="Toggle High Resolution"
                className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors focus:outline-none ${!usePreview ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${!usePreview ? 'translate-x-6' : 'translate-x-1'}`}
                />
              </button>
              {imageLoading && (
                <svg className="animate-spin h-4 w-4 text-gray-600" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                </svg>
              )}
            </div>
          )}
          {/* Download dropdown */}
          <div className="relative">
            <details className="group">
              <summary className="list-none px-3 py-1.5 text-sm rounded-md bg-white text-gray-900 shadow hover:bg-gray-100 cursor-pointer select-none">Download ▾</summary>
              <div className="absolute mt-1 bg-white text-gray-900 rounded-md shadow border z-50 min-w-[12rem]">
                <button className="block w-full text-left px-3 py-2 hover:bg-gray-100" onClick={async () => {
                  const r = await fetch(`/api/projects/${encodeURIComponent(projectFolder)}/download-url`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: currentPhoto.filename, type: 'jpg' })
                  });
                  const { url } = await r.json();
                  await fetchAndSave(url);
                }}>JPG</button>
                <button className="block w-full text-left px-3 py-2 hover:bg-gray-100" onClick={async () => {
                  const r = await fetch(`/api/projects/${encodeURIComponent(projectFolder)}/download-url`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: currentPhoto.filename, type: 'raw' })
                  });
                  const { url } = await r.json();
                  await fetchAndSave(url);
                }}>RAW</button>
                <button className="block w-full text-left px-3 py-2 hover:bg-gray-100" onClick={async () => {
                  const r = await fetch(`/api/projects/${encodeURIComponent(projectFolder)}/download-url`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: currentPhoto.filename, type: 'zip' })
                  });
                  const { url } = await r.json();
                  await fetchAndSave(url);
                }}>All files (ZIP)</button>
              </div>
            </details>
          </div>
        </div>
        <div className="pointer-events-auto"></div>
      </div>

      <div ref={containerRef} className={`flex-1 h-full flex items-center justify-center overflow-hidden relative ${isPanning ? 'cursor-grabbing' : (zoomPercent > 0 ? 'cursor-grab' : '')}`} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onClick={(e)=>{ if (e.target === e.currentTarget) onClose(); }}>
        {/* Prev/Next inside image container so they don't overlap right-side slider/sidebar */}
        <button onClick={(e)=>{e.stopPropagation(); prevPhoto();}} className="absolute left-4 top-1/2 -translate-y-1/2 text-white text-4xl z-40 bg-black bg-opacity-40 p-2 rounded-full hover:bg-opacity-60">&#10094;</button>
        <button onClick={(e)=>{e.stopPropagation(); nextPhoto();}} className="absolute right-4 top-1/2 -translate-y-1/2 text-white text-4xl z-40 bg-black bg-opacity-40 p-2 rounded-full hover:bg-opacity-60">&#10095;</button>
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
                e.target.nextSibling.style.display = 'flex';
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
      </div>
      {/* Bottom controls: zoom slider + percent */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white bg-black bg-opacity-60 backdrop-blur px-3 py-2 rounded-md flex items-center gap-3 shadow-lg" onMouseDown={(e)=>e.stopPropagation()} onClick={(e)=>e.stopPropagation()}>
        <button className="px-2 py-1 text-xs rounded bg-white bg-opacity-90 text-gray-800" onClick={() => { setZoomPercent(0); setPosition({x:0,y:0}); }} title="Fit to screen">Fit</button>
        <input type="range" min={0} max={100} step={1} value={zoomPercent} onChange={(e) => setZoomPercent(parseInt(e.target.value, 10))} />
        <span className="text-xs">{zoomPercent}%</span>
      </div>

      {/* Info sidebar */}
      {showInfo && (
        <div className="hidden md:block w-80 h-full bg-white bg-opacity-95 text-gray-800 pt-16 px-4 pb-4 overflow-auto border-l" onMouseDown={(e)=>e.stopPropagation()} onClick={(e)=>e.stopPropagation()}>
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
            <summary className="cursor-pointer text-sm font-semibold select-none">Details</summary>
            <div className="mt-2 text-xs space-y-1">
              {Object.entries(currentPhoto).filter(([k]) => !['tags','metadata','exif','filename','created_at','updated_at'].includes(k)).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span className="text-gray-600 break-all">{k}</span>
                  <span className="text-right break-all">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
      {/* Filename badge */}
      <div className="absolute bottom-4 right-4 text-white bg-black bg-opacity-50 px-3 py-2 rounded-md text-xs">{currentPhoto.filename}</div>
    </div>
  );
};

export default PhotoViewer;
