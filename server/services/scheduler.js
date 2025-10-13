const projectsRepo = require('./repositories/projectsRepo');
const tasksOrchestrator = require('./tasksOrchestrator');
const { rotateDueHashes } = require('./publicAssetHashes');
const jobsRepo = require('./repositories/jobsRepo');
const { getConfig } = require('./config');
const makeLogger = require('../utils/logger2');
const log = makeLogger('scheduler');

let timers = [];

function schedule(fn, intervalMs) {
  const timer = setInterval(fn, intervalMs);
  timers.push(timer);
  return timer;
}

function startMaintenanceForActiveProjects() {
  // Use global maintenance task instead of per-project loops
  try {
    tasksOrchestrator.startTask({ type: 'maintenance_global', source: 'maintenance', scope: 'global' });
    try { log.info('started_global_maintenance', { task_type: 'maintenance_global' }); } catch {}
  } catch (e) {
    try { log.warn('start_task_failed', { task_type: 'maintenance_global', error: e && e.message }); } catch {}
  }
}

function startScavengeForArchivedProjects() {
  // Use global scavenge task instead of per-project loops
  try {
    tasksOrchestrator.startTask({ type: 'project_scavenge_global', source: 'maintenance', scope: 'global' });
    try { log.info('started_global_scavenge', { task_type: 'project_scavenge_global' }); } catch {}
  } catch (e) {
    try { log.warn('start_task_failed', { task_type: 'project_scavenge_global', error: e && e.message }); } catch {}
  }
}

function startFolderDiscovery() {
  try {
    const job = jobsRepo.enqueue({
      tenant_id: 1,
      project_id: null,
      type: 'folder_discovery',
      priority: 95,
      scope: 'global',
      payload: { 
        source: 'scheduler',
        triggered_at: new Date().toISOString()
      }
    });
    try { log.info('scheduled_folder_discovery', { job_id: job.id }); } catch {}
  } catch (e) {
    try { log.warn('folder_discovery_schedule_failed', { error: e && e.message }); } catch {}
  }
}

function startScheduler() {
  // Clear any existing timers
  stopScheduler();

  // Get folder discovery interval from config (default 5 minutes)
  const config = getConfig();
  const folderDiscoveryIntervalMs = (config.folder_discovery?.interval_minutes || 5) * 60 * 1000;

  // Schedule maintenance task. It includes trash + reconciliation steps per definitions.
  // Hourly kickoff covers trash and regular reconciliation without enqueuing standalone jobs.
  schedule(() => startMaintenanceForActiveProjects(), 60 * 60 * 1000);

  // Schedule archived-project scavenging to clean leftover folders.
  schedule(() => startScavengeForArchivedProjects(), 60 * 60 * 1000);

  // Schedule folder discovery to automatically detect new/renamed folders
  schedule(() => startFolderDiscovery(), folderDiscoveryIntervalMs);
  log.info('folder_discovery_scheduled', { 
    interval_minutes: folderDiscoveryIntervalMs / 60000 
  });

  // Schedule hash rotation daily to keep public asset tokens fresh
  schedule(() => {
    try {
      const rotated = rotateDueHashes();
      if (rotated > 0) {
        log.info('hash_rotation_cycle', { rotated });
      }
    } catch (err) {
      log.warn('hash_rotation_cycle_failed', { error: err && err.message });
    }
  }, 24 * 60 * 60 * 1000);

  // Kick off initial runs shortly after start to seed queue
  setTimeout(() => {
    startMaintenanceForActiveProjects();
    startScavengeForArchivedProjects();
    startFolderDiscovery(); // Run discovery on startup
    try {
      const rotated = rotateDueHashes();
      if (rotated > 0) {
        log.info('hash_rotation_cycle_initial', { rotated });
      }
    } catch (err) {
      log.warn('hash_rotation_cycle_initial_failed', { error: err && err.message });
    }
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
