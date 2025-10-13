import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Custom hook for fetching shared link data
 * Automatically detects auth status and calls appropriate endpoint:
 * - Public users: GET /shared/api/:hash (public photos only)
 * - Admin users: GET /shared/api/:hash/admin (all photos: public + private)
 * 
 * @param {Object} options
 * @param {string} options.hashedKey - The shared link hashed key
 * @param {boolean} options.isAuthenticated - Whether user is authenticated as admin
 * @param {number} [options.limit=50] - Page size limit
 * @returns {Object} Hook state and methods
 */
export function useSharedLinkData({ hashedKey, isAuthenticated, limit = 50 }) {
  const [photos, setPhotos] = useState([]);
  const [metadata, setMetadata] = useState({ id: null, title: null, description: null });
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [prevCursor, setPrevCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Track if we're currently fetching to prevent duplicate requests
  const fetchingRef = useRef(false);
  const abortControllerRef = useRef(null);

  /**
   * Fetch shared link data from appropriate endpoint
   * @param {string|null} cursor - Forward pagination cursor
   * @param {string|null} beforeCursor - Backward pagination cursor
   * @param {boolean} append - If true, append to existing photos; if false, replace
   */
  const fetchData = useCallback(async (cursor = null, beforeCursor = null, append = false) => {
    console.log('[useSharedLinkData] fetchData called:', {
      hashedKey,
      cursor,
      beforeCursor,
      append,
      isAuthenticated,
      fetchingRef: fetchingRef.current,
    });

    if (!hashedKey) {
      console.log('[useSharedLinkData] No hashedKey, setting error');
      setError(new Error('No hashed key provided'));
      return;
    }

    // Prevent duplicate requests
    if (fetchingRef.current) {
      console.log('[useSharedLinkData] Already fetching, skipping');
      return;
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      console.log('[useSharedLinkData] Aborting previous request');
      abortControllerRef.current.abort();
    }

    console.log('[useSharedLinkData] Starting fetch...');
    fetchingRef.current = true;
    setLoading(true);
    setError(null);

    // Create new abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // Choose endpoint based on auth status
      const endpoint = isAuthenticated
        ? `/shared/api/${hashedKey}/admin`
        : `/shared/api/${hashedKey}`;

      // Build query params
      const params = new URLSearchParams({ limit: String(limit) });
      if (cursor) params.append('cursor', cursor);
      if (beforeCursor) params.append('before_cursor', beforeCursor);

      const url = `${endpoint}?${params.toString()}`;
      
      console.log('[useSharedLinkData] Fetching URL:', url);

      const response = await fetch(url, {
        signal: abortController.signal,
        credentials: 'include', // Include cookies for auth
      });
      
      console.log('[useSharedLinkData] Response received:', {
        status: response.status,
        ok: response.ok,
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Shared link not found');
        } else if (response.status === 401) {
          throw new Error('Authentication required');
        } else {
          throw new Error(`Failed to load shared link: ${response.status}`);
        }
      }

      const data = await response.json();

      console.log('[useSharedLinkData] Received data:', {
        endpoint,
        photosCount: data.photos?.length,
        total: data.total,
        hasPhotos: !!data.photos,
        isAuthenticated,
      });

      // Update state
      setMetadata({
        id: data.id,
        title: data.title,
        description: data.description,
      });
      setTotal(data.total || 0);
      setNextCursor(data.next_cursor || null);
      setPrevCursor(data.prev_cursor || null);

      // Update photos - append or replace based on flag
      if (append) {
        setPhotos(prev => [...prev, ...(data.photos || [])]);
      } else {
        setPhotos(data.photos || []);
      }

      console.log('[useSharedLinkData] Photos state updated:', {
        photosLength: data.photos?.length,
        append,
      });

    } catch (err) {
      // Don't set error if request was aborted (component unmounted or new request started)
      if (err.name !== 'AbortError') {
        setError(err);
        console.error('Failed to fetch shared link data:', err);
      }
    } finally {
      fetchingRef.current = false;
      setLoading(false);
      abortControllerRef.current = null;
    }
  }, [hashedKey, isAuthenticated, limit]);

  /**
   * Load more photos (forward pagination)
   */
  const loadMore = useCallback(() => {
    if (nextCursor && !loading) {
      fetchData(nextCursor, null, true);
    }
  }, [nextCursor, loading, fetchData]);

  /**
   * Load previous photos (backward pagination)
   */
  const loadPrev = useCallback(() => {
    if (prevCursor && !loading) {
      fetchData(null, prevCursor, false);
    }
  }, [prevCursor, loading, fetchData]);

  /**
   * Reload data (reset to first page)
   */
  const reload = useCallback(() => {
    if (!loading) {
      fetchData(null, null, false);
    }
  }, [loading, fetchData]);

  // Initial fetch when hashedKey or isAuthenticated changes
  useEffect(() => {
    console.log('[useSharedLinkData] Effect triggered:', {
      hashedKey,
      isAuthenticated,
      willFetch: !!hashedKey,
    });
    
    if (!hashedKey) {
      console.log('[useSharedLinkData] No hashedKey, skipping fetch');
      return;
    }

    console.log('[useSharedLinkData] Calling fetchData...');
    fetchData(null, null, false);

    // Cleanup: abort any pending request on unmount or when dependencies change
    return () => {
      console.log('[useSharedLinkData] Effect cleanup - aborting request');
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      // Reset fetching flag so next effect can run
      fetchingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashedKey, isAuthenticated, limit]); // Don't include fetchData - it would cause infinite loop

  return {
    photos,
    metadata,
    total,
    nextCursor,
    prevCursor,
    loading,
    error,
    loadMore,
    loadPrev,
    reload,
    hasMore: !!nextCursor,
    hasPrev: !!prevCursor,
  };
}
