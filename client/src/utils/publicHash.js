export function isPublicPhoto(photo) {
  return (photo?.visibility || 'private') === 'public';
}

export function getHashExpiry(photo) {
  if (!photo?.public_hash_expires_at) return null;
  try {
    const ts = new Date(photo.public_hash_expires_at);
    return Number.isNaN(ts.getTime()) ? null : ts;
  } catch {
    return null;
  }
}

export function hasFreshPublicHash(photo, now = new Date()) {
  if (!isPublicPhoto(photo)) return false;
  if (!photo?.public_hash) return false;
  const expiry = getHashExpiry(photo);
  if (!expiry) return true;
  return expiry.getTime() > now.getTime();
}

export function shouldRefreshPublicHash(photo, now = new Date()) {
  if (!isPublicPhoto(photo)) return false;
  if (!photo?.public_hash) return true;
  const expiry = getHashExpiry(photo);
  if (!expiry) return false;
  return expiry.getTime() <= now.getTime();
}

export function buildAssetUrl({ folder, type, filename, version, hash }) {
  if (!folder || !type || !filename) {
    throw new Error('folder, type, and filename are required to build asset url');
  }
  const encodedFolder = encodeURIComponent(folder);
  const encodedFilename = encodeURIComponent(filename);
  const params = new URLSearchParams();
  if (version != null) {
    params.set('v', String(version));
  }
  if (hash) {
    params.set('hash', String(hash));
  }
  const query = params.toString();
  return `/api/projects/${encodedFolder}/${type}/${encodedFilename}${query ? `?${query}` : ''}`;
}
