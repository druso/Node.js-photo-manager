import { useEffect } from 'react';
import { setSessionWindowY, setSessionMainY } from '../utils/storage';

/**
 * Hook to handle UI state persistence
 * Extracts persistence-related useEffect blocks from App.jsx
 */
export function usePersistence({
  // State
  uiPrefsReady,
  viewMode,
  sizeLevel,
  filtersCollapsed,
  activeFilters,
  
  // Refs
  uiPrefsReadyRef,
  prefsLoadedOnceRef,
  mainRef,
  
  // Config
  DEBUG_PERSIST = false
}) {
  // Persist UI prefs when they change
  useEffect(() => {
    if (!uiPrefsReadyRef.current || !uiPrefsReady) return; // wait until load attempt completes
    try {
      const toSave = {
        viewMode,
        sizeLevel,
        filtersCollapsed,
        activeFilters
      };
      localStorage.setItem('ui_prefs', JSON.stringify(toSave));
      if (DEBUG_PERSIST) console.debug('[persist] saved ui_prefs:', toSave);
    } catch (error) {
      if (DEBUG_PERSIST) console.debug('[persist] failed to save ui_prefs:', error);
    }
  }, [uiPrefsReady, viewMode, sizeLevel, filtersCollapsed, activeFilters, uiPrefsReadyRef, DEBUG_PERSIST]);

  // Ensure we save once after readiness even if no user changes yet
  useEffect(() => {
    if (!uiPrefsReady) return;
    if (prefsLoadedOnceRef.current) return;
    prefsLoadedOnceRef.current = true;
    
    // Trigger a save by updating a dummy dependency
    const timer = setTimeout(() => {
      try {
        const toSave = { viewMode, sizeLevel, filtersCollapsed, activeFilters };
        localStorage.setItem('ui_prefs', JSON.stringify(toSave));
        if (DEBUG_PERSIST) console.debug('[persist] initial save after ready:', toSave);
      } catch {}
    }, 100);
    
    return () => clearTimeout(timer);
  }, [uiPrefsReady, viewMode, sizeLevel, filtersCollapsed, activeFilters, prefsLoadedOnceRef, DEBUG_PERSIST]);

  // Persist main scroll position (session-only)
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    
    // Restore saved scroll position
    try {
      const saved = sessionStorage.getItem('main_scroll_y');
      if (saved) {
        const y = parseInt(saved, 10);
        if (!isNaN(y)) {
          el.scrollTop = y;
        }
      }
    } catch {}
    
    // Set up scroll persistence
    let saveTimer = null;
    const onScroll = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try {
          setSessionMainY(el.scrollTop);
        } catch {}
      }, 100);
    };
    
    el.addEventListener('scroll', onScroll, { passive: true });
    
    return () => {
      el.removeEventListener('scroll', onScroll);
      clearTimeout(saveTimer);
    };
  }, [mainRef]);

  // Persist window scroll position (session-only)
  useEffect(() => {
    let saveTimer = null;
    const onScroll = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try {
          const y = window.scrollY || window.pageYOffset || 0;
          setSessionWindowY(y);
        } catch {}
      }, 100);
    };
    
    window.addEventListener('scroll', onScroll, { passive: true });
    
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(saveTimer);
    };
  }, []);
}
