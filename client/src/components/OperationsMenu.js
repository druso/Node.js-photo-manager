import React, { useState } from 'react';
import { updateTags } from '../api/tagsApi';

export default function OperationsMenu({
  projectFolder,
  projectData,
  selectedPhotos,
  setSelectedPhotos,
  onTagsUpdated,
}) {
  const [open, setOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="relative inline-block text-left">
      <div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex justify-center w-full rounded-md border border-gray-300 shadow-sm px-3 py-2 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Operations
          <svg className="-mr-1 ml-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="origin-top-right absolute right-0 mt-2 w-80 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 p-3 z-10">
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
    </div>
  );
}
