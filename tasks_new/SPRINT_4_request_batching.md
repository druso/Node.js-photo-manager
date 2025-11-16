# Sprint 4: Request Batching for Photo Operations

**Priority**: HIGH  
**Expected Impact**: 90%+ reduction in API calls, 80%+ faster bulk operations

---

## Objective

Implement client-side request batching and server-side batch endpoints to consolidate multiple photo operations into single API calls.

---

## Problem Analysis

### Current State

**Individual Requests**:
```javascript
// User selects 50 photos, adds tag "vacation"
for (const photo of selectedPhotos) {
  await addTag(photo.id, 'vacation'); // 50 separate API calls!
}
```

**Issues**:
- 50 photos = 50 API calls
- 50 database transactions
- 5-10 seconds total time
- High server load

### Target State

**Batched Requests**:
```javascript
// User selects 50 photos, adds tag "vacation"
await batchAddTags(selectedPhotos.map(p => p.id), ['vacation']); // 1 API call!
```

**Benefits**:
- 50 photos = 1 API call (98% reduction)
- 1 database transaction
- <1 second total time
- Minimal server load

---

## Implementation Tasks

### Task 1: Create Request Batcher Service

**File**: `client/src/services/requestBatcher.js` (NEW)

```javascript
class RequestBatcher {
  constructor() {
    this.queues = new Map(); // operation -> queue
    this.timers = new Map(); // operation -> timeout
    this.debounceMs = 200;
    this.maxBatchSize = 100;
  }

  /**
   * Queue an operation for batching
   */
  queue(operation, item) {
    if (!this.queues.has(operation)) {
      this.queues.set(operation, []);
    }
    
    const queue = this.queues.get(operation);
    queue.push(item);
    
    // Clear existing timer
    if (this.timers.has(operation)) {
      clearTimeout(this.timers.get(operation));
    }
    
    // Set new timer
    const timer = setTimeout(() => {
      this.flush(operation);
    }, this.debounceMs);
    
    this.timers.set(operation, timer);
    
    // Flush if batch size reached
    if (queue.length >= this.maxBatchSize) {
      this.flush(operation);
    }
  }

  /**
   * Flush a specific operation queue
   */
  async flush(operation) {
    const queue = this.queues.get(operation);
    if (!queue || queue.length === 0) return;
    
    // Clear queue and timer
    this.queues.delete(operation);
    if (this.timers.has(operation)) {
      clearTimeout(this.timers.get(operation));
      this.timers.delete(operation);
    }
    
    // Execute batch operation
    const handler = this.handlers.get(operation);
    if (handler) {
      await handler(queue);
    }
  }

  /**
   * Register a batch handler
   */
  registerHandler(operation, handler) {
    if (!this.handlers) {
      this.handlers = new Map();
    }
    this.handlers.set(operation, handler);
  }
}

export default new RequestBatcher();
```

### Task 2: Create Server Batch Endpoints

**File**: `server/routes/photosActions.js`

Add batch endpoints:

