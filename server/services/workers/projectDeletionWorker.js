const path = require('path');
const fs = require('fs-extra');
const projectsRepo = require('../repositories/projectsRepo');
const photosRepo = require('../repositories/photosRepo');
const jobsRepo = require('../repositories/jobsRepo');

async function runProjectStopProcesses(job) {
  console.info('[projectDeletionWorker] stopProcesses: start', { job_id: job.id, project_id: job.project_id });
  const project = projectsRepo.getById(job.project_id);
  if (!project) {
    console.warn('[projectDeletionWorker] stopProcesses: project not found; nothing to do', { job_id: job.id, project_id: job.project_id });
    return; // nothing to do
  }
  // Mark project as canceled/archived if not already
  if (project.status !== 'canceled') {
    try {
      projectsRepo.archive(project.id);
      console.info('[projectDeletionWorker] stopProcesses: archived project', { project_id: project.id });
    } catch (e) {
      console.error('[projectDeletionWorker] stopProcesses: archive failed (continuing)', { project_id: project.id, error: e && e.message });
    }
  } else {
    console.info('[projectDeletionWorker] stopProcesses: project already canceled', { project_id: project.id });
  }
  // Cancel any queued/running jobs for this project
  try {
    jobsRepo.cancelByProject(project.id);
    console.info('[projectDeletionWorker] stopProcesses: canceled related jobs', { project_id: project.id });
  } catch (e) {
    console.error('[projectDeletionWorker] stopProcesses: cancelByProject failed (continuing)', { project_id: project.id, error: e && e.message });
  }
  console.info('[projectDeletionWorker] stopProcesses: done', { job_id: job.id, project_id: job.project_id });
}

async function runProjectDeleteFiles(job) {
  console.info('[projectDeletionWorker] deleteFiles: start', { job_id: job.id, project_id: job.project_id });
  const project = projectsRepo.getById(job.project_id);
  if (!project) {
    console.warn('[projectDeletionWorker] deleteFiles: project not found; nothing to do', { job_id: job.id, project_id: job.project_id });
    return;
  }
  // Safety: only operate if project is canceled
  if (project.status !== 'canceled') {
    console.warn('[projectDeletionWorker] deleteFiles: project not canceled; skipping', { project_id: project.id, status: project.status });
    return;
  }
  const projectPath = path.join(__dirname, '..', '..', '..', '.projects', project.project_folder);
  try {
    const exists = await fs.pathExists(projectPath);
    if (exists) {
      console.info('[projectDeletionWorker] deleteFiles: removing path', { project_path: projectPath });
      await fs.remove(projectPath);
      console.info('[projectDeletionWorker] deleteFiles: removed path', { project_path: projectPath });
    } else {
      console.info('[projectDeletionWorker] deleteFiles: path does not exist; nothing to remove', { project_path: projectPath });
    }
  } catch (e) {
    console.error('[projectDeletionWorker] deleteFiles: error', { project_path: projectPath, error: e && e.message });
    // Bubble up error to allow retry
    throw e;
  } finally {
    console.info('[projectDeletionWorker] deleteFiles: done', { job_id: job.id, project_id: job.project_id });
  }
}

async function runProjectCleanupDb(job) {
  console.info('[projectDeletionWorker] cleanupDb: start', { job_id: job.id, project_id: job.project_id });
  const project = projectsRepo.getById(job.project_id);
  if (!project) {
    console.warn('[projectDeletionWorker] cleanupDb: project not found; nothing to do', { job_id: job.id, project_id: job.project_id });
    return;
  }
  // Safety: only cleanup if canceled
  if (project.status !== 'canceled') {
    console.warn('[projectDeletionWorker] cleanupDb: project not canceled; skipping', { project_id: project.id, status: project.status });
    return;
  }
  // Remove photos/tags while keeping the project row as archive record
  try {
    const db = require('../db').getDb();
    const trx = db.transaction((pid) => {
      try { db.prepare(`DELETE FROM photo_tags WHERE photo_id IN (SELECT id FROM photos WHERE project_id = ?);`).run(pid); } catch (e) { console.warn('[projectDeletionWorker] cleanupDb: photo_tags delete skipped', { error: e && e.message }); }
      try { db.prepare(`DELETE FROM tags WHERE project_id = ?;`).run(pid); } catch (e) { console.warn('[projectDeletionWorker] cleanupDb: tags delete skipped', { error: e && e.message }); }
      try { db.prepare(`DELETE FROM photos WHERE project_id = ?;`).run(pid); } catch (e) { console.warn('[projectDeletionWorker] cleanupDb: photos delete skipped', { error: e && e.message }); }
    });
    trx(project.id);
    console.info('[projectDeletionWorker] cleanupDb: deleted related rows', { project_id: project.id });
  } catch (e) {
    console.error('[projectDeletionWorker] cleanupDb: error', { project_id: project.id, error: e && e.message });
    throw e;
  } finally {
    console.info('[projectDeletionWorker] cleanupDb: done', { job_id: job.id, project_id: job.project_id });
  }
}

module.exports = {
  runProjectStopProcesses,
  runProjectDeleteFiles,
  runProjectCleanupDb,
};
