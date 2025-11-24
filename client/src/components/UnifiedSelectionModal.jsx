import React, { useEffect, useMemo, useState } from 'react';
import { listProjects, createProject } from '../api/projectsApi';
import { listSharedLinks, createSharedLink, addPhotosToLink, removePhotoFromLink } from '../api/sharedLinksManagementApi';
import { batchMovePhotos } from '../api/batchApi';
import { useToast } from '../ui/toast/ToastContext';

/**
 * UnifiedSelectionModal - Unified modal for both "Move to..." and "Share..." operations
 * 
 * Mode: 'move' | 'share'
 * - move: Single-select projects (existing or create new)
 * - share: Multi-select shared links (existing or create new)
 */
export default function UnifiedSelectionModal({
  open,
  onClose,
  mode = 'move', // 'move' | 'share'
  // Move mode props
  sourceFolder,
  selectedFilenames = [], // DEPRECATED: kept for backward compatibility, use selectedPhotos instead
  selectedPhotos = [], // Array of photo objects with { id, filename, project_folder } - used for both move and share
  selectedProjectSummaries = [],
  // Share mode props
  currentLinkIds = [], // Array of link IDs this photo is already in (for share mode)
}) {
  const [items, setItems] = useState([]); // projects or shared links
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState(null); // For move mode (single select)
  const [multiSelection, setMultiSelection] = useState(new Set()); // For share mode (multi select)
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newItemDescription, setNewItemDescription] = useState('');
  const toast = useToast();

  const isShareMode = mode === 'share';
  const isMoveMode = mode === 'move';

  // Load items when modal opens
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const list = isShareMode ? await listSharedLinks() : await listProjects();
        if (!alive) return;
        setItems(list || []);

        // Pre-select current links in share mode
        if (isShareMode && Array.isArray(currentLinkIds) && currentLinkIds.length > 0) {
          setMultiSelection(new Set(currentLinkIds));
        }
      } catch (_) { }
    })();
    return () => { alive = false; };
  }, [open, isShareMode, currentLinkIds]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelection(null);
      setMultiSelection(new Set());
      setCreating(false);
      setLoading(false);
      setShowCreateForm(false);
      setNewItemDescription('');
      return;
    }
    setSelection(null);
    setMultiSelection(new Set());
    setQuery('');
    setShowCreateForm(false);
    setNewItemDescription('');
  }, [open]);

  // For move mode: exclude source projects
  const exclusionSet = useMemo(() => {
    if (!isMoveMode) return new Set();
    const set = new Set();
    if (sourceFolder) set.add(sourceFolder);
    (selectedProjectSummaries || []).forEach(info => {
      if (info?.folder) set.add(info.folder);
    });
    return set;
  }, [isMoveMode, sourceFolder, selectedProjectSummaries]);

  const normalizedQuery = query.trim().toLowerCase();

  // Filter and search items
  const availableItems = useMemo(() => {
    const pool = Array.isArray(items)
      ? items.filter(item => isMoveMode ? !exclusionSet.has(item.folder) : true)
      : [];

    let filtered = pool;
    if (normalizedQuery) {
      filtered = pool.filter(item => {
        if (isShareMode) {
          const title = (item.title || '').toLowerCase();
          const desc = (item.description || '').toLowerCase();
          return title.includes(normalizedQuery) || desc.includes(normalizedQuery);
        } else {
          const name = (item.name || '').toLowerCase();
          const folder = (item.folder || '').toLowerCase();
          return name.includes(normalizedQuery) || folder.includes(normalizedQuery);
        }
      });
    }

    // In share mode, sort to show pre-selected links first
    if (isShareMode && currentLinkIds.length > 0) {
      const currentSet = new Set(currentLinkIds);
      const current = filtered.filter(item => currentSet.has(item.id));
      const others = filtered.filter(item => !currentSet.has(item.id));
      return [...current, ...others].slice(0, 20);
    }

    return filtered.slice(0, 20);
  }, [items, exclusionSet, normalizedQuery, isShareMode, isMoveMode, currentLinkIds]);

  // For move mode: check for exact match
  const exactMatch = useMemo(() => {
    if (!isMoveMode || !normalizedQuery) return null;
    return (Array.isArray(items) ? items : []).find(item => {
      if (exclusionSet.has(item.folder)) return false;
      const name = (item.name || '').toLowerCase();
      const folder = (item.folder || '').toLowerCase();
      return normalizedQuery === name || normalizedQuery === folder;
    }) || null;
  }, [items, normalizedQuery, exclusionSet, isMoveMode]);

  // For move mode: project name mapping
  const projectNameMap = useMemo(() => {
    if (!isMoveMode) return new Map();
    const map = new Map();
    (items || []).forEach(item => {
      map.set(item.folder, item.name || item.folder);
    });
    return map;
  }, [items, isMoveMode]);

  const selectedProjectsLabel = useMemo(() => {
    if (!isMoveMode || !Array.isArray(selectedProjectSummaries) || selectedProjectSummaries.length === 0) return '';
    return selectedProjectSummaries
      .map(({ folder, count }) => {
        if (!folder) return null;
        const displayName = projectNameMap.get(folder) || folder;
        const countValue = typeof count === 'number' ? count : 0;
        return `${displayName} (${countValue})`;
      })
      .filter(Boolean)
      .join(', ');
  }, [selectedProjectSummaries, projectNameMap, isMoveMode]);

  const hasSelection = isMoveMode ? selection != null : multiSelection.size > 0;

  const confirmLabel = useMemo(() => {
    if (isMoveMode) {
      return hasSelection || exactMatch ? (loading ? 'Moving…' : 'Confirm') : (creating ? 'Creating…' : 'Create project');
    } else {
      return loading ? 'Sharing…' : `Share to ${multiSelection.size} link${multiSelection.size === 1 ? '' : 's'}`;
    }
  }, [isMoveMode, hasSelection, exactMatch, loading, creating, multiSelection.size]);

  const confirmDisabled = useMemo(() => {
    if (loading || creating) return true;
    if (isMoveMode) {
      // Check if we have photos to move (prefer selectedPhotos, fall back to selectedFilenames)
      const hasFiles = selectedPhotos.length > 0 || (selectedFilenames?.length || 0) > 0;
      return !hasFiles || (!hasSelection && !exactMatch && !query.trim());
    } else {
      // Share mode: just need at least one change in selection
      // Allow confirming even with 0 photos if user wants to remove from links
      // Disabled only if no selection changes have been made
      return false; // Always enabled in share mode (user can add/remove)
    }
  }, [loading, creating, isMoveMode, hasSelection, exactMatch, query, selectedFilenames, selectedPhotos]);

  const handleSuggestionClick = (item) => {
    if (isMoveMode) {
      setSelection(item);
      setQuery(item.name || item.folder || '');
    } else {
      // Toggle multi-selection for share mode
      setMultiSelection(prev => {
        const next = new Set(prev);
        const id = item.id;
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    }
  };

  const handleClearSelection = () => {
    setSelection(null);
    setQuery('');
  };

  const handleCreateNew = async () => {
    const title = query.trim();
    if (!title) {
      toast.show({
        emoji: '⚠️',
        message: isShareMode ? 'Title is required' : 'Project name is required',
        variant: 'warning',
      });
      return;
    }

    setCreating(true);
    try {
      if (isShareMode) {
        const newLink = await createSharedLink({
          title,
          description: newItemDescription.trim() || undefined,
        });

        setItems(prev => [...prev, newLink]);
        setMultiSelection(prev => new Set([...prev, newLink.id]));

        setQuery('');
        setNewItemDescription('');
        setShowCreateForm(false);

        toast.show({
          emoji: '✅',
          message: `Created "${title}"`,
          variant: 'success',
        });
      } else {
        const res = await createProject(title);
        const proj = res && res.project;
        if (!proj || !proj.folder) throw new Error('Invalid create response');

        setItems(prev => {
          const next = Array.isArray(prev) ? [...prev] : [];
          next.push({
            name: proj.name,
            folder: proj.folder,
            created_at: proj.created_at,
            updated_at: proj.updated_at,
            photo_count: proj.photo_count ?? 0
          });
          return next;
        });
        setSelection(proj);
        setQuery(proj.name || proj.folder || '');

        toast.show({
          emoji: '✅',
          message: `Created project "${title}"`,
          variant: 'success',
        });
      }
    } catch (e) {
      toast.show({
        emoji: '⚠️',
        message: `Failed to create ${isShareMode ? 'shared link' : 'project'}${e?.message ? `: ${e.message}` : ''}`,
        variant: 'error'
      });
    } finally {
      setCreating(false);
    }
  };

  const performMove = async (folder) => {
    if (!folder) return;
    setLoading(true);
    try {
      // Use selectedPhotos if available (with IDs), otherwise fall back to selectedFilenames
      const photosToMove = selectedPhotos.length > 0 ? selectedPhotos : [];

      if (photosToMove.length === 0) {
        toast.show({
          emoji: '⚠️',
          message: 'No photos to move (missing photo data)',
          variant: 'warning'
        });
        return;
      }

      // Extract photo IDs
      const photoIds = photosToMove.map(p => p?.id).filter(Boolean);

      if (photoIds.length === 0) {
        console.error('Selected photos missing IDs:', photosToMove);
        toast.show({
          emoji: '⚠️',
          message: 'Selected photos missing IDs',
          variant: 'error'
        });
        return;
      }

      // Use batch move API with photo IDs
      await batchMovePhotos(photoIds, folder);

      toast.show({
        emoji: '📦',
        message: `Moving ${photoIds.length} photo(s) → ${folder}`,
        variant: 'notification'
      });
      onClose && onClose({ moved: true, destFolder: folder });
    } catch (e) {
      console.error('Move failed:', e);
      toast.show({ emoji: '⚠️', message: e?.message || 'Failed to start move', variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const performShare = async () => {
    // In share mode, selectedPhotos contains the photos to share
    if (!Array.isArray(selectedPhotos) || selectedPhotos.length === 0) {
      toast.show({
        emoji: '⚠️',
        message: 'No photos selected',
        variant: 'warning',
      });
      return;
    }

    setLoading(true);
    try {
      const photoIds = selectedPhotos.map(p => p?.id).filter(Boolean);
      if (photoIds.length === 0) {
        console.error('Selected photos:', selectedPhotos);
        throw new Error('Selected photos missing IDs');
      }

      // Calculate which links to add to and which to remove from
      const currentLinkSet = new Set(currentLinkIds);
      const newLinkSet = new Set(multiSelection);

      const linksToAdd = Array.from(newLinkSet).filter(id => !currentLinkSet.has(id));
      const linksToRemove = Array.from(currentLinkSet).filter(id => !newLinkSet.has(id));

      const promises = [];

      // Add photos to newly selected links
      linksToAdd.forEach(linkId => {
        promises.push(addPhotosToLink(linkId, photoIds));
      });

      // Remove photos from deselected links
      linksToRemove.forEach(linkId => {
        photoIds.forEach(photoId => {
          promises.push(removePhotoFromLink(linkId, photoId));
        });
      });

      if (promises.length === 0) {
        toast.show({
          emoji: 'ℹ️',
          message: 'No changes made',
          variant: 'info',
        });
        onClose && onClose({ shared: false });
        return;
      }

      await Promise.all(promises);

      const photoCount = photoIds.length;
      const addedCount = linksToAdd.length;
      const removedCount = linksToRemove.length;

      let message = '';
      if (addedCount > 0 && removedCount > 0) {
        message = `Updated ${photoCount} photo${photoCount === 1 ? '' : 's'}: added to ${addedCount} link${addedCount === 1 ? '' : 's'}, removed from ${removedCount}`;
      } else if (addedCount > 0) {
        message = `Added ${photoCount} photo${photoCount === 1 ? '' : 's'} to ${addedCount} link${addedCount === 1 ? '' : 's'}`;
      } else if (removedCount > 0) {
        message = `Removed ${photoCount} photo${photoCount === 1 ? '' : 's'} from ${removedCount} link${removedCount === 1 ? '' : 's'}`;
      }

      toast.show({
        emoji: '✅',
        message,
        variant: 'success',
      });

      onClose && onClose({ shared: true });
    } catch (err) {
      console.error('Failed to share photos:', err);
      toast.show({
        emoji: '⚠️',
        message: err.message || 'Failed to update shared links',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (confirmDisabled) return;

    if (isMoveMode) {
      if (selection) {
        await performMove(selection.folder);
        return;
      }
      if (exactMatch) {
        setSelection(exactMatch);
        await performMove(exactMatch.folder);
        return;
      }
      // Create new project and move
      await handleCreateNew();
      // After creation, selection is set, so we need to wait and then move
      // This is handled by the user clicking confirm again after creation
    } else {
      await performShare();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => onClose && onClose({ canceled: true })} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-xl font-semibold text-gray-900">
            {isShareMode ? 'Share Photos' : 'Move Photos'}
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            {isShareMode
              ? `${selectedPhotos.length} photo${selectedPhotos.length === 1 ? '' : 's'} selected`
              : `Select a destination project. ${selectedPhotos.length > 0 ? selectedPhotos.length : (selectedFilenames?.length || 0)} selected${selectedProjectsLabel ? ` from projects: ${selectedProjectsLabel}` : '.'}`
            }
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {/* Search input */}
          <div className="relative mb-4">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (isMoveMode) setSelection(null);
              }}
              placeholder={isShareMode ? "Search shared links..." : "Type to search or create"}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading || creating}
              autoFocus
            />
            {isMoveMode && selection && (
              <button
                type="button"
                onClick={handleClearSelection}
                className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600"
                aria-label="Clear selection"
                disabled={loading || creating}
              >
                ×
              </button>
            )}
          </div>

          {/* Move mode: Show selected project */}
          {isMoveMode && selection && (
            <div className="border border-blue-200 bg-blue-50 rounded-md px-4 py-3 mb-4">
              <div className="font-medium text-blue-900">{selection.name || selection.folder}</div>
              <div className="text-sm text-blue-700 mt-0.5">{selection.folder}</div>
            </div>
          )}

          {/* List of items */}
          {(!isMoveMode || !selection) && (
            <div className="space-y-2 mb-4">
              {availableItems.length > 0 ? (
                availableItems.map(item => {
                  const isSelected = isShareMode ? multiSelection.has(item.id) : false;
                  return (
                    <button
                      key={isShareMode ? item.id : item.folder}
                      type="button"
                      onClick={() => handleSuggestionClick(item)}
                      className={`w-full px-4 py-3 text-left rounded-lg border transition-colors ${isSelected
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-300 hover:border-gray-400 bg-white hover:bg-gray-50'
                        }`}
                      disabled={loading || creating}
                    >
                      {isShareMode ? (
                        <div className="flex items-start">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => { }}
                            className="mt-1 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 pointer-events-none"
                          />
                          <div className="ml-3 flex-1">
                            <div className="font-medium text-gray-900">{item.title}</div>
                            {item.description && (
                              <div className="text-sm text-gray-600 mt-0.5">{item.description}</div>
                            )}
                            <div className="text-xs text-gray-500 mt-1">
                              {item.photo_count || 0} photo{item.photo_count === 1 ? '' : 's'}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="text-sm font-medium text-gray-900">{item.name || item.folder}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{item.folder}</div>
                        </>
                      )}
                    </button>
                  );
                })
              ) : (
                <div className="px-4 py-8 text-center text-gray-500">
                  {query.trim().length === 0
                    ? (isShareMode ? 'No shared links yet.' : 'Start typing to see suggestions.')
                    : (isShareMode
                      ? `No shared links found matching "${query.trim()}".`
                      : `No projects found. Press Confirm to create "${query.trim()}".`
                    )
                  }
                </div>
              )}
            </div>
          )}

          {/* Create new section for share mode */}
          {isShareMode && !showCreateForm && (
            <button
              onClick={() => setShowCreateForm(true)}
              disabled={loading || creating}
              className="w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors disabled:opacity-50"
            >
              + Create New Shared Link
            </button>
          )}

          {isShareMode && showCreateForm && (
            <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
              <div className="text-sm font-medium text-gray-700 mb-3">
                Create New Shared Link
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">
                    Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="e.g., Summer Vacation 2024"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    disabled={loading || creating}
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">
                    Description (optional)
                  </label>
                  <textarea
                    value={newItemDescription}
                    onChange={(e) => setNewItemDescription(e.target.value)}
                    placeholder="Add a description..."
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    disabled={loading || creating}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateNew}
                    disabled={creating || !query.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {creating ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    onClick={() => {
                      setShowCreateForm(false);
                      setQuery('');
                      setNewItemDescription('');
                    }}
                    disabled={creating}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={() => onClose && onClose({ canceled: true })}
            className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200"
            disabled={loading || creating}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirmDisabled}
            className={`px-4 py-2 rounded-md ${confirmDisabled
                ? 'bg-blue-300 text-white cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
