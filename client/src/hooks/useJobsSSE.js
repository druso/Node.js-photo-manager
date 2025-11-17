import { useEffect } from 'react';
import sseClient from '../api/sseClient';

/**
 * Hook to subscribe to job update events via unified SSE stream
 * @param {Function} onJobUpdate - Callback for job updates
 * @returns {Object} - Connection status
 */
export function useJobsSSE(onJobUpdate) {
  useEffect(() => {
    // Connect to jobs channel
    sseClient.connect(['jobs']);
    
    // Register listener
    if (onJobUpdate) {
      sseClient.on('job_update', onJobUpdate);
    }
    
    // Cleanup
    return () => {
      if (onJobUpdate) {
        sseClient.off('job_update', onJobUpdate);
      }
    };
  }, [onJobUpdate]);

  return {
    connected: sseClient.isConnected()
  };
}

/**
 * Hook to subscribe to specific job event types
 * @param {Object} handlers - Object with event handlers (job_completed, job_started, job_failed)
 */
export function useJobEvents(handlers = {}) {
  useEffect(() => {
    // Connect to jobs channel
    sseClient.connect(['jobs']);
    
    // Register handlers
    const { onCompleted, onStarted, onFailed, onUpdate } = handlers;
    
    if (onCompleted) {
      sseClient.on('job_completed', onCompleted);
    }
    if (onStarted) {
      sseClient.on('job_started', onStarted);
    }
    if (onFailed) {
      sseClient.on('job_failed', onFailed);
    }
    if (onUpdate) {
      sseClient.on('job_update', onUpdate);
    }
    
    // Cleanup
    return () => {
      if (onCompleted) {
        sseClient.off('job_completed', onCompleted);
      }
      if (onStarted) {
        sseClient.off('job_started', onStarted);
      }
      if (onFailed) {
        sseClient.off('job_failed', onFailed);
      }
      if (onUpdate) {
        sseClient.off('job_update', onUpdate);
      }
    };
  }, [handlers.onCompleted, handlers.onStarted, handlers.onFailed, handlers.onUpdate]);

  return {
    connected: sseClient.isConnected()
  };
}
