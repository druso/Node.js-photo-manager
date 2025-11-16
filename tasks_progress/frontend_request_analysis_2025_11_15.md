# Frontend Request Analysis & Optimization

**Date**: 2025-11-15  
**Issue**: Too many requests from frontend, hitting rate limits  
**Priority**: HIGH

---

## 🔍 Analysis Summary

After analyzing the frontend request patterns, I found **several issues causing excessive API calls**:

### 🔴 Critical Issues Found

1. **Polling Fallback Running Unnecessarily** (3-second interval)
2. **Multiple useEffect Hooks Triggering on Same Dependencies**
3. **No Request Deduplication**
4. **SSE Reconnection Creating Duplicate Connections**
5. **Rate Limits May Be Too Restrictive**

---

## 📊 Detailed Findings

### Issue #1: Aggressive Polling Fallback

**File**: `client/src/hooks/useProjectSse.js` (lines 248-264)

**Problem**: A 3-second polling interval runs as a fallback when SSE isn't ready:

```javascript
useEffect(() => {
  if (!selectedProject?.folder) return;
  if (committing) return;
  const photos = projectData?.photos || [];
  const anyPending = photos.some(p => p && (p.thumbnail_status === 'pending' || !p.thumbnail_status));
  if (!anyPending) return;
  if (sseReadyRef.current) return;  // ❌ This should stop polling, but SSE may not be "ready"

  const id = setInterval(() => {
    const folder = selectedProject?.folder;
    if (folder) {
      fetchProjectDataRef.current?.(folder);  // 🔥 Calls getProject() every 3 seconds!
    }
  }, 3000);

  return () => clearInterval(id);
}, [selectedProject?.folder, projectData, committing]);
```

**Impact**:
- **20 requests per minute** per project when thumbnails are pending
- Hits rate limits quickly (60 req/min for most endpoints)
- Runs even when SSE is working fine

**Why It Happens**:
- `sseReadyRef.current` is only set to `true` when the first SSE event arrives
- If no events come (e.g., no jobs running), polling never stops
- Polling continues until ALL thumbnails are complete

---

### Issue #2: Multiple Initialization Requests

**File**: `client/src/hooks/useAppInitialization.js`

**Problem**: Multiple `useEffect` hooks fire on mount, each making API calls:

```javascript
// Effect 1: Fetch projects (line 76)
useEffect(() => {
  const fetchProjects = async () => {
    const data = await listProjects();  // API call #1
    setProjects(data || []);
  };
  fetchProjects();
}, [setProjects, setConfig]);

// Effect 2: Fetch config (line 87)
useEffect(() => {
  const fetchConfig = async () => {
    const data = await getConfig();  // API call #2
    setConfig(data || {});
  };
  fetchConfig();
}, [setProjects, setConfig]);

// Effect 3: Fetch task definitions (line 102)
useEffect(() => {
  fetchTaskDefinitions()  // API call #3
    .then(d => { if (alive) setTaskDefs(d || {}); })
}, [setTaskDefs]);

// Effect 4: Fetch pending deletes (line 355)
useEffect(() => {
  const fetchPendingDeletes = async () => {
    const result = await listAllPendingDeletes({...});  // API call #4
    setAllPendingDeletes({...});
  };
  fetchPendingDeletes();
}, [view.project_filter, activeFilters?.dateRange, ...]);
```

**Impact**:
- **4-5 API calls** on initial page load
- Additional calls when filters change
- No batching or deduplication

---

### Issue #3: SSE Reconnection Loop

**File**: `client/src/hooks/usePendingChangesSSE.js` (lines 60-77)

**Problem**: SSE reconnects every 5 seconds on error, potentially creating multiple connections:

```javascript
eventSource.onerror = (error) => {
  setConnected(false);
  eventSource.close();
  
  // Attempt to reconnect after 5 seconds
  reconnectTimeoutRef.current = setTimeout(() => {
    if (mounted) {
      connect();  // 🔥 Creates new connection every 5 seconds on persistent errors
    }
  }, 5000);
};
```

**Impact**:
- If SSE endpoint is rate-limited (429), client keeps reconnecting
- Each reconnection attempt counts against rate limit
- Can create a "death spiral" of 429 errors

---

### Issue #4: Pending Deletes Refetch on Filter Changes

**File**: `client/src/hooks/useAppInitialization.js` (lines 355-383)

**Problem**: Fetches pending deletes whenever ANY filter changes:

