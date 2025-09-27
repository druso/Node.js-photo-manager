import { useEffect } from 'react';

/**
 * Hook for keyboard shortcuts handling
 * Extracts keyboard event handling logic from App.jsx
 */
export function useKeyboardShortcuts({
  config,
  viewerState,
  isAllMode,
  toggleAllMode,
  setFiltersCollapsed,
  setShowOptionsModal,
  setShowCreateProject
}) {
  // Keyboard shortcuts: use config.keyboard_shortcuts with sensible defaults
  useEffect(() => {
    const onKeyDown = (e) => {
      // Ignore when typing or with modifiers
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.metaKey || e.ctrlKey || e.altKey) return;
      
      // Don't interfere with viewer shortcuts
      if (viewerState?.isOpen) return;
      
      const shortcuts = config?.keyboard_shortcuts || {};
      const key = e.key?.toLowerCase();
      
      // Toggle All Photos mode (default: 'a')
      const allModeKey = shortcuts.toggle_all_mode || 'a';
      if (key === allModeKey) {
        e.preventDefault();
        toggleAllMode();
        return;
      }
      
      // Toggle filters panel (default: 'f')
      const filtersKey = shortcuts.toggle_filters || 'f';
      if (key === filtersKey) {
        e.preventDefault();
        setFiltersCollapsed(prev => !prev);
        return;
      }
      
      // Open settings (default: ',')
      const settingsKey = shortcuts.open_settings || ',';
      if (key === settingsKey) {
        e.preventDefault();
        setShowOptionsModal(true);
        return;
      }
      
      // Create new project (default: 'n')
      const newProjectKey = shortcuts.new_project || 'n';
      if (key === newProjectKey) {
        e.preventDefault();
        setShowCreateProject(true);
        return;
      }
      
      // Help (default: '?')
      const helpKey = shortcuts.help || '?';
      if (key === helpKey || key === '/') {
        e.preventDefault();
        // Could open help modal in the future
        console.log('Keyboard shortcuts help - feature not implemented yet');
        return;
      }
    };
    
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [config, viewerState?.isOpen, toggleAllMode, setFiltersCollapsed, setShowOptionsModal, setShowCreateProject]);
}
