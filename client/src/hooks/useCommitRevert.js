import { useState, useRef, useCallback } from 'react';

export const useCommitRevert = ({
  isAllMode,
  selectedProject,
  activeFilters,
  setProjectData,
  mutatePagedPhotos,
  mutateAllPhotos,
  refreshAllPhotos,
  fetchProjectData,
  toast
}) => {
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [reverting, setReverting] = useState(false);
  
  const commitOpenerElRef = useRef(null);
  const revertOpenerElRef = useRef(null);

  const handleCommitChanges = useCallback(() => {
    if (!isAllMode && !selectedProject) return;
    try { commitOpenerElRef.current = document.activeElement; } catch {}
    setShowCommitModal(true);
  }, [isAllMode, selectedProject]);

  const openRevertConfirm = useCallback(() => {
    if (!selectedProject) return;
    try { revertOpenerElRef.current = document.activeElement; } catch {}
    setShowRevertModal(true);
  }, [selectedProject]);

  const confirmCommitChanges = useCallback(async (pendingDeleteTotals) => {
    if (!selectedProject) return;
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

      await toast.promise(
        (async () => {
          const targetProjects = Array.from(pendingDeleteTotals.byProject || []);
          const endpoint = isAllMode ? '/api/photos/commit-changes' : `/api/projects/${encodeURIComponent(selectedProject.folder)}/commit-changes`;
          const body = (isAllMode && targetProjects.length) ? { projects: targetProjects } : undefined;
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (isAllMode) {
            const data = await res.json().catch(() => ({}));
            const queued = Array.isArray(data.projects) ? data.projects.length : 0;
            if (!queued) {
              await refreshAllPhotos();
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
      if (selectedProject && !isAllMode) {
        try { await fetchProjectData(selectedProject.folder); } catch {}
      } else {
        await refreshAllPhotos();
      }
    } finally {
      setCommitting(false);
    }
  }, [selectedProject, isAllMode, setProjectData, mutatePagedPhotos, mutateAllPhotos, toast, refreshAllPhotos, fetchProjectData]);

  const confirmRevertChanges = useCallback(async (pendingDeleteTotals) => {
    if (!selectedProject) return;
    setReverting(true);
    
    try {
      await toast.promise(
        (async () => {
          const targetProjects = Array.from(pendingDeleteTotals.byProject || []);
          const endpoint = isAllMode ? '/api/photos/revert-changes' : `/api/projects/${encodeURIComponent(selectedProject.folder)}/revert-changes`;
          const body = (isAllMode && targetProjects.length) ? { projects: targetProjects } : undefined;
          const res = await fetch(endpoint, {
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
          if (isAllMode) {
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
      if (isAllMode) {
        await refreshAllPhotos();
      }
    } finally {
      setReverting(false);
    }
  }, [selectedProject, isAllMode, setProjectData, mutatePagedPhotos, mutateAllPhotos, toast, refreshAllPhotos]);

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