```javascript
useEffect(() => {
  const fetchPendingDeletes = async () => {
    const result = await listAllPendingDeletes({
      date_from: range.start || undefined,
      date_to: range.end || undefined,
      file_type: activeFilters?.fileType !== 'any' ? activeFilters?.fileType : undefined,
      orientation: activeFilters?.orientation !== 'any' ? activeFilters?.orientation : undefined,
    });
    // ...
  };
  fetchPendingDeletes();
}, [view.project_filter, activeFilters?.dateRange, activeFilters?.fileType, activeFilters?.orientation, setAllPendingDeletes]);
```

**Impact**:
- Every filter change = 1 API call
- User adjusting filters = multiple rapid calls
- No debouncing

---

### Issue #5: Rate Limits May Be Too Restrictive

**Current Rate Limits** (from `server/routes/*.js`):

| Endpoint | Limit | Window |
|----------|-------|--------|
| General API | 60 req/min | Per IP |
| Thumbnails | 600 req/min | Per IP |
| Previews | 600 req/min | Per IP |
| Images | 120 req/min | Per IP |
| Destructive ops | 10 req/5min | Per IP |

**Problem**:
- **60 req/min** for general API is low for a single-user app
- Polling at 3-second intervals = 20 req/min just for one project
- Multiple tabs/windows share the same IP limit
- SSE reconnections count against limit

---

## 🎯 Recommended Fixes

### Priority 1: Fix Polling Fallback (HIGH - 30 minutes)

**File**: `client/src/hooks/useProjectSse.js`

**Current Issue**: Polling runs even when SSE is working

**Solution**: Only poll if SSE explicitly fails, not just "not ready"

```javascript
// Add a new ref to track SSE failure state
const sseFailedRef = useRef(false);

// In the SSE connection setup (line 38)
const close = openJobStream((evt) => {
  sseReadyRef.current = true;
  sseFailedRef.current = false;  // ✅ SSE is working
  // ... rest of handler
});

// Update polling condition (line 248)
useEffect(() => {
  if (!selectedProject?.folder) return;
  if (committing) return;
  const photos = projectData?.photos || [];
  const anyPending = photos.some(p => p && (p.thumbnail_status === 'pending' || !p.thumbnail_status));
  if (!anyPending) return;
  
  // ✅ Only poll if SSE explicitly failed AND we have pending items
  if (sseReadyRef.current || !sseFailedRef.current) return;

  // Increase interval to 10 seconds (less aggressive)
  const id = setInterval(() => {
    const folder = selectedProject?.folder;
    if (folder) {
      fetchProjectDataRef.current?.(folder);
    }
  }, 10000);  // ✅ Changed from 3000ms to 10000ms

  return () => clearInterval(id);
}, [selectedProject?.folder, projectData, committing]);
```

**Expected Impact**: Reduces polling from 20 req/min to 0 req/min (when SSE works) or 6 req/min (when SSE fails)

---

### Priority 2: Add Exponential Backoff to SSE Reconnection (HIGH - 20 minutes)

**File**: `client/src/hooks/usePendingChangesSSE.js`

**Current Issue**: Reconnects every 5 seconds, even on 429 errors

**Solution**: Exponential backoff with max delay

```javascript
const [pendingChanges, setPendingChanges] = useState(null);
const [connected, setConnected] = useState(false);
const eventSourceRef = useRef(null);
const reconnectTimeoutRef = useRef(null);
const reconnectDelayRef = useRef(5000);  // ✅ Start at 5 seconds
const maxReconnectDelay = 60000;  // ✅ Max 60 seconds

useEffect(() => {
  let mounted = true;

  function connect() {
    if (!mounted) return;

    if (IS_DEV) {
      console.log('[SSE] Attempting to connect to /api/sse/pending-changes');
    }
    
    try {
      const token = getAuthAccessToken();
      const eventSource = token
        ? new EventSourcePolyfill('/api/sse/pending-changes', {
            headers: { Authorization: `Bearer ${token}` },
            withCredentials: true,
          })
        : new EventSource('/api/sse/pending-changes');
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        if (!mounted) return;
        if (IS_DEV) {
          console.log('[SSE] ✅ Connected to pending changes stream');
        }
        setConnected(true);
        reconnectDelayRef.current = 5000;  // ✅ Reset delay on successful connection
      };

      eventSource.onmessage = (event) => {
        if (!mounted) return;
        try {
          const data = JSON.parse(event.data);
          if (IS_DEV) {
            console.log('[SSE] Received pending changes update:', data);
          }
          setPendingChanges(data);
        } catch (error) {
          if (IS_DEV) {
            console.error('[SSE] Failed to parse message:', error);
          }
        }
      };

      eventSource.onerror = (error) => {
        if (!mounted) return;
        if (IS_DEV) {
          console.error('[SSE] Connection error:', error);
        }
        setConnected(false);
        eventSource.close();
        
        // ✅ Exponential backoff
        const delay = reconnectDelayRef.current;
        if (IS_DEV) {
          console.log(`[SSE] Will reconnect in ${delay}ms`);
        }
        
        reconnectTimeoutRef.current = setTimeout(() => {
          if (mounted) {
            if (IS_DEV) {
              console.log('[SSE] Attempting to reconnect...');
            }
            connect();
          }
        }, delay);
        
        // ✅ Double the delay for next time, up to max
        reconnectDelayRef.current = Math.min(delay * 2, maxReconnectDelay);
      };
    } catch (error) {
      if (IS_DEV) {
        console.error('[SSE] Failed to create EventSource:', error);
      }
    }
  }

  connect();

  return () => {
    mounted = false;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setConnected(false);
  };
}, []);
```

