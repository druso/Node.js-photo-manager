# Sprint 3: SSE Connection Consolidation

**Priority**: HIGH  
**Expected Impact**: 50-75% reduction in SSE connections, 75% memory savings

---

## Objective

Consolidate multiple SSE endpoints into a single unified stream with server-side multiplexing to reduce connection overhead and prevent connection leaks.

---

## Problem Analysis

### Current Architecture

**Multiple SSE Endpoints**:
- `/api/jobs/stream` - Job updates
- `/api/sse/pending-changes` - Pending changes

**Issues**:
- 2-4 connections per user
- Connection leaks during HMR (hot module reload)
- High memory usage (4-16MB per user)
- Potential 429 errors

### Target Architecture

**Single SSE Endpoint**:
- `/api/sse/stream` - All events multiplexed

**Benefits**:
- 1 connection per user
- No connection leaks
- Lower memory usage (1-2MB per user)
- Better connection management

---

## Implementation Tasks

### Task 1: Create SSE Multiplexer Service

**File**: `server/services/sseMultiplexer.js` (NEW)

```javascript
const makeLogger = require('../utils/logger2');
const log = makeLogger('sse-multiplexer');

class SSEMultiplexer {
  constructor() {
    this.connections = new Map(); // userId -> Set of response objects
    this.subscriptions = new Map(); // userId -> Set of channels
    this.heartbeatInterval = null;
  }

  /**
   * Register a new SSE connection
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
      totalConnections: this.getTotalConnections()
    });
    
    // Start heartbeat if first connection
    if (this.getTotalConnections() === 1) {
      this.startHeartbeat();
    }
  }

  /**
   * Remove a connection
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
      totalConnections: this.getTotalConnections()
    });
    
    // Stop heartbeat if no connections
    if (this.getTotalConnections() === 0) {
      this.stopHeartbeat();
    }
  }

  /**
   * Broadcast event to all subscribers of a channel
   */
  broadcast(channel, eventType, data) {
    let sentCount = 0;
    
    for (const [userId, channels] of this.subscriptions.entries()) {
      if (channels.has(channel) || channels.has('all')) {
        const conns = this.connections.get(userId);
        if (conns) {
          for (const res of conns) {
            try {
              res.write(`event: ${eventType}\n`);
              res.write(`data: ${JSON.stringify(data)}\n\n`);
              sentCount++;
            } catch (err) {
              log.error('sse_write_failed', { userId, error: err.message });
              this.removeConnection(userId, res);
            }
          }
        }
      }
    }
    
    log.debug('sse_broadcast', { channel, eventType, sentCount });
  }

  /**
   * Send heartbeat to all connections
   */
  sendHeartbeat() {
    for (const conns of this.connections.values()) {
      for (const res of conns) {
        try {
          res.write(': heartbeat\n\n');
        } catch (err) {
          // Connection dead, will be cleaned up
        }
      }
    }
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), 30000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  getTotalConnections() {
    let total = 0;
    for (const conns of this.connections.values()) {
      total += conns.size;
    }
    return total;
  }
}

module.exports = new SSEMultiplexer();
```

### Task 2: Create Unified SSE Endpoint

**File**: `server/routes/sse.js`

Replace existing endpoints with:

```javascript
const express = require('express');
const router = express.Router();
const sseMultiplexer = require('../services/sseMultiplexer');
const makeLogger = require('../utils/logger2');
const log = makeLogger('sse-routes');

router.get('/stream', (req, res) => {
  const userId = req.user?.id || req.ip;
  const channels = req.query.channels ? req.query.channels.split(',') : ['all'];
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  // Add connection
  sseMultiplexer.addConnection(userId, res, channels);
  
  // Send initial connected event
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ channels })}\n\n`);
  
  // Handle client disconnect
  req.on('close', () => {
    sseMultiplexer.removeConnection(userId, res);
  });
});

module.exports = router;
```

### Task 3: Update Event Emitters

**File**: `server/services/jobRunner.js`

Replace direct SSE writes with multiplexer:

```javascript
const sseMultiplexer = require('./sseMultiplexer');

// When job completes
function onJobComplete(job) {
  sseMultiplexer.broadcast('jobs', 'job_completed', {
    id: job.id,
    task_type: job.task_type,
    status: job.status
  });
}

