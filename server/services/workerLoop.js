const { getConfig } = require('./config');
const jobsRepo = require('./repositories/jobsRepo');
const { runGenerateDerivatives } = require('./workers/derivativesWorker');
const { runProjectStopProcesses, runProjectDeleteFiles, runProjectCleanupDb } = require('./workers/projectDeletionWorker');
const { runProjectScavenge } = require('./workers/projectScavengeWorker');
const { runImageMoveFiles } = require('./workers/imageMoveWorker');
const { runTrashMaintenance, runManifestCheck, runFolderCheck, runManifestCleaning } = require('./workers/maintenanceWorker');
const { runFileRemoval } = require('./workers/fileRemovalWorker');
const { emitJobUpdate } = require('./events');
const tasksOrchestrator = require('./tasksOrchestrator');
const makeLogger = require('../utils/logger2');
const log = makeLogger('workerLoop');

let running = false;
let timer = null;

async function handleJob(job, { heartbeatMs, maxAttemptsDefault, workerId }) {
  // Ensure defaults
  if (!job.max_attempts) {
    jobsRepo.setDefaultMaxAttempts(job.id, maxAttemptsDefault);
    job.max_attempts = maxAttemptsDefault;
  }
  let hb = null;
  const startHeartbeat = () => {
    if (hb) return;
    hb = setInterval(() => {
      try { jobsRepo.heartbeat(job.id); } catch {}
    }, heartbeatMs);
  };
  const stopHeartbeat = () => { if (hb) { clearInterval(hb); hb = null; } };

  try {
    startHeartbeat();
    if (job.type === 'generate_derivatives' || job.type === 'upload_postprocess') {
      await runGenerateDerivatives({ job, onProgress: ({ done, total }) => {
        const p = job.payload_json || {};
        emitJobUpdate({ id: job.id, status: 'running', progress_done: done, progress_total: total, task_id: p.task_id, task_type: p.task_type, source: p.source });
        try { jobsRepo.updateProgress(job.id, { done, total }); } catch {}
      }});
      stopHeartbeat();
      jobsRepo.complete(job.id);
      {
        const p = job.payload_json || {};
        emitJobUpdate({ id: job.id, status: 'completed', task_id: p.task_id, task_type: p.task_type, source: p.source });
      }
      try { tasksOrchestrator.onJobCompleted(job); } catch {}
      return;
    }

    // Project deletion flow
    if (job.type === 'project_stop_processes') {
      await runProjectStopProcesses(job);
      stopHeartbeat();
      jobsRepo.complete(job.id);
      {
        const p = job.payload_json || {};
        emitJobUpdate({ id: job.id, status: 'completed', task_id: p.task_id, task_type: p.task_type, source: p.source });
      }
      try { tasksOrchestrator.onJobCompleted(job); } catch {}
      return;
    }
    if (job.type === 'project_delete_files') {
      await runProjectDeleteFiles(job);
      stopHeartbeat();
      jobsRepo.complete(job.id);
      {
        const p = job.payload_json || {};
        emitJobUpdate({ id: job.id, status: 'completed', task_id: p.task_id, task_type: p.task_type, source: p.source });
      }
      try { tasksOrchestrator.onJobCompleted(job); } catch {}
      return;
    }
    if (job.type === 'project_cleanup_db') {
      await runProjectCleanupDb(job);
      stopHeartbeat();
      jobsRepo.complete(job.id);
      {
        const p = job.payload_json || {};
        emitJobUpdate({ id: job.id, status: 'completed', task_id: p.task_id, task_type: p.task_type, source: p.source });
      }
      try { tasksOrchestrator.onJobCompleted(job); } catch {}
      return;
    }

    // Maintenance job types
    if (job.type === 'trash_maintenance') {
      await runTrashMaintenance(job);
      stopHeartbeat();
      jobsRepo.complete(job.id);
      {
        const p = job.payload_json || {};
        emitJobUpdate({ id: job.id, status: 'completed', task_id: p.task_id, task_type: p.task_type, source: p.source });
      }
      try { tasksOrchestrator.onJobCompleted(job); } catch {}
      return;
    }
    if (job.type === 'manifest_check') {
      await runManifestCheck(job);
      stopHeartbeat();
      jobsRepo.complete(job.id);
      {
        const p = job.payload_json || {};
        emitJobUpdate({ id: job.id, status: 'completed', task_id: p.task_id, task_type: p.task_type, source: p.source });
      }
      try { tasksOrchestrator.onJobCompleted(job); } catch {}
      return;
    }
    if (job.type === 'folder_check') {
      await runFolderCheck(job);
      stopHeartbeat();
      jobsRepo.complete(job.id);
      {
        const p = job.payload_json || {};
        emitJobUpdate({ id: job.id, status: 'completed', task_id: p.task_id, task_type: p.task_type, source: p.source });
      }
      try { tasksOrchestrator.onJobCompleted(job); } catch {}
      return;
    }
    if (job.type === 'manifest_cleaning') {
      await runManifestCleaning(job);
      stopHeartbeat();
      jobsRepo.complete(job.id);
      {
        const p = job.payload_json || {};
        emitJobUpdate({ id: job.id, status: 'completed', task_id: p.task_id, task_type: p.task_type, source: p.source });
      }
      try { tasksOrchestrator.onJobCompleted(job); } catch {}
      return;
    }

    // Archived-project cleanup
    if (job.type === 'project_scavenge') {
      await runProjectScavenge(job);
      stopHeartbeat();
      jobsRepo.complete(job.id);
      {
        const p = job.payload_json || {};
        emitJobUpdate({ id: job.id, status: 'completed', task_id: p.task_id, task_type: p.task_type, source: p.source });
      }
      try { tasksOrchestrator.onJobCompleted(job); } catch {}
      return;
    }

    // Commit flow: file removal
    if (job.type === 'file_removal') {
      await runFileRemoval(job);
      stopHeartbeat();
      jobsRepo.complete(job.id);
      {
        const p = job.payload_json || {};
        emitJobUpdate({ id: job.id, status: 'completed', task_id: p.task_id, task_type: p.task_type, source: p.source });
      }
      try { tasksOrchestrator.onJobCompleted(job); } catch {}
      return;
    }

    // Image move job type
    if (job.type === 'image_move_files') {
      await runImageMoveFiles(job);
      stopHeartbeat();
      jobsRepo.complete(job.id);
      {
        const p = job.payload_json || {};
        emitJobUpdate({ id: job.id, status: 'completed', task_id: p.task_id, task_type: p.task_type, source: p.source });
      }
      try { tasksOrchestrator.onJobCompleted(job); } catch {}
      return;
    }

    // Unknown type → fail without retry
    stopHeartbeat();
    jobsRepo.fail(job.id, `Unknown job type: ${job.type}`);
    {
      const p = job.payload_json || {};
      emitJobUpdate({ id: job.id, status: 'failed', task_id: p.task_id, task_type: p.task_type, source: p.source });
    }
  } catch (err) {
    stopHeartbeat();
    // Retry policy: increment attempts; if below max, requeue; else fail
    try { jobsRepo.incrementAttempts(job.id); } catch {}
    const current = jobsRepo.getById(job.id) || job;
    const attempts = (current.attempts ?? 0);
    const maxA = current.max_attempts || maxAttemptsDefault || 1;
    if (attempts < maxA) {
      // Requeue for retry
      jobsRepo.requeue(job.id);
      const p = job.payload_json || {};
      emitJobUpdate({ id: job.id, status: 'queued', task_id: p.task_id, task_type: p.task_type, source: p.source });
    } else {
      jobsRepo.fail(job.id, (err && err.message) ? err.message : String(err));
      const p = job.payload_json || {};
      emitJobUpdate({ id: job.id, status: 'failed', task_id: p.task_id, task_type: p.task_type, source: p.source });
    }
  }
}

