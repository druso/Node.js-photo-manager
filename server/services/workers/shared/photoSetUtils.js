/**
 * Shared utilities for scope-agnostic worker processing
 * 
 * These utilities help workers process jobs that may span multiple projects
 * or operate on arbitrary photo sets without project context.
 */

const projectsRepo = require('../../repositories/projectsRepo');
const photosRepo = require('../../repositories/photosRepo');

/**
 * Groups job items by project for filesystem operations
 * 
 * @param {Array} items - Job items with photo_id or filename
 * @returns {Promise<Array>} Array of { project, photos: [...] } objects
 */
async function groupItemsByProject(items) {
  const groups = new Map();
  
  for (const item of items) {
    let photo = null;
    
    // Resolve photo from photo_id or filename
    if (item.photo_id) {
      photo = photosRepo.getById(item.photo_id);
    } else if (item.filename) {
      // If only filename is provided, we need to search across projects
      // This is less efficient but supports cross-project operations
      const allPhotos = photosRepo.listAll({ filename: item.filename, limit: 1 });
      photo = allPhotos.items && allPhotos.items[0];
    }
    
    if (!photo) continue;
    
    // Get project for this photo
    const project = projectsRepo.getById(photo.project_id);
    if (!project) continue;
    
    // Group by project_id
    if (!groups.has(project.id)) {
      groups.set(project.id, {
        project,
        photos: []
      });
    }
    
    groups.get(project.id).photos.push({
      ...photo,
      job_item_id: item.id,
      job_item_status: item.status
    });
  }
  
  return Array.from(groups.values());
}

/**
 * Resolves a job's target photos based on scope and payload
 * 
 * @param {Object} job - Job object with scope, project_id, and payload_json
 * @returns {Promise<Array>} Array of photo objects with project context
 */
async function resolveJobTargets(job) {
  const payload = job.payload_json || {};
  const results = [];
  
  switch (job.scope) {
    case 'project':
      // Traditional project-scoped job
      if (!job.project_id) {
        throw new Error('Project-scoped job missing project_id');
      }
      const project = projectsRepo.getById(job.project_id);
      if (!project) {
        throw new Error(`Project ${job.project_id} not found`);
      }
      
      // Get all photos or filtered subset based on payload
      const photos = payload.photo_ids
        ? payload.photo_ids.map(id => photosRepo.getById(id)).filter(Boolean)
        : photosRepo.listPaged({ project_id: job.project_id, limit: 100000, sort: 'filename', dir: 'ASC' }).items;
      
      return photos.map(photo => ({
        ...photo,
        project
      }));
    
    case 'photo_set':
      // Arbitrary photo set (may span multiple projects)
      if (payload.photo_ids && Array.isArray(payload.photo_ids)) {
        for (const photoId of payload.photo_ids) {
          const photo = photosRepo.getById(photoId);
          if (photo) {
            const project = projectsRepo.getById(photo.project_id);
            if (project) {
              results.push({ ...photo, project });
            }
          }
        }
      }
      return results;
    
    case 'global':
      // Global scope - typically used for maintenance tasks
      // Return all active projects for processing
      const projects = projectsRepo.list().filter(p => p.status !== 'canceled');
      return projects.map(project => ({ project, scope: 'global' }));
    
    default:
      throw new Error(`Unknown job scope: ${job.scope}`);
  }
}

/**
 * Validates that a job's payload doesn't exceed size limits
 * 
 * @param {Object} payload - Job payload
 * @param {number} maxItems - Maximum allowed items (default: 2000)
 * @returns {Object} { valid: boolean, count: number, message?: string }
 */
function validatePayloadSize(payload, maxItems = 2000) {
  if (!payload) {
    return { valid: true, count: 0 };
  }
  
  const photoIds = payload.photo_ids || [];
  const count = photoIds.length;
  
  if (count > maxItems) {
    return {
      valid: false,
      count,
      message: `Payload contains ${count} items, exceeding maximum of ${maxItems}`
    };
  }
  
  return { valid: true, count };
}

/**
 * Chunks an array of photo IDs into batches for processing
 * 
 * @param {Array} photoIds - Array of photo IDs
 * @param {number} chunkSize - Size of each chunk (default: 2000)
 * @returns {Array<Array>} Array of chunked photo ID arrays
 */
function chunkPhotoIds(photoIds, chunkSize = 2000) {
  const chunks = [];
  for (let i = 0; i < photoIds.length; i += chunkSize) {
    chunks.push(photoIds.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Gets project path for a given project, handling null/undefined gracefully
 * 
 * @param {Object} project - Project object
 * @returns {string|null} Absolute path to project directory or null
 */
function getProjectPath(project) {
  if (!project || !project.project_folder) return null;
  // Use centralized function from fsUtils
  const { getProjectPath: getPath } = require('../../fsUtils');
  return getPath(project);
}

module.exports = {
  groupItemsByProject,
  resolveJobTargets,
  validatePayloadSize,
  chunkPhotoIds,
  getProjectPath
};
