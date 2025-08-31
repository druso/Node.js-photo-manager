import React, { useEffect, useRef, useState } from 'react';
import { useUpload } from '../upload/UploadContext';

export default function GlobalDragDrop({ onFilesDroppedInAllView }) {
  const { actions } = useUpload();
  const [dragActive, setDragActive] = useState(false);
  const dragCounterRef = useRef(0);

  useEffect(() => {
    const onDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onDragEnter = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current += 1;
      setDragActive(true);
    };
    const onDragLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        setDragActive(false);
        dragCounterRef.current = 0;
      }
    };
    const onDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setDragActive(false);
      if (!e.dataTransfer) return;
      const items = e.dataTransfer.items || [];
      const files = [];
      for (let i = 0; i < (items.length || 0); i++) {
        const it = items[i];
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length === 0 && e.dataTransfer.files) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) files.push(e.dataTransfer.files[i]);
      }
      if (files.length > 0) {
        if (typeof onFilesDroppedInAllView === 'function') {
          // In All view - need project selection first
          onFilesDroppedInAllView(files);
        } else if (typeof actions.startAnalyze === 'function') {
          // In project view - proceed directly
          actions.startAnalyze(files);
        }
      }
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [actions]);

  return (
    <>
      {dragActive && (
        <div className="fixed inset-0 z-[998] pointer-events-none">
          <div className="absolute inset-0 bg-blue-500/10 border-4 border-dashed border-blue-400" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="px-6 py-3 rounded-xl bg-white/90 backdrop-blur shadow text-blue-700 font-medium">
              Drop files to import
            </div>
          </div>
        </div>
      )}
    </>
  );
}