function startWorkerLoop() {
  if (running) return;
  running = true;
  const cfg = getConfig();
  const pipeline = cfg.pipeline || {};
  const totalSlots = Math.max(1, Number(pipeline.max_parallel_jobs || 1));
  const intervalMs = 500;
  const heartbeatMs = Math.max(250, Number(pipeline.heartbeat_ms || 1000));
  const staleSeconds = Math.max(5, Number(pipeline.stale_seconds || 60));
  const maxAttemptsDefault = Math.max(1, Number(pipeline.max_attempts_default || 3));
  const priorityThreshold = Number(pipeline.priority_threshold != null ? pipeline.priority_threshold : 90);
  const prioritySlots = Math.max(0, Number(pipeline.priority_lane_slots != null ? pipeline.priority_lane_slots : 1));
  const normalSlots = Math.max(0, totalSlots - prioritySlots);
  // Configuration sanity warnings
  if (Number(pipeline.max_parallel_jobs || 1) < 1) {
    log.warn('config_sanity_max_parallel_clamped', { max_parallel_jobs: pipeline.max_parallel_jobs });
  }
  if (prioritySlots > totalSlots) {
    log.warn('config_sanity_priority_slots_exceed_total', { priority_slots: prioritySlots, total_slots: totalSlots });
  }
  if (totalSlots > 0 && normalSlots === 0) {
    log.warn('config_sanity_normal_lane_zero', { total_slots: totalSlots, priority_slots: prioritySlots, note: 'Normal-priority jobs may starve' });
  }
  const workerId = `inproc-${process.pid || '1'}`;
  const activePriority = new Set();
  const activeNormal = new Set();

  function tick() {
    try {
      // Crash recovery: requeue stale running jobs (heartbeat expired)
      try { jobsRepo.requeueStaleRunning({ staleSeconds }); } catch {}
      // 1) Fill priority lane
      while (activePriority.size < prioritySlots) {
        const job = jobsRepo.claimNext({ workerId, minPriority: priorityThreshold });
        if (!job) break;
        activePriority.add(job.id);
        {
          const p = job.payload_json || {};
          emitJobUpdate({ id: job.id, status: 'running', task_id: p.task_id, task_type: p.task_type, source: p.source });
        }
        Promise.resolve(handleJob(job, { heartbeatMs, maxAttemptsDefault, workerId })).finally(() => {
          activePriority.delete(job.id);
        });
      }
      // 2) Fill normal lane
      while (activeNormal.size < normalSlots) {
        const job = jobsRepo.claimNext({ workerId, maxPriority: priorityThreshold - 1 });
        if (!job) break;
        activeNormal.add(job.id);
        {
          const p = job.payload_json || {};
          emitJobUpdate({ id: job.id, status: 'running', task_id: p.task_id, task_type: p.task_type, source: p.source });
        }
        Promise.resolve(handleJob(job, { heartbeatMs, maxAttemptsDefault, workerId })).finally(() => {
          activeNormal.delete(job.id);
        });
      }
    } catch (_) {
      // swallow errors in loop, they are handled per job
    } finally {
      timer = setTimeout(tick, intervalMs);
    }
  }

  tick();
}

function stopWorkerLoop() {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { startWorkerLoop, stopWorkerLoop };
