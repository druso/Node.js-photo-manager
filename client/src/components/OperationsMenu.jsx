import React, { useState, useEffect, useRef } from 'react';
// NOTE: This menu is strictly for ACTIONS on selected UI objects (photos): tagging, plan keep/delete, regenerate, etc.
// It is NOT the options/hamburger menu. Global options (Settings, Processes, Create Project) live in OptionsMenu.
import { batchAddTags, batchRemoveTags, batchUpdateKeep, batchProcessPhotos } from '../api/batchApi';
import { useUpload } from '../upload/UploadContext';
import { useToast } from '../ui/toast/ToastContext';
import useVisibilityMutation from '../hooks/useVisibilityMutation';

export default function OperationsMenu({
  projectFolder,
  projectData,
  selectedPhotos = new Set(),
  setSelectedPhotos,
  onTagsUpdated,
  onKeepBulkUpdated,
  onTagsBulkUpdated,
  onVisibilityBulkUpdated,
  config,
  trigger = 'label', // 'label' | 'hamburger'
  onRequestMove,
  onRequestShare, // NEW: callback to open share modal
  // All Photos mode props
  allMode = false,
  allSelectedKeys, // Set of 'project_folder::filename' (for backward compatibility)
  allSelectedPhotos, // NEW: Map<key, photo> with full photo objects
  setAllSelectedKeys,
  clearSelection, // NEW: Unified clear function
  allPhotos,
  selection,
  setSelection,
}) {
  const [open, setOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);
  const { actions: uploadActions } = useUpload();
  const rootRef = useRef(null);
  const toast = useToast();

  // Unified selection derivation
  const selectionCount = allSelectedPhotos instanceof Map ? allSelectedPhotos.size : (allMode ? (allSelectedKeys?.size || 0) : selectedPhotos.size);
  const selectionIsEmpty = selectionCount === 0;

  const visibilityMutation = useVisibilityMutation();

  // Close when clicking outside the menu
  useEffect(() => {
    const handleDocClick = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpen(false);
    };

    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, []);

  const collectSelectedItems = () => {
    // Prefer unified Map if available
    if (allSelectedPhotos instanceof Map) {
      const items = Array.from(allSelectedPhotos.values());
      // If in project mode, we might want to filter? 
      // But usually "Actions" apply to what is selected.
      // If I am in Project A, but I have selected items from Project B (via All Photos), 
      // and I open the menu, should I act on Project B items too?
      // Probably yes, if the selection is unified.
      return items;
    }

    // Fallback to legacy logic
    if (allMode) {
      const keys = Array.from(allSelectedKeys || []);
      if (!keys.length) return [];
      const photosList = Array.isArray(allPhotos) ? allPhotos : [];
      const map = new Map(photosList.map(photo => {
        const key = `${photo.project_folder || ''}::${photo.filename}`;
        return [key, photo];
      }));
      return keys.map(key => map.get(key)).filter(Boolean);
    } else {
      const photos = Array.isArray(projectData?.photos) ? projectData.photos : [];
      return Array.from(selectedPhotos)
        .map(key => {
          // Handle unified key "folder::filename" or legacy "filename"
          const parts = key.split('::');
          const filename = parts.length === 2 ? parts[1] : key;

          const entry = photos.find(p => p.filename === filename);
          if (!entry) return null;
          return {
            ...entry,
            project_folder: entry.project_folder || projectFolder || entry.folder || null,
          };
        })
        .filter(Boolean);
    }
  };

  const handleVisibilityChange = async (visibility) => {
    if (selectionIsEmpty) return;
    const selectedItems = collectSelectedItems();
    if (!selectedItems.length) {
      if (toast?.show) {
        toast.show({ emoji: '⚠️', message: 'Unable to resolve selected photos.', variant: 'warning' });
      }
      return;
    }

    try {
      setBusy(true);
      const result = await visibilityMutation.apply(selectedItems, visibility);
      const changed = Array.isArray(result?.changedItems) ? result.changedItems : [];
      if (changed.length && typeof onVisibilityBulkUpdated === 'function') {
        onVisibilityBulkUpdated(changed);
      }

      if (typeof clearSelection === 'function') {
        clearSelection();
      } else if (allMode) {
        if (typeof setAllSelectedKeys === 'function') setAllSelectedKeys(new Set());
      } else if (typeof setSelectedPhotos === 'function') {
        setSelectedPhotos(new Set());
      }

      if (Array.isArray(selection) && typeof setSelection === 'function') {
        const clearedIds = new Set(changed.map(item => `${item.project_folder || ''}::${item.filename}`));
        setSelection(prev => Array.isArray(prev)
          ? prev.filter(ref => !clearedIds.has(`${ref.project_folder || ''}::${ref.filename}`))
          : prev);
      }
    } catch (err) {
      console.error('Visibility update failed', err);
      toast?.show?.({ emoji: '⚠️', message: err?.message || 'Failed to update visibility.', variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // Keep menu open regardless of selection size so Project actions remain accessible

  const applyTags = async (mode) => {
    const input = tagInput.trim();
    if (!input || projectSelected.size === 0) return;
    if (!projectFolder) return;
    const tagsArray = input.split(',').map(t => t.trim()).filter(Boolean);
    if (tagsArray.length === 0) return;

    const photos = Array.isArray(projectData?.photos) ? projectData.photos : [];
    const selectedItems = Array.from(projectSelected)
      .map(filename => photos.find(e => e.filename === filename))
      .filter(Boolean);

    if (selectedItems.length === 0) {
      toast.show({ emoji: '⚠️', message: 'No valid photos selected', variant: 'warning' });
      return;
    }

    const photoIds = selectedItems.map(p => p.id);

    setBusy(true);
    try {
      let result;
      if (mode === 'add') {
        result = await batchAddTags(photoIds, tagsArray);
      } else {
        result = await batchRemoveTags(photoIds, tagsArray);
      }

      setTagInput('');
      if (typeof clearSelection === 'function') {
        clearSelection();
      } else if (typeof setSelectedPhotos === 'function') {
        setSelectedPhotos(new Set());
      }

      // Show success message
      const action = mode === 'add' ? 'added to' : 'removed from';
      if (result.errors && result.errors.length > 0) {
        toast.show({
          emoji: '⚠️',
          message: `Tags ${action} ${result.updated} photos, ${result.errors.length} failed`,
          variant: 'warning'
        });
      } else {
        toast.show({
          emoji: '✅',
          message: `Tags ${action} ${result.updated} photo(s)`,
          variant: 'success'
        });
      }

      // Trigger parent refresh
      if (onTagsUpdated) {
        onTagsUpdated();
      }
    } catch (e) {
      console.error('Batch tag operation failed:', e);
      toast.show({
        emoji: '❌',
        message: e.message || 'Failed to update tags',
        variant: 'error'
      });
    } finally {
      setBusy(false);
    }
  };

  const applyKeep = async (mode) => {
    const isAll = !!allMode;
    const selCount = selectionCount;
    if (selCount === 0) return;
    let target;
    if (mode === 'none') target = { keep_jpg: false, keep_raw: false };
    else if (mode === 'jpg_only') target = { keep_jpg: true, keep_raw: false };
    else if (mode === 'raw_jpg') target = { keep_jpg: true, keep_raw: true };
    else return;
    setBusy(true);
    try {
      // Unified logic: use collectSelectedItems
      const selectedItems = collectSelectedItems();

      if (selectedItems.length === 0) {
        toast.show({ emoji: '⚠️', message: 'No valid photos selected', variant: 'warning' });
        return;
      }

      const photoIds = selectedItems.map(p => p.id);
      const result = await batchUpdateKeep(photoIds, target);

      if (typeof clearSelection === 'function') {
        clearSelection();
      } else if (typeof setSelectedPhotos === 'function') {
        setSelectedPhotos(new Set());
      } else if (typeof setAllSelectedKeys === 'function') {
        setAllSelectedKeys(new Set());
      }

      // Count unique projects
      const projectFolders = new Set(selectedItems.map(p => p.project_folder));

      let msg;
      if (!target.keep_jpg && !target.keep_raw) {
        msg = `${result.updated} planned for delete across ${projectFolders.size} project(s)`;
      } else if (target.keep_jpg && !target.keep_raw) {
        msg = `Planned to keep only JPG for ${result.updated} across ${projectFolders.size} project(s)`;
      } else {
        msg = `Planned to keep JPG + RAW for ${result.updated} across ${projectFolders.size} project(s)`;
      }

      if (result.errors && result.errors.length > 0) {
        toast.show({
          emoji: '⚠️',
          message: `${msg}, ${result.errors.length} failed`,
          variant: 'warning'
        });
      } else {
        toast.show({ emoji: '📝', message: msg, variant: 'notification' });
      }

      // Trigger parent refresh
      if (onTagsUpdated) {
        onTagsUpdated();
      }
    } catch (e) {
      console.error('Batch keep operation failed:', e);
      toast.show({
        emoji: '❌',
        message: e.message || 'Failed to update keep flags',
        variant: 'error'
      });
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
          className={`inline-flex justify-center items-center w-full rounded-md border shadow-sm px-3 py-2 text-sm font-medium pointer-events-auto relative z-10 ${busy
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
                disabled={busy || selectionIsEmpty}
                className="px-2 py-1.5 text-sm rounded-md bg-red-100 hover:bg-red-200 disabled:bg-gray-200 border border-red-200"
                title="Plan: Delete"
              >Delete</button>
              <button
                onClick={() => applyKeep('jpg_only')}
                disabled={busy || selectionIsEmpty}
                className="px-2 py-1.5 text-sm rounded-md bg-gray-100 hover:bg-gray-200 disabled:bg-gray-200 border border-gray-200"
                title="Plan: Keep JPG only"
              >JPG</button>
              <button
                onClick={() => applyKeep('raw_jpg')}
                disabled={busy || selectionIsEmpty}
                className="px-2 py-1.5 text-sm rounded-md bg-gray-100 hover:bg-gray-200 disabled:bg-gray-200 border border-gray-200"
                title="Plan: Keep JPG + RAW"
              >JPG+RAW</button>
            </div>
          </div>

          {/* Maintenance */}
          <div className="mt-3 pt-3 border-t-0">
            <div className="text-xs text-gray-500 mb-2">Maintenance</div>
            <button
              onClick={async () => {
                if (selectionIsEmpty) return;

                try {
                  setBusy(true);

                  // Collect selected items using the unified helper
                  const selectedItems = collectSelectedItems();

                  if (selectedItems.length === 0) {
                    toast.show({ emoji: '⚠️', message: 'No valid photos selected', variant: 'warning' });
                    return;
                  }

                  // Filter out items without IDs and log warning
                  const validItems = selectedItems.filter(p => p && p.id);
                  if (validItems.length === 0) {
                    console.error('No photos with valid IDs found', selectedItems);
                    toast.show({ emoji: '⚠️', message: 'Selected photos missing IDs', variant: 'warning' });
                    return;
                  }

                  if (validItems.length < selectedItems.length) {
                    console.warn(`${selectedItems.length - validItems.length} photos skipped (missing IDs)`);
                  }

                  const photoIds = validItems.map(p => p.id);
                  const result = await batchProcessPhotos(photoIds, true); // force=true for regeneration

                  const projectFolders = new Set(validItems.map(p => p.project_folder));
                  toast.show({
                    emoji: '🔄',
                    message: `Processing queued for ${validItems.length} photo(s) across ${projectFolders.size} project(s)`,
                    variant: 'notification'
                  });

                  if (typeof clearSelection === 'function') {
                    clearSelection();
                  } else if (allMode) {
                    if (typeof setAllSelectedKeys === 'function') setAllSelectedKeys(new Set());
                  } else if (typeof setSelectedPhotos === 'function') {
                    setSelectedPhotos(new Set());
                  }
                } catch (e) {
                  console.error('Batch process failed:', e);
                  toast.show({
                    emoji: '❌',
                    message: e.message || 'Failed to queue processing',
                    variant: 'error'
                  });
                } finally {
                  setBusy(false);
                }
              }}
              disabled={selectionIsEmpty || busy}
              className={`w-full px-3 py-2 text-sm rounded-md border ${selectionIsEmpty || busy ? 'bg-gray-200 text-gray-500 cursor-not-allowed border-gray-300' : 'bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-800'}`}
              title="Regenerate thumbnails and previews for selected photos"
            >
              Regenerate Derivatives
            </button>
            <button
              onClick={() => { if (onRequestMove) onRequestMove(); }}
              disabled={selectionIsEmpty}
              className={`w-full mt-2 px-3 py-2 text-sm rounded-md border ${selectionIsEmpty ? 'bg-gray-200 text-gray-500 cursor-not-allowed border-gray-300' : 'bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-800'}`}
              title="Move selected photos to another project"
            >
              Move to…
            </button>
            <button
              onClick={() => { if (onRequestShare) onRequestShare(); }}
              disabled={selectionIsEmpty}
              className={`w-full mt-2 px-3 py-2 text-sm rounded-md border ${selectionIsEmpty ? 'bg-gray-200 text-gray-500 cursor-not-allowed border-gray-300' : 'bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-800'}`}
              title="Add selected photos to shared links"
            >
              Share…
            </button>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={() => handleVisibilityChange('public')}
                disabled={busy || selectionIsEmpty}
                className="px-2 py-1.5 text-sm rounded-md border border-green-500 bg-green-500 text-white disabled:bg-gray-200 disabled:text-gray-500"
              >Apply Public</button>
              <button
                onClick={() => handleVisibilityChange('private')}
                disabled={busy || selectionIsEmpty}
                className="px-2 py-1.5 text-sm rounded-md border border-purple-600 bg-purple-600 text-white disabled:bg-gray-200 disabled:text-gray-500"
              >Apply Private</button>
            </div>
          </div>

          <div className="mb-2">
            <div className="text-xs text-gray-500 mb-2">Tagging</div>
            <div className="flex">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder={selectionIsEmpty ? 'Select images first' : 'Comma-separated tags'}
                className="flex-grow p-2 border rounded-l-md"
                disabled={busy || allMode}
                title={allMode ? 'Tagging from All Photos requires backend tag deltas or tags in listings (coming soon)' : undefined}
              />
              <button
                onClick={() => applyTags('add')}
                disabled={busy || (allMode ? true : (selectionIsEmpty || !tagInput.trim()))}
                className={`px-3 py-2 ${allMode ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'} disabled:bg-gray-400`}
                title={allMode ? 'Disabled in All Photos for now' : 'Add tags'}
              >
                +
              </button>
              <button
                onClick={() => applyTags('remove')}
                disabled={busy || (allMode ? true : (selectionIsEmpty || !tagInput.trim()))}
                className={`px-3 py-2 ${allMode ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-red-500 text-white hover:bg-red-600'} disabled:bg-gray-400 rounded-r-md`}
                title={allMode ? 'Disabled in All Photos for now' : 'Remove tags'}
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
