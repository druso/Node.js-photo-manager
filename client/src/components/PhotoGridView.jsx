import React, { useEffect, useMemo, useRef, useState } from 'react';
import Thumbnail from './Thumbnail';

const PhotoGridView = ({ projectData, projectFolder, onPhotoSelect, selectedPhotos, onToggleSelection, lazyLoadThreshold = 100, sizeLevel = 's' }) => {
  const [visibleCount, setVisibleCount] = useState(lazyLoadThreshold);
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    // Reset only when switching projects or the threshold changes
    setVisibleCount(lazyLoadThreshold);
  }, [projectFolder, lazyLoadThreshold]);

  // Lazy-load more items when near bottom of page scroll
  useEffect(() => {
    function onWindowScroll() {
      if (!projectData?.photos?.length) return;
      const nearBottom = (window.innerHeight + window.scrollY) >= (document.body.offsetHeight - 200);
      if (nearBottom) {
        setVisibleCount(prev => Math.min(prev + lazyLoadThreshold, projectData.photos.length));
      }
    }
    window.addEventListener('scroll', onWindowScroll, { passive: true });
    return () => window.removeEventListener('scroll', onWindowScroll);
  }, [projectData, lazyLoadThreshold]);

  const isEmpty = !projectData || !projectData.photos || projectData.photos.length === 0;

  // Target row height by size; rows will scale to perfectly fill width
  const sizeToTargetH = { s: 120, m: 180, l: 240 };
  const targetRowH = sizeToTargetH[sizeLevel] ?? sizeToTargetH.s;
  const gap = sizeLevel === 's' ? 2 : 4; // px gap between items
  const borderClass = 'border';

  // Observe container width (responsive, no CLS)
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

  // Precompute aspect ratios using EXIF metadata when available
  const photos = projectData?.photos?.slice(0, visibleCount) || [];
  const ratios = useMemo(() => {
    return photos.map(p => {
      const md = p.metadata || {};
      const w = md.exif_image_width || md.ExifImageWidth || md.ImageWidth || md.width || md.PixelXDimension;
      const h = md.exif_image_height || md.ExifImageHeight || md.ImageHeight || md.height || md.PixelYDimension;
      let r = 3 / 2; // default 1.5
      if (w && h && w > 0 && h > 0) {
        // consider EXIF orientation swaps 6/8 where dimensions stored rotated
        const ori = md.orientation || md.Orientation;
        if (ori === 6 || ori === 8) {
          r = h / w; // swapped
        } else {
          r = w / h;
        }
      }
      // clamp extreme ratios to keep layout stable
      return Math.max(0.3, Math.min(3.5, r));
    });
  }, [photos]);

  // Build justified rows that exactly fill containerWidth
  const rows = useMemo(() => {
    if (!containerWidth || photos.length === 0) return [];
    const rowsOut = [];
    let row = [];
    let sumR = 0;
    const maxRowH = targetRowH * 1.4;
    const minRowH = targetRowH * 0.7;
    const usableWidth = containerWidth; // we include gap during width calculations per item
    for (let i = 0; i < photos.length; i++) {
      const r = ratios[i] || 1.5;
      row.push({ idx: i, r });
      sumR += r;
      // width at target height (including gaps between items)
      const totalGaps = (row.length - 1) * gap;
      const rowWidthAtTarget = sumR * targetRowH + totalGaps;
      // If row is too wide, finalize by scaling height so it fits exactly
      if (rowWidthAtTarget >= usableWidth || i === photos.length - 1) {
        // Scale height to fill exactly
        let h = (usableWidth - totalGaps) / sumR;
        // Clamp to avoid extreme heights; if clamped, we may have leftover space at row end
        h = Math.max(minRowH, Math.min(maxRowH, h));
        const rowItems = row.map((it, j) => {
          const w = Math.round(it.r * h);
          return { ...it, w, h };
        });
        rowsOut.push(rowItems);
        // reset row
        row = [];
        sumR = 0;
      }
    }
    return rowsOut;
  }, [containerWidth, photos, ratios, targetRowH, gap]);

  return (
    <div ref={containerRef} className="w-full p-1">
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-12 text-center text-gray-600">
          <div className="mb-3 text-gray-400" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-8 w-8">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
          </div>
          <p className="max-w-md">
            <span className="font-medium text-gray-800">Drop images anywhere on this page</span> to add them to the current project, or click the{' '}
            <span className="inline-flex items-center gap-1 align-middle" aria-label="plus icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg>
              <span>+ icon</span>
            </span>.
          </p>
        </div>
      ) : (
        rows.map((rowItems, rowIdx) => (
          <div key={`row-${rowIdx}`} className="flex" style={{ marginBottom: `${gap}px` }}>
            {rowItems.map(({ idx, w, h }, j) => {
              const photo = photos[idx];
              const isSelected = selectedPhotos?.has(photo.filename);
              const marginRight = j < rowItems.length - 1 ? gap : 0;
              return (
                <div
                  key={`${photo.id}-${photo.filename}`}
                  className={`relative bg-gray-200 overflow-hidden cursor-pointer group ${borderClass} border-2 ${isSelected ? 'border-blue-600 ring-2 ring-blue-400' : 'border-transparent ring-0'} transition-all flex-none`}
                  style={{ width: `${w}px`, height: `${Math.round(h)}px`, marginRight }}
                  onClick={() => onToggleSelection(photo)}
                >
                  {/* Selection toggle in top-left */}
                  <button
                    type="button"
                    aria-label={isSelected ? 'Deselect photo' : 'Select photo'}
                    onClick={(e) => { e.stopPropagation(); onToggleSelection(photo); }}
                    className={`absolute top-1 left-1 z-10 flex items-center justify-center h-6 w-6 rounded-full border transition shadow-sm
                      ${isSelected
                        ? 'bg-blue-600 text-white border-blue-600 opacity-100'
                        : 'bg-white/80 text-gray-600 border-gray-300 opacity-0 group-hover:opacity-100'}
                    `}
                  >
                    {isSelected ? (
                      // Check icon
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414L8.5 11.086l6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      // Empty circle (no check)
                      <span className="block h-3.5 w-3.5 rounded-full border border-gray-400" />
                    )}
                  </button>

                <Thumbnail
                  photo={photo}
                  projectFolder={projectFolder}
                  className="w-full h-full group-hover:opacity-75 transition-all duration-300"
                  objectFit="cover"
                  rounded={false}
                />
                {isSelected && (
                  <div className="absolute inset-0 bg-blue-500 bg-opacity-25 pointer-events-none"></div>
                )}
                <div className="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity p-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPhotoSelect(photo);
                    }}
                    className="px-4 py-2 text-base font-semibold text-white bg-gray-900/90 rounded-md hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white"
                  >
                    View
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        ))
      )}
    </div>
  );
};

export default PhotoGridView;
