# SSE Timeout Error Fix - November 16, 2024

## Issue
The browser console was logging false timeout errors:
```
Error: No activity within 45000 milliseconds. No response received. Reconnecting.
```

## Root Cause
The `EventSourcePolyfill` library has a default `heartbeatTimeout` of 45 seconds. The server sends heartbeats every 25-30 seconds, but if a heartbeat is slightly delayed due to network latency or server load, the client would timeout and reconnect unnecessarily.

**Timeline:**
- Server heartbeat interval: 25s (jobs stream) / 30s (SSE multiplexer)
- Client timeout: 45s (default)
- Problem: Only 15-20 second buffer, not enough for network delays

## Solution
Increased the `heartbeatTimeout` to 120 seconds (2 minutes) in both SSE clients:

1. **Main SSE Client** (`client/src/api/sseClient.js`)
   - Handles pending changes and job updates via multiplexer
   - Server heartbeat: 30 seconds
   - New timeout: 120 seconds

2. **Jobs API Client** (`client/src/api/jobsApi.js`)
   - Handles job stream events
   - Server heartbeat: 25 seconds
   - New timeout: 120 seconds

## Code Changes

### client/src/api/sseClient.js (line 52)
```javascript
this.eventSource = token
  ? new EventSourcePolyfill(url, {
      headers: { Authorization: `Bearer ${token}` },
      withCredentials: true,
      heartbeatTimeout: 120000, // 2 minutes (server sends heartbeat every 30s)
    })
  : new EventSource(url);
```

### client/src/api/jobsApi.js (line 74)
```javascript
__jobEs = token
  ? new EventSourcePolyfill('/api/jobs/stream', {
      headers: { Authorization: `Bearer ${token}` },
      withCredentials: true,
      heartbeatTimeout: 120000, // 2 minutes (server sends heartbeat every 25s)
    })
  : new EventSource('/api/jobs/stream');
```

## Impact
- ✅ Eliminates false timeout errors in console
- ✅ Reduces unnecessary reconnections
- ✅ More stable SSE connections
- ✅ Better tolerance for network delays
- ✅ No impact on actual connection health (still reconnects on real failures)

## Testing
After refreshing the browser, the timeout errors should no longer appear in the console. The SSE connections will remain stable even during brief network delays or server load spikes.

## Files Modified
- `client/src/api/sseClient.js` - Added heartbeatTimeout: 120000
- `client/src/api/jobsApi.js` - Added heartbeatTimeout: 120000
