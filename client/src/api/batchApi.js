import { authFetch } from './httpClient';

/**
 * Batch API client for photo operations
 * Wraps the existing /api/photos/* batch endpoints
 */

/**
 * Batch add tags to multiple photos
 * @param {number[]} photoIds - Array of photo IDs
 * @param {string[]} tags - Array of tag names to add
 * @param {boolean} dryRun - If true, preview changes without applying
 * @returns {Promise<{updated: number, errors?: Array, dry_run?: Object}>}
 */
export async function batchAddTags(photoIds, tags, dryRun = false) {
  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    throw new Error('photoIds must be a non-empty array');
  }
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new Error('tags must be a non-empty array');
  }

  const items = photoIds.map(photo_id => ({ photo_id, tags }));
  
  const res = await authFetch('/api/photos/tags/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, dry_run: dryRun })
  });

  if (!res.ok) {
    let msg = 'Failed to add tags';
    try {
      const json = await res.json();
      msg = json.error || msg;
    } catch {}
    throw new Error(msg);
  }

  return res.json();
}

/**
 * Batch remove tags from multiple photos
 * @param {number[]} photoIds - Array of photo IDs
 * @param {string[]} tags - Array of tag names to remove
 * @param {boolean} dryRun - If true, preview changes without applying
 * @returns {Promise<{updated: number, errors?: Array, dry_run?: Object}>}
 */
export async function batchRemoveTags(photoIds, tags, dryRun = false) {
  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    throw new Error('photoIds must be a non-empty array');
  }
  if (!Array.isArray(tags) || tags.length === 0) {
    throw new Error('tags must be a non-empty array');
  }

  const items = photoIds.map(photo_id => ({ photo_id, tags }));
  
  const res = await authFetch('/api/photos/tags/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, dry_run: dryRun })
  });

  if (!res.ok) {
    let msg = 'Failed to remove tags';
    try {
      const json = await res.json();
      msg = json.error || msg;
    } catch {}
    throw new Error(msg);
  }

  return res.json();
}

/**
 * Batch update keep flags for multiple photos
 * @param {number[]} photoIds - Array of photo IDs
 * @param {Object} keepFlags - Keep flags to apply { keep_jpg?: boolean, keep_raw?: boolean }
 * @param {boolean} dryRun - If true, preview changes without applying
 * @returns {Promise<{updated: number, errors?: Array, dry_run?: Object}>}
 */
export async function batchUpdateKeep(photoIds, keepFlags, dryRun = false) {
  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    throw new Error('photoIds must be a non-empty array');
  }
  if (!keepFlags || typeof keepFlags !== 'object') {
    throw new Error('keepFlags must be an object with keep_jpg and/or keep_raw');
  }

  const items = photoIds.map(photo_id => ({ photo_id, ...keepFlags }));
  
  const res = await authFetch('/api/photos/keep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, dry_run: dryRun })
  });

  if (!res.ok) {
    let msg = 'Failed to update keep flags';
    try {
      const json = await res.json();
      msg = json.error || msg;
    } catch {}
    throw new Error(msg);
  }

  return res.json();
}

/**
 * Batch update visibility for multiple photos
 * @param {number[]} photoIds - Array of photo IDs
 * @param {string} visibility - Visibility setting ('public' or 'private')
 * @returns {Promise<{updated: number, errors?: Array}>}
 */
export async function batchUpdateVisibility(photoIds, visibility) {
  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    throw new Error('photoIds must be a non-empty array');
  }
  if (!visibility || !['public', 'private'].includes(visibility)) {
    throw new Error('visibility must be "public" or "private"');
  }

  const items = photoIds.map(photo_id => ({ photo_id, visibility }));
  
  const res = await authFetch('/api/photos/visibility', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items })
  });

  if (!res.ok) {
    let msg = 'Failed to update visibility';
    try {
      const json = await res.json();
      msg = json.error || msg;
    } catch {}
    throw new Error(msg);
  }

  return res.json();
}

/**
 * Batch process derivatives for multiple photos
 * @param {number[]} photoIds - Array of photo IDs
 * @param {boolean} force - Force regeneration even if derivatives exist
 * @param {boolean} dryRun - If true, preview what would be processed
 * @returns {Promise<{message: string, task_id: string, job_count: number, job_ids: Array}>}
 */
export async function batchProcessPhotos(photoIds, force = false, dryRun = false) {
  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    throw new Error('photoIds must be a non-empty array');
  }

  const items = photoIds.map(photo_id => ({ photo_id }));
  
  const res = await authFetch('/api/photos/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, force, dry_run: dryRun })
  });

  if (!res.ok) {
    let msg = 'Failed to process photos';
    try {
      const json = await res.json();
      msg = json.error || msg;
    } catch {}
    throw new Error(msg);
  }

  return res.json();
}

/**
 * Batch move photos to a different project
 * @param {number[]} photoIds - Array of photo IDs
 * @param {string} destFolder - Destination project folder
 * @param {boolean} dryRun - If true, preview what would be moved
 * @returns {Promise<{message: string, job_count: number, job_ids: Array, destination_project: Object}>}
 */
export async function batchMovePhotos(photoIds, destFolder, dryRun = false) {
  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    throw new Error('photoIds must be a non-empty array');
  }
  if (!destFolder || typeof destFolder !== 'string') {
    throw new Error('destFolder must be a non-empty string');
  }

  const items = photoIds.map(photo_id => ({ photo_id }));
  
  const res = await authFetch('/api/photos/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, dest_folder: destFolder, dry_run: dryRun })
  });

  if (!res.ok) {
    let msg = 'Failed to move photos';
    try {
      const json = await res.json();
      msg = json.error || msg;
    } catch {}
    throw new Error(msg);
  }

  return res.json();
}
