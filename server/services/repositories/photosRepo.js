const { getDb } = require('../db');
const makeLogger = require('../../utils/logger2');
const log = makeLogger('photosRepo');

function nowISO() { return new Date().toISOString(); }

// ---- Project-scoped page locator ----
// Similar to locateAllPage but restricted to a single project and compatible with /api/projects/:folder/photos pagination semantics.
// Params: { project_folder, filename?, name?, limit = 100, date_from?, date_to?, file_type?, keep_type?, orientation? }
function buildProjectPhotosWhere({ project_id, date_from = null, date_to = null, file_type = null, keep_type = null, orientation = null } = {}) {
  const params = [];
  const where = [];
  where.push(`ph.project_id = ?`);
  params.push(project_id);
  if (date_from) {
    where.push(`COALESCE(ph.date_time_original, ph.created_at) >= ?`);
    params.push(String(date_from));
  }
  if (date_to) {
    where.push(`COALESCE(ph.date_time_original, ph.created_at) <= ?`);
    params.push(String(date_to));
  }
  if (file_type && typeof file_type === 'string' && file_type !== 'any') {
    if (file_type === 'jpg_only') {
      where.push(`ph.jpg_available = 1 AND ph.raw_available = 0`);
    } else if (file_type === 'raw_only') {
      where.push(`ph.raw_available = 1 AND ph.jpg_available = 0`);
    } else if (file_type === 'both') {
      where.push(`ph.jpg_available = 1 AND ph.raw_available = 1`);
    }
  }
  if (keep_type && typeof keep_type === 'string' && keep_type !== 'any') {
    if (keep_type === 'any_kept') {
      where.push(`(ph.keep_jpg = 1 OR ph.keep_raw = 1)`);
    } else if (keep_type === 'jpg_only') {
      where.push(`ph.keep_jpg = 1 AND ph.keep_raw = 0`);
    } else if (keep_type === 'raw_jpg') {
      where.push(`ph.keep_jpg = 1 AND ph.keep_raw = 1`);
    } else if (keep_type === 'none') {
      where.push(`ph.keep_jpg = 0 AND ph.keep_raw = 0`);
    }
  }
  if (orientation && typeof orientation === 'string' && orientation !== 'any') {
    const wExpr = `COALESCE(CAST(json_extract(ph.meta_json, '$.exif_image_width') AS INTEGER), CAST(json_extract(ph.meta_json, '$.ExifImageWidth') AS INTEGER), CAST(json_extract(ph.meta_json, '$.ImageWidth') AS INTEGER))`;
    const hExpr = `COALESCE(CAST(json_extract(ph.meta_json, '$.exif_image_height') AS INTEGER), CAST(json_extract(ph.meta_json, '$.ExifImageHeight') AS INTEGER), CAST(json_extract(ph.meta_json, '$.ImageHeight') AS INTEGER))`;
    const oExpr = `COALESCE(ph.orientation, CAST(json_extract(ph.meta_json, '$.orientation') AS INTEGER), CAST(json_extract(ph.meta_json, '$.Orientation') AS INTEGER), 1)`;
    if (orientation === 'vertical') {
      where.push(`(${wExpr} IS NOT NULL AND ${hExpr} IS NOT NULL AND (CASE WHEN ${oExpr} IN (6,8) THEN ${wExpr} > ${hExpr} ELSE ${hExpr} > ${wExpr} END))`);
    } else if (orientation === 'horizontal') {
      where.push(`(${wExpr} IS NOT NULL AND ${hExpr} IS NOT NULL AND (CASE WHEN ${oExpr} IN (6,8) THEN ${hExpr} > ${wExpr} ELSE ${wExpr} > ${hExpr} END))`);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}

function locateProjectPage({ project_folder, filename = null, name = null, limit = 100, date_from = null, date_to = null, file_type = null, keep_type = null, orientation = null } = {}) {
  const db = getDb();
  if (!project_folder || typeof project_folder !== 'string') {
    const err = new Error('project_folder is required'); err.code = 'INVALID'; throw err;
  }
  if (!filename && !name) {
    const err = new Error('filename or name is required'); err.code = 'INVALID'; throw err;
  }
  const capLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 1000) : 100;

  const project = db.prepare(`SELECT id, project_folder, status FROM projects WHERE project_folder = ?`).get(project_folder);
  if (!project) { const err = new Error('Project not found'); err.code = 'NOT_FOUND'; throw err; }
  if (project.status === 'canceled') { const err = new Error('Project archived'); err.code = 'NOT_FOUND'; throw err; }

  // Resolve target within project
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
    const candidates = db.prepare(`
      SELECT ph.*, COALESCE(ph.date_time_original, ph.created_at) as taken_at
      FROM photos ph
      WHERE ph.project_id = ? AND (
        (ph.basename IS NOT NULL AND lower(ph.basename) = ?) OR
        lower(ph.filename) = ? OR
        lower(ph.filename) LIKE (? || '.%')
      )
    `).all(project.id, nm, nm, nm);
    if (!candidates || candidates.length === 0) { const err = new Error('Target not found'); err.code = 'NOT_FOUND'; throw err; }
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
  if (!target) { const err = new Error('Target not found'); err.code = 'NOT_FOUND'; throw err; }

  // Build project filtered universe WHERE (without cursor)
  const { whereSql, params } = buildProjectPhotosWhere({ project_id: project.id, date_from, date_to, file_type, keep_type, orientation });

  // Ensure target included
  const included = db.prepare(`${whereSql} AND ph.id = ?`.replace('WHERE', 'SELECT 1 FROM photos ph WHERE') + ' LIMIT 1').get(...params, target.id);
  if (!included) { const err = new Error('Target filtered out'); err.code = 'NOT_FOUND'; throw err; }

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
      COALESCE(ph.date_time_original, ph.created_at) as taken_at
    FROM photos ph
    ${whereSql}
    ORDER BY taken_at DESC, ph.id DESC
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(pageSql).all(...params, capLimit, pageStart);

  // Compute cursors compatible with listPaged (offset-based)
  const nextCursor = pageStart + (rows?.length || 0) < db.prepare(`SELECT COUNT(*) as c FROM photos ph ${whereSql.replace('WHERE','WHERE')}`).get(...params).c
    ? String(pageStart + (rows?.length || 0))
    : null;
  const prevCursor = pageStart > 0 ? String(Math.max(0, pageStart - capLimit)) : null;

  const items = rows || [];
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
    target: { id: target.id, project_id: target.project_id, project_folder: project_folder, filename: target.filename, taken_at: target.taken_at },
  };
}

