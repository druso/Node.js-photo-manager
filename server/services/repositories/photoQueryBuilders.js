const makeLogger = require('../../utils/logger2');
const log = makeLogger('photoQueryBuilders');

/**
 * Build WHERE clause for project-scoped photo filtering
 * @param {Object} options - Filter options
 * @param {number} options.project_id - Project ID to filter by
 * @param {string} [options.date_from] - Start date filter
 * @param {string} [options.date_to] - End date filter  
 * @param {string} [options.file_type] - File type filter (jpg_only, raw_only, both, any)
 * @param {string} [options.keep_type] - Keep type filter (any_kept, jpg_only, raw_jpg, none, any)
 * @param {string} [options.orientation] - Orientation filter (vertical, horizontal, any)
 * @param {string} [options.tags] - Comma-separated tags filter
 * @returns {Object} { whereSql, params }
 */
function buildProjectPhotosWhere({ 
  project_id, 
  date_from = null, 
  date_to = null, 
  file_type = null, 
  keep_type = null, 
  orientation = null, 
  tags = null 
} = {}) {
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
      where.push(`ph.jpg_available = 1 AND ph.raw_available = 0`);
    } else if (file_type === 'raw_only') {
      where.push(`ph.raw_available = 1 AND ph.jpg_available = 0`);
    } else if (file_type === 'both') {
      where.push(`ph.jpg_available = 1 AND ph.raw_available = 1`);
    }
  }
  
  // Keep type filter
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
  
  // Orientation filter with EXIF rotation handling
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
  
  // Handle tags filter: comma-separated list where names without prefix are required, and names with leading '-' are exclusions
  if (tags && typeof tags === 'string') {
    const tagsList = tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tagsList.length > 0) {
      const includeTags = tagsList.filter(t => !t.startsWith('-')).map(t => t.trim());
      const excludeTags = tagsList.filter(t => t.startsWith('-')).map(t => t.substring(1).trim());
      
      // For include tags: photo must have ALL specified tags (AND logic)
      if (includeTags.length > 0) {
        includeTags.forEach(tag => {
          where.push(`EXISTS (
            SELECT 1 FROM photo_tags pt
            JOIN tags t ON t.id = pt.tag_id
            WHERE pt.photo_id = ph.id AND t.name = ?
          )`);
          params.push(tag);
        });
      }
      
      // For exclude tags: photo must have NONE of the specified tags (NOT ANY logic)
      if (excludeTags.length > 0) {
        const excludePlaceholders = excludeTags.map(() => '?').join(',');
        where.push(`NOT EXISTS (
          SELECT 1 FROM photo_tags pt
          JOIN tags t ON t.id = pt.tag_id
          WHERE pt.photo_id = ph.id AND t.name IN (${excludePlaceholders})
        )`);
        params.push(...excludeTags);
      }
    }
  }
  
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}

/**
 * Build WHERE clause for cross-project (All Photos) filtering
 * @param {Object} options - Filter options
 * @param {string} [options.date_from] - Start date filter
 * @param {string} [options.date_to] - End date filter
 * @param {string} [options.file_type] - File type filter
 * @param {string} [options.keep_type] - Keep type filter
 * @param {string} [options.orientation] - Orientation filter
 * @param {string} [options.cursor] - Forward pagination cursor
 * @param {string} [options.before_cursor] - Backward pagination cursor
 * @param {string} [options.tags] - Tags filter
 * @param {number} [options.project_id] - Optional project ID constraint
 * @returns {Object} { whereSql, params }
 */
function buildAllPhotosWhere({ 
  date_from = null, 
  date_to = null, 
  file_type = null, 
  keep_type = null, 
  orientation = null, 
  cursor = null, 
  before_cursor = null, 
  tags = null, 
  project_id = null 
} = {}) {
  const params = [];
  const where = [];
  
  // Exclude archived projects (wrap OR to preserve AND precedence with other filters)
  where.push(`(p.status IS NULL OR p.status != 'canceled')`);
  
  if (project_id != null) {
    where.push(`p.id = ?`);
    params.push(project_id);
  }
  
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
  
  // Handle tags filter: comma-separated list where names without prefix are required, and names with leading '-' are exclusions
  if (tags && typeof tags === 'string') {
    const tagsList = tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tagsList.length > 0) {
      const includeTags = tagsList.filter(t => !t.startsWith('-')).map(t => t.trim());
      const excludeTags = tagsList.filter(t => t.startsWith('-')).map(t => t.substring(1).trim());
      
      // For include tags: photo must have ALL specified tags (AND logic)
      if (includeTags.length > 0) {
        includeTags.forEach(tag => {
          where.push(`EXISTS (
            SELECT 1 FROM photo_tags pt
            JOIN tags t ON t.id = pt.tag_id
            WHERE pt.photo_id = ph.id AND t.name = ?
          )`);
          params.push(tag);
        });
      }
      
      // For exclude tags: photo must have NONE of the specified tags (NOT ANY logic)
      if (excludeTags.length > 0) {
        const excludePlaceholders = excludeTags.map(() => '?').join(',');
        where.push(`NOT EXISTS (
          SELECT 1 FROM photo_tags pt
          JOIN tags t ON t.id = pt.tag_id
          WHERE pt.photo_id = ph.id AND t.name IN (${excludePlaceholders})
        )`);
        params.push(...excludeTags);
      }
    }
  }
  
  // Note: before_cursor is handled separately in listAll() with flipped query approach
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}

/**
 * Parse a base64-encoded cursor into its components
 * @param {string} cursor - Base64 cursor string
 * @returns {Object} { taken_at, id } or { taken_at: null, id: null } if parsing fails
 */
function parseCursor(cursor) {
  try {
    let cur = String(cursor).trim();
    // Support URL-safe base64 and missing padding
    cur = cur.replace(/-/g, '+').replace(/_/g, '/');
    const pad = cur.length % 4;
    if (pad) cur = cur + '='.repeat(4 - pad);
    const json = Buffer.from(cur, 'base64').toString('utf8');
    const obj = JSON.parse(json);
    const taken_at = obj && obj.taken_at ? String(obj.taken_at) : null;
    const id = obj && Number.isFinite(Number(obj.id)) ? Number(obj.id) : null;
    return { taken_at, id };
  } catch (e) {
    log.warn('cursor_parse_failed', { cursor_sample: String(cursor).slice(0, 16), message: e?.message });
    return { taken_at: null, id: null };
  }
}

/**
 * Create a base64-encoded cursor from taken_at and id
 * @param {string} taken_at - Timestamp string
 * @param {number} id - Photo ID
 * @returns {string} Base64 cursor string
 */
function createCursor(taken_at, id) {
  return Buffer.from(JSON.stringify({ taken_at, id }), 'utf8').toString('base64');
}

module.exports = {
  buildProjectPhotosWhere,
  buildAllPhotosWhere,
  parseCursor,
  createCursor
};
