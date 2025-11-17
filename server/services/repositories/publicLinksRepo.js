const { getDb } = require('../db');
const stmtCache = require('./preparedStatements');
const crypto = require('crypto');

function nowISO() { return new Date().toISOString(); }

/**
 * Generate a secure random hashed key for public links
 * @returns {string} URL-safe base64 string (32 chars)
 */
function generateHashedKey() {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Create a new public link
 * @param {Object} params
 * @param {string} params.title - Display title for the link
 * @param {string} [params.description] - Optional description
 * @returns {Object} Created public link record
 */
function create({ title, description = null }) {
  const db = getDb();
  const ts = nowISO();
  const id = crypto.randomUUID();
  const hashedKey = generateHashedKey();

  const insert = stmtCache.get(db, 'publicLinks:create', `
    INSERT INTO public_links (id, title, description, hashed_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  insert.run(id, title, description, hashedKey, ts, ts);
  return getById(id);
}

/**
 * Get public link by ID
 * @param {string} id
 * @returns {Object|undefined}
 */
function getById(id) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'publicLinks:getById', 'SELECT * FROM public_links WHERE id = ?');
  return stmt.get(id);
}

/**
 * Get public link by hashed key
 * @param {string} hashedKey
 * @returns {Object|undefined}
 */
function getByHashedKey(hashedKey) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'publicLinks:getByHashedKey', 'SELECT * FROM public_links WHERE hashed_key = ?');
  return stmt.get(hashedKey);
}

/**
 * List all public links
 * @returns {Array<Object>}
 */
function list() {
  const db = getDb();
  const stmt = stmtCache.get(db, 'publicLinks:list', `
    SELECT * FROM public_links 
    ORDER BY created_at DESC
  `);
  return stmt.all();
}

/**
 * Update public link title and/or description
 * @param {string} id
 * @param {Object} updates
 * @param {string} [updates.title]
 * @param {string} [updates.description]
 * @returns {Object} Updated record
 */
function update(id, { title, description }) {
  const db = getDb();
  const ts = nowISO();
  
  const updates = [];
  const values = [];
  
  if (title !== undefined) {
    updates.push('title = ?');
    values.push(title);
  }
  if (description !== undefined) {
    updates.push('description = ?');
    values.push(description);
  }
  
  if (updates.length === 0) {
    return getById(id);
  }
  
  updates.push('updated_at = ?');
  values.push(ts, id);
  
  const cacheKey = `publicLinks:update:${updates.join(':')}`;
  const sql = `
    UPDATE public_links 
    SET ${updates.join(', ')}
    WHERE id = ?
  `;
  const stmt = stmtCache.get(db, cacheKey, sql);
  stmt.run(...values);
  
  return getById(id);
}

/**
 * Regenerate hashed key for a public link
 * @param {string} id
 * @returns {Object} Updated record with new hashed_key
 */
function regenerateKey(id) {
  const db = getDb();
  const ts = nowISO();
  const newHashedKey = generateHashedKey();
  
  const stmt = stmtCache.get(db, 'publicLinks:regenerateKey', `
    UPDATE public_links 
    SET hashed_key = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(newHashedKey, ts, id);
  
  return getById(id);
}

/**
 * Delete a public link (cascade deletes photo associations)
 * @param {string} id
 */
function remove(id) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'publicLinks:remove', 'DELETE FROM public_links WHERE id = ?');
  stmt.run(id);
}

/**
 * Associate photos with a public link
 * @param {string} publicLinkId
 * @param {Array<number>} photoIds - Array of photo IDs
 */
function associatePhotos(publicLinkId, photoIds) {
  if (!photoIds || photoIds.length === 0) return;
  
  const db = getDb();
  const ts = nowISO();
  
  const trx = db.transaction(() => {
    const insert = stmtCache.get(db, 'publicLinks:associatePhoto', `
      INSERT OR IGNORE INTO photo_public_links (photo_id, public_link_id, created_at)
      VALUES (?, ?, ?)
    `);
    
    for (const photoId of photoIds) {
      insert.run(photoId, publicLinkId, ts);
    }
  });
  
  trx();
}

/**
 * Remove a photo from a public link
 * @param {string} publicLinkId
 * @param {number} photoId
 */
function removePhoto(publicLinkId, photoId) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'publicLinks:removePhoto', `
    DELETE FROM photo_public_links 
    WHERE public_link_id = ? AND photo_id = ?
  `);
  stmt.run(publicLinkId, photoId);
}

/**
 * Remove multiple photos from a public link
 * @param {string} publicLinkId
 * @param {Array<number>} photoIds
 */
function removePhotos(publicLinkId, photoIds) {
  if (!photoIds || photoIds.length === 0) return;
  
  const db = getDb();
  const placeholders = photoIds.map(() => '?').join(',');
  
  const cacheKey = `publicLinks:removePhotos:${photoIds.length}`;
  const sql = `
    DELETE FROM photo_public_links 
    WHERE public_link_id = ? AND photo_id IN (${placeholders})
  `;
  const stmt = stmtCache.get(db, cacheKey, sql);
  stmt.run(publicLinkId, ...photoIds);
}

/**
 * Get all public links for a specific photo
 * @param {number} photoId
 * @returns {Array<Object>} Array of public link records
 */
function getLinksForPhoto(photoId) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'publicLinks:getLinksForPhoto', `
    SELECT pl.* 
    FROM public_links pl
    INNER JOIN photo_public_links ppl ON ppl.public_link_id = pl.id
    WHERE ppl.photo_id = ?
    ORDER BY pl.title ASC
  `);
  return stmt.all(photoId);
}

/**
 * Get all photo IDs associated with a public link
 * @param {string} publicLinkId
 * @returns {Array<number>} Array of photo IDs
 */
function getPhotoIdsForLink(publicLinkId) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'publicLinks:getPhotoIdsForLink', `
    SELECT photo_id 
    FROM photo_public_links 
    WHERE public_link_id = ?
  `);
  return stmt.all(publicLinkId).map(row => row.photo_id);
}

/**
 * Get count of photos in a public link
 * @param {string} publicLinkId
 * @returns {number}
 */
function getPhotoCount(publicLinkId) {
  const db = getDb();
  const stmt = stmtCache.get(db, 'publicLinks:getPhotoCount', `
    SELECT COUNT(*) as count 
    FROM photo_public_links 
    WHERE public_link_id = ?
  `);
  const result = stmt.get(publicLinkId);
  return result.count;
}

module.exports = {
  create,
  getById,
  getByHashedKey,
  list,
  update,
  regenerateKey,
  remove,
  associatePhotos,
  removePhoto,
  removePhotos,
  getLinksForPhoto,
  getPhotoIdsForLink,
  getPhotoCount,
  generateHashedKey, // Export for testing
};
