import { useEffect, useState, useRef } from 'react';
import { getAuthAccessToken } from '../api/httpClient';
import { EventSourcePolyfill } from 'event-source-polyfill';

const IS_DEV = Boolean(import.meta?.env?.DEV);

/**
 * Hook to connect to SSE stream for real-time pending changes updates
 * Returns the raw payload emitted by the backend, including totals, projects and photos arrays
 */
export function usePendingChangesSSE() {
  const [pendingChanges, setPendingChanges] = useState(null);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectDelayRef = useRef(5000);
  const maxReconnectDelay = 60000;

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
          reconnectDelayRef.current = 5000;
        };

        eventSource.onmessage = (event) => {
          if (!mounted) return;
          try {
            const data = JSON.parse(event.data);
            if (IS_DEV) {
              console.log('[SSE] Received pending changes update:', data);
            }
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
          
          // Exponential backoff: start at 5s, double each time, max 60s
          const delay = reconnectDelayRef.current;
          if (IS_DEV) {
            console.log(`[SSE] Will reconnect in ${delay}ms`);
          }
          
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mounted) {
              if (IS_DEV) {
                console.log('[SSE] Attempting to reconnect...');
              }
              connect();
            }
          }, delay);
          
          // Double the delay for next time, up to max
          reconnectDelayRef.current = Math.min(delay * 2, maxReconnectDelay);
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

  return { pendingChanges, connected };
}
