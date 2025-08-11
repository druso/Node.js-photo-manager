// API client for uploads-related operations

export async function analyzeFiles(folder, files) {
  const res = await fetch(`/api/projects/${encodeURIComponent(folder)}/analyze-files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files })
  });
  if (!res.ok) throw new Error(`analyzeFiles failed: ${res.status}`);
  return res.json();
}

// Note: Upload with progress is handled in the UploadContext via XMLHttpRequest.
// This function is provided for future use if progress is not required.
export async function uploadFiles(folder, fileList) {
  const formData = new FormData();
  fileList.forEach(file => formData.append('photos', file));
  const res = await fetch(`/api/projects/${encodeURIComponent(folder)}/upload`, {
    method: 'POST',
    body: formData
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Removed deprecated generateThumbnails/generatePreviews. Use processPerImage() instead.

export async function getProgress(folder) {
  const res = await fetch(`/api/projects/${encodeURIComponent(folder)}/progress`);
  if (!res.ok) throw new Error(`getProgress failed: ${res.status}`);
  return res.json();
}

export async function processPerImage(folder, { force } = {}) {
  const q = force ? '?force=true' : '';
  const res = await fetch(`/api/projects/${encodeURIComponent(folder)}/process${q}`, { method: 'POST' });
  if (!res.ok) throw new Error(`processPerImage failed: ${res.status}`);
  return res.json();
}
