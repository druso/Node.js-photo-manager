export async function updateTags(projectFolder, updates) {
  const res = await fetch(`/api/projects/${projectFolder}/tags`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates }),
  });
  if (!res.ok) {
    let msg = 'Failed to update tags';
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}
