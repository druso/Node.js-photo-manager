const makeLogger = require('../utils/logger2');
const projectsRepo = require('../services/repositories/projectsRepo');
const photosRepo = require('../services/repositories/photosRepo');
const tasksOrchestrator = require('../services/tasksOrchestrator');

const log = makeLogger('projectCommitHandlers');

function toBoolean(val) {
  return !!val;
}

function ensureArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function gatherSelectors(body = {}) {
  const selectors = [];
  const add = (val) => {
    if (val == null) return;
    if (Array.isArray(val)) {
      val.forEach(add);
    } else if (typeof val === 'string' || typeof val === 'number') {
      const trimmed = String(val).trim();
      if (trimmed) selectors.push(trimmed);
    }
  };
  add(body.project);
  add(body.projects);
  add(body.project_folder);
  add(body.project_folders);
  add(body.project_id);
  add(body.project_ids);
  return selectors;
}

function resolveProject(selector) {
  if (selector == null) return null;
  const str = String(selector).trim();
  if (!str) return null;

  // Try folder match first
  const byFolder = projectsRepo.getByFolder(str);
  if (byFolder) return byFolder;

  // Try numeric id (plain or prefixed with 'p')
  const idMatch = str.match(/^p?(\d+)$/i);
  if (idMatch) {
    const byId = projectsRepo.getById(Number(idMatch[1]));
    if (byId) return byId;
  }

  return null;
}

function commitChanges(req, res) {
  try {
    const folderParam = req.params && req.params.folder;
    const scope = req.routeContext && req.routeContext.scope ? req.routeContext.scope : (folderParam ? 'project' : 'global');
    const selectors = gatherSelectors(req.body);
    const requestedProjects = new Map();
    const missingSelectors = [];

    if (folderParam) {
      const project = projectsRepo.getByFolder(folderParam);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      requestedProjects.set(project.id, project);
    }

    if (!folderParam && selectors.length) {
      for (const selector of selectors) {
        const project = resolveProject(selector);
        if (!project) {
          missingSelectors.push(selector);
          continue;
        }
        requestedProjects.set(project.id, project);
      }
    }

    const projectIdsFilter = requestedProjects.size ? Array.from(requestedProjects.keys()) : null;

    const pendingPhotos = photosRepo.listPendingDeletePhotos({ projectIds: projectIdsFilter });

    if (!pendingPhotos.length) {
      return res.json({
        queued_projects: 0,
        projects: [],
        missing: missingSelectors.length ? missingSelectors : undefined,
        message: 'No pending deletions to commit',
      });
    }

    const groupedByProject = new Map();
    const ensureProject = (projectId) => {
      if (!groupedByProject.has(projectId)) {
        let project = requestedProjects.get(projectId);
        if (!project) {
          project = projectsRepo.getById(projectId);
          if (!project || project.status === 'canceled') {
            return null;
          }
        }
        groupedByProject.set(projectId, {
          project,
          filenames: new Set(),
          photoIds: new Set(),
          photoNamesById: new Map(),
          pending_jpg: 0,
          pending_raw: 0,
        });
      }
      return groupedByProject.get(projectId);
    };

    for (const row of pendingPhotos) {
      const group = ensureProject(row.project_id);
      if (!group) continue;
      group.filenames.add(String(row.filename));
      group.photoIds.add(Number(row.id));
      group.photoNamesById.set(Number(row.id), String(row.filename));
      if (row.jpg_available && row.keep_jpg === 0) group.pending_jpg++;
      if (row.raw_available && row.keep_raw === 0) group.pending_raw++;
    }

    // Filter out any projects that ended up with zero actionable items
    for (const [projectId, group] of Array.from(groupedByProject.entries())) {
      if (!group.filenames.size) {
        groupedByProject.delete(projectId);
      }
    }

    if (!groupedByProject.size) {
      return res.json({
        queued_projects: 0,
        projects: [],
        missing: missingSelectors.length ? missingSelectors : undefined,
        message: 'No pending deletions to commit',
      });
    }

    if (scope === 'project') {
      const projectEntry = groupedByProject.values().next().value;
      const filenames = Array.from(projectEntry.filenames);
      const photoItems = Array.from(projectEntry.photoIds).map(photo_id => ({ photo_id }));
      const { task_id } = tasksOrchestrator.startTask({
        project_id: projectEntry.project.id,
        type: 'change_commit',
        source: 'commit',
        payload: { filenames },
        items: photoItems,
      });
      return res.json({
        started: true,
        task_id,
        pending: projectEntry.pending_jpg + projectEntry.pending_raw,
        pending_jpg: projectEntry.pending_jpg,
        pending_raw: projectEntry.pending_raw,
      });
    }

    const projectSummaries = [];
    const photoItems = [];
    let totalPending = 0;

    for (const { project, photoIds, photoNamesById, pending_jpg, pending_raw } of groupedByProject.values()) {
      if (!photoIds.size) continue;
      const pending_total = (pending_jpg || 0) + (pending_raw || 0);
      totalPending += pending_total;

      const summary = {
        project_id: project.id,
        project_folder: project.project_folder,
        project_name: project.project_name,
        pending_jpg,
        pending_raw,
        pending_total,
        photo_count: photoIds.size,
      };
      projectSummaries.push(summary);

      for (const photoId of photoIds) {
        const filename = photoNamesById.get(photoId) || null;
        photoItems.push({
          photo_id: photoId,
          filename,
          project_id: project.id,
          project_folder: project.project_folder,
          project_name: project.project_name,
        });
      }
    }

    if (!photoItems.length) {
      return res.json({
        queued_projects: 0,
        projects: [],
        missing: missingSelectors.length ? missingSelectors : undefined,
        message: 'No pending deletions to commit',
      });
    }

    const taskInfo = tasksOrchestrator.startTask({
      type: 'change_commit_all',
      source: 'commit',
      payload: {
        summary: {
          project_count: projectSummaries.length,
          total_pending: totalPending,
          projects: projectSummaries.map(({ project_id, project_folder, project_name, pending_jpg, pending_raw, photo_count }) => ({
            project_id,
            project_folder,
            project_name,
            pending_jpg,
            pending_raw,
            photo_count,
          })),
        },
      },
      items: photoItems,
    });

    const enrichedProjects = projectSummaries.map(summary => ({
      ...summary,
      task_id: taskInfo && taskInfo.task_id ? taskInfo.task_id : null,
    }));

    return res.json({
      started: true,
      scope: 'photo_set',
      task_id: taskInfo && taskInfo.task_id ? taskInfo.task_id : null,
      chunked: taskInfo ? !!taskInfo.chunked : false,
      job_count: taskInfo && typeof taskInfo.job_count === 'number' ? taskInfo.job_count : undefined,
      queued_projects: enrichedProjects.length,
      total_pending: totalPending,
      projects: enrichedProjects,
      missing: missingSelectors.length ? missingSelectors : undefined,
    });
  } catch (err) {
    log.error('commit_changes_failed', { error: err && err.message, stack: err && err.stack });
    return res.status(500).json({ error: 'Failed to commit changes' });
  }
}

