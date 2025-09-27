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
  tags = null 
}) {
  const db = getDb();
  
  // Build WHERE clause with filters
  const { whereSql, params } = buildProjectPhotosWhere({ 
    project_id, 
    date_from, 
    date_to, 
    file_type, 
    keep_type, 
    orientation, 
    tags 
  });
  
  // Main query to get photos
  const sql = `
    SELECT ph.*
    FROM photos ph
    ${whereSql}
    ORDER BY COALESCE(ph.date_time_original, ph.created_at) DESC, ph.id DESC
    LIMIT ?
  `;
  
  const rows = db.prepare(sql).all(...params, limit);
  const items = rows;
  
  // Simple cursor logic (can be enhanced later)
  let nextCursor = null;
  let prevCursor = null;
  
  if (items && items.length) {
    const last = items[items.length - 1];
    const first = items[0];
    
    // Check if there are more items after the last one
    const hasMoreSql = `
      SELECT 1
      FROM photos ph
      ${whereSql ? whereSql + ' AND' : 'WHERE'} (
        (COALESCE(ph.date_time_original, ph.created_at) < ?) OR
        (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id < ?)
      )
      LIMIT 1
    `;
    const hasMore = db.prepare(hasMoreSql).get(...params, last.date_time_original || last.created_at, last.date_time_original || last.created_at, last.id);
    if (hasMore) {
      nextCursor = createCursor(last.date_time_original || last.created_at, last.id);
    }
    
    // Set prevCursor if we have a cursor (indicating we're not on the first page)
    if (cursor) {
      prevCursor = createCursor(first.date_time_original || first.created_at, first.id);
    }
  }
  
  // Get both filtered and unfiltered total counts
  let filteredTotal = 0;
  let unfilteredTotal = 0;
  
  try {
    // Count with current filters applied
    const filteredCountSql = `
      SELECT COUNT(*) as c 
      FROM photos ph
      ${whereSql}
    `;
    const filteredResult = db.prepare(filteredCountSql).get(...params);
    filteredTotal = filteredResult ? filteredResult.c : 0;
    
    // Count without filters (just project_id)
    const unfilteredCountSql = `
      SELECT COUNT(*) as c 
      FROM photos ph
      WHERE ph.project_id = ?
    `;
    const unfilteredResult = db.prepare(unfilteredCountSql).get(project_id);
    unfilteredTotal = unfilteredResult ? unfilteredResult.c : 0;
    
    console.log('DEBUG: Project total count calculation:', { project_id, filteredTotal, unfilteredTotal });
  } catch (e) {
    console.error('ERROR calculating project total counts:', e);
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
  project_id = null 
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
    tags_provided: !!tags 
  });
  
  // SIMPLE FIX: Handle before_cursor with straightforward approach
  if (before_cursor) {
    log.debug('before_cursor_detected', { before_cursor });
    // Parse the before_cursor to get the boundary
    let cTaken = null, cId = null;
    try {
      const { taken_at, id } = parseCursor(before_cursor);
      cTaken = taken_at;
      cId = id;
      console.log('DEBUG: Parsed before_cursor:', { cTaken, cId });
    } catch (e) {
      log.warn('before_cursor_parse_failed', { message: e?.message });
    }
    
    if (cTaken && cId != null) {
      // Get base filters without cursor
      const { whereSql: baseWhereSql, params: baseParams } = buildAllPhotosWhere({ 
        date_from, 
        date_to, 
        file_type, 
        keep_type, 
        orientation, 
        project_id 
      });
      
      // Build WHERE clause for before_cursor: items older than cursor
      const whereConditions = [];
      const whereParams = [...baseParams];
      
      if (baseWhereSql) {
        whereConditions.push(baseWhereSql.replace('WHERE ', ''));
      }
      
      // CORRECT LOGIC: For before_cursor with DESC sort, we want items NEWER than cursor
      // "Before" in pagination order means "earlier in DESC list" = "newer taken_at"
      whereConditions.push(`(COALESCE(ph.date_time_original, ph.created_at) > ? OR (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id > ?))`);
      whereParams.push(cTaken, cTaken, cId);
      
      const whereSql = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';
      
      // CORRECT ASC + REVERSE APPROACH: Get the immediate previous page
      // 1. Find items newer than cursor
      // 2. Order ASC to bring the "last N" items to the top
      // 3. Take LIMIT to get exactly the previous page
      // 4. Reverse to restore DESC order for client
      const sql = `
        SELECT
          ph.*, p.project_folder, p.project_name,
          COALESCE(ph.date_time_original, ph.created_at) as taken_at
        FROM photos ph
        JOIN projects p ON p.id = ph.project_id
        ${whereSql}
        ORDER BY taken_at ASC, ph.id ASC
        LIMIT ?
      `;
      
      const rows = db.prepare(sql).all(...whereParams, limit);
      // Reverse to get DESC order (newest first) for the client
      const items = rows.reverse();
      
      // Generate cursors
      let nextCursor = null;
      let prevCursor = null;
      if (items && items.length) {
        const first = items[0];
        const last = items[items.length - 1];
        
        // Check for older items (for nextCursor)
        const hasOlderSql = `
          SELECT 1
          FROM photos ph
          JOIN projects p ON p.id = ph.project_id
          ${baseWhereSql ? baseWhereSql + ' AND' : 'WHERE'} (
            (COALESCE(ph.date_time_original, ph.created_at) < ?) OR
            (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id < ?)
          )
          LIMIT 1
        `;
        const hasOlder = db.prepare(hasOlderSql).get(...baseParams, last.taken_at, last.taken_at, last.id);
        if (hasOlder) {
          nextCursor = createCursor(last.taken_at, last.id);
        }
        
        // Check for newer items (for prevCursor)
        const hasNewerSql = `
          SELECT 1
          FROM photos ph
          JOIN projects p ON p.id = ph.project_id
          ${baseWhereSql ? baseWhereSql + ' AND' : 'WHERE'} (
            (COALESCE(ph.date_time_original, ph.created_at) > ?) OR
            (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id > ?)
          )
          LIMIT 1
        `;
        const hasNewer = db.prepare(hasNewerSql).get(...baseParams, first.taken_at, first.taken_at, first.id);
        if (hasNewer) {
          prevCursor = createCursor(first.taken_at, first.id);
        }
      }
      
      // Get total count
      let totalCount = 0;
      try {
        const countSql = `SELECT COUNT(*) as c FROM photos`;
        const countResult = db.prepare(countSql).get();
        totalCount = countResult ? countResult.c : 0;
      } catch (e) {
        log.warn('listAll_count_failed', { message: e?.message });
      }
      
      return { items, nextCursor, prevCursor, total: totalCount };
    }
  }
  
  // NORMAL CASE: forward pagination or initial page
  const { whereSql, params } = buildAllPhotosWhere({ 
    date_from, 
    date_to, 
    file_type, 
    keep_type, 
    orientation, 
    cursor, 
    before_cursor, 
    tags, 
    project_id 
  });

  const sql = `
    SELECT
      ph.*, p.project_folder, p.project_name,
      COALESCE(ph.date_time_original, ph.created_at) as taken_at
    FROM photos ph
    JOIN projects p ON p.id = ph.project_id
    ${whereSql}
    ORDER BY taken_at DESC, ph.id DESC
    LIMIT ?
  `;
  log.debug('listAll_query', { where: whereSql, params, limit });
  const rows = db.prepare(sql).all(...params, limit);
  const items = rows;
  let nextCursor = null;
  let prevCursor = null;
  if (items && items.length) {
    const first = items[0];
    const last = items[items.length - 1];
    // Determine if there are items beyond the current window to set cursors correctly
    // Has older items beyond 'last' (for nextCursor)
    const hasOlderSql = `
      SELECT 1
      FROM photos ph
      JOIN projects p ON p.id = ph.project_id
      ${whereSql ? whereSql + ' AND' : 'WHERE'} (
        (COALESCE(ph.date_time_original, ph.created_at) < ?) OR
        (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id < ?)
      )
      LIMIT 1
    `;
    const hasOlder = db.prepare(hasOlderSql).get(...params, last.taken_at, last.taken_at, last.id);
    if (hasOlder) {
      nextCursor = createCursor(last.taken_at, last.id);
    } else {
      nextCursor = null;
    }

    // Has newer items beyond 'first' (for prevCursor)
    const hasNewerSql = `
      SELECT 1
      FROM photos ph
      JOIN projects p ON p.id = ph.project_id
      ${whereSql ? whereSql + ' AND' : 'WHERE'} (
        (COALESCE(ph.date_time_original, ph.created_at) > ?) OR
        (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id > ?)
      )
      LIMIT 1
    `;
    const hasNewer = db.prepare(hasNewerSql).get(...params, first.taken_at, first.taken_at, first.id);
    
    // SIMPLIFIED FIX: Keep cursors simple - prevCursor = first item, nextCursor = last item
    // The before_cursor logic will handle the complexity by flipping the query
    if (cursor || hasNewer) {
      prevCursor = createCursor(first.taken_at, first.id);
    } else {
      prevCursor = null;
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
  // Get both filtered and unfiltered total counts
  let filteredTotal = 0;
  let unfilteredTotal = 0;
  
  try {
    // Count with current filters applied (same WHERE clause as main query)
    const filteredCountSql = `
      SELECT COUNT(*) as c 
      FROM photos ph
      JOIN projects p ON p.id = ph.project_id
      ${whereSql}
    `;
    const filteredResult = db.prepare(filteredCountSql).get(...params);
    filteredTotal = filteredResult ? filteredResult.c : 0;
    
    // Count without filters (total photos across all non-archived projects, optionally constrained to project)
    let unfilteredQuery = `
      SELECT COUNT(*) as c 
      FROM photos ph
      JOIN projects p ON p.id = ph.project_id
      WHERE (p.status IS NULL OR p.status != 'canceled')
    `;
    const unfilteredParams = [];
    if (project_id != null) {
      unfilteredQuery += ` AND p.id = ?`;
      unfilteredParams.push(project_id);
    }
    const unfilteredResult = db.prepare(unfilteredQuery).get(...unfilteredParams);
    unfilteredTotal = unfilteredResult ? unfilteredResult.c : 0;
    
    console.log('DEBUG: Total count calculation:', { filteredTotal, unfilteredTotal });
  } catch (e) {
    console.error('ERROR calculating total counts:', e);
    log.warn('listAll_count_failed', { message: e?.message });
  }
  
  return { items, nextCursor, prevCursor, total: filteredTotal, unfiltered_total: unfilteredTotal };
}

module.exports = {
  listProjectFiltered,
  listAll
};
