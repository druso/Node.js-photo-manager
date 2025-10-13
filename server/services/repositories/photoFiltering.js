const { getDb } = require('../db');
const makeLogger = require('../../utils/logger2');
const { buildProjectPhotosWhere, buildAllPhotosWhere, parseCursor, createCursor } = require('./photoQueryBuilders');
const log = makeLogger('photoFiltering');

/**
 * List filtered photos for a specific project with pagination
 * @param {Object} options - Filter and pagination options
 * @param {number} options.project_id - Project ID
 * @param {number} [options.limit=100] - Page size limit
 * @param {string} [options.cursor] - Forward pagination cursor
 * @param {string} [options.before_cursor] - Backward pagination cursor
 * @param {string} [options.date_from] - Start date filter
 * @param {string} [options.date_to] - End date filter
 * @param {string} [options.file_type] - File type filter
 * @param {string} [options.keep_type] - Keep type filter
 * @param {string} [options.orientation] - Orientation filter
 * @param {string} [options.tags] - Tags filter
 * @returns {Object} Filtered result with items, cursors, and totals
 */
function listProjectFiltered({
  project_id,
  limit = 100,
  cursor = null,
  before_cursor = null,
  date_from = null,
  date_to = null,
  file_type = null,
  keep_type = null,
  orientation = null,
  tags = null,
  visibility = null,
}) {
  const db = getDb();

  const { whereSql, params } = buildProjectPhotosWhere({
    project_id,
    date_from,
    date_to,
    file_type,
    keep_type,
    orientation,
    tags,
    visibility,
  });

  const rows = db
    .prepare(`
      SELECT ph.*, pph.hash AS public_hash, pph.expires_at AS public_hash_expires_at
      FROM photos ph
      LEFT JOIN photo_public_hashes pph ON pph.photo_id = ph.id
      ${whereSql}
      ORDER BY COALESCE(ph.date_time_original, ph.created_at) DESC, ph.id DESC
      LIMIT ?
    `)
    .all(...params, limit);

  const items = rows || [];
  let nextCursor = null;
  let prevCursor = null;

  if (items.length) {
    const last = items[items.length - 1];
    const first = items[0];

    const hasMore = db
      .prepare(`
        SELECT 1
        FROM photos ph
        ${whereSql ? `${whereSql} AND` : 'WHERE'} (
          (COALESCE(ph.date_time_original, ph.created_at) < ?) OR
          (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id < ?)
        )
        LIMIT 1
      `)
      .get(
        ...params,
        last.date_time_original || last.created_at,
        last.date_time_original || last.created_at,
        last.id,
      );
    if (hasMore) {
      nextCursor = createCursor(last.date_time_original || last.created_at, last.id);
    }

    if (cursor || before_cursor) {
      prevCursor = createCursor(first.date_time_original || first.created_at, first.id);
    }
  }

  let filteredTotal = 0;
  let unfilteredTotal = 0;

  try {
    const filteredResult = db
      .prepare(`
        SELECT COUNT(*) as c
        FROM photos ph
        ${whereSql}
      `)
      .get(...params);
    filteredTotal = filteredResult ? filteredResult.c : 0;

    const unfilteredResult = db
      .prepare(`
        SELECT COUNT(*) as c
        FROM photos ph
        WHERE ph.project_id = ?
      `)
      .get(project_id);
    unfilteredTotal = unfilteredResult ? unfilteredResult.c : 0;
  } catch (e) {
    log.warn('listProjectFiltered_count_failed', { message: e?.message });
  }

  return { items, nextCursor, prevCursor, total: filteredTotal, unfiltered_total: unfilteredTotal };
}

/**
 * List all photos across projects with filtering and pagination
 * @param {Object} options - Filter and pagination options
 * @param {number} [options.limit=200] - Page size limit
 * @param {string} [options.cursor] - Forward pagination cursor
 * @param {string} [options.before_cursor] - Backward pagination cursor
 * @param {string} [options.date_from] - Start date filter
 * @param {string} [options.date_to] - End date filter
 * @param {string} [options.file_type] - File type filter
 * @param {string} [options.keep_type] - Keep type filter
 * @param {string} [options.orientation] - Orientation filter
 * @param {string} [options.tags] - Tags filter
 * @param {number} [options.project_id] - Optional project ID constraint
 * @returns {Object} Filtered result with items, cursors, and totals
 */
