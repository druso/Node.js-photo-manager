const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  MIN_BCRYPT_COST,
  MAX_BCRYPT_COST,
  ensureAuthConfig,
} = require('../authConfig');
const { withAuthEnv, withEnv } = require('./testUtils');

describe('authConfig', { concurrency: false }, () => {
test('ensureAuthConfig returns normalized config with defaults', async () => {
  await withAuthEnv({
    AUTH_BCRYPT_COST: null,
    AUTH_JWT_ISSUER: null,
    AUTH_JWT_AUDIENCE: null,
  }, async () => {
    const config = ensureAuthConfig();
    assert.equal(config.bcryptCost, 12);
    assert.equal(config.jwt.access.expiresInSeconds, ACCESS_TOKEN_TTL_SECONDS);
    assert.equal(config.jwt.refresh.expiresInSeconds, REFRESH_TOKEN_TTL_SECONDS);
    assert.equal(config.jwt.issuer, 'photo-manager');
    assert.equal(config.jwt.audience, 'photo-manager-admin');
  });
});

test('ensureAuthConfig respects env issuer/audience overrides and bcrypt cost', async () => {
  await withAuthEnv({
    AUTH_BCRYPT_COST: String(MIN_BCRYPT_COST),
    AUTH_JWT_ISSUER: 'custom-issuer',
    AUTH_JWT_AUDIENCE: 'custom-audience',
  }, async () => {
    const config = ensureAuthConfig();
    assert.equal(config.bcryptCost, MIN_BCRYPT_COST);
    assert.equal(config.jwt.issuer, 'custom-issuer');
    assert.equal(config.jwt.audience, 'custom-audience');
  });
});

test('ensureAuthConfig throws when bcrypt cost out of range', async () => {
  await withAuthEnv({ AUTH_BCRYPT_COST: String(MAX_BCRYPT_COST + 1) }, async () => {
    assert.throws(() => ensureAuthConfig(), /between/);
  });
});

test('ensureAuthConfig throws when bcrypt cost is non-integer', async () => {
  await withAuthEnv({ AUTH_BCRYPT_COST: 'abc' }, async () => {
    assert.throws(() => ensureAuthConfig(), /integer/);
  });
});

test('ensureAuthConfig throws when hash missing or invalid', async () => {
  await withAuthEnv({ AUTH_ADMIN_BCRYPT_HASH: '' }, async () => {
    assert.throws(() => ensureAuthConfig(), /AUTH_ADMIN_BCRYPT_HASH is required/);
  });
  await withAuthEnv({ AUTH_ADMIN_BCRYPT_HASH: 'not-a-hash' }, async () => {
    assert.throws(() => ensureAuthConfig(), /valid bcrypt hash/);
  });
});

test('ensureAuthConfig throws when JWT secrets missing', async () => {
  await withAuthEnv({ AUTH_JWT_SECRET_ACCESS: '' }, async () => {
    assert.throws(() => ensureAuthConfig(), /AUTH_JWT_SECRET_ACCESS is required/);
  });
  await withAuthEnv({ AUTH_JWT_SECRET_REFRESH: '' }, async () => {
    assert.throws(() => ensureAuthConfig(), /AUTH_JWT_SECRET_REFRESH is required/);
  });
});

});
