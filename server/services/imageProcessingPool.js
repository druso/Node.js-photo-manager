const { Worker } = require('worker_threads');
const path = require('path');
const makeLogger = require('../utils/logger2');
const log = makeLogger('image-pool');

/**
 * ImageProcessingPool manages a pool of worker threads for parallel image processing.
 * Each worker can handle Sharp operations independently, allowing multiple images
 * to be processed simultaneously while controlling CPU usage.
 */
class ImageProcessingPool {
  constructor(workerCount = 4) {
    this.workerCount = workerCount;
    this.workers = [];
    this.queue = [];
    this.activeJobs = new Map();
    this.nextJobId = 1;
    this.shuttingDown = false;
    this.init();
  }

  init() {
    log.info('pool_init', { workerCount: this.workerCount });
    for (let i = 0; i < this.workerCount; i++) {
      this.createWorker(i);
    }
  }

  createWorker(index) {
    const workerPath = path.join(__dirname, 'imageWorker.js');
    const worker = new Worker(workerPath);
    
    worker.on('message', (msg) => this.handleWorkerMessage(msg));
    worker.on('error', (err) => {
      log.error('worker_error', { index, error: err.message, stack: err.stack });
      // Worker crashed - recreate it
      this.recreateWorker(index);
    });
    worker.on('exit', (code) => {
      if (code !== 0) {
        log.warn('worker_exit', { index, code });
        this.recreateWorker(index);
      }
    });
    
    this.workers[index] = { worker, busy: false, index };
    log.debug('worker_created', { index });
  }

  recreateWorker(index) {
    // Don't recreate workers if we're shutting down
    if (this.shuttingDown) {
      log.debug('worker_recreate_skipped_shutdown', { index });
      return;
    }
    
    log.info('worker_recreate', { index });
    const oldWorker = this.workers[index];
    if (oldWorker && oldWorker.worker) {
      try {
        oldWorker.worker.terminate();
      } catch (err) {
        log.warn('worker_terminate_error', { index, error: err.message });
      }
    }
    this.createWorker(index);
    // Reprocess queue in case jobs were lost
    this.processQueue();
  }

  /**
   * Process an image task with the worker pool.
   * @param {Object} task - Task definition
   * @param {string} task.sourcePath - Absolute path to source image
   * @param {Array} task.derivatives - Array of derivative definitions
   * @param {string} task.derivatives[].type - 'thumbnail' or 'preview'
   * @param {number} task.derivatives[].width - Max width
   * @param {number} task.derivatives[].height - Max height
   * @param {number} task.derivatives[].quality - JPEG quality (1-100)
   * @param {string} task.derivatives[].outputPath - Absolute output path
   * @returns {Promise<Array>} Array of results with metadata
   */
  async processImage(task) {
    return new Promise((resolve, reject) => {
      const jobId = this.nextJobId++;
      this.queue.push({ jobId, task, resolve, reject, queuedAt: Date.now() });
      log.debug('job_queued', { jobId, queueLength: this.queue.length });
      this.processQueue();
    });
  }

