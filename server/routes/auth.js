const express = require('express');
const makeLogger = require('../utils/logger2');
const { verifyAdminPassword } = require('../services/auth/passwordUtils');
const {
  setRefreshTokenCookie,
  setAccessTokenCookie,
  clearAuthCookies,
  REFRESH_COOKIE_NAME,
} = require('../services/auth/authCookieService');
const {
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
} = require('../services/auth/tokenService');
const {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} = require('../services/auth/authConfig');

const log = makeLogger('auth-routes');
const router = express.Router();
router.use(express.json());

function respondWithTokens(res, { accessToken, refreshToken }) {
  setAccessTokenCookie(res, accessToken);
  setRefreshTokenCookie(res, refreshToken);
  res.set('Cache-Control', 'no-store');
  res.json({
    admin: { role: 'admin' },
    accessToken,
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
  });
}

router.post('/login', async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  try {
    const ok = await verifyAdminPassword(password);
    if (!ok) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const accessToken = issueAccessToken({ sub: 'admin' });
    const refreshToken = issueRefreshToken({ sub: 'admin' });
    respondWithTokens(res, { accessToken, refreshToken });
  } catch (error) {
    log.error('login_failed', { message: error?.message, name: error?.name });
    clearAuthCookies(res);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/refresh', (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!token) {
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = verifyRefreshToken(token);
    const sub = decoded.sub || 'admin';
    const accessToken = issueAccessToken({ sub });
    const refreshToken = issueRefreshToken({ sub });
    respondWithTokens(res, { accessToken, refreshToken });
  } catch (error) {
    log.warn('refresh_failed', { message: error?.message, name: error?.name });
    clearAuthCookies(res);
    res.status(401).json({ error: 'Unauthorized' });
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookies(res);
  res.status(204).end();
});

module.exports = router;
