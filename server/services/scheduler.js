const projectsRepo = require('./repositories/projectsRepo');
const tasksOrchestrator = require('./tasksOrchestrator');
const makeLogger = require('../utils/logger2');
const log = makeLogger('scheduler');

let timers = [];

function startTaskForAllProjects(taskType, source = 'maintenance') {
  const projects = projectsRepo.list();
  for (const p of projects) {
    try {
      tasksOrchestrator.startTask({ project_id: p.id, type: taskType, source });
    } catch (e) {
      try { log.warn('start_task_failed', { task_type: taskType, project_id: p.id, project_folder: p.project_folder, project_name: p.project_name, error: e && e.message }); } catch {}
    }
  }
}

function startScheduler() {
  // Clear any existing timers
  stopScheduler();

  // Schedule maintenance task. It includes trash + reconciliation steps per definitions.
  // Hourly kickoff covers trash and regular reconciliation without enqueuing standalone jobs.
  timers.push(setInterval(() => startTaskForAllProjects('maintenance'), 60 * 60 * 1000));

  // Kick off initial runs shortly after start to seed queue
  setTimeout(() => {
    startTaskForAllProjects('maintenance');
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
