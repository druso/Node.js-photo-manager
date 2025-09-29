import { useEffect } from 'react';
import { locateProjectPhotosPage } from '../api/photosApi';
import { locateAllPhotosPage } from '../api/allPhotosApi';

/**
 * Hook to handle photo viewer deep linking functionality
 * Extracts the complex deep linking logic from App.jsx
 * 
 * This hook now handles both Project and All Photos modes with a unified approach
 */
export function usePhotoDeepLinking({
  // Common parameters
  pendingOpenRef,
  viewerState,
  activeFilters,
  projectLocateTriedRef,
  setViewerList,
  setViewerState,
  
  // Project mode parameters
  selectedProject,
  projectData,
  pagedPhotos,
  nextCursor,
  loadingMore,
  loadMore,
  setGridAnchorIndex,
  applyProjectPage,
  
  // All Photos mode parameters
  isAllMode,
  allPhotos,
  allDeepLinkRef,
  allNextCursor,
  allLoadingMore,
  loadAllMore,
  setAllGridAnchorIndex
}) {
  // Project mode deep linking
  useEffect(() => {
    // Skip if in All Photos mode or no pending deep link
    if (isAllMode || !pendingOpenRef.current) return;
    
    const pending = pendingOpenRef.current;
    if (!pending) return;
    if (!selectedProject || selectedProject.folder !== pending.folder) return;
    
    const targetNameRaw = String(pending.filename || '').trim();
    if (!targetNameRaw) return;
    
    const targetLower = targetNameRaw.toLowerCase();
    console.debug('[deep-link] project mode pending', pending);
    
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
          const locateIndex = items.findIndex(isTarget);
          applyProjectPage({
            items,
            nextCursor: res.next_cursor ?? null,
            prevCursor: res.prev_cursor ?? null,
            hasPrev: Boolean(res.prev_cursor),
            total: res.total,
            unfilteredTotal: res.unfiltered_total,
          });

          if (locateIndex >= 0 && items[locateIndex]) {
            console.debug('[deep-link] project locate-page hit', locateIndex, items[locateIndex]);
            setViewerList(items.slice());
            setViewerState({ isOpen: true, startIndex: locateIndex });
            // Ask grid to center the located item row
            setGridAnchorIndex(locateIndex);
            pendingOpenRef.current = null;
            return; // handled via locate
          }
          console.debug('[deep-link] project locate-page miss, falling back to pagination');
        } catch {}
      })();
    }

    const fullList = Array.isArray(projectData?.photos) ? projectData.photos : null;
    const idxFull = Array.isArray(fullList) ? fullList.findIndex(isTarget) : -1;
    const idxPaged = Array.isArray(pagedPhotos) ? pagedPhotos.findIndex(isTarget) : -1;

    // Open viewer once (prefer full list for complete navigation)
    if (!viewerState?.isOpen && idxFull >= 0) {
      console.debug('[deep-link] project full list hit', idxFull, fullList[idxFull]);
      setViewerList(fullList);
      setViewerState({ isOpen: true, startIndex: idxFull });
      setGridAnchorIndex(idxFull);
    }

    // Ensure grid pagination loads until the target photo is present
    if (idxPaged < 0) {
      if (nextCursor && !loadingMore) {
        loadMore();
      }
      return; // keep pending until item appears or no more pages
    }
    console.debug('[deep-link] project paged list hit', idxPaged, pagedPhotos[idxPaged]);
    // Target now present in paged grid; we can clear pending
    pendingOpenRef.current = null;
  }, [
    isAllMode, selectedProject, projectData, pagedPhotos, nextCursor, 
    loadingMore, loadMore, viewerState, activeFilters?.dateRange, 
    activeFilters?.fileType, activeFilters?.keepType, activeFilters?.orientation, 
    pendingOpenRef, projectLocateTriedRef, setViewerList, setViewerState, 
    setGridAnchorIndex, applyProjectPage
  ]);
  
  // All Photos mode deep linking
  useEffect(() => {
    // Skip if in Project mode or no pending deep link
    if (!isAllMode || !allDeepLinkRef?.current) return;
    
    const target = allDeepLinkRef.current;
    console.debug('[deep-link] all mode pending', target);
    
    if (!allPhotos.length) return;

    const targetLower = String(target.filename || '').trim().toLowerCase();
    const isTarget = (p) => {
      if (!p || p.project_folder !== target.folder) return false;
      const fn = (p.filename || '').toLowerCase();
      if (fn === targetLower) return true;
      const base = (p.basename ? String(p.basename) : String(p.filename || ''))
        .toLowerCase()
        .replace(/\.[^/.]+$/, '');
      return base === targetLower;
    };

    const idx = allPhotos.findIndex(isTarget);
    if (idx >= 0) {
      console.debug('[deep-link] all photos list hit', idx, allPhotos[idx]);
      setViewerList(allPhotos.slice());
      setViewerState({ isOpen: true, startIndex: idx, fromAll: true });
      setAllGridAnchorIndex(idx);
      allDeepLinkRef.current = null;
      return;
    }

    // Try to locate the photo using the API
    if (!projectLocateTriedRef.current) {
      projectLocateTriedRef.current = true;
      (async () => {
        try {
          const filters = {
            date_from: activeFilters?.dateRange?.start,
            date_to: activeFilters?.dateRange?.end,
            file_type: activeFilters?.fileType !== 'any' ? activeFilters?.fileType : undefined,
            keep_type: activeFilters?.keepType !== 'any' ? activeFilters?.keepType : undefined,
            orientation: activeFilters?.orientation !== 'any' ? activeFilters?.orientation : undefined,
          };
          
          const hasDot = /\.[A-Za-z0-9]+$/.test(String(target.filename || ''));
          const maybeName = (target.filename || '').replace(/\.[^/.]+$/, '');
          
          console.debug('[deep-link] trying to locate all photos page', {
            project_folder: target.folder,
            filename: hasDot ? target.filename : undefined,
            name: !hasDot ? maybeName : undefined
          });
          
          const res = await locateAllPhotosPage({
            project_folder: target.folder,
            filename: hasDot ? target.filename : undefined,
            name: !hasDot ? maybeName : undefined,
            limit: 100,
            ...filters
          });
          
          const items = Array.isArray(res.items) ? res.items : [];
          const locateIndex = items.findIndex(isTarget);
          
          if (locateIndex >= 0 && items[locateIndex]) {
            console.debug('[deep-link] all photos locate-page hit', locateIndex, items[locateIndex]);
            setViewerList(items.slice());
            setViewerState({ isOpen: true, startIndex: locateIndex, fromAll: true });
            setAllGridAnchorIndex(locateIndex);
            allDeepLinkRef.current = null;
            return;
          }
          console.debug('[deep-link] all photos locate-page miss, falling back to pagination');
        } catch (err) {
          console.error('[deep-link] all photos locate error', err);
        }
      })();
      return;
    }

    // Continue loading more pages if needed
    if (allNextCursor && !allLoadingMore) {
      console.debug('[deep-link] all photos loading more to find target');
      loadAllMore();
    }
  }, [
    isAllMode, allPhotos, allDeepLinkRef, allNextCursor, allLoadingMore,
    loadAllMore, activeFilters, projectLocateTriedRef, setViewerList,
    setViewerState, setAllGridAnchorIndex
  ]);
}
