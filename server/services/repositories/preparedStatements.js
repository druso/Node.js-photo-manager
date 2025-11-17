/**
 * Centralized prepared statement cache for better-sqlite3
 * 
 * Statements are compiled once and reused across all calls, eliminating
 * redundant SQL parsing and compilation overhead.
 * 
 * Expected performance improvement: 20-30% reduction in query execution time
 */

const makeLogger = require('../../utils/logger2');
const log = makeLogger('preparedStatements');

class PreparedStatementCache {
  constructor() {
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      created: 0
    };
  }

  /**
   * Get or create a prepared statement
   * 
   * @param {Database} db - better-sqlite3 database instance
   * @param {string} key - Unique cache key (format: module:operation:conditions)
   * @param {string} sql - SQL query string
   * @returns {Statement} Prepared statement ready for execution
   * 
   * @example
   * const stmt = stmtCache.get(db, 'photos:getById', 'SELECT * FROM photos WHERE id = ?');
   * const photo = stmt.get(photoId);
   */
  get(db, key, sql) {
    if (!db) {
      throw new Error('Database instance is required');
    }
    if (!key) {
      throw new Error('Cache key is required');
    }
    if (!sql) {
      throw new Error('SQL query is required');
    }

    if (this.cache.has(key)) {
      this.stats.hits++;
      return this.cache.get(key);
    }

    // Cache miss - compile and store the statement
    this.stats.misses++;
    this.stats.created++;
    
    try {
      const stmt = db.prepare(sql);
      this.cache.set(key, stmt);
      
      // Log cache miss for monitoring (sample 1% to avoid log spam)
      if (Math.random() < 0.01) {
        log.debug('cache_miss', { 
          key, 
          cache_size: this.cache.size,
          hit_rate: this.getHitRate()
        });
      }
      
      return stmt;
    } catch (error) {
      log.error('prepare_failed', { key, sql, error: error.message });
      throw error;
    }
  }

  /**
   * Clear all cached statements
   * 
   * This should be called when the database is closed or reconnected
   * to prevent using stale statement objects.
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      created: 0
    };
    log.info('cache_cleared', { statements_cleared: size });
  }

  /**
   * Get cache statistics
   * 
   * @returns {Object} Cache statistics including size, hit rate, and keys
   */
  getStats() {
    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      created: this.stats.created,
      hit_rate: this.getHitRate(),
      keys: Array.from(this.cache.keys()).sort()
    };
  }

  /**
   * Calculate cache hit rate as a percentage
   * 
   * @returns {number} Hit rate percentage (0-100)
   */
  getHitRate() {
    const total = this.stats.hits + this.stats.misses;
    if (total === 0) return 0;
    return ((this.stats.hits / total) * 100).toFixed(2);
  }

  /**
   * Check if a statement is cached
   * 
   * @param {string} key - Cache key to check
   * @returns {boolean} True if statement is cached
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Remove a specific statement from cache
   * 
   * @param {string} key - Cache key to remove
   * @returns {boolean} True if statement was removed
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Log cache statistics (for monitoring and debugging)
   */
  logStats() {
    const stats = this.getStats();
    log.info('cache_stats', stats);
  }
}

// Export singleton instance
const instance = new PreparedStatementCache();

// Log statistics periodically (every 10 minutes in production)
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    instance.logStats();
  }, 10 * 60 * 1000);
}

module.exports = instance;
