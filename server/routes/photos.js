const express = require('express');
const makeLogger = require('../utils/logger2');
const log = makeLogger('photos');
const router = express.Router();
const { rateLimit } = require('../utils/rateLimit');

const photosRepo = require('../services/repositories/photosRepo');
const photoTagsRepo = require('../services/repositories/photoTagsRepo');
const projectsRepo = require('../services/repositories/projectsRepo');
const { normalizeVisibilityParam } = require('../utils/visibility');

// Apply rate limiting (60 requests per minute per IP)
const apiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // limit each IP to 60 requests per windowMs
  message: 'Too many requests, please try again later.'
});

// GET /api/photos/locate-page - Locate a specific photo in All Photos and return its page
// Query:
//   - project_folder: required, project folder name
//   - filename: full filename (with extension) or name (basename without extension)
//   - limit: optional, default 100, max 300
//   - date_from, date_to, file_type, keep_type, orientation: same as /api/photos
router.get('/photos/locate-page', apiRateLimit, async (req, res) => {
  try {
    // Prevent caching to ensure fresh pagination data
    
    const q = req.query || {};
    const { project_folder, filename, name, limit, date_from, date_to, file_type, keep_type, orientation } = q;
    const includeTags = q.include === 'tags';
    const tags = typeof q.tags === 'string' && q.tags.length ? q.tags : null; // comma-separated list of tags, with optional - prefix for exclusion
    const { value: visibility, error: visibilityError } = normalizeVisibilityParam(q.visibility);
    if (visibilityError) {
      return res.status(400).json({ error: visibilityError });
    }

    if (!filename && !name) {
      return res.status(400).json({ error: 'filename or name is required' });
    }

    log.debug('locate_page_req', {
      project_folder,
      filename,
      name,
      limit,
      date_from,
      date_to,
      file_type,
      keep_type,
      orientation,
      tags: tags || undefined,
      visibility: visibility || undefined,
    });

    // Map items to the same format as the /api/photos endpoint
    const items = (result.items || []).map((r) => {
      let metadata;
      try {
        metadata = r.meta_json ? JSON.parse(r.meta_json) : undefined;
      } catch (_) {
        metadata = undefined;
      }

      return {
        id: r.id,
        project_id: r.project_id,
        manifest_id: r.manifest_id,
        filename: r.filename,
        basename: r.basename || undefined,
        ext: r.ext || undefined,
        created_at: r.created_at,
        updated_at: r.updated_at,
        date_time_original: r.date_time_original || undefined,
        jpg_available: !!r.jpg_available,
        raw_available: !!r.raw_available,
        other_available: !!r.other_available,
        keep_jpg: !!r.keep_jpg,
        keep_raw: !!r.keep_raw,
        thumbnail_status: r.thumbnail_status || undefined,
        preview_status: r.preview_status || undefined,
        orientation: r.orientation ?? undefined,
        metadata,
        visibility: r.visibility || 'private',
        public_hash: r.public_hash || null,
        public_hash_expires_at: r.public_hash_expires_at || null,
      };
    });
    
    // Optionally include tags when requested
    if (includeTags && items.length > 0) {
      try {
        const photoIds = items.map((item) => item.id);
        const tagsMap = photoTagsRepo.listTagsForPhotos(photoIds);

        items.forEach((item) => {
          item.tags = tagsMap[item.id] || [];
        });

        log.debug('locate_page_tags_included', { count: photoIds.length });
      } catch (tagErr) {
        log.warn('locate_page_tags_fetch_failed', { error: tagErr?.message });
      }
    }
    
    log.debug('locate_page_resp', {
      count: items.length,
      position: result.position,
      page_index: result.page_index,
      idx_in_items: result.idx_in_items,
      target_id: result.target?.id,
    });
    
    // Return response in the same format as /api/photos but with additional metadata
    res.json({
      items,
      position: result.position,
      page_index: result.page_index,
      limit: result.limit,
      next_cursor: result.nextCursor || null,
      prev_cursor: result.prevCursor || null,
      idx_in_items: result.idx_in_items,
      target: result.target,
      date_from: date_from || null,
      date_to: date_to || null,
    });
    
  } catch (err) {
    log.error('locate_page_failed', { 
      error: err && err.message, 
      code: err && err.code,
      stack: err && err.stack 
    });
    
    // Map specific error codes to appropriate HTTP status codes
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message || 'Photo not found or filtered out' });
    } else if (err.code === 'AMBIGUOUS') {
      return res.status(409).json({ error: err.message || 'Multiple photos match the provided name' });
    } else if (err.code === 'INVALID') {
      return res.status(400).json({ error: err.message || 'Invalid request parameters' });
    }
    
    // Default error response
    res.status(500).json({ 
      error: 'Failed to locate photo',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// GET /api/photos - cross-project photos (All Photos)
// Query:
//   - limit: default 200, max 300
//   - cursor: base64 of { taken_at, id }
//   - date_from, date_to: ISO strings (operate on taken_at := coalesce(date_time_original, created_at))
// GET /api/photos - cross-project photos (All Photos)
router.get('/photos', async (req, res) => {
  try {
    // This endpoint is cursor-paginated and must not be cached; stale caches can freeze pagination.
    res.set('Cache-Control', 'no-store');
    const q = req.query || {};

    // Limit handling: default 200, cap 300
    const limitRaw = q.limit != null ? Number(q.limit) : 200;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 300) : 200;

    const cursor = typeof q.cursor === 'string' && q.cursor.length ? q.cursor : null;
    const before_cursor = typeof q.before_cursor === 'string' && q.before_cursor.length ? q.before_cursor : null;
    const project_folder = typeof q.project_folder === 'string' && q.project_folder.length ? q.project_folder : null;
    const date_from = typeof q.date_from === 'string' && q.date_from.length ? q.date_from : null;
    const date_to = typeof q.date_to === 'string' && q.date_to.length ? q.date_to : null;
    const file_type = typeof q.file_type === 'string' && q.file_type.length ? q.file_type : null; // any | jpg_only | raw_only | both
    const keep_type = typeof q.keep_type === 'string' && q.keep_type.length ? q.keep_type : null; // any | any_kept | jpg_only | raw_jpg | none
    const orientation = typeof q.orientation === 'string' && q.orientation.length ? q.orientation : null; // any | vertical | horizontal
    const includeTags = q.include === 'tags';
    const tags = typeof q.tags === 'string' && q.tags.length ? q.tags : null; // comma-separated list of tags, with optional - prefix for exclusion
    
    // Calculate total count directly
    let totalCount = 0;
    try {
      const db = require('../services/db').getDb();
      const countResult = db.prepare('SELECT COUNT(*) as c FROM photos').get();
      totalCount = countResult ? countResult.c : 0;
      console.log('DEBUG: Total count =', totalCount);
    } catch (err) {
      console.error('ERROR: Failed to get total count', err);
    }

    log.debug('all_photos_req', {
      limit,
      cursor_len: cursor ? String(cursor).length : 0,
      cursor_sample: cursor ? String(cursor).slice(0, 16) : undefined,
      date_from,
      date_to,
    });
    let projectId = null;
    if (project_folder) {
      const project = projectsRepo.getByFolder(project_folder);
      if (!project || project.status === 'canceled') {
        return res.json({ items: [], next_cursor: null, prev_cursor: null, total: 0, unfiltered_total: 0, limit, date_from, date_to });
      }
      projectId = project.id;
    }

    const { value: visibilityFilter, error: visibilityError } = normalizeVisibilityParam(q.visibility);
    if (visibilityError) {
      return res.status(400).json({ error: visibilityError });
    }

    const page = photosRepo.listAll({ limit, cursor, before_cursor, date_from, date_to, file_type, keep_type, orientation, tags, project_id: projectId, visibility: visibilityFilter });
    const items = (page.items || []).map((r) => {
      let metadata;
      try {
        metadata = r.meta_json ? JSON.parse(r.meta_json) : undefined;
      } catch (_) {
        metadata = undefined;
      }

      return {
        id: r.id,
        project_id: r.project_id,
        project_folder: r.project_folder,
        project_name: r.project_name,
        filename: r.filename,
        basename: r.basename || undefined,
        ext: r.ext || undefined,
        created_at: r.created_at,
        updated_at: r.updated_at,
        date_time_original: r.date_time_original || undefined,
        taken_at: r.taken_at,
        jpg_available: !!r.jpg_available,
        raw_available: !!r.raw_available,
        other_available: !!r.other_available,
        keep_jpg: !!r.keep_jpg,
        keep_raw: !!r.keep_raw,
        thumbnail_status: r.thumbnail_status || undefined,
        preview_status: r.preview_status || undefined,
        orientation: r.orientation ?? undefined,
        metadata,
        visibility: r.visibility || 'private',
      };
    });
    
    // Optionally include tags when requested
    if (includeTags && items.length > 0) {
      try {
        // Fetch tags for all photos in the page in a single efficient query
        const photoIds = items.map(item => item.id);
        const tagsMap = photoTagsRepo.listTagsForPhotos(photoIds);
        
        // Add tags to each item
        items.forEach(item => {
          item.tags = tagsMap[item.id] || [];
        });
        
        log.debug('all_photos_tags_included', { count: photoIds.length });
      } catch (tagErr) {
        log.warn('all_photos_tags_fetch_failed', { error: tagErr?.message });
        // Continue without tags rather than failing the whole request
      }
    }

    log.debug('all_photos_resp', {
      count: items.length,
      first_id: items[0]?.id,
      first_taken_at: items[0]?.taken_at,
      last_id: items[items.length - 1]?.id,
      last_taken_at: items[items.length - 1]?.taken_at,
      next_cursor_len: page.nextCursor ? String(page.nextCursor).length : 0,
      total: page.total,
      page_keys: Object.keys(page),
    });
    // Simple response with real SQL totals and ensuring prevCursor is passed correctly
    res.json({
      items, 
      next_cursor: page.nextCursor, 
      prev_cursor: page.prevCursor, 
      total: page.total, 
      unfiltered_total: page.unfiltered_total,
      limit, 
      date_from, 
      date_to
    });
  } catch (err) {
    log.error('all_photos_failed', { error: err && err.message, stack: err && err.stack });
    res.status(500).json({ error: 'Failed to list photos' });
  }
});

module.exports = router;
