# Current Issues - Debugging Session

## Issue 1: View Button Not Opening Images

### Symptoms
- Clicking "View" button shows log: `[VirtualizedPhotoGrid] View button clicked`
- But viewer doesn't open
- Happening consistently now (was random before)

### Added Debug Logging
**File**: `client/src/hooks/useAllPhotosViewer.js`

Now logs:
1. When handler is called (with photo filename, list lengths, function types)
2. When setting viewer state (list length, found index, start index)
3. When updating URL (new URL being pushed)

### What to Check
When you click "View", look for these logs in sequence:
```
[useAllPhotosViewer] handleAllPhotoSelect called { photo: "DSC05127", ... }
[useAllPhotosViewer] Setting viewer state: { listLength: 100, foundIndex: 5, startIndex: 5, ... }
[useAllPhotosViewer] Viewer state set, updating URL
[useAllPhotosViewer] Pushing URL: /all/p15/DSC05127
```

### Possible Causes
1. **setViewerState not working** - Check if `setViewerState: "function"` in logs
2. **setViewerList not working** - Check if `setViewerList: "function"` in logs
3. **Photo not found in list** - Check if `foundIndex: -1` (means photo not in list)
4. **State not triggering re-render** - React issue

## Issue 2: Toolbar Not Showing Despite Pending Changes

### Symptoms
- Photo DSC05127 has:
  - `jpg_available: true`, `keep_jpg: false`
  - `raw_available: true`, `keep_raw: false`
- But `hasPendingDeletesProject: false`
- And `pendingChangesSSE: {…}` (unknown contents)

### Added Debug Logging
**File**: `client/src/hooks/usePendingDeletes.js`

Now logs:
- `pendingChangesSSE: JSON.stringify(...)` - Full object as string
- `pendingChangesSSE_keys: [...]` - All keys in the object
- `pendingChangesSSE_p15: ...` - Specific value for p15

### What to Check

1. **Is SSE connected?**
   Look for: `[SSE] ✅ Connected to pending changes stream`

2. **Did SSE receive data?**
   Look for: `[SSE] Received pending changes update: { ... }`

3. **What's in pendingChangesSSE?**
   Look at the new detailed logs:
   ```
   pendingChangesSSE: "{}"  // Empty object = no pending changes detected
   pendingChangesSSE: "{\"p15\":true}"  // p15 has pending changes
   pendingChangesSSE_keys: ["p15"]
   pendingChangesSSE_p15: true
   ```

4. **Server-side check**
   Look in server logs for:
   ```
   [SSE] Database check: { totalPhotos: 1092, totalMismatches: 6 }
   [SSE] Projects with mismatches: [ { project_folder: 'p15', mismatch_count: 6 } ]
   [SSE] Current pending changes state: { p15: true }
   ```

### Possible Causes

#### A. SSE Not Connecting
- Check Network tab for `/api/sse/pending-changes` request
- Should be in "pending" state (EventStream)
- If failed, check CORS or server errors

#### B. SSE Connected But Empty Data
- Server query returns no results
- Database has no mismatches (but you confirmed DSC05127 has mismatches)
- SQL query is wrong

#### C. SSE Connected With Data But Not Reaching Hook
- Data is being sent but not parsed correctly
- React state not updating
- Hook not receiving the data

## Testing Steps

### Step 1: Restart Everything
```bash
# Terminal 1: Start server
npm start

# Terminal 2: Start client (if separate)
cd client && npm start
```

### Step 2: Open Browser Console
Press F12, go to Console tab

### Step 3: Check SSE Connection
Look for:
```
[SSE] Attempting to connect to /api/sse/pending-changes
[SSE] ✅ Connected to pending changes stream
[SSE] Received pending changes update: { ... }
```

### Step 4: Check Pending Deletes State
Look for:
```
[usePendingDeletes] {
  pendingChangesSSE: "{\"p15\":true}",
  pendingChangesSSE_keys: ["p15"],
  pendingChangesSSE_p15: true,
  hasPendingDeletesProject: true,
  hasPendingDeletes: true
}
```

### Step 5: Try Opening Photo
1. Click "View" button on a photo
2. Check console for the sequence of logs
3. Report what you see

### Step 6: Check Server Logs
Look for SSE-related logs when:
- Page loads (initial connection)
- You mark a photo as "don't keep" (broadcast)

## What to Report

Please share:

1. **Browser Console Output** (copy/paste):
   - All `[SSE]` logs
   - All `[usePendingDeletes]` logs
   - All `[useAllPhotosViewer]` logs when clicking View

2. **Server Terminal Output** (copy/paste):
   - All `[SSE]` logs

3. **Network Tab**:
   - Screenshot of `/api/sse/pending-changes` request
   - Status (pending/failed)
   - Response preview

4. **Specific Questions**:
   - Does the toolbar show in `/all` mode?
   - Does the toolbar show in `/p15` mode?
   - Can you open ANY photo or NONE?
