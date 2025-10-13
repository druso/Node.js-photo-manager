const express = require('express');
const makeLogger = require('../utils/logger2');
const log = makeLogger('publicLinks');
const publicLinksRepo = require('../services/repositories/publicLinksRepo');
const photosRepo = require('../services/repositories/photosRepo');
const { rateLimit } = require('../utils/rateLimit');

const router = express.Router();

// Rate limiting for public link operations
const createLinkRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10,
  message: 'Too many public link creations, please try again later.'
});

const regenerateKeyRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  message: 'Too many key regenerations, please try again later.'
});

// ===== ADMIN ENDPOINTS (require authentication via middleware) =====

// GET /api/public-links - List all public links
router.get('/', async (req, res) => {
  try {
    const links = publicLinksRepo.list();
    
    // Enrich with photo counts
    const enriched = links.map(link => ({
      ...link,
      photo_count: publicLinksRepo.getPhotoCount(link.id),
    }));
    
    res.json(enriched);
  } catch (err) {
    log.error('list_public_links_failed', { error: err?.message, stack: err?.stack });
    res.status(500).json({ error: 'Failed to list public links' });
  }
});

// POST /api/public-links - Create a new public link
router.post('/', createLinkRateLimit, async (req, res) => {
  try {
    const { title, description } = req.body || {};
    
    if (!title || String(title).trim() === '') {
      return res.status(400).json({ error: 'Title is required' });
    }
    
    const link = publicLinksRepo.create({
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
    });
    
    log.info('public_link_created', { link_id: link.id, title: link.title });
    res.status(201).json(link);
  } catch (err) {
    log.error('create_public_link_failed', { error: err?.message, stack: err?.stack });
    res.status(500).json({ error: 'Failed to create public link' });
  }
});

// GET /api/public-links/:id - Get a specific public link
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const link = publicLinksRepo.getById(id);
    
    if (!link) {
      return res.status(404).json({ error: 'Public link not found' });
    }
    
    const photo_count = publicLinksRepo.getPhotoCount(link.id);
    res.json({ ...link, photo_count });
  } catch (err) {
    log.error('get_public_link_failed', { link_id: req.params.id, error: err?.message });
    res.status(500).json({ error: 'Failed to get public link' });
  }
});

// PATCH /api/public-links/:id - Update title/description
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description } = req.body || {};
    
    const existing = publicLinksRepo.getById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Public link not found' });
    }
    
    const updates = {};
    if (title !== undefined) {
      if (String(title).trim() === '') {
        return res.status(400).json({ error: 'Title cannot be empty' });
      }
      updates.title = String(title).trim();
    }
    if (description !== undefined) {
      updates.description = description ? String(description).trim() : null;
    }
    
    const updated = publicLinksRepo.update(id, updates);
    log.info('public_link_updated', { link_id: id, updates });
    res.json(updated);
  } catch (err) {
    log.error('update_public_link_failed', { link_id: req.params.id, error: err?.message });
    res.status(500).json({ error: 'Failed to update public link' });
  }
});

// POST /api/public-links/:id/regenerate - Regenerate hashed key
router.post('/:id/regenerate', regenerateKeyRateLimit, async (req, res) => {
  try {
    const { id } = req.params;
    
    const existing = publicLinksRepo.getById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Public link not found' });
    }
    
    const updated = publicLinksRepo.regenerateKey(id);
    log.info('public_link_key_regenerated', { link_id: id, old_key: existing.hashed_key, new_key: updated.hashed_key });
    res.json(updated);
  } catch (err) {
    log.error('regenerate_key_failed', { link_id: req.params.id, error: err?.message });
    res.status(500).json({ error: 'Failed to regenerate key' });
  }
});

// DELETE /api/public-links/:id - Delete a public link
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const existing = publicLinksRepo.getById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Public link not found' });
    }
    
    publicLinksRepo.remove(id);
    log.info('public_link_deleted', { link_id: id, title: existing.title });
    res.status(204).send();
  } catch (err) {
    log.error('delete_public_link_failed', { link_id: req.params.id, error: err?.message });
    res.status(500).json({ error: 'Failed to delete public link' });
  }
});

