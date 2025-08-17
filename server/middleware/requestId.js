const crypto = require('crypto');

function requestId(opts = {}) {
  return function(req, res, next) {
    if (!req.id) {
      try {
        req.id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString('hex');
      } catch (_) {
        req.id = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
      }
    }
    res.setHeader('X-Request-Id', req.id);
    next();
  };
}

module.exports = requestId;
