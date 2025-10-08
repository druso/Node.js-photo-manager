import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { fetchPublicImageMetadata } from '../api/photosApi';
import { buildAssetUrl, hasFreshPublicHash, isPublicPhoto, shouldRefreshPublicHash } from '../utils/publicHash';

const PublicHashContext = createContext({
  ensurePublicAssets: async () => null,
  getAssetUrl: () => null,
});

function makeKey(folder, filename) {
  return `${folder || ''}::${filename || ''}`;
}

function mergePhoto(photo, updates) {
  if (!photo || !updates) return photo;
  let changed = false;
  const next = { ...photo };
  for (const [key, value] of Object.entries(updates)) {
    if (photo[key] !== value) {
      next[key] = value;
      changed = true;
    }
  }
  return changed ? next : photo;
}

export function PublicHashProvider({ children, mutateAllPhotos, mutateProjectPhotos, setProjectData }) {
  const inflightRef = useRef(new Map());
  const cacheRef = useRef(new Map());

  const updateCollections = useCallback((folder, filename, updates) => {
    if (!folder || !filename || !updates) return;

    if (typeof mutateAllPhotos === 'function') {
      mutateAllPhotos(prev => {
        if (!Array.isArray(prev) || prev.length === 0) return prev;
        let changed = false;
        const next = prev.map(photo => {
          if (!photo) return photo;
          const sameFolder = (photo.project_folder || '') === folder;
          if (sameFolder && photo.filename === filename) {
            const merged = mergePhoto(photo, updates);
            if (merged !== photo) changed = true;
            return merged;
          }
          return photo;
        });
        return changed ? next : prev;
      });
    }

    if (typeof mutateProjectPhotos === 'function') {
      mutateProjectPhotos(prev => {
        if (!Array.isArray(prev) || prev.length === 0) return prev;
        let changed = false;
        const next = prev.map(photo => {
          if (!photo) return photo;
          const sameFolder = (photo.project_folder || '') === folder;
          if (sameFolder && photo.filename === filename) {
            const merged = mergePhoto(photo, updates);
            if (merged !== photo) changed = true;
            return merged;
          }
          return photo;
        });
        return changed ? next : prev;
      });
    }

    if (typeof setProjectData === 'function') {
      setProjectData(prev => {
        if (!prev || !Array.isArray(prev.photos) || prev.photos.length === 0) return prev;
        let changed = false;
        const photos = prev.photos.map(photo => {
          if (!photo) return photo;
          const sameFolder = (photo.project_folder || '') === folder;
          if (sameFolder && photo.filename === filename) {
            const merged = mergePhoto(photo, updates);
            if (merged !== photo) changed = true;
            return merged;
          }
          return photo;
        });
        return changed ? { ...prev, photos } : prev;
      });
    }
  }, [mutateAllPhotos, mutateProjectPhotos, setProjectData]);

  const persistCache = useCallback((folder, filename, meta) => {
    if (!folder || !filename) return;
    const key = makeKey(folder, filename);
    cacheRef.current.set(key, {
      hash: meta?.photo?.hash ?? null,
      hashExpiresAt: meta?.photo?.hash_expires_at ?? null,
      assets: meta?.assets || null,
      fetchedAt: Date.now(),
    });
  }, []);

  const processMetadata = useCallback((meta, fallbackFolder, fallbackFilename) => {
    const folder = meta?.photo?.project_folder || fallbackFolder || '';
    const filename = meta?.photo?.filename || fallbackFilename || '';
    if (!folder || !filename) return meta;

    const updates = {
      public_hash: meta?.photo?.hash ?? null,
      public_hash_expires_at: meta?.photo?.hash_expires_at ?? null,
    };

    updateCollections(folder, filename, updates);
    persistCache(folder, filename, meta);
    return meta;
  }, [persistCache, updateCollections]);

  const ensurePublicAssets = useCallback(async (input) => {
    const items = Array.isArray(input) ? input : [input];
    const tasks = items.map(async (item) => {
      if (!item || !isPublicPhoto(item) || !item.filename) return null;
      const folder = item.project_folder || item.folder || '';
      const key = makeKey(folder, item.filename);

      const cached = cacheRef.current.get(key);
      if (cached && cached.hash && hasFreshPublicHash({ public_hash: cached.hash, public_hash_expires_at: cached.hashExpiresAt, visibility: 'public' })) {
        return {
          photo: {
            filename: item.filename,
            project_folder: folder,
            hash: cached.hash,
            hash_expires_at: cached.hashExpiresAt,
          },
          assets: cached.assets,
        };
      }

      if (!shouldRefreshPublicHash(item) && item.public_hash) {
        const meta = {
          photo: {
            filename: item.filename,
            project_folder: folder,
            hash: item.public_hash,
            hash_expires_at: item.public_hash_expires_at || null,
          },
          assets: null,
        };
        persistCache(folder, item.filename, meta);
        return meta;
      }

      if (inflightRef.current.has(key)) {
        return inflightRef.current.get(key);
      }

      const promise = fetchPublicImageMetadata(item.filename)
        .then((meta) => processMetadata(meta, folder, item.filename))
        .finally(() => {
          inflightRef.current.delete(key);
        });

      inflightRef.current.set(key, promise);
      return promise;
    });

    const results = await Promise.all(tasks);
    return Array.isArray(input) ? results : results[0];
  }, [persistCache, processMetadata]);

  const getAssetUrl = useCallback(({ photo, type, version }) => {
    if (!photo || !photo.filename || !type) return null;
    const folder = photo.project_folder || photo.folder || '';
    const key = makeKey(folder, photo.filename);
    const cached = cacheRef.current.get(key);
    const hash = cached?.hash ?? photo.public_hash;
    if (!hash) return null;
    try {
      return buildAssetUrl({
        folder,
        type,
        filename: photo.filename,
        hash,
        version,
      });
    } catch {
      return null;
    }
  }, []);

  const value = useMemo(() => ({
    ensurePublicAssets,
    getAssetUrl,
  }), [ensurePublicAssets, getAssetUrl]);

  return (
    <PublicHashContext.Provider value={value}>
      {children}
    </PublicHashContext.Provider>
  );
}

export function usePublicHashContext() {
  return useContext(PublicHashContext);
}

export default PublicHashContext;