function revertChanges(req, res) {
  try {
    const folderParam = req.params && req.params.folder;
    const scope = req.routeContext && req.routeContext.scope ? req.routeContext.scope : (folderParam ? 'project' : 'global');
    const selectors = gatherSelectors(req.body);
    const requestedProjects = new Map();
    const missingSelectors = [];

    if (folderParam) {
      const project = projectsRepo.getByFolder(folderParam);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      requestedProjects.set(project.id, project);
    }

    if (!folderParam && selectors.length) {
      for (const selector of selectors) {
        const project = resolveProject(selector);
        if (!project) {
          missingSelectors.push(selector);
          continue;
        }
        requestedProjects.set(project.id, project);
      }
    }

    const projectIdsFilter = requestedProjects.size ? Array.from(requestedProjects.keys()) : null;
    const mismatchPhotos = photosRepo.listKeepMismatchPhotos({ projectIds: projectIdsFilter });

    if (!mismatchPhotos.length) {
      return res.json({
        updated_projects: 0,
        projects: [],
        missing: missingSelectors.length ? missingSelectors : undefined,
        message: 'No keep flag mismatches found',
      });
    }

    const groupedByProject = new Map();
    const ensureProject = (projectId) => {
      if (!groupedByProject.has(projectId)) {
        let project = requestedProjects.get(projectId);
        if (!project) {
          project = projectsRepo.getById(projectId);
          if (!project || project.status === 'canceled') {
            return null;
          }
        }
        groupedByProject.set(projectId, {
          project,
          photos: [],
        });
      }
      return groupedByProject.get(projectId);
    };

    for (const row of mismatchPhotos) {
      const group = ensureProject(row.project_id);
      if (!group) continue;
      group.photos.push(row);
    }

    if (!groupedByProject.size) {
      return res.json({
        updated_projects: 0,
        projects: [],
        missing: missingSelectors.length ? missingSelectors : undefined,
        message: 'No keep flag mismatches found',
      });
    }

    const applyRevert = (photos) => {
      let updated = 0;
      let mismatch_jpg = 0;
      let mismatch_raw = 0;
      for (const photo of photos) {
        const shouldKeepJpg = toBoolean(photo.jpg_available);
        const shouldKeepRaw = toBoolean(photo.raw_available);
        if (toBoolean(photo.keep_jpg) !== shouldKeepJpg) mismatch_jpg++;
        if (toBoolean(photo.keep_raw) !== shouldKeepRaw) mismatch_raw++;
        if (toBoolean(photo.keep_jpg) !== shouldKeepJpg || toBoolean(photo.keep_raw) !== shouldKeepRaw) {
          photosRepo.updateKeepFlags(photo.id, {
            keep_jpg: shouldKeepJpg,
            keep_raw: shouldKeepRaw,
          });
          updated++;
        }
      }
      return {
        updated,
        processed: photos.length,
        mismatch_jpg,
        mismatch_raw,
      };
    };

    if (scope === 'project') {
      const projectEntry = groupedByProject.values().next().value;
      const stats = applyRevert(projectEntry.photos);
      return res.json(stats);
    }

    const updatedProjects = [];
    for (const { project, photos } of groupedByProject.values()) {
      const stats = applyRevert(photos);
      if (!stats.updated) continue;
      updatedProjects.push({
        project_id: project.id,
        project_folder: project.project_folder,
        project_name: project.project_name,
        updated: stats.updated,
        processed: stats.processed,
        mismatch_jpg: stats.mismatch_jpg,
        mismatch_raw: stats.mismatch_raw,
      });
    }

    return res.json({
      updated_projects: updatedProjects.length,
      projects: updatedProjects,
      missing: missingSelectors.length ? missingSelectors : undefined,
    });
  } catch (err) {
    log.error('revert_changes_failed', { error: err && err.message, stack: err && err.stack });
    return res.status(500).json({ error: 'Failed to revert changes' });
  }
}

module.exports = {
  commitChanges,
  revertChanges,
};
