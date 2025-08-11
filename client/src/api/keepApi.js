export async function updateKeep(folder, updates) {
  const res = await fetch(`/api/projects/${encodeURIComponent(folder)}/keep`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates })
  });
  if (!res.ok) {
    const msg = await res.text().catch(()=> '');
    throw new Error(msg || 'Failed to update keep flags');
  }
  return res.json();
}
