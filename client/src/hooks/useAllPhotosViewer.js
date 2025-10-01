import { useCallback } from 'react';

export default function useAllPhotosViewer({
  allPhotos,
  activeFilters,
  setViewerList,
  setViewerState,
  projects,
  handleProjectSelect,
  pendingOpenRef,
}) {
  const buildSearchParams = useCallback(() => {
    const range = activeFilters?.dateRange || {};
    const qp = new URLSearchParams();
    if (range.start) qp.set('date_from', range.start);
    if (range.end) qp.set('date_to', range.end);
    if (activeFilters?.fileType && activeFilters.fileType !== 'any') qp.set('file_type', activeFilters.fileType);
    if (activeFilters?.keepType && activeFilters.keepType !== 'any') qp.set('keep_type', activeFilters.keepType);
    if (activeFilters?.orientation && activeFilters.orientation !== 'any') qp.set('orientation', activeFilters.orientation);
    const search = qp.toString();
    return search ? `?${search}` : '';
  }, [activeFilters]);

  const handleAllPhotoSelect = useCallback((photo, photosList) => {
    if (!photo) return;
    
    // Use photosList if provided, otherwise fall back to allPhotos
    const list = photosList || allPhotos;
    const idx = list.findIndex(p => p.project_folder === photo.project_folder && p.filename === photo.filename);
    const start = idx >= 0 ? idx : 0;
    
    setViewerList(list.slice());
    setViewerState({ isOpen: true, startIndex: start, fromAll: true });
    
    try {
      const search = buildSearchParams();
      const nameForUrl = photo.basename || (photo.filename || '').replace(/\.[^/.]+$/, '');
      window.history.pushState({}, '', `/all/${encodeURIComponent(photo.project_folder)}/${encodeURIComponent(nameForUrl)}${search}`);
    } catch (err) {
      console.error('[useAllPhotosViewer] Error updating URL:', err);
    }
  }, [allPhotos, buildSearchParams, setViewerList, setViewerState]);

  return { handleAllPhotoSelect };
}
