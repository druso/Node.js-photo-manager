// API client for project-level operations

export async function listProjects() {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error(`listProjects failed: ${res.status}`);
  return res.json();
}

export async function getProject(folder) {
  const res = await fetch(`/api/projects/${encodeURIComponent(folder)}`);
  if (!res.ok) throw new Error(`getProject failed: ${res.status}`);
  return res.json();
}

export async function createProject(name) {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteProject(folder) {
  const res = await fetch(`/api/projects/${encodeURIComponent(folder)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
