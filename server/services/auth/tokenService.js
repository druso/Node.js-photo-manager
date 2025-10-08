const jwt = require('jsonwebtoken');
const { ensureAuthConfig } = require('./authConfig');

function issueAccessToken(claims = {}) {
  const config = ensureAuthConfig();
  const payload = { ...claims };
  payload.role = 'admin';
  payload.tokenType = 'access';
  return jwt.sign(payload, config.jwt.access.secret, {
    expiresIn: config.jwt.access.expiresInSeconds,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

function issueRefreshToken(claims = {}) {
  const config = ensureAuthConfig();
  const payload = { ...claims };
  payload.role = 'admin';
  payload.tokenType = 'refresh';
  return jwt.sign(payload, config.jwt.refresh.secret, {
    expiresIn: config.jwt.refresh.expiresInSeconds,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

function verifyAccessToken(token) {
  const config = ensureAuthConfig();
  const decoded = jwt.verify(token, config.jwt.access.secret, {
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
  if (decoded.tokenType !== 'access') {
    const error = new Error('Invalid token type');
    error.code = 'ERR_INVALID_TOKEN_TYPE';
    throw error;
  }
  return decoded;
}

function verifyRefreshToken(token) {
  const config = ensureAuthConfig();
  const decoded = jwt.verify(token, config.jwt.refresh.secret, {
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
  if (decoded.tokenType !== 'refresh') {
    const error = new Error('Invalid token type');
    error.code = 'ERR_INVALID_TOKEN_TYPE';
    throw error;
  }
  return decoded;
}

module.exports = {
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
