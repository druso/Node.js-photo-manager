import { useEffect } from 'react';
import { locateProjectPhotosPage } from '../api/photosApi';

/**
 * Hook to handle photo viewer deep linking functionality
 * Extracts the complex deep linking logic from App.jsx
 */
export function usePhotoDeepLinking({
  pendingOpenRef,
  selectedProject,
  projectData,
  pagedPhotos,
  nextCursor,
  loadingMore,
  loadMore,
  viewerState,
  activeFilters,
  projectLocateTriedRef,
  setViewerList,
  setViewerState,
  setGridAnchorIndex,
  applyProjectPage,
}) {
  useEffect(() => {
    const pending = pendingOpenRef.current;
    if (!pending) return;
    if (!selectedProject || selectedProject.folder !== pending.folder) return;
    const targetNameRaw = String(pending.filename || '').trim();
    if (!targetNameRaw) return;
    const targetLower = targetNameRaw.toLowerCase();
    const isTarget = (p) => {
      if (!p) return false;
      const fn = (p.filename || '').toLowerCase();
      if (fn === targetLower) return true;
      const base = (p.basename ? String(p.basename) : String(p.filename || ''))
        .toLowerCase()
        .replace(/\.[^/.]+$/, '');
      return base === targetLower;
    };

    // Prefer efficient locate-page once per deep link
    if (!projectLocateTriedRef.current) {
      projectLocateTriedRef.current = true;
      (async () => {
        try {
          const range = activeFilters?.dateRange || {};
          const hasDot = /\.[A-Za-z0-9]+$/.test(String(targetNameRaw));
          const maybeName = (targetNameRaw || '').replace(/\.[^/.]+$/, '');
          const res = await locateProjectPhotosPage(selectedProject.folder, {
            filename: hasDot ? targetNameRaw : undefined,
            name: !hasDot ? maybeName : undefined,
            limit: 100,
            date_from: range.start || undefined,
            date_to: range.end || undefined,
            file_type: activeFilters?.fileType,
            keep_type: activeFilters?.keepType,
            orientation: activeFilters?.orientation,
          });
          const items = Array.isArray(res.items) ? res.items : [];
          applyProjectPage({
            items,
            nextCursor: res.next_cursor ?? null,
            prevCursor: res.prev_cursor ?? null,
            hasPrev: Boolean(res.prev_cursor),
            total: res.total,
            unfilteredTotal: res.unfiltered_total,
          });

          const startIndex = Number.isFinite(res.idx_in_items) && res.idx_in_items >= 0 ? res.idx_in_items : -1;
          if (startIndex >= 0 && items[startIndex]) {
            setViewerList(items.slice());
            setViewerState({ isOpen: true, startIndex });
            // Ask grid to center the located item row
            setGridAnchorIndex(startIndex);
            // Push canonical project deep-link URL with current filters
            try {
              const nameForUrl = (items[startIndex]?.basename) || (items[startIndex]?.filename || '').replace(/\.[^/.]+$/, '');
              if (selectedProject?.folder && nameForUrl) {
                // Canonical URL without filters (basename only)
                window.history.pushState({}, '', `/${encodeURIComponent(selectedProject.folder)}/${encodeURIComponent(nameForUrl)}`);
              }
            } catch {}
            pendingOpenRef.current = null;
            return; // handled via locate
          }
        } catch (e) {
          // locate failed; fall back to existing sequential logic
        }
      })();
    }

    const fullList = Array.isArray(projectData?.photos) ? projectData.photos : null;
    const idxFull = Array.isArray(fullList) ? fullList.findIndex(isTarget) : -1;
    const idxPaged = Array.isArray(pagedPhotos) ? pagedPhotos.findIndex(isTarget) : -1;

    // Open viewer once (prefer full list for complete navigation)
    if (!viewerState?.isOpen && idxFull >= 0) {
      setViewerList(fullList);
      setViewerState({ isOpen: true, startIndex: idxFull });
      setGridAnchorIndex(idxFull);
      // Session viewer state removed - URL is source of truth
      try {
        const nameForUrl = (fullList[idxFull]?.basename) || (fullList[idxFull]?.filename || '').replace(/\.[^/.]+$/, '');
        if (selectedProject?.folder && nameForUrl) {
          // Canonical URL without filters
          window.history.pushState({}, '', `/${encodeURIComponent(selectedProject.folder)}/${encodeURIComponent(nameForUrl)}`);
        }
      } catch {}
    }

    // Ensure grid pagination loads until the target photo is present
    if (idxPaged < 0) {
      if (nextCursor && !loadingMore) {
        loadMore();
      }
      return; // keep pending until item appears or no more pages
    }
    // Target now present in paged grid; we can clear pending
    pendingOpenRef.current = null;
  }, [selectedProject, projectData, pagedPhotos, nextCursor, loadingMore, loadMore, viewerState, activeFilters?.dateRange, activeFilters?.fileType, activeFilters?.keepType, activeFilters?.orientation, pendingOpenRef, projectLocateTriedRef, setViewerList, setViewerState, setGridAnchorIndex, applyProjectPage]);
}
