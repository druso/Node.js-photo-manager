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

function computePendingCounts(project) {
  const rows = photosRepo.listPendingDeletesForProject(project.id);
  let pendingJpg = 0;
  let pendingRaw = 0;
  for (const row of rows) {
    if (row.jpg_available && row.keep_jpg === 0) pendingJpg++;
    if (row.raw_available && row.keep_raw === 0) pendingRaw++;
  }
  return { pending_jpg: pendingJpg, pending_raw: pendingRaw, total: pendingJpg + pendingRaw };
}

function computeMismatchStats(project) {
  const rows = photosRepo.listKeepMismatchesForProject(project.id);
  let mismatchJpg = 0;
  let mismatchRaw = 0;
  let updated = 0;
  for (const row of rows) {
    const shouldKeepJpg = toBoolean(row.jpg_available);
    const shouldKeepRaw = toBoolean(row.raw_available);
    const currentKeepJpg = toBoolean(row.keep_jpg);
    const currentKeepRaw = toBoolean(row.keep_raw);

    if (currentKeepJpg !== shouldKeepJpg) mismatchJpg++;
    if (currentKeepRaw !== shouldKeepRaw) mismatchRaw++;

    if (currentKeepJpg !== shouldKeepJpg || currentKeepRaw !== shouldKeepRaw) {
      photosRepo.updateKeepFlags(row.id, {
        keep_jpg: shouldKeepJpg,
        keep_raw: shouldKeepRaw,
      });
      updated++;
    }
  }
  return { updated, processed: rows.length, mismatch_jpg: mismatchJpg, mismatch_raw: mismatchRaw };
}

function commitChanges(req, res) {
  try {
    const folderParam = req.params && req.params.folder;
    const scope = req.routeContext && req.routeContext.scope ? req.routeContext.scope : (folderParam ? 'project' : 'global');
    const selectors = gatherSelectors(req.body);
    const seen = new Set();
    const targets = [];
    const countsByProject = new Map();
    const missingSelectors = [];

    const addProject = (project) => {
      if (!project) return;
      if (project.status === 'canceled') return;
      if (seen.has(project.id)) return;
      seen.add(project.id);
      targets.push(project);
    };

    if (folderParam) {
      const project = projectsRepo.getByFolder(folderParam);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      addProject(project);
      countsByProject.set(project.id, computePendingCounts(project));
    }

    if (!folderParam && selectors.length) {
      for (const selector of selectors) {
        const project = resolveProject(selector);
        if (!project) {
          missingSelectors.push(selector);
          continue;
        }
        addProject(project);
        countsByProject.set(project.id, computePendingCounts(project));
      }
    }

    if (!folderParam && targets.length === 0) {
      const aggregated = photosRepo.listPendingDeletesByProject();
      for (const row of aggregated) {
        const project = projectsRepo.getById(row.project_id);
        if (!project) continue;
        addProject(project);
        countsByProject.set(project.id, {
          pending_jpg: Number(row.pending_jpg) || 0,
          pending_raw: Number(row.pending_raw) || 0,
          total: (Number(row.pending_jpg) || 0) + (Number(row.pending_raw) || 0),
        });
      }
    }

    if (!targets.length) {
      return res.json({
        queued_projects: 0,
        projects: [],
        missing: missingSelectors.length ? missingSelectors : undefined,
        message: 'No pending deletions to commit',
      });
    }

    if (scope === 'project') {
      const project = targets[0];
      const counts = countsByProject.get(project.id) || computePendingCounts(project);
      if (!counts.total) {
        return res.json({ started: false, pending: 0, pending_jpg: 0, pending_raw: 0 });
      }
      const { task_id } = tasksOrchestrator.startTask({ project_id: project.id, type: 'change_commit', source: 'commit' });
      return res.json({
        started: true,
        task_id,
        pending: counts.total,
        pending_jpg: counts.pending_jpg,
        pending_raw: counts.pending_raw,
      });
    }

    const queued = [];
    const skipped = [];
    for (const project of targets) {
      const counts = countsByProject.get(project.id) || computePendingCounts(project);
      if (!counts.total) {
        skipped.push({
          project_id: project.id,
          project_folder: project.project_folder,
          project_name: project.project_name,
          pending_jpg: counts.pending_jpg,
          pending_raw: counts.pending_raw,
        });
        continue;
      }
      const { task_id } = tasksOrchestrator.startTask({ project_id: project.id, type: 'change_commit', source: 'commit' });
      queued.push({
        project_id: project.id,
        project_folder: project.project_folder,
        project_name: project.project_name,
        pending_jpg: counts.pending_jpg,
        pending_raw: counts.pending_raw,
        task_id,
      });
    }

    return res.json({
      queued_projects: queued.length,
      projects: queued,
      skipped: skipped.length ? skipped : undefined,
      missing: missingSelectors.length ? missingSelectors : undefined,
      message: queued.length ? undefined : 'No pending deletions to commit',
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
    const seen = new Set();
    const targets = [];
    const statsByProject = new Map();
    const missingSelectors = [];

    const addProject = (project) => {
      if (!project) return;
      if (project.status === 'canceled') return;
      if (seen.has(project.id)) return;
      seen.add(project.id);
      targets.push(project);
    };

    if (folderParam) {
      const project = projectsRepo.getByFolder(folderParam);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      addProject(project);
    }

    if (!folderParam && selectors.length) {
      for (const selector of selectors) {
        const project = resolveProject(selector);
        if (!project) {
          missingSelectors.push(selector);
          continue;
        }
        addProject(project);
      }
    }

    if (!folderParam && targets.length === 0) {
      const aggregated = photosRepo.listKeepMismatchesByProject();
      for (const row of aggregated) {
        const project = projectsRepo.getById(row.project_id);
        if (!project) continue;
        addProject(project);
        statsByProject.set(project.id, {
          mismatch_jpg: Number(row.mismatch_jpg) || 0,
          mismatch_raw: Number(row.mismatch_raw) || 0,
        });
      }
    }

    if (!targets.length) {
      return res.json({
        updated_projects: 0,
        projects: [],
        missing: missingSelectors.length ? missingSelectors : undefined,
        message: 'No keep flag mismatches found',
      });
    }

    if (scope === 'project') {
      const project = targets[0];
      const stats = computeMismatchStats(project);
      return res.json({ updated: stats.updated, processed: stats.processed, mismatch_jpg: stats.mismatch_jpg, mismatch_raw: stats.mismatch_raw });
    }

    const updatedProjects = [];
    const skipped = [];
    for (const project of targets) {
      const existing = statsByProject.get(project.id);
      if (!existing && !photosRepo.listKeepMismatchesForProject(project.id).length) {
        skipped.push({
          project_id: project.id,
          project_folder: project.project_folder,
          project_name: project.project_name,
        });
        continue;
      }
      const stats = computeMismatchStats(project);
      if (!stats.updated) {
        skipped.push({
          project_id: project.id,
          project_folder: project.project_folder,
          project_name: project.project_name,
        });
        continue;
      }
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
      skipped: skipped.length ? skipped : undefined,
      missing: missingSelectors.length ? missingSelectors : undefined,
      message: updatedProjects.length ? undefined : 'No keep flag mismatches found',
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
