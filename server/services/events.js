const EventEmitter = require('events');

const emitter = new EventEmitter();

function emitJobUpdate(update) {
  emitter.emit('job_update', update);
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