  processQueue() {
    // Find available worker
    const availableWorker = this.workers.find(w => !w.busy);
    if (!availableWorker || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    availableWorker.busy = true;
    
    this.activeJobs.set(job.jobId, { ...job, worker: availableWorker, startedAt: Date.now() });
    
    const waitTime = Date.now() - job.queuedAt;
    log.debug('job_started', { 
      jobId: job.jobId, 
      workerIndex: availableWorker.index,
      waitTimeMs: waitTime,
      queueLength: this.queue.length 
    });
    
    availableWorker.worker.postMessage({ jobId: job.jobId, task: job.task });
    
    // Continue processing queue if more workers available
    if (this.queue.length > 0) {
      setImmediate(() => this.processQueue());
    }
  }

  handleWorkerMessage(msg) {
    const job = this.activeJobs.get(msg.jobId);
    if (!job) {
      log.warn('unknown_job_response', { jobId: msg.jobId });
      return;
    }

    job.worker.busy = false;
    this.activeJobs.delete(msg.jobId);

    const processingTime = Date.now() - job.startedAt;
    
    if (msg.error) {
      log.error('job_failed', { 
        jobId: msg.jobId, 
        error: msg.error,
        processingTimeMs: processingTime 
      });
      job.reject(new Error(msg.error));
    } else {
      log.debug('job_completed', { 
        jobId: msg.jobId, 
        processingTimeMs: processingTime,
        derivatives: msg.result?.length || 0
      });
      job.resolve(msg.result);
    }

    // Process next queued job
    this.processQueue();
    
    // Schedule idle shutdown if pool becomes idle
    if (this.activeJobs.size === 0 && this.queue.length === 0) {
      const { scheduleIdleShutdown } = require('./imageProcessingPool');
      scheduleIdleShutdown();
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      workerCount: this.workerCount,
      busyWorkers: this.workers.filter(w => w.busy).length,
      queueLength: this.queue.length,
      activeJobs: this.activeJobs.size
    };
  }

  /**
   * Shutdown the pool gracefully
   */
  async shutdown() {
    this.shuttingDown = true;
    log.info('pool_shutdown', { activeJobs: this.activeJobs.size, queueLength: this.queue.length });
    
    // Reject all queued jobs
    for (const job of this.queue) {
      job.reject(new Error('Pool shutting down'));
    }
    this.queue = [];
    
    // Wait for active jobs to complete (with timeout)
    const timeout = 5000; // 5 seconds for tests
    const start = Date.now();
    while (this.activeJobs.size > 0 && (Date.now() - start) < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Force reject any remaining active jobs
    for (const [jobId, job] of this.activeJobs.entries()) {
      job.reject(new Error('Pool shutdown timeout'));
      this.activeJobs.delete(jobId);
    }
    
    // Terminate all workers
    for (const { worker, index } of this.workers) {
      try {
        await worker.terminate();
        log.debug('worker_terminated', { index });
      } catch (err) {
        log.warn('worker_terminate_error', { index, error: err.message });
      }
    }
    
    this.workers = [];
    log.info('pool_shutdown_complete');
  }
}

// Singleton instance - created lazily on first use
// This improves startup time and allows clean shutdown when idle
let poolInstance = null;
let poolIdleTimeout = null;
const IDLE_SHUTDOWN_MS = 30000; // Shutdown pool after 30 seconds of inactivity

function getPool(workerCount = 4) {
  // Clear any pending idle shutdown
  if (poolIdleTimeout) {
    clearTimeout(poolIdleTimeout);
    poolIdleTimeout = null;
  }
  
  // Create pool lazily on first use
  if (!poolInstance) {
    log.info('pool_lazy_init', { workerCount });
    poolInstance = new ImageProcessingPool(workerCount);
  }
  
  return poolInstance;
}

/**
 * Schedule automatic pool shutdown after idle period
 * This allows the application to clean up resources when not processing images
 */
function scheduleIdleShutdown() {
  // In test mode, use shorter timeout for faster cleanup
  const timeout = process.env.NODE_ENV === 'test' ? 100 : IDLE_SHUTDOWN_MS;
  
  // Clear any existing timeout
  if (poolIdleTimeout) {
    clearTimeout(poolIdleTimeout);
  }
  
  // Schedule shutdown after idle period
  poolIdleTimeout = setTimeout(async () => {
    if (poolInstance && poolInstance.activeJobs.size === 0 && poolInstance.queue.length === 0) {
      log.info('pool_idle_shutdown', { idleMs: timeout, testMode: process.env.NODE_ENV === 'test' });
      await resetPool();
    }
  }, timeout);
}

async function resetPool() {
  if (poolInstance) {
    try {
      await poolInstance.shutdown();
    } catch (err) {
      log.error('pool_reset_error', { error: err.message });
    }
    poolInstance = null;
  }
}

/**
 * Force immediate pool shutdown (for test cleanup)
 * Does not wait for jobs to complete
 */
function forceResetPool() {
  if (poolInstance) {
    // Set shutting down flag to prevent worker recreation
    poolInstance.shuttingDown = true;
    
    // Terminate all workers immediately
    for (const { worker } of poolInstance.workers) {
      try {
        worker.terminate();
      } catch (err) {
        // Ignore errors during force shutdown
      }
    }
    poolInstance = null;
  }
}

module.exports = { getPool, resetPool, forceResetPool, scheduleIdleShutdown, ImageProcessingPool };
