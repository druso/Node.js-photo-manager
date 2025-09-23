// API client for paginated photo fetching per project

/**
 * Fetch a page of photos for a project.
 *
 * @param {string} folder - Canonical project folder (e.g., "p1").
 * @param {Object} opts
 * @param {number} [opts.limit] - Page size. If omitted, server uses config photo_grid.page_size.
 * @param {string|null} [opts.cursor] - Forward cursor (next page). For DESC date sorts, this is a base64 keyset cursor; for others, it's an offset.
 * @param {string|null} [opts.before_cursor] - Backward cursor (previous page). Only used for DESC date sorts.
 * @param {('filename'|'date_time_original'|'created_at'|'updated_at')} [opts.sort]
 * @param {('ASC'|'DESC')} [opts.dir]
 * @returns {Promise<{ items: any[], total: number, nextCursor: string|null, prevCursor: string|null, limit: number, sort: string, dir: string }>}
 */
export async function listProjectPhotos(folder, opts = {}) {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set('limit', String(opts.limit));
  if (opts.cursor != null) params.set('cursor', String(opts.cursor));
  if (opts.before_cursor != null) params.set('before_cursor', String(opts.before_cursor));
  if (opts.sort) params.set('sort', String(opts.sort));
  if (opts.dir) params.set('dir', String(opts.dir));
  // Add filter parameters (same as All Photos)
  if (opts.date_from) params.set('date_from', String(opts.date_from));
  if (opts.date_to) params.set('date_to', String(opts.date_to));
  if (opts.file_type) params.set('file_type', String(opts.file_type));
  if (opts.keep_type) params.set('keep_type', String(opts.keep_type));
  if (opts.orientation) params.set('orientation', String(opts.orientation));

  const url = `/api/projects/${encodeURIComponent(folder)}/photos${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`listProjectPhotos failed: ${res.status}`);
  return res.json();
}

/**
 * Locate a specific photo within a project and return its page with surrounding items.
 * Mirrors the All Photos locate endpoint shape.
 * @param {string} folder - Canonical project folder (e.g., "p1").
 * @param {Object} opts
 * @param {string} [opts.filename] - Full filename with extension (preferred over name).
 * @param {string} [opts.name] - Basename without extension (if filename not provided).
 * @param {number} [opts.limit=100]
 * @param {string} [opts.date_from]
 * @param {string} [opts.date_to]
 * @param {('any'|'jpg_only'|'raw_only'|'both')} [opts.file_type]
 * @param {('any'|'any_kept'|'jpg_only'|'raw_jpg'|'none')} [opts.keep_type]
 * @param {('any'|'vertical'|'horizontal')} [opts.orientation]
 * @returns {Promise<{
 *   items: any[], position: number, page_index: number, limit: number,
 *   next_cursor: string|null, prev_cursor: string|null, idx_in_items: number,
 *   target: any, date_from: string|null, date_to: string|null
 * }>}
 */
export async function locateProjectPhotosPage(folder, opts = {}) {
  if (!folder) throw new Error('project folder is required');
  const params = new URLSearchParams();
  if (!opts.filename && !opts.name) throw new Error('Either filename or name is required');
  if (opts.filename) params.set('filename', String(opts.filename));
  if (opts.name) params.set('name', String(opts.name));
  if (opts.limit != null) params.set('limit', String(Math.min(300, Math.max(1, Number(opts.limit) || 100))));
  if (opts.date_from) params.set('date_from', String(opts.date_from));
  if (opts.date_to) params.set('date_to', String(opts.date_to));
  if (opts.file_type && opts.file_type !== 'any') params.set('file_type', String(opts.file_type));
  if (opts.keep_type && opts.keep_type !== 'any') params.set('keep_type', String(opts.keep_type));
  if (opts.orientation && opts.orientation !== 'any') params.set('orientation', String(opts.orientation));
  const url = `/api/projects/${encodeURIComponent(folder)}/photos/locate-page${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `locateProjectPhotosPage failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
