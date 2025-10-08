const bcrypt = require('bcrypt');
const {
  ensureAuthConfig,
  DEFAULT_BCRYPT_COST,
  MIN_BCRYPT_COST,
  MAX_BCRYPT_COST,
  parseBcryptCost,
} = require('./authConfig');

async function verifyAdminPassword(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    return false;
  }
  const { adminHash } = ensureAuthConfig();
  try {
    return await bcrypt.compare(plaintext, adminHash);
  } catch (error) {
    return false;
  }
}

async function generateAdminPasswordHash(password, costOverride, options = {}) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  const { bcryptCost: configCost } = options.skipConfig
    ? { bcryptCost: DEFAULT_BCRYPT_COST }
    : ensureAuthConfig();
  const cost = resolveBcryptCost(costOverride, configCost);
  return bcrypt.hash(password, cost);
}

function resolveBcryptCost(override, fallback) {
  if (override !== undefined && override !== null) {
    return coerceCost(override);
  }
  return coerceCost(fallback);
}

function coerceCost(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value < MIN_BCRYPT_COST || value > MAX_BCRYPT_COST) {
      throw new Error(`Bcrypt cost must be between ${MIN_BCRYPT_COST} and ${MAX_BCRYPT_COST}`);
    }
    return value;
  }
  return parseBcryptCost(value);
}

module.exports = {
  verifyAdminPassword,
  generateAdminPasswordHash,
  DEFAULT_BCRYPT_COST,
};
