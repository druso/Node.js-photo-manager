// Jobs/Tasks API client for async pipeline

// Start a task for a project
export async function startTask(folder, { task_type, source = 'client', items = null } = {}) {
  if (!task_type) throw new Error('startTask: task_type is required');
  const res = await fetch(`/api/projects/${encodeURIComponent(folder)}/jobs`, {
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
  const res = await fetch(`/api/projects/${encodeURIComponent(folder)}/jobs${qs}`);
  if (!res.ok) throw new Error(`listJobs failed: ${res.status}`);
  return res.json(); // { jobs }
}

export async function getJob(id) {
  const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`getJob failed: ${res.status}`);
  return res.json(); // { job, items_summary, total_items }
}

// Open an SSE stream. Returns a function to close it.
export function openJobStream(onMessage) {
  const es = new EventSource('/api/jobs/stream');
  es.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      onMessage && onMessage(data);
    } catch (_) {}
  };
  es.onerror = () => {
    // Rely on browser's automatic reconnection; keep using relative URL through Vite proxy
  };
  return () => { try { es.close(); } catch (_) {} };
}

// Fetch task definitions (labels, user_relevant, steps)
export async function fetchTaskDefinitions() {
  const res = await fetch('/api/tasks/definitions');
  if (!res.ok) throw new Error(`fetchTaskDefinitions failed: ${res.status}`);
  return res.json();
}
