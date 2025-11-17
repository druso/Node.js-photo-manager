const crypto = require('crypto');
const makeLogger = require('../utils/logger2');
const { getConfig } = require('./config');
const photoPublicHashesRepo = require('./repositories/photoPublicHashesRepo');

const log = makeLogger('publicAssetHashes');

let nowProvider = () => new Date();

function readSettings() {
  try {
    const cfg = getConfig() || {};
    const section = cfg.public_assets || {};
    const rotationDays = Number(process.env.PUBLIC_HASH_ROTATION_DAYS || section.hash_rotation_days || 21);
    const ttlDays = Number(process.env.PUBLIC_HASH_TTL_DAYS || section.hash_ttl_days || 28);
    return {
      rotationDays: Number.isFinite(rotationDays) && rotationDays > 0 ? rotationDays : 21,
      ttlDays: Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 28,
    };
  } catch (err) {
    log.warn('read_settings_failed', { error: err.message, stack: err.stack });
    return { rotationDays: 21, ttlDays: 28 };
  }
}

function now() {
  return nowProvider();
}

function addDays(date, days) {
  const ms = Number(days) * 24 * 60 * 60 * 1000;
  return new Date(date.getTime() + ms);
}

function generateHash() {
  const buf = crypto.randomBytes(24).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
  return buf.slice(0, 40);
}

function isExpired(record, reference = now()) {
  if (!record || !record.expires_at) return true;
  try {
    return new Date(record.expires_at).getTime() <= reference.getTime();
  } catch (_) {
    return true;
  }
}

function ensureHashForPhoto(photoId, { force = false } = {}) {
  if (!photoId) {
    throw new Error('ensureHashForPhoto requires photoId');
  }
  const settings = readSettings();
  const existing = photoPublicHashesRepo.getByPhotoId(photoId);
  if (!force && existing && !isExpired(existing)) {
    return existing;
  }
  const rotatedAt = now();
  const expiresAt = addDays(rotatedAt, settings.ttlDays);
  const hash = generateHash();
  photoPublicHashesRepo.upsertHash({
    photo_id: photoId,
    hash,
    rotated_at: rotatedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
  return {
    photo_id: photoId,
    hash,
    rotated_at: rotatedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
}

function getActiveHash(photoId) {
  if (!photoId) return null;
  const record = photoPublicHashesRepo.getByPhotoId(photoId);
  if (record && !isExpired(record)) {
    return record;
  }
  return null;
}

function validateHash(photoId, providedHash) {
  if (!photoId) {
    return { ok: false, reason: 'invalid_photo' };
  }
  if (!providedHash) {
    return { ok: false, reason: 'missing' };
  }
  const record = photoPublicHashesRepo.getByPhotoId(photoId);
  if (!record) {
    return { ok: false, reason: 'missing' };
  }
  if (isExpired(record)) {
    return { ok: false, reason: 'expired', record };
  }
  if (record.hash !== providedHash) {
    return { ok: false, reason: 'mismatch', record };
  }
  return { ok: true, record };
}

function clearHashForPhoto(photoId) {
  if (!photoId) return;
  photoPublicHashesRepo.deleteForPhoto(photoId);
}

function invalidateHash(photoId) {
  if (!photoId) return;
  clearHashForPhoto(photoId);
}

function rotateDueHashes(reference = now()) {
  try {
    const cutoffIso = reference.toISOString();
    const expiring = photoPublicHashesRepo.listExpiring(cutoffIso) || [];
    let rotated = 0;
    for (const record of expiring) {
      ensureHashForPhoto(record.photo_id, { force: true });
      rotated += 1;
    }
    if (rotated > 0) {
      log.info('hashes_rotated', { count: rotated });
    }
    return rotated;
  } catch (err) {
    log.warn('rotate_due_hashes_failed', { error: err.message, stack: err.stack });
    return 0;
  }
}

module.exports = {
  ensureHashForPhoto,
  getActiveHash,
  validateHash,
  clearHashForPhoto,
  invalidateHash,
  rotateDueHashes,
  __setNowProvider(fn) {
    nowProvider = typeof fn === 'function' ? fn : () => new Date();
  },
};
