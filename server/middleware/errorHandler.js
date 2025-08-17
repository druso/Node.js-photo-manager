const makeLogger = require('../utils/logger2');
const log = makeLogger('errors');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  log.error('unhandled_error', log.withReq(req, { message: err?.message, stack: err?.stack }));
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: 'Internal Server Error' });
}

module.exports = errorHandler;
