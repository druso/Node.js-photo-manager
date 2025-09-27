import React, { useEffect, useRef } from 'react';

const CommitModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  isCommitting, 
  pendingDeleteTotals, 
  commitDescription 
}) => {
  const modalRef = useRef(null);
  const pendingProjectsCount = pendingDeleteTotals.byProject ? pendingDeleteTotals.byProject.size : 0;

  // A11y: focus trap
  useEffect(() => {
    if (!isOpen) return;
    
    const modal = modalRef.current;
    if (!modal) return;
    
    const previouslyFocused = document.activeElement;
    const focusable = modal.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    
    const onKeyDown = (e) => {
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === first) { 
          e.preventDefault(); 
          last.focus(); 
        } else if (!e.shiftKey && document.activeElement === last) { 
          e.preventDefault(); 
          first.focus(); 
        }
      }
      if (e.key === 'Escape') onClose();
    };
    
    first && first.focus();
    document.addEventListener('keydown', onKeyDown);
    
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        try { previouslyFocused.focus(); } catch {}
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="presentation">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />
      <div
        ref={modalRef}
        className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="commit-modal-title"
        aria-describedby="commit-modal-desc"
        aria-busy={isCommitting ? 'true' : 'false'}
      >
        <div className="px-6 py-4 border-b">
          <h3 id="commit-modal-title" className="text-lg font-semibold">
            Commit pending deletions
          </h3>
        </div>
        <div className="px-6 py-4 space-y-2">
          <p id="commit-modal-desc" className="text-sm text-gray-700">
            {commitDescription}
          </p>
          <div className="text-sm text-gray-600">
            <div>Total pending: <span className="font-medium">{pendingDeleteTotals.total}</span></div>
            <div className="text-xs">JPG: {pendingDeleteTotals.jpg} · RAW: {pendingDeleteTotals.raw}</div>
            {pendingProjectsCount > 0 && (
              <div className="text-xs">Projects affected: {pendingProjectsCount}</div>
            )}
          </div>
        </div>
        <div className="px-6 py-4 border-t-0 flex justify-end gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300"
            onClick={onClose}
            disabled={isCommitting}
            aria-label="Cancel commit"
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            onClick={onConfirm}
            disabled={isCommitting || pendingDeleteTotals.total === 0}
            aria-disabled={isCommitting || pendingDeleteTotals.total === 0 ? 'true' : 'false'}
            aria-label="Confirm commit pending deletions"
          >
            {isCommitting ? 'Committing…' : 'Commit'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CommitModal;
