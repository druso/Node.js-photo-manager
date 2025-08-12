import React, { createContext, useContext, useMemo, useRef, useState, useEffect } from 'react';
import { analyzeFiles as apiAnalyzeFiles, processPerImage } from '../api/uploadsApi';

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
  const lingerTimerRef = useRef(null);
  const progressTimerRef = useRef(null);
  const hideTimerRef = useRef(null);
  const xhrRef = useRef(null);

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

  // Progress polling removed: processing is now handled by background jobs with SSE/Processes panel

  const startAnalyze = async (files) => {
    if (!files || files.length === 0) return;
    if (!projectFolder) {
      setOperation({ type: 'upload', phase: 'error', label: 'Select a project first', percent: null });
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

    const { filesToUpload, imagesToProcess } = pickFilesForUpload(analysisResult, skip);
    if (filesToUpload.length === 0) {
      setOperation({ type: 'upload', phase: 'error', label: 'No files to upload', percent: null });
      return;
    }

    // Phase: uploading (XHR to get progress)
    setOperation({ type: 'upload', phase: 'uploading', label: `Uploading ${filesToUpload.length} file${filesToUpload.length > 1 ? 's' : ''}…`, percent: 0, meta: { totalFiles: filesToUpload.length, totalImages: imagesToProcess } });

    const formData = new FormData();
    filesToUpload.forEach(file => formData.append('photos', file));

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const pct = Math.round((event.loaded * 100) / event.total);
        setOperation(prev => prev ? { ...prev, percent: pct, label: `Uploading ${prev.meta?.totalFiles ?? filesToUpload.length} files (${pct}%)…` } : null);
      }
    };

    xhr.onload = async function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        // Background job will process uploaded files. Mark upload complete.
        finishSuccess({ note: 'Upload complete. Processing in background.' });
      } else {
        finishError(parseErrorText(xhr));
      }
    };

    xhr.onerror = () => finishError('Network error during upload');

    xhr.open('POST', `/api/projects/${encodeURIComponent(projectFolder)}/upload`);
    xhr.send(formData);
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
    try { xhrRef.current && xhrRef.current.abort && xhrRef.current.abort(); } catch {}
    xhrRef.current = null;
    setAnalysisResult(null);
    setSummary(null);
    setOperation(null);
  };

  const finishSuccess = (details) => {
    setOperation(prev => prev ? { ...prev, phase: 'completed', label: 'Completed', meta: { ...(prev.meta || {}), ...details } } : null);
    if (typeof onCompleted === 'function') {
      try { onCompleted(); } catch {}
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
    if (!analysis || !analysis.imageGroups) return { filesToUpload, imagesToProcess };

    if (skip) {
      const allowedGroups = Object.values(analysis.imageGroups).filter(group => group.isNew || group.conflictType === 'completion');
      filesToUpload = allowedGroups.flatMap(group => group.files.map(f => f.file).filter(Boolean));
      imagesToProcess = allowedGroups.length;
    } else {
      const allGroups = Object.values(analysis.imageGroups);
      filesToUpload = allGroups.flatMap(group => group.files.map(f => f.file).filter(Boolean));
      imagesToProcess = analysis.summary?.totalImages ?? allGroups.length;
    }
    return { filesToUpload, imagesToProcess };
  };

  const value = useMemo(() => ({
    state: { operation, analysisResult, summary, skipDuplicates },
    actions: { startAnalyze, confirmUpload, cancel, startProcess, setSkipDuplicates }
  }), [operation, analysisResult, summary, skipDuplicates, projectFolder]);

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