function listAll({
  limit = 200,
  cursor = null,
  before_cursor = null,
  date_from = null,
  date_to = null,
  file_type = null,
  keep_type = null,
  orientation = null,
  tags = null,
  project_id = null,
  visibility = null,
  public_link_id = null,
} = {}) {
  const db = getDb();

  log.debug('listAll_called', {
    limit,
    cursor,
    before_cursor,
    date_from,
    date_to,
    file_type,
    keep_type,
    orientation,
    tags_provided: !!tags,
  });

  const baseFilters = { date_from, date_to, file_type, keep_type, orientation, tags, project_id, visibility, public_link_id };

  const computeTotals = (baseWhereSql, baseParams) => {
    let filteredTotal = 0;
    let unfilteredTotal = 0;
    try {
      const filteredCountSql = `
        SELECT COUNT(*) as c
        FROM photos ph
        JOIN projects p ON p.id = ph.project_id
        ${baseWhereSql}
      `;
      const filteredResult = db.prepare(filteredCountSql).get(...baseParams);
      filteredTotal = filteredResult ? filteredResult.c : 0;

      let unfilteredQuery = `
        SELECT COUNT(*) as c
        FROM photos ph
        JOIN projects p ON p.id = ph.project_id
        WHERE (p.status IS NULL OR p.status != 'canceled')
      `;
      const unfilteredParams = [];
      if (project_id != null) {
        unfilteredQuery += ' AND p.id = ?';
        unfilteredParams.push(project_id);
      }
      const unfilteredResult = db.prepare(unfilteredQuery).get(...unfilteredParams);
      unfilteredTotal = unfilteredResult ? unfilteredResult.c : 0;
    } catch (e) {
      log.warn('listAll_count_failed', { message: e?.message });
    }
    return { filteredTotal, unfilteredTotal };
  };

  if (before_cursor) {
    const { taken_at: beforeTaken, id: beforeId } = parseCursor(before_cursor);
    if (beforeTaken && beforeId != null) {
      const { whereSql: baseWhereSql, params: baseParams } = buildAllPhotosWhere(baseFilters);

      const whereConditions = [];
      const whereParams = [...baseParams];
      if (baseWhereSql) {
        whereConditions.push(baseWhereSql.replace('WHERE ', ''));
      }
      whereConditions.push(`(
        COALESCE(ph.date_time_original, ph.created_at) > ? OR
        (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id > ?)
      )`);
      whereParams.push(beforeTaken, beforeTaken, beforeId);

      const whereSql = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';
      const rowsAsc = db
        .prepare(`
          SELECT
            ph.*, ph.id as photo_id, p.project_folder, p.project_name,
            COALESCE(ph.date_time_original, ph.created_at) as taken_at
          FROM photos ph
          JOIN projects p ON p.id = ph.project_id
          ${whereSql}
          ORDER BY taken_at ASC, ph.id ASC
          LIMIT ?
        `)
        .all(...whereParams, limit);

      const items = (rowsAsc || []).reverse();
      let nextCursor = null;
      let prevCursor = null;

      if (items.length) {
        const first = items[0];
        const last = items[items.length - 1];

        const hasOlder = db
          .prepare(`
            SELECT 1
            FROM photos ph
            JOIN projects p ON p.id = ph.project_id
            ${baseWhereSql ? `${baseWhereSql} AND` : 'WHERE'} (
              (COALESCE(ph.date_time_original, ph.created_at) < ?) OR
              (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id < ?)
            )
            LIMIT 1
          `)
          .get(...baseParams, last.taken_at, last.taken_at, last.id);
        if (hasOlder) {
          nextCursor = createCursor(last.taken_at, last.id);
        }

        const hasNewer = db
          .prepare(`
            SELECT 1
            FROM photos ph
            JOIN projects p ON p.id = ph.project_id
            ${baseWhereSql ? `${baseWhereSql} AND` : 'WHERE'} (
              (COALESCE(ph.date_time_original, ph.created_at) > ?) OR
              (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id > ?)
            )
            LIMIT 1
          `)
          .get(...baseParams, first.taken_at, first.taken_at, first.id);
        if (hasNewer) {
          prevCursor = createCursor(first.taken_at, first.id);
        }
      }

      const { filteredTotal, unfilteredTotal } = computeTotals(baseWhereSql, baseParams);
      return { items, nextCursor, prevCursor, total: filteredTotal, unfiltered_total: unfilteredTotal };
    }
  }

  const baseWhere = buildAllPhotosWhere(baseFilters);
  const baseWhereSql = baseWhere.whereSql;
  const baseParams = baseWhere.params;

  const { whereSql, params } = buildAllPhotosWhere({ ...baseFilters, cursor });
  const rows = db
    .prepare(`
      SELECT
        ph.*, p.project_folder, p.project_name,
        COALESCE(ph.date_time_original, ph.created_at) as taken_at,
        pph.hash AS public_hash,
        pph.expires_at AS public_hash_expires_at
      FROM photos ph
      JOIN projects p ON p.id = ph.project_id
      LEFT JOIN photo_public_hashes pph ON pph.photo_id = ph.id
      ${whereSql}
      ORDER BY taken_at DESC, ph.id DESC
      LIMIT ?
    `)
    .all(...params, limit);

  const items = rows || [];
  let nextCursor = null;
  let prevCursor = null;

  if (items.length) {
    const first = items[0];
    const last = items[items.length - 1];

    const hasOlder = db
      .prepare(`
        SELECT 1
        FROM photos ph
        JOIN projects p ON p.id = ph.project_id
        ${whereSql ? `${whereSql} AND` : 'WHERE'} (
          (COALESCE(ph.date_time_original, ph.created_at) < ?) OR
          (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id < ?)
        )
        LIMIT 1
      `)
      .get(...params, last.taken_at, last.taken_at, last.id);
    if (hasOlder) {
      nextCursor = createCursor(last.taken_at, last.id);
    }

    // Always set prevCursor when using forward pagination (cursor)
    // This allows backward navigation after loading subsequent pages
    if (cursor) {
      prevCursor = createCursor(first.taken_at, first.id);
    } else {
      // For initial load (no cursor), check if there are newer items
      const hasNewer = db
        .prepare(`
          SELECT 1
          FROM photos ph
          JOIN projects p ON p.id = ph.project_id
          ${whereSql ? `${whereSql} AND` : 'WHERE'} (
            (COALESCE(ph.date_time_original, ph.created_at) > ?) OR
            (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id > ?)
          )
          LIMIT 1
        `)
        .get(...params, first.taken_at, first.taken_at, first.id);
      if (hasNewer) {
        prevCursor = createCursor(first.taken_at, first.id);
      }
    }

    log.debug('listAll_page', {
      count: items.length,
      first_id: first?.id,
      first_taken_at: first?.taken_at,
      last_id: last.id,
      last_taken_at: last.taken_at,
      next_cursor_len: nextCursor ? String(nextCursor).length : 0,
      prev_cursor_len: prevCursor ? String(prevCursor).length : 0,
      is_next_page: !!cursor,
      is_prev_page: !!before_cursor,
    });
  }

  const { filteredTotal, unfilteredTotal } = computeTotals(baseWhereSql, baseParams);
  return { items, nextCursor, prevCursor, total: filteredTotal, unfiltered_total: unfilteredTotal };
}

