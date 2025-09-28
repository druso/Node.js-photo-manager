import { useCallback, useState } from 'react';

/**
 * Unified selection hook that works for both All Photos and Project views
 * 
 * This hook manages a normalized selection model where each selected photo
 * is represented as a PhotoRef object with { id, project_folder, filename }
 * 
 * @typedef {Object} PhotoRef
 * @property {string} [id] - Photo ID (preferred when available)
 * @property {string} project_folder - Project folder containing the photo
 * @property {string} filename - Filename of the photo
 * 
 * @returns {Object} Selection state and methods
 */
export function useUnifiedSelection() {
  // Array of PhotoRef objects
  const [selection, setSelection] = useState([]);

  /**
   * Replace the entire selection with a new set of photos
   * @param {PhotoRef[] | Set<PhotoRef>} photos - New selection
   */
  const replaceSelection = useCallback((photos) => {
    if (!photos) {
      setSelection([]);
      return;
    }
    
    if (photos instanceof Set) {
      setSelection(Array.from(photos));
    } else if (Array.isArray(photos)) {
      setSelection([...photos]);
    } else {
      setSelection([]);
    }
  }, []);

  /**
   * Clear the selection
   */
  const clearSelection = useCallback(() => {
    setSelection([]);
  }, []);

  /**
   * Toggle selection state for a single photo
   * @param {PhotoRef} photo - Photo to toggle
   */
  const toggleSelection = useCallback((photo) => {
    if (!photo || !photo.filename || !photo.project_folder) return;
    
    setSelection(prev => {
      // Check if this photo is already selected
      const index = prev.findIndex(p => 
        p.project_folder === photo.project_folder && 
        p.filename === photo.filename
      );
      
      if (index >= 0) {
        // Remove from selection
        return [...prev.slice(0, index), ...prev.slice(index + 1)];
      } else {
        // Add to selection
        return [...prev, photo];
      }
    });
  }, []);

  /**
   * Select all photos from a list
   * @param {PhotoRef[]} photos - Photos to select
   */
  const selectAll = useCallback((photos) => {
    if (!Array.isArray(photos) || photos.length === 0) {
      setSelection([]);
      return;
    }
    
    // Ensure each photo has project_folder and filename
    const validPhotos = photos.filter(p => p && p.project_folder && p.filename);
    setSelection(validPhotos);
  }, []);

  /**
   * Check if a photo is selected
   * @param {PhotoRef} photo - Photo to check
   * @returns {boolean} True if selected
   */
  const isSelected = useCallback((photo) => {
    if (!photo || !photo.filename || !photo.project_folder) return false;
    
    return selection.some(p => 
      p.project_folder === photo.project_folder && 
      p.filename === photo.filename
    );
  }, [selection]);

  /**
   * Get selection count
   * @returns {number} Number of selected photos
   */
  const getSelectionCount = useCallback(() => {
    return selection.length;
  }, [selection]);

  /**
   * Get selection for a specific project
   * @param {string} projectFolder - Project folder
   * @returns {PhotoRef[]} Selected photos in the project
   */
  const getProjectSelection = useCallback((projectFolder) => {
    if (!projectFolder) return [];
    
    return selection.filter(p => p.project_folder === projectFolder);
  }, [selection]);

  /**
   * Convert legacy selection formats to unified format
   * @param {Object} options - Conversion options
   * @param {Set<string>} [options.projectSelection] - Project selection (filenames only)
   * @param {string} [options.projectFolder] - Project folder for project selection
   * @param {Set<string>} [options.allSelection] - All Photos selection (composite keys)
   * @returns {PhotoRef[]} Unified selection
   */
  const fromLegacySelection = useCallback(({ projectSelection, projectFolder, allSelection }) => {
    const result = [];
    
    // Convert project selection (Set of filenames)
    if (projectSelection instanceof Set && projectSelection.size > 0 && projectFolder) {
      Array.from(projectSelection).forEach(filename => {
        result.push({
          project_folder: projectFolder,
          filename
        });
      });
    }
    
    // Convert All Photos selection (Set of composite keys)
    if (allSelection instanceof Set && allSelection.size > 0) {
      Array.from(allSelection).forEach(key => {
        const parts = key.split('::');
        if (parts.length === 2) {
          result.push({
            project_folder: parts[0],
            filename: parts[1]
          });
        }
      });
    }
    
    return result;
  }, []);

  /**
   * Convert unified selection to legacy project selection format
   * @param {string} projectFolder - Project folder
   * @returns {Set<string>} Set of filenames
   */
  const toLegacyProjectSelection = useCallback((projectFolder) => {
    if (!projectFolder) return new Set();
    
    const projectPhotos = selection.filter(p => p.project_folder === projectFolder);
    return new Set(projectPhotos.map(p => p.filename));
  }, [selection]);

  /**
   * Convert unified selection to legacy All Photos selection format
   * @returns {Set<string>} Set of composite keys
   */
  const toLegacyAllSelection = useCallback(() => {
    return new Set(selection.map(p => `${p.project_folder}::${p.filename}`));
  }, [selection]);

  return {
    // Core selection state and operations
    selection,
    setSelection,
    replaceSelection,
    clearSelection,
    toggleSelection,
    selectAll,
    isSelected,
    getSelectionCount,
    getProjectSelection,
    
    // Legacy format conversion helpers
    fromLegacySelection,
    toLegacyProjectSelection,
    toLegacyAllSelection
  };
}

export default useUnifiedSelection;