```javascript
const express = require('express');
const router = express.Router();
const photosRepo = require('../services/repositories/photosRepo');
const photoTagsRepo = require('../services/repositories/photoTagsRepo');
const { getDb } = require('../services/db');
const makeLogger = require('../utils/logger2');
const log = makeLogger('photos-batch');

/**
 * Batch add tags to multiple photos
 * POST /api/photos/tags/batch-add
 * Body: { photo_ids: [1, 2, 3], tags: ['vacation', 'beach'] }
 */
router.post('/tags/batch-add', async (req, res) => {
  const { photo_ids, tags } = req.body;
  
  if (!Array.isArray(photo_ids) || !Array.isArray(tags)) {
    return res.status(400).json({ error: 'photo_ids and tags must be arrays' });
  }
  
  if (photo_ids.length === 0 || tags.length === 0) {
    return res.status(400).json({ error: 'photo_ids and tags cannot be empty' });
  }
  
  if (photo_ids.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 photos per batch' });
  }
  
  const db = getDb();
  const results = { success: 0, failed: 0, errors: [] };
  
  // Use transaction for atomicity
  const transaction = db.transaction(() => {
    for (const photoId of photo_ids) {
      for (const tag of tags) {
        try {
          photoTagsRepo.addTag(photoId, tag);
          results.success++;
        } catch (err) {
          results.failed++;
          results.errors.push({
            photo_id: photoId,
            tag,
            error: err.message
          });
        }
      }
    }
  });
  
  try {
    transaction();
    log.info('batch_add_tags_completed', {
      photoCount: photo_ids.length,
      tagCount: tags.length,
      success: results.success,
      failed: results.failed
    });
    res.json(results);
  } catch (err) {
    log.error('batch_add_tags_failed', {
      error: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: 'Batch operation failed' });
  }
});

/**
 * Batch remove tags from multiple photos
 * POST /api/photos/tags/batch-remove
 * Body: { photo_ids: [1, 2, 3], tags: ['vacation'] }
 */
router.post('/tags/batch-remove', async (req, res) => {
  const { photo_ids, tags } = req.body;
  
  if (!Array.isArray(photo_ids) || !Array.isArray(tags)) {
    return res.status(400).json({ error: 'photo_ids and tags must be arrays' });
  }
  
  if (photo_ids.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 photos per batch' });
  }
  
  const db = getDb();
  const results = { success: 0, failed: 0, errors: [] };
  
  const transaction = db.transaction(() => {
    for (const photoId of photo_ids) {
      for (const tag of tags) {
        try {
          photoTagsRepo.removeTag(photoId, tag);
          results.success++;
        } catch (err) {
          results.failed++;
          results.errors.push({
            photo_id: photoId,
            tag,
            error: err.message
          });
        }
      }
    }
  });
  
  try {
    transaction();
    log.info('batch_remove_tags_completed', {
      photoCount: photo_ids.length,
      tagCount: tags.length,
      success: results.success,
      failed: results.failed
    });
    res.json(results);
  } catch (err) {
    log.error('batch_remove_tags_failed', {
      error: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: 'Batch operation failed' });
  }
});

/**
 * Batch update keep flags
 * POST /api/photos/keep/batch-update
 * Body: { photo_ids: [1, 2, 3], keep: true }
 */
router.post('/keep/batch-update', async (req, res) => {
  const { photo_ids, keep } = req.body;
  
  if (!Array.isArray(photo_ids)) {
    return res.status(400).json({ error: 'photo_ids must be an array' });
  }
  
  if (typeof keep !== 'boolean') {
    return res.status(400).json({ error: 'keep must be a boolean' });
  }
  
  if (photo_ids.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 photos per batch' });
  }
  
  const db = getDb();
  const results = { success: 0, failed: 0, errors: [] };
  
  const transaction = db.transaction(() => {
    for (const photoId of photo_ids) {
      try {
        photosRepo.updateKeep(photoId, keep);
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({
          photo_id: photoId,
          error: err.message
        });
      }
    }
  });
  
  try {
    transaction();
    log.info('batch_update_keep_completed', {
      photoCount: photo_ids.length,
      keep,
      success: results.success,
      failed: results.failed
    });
    res.json(results);
  } catch (err) {
    log.error('batch_update_keep_failed', {
      error: err.message,
      stack: err.stack
    });
    res.status(500).json({ error: 'Batch operation failed' });
  }
});

module.exports = router;
```

### Task 3: Create Batch API Client

**File**: `client/src/api/batchApi.js` (NEW)

```javascript
import { authFetch } from './authFetch';

/**
 * Batch add tags to multiple photos
 */
export async function batchAddTags(photoIds, tags) {
  const res = await authFetch('/api/photos/tags/batch-add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_ids: photoIds, tags })
  });
  
  if (!res.ok) {
    throw new Error(`Batch add tags failed: ${res.status}`);
  }
  
  return res.json();
}

/**
 * Batch remove tags from multiple photos
 */
export async function batchRemoveTags(photoIds, tags) {
  const res = await authFetch('/api/photos/tags/batch-remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_ids: photoIds, tags })
  });
  
  if (!res.ok) {
    throw new Error(`Batch remove tags failed: ${res.status}`);
  }
  
  return res.json();
}

/**
 * Batch update keep flags
 */
export async function batchUpdateKeep(photoIds, keep) {
  const res = await authFetch('/api/photos/keep/batch-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photo_ids: photoIds, keep })
  });
  
  if (!res.ok) {
    throw new Error(`Batch update keep failed: ${res.status}`);
  }
  
  return res.json();
}
```

### Task 4: Update OperationsMenu Component

**File**: `client/src/components/OperationsMenu.jsx`

Replace individual API calls with batch calls:

