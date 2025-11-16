# Sprint 1: Prepared Statement Caching

**Assignee**: Junior Developer  
**Estimated Effort**: 2-3 hours  
**Priority**: HIGH  
**Expected Impact**: 10-30% query performance improvement  
**Difficulty**: ⭐⭐ (Medium)

---

## 📋 Overview

Currently, every database query calls `.prepare()` which compiles the SQL statement from scratch. This is inefficient because the same queries are executed repeatedly. By caching prepared statements, we can significantly improve query performance.

**Current Problem**:
```javascript
// ❌ BAD - Compiles SQL on every call
function getById(id) {
  const db = getDb();
  return db.prepare(`SELECT * FROM photos WHERE id = ?`).get(id);
}
```

**After This Sprint**:
```javascript
// ✅ GOOD - Reuses compiled statement
function getById(id) {
  const db = getDb();
  return getPrepared(db, `SELECT * FROM photos WHERE id = ?`).get(id);
}
```

---

## 🎯 Learning Objectives

By completing this sprint, you will learn:
1. How SQL statement compilation works
2. Caching patterns in Node.js
3. Performance optimization techniques
4. Working with better-sqlite3 library

---

## 📚 Background Reading (15 minutes)

### What is a Prepared Statement?

When you call `db.prepare(sql)`, SQLite:
1. **Parses** the SQL string
2. **Compiles** it into bytecode
3. **Optimizes** the execution plan
4. Returns a statement object

This process takes time! By caching the statement object, we skip steps 1-3 on subsequent calls.

### Why Cache?

**Without caching**:
- Every `getById()` call compiles the same SQL
- 100 calls = 100 compilations
- Wastes CPU and time

**With caching**:
- First call compiles and caches
- Next 99 calls reuse cached statement
- 100 calls = 1 compilation

**Expected speedup**: 10-30% for frequently-called queries

---

## 🛠️ Implementation Steps

### Step 1: Create the Cache Utility (30 minutes)

**File**: `server/utils/preparedStatementCache.js` (NEW FILE)

```javascript
/**
 * Prepared Statement Cache for better-sqlite3
 * 
 * Caches compiled SQL statements to avoid recompilation overhead.
 * Each database instance gets its own cache.
 */

// WeakMap allows garbage collection when db instance is destroyed
const cachesByDb = new WeakMap();

/**
 * Get or create a prepared statement cache for a database instance
 * @param {Database} db - better-sqlite3 database instance
 * @returns {Map} Cache map for this database
 */
function getCacheForDb(db) {
  if (!cachesByDb.has(db)) {
    cachesByDb.set(db, new Map());
  }
  return cachesByDb.get(db);
}

/**
 * Get a cached prepared statement, or create and cache it
 * @param {Database} db - better-sqlite3 database instance
 * @param {string} sql - SQL query string
 * @returns {Statement} Prepared statement object
 */
function getPrepared(db, sql) {
  const cache = getCacheForDb(db);
  
  if (!cache.has(sql)) {
    // First time seeing this SQL - compile and cache it
    const stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  
  return cache.get(sql);
}

/**
 * Clear the cache for a specific database (useful for testing)
 * @param {Database} db - better-sqlite3 database instance
 */
function clearCache(db) {
  const cache = getCacheForDb(db);
  cache.clear();
}

/**
 * Get cache statistics for debugging
 * @param {Database} db - better-sqlite3 database instance
 * @returns {Object} Stats object with cache size
 */
function getCacheStats(db) {
  const cache = getCacheForDb(db);
  return {
    size: cache.size,
    statements: Array.from(cache.keys()).map(sql => sql.substring(0, 50) + '...')
  };
}

module.exports = {
  getPrepared,
  clearCache,
  getCacheStats
};
```

**Testing Your Utility**:

Create `server/utils/__tests__/preparedStatementCache.test.js`:

