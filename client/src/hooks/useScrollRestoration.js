import { useEffect } from 'react';
import { getSessionState, setSessionMainY } from '../utils/storage';

/**
 * Hook to handle window and main container scroll restoration
 * Extracts scroll restoration logic from App.jsx
 */
export function useScrollRestoration({
  windowScrollRestoredRef,
  initialSavedYRef,
  mainRef,
  projectData,
  config
}) {
  // Re-apply saved window scroll once after initial content render
  useEffect(() => {
    if (windowScrollRestoredRef.current) return;
    if (initialSavedYRef.current == null) return;
    const y = initialSavedYRef.current;
    let attempts = 0;
    const maxAttempts = 5;
    const apply = () => {
      attempts++;
      try { window.scrollTo(0, y); } catch {}
      // If not yet applied (layout not ready), try again shortly
      if (Math.abs((window.scrollY || window.pageYOffset || 0) - y) > 1 && attempts < maxAttempts) {
        setTimeout(() => requestAnimationFrame(apply), 30);
      }
    };
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(apply);
      (window.__raf2 ||= []).push(raf2);
    });
    (window.__raf1 ||= []).push(raf1);
    return () => {
      if (window.__raf1) { window.__raf1.forEach(id => cancelAnimationFrame(id)); window.__raf1 = []; }
      if (window.__raf2) { window.__raf2.forEach(id => cancelAnimationFrame(id)); window.__raf2 = []; }
    };
  }, [projectData, config, windowScrollRestoredRef, initialSavedYRef]);

  // Persist and restore main scroll position (session-only)
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    // restore
    try {
      const st = getSessionState();
      if (st && typeof st.mainY === 'number') {
        const target = st.mainY || 0;
        el.scrollTop = target;
        // small retry to ensure it sticks after layout/content paint
        let count = 0;
        const max = 4;
        const retry = () => {
          if (Math.abs(el.scrollTop - target) <= 1 || count >= max) return;
          count++;
          requestAnimationFrame(() => setTimeout(() => { el.scrollTop = target; retry(); }, 20));
        };
        retry();
      }
    } catch {}
    const onScroll = () => {
      try { setSessionMainY(el.scrollTop || 0); } catch {}
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [mainRef]);
}
