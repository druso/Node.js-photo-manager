const { getDb } = require('./db');
const crypto = require('crypto');
const fs = require('fs');
const makeLogger = require('../utils/logger2');
const log = makeLogger('deriv-cache');

/**
 * DerivativeCache manages a cache of derivative metadata keyed by source file hash.
 * This prevents regenerating derivatives when the source file hasn't changed.
 */
class DerivativeCache {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize the cache table if it doesn't exist.
   * Called lazily on first use.
   */
  initTable() {
    if (this.initialized) return;
    
    const db = getDb();
    
    // Create cache table
    db.exec(`
      CREATE TABLE IF NOT EXISTS derivative_cache (
        photo_id INTEGER PRIMARY KEY,
        source_hash TEXT NOT NULL,
        source_size INTEGER,
        thumbnail_meta TEXT,
        preview_meta TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    
    // Create index on source_hash for lookups
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_derivative_cache_hash 
      ON derivative_cache(source_hash)
    `);
    
    this.initialized = true;
    log.info('cache_table_initialized');
  }

  /**
   * Calculate MD5 hash of a file.
   * @param {string} filePath - Absolute path to file
   * @returns {Promise<string>} MD5 hash as hex string
   */
  async calculateHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', (err) => reject(err));
    });
  }

  /**
   * Calculate hash synchronously (blocking).
   * Use for small files or when async is not needed.
   * @param {string} filePath - Absolute path to file
   * @returns {string} MD5 hash as hex string
   */
  calculateHashSync(filePath) {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  /**
   * Check if derivatives need regeneration for a photo.
   * @param {number} photoId - Photo ID
   * @param {string} sourceHash - Current source file hash
   * @param {number} sourceSize - Current source file size (optional, for logging)
   * @returns {boolean} True if regeneration needed, false if cached
   */
  needsRegeneration(photoId, sourceHash, sourceSize = null) {
    this.initTable();
    
    const db = getDb();
    const cached = db.prepare(
      'SELECT source_hash, source_size, thumbnail_meta, preview_meta, updated_at FROM derivative_cache WHERE photo_id = ?'
    ).get(photoId);
    
    if (!cached) {
      log.debug('cache_miss_new', { photoId });
      return true;
    }
    
    if (cached.source_hash !== sourceHash) {
      log.info('cache_miss_changed', { 
        photoId, 
        oldHash: cached.source_hash.substring(0, 8),
        newHash: sourceHash.substring(0, 8),
        oldSize: cached.source_size,
        newSize: sourceSize
      });
      return true;
    }
    
    log.debug('cache_hit', { 
      photoId, 
      hash: sourceHash.substring(0, 8),
      age: Date.now() - cached.updated_at
    });
    return false;
  }

  /**
   * Update cache with new derivative metadata.
   * @param {number} photoId - Photo ID
   * @param {string} sourceHash - Source file hash
   * @param {number} sourceSize - Source file size
   * @param {Object} metadata - Derivative metadata
   * @param {Object} metadata.thumbnail - Thumbnail metadata (width, height, size, etc.)
   * @param {Object} metadata.preview - Preview metadata (width, height, size, etc.)
   */
  updateCache(photoId, sourceHash, sourceSize, metadata) {
    this.initTable();
    
    const db = getDb();
    const now = Date.now();
    
    db.prepare(`
      INSERT OR REPLACE INTO derivative_cache 
      (photo_id, source_hash, source_size, thumbnail_meta, preview_meta, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 
        COALESCE((SELECT created_at FROM derivative_cache WHERE photo_id = ?), ?),
        ?)
    `).run(
      photoId,
      sourceHash,
      sourceSize,
      metadata.thumbnail ? JSON.stringify(metadata.thumbnail) : null,
      metadata.preview ? JSON.stringify(metadata.preview) : null,
      photoId, // for COALESCE subquery
      now, // created_at if new
      now  // updated_at always updated
    );
    
    log.debug('cache_updated', { 
      photoId, 
      hash: sourceHash.substring(0, 8),
      size: sourceSize,
      hasThumbnail: !!metadata.thumbnail,
      hasPreview: !!metadata.preview
    });
  }

  /**
   * Get cached metadata for a photo.
   * @param {number} photoId - Photo ID
   * @returns {Object|null} Cached metadata or null if not found
   */
  getCached(photoId) {
    this.initTable();
    
    const db = getDb();
    const cached = db.prepare(
      'SELECT * FROM derivative_cache WHERE photo_id = ?'
    ).get(photoId);
    
    if (!cached) return null;
    
    return {
      photoId: cached.photo_id,
      sourceHash: cached.source_hash,
      sourceSize: cached.source_size,
      thumbnail: cached.thumbnail_meta ? JSON.parse(cached.thumbnail_meta) : null,
      preview: cached.preview_meta ? JSON.parse(cached.preview_meta) : null,
      createdAt: cached.created_at,
      updatedAt: cached.updated_at
    };
  }

  /**
   * Invalidate cache for a photo (force regeneration on next request).
   * @param {number} photoId - Photo ID
   */
  invalidate(photoId) {
    this.initTable();
    
    const db = getDb();
    db.prepare('DELETE FROM derivative_cache WHERE photo_id = ?').run(photoId);
    
    log.info('cache_invalidated', { photoId });
  }

  /**
   * Clear all cache entries (useful for maintenance).
   * @returns {number} Number of entries deleted
   */
  clearAll() {
    this.initTable();
    
    const db = getDb();
    const result = db.prepare('DELETE FROM derivative_cache').run();
    
    log.info('cache_cleared', { count: result.changes });
    return result.changes;
  }

  /**
   * Get cache statistics.
   * @returns {Object} Statistics about cache usage
   */
  getStats() {
    this.initTable();
    
    const db = getDb();
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(thumbnail_meta) as with_thumbnail,
        COUNT(preview_meta) as with_preview,
        AVG(source_size) as avg_source_size,
        MIN(updated_at) as oldest_entry,
        MAX(updated_at) as newest_entry
      FROM derivative_cache
    `).get();
    
    return {
      totalEntries: stats.total,
      withThumbnail: stats.with_thumbnail,
      withPreview: stats.with_preview,
      avgSourceSize: Math.round(stats.avg_source_size || 0),
      oldestEntry: stats.oldest_entry,
      newestEntry: stats.newest_entry
    };
  }
}

// Export singleton instance
module.exports = new DerivativeCache();
