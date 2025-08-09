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

// Note: Upload with progress is still handled in PhotoUpload via XMLHttpRequest.
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

export async function generateThumbnails(folder) {
  const res = await fetch(`/api/projects/${encodeURIComponent(folder)}/generate-thumbnails`, {
    method: 'POST'
  });
  if (!res.ok) throw new Error(`generateThumbnails failed: ${res.status}`);
  return res.json();
}
