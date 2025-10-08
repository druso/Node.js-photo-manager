import { useEffect, useState, useRef } from 'react';
import { getAuthAccessToken } from '../api/httpClient';
import { EventSourcePolyfill } from 'event-source-polyfill';

const IS_DEV = Boolean(import.meta?.env?.DEV);

/**
 * Hook to connect to SSE stream for real-time pending changes updates
 * Returns object with project_folder as key and boolean as value
 * 
 * Example: { "p15": true, "p7": false } means p15 has pending changes, p7 doesn't
 */
export function usePendingChangesSSE() {
  const [pendingChanges, setPendingChanges] = useState({});
  const pendingOverridesRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    function connect() {
      if (!mounted) return;

      if (IS_DEV) {
        console.log('[SSE] Attempting to connect to /api/sse/pending-changes');
      }
      
      try {
        const token = getAuthAccessToken();
        const eventSource = token
          ? new EventSourcePolyfill('/api/sse/pending-changes', {
              headers: { Authorization: `Bearer ${token}` },
              withCredentials: true,
            })
          : new EventSource('/api/sse/pending-changes');
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          if (!mounted) return;
          if (IS_DEV) {
            console.log('[SSE] ✅ Connected to pending changes stream');
          }
          setConnected(true);
        };

        eventSource.onmessage = (event) => {
          if (!mounted) return;
          try {
            const data = JSON.parse(event.data);
            if (IS_DEV) {
              console.log('[SSE] Received pending changes update:', data);
            }
            pendingOverridesRef.current = null;
            setPendingChanges(data);
          } catch (error) {
            if (IS_DEV) {
              console.error('[SSE] Failed to parse message:', error);
            }
          }
        };

        eventSource.onerror = (error) => {
          if (!mounted) return;
          if (IS_DEV) {
            console.error('[SSE] Connection error:', error);
          }
          setConnected(false);
          eventSource.close();
          
          // Attempt to reconnect after 5 seconds
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mounted) {
              if (IS_DEV) {
                console.log('[SSE] Attempting to reconnect...');
              }
              connect();
            }
          }, 5000);
        };
      } catch (error) {
        if (IS_DEV) {
          console.error('[SSE] Failed to create EventSource:', error);
        }
      }
    }

    connect();

    return () => {
      mounted = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setConnected(false);
    };
  }, []);

  const applyPendingOverride = (updater) => {
    setPendingChanges(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      pendingOverridesRef.current = next;
      return next;
    });
  };

  const clearPendingOverride = () => {
    pendingOverridesRef.current = null;
  };

  return { pendingChanges, connected, applyPendingOverride, clearPendingOverride };
}
