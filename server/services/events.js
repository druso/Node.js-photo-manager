const EventEmitter = require('events');
const sseMultiplexer = require('./sseMultiplexer');

const emitter = new EventEmitter();

/**
 * Emit a job update event
 * Broadcasts to both EventEmitter listeners (legacy /api/jobs/stream) 
 * and the new SSE multiplexer (/api/sse/stream)
 */
function emitJobUpdate(update) {
  // Emit to EventEmitter for legacy endpoint
  emitter.emit('job_update', update);
  
  // Also broadcast via multiplexer for new unified endpoint
  if (update && update.type) {
    // Determine event type based on update.type
    let eventType = 'job_update';
    if (update.type === 'job_completed' || update.status === 'completed') {
      eventType = 'job_completed';
    } else if (update.type === 'job_started' || update.status === 'running') {
      eventType = 'job_started';
    } else if (update.type === 'job_failed' || update.status === 'failed') {
      eventType = 'job_failed';
    }
    
    sseMultiplexer.broadcast('jobs', eventType, update);
  }
}

function onJobUpdate(listener) {
  emitter.on('job_update', listener);
  return () => emitter.off('job_update', listener);
}

module.exports = {
  emitJobUpdate,
  onJobUpdate,
  emitter,
};
