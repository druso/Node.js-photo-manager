// API client for project-level operations
import { authFetch } from './httpClient';

export async function listProjects() {
  const res = await authFetch('/api/projects');
  if (!res.ok) throw new Error(`listProjects failed: ${res.status}`);
  return res.json();
}

export async function getProject(folder) {
  const res = await authFetch(`/api/projects/${encodeURIComponent(folder)}`);
  if (!res.ok) throw new Error(`getProject failed: ${res.status}`);
  return res.json();
}

export async function createProject(name) {
  const res = await authFetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteProject(folder) {
  const res = await authFetch(`/api/projects/${encodeURIComponent(folder)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function renameProjectById(id, name) {
  const res = await authFetch(`/api/projects/${encodeURIComponent(String(id))}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getConfig() {
  const res = await authFetch('/api/config');
  if (!res.ok) throw new Error(`getConfig failed: ${res.status}`);
  return res.json();
}
