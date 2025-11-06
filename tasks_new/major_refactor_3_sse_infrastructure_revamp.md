# Major Refactoring Task 3: Jobs SSE Infrastructure Revamp

## Overview
Build a shared SSE manager that tracks per-IP/session tokens, handles idle timeouts, exposes metrics, and provides better connection lifecycle management. This eliminates reconnect storms, reduces 429 errors, and improves observability.

## Business Value
- **Better UX**: Eliminates connection storms causing 429 errors
- **Observability**: Metrics and monitoring for SSE connections
- **Reliability**: Proper connection lifecycle management
- **Scalability**: Better resource management for many concurrent users
- **Debugging**: Easier to diagnose SSE-related issues

## Estimated Effort
**2-3 days** spanning backend refactor and client adjustments

## Current Implementation Issues

### Problem 1: Basic Connection Tracking
**File**: `server/routes/jobs.js` (lines 14-15, 76-80, 115-116)

```javascript
// CURRENT: Simple Map with no lifecycle management
const ipConnCounts = new Map(); // ip -> count
const MAX_SSE_PER_IP = Number(process.env.SSE_MAX_CONN_PER_IP || 2);

// In route handler:
const current = ipConnCounts.get(ip) || 0;
if (current >= MAX_SSE_PER_IP) {
  return res.status(429).json({ error: 'Too many SSE connections from this IP' });
}
ipConnCounts.set(ip, current + 1);
```

