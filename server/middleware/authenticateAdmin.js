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

function authenticateAdmin(req, res, next) {
  try {
    const headerToken = extractBearerToken(req);
    const cookieToken = extractCookieToken(req);
    const token = headerToken || cookieToken;
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const decoded = verifyAccessToken(token);
    if (decoded.role !== 'admin') {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    req.admin = {
      id: decoded.sub || 'admin',
      role: decoded.role,
      tokenId: decoded.jti || null,
      issuedAt: decoded.iat,
      expiresAt: decoded.exp,
      claims: decoded,
    };
    next();
  } catch (error) {
    try {
      log.warn('access_token_invalid', {
        message: error?.message,
        name: error?.name,
        code: error?.code,
        path: req.originalUrl,
      });
    } catch (_) {
      // ignore logging failures
    }
    res.status(401).json({ error: 'Authentication required' });
  }
}

module.exports = authenticateAdmin;
