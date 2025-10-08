// Jobs/Tasks API client for async pipeline
import { authFetch, getAuthAccessToken } from './httpClient';
import { EventSourcePolyfill } from 'event-source-polyfill';

// Start a task for a project
// Dev-only logger (Vite: import.meta.env.DEV)
let __isDev = false;
try { __isDev = !!(import.meta && import.meta.env && import.meta.env.DEV); } catch (_) { /* non-Vite/non-ESM */ }
const __devLog = (...args) => { try { if (__isDev) console.info(...args); } catch (_) {} };
export async function startTask(folder, { task_type, source = 'client', items = null } = {}) {
  if (!task_type) throw new Error('startTask: task_type is required');
  const res = await authFetch(`/api/projects/${encodeURIComponent(folder)}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_type, source, items }),
  });
  if (!res.ok) throw new Error(`startTask failed: ${res.status}`);
  return res.json(); // { task }
}

export async function listJobs(folder, { status, type, limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (type) params.set('type', type);
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await authFetch(`/api/projects/${encodeURIComponent(folder)}/jobs${qs}`);
  if (!res.ok) throw new Error(`listJobs failed: ${res.status}`);
  return res.json(); // { jobs }
}

export async function getJob(id) {
  const res = await authFetch(`/api/jobs/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`getJob failed: ${res.status}`);
  return res.json(); // { job, items_summary, total_items }
}

// Open an SSE stream. Returns a function to close it.
// Singleton SSE connection shared across consumers to avoid hitting server IP limits
// Persist on globalThis/window to survive Vite HMR reloads
const __g = (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : {}));
__g.__jobsSse ||= { es: null, listeners: new Set(), lastError: null, teardownTimer: null };
let __jobEs = __g.__jobsSse.es;
let __jobEsListeners = __g.__jobsSse.listeners;
let __jobEsLastError = __g.__jobsSse.lastError;
let __jobEsTeardownTimer = __g.__jobsSse.teardownTimer;

export function openJobStream(onMessage) {
  if (onMessage && typeof onMessage === 'function') {
    __jobEsListeners.add(onMessage);
  }
  // Establish the shared connection if needed
  if (!__jobEs) {
    try { if (__jobEsTeardownTimer) { clearTimeout(__jobEsTeardownTimer); __jobEsTeardownTimer = null; } } catch {}
    const token = getAuthAccessToken();
    __jobEs = token
      ? new EventSourcePolyfill('/api/jobs/stream', {
          headers: { Authorization: `Bearer ${token}` },
          withCredentials: true,
        })
      : new EventSource('/api/jobs/stream');
    __devLog('[SSE] connecting to /api/jobs/stream ...');
    __jobEs.onopen = () => {
      __devLog('[SSE] connected');
    };
    __jobEs.onmessage = (evt) => {
      let data = null;
      try { data = JSON.parse(evt.data); } catch { return; }
      __devLog('[SSE] message', data && data.type ? data.type : '(no type)', data);
      __jobEsListeners.forEach(fn => { try { fn(data); } catch {} });
    };
    __jobEs.onerror = (e) => {
      __jobEsLastError = e || true;
      __devLog('[SSE] error', e);
      // Let the browser auto-reconnect; don't tear down listeners
    };
    // Save back to global so subsequent HMR modules reuse it
    __g.__jobsSse.es = __jobEs;
    __g.__jobsSse.listeners = __jobEsListeners;
    __g.__jobsSse.lastError = __jobEsLastError;
    __g.__jobsSse.teardownTimer = __jobEsTeardownTimer;
  }

  // Return an unsubscribe that removes the listener and possibly tears down the ES
  return () => {
    if (onMessage && typeof onMessage === 'function') {
      __jobEsListeners.delete(onMessage);
    }
    // If no more listeners, close the ES after a short grace period to prevent flapping
    if (__jobEs && __jobEsListeners.size === 0) {
      try { if (__jobEsTeardownTimer) clearTimeout(__jobEsTeardownTimer); } catch {}
      __jobEsTeardownTimer = setTimeout(() => {
        try { __jobEs.close(); } catch {}
        __jobEs = null;
        __jobEsLastError = null;
        __jobEsTeardownTimer = null;
        // reflect in global store
        __g.__jobsSse.es = null;
        __g.__jobsSse.lastError = null;
        __g.__jobsSse.teardownTimer = null;
      }, 1500);
    }
  };
}

// Fetch task definitions (labels, user_relevant, steps)
export async function fetchTaskDefinitions() {
  const res = await authFetch('/api/tasks/definitions');
  if (!res.ok) throw new Error(`fetchTaskDefinitions failed: ${res.status}`);
  return res.json();
}
