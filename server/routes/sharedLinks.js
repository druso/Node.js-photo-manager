const express = require('express');
const makeLogger = require('../utils/logger2');
const log = makeLogger('sharedLinks');
const publicLinksRepo = require('../services/repositories/publicLinksRepo');
const photosRepo = require('../services/repositories/photosRepo');
const { rateLimit } = require('../utils/rateLimit');
const { attachAdminToRequest } = require('../middleware/authenticateAdmin');

const router = express.Router();

// Rate limiting for public access (more restrictive)
const sharedLinkRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  message: 'Too many requests, please try again later.'
});

// GET /shared/api/:hashedKey/admin - Get shared link with all photos (admin endpoint)
// IMPORTANT: This route must be registered BEFORE the generic /:hashedKey route
router.get('/:hashedKey/admin', async (req, res) => {
  try {
    const { hashedKey } = req.params;

    // Verify admin authentication
    const attachResult = attachAdminToRequest(req);
    if (!attachResult?.attached) {
      log.warn('admin_endpoint_unauthorized', {
        hashed_key: hashedKey,
        reason: attachResult?.reason || 'no_auth'
      });
      return res.status(401).json({ error: 'Admin authentication required' });
    }

    // Validate hashed key format (base64url, 32 chars)
    if (!hashedKey || typeof hashedKey !== 'string' || hashedKey.length !== 32) {
      log.warn('invalid_shared_key_format_admin', { key_length: hashedKey?.length });
      return res.status(404).json({ error: 'Shared link not found' });
    }

    const link = publicLinksRepo.getByHashedKey(hashedKey);

    if (!link) {
      log.info('shared_link_not_found_admin', { hashed_key: hashedKey });
      return res.status(404).json({ error: 'Shared link not found' });
    }

    // Get pagination params
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const cursor = req.query.cursor || null;
    const before_cursor = req.query.before_cursor || null;

    // Fetch ALL photos (public + private) for admin
    const result = photosRepo.listSharedLinkPhotos({
      public_link_id: link.id,
      limit,
      cursor,
      before_cursor,
      includePrivate: true, // KEY DIFFERENCE: admins see all photos
    });

    log.info('shared_link_accessed_admin', {
      link_id: link.id,
      title: link.title,
      photo_count: result.total,
      has_cursor: !!cursor,
      has_before_cursor: !!before_cursor,
      admin_id: req.admin?.id,
    });

    res.json({
      id: link.id,
      title: link.title,
      description: link.description,
      photos: result.items,
      total: result.total,
      next_cursor: result.nextCursor,
      prev_cursor: result.prevCursor,
    });
  } catch (err) {
    log.error('get_shared_link_admin_failed', {
      hashed_key: req.params.hashedKey,
      error: err?.message,
      stack: err?.stack
    });
    res.status(500).json({ error: 'Failed to load shared link' });
  }
});

// GET /shared/api/:hashedKey - Get shared link metadata and photos (public endpoint)
router.get('/:hashedKey', sharedLinkRateLimit, async (req, res) => {
  try {
    const { hashedKey } = req.params;

    // Validate hashed key format (base64url, 32 chars)
    if (!hashedKey || typeof hashedKey !== 'string' || hashedKey.length !== 32) {
      log.warn('invalid_shared_key_format', { key_length: hashedKey?.length });
      return res.status(404).json({ error: 'Shared link not found' });
    }

    const link = publicLinksRepo.getByHashedKey(hashedKey);

    if (!link) {
      log.info('shared_link_not_found', { hashed_key: hashedKey });
      return res.status(404).json({ error: 'Shared link not found' });
    }

    // Get pagination params
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const cursor = req.query.cursor || null;
    const before_cursor = req.query.before_cursor || null;

    // Fetch public photos only
    const result = photosRepo.listSharedLinkPhotos({
      public_link_id: link.id,
      limit,
      cursor,
      before_cursor,
    });

    log.info('shared_link_accessed', {
      link_id: link.id,
      title: link.title,
      photo_count: result.total,
      has_cursor: !!cursor,
      has_before_cursor: !!before_cursor,
    });

    res.json({
      id: link.id,
      title: link.title,
      description: link.description,
      photos: result.items,
      total: result.total,
      next_cursor: result.nextCursor,
      prev_cursor: result.prevCursor,
    });
  } catch (err) {
    log.error('get_shared_link_failed', {
      hashed_key: req.params.hashedKey,
      error: err?.message,
      stack: err?.stack
    });
    res.status(500).json({ error: 'Failed to load shared link' });
  }
});

// GET /shared/api/:hashedKey/photo/:photoId - Get specific photo in shared link context
router.get('/:hashedKey/photo/:photoId', sharedLinkRateLimit, async (req, res) => {
  try {
    const { hashedKey, photoId } = req.params;
    const photoIdNum = Number(photoId);

    if (!Number.isInteger(photoIdNum) || photoIdNum <= 0) {
      return res.status(400).json({ error: 'Invalid photo ID' });
    }

    const link = publicLinksRepo.getByHashedKey(hashedKey);
    if (!link) {
      return res.status(404).json({ error: 'Shared link not found' });
    }

    const photo = photosRepo.getById(photoIdNum);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    // Verify photo is public and in this link
    if (photo.visibility !== 'public') {
      return res.status(404).json({ error: 'Photo not found' });
    }

    const photoIds = publicLinksRepo.getPhotoIdsForLink(link.id);
    if (!photoIds.includes(photoIdNum)) {
      return res.status(404).json({ error: 'Photo not in this shared link' });
    }

    res.json(photo);
  } catch (err) {
    log.error('get_shared_photo_failed', {
      hashed_key: req.params.hashedKey,
      photo_id: req.params.photoId,
      error: err?.message
    });
    res.status(500).json({ error: 'Failed to load photo' });
  }
});

module.exports = router;
