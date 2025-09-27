import { useEffect } from 'react';

export const useUrlSync = ({
  isAllMode,
  selectedProject,
  activeFilters
}) => {
  // Sync URL query with filters when in All mode (preserve current /all path and filename if any)
  useEffect(() => {
    if (!isAllMode) return;
    try {
      const path = window.location?.pathname || '/all';
      const keepPath = path.startsWith('/all') ? path : '/all';
      const range = (activeFilters?.dateRange) || {};
      const qp = new URLSearchParams();
      if (range.start) qp.set('date_from', range.start);
      if (range.end) qp.set('date_to', range.end);
      if (activeFilters?.fileType && activeFilters.fileType !== 'any') qp.set('file_type', activeFilters.fileType);
      if (activeFilters?.keepType && activeFilters.keepType !== 'any') qp.set('keep_type', activeFilters.keepType);
      if (activeFilters?.orientation && activeFilters.orientation !== 'any') qp.set('orientation', activeFilters.orientation);
      const search = qp.toString();
      const target = `${keepPath}${search ? `?${search}` : ''}`;
      const current = `${path}${window.location?.search || ''}`;
      if (target !== current) {
        window.history.replaceState({}, '', target);
      }
    } catch {}
  }, [isAllMode, activeFilters?.dateRange?.start, activeFilters?.dateRange?.end, activeFilters?.fileType, activeFilters?.keepType, activeFilters?.orientation]);

  // Sync URL query with filters when in Project mode as well
  useEffect(() => {
    if (isAllMode) return;
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
      const search = qp.toString();
      const target = `${keepPath}${search ? `?${search}` : ''}`;
      const current = `${path}${window.location?.search || ''}`;
      if (target !== current) {
        window.history.replaceState({}, '', target);
      }
    } catch {}
  }, [isAllMode, selectedProject?.folder, activeFilters?.dateRange?.start, activeFilters?.dateRange?.end, activeFilters?.fileType, activeFilters?.keepType, activeFilters?.orientation]);
};
