let accessToken = null;

export function setAuthAccessToken(token) {
  accessToken = token || null;
}

export function getAuthAccessToken() {
  return accessToken;
}

export async function authFetch(input, init = {}) {
  const headers = new Headers(init.headers || {});
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  const options = {
    credentials: 'include',
    ...init,
    headers,
  };
  return fetch(input, options);
}
