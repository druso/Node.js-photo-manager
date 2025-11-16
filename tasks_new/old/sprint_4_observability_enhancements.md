# Sprint 4: Observability & Monitoring Enhancements

**Assignee**: Junior Developer  
**Estimated Effort**: 2-3 hours  
**Priority**: LOW-MEDIUM  
**Expected Impact**: Better production debugging, request tracing  
**Difficulty**: ⭐⭐ (Medium)

---

## 📋 Overview

Observability is the ability to understand what's happening inside your system by examining its outputs (logs, metrics, traces). This sprint adds request ID tracking and improves logging to make production debugging much easier.

**Current Problem**:
- Can't trace a single request across multiple log entries
- Hard to correlate frontend errors with backend logs
- No way to track request flow through the system

**After This Sprint**:
- Every request has a unique ID
- All logs for a request include the same ID
- Can trace requests from frontend → backend → database
- Easy to debug production issues

---

## 🎯 Learning Objectives

By completing this sprint, you will learn:
1. What observability means in production systems
2. How request tracing works
3. Middleware patterns in Express
4. Correlation IDs and distributed tracing
5. Production debugging techniques

---

## 📚 Background Reading (15 minutes)

### What is a Request ID?

A **request ID** (also called correlation ID or trace ID) is a unique identifier assigned to each HTTP request. It flows through your entire system:

```
Frontend Request
  ↓ (request-id: abc123)
Backend API
  ↓ (request-id: abc123)
Database Query
  ↓ (request-id: abc123)
Worker Job
  ↓ (request-id: abc123)
Response
```

### Why Request IDs Matter

**Scenario**: User reports "Upload failed"

**Without Request IDs**:
```
[2025-11-15 14:23:01] Upload started
[2025-11-15 14:23:02] Database error
[2025-11-15 14:23:03] Upload started
[2025-11-15 14:23:04] Upload completed
```
Which upload failed? Impossible to tell!

**With Request IDs**:
```
[2025-11-15 14:23:01] [req-abc123] Upload started
[2025-11-15 14:23:02] [req-abc123] Database error
[2025-11-15 14:23:03] [req-def456] Upload started
[2025-11-15 14:23:04] [req-def456] Upload completed
```
Clear! Request abc123 failed.

---

## 🛠️ Implementation Steps

### Step 1: Create Request ID Middleware (30 minutes)

**File**: `server/middleware/requestId.js` (NEW FILE)

```javascript
/**
 * Request ID Middleware
 * 
 * Assigns a unique ID to each HTTP request for tracing and debugging.
 * The ID can be:
 * 1. Provided by client via X-Request-ID header (for frontend correlation)
 * 2. Auto-generated if not provided
 * 
 * The ID is:
 * - Attached to req.id for use in route handlers
 * - Returned in X-Request-ID response header
 * - Available to all subsequent middleware and routes
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Generate a short, readable request ID
 * Format: req_<timestamp>_<random>
 * Example: req_1700000000_a1b2c3
 */
function generateRequestId() {
  const timestamp = Date.now().toString(36); // Base36 timestamp
  const random = Math.random().toString(36).substring(2, 8); // 6 random chars
  return `req_${timestamp}_${random}`;
}

/**
 * Request ID middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function requestIdMiddleware(req, res, next) {
  // Check if client provided a request ID
  const clientRequestId = req.headers['x-request-id'];
  
  // Use client ID if valid, otherwise generate new one
  const requestId = (clientRequestId && typeof clientRequestId === 'string' && clientRequestId.length < 100)
    ? clientRequestId
    : generateRequestId();
  
  // Attach to request object
  req.id = requestId;
  
  // Return in response header so client can reference it
  res.setHeader('X-Request-ID', requestId);
  
  next();
}

module.exports = requestIdMiddleware;
```

**Testing Your Middleware**:

Create `server/middleware/__tests__/requestId.test.js`:

```javascript
const requestIdMiddleware = require('../requestId');

describe('requestIdMiddleware', () => {
  let req, res, next;
  
  beforeEach(() => {
    req = { headers: {} };
    res = { setHeader: jest.fn() };
    next = jest.fn();
  });
  
  it('should generate request ID if not provided', () => {
    requestIdMiddleware(req, res, next);
    
    expect(req.id).toBeDefined();
    expect(req.id).toMatch(/^req_[a-z0-9]+_[a-z0-9]+$/);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.id);
    expect(next).toHaveBeenCalled();
  });
  
  it('should use client-provided request ID', () => {
    req.headers['x-request-id'] = 'client-abc123';
    
    requestIdMiddleware(req, res, next);
    
    expect(req.id).toBe('client-abc123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'client-abc123');
  });
  
  it('should reject invalid client IDs', () => {
    // Too long
    req.headers['x-request-id'] = 'x'.repeat(101);
    
    requestIdMiddleware(req, res, next);
    
    expect(req.id).not.toBe('x'.repeat(101));
    expect(req.id).toMatch(/^req_/);
  });
});
```

