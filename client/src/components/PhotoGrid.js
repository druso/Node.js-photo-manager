import React, { useState } from 'react';

const PhotoGrid = ({ projectData, projectFolder }) => {
  const [sortBy, setSortBy] = useState('filename');
  const [sortOrder, setSortOrder] = useState('asc');
  const [filterText, setFilterText] = useState('');

  if (!projectData || !projectData.entries) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-4">📷</div>
        <p className="text-gray-600">No photos in this project yet.</p>
      </div>
    );
  }

  // Filter and sort entries
  const filteredEntries = projectData.entries
    .filter(entry => {
      if (!filterText) return true;
      const searchText = filterText.toLowerCase();
      return (
        entry.filename.toLowerCase().includes(searchText) ||
        entry.tags.some(tag => tag.toLowerCase().includes(searchText))
      );
    })
    .sort((a, b) => {
      let aVal, bVal;
      
      switch (sortBy) {
        case 'filename':
          aVal = a.filename.toLowerCase();
          bVal = b.filename.toLowerCase();
          break;
        case 'created_at':
          aVal = new Date(a.created_at);
          bVal = new Date(b.created_at);
          break;
        case 'updated_at':
          aVal = new Date(a.updated_at);
          bVal = new Date(b.updated_at);
          break;
        case 'tags':
          aVal = a.tags.join(', ').toLowerCase();
          bVal = b.tags.join(', ').toLowerCase();
          break;
        default:
          return 0;
      }
      
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const getSortIcon = (column) => {
    if (sortBy !== column) return '↕️';
    return sortOrder === 'asc' ? '↑' : '↓';
  };

  const getFileTypeFlags = (entry) => {
    const flags = [];
    if (entry.jpg_available) flags.push('JPG');
    if (entry.raw_available) flags.push('RAW');
    if (entry.other_available) flags.push('OTHER');
    return flags;
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-3 sm:space-y-0">
          <div className="flex items-center space-x-4">
            <span className="text-sm font-medium text-gray-700">
              {filteredEntries.length} of {projectData.entries.length} photos
            </span>
          </div>
          
          <div className="flex items-center space-x-3">
            <input
              type="text"
              placeholder="Filter by filename or tags..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Photo Grid */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Thumbnail
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('filename')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Filename</span>
                    <span>{getSortIcon('filename')}</span>
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('tags')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Tags</span>
                    <span>{getSortIcon('tags')}</span>
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  File Types
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('created_at')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Created</span>
                    <span>{getSortIcon('created_at')}</span>
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('updated_at')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Updated</span>
                    <span>{getSortIcon('updated_at')}</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredEntries.map((entry, index) => (
                <tr key={entry.filename} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  {/* Thumbnail */}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="w-16 h-16 bg-gray-200 rounded-lg overflow-hidden flex items-center justify-center">
                      <img
                        src={`/api/projects/${projectFolder}/thumb/${entry.filename}.jpg`}
                        alt={entry.filename}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.nextSibling.style.display = 'flex';
                        }}
                      />
                      <div className="hidden w-full h-full items-center justify-center text-gray-400 text-xs">
                        No thumb
                      </div>
                    </div>
                  </td>
                  
                  {/* Filename */}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {entry.filename}
                    </div>
                  </td>
                  
                  {/* Tags */}
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {entry.tags.length > 0 ? (
                        entry.tags.map((tag, tagIndex) => (
                          <span
                            key={tagIndex}
                            className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-gray-400 italic">No tags</span>
                      )}
                    </div>
                  </td>
                  
                  {/* File Types */}
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex space-x-1">
                      {getFileTypeFlags(entry).map((flag, flagIndex) => (
                        <span
                          key={flagIndex}
                          className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                            flag === 'JPG'
                              ? 'bg-green-100 text-green-800'
                              : flag === 'RAW'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {flag}
                        </span>
                      ))}
                    </div>
                  </td>
                  
                  {/* Created */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(entry.created_at).toLocaleDateString()}
                  </td>
                  
                  {/* Updated */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(entry.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {filteredEntries.length === 0 && (
          <div className="text-center py-12">
            <div className="text-4xl mb-4">🔍</div>
            <p className="text-gray-600">
              {filterText ? 'No photos match your filter.' : 'No photos in this project yet.'}
            </p>
            {filterText && (
              <button
                onClick={() => setFilterText('')}
                className="mt-2 text-blue-600 hover:text-blue-800 text-sm"
              >
                Clear filter
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PhotoGrid;
