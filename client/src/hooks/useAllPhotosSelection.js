import { useCallback, useState } from 'react';

export default function useAllPhotosSelection() {
  const [selectedKeys, setSelectedKeys] = useState(new Set());

  const replaceSelection = useCallback((next) => {
    setSelectedKeys(() => {
      if (next instanceof Set) {
        return new Set(next);
      }
      if (Array.isArray(next)) {
        return new Set(next);
      }
      return new Set();
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  const toggleSelection = useCallback((photo) => {
    if (!photo) return;
    const key = `${photo.project_folder}::${photo.filename}`;
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const selectAllFromPhotos = useCallback((photos) => {
    if (!Array.isArray(photos) || photos.length === 0) {
      setSelectedKeys(new Set());
      return;
    }
    const keys = photos.map(p => `${p.project_folder}::${p.filename}`);
    setSelectedKeys(new Set(keys));
  }, []);

  return {
    selectedKeys,
    replaceSelection,
    clearSelection,
    toggleSelection,
    selectAllFromPhotos,
  };
}