```javascript
import { batchAddTags, batchRemoveTags, batchUpdateKeep } from '../api/batchApi';

// In handleAddTag function
const handleAddTag = async (tag) => {
  const photoIds = selection.map(p => p.id);
  
  try {
    setIsProcessing(true);
    
    // Optimistic update
    const updatedPhotos = selection.map(p => ({
      ...p,
      tags: [...(p.tags || []), tag]
    }));
    updatePhotosInState(updatedPhotos);
    
    // Batch API call
    const result = await batchAddTags(photoIds, [tag]);
    
    if (result.failed > 0) {
      console.warn('Some tags failed to add:', result.errors);
      toast.show({
        emoji: '⚠️',
        message: `Added tag to ${result.success} photos, ${result.failed} failed`,
        variant: 'warning'
      });
    } else {
      toast.show({
        emoji: '✅',
        message: `Tag "${tag}" added to ${photoIds.length} photos`,
        variant: 'success'
      });
    }
  } catch (err) {
    console.error('Batch add tag failed:', err);
    toast.show({
      emoji: '❌',
      message: 'Failed to add tag',
      variant: 'error'
    });
    // Revert optimistic update
    refreshPhotos();
  } finally {
    setIsProcessing(false);
  }
};

// In handleRemoveTag function
const handleRemoveTag = async (tag) => {
  const photoIds = selection.map(p => p.id);
  
  try {
    setIsProcessing(true);
    
    // Optimistic update
    const updatedPhotos = selection.map(p => ({
      ...p,
      tags: (p.tags || []).filter(t => t !== tag)
    }));
    updatePhotosInState(updatedPhotos);
    
    // Batch API call
    const result = await batchRemoveTags(photoIds, [tag]);
    
    if (result.failed > 0) {
      console.warn('Some tags failed to remove:', result.errors);
    }
    
    toast.show({
      emoji: '✅',
      message: `Tag "${tag}" removed from ${photoIds.length} photos`,
      variant: 'success'
    });
  } catch (err) {
    console.error('Batch remove tag failed:', err);
    toast.show({
      emoji: '❌',
      message: 'Failed to remove tag',
      variant: 'error'
    });
    refreshPhotos();
  } finally {
    setIsProcessing(false);
  }
};

// In handleKeepToggle function
const handleKeepToggle = async (keepValue) => {
  const photoIds = selection.map(p => p.id);
  
  try {
    setIsProcessing(true);
    
    // Optimistic update
    const updatedPhotos = selection.map(p => ({
      ...p,
      keep: keepValue
    }));
    updatePhotosInState(updatedPhotos);
    
    // Batch API call
    const result = await batchUpdateKeep(photoIds, keepValue);
    
    if (result.failed > 0) {
      console.warn('Some keep updates failed:', result.errors);
    }
    
    toast.show({
      emoji: '✅',
      message: `Updated keep flag for ${photoIds.length} photos`,
      variant: 'success'
    });
  } catch (err) {
    console.error('Batch update keep failed:', err);
    toast.show({
      emoji: '❌',
      message: 'Failed to update keep flag',
      variant: 'error'
    });
    refreshPhotos();
  } finally {
    setIsProcessing(false);
  }
};
```

### Task 5: Add Progress Indicators

**File**: `client/src/components/OperationsMenu.jsx`

Add loading state during batch operations:

```javascript
{isProcessing && (
  <div className="flex items-center gap-2 text-sm text-gray-600">
    <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
    <span>Processing {selection.length} photos...</span>
  </div>
)}
```

---

## Verification Checklist

- [ ] RequestBatcher service created
- [ ] Server batch endpoints created
- [ ] Batch API client created
- [ ] OperationsMenu updated to use batch APIs
- [ ] Optimistic updates working
- [ ] Progress indicators showing
- [ ] Error handling for partial failures
- [ ] Toast notifications working
- [ ] Transaction rollback on errors
- [ ] 100-item batch limit enforced

---

## Testing

### Manual Testing

1. **Select 50 photos**
2. **Add tag "test"**
3. **Verify**:
   - Only 1 API call in Network tab
   - Operation completes in <1 second
   - All photos have tag
   - Toast notification shows

4. **Test partial failure**:
   - Modify server to fail some items
   - Verify error handling
   - Verify partial success reported

### Performance Testing

```javascript
// Before: 50 individual calls
console.time('individual');
for (const photo of photos) {
  await addTag(photo.id, 'test');
}
console.timeEnd('individual'); // ~5-10 seconds

// After: 1 batch call
console.time('batch');
await batchAddTags(photos.map(p => p.id), ['test']);
console.timeEnd('batch'); // ~0.5-1 second
```

---

## Success Metrics

- **API calls (50 photos)**: 1 (was 50)
- **Operation time**: <1s (was 5-10s)
- **Database transactions**: 1 (was 50)
- **User experience**: Excellent
