# SSE Heartbeat Synchronization Fix

**Date**: November 16, 2025  
**Issue**: Client-side SSE timeout errors: "No activity within 120000 milliseconds. No response received. Reconnecting."

## Root Cause

The SSE multiplexer was sending heartbeats every 30 seconds, but **wasn't flushing the response stream**. This caused heartbeat messages to be buffered instead of sent immediately, especially through proxies and load balancers.

**Symptoms**:
- Client timeout after 120 seconds (2 minutes)
- Reconnection attempts in browser console
- Server logs showing heartbeats being sent, but client not receiving them

## The Problem

### Server-Side Issues:
1. **No Response Flushing**: `res.write()` calls weren't followed by `res.flush()`
2. **Buffering**: Node.js and intermediary proxies buffer SSE data
3. **Heartbeat Interval**: 30 seconds was too long for reliable delivery through proxies

### Client-Side Configuration:
- `heartbeatTimeout: 120000` (2 minutes)
- Expected heartbeats every 30 seconds
- Timeout triggered when no data received for 120 seconds

## The Fix

### File: `/server/services/sseMultiplexer.js`

**Changes**:

1. **Added `res.flush()` after all SSE writes**:
   - Broadcast method (line 91)
   - SendToUser method (line 141)
   - SendHeartbeat method (line 167)

2. **Reduced heartbeat interval from 30s to 20s** (line 14):
   ```javascript
   this.heartbeatIntervalMs = 20000; // 20 seconds (client timeout is 120s)
   ```

**Why flush() is critical**:
- Forces immediate transmission of buffered data
- Ensures heartbeats reach client before timeout
- Required for SSE to work reliably through proxies/load balancers
- Prevents intermediary buffering from delaying messages

### File: `/client/src/api/sseClient.js`

**Changes**:
- Updated comment to reflect new 20-second heartbeat interval

## Technical Details

### SSE Heartbeat Flow:
1. **Server**: Every 20 seconds, `sendHeartbeat()` is called
2. **Write**: `res.write(': heartbeat\\n\\n')` sends comment line
3. **Flush**: `res.flush()` forces immediate transmission
4. **Client**: Receives heartbeat, resets 120-second timeout
5. **Repeat**: Cycle continues every 20 seconds

### Timing Safety Margin:
- **Heartbeat interval**: 20 seconds
- **Client timeout**: 120 seconds
- **Safety margin**: 6x (can miss 5 heartbeats before timeout)
- **Network latency buffer**: ~100 seconds

### Why 20 seconds?
- Aggressive enough to prevent timeouts through proxies
- Conservative enough to avoid excessive network traffic
- Provides 6x safety margin before client timeout
- Aligns with industry best practices (15-30 seconds)

## Testing

To verify the fix:
1. **Restart the server**
2. **Open browser DevTools** → Network tab
3. **Filter for EventSource** connections
4. **Watch for heartbeat comments** every 20 seconds
5. **Leave browser idle** for 5+ minutes
6. **Verify no timeout errors** in console

### Expected Behavior:
- ✅ Heartbeats sent every 20 seconds
- ✅ No client-side timeout errors
- ✅ Stable SSE connection for hours
- ✅ Automatic reconnection only on actual network issues

## Additional Notes

### Other SSE Endpoints:
The `/api/jobs/stream` endpoint (in `routes/jobs.js`) already sends heartbeats every 25 seconds and likely has similar flushing issues. Consider applying the same fix if timeout errors occur there.

### Proxy Considerations:
Some proxies (nginx, Apache) have their own buffering settings. If issues persist:
- Check proxy configuration for SSE/chunked encoding
- Ensure `X-Accel-Buffering: no` header is set (nginx)
- Verify proxy timeout settings are > 120 seconds

## Status

- ✅ Bug identified
- ✅ Root cause analyzed
- ✅ Response flushing added to all SSE writes
- ✅ Heartbeat interval reduced to 20 seconds
- ✅ Client comment updated
- ⏳ Needs testing with server restart

## Related Files

- `/server/services/sseMultiplexer.js` - SSE connection pool and heartbeat
- `/client/src/api/sseClient.js` - Client-side SSE connection manager
- `/client/src/api/jobsApi.js` - Jobs SSE stream (separate endpoint)
- `/server/routes/jobs.js` - Legacy jobs SSE endpoint
