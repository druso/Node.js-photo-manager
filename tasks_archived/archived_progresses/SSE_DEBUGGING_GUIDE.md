# SSE Toolbar Debugging Guide

## Added Debug Logging

### Backend Logging
**File**: `server/routes/sse.js`
- Connection events: `[SSE] Client connected: {id}, total connections: {count}`
- Initial state: `[SSE] Sending initial state to client: {...}`
- Database check: `[SSE] Database check: { totalPhotos, totalMismatches }`
- Projects with mismatches: `[SSE] Projects with mismatches: [...]`
- Current state: `[SSE] Current pending changes state: {...}`

### Frontend Logging
**File**: `client/src/hooks/usePendingChangesSSE.js`
- Connection attempt: `[SSE] Attempting to connect to /api/sse/pending-changes`
- Connection success: `[SSE] ✅ Connected to pending changes stream`
- Message received: `[SSE] Received pending changes update: {...}`

**File**: `client/src/hooks/usePendingDeletes.js`
- State calculation: Shows all relevant state values

## Testing Steps

### 1. Check Backend SSE Endpoint

Open browser console and look for:
```
[SSE] Attempting to connect to /api/sse/pending-changes
[SSE] ✅ Connected to pending changes stream
[SSE] Received pending changes update: { ... }
```

### 2. Check Server Logs

Look for:
```
[SSE] Client connected: {id}, total connections: 1
[SSE] Database check: { totalPhotos: 1092, totalMismatches: X }
[SSE] Projects with mismatches: [ { project_folder: 'p15', mismatch_count: 6 } ]
[SSE] Current pending changes state: { p15: true }
[SSE] Sending initial state to client: { p15: true }
```

### 3. Check Frontend State

Look for:
```
[usePendingDeletes] {
  isAllPhotosView: false,
  selectedProject: 'p15',
  pendingChangesSSE: { p15: true },
  hasPendingDeletesAll: true,
  hasPendingDeletesProject: true,
  hasPendingDeletes: true,
  pendingProjectsCount: 1
}
```

## Common Issues

### Issue 1: SSE Not Connecting
**Symptoms**: No `[SSE] ✅ Connected` message in browser console

**Possible Causes**:
- CORS issue
- Proxy/nginx buffering
- EventSource not supported

**Check**:
1. Open Network tab in browser DevTools
2. Look for `/api/sse/pending-changes` request
3. Check if it's in "pending" state (good) or failed (bad)

### Issue 2: No Pending Changes Detected
**Symptoms**: `[SSE] Database check: { totalMismatches: 0 }`

**Possible Causes**:
- No photos marked as "don't keep"
- Database not updated after marking photos

**Fix**:
1. Go to a project
2. Open a photo
3. Mark JPG or RAW as "don't keep"
4. Check server logs for database update

### Issue 3: Toolbar Not Showing
**Symptoms**: `hasPendingDeletes: false` even though `pendingChangesSSE` has data

**Possible Causes**:
- Wrong project selected
- View context not set correctly
- Logic error in `usePendingDeletes`

**Check**:
1. Look at `[usePendingDeletes]` log
2. Verify `selectedProject` matches key in `pendingChangesSSE`
3. Verify `isAllPhotosView` is correct for current mode

## Manual Database Check

To verify there are actually pending changes:

```bash
cd /home/druso/code/Node.js\ photo\ manager
sqlite3 .projects/db/user_0.sqlite

# Check for mismatches
SELECT 
  project_folder,
  filename,
  jpg_available,
  keep_jpg,
  raw_available,
  keep_raw
FROM photos
WHERE (jpg_available = 1 AND keep_jpg = 0) OR (raw_available = 1 AND keep_raw = 0)
LIMIT 10;
```

## Expected Flow

1. **Page Load**:
   ```
   [SSE] Attempting to connect...
   [SSE] ✅ Connected
   [SSE] Received: { p15: true }
   [usePendingDeletes] hasPendingDeletes: true
   → Toolbar appears
   ```

2. **Mark Photo as Don't Keep**:
   ```
   Frontend: PUT /api/projects/p15/keep
   Backend: Updates database
   Backend: broadcastPendingChanges('p15')
   [SSE] Sending: { p15: true }
   Frontend: [SSE] Received: { p15: true }
   [usePendingDeletes] hasPendingDeletes: true
   → Toolbar stays visible
   ```

3. **Commit Changes**:
   ```
   Frontend: POST /api/projects/p15/commit-changes
   Backend: Commits changes
   Backend: broadcastPendingChanges('p15')
   [SSE] Sending: {}
   Frontend: [SSE] Received: {}
   [usePendingDeletes] hasPendingDeletes: false
   → Toolbar disappears
   ```

## Next Steps

1. **Restart server** with new logging
2. **Open browser** and check console
3. **Report back** what you see in:
   - Browser console (SSE logs)
   - Server logs (database check)
   - usePendingDeletes state