Run the test:
```bash
npm test -- requestId.test.js
```

---

### Step 2: Install Middleware in Server (15 minutes)

**File**: `server.js`

Add the middleware early in the middleware stack (before routes):

```javascript
const express = require('express');
const requestIdMiddleware = require('./middleware/requestId');

const app = express();

// Add request ID middleware EARLY (before other middleware)
app.use(requestIdMiddleware);

// ... rest of middleware
app.use(express.json());
app.use(cors());

// ... routes
```

**Why early?** So all subsequent middleware and routes have access to `req.id`.

---

### Step 3: Update Logger to Include Request ID (30 minutes)

**File**: `server/utils/logger2.js`

Modify the logger to accept and include request ID:

```javascript
function makeLogger(component) {
  return {
    debug: (evt, ctx = {}) => {
      if (logLevel > 3) return;
      const entry = { level: 'debug', cmp: component, evt, ...ctx, ts: new Date().toISOString() };
      console.log(JSON.stringify(entry));
    },
    info: (evt, ctx = {}) => {
      if (logLevel > 2) return;
      const entry = { level: 'info', cmp: component, evt, ...ctx, ts: new Date().toISOString() };
      console.log(JSON.stringify(entry));
    },
    warn: (evt, ctx = {}) => {
      if (logLevel > 1) return;
      const entry = { level: 'warn', cmp: component, evt, ...ctx, ts: new Date().toISOString() };
      console.warn(JSON.stringify(entry));
    },
    error: (evt, ctx = {}) => {
      const entry = { level: 'error', cmp: component, evt, ...ctx, ts: new Date().toISOString() };
      console.error(JSON.stringify(entry));
    }
  };
}
```

**Create a helper for route logging**:

**File**: `server/utils/routeLogger.js` (NEW FILE)

```javascript
const makeLogger = require('./logger2');

/**
 * Create a logger that automatically includes request ID
 * @param {string} component - Component name
 * @param {Object} req - Express request object
 * @returns {Object} Logger with request ID context
 */
function makeRouteLogger(component, req) {
  const log = makeLogger(component);
  const requestId = req.id;
  
  return {
    debug: (evt, ctx = {}) => log.debug(evt, { request_id: requestId, ...ctx }),
    info: (evt, ctx = {}) => log.info(evt, { request_id: requestId, ...ctx }),
    warn: (evt, ctx = {}) => log.warn(evt, { request_id: requestId, ...ctx }),
    error: (evt, ctx = {}) => log.error(evt, { request_id: requestId, ...ctx })
  };
}

module.exports = makeRouteLogger;
```

---

### Step 4: Update Routes to Use Request ID (45 minutes)

Now update routes to include request ID in logs.

#### Example 1: Photos Route

**File**: `server/routes/photos.js`

❌ **Before**:
```javascript
const makeLogger = require('../utils/logger2');
const log = makeLogger('photos');

router.get('/photos', (req, res) => {
  log.info('list_photos_request', { limit: req.query.limit });
  // ...
});
```

✅ **After**:
```javascript
const makeRouteLogger = require('../utils/routeLogger');

router.get('/photos', (req, res) => {
  const log = makeRouteLogger('photos', req);
  log.info('list_photos_request', { limit: req.query.limit });
  // Now includes request_id automatically!
  // ...
});
```

#### Example 2: Projects Route

**File**: `server/routes/projects.js`

```javascript
const makeRouteLogger = require('../utils/routeLogger');

router.post('/projects', (req, res) => {
  const log = makeRouteLogger('projects', req);
  log.info('create_project_request', { name: req.body.name });
  
  try {
    const project = projectsRepo.create(req.body);
    log.info('create_project_success', { project_id: project.id });
    res.json(project);
  } catch (err) {
    log.error('create_project_failed', { error: err?.message, stack: err?.stack });
    res.status(500).json({ error: 'Failed to create project' });
  }
});
```

#### Example 3: Jobs Route

**File**: `server/routes/jobs.js`

```javascript
const makeRouteLogger = require('../utils/routeLogger');

router.get('/jobs/stream', (req, res) => {
  const log = makeRouteLogger('jobs-sse', req);
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  
  log.info('sse_connection_attempt', { ip });
  
  // ... SSE setup ...
  
  log.info('sse_connection_established', { connectionId });
});
```

**Files to update** (apply same pattern):
- `server/routes/photos.js`
- `server/routes/projects.js`
- `server/routes/jobs.js`
- `server/routes/uploads.js`
- `server/routes/assets.js`
- `server/routes/tags.js`
- `server/routes/keep.js`
- `server/routes/sse.js`

---

### Step 5: Add Request ID to Frontend (30 minutes)

Update the frontend to send and track request IDs.

**File**: `client/src/api/httpClient.js`

