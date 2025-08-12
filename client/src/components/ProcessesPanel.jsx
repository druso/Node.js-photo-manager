import React, { useEffect, useMemo, useRef, useState } from 'react';
import { listJobs, openJobStream } from '../api/jobsApi';

export default function ProcessesPanel({ projectFolder, onClose, embedded = false }) {
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState({ status: '', type: '' });
  const [loading, setLoading] = useState(false);
  const esCloseRef = useRef(null);

  const refresh = async () => {
    if (!projectFolder) return;
    setLoading(true);
    try {
      const { jobs } = await listJobs(projectFolder, {
        status: filter.status || undefined,
        type: filter.type || undefined,
        limit: 50,
        offset: 0,
      });
      setJobs(jobs || []);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [projectFolder, filter.status, filter.type]);

  useEffect(() => {
    if (esCloseRef.current) { esCloseRef.current(); esCloseRef.current = null; }
    esCloseRef.current = openJobStream(async (evt) => {
      // Merge where possible; refresh if unknown or completed
      let found = false;
      setJobs(prev => {
        if (!prev || prev.length === 0) return prev;
        const idx = prev.findIndex(j => j.id === evt.id);
        if (idx === -1) return prev;
        found = true;
        const updated = { ...prev[idx], ...evt };
        const copy = prev.slice();
        copy[idx] = updated;
        return copy;
      });
      if (!found || evt.status === 'completed' || evt.status === 'failed' || evt.status === 'canceled') {
        // Ensure list reflects latest server state and ordering
        refresh();
      }
    });
    return () => { if (esCloseRef.current) { esCloseRef.current(); esCloseRef.current = null; } };
  }, [projectFolder]);

  const statusBadge = (s) => {
    const map = {
      queued: 'bg-gray-100 text-gray-800 border-gray-300',
      running: 'bg-blue-100 text-blue-800 border-blue-300',
      completed: 'bg-green-100 text-green-800 border-green-300',
      failed: 'bg-red-100 text-red-800 border-red-300',
      canceled: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    };
    return <span className={`px-2 py-0.5 text-xs rounded border ${map[s] || 'bg-gray-100 text-gray-800 border-gray-300'}`}>{s}</span>;
  };

  const JobRow = ({ j }) => {
    const pct = j.progress_total ? Math.min(100, Math.round(((j.progress_done || 0) / j.progress_total) * 100)) : null;
    const running = j.status === 'running' || j.status === 'queued';
    return (
      <div className="border rounded p-3 mb-2 bg-white">
        <div className="flex items-center justify-between">
          <div className="font-medium text-sm">{j.type} <span className="text-gray-400">#{j.id}</span></div>
          <div>{statusBadge(j.status)}</div>
        </div>
        <div className="text-xs text-gray-500 mt-1">{new Date(j.created_at).toLocaleString()}</div>
        <div className="mt-2">
          {pct != null ? (
            <div className="w-full h-2 bg-gray-200 rounded">
              <div className="h-2 bg-blue-500 rounded" style={{ width: `${pct}%` }} />
            </div>
          ) : running ? (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="inline-block h-3 w-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span>Working…</span>
            </div>
          ) : (
            <div className="text-sm text-gray-500">No progress</div>
          )}
        </div>
      </div>
    );
  };

  if (embedded) {
    return (
      <div>
        <div className="flex gap-2 mb-3">
          <select value={filter.status} onChange={(e) => setFilter(f => ({ ...f, status: e.target.value }))} className="border rounded px-2 py-1 text-sm">
            <option value="">All statuses</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="canceled">Canceled</option>
          </select>
          <select value={filter.type} onChange={(e) => setFilter(f => ({ ...f, type: e.target.value }))} className="border rounded px-2 py-1 text-sm">
            <option value="">All types</option>
            <option value="generate_derivatives">Generate derivatives</option>
            <option value="upload_postprocess">Upload post-process</option>
          </select>
        </div>
        <div className="overflow-auto max-h-[60vh]">
          {(() => {
            const active = (jobs || []).filter(j => j.status === 'queued' || j.status === 'running');
            const completed = (jobs || []).filter(j => j.status === 'completed').sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0,5);
            const others = (jobs || []).filter(j => !['queued','running','completed'].includes(j.status));
            const display = [...active, ...completed, ...others];
            if (display.length === 0) return (<div className="py-6 text-center text-gray-500">No jobs yet</div>);
            return display.map(j => (<JobRow key={j.id} j={j} />));
          })()}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold">Processes</div>
          <button className="text-gray-600 hover:text-black" onClick={onClose}>&times;</button>
        </div>
        <div className="p-4">
          <div className="flex gap-2 mb-3">
            <select value={filter.status} onChange={(e) => setFilter(f => ({ ...f, status: e.target.value }))} className="border rounded px-2 py-1 text-sm">
              <option value="">All statuses</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="canceled">Canceled</option>
            </select>
            <select value={filter.type} onChange={(e) => setFilter(f => ({ ...f, type: e.target.value }))} className="border rounded px-2 py-1 text-sm">
              <option value="">All types</option>
              <option value="generate_derivatives">Generate derivatives</option>
              <option value="upload_postprocess">Upload post-process</option>
            </select>
          </div>
          <div className="overflow-auto max-h-[55vh]">
            {(() => {
              const active = (jobs || []).filter(j => j.status === 'queued' || j.status === 'running');
              const completed = (jobs || []).filter(j => j.status === 'completed').sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0,5);
              const others = (jobs || []).filter(j => !['queued','running','completed'].includes(j.status));
              const display = [...active, ...completed, ...others];
              if (display.length === 0) return (<div className="py-6 text-center text-gray-500">No jobs yet</div>);
              return display.map(j => (<JobRow key={j.id} j={j} />));
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