```javascript
const Database = require('better-sqlite3');
const { getPrepared, clearCache, getCacheStats } = require('../preparedStatementCache');

describe('preparedStatementCache', () => {
  let db;
  
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
  });
  
  afterEach(() => {
    db.close();
  });
  
  it('should cache prepared statements', () => {
    const sql = 'SELECT * FROM test WHERE id = ?';
    
    // First call - should compile and cache
    const stmt1 = getPrepared(db, sql);
    
    // Second call - should return cached statement
    const stmt2 = getPrepared(db, sql);
    
    // Should be the exact same object
    expect(stmt1).toBe(stmt2);
  });
  
  it('should track cache size', () => {
    getPrepared(db, 'SELECT * FROM test WHERE id = ?');
    getPrepared(db, 'SELECT * FROM test WHERE name = ?');
    
    const stats = getCacheStats(db);
    expect(stats.size).toBe(2);
  });
  
  it('should clear cache', () => {
    getPrepared(db, 'SELECT * FROM test WHERE id = ?');
    expect(getCacheStats(db).size).toBe(1);
    
    clearCache(db);
    expect(getCacheStats(db).size).toBe(0);
  });
});
```

Run the test:
```bash
npm test -- preparedStatementCache.test.js
```

---

### Step 2: Update photoCrud.js (30 minutes)

**File**: `server/services/repositories/photoCrud.js`

**Import the utility at the top**:
```javascript
const { getPrepared } = require('../../utils/preparedStatementCache');
```

**Find and replace pattern**:

❌ **Before**:
```javascript
return db.prepare(`SELECT * FROM photos WHERE id = ?`).get(id);
```

✅ **After**:
```javascript
return getPrepared(db, `SELECT * FROM photos WHERE id = ?`).get(id);
```

**Files to update** (17 instances):
1. `getById()` - line ~14
2. `getByManifestId()` - line ~25
3. `getByFilename()` - line ~36
4. `getByProjectAndFilename()` - line ~48
5. `getGlobalByFilename()` - line ~68
6. `upsertPhoto()` - lines ~85, ~95
7. `updateDerivativeStatus()` - line ~140
8. `updateKeepFlags()` - line ~160
9. `updateVisibility()` - line ~180
10. `moveToProject()` - line ~200
11. `removeById()` - line ~220
12. `countByProject()` - line ~240
13. `getPublicByFilename()` - line ~260
14. `getPublicByBasename()` - line ~280
15. `getAnyVisibilityByFilename()` - line ~300
16. `getAnyVisibilityByBasename()` - line ~320

**Pro Tip**: Use your IDE's "Find and Replace" feature:
- Find: `db.prepare(`
- Replace: `getPrepared(db, `

---

### Step 3: Update photoFiltering.js (30 minutes)

**File**: `server/services/repositories/photoFiltering.js`

Same pattern - import the utility and replace all `db.prepare(` with `getPrepared(db, `.

**Instances to update** (12 total):
- Lines in `listAll()` function
- Lines in `listProjectFiltered()` function
- Lines in `listSharedLinkPhotos()` function
- Lines in `listAllKeys()` function

---

### Step 4: Update jobsRepo.js (30 minutes)

**File**: `server/services/repositories/jobsRepo.js`

**Instances to update** (23 total):
- `getById()` - line ~37
- `listByProject()` - line ~48
- `listByTenant()` - line ~60
- `enqueue()` - line ~69
- `enqueueWithItems()` - line ~100
- `claimNext()` - line ~119, ~122
- `heartbeat()` - line ~129
- `updateProgress()` - line ~140
- `updatePayload()` - line ~148
- And more...

---

### Step 5: Update projectsRepo.js (30 minutes)

**File**: `server/services/repositories/projectsRepo.js`

**Instances to update** (13 total):
- `getById()` - line ~20
- `getByFolder()` - line ~30
- `list()` - line ~54
- `create()` - line ~70
- `updateName()` - line ~90
- And more...

---

### Step 6: Update Remaining Repositories (30 minutes)

Apply the same pattern to:
- `photoPagination.js`
- `photoPendingOps.js`
- `tagsRepo.js`
- `photoTagsRepo.js`
- `publicLinksRepo.js`
- `photoPublicHashesRepo.js`

---

## ✅ Testing Checklist

### Unit Tests
- [ ] `preparedStatementCache.test.js` passes
- [ ] Run `npm test` - all existing tests still pass

