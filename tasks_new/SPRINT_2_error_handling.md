# Sprint 2: Error Handling & Logging Improvements

**Priority**: HIGH  
**Expected Impact**: Improved debugging, better production stability, reduced MTTR

---

## Objective

Replace empty catch blocks and console.log statements with structured logging throughout the codebase to improve observability and error tracking.

---

## Problem Analysis

### Current Issues

**Empty Catch Blocks**:
```javascript
try {
  await riskyOperation();
} catch (err) {
  // Silent failure - no visibility into errors
}
```

**Console.log in Production**:
```javascript
console.log('Processing photo:', photoId); // Lost in production
console.error('Failed:', err); // No context, no structure
```

**Impact**:
- Errors disappear silently
- No audit trail for debugging
- Cannot track error patterns
- Poor production observability

### Target State

**Structured Logging**:
```javascript
const log = makeLogger('photo-processor');

try {
  await riskyOperation();
} catch (err) {
  log.error('risky_operation_failed', {
    error: err.message,
    stack: err.stack,
    photoId,
    context: 'additional data'
  });
  throw err; // Re-throw if appropriate
}
```

**Benefits**:
- All errors logged with context
- Structured data for analysis
- Searchable logs
- Better debugging

---

## Implementation Tasks

### Task 1: Audit Codebase for Issues

#### 1.1 Find Empty Catch Blocks

Search for pattern:
```bash
grep -r "catch.*{" server/ | grep -A 2 "catch"
```

Look for:
```javascript
catch (err) {
  // Empty or just return
}
catch (e) {}
catch {
  return null;
}
```

**Files to check**:
- `server/routes/*.js`
- `server/services/**/*.js`
- `server/middleware/*.js`

#### 1.2 Find Console.log Statements

Search for:
```bash
grep -r "console\\.log\\|console\\.error\\|console\\.warn" server/
```

**Exclude**:
- Development-only files
- Test files
- Startup messages (keep minimal)

---

### Task 2: Replace Empty Catch Blocks

For each empty catch block, determine the appropriate action:

#### Pattern A: Log and Continue

**Use when**: Error is expected and non-critical

```javascript
// BEFORE
try {
  const metadata = await fetchOptionalMetadata(photoId);
} catch (err) {
  // Silent failure
}

// AFTER
const log = makeLogger('metadata-fetcher');
try {
  const metadata = await fetchOptionalMetadata(photoId);
} catch (err) {
  log.warn('optional_metadata_fetch_failed', {
    error: err.message,
    photoId,
    reason: 'Metadata is optional, continuing without it'
  });
  // Continue execution
}
```

#### Pattern B: Log and Re-throw

**Use when**: Error should propagate but needs logging

```javascript
// BEFORE
try {
  await criticalOperation();
} catch (err) {
  // Silent failure, but error should propagate
  throw err;
}

// AFTER
const log = makeLogger('critical-ops');
try {
  await criticalOperation();
} catch (err) {
  log.error('critical_operation_failed', {
    error: err.message,
    stack: err.stack,
    operation: 'criticalOperation',
    context: { /* relevant data */ }
  });
  throw err; // Propagate to caller
}
```

#### Pattern C: Log and Return Default

**Use when**: Function should return a safe default on error

```javascript
// BEFORE
function getPhotoCount(projectFolder) {
  try {
    const result = db.prepare('SELECT COUNT(*) as c FROM photos WHERE project_folder = ?').get(projectFolder);
    return result.c;
  } catch (err) {
    return 0;
  }
}

// AFTER
const log = makeLogger('photo-repo');
function getPhotoCount(projectFolder) {
  try {
    const result = db.prepare('SELECT COUNT(*) as c FROM photos WHERE project_folder = ?').get(projectFolder);
    return result.c;
  } catch (err) {
    log.error('photo_count_query_failed', {
      error: err.message,
      stack: err.stack,
      projectFolder,
      defaultValue: 0
    });
    return 0;
  }
}
```

---

### Task 3: Replace Console.log Statements

#### 3.1 Import Logger

At top of each file:
```javascript
const makeLogger = require('../utils/logger2');
const log = makeLogger('module-name'); // Use descriptive module name
```

#### 3.2 Replace Console Statements

**Debug Information**:
```javascript
// BEFORE
console.log('Processing photo:', photoId);

// AFTER
log.debug('processing_photo', { photoId });
```

**Info Messages**:
```javascript
// BEFORE
console.log('Upload completed:', { count: files.length });

// AFTER
log.info('upload_completed', { fileCount: files.length });
```

