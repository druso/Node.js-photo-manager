// API client for uploads-related operations
import { authFetch } from './httpClient';

export async function analyzeFiles(folder, files) {
  const fileMetadata = files.map(file => ({
    name: file.name,
    type: file.type
  }));
  
  const res = await authFetch(`/api/projects/${encodeURIComponent(folder)}/analyze-files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: fileMetadata })
  });
  if (!res.ok) throw new Error(`analyzeFiles failed: ${res.status}`);
  return res.json();
}

// Removed deprecated generateThumbnails/generatePreviews. Use processPerImage() instead.
// Removed unused uploadFiles() and getProgress() functions - no longer used by the application.

export async function processPerImage(folder, { force, filenames } = {}) {
  const q = force ? '?force=true' : '';
  const hasSubset = Array.isArray(filenames) && filenames.length > 0;
  const res = await authFetch(`/api/projects/${encodeURIComponent(folder)}/process${q}`, {
    method: 'POST',
    headers: hasSubset ? { 'Content-Type': 'application/json' } : undefined,
    body: hasSubset ? JSON.stringify({ filenames }) : undefined,
  });
  if (!res.ok) throw new Error(`processPerImage failed: ${res.status}`);
  return res.json();
}
