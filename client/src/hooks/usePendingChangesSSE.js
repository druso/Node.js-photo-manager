import { useEffect, useState, useRef } from 'react';

/**
 * Hook to connect to SSE stream for real-time pending changes updates
 * Returns object with project_folder as key and boolean as value
 * 
 * Example: { "p15": true, "p7": false } means p15 has pending changes, p7 doesn't
 */
export function usePendingChangesSSE() {
  const [pendingChanges, setPendingChanges] = useState({});
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    function connect() {
      if (!mounted) return;

      console.log('[SSE] Attempting to connect to /api/sse/pending-changes');
      
      try {
        const eventSource = new EventSource('/api/sse/pending-changes');
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          if (!mounted) return;
          console.log('[SSE] ✅ Connected to pending changes stream');
          setConnected(true);
        };

        eventSource.onmessage = (event) => {
          if (!mounted) return;
          try {
            const data = JSON.parse(event.data);
            console.log('[SSE] Received pending changes update:', data);
            setPendingChanges(data);
          } catch (error) {
            console.error('[SSE] Failed to parse message:', error);
          }
        };

        eventSource.onerror = (error) => {
          if (!mounted) return;
          console.error('[SSE] Connection error:', error);
          setConnected(false);
          eventSource.close();
          
          // Attempt to reconnect after 5 seconds
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mounted) {
              console.log('[SSE] Attempting to reconnect...');
              connect();
            }
          }, 5000);
        };
      } catch (error) {
        console.error('[SSE] Failed to create EventSource:', error);
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
