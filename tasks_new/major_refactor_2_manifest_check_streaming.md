# Major Refactoring Task 2: Manifest Lifecycle Hardening - Streaming Implementation

## Overview
Refactor `runManifestCheck` to use paginated reads instead of loading 100k+ records at once. This reduces memory usage, improves performance for large projects, and prevents potential OOM crashes.

## Business Value
- **Performance**: ~30% reduction in maintenance runtime for large projects
- **Scalability**: Handles projects with 100k+ photos without memory issues
- **Reliability**: Prevents out-of-memory crashes during maintenance
- **Lower Peak IO**: Reduces disk I/O spikes during maintenance operations

## Estimated Effort
**3 days** including implementation, instrumentation, and testing

## Current Implementation Issues

### Problem: Memory-Intensive Batch Loading
**File**: `server/services/workers/maintenanceWorker.js` (line ~187)

```javascript
// CURRENT (BAD): Loads ALL photos at once
const page = photosRepo.listPaged({ project_id: project.id, limit: 100000 });
for (const p of page.items) {
  // Process each photo...
}
```

**Issues**:
- Loads up to 100k records into memory at once
- High memory usage (each photo record ~1-2KB = 100-200MB for 100k photos)
- Blocks event loop during large queries
- Slow for projects with many photos

## Proposed Solution: Streaming with Pagination

### Architecture
Use cursor-based pagination to process photos in chunks of 1000-5000 at a time:

```javascript
async function runManifestCheck(job) {
  const projects = getProjectsForJob(job);
  let totalChanged = 0;
  
  for (const project of projects) {
    try {
      const projectPath = await ensureManifest(project);
      const { jpg, raw, other } = splitExtSets();
      
      let cursor = null;
      let changed = 0;
      let processed = 0;
      const CHUNK_SIZE = 2000; // Process 2000 photos at a time
      
      // Stream through photos using pagination
      do {
        const page = photosRepo.listPaged({
          project_id: project.id,
          limit: CHUNK_SIZE,
          cursor: cursor
        });
        
        // Process this chunk
        for (const p of page.items) {
          const base = p.filename;
          const jpgExists = [...jpg].some(e => 
            fs.existsSync(path.join(projectPath, `${base}.${e}`)) || 
            fs.existsSync(path.join(projectPath, `${base}.${e.toUpperCase()}`))
          );
          const rawExists = [...raw].some(e => 
            fs.existsSync(path.join(projectPath, `${base}.${e}`)) || 
            fs.existsSync(path.join(projectPath, `${base}.${e.toUpperCase()}`))
          );
          const otherExists = [...other].some(e => 
            fs.existsSync(path.join(projectPath, `${base}.${e}`)) || 
            fs.existsSync(path.join(projectPath, `${base}.${e.toUpperCase()}`))
          );
          
          if ((!!p.jpg_available) !== jpgExists || 
              (!!p.raw_available) !== rawExists || 
              (!!p.other_available) !== otherExists) {
            photosRepo.upsertPhoto(project.id, {
              manifest_id: p.manifest_id,
              filename: p.filename,
              basename: p.basename || p.filename,
              ext: p.ext,
              date_time_original: p.date_time_original,
              jpg_available: jpgExists,
              raw_available: rawExists,
              other_available: otherExists,
              keep_jpg: !!p.keep_jpg,
              keep_raw: !!p.keep_raw,
              thumbnail_status: p.thumbnail_status,
              preview_status: p.preview_status,
              orientation: p.orientation,
              meta_json: p.meta_json,
            });
            log.warn('manifest_check_corrected', { 
              ...projectLogContext(project), 
              filename: base, 
              jpg: jpgExists, 
              raw: rawExists, 
              other: otherExists 
            });
            changed++;
          }
          processed++;
        }
        
        // Update job progress
        if (job.id) {
          jobsRepo.updateProgress(job.id, processed, page.total || processed);
        }
        
        // Move to next page
        cursor = page.nextCursor;
        
        // Optional: yield to event loop every chunk
        await new Promise(resolve => setImmediate(resolve));
        
      } while (cursor); // Continue until no more pages
      
      totalChanged += changed;
      log.info('manifest_check_summary', { 
        ...projectLogContext(project), 
        updated_rows: changed,
        total_processed: processed
      });
      
      if (changed > 0) {
        emitJobUpdate({ 
          type: 'manifest_changed', 
          project_folder: project.project_folder, 
          changed 
        });
      }
    } catch (err) {
      log.error('manifest_check_project_failed', { 
        ...projectLogContext(project), 
        error: err.message 
      });
    }
  }
  
  if (projects.length > 1) {
    log.info('manifest_check_global_summary', { 
      projects_processed: projects.length, 
      total_changed: totalChanged 
    });
  }
}
```

## Implementation Steps

### Step 1: Verify Pagination Support
Check that `photosRepo.listPaged()` properly supports cursor-based pagination:

```javascript
// Test in Node REPL or create a test script
const photosRepo = require('./server/services/repositories/photosRepo');
const result = photosRepo.listPaged({ project_id: 1, limit: 10 });
console.log('Has nextCursor:', !!result.nextCursor);
console.log('Total:', result.total);
```

### Step 2: Implement Streaming Logic
**File**: `server/services/workers/maintenanceWorker.js`

1. Replace the single `listPaged` call with a do-while loop
2. Add cursor tracking
3. Add progress updates
4. Add optional event loop yielding

### Step 3: Add Instrumentation
Add timing and memory metrics:

