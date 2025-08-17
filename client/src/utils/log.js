// Lightweight frontend logger with env gating
// Usage: import log from '../utils/log'; log.debug('msg', { key: 'val' })

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const envLevel = (import.meta?.env?.VITE_LOG_LEVEL || process.env?.VITE_LOG_LEVEL || (process.env?.NODE_ENV === 'development' ? 'debug' : 'info')).toLowerCase();
const current = LEVELS[envLevel] ?? LEVELS.info;

function gate(lvl) { return LEVELS[lvl] >= current; }

function emit(lvl, msg, data) {
  const ts = new Date().toISOString();
  const payload = data ? [msg, data] : [msg];
  if (lvl === 'error') return console.error(`[${ts}] [${lvl}]`, ...payload);
  if (lvl === 'warn') return console.warn(`[${ts}] [${lvl}]`, ...payload);
  if (lvl === 'info') return console.info(`[${ts}] [${lvl}]`, ...payload);
  return console.debug(`[${ts}] [${lvl}]`, ...payload);
}

const log = {
  debug(msg, data) { if (gate('debug')) emit('debug', msg, data); },
  info(msg, data)  { if (gate('info')) emit('info', msg, data); },
  warn(msg, data)  { if (gate('warn')) emit('warn', msg, data); },
  error(msg, data) { if (gate('error')) emit('error', msg, data); },
};

export default log;
