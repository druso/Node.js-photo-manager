const makeLogger = require('../utils/logger2');
const log = makeLogger('http');

function accessLog() {
  return function(req, res, next) {
    const start = process.hrtime.bigint();
    const { method, originalUrl } = req;
    res.on('finish', () => {
      const durMs = Number(process.hrtime.bigint() - start) / 1e6;
      log.info('access', log.withReq(req, { status: res.statusCode, dur_ms: Math.round(durMs), content_length: res.getHeader('Content-Length') }));
    });
    next();
  };
}

module.exports = accessLog;
