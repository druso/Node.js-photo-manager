/**
 * API client for public shared links (no authentication required)
 */

const API_BASE = '/shared/api';

/**
 * Get shared link by hashed key
 * @param {string} hashedKey - The hashed key from the URL
 * @param {Object} options - Pagination options
 * @param {number} [options.limit] - Page size
 * @param {string} [options.cursor] - Forward pagination cursor
 * @param {string} [options.before_cursor] - Backward pagination cursor
 * @returns {Promise<Object>} Shared link data with photos
 */
export async function getSharedLink(hashedKey, { limit, cursor, before_cursor } = {}) {
  const params = new URLSearchParams();
  if (limit) params.append('limit', limit);
  if (cursor) params.append('cursor', cursor);
  if (before_cursor) params.append('before_cursor', before_cursor);
  
  const queryString = params.toString();
  const url = `${API_BASE}/${hashedKey}${queryString ? `?${queryString}` : ''}`;
  
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('Shared link not found');
    }
    throw new Error(`Failed to load shared link: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Get a specific photo in shared link context
 * @param {string} hashedKey - The hashed key from the URL
 * @param {number} photoId - Photo ID
 * @returns {Promise<Object>} Photo data
 */
export async function getSharedPhoto(hashedKey, photoId) {
  const res = await fetch(`${API_BASE}/${hashedKey}/photo/${photoId}`);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('Photo not found');
    }
    throw new Error(`Failed to load photo: ${res.statusText}`);
  }
  return res.json();
}
