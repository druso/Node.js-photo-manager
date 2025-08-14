const { getConfig } = require('./config');
const jobsRepo = require('./repositories/jobsRepo');
const { runGenerateDerivatives } = require('./workers/derivativesWorker');
const { runTrashMaintenance, runManifestCheck, runFolderCheck, runManifestCleaning } = require('./workers/maintenanceWorker');
const { emitJobUpdate } = require('./events');

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
        emitJobUpdate({ id: job.id, status: 'running', progress_done: done, progress_total: total });
        try { jobsRepo.updateProgress(job.id, { done, total }); } catch {}
      }});
      stopHeartbeat();
      jobsRepo.complete(job.id);
      emitJobUpdate({ id: job.id, status: 'completed' });
      return;
    }

    // Maintenance job types
    if (job.type === 'trash_maintenance') {
      await runTrashMaintenance(job);
      stopHeartbeat();
      jobsRepo.complete(job.id);
      emitJobUpdate({ id: job.id, status: 'completed' });
      return;
    }
    if (job.type === 'manifest_check') {
      await runManifestCheck(job);
      stopHeartbeat();
      jobsRepo.complete(job.id);
      emitJobUpdate({ id: job.id, status: 'completed' });
      return;
    }
    if (job.type === 'folder_check') {
      await runFolderCheck(job);
      stopHeartbeat();
      jobsRepo.complete(job.id);
      emitJobUpdate({ id: job.id, status: 'completed' });
      return;
    }
    if (job.type === 'manifest_cleaning') {
      await runManifestCleaning(job);
      stopHeartbeat();
      jobsRepo.complete(job.id);
      emitJobUpdate({ id: job.id, status: 'completed' });
      return;
    }

    // Unknown type → fail without retry
    stopHeartbeat();
    jobsRepo.fail(job.id, `Unknown job type: ${job.type}`);
    emitJobUpdate({ id: job.id, status: 'failed' });
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
      emitJobUpdate({ id: job.id, status: 'queued' });
    } else {
      jobsRepo.fail(job.id, (err && err.message) ? err.message : String(err));
      emitJobUpdate({ id: job.id, status: 'failed' });
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
    console.warn('[workerLoop] pipeline.max_parallel_jobs < 1; clamped to 1. Current:', pipeline.max_parallel_jobs);
  }
  if (prioritySlots > totalSlots) {
    console.warn('[workerLoop] priority_lane_slots exceeds max_parallel_jobs; priority will be capped by available slots. priority_slots:', prioritySlots, 'total_slots:', totalSlots);
  }
  if (totalSlots > 0 && normalSlots === 0) {
    console.warn('[workerLoop] Normal lane has zero slots (max_parallel_jobs:', totalSlots, ', priority_lane_slots:', prioritySlots, '). Normal-priority jobs may starve. Consider lowering priority_lane_slots or increasing max_parallel_jobs.');
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
        emitJobUpdate({ id: job.id, status: 'running' });
        Promise.resolve(handleJob(job, { heartbeatMs, maxAttemptsDefault, workerId })).finally(() => {
          activePriority.delete(job.id);
        });
      }
      // 2) Fill normal lane
      while (activeNormal.size < normalSlots) {
        const job = jobsRepo.claimNext({ workerId, maxPriority: priorityThreshold - 1 });
        if (!job) break;
        activeNormal.add(job.id);
        emitJobUpdate({ id: job.id, status: 'running' });
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