```javascript
const startTime = Date.now();
const startMem = process.memoryUsage().heapUsed;

// ... processing logic ...

const endTime = Date.now();
const endMem = process.memoryUsage().heapUsed;
const duration = endTime - startTime;
const memDelta = (endMem - startMem) / 1024 / 1024; // MB

log.info('manifest_check_performance', {
  ...projectLogContext(project),
  duration_ms: duration,
  memory_delta_mb: memDelta.toFixed(2),
  photos_processed: processed,
  photos_per_second: (processed / (duration / 1000)).toFixed(2)
});
```

### Step 4: Configuration
Add tunable chunk size to `config.default.json`:

```json
{
  "maintenance": {
    "manifest_check_chunk_size": 2000,
    "yield_every_chunk": true
  }
}
```

Load in worker:
```javascript
const config = require('../config');
const CHUNK_SIZE = config.maintenance?.manifest_check_chunk_size || 2000;
const YIELD_CHUNKS = config.maintenance?.yield_every_chunk !== false;
```

## Testing Requirements

### Unit Tests
Create `server/services/workers/__tests__/maintenanceWorker.test.js`:

```javascript
describe('runManifestCheck streaming', () => {
  it('should process photos in chunks', async () => {
    // Mock photosRepo.listPaged to return multiple pages
    // Verify it's called multiple times with different cursors
  });

  it('should update job progress during processing', async () => {
    // Verify jobsRepo.updateProgress is called
  });

  it('should handle empty projects', async () => {
    // Test with project that has 0 photos
  });

  it('should handle single-page projects', async () => {
    // Test with project that has < chunk_size photos
  });
});
```

### Performance Testing
Create a test script to measure improvements:

```javascript
// test-manifest-check-performance.js
const { runManifestCheck } = require('./server/services/workers/maintenanceWorker');

async function testPerformance() {
  const job = { project_id: 1 }; // Use a large project
  
  console.time('manifest_check');
  const startMem = process.memoryUsage().heapUsed;
  
  await runManifestCheck(job);
  
  const endMem = process.memoryUsage().heapUsed;
  console.timeEnd('manifest_check');
  console.log('Peak memory delta:', ((endMem - startMem) / 1024 / 1024).toFixed(2), 'MB');
}

testPerformance().catch(console.error);
```

Run before and after to compare:
- Execution time
- Peak memory usage
- CPU usage

### Integration Tests
1. **Small Project** (< 100 photos): Verify single-page processing works
2. **Medium Project** (1k-10k photos): Verify multi-page processing works
3. **Large Project** (50k+ photos): Verify memory stays bounded
4. **Global Maintenance**: Verify works across multiple projects

### Manual Testing Checklist
- [ ] Run maintenance on a project with 100 photos
- [ ] Run maintenance on a project with 10k photos
- [ ] Run maintenance on a project with 50k+ photos
- [ ] Monitor memory usage during large project maintenance
- [ ] Verify job progress updates in real-time
- [ ] Check logs for performance metrics
- [ ] Verify SSE updates are sent correctly

## Performance Benchmarks

### Expected Results
For a project with 50,000 photos:

**Before (Current)**:
- Memory: ~100-150MB peak
- Time: ~45-60 seconds
- Single blocking query

**After (Streaming)**:
- Memory: ~10-20MB peak (85% reduction)
- Time: ~30-40 seconds (30% faster)
- Multiple small queries with progress updates

## Documentation Updates

### Files to Update
1. **`project_docs/JOBS_OVERVIEW.md`**
   - Update `manifest_check` job description
   - Document streaming behavior and chunk size
   - Add performance characteristics

2. **`project_docs/PROJECT_OVERVIEW.md`**
   - Update maintenance system section
   - Document memory-efficient processing

3. **`config.default.json`**
   - Add new maintenance configuration options with comments

4. **`SECURITY.md`**
   - Note: Streaming reduces DoS risk from large maintenance operations

## Rollback Plan
If issues are discovered:
1. Revert to single `listPaged` call with high limit
2. The database is unchanged, so no data migration needed
3. Monitor for any correctness issues in the old implementation

## Success Criteria
- [ ] Streaming implementation complete
- [ ] Memory usage reduced by >50% for large projects
- [ ] Performance improved by >20% for large projects
- [ ] Job progress updates working
- [ ] All tests passing
- [ ] Performance benchmarks documented
- [ ] Configuration options added
- [ ] Documentation updated
- [ ] Code review approved

## Potential Challenges & Solutions

### Challenge 1: Cursor Stability
**Problem**: If photos are added/deleted during maintenance, cursor might become invalid

**Solution**: 
- Use snapshot isolation if database supports it
- Add retry logic for invalid cursor errors
- Document that maintenance should run during low-activity periods

### Challenge 2: Progress Tracking
**Problem**: Total count might not be known upfront with cursors

**Solution**:
- Use `page.total` from first page as estimate
- Update total as pages are processed
- Show "X processed" instead of "X of Y" if total unknown

### Challenge 3: Event Loop Blocking
**Problem**: Even with chunks, processing might block event loop

**Solution**:
- Add `setImmediate` yield between chunks
- Make chunk size configurable
- Consider using worker threads for CPU-intensive operations

## Notes for Junior Developer
- **Start Small**: Test with small projects first (100-1000 photos)
- **Monitor Memory**: Use `process.memoryUsage()` to track memory consumption
- **Log Everything**: Add detailed logging to understand behavior
- **Benchmark**: Measure before/after performance to validate improvements
- **Ask for Help**: If cursor pagination is unclear, ask senior dev for guidance

## Related Files
- `server/services/workers/maintenanceWorker.js` - Main implementation
- `server/services/repositories/photosRepo.js` - Pagination logic
- `server/services/repositories/jobsRepo.js` - Progress tracking
- `config.default.json` - Configuration
