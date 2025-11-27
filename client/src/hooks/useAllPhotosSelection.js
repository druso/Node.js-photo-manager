import { useCallback, useState } from 'react';

/**
 * Selection hook that stores full photo objects instead of just keys.
 * This solves the critical bug where selections from other pages couldn't be resolved
 * for bulk operations (visibility changes, tagging, etc.)
 * 
 * Uses Map<key, photo> internally for O(1) lookups while preserving full photo data.
 */
export default function useAllPhotosSelection() {
  // Store Map<key, photo> instead of Set<key>
  const [selectedPhotos, setSelectedPhotos] = useState(new Map());

  const replaceSelection = useCallback((next) => {
    setSelectedPhotos(() => {
      if (next instanceof Map) {
        return new Map(next);
      }
      if (Array.isArray(next)) {
        const map = new Map();
        next.forEach(photo => {
          if (photo) {
            const key = `${photo.project_folder}::${photo.filename}`;
            map.set(key, photo);
          }
        });
        return map;
      }
      return new Map();
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPhotos(new Map());
  }, []);

  const toggleSelection = useCallback((photo) => {
    if (!photo) return;
    const key = `${photo.project_folder}::${photo.filename}`;
    setSelectedPhotos(prev => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, photo); // Store full photo object
      }
      return next;
    });
  }, []);

  const selectAllFromPhotos = useCallback((photos) => {
    if (!Array.isArray(photos) || photos.length === 0) {
      setSelectedPhotos(new Map());
      return;
    }
    const map = new Map();
    photos.forEach(photo => {
      const key = `${photo.project_folder}::${photo.filename}`;
      map.set(key, photo);
    });
    console.log('[useAllPhotosSelection] Setting selected photos:', map.size, 'First key:', map.keys().next().value);
    setSelectedPhotos(map);
  }, []);

  const selectBatch = useCallback((photos) => {
    if (!Array.isArray(photos) || photos.length === 0) return;
    setSelectedPhotos(prev => {
      const next = new Map(prev);
      photos.forEach(photo => {
        const key = `${photo.project_folder}::${photo.filename}`;
        next.set(key, photo);
      });
      return next;
    });
  }, []);

  const deselectBatch = useCallback((keys) => {
    if (!Array.isArray(keys) || keys.length === 0) return;
    setSelectedPhotos(prev => {
      const next = new Map(prev);
      keys.forEach(key => {
        next.delete(key);
      });
      return next;
    });
  }, []);

  // Expose selectedKeys as a Set for backward compatibility with existing code
  // that checks selectedKeys.has(key)
  const selectedKeys = new Set(selectedPhotos.keys());

  return {
    selectedKeys,
    selectedPhotos, // NEW: expose the Map for direct access to photo objects
    replaceSelection,
    clearSelection,
    toggleSelection,
    selectAllFromPhotos,
    selectBatch,
    deselectBatch,
  };
}