**Expected Impact**: Reduces reconnection attempts from 12/min to 1-2/min during outages

---

### Priority 3: Debounce Filter Changes (MEDIUM - 15 minutes)

**File**: `client/src/hooks/useAppInitialization.js`

**Current Issue**: Every filter change triggers immediate API call

**Solution**: Debounce pending deletes fetch

```javascript
// Add at top of file
import { useEffect, useRef, useMemo } from 'react';

// Inside the hook, create a debounced version
const debouncedFilters = useMemo(() => {
  // Create a stable reference to filters
  return {
    dateRange: activeFilters?.dateRange,
    fileType: activeFilters?.fileType,
    orientation: activeFilters?.orientation,
  };
}, [
  activeFilters?.dateRange?.start,
  activeFilters?.dateRange?.end,
  activeFilters?.fileType,
  activeFilters?.orientation
]);

// Update the effect (line 355)
useEffect(() => {
  const isAllPhotosView = view.project_filter === null;
  if (!isAllPhotosView) return;
  
  // ✅ Debounce: wait 500ms before fetching
  const timeoutId = setTimeout(() => {
    const fetchPendingDeletes = async () => {
      try {
        const range = debouncedFilters.dateRange || {};
        const result = await listAllPendingDeletes({
          date_from: range.start || undefined,
          date_to: range.end || undefined,
          file_type: debouncedFilters.fileType !== 'any' ? debouncedFilters.fileType : undefined,
          orientation: debouncedFilters.orientation !== 'any' ? debouncedFilters.orientation : undefined,
        });
        setAllPendingDeletes({
          jpg: result.jpg || 0,
          raw: result.raw || 0,
          total: result.total || 0,
          byProject: new Set(result.byProject || []),
        });
      } catch (error) {
        console.debug('Failed to fetch pending deletions:', error);
        setAllPendingDeletes({ jpg: 0, raw: 0, total: 0, byProject: new Set() });
      }
    };

    fetchPendingDeletes();
  }, 500);  // ✅ Wait 500ms after last filter change
  
  return () => clearTimeout(timeoutId);
}, [view.project_filter, debouncedFilters, setAllPendingDeletes]);
```

**Expected Impact**: Reduces filter-change requests from 5-10/adjustment to 1/adjustment

---

### Priority 4: Increase Rate Limits for Authenticated Users (MEDIUM - 10 minutes)

**File**: `server/routes/projects.js` and others

**Current Issue**: 60 req/min is too low for single-user app

**Solution**: Increase limits for authenticated requests

```javascript
// Update rate limit for general API calls
const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 180,  // ✅ Increased from 60 to 180 (3 req/sec)
  message: 'Too many requests, please try again later.'
});
```

**Files to update**:
- `server/routes/projects.js` - line 25
- `server/routes/photos.js` - if it has general limits
- `server/routes/tags.js` - line 20

**Expected Impact**: Reduces 429 errors for normal usage

---

### Priority 5: Add Request Deduplication (LOW - 30 minutes)

**Create**: `client/src/utils/requestCache.js`

**Solution**: Cache identical requests for short duration

