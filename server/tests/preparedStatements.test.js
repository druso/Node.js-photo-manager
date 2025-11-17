const assert = require('assert');
const { describe, it, beforeEach } = require('node:test');
const stmtCache = require('../services/repositories/preparedStatements');
const { getDb } = require('../services/db');

describe('PreparedStatementCache', () => {
  beforeEach(() => {
    // Clear cache before each test
    stmtCache.clear();
  });

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
    const statsBefore = stmtCache.getStats();
    assert.strictEqual(statsBefore.size, 1, 'Cache should have 1 statement');
    
    stmtCache.clear();
    const statsAfter = stmtCache.getStats();
    assert.strictEqual(statsAfter.size, 0, 'Cache should be empty');
    assert.strictEqual(statsAfter.hits, 0, 'Hits should be reset');
    assert.strictEqual(statsAfter.misses, 0, 'Misses should be reset');
  });

  it('should track cache hits and misses', () => {
    const db = getDb();
    
    // First access - miss
    stmtCache.get(db, 'test:query', 'SELECT 1');
    let stats = stmtCache.getStats();
    assert.strictEqual(stats.misses, 1, 'Should have 1 miss');
    assert.strictEqual(stats.hits, 0, 'Should have 0 hits');
    
    // Second access - hit
    stmtCache.get(db, 'test:query', 'SELECT 1');
    stats = stmtCache.getStats();
    assert.strictEqual(stats.misses, 1, 'Should still have 1 miss');
    assert.strictEqual(stats.hits, 1, 'Should have 1 hit');
    
    // Third access - hit
    stmtCache.get(db, 'test:query', 'SELECT 1');
    stats = stmtCache.getStats();
    assert.strictEqual(stats.hits, 2, 'Should have 2 hits');
  });

  it('should calculate hit rate correctly', () => {
    const db = getDb();
    
    // 1 miss, 0 hits = 0% hit rate
    stmtCache.get(db, 'test:query1', 'SELECT 1');
    assert.strictEqual(stmtCache.getHitRate(), '0.00');
    
    // 1 miss, 1 hit = 50% hit rate
    stmtCache.get(db, 'test:query1', 'SELECT 1');
    assert.strictEqual(stmtCache.getHitRate(), '50.00');
    
    // 1 miss, 2 hits = 66.67% hit rate
    stmtCache.get(db, 'test:query1', 'SELECT 1');
    assert.strictEqual(stmtCache.getHitRate(), '66.67');
  });

  it('should execute cached statements correctly', () => {
    const db = getDb();
    const stmt = stmtCache.get(db, 'test:select', 'SELECT 1 as value');
    const result = stmt.get();
    assert.strictEqual(result.value, 1, 'Statement should execute correctly');
  });

  it('should handle parameterized queries', () => {
    const db = getDb();
    const stmt = stmtCache.get(db, 'test:param', 'SELECT ? as value');
    const result = stmt.get(42);
    assert.strictEqual(result.value, 42, 'Should handle parameters correctly');
  });

  it('should throw error for missing database', () => {
    assert.throws(
      () => stmtCache.get(null, 'test:key', 'SELECT 1'),
      /Database instance is required/,
      'Should throw error for null database'
    );
  });

  it('should throw error for missing cache key', () => {
    const db = getDb();
    assert.throws(
      () => stmtCache.get(db, '', 'SELECT 1'),
      /Cache key is required/,
      'Should throw error for empty key'
    );
  });

  it('should throw error for missing SQL', () => {
    const db = getDb();
    assert.throws(
      () => stmtCache.get(db, 'test:key', ''),
      /SQL query is required/,
      'Should throw error for empty SQL'
    );
  });

  it('should check if statement is cached', () => {
    const db = getDb();
    assert.strictEqual(stmtCache.has('test:query'), false, 'Should not have uncached statement');
    
    stmtCache.get(db, 'test:query', 'SELECT 1');
    assert.strictEqual(stmtCache.has('test:query'), true, 'Should have cached statement');
  });

  it('should delete specific statement from cache', () => {
    const db = getDb();
    stmtCache.get(db, 'test:query1', 'SELECT 1');
    stmtCache.get(db, 'test:query2', 'SELECT 2');
    
    assert.strictEqual(stmtCache.getStats().size, 2, 'Should have 2 statements');
    
    const deleted = stmtCache.delete('test:query1');
    assert.strictEqual(deleted, true, 'Should return true for successful delete');
    assert.strictEqual(stmtCache.getStats().size, 1, 'Should have 1 statement remaining');
    assert.strictEqual(stmtCache.has('test:query1'), false, 'Deleted statement should not exist');
    assert.strictEqual(stmtCache.has('test:query2'), true, 'Other statement should still exist');
  });

  it('should return stats with all keys', () => {
    const db = getDb();
    stmtCache.get(db, 'test:query1', 'SELECT 1');
    stmtCache.get(db, 'test:query2', 'SELECT 2');
    stmtCache.get(db, 'test:query3', 'SELECT 3');
    
    const stats = stmtCache.getStats();
    assert.strictEqual(stats.keys.length, 3, 'Should have 3 keys');
    assert.ok(stats.keys.includes('test:query1'), 'Should include query1');
    assert.ok(stats.keys.includes('test:query2'), 'Should include query2');
    assert.ok(stats.keys.includes('test:query3'), 'Should include query3');
  });

  it('should handle dynamic cache keys correctly', () => {
    const db = getDb();
    
    // Simulate dynamic WHERE clause building
    const conditions = ['project_id = ?', 'status = ?'];
    const cacheKey = `jobs:list:${conditions.join(':')}`;
    
    const stmt1 = stmtCache.get(db, cacheKey, 'SELECT * FROM jobs WHERE project_id = ? AND status = ?');
    const stmt2 = stmtCache.get(db, cacheKey, 'SELECT * FROM jobs WHERE project_id = ? AND status = ?');
    
    assert.strictEqual(stmt1, stmt2, 'Dynamic cache keys should work correctly');
    assert.strictEqual(stmtCache.getStats().size, 1, 'Should only cache one statement');
  });
});
