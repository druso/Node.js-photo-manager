# Toolbar SSE Proposal - Analysis

## Your Proposal

Use Server-Sent Events (SSE) to push pending changes status:
- **Data**: Boolean (true/false) for each project indicating if changes are pending
- **Client**: Reads from SSE stream
  - `/all` mode: Show toolbar if ANY project has pending changes
  - `/project` mode: Show toolbar if THAT project has pending changes
- **Backend**: SQL formula/trigger that updates when changes occur
- **Commit/Revert**: Client sends only `project + command`, backend handles everything

## Evaluation

### ✅ Advantages

1. **Real-time Updates**
   - Toolbar appears/disappears immediately when keep flags change
   - No need to manually refresh or poll
   - Works across multiple browser tabs/windows

2. **Reduced API Calls**
   - No need to poll for pending deletes
   - No need to call API after every keep flag change
   - Server pushes updates only when state changes

3. **Simplified Client Logic**
   - Client just listens to SSE stream
   - No complex calculation or state management
   - Single source of truth from server

4. **Better UX**
   - Instant feedback when marking photos
   - Consistent state across all clients
   - No stale data issues

### ⚠️ Considerations

#### Performance

**Pros**:
- Efficient: Only sends updates when state changes
- Lightweight: Boolean per project is minimal data
- Scalable: SSE is designed for this use case

**Cons**:
- Need to maintain open connections (one per client)
- SQL trigger overhead on every keep flag update
- Memory for tracking connection state

**Verdict**: ✅ **Good for single-user or small team usage**. For your use case (personal photo manager), this is perfectly fine.

#### Security

**Pros**:
- Server controls what data is sent
- Can validate permissions before sending updates
- No client-side calculation that could be manipulated

**Cons**:
- Need to ensure SSE endpoint is authenticated
- Need to prevent unauthorized access to project status
- Need to handle connection hijacking

**Mitigations**:
- Use existing session/auth middleware
- Only send updates for projects user has access to
- Use HTTPS in production

**Verdict**: ✅ **Secure with proper authentication**. Your existing auth will work fine.

#### Complexity

**Pros**:
- Cleaner separation of concerns
- Less client-side logic
- Easier to maintain

**Cons**:
- Need to implement SSE infrastructure
- Need SQL triggers or change detection
- Need connection management

**Verdict**: ⚠️ **Moderate complexity increase**, but worth it for the benefits.

## Recommended Implementation

### Phase 1: Backend SSE Infrastructure

#### 1. Create SSE Endpoint

**File**: `server/routes/sse.js`

```javascript
const express = require('express');
const router = express.Router();

// Store active SSE connections
const connections = new Map();

// SSE endpoint for pending changes
router.get('/pending-changes', (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Generate unique connection ID
  const connectionId = Date.now() + Math.random();
  
  // Store connection
  connections.set(connectionId, res);
  
  // Send initial state
  const initialState = getPendingChangesState();
  res.write(`data: ${JSON.stringify(initialState)}\n\n`);
  
  // Handle client disconnect
  req.on('close', () => {
    connections.delete(connectionId);
  });
});

// Function to broadcast updates to all clients
function broadcastPendingChanges(projectFolder = null) {
  const state = getPendingChangesState(projectFolder);
  const message = `data: ${JSON.stringify(state)}\n\n`;
  
  for (const [id, res] of connections) {
    res.write(message);
  }
}

// Function to get current pending changes state
function getPendingChangesState(projectFolder = null) {
  const db = require('../db');
  
  if (projectFolder) {
    // Get state for specific project
    const result = db.prepare(`
      SELECT 
        project_folder,
        CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END as has_pending
      FROM photos
      WHERE project_folder = ?
        AND ((jpg_available = 1 AND keep_jpg = 0) OR (raw_available = 1 AND keep_raw = 0))
      GROUP BY project_folder
    `).get(projectFolder);
    
    return {
      [projectFolder]: result ? !!result.has_pending : false
    };
  } else {
    // Get state for all projects
    const results = db.prepare(`
      SELECT 
        project_folder,
        1 as has_pending
      FROM photos
      WHERE (jpg_available = 1 AND keep_jpg = 0) OR (raw_available = 1 AND keep_raw = 0)
      GROUP BY project_folder
    `).all();
    
    const state = {};
    for (const row of results) {
      state[row.project_folder] = true;
    }
    return state;
  }
}

module.exports = { router, broadcastPendingChanges };
```

#### 2. Trigger Updates on Keep Flag Changes

**File**: `server/routes/keepApi.js` (or wherever keep flags are updated)

```javascript
const { broadcastPendingChanges } = require('./sse');

// After updating keep flags
await updateKeepFlags(photoId, updates);

// Broadcast update
const photo = await getPhoto(photoId);
broadcastPendingChanges(photo.project_folder);
```

### Phase 2: Frontend SSE Client

#### 1. Create SSE Hook