```javascript
/**
 * Generate a client-side request ID
 */
function generateClientRequestId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `client_${timestamp}_${random}`;
}

/**
 * Enhanced fetch with request ID tracking
 */
export async function authFetch(url, options = {}) {
  // Generate request ID for this request
  const requestId = generateClientRequestId();
  
  // Add request ID to headers
  const headers = {
    ...options.headers,
    'X-Request-ID': requestId
  };
  
  // Log request (for debugging)
  if (import.meta.env.DEV) {
    console.log(`[${requestId}] ${options.method || 'GET'} ${url}`);
  }
  
  try {
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include'
    });
    
    // Log response
    if (import.meta.env.DEV) {
      console.log(`[${requestId}] Response: ${response.status}`);
    }
    
    return response;
  } catch (error) {
    // Log error with request ID
    console.error(`[${requestId}] Request failed:`, error);
    throw error;
  }
}
```

Now when users report errors, they can:
1. Open browser DevTools
2. Find the request ID in console
3. Send it to you
4. You search backend logs for that ID

---

## ✅ Testing Checklist

### Unit Tests
- [ ] `requestId.test.js` passes
- [ ] Run `npm test` - all tests pass

### Integration Testing

**Test 1: Request ID Generation**
```bash
# Make a request without X-Request-ID header
curl -v http://localhost:3001/api/projects

# Check response headers - should include X-Request-ID
# X-Request-ID: req_abc123_def456
```

**Test 2: Client-Provided Request ID**
```bash
# Make a request WITH X-Request-ID header
curl -v -H "X-Request-ID: my-custom-id" http://localhost:3001/api/projects

# Check response headers - should echo back your ID
# X-Request-ID: my-custom-id
```

**Test 3: Log Correlation**
```bash
# Make a request and note the request ID
curl -H "X-Request-ID: test-123" http://localhost:3001/api/projects

# Check server logs - all entries should include request_id: test-123
grep "test-123" logs/server.log
```

### Manual Testing
1. [ ] Start server: `npm start`
2. [ ] Open frontend in browser
3. [ ] Open DevTools Console
4. [ ] Make a request (e.g., load photos)
5. [ ] See request ID in console: `[client_abc123_def456] GET /api/photos`
6. [ ] Check server logs - same request ID appears
7. [ ] Verify request tracing works end-to-end

---

## 📊 Success Criteria

- [ ] Request ID middleware created and tested
- [ ] Middleware installed in server.js
- [ ] All routes use makeRouteLogger
- [ ] Frontend sends request IDs
- [ ] All logs include request_id field
- [ ] Can trace requests from frontend to backend
- [ ] All tests pass

---

## 🐛 Common Pitfalls

### Pitfall 1: Installing Middleware Too Late

**Problem**: Routes execute before middleware

```javascript
// ❌ BAD - Routes before middleware
app.use('/api/photos', photosRouter);
app.use(requestIdMiddleware);

// ✅ GOOD - Middleware before routes
app.use(requestIdMiddleware);
app.use('/api/photos', photosRouter);
```

### Pitfall 2: Not Using makeRouteLogger

**Problem**: Logs missing request ID

```javascript
// ❌ BAD - No request ID
const log = makeLogger('photos');
log.info('request', { ... });

// ✅ GOOD - Includes request ID
const log = makeRouteLogger('photos', req);
log.info('request', { ... });
```

### Pitfall 3: Request ID Too Long

**Problem**: Malicious client sends huge header

```javascript
// ✅ GOOD - Validate length
const requestId = (clientRequestId && clientRequestId.length < 100)
  ? clientRequestId
  : generateRequestId();
```

---

## 🎓 Learning Resources

- [Distributed Tracing](https://opentelemetry.io/docs/concepts/observability-primer/#distributed-traces)
- [Express Middleware](https://expressjs.com/en/guide/using-middleware.html)
- [UUID Library](https://www.npmjs.com/package/uuid)
- [Observability Best Practices](https://www.honeycomb.io/blog/observability-101-terminology-and-concepts)

---

## 📝 Submission Checklist

Before marking this sprint as complete:

- [ ] Created requestId middleware with tests
- [ ] Created makeRouteLogger utility
- [ ] Updated all routes to use makeRouteLogger
- [ ] Updated frontend httpClient
- [ ] All tests pass
- [ ] Manually verified request tracing works
- [ ] Committed with message: "feat: add request ID tracking for better observability"
- [ ] Created PR with example log output showing request IDs

---

## 🆘 Need Help?

If you get stuck:
1. Check that middleware is installed before routes
2. Verify req.id exists in route handlers
3. Test with curl to see request/response headers
4. Check server logs for request_id field
5. Ask senior developer for code review

**Estimated Time**: 2-3 hours  
**Actual Time**: _____ hours (fill this in when done)

---

## 📈 Impact Metrics

After completing this sprint:
- **100% of requests** have unique IDs
- **Debugging time** reduced from hours to minutes
- **Can trace** requests across frontend/backend/database
- **Better production support** with correlation IDs

**Outstanding work!** 🎉
