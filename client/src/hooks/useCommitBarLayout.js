import { useLayoutEffect } from 'react';

/**
 * Hook to handle commit/revert bar layout and toast offset
 * Extracts commit bar layout logic from App.jsx
 */
export function useCommitBarLayout({
  hasPendingDeletes,
  commitBarRef,
  toast,
  pendingDeleteTotals
}) {
  // Reserve space for the commit/revert bottom bar so toasts don't overlap it
  useLayoutEffect(() => {
    if (!hasPendingDeletes) {
      toast.clearOffset('commit-revert-bar');
      return;
    }
    const el = commitBarRef.current;
    if (!el) return;
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      toast.setOffset('commit-revert-bar', h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      toast.clearOffset('commit-revert-bar');
    };
  }, [toast, hasPendingDeletes, pendingDeleteTotals.total, commitBarRef]);
}
