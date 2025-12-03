/**
 * Optimized photosRepo.js - Main repository interface that delegates to specialized modules
 * 
 * This file has been refactored to improve maintainability by breaking down a large 1200+ line file
 * into focused, single-responsibility modules:
 * 
 * - photoCrud.js: Basic CRUD operations (get, upsert, update, delete)
 * - photoFiltering.js: Filtering and listing operations (listAll, listProjectFiltered)
 * - photoPagination.js: Pagination logic (locateProjectPage, locateAllPage, listPaged)
 * - photoPendingOps.js: Pending operations (deletes, mismatches)
 * - photoQueryBuilders.js: SQL WHERE clause construction utilities
 */

// Import specialized modules
const photoCrud = require('./photoCrud');
const photoFiltering = require('./photoFiltering');
const photoPagination = require('./photoPagination');
const photoPendingOps = require('./photoPendingOps');
const { ensureHashForPhoto, invalidateHash } = require('../publicAssetHashes');

const makeLogger = require('../../utils/logger2');
const log = makeLogger('photosRepo');

// ===== CRUD OPERATIONS =====
// Delegate to photoCrud module
const upsertPhoto = photoCrud.upsertPhoto;
const updateDerivativeStatus = photoCrud.updateDerivativeStatus;
const updateKeepFlags = photoCrud.updateKeepFlags;
const getById = photoCrud.getById;
const getByManifestId = photoCrud.getByManifestId;
const getByFilename = photoCrud.getByFilename;
const getByProjectAndFilename = photoCrud.getByProjectAndFilename;
const getByProjectAndBasename = photoCrud.getByProjectAndBasename;
const getGlobalByFilename = photoCrud.getGlobalByFilename;
const getGlobalByFilenameInsensitive = photoCrud.getGlobalByFilenameInsensitive;
const moveToProject = photoCrud.moveToProject;
const removeById = photoCrud.removeById;
const countByProject = photoCrud.countByProject;
const getPublicByFilename = photoCrud.getPublicByFilename;
const getPublicByBasename = photoCrud.getPublicByBasename;
const getAnyVisibilityByFilename = photoCrud.getAnyVisibilityByFilename;
const getAnyVisibilityByBasename = photoCrud.getAnyVisibilityByBasename;

function updateVisibility(id, visibility) {
  const before = (() => {
    try {
      return photoCrud.getById(id);
    } catch (err) {
      log.warn('updateVisibility_lookup_failed', { photo_id: id, error: err?.message });
      return null;
    }
  })();

  const updated = photoCrud.updateVisibility(id, visibility);

  try {
    const prevVisibility = before ? (before.visibility || 'private') : null;
    const nextVisibility = updated.visibility || 'private';
    if (prevVisibility !== nextVisibility) {
      if (nextVisibility === 'public') {
        ensureHashForPhoto(updated.id);
      } else {
        invalidateHash(updated.id);
      }
    }
  } catch (err) {
    log.warn('updateVisibility_hash_side_effect_failed', { photo_id: id, error: err?.message });
  }

  return updated;
}

// ===== FILTERING & LISTING =====
// Delegate to photoFiltering module
const listAll = photoFiltering.listAll;
const listProjectFiltered = photoFiltering.listProjectFiltered;
const listSharedLinkPhotos = photoFiltering.listSharedLinkPhotos;
const listAllKeys = photoFiltering.listAllKeys;

// ===== PAGINATION =====
// Delegate to photoPagination module
const locateProjectPage = photoPagination.locateProjectPage;
const locateAllPage = photoPagination.locateAllPage;
const listPaged = photoPagination.listPaged;

// ===== PENDING OPERATIONS =====
// Delegate to photoPendingOps module
const listPendingDeletesForProject = photoPendingOps.listPendingDeletesForProject;
const listPendingDeletesByProject = photoPendingOps.listPendingDeletesByProject;
const listPendingDeletePhotos = photoPendingOps.listPendingDeletePhotos;
const listKeepMismatchesForProject = photoPendingOps.listKeepMismatchesForProject;
const listKeepMismatchesByProject = photoPendingOps.listKeepMismatchesByProject;
const listKeepMismatchPhotos = photoPendingOps.listKeepMismatchPhotos;
const countMissingDerivativesForProject = photoPendingOps.countMissingDerivativesForProject;

module.exports = {
  // CRUD operations
  upsertPhoto,
  updateDerivativeStatus,
  updateKeepFlags,
  getById,
  getByManifestId,
  getByFilename,
  getByProjectAndFilename,
  getByProjectAndBasename,
  getGlobalByFilename,
  getGlobalByFilenameInsensitive,
  getPublicByFilename,
  getPublicByBasename,
  getAnyVisibilityByFilename,
  getAnyVisibilityByBasename,
  moveToProject,
  removeById,
  countByProject,
  updateVisibility,

  // Filtering & listing
  listAll,
  listProjectFiltered,
  listSharedLinkPhotos,
  listAllKeys,

  // Pagination
  locateProjectPage,
  locateAllPage,
  listPaged,

  // Pending operations
  listPendingDeletesForProject,
  listPendingDeletesByProject,
  listPendingDeletePhotos,
  listKeepMismatchesForProject,
  listKeepMismatchesByProject,
  listKeepMismatchPhotos,
  countMissingDerivativesForProject,
};
