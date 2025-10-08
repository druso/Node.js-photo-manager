const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { withAuthEnv, loadFresh } = require('./testUtils');

describe('tokenService', { concurrency: false }, () => {
  test('issueAccessToken embeds claims and verifies successfully', async () => {
    await withAuthEnv({}, async () => {
      const tokenService = loadFresh('../tokenService');
      const token = tokenService.issueAccessToken({ subject: 'admin' });
      const decoded = tokenService.verifyAccessToken(token);
      assert.equal(decoded.subject, 'admin');
      assert.equal(decoded.role, 'admin');
      assert.equal(decoded.tokenType, 'access');
      assert.ok(decoded.exp > decoded.iat);
      assert.equal(decoded.iss, 'photo-manager');
      assert.equal(decoded.aud, 'photo-manager-admin');
    });
  });

  test('issueRefreshToken verifies and distinguishes token type', async () => {
    await withAuthEnv({}, async () => {
      const tokenService = loadFresh('../tokenService');
      const refreshToken = tokenService.issueRefreshToken({ sessionId: 'abc' });
      const decoded = tokenService.verifyRefreshToken(refreshToken);
      assert.equal(decoded.sessionId, 'abc');
      assert.equal(decoded.tokenType, 'refresh');
      assert.equal(decoded.role, 'admin');
    });
  });

  test('verifyAccessToken rejects refresh token and invalid signature', async () => {
    await withAuthEnv({
      AUTH_JWT_SECRET_ACCESS: 'shared-secret',
      AUTH_JWT_SECRET_REFRESH: 'shared-secret',
    }, async () => {
      const tokenService = loadFresh('../tokenService');
      const refreshToken = tokenService.issueRefreshToken({});
      assert.throws(() => tokenService.verifyAccessToken(refreshToken), /Invalid token type/);
      const invalid = jwt.sign({ tokenType: 'access' }, 'wrong-secret');
      assert.throws(() => tokenService.verifyAccessToken(invalid));
    });
  });

  test('verifyRefreshToken rejects access token', async () => {
    await withAuthEnv({
      AUTH_JWT_SECRET_ACCESS: 'shared-secret',
      AUTH_JWT_SECRET_REFRESH: 'shared-secret',
    }, async () => {
      const tokenService = loadFresh('../tokenService');
      const accessToken = tokenService.issueAccessToken({});
      assert.throws(() => tokenService.verifyRefreshToken(accessToken), /Invalid token type/);
    });
  });
});
