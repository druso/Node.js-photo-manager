# Sprint 1: Database Optimization - Prepared Statement Caching

**Priority**: HIGH  
**Expected Impact**: 20-30% reduction in database query overhead

---

## Objective

Implement prepared statement caching across all repository modules to eliminate redundant SQL compilation overhead and improve database query performance.

---

## Problem Analysis

### Current State

All repository modules use `better-sqlite3` with inline prepared statements that are created on every function call:

```javascript
// Current pattern (inefficient)
function getPhotoById(id) {
  const stmt = db.prepare('SELECT * FROM photos WHERE id = ?');
  return stmt.get(id);
}
```

**Issues**:
- SQL parsing and compilation happens on every call
- No statement reuse across invocations
- Unnecessary CPU overhead
- Slower query execution

### Target State

Cached prepared statements created once at module initialization:

```javascript
// Target pattern (efficient)
let stmtCache = {};

function initStatements(db) {
  stmtCache.getById = db.prepare('SELECT * FROM photos WHERE id = ?');
}

function getPhotoById(id) {
  return stmtCache.getById.get(id);
}
```

**Benefits**:
- SQL compiled once, reused many times
- 20-30% faster query execution
- Lower CPU usage
- Better memory efficiency

---

## Implementation Tasks

### Task 1: Create Statement Cache Infrastructure

**File**: `server/services/repositories/preparedStatements.js` (NEW)

Create a centralized statement cache manager:

```javascript
/**
 * Centralized prepared statement cache
 * Statements are compiled once and reused across all calls
 */

class PreparedStatementCache {
  constructor() {
    this.cache = new Map();
  }

  /**
   * Get or create a prepared statement
   * @param {Database} db - better-sqlite3 database instance
   * @param {string} key - Unique cache key
   * @param {string} sql - SQL query string
   * @returns {Statement} Prepared statement
   */
  get(db, key, sql) {
    if (!this.cache.has(key)) {
      this.cache.set(key, db.prepare(sql));
    }
    return this.cache.get(key);
  }

  /**
   * Clear all cached statements
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

module.exports = new PreparedStatementCache();
```

---

### Task 2: Update photosRepo.js

**File**: `server/services/repositories/photosRepo.js`

#### Step 2.1: Add Statement Cache Import

```javascript
const stmtCache = require('./preparedStatements');
```

#### Step 2.2: Convert All Inline Statements

**Pattern to find**:
```javascript
const stmt = db.prepare('SELECT ...');
return stmt.get(...);
```

**Replace with**:
```javascript
const stmt = stmtCache.get(db, 'unique_key', 'SELECT ...');
return stmt.get(...);
```

**Key Functions to Update**:

1. `getById(id)`
   - Cache key: `'photos:getById'`
   - SQL: `'SELECT * FROM photos WHERE id = ?'`

2. `listByProject(projectFolder, opts)`
   - Cache key: `'photos:listByProject'` (base query)
   - Note: Dynamic WHERE clauses need special handling (see Task 2.3)

3. `updateKeep(id, keepValue)`
   - Cache key: `'photos:updateKeep'`
   - SQL: `'UPDATE photos SET keep = ? WHERE id = ?'`

4. `markDeleted(id)`
   - Cache key: `'photos:markDeleted'`
   - SQL: `'UPDATE photos SET deleted_at = ? WHERE id = ?'`

5. `restore(id)`
   - Cache key: `'photos:restore'`
   - SQL: `'UPDATE photos SET deleted_at = NULL WHERE id = ?'`

6. `physicalDelete(id)`
   - Cache key: `'photos:physicalDelete'`
   - SQL: `'DELETE FROM photos WHERE id = ?'`

#### Step 2.3: Handle Dynamic Queries

For queries with dynamic WHERE clauses (filters, sorting):

**Option A**: Cache base query, build WHERE dynamically
```javascript
function listByProject(projectFolder, opts = {}) {
  const { fileType, keepType, orientation } = opts;
  
  // Build WHERE clause
  const whereClauses = ['project_folder = ?'];
  const params = [projectFolder];
  
  if (fileType && fileType !== 'any') {
    whereClauses.push('file_type = ?');
    params.push(fileType);
  }
  
  // Create cache key from query signature
  const cacheKey = `photos:listByProject:${whereClauses.join(':')}`;
  const sql = `SELECT * FROM photos WHERE ${whereClauses.join(' AND ')}`;
  
  const stmt = stmtCache.get(db, cacheKey, sql);
  return stmt.all(...params);
}
```

