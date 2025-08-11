import React, { useState } from 'react';
import { updateTags } from '../api/tagsApi';
import { updateKeep } from '../api/keepApi';

export default function OperationsMenu({
  projectFolder,
  projectData,
  selectedPhotos,
  setSelectedPhotos,
  onTagsUpdated,
  config,
  previewModeEnabled,
}) {
  const [open, setOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState({ visible: false, text: '' });
  const showToast = (text) => {
    setToast({ visible: true, text });
    setTimeout(() => setToast({ visible: false, text: '' }), 1800);
  };

  const applyTags = async (mode) => {
    const input = tagInput.trim();
    if (!input || selectedPhotos.size === 0) return;
    const tagsArray = input.split(',').map(t => t.trim()).filter(Boolean);
    if (tagsArray.length === 0) return;

    const updates = Array.from(selectedPhotos).map(filename => {
      const entry = projectData.photos.find(e => e.filename === filename);
      const currentTags = entry ? entry.tags || [] : [];
      const next = mode === 'add'
        ? Array.from(new Set([...currentTags, ...tagsArray]))
        : currentTags.filter(t => !tagsArray.includes(t));
      return { filename, tags: next };
    });

    setBusy(true);
    try {
      await updateTags(projectFolder, updates);
      setTagInput('');
      setSelectedPhotos(new Set());
      onTagsUpdated && onTagsUpdated();
    } catch (e) {
      console.error('OperationsMenu tags error:', e);
      alert(e.message || 'Failed to update tags');
    } finally {
      setBusy(false);
    }
  };

  const applyKeep = async (mode) => {
    if (selectedPhotos.size === 0) return;
    let target;
    if (mode === 'none') target = { keep_jpg: false, keep_raw: false };
    else if (mode === 'jpg_only') target = { keep_jpg: true, keep_raw: false };
    else if (mode === 'raw_jpg') target = { keep_jpg: true, keep_raw: true };
    else return;

    const updates = Array.from(selectedPhotos).map(filename => ({ filename, ...target }));
    setBusy(true);
    try {
      await updateKeep(projectFolder, updates);
      setSelectedPhotos(new Set());
      onTagsUpdated && onTagsUpdated(); // reuse to trigger refresh
      const total = projectData?.photos?.length || 0;
      let msg;
      if (!target.keep_jpg && !target.keep_raw) {
        msg = `${updates.length} planned for delete`;
      } else if (target.keep_jpg && !target.keep_raw) {
        msg = `Planned to keep only JPG for ${updates.length}`;
      } else {
        msg = `Planned to keep JPG + RAW for ${updates.length}`;
      }
      if (previewModeEnabled) msg += ` • Preview mode ON`;
      showToast(msg);
    } catch (e) {
      console.error('OperationsMenu keep error:', e);
      alert(e.message || 'Failed to update keep flags');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative inline-block text-left">
      <div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex justify-center w-full rounded-md border border-gray-300 shadow-sm px-3 py-2 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Actions
          <svg className="-mr-1 ml-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="origin-top-right absolute right-0 mt-2 w-80 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 p-3 z-10">
          <div className="mb-3">
            <div className="text-xs text-gray-500 mb-2">Plan</div>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => applyKeep('none')}
                disabled={busy || selectedPhotos.size === 0}
                className="px-2 py-1.5 text-sm rounded-md bg-red-100 hover:bg-red-200 disabled:bg-gray-200 border border-red-200"
                title="Plan: Delete (hide in preview mode)"
              >Delete</button>
              <button
                onClick={() => applyKeep('jpg_only')}
                disabled={busy || selectedPhotos.size === 0}
                className="px-2 py-1.5 text-sm rounded-md bg-gray-100 hover:bg-gray-200 disabled:bg-gray-200 border border-gray-200"
                title="Plan: Keep JPG only"
              >JPG</button>
              <button
                onClick={() => applyKeep('raw_jpg')}
                disabled={busy || selectedPhotos.size === 0}
                className="px-2 py-1.5 text-sm rounded-md bg-gray-100 hover:bg-gray-200 disabled:bg-gray-200 border border-gray-200"
                title="Plan: Keep JPG + RAW"
              >JPG+RAW</button>
            </div>
          </div>
          <div className="mb-2">
            <div className="text-xs text-gray-500 mb-2">Tagging</div>
            <div className="flex">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder={selectedPhotos.size === 0 ? 'Select images first' : 'Comma-separated tags'}
                className="flex-grow p-2 border rounded-l-md"
                disabled={busy}
              />
              <button
                onClick={() => applyTags('add')}
                disabled={busy || selectedPhotos.size === 0 || !tagInput.trim()}
                className="px-3 py-2 bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-400"
                title="Add tags"
              >
                +
              </button>
              <button
                onClick={() => applyTags('remove')}
                disabled={busy || selectedPhotos.size === 0 || !tagInput.trim()}
                className="px-3 py-2 bg-red-500 text-white hover:bg-red-600 disabled:bg-gray-400 rounded-r-md"
                title="Remove tags"
              >
                -
              </button>
            </div>
          </div>

          {/* Future operations can go here */}
        </div>
      )}
      {/* Toast */}
      <div className={`fixed bottom-6 right-6 transition-all ${toast.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'} z-40`}>
        <div className="px-4 py-3 rounded-lg bg-black bg-opacity-85 text-white text-sm shadow-lg border-2 border-blue-400">
          {toast.text}
        </div>
      </div>
    </div>
  );
}
