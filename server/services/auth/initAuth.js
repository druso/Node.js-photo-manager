const makeLogger = require('../../utils/logger2');
const { ensureAuthConfig } = require('./authConfig');

function initAuth(options = {}) {
  const log = options.log || makeLogger('authInit');
  const exitFn = typeof options.exit === 'function' ? options.exit : (code => process.exit(code));
  const env = options.env || process.env;

  try {
    const config = ensureAuthConfig(env);
    log.info('auth_config_loaded');
    return config;
  } catch (error) {
    log.error('auth_config_invalid', { message: error?.message });
    exitFn(1);
    return null;
  }
}

module.exports = {
  initAuth,
};
