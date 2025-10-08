function normalizeVisibilityParam(raw) {
  if (raw === undefined || raw === null) {
    return { value: null, error: null };
  }
  const str = String(raw).trim().toLowerCase();
  if (!str.length) {
    return { value: null, error: null };
  }
  if (str !== 'public' && str !== 'private') {
    return { value: null, error: 'visibility must be "public" or "private"' };
  }
  return { value: str, error: null };
}

function ensureValidVisibility(value) {
  if (value === null || value === undefined) {
    return { value: null, error: null };
  }
  const str = String(value).trim().toLowerCase();
  if (str !== 'public' && str !== 'private') {
    return { value: null, error: 'visibility must be "public" or "private"' };
  }
  return { value: str, error: null };
}

module.exports = {
  normalizeVisibilityParam,
  ensureValidVisibility,
};