**Issues**:
- No per-session tracking (can't distinguish multiple tabs from same IP)
- No connection metadata (start time, user agent, etc.)
- No metrics or monitoring
- Cleanup relies on request 'close' event only
- No graceful shutdown handling

### Problem 2: No Reconnect Backoff
**Client Side**: `client/src/api/jobsApi.js`

**Issues**:
- Client may reconnect immediately on disconnect
- Can cause connection storms during server restarts
- No exponential backoff strategy

### Problem 3: Limited Observability
**Current State**: Only basic logging, no metrics

**Missing**:
- Active connection count
- Connection duration stats
- Reconnect frequency
- Error rates
- Per-IP connection history

## Proposed Solution: SSE Manager Service

### Architecture Overview

Create a centralized SSE manager that:
1. Tracks all active connections with metadata
2. Enforces per-IP and per-session limits
3. Provides metrics and health endpoints
4. Handles graceful shutdown
5. Supports connection tokens for better tracking

### File Structure
```
server/services/
  sse/
    SSEManager.js          # Main manager class
    SSEConnection.js       # Individual connection wrapper
    SSEMetrics.js          # Metrics collection
    index.js               # Exports
```

## Implementation Details

### Step 1: Create SSEConnection Class

**File**: `server/services/sse/SSEConnection.js`

```javascript
const { v4: uuidv4 } = require('uuid');

class SSEConnection {
  constructor(req, res, options = {}) {
    this.id = uuidv4();
    this.req = req;
    this.res = res;
    this.ip = req.ip || req.connection?.remoteAddress || 'unknown';
    this.userAgent = req.headers['user-agent'] || 'unknown';
    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();
    this.messagesSent = 0;
    this.closed = false;
    
    // Options
    this.heartbeatInterval = options.heartbeatInterval || 25000;
    this.idleTimeout = options.idleTimeout || 5 * 60 * 1000;
    
    // Setup response
    this.setupResponse();
    
    // Start heartbeat and idle timer
    this.startHeartbeat();
    this.startIdleTimer();
    
    // Handle client disconnect
    this.req.on('close', () => this.close());
  }
  
  setupResponse() {
    this.res.setHeader('Content-Type', 'text/event-stream');
    this.res.setHeader('Cache-Control', 'no-cache');
    this.res.setHeader('Connection', 'keep-alive');
    this.res.setHeader('X-SSE-Connection-Id', this.id);
    this.res.flushHeaders && this.res.flushHeaders();
  }
  
  send(data, eventType = null) {
    if (this.closed) return false;
    
    try {
      if (eventType) {
        this.res.write(`event: ${eventType}\n`);
      }
      this.res.write(`data: ${JSON.stringify(data)}\n\n`);
      this.messagesSent++;
      this.lastActivityAt = Date.now();
      return true;
    } catch (err) {
      this.close();
      return false;
    }
  }
  
  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.closed) return;
      try {
        this.res.write(`: ping\n\n`);
        this.lastActivityAt = Date.now();
      } catch (err) {
        this.close();
      }
    }, this.heartbeatInterval);
  }
  
  startIdleTimer() {
    this.idleTimer = setTimeout(() => {
      if (this.closed) return;
      this.send({ reason: 'idle_timeout' }, 'bye');
      this.close();
    }, this.idleTimeout);
  }
  
  close() {
    if (this.closed) return;
    this.closed = true;
    
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.idleTimer);
    
    try {
      this.res.end();
    } catch (err) {
      // Ignore errors on close
    }
  }
  
  getMetadata() {
    return {
      id: this.id,
      ip: this.ip,
      userAgent: this.userAgent,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
      messagesSent: this.messagesSent,
      durationMs: Date.now() - this.createdAt,
      closed: this.closed
    };
  }
}

module.exports = SSEConnection;
```

### Step 2: Create SSEManager Class

**File**: `server/services/sse/SSEManager.js`

```javascript
const SSEConnection = require('./SSEConnection');
const SSEMetrics = require('./SSEMetrics');
const makeLogger = require('../../utils/logger2');
const log = makeLogger('sse-manager');

class SSEManager {
  constructor(options = {}) {
    this.connections = new Map(); // connectionId -> SSEConnection
    this.ipConnections = new Map(); // ip -> Set<connectionId>
    this.sessionConnections = new Map(); // sessionToken -> Set<connectionId>
    
    this.maxPerIp = options.maxPerIp || 2;
    this.maxPerSession = options.maxPerSession || 1;
    this.heartbeatInterval = options.heartbeatInterval || 25000;
    this.idleTimeout = options.idleTimeout || 5 * 60 * 1000;
    
    this.metrics = new SSEMetrics();
    
    // Cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }
  
  createConnection(req, res, sessionToken = null) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    
    // Check IP limit
    const ipConns = this.ipConnections.get(ip) || new Set();
    if (ipConns.size >= this.maxPerIp) {
      log.warn('sse_ip_limit_exceeded', { ip, current: ipConns.size, max: this.maxPerIp });
      return { error: 'Too many SSE connections from this IP', status: 429 };
    }
    
    // Check session limit if token provided
    if (sessionToken) {
      const sessionConns = this.sessionConnections.get(sessionToken) || new Set();
      if (sessionConns.size >= this.maxPerSession) {
        log.warn('sse_session_limit_exceeded', { 
          sessionToken, 
          current: sessionConns.size, 
          max: this.maxPerSession 
        });
        return { error: 'Too many SSE connections for this session', status: 429 };
      }
    }
    
    // Create connection
    const connection = new SSEConnection(req, res, {
      heartbeatInterval: this.heartbeatInterval,
      idleTimeout: this.idleTimeout
    });
    
    // Track connection
    this.connections.set(connection.id, connection);
    
    if (!this.ipConnections.has(ip)) {
      this.ipConnections.set(ip, new Set());
    }
    this.ipConnections.get(ip).add(connection.id);
    
    if (sessionToken) {
      if (!this.sessionConnections.has(sessionToken)) {
        this.sessionConnections.set(sessionToken, new Set());
      }
      this.sessionConnections.get(sessionToken).add(connection.id);
    }
    
    // Handle connection close
    const originalClose = connection.close.bind(connection);
    connection.close = () => {
      originalClose();
      this.removeConnection(connection.id, ip, sessionToken);
    };
    
    this.metrics.recordConnection();
    log.info('sse_connection_created', { 
      connectionId: connection.id, 
      ip, 
      sessionToken,
      totalActive: this.connections.size 
    });
    
    return { connection };
  }
  
  removeConnection(connectionId, ip, sessionToken) {
    this.connections.delete(connectionId);
    
    if (this.ipConnections.has(ip)) {
      this.ipConnections.get(ip).delete(connectionId);
      if (this.ipConnections.get(ip).size === 0) {
        this.ipConnections.delete(ip);
      }
    }
    
    if (sessionToken && this.sessionConnections.has(sessionToken)) {
      this.sessionConnections.get(sessionToken).delete(connectionId);
      if (this.sessionConnections.get(sessionToken).size === 0) {
        this.sessionConnections.delete(sessionToken);
      }
    }
    
    this.metrics.recordDisconnection();
    log.info('sse_connection_removed', { 
      connectionId, 
      ip, 
      sessionToken,
      totalActive: this.connections.size 
    });
  }
  
  broadcast(data, eventType = null) {
    let sent = 0;
    for (const conn of this.connections.values()) {
      if (conn.send(data, eventType)) {
        sent++;
      }
    }
    this.metrics.recordBroadcast(sent);
    return sent;
  }
  
  cleanup() {
    // Remove closed connections
    for (const [id, conn] of this.connections.entries()) {
      if (conn.closed) {
        this.removeConnection(id, conn.ip, null);
      }
    }
  }
  
  getStats() {
    return {
      activeConnections: this.connections.size,
      uniqueIps: this.ipConnections.size,
      uniqueSessions: this.sessionConnections.size,
      metrics: this.metrics.getStats(),
      connections: Array.from(this.connections.values()).map(c => c.getMetadata())
    };
  }
  
  shutdown() {
    log.info('sse_manager_shutdown', { activeConnections: this.connections.size });
    
    clearInterval(this.cleanupInterval);
    
    // Close all connections gracefully
    for (const conn of this.connections.values()) {
      conn.send({ reason: 'server_shutdown' }, 'bye');
      conn.close();
    }
    
    this.connections.clear();
    this.ipConnections.clear();
    this.sessionConnections.clear();
  }
}

module.exports = SSEManager;
```

### Step 3: Create SSEMetrics Class

**File**: `server/services/sse/SSEMetrics.js`

```javascript
class SSEMetrics {
  constructor() {
    this.totalConnections = 0;
    this.totalDisconnections = 0;
    this.totalBroadcasts = 0;
    this.totalMessagesSent = 0;
    this.connectionDurations = [];
    this.startTime = Date.now();
  }
  
  recordConnection() {
    this.totalConnections++;
  }
  
  recordDisconnection(durationMs = null) {
    this.totalDisconnections++;
    if (durationMs) {
      this.connectionDurations.push(durationMs);
      // Keep only last 1000 durations
      if (this.connectionDurations.length > 1000) {
        this.connectionDurations.shift();
      }
    }
  }
  
  recordBroadcast(recipientCount) {
    this.totalBroadcasts++;
    this.totalMessagesSent += recipientCount;
  }
  
  getStats() {
    const avgDuration = this.connectionDurations.length > 0
      ? this.connectionDurations.reduce((a, b) => a + b, 0) / this.connectionDurations.length
      : 0;
    
    return {
      totalConnections: this.totalConnections,
      totalDisconnections: this.totalDisconnections,
      totalBroadcasts: this.totalBroadcasts,
      totalMessagesSent: this.totalMessagesSent,
      avgConnectionDurationMs: Math.round(avgDuration),
      uptimeMs: Date.now() - this.startTime
    };
  }
}

module.exports = SSEMetrics;
```

### Step 4: Update Routes to Use SSEManager

**File**: `server/routes/jobs.js`

```javascript
const express = require('express');
const SSEManager = require('../services/sse/SSEManager');
// ... other imports ...

const router = express.Router();
router.use(express.json());

// Create SSE manager instance
const sseManager = new SSEManager({
  maxPerIp: Number(process.env.SSE_MAX_CONN_PER_IP || 2),
  maxPerSession: 1,
  heartbeatInterval: 25000,
  idleTimeout: Number(process.env.SSE_IDLE_TIMEOUT_MS || (5 * 60 * 1000))
});

// GET /api/jobs/stream -> SSE for job updates
router.get('/jobs/stream', (req, res) => {
  const sessionToken = req.query.session || req.headers['x-session-token'] || null;
  
  const result = sseManager.createConnection(req, res, sessionToken);
  
  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }
  
  const { connection } = result;
  
  // Subscribe to job updates
  const off = onJobUpdate((data) => {
    connection.send(data);
  });
  
  // Cleanup on close
  const originalClose = connection.close.bind(connection);
  connection.close = () => {
    off();
    originalClose();
  };
  
  // Send initial hello
  connection.send({ type: 'hello', connectionId: connection.id });
});

// GET /api/jobs/stream/stats -> SSE statistics (admin only)
router.get('/jobs/stream/stats', (req, res) => {
  // TODO: Add admin authentication
  res.json(sseManager.getStats());
});

// Graceful shutdown
process.on('SIGTERM', () => {
  sseManager.shutdown();
});

module.exports = router;
```

### Step 5: Client-Side Improvements

**File**: `client/src/api/jobsApi.js`

Add exponential backoff for reconnects:

```javascript
class SSEClient {
  constructor(url) {
    this.url = url;
    this.eventSource = null;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 30000; // 30 seconds max
    this.sessionToken = this.generateSessionToken();
  }
  
  generateSessionToken() {
    // Generate or retrieve session token from localStorage
    let token = localStorage.getItem('sse_session_token');
    if (!token) {
      token = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('sse_session_token', token);
    }
    return token;
  }
  
  connect() {
    const urlWithSession = `${this.url}?session=${this.sessionToken}`;
    this.eventSource = new EventSource(urlWithSession);
    
    this.eventSource.onopen = () => {
      console.log('SSE connected');
      this.reconnectAttempts = 0;
    };
    
    this.eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      this.eventSource.close();
      this.scheduleReconnect();
    };
    
    this.eventSource.addEventListener('bye', (event) => {
      const data = JSON.parse(event.data);
      console.log('SSE bye:', data.reason);
      this.eventSource.close();
      
      // Don't reconnect on server shutdown
      if (data.reason !== 'server_shutdown') {
        this.scheduleReconnect();
      }
    });
    
    return this.eventSource;
  }
  
  scheduleReconnect() {
    this.reconnectAttempts++;
    
    // Exponential backoff: 1s, 2s, 4s, 8s, ..., up to 30s
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );
    
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }
  
  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

// Export singleton
export const sseClient = new SSEClient('/api/jobs/stream');
```

## Testing Requirements

### Unit Tests

**File**: `server/services/sse/__tests__/SSEManager.test.js`

```javascript
describe('SSEManager', () => {
  let manager;
  
  beforeEach(() => {
    manager = new SSEManager({ maxPerIp: 2, maxPerSession: 1 });
  });
  
  afterEach(() => {
    manager.shutdown();
  });
  
  it('should enforce IP connection limits', () => {
    // Create mock req/res objects
    // Attempt to create 3 connections from same IP
    // Verify 3rd connection is rejected with 429
  });
  
  it('should enforce session connection limits', () => {
    // Create connections with same session token
    // Verify limit is enforced
  });
  
  it('should broadcast to all connections', () => {
    // Create multiple connections
    // Broadcast a message
    // Verify all connections received it
  });
  
  it('should cleanup closed connections', () => {
    // Create connection
    // Close it
    // Run cleanup
    // Verify it's removed from tracking
  });
  
  it('should track metrics correctly', () => {
    // Create and close connections
    // Broadcast messages
    // Verify metrics are accurate
  });
});
```

### Integration Tests
1. **Connection Limits**: Verify IP and session limits work
2. **Reconnect Backoff**: Verify client uses exponential backoff
3. **Graceful Shutdown**: Verify connections close cleanly on server shutdown
4. **Message Delivery**: Verify broadcasts reach all connections
5. **Metrics Endpoint**: Verify stats endpoint returns accurate data

### Load Testing
Create a load test script:

```javascript
// test-sse-load.js
const EventSource = require('eventsource');

async function loadTest(concurrentConnections = 10) {
  const connections = [];
  
  for (let i = 0; i < concurrentConnections; i++) {
    const es = new EventSource('http://localhost:3001/api/jobs/stream');
    connections.push(es);
    
    es.onmessage = (event) => {
      console.log(`Connection ${i} received:`, event.data);
    };
  }
  
  // Keep connections open for 5 minutes
  await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
  
  // Close all
  connections.forEach(es => es.close());
}

loadTest(50).catch(console.error);
```

### Manual Testing Checklist
- [ ] Open multiple browser tabs, verify connection limits
- [ ] Close tabs, verify connections are cleaned up
- [ ] Restart server, verify graceful shutdown
- [ ] Check `/api/jobs/stream/stats` endpoint
- [ ] Monitor memory usage with many connections
- [ ] Test reconnect behavior after network interruption
- [ ] Verify metrics are accurate

## Documentation Updates

### Files to Update
1. **`project_docs/PROJECT_OVERVIEW.md`**
   - Add "SSE Infrastructure" section
   - Document connection limits and lifecycle
   - Document metrics endpoint

2. **`project_docs/SCHEMA_DOCUMENTATION.md`**
   - Document SSE connection flow
   - Document session token usage
   - Document stats endpoint

3. **`README.md`**
   - Update SSE section with new features
   - Document environment variables

4. **`SECURITY.md`**
   - Document SSE security considerations
   - Note: Session tokens prevent connection storms
   - Note: Metrics endpoint should be admin-only

## Success Criteria
- [ ] SSEManager class implemented and tested
- [ ] Connection limits enforced (IP and session)
- [ ] Metrics collection working
- [ ] Stats endpoint available
- [ ] Client exponential backoff implemented
- [ ] Graceful shutdown working
- [ ] All tests passing
- [ ] Load testing completed
- [ ] Documentation updated
- [ ] Code review approved

## Potential Challenges & Solutions

### Challenge 1: Session Token Management
**Problem**: How to generate and persist session tokens?

**Solution**: Use localStorage on client, generate UUID on first connection

### Challenge 2: Metrics Storage
**Problem**: Metrics might grow unbounded

**Solution**: Use circular buffers, keep only recent data (last 1000 samples)

### Challenge 3: Graceful Shutdown
**Problem**: How to ensure all connections close cleanly?

**Solution**: Send 'bye' event before closing, use SIGTERM handler

## Notes for Junior Developer
- **Start with Tests**: Write tests first to understand expected behavior
- **Mock Carefully**: SSE testing requires careful mocking of req/res objects
- **Monitor Logs**: Add detailed logging to understand connection lifecycle
- **Test Reconnects**: Use browser DevTools to simulate network interruptions
- **Ask Questions**: SSE can be tricky, don't hesitate to ask for help

## Related Files
- `server/routes/jobs.js` - SSE endpoint
- `server/services/events.js` - Job update events
- `client/src/api/jobsApi.js` - Client SSE handling
- `client/src/App.jsx` - SSE consumer
