import { getAuthAccessToken } from './httpClient';
import { EventSourcePolyfill } from 'event-source-polyfill';

const IS_DEV = Boolean(import.meta?.env?.DEV);

/**
 * Unified SSE Client
 * Manages a single SSE connection to /api/sse/stream with channel-based subscriptions
 * Reduces connection overhead from 2+ connections to 1 connection per user
 */
class SSEClient {
  constructor() {
    this.eventSource = null;
    this.listeners = new Map(); // eventType -> Set of callbacks
    this.channels = new Set(); // Set of subscribed channels
    this.reconnectDelay = 5000;
    this.maxReconnectDelay = 60000;
    this.reconnectTimeout = null;
    this.connected = false;
  }

  /**
   * Connect to SSE stream with specified channels
   * @param {string[]} channels - Array of channel names to subscribe to
   */
  connect(channels = ['all']) {
    // Add new channels to subscription set
    channels.forEach(ch => this.channels.add(ch));
    
    // If already connected, we're done (channels are cumulative)
    if (this.eventSource) {
      if (IS_DEV) {
        console.log('[SSE] Already connected, added channels:', channels);
      }
      return;
    }

    // Build channel query parameter
    const channelParam = Array.from(this.channels).join(',');
    const url = `/api/sse/stream?channels=${encodeURIComponent(channelParam)}`;
    
    if (IS_DEV) {
      console.log('[SSE] Connecting to:', url);
    }
    
    try {
      const token = getAuthAccessToken();
      this.eventSource = token
        ? new EventSourcePolyfill(url, {
            headers: { Authorization: `Bearer ${token}` },
            withCredentials: true,
            heartbeatTimeout: 120000, // 2 minutes (server sends heartbeat every 20s)
          })
        : new EventSource(url);
      
      this.eventSource.onopen = () => {
        if (IS_DEV) {
          console.log('[SSE] ✅ Connected');
        }
        this.connected = true;
        this.reconnectDelay = 5000; // Reset delay on successful connection
      };
      
      this.eventSource.onerror = (error) => {
        if (IS_DEV) {
          console.error('[SSE] Connection error:', error);
        }
        this.connected = false;
        this.disconnect();
        this.scheduleReconnect();
      };
      
      // Set up event listeners for all known event types
      this.setupEventListeners();
      
    } catch (error) {
      if (IS_DEV) {
        console.error('[SSE] Failed to create EventSource:', error);
      }
      this.scheduleReconnect();
    }
  }

  /**
   * Set up event listeners for all event types
   */
  setupEventListeners() {
    if (!this.eventSource) return;

    // Generic message handler (for events without explicit type)
    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (IS_DEV) {
          console.log('[SSE] Message:', data);
        }
        this.emit('message', data);
      } catch (error) {
        if (IS_DEV) {
          console.error('[SSE] Failed to parse message:', error);
        }
      }
    };

    // Connected event
    this.eventSource.addEventListener('connected', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (IS_DEV) {
          console.log('[SSE] Connected event:', data);
        }
        this.emit('connected', data);
      } catch (error) {
        if (IS_DEV) {
          console.error('[SSE] Failed to parse connected event:', error);
        }
      }
    });

    // Job events
    this.eventSource.addEventListener('job_completed', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (IS_DEV) {
          console.log('[SSE] Job completed:', data);
        }
        this.emit('job_completed', data);
        this.emit('job_update', data); // Also emit generic job_update
      } catch (error) {
        if (IS_DEV) {
          console.error('[SSE] Failed to parse job_completed:', error);
        }
      }
    });

    this.eventSource.addEventListener('job_started', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (IS_DEV) {
          console.log('[SSE] Job started:', data);
        }
        this.emit('job_started', data);
        this.emit('job_update', data);
      } catch (error) {
        if (IS_DEV) {
          console.error('[SSE] Failed to parse job_started:', error);
        }
      }
    });

    this.eventSource.addEventListener('job_failed', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (IS_DEV) {
          console.error('[SSE] Job failed:', data);
        }
        this.emit('job_failed', data);
        this.emit('job_update', data);
      } catch (error) {
        if (IS_DEV) {
          console.error('[SSE] Failed to parse job_failed:', error);
        }
      }
    });

    this.eventSource.addEventListener('job_update', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (IS_DEV) {
          console.log('[SSE] Job update:', data);
        }
        this.emit('job_update', data);
      } catch (error) {
        if (IS_DEV) {
          console.error('[SSE] Failed to parse job_update:', error);
        }
      }
    });

    // Pending changes events
    this.eventSource.addEventListener('pending_changes_state', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (IS_DEV) {
          console.log('[SSE] Pending changes state:', data);
        }
        this.emit('pending_changes_state', data);
      } catch (error) {
        if (IS_DEV) {
          console.error('[SSE] Failed to parse pending_changes_state:', error);
        }
      }
    });
  }

  /**
   * Disconnect from SSE stream
   */
  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.connected = false;
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  scheduleReconnect() {
    if (this.reconnectTimeout) {
      return; // Already scheduled
    }

    const delay = this.reconnectDelay;
    if (IS_DEV) {
      console.log(`[SSE] Will reconnect in ${delay}ms`);
    }

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (IS_DEV) {
        console.log('[SSE] Attempting to reconnect...');
      }
      this.connect(Array.from(this.channels));
    }, delay);
    
    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  /**
   * Register an event listener
   * @param {string} event - Event type
   * @param {Function} callback - Callback function
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  /**
   * Unregister an event listener
   * @param {string} event - Event type
   * @param {Function} callback - Callback function
   */
  off(event, callback) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  /**
   * Emit an event to all registered listeners
   * @param {string} event - Event type
   * @param {*} data - Event data
   */
  emit(event, data) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach(cb => {
        try {
          cb(data);
        } catch (error) {
          if (IS_DEV) {
            console.error(`[SSE] Error in listener for ${event}:`, error);
          }
        }
      });
    }
  }

  /**
   * Get connection status
   * @returns {boolean}
   */
  isConnected() {
    return this.connected;
  }
}

// Create singleton instance and persist on globalThis/window to survive HMR
const __g = (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}));

if (!__g.__sseClient) {
  __g.__sseClient = new SSEClient();
}

const sseClient = __g.__sseClient;

// HMR cleanup
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    // Don't disconnect on HMR - keep connection alive
    if (IS_DEV) {
      console.log('[SSE] HMR reload - keeping connection alive');
    }
  });
}

export default sseClient;
