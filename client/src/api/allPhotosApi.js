// API client for All Photos (cross-project) keyset pagination

/**
 * Locate a specific photo in All Photos and return its page with surrounding items.
 * @param {Object} opts
 * @param {string} opts.project_folder - Required. The project folder name.
 * @param {string} [opts.filename] - Full filename with extension (preferred over name).
 * @param {string} [opts.name] - Basename without extension (if filename not provided).
 * @param {number} [opts.limit=100] - Number of items per page (1-300).
 * @param {string} [opts.date_from] - YYYY-MM-DD
 * @param {string} [opts.date_to] - YYYY-MM-DD
 * @param {('any'|'jpg_only'|'raw_only'|'both')} [opts.file_type]
 * @param {('any'|'any_kept'|'jpg_only'|'raw_jpg'|'none')} [opts.keep_type]
 * @param {('any'|'vertical'|'horizontal')} [opts.orientation]
 * @returns {Promise<{
 *   items: Array<Photo>,
 *   position: number,
 *   page_index: number,
 *   limit: number,
 *   next_cursor: string|null,
 *   prev_cursor: string|null,
 *   idx_in_items: number,
 *   target: { id: string, project_id: string, project_folder: string, filename: string, taken_at: string },
 *   date_from: string|null,
 *   date_to: string|null
 * }>}
 * @throws {Error} If the request fails or the photo is not found.
 */
export async function locateAllPhotosPage(opts = {}) {
  const params = new URLSearchParams();
  
  // Required parameters
  if (!opts.project_folder) throw new Error('project_folder is required');
  if (!opts.filename && !opts.name) throw new Error('Either filename or name is required');
  
  // Add parameters
  params.set('project_folder', opts.project_folder);
  if (opts.filename) params.set('filename', opts.filename);
  if (opts.name) params.set('name', opts.name);
  if (opts.limit != null) params.set('limit', String(Math.min(300, Math.max(1, Number(opts.limit) || 100))));
  if (opts.date_from) params.set('date_from', String(opts.date_from));
  if (opts.date_to) params.set('date_to', String(opts.date_to));
  if (opts.file_type && opts.file_type !== 'any') params.set('file_type', String(opts.file_type));
  if (opts.keep_type && opts.keep_type !== 'any') params.set('keep_type', String(opts.keep_type));
  if (opts.orientation && opts.orientation !== 'any') params.set('orientation', String(opts.orientation));
  
  const url = `/api/photos/locate-page?${params.toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const errorMessage = errorData.error || `Failed to locate photo: ${res.status} ${res.statusText}`;
    const error = new Error(errorMessage);
    error.status = res.status;
    error.code = errorData.code || 'LOCATE_PHOTO_FAILED';
    throw error;
  }
  
  return res.json();
}

/**
 * Fetch a page of photos across all non-archived projects.
 * @param {Object} opts
 * @param {number} [opts.limit]
 * @param {string|null} [opts.cursor]
 * @param {string} [opts.date_from] - YYYY-MM-DD
 * @param {string} [opts.date_to] - YYYY-MM-DD
 * @param {('any'|'jpg_only'|'raw_only'|'both')} [opts.file_type]
 * @param {('any'|'any_kept'|'jpg_only'|'raw_jpg'|'none')} [opts.keep_type]
 * @param {('any'|'vertical'|'horizontal')} [opts.orientation]
 * @param {string|null} [opts.before_cursor]
 * @returns {Promise<{ items: any[], next_cursor: string|null, prev_cursor: string|null, limit: number }>}
 */
export async function listAllPhotos(opts = {}) {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set('limit', String(opts.limit));
  if (opts.cursor != null) params.set('cursor', String(opts.cursor));
  if (opts.before_cursor != null) params.set('before_cursor', String(opts.before_cursor));
  if (opts.date_from) params.set('date_from', String(opts.date_from));
  if (opts.date_to) params.set('date_to', String(opts.date_to));
  if (opts.file_type && opts.file_type !== 'any') params.set('file_type', String(opts.file_type));
  if (opts.keep_type && opts.keep_type !== 'any') params.set('keep_type', String(opts.keep_type));
  if (opts.orientation && opts.orientation !== 'any') params.set('orientation', String(opts.orientation));
  const url = `/api/photos${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`listAllPhotos failed: ${res.status}`);
  return res.json();
}