### Manual Testing
1. [ ] Start the server: `npm start`
2. [ ] Load a project - should work normally
3. [ ] Filter photos - should work normally
4. [ ] Upload photos - should work normally
5. [ ] Check logs - no errors

### Performance Testing

Create a simple benchmark script `scripts/benchmark-queries.js`:

```javascript
const { getDb } = require('../server/services/db');
const photosRepo = require('../server/services/repositories/photosRepo');

async function benchmark() {
  const db = getDb();
  
  // Get a photo ID from the database
  const photo = db.prepare('SELECT id FROM photos LIMIT 1').get();
  if (!photo) {
    console.log('No photos in database - add some first');
    return;
  }
  
  const iterations = 1000;
  
  console.log(`Running ${iterations} queries...`);
  const start = Date.now();
  
  for (let i = 0; i < iterations; i++) {
    photosRepo.getById(photo.id);
  }
  
  const elapsed = Date.now() - start;
  const perQuery = elapsed / iterations;
  
  console.log(`Total time: ${elapsed}ms`);
  console.log(`Per query: ${perQuery.toFixed(2)}ms`);
  console.log(`Queries/sec: ${(1000 / perQuery).toFixed(0)}`);
}

benchmark().catch(console.error);
```

Run before and after:
```bash
# Before caching
node scripts/benchmark-queries.js

# After caching (should be 10-30% faster)
node scripts/benchmark-queries.js
```

---

## 📊 Success Criteria

- [ ] All 160+ `db.prepare()` calls replaced with `getPrepared()`
- [ ] All tests pass (`npm test`)
- [ ] Server starts without errors
- [ ] Manual testing confirms functionality works
- [ ] Benchmark shows 10-30% improvement
- [ ] No console errors in production

---

## 🐛 Common Pitfalls

### Pitfall 1: Forgetting to Import

**Error**: `getPrepared is not defined`

**Fix**: Add import at top of file:
```javascript
const { getPrepared } = require('../../utils/preparedStatementCache');
```

### Pitfall 2: Wrong Number of Arguments

**Error**: `TypeError: db.prepare is not a function`

**Fix**: Make sure you're passing both `db` and `sql`:
```javascript
// ❌ Wrong
getPrepared(`SELECT * FROM photos WHERE id = ?`)

// ✅ Correct
getPrepared(db, `SELECT * FROM photos WHERE id = ?`)
```

### Pitfall 3: Dynamic SQL

**Problem**: SQL with string concatenation won't cache properly

```javascript
// ❌ BAD - Different SQL string each time
const sql = `SELECT * FROM photos WHERE project_id = ${projectId}`;
getPrepared(db, sql).all();

// ✅ GOOD - Same SQL string, different parameter
getPrepared(db, `SELECT * FROM photos WHERE project_id = ?`).all(projectId);
```

---

## 🎓 Learning Resources

- [better-sqlite3 Documentation](https://github.com/WiseLibs/better-sqlite3/wiki)
- [SQLite Prepared Statements](https://www.sqlite.org/c3ref/prepare.html)
- [JavaScript WeakMap](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakMap)

---

## 📝 Submission Checklist

Before marking this sprint as complete:

- [ ] Created `preparedStatementCache.js` utility
- [ ] Created unit tests for the utility
- [ ] Updated all repository files
- [ ] All tests pass
- [ ] Benchmark shows improvement
- [ ] Committed changes with message: "feat: add prepared statement caching for 10-30% query performance improvement"
- [ ] Created PR with before/after benchmark results

---

## 🆘 Need Help?

If you get stuck:
1. Check the "Common Pitfalls" section above
2. Run `npm test` to see which tests are failing
3. Check the server logs for errors
4. Ask a senior developer for code review

**Estimated Time**: 2-3 hours  
**Actual Time**: _____ hours (fill this in when done)

---

## 📈 Impact Metrics

After completing this sprint, you should see:
- **10-30% faster** query execution
- **Reduced CPU** usage during high load
- **Better scalability** for concurrent users
- **~160 queries** now using cached statements

**Well done!** 🎉
