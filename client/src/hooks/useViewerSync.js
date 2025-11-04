import { useCallback, useEffect, useMemo } from 'react';

const buildQueryString = (activeFilters) => {
  const range = activeFilters?.dateRange || {};
  const qp = new URLSearchParams();
  if (range.start) qp.set('date_from', range.start);
  if (range.end) qp.set('date_to', range.end);
  if (activeFilters?.fileType && activeFilters.fileType !== 'any') qp.set('file_type', activeFilters.fileType);
  if (activeFilters?.keepType && activeFilters.keepType !== 'any') qp.set('keep_type', activeFilters.keepType);
  if (activeFilters?.orientation && activeFilters.orientation !== 'any') qp.set('orientation', activeFilters.orientation);
  const search = qp.toString();
  return search ? `?${search}` : '';
};

const safePushState = (path) => {
  try {
    window.history.pushState({}, '', path);
  } catch {}
};

export default function useViewerSync({
  isAllMode,
  viewerState,
  setViewerState,
  viewerList,
  setViewerList,
  allPhotos,
  filteredProjectData,
  projectData,
  selectedProject,
  activeFilters,
  allDeepLinkRef,
  suppressUrlRef,
}) {
  const viewerPhotos = useMemo(() => {
    let photos;
    if (isAllMode || viewerState.fromAll) {
      photos = (viewerList && viewerState.isOpen ? viewerList : allPhotos) || [];
    } else {
      const pd = viewerList ? { photos: viewerList } : (filteredProjectData || projectData);
      photos = (pd && Array.isArray(pd.photos)) ? pd.photos : [];
    }
    
    // Apply preview-mode filtering if keepType is any_kept
    if (activeFilters?.keepType === 'any_kept' && Array.isArray(photos)) {
      return photos.filter(p => p && (p.keep_jpg === true || p.keep_raw === true));
    }
    
    return photos;
  }, [isAllMode, viewerState.fromAll, viewerList, viewerState.isOpen, allPhotos, filteredProjectData, projectData, activeFilters?.keepType]);

  const viewerKey = useMemo(() => {
    const source = (isAllMode || viewerState.fromAll) ? 'all' : (selectedProject?.folder || 'none');
    const start = Number.isFinite(viewerState.startIndex) ? viewerState.startIndex : -1;
    const idPart = (() => {
      try {
        const p = viewerPhotos[start];
        return p ? `${p.project_folder || source}:${p.filename}` : `idx:${start}`;
      } catch {
        return `idx:${start}`;
      }
    })();
    return `${source}:${idPart}`;
  }, [isAllMode, viewerState.fromAll, selectedProject?.folder, viewerPhotos, viewerState.startIndex]);

  useEffect(() => {
    if (!viewerState?.isOpen) return;
    const fromAll = !!(isAllMode || viewerState.fromAll);
    const start = Number.isFinite(viewerState.startIndex) ? viewerState.startIndex : -1;
    const len = Array.isArray(viewerPhotos) ? viewerPhotos.length : -1;
    const cur = (start >= 0 && start < len) ? viewerPhotos[start] : null;
    // eslint-disable-next-line no-console
    console.debug('[Viewer] open', {
      fromAll,
      start,
      photosLen: len,
      startValid: start >= 0 && start < len,
      current: cur ? { filename: cur.filename, project_folder: cur.project_folder } : null,
    });
  }, [viewerState?.isOpen, viewerState?.startIndex, isAllMode, viewerState?.fromAll, viewerPhotos]);

  const handleCloseViewer = useCallback(() => {
    const wasAll = !!(isAllMode || viewerState.fromAll);
    setViewerState(prev => ({ ...(prev || {}), isOpen: false, showInfo: false }));
    const query = buildQueryString(activeFilters);
    const targetUrl = wasAll 
      ? `/all${query}`
      : selectedProject?.folder 
        ? `/${encodeURIComponent(selectedProject.folder)}${query}`
        : '/';
    
    console.log('[handleCloseViewer] Closing viewer, updating URL to:', targetUrl);
    safePushState(targetUrl);
    setViewerList(null);
  }, [isAllMode, viewerState.fromAll, setViewerState, activeFilters, selectedProject?.folder, setViewerList]);

  const handleViewerIndexChange = useCallback((idx, photo) => {
    try {
      if (viewerState?.isOpen && photo?.filename) {
        if ((isAllMode || viewerState.fromAll) && allDeepLinkRef?.current) {
          return;
        }
        if (suppressUrlRef?.current) {
          try { console.debug('[deep-link] URL update blocked during resolution'); } catch {}
          return;
        }
        const query = buildQueryString(activeFilters);
        const nameForUrl = photo.basename || (photo.filename || '').replace(/\.[^/.]+$/, '');
        if (isAllMode || viewerState.fromAll) {
          const pf = photo.project_folder || (selectedProject?.folder || '');
          if (pf && nameForUrl) {
            safePushState(`/all/${encodeURIComponent(pf)}/${encodeURIComponent(nameForUrl)}${query}`);
          }
        } else if (selectedProject?.folder && nameForUrl) {
          safePushState(`/${encodeURIComponent(selectedProject.folder)}/${encodeURIComponent(nameForUrl)}${query}`);
        }
      }
    } catch {}
  }, [viewerState, isAllMode, activeFilters, allDeepLinkRef, suppressUrlRef, selectedProject?.folder]);

  return {
    viewerPhotos,
    viewerKey,
    handleCloseViewer,
    handleViewerIndexChange,
  };
}
