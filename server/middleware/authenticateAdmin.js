const makeLogger = require('../utils/logger2');
const { verifyAccessToken } = require('../services/auth/tokenService');
const { ACCESS_COOKIE_NAME } = require('../services/auth/authCookieService');

const log = makeLogger('authenticateAdmin');

function extractBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || !value) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}

function extractCookieToken(req) {
  const cookies = req.cookies || {};
  const raw = cookies[ACCESS_COOKIE_NAME];
  if (!raw || typeof raw !== 'string') return null;
  return raw.trim() || null;
}

function attachAdminToRequest(req) {
  const headerToken = extractBearerToken(req);
  const cookieToken = extractCookieToken(req);
  const token = headerToken || cookieToken;

  if (!token) {
    return { attached: false, reason: 'missing' };
  }

  try {
    const decoded = verifyAccessToken(token);
    if (decoded.role !== 'admin') {
      const error = new Error('admin role required');
      error.code = 'FORBIDDEN_ROLE';
      return { attached: false, reason: 'forbidden', error };
    }

    req.admin = {
      id: decoded.sub || 'admin',
      role: decoded.role,
      tokenId: decoded.jti || null,
      issuedAt: decoded.iat,
      expiresAt: decoded.exp,
      claims: decoded,
    };

    return { attached: true };
  } catch (error) {
    return { attached: false, reason: 'invalid', error };
  }
}

function authenticateAdmin(req, res, next) {
  const result = attachAdminToRequest(req);
  if (result.attached) {
    next();
    return;
  }

  if (result.error) {
    try {
      log.warn('access_token_invalid', {
        message: result.error?.message,
        name: result.error?.name,
        code: result.error?.code,
        path: req.originalUrl,
      });
    } catch (_) {
      // ignore logging failures
    }
  }

  res.status(401).json({ error: 'Authentication required' });
}

module.exports = authenticateAdmin;
module.exports.attachAdminToRequest = attachAdminToRequest;