**Warnings**:
```javascript
// BEFORE
console.warn('Rate limit approaching:', ip);

// AFTER
log.warn('rate_limit_approaching', { ip, threshold: '80%' });
```

**Errors**:
```javascript
// BEFORE
console.error('Failed to process:', err);

// AFTER
log.error('processing_failed', {
  error: err.message,
  stack: err.stack,
  context: { /* relevant data */ }
});
```

---

### Task 4: File-by-File Updates

#### 4.1 Server Routes

**Files**:
- `server/routes/photos.js`
- `server/routes/projects.js`
- `server/routes/uploads.js`
- `server/routes/assets.js`
- `server/routes/auth.js`
- `server/routes/jobs.js`
- `server/routes/sse.js`
- `server/routes/maintenance.js`

**Actions**:
1. Add logger import at top
2. Replace all console.log/error/warn
3. Add error logging to catch blocks
4. Use descriptive event names (snake_case)

**Example** (`server/routes/photos.js`):
```javascript
const makeLogger = require('../utils/logger2');
const log = makeLogger('routes-photos');

// Replace console.log
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  log.debug('get_photo_request', { photoId: id });
  
  try {
    const photo = await photosRepo.getById(id);
    if (!photo) {
      log.warn('photo_not_found', { photoId: id });
      return res.status(404).json({ error: 'Photo not found' });
    }
    res.json(photo);
  } catch (err) {
    log.error('get_photo_failed', {
      error: err.message,
      stack: err.stack,
      photoId: id
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

#### 4.2 Repository Modules

**Files**:
- `server/services/repositories/photosRepo.js`
- `server/services/repositories/projectsRepo.js`
- `server/services/repositories/jobsRepo.js`
- `server/services/repositories/photoTagsRepo.js`

**Actions**:
1. Add logger for each repository
2. Log database errors with context
3. Log unexpected conditions

**Example** (`server/services/repositories/photosRepo.js`):
```javascript
const makeLogger = require('../../utils/logger2');
const log = makeLogger('photos-repo');

function getById(id) {
  try {
    const stmt = db.prepare('SELECT * FROM photos WHERE id = ?');
    const photo = stmt.get(id);
    
    if (!photo) {
      log.debug('photo_not_found', { photoId: id });
    }
    
    return photo;
  } catch (err) {
    log.error('get_photo_by_id_failed', {
      error: err.message,
      stack: err.stack,
      photoId: id,
      query: 'SELECT * FROM photos WHERE id = ?'
    });
    throw err;
  }
}
```

#### 4.3 Service Modules

**Files**:
- `server/services/imageProcessor.js`
- `server/services/manifestService.js`
- `server/services/uploadService.js`
- `server/services/jobRunner.js`

**Actions**:
1. Add structured logging for all operations
2. Log start/end of long-running operations
3. Log errors with full context

**Example** (`server/services/imageProcessor.js`):
```javascript
const makeLogger = require('../utils/logger2');
const log = makeLogger('image-processor');

async function generateThumbnail(sourcePath, outputPath) {
  log.info('thumbnail_generation_started', {
    source: sourcePath,
    output: outputPath
  });
  
  try {
    await sharp(sourcePath)
      .resize(200, 200)
      .toFile(outputPath);
    
    log.info('thumbnail_generation_completed', {
      source: sourcePath,
      output: outputPath
    });
  } catch (err) {
    log.error('thumbnail_generation_failed', {
      error: err.message,
      stack: err.stack,
      source: sourcePath,
      output: outputPath
    });
    throw err;
  }
}
```

#### 4.4 Middleware

**Files**:
- `server/middleware/errorHandler.js`
- `server/middleware/authenticateAdmin.js`
- `server/middleware/accessLog.js`

**Actions**:
1. Ensure all errors are logged before responding
2. Include request context in logs

**Example** (`server/middleware/errorHandler.js`):
```javascript
const makeLogger = require('../utils/logger2');
const log = makeLogger('error-handler');

function errorHandler(err, req, res, next) {
  log.error('request_error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userId: req.user?.id
  });
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
}
```

---

### Task 5: Logging Best Practices

#### 5.1 Event Naming Convention

Use **snake_case** for event names:
```javascript
// GOOD
log.info('photo_upload_started', { ... });
log.error('database_connection_failed', { ... });
log.warn('rate_limit_exceeded', { ... });

