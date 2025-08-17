// Simple in-memory rate limiter middleware (per-process)
// Usage: const limiter = rateLimit({ windowMs: 5*60*1000, max: 10, keyGenerator: (req)=> req.ip })
// Notes:
// - For single-instance deployments this is sufficient. For clustered/multi-instance, use a shared store (e.g., Redis).

function rateLimit({ windowMs = 60000, max = 60, keyGenerator, onLimitReached }) {
  const hits = new Map(); // key -> { count, resetAt }
  const getKey = keyGenerator || ((req) => req.ip || 'unknown');

  function cleanup(now) {
    // Opportunistic cleanup of expired buckets to keep memory bounded
    for (const [k, v] of hits) {
      if (v.resetAt <= now) hits.delete(k);
    }
  }

  return function(req, res, next) {
    const now = Date.now();
    const key = getKey(req);
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      cleanup(now);
      return next();
    }
    if (entry.count < max) {
      entry.count++;
      return next();
    }
    if (typeof onLimitReached === 'function') {
      try { onLimitReached(req, res, key); } catch (_) {}
    }
    res.status(429).json({ error: 'Too Many Requests', retry_after_ms: entry.resetAt - now });
  };
}

module.exports = { rateLimit };