**Option B**: Pre-cache common query variations
```javascript
// Cache most common queries at startup
function initCommonQueries(db) {
  stmtCache.get(db, 'photos:list:all', 'SELECT * FROM photos WHERE project_folder = ?');
  stmtCache.get(db, 'photos:list:jpg', 'SELECT * FROM photos WHERE project_folder = ? AND file_type = ?');
  stmtCache.get(db, 'photos:list:raw', 'SELECT * FROM photos WHERE project_folder = ? AND file_type = ?');
  // ... etc
}
```

**Recommendation**: Use Option A for flexibility

---

### Task 3: Update projectsRepo.js

**File**: `server/services/repositories/projectsRepo.js`

Convert all inline prepared statements:

1. `getByFolder(folder)`
   - Cache key: `'projects:getByFolder'`
   - SQL: `'SELECT * FROM projects WHERE folder = ?'`

2. `listAll()`
   - Cache key: `'projects:listAll'`
   - SQL: `'SELECT * FROM projects ORDER BY name'`

3. `create(projectData)`
   - Cache key: `'projects:create'`
   - SQL: `'INSERT INTO projects (folder, name, ...) VALUES (?, ?, ...)'`

4. `update(folder, updates)`
   - Cache key: `'projects:update'`
   - SQL: `'UPDATE projects SET name = ?, ... WHERE folder = ?'`

5. `delete(folder)`
   - Cache key: `'projects:delete'`
   - SQL: `'DELETE FROM projects WHERE folder = ?'`

---

### Task 4: Update jobsRepo.js

**File**: `server/services/repositories/jobsRepo.js`

Convert all inline prepared statements:

1. `create(jobData)`
   - Cache key: `'jobs:create'`
   - SQL: `'INSERT INTO jobs (task_id, task_type, ...) VALUES (?, ?, ...)'`

2. `getById(id)`
   - Cache key: `'jobs:getById'`
   - SQL: `'SELECT * FROM jobs WHERE id = ?'`

3. `claimNext()`
   - Cache key: `'jobs:claimNext'`
   - SQL: `'UPDATE jobs SET status = ?, started_at = ? WHERE id = (SELECT id FROM jobs WHERE status = ? ORDER BY priority DESC, created_at ASC LIMIT 1) RETURNING *'`

4. `updateStatus(id, status, result)`
   - Cache key: `'jobs:updateStatus'`
   - SQL: `'UPDATE jobs SET status = ?, result = ?, completed_at = ? WHERE id = ?'`

5. `listPending()`
   - Cache key: `'jobs:listPending'`
   - SQL: `'SELECT * FROM jobs WHERE status = ? ORDER BY priority DESC, created_at ASC'`

---

### Task 5: Update photoTagsRepo.js

**File**: `server/services/repositories/photoTagsRepo.js`

Convert all inline prepared statements:

1. `addTag(photoId, tag)`
   - Cache key: `'photoTags:add'`
   - SQL: `'INSERT OR IGNORE INTO photo_tags (photo_id, tag) VALUES (?, ?)'`

2. `removeTag(photoId, tag)`
   - Cache key: `'photoTags:remove'`
   - SQL: `'DELETE FROM photo_tags WHERE photo_id = ? AND tag = ?'`

3. `listTagsForPhoto(photoId)`
   - Cache key: `'photoTags:listForPhoto'`
   - SQL: `'SELECT tag FROM photo_tags WHERE photo_id = ? ORDER BY tag'`

4. `listTagsForPhotos(photoIds)`
   - Note: Dynamic IN clause, needs special handling
   - Build cache key from array length: `'photoTags:listForPhotos:' + photoIds.length`

---

### Task 6: Testing & Validation

#### 6.1 Unit Tests

Create test file: `server/tests/preparedStatements.test.js`

```javascript
const assert = require('assert');
const stmtCache = require('../services/repositories/preparedStatements');
const { getDb } = require('../services/db');

describe('PreparedStatementCache', () => {
  it('should cache statements', () => {
    const db = getDb();
    const stmt1 = stmtCache.get(db, 'test:query', 'SELECT 1');
    const stmt2 = stmtCache.get(db, 'test:query', 'SELECT 1');
    assert.strictEqual(stmt1, stmt2, 'Should return same statement instance');
  });

  it('should return different statements for different keys', () => {
    const db = getDb();
    const stmt1 = stmtCache.get(db, 'test:query1', 'SELECT 1');
    const stmt2 = stmtCache.get(db, 'test:query2', 'SELECT 2');
    assert.notStrictEqual(stmt1, stmt2, 'Should return different statements');
  });

  it('should clear cache', () => {
    const db = getDb();
    stmtCache.get(db, 'test:query', 'SELECT 1');
    stmtCache.clear();
    const stats = stmtCache.getStats();
    assert.strictEqual(stats.size, 0, 'Cache should be empty');
  });
});
```

