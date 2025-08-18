const path = require('path');
const fs = require('fs-extra');
const makeLogger = require('../../utils/logger2');
const log = makeLogger('projectScavenge');
const projectsRepo = require('../repositories/projectsRepo');

async function runProjectScavenge(job) {
  // Best-effort cleanup: if project is archived (status==='canceled'), remove leftover on-disk folder
  const project = projectsRepo.getById(job.project_id);
  if (!project) {
    log.warn('scavenge_project_not_found', { job_id: job.id, project_id: job.project_id });
    return;
  }
  if (project.status !== 'canceled') {
    log.info('scavenge_skip_active', { project_id: project.id, project_folder: project.project_folder, status: project.status });
    return;
  }
  const projectPath = path.join(__dirname, '..', '..', '..', '.projects', project.project_folder);
  try {
    const exists = await fs.pathExists(projectPath);
    if (exists) {
      log.info('scavenge_removing_leftover_folder', { project_id: project.id, project_folder: project.project_folder, project_path: projectPath });
      await fs.remove(projectPath);
      log.info('scavenge_removed_leftover_folder', { project_id: project.id, project_folder: project.project_folder, project_path: projectPath });
    } else {
      log.info('scavenge_folder_absent', { project_id: project.id, project_folder: project.project_folder, project_path: projectPath });
    }
  } catch (e) {
    // Bubble up so retry policy can requeue
    log.error('scavenge_error', { project_id: project.id, project_folder: project.project_folder, error: e && e.message });
    throw e;
  }
}

module.exports = { runProjectScavenge };
