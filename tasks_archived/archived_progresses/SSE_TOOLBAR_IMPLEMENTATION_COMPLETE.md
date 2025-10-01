# SSE Toolbar Implementation - Complete

## ✅ Implementation Complete

### Backend (Server-Side)

#### 1. SSE Endpoint Created
**File**: `server/routes/sse.js`
- Endpoint: `GET /api/sse/pending-changes`
- Returns: `{ "p15": true, "p7": false, ... }` (boolean per project)
- Features:
  - Connection management with Map
  - Keepalive every 30 seconds
  - Auto-reconnect on disconnect
  - SQL query to check pending changes per project

#### 2. SSE Route Registered
**File**: `server.js`
- Added SSE router to Express app
- Endpoint: `/api/sse/pending-changes`

#### 3. Broadcast on Keep Flag Changes
**File**: `server/routes/keep.js`
- Calls `broadcastPendingChanges(folder)` after updating keep flags
- Sends real-time updates to all connected clients

### Frontend (Client-Side)

#### 1. SSE Hook Created
**File**: `client/src/hooks/usePendingChangesSSE.js`
- Connects to SSE stream
- Auto-reconnects on error (5 second delay)
- Returns: `{ pendingChanges, connected }`
- Handles cleanup on unmount

#### 2. Updated Pending Deletes Logic
**File**: `client/src/hooks/usePendingDeletes.js`
- Now uses SSE data instead of calculating from loaded photos
- For All Photos: Shows toolbar if ANY project has pending changes
- For Project: Shows toolbar if THAT project has pending changes
- Counts affected projects for display

#### 3. Wired Up in App.jsx
**File**: `client/src/App.jsx`
- Added `usePendingChangesSSE()` hook
- Passes `pendingChanges` to `usePendingDeletes()`
- Removed old calculation logic

### showdetail Parameter Fix

#### Files Modified:
- `client/src/hooks/useAppInitialization.js` - Stores showdetail in sessionStorage
- `client/src/components/PhotoViewer.jsx` - Reads from sessionStorage and notifies parent

**How It Works**:
1. URL has `?showdetail=1`
2. `useAppInitialization` stores it in sessionStorage
3. PhotoViewer reads it on mount
4. PhotoViewer notifies parent to update viewerState
5. useUrlSync keeps parameter in URL

## Testing Checklist

### SSE Connection
- [ ] Open browser console
- [ ] Look for: `[SSE] Connected to pending changes stream`
- [ ] Look for: `[SSE] Received pending changes update: {...}`

### Toolbar Visibility

#### Project Mode
1. [ ] Go to a project (e.g., `/p15`)
2. [ ] Toolbar should NOT show initially
3. [ ] Open a photo in viewer
4. [ ] Mark JPG or RAW as "don't keep"
5. [ ] Close viewer
6. [ ] Toolbar should appear immediately (via SSE)
7. [ ] Console should show: `[SSE] Received pending changes update: { "p15": true }`

#### All Photos Mode
1. [ ] Go to All Photos (`/all`)
2. [ ] Toolbar should show if ANY project has pending changes
3. [ ] Mark a photo as "don't keep" in any project
4. [ ] Toolbar should appear immediately
5. [ ] Console should show SSE update

### showdetail Parameter
1. [ ] Open URL: `http://localhost:3000/all/p7/DSC03726?showdetail=1`
2. [ ] Detail panel should open automatically
3. [ ] Parameter should stay in URL
4. [ ] Console should show: `[PhotoViewer] Opening with detail panel from URL`

## How It Works

### Real-Time Flow

```
1. User marks photo as "don't keep"
   ↓
2. Frontend calls PUT /api/projects/:folder/keep
   ↓
3. Backend updates database
   ↓
4. Backend calls broadcastPendingChanges(folder)
   ↓
5. Backend queries: SELECT project_folder WHERE (jpg_available=1 AND keep_jpg=0) OR ...
   ↓
6. Backend sends SSE message: { "p15": true, "p7": false, ... }
   ↓
7. Frontend receives SSE message
   ↓
8. usePendingChangesSSE updates pendingChanges state
   ↓
9. usePendingDeletes recalculates hasPendingDeletes
   ↓
10. Toolbar appears/disappears instantly
```

### Commit/Revert Flow

```
1. User clicks "Commit Changes"
   ↓
2. Frontend sends: POST /api/projects/:folder/commit-changes
   (or POST /api/projects/all/commit-changes for all projects)
   ↓
3. Backend commits changes (moves files to .trash)
   ↓
4. Backend calls broadcastPendingChanges()
   ↓
5. SSE updates all clients
   ↓
6. Toolbar disappears automatically
```

## Benefits Achieved

✅ **Real-time Updates**: Toolbar appears instantly when marking photos
✅ **Multi-tab Support**: Changes in one tab update all tabs
✅ **Reduced API Calls**: No polling, server pushes only on change
✅ **Simplified Logic**: No complex client-side calculations
✅ **Better UX**: Instant feedback, no refresh needed
✅ **Scalable**: Works well for single-user or small team

## Files Modified

### Backend
1. `server/routes/sse.js` - NEW: SSE endpoint and broadcast logic
2. `server.js` - Register SSE router
3. `server/routes/keep.js` - Add broadcast call after keep flag updates

### Frontend
1. `client/src/hooks/usePendingChangesSSE.js` - NEW: SSE connection hook
2. `client/src/hooks/usePendingDeletes.js` - Use SSE data instead of calculation
3. `client/src/App.jsx` - Wire up SSE hook
4. `client/src/hooks/useAppInitialization.js` - Fix showdetail parameter
5. `client/src/components/PhotoViewer.jsx` - Read showdetail from sessionStorage

## Next Steps

1. **Test the implementation**:
   - Mark photos as "don't keep"
   - Verify toolbar appears immediately
   - Check SSE connection in console
   - Test in both Project and All Photos modes

2. **Test showdetail parameter**:
   - Open deep link with `?showdetail=1`
   - Verify detail panel opens
   - Verify parameter stays in URL

3. **Monitor SSE connection**:
   - Check for reconnection on network issues
   - Verify keepalive messages every 30 seconds
   - Test with multiple browser tabs

## Troubleshooting

### Toolbar Not Appearing
- Check console for `[SSE] Connected to pending changes stream`
- Check console for `[SSE] Received pending changes update`
- Verify backend is calling `broadcastPendingChanges()`
- Check SQL query returns correct data

### SSE Connection Issues
- Check CORS settings
- Verify `/api/sse/pending-changes` endpoint is accessible
- Check for proxy/nginx buffering issues
- Look for connection errors in console

### showdetail Not Working
- Check console for `[PhotoViewer] Opening with detail panel from URL`
- Verify sessionStorage has `viewer_show_detail_from_url`
- Check if `useUrlSync` is clearing the parameter