/**
 * List photos in a shared link
 * @param {Object} options
 * @param {number} options.public_link_id - Public link ID
 * @param {number} [options.limit=100] - Page size limit
 * @param {string} [options.cursor] - Forward pagination cursor
 * @param {string} [options.before_cursor] - Backward pagination cursor
 * @param {boolean} [options.includePrivate=false] - If true, include private photos (admin access); if false, only public photos
 * @returns {Object} Result with items, cursors, and total
 */
function listSharedLinkPhotos({
  public_link_id,
  limit = 100,
  cursor = null,
  before_cursor = null,
  includePrivate = false,
}) {
  const db = getDb();
  
  // Base WHERE clause: photos must be in the link
  // For public access (includePrivate=false): also filter to public photos only
  // For admin access (includePrivate=true): include all photos (public + private)
  let whereSql = `
    WHERE ppl.public_link_id = ?${includePrivate ? '' : ' AND ph.visibility = \'public\''}
  `;
  const params = [public_link_id];
  
  // Handle cursor-based pagination
  if (cursor) {
    const { timestamp, id } = parseCursor(cursor);
    whereSql += ` AND (
      (COALESCE(ph.date_time_original, ph.created_at) < ?) OR
      (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id < ?)
    )`;
    params.push(timestamp, timestamp, id);
  } else if (before_cursor) {
    const { timestamp, id } = parseCursor(before_cursor);
    whereSql += ` AND (
      (COALESCE(ph.date_time_original, ph.created_at) > ?) OR
      (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id > ?)
    )`;
    params.push(timestamp, timestamp, id);
  }
  
  const orderSql = before_cursor
    ? 'ORDER BY COALESCE(ph.date_time_original, ph.created_at) ASC, ph.id ASC'
    : 'ORDER BY COALESCE(ph.date_time_original, ph.created_at) DESC, ph.id DESC';
  
  const rows = db
    .prepare(`
      SELECT 
        ph.*, 
        p.project_folder, 
        p.project_name,
        COALESCE(ph.date_time_original, ph.created_at) AS taken_at,
        pph.hash AS public_hash, 
        pph.expires_at AS public_hash_expires_at
      FROM photos ph
      INNER JOIN photo_public_links ppl ON ppl.photo_id = ph.id
      INNER JOIN projects p ON p.id = ph.project_id
      LEFT JOIN photo_public_hashes pph ON pph.photo_id = ph.id
      ${whereSql}
      ${orderSql}
      LIMIT ?
    `)
    .all(...params, limit);
  
  let items = rows || [];
  
  // Reverse items if backward pagination
  if (before_cursor && items.length) {
    items = items.reverse();
  }
  
  let nextCursor = null;
  let prevCursor = null;
  
  if (items.length) {
    const last = items[items.length - 1];
    const first = items[0];
    
    // Check if there are more items after the last one
    const hasMore = db
      .prepare(`
        SELECT 1
        FROM photos ph
        INNER JOIN photo_public_links ppl ON ppl.photo_id = ph.id
        WHERE ppl.public_link_id = ?${includePrivate ? '' : ' AND ph.visibility = \'public\''}
        AND (
          (COALESCE(ph.date_time_original, ph.created_at) < ?) OR
          (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id < ?)
        )
        LIMIT 1
      `)
      .get(
        public_link_id,
        last.date_time_original || last.created_at,
        last.date_time_original || last.created_at,
        last.id,
      );
    
    if (hasMore) {
      nextCursor = createCursor(last.date_time_original || last.created_at, last.id);
    }
    
    if (cursor || before_cursor) {
      prevCursor = createCursor(first.date_time_original || first.created_at, first.id);
    }
  }
  
  // Get total count of photos in this link (filtered by visibility if not includePrivate)
  const totalResult = db
    .prepare(`
      SELECT COUNT(*) as c
      FROM photos ph
      INNER JOIN photo_public_links ppl ON ppl.photo_id = ph.id
      WHERE ppl.public_link_id = ?${includePrivate ? '' : ' AND ph.visibility = \'public\''}
    `)
    .get(public_link_id);
  
  const total = totalResult ? totalResult.c : 0;
  
  return { items, nextCursor, prevCursor, total };
}

module.exports = {
  listProjectFiltered,
  listAll,
  listSharedLinkPhotos,
};
