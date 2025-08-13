const projectsRepo = require('./repositories/projectsRepo');
const jobsRepo = require('./repositories/jobsRepo');

let timers = [];

function enqueueForAllProjects(type, priority) {
  const projects = projectsRepo.list();
  for (const p of projects) {
    try {
      jobsRepo.enqueue({ tenant_id: 'user_0', project_id: p.id, type, priority });
    } catch (e) {
      try { console.warn(`[scheduler] failed to enqueue ${type} for project ${p.id}:`, e.message); } catch {}
    }
  }
}

function startScheduler() {
  // Clear any existing timers
  stopScheduler();

  // Hourly trash maintenance (every 60 min)
  timers.push(setInterval(() => enqueueForAllProjects('trash_maintenance', 100), 60 * 60 * 1000));
  // Every 6h manifest_check
  timers.push(setInterval(() => enqueueForAllProjects('manifest_check', 95), 6 * 60 * 60 * 1000));
  // Every 6h folder_check, offset 30 minutes
  timers.push(setTimeout(() => {
    enqueueForAllProjects('folder_check', 95);
    timers.push(setInterval(() => enqueueForAllProjects('folder_check', 95), 6 * 60 * 60 * 1000));
  }, 30 * 60 * 1000));
  // Daily manifest_cleaning (24h)
  timers.push(setInterval(() => enqueueForAllProjects('manifest_cleaning', 80), 24 * 60 * 60 * 1000));

  // Kick off initial runs shortly after start to seed queue
  setTimeout(() => {
    enqueueForAllProjects('trash_maintenance', 100);
    enqueueForAllProjects('manifest_check', 95);
    enqueueForAllProjects('folder_check', 95);
    enqueueForAllProjects('manifest_cleaning', 80);
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
