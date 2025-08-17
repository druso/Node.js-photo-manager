const path = require('path');
const fs = require('fs-extra');
const makeLogger = require('../../utils/logger2');
const log = makeLogger('projectDeletion');
const projectsRepo = require('../repositories/projectsRepo');
const photosRepo = require('../repositories/photosRepo');
const jobsRepo = require('../repositories/jobsRepo');

async function runProjectStopProcesses(job) {
  log.info('stop_processes_start', { job_id: job.id, project_id: job.project_id });
  const project = projectsRepo.getById(job.project_id);
  if (!project) {
    log.warn('stop_processes_project_not_found', { job_id: job.id, project_id: job.project_id });
    return; // nothing to do
  }
  // Mark project as canceled/archived if not already
  if (project.status !== 'canceled') {
    try {
      projectsRepo.archive(project.id);
      log.info('stop_processes_archived', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name || project.name });
    } catch (e) {
      log.error('stop_processes_archive_failed', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name || project.name, error: e && e.message });
    }
  } else {
    log.info('stop_processes_already_canceled', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name || project.name });
  }
  // Cancel any queued/running jobs for this project
  try {
    jobsRepo.cancelByProject(project.id);
    log.info('stop_processes_canceled_related_jobs', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name || project.name });
  } catch (e) {
    log.error('stop_processes_cancel_jobs_failed', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name || project.name, error: e && e.message });
  }
  log.info('stop_processes_done', { job_id: job.id, project_id: job.project_id });
}

async function runProjectDeleteFiles(job) {
  log.info('delete_files_start', { job_id: job.id, project_id: job.project_id });
  const project = projectsRepo.getById(job.project_id);
  if (!project) {
    log.warn('delete_files_project_not_found', { job_id: job.id, project_id: job.project_id });
    return;
  }
  // Safety: only operate if project is canceled
  if (project.status !== 'canceled') {
    log.warn('delete_files_not_canceled', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name || project.name, status: project.status });
    return;
  }
  const projectPath = path.join(__dirname, '..', '..', '..', '.projects', project.project_folder);
  try {
    const exists = await fs.pathExists(projectPath);
    if (exists) {
      log.info('delete_files_removing_path', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name || project.name, project_path: projectPath });
      await fs.remove(projectPath);
      log.info('delete_files_removed_path', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name || project.name, project_path: projectPath });
    } else {
      log.info('delete_files_path_missing', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name || project.name, project_path: projectPath });
    }
  } catch (e) {
    log.error('delete_files_error', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name || project.name, project_path: projectPath, error: e && e.message });
    // Bubble up error to allow retry
    throw e;
  } finally {
    log.info('delete_files_done', { job_id: job.id, project_id: job.project_id });
  }
}

async function runProjectCleanupDb(job) {
  log.info('cleanup_db_start', { job_id: job.id, project_id: job.project_id });
  const project = projectsRepo.getById(job.project_id);
  if (!project) {
    log.warn('cleanup_db_project_not_found', { job_id: job.id, project_id: job.project_id });
    return;
  }
  // Safety: only cleanup if canceled
  if (project.status !== 'canceled') {
    log.warn('cleanup_db_not_canceled', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name || project.name, status: project.status });
    return;
  }
  // Remove photos/tags while keeping the project row as archive record
  try {
    const db = require('../db').getDb();
    const trx = db.transaction((pid) => {
      try { db.prepare(`DELETE FROM photo_tags WHERE photo_id IN (SELECT id FROM photos WHERE project_id = ?);`).run(pid); } catch (e) { try { log.warn('cleanup_db_photo_tags_delete_skipped', { project_id: project.id, error: e && e.message }); } catch {} }
      try { db.prepare(`DELETE FROM tags WHERE project_id = ?;`).run(pid); } catch (e) { try { log.warn('cleanup_db_tags_delete_skipped', { project_id: project.id, error: e && e.message }); } catch {} }
      try { db.prepare(`DELETE FROM photos WHERE project_id = ?;`).run(pid); } catch (e) { try { log.warn('cleanup_db_photos_delete_skipped', { project_id: project.id, error: e && e.message }); } catch {} }
    });
    trx(project.id);
    log.info('cleanup_db_deleted_related_rows', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name || project.name });
  } catch (e) {
    log.error('cleanup_db_error', { project_id: project.id, project_folder: project.project_folder, project_name: project.project_name || project.name, error: e && e.message });
    throw e;
  } finally {
    log.info('cleanup_db_done', { job_id: job.id, project_id: job.project_id });
  }
}

module.exports = {
  runProjectStopProcesses,
  runProjectDeleteFiles,
  runProjectCleanupDb,
};
