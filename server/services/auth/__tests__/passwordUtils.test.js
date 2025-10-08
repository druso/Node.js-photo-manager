const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { withAuthEnv, loadFresh, SAMPLE_HASH } = require('./testUtils');

test('verifyAdminPassword validates plaintext against configured hash', async () => {
  await withAuthEnv({}, async () => {
    const { verifyAdminPassword } = loadFresh('../passwordUtils');
    assert.equal(await verifyAdminPassword('password'), true);
    assert.equal(await verifyAdminPassword('wrong'), false);
  });
});

test('verifyAdminPassword returns false for empty input and handles errors', async () => {
  await withAuthEnv({}, async () => {
    const { verifyAdminPassword } = loadFresh('../passwordUtils');
    assert.equal(await verifyAdminPassword(''), false);
    assert.equal(await verifyAdminPassword(null), false);
  });
});

test('generateAdminPasswordHash uses configured cost by default', async () => {
  await withAuthEnv({}, async () => {
    const { generateAdminPasswordHash } = loadFresh('../passwordUtils');
    const hash = await generateAdminPasswordHash('secret');
    assert.equal(bcrypt.getRounds(hash), 12);
    assert.equal(await bcrypt.compare('secret', hash), true);
  });
});

test('generateAdminPasswordHash accepts override cost within bounds', async () => {
  await withAuthEnv({ AUTH_BCRYPT_COST: '10' }, async () => {
    const { generateAdminPasswordHash } = loadFresh('../passwordUtils');
    const hash = await generateAdminPasswordHash('secret', 9);
    assert.equal(bcrypt.getRounds(hash), 9);
  });
});

test('generateAdminPasswordHash rejects override cost outside allowed range', async () => {
  await withAuthEnv({ AUTH_BCRYPT_COST: '10' }, async () => {
    const { generateAdminPasswordHash } = loadFresh('../passwordUtils');
    await assert.rejects(() => generateAdminPasswordHash('secret', 4), /between 8 and 14/);
    await assert.rejects(() => generateAdminPasswordHash('secret', 20), /between 8 and 14/);
  });
});

test('generateAdminPasswordHash can bootstrap without auth config when skipConfig provided', async () => {
  await withAuthEnv({
    AUTH_ADMIN_BCRYPT_HASH: null,
    AUTH_JWT_SECRET_ACCESS: null,
    AUTH_JWT_SECRET_REFRESH: null,
  }, async () => {
    const { generateAdminPasswordHash, DEFAULT_BCRYPT_COST } = loadFresh('../passwordUtils');
    const hash = await generateAdminPasswordHash('bootstrap-secret', undefined, { skipConfig: true });
    assert.equal(bcrypt.getRounds(hash), DEFAULT_BCRYPT_COST);
    assert.equal(await bcrypt.compare('bootstrap-secret', hash), true);
  });
});
