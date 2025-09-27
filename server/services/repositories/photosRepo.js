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
const getGlobalByFilename = photoCrud.getGlobalByFilename;
const moveToProject = photoCrud.moveToProject;
const removeById = photoCrud.removeById;
const countByProject = photoCrud.countByProject;

// ===== FILTERING & LISTING =====
// Delegate to photoFiltering module
const listAll = photoFiltering.listAll;
const listProjectFiltered = photoFiltering.listProjectFiltered;

// ===== PAGINATION =====
// Delegate to photoPagination module
const locateProjectPage = photoPagination.locateProjectPage;
const locateAllPage = photoPagination.locateAllPage;
const listPaged = photoPagination.listPaged;

// ===== PENDING OPERATIONS =====
// Delegate to photoPendingOps module
const listPendingDeletesForProject = photoPendingOps.listPendingDeletesForProject;
const listPendingDeletesByProject = photoPendingOps.listPendingDeletesByProject;
const listKeepMismatchesForProject = photoPendingOps.listKeepMismatchesForProject;
const listKeepMismatchesByProject = photoPendingOps.listKeepMismatchesByProject;

module.exports = {
  // CRUD operations
  upsertPhoto,
  updateDerivativeStatus,
  updateKeepFlags,
  getById,
  getByManifestId,
  getByFilename,
  getByProjectAndFilename,
  getGlobalByFilename,
  moveToProject,
  removeById,
  countByProject,
  
  // Filtering & listing
  listAll,
  listProjectFiltered,
  
  // Pagination
  locateProjectPage,
  locateAllPage,
  listPaged,
  
  // Pending operations
  listPendingDeletesForProject,
  listPendingDeletesByProject,
  listKeepMismatchesForProject,
  listKeepMismatchesByProject,
};
