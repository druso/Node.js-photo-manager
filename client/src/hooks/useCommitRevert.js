import { useState, useRef, useCallback } from 'react';
import { authFetch } from '../api/httpClient';

/**
 * Hook to handle commit and revert operations for both All Photos and Project views
 * 
 * ARCHITECTURAL DECISION: Unified View Context
 * There is NO conceptual distinction between "All Photos" and "Project" views.
 * A Project view is simply the All Photos view with a project filter applied.
 * 
 * This hook uses view.project_filter to determine the current view context
 * while maintaining backward compatibility with isAllMode during transition.
 */
export const useCommitRevert = ({
  // Unified view context
  view,
  
  // Data refresh functions
  refreshPhotoData,
  
  // Legacy properties (for backward compatibility)
  isAllMode,
  selectedProject,
  activeFilters,
  setProjectData,
  mutatePagedPhotos,
  mutateAllPhotos,
  refreshAllPhotos,
  fetchProjectData,
  toast,
  setAllPendingDeletes
}) => {
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [reverting, setReverting] = useState(false);
  
  const commitOpenerElRef = useRef(null);
  const revertOpenerElRef = useRef(null);

  const handleCommitChanges = useCallback(() => {
    // Use unified view context to determine if we're in All Photos view
    const isAllPhotosView = view?.project_filter === null;
    
    // For backward compatibility, fall back to isAllMode if view context is not available
    const inAllPhotosMode = (view !== undefined) ? isAllPhotosView : isAllMode;
    
    if (!inAllPhotosMode && !selectedProject) return;
    try { commitOpenerElRef.current = document.activeElement; } catch {}
    setShowCommitModal(true);
  }, [view?.project_filter, isAllMode, selectedProject]);

  const openRevertConfirm = useCallback(() => {
    // Use unified view context to determine if we're in All Photos view
    const isAllPhotosView = view?.project_filter === null;
    
    // For backward compatibility, fall back to isAllMode if view context is not available
    const inAllPhotosMode = (view !== undefined) ? isAllPhotosView : isAllMode;
    
    // Allow revert in All Photos mode or when a project is selected
    if (!inAllPhotosMode && !selectedProject) return;
    try { revertOpenerElRef.current = document.activeElement; } catch {}
    setShowRevertModal(true);
  }, [view?.project_filter, isAllMode, selectedProject]);

  const confirmCommitChanges = useCallback(async (pendingDeleteTotals) => {
    // Use unified view context to determine if we're in All Photos view
    const isAllPhotosView = view?.project_filter === null;
    
    // For backward compatibility, fall back to isAllMode if view context is not available
    const inAllPhotosMode = (view !== undefined) ? isAllPhotosView : isAllMode;
    
    // Allow commit in All Photos mode or when a project is selected
    if (!inAllPhotosMode && !selectedProject) return;
    setCommitting(true);
    
    try {
      // Optimistic hide: mark pending deletions as missing immediately to avoid 404s
      const applyOptimisticCommit = (list) => {
        const base = Array.isArray(list) ? list : [];
        const result = [];
        for (const p of base) {
          const willRemoveJpg = !!p.jpg_available && p.keep_jpg === false;
          const willRemoveRaw = !!p.raw_available && p.keep_raw === false;
          if (!willRemoveJpg && !willRemoveRaw) {
            result.push(p);
            continue;
          }
          const next = { ...p };
          if (willRemoveJpg) {
            next.jpg_available = false;
            next.thumbnail_status = 'missing';
            next.preview_status = 'missing';
          }
          if (willRemoveRaw) {
            next.raw_available = false;
          }
          if (!next.jpg_available && !next.raw_available) {
            continue;
          }
          result.push(next);
        }
        return result;
      };

      setProjectData(prev => {
        if (!prev || !Array.isArray(prev.photos)) return prev;
        const photos = applyOptimisticCommit(prev.photos);
        return { ...prev, photos };
      });
      mutatePagedPhotos(prev => applyOptimisticCommit(prev));
      mutateAllPhotos(prev => applyOptimisticCommit(prev));

      // Use unified view context to determine if we're in All Photos view
      const isAllPhotosView = view?.project_filter === null;
      
      // For backward compatibility, fall back to isAllMode if view context is not available
      const inAllPhotosMode = (view !== undefined) ? isAllPhotosView : isAllMode;

      await toast.promise(
        (async () => {
          const targetProjects = Array.from(pendingDeleteTotals.byProject || []);
          const endpoint = inAllPhotosMode ? '/api/photos/commit-changes' : `/api/projects/${encodeURIComponent(selectedProject.folder)}/commit-changes`;
          const body = (inAllPhotosMode && targetProjects.length) ? { projects: targetProjects } : undefined;
          const res = await authFetch(endpoint, {
            method: 'POST',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          
          if (inAllPhotosMode) {
            const data = await res.json().catch(() => ({}));
            const queued = Array.isArray(data?.projects) ? data.projects.length : 0;
            const started = data && data.started === true;

            if (started && setAllPendingDeletes) {
              setAllPendingDeletes({ total: 0, jpg: 0, raw: 0, byProject: new Set() });
            }

            if (!queued && !started) {
              if (refreshPhotoData) {
                await refreshPhotoData();
              } else {
                await refreshAllPhotos();
              }
            }
          }
        })(),
        {
          pending: { emoji: '🗑️', message: 'Committing…', variant: 'info' },
          success: { emoji: '✅', message: 'Committed pending deletions', variant: 'success' },
          error:   { emoji: '⚠️', message: 'Commit failed', variant: 'error' }
        }
      );
      setShowCommitModal(false);
    } catch (e) {
      // Commit changes failed - revert optimistic changes by refetching on failure
      // Use unified refresh function if available
      if (refreshPhotoData) {
        await refreshPhotoData();
      } else {
        // Fall back to legacy refresh functions
        const isAllPhotosView = view?.project_filter === null;
        const inAllPhotosMode = (view !== undefined) ? isAllPhotosView : isAllMode;
        
        if (selectedProject && !inAllPhotosMode) {
          try { await fetchProjectData(selectedProject.folder); } catch {}
        } else {
          await refreshAllPhotos();
        }
      }
    } finally {
      setCommitting(false);
    }
  }, [view?.project_filter, selectedProject, isAllMode, setProjectData, mutatePagedPhotos, mutateAllPhotos, toast, refreshPhotoData, refreshAllPhotos, fetchProjectData]);

  const confirmRevertChanges = useCallback(async (pendingDeleteTotals) => {
    // Use unified view context to determine if we're in All Photos view
    const isAllPhotosView = view?.project_filter === null;
    
    // For backward compatibility, fall back to isAllMode if view context is not available
    const inAllPhotosMode = (view !== undefined) ? isAllPhotosView : isAllMode;
    
    // Allow revert in All Photos mode or when a project is selected
    if (!inAllPhotosMode && !selectedProject) return;
    setReverting(true);
    
    try {
      // Use unified view context to determine if we're in All Photos view
      const isAllPhotosView = view?.project_filter === null;
      
      // For backward compatibility, fall back to isAllMode if view context is not available
      const inAllPhotosMode = (view !== undefined) ? isAllPhotosView : isAllMode;
      
      await toast.promise(
        (async () => {
          const targetProjects = Array.from(pendingDeleteTotals.byProject || []);
          const endpoint = inAllPhotosMode ? '/api/photos/revert-changes' : `/api/projects/${encodeURIComponent(selectedProject.folder)}/revert-changes`;
          const body = (inAllPhotosMode && targetProjects.length) ? { projects: targetProjects } : undefined;
          const res = await authFetch(endpoint, {
            method: 'POST',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          
          // Optimistically reflect revert: keep flags back to availability
          setProjectData(prev => {
            if (!prev || !Array.isArray(prev.photos)) return prev;
            const photos = prev.photos.map(p => ({
              ...p,
              keep_jpg: !!p.jpg_available,
              keep_raw: !!p.raw_available,
            }));
            return { ...prev, photos };
          });
          mutatePagedPhotos(prev => {
            if (!Array.isArray(prev)) return prev;
            return prev.map(p => ({
              ...p,
              keep_jpg: !!p.jpg_available,
              keep_raw: !!p.raw_available,
            }));
          });
          mutateAllPhotos(prev => {
            if (!Array.isArray(prev)) return prev;
            return prev.map(p => ({
              ...p,
              keep_jpg: !!p.jpg_available,
              keep_raw: !!p.raw_available,
            }));
          });
          
          // Force-reset pending deletes to zero to hide commit bar immediately
          if (setAllPendingDeletes) {
            setAllPendingDeletes({ total: 0, jpg: 0, raw: 0, byProject: new Set() });
          }
          
          setProjectData(prev => {
            if (!prev) return prev;
            return { ...prev, pending_deletes: {} };
          });
          
          // Use unified refresh function if available
          if (refreshPhotoData) {
            await refreshPhotoData();
          } else if (inAllPhotosMode) {
            await refreshAllPhotos();
          }
        })(),
        {
          pending: { emoji: '↩️', message: 'Reverting…', variant: 'info' },
          success: { emoji: '✅', message: 'Reverted keep flags to availability', variant: 'success' },
          error:   { emoji: '⚠️', message: 'Revert failed', variant: 'error' }
        }
      );
      setShowRevertModal(false);
    } catch (e) {
      // Use unified refresh function if available
      if (refreshPhotoData) {
        await refreshPhotoData();
      } else {
        const isAllPhotosView = view?.project_filter === null;
        const inAllPhotosMode = (view !== undefined) ? isAllPhotosView : isAllMode;
        
        if (inAllPhotosMode) {
          await refreshAllPhotos();
        }
      }
    } finally {
      setReverting(false);
    }
  }, [view?.project_filter, selectedProject, isAllMode, setProjectData, mutatePagedPhotos, mutateAllPhotos, toast, refreshPhotoData, refreshAllPhotos, setAllPendingDeletes]);

  return {
    // Modal state
    showCommitModal,
    setShowCommitModal,
    committing,
    showRevertModal,
    setShowRevertModal,
    reverting,
    
    // Handlers
    handleCommitChanges,
    openRevertConfirm,
    confirmCommitChanges,
    confirmRevertChanges,
    
    // Refs for focus restoration
    commitOpenerElRef,
    revertOpenerElRef
  };
};
