import React, { useState } from 'react';
import PhotoDisplay from './PhotoDisplay';

const PhotoTagger = ({ projectData, projectFolder, onTagsUpdated, onPhotoSelect, config, selectedPhotos, onToggleSelection, setSelectedPhotos }) => {
  const [tagInput, setTagInput] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [viewMode, setViewMode] = useState('grid');

  const handleSelectAll = () => {
    if (selectedPhotos.size === projectData.photos.length) {
      setSelectedPhotos(new Set());
    } else {
      setSelectedPhotos(new Set(projectData.photos.map(entry => entry.filename)));
    }
  };

  const handleAddTags = async (tagsToAdd) => {
    if (selectedPhotos.size === 0 || !tagsToAdd.trim()) return;

    const tagsArray = tagsToAdd.split(',').map(tag => tag.trim()).filter(tag => tag);
    if (tagsArray.length === 0) return;

    setIsUpdating(true);
    try {
      const updates = Array.from(selectedPhotos).map(filename => {
        const entry = projectData.photos.find(e => e.filename === filename);
        const currentTags = entry ? entry.tags : [];
        const updatedTags = [...new Set([...currentTags, ...tagsArray])];
        return { filename, tags: updatedTags };
      });

      const response = await fetch(`/api/projects/${projectFolder}/tags`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ updates }),
      });

      if (response.ok) {
        setTagInput('');
        setSelectedPhotos(new Set());
        onTagsUpdated();
      } else {
        const error = await response.json();
        alert(`Error updating tags: ${error.error}`);
      }
    } catch (error) {
      console.error('Error updating tags:', error);
      alert('Error updating tags');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRemoveTags = async (tagsToRemove) => {
    if (selectedPhotos.size === 0 || !tagsToRemove.trim()) return;
    
    const tagsArray = tagsToRemove.split(',').map(tag => tag.trim()).filter(tag => tag);

    setIsUpdating(true);
    try {
      const updates = Array.from(selectedPhotos).map(filename => {
        const entry = projectData.photos.find(e => e.filename === filename);
        const currentTags = entry ? entry.tags : [];
        const updatedTags = currentTags.filter(tag => !tagsArray.includes(tag));
        return { filename, tags: updatedTags };
      });

      const response = await fetch(`/api/projects/${projectFolder}/tags`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ updates }),
      });

      if (response.ok) {
        setTagInput('');
        setSelectedPhotos(new Set());
        onTagsUpdated();
      } else {
        const error = await response.json();
        alert(`Error removing tags: ${error.error}`);
      }
    } catch (error) {
      console.error('Error removing tags:', error);
      alert('Error removing tags');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div>
      {/* Controls Header */}
      <div className="bg-white p-4 rounded-lg shadow-sm mb-4">
        <h2 className="text-xl font-bold mb-4">Tag Photos</h2>

        {/* Tagging Controls */}
        <div className="flex items-center mb-4">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTags(tagInput)}
            placeholder={selectedPhotos.size === 0 ? "Select images first" : "Add or remove tags (comma-separated)"}
            className="flex-grow p-2 border rounded-l-md"
            disabled={isUpdating || selectedPhotos.size === 0}
          />
          <button
            onClick={() => handleAddTags(tagInput)}
            disabled={isUpdating || selectedPhotos.size === 0 || !tagInput.trim()}
            className="px-4 py-2 bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-400 rounded-r-md"
            title="Add tags"
          >
            +
          </button>
          {tagInput.trim() && (
            <button
              onClick={() => handleRemoveTags(tagInput)}
              disabled={isUpdating || selectedPhotos.size === 0}
              className="px-4 py-2 bg-red-500 text-white hover:bg-red-600 disabled:bg-gray-400 ml-1 rounded-md"
              title="Remove tags"
            >
              -
            </button>
          )}
        </div>

        {/* Selection Info and Actions */}
        <div className="flex justify-between items-center mt-4">
          <span className="text-sm text-gray-600">
            {selectedPhotos.size} of {projectData.photos.length} photos selected.
          </span>
          <div>
            <button onClick={handleSelectAll} className="text-sm text-blue-600 hover:underline mr-4">
              {selectedPhotos.size === projectData.photos.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>
        </div>
      </div>

      {/* Photo Display Area */}
      <div>
        {projectData.photos.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-600">No photos in this project yet.</p>
          </div>
        ) : (
          <div>
            <div className="flex justify-end items-center mb-4">
              <span className="text-sm mr-2">View as:</span>
              <button 
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1 text-sm rounded-md ${viewMode === 'grid' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}>
                  Grid
              </button>
              <button 
                onClick={() => setViewMode('table')}
                className={`px-3 py-1 text-sm rounded-md ml-2 ${viewMode === 'table' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}>
                  Table
              </button>
            </div>

            <PhotoDisplay 
              viewMode={viewMode}
              projectData={projectData}
              projectFolder={projectFolder}
              selectedPhotos={selectedPhotos}
              onPhotoSelect={onPhotoSelect}
              onToggleSelection={onToggleSelection}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default PhotoTagger;
