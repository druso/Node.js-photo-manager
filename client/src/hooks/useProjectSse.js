import { useEffect, useRef } from 'react';
import { listJobs } from '../api/jobsApi';
import sseClient from '../api/sseClient';
import { stripKnownExt } from './useAllPhotosPagination';

export default function useProjectSse({
  selectedProject,
  projectData,
  pagedPhotos,
  setProjectData,
  mutatePagedPhotos,
  fetchProjectData,
  toast,
  taskDefs,
  notifiedTasksRef,
  committing,
}) {
  const sseReadyRef = useRef(false);
  const fetchProjectDataRef = useRef(fetchProjectData);
  const projectDataRef = useRef(projectData);
  const pagedPhotosRef = useRef(pagedPhotos);

  useEffect(() => {
    fetchProjectDataRef.current = fetchProjectData;
  }, [fetchProjectData]);

  useEffect(() => {
    projectDataRef.current = projectData;
  }, [projectData]);

  useEffect(() => {
    pagedPhotosRef.current = pagedPhotos;
  }, [pagedPhotos]);

  useEffect(() => {
    if (!selectedProject?.folder) return;
    if (selectedProject.folder === '__all__') return;

    // Connect to jobs channel via unified SSE client
    sseClient.connect(['jobs']);

    const handleJobUpdate = (evt) => {
      sseReadyRef.current = true;

      // 0) Manifest changes: prefer incremental updates, no hard refetch
      if (evt && evt.type === 'manifest_changed' && evt.project_folder === selectedProject.folder) {
        if (Array.isArray(evt.removed_filenames) && evt.removed_filenames.length) {
          const toRemove = new Set(evt.removed_filenames);
          setProjectData(prev => {
            if (!prev || !Array.isArray(prev.photos)) return prev;
            const photos = prev.photos.filter(p => !toRemove.has(p.filename));
            return { ...prev, photos };
          });
          mutatePagedPhotos(prev => {
            if (!Array.isArray(prev)) return prev;
            return prev.filter(p => !toRemove.has(p.filename));
          });
        }
        return;
      }

      // 1) Item-level updates without full refetch
      if (evt && evt.type === 'item' && evt.project_folder === selectedProject.folder) {
        const targetId = typeof evt.photo_id === 'number' ? evt.photo_id : Number.isFinite(Number(evt.photo_id)) ? Number(evt.photo_id) : null;
        const targetFilename = String(evt.filename || '');
        const targetBase = stripKnownExt(targetFilename);

        setProjectData(prev => {
          if (!prev || !Array.isArray(prev.photos)) return prev;
          const idx = prev.photos.findIndex(p => {
            if (!p) return false;
            if (targetId != null && Number.isFinite(Number(p.id)) && Number(p.id) === targetId) return true;
            const existingFile = String(p.filename || '');
            if (existingFile === targetFilename) return true;
            return stripKnownExt(existingFile) === targetBase;
          });
          if (idx === -1) return prev;
          const updated = { ...prev.photos[idx] };
          if (evt.thumbnail_status) updated.thumbnail_status = evt.thumbnail_status;
          if (evt.preview_status) updated.preview_status = evt.preview_status;
          if (typeof evt.keep_jpg === 'boolean') updated.keep_jpg = evt.keep_jpg;
          if (typeof evt.keep_raw === 'boolean') updated.keep_raw = evt.keep_raw;
          if (evt.updated_at) updated.updated_at = evt.updated_at;
          if (targetId != null) updated.id = targetId;
          const photos = prev.photos.slice();
          photos[idx] = updated;
          return { ...prev, photos };
        });
        mutatePagedPhotos(prev => {
          if (!Array.isArray(prev)) return prev;
          const idx = prev.findIndex(p => {
            if (!p) return false;
            if (targetId != null && Number.isFinite(Number(p.id)) && Number(p.id) === targetId) return true;
            const existingFile = String(p.filename || '');
            if (existingFile === targetFilename) return true;
            return stripKnownExt(existingFile) === targetBase;
          });
          if (idx === -1) return prev;
          const updated = { ...prev[idx] };
          if (evt.thumbnail_status) updated.thumbnail_status = evt.thumbnail_status;
          if (evt.preview_status) updated.preview_status = evt.preview_status;
          if (typeof evt.keep_jpg === 'boolean') updated.keep_jpg = evt.keep_jpg;
          if (typeof evt.keep_raw === 'boolean') updated.keep_raw = evt.keep_raw;
          if (evt.updated_at) updated.updated_at = evt.updated_at;
          if (targetId != null) updated.id = targetId;
          const next = prev.slice();
          next[idx] = updated;
          return next;
        });
        return;
      }

      // 1b) Item removed: drop from list in-place (tolerant to extension differences)
      if (evt && evt.type === 'item_removed' && evt.project_folder === selectedProject.folder) {
        const targetId = typeof evt.photo_id === 'number' ? evt.photo_id : Number.isFinite(Number(evt.photo_id)) ? Number(evt.photo_id) : null;
        const fname = String(evt.filename || '');
        const base = stripKnownExt(fname);
        setProjectData(prev => {
          if (!prev || !Array.isArray(prev.photos)) return prev;
          const photos = prev.photos.filter(p => {
            if (!p) return false;
            if (targetId != null && Number.isFinite(Number(p.id)) && Number(p.id) === targetId) return false;
            const existingFile = String(p.filename || '');
            if (existingFile === fname) return false;
            return stripKnownExt(existingFile) !== base;
          });
          return { ...prev, photos };
        });
        mutatePagedPhotos(prev => {
          if (!Array.isArray(prev)) return prev;
          return prev.filter(p => {
            if (!p) return false;
            if (targetId != null && Number.isFinite(Number(p.id)) && Number(p.id) === targetId) return false;
            const existingFile = String(p.filename || '');
            if (existingFile === fname) return false;
            return stripKnownExt(existingFile) !== base;
          });
        });
        return;
      }

      // 1c) Item moved into this project: update if exists (tolerant match), else soft refetch
      if (evt && evt.type === 'item_moved' && evt.project_folder === selectedProject.folder) {
        const targetId = typeof evt.photo_id === 'number' ? evt.photo_id : Number.isFinite(Number(evt.photo_id)) ? Number(evt.photo_id) : null;
        const fname = String(evt.filename || '');
        const base = stripKnownExt(fname);
        const currentProjectData = projectDataRef.current;
        const currentPagedPhotos = pagedPhotosRef.current;
        const existsInProjectData = Array.isArray(currentProjectData?.photos)
          ? currentProjectData.photos.findIndex(p => {
              if (!p) return false;
              if (targetId != null && Number.isFinite(Number(p.id)) && Number(p.id) === targetId) return true;
              const existingFile = String(p.filename || '');
              if (existingFile === fname) return true;
              return stripKnownExt(existingFile) === base;
            }) !== -1
          : false;
        const existsInPaged = Array.isArray(currentPagedPhotos)
          ? currentPagedPhotos.findIndex(p => {
              if (!p) return false;
              if (targetId != null && Number.isFinite(Number(p.id)) && Number(p.id) === targetId) return true;
              const existingFile = String(p.filename || '');
              if (existingFile === fname) return true;
              return stripKnownExt(existingFile) === base;
            }) !== -1
          : false;

        setProjectData(prev => {
          if (!prev || !Array.isArray(prev.photos)) return prev;
          const idx = prev.photos.findIndex(p => {
            if (!p) return false;
            if (targetId != null && Number.isFinite(Number(p.id)) && Number(p.id) === targetId) return true;
            const existingFile = String(p.filename || '');
            if (existingFile === fname) return true;
            return stripKnownExt(existingFile) === base;
          });
          if (idx === -1) return prev;
          const updated = { ...prev.photos[idx] };
          if (evt.thumbnail_status) updated.thumbnail_status = evt.thumbnail_status;
          if (evt.preview_status) updated.preview_status = evt.preview_status;
          if (typeof evt.keep_jpg === 'boolean') updated.keep_jpg = evt.keep_jpg;
          if (typeof evt.keep_raw === 'boolean') updated.keep_raw = evt.keep_raw;
          if (evt.updated_at) updated.updated_at = evt.updated_at;
          if (targetId != null) updated.id = targetId;
          const photos = prev.photos.slice();
          photos[idx] = updated;
          return { ...prev, photos };
        });
        mutatePagedPhotos(prev => {
          if (!Array.isArray(prev)) return prev;
          const idx = prev.findIndex(p => {
            if (!p) return false;
            if (targetId != null && Number.isFinite(Number(p.id)) && Number(p.id) === targetId) return true;
            const existingFile = String(p.filename || '');
            if (existingFile === fname) return true;
            return stripKnownExt(existingFile) === base;
          });
          if (idx === -1) return prev;
          const updated = { ...prev[idx] };
          if (evt.thumbnail_status) updated.thumbnail_status = evt.thumbnail_status;
          if (evt.preview_status) updated.preview_status = evt.preview_status;
          if (typeof evt.keep_jpg === 'boolean') updated.keep_jpg = evt.keep_jpg;
          if (typeof evt.keep_raw === 'boolean') updated.keep_raw = evt.keep_raw;
          if (evt.updated_at) updated.updated_at = evt.updated_at;
          if (targetId != null) updated.id = targetId;
          const next = prev.slice();
          next[idx] = updated;
          return next;
        });
        if (!existsInProjectData && !existsInPaged) {
          try {
            fetchProjectDataRef.current?.(selectedProject.folder);
          } catch (e) {
            console.debug('[SSE] item_moved refetch failed', e);
          }
        }
        return;
      }

      // 2) Task completion toasts (user-relevant tasks only)
      if (evt && evt.task_id && evt.task_type && (evt.status === 'completed' || evt.status === 'failed')) {
        const tid = evt.task_id;
        const ttype = evt.task_type;
        const meta = taskDefs?.[ttype];
        const userRelevant = meta ? (meta.user_relevant !== false) : true;
        
        console.log('[SSE] Task event received:', {
          task_id: tid,
          task_type: ttype,
          status: evt.status,
          userRelevant,
          alreadyNotified: notifiedTasksRef.current.has(tid),
          projectFolder: selectedProject?.folder
        });
        
        if (userRelevant && !notifiedTasksRef.current.has(tid)) {
          setTimeout(async () => {
            try {
              const { jobs } = await listJobs(selectedProject.folder, { limit: 100 });
              const sameTask = (jobs || []).filter(j => j?.payload_json?.task_id === tid);
              const anyActive = sameTask.some(j => j.status === 'running' || j.status === 'queued');
              if (anyActive) {
                console.log('[SSE] Task still has active jobs, skipping notification');
                return;
              }
              const anyFailed = sameTask.some(j => j.status === 'failed');
              const label = meta?.label || ttype;
              if (anyFailed) {
                toast?.show({ emoji: '⚠️', message: `${label} failed`, variant: 'error' });
              } else {
                toast?.show({ emoji: '✅', message: `${label} completed`, variant: 'success' });
              }
              notifiedTasksRef.current.add(tid);
              
              // Refresh project data after upload-related tasks complete
              // This ensures the grid shows newly uploaded photos
              if (ttype === 'upload_postprocess' && evt.status === 'completed') {
                console.log('[SSE] Upload task completed, refreshing project data for:', selectedProject.folder);
                try {
                  await fetchProjectDataRef.current?.(selectedProject.folder);
                  console.log('[SSE] Project data refreshed successfully');
                } catch (error) {
                  console.error('[SSE] post-upload refresh failed', error);
                }
              }
            } catch (error) {
              console.error('[SSE] toast fetch jobs failed', error);
            }
          }, 400);
        }
      }
    };

    // Register listener
    sseClient.on('job_update', handleJobUpdate);

    return () => {
      sseClient.off('job_update', handleJobUpdate);
    };
  }, [selectedProject?.folder, taskDefs, setProjectData, mutatePagedPhotos, toast, notifiedTasksRef]);

  useEffect(() => {
    if (!selectedProject?.folder) return;
    if (committing) return;
    const photos = projectData?.photos || [];
    const anyPending = photos.some(p => p && (p.thumbnail_status === 'pending' || !p.thumbnail_status));
    if (!anyPending) return;
    if (sseReadyRef.current) return;

    // Fallback polling for pending thumbnails when SSE isn't ready
    // Increased interval from 3s to 10s to reduce server load
    const id = setInterval(() => {
      const folder = selectedProject?.folder;
      if (folder) {
        fetchProjectDataRef.current?.(folder);
      }
    }, 10000);

    return () => clearInterval(id);
  }, [selectedProject?.folder, projectData, committing]);
}
