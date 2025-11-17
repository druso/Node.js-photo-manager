const makeLogger = require('../utils/logger2');
const log = makeLogger('sse-multiplexer');

/**
 * SSE Multiplexer Service
 * Manages a single SSE connection pool and broadcasts events to subscribed channels
 * Reduces connection overhead from 2-4 connections per user to 1 connection per user
 */
class SSEMultiplexer {
  constructor() {
    this.connections = new Map(); // userId -> Set of response objects
    this.subscriptions = new Map(); // userId -> Set of channels
    this.heartbeatInterval = null;
    this.heartbeatIntervalMs = 20000; // 20 seconds (client timeout is 120s)
  }

  /**
   * Register a new SSE connection
   * @param {string} userId - User identifier (user ID or IP address)
   * @param {Response} res - Express response object
   * @param {string[]} channels - Array of channel names to subscribe to
   */
  addConnection(userId, res, channels = ['all']) {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
      this.subscriptions.set(userId, new Set());
    }
    
    this.connections.get(userId).add(res);
    channels.forEach(ch => this.subscriptions.get(userId).add(ch));
    
    log.info('sse_connection_added', {
      userId,
      channels,
      totalConnections: this.getTotalConnections(),
      uniqueUsers: this.connections.size
    });
    
    // Start heartbeat if first connection
    if (this.getTotalConnections() === 1) {
      this.startHeartbeat();
    }
  }

  /**
   * Remove a connection
   * @param {string} userId - User identifier
   * @param {Response} res - Express response object
   */
  removeConnection(userId, res) {
    const userConns = this.connections.get(userId);
    if (userConns) {
      userConns.delete(res);
      if (userConns.size === 0) {
        this.connections.delete(userId);
        this.subscriptions.delete(userId);
      }
    }
    
    log.info('sse_connection_removed', {
      userId,
      totalConnections: this.getTotalConnections(),
      uniqueUsers: this.connections.size
    });
    
    // Stop heartbeat if no connections
    if (this.getTotalConnections() === 0) {
      this.stopHeartbeat();
    }
  }

  /**
   * Broadcast event to all subscribers of a channel
   * @param {string} channel - Channel name (e.g., 'jobs', 'pending-changes', 'all')
   * @param {string} eventType - Event type name
   * @param {Object} data - Event data payload
   */
  broadcast(channel, eventType, data) {
    let sentCount = 0;
    const deadConnections = [];
    
    for (const [userId, channels] of this.subscriptions.entries()) {
      // Send to users subscribed to this channel or to 'all'
      if (channels.has(channel) || channels.has('all')) {
        const conns = this.connections.get(userId);
        if (conns) {
          for (const res of conns) {
            try {
              res.write(`event: ${eventType}\n`);
              res.write(`data: ${JSON.stringify(data)}\n\n`);
              if (typeof res.flush === 'function') res.flush();
              sentCount++;
            } catch (err) {
              log.error('sse_write_failed', { 
                userId, 
                channel, 
                eventType,
                error: err.message 
              });
              deadConnections.push({ userId, res });
            }
          }
        }
      }
    }
    
    // Clean up dead connections
    deadConnections.forEach(({ userId, res }) => {
      this.removeConnection(userId, res);
    });
    
    if (sentCount > 0) {
      log.debug('sse_broadcast', { 
        channel, 
        eventType, 
        sentCount,
        deadConnections: deadConnections.length
      });
    }
  }

  /**
   * Send a message directly to a specific user
   * @param {string} userId - User identifier
   * @param {string} eventType - Event type name
   * @param {Object} data - Event data payload
   */
  sendToUser(userId, eventType, data) {
    const conns = this.connections.get(userId);
    if (!conns) {
      log.debug('sse_send_to_user_not_found', { userId, eventType });
      return;
    }

    let sentCount = 0;
    const deadConnections = [];

    for (const res of conns) {
      try {
        res.write(`event: ${eventType}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof res.flush === 'function') res.flush();
        sentCount++;
      } catch (err) {
        log.error('sse_write_failed', { userId, eventType, error: err.message });
        deadConnections.push({ userId, res });
      }
    }

    // Clean up dead connections
    deadConnections.forEach(({ userId, res }) => {
      this.removeConnection(userId, res);
    });

    log.debug('sse_send_to_user', { userId, eventType, sentCount });
  }

  /**
   * Send heartbeat to all connections to keep them alive
   */
  sendHeartbeat() {
    const deadConnections = [];
    
    for (const [userId, conns] of this.connections.entries()) {
      for (const res of conns) {
        try {
          res.write(': heartbeat\n\n');
          if (typeof res.flush === 'function') res.flush();
        } catch (err) {
          // Connection is dead, mark for cleanup
          deadConnections.push({ userId, res });
        }
      }
    }
    
    // Clean up dead connections
    deadConnections.forEach(({ userId, res }) => {
      this.removeConnection(userId, res);
    });
    
    if (deadConnections.length > 0) {
      log.info('sse_heartbeat_cleanup', { 
        deadConnections: deadConnections.length,
        remainingConnections: this.getTotalConnections()
      });
    }
  }

  /**
   * Start periodic heartbeat
   */
  startHeartbeat() {
    if (this.heartbeatInterval) {
      return; // Already running
    }
    
    log.info('sse_heartbeat_started', { intervalMs: this.heartbeatIntervalMs });
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  /**
   * Stop periodic heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      log.info('sse_heartbeat_stopped');
    }
  }

  /**
   * Get total number of active connections
   * @returns {number}
   */
  getTotalConnections() {
    let total = 0;
    for (const conns of this.connections.values()) {
      total += conns.size;
    }
    return total;
  }

  /**
   * Get statistics about current connections
   * @returns {Object}
   */
  getStats() {
    const channelCounts = {};
    
    for (const channels of this.subscriptions.values()) {
      for (const channel of channels) {
        channelCounts[channel] = (channelCounts[channel] || 0) + 1;
      }
    }
    
    return {
      totalConnections: this.getTotalConnections(),
      uniqueUsers: this.connections.size,
      channelSubscriptions: channelCounts,
      heartbeatActive: !!this.heartbeatInterval
    };
  }

  /**
   * Get connection count for a specific user/IP
   * @param {string} userId - User identifier
   * @returns {number}
   */
  getConnectionCountForUser(userId) {
    const conns = this.connections.get(userId);
    return conns ? conns.size : 0;
  }
}

// Export singleton instance
module.exports = new SSEMultiplexer();
