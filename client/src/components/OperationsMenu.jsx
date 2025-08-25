import React, { useState, useEffect, useRef } from 'react';
// NOTE: This menu is strictly for ACTIONS on selected UI objects (photos): tagging, plan keep/delete, regenerate, etc.
// It is NOT the options/hamburger menu. Global options (Settings, Processes, Create Project) live in OptionsMenu.
import { updateTags } from '../api/tagsApi';
import { updateKeep } from '../api/keepApi';
import { useUpload } from '../upload/UploadContext';
import { useToast } from '../ui/toast/ToastContext';

export default function OperationsMenu({
  projectFolder,
  projectData,
  selectedPhotos,
  setSelectedPhotos,
  onTagsUpdated,
  onKeepBulkUpdated,
  onTagsBulkUpdated,
  config,
  trigger = 'label', // 'label' | 'hamburger'
  onRequestMove,
}) {
  const [open, setOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);
  const { actions: uploadActions } = useUpload();
  const rootRef = useRef(null);
  const toast = useToast();

  // Close when clicking outside the menu
  useEffect(() => {
    const handleDocClick = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, []);

  // Keep menu open regardless of selection size so Project actions remain accessible

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
      if (onTagsBulkUpdated) {
        onTagsBulkUpdated(updates);
      } else if (onTagsUpdated) {
        // backward-compat fallback: triggers refetch in parent
        onTagsUpdated();
      }
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
      if (onKeepBulkUpdated) {
        onKeepBulkUpdated(updates);
      } else if (onTagsUpdated) {
        // backward-compat fallback: triggers refetch in parent
        onTagsUpdated();
      }
      const total = projectData?.photos?.length || 0;
      let msg;
      if (!target.keep_jpg && !target.keep_raw) {
        msg = `${updates.length} planned for delete`;
      } else if (target.keep_jpg && !target.keep_raw) {
        msg = `Planned to keep only JPG for ${updates.length}`;
      } else {
        msg = `Planned to keep JPG + RAW for ${updates.length}`;
      }
      toast.show({ emoji: '📝', message: msg, variant: 'notification' });
    } catch (e) {
      console.error('OperationsMenu keep error:', e);
      alert(e.message || 'Failed to update keep flags');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <div>
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); if (!busy) setOpen(prev => !prev); }}
          disabled={busy}
          aria-disabled={busy}
          className={`inline-flex justify-center items-center w-full rounded-md border shadow-sm px-3 py-2 text-sm font-medium pointer-events-auto relative z-10 ${
            busy
              ? 'bg-gray-200 text-gray-500 border-gray-300 cursor-not-allowed'
              : 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300'
          }`}
          title={trigger === 'hamburger' ? 'Actions' : undefined}
        >
          {trigger === 'hamburger' ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          ) : (
            <>
              <span>Actions</span>
              <svg className="-mr-1 ml-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </>
          )}
        </button>
      </div>

      {open && (
        <div
          className="origin-top-right absolute right-0 mt-2 w-80 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 p-3 z-50 animate-slideDownFade"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* No project/global options here by design */}
          <div className="mb-3">
            <div className="text-xs text-gray-500 mb-2">Plan</div>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => applyKeep('none')}
                disabled={busy || selectedPhotos.size === 0}
                className="px-2 py-1.5 text-sm rounded-md bg-red-100 hover:bg-red-200 disabled:bg-gray-200 border border-red-200"
                title="Plan: Delete"
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

          {/* Maintenance */}
          <div className="mt-3 pt-3 border-t-0">
            <div className="text-xs text-gray-500 mb-2">Maintenance</div>
            <button
              onClick={() => uploadActions.startProcess({ thumbnails: true, previews: true, force: false, filenames: Array.from(selectedPhotos) })}
              disabled={selectedPhotos.size === 0}
              className={`w-full px-3 py-2 text-sm rounded-md border ${selectedPhotos.size === 0 ? 'bg-gray-200 text-gray-500 cursor-not-allowed border-gray-300' : 'bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-800'}`}
              title="Regenerate thumbnails and previews for selected"
            >
              Regenerate thumbnails & previews (selected)
            </button>
            <button
              onClick={() => { if (onRequestMove) onRequestMove(); }}
              disabled={selectedPhotos.size === 0}
              className={`w-full mt-2 px-3 py-2 text-sm rounded-md border ${selectedPhotos.size === 0 ? 'bg-gray-200 text-gray-500 cursor-not-allowed border-gray-300' : 'bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-800'}`}
              title="Move selected photos to another project"
            >
              Move to…
            </button>
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
      {/* Toasts are rendered by the global ToastContainer */}
    </div>
  );
}
