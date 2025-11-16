# Sprint 5: Image Processing Pipeline Optimization

**Priority**: HIGH  
**Expected Impact**: 40-50% faster processing, 30-50% CPU reduction

---

## Objective

Implement parallel image processing with worker pools, derivative caching, and progressive encoding to dramatically improve upload processing speed and reduce CPU usage.

---

## Problem Analysis

### Current State
- Sequential processing (one photo at a time)
- No derivative metadata caching
- Regenerates all derivatives even if unchanged
- 100% CPU usage during uploads
- 100 photos = 5-10 minutes

### Target State
- Parallel processing with worker pool
- Smart derivative caching
- Progressive JPEG encoding
- 50-70% CPU usage (controlled)
- 100 photos = 2-3 minutes

---

## Implementation Tasks

### Task 1: Create Worker Pool Service

**File**: `server/services/imageProcessingPool.js` (NEW)

```javascript
const { Worker } = require('worker_threads');
const path = require('path');
const makeLogger = require('../utils/logger2');
const log = makeLogger('image-pool');

class ImageProcessingPool {
  constructor(workerCount = 4) {
    this.workerCount = workerCount;
    this.workers = [];
    this.queue = [];
    this.activeJobs = new Map();
    this.init();
  }

  init() {
    for (let i = 0; i < this.workerCount; i++) {
      this.createWorker();
    }
  }

  createWorker() {
    const worker = new Worker(path.join(__dirname, 'imageWorker.js'));
    worker.on('message', (msg) => this.handleWorkerMessage(msg));
    worker.on('error', (err) => log.error('worker_error', { error: err.message }));
    this.workers.push({ worker, busy: false });
  }

  async processImage(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.processQueue();
    });
  }

  processQueue() {
    const availableWorker = this.workers.find(w => !w.busy);
    if (!availableWorker || this.queue.length === 0) return;

    const job = this.queue.shift();
    availableWorker.busy = true;
    
    const jobId = Math.random().toString(36);
    this.activeJobs.set(jobId, { ...job, worker: availableWorker });
    
    availableWorker.worker.postMessage({ jobId, task: job.task });
  }

  handleWorkerMessage(msg) {
    const job = this.activeJobs.get(msg.jobId);
    if (!job) return;

    job.worker.busy = false;
    this.activeJobs.delete(msg.jobId);

    if (msg.error) {
      job.reject(new Error(msg.error));
    } else {
      job.resolve(msg.result);
    }

    this.processQueue();
  }
}

module.exports = new ImageProcessingPool(4);
```

### Task 2: Create Image Worker

**File**: `server/services/imageWorker.js` (NEW)

```javascript
const { parentPort } = require('worker_threads');
const sharp = require('sharp');
const fs = require('fs').promises;

parentPort.on('message', async ({ jobId, task }) => {
  try {
    const result = await processImage(task);
    parentPort.postMessage({ jobId, result });
  } catch (err) {
    parentPort.postMessage({ jobId, error: err.message });
  }
});

async function processImage(task) {
  const { sourcePath, derivatives } = task;
  const results = [];

  for (const deriv of derivatives) {
    const output = await sharp(sourcePath)
      .resize(deriv.width, deriv.height, { fit: 'inside' })
      .jpeg({ quality: deriv.quality, progressive: true })
      .toFile(deriv.outputPath);
    
    results.push({
      type: deriv.type,
      width: output.width,
      height: output.height,
      size: output.size
    });
  }

  return results;
}
```

### Task 3: Add Derivative Caching

**File**: `server/services/derivativeCache.js` (NEW)

```javascript
const { getDb } = require('./db');

class DerivativeCache {
  constructor() {
    this.initTable();
  }

  initTable() {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS derivative_cache (
        photo_id INTEGER PRIMARY KEY,
        source_hash TEXT NOT NULL,
        thumbnail_meta TEXT,
        preview_meta TEXT,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  needsRegeneration(photoId, sourceHash) {
    const db = getDb();
    const cached = db.prepare(
      'SELECT source_hash FROM derivative_cache WHERE photo_id = ?'
    ).get(photoId);
    
    return !cached || cached.source_hash !== sourceHash;
  }

  updateCache(photoId, sourceHash, metadata) {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO derivative_cache 
      (photo_id, source_hash, thumbnail_meta, preview_meta, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      photoId,
      sourceHash,
      JSON.stringify(metadata.thumbnail),
      JSON.stringify(metadata.preview),
      Date.now()
    );
  }
}

module.exports = new DerivativeCache();
```

### Task 4: Update Image Processor

**File**: `server/services/imageProcessor.js`

Replace sequential processing with pool:

```javascript
const imagePool = require('./imageProcessingPool');
const derivativeCache = require('./derivativeCache');
const crypto = require('crypto');
const fs = require('fs').promises;

async function generateDerivatives(photoId, sourcePath) {
  // Calculate source hash
  const sourceBuffer = await fs.readFile(sourcePath);
  const sourceHash = crypto.createHash('md5').update(sourceBuffer).digest('hex');
  
  // Check cache
  if (!derivativeCache.needsRegeneration(photoId, sourceHash)) {
    log.info('derivatives_cached', { photoId });
    return; // Skip regeneration
  }
  
  // Process with worker pool
  const task = {
    sourcePath,
    derivatives: [
      { type: 'thumbnail', width: 200, height: 200, quality: 80, outputPath: getThumbnailPath(photoId) },
      { type: 'preview', width: 1200, height: 1200, quality: 85, outputPath: getPreviewPath(photoId) }
    ]
  };
  
  const results = await imagePool.processImage(task);
  
  // Update cache
  const metadata = {
    thumbnail: results.find(r => r.type === 'thumbnail'),
    preview: results.find(r => r.type === 'preview')
  };
  derivativeCache.updateCache(photoId, sourceHash, metadata);
  
  log.info('derivatives_generated', { photoId, cached: false });
}
```

---

## Verification Checklist

- [ ] Worker pool created with 4 workers
- [ ] Image worker handles Sharp processing
- [ ] Derivative cache table created
- [ ] Cache checks working
- [ ] Progressive JPEG enabled
- [ ] Parallel processing working
- [ ] CPU usage controlled
- [ ] Processing time reduced by 40-50%

---

## Testing

### Performance Test

```bash
# Upload 100 photos
# Monitor processing time and CPU

# Before: 5-10 minutes, 100% CPU
# After: 2-3 minutes, 50-70% CPU
```

### Cache Test

```bash
# Upload photo
# Re-upload same photo
# Verify derivatives not regenerated
```

---

## Success Metrics

- **100 photos processing**: 2-3 min (was 5-10 min)
- **CPU usage**: 50-70% (was 100%)
- **Regeneration overhead**: 10-20% (was 100%)