// BAD
log.info('PhotoUploadStarted', { ... }); // PascalCase
log.error('database-connection-failed', { ... }); // kebab-case
log.warn('Rate Limit Exceeded', { ... }); // Spaces
```

#### 5.2 Include Relevant Context

Always include data needed for debugging:
```javascript
// GOOD - Includes all relevant context
log.error('photo_processing_failed', {
  error: err.message,
  stack: err.stack,
  photoId: photo.id,
  projectFolder: photo.project_folder,
  fileType: photo.file_type,
  operation: 'thumbnail_generation'
});

// BAD - Missing context
log.error('error', { error: err.message });
```

#### 5.3 Log Levels

**debug**: Detailed diagnostic information
```javascript
log.debug('cache_hit', { key: cacheKey });
```

**info**: Normal operational events
```javascript
log.info('server_started', { port: 3000 });
```

**warn**: Potentially harmful situations
```javascript
log.warn('slow_query', { duration: 5000, query: sql });
```

**error**: Error events that might still allow the app to continue
```javascript
log.error('api_call_failed', { error: err.message, endpoint: '/api/photos' });
```

#### 5.4 Avoid Logging Sensitive Data

**Never log**:
- Passwords
- API keys
- Tokens
- Personal information (unless necessary)

```javascript
// BAD
log.info('user_login', { username, password }); // Never log passwords!

// GOOD
log.info('user_login', { username, success: true });
```

---

## Verification Checklist

- [ ] All empty catch blocks have logging
- [ ] All console.log replaced with structured logging
- [ ] All console.error replaced with log.error
- [ ] All console.warn replaced with log.warn
- [ ] Logger imported in all modified files
- [ ] Event names use snake_case
- [ ] All errors include stack traces
- [ ] Context data included in all logs
- [ ] No sensitive data in logs
- [ ] Application still functions correctly

---

## Testing

### Manual Testing

1. **Trigger errors intentionally**:
   - Try to access non-existent photo
   - Upload invalid file
   - Make request with invalid auth

2. **Check logs**:
   ```bash
   # Watch logs in real-time
   tail -f logs/app.log | jq
   
   # Search for specific events
   grep "photo_not_found" logs/app.log | jq
   ```

3. **Verify structure**:
   - All logs should be valid JSON
   - All logs should have timestamp
   - All logs should have level
   - All logs should have event name

### Automated Testing

Run existing tests to ensure no regressions:
```bash
npm test
```

All tests should still pass.

---

## Common Pitfalls

### Pitfall 1: Swallowing Errors

**Problem**: Logging but not propagating critical errors
```javascript
// BAD - Error is logged but swallowed
try {
  await criticalOperation();
} catch (err) {
  log.error('operation_failed', { error: err.message });
  // Error is lost!
}
```

**Solution**: Re-throw if caller needs to handle it
```javascript
// GOOD - Error is logged AND propagated
try {
  await criticalOperation();
} catch (err) {
  log.error('operation_failed', { error: err.message });
  throw err; // Caller can handle
}
```

### Pitfall 2: Over-logging

**Problem**: Logging too much, creating noise
```javascript
// BAD - Logs every iteration
for (const photo of photos) {
  log.debug('processing_photo', { photoId: photo.id }); // Too verbose!
  processPhoto(photo);
}
```

**Solution**: Log summary or sample
```javascript
// GOOD - Log summary
log.info('batch_processing_started', { photoCount: photos.length });
for (const photo of photos) {
  processPhoto(photo);
}
log.info('batch_processing_completed', { photoCount: photos.length });
```

### Pitfall 3: Missing Stack Traces

**Problem**: Logging error message without stack trace
```javascript
// BAD - No stack trace
log.error('operation_failed', { error: err.message });
```

**Solution**: Always include stack trace for errors
```javascript
// GOOD - Includes stack trace
log.error('operation_failed', {
  error: err.message,
  stack: err.stack
});
```

---

## Success Metrics

### Code Quality

- **Zero empty catch blocks** in production code
- **Zero console.log** statements in server code
- **100% error logging** coverage

### Observability

- All errors visible in logs
- All errors include context
- Logs are searchable and structured
- Can trace request flow through logs

---

## References

- **Logger implementation**: `server/utils/logger2.js`
- **Logging best practices**: https://www.loggly.com/ultimate-guide/node-logging-basics/
- **Structured logging**: https://engineering.linkedin.com/distributed-systems/log-what-every-software-engineer-should-know-about-real-time-datas-unifying
