/**
 * API client for shared links management (admin endpoints)
 * Requires authentication
 */

const API_BASE = '/api/public-links';

/**
 * List all shared links
 * @returns {Promise<Array>} Array of shared links with photo counts
 */
export async function listSharedLinks() {
  const res = await fetch(API_BASE, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`Failed to list shared links: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Get a specific shared link by ID
 * @param {string} id - Link ID
 * @returns {Promise<Object>} Shared link details
 */
export async function getSharedLink(id) {
  const res = await fetch(`${API_BASE}/${id}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`Failed to get shared link: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Create a new shared link
 * @param {Object} data
 * @param {string} data.title - Link title (required)
 * @param {string} [data.description] - Link description (optional)
 * @returns {Promise<Object>} Created shared link
 */
export async function createSharedLink({ title, description }) {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ title, description }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Failed to create shared link');
  }
  return res.json();
}

/**
 * Update a shared link
 * @param {string} id - Link ID
 * @param {Object} data
 * @param {string} [data.title] - New title
 * @param {string} [data.description] - New description
 * @returns {Promise<Object>} Updated shared link
 */
export async function updateSharedLink(id, { title, description }) {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ title, description }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Failed to update shared link');
  }
  return res.json();
}

/**
 * Delete a shared link
 * @param {string} id - Link ID
 * @returns {Promise<void>}
 */
export async function deleteSharedLink(id) {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Failed to delete shared link');
  }
}

/**
 * Regenerate the hashed key for a shared link
 * @param {string} id - Link ID
 * @returns {Promise<Object>} Updated shared link with new hashed_key
 */
export async function regenerateKey(id) {
  const res = await fetch(`${API_BASE}/${id}/regenerate`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Failed to regenerate key');
  }
  return res.json();
}

/**
 * Add photos to a shared link
 * @param {string} id - Link ID
 * @param {Array<number>} photoIds - Array of photo IDs to add
 * @returns {Promise<Object>} Result with added count
 */
export async function addPhotosToLink(id, photoIds) {
  const res = await fetch(`${API_BASE}/${id}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ photo_ids: photoIds }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Failed to add photos');
  }
  return res.json();
}

/**
 * Remove a photo from a shared link
 * @param {string} id - Link ID
 * @param {number} photoId - Photo ID to remove
 * @returns {Promise<void>}
 */
export async function removePhotoFromLink(id, photoId) {
  const res = await fetch(`${API_BASE}/${id}/photos/${photoId}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Failed to remove photo');
  }
}

/**
 * Get all shared links that contain a specific photo
 * @param {number} photoId - Photo ID
 * @returns {Promise<Array>} Array of shared links
 */
export async function getLinksForPhoto(photoId) {
  const res = await fetch(`/api/public-links/photos/${photoId}/links`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Failed to get links for photo');
  }
  return res.json();
}

/**
 * Batch add photos to multiple links
 * Handles partial failures gracefully
 * @param {Array<string>} linkIds - Array of link IDs
 * @param {Array<number>} photoIds - Array of photo IDs
 * @returns {Promise<Object>} Result with success/failure counts
 */
export async function batchAddPhotosToLinks(linkIds, photoIds) {
  const results = {
    successful: [],
    failed: [],
    totalLinks: linkIds.length,
    totalPhotos: photoIds.length,
  };

  for (const linkId of linkIds) {
    try {
      const result = await addPhotosToLink(linkId, photoIds);
      results.successful.push({ linkId, result });
    } catch (error) {
      results.failed.push({ linkId, error: error.message });
    }
  }

  return results;
}

/**
 * Batch remove photos from multiple links
 * Handles partial failures gracefully
 * @param {Array<string>} linkIds - Array of link IDs
 * @param {Array<number>} photoIds - Array of photo IDs
 * @returns {Promise<Object>} Result with success/failure counts
 */
export async function batchRemovePhotosFromLinks(linkIds, photoIds) {
  const results = {
    successful: [],
    failed: [],
    totalLinks: linkIds.length,
    totalPhotos: photoIds.length,
  };

  for (const linkId of linkIds) {
    for (const photoId of photoIds) {
      try {
        await removePhotoFromLink(linkId, photoId);
        results.successful.push({ linkId, photoId });
      } catch (error) {
        results.failed.push({ linkId, photoId, error: error.message });
      }
    }
  }

  return results;
}

/**
 * Sync photos to links - add to new links, remove from old links
 * Handles partial failures gracefully
 * @param {Array<number>} photoIds - Array of photo IDs
 * @param {Array<string>} currentLinkIds - Current link IDs photo is in
 * @param {Array<string>} newLinkIds - New link IDs photo should be in
 * @returns {Promise<Object>} Result with success/failure details
 */
export async function syncPhotosToLinks(photoIds, currentLinkIds, newLinkIds) {
  const currentSet = new Set(currentLinkIds);
  const newSet = new Set(newLinkIds);
  
  const linksToAdd = Array.from(newSet).filter(id => !currentSet.has(id));
  const linksToRemove = Array.from(currentSet).filter(id => !newSet.has(id));
  
  const results = {
    added: { successful: [], failed: [] },
    removed: { successful: [], failed: [] },
    totalAdded: 0,
    totalRemoved: 0,
    totalFailed: 0,
  };

  // Add to new links
  for (const linkId of linksToAdd) {
    try {
      await addPhotosToLink(linkId, photoIds);
      results.added.successful.push(linkId);
      results.totalAdded++;
    } catch (error) {
      results.added.failed.push({ linkId, error: error.message });
      results.totalFailed++;
    }
  }

  // Remove from old links
  for (const linkId of linksToRemove) {
    for (const photoId of photoIds) {
      try {
        await removePhotoFromLink(linkId, photoId);
        if (!results.removed.successful.includes(linkId)) {
          results.removed.successful.push(linkId);
          results.totalRemoved++;
        }
      } catch (error) {
        results.removed.failed.push({ linkId, photoId, error: error.message });
        results.totalFailed++;
      }
    }
  }

  return results;
}
