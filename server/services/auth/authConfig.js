const makeLogger = require('../../utils/logger2');

const log = makeLogger('authConfig');

const MIN_BCRYPT_COST = 8;
const MAX_BCRYPT_COST = 14;
const DEFAULT_BCRYPT_COST = 12;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

let cachedConfig = null;

function parseBcryptCost(rawCost) {
  if (rawCost === undefined || rawCost === null || rawCost === '') {
    return DEFAULT_BCRYPT_COST;
  }
  const parsed = Number(rawCost);
  if (!Number.isInteger(parsed)) {
    throw new Error('AUTH_BCRYPT_COST must be an integer');
  }
  if (parsed < MIN_BCRYPT_COST || parsed > MAX_BCRYPT_COST) {
    throw new Error(`AUTH_BCRYPT_COST must be between ${MIN_BCRYPT_COST} and ${MAX_BCRYPT_COST}`);
  }
  return parsed;
}

function validateBcryptHash(hash) {
  const bcryptRegex = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
  if (!bcryptRegex.test(hash)) {
    throw new Error('AUTH_ADMIN_BCRYPT_HASH must be a valid bcrypt hash');
  }
}

function requireEnv(name, env) {
  const value = env[name];
  if (!value || typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function buildAuthConfig(env = process.env) {
  const adminHash = requireEnv('AUTH_ADMIN_BCRYPT_HASH', env);
  validateBcryptHash(adminHash);

  const accessSecret = requireEnv('AUTH_JWT_SECRET_ACCESS', env);
  const refreshSecret = requireEnv('AUTH_JWT_SECRET_REFRESH', env);

  const bcryptCost = parseBcryptCost(env.AUTH_BCRYPT_COST);

  return {
    adminHash,
    bcryptCost,
    jwt: {
      access: {
        secret: accessSecret,
        expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      },
      refresh: {
        secret: refreshSecret,
        expiresInSeconds: REFRESH_TOKEN_TTL_SECONDS,
      },
      issuer: env.AUTH_JWT_ISSUER || 'photo-manager',
      audience: env.AUTH_JWT_AUDIENCE || 'photo-manager-admin',
    },
  };
}

function ensureAuthConfig(env = process.env) {
  if (cachedConfig) {
    return cachedConfig;
  }
  try {
    cachedConfig = buildAuthConfig(env);
    return cachedConfig;
  } catch (error) {
    try {
      log.error('auth_config_invalid', { message: error?.message });
    } catch (_) {
      // ignore logging failures during boot
    }
    throw error;
  }
}

function resetAuthConfigCache() {
  cachedConfig = null;
}

module.exports = {
  MIN_BCRYPT_COST,
  MAX_BCRYPT_COST,
  DEFAULT_BCRYPT_COST,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  buildAuthConfig,
  ensureAuthConfig,
  resetAuthConfigCache,
  parseBcryptCost,
};
