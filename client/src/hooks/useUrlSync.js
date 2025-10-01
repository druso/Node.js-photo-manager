import { useEffect } from 'react';

export const useUrlSync = ({
  view,
  selectedProject,
  activeFilters,
  viewerState
}) => {
  const isAllPhotosView = view?.project_filter === null;
  // Sync URL query with filters when in All mode (preserve current /all path and filename if any)
  useEffect(() => {
    if (!isAllPhotosView) return;
    try {
      const path = window.location?.pathname || '/';

      // Only normalize to /all when we're already on an /all route or at the root.
      if (!path.startsWith('/all') && path !== '/' && path !== '') {
        return;
      }

      const keepPath = path.startsWith('/all') ? path : '/all';
      const range = (activeFilters?.dateRange) || {};
      const qp = new URLSearchParams();
      if (range.start) qp.set('date_from', range.start);
      if (range.end) qp.set('date_to', range.end);
      if (activeFilters?.fileType && activeFilters.fileType !== 'any') qp.set('file_type', activeFilters.fileType);
      if (activeFilters?.keepType && activeFilters.keepType !== 'any') qp.set('keep_type', activeFilters.keepType);
      if (activeFilters?.orientation && activeFilters.orientation !== 'any') qp.set('orientation', activeFilters.orientation);
      // Add showdetail parameter if viewer is open and info panel is shown
      if (viewerState?.isOpen && viewerState?.showInfo) {
        qp.set('showdetail', '1');
      }
      const search = qp.toString();
      const target = `${keepPath}${search ? `?${search}` : ''}`;
      const current = `${path}${window.location?.search || ''}`;
      if (target !== current) {
        console.log('[useUrlSync] All Photos - Updating URL', { target, current, viewerState });
        window.history.replaceState({}, '', target);
      }
    } catch (err) {
      console.error('[useUrlSync] Error in All Photos sync:', err);
    }
  }, [isAllPhotosView, activeFilters?.dateRange?.start, activeFilters?.dateRange?.end, activeFilters?.fileType, activeFilters?.keepType, activeFilters?.orientation, viewerState?.isOpen, viewerState?.showInfo]);

  // Sync URL query with filters when in Project mode as well
  useEffect(() => {
    if (isAllPhotosView) return;
    try {
      const basePath = selectedProject?.folder ? `/${encodeURIComponent(selectedProject.folder)}` : (window.location?.pathname || '/');
      // Preserve filename segment if present
      const path = window.location?.pathname || basePath;
      const keepPath = path.startsWith('/') ? path : basePath;
      const range = (activeFilters?.dateRange) || {};
      const qp = new URLSearchParams();
      if (range.start) qp.set('date_from', range.start);
      if (range.end) qp.set('date_to', range.end);
      if (activeFilters?.fileType && activeFilters.fileType !== 'any') qp.set('file_type', activeFilters.fileType);
      if (activeFilters?.keepType && activeFilters.keepType !== 'any') qp.set('keep_type', activeFilters.keepType);
      if (activeFilters?.orientation && activeFilters.orientation !== 'any') qp.set('orientation', activeFilters.orientation);
      // Add showdetail parameter if viewer is open and info panel is shown
      if (viewerState?.isOpen && viewerState?.showInfo) {
        qp.set('showdetail', '1');
      }
      const search = qp.toString();
      const target = `${keepPath}${search ? `?${search}` : ''}`;
      const current = `${path}${window.location?.search || ''}`;
      if (target !== current) {
        console.log('[useUrlSync] Project - Updating URL', { target, current, viewerState });
        window.history.replaceState({}, '', target);
      }
    } catch (err) {
      console.error('[useUrlSync] Error in Project sync:', err);
    }
  }, [isAllPhotosView, selectedProject?.folder, activeFilters?.dateRange?.start, activeFilters?.dateRange?.end, activeFilters?.fileType, activeFilters?.keepType, activeFilters?.orientation, viewerState?.isOpen, viewerState?.showInfo]);
};