function upsertPhoto(project_id, photo) {
  const db = getDb();
  const ts = nowISO();
  // Prefer project-scoped lookup by filename to avoid cross-project collisions.
  const existing = getByProjectAndFilename(project_id, photo.filename) || getByManifestId(photo.manifest_id);
  if (existing) {
    const stmt = db.prepare(`
      UPDATE photos SET
        filename = ?, basename = ?, ext = ?,
        updated_at = ?, date_time_original = ?,
        jpg_available = ?, raw_available = ?, other_available = ?,
        keep_jpg = ?, keep_raw = ?,
        thumbnail_status = ?, preview_status = ?,
        orientation = ?, meta_json = ?
      WHERE id = ?
    `);
    stmt.run(
      photo.filename, photo.basename || null, photo.ext || null,
      ts, photo.date_time_original || null,
      photo.jpg_available ? 1 : 0, photo.raw_available ? 1 : 0, photo.other_available ? 1 : 0,
      photo.keep_jpg ? 1 : 0, photo.keep_raw ? 1 : 0,
      photo.thumbnail_status || null, photo.preview_status || null,
      photo.orientation ?? null, photo.meta_json || null,
      existing.id
    );
    return getById(existing.id);
  } else {
    const stmt = db.prepare(`
      INSERT INTO photos (
        project_id, manifest_id, filename, basename, ext,
        created_at, updated_at, date_time_original,
        jpg_available, raw_available, other_available,
        keep_jpg, keep_raw, thumbnail_status, preview_status,
        orientation, meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      project_id, (photo.manifest_id || `${project_id}:${photo.filename}`), photo.filename, photo.basename || null, photo.ext || null,
      ts, ts, photo.date_time_original || null,
      photo.jpg_available ? 1 : 0, photo.raw_available ? 1 : 0, photo.other_available ? 1 : 0,
      photo.keep_jpg ? 1 : 0, photo.keep_raw ? 1 : 0,
      photo.thumbnail_status || null, photo.preview_status || null,
      photo.orientation ?? null, photo.meta_json || null
    );
    return getById(info.lastInsertRowid);
  }
}

function updateDerivativeStatus(id, { thumbnail_status, preview_status }) {
  const db = getDb();
  const sets = [];
  const params = [];
  if (thumbnail_status !== undefined) { sets.push('thumbnail_status = ?'); params.push(thumbnail_status); }
  if (preview_status !== undefined) { sets.push('preview_status = ?'); params.push(preview_status); }
  if (!sets.length) return getById(id);
  const sql = `UPDATE photos SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`;
  params.push(nowISO(), id);
  db.prepare(sql).run(...params);
  return getById(id);
}

function updateKeepFlags(id, { keep_jpg, keep_raw }) {
  const db = getDb();
  const ts = nowISO();
  db.prepare(`UPDATE photos SET keep_jpg = ?, keep_raw = ?, updated_at = ? WHERE id = ?`)
    .run(keep_jpg ? 1 : 0, keep_raw ? 1 : 0, ts, id);
  return getById(id);
}

function getById(id) {
  const db = getDb();
  return db.prepare(`SELECT * FROM photos WHERE id = ?`).get(id);
}

function getByManifestId(manifest_id) {
  if (!manifest_id) return null;
  const db = getDb();
  return db.prepare(`SELECT * FROM photos WHERE manifest_id = ?`).get(manifest_id);
}

function getByFilename(project_id, filename) {
  const db = getDb();
  return db.prepare(`SELECT * FROM photos WHERE project_id = ? AND filename = ?`).get(project_id, filename);
}

function getByProjectAndFilename(project_id, filename) {
  if (!project_id || !filename) return null;
  const db = getDb();
  return db.prepare(`SELECT * FROM photos WHERE project_id = ? AND filename = ?`).get(project_id, filename);
}

// Helper function to build WHERE clause for project photo filtering (similar to buildAllPhotosWhere)
function buildProjectPhotosWhere({ project_id, date_from = null, date_to = null, file_type = null, keep_type = null, orientation = null } = {}) {
  const params = [project_id];
  const where = ['ph.project_id = ?'];
  
  // Date filters operate on date_time_original with created_at fallback
  if (date_from) {
    where.push(`COALESCE(ph.date_time_original, ph.created_at) >= ?`);
    params.push(String(date_from));
  }
  if (date_to) {
    where.push(`COALESCE(ph.date_time_original, ph.created_at) <= ?`);
    params.push(String(date_to));
  }
  
  // File type availability filter
  if (file_type && typeof file_type === 'string' && file_type !== 'any') {
    if (file_type === 'jpg_only') {
      where.push(`ph.jpg_available = 1`);
    } else if (file_type === 'raw_only') {
      where.push(`ph.raw_available = 1`);
    } else if (file_type === 'both') {
      where.push(`ph.jpg_available = 1 AND ph.raw_available = 1`);
    }
  }
  
  // Keep type filter
  if (keep_type && typeof keep_type === 'string' && keep_type !== 'any') {
    if (keep_type === 'any_kept') {
      where.push(`(ph.keep_jpg = 1 OR ph.keep_raw = 1)`);
    } else if (keep_type === 'jpg_only') {
      where.push(`ph.keep_jpg = 1`);
    } else if (keep_type === 'raw_jpg') {
      where.push(`ph.keep_jpg = 1 AND ph.keep_raw = 1`);
    } else if (keep_type === 'none') {
      where.push(`ph.keep_jpg = 0 AND ph.keep_raw = 0`);
    }
  }
  
  // Orientation filter
  if (orientation && typeof orientation === 'string' && orientation !== 'any') {
    if (orientation === 'vertical') {
      where.push(`ph.orientation = 'vertical'`);
    } else if (orientation === 'horizontal') {
      where.push(`ph.orientation = 'horizontal'`);
    }
  }
  
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}

// New function for filtered project photos (similar to listAll but for a specific project)
function listProjectFiltered({ project_id, limit = 100, cursor = null, before_cursor = null, date_from = null, date_to = null, file_type = null, keep_type = null, orientation = null }) {
  const db = getDb();
  
  // Build WHERE clause with filters
  const { whereSql, params } = buildProjectPhotosWhere({ project_id, date_from, date_to, file_type, keep_type, orientation });
  
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
      nextCursor = Buffer.from(JSON.stringify({ taken_at: last.date_time_original || last.created_at, id: last.id }), 'utf8').toString('base64');
    }
    
    // Set prevCursor if we have a cursor (indicating we're not on the first page)
    if (cursor) {
      prevCursor = Buffer.from(JSON.stringify({ taken_at: first.date_time_original || first.created_at, id: first.id }), 'utf8').toString('base64');
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

function listPaged({ project_id, sort = 'filename', dir = 'ASC', limit = 100, cursor = null, before_cursor = null, date_from = null, date_to = null, file_type = null, keep_type = null, orientation = null }) {
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

    const parseB64Cursor = (val) => {
      let cur = String(val).trim().replace(/-/g, '+').replace(/_/g, '/');
      const pad = cur.length % 4; if (pad) cur += '='.repeat(4 - pad);
      const json = Buffer.from(cur, 'base64').toString('utf8');
      const obj = JSON.parse(json);
      const t = obj && obj.taken_at ? String(obj.taken_at) : null;
      const id = obj && Number.isFinite(Number(obj.id)) ? Number(obj.id) : null;
      return { t, id };
    };

    try {
      if (cursor && !before_cursor) {
        const { t, id } = parseB64Cursor(cursor);
        if (t && id != null) {
          where.push(`(${orderExpr} < ? OR (${orderExpr} = ? AND ph.id < ?))`);
          params.push(t, t, id);
        }
      }
    } catch (e) {
      log.warn('project_list_keyset_cursor_parse_failed', { message: e && e.message });
    }
    try {
      if (before_cursor) {
        const { t, id } = parseB64Cursor(before_cursor);
        if (t && id != null) {
          where.push(`(${orderExpr} > ? OR (${orderExpr} = ? AND ph.id > ?))`);
          params.push(t, t, id);
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
      nextCursor = Buffer.from(JSON.stringify({ taken_at: last.taken_at, id: last.id }), 'utf8').toString('base64');
      prevCursor = Buffer.from(JSON.stringify({ taken_at: first.taken_at, id: first.id }), 'utf8').toString('base64');
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

function removeById(id) {
  const db = getDb();
  db.prepare(`DELETE FROM photos WHERE id = ?`).run(id);
}

function countByProject(project_id) {
  const db = getDb();
  return db.prepare(`SELECT COUNT(*) as c FROM photos WHERE project_id = ?`).get(project_id).c;
}

// Returns a photo by filename across all projects, optionally excluding a project_id
function getGlobalByFilename(filename, { exclude_project_id = null } = {}) {
  if (!filename) return null;
  const db = getDb();
  const conds = ['filename = ?'];
  const params = [filename];
  if (exclude_project_id != null) { conds.push('project_id != ?'); params.push(exclude_project_id); }
  const where = `WHERE ${conds.join(' AND ')}`;
  return db.prepare(`SELECT * FROM photos ${where} LIMIT 1`).get(...params);
}

// Move a photo row to a different project, rewriting manifest_id and aligning keep flags to availability
function moveToProject({ photo_id, to_project_id }) {
  if (!photo_id || !to_project_id) throw new Error('moveToProject requires photo_id and to_project_id');
  const db = getDb();
  const row = getById(photo_id);
  if (!row) throw new Error('Photo not found');
  const ts = nowISO();
  const manifest_id = `${to_project_id}:${row.filename}`;
  const keep_jpg = row.jpg_available ? 1 : 0;
  const keep_raw = row.raw_available ? 1 : 0;
  db.prepare(`UPDATE photos SET project_id = ?, manifest_id = ?, keep_jpg = ?, keep_raw = ?, updated_at = ? WHERE id = ?`)
    .run(to_project_id, manifest_id, keep_jpg, keep_raw, ts, photo_id);
  return getById(photo_id);
}

module.exports = {
  upsertPhoto,
  updateDerivativeStatus,
  updateKeepFlags,
  getById,
  getByManifestId,
  getByFilename,
  getByProjectAndFilename,
  getGlobalByFilename,
  moveToProject,
  listPaged,
  listProjectFiltered,
  removeById,
  countByProject,
  listAll,
  locateAllPage,
  locateProjectPage,
};

// ---- Cross-project listing (All Photos) ----
// Keyset pagination over taken_at := COALESCE(date_time_original, created_at) DESC, id DESC
// Options: { limit, cursor?, before_cursor?, date_from?, date_to?, file_type?, keep_type?, orientation? }
function buildAllPhotosWhere({ date_from = null, date_to = null, file_type = null, keep_type = null, orientation = null, cursor = null, before_cursor = null } = {}) {
  const params = [];
  const where = [];
  // Exclude archived projects (wrap OR to preserve AND precedence with other filters)
  where.push(`(p.status IS NULL OR p.status != 'canceled')`);
  // Date filters operate on taken_at
  if (date_from) {
    where.push(`COALESCE(ph.date_time_original, ph.created_at) >= ?`);
    params.push(String(date_from));
  }
  if (date_to) {
    where.push(`COALESCE(ph.date_time_original, ph.created_at) <= ?`);
    params.push(String(date_to));
  }
  // File type availability filter
  if (file_type && typeof file_type === 'string' && file_type !== 'any') {
    if (file_type === 'jpg_only') {
      where.push(`ph.jpg_available = 1 AND ph.raw_available = 0`);
    } else if (file_type === 'raw_only') {
      where.push(`ph.raw_available = 1 AND ph.jpg_available = 0`);
    } else if (file_type === 'both') {
      where.push(`ph.jpg_available = 1 AND ph.raw_available = 1`);
    }
  }
  // Keep-type filter (planned keep flags)
  if (keep_type && typeof keep_type === 'string' && keep_type !== 'any') {
    if (keep_type === 'any_kept') {
      where.push(`(ph.keep_jpg = 1 OR ph.keep_raw = 1)`);
    } else if (keep_type === 'jpg_only') {
      where.push(`ph.keep_jpg = 1 AND ph.keep_raw = 0`);
    } else if (keep_type === 'raw_jpg') {
      where.push(`ph.keep_jpg = 1 AND ph.keep_raw = 1`);
    } else if (keep_type === 'none') {
      where.push(`ph.keep_jpg = 0 AND ph.keep_raw = 0`);
    }
  }
  // Orientation filter: compute vertical/horizontal considering EXIF rotation (6/8 swaps)
  if (orientation && typeof orientation === 'string' && orientation !== 'any') {
    const wExpr = `COALESCE(CAST(json_extract(ph.meta_json, '$.exif_image_width') AS INTEGER), CAST(json_extract(ph.meta_json, '$.ExifImageWidth') AS INTEGER), CAST(json_extract(ph.meta_json, '$.ImageWidth') AS INTEGER))`;
    const hExpr = `COALESCE(CAST(json_extract(ph.meta_json, '$.exif_image_height') AS INTEGER), CAST(json_extract(ph.meta_json, '$.ExifImageHeight') AS INTEGER), CAST(json_extract(ph.meta_json, '$.ImageHeight') AS INTEGER))`;
    const oExpr = `COALESCE(ph.orientation, CAST(json_extract(ph.meta_json, '$.orientation') AS INTEGER), CAST(json_extract(ph.meta_json, '$.Orientation') AS INTEGER), 1)`;
    if (orientation === 'vertical') {
      where.push(`(${wExpr} IS NOT NULL AND ${hExpr} IS NOT NULL AND (CASE WHEN ${oExpr} IN (6,8) THEN ${wExpr} > ${hExpr} ELSE ${hExpr} > ${wExpr} END))`);
    } else if (orientation === 'horizontal') {
      where.push(`(${wExpr} IS NOT NULL AND ${hExpr} IS NOT NULL AND (CASE WHEN ${oExpr} IN (6,8) THEN ${hExpr} > ${wExpr} ELSE ${wExpr} > ${hExpr} END))`);
    }
  }
  // No implicit thumbnail-status filtering
  // Forward pagination: items strictly older than the cursor position
  if (cursor && !before_cursor) {
    try {
      let cur = String(cursor).trim();
      // Support URL-safe base64 and missing padding
      cur = cur.replace(/-/g, '+').replace(/_/g, '/');
      const pad = cur.length % 4;
      if (pad) cur = cur + '='.repeat(4 - pad);
      const json = Buffer.from(cur, 'base64').toString('utf8');
      const obj = JSON.parse(json);
      const cTaken = obj && obj.taken_at ? String(obj.taken_at) : null;
      const cId = obj && Number.isFinite(Number(obj.id)) ? Number(obj.id) : null;
      log.debug('build_where_cursor_parsed', { cursor_len: String(cursor).length, cTaken, cId });
      if (cTaken && cId != null) {
        where.push(`(COALESCE(ph.date_time_original, ph.created_at) < ? OR (COALESCE(ph.date_time_original, ph.created_at) = ? AND ph.id < ?))`);
        params.push(cTaken, cTaken, cId);
      }
    } catch (e) {
      log.warn('build_where_cursor_parse_failed', { cursor_sample: String(cursor).slice(0, 16), message: e && e.message });
    }
  }
  // Note: before_cursor is now handled separately in listAll() with flipped query approach
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}
function listAll({ limit = 200, cursor = null, before_cursor = null, date_from = null, date_to = null, file_type = null, keep_type = null, orientation = null } = {}) {
  const db = getDb();
  
  log.debug('listAll_called', { limit, cursor, before_cursor, date_from, date_to, file_type, keep_type, orientation });
  
  // SIMPLE FIX: Handle before_cursor with straightforward approach
  if (before_cursor) {
    log.debug('before_cursor_detected', { before_cursor });
    // Parse the before_cursor to get the boundary
    let cTaken = null, cId = null;
    try {
      let cur = String(before_cursor).trim();
      cur = cur.replace(/-/g, '+').replace(/_/g, '/');
      const pad = cur.length % 4;
      if (pad) cur = cur + '='.repeat(4 - pad);
      const json = Buffer.from(cur, 'base64').toString('utf8');
      const obj = JSON.parse(json);
      cTaken = obj && obj.taken_at ? String(obj.taken_at) : null;
      cId = obj && Number.isFinite(Number(obj.id)) ? Number(obj.id) : null;
      console.log('DEBUG: Parsed before_cursor:', { cTaken, cId });
    } catch (e) {
      log.warn('before_cursor_parse_failed', { message: e?.message });
    }
    
    if (cTaken && cId != null) {
      // Get base filters without cursor
      const { whereSql: baseWhereSql, params: baseParams } = buildAllPhotosWhere({ date_from, date_to, file_type, keep_type, orientation });
      
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
          nextCursor = Buffer.from(JSON.stringify({ taken_at: last.taken_at, id: last.id }), 'utf8').toString('base64');
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
          prevCursor = Buffer.from(JSON.stringify({ taken_at: first.taken_at, id: first.id }), 'utf8').toString('base64');
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
  const { whereSql, params } = buildAllPhotosWhere({ date_from, date_to, file_type, keep_type, orientation, cursor, before_cursor });

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
      nextCursor = Buffer.from(JSON.stringify({ taken_at: last.taken_at, id: last.id }), 'utf8').toString('base64');
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
      prevCursor = Buffer.from(JSON.stringify({ taken_at: first.taken_at, id: first.id }), 'utf8').toString('base64');
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
    
    // Count without filters (total photos across all non-archived projects)
    const unfilteredCountSql = `
      SELECT COUNT(*) as c 
      FROM photos ph
      JOIN projects p ON p.id = ph.project_id
      WHERE (p.status IS NULL OR p.status != 'canceled')
    `;
    const unfilteredResult = db.prepare(unfilteredCountSql).get();
    unfilteredTotal = unfilteredResult ? unfilteredResult.c : 0;
    
    console.log('DEBUG: Total count calculation:', { filteredTotal, unfilteredTotal });
  } catch (e) {
    console.error('ERROR calculating total counts:', e);
    log.warn('listAll_count_failed', { message: e?.message });
  }
  
  return { items, nextCursor, prevCursor, total: filteredTotal, unfiltered_total: unfilteredTotal };
}

// Locate the page in All Photos that contains a specific target photo, returning that page slice and cursors.
// Params: { project_folder, filename?, name?, limit = 100, date_from?, date_to?, file_type?, keep_type?, orientation? }
function locateAllPage({ project_folder, filename = null, name = null, limit = 100, date_from = null, date_to = null, file_type = null, keep_type = null, orientation = null } = {}) {
  const db = getDb();
  if (!project_folder || typeof project_folder !== 'string') {
    const err = new Error('project_folder is required'); err.code = 'INVALID'; throw err;
  }
  if (!filename && !name) {
    const err = new Error('filename or name is required'); err.code = 'INVALID'; throw err;
  }
  const capLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 300) : 100;

  // Resolve project
  const project = db.prepare(`SELECT id, project_folder, status FROM projects WHERE project_folder = ?`).get(project_folder);
  if (!project) { const err = new Error('Project not found'); err.code = 'NOT_FOUND'; throw err; }
  if (project.status === 'canceled') { const err = new Error('Project archived'); err.code = 'NOT_FOUND'; throw err; }

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
    if (!candidates || candidates.length === 0) { const err = new Error('Target not found'); err.code = 'NOT_FOUND'; throw err; }
    // If multiple candidates match the basename, deterministically select a preferred one:
    // 1) Prefer JPG/JPEG extension if available
    // 2) Otherwise, pick the highest id (newest row)
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
        const { whereSql, params } = buildAllPhotosWhere({ date_from, date_to, file_type, keep_type, orientation });
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
      log.warn('locateAllPage_ambiguous_name_resolved', { project_folder, name: nm, matches: candidates.length, chosen_id: candidates[0]?.id, chosen_ext: candidates[0]?.ext });
    }
    target = candidates[0];
  }
  if (!target) { const err = new Error('Target not found'); err.code = 'NOT_FOUND'; throw err; }

  // Build filtered universe WHERE (without cursor)
  const { whereSql, params } = buildAllPhotosWhere({ date_from, date_to, file_type, keep_type, orientation });

  // Ensure target is included in filtered set by checking it matches filters and non-archived project constraint
  const checkSql = `
    SELECT 1
    FROM photos ph
    JOIN projects p ON p.id = ph.project_id
    ${whereSql ? whereSql + ' AND' : 'WHERE'} ph.id = ?
    LIMIT 1
  `;
  const included = db.prepare(checkSql).get(...params, target.id);
  if (!included) { const err = new Error('Target filtered out'); err.code = 'NOT_FOUND'; throw err; }

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
      COALESCE(ph.date_time_original, ph.created_at) as taken_at
    FROM photos ph
    JOIN projects p ON p.id = ph.project_id
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
    nextCursor = Buffer.from(JSON.stringify({ taken_at: last.taken_at, id: last.id }), 'utf8').toString('base64');
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
      prevCursor = Buffer.from(JSON.stringify({ taken_at: prevRow.taken_at, id: prevRow.id }), 'utf8').toString('base64');
    }
  }

  const items = rows || [];
  const idxInItems = items.findIndex(r => r.id === target.id);
  const pageIndex = Math.floor(rank / capLimit);

  log.debug('locateAllPage', { project_folder, filename, name, rank, pageStart, pageIndex, count: items.length, idxInItems });
  return {
    items,
    position: rank,
    page_index: pageIndex,
    limit: capLimit,
    nextCursor,
    prevCursor,
    idx_in_items: idxInItems >= 0 ? idxInItems : null,
    target: { id: target.id, project_id: target.project_id, project_folder: project_folder, filename: target.filename, taken_at: target.taken_at },
  };
}