#### 6.2 Performance Benchmarks

Create benchmark file: `server/tests/benchmarks/preparedStatements.bench.js`

```javascript
const { getDb } = require('../../services/db');
const stmtCache = require('../../services/repositories/preparedStatements');

function benchmarkInline(iterations) {
  const db = getDb();
  const start = Date.now();
  
  for (let i = 0; i < iterations; i++) {
    const stmt = db.prepare('SELECT * FROM photos WHERE id = ?');
    stmt.get(1);
  }
  
  return Date.now() - start;
}

function benchmarkCached(iterations) {
  const db = getDb();
  const start = Date.now();
  
  for (let i = 0; i < iterations; i++) {
    const stmt = stmtCache.get(db, 'bench:test', 'SELECT * FROM photos WHERE id = ?');
    stmt.get(1);
  }
  
  return Date.now() - start;
}

// Run benchmarks
const iterations = 10000;
const inlineTime = benchmarkInline(iterations);
const cachedTime = benchmarkCached(iterations);

console.log(`Inline: ${inlineTime}ms`);
console.log(`Cached: ${cachedTime}ms`);
console.log(`Improvement: ${((inlineTime - cachedTime) / inlineTime * 100).toFixed(1)}%`);
```

**Expected Results**: 20-30% improvement

#### 6.3 Integration Tests

Verify all repository functions still work correctly:

```bash
npm test -- --grep "photosRepo"
npm test -- --grep "projectsRepo"
npm test -- --grep "jobsRepo"
npm test -- --grep "photoTagsRepo"
```

All existing tests should pass without modification.

---

## Verification Checklist

- [ ] `preparedStatements.js` created with cache manager
- [ ] All `photosRepo.js` functions use cached statements
- [ ] All `projectsRepo.js` functions use cached statements
- [ ] All `jobsRepo.js` functions use cached statements
- [ ] All `photoTagsRepo.js` functions use cached statements
- [ ] Unit tests pass
- [ ] Performance benchmarks show 20-30% improvement
- [ ] Integration tests pass
- [ ] No functionality regressions
- [ ] Cache statistics available for monitoring

---

## Common Pitfalls

### Pitfall 1: Incorrect Cache Keys

**Problem**: Using same cache key for different queries
```javascript
// WRONG - same key for different queries
stmtCache.get(db, 'photos:list', 'SELECT * FROM photos WHERE project_folder = ?');
stmtCache.get(db, 'photos:list', 'SELECT * FROM photos WHERE id = ?');
```

**Solution**: Use descriptive, unique keys
```javascript
// CORRECT
stmtCache.get(db, 'photos:listByProject', 'SELECT * FROM photos WHERE project_folder = ?');
stmtCache.get(db, 'photos:getById', 'SELECT * FROM photos WHERE id = ?');
```

### Pitfall 2: Dynamic SQL Without Cache Key Variation

**Problem**: Same cache key for queries with different WHERE clauses
```javascript
// WRONG - cache key doesn't reflect query variation
const sql = `SELECT * FROM photos WHERE ${whereClause}`;
stmtCache.get(db, 'photos:list', sql); // Same key, different SQL!
```

**Solution**: Include query signature in cache key
```javascript
// CORRECT
const cacheKey = `photos:list:${whereClauses.join(':')}`;
stmtCache.get(db, cacheKey, sql);
```

### Pitfall 3: Not Handling Database Reconnection

**Problem**: Cached statements become invalid if database is closed/reopened

**Solution**: Clear cache on database reconnection
```javascript
// In db.js
function reconnect() {
  db.close();
  db = new Database(dbPath);
  stmtCache.clear(); // Clear stale statements
}
```

---

## Success Metrics

### Performance Targets

- **Query execution time**: 20-30% reduction
- **CPU usage**: 10-15% reduction during heavy query load
- **Memory usage**: Stable (no increase from caching)

### Monitoring

Add logging to track cache effectiveness:

```javascript
// In preparedStatements.js
get(db, key, sql) {
  const isHit = this.cache.has(key);
  if (!isHit) {
    this.cache.set(key, db.prepare(sql));
  }
  
  // Log cache statistics periodically
  if (Math.random() < 0.01) { // 1% sample
    console.log('[PreparedStatements] Cache stats:', this.getStats());
  }
  
  return this.cache.get(key);
}
```

---

## References

- **better-sqlite3 docs**: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#preparestring---statement
- **SQLite prepared statements**: https://www.sqlite.org/c3ref/prepare.html
- **Current implementation**: `server/services/repositories/*.js`