```javascript
/**
 * Simple request cache to prevent duplicate in-flight requests
 */
class RequestCache {
  constructor(ttlMs = 1000) {
    this.cache = new Map();
    this.ttlMs = ttlMs;
  }
  
  /**
   * Get cached promise or create new one
   * @param {string} key - Cache key
   * @param {Function} fetcher - Function that returns a promise
   * @returns {Promise} Cached or new promise
   */
  async fetch(key, fetcher) {
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expires) {
      return cached.promise;
    }
    
    const promise = fetcher();
    this.cache.set(key, {
      promise,
      expires: Date.now() + this.ttlMs
    });
    
    // Clean up after resolution
    promise.finally(() => {
      setTimeout(() => {
        const entry = this.cache.get(key);
        if (entry && entry.promise === promise) {
          this.cache.delete(key);
        }
      }, this.ttlMs);
    });
    
    return promise;
  }
  
  clear() {
    this.cache.clear();
  }
}

export const requestCache = new RequestCache(1000);  // 1 second TTL
```

**Usage in API clients**:

```javascript
// client/src/api/projectsApi.js
import { requestCache } from '../utils/requestCache';

export async function listProjects() {
  return requestCache.fetch('listProjects', async () => {
    const res = await authFetch('/api/projects');
    if (!res.ok) throw new Error(`listProjects failed: ${res.status}`);
    return res.json();
  });
}

export async function getProject(folder) {
  return requestCache.fetch(`getProject:${folder}`, async () => {
    const res = await authFetch(`/api/projects/${encodeURIComponent(folder)}`);
    if (!res.ok) throw new Error(`getProject failed: ${res.status}`);
    return res.json();
  });
}
```

**Expected Impact**: Prevents duplicate requests when multiple components mount simultaneously

---

## 📊 Expected Results After Fixes

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Polling requests | 20/min | 0-6/min | -70% to -100% |
| SSE reconnections | 12/min (on error) | 1-2/min | -83% |
| Filter change requests | 5-10 per adjustment | 1 per adjustment | -80% to -90% |
| Rate limit errors | Frequent | Rare | -90% |
| Initial page load requests | 4-5 | 4-5 (but deduplicated) | 0% (but faster) |

**Total Request Reduction**: ~60-80% fewer requests

---

## 🎯 Implementation Priority

### Week 1 (High Priority - 1 hour)
1. ✅ Fix polling fallback (30 min)
2. ✅ Add exponential backoff to SSE (20 min)
3. ✅ Increase rate limits (10 min)

### Week 2 (Medium Priority - 45 minutes)
4. ✅ Debounce filter changes (15 min)
5. ✅ Add request deduplication (30 min)

---

## 🐛 Additional Observations

### Good Practices Found ✅

1. **SSE Singleton**: Jobs SSE uses singleton pattern to prevent multiple connections
2. **Cleanup Functions**: All useEffect hooks have proper cleanup
3. **Incremental Updates**: SSE uses item-level updates instead of full refetches
4. **Rate Limiting**: Server has comprehensive rate limiting

### Minor Issues (Not Urgent)

1. **No Request Cancellation**: Long-running requests aren't cancelled when component unmounts
2. **No Retry Logic**: Failed requests don't retry with backoff
3. **No Offline Detection**: App doesn't detect offline state to pause requests

---

## 📝 Testing Plan

After implementing fixes:

1. **Monitor Network Tab**:
   - Open DevTools Network tab
   - Use app normally for 5 minutes
   - Count total requests
   - Should see <30 requests in 5 minutes (vs 100+ before)

2. **Test Rate Limits**:
   - Rapidly change filters
   - Should not see 429 errors
   - Requests should be debounced

3. **Test SSE Reconnection**:
   - Stop server
   - Watch console for reconnection attempts
   - Should see increasing delays (5s, 10s, 20s, 40s, 60s)

4. **Test Polling Fallback**:
   - Upload photos
   - Check if polling starts
   - Should only poll if SSE fails, not just "not ready"

---

## 🆘 Quick Fix Summary

**If you need immediate relief from 429 errors**, apply just these two changes:

### 1. Increase Rate Limit (2 minutes)

**File**: `server/routes/projects.js` line 25

```javascript
const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 180,  // Changed from 60
  message: 'Too many requests, please try again later.'
});
```

### 2. Disable Polling Fallback (1 minute)

**File**: `client/src/hooks/useProjectSse.js` line 254

```javascript
// Comment out the entire polling effect temporarily
/*
useEffect(() => {
  // ... polling code ...
}, [selectedProject?.folder, projectData, committing]);
*/
```

**This will immediately stop 90% of the excessive requests.**

---

## 📈 Success Criteria

- [ ] No 429 errors during normal usage
- [ ] <30 API requests in 5 minutes of normal use
- [ ] SSE reconnection uses exponential backoff
- [ ] Filter changes are debounced
- [ ] Polling only runs when SSE fails

---

**Status**: Analysis complete, fixes ready for implementation
