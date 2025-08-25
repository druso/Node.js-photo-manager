// API client for paginated photo fetching per project

/**
 * Fetch a page of photos for a project.
 *
 * @param {string} folder - Canonical project folder (e.g., "p1").
 * @param {Object} opts
 * @param {number} [opts.limit] - Page size. If omitted, server uses config photo_grid.page_size.
 * @param {string|null} [opts.cursor] - Cursor/offset string returned by previous call.
 * @param {('filename'|'date_time_original'|'created_at'|'updated_at')} [opts.sort]
 * @param {('ASC'|'DESC')} [opts.dir]
 * @returns {Promise<{ items: any[], total: number, nextCursor: string|null, limit: number, sort: string, dir: string }>}
 */
export async function listProjectPhotos(folder, opts = {}) {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set('limit', String(opts.limit));
  if (opts.cursor != null) params.set('cursor', String(opts.cursor));
  if (opts.sort) params.set('sort', String(opts.sort));
  if (opts.dir) params.set('dir', String(opts.dir));

  const url = `/api/projects/${encodeURIComponent(folder)}/photos${params.toString() ? `?${params.toString()}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`listProjectPhotos failed: ${res.status}`);
  return res.json();
}
