const projectsRepo = require('./repositories/projectsRepo');
const tasksOrchestrator = require('./tasksOrchestrator');

let timers = [];

function startTaskForAllProjects(taskType, source = 'maintenance') {
  const projects = projectsRepo.list();
  for (const p of projects) {
    try {
      tasksOrchestrator.startTask({ project_id: p.id, type: taskType, source });
    } catch (e) {
      try { console.warn(`[scheduler] failed to start task ${taskType} for project ${p.id}:`, e.message); } catch {}
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
