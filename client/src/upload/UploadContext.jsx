import React, { createContext, useContext, useMemo, useRef, useState, useEffect } from 'react';
import { analyzeFiles as apiAnalyzeFiles, processPerImage } from '../api/uploadsApi';
import { uploadFileResumable } from '../api/resumableUpload';

// Public shape
// operation: null | {
//   type: 'upload' | 'process',
//   phase: 'idle' | 'preparation' | 'uploading' | 'post-processing' | 'completed' | 'error',
//   label: string,
//   percent: number | null,
//   meta?: any,
// }
// analysisResult: result from /analyze-files (when type = 'upload')
// summary: convenient summary for confirmation UI
// skipDuplicates: boolean
// actions: startAnalyze(files), confirmUpload({ skipDuplicates }), cancel(), startProcess({ thumbnails, previews, force })

const UploadContext = createContext(null);

export function UploadProvider({ children, projectFolder, onCompleted }) {
  const [operation, setOperation] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [summary, setSummary] = useState(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  // Conflict-handling flag: cross-project moves
  const [reloadConflictsIntoThisProject, setReloadConflictsIntoThisProject] = useState(false);
  // Config flag for resumable uploads
  const [useResumableUploads, setUseResumableUploads] = useState(false);
  const lingerTimerRef = useRef(null);
  const progressTimerRef = useRef(null);
  const hideTimerRef = useRef(null);
  const xhrRef = useRef(null);
  const tusUploadsRef = useRef([]); // Track active tus uploads

  const clearLingerTimer = () => {
    if (lingerTimerRef.current) {
      clearTimeout(lingerTimerRef.current);
      lingerTimerRef.current = null;
    }
  };

  const clearProgressTimer = () => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  };

  // Fetch config to determine if resumable uploads are enabled
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/config');
        if (response.ok) {
          const config = await response.json();
          const enabled = config?.uploader?.use_resumable_uploads === true;
          setUseResumableUploads(enabled);
          if (enabled) {
            console.log('[Upload] Resumable uploads (tus) enabled');
          }
        }
      } catch (err) {
        console.warn('[Upload] Failed to fetch config, using default upload method:', err);
      }
    };
    fetchConfig();
  }, []);

  // Progress polling removed: processing is now handled by background jobs with SSE/Processes panel

  const startAnalyze = async (files) => {
    if (!files || files.length === 0) return;
    if (!projectFolder) {
      console.error('UploadContext.startAnalyze called without projectFolder:', { projectFolder, filesCount: files?.length });
      setOperation({ type: 'upload', phase: 'error', label: 'No project selected for upload', percent: null });
      return;
    }
    clearLingerTimer();
    clearProgressTimer();
    setAnalysisResult(null);
    setSummary(null);
    setOperation({ type: 'upload', phase: 'preparation', label: 'Analyzing files…', percent: null });

    // Prepare minimal file descriptors for analysis
    const fileList = files.map(f => ({ name: f.name, size: f.size, type: f.type }));
    try {
      const result = await apiAnalyzeFiles(projectFolder, fileList);
      setAnalysisResult(() => {
        // attach File objects back to returned groups for upload step
        const withFiles = { ...result };
        if (withFiles && withFiles.imageGroups) {
          Object.values(withFiles.imageGroups).forEach(group => {
            group.files.forEach(fileInfo => {
              const originalFile = files.find(ff => ff.name === fileInfo.name);
              if (originalFile) fileInfo.file = originalFile;
            });
          });
        }
        return withFiles;
      });
      setSummary(result.summary);
      // Initialize flags for a new analysis session
      setReloadConflictsIntoThisProject(false);
      // If no valid files were accepted by the server, stop here and show a clear message
      if (!result.summary || (result.summary.totalFiles || 0) === 0) {
        const rejectedCount = Array.isArray(result.rejected) ? result.rejected.length : 0;
        const msg = rejectedCount > 0
          ? `No valid image files to upload. Rejected ${rejectedCount} file${rejectedCount === 1 ? '' : 's'}.`
          : 'No valid image files to upload.';
        setOperation({ type: 'upload', phase: 'error', label: msg, percent: null });
        return;
      }
      // Keep operation in idle; UI can open a confirmation modal using analysisResult/summary
      setOperation(prev => ({ ...(prev || { type: 'upload' }), phase: 'idle', label: 'Ready to upload', percent: null }));
    } catch (err) {
      console.error('Analyze failed:', err);
      setOperation({ type: 'upload', phase: 'error', label: 'Analyze failed', percent: null, meta: { error: String(err) } });
    }
  };

  const confirmUpload = async ({ skip = skipDuplicatesFromState() } = {}) => {
    if (!analysisResult) return;
    if (!projectFolder) {
      setOperation({ type: 'upload', phase: 'error', label: 'Select a project first', percent: null });
      return;
    }
    clearLingerTimer();

    const { filesToUpload, imagesToProcess, conflictArray } = pickFilesForUpload(analysisResult, skip);
    const moveOnly = !!reloadConflictsIntoThisProject && conflictArray.length > 0 && filesToUpload.length === 0;
    if (!moveOnly && filesToUpload.length === 0) {
      setOperation({ type: 'upload', phase: 'error', label: 'No files to upload', percent: null });
      return;
    }

    // Batch size for sequential uploads (helps avoid Cloudflare Tunnel 100s timeout)
    // Reduced to 1 for maximum reliability with large files through Cloudflare Tunnel
    // Configurable via server config.json: uploader.batch_size (default: 1)
    const BATCH_SIZE = 1;
    const MAX_RETRIES = 3; // Retry failed uploads up to 3 times

    // Phase: uploading (sequential batches with aggregated progress)
    const totalFiles = moveOnly ? 0 : filesToUpload.length;
    const initialLabel = moveOnly
      ? `Consolidating ${conflictArray.length} conflicted item${conflictArray.length > 1 ? 's' : ''}…`
      : `Uploading ${totalFiles} file${totalFiles > 1 ? 's' : ''}…`;
    setOperation({
      type: 'upload',
      phase: 'uploading',
      label: initialLabel,
      percent: 0,
      meta: { totalFiles, totalImages: moveOnly ? 0 : imagesToProcess }
    });

    // Flags expected by backend
    const effectiveOverwrite = !skip;

    // Handle move-only case (no files to upload, only conflicts to consolidate)
    if (moveOnly) {
      const formData = new FormData();
      formData.append('overwriteInThisProject', String(effectiveOverwrite).toLowerCase());
      formData.append('reloadConflictsIntoThisProject', 'true');
      if (conflictArray.length > 0) {
        try { formData.append('conflictItems', JSON.stringify(conflictArray)); } catch { }
      }

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          finishSuccess({ note: 'Consolidation scheduled.' });
        } else {
          finishError(parseErrorText(xhr));
        }
      };

      xhr.onerror = () => finishError('Network error during consolidation');

      xhr.open('POST', `/api/projects/${encodeURIComponent(projectFolder)}/upload`);
      xhr.send(formData);
      return;
    }

    // Use tus resumable uploads if enabled
    if (useResumableUploads) {
      return uploadWithTus(filesToUpload, { skip, conflictArray });
    }

    // Split files into batches
    const batches = [];
    for (let i = 0; i < filesToUpload.length; i += BATCH_SIZE) {
      batches.push(filesToUpload.slice(i, i + BATCH_SIZE));
    }

    const totalBatches = batches.length;
    let filesCompleted = 0;
    const allWarnings = [];
    const allErrors = [];

    // Upload batches sequentially
    try {
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const batchNumber = batchIndex + 1;

        // Retry logic for this batch
        let batchResult = null;
        let retryCount = 0;

        while (retryCount <= MAX_RETRIES) {
          // Create FormData for this batch
          const formData = new FormData();
          batch.forEach(file => formData.append('photos', file));
          formData.append('overwriteInThisProject', String(effectiveOverwrite).toLowerCase());
          formData.append('reloadConflictsIntoThisProject', String(!!reloadConflictsIntoThisProject).toLowerCase());

          // Only include conflictItems in the first batch to avoid duplicate processing
          if (batchIndex === 0 && reloadConflictsIntoThisProject && conflictArray.length > 0) {
            try { formData.append('conflictItems', JSON.stringify(conflictArray)); } catch { }
          }

          // Upload this batch via XHR
          batchResult = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhrRef.current = xhr;

            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                // Calculate overall progress across all batches
                const batchProgress = event.loaded / event.total;
                const overallProgress = (filesCompleted + (batchProgress * batch.length)) / totalFiles;
                const pct = Math.round(overallProgress * 100);

                const retryLabel = retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRIES})` : '';
                setOperation(prev => prev ? {
                  ...prev,
                  percent: pct,
                  label: `Uploading ${totalFiles} file${totalFiles > 1 ? 's' : ''} (${pct}%)${retryLabel}…`
                } : null);
              }
            };

            xhr.onload = function () {
              if (xhr.status >= 200 && xhr.status < 300) {
                try {
                  const response = JSON.parse(xhr.responseText);
                  resolve({ success: true, response });
                } catch {
                  resolve({ success: true, response: {} });
                }
              } else {
                resolve({ success: false, error: parseErrorText(xhr) });
              }
            };

            xhr.onerror = () => resolve({ success: false, error: 'Network error during upload' });

            xhr.open('POST', `/api/projects/${encodeURIComponent(projectFolder)}/upload`);
            xhr.send(formData);
          });

          // If successful, break out of retry loop
          if (batchResult.success) {
            break;
          }

          // If failed and retries remaining, wait before retrying
          retryCount++;
          if (retryCount <= MAX_RETRIES) {
            const retryDelay = Math.pow(2, retryCount - 1) * 1000; // Exponential backoff: 1s, 2s, 4s
            console.log(`[Upload] Batch ${batchNumber} failed, retrying in ${retryDelay}ms (attempt ${retryCount}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }

        // Handle batch result
        if (batchResult.success) {
          filesCompleted += batch.length;
          // Collect warnings from this batch
          if (batchResult.response?.warnings) {
            allWarnings.push(...batchResult.response.warnings);
          }
        } else {
          // Batch failed - collect error and continue with remaining batches
          allErrors.push({
            batch: batchNumber,
            files: batch.map(f => f.name),
            error: batchResult.error
          });
          // Don't increment filesCompleted for failed batch
        }

        // Update progress to reflect completed files
        const progressPct = Math.round((filesCompleted / totalFiles) * 100);
        setOperation(prev => prev ? {
          ...prev,
          percent: progressPct,
          label: `Uploading ${totalFiles} file${totalFiles > 1 ? 's' : ''} (${progressPct}%)…`
        } : null);
      }

      // All batches processed - show final result
      if (allErrors.length === 0) {
        // Complete success
        const note = allWarnings.length > 0
          ? `Upload complete. ${allWarnings.length} warning${allWarnings.length > 1 ? 's' : ''}.`
          : 'Upload complete. Processing in background.';
        finishSuccess({ note, warnings: allWarnings });
      } else if (filesCompleted > 0) {
        // Partial success
        const successCount = filesCompleted;
        const failCount = totalFiles - filesCompleted;
        finishError(`Uploaded ${successCount} of ${totalFiles} files. ${failCount} failed.`);
      } else {
        // Complete failure
        finishError(allErrors[0]?.error || 'Upload failed');
      }

    } catch (err) {
      console.error('Upload error:', err);
      finishError('Upload failed: ' + String(err));
    }
  };

  // Upload files using tus resumable upload protocol
  const uploadWithTus = async (filesToUpload, options = {}) => {
    const totalFiles = filesToUpload.length;
    let completedFiles = 0;
    const allErrors = [];

    setOperation({
      type: 'upload',
      phase: 'uploading',
      label: `Uploading ${totalFiles} file${totalFiles > 1 ? 's' : ''} (resumable)…`,
      percent: 0,
      meta: { totalFiles, resumable: true }
    });

    // Clear any previous tus uploads
    tusUploadsRef.current.forEach(upload => {
      try {
        upload.abort();
      } catch (err) {
        console.warn('[tus] Failed to abort previous upload:', err);
      }
    });
    tusUploadsRef.current = [];

    try {
      // Upload files sequentially (can be parallelized if needed)
      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i];
        const fileNumber = i + 1;

        await new Promise((resolve, reject) => {
          const upload = uploadFileResumable(file, {
            projectFolder,
            onProgress: (percentage, bytesUploaded, bytesTotal) => {
              // Calculate overall progress
              const fileProgress = percentage / 100;
              const overallProgress = (completedFiles + fileProgress) / totalFiles;
              const pct = Math.round(overallProgress * 100);

              setOperation(prev => prev ? {
                ...prev,
                percent: pct,
                label: `Uploading ${totalFiles} file${totalFiles > 1 ? 's' : ''} (${pct}%) [${fileNumber}/${totalFiles}]…`
              } : null);
            },
            onError: (error) => {
              console.error(`[tus] Upload failed for ${file.name}:`, error);
              allErrors.push({
                file: file.name,
                error: error.message || String(error)
              });
              reject(error);
            },
            onSuccess: () => {
              console.log(`[tus] Upload succeeded for ${file.name}`);
              completedFiles++;
              resolve();
            }
          });

          // Track upload instance
          tusUploadsRef.current.push(upload);

          // Start the upload
          upload.start();
        });
      }

      // All uploads completed
      if (allErrors.length === 0) {
        finishSuccess({ note: 'Upload complete. Processing in background.' });
      } else if (completedFiles > 0) {
        const successCount = completedFiles;
        const failCount = totalFiles - completedFiles;
        finishError(`Uploaded ${successCount} of ${totalFiles} files. ${failCount} failed.`);
      } else {
        finishError(allErrors[0]?.error || 'Upload failed');
      }

    } catch (err) {
      console.error('[tus] Upload error:', err);
      finishError('Upload failed: ' + String(err));
    } finally {
      // Clear tus uploads
      tusUploadsRef.current = [];
    }
  };

  // Start processing via unified per-image endpoint (now enqueues a background job).
  // Note: thumbnails/previews flags are ignored; kept for compatibility with callers.
  const startProcess = async ({ thumbnails = true, previews = true, force = false, filenames } = {}) => {
    if (!projectFolder) {
      setOperation({ type: 'process', phase: 'error', label: 'Select a project first', percent: null });
      return;
    }
    clearLingerTimer();
    setOperation({ type: 'process', phase: 'post-processing', label: 'Queuing background process…', percent: null });
    try {
      await processPerImage(projectFolder, { force, filenames });
      finishSuccess({ note: 'Process queued. Running in background.' });
    } catch (err) {
      setOperation({ type: 'process', phase: 'error', label: 'Processing failed', percent: null, meta: { error: String(err) } });
    }
  };

  const cancel = () => {
    clearLingerTimer();
    clearProgressTimer();
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    // Abort XHR uploads
    try { xhrRef.current && xhrRef.current.abort && xhrRef.current.abort(); } catch { }
    xhrRef.current = null;
    // Abort tus uploads
    tusUploadsRef.current.forEach(upload => {
      try {
        upload.abort();
      } catch (err) {
        console.warn('[tus] Failed to abort upload:', err);
      }
    });
    tusUploadsRef.current = [];
    setAnalysisResult(null);
    setSummary(null);
    setOperation(null);
  };

  const finishSuccess = (details) => {
    setOperation(prev => prev ? { ...prev, phase: 'completed', label: 'Completed', meta: { ...(prev.meta || {}), ...details } } : null);
    if (typeof onCompleted === 'function') {
      try { onCompleted(); } catch { }
    }
    hideTimerRef.current = setTimeout(() => setOperation(null), 3000);
  };

  const finishError = (message) => {
    setOperation({ type: 'upload', phase: 'error', label: message || 'Upload failed', percent: null });
  };

  const parseErrorText = (xhr) => {
    try {
      const json = JSON.parse(xhr.responseText);
      return json?.error || xhr.statusText || 'Upload failed';
    } catch {
      return xhr.statusText || 'Upload failed';
    }
  };

  const skipDuplicatesFromState = () => skipDuplicates;

  const pickFilesForUpload = (analysis, skip) => {
    let filesToUpload = [];
    let imagesToProcess = 0;
    let conflictArray = [];
    if (!analysis || !analysis.imageGroups) return { filesToUpload, imagesToProcess };

    // Build conflict set from analysis (cross-project conflicts only)
    try {
      conflictArray = Array.isArray(analysis.conflicts) ? analysis.conflicts.map(c => c.filename) : [];
    } catch { }
    const conflictSet = new Set(conflictArray);

    if (skip) {
      // Skip true duplicates, include new images and format completions.
      // Cross-project conflicts are NEVER uploaded (handled via move when selected).
      const allowedGroups = Object.values(analysis.imageGroups).filter(group => {
        const isCrossConflict = conflictSet.has(group.baseName);
        return (group.isNew || group.conflictType === 'completion') && !isCrossConflict;
      });
      filesToUpload = allowedGroups.flatMap(group => group.files.map(f => f.file).filter(Boolean));
      imagesToProcess = allowedGroups.length;
    } else {
      // Overwrite duplicates in this project, but NEVER upload cross-project conflicts.
      const allowedGroups = Object.values(analysis.imageGroups).filter(group => !conflictSet.has(group.baseName));
      filesToUpload = allowedGroups.flatMap(group => group.files.map(f => f.file).filter(Boolean));
      imagesToProcess = allowedGroups.length;
    }
    return { filesToUpload, imagesToProcess, conflictArray };
  };

  const value = useMemo(() => ({
    state: { operation, analysisResult, summary, skipDuplicates, reloadConflictsIntoThisProject },
    actions: { startAnalyze, confirmUpload, cancel, startProcess, setSkipDuplicates, setReloadConflictsIntoThisProject }
  }), [operation, analysisResult, summary, skipDuplicates, reloadConflictsIntoThisProject, projectFolder]);

  return (
    <UploadContext.Provider value={value}>
      {children}
    </UploadContext.Provider>
  );
}

export function useUpload() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUpload must be used within an UploadProvider');
  return ctx;
}
