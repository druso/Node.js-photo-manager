import { useEffect, useState } from 'react';
import sseClient from '../api/sseClient';

/**
 * Hook to connect to SSE stream for real-time pending changes updates
 * Uses the new unified SSE client with channel-based subscriptions
 * Returns the raw payload emitted by the backend, including totals, projects and photos arrays
 */
export function usePendingChangesSSE() {
  const [pendingChanges, setPendingChanges] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Connect to pending-changes channel
    sseClient.connect(['pending-changes']);
    
    // Update connected state
    setConnected(sseClient.isConnected());
    
    // Handler for pending changes state updates
    const handlePendingChanges = (data) => {
      setPendingChanges(data);
    };
    
    // Handler for connection status
    const handleConnected = () => {
      setConnected(true);
    };
    
    // Register listeners
    sseClient.on('pending_changes_state', handlePendingChanges);
    sseClient.on('connected', handleConnected);
    
    // Also listen to generic message events for backward compatibility
    sseClient.on('message', (data) => {
      // Legacy format from /api/sse/pending-changes sends data without event type
      if (data && data.totals && data.projects) {
        setPendingChanges(data);
      }
    });
    
    // Cleanup
    return () => {
      sseClient.off('pending_changes_state', handlePendingChanges);
      sseClient.off('connected', handleConnected);
    };
  }, []);

  return { pendingChanges, connected };
}
