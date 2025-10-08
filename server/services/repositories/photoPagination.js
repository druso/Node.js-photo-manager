const { getDb } = require('../db');
const makeLogger = require('../../utils/logger2');
const { buildProjectPhotosWhere, buildAllPhotosWhere, parseCursor, createCursor } = require('./photoQueryBuilders');
const log = makeLogger('photoPagination');

/**
 * Locate the page in a project that contains a specific target photo
 * @param {Object} options - Location options
 * @param {string} options.project_folder - Project folder name
 * @param {string} [options.filename] - Target photo filename
 * @param {string} [options.name] - Target photo name (basename)
 * @param {number} [options.limit=100] - Page size limit
 * @param {string} [options.date_from] - Start date filter
 * @param {string} [options.date_to] - End date filter
 * @param {string} [options.file_type] - File type filter
 * @param {string} [options.keep_type] - Keep type filter
 * @param {string} [options.orientation] - Orientation filter
 * @returns {Object} Page location result with items, cursors, and target info
 */
function locateProjectPage({ 
  project_folder, 
  filename = null, 
  name = null, 
  limit = 100, 
  date_from = null, 
  date_to = null, 
  file_type = null, 
  keep_type = null, 
  orientation = null,
  tags = null,
  visibility = null,
} = {}) {
  const db = getDb();
  
  if (!project_folder || typeof project_folder !== 'string') {
    const err = new Error('project_folder is required'); 
    err.code = 'INVALID'; 
    throw err;
  }
  if (!filename && !name) {
    const err = new Error('filename or name is required'); 
    err.code = 'INVALID'; 
    throw err;
  }
  
  const capLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 1000) : 100;

  const project = db.prepare(`SELECT id, project_folder, status FROM projects WHERE project_folder = ?`).get(project_folder);
  if (!project) { 
    const err = new Error('Project not found'); 
    err.code = 'NOT_FOUND'; 
    throw err; 
  }
  if (project.status === 'canceled') { 
    const err = new Error('Project archived'); 
    err.code = 'NOT_FOUND'; 
    throw err; 
  }

  // Resolve target within project
  let target = null;
  if (filename) {
    target = db.prepare(`
      SELECT ph.*, COALESCE(ph.date_time_original, ph.created_at) as taken_at,
        pph.hash AS public_hash,
        pph.expires_at AS public_hash_expires_at
      FROM photos ph
      LEFT JOIN photo_public_hashes pph ON pph.photo_id = ph.id
      WHERE ph.project_id = ? AND ph.filename = ?
      LIMIT 1
    `).get(project.id, filename);
  } else if (name) {
    const nm = String(name).toLowerCase();
    const candidates = db.prepare(`
      SELECT ph.*, COALESCE(ph.date_time_original, ph.created_at) as taken_at,
        pph.hash AS public_hash,
        pph.expires_at AS public_hash_expires_at
      FROM photos ph
      LEFT JOIN photo_public_hashes pph ON pph.photo_id = ph.id
      WHERE ph.project_id = ? AND (
        (ph.basename IS NOT NULL AND lower(ph.basename) = ?) OR
        lower(ph.filename) = ? OR
        lower(ph.filename) LIKE (? || '.%')
      )
    `).all(project.id, nm, nm, nm);
    
    if (!candidates || candidates.length === 0) { 
      const err = new Error('Target not found'); 
      err.code = 'NOT_FOUND'; 
      throw err; 
    }
    
    // Prefer JPG/JPEG, else highest id
    candidates.sort((a, b) => {
      const ea = String(a.ext || '').toLowerCase();
      const eb = String(b.ext || '').toLowerCase();
      const sa = ea === 'jpg' || ea === 'jpeg' ? 2 : 1;
      const sb = eb === 'jpg' || eb === 'jpeg' ? 2 : 1;
      if (sb - sa) return sb - sa;
      return (b.id || 0) - (a.id || 0);
    });
    target = candidates[0];
  }
  
  if (!target) { 
    const err = new Error('Target not found'); 
    err.code = 'NOT_FOUND'; 
    throw err; 
  }

  // Build project filtered universe WHERE (without cursor)
  const { whereSql, params } = buildProjectPhotosWhere({ 
    project_id: project.id, 
    date_from, 
    date_to, 
    file_type, 
    keep_type, 
    orientation,
    tags,
    visibility,
  });

  // Ensure target included
  const included = db.prepare(`${whereSql} AND ph.id = ?`.replace('WHERE', 'SELECT 1 FROM photos ph WHERE') + ' LIMIT 1')
    .get(...params, target.id);
  if (!included) { 
    const err = new Error('Target filtered out'); 
    err.code = 'NOT_FOUND'; 
    throw err; 
  }

  // Compute rank in DESC taken_at, id
  const rankSql = `
    SELECT COUNT(*) AS c
    FROM photos ph
    ${whereSql}
    AND (
      (COALESCE(ph.date_time_original, ph.created_at) > ?) OR
      (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id > ?)
    )
  `;
  const rank = db.prepare(rankSql).get(...params, target.taken_at, target.taken_at, target.id).c;
  const pageStart = Math.floor(rank / capLimit) * capLimit;

  // Fetch page slice
  const pageSql = `
    SELECT ph.*,
      COALESCE(ph.date_time_original, ph.created_at) as taken_at,
      pph.hash AS public_hash,
      pph.expires_at AS public_hash_expires_at
    FROM photos ph
    LEFT JOIN photo_public_hashes pph ON pph.photo_id = ph.id
    ${whereSql}
    ORDER BY taken_at DESC, ph.id DESC
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(pageSql).all(...params, capLimit, pageStart);

  // Compute cursors compatible with listPaged (offset-based)
  const totalCount = db.prepare(`SELECT COUNT(*) as c FROM photos ph ${whereSql.replace('WHERE','WHERE')}`).get(...params).c;
  const nextCursor = pageStart + (rows?.length || 0) < totalCount
    ? String(pageStart + (rows?.length || 0))
    : null;
  const prevCursor = pageStart > 0 ? String(Math.max(0, pageStart - capLimit)) : null;

  const items = (rows || []).map((r) => ({
    ...r,
    visibility: r.visibility || 'private',
    public_hash: r.public_hash || null,
    public_hash_expires_at: r.public_hash_expires_at || null,
  }));
  const idxInItems = items.findIndex(r => r.id === target.id);
  const pageIndex = Math.floor(rank / capLimit);

  return {
    items,
    position: rank,
    page_index: pageIndex,
    limit: capLimit,
    nextCursor,
    prevCursor,
    idx_in_items: idxInItems >= 0 ? idxInItems : null,
    target: { 
      id: target.id, 
      project_id: target.project_id, 
      project_folder: project_folder, 
      filename: target.filename, 
      taken_at: target.taken_at,
      visibility: target.visibility || 'private',
      public_hash: target.public_hash || null,
      public_hash_expires_at: target.public_hash_expires_at || null,
    },
  };
}

/**
 * Locate the page in All Photos that contains a specific target photo
 * @param {Object} options - Location options
 * @param {string} options.project_folder - Project folder name
 * @param {string} [options.filename] - Target photo filename
 * @param {string} [options.name] - Target photo name (basename)
 * @param {number} [options.limit=100] - Page size limit
 * @param {string} [options.date_from] - Start date filter
 * @param {string} [options.date_to] - End date filter
 * @param {string} [options.file_type] - File type filter
 * @param {string} [options.keep_type] - Keep type filter
 * @param {string} [options.orientation] - Orientation filter
 * @returns {Object} Page location result with items, cursors, and target info
 */
function locateAllPage({ 
  project_folder, 
  filename = null, 
  name = null, 
  limit = 100, 
  date_from = null, 
  date_to = null, 
  file_type = null, 
  keep_type = null, 
  orientation = null,
  tags = null,
  visibility = null,
} = {}) {
  const db = getDb();
  
  if (!project_folder || typeof project_folder !== 'string') {
    const err = new Error('project_folder is required'); 
    err.code = 'INVALID'; 
    throw err;
  }
  if (!filename && !name) {
    const err = new Error('filename or name is required'); 
    err.code = 'INVALID'; 
    throw err;
  }
  
  const capLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 300) : 100;

  // Resolve project
  const project = db.prepare(`SELECT id, project_folder, status FROM projects WHERE project_folder = ?`).get(project_folder);
  if (!project) { 
    const err = new Error('Project not found'); 
    err.code = 'NOT_FOUND'; 
    throw err; 
  }
  if (project.status === 'canceled') { 
    const err = new Error('Project archived'); 
    err.code = 'NOT_FOUND'; 
    throw err; 
  }

  // Resolve target candidates
  let target = null;
  if (filename) {
    target = db.prepare(`
      SELECT ph.*, COALESCE(ph.date_time_original, ph.created_at) as taken_at
      FROM photos ph
      WHERE ph.project_id = ? AND ph.filename = ?
      LIMIT 1
    `).get(project.id, filename);
  } else if (name) {
    const nm = String(name).toLowerCase();
    // Try basename first; if basename is null, also allow filename without extension via LIKE pattern
    const candidates = db.prepare(`
      SELECT ph.*, COALESCE(ph.date_time_original, ph.created_at) as taken_at
      FROM photos ph
      WHERE ph.project_id = ? AND (
        (ph.basename IS NOT NULL AND lower(ph.basename) = ?) OR
        lower(ph.filename) = ? OR
        lower(ph.filename) LIKE (? || '.%')
      )
    `).all(project.id, nm, nm, nm);
    
    if (!candidates || candidates.length === 0) { 
      const err = new Error('Target not found'); 
      err.code = 'NOT_FOUND'; 
      throw err; 
    }
    
    // If multiple candidates match the basename, deterministically select a preferred one
    if (candidates.length > 1) {
      const score = (row) => {
        try {
          const e = String(row.ext || '').toLowerCase();
          if (e === 'jpg' || e === 'jpeg') return 3;
          if (e === 'arw' || e === 'cr2' || e === 'nef' || e === 'dng' || e === 'raw') return 2;
          return 1;
        } catch { return 1; }
      };
      
      // Prefer candidates that are included by current filters
      try {
        const { whereSql, params } = buildAllPhotosWhere({ 
          date_from, 
          date_to, 
          file_type, 
          keep_type, 
          orientation, 
          tags,
          project_id: project.id,
          visibility,
        });
        const checkSql = `
          SELECT 1
          FROM photos ph
          JOIN projects p ON p.id = ph.project_id
          ${whereSql ? whereSql + ' AND' : 'WHERE'} ph.id = ?
          LIMIT 1
        `;
        const included = [];
        for (const c of candidates) {
          const hit = db.prepare(checkSql).get(...params, c.id);
          if (hit) included.push(c);
        }
        const pool = included.length ? included : candidates;
        pool.sort((a, b) => {
          const s = score(b) - score(a);
          if (s) return s;
          return (b.id || 0) - (a.id || 0);
        });
        candidates.length = 0; // replace original array contents
        for (const it of pool) candidates.push(it);
      } catch (e) {
        // Fallback to deterministic rule even if inclusion check fails
        candidates.sort((a, b) => {
          const s = score(b) - score(a);
          if (s) return s;
          return (b.id || 0) - (a.id || 0);
        });
      }
      log.warn('locateAllPage_ambiguous_name_resolved', { 
        project_folder, 
        name: nm, 
        matches: candidates.length, 
        chosen_id: candidates[0]?.id, 
        chosen_ext: candidates[0]?.ext 
      });
    }
    target = candidates[0];
  }
  
  if (!target) { 
    const err = new Error('Target not found'); 
    err.code = 'NOT_FOUND'; 
    throw err; 
  }

  // Build filtered universe WHERE (without cursor)
  const { whereSql, params } = buildAllPhotosWhere({ 
    date_from, 
    date_to, 
    file_type, 
    keep_type, 
    orientation, 
    tags,
    project_id: project.id,
    visibility,
  });

  // Ensure target is included in filtered set by checking it matches filters and non-archived project constraint
  const checkSql = `
    SELECT 1
    FROM photos ph
    JOIN projects p ON p.id = ph.project_id
    ${whereSql ? whereSql + ' AND' : 'WHERE'} ph.id = ?
    LIMIT 1
  `;
  const included = db.prepare(checkSql).get(...params, target.id);
  if (!included) { 
    const err = new Error('Target filtered out'); 
    err.code = 'NOT_FOUND'; 
    throw err; 
  }

  // Compute rank: rows before target in DESC ordering
  const rankSql = `
    SELECT COUNT(*) AS c
    FROM photos ph
    JOIN projects p ON p.id = ph.project_id
    ${whereSql ? whereSql + ' AND' : 'WHERE'} (
      (COALESCE(ph.date_time_original, ph.created_at) > ?) OR
      (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id > ?)
    )
  `;
  const rank = db.prepare(rankSql).get(...params, target.taken_at, target.taken_at, target.id).c;
  const pageStart = Math.floor(rank / capLimit) * capLimit;

  // Fetch page slice
  const pageSql = `
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
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(pageSql).all(...params, capLimit, pageStart);

  // Compute cursors
  let nextCursor = null;
  let prevCursor = null;
  if (rows && rows.length) {
    const last = rows[rows.length - 1];
    nextCursor = createCursor(last.taken_at, last.id);
  }
  if (pageStart > 0) {
    const prevRowSql = `
      SELECT
        COALESCE(ph.date_time_original, ph.created_at) as taken_at, ph.id
      FROM photos ph
      JOIN projects p ON p.id = ph.project_id
      ${whereSql}
      ORDER BY taken_at DESC, ph.id DESC
      LIMIT 1 OFFSET ?
    `;
    const prevRow = db.prepare(prevRowSql).get(...params, pageStart - 1);
    if (prevRow) {
      prevCursor = createCursor(prevRow.taken_at, prevRow.id);
    }
  }

  const items = (rows || []).map((r) => ({
    ...r,
    project_folder: r.project_folder,
    project_name: r.project_name,
    visibility: r.visibility || 'private',
    public_hash: r.public_hash || null,
    public_hash_expires_at: r.public_hash_expires_at || null,
  }));
  const idxInItems = items.findIndex(r => r.id === target.id);
  const pageIndex = Math.floor(rank / capLimit);

  return {
    items,
    position: rank,
    page_index: pageIndex,
    limit: capLimit,
    prevCursor,
    idx_in_items: idxInItems >= 0 ? idxInItems : null,
    target: { 
      id: target.id, 
      project_id: target.project_id, 
      project_folder: project_folder, 
      filename: target.filename, 
      taken_at: target.taken_at,
      visibility: target.visibility || 'private',
    },
  };
}

