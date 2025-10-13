import React, { useState, useEffect } from 'react';
import { listSharedLinks, createSharedLink, addPhotosToLink } from '../api/sharedLinksManagementApi';
import { useToast } from '../ui/toast/ToastContext';

/**
 * ShareModal - Allows admins to add selected photos to existing or new shared links
 * Mirrors the "Move to..." UX for consistency
 */
export default function ShareModal({ 
  isOpen, 
  onClose, 
  selectedPhotos = [], // Array of photo objects with { id, filename, project_folder }
}) {
  const [links, setLinks] = useState([]);
  const [selectedLinkIds, setSelectedLinkIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [newLinkDescription, setNewLinkDescription] = useState('');
  const toast = useToast();

  // Load shared links when modal opens
  useEffect(() => {
    if (isOpen) {
      loadLinks();
    }
  }, [isOpen]);

  const loadLinks = async () => {
    setLoading(true);
    try {
      const data = await listSharedLinks();
      setLinks(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load shared links:', err);
      toast.show({
        emoji: '⚠️',
        message: err.message || 'Failed to load shared links',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleLink = (linkId) => {
    setSelectedLinkIds(prev => {
      const next = new Set(prev);
      if (next.has(linkId)) {
        next.delete(linkId);
      } else {
        next.add(linkId);
      }
      return next;
    });
  };

  const handleCreateNewLink = async () => {
    const title = newLinkTitle.trim();
    if (!title) {
      toast.show({
        emoji: '⚠️',
        message: 'Title is required',
        variant: 'warning',
      });
      return;
    }

    setBusy(true);
    try {
      const newLink = await createSharedLink({
        title,
        description: newLinkDescription.trim() || undefined,
      });
      
      // Add to links list and auto-select it
      setLinks(prev => [...prev, newLink]);
      setSelectedLinkIds(prev => new Set([...prev, newLink.id]));
      
      // Reset form
      setNewLinkTitle('');
      setNewLinkDescription('');
      setShowCreateForm(false);
      
      toast.show({
        emoji: '✅',
        message: `Created "${title}"`,
        variant: 'success',
      });
    } catch (err) {
      console.error('Failed to create shared link:', err);
      toast.show({
        emoji: '⚠️',
        message: err.message || 'Failed to create shared link',
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    if (selectedLinkIds.size === 0) {
      toast.show({
        emoji: '⚠️',
        message: 'Please select at least one shared link',
        variant: 'warning',
      });
      return;
    }

    if (selectedPhotos.length === 0) {
      toast.show({
        emoji: '⚠️',
        message: 'No photos selected',
        variant: 'warning',
      });
      return;
    }

    setBusy(true);
    try {
      const photoIds = selectedPhotos.map(p => p.id).filter(Boolean);
      if (photoIds.length === 0) {
        throw new Error('Selected photos missing IDs');
      }

      // Add photos to each selected link
      const promises = Array.from(selectedLinkIds).map(linkId =>
        addPhotosToLink(linkId, photoIds)
      );
      
      await Promise.all(promises);

      const linkCount = selectedLinkIds.size;
      const photoCount = photoIds.length;
      
      toast.show({
        emoji: '✅',
        message: `Added ${photoCount} photo${photoCount === 1 ? '' : 's'} to ${linkCount} shared link${linkCount === 1 ? '' : 's'}`,
        variant: 'success',
      });

      onClose();
    } catch (err) {
      console.error('Failed to share photos:', err);
      toast.show({
        emoji: '⚠️',
        message: err.message || 'Failed to add photos to shared links',
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    setSelectedLinkIds(new Set());
    setShowCreateForm(false);
    setNewLinkTitle('');
    setNewLinkDescription('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={handleCancel}
    >
      <div 
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            Share Photos
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            {selectedPhotos.length} photo{selectedPhotos.length === 1 ? '' : 's'} selected
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <>
              {/* Existing Links */}
              {links.length > 0 ? (
                <div className="space-y-2 mb-4">
                  <div className="text-sm font-medium text-gray-700 mb-2">
                    Select shared links:
                  </div>
                  {links.map(link => (
                    <label
                      key={link.id}
                      className={`flex items-start p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedLinkIds.has(link.id)
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-300 hover:border-gray-400 bg-white'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedLinkIds.has(link.id)}
                        onChange={() => handleToggleLink(link.id)}
                        className="mt-1 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                      />
                      <div className="ml-3 flex-1">
                        <div className="font-medium text-gray-900">{link.title}</div>
                        {link.description && (
                          <div className="text-sm text-gray-600 mt-0.5">{link.description}</div>
                        )}
                        <div className="text-xs text-gray-500 mt-1">
                          {link.photo_count || 0} photo{link.photo_count === 1 ? '' : 's'}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p>No shared links yet.</p>
                  <p className="text-sm mt-1">Create your first one below.</p>
                </div>
              )}

              {/* Create New Link Section */}
              {!showCreateForm ? (
                <button
                  onClick={() => setShowCreateForm(true)}
                  disabled={busy}
                  className="w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors disabled:opacity-50"
                >
                  + Create New Shared Link
                </button>
              ) : (
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
                        value={newLinkTitle}
                        onChange={(e) => setNewLinkTitle(e.target.value)}
                        placeholder="e.g., Summer Vacation 2024"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={busy}
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">
                        Description (optional)
                      </label>
                      <textarea
                        value={newLinkDescription}
                        onChange={(e) => setNewLinkDescription(e.target.value)}
                        placeholder="Add a description..."
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={busy}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleCreateNewLink}
                        disabled={busy || !newLinkTitle.trim()}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                      >
                        {busy ? 'Creating...' : 'Create'}
                      </button>
                      <button
                        onClick={() => {
                          setShowCreateForm(false);
                          setNewLinkTitle('');
                          setNewLinkDescription('');
                        }}
                        disabled={busy}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={handleCancel}
            disabled={busy}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleShare}
            disabled={busy || selectedLinkIds.size === 0 || loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {busy ? 'Sharing...' : `Share to ${selectedLinkIds.size} link${selectedLinkIds.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
