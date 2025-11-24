const path = require('path');
const fs = require('fs-extra');
const makeLogger = require('../utils/logger2');
const log = makeLogger('config');

const ROOT = path.join(__dirname, '..', '..');
// Store config.json in .projects directory to avoid Docker permission issues
// .projects is already mounted with write permissions
const CONFIG_PATH = path.join(ROOT, '.projects', 'config.json');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config.default.json');

function ensureConfig() {
  // Create config.json from defaults if it doesn't exist
  if (!fs.existsSync(CONFIG_PATH)) {
    try {
      fs.copySync(DEFAULT_CONFIG_PATH, CONFIG_PATH);
      log.info('config_created_from_defaults', { path: CONFIG_PATH });
    } catch (err) {
      log.error('config_creation_failed', {
        path: CONFIG_PATH,
        error: err?.message
      });
      throw err;
    }
  }
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const [k, v] of Object.entries(source || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(out[k] || {}, v);
    } else if (out[k] === undefined) {
      out[k] = v;
    }
  }
  return out;
}

function getConfig() {
  ensureConfig();
  const defaults = fs.readJsonSync(DEFAULT_CONFIG_PATH);
  const current = fs.readJsonSync(CONFIG_PATH);
  // Merge defaults into current for missing keys (do not overwrite existing values)
  const merged = deepMerge(current || {}, defaults || {});
  // Persist merged config to disk if it added any missing defaults
  try {
    const before = JSON.stringify(current || {});
    const after = JSON.stringify(merged || {});
    if (before !== after) {
      fs.writeJsonSync(CONFIG_PATH, merged, { spaces: 2 });
    }
  } catch (e) {
    // Non-fatal: log and continue returning merged
    log.warn('persist_merged_config_failed', { error: e && e.message });
  }
  return merged;
}

module.exports = { getConfig };
