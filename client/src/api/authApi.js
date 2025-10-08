import { authFetch, setAuthAccessToken, getAuthAccessToken } from './httpClient';

async function readJsonOrThrow(res) {
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    const message = data?.error || data?.message || `Request failed: ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.body = data;
    throw error;
  }
  return data;
}

export async function login(password) {
  const res = await authFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await readJsonOrThrow(res);
  setAuthAccessToken(data.accessToken || null);
  return data;
}

export async function refreshAccessToken() {
  const res = await authFetch('/api/auth/refresh', {
    method: 'POST',
  });
  const data = await readJsonOrThrow(res);
  setAuthAccessToken(data.accessToken || null);
  return data;
}

export async function logout() {
  await authFetch('/api/auth/logout', {
    method: 'POST',
  });
  setAuthAccessToken(null);
}

export function hasAccessToken() {
  return !!getAuthAccessToken();
}
