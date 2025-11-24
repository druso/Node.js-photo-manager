const { ensureAuthConfig } = require('./authConfig');

const REFRESH_COOKIE_NAME = 'pm_refresh_token';
const ACCESS_COOKIE_NAME = 'pm_access_token';

function resolveSecureFlag(override) {
  if (typeof override === 'boolean') return override;
  if (process.env.AUTH_COOKIE_SECURE === 'false') return false;
  if (process.env.AUTH_COOKIE_SECURE === 'true') return true;
  return process.env.NODE_ENV !== 'development';
}

function resolveSameSiteFlag(override) {
  if (typeof override === 'string') return override;
  if (process.env.AUTH_COOKIE_SAMESITE) return process.env.AUTH_COOKIE_SAMESITE;
  return 'strict';
}

function buildRefreshCookieOptions(overrides = {}) {
  const config = ensureAuthConfig();
  return {
    httpOnly: overrides.httpOnly ?? true,
    secure: resolveSecureFlag(overrides.secure),
    sameSite: resolveSameSiteFlag(overrides.sameSite),
    path: overrides.path ?? '/api/auth/refresh',
    maxAge: overrides.maxAge ?? (config.jwt.refresh.expiresInSeconds * 1000),
    ...(overrides.domain ? { domain: overrides.domain } : {}),
  };
}

function buildAccessCookieOptions(overrides = {}) {
  const config = ensureAuthConfig();
  return {
    httpOnly: overrides.httpOnly ?? true,
    secure: resolveSecureFlag(overrides.secure),
    sameSite: resolveSameSiteFlag(overrides.sameSite),
    path: overrides.path ?? '/',
    maxAge: overrides.maxAge ?? (config.jwt.access.expiresInSeconds * 1000),
    ...(overrides.domain ? { domain: overrides.domain } : {}),
  };
}

function setRefreshTokenCookie(res, token, overrides = {}) {
  if (!res || typeof res.cookie !== 'function') {
    throw new Error('Response object with cookie() required');
  }
  const options = buildRefreshCookieOptions(overrides);
  res.cookie(REFRESH_COOKIE_NAME, token, options);
}

function clearRefreshTokenCookie(res, overrides = {}) {
  if (!res || typeof res.clearCookie !== 'function') {
    throw new Error('Response object with clearCookie() required');
  }
  const options = buildRefreshCookieOptions({ ...overrides, maxAge: 0 });
  res.clearCookie(REFRESH_COOKIE_NAME, options);
}

function setAccessTokenCookie(res, token, overrides = {}) {
  if (!res || typeof res.cookie !== 'function') {
    throw new Error('Response object with cookie() required');
  }
  const options = buildAccessCookieOptions(overrides);
  res.cookie(ACCESS_COOKIE_NAME, token, options);
}

function clearAccessTokenCookie(res, overrides = {}) {
  if (!res || typeof res.clearCookie !== 'function') {
    throw new Error('Response object with clearCookie() required');
  }
  const options = buildAccessCookieOptions({ ...overrides, maxAge: 0 });
  res.clearCookie(ACCESS_COOKIE_NAME, options);
}

function clearAuthCookies(res, overrides = {}) {
  clearAccessTokenCookie(res, overrides);
  clearRefreshTokenCookie(res, overrides);
}

module.exports = {
  REFRESH_COOKIE_NAME,
  ACCESS_COOKIE_NAME,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  setAccessTokenCookie,
  clearAccessTokenCookie,
  buildRefreshCookieOptions,
  buildAccessCookieOptions,
  clearAuthCookies,
};
