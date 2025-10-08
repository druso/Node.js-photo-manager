const bcrypt = require('bcrypt');
const { resetAuthConfigCache } = require('../authConfig');

const SAMPLE_HASH = bcrypt.hashSync('password', 10);

function baseAuthEnv(overrides = {}) {
  const env = {
    AUTH_ADMIN_BCRYPT_HASH: SAMPLE_HASH,
    AUTH_JWT_SECRET_ACCESS: 'test-access-secret',
    AUTH_JWT_SECRET_REFRESH: 'test-refresh-secret',
    ...overrides,
  };
  return env;
}

async function withEnv(env, fn) {
  const keys = Object.keys(env);
  const previous = {};
  for (const key of keys) {
    previous[key] = process.env[key];
    const value = env[key];
    if (value === null || value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetAuthConfigCache();
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
    resetAuthConfigCache();
  }
}

function withAuthEnv(overrides = {}, fn) {
  return withEnv(baseAuthEnv(overrides), fn);
}

function loadFresh(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

module.exports = {
  SAMPLE_HASH,
  baseAuthEnv,
  withEnv,
  withAuthEnv,
  loadFresh,
};