// When job starts
function onJobStart(job) {
  sseMultiplexer.broadcast('jobs', 'job_started', {
    id: job.id,
    task_type: job.task_type
  });
}
```

**File**: `server/services/manifestService.js`

```javascript
const sseMultiplexer = require('./sseMultiplexer');

function notifyManifestChange(projectFolder) {
  sseMultiplexer.broadcast('pending-changes', 'manifest_changed', {
    project_folder: projectFolder,
    timestamp: Date.now()
  });
}
```

### Task 4: Create Client SSE Manager

**File**: `client/src/api/sseClient.js` (NEW)

```javascript
class SSEClient {
  constructor() {
    this.eventSource = null;
    this.listeners = new Map();
    this.reconnectDelay = 5000;
    this.maxReconnectDelay = 60000;
    this.reconnectTimeout = null;
  }

  connect(channels = ['all']) {
    if (this.eventSource) {
      return; // Already connected
    }

    const channelParam = channels.join(',');
    const url = `/api/sse/stream?channels=${channelParam}`;
    
    this.eventSource = new EventSource(url);
    
    this.eventSource.onopen = () => {
      console.log('[SSE] Connected');
      this.reconnectDelay = 5000; // Reset delay
    };
    
    this.eventSource.onerror = () => {
      console.error('[SSE] Connection error');
      this.disconnect();
      this.scheduleReconnect(channels);
    };
    
    // Forward events to listeners
    this.eventSource.addEventListener('job_completed', (e) => {
      this.emit('job_completed', JSON.parse(e.data));
    });
    
    this.eventSource.addEventListener('manifest_changed', (e) => {
      this.emit('manifest_changed', JSON.parse(e.data));
    });
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  scheduleReconnect(channels) {
    this.reconnectTimeout = setTimeout(() => {
      this.connect(channels);
    }, this.reconnectDelay);
    
    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  off(event, callback) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  emit(event, data) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach(cb => cb(data));
    }
  }
}

// Singleton instance
const sseClient = new SSEClient();

// HMR cleanup
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    sseClient.disconnect();
  });
}

export default sseClient;
```

### Task 5: Update Client Components

**File**: `client/src/hooks/usePendingChangesSSE.js`

Replace with:

```javascript
import { useEffect } from 'react';
import sseClient from '../api/sseClient';

export function usePendingChangesSSE(onUpdate) {
  useEffect(() => {
    sseClient.connect(['pending-changes']);
    sseClient.on('manifest_changed', onUpdate);
    
    return () => {
      sseClient.off('manifest_changed', onUpdate);
    };
  }, [onUpdate]);
}
```

**File**: `client/src/hooks/useJobsSSE.js`

```javascript
import { useEffect } from 'react';
import sseClient from '../api/sseClient';

export function useJobsSSE(onJobComplete) {
  useEffect(() => {
    sseClient.connect(['jobs']);
    sseClient.on('job_completed', onJobComplete);
    
    return () => {
      sseClient.off('job_completed', onJobComplete);
    };
  }, [onJobComplete]);
}
```

---

## Verification Checklist

- [ ] SSEMultiplexer service created
- [ ] Unified `/api/sse/stream` endpoint created
- [ ] Old SSE endpoints removed
- [ ] All event emitters updated to use multiplexer
- [ ] Client SSEClient created
- [ ] All client hooks updated
- [ ] HMR cleanup working
- [ ] No connection leaks
- [ ] Heartbeat working
- [ ] All events routing correctly

---

## Testing

### Connection Count Test

```javascript
// Open browser console
// Check connection count
fetch('/api/sse/stats').then(r => r.json()).then(console.log);

// Should show 1 connection per tab
```

### HMR Test

1. Open app in dev mode
2. Make code change (trigger HMR)
3. Check connection count
4. Should still be 1 connection (not 2+)

### Event Routing Test

1. Upload a photo
2. Verify job events received
3. Verify manifest events received
4. All via single connection

---

## Success Metrics

- **Connections per user**: 1 (was 2-4)
- **Memory per user**: 1-2MB (was 4-16MB)
- **Connection leaks**: 0
- **429 errors**: 0