// POST /api/public-links/:id/photos - Associate photos with a public link
router.post('/:id/photos', async (req, res) => {
  try {
    const { id } = req.params;
    const { photo_ids } = req.body || {};
    
    const existing = publicLinksRepo.getById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Public link not found' });
    }
    
    if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
      return res.status(400).json({ error: 'photo_ids array is required' });
    }
    
    // Validate all photo IDs are integers
    const validIds = photo_ids.filter(id => Number.isInteger(id) && id > 0);
    if (validIds.length !== photo_ids.length) {
      return res.status(400).json({ error: 'All photo_ids must be valid integers' });
    }
    
    // Associate photos with the link
    publicLinksRepo.associatePhotos(id, validIds);
    
    // Automatically set all photos to public visibility
    let visibilityUpdated = 0;
    for (const photoId of validIds) {
      const photo = photosRepo.getById(photoId);
      if (photo && photo.visibility !== 'public') {
        photosRepo.updateVisibility(photoId, 'public');
        visibilityUpdated++;
      }
    }
    
    // Generate hashes for all photos (now all are public)
    const publicAssetHashes = require('../services/publicAssetHashes');
    for (const photoId of validIds) {
      await publicAssetHashes.ensureHashForPhoto(photoId);
    }
    
    log.info('photos_associated_to_link', { 
      link_id: id, 
      photo_count: validIds.length,
      visibility_updated: visibilityUpdated,
      hashes_generated: validIds.length
    });
    
    res.json({ 
      success: true, 
      link_id: id,
      photos_added: validIds.length,
      visibility_updated: visibilityUpdated,
      hashes_generated: validIds.length
    });
  } catch (err) {
    log.error('associate_photos_failed', { link_id: req.params.id, error: err?.message });
    res.status(500).json({ error: 'Failed to associate photos' });
  }
});

// DELETE /api/public-links/:id/photos/:photoId - Remove a photo from a public link
router.delete('/:id/photos/:photoId', async (req, res) => {
  try {
    const { id, photoId } = req.params;
    const photoIdNum = Number(photoId);
    
    if (!Number.isInteger(photoIdNum) || photoIdNum <= 0) {
      return res.status(400).json({ error: 'Invalid photo ID' });
    }
    
    const existing = publicLinksRepo.getById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Public link not found' });
    }
    
    publicLinksRepo.removePhoto(id, photoIdNum);
    log.info('photo_removed_from_link', { link_id: id, photo_id: photoIdNum });
    
    res.status(204).send();
  } catch (err) {
    log.error('remove_photo_failed', { link_id: req.params.id, photo_id: req.params.photoId, error: err?.message });
    res.status(500).json({ error: 'Failed to remove photo' });
  }
});

// GET /api/public-links/:id/photos - Get photos for a public link (admin view, includes private)
router.get('/:id/photos', async (req, res) => {
  try {
    const { id } = req.params;
    
    const existing = publicLinksRepo.getById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Public link not found' });
    }
    
    const photoIds = publicLinksRepo.getPhotoIdsForLink(id);
    const photos = photoIds.map(photoId => photosRepo.getById(photoId)).filter(Boolean);
    
    res.json({ photos, total: photos.length });
  } catch (err) {
    log.error('get_link_photos_failed', { link_id: req.params.id, error: err?.message });
    res.status(500).json({ error: 'Failed to get photos' });
  }
});

// GET /api/photos/:photoId/public-links - Get all public links for a photo
router.get('/photos/:photoId/links', async (req, res) => {
  try {
    const photoId = Number(req.params.photoId);
    
    if (!Number.isInteger(photoId) || photoId <= 0) {
      return res.status(400).json({ error: 'Invalid photo ID' });
    }
    
    const links = publicLinksRepo.getLinksForPhoto(photoId);
    res.json(links);
  } catch (err) {
    log.error('get_photo_links_failed', { photo_id: req.params.photoId, error: err?.message });
    res.status(500).json({ error: 'Failed to get photo links' });
  }
});

module.exports = router;