/**
 * List photos with pagination support (project-scoped)
 * @param {Object} options - Pagination options
 * @param {number} options.project_id - Project ID
 * @param {string} [options.sort='filename'] - Sort field
 * @param {string} [options.dir='ASC'] - Sort direction
 * @param {number} [options.limit=100] - Page size limit
 * @param {string} [options.cursor] - Forward pagination cursor
 * @param {string} [options.before_cursor] - Backward pagination cursor
 * @param {string} [options.date_from] - Start date filter
 * @param {string} [options.date_to] - End date filter
 * @param {string} [options.file_type] - File type filter
 * @param {string} [options.keep_type] - Keep type filter
 * @param {string} [options.orientation] - Orientation filter
 * @returns {Object} Paginated result with items, total, and cursors
 */
function listPaged({ 
  project_id, 
  sort = 'filename', 
  dir = 'ASC', 
  limit = 100, 
  cursor = null, 
  before_cursor = null, 
  date_from = null, 
  date_to = null, 
  file_type = null, 
  keep_type = null, 
  orientation = null 
}) {
  const db = getDb();
  const safeSort = ['filename', 'date_time_original', 'created_at', 'updated_at'].includes(sort) ? sort : 'filename';
  const safeDir = dir && dir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  // Keyset pagination supported for DESC on date-based sorts
  const isDateSort = ['date_time_original', 'created_at', 'updated_at'].includes(safeSort);
  const useKeyset = isDateSort && safeDir === 'DESC' && (cursor || before_cursor);

  if (useKeyset) {
    // Determine ordering expression
    const orderExpr = safeSort === 'date_time_original'
      ? 'COALESCE(ph.date_time_original, ph.created_at)'
      : (safeSort === 'created_at' ? 'ph.created_at' : 'ph.updated_at');

    const params = [project_id];
    const where = ['ph.project_id = ?'];

    try {
      if (cursor && !before_cursor) {
        const { taken_at, id } = parseCursor(cursor);
        if (taken_at && id != null) {
          where.push(`(${orderExpr} < ? OR (${orderExpr} = ? AND ph.id < ?))`);
          params.push(taken_at, taken_at, id);
        }
      }
    } catch (e) {
      log.warn('project_list_keyset_cursor_parse_failed', { message: e && e.message });
    }
    
    try {
      if (before_cursor) {
        const { taken_at, id } = parseCursor(before_cursor);
        if (taken_at && id != null) {
          where.push(`(${orderExpr} > ? OR (${orderExpr} = ? AND ph.id > ?))`);
          params.push(taken_at, taken_at, id);
        }
      }
    } catch (e) {
      log.warn('project_list_keyset_before_cursor_parse_failed', { message: e && e.message });
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const sql = `
      SELECT ph.*,
        ${orderExpr} as taken_at
      FROM photos ph
      ${whereSql}
      ORDER BY ${orderExpr} DESC, ph.id DESC
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(...params, limit);
    const items = rows || [];
    let nextCursor = null;
    let prevCursor = null;
    if (items.length) {
      const first = items[0];
      const last = items[items.length - 1];
      nextCursor = createCursor(last.taken_at, last.id);
      prevCursor = createCursor(first.taken_at, first.id);
    }
    const total = db.prepare(`SELECT COUNT(*) as c FROM photos ph WHERE ph.project_id = ?`).get(project_id).c;
    return { items, total, nextCursor, prevCursor };
  }

  // Fallback: OFFSET-based pagination (kept for filename or ASC sorts)
  let offset = 0;
  if (cursor) {
    const n = parseInt(cursor, 10);
    if (!isNaN(n) && n >= 0) offset = n;
  }
  const items = db.prepare(`
    SELECT * FROM photos WHERE project_id = ?
    ORDER BY ${safeSort} ${safeDir}, id ${safeDir}
    LIMIT ? OFFSET ?
  `).all(project_id, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) as c FROM photos WHERE project_id = ?`).get(project_id).c;
  const nextCursor = offset + items.length < total ? String(offset + items.length) : null;
  const prevCursor = offset > 0 ? String(Math.max(0, offset - limit)) : null;
  return { items, total, nextCursor, prevCursor };
}

module.exports = {
  locateProjectPage,
  locateAllPage,
  listPaged
};