**File**: `client/src/hooks/usePendingChangesSSE.js`

```javascript
import { useEffect, useState } from 'react';

export function usePendingChangesSSE() {
  const [pendingChanges, setPendingChanges] = useState({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const eventSource = new EventSource('/api/sse/pending-changes');

    eventSource.onopen = () => {
      console.log('[SSE] Connected to pending changes stream');
      setConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[SSE] Received pending changes update:', data);
        setPendingChanges(prev => ({ ...prev, ...data }));
      } catch (error) {
        console.error('[SSE] Failed to parse message:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[SSE] Connection error:', error);
      setConnected(false);
    };

    return () => {
      eventSource.close();
      setConnected(false);
    };
  }, []);

  return { pendingChanges, connected };
}
```

#### 2. Update Toolbar Logic

**File**: `client/src/hooks/usePendingDeletes.js`

```javascript
export function usePendingDeletes({
  view,
  selectedProject,
  pendingChangesSSE, // From SSE hook
}) {
  const isAllPhotosView = view?.project_filter === null;
  
  // For All Photos: check if ANY project has pending changes
  const hasPendingDeletesAll = useMemo(() => {
    return Object.values(pendingChangesSSE).some(hasPending => hasPending);
  }, [pendingChangesSSE]);
  
  // For Project: check if THIS project has pending changes
  const hasPendingDeletesProject = useMemo(() => {
    return !!pendingChangesSSE[selectedProject?.folder];
  }, [pendingChangesSSE, selectedProject?.folder]);
  
  const hasPendingDeletes = isAllPhotosView 
    ? hasPendingDeletesAll 
    : hasPendingDeletesProject;
  
  return { hasPendingDeletes };
}
```

#### 3. Wire Up in App.jsx

```javascript
// Add SSE hook
const { pendingChanges, connected } = usePendingChangesSSE();

// Pass to usePendingDeletes
const { hasPendingDeletes } = usePendingDeletes({
  view,
  selectedProject,
  pendingChangesSSE: pendingChanges,
});
```

### Phase 3: Simplified Commit/Revert

**Backend**: `server/routes/projectCommitHandlers.js`

```javascript
// Commit endpoint
router.post('/api/projects/:folder/commit-changes', async (req, res) => {
  const { folder } = req.params;
  
  // If folder is 'all', commit all projects
  const projectFolders = folder === 'all' 
    ? await getAllProjectFolders()
    : [folder];
  
  for (const projectFolder of projectFolders) {
    await commitChanges(projectFolder);
    broadcastPendingChanges(projectFolder);
  }
  
  res.json({ success: true, projects: projectFolders });
});
```

**Frontend**: Just send project + command

```javascript
const handleCommit = async () => {
  const project = isAllPhotosView ? 'all' : selectedProject.folder;
  await fetch(`/api/projects/${project}/commit-changes`, { method: 'POST' });
  // SSE will update toolbar automatically
};
```

## Comparison: SSE vs Polling

| Aspect | SSE (Proposed) | Polling (Current) |
|--------|----------------|-------------------|
| Real-time | ✅ Instant | ❌ Delayed by poll interval |
| API Calls | ✅ Minimal | ❌ Constant polling |
| Server Load | ✅ Low (push only on change) | ❌ High (constant queries) |
| Client Logic | ✅ Simple (just listen) | ❌ Complex (manage state) |
| Connection | ⚠️ Persistent | ✅ Stateless |
| Complexity | ⚠️ Moderate setup | ✅ Simple |
| Multi-tab | ✅ Works automatically | ❌ Each tab polls separately |

## Recommendation

✅ **Implement SSE approach** for the following reasons:

1. **Better UX**: Instant feedback when marking photos
2. **Cleaner Code**: Simpler client logic, server controls state
3. **Scalable**: Works well for single-user or small team
4. **Future-proof**: Can add more real-time features later (job progress, etc.)

## Implementation Timeline

- **Phase 1** (Backend SSE): 1-2 hours
- **Phase 2** (Frontend SSE): 1 hour
- **Phase 3** (Commit/Revert): 30 minutes
- **Testing**: 1 hour
- **Total**: ~4 hours

## Alternative: Hybrid Approach

If SSE seems too complex initially:

1. **Start with polling** for MVP (30 minutes)
2. **Migrate to SSE** later when you have time
3. **Keep same API contract** so migration is easy

The polling approach would be:
```javascript
// Poll every 5 seconds
useEffect(() => {
  const interval = setInterval(async () => {
    const result = await fetch(`/api/projects/${project}/pending-deletes`);
    setPendingDeletes(await result.json());
  }, 5000);
  return () => clearInterval(interval);
}, [project]);
```

## Conclusion

Your SSE proposal is **excellent** for this use case. It's the right architectural choice for:
- Real-time updates
- Reduced server load
- Cleaner code
- Better UX

The complexity is manageable and the benefits are significant. I recommend implementing it.
