import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useUpload } from '../upload/UploadContext';
import { useToast } from '../ui/toast/ToastContext';

const phaseText = (op) => {
  if (!op) return '';
  const typeLabel = op.type === 'process' ? 'Processing' : 'Uploading';
  switch (op.phase) {
    case 'preparation':
      return 'Analyzing files…';
    case 'uploading':
      return op.label || `${typeLabel}…`;
    case 'post-processing':
      return 'Processing images…';
    case 'completed':
      return 'Completed';
    case 'error':
      return op.label || 'Error';
    default:
      return op.label || '';
  }
};

const BottomUploadBar = () => {
  const { state } = useUpload();
  const toast = useToast();
  const rootRef = useRef(null);
  const { operation } = state;

  // Keep toast container offset above this bar while it's potentially visible.
  // IMPORTANT: Hooks must not be conditional. We run this effect every render
  // and guard its internals based on current visibility state.
  useLayoutEffect(() => {
    const op = operation;
    const el = rootRef.current;
    const showBar = !!op && ['preparation', 'uploading', 'post-processing', 'completed', 'error'].includes(op.phase);
    if (!showBar || !el) {
      // Ensure any previous offset is cleared when hidden or not mounted
      toast.clearOffset('bottom-upload-bar');
      return;
    }
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      toast.setOffset('bottom-upload-bar', h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      toast.clearOffset('bottom-upload-bar');
    };
  }, [toast, operation?.phase]);

  if (!operation) return null;

  const showBar = ['preparation', 'uploading', 'post-processing', 'completed', 'error'].includes(operation.phase);
  if (!showBar) return null;

  const isUploading = operation.phase === 'uploading';
  const isProcessing = operation.phase === 'post-processing';
  const isCompleted = operation.phase === 'completed';
  const hasNumber = typeof operation.percent === 'number';
  const numericPercent = (isUploading || isProcessing) && hasNumber
    ? Math.max(0, Math.min(100, operation.percent))
    : isCompleted
      ? 100
      : 0;
  const indeterminate = isProcessing && (operation.percent == null);

  const label = phaseText(operation);

  // (effect moved above to run unconditionally)

  return (
    <div ref={rootRef} className="fixed bottom-0 left-0 right-0 z-[999]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-3">
        <div className="rounded-md shadow bg-white/90 backdrop-blur border">
          <div className="px-4 py-2 flex items-center gap-3">
            {/* Icon */}
            <div className="text-xl">
              {operation.phase === 'completed' ? '✅' : operation.phase === 'error' ? '⚠️' : '⏳'}
            </div>
            {/* Labels */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{label}</div>
              {operation.phase === 'uploading' && (
                <div className="text-xs text-gray-600 flex gap-2">
                  <div className="flex-1">
                    {operation.meta?.currentFile ? (
                      <span>File {operation.meta.currentFile} of {operation.meta.totalFiles}</span>
                    ) : operation.meta?.completedFiles !== undefined ? (
                      <span>{operation.meta.completedFiles} of {operation.meta.totalFiles} files uploaded</span>
                    ) : (
                      <>
                        {operation.meta?.totalFiles ? `${operation.meta.totalFiles} file${operation.meta.totalFiles > 1 ? 's' : ''}` : ''}
                        {operation.meta?.totalImages ? ` • ${operation.meta.totalImages} image${operation.meta.totalImages > 1 ? 's' : ''}` : ''}
                      </>
                    )}
                  </div>
                  {operation.meta?.speed && (
                    <div className="text-gray-500 font-mono text-[10px] self-center bg-gray-100 px-1.5 py-0.5 rounded">
                      {operation.meta.speed}
                    </div>
                  )}
                </div>
              )}
              {operation.phase === 'post-processing' && (
                <div className="text-xs text-gray-600">
                  Generating thumbnails and previews…
                </div>
              )}
            </div>
            {/* Percent */}
            <div className="text-sm text-gray-800 w-12 text-right">
              {(isUploading || isProcessing) && hasNumber ? `${numericPercent}%` : ''}
            </div>
          </div>
          <div className="px-4 pb-3">
            <div className="h-2 w-full bg-gray-200 rounded overflow-hidden relative">
              {indeterminate ? (
                <div className="absolute inset-0">
                  <div className="h-2 w-2/5 bg-blue-600 rounded animate-pulse" style={{ position: 'absolute', left: 0 }} />
                </div>
              ) : (
                <div
                  className={`h-2 rounded ${operation.phase === 'error' ? 'bg-red-500' : 'bg-blue-600'}`}
                  style={{ width: `${numericPercent}%`, transition: 'width 200ms linear' }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BottomUploadBar;
