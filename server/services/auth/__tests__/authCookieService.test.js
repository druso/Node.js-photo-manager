const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { withAuthEnv, loadFresh } = require('./testUtils');

describe('authCookieService', { concurrency: false }, () => {
  test('setRefreshTokenCookie sets secure httpOnly cookie with defaults', async () => {
    await withAuthEnv({}, async () => {
      const service = loadFresh('../authCookieService');
      const calls = [];
      const clearCalls = [];
      const res = {
        cookie: (name, value, opts) => calls.push({ name, value, opts }),
        clearCookie: (name, opts) => clearCalls.push({ name, opts }),
      };
      service.setRefreshTokenCookie(res, 'refresh-token');
      assert.equal(calls.length, 1);
      const { name, value, opts } = calls[0];
      assert.equal(name, service.REFRESH_COOKIE_NAME);
      assert.equal(value, 'refresh-token');
      assert.equal(opts.httpOnly, true);
      assert.equal(opts.sameSite, 'strict');
      assert.equal(typeof opts.maxAge, 'number');
      assert.ok(opts.maxAge > 0);
    });
  });

  test('setAccessTokenCookie respects overrides', async () => {
    await withAuthEnv({}, async () => {
      const service = loadFresh('../authCookieService');
      const calls = [];
      const clearCalls = [];
      const res = {
        cookie: (name, value, opts) => calls.push({ name, value, opts }),
        clearCookie: (name, opts) => clearCalls.push({ name, opts }),
      };
      service.setAccessTokenCookie(res, 'access-token', {
        secure: false,
        sameSite: 'lax',
        domain: 'example.com',
        path: '/api',
        maxAge: 1000,
        httpOnly: false,
      });
      const { name, value, opts } = calls[0];
      assert.equal(name, service.ACCESS_COOKIE_NAME);
      assert.equal(value, 'access-token');
      assert.equal(opts.secure, false);
      assert.equal(opts.sameSite, 'lax');
      assert.equal(opts.domain, 'example.com');
      assert.equal(opts.path, '/api');
      assert.equal(opts.maxAge, 1000);
      assert.equal(opts.httpOnly, false);
    });
  });

  test('clear cookies set zero maxAge', async () => {
    await withAuthEnv({}, async () => {
      const service = loadFresh('../authCookieService');
      const calls = [];
      const clearCalls = [];
      const res = {
        cookie: (name, value, opts) => calls.push({ name, value, opts }),
        clearCookie: (name, opts) => clearCalls.push({ name, opts }),
      };
      service.clearRefreshTokenCookie(res);
      service.clearAccessTokenCookie(res);
      assert.equal(clearCalls[0].name, service.REFRESH_COOKIE_NAME);
      assert.equal(clearCalls[0].opts.maxAge, 0);
      assert.equal(clearCalls[1].name, service.ACCESS_COOKIE_NAME);
      assert.equal(clearCalls[1].opts.maxAge, 0);
    });
  });
});
