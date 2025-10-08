const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const path = require('node:path');
const { withAuthEnv, loadFresh } = require('../../services/auth/__tests__/testUtils');

function cookiesExpireImmediately(setCookies = []) {
  return setCookies.every(
    (c) => /Max-Age=0/i.test(c) || /Expires=Thu, 01 Jan 1970 00:00:00 GMT/i.test(c)
  );
}

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const authRouterPath = path.join(__dirname, '..', 'auth');
  const authRouter = loadFresh(authRouterPath);
  app.use('/api/auth', authRouter);
  return app;
}

describe('auth routes negative paths', { concurrency: false }, () => {
  test('POST /api/auth/login rejects invalid password and clears cookies', async () => {
    await withAuthEnv({}, async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: 'wrong-password' });

      assert.equal(res.status, 401);
      assert.equal(res.body?.error, 'Invalid credentials');
      const setCookies = res.headers['set-cookie'] || [];
      assert.ok(setCookies.some(c => c.startsWith('pm_access_token=;')), 'access cookie cleared');
      assert.ok(setCookies.some(c => c.startsWith('pm_refresh_token=;')), 'refresh cookie cleared');
      assert.ok(cookiesExpireImmediately(setCookies), 'cookies set to expire immediately');
    });
  });

  test('POST /api/auth/refresh without refresh cookie returns 401 and clears cookies', async () => {
    await withAuthEnv({}, async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/auth/refresh');

      assert.equal(res.status, 401);
      assert.equal(res.body?.error, 'Unauthorized');
      const setCookies = res.headers['set-cookie'] || [];
      assert.ok(setCookies.some(c => c.startsWith('pm_access_token=;')), 'access cookie cleared');
      assert.ok(setCookies.some(c => c.startsWith('pm_refresh_token=;')), 'refresh cookie cleared');
      assert.ok(cookiesExpireImmediately(setCookies), 'cookies set to expire immediately');
    });
  });

  test('POST /api/auth/refresh with invalid refresh cookie returns 401 and clears cookies', async () => {
    await withAuthEnv({}, async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', ['pm_refresh_token=invalid-token']);

      assert.equal(res.status, 401);
      assert.equal(res.body?.error, 'Unauthorized');
      const setCookies = res.headers['set-cookie'] || [];
      assert.ok(setCookies.some(c => c.startsWith('pm_access_token=;')), 'access cookie cleared');
      assert.ok(setCookies.some(c => c.startsWith('pm_refresh_token=;')), 'refresh cookie cleared');
      assert.ok(cookiesExpireImmediately(setCookies), 'cookies set to expire immediately');
    });
  });
});
