// Structured logger v2
// Usage: const log = require('./logger2')('componentName'); log.info('event', { key: 'value' })

const util = require('util');

function getLevel() {
  const v = process.env.LOG_LEVEL || 'info';
  const map = { debug: 10, info: 20, warn: 30, error: 40 };
  return { name: v, num: map[v] ?? 20 };
}

function serialize(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    // Fallback to util.inspect to avoid throw from circular
    return JSON.stringify({ _inspected: util.inspect(obj, { depth: 2 }) });
  }
}

function baseLog(level, component, event, data) {
  const ts = new Date().toISOString();
  const payload = { ts, lvl: level, cmp: component, evt: event, ...data };
  const line = serialize(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (level === 'info') console.info(line);
  else console.debug(line);
}

function withReq(req, extra = {}) {
  const reqFields = {
    request_id: req?.id,
    ip: req?.ip,
    path: req?.originalUrl,
    method: req?.method,
  };
  return { ...reqFields, ...extra };
}

function makeLogger(component) {
  const current = getLevel();
  const gate = (lvlNum) => lvlNum >= current.num;
  return {
    debug(event, data = {}) { if (gate(10)) baseLog('debug', component, event, data); },
    info(event, data = {})  { if (gate(20)) baseLog('info', component, event, data); },
    warn(event, data = {})  { if (gate(30)) baseLog('warn', component, event, data); },
    error(event, data = {}) { if (gate(40)) baseLog('error', component, event, data); },
    // helpers
    withReq,
  };
}

module.exports = makeLogger;
