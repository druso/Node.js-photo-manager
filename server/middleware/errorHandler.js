const makeLogger = require('../utils/logger2');
const log = makeLogger('errors');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Infer a reasonable status code without over-upgrading to 500
  // Priority: explicit status on error -> current response status -> ENOENT => 404 -> default 500
  let inferredStatus = (
    (typeof err?.status === 'number' && err.status) ||
    (typeof err?.statusCode === 'number' && err.statusCode) ||
    (res.statusCode && res.statusCode >= 400 ? res.statusCode : undefined) ||
    (err?.code === 'ENOENT' ? 404 : undefined) ||
    500
  );

  // Map CORS denials to 403 Forbidden (the CORS middleware throws an error with this message)
  if (err && typeof err.message === 'string' && err.message.includes('CORS: Origin not allowed')) {
    inferredStatus = 403;
  }

  // If the request looks like a static asset and no explicit status is present, prefer 404
  const isAsset = /\.(?:js|css|png|jpe?g|gif|webp|svg|ico|map|txt|json)$/i.test(req?.path || '');
  const status = (!err?.status && !err?.statusCode && isAsset && err?.code !== 'EACCES')
    ? 404
    : inferredStatus;

  // Log with status and basic error context
  log.error('unhandled_error', log.withReq(req, {
    status,
    message: err?.message,
    code: err?.code,
    stack: err?.stack
  }));

  if (res.headersSent) return;
  // For non-JSON asset requests, still return JSON body (frontend will not parse it, but status is correct)
  const body = (status === 404)
    ? { error: 'Not Found' }
    : (status === 403 ? { error: 'Forbidden' } : { error: 'Internal Server Error' });
  res.status(status).json(body);
}

module.exports = errorHandler;
