const projectsRepo = require('./repositories/projectsRepo');
const tasksOrchestrator = require('./tasksOrchestrator');
const makeLogger = require('../utils/logger2');
const log = makeLogger('scheduler');

let timers = [];

function startMaintenanceForActiveProjects() {
  const projects = projectsRepo.list();
  for (const p of projects) {
    if (p.status === 'canceled') continue; // skip archived
    try {
      tasksOrchestrator.startTask({ project_id: p.id, type: 'maintenance', source: 'maintenance' });
    } catch (e) {
      try { log.warn('start_task_failed', { task_type: 'maintenance', project_id: p.id, project_folder: p.project_folder, project_name: p.project_name, error: e && e.message }); } catch {}
    }
  }
}

function startScavengeForArchivedProjects() {
  const projects = projectsRepo.list();
  for (const p of projects) {
    if (p.status !== 'canceled') continue; // only archived
    try {
      tasksOrchestrator.startTask({ project_id: p.id, type: 'project_scavenge', source: 'maintenance' });
      // Also run trash cleanup for archived projects
      tasksOrchestrator.startTask({ project_id: p.id, type: 'trash_only', source: 'maintenance' });
    } catch (e) {
      try { log.warn('start_task_failed', { task_type: 'project_scavenge', project_id: p.id, project_folder: p.project_folder, project_name: p.project_name, error: e && e.message }); } catch {}
    }
  }
}

function startScheduler() {
  // Clear any existing timers
  stopScheduler();

  // Schedule maintenance task. It includes trash + reconciliation steps per definitions.
  // Hourly kickoff covers trash and regular reconciliation without enqueuing standalone jobs.
  timers.push(setInterval(() => startMaintenanceForActiveProjects(), 60 * 60 * 1000));

  // Schedule archived-project scavenging to clean leftover folders.
  timers.push(setInterval(() => startScavengeForArchivedProjects(), 60 * 60 * 1000));

  // Kick off initial runs shortly after start to seed queue
  setTimeout(() => {
    startMaintenanceForActiveProjects();
    startScavengeForArchivedProjects();
  }, 5 * 1000);
}

function stopScheduler() {
  for (const t of timers) {
    try { clearInterval(t); } catch {}
    try { clearTimeout(t); } catch {}
  }
  timers = [];
}

module.exports = { startScheduler, stopScheduler };
