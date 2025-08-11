import React from 'react';
import Thumbnail from './Thumbnail';

const PhotoTableView = ({ projectData, projectFolder, onPhotoSelect, selectedPhotos, onToggleSelection, sortKey, sortDir, onSortChange, sizeLevel = 's' }) => {
  const photos = projectData?.photos || [];

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-gray-600">
        <div className="mb-3 text-gray-400" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-8 w-8">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        </div>
        <p className="max-w-md">
          <span className="font-medium text-gray-800">Drop images anywhere on this page</span> to add them to the current project,
          or click the <span className="inline-flex items-center gap-1 align-middle"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg><span>add</span></span> icon above.
        </p>
      </div>
    );
  }

  const HeaderButton = ({ label, k }) => (
    <button
      type="button"
      onClick={() => onSortChange(k)}
      className={`inline-flex items-center gap-1 text-xs uppercase tracking-wider ${sortKey === k ? 'font-semibold text-gray-900' : 'font-medium text-gray-500'} hover:text-gray-700`}
      title={`Sort by ${label.toLowerCase()}`}
    >
      <span>{label}</span>
      {sortKey === k && <span>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );

  // Size mapping for thumbnail and cell paddings
  // 1:2:3 ratio for S:M:L
  const thumbBySize = {
    s: { box: 'w-16 h-16', cellPadX: 'px-3', cellPadY: 'py-2' },   // 64px
    m: { box: 'w-32 h-32', cellPadX: 'px-3', cellPadY: 'py-2' },   // 128px
    l: { box: 'w-48 h-48', cellPadX: 'px-3', cellPadY: 'py-2' },   // 192px
  };
  const tcfg = thumbBySize[sizeLevel] || thumbBySize.s;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full bg-white divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Preview</th>
            <th scope="col" className="px-6 py-3 text-left">
              <HeaderButton label="Filename" k="name" />
            </th>
            <th scope="col" className="px-6 py-3 text-left">
              <HeaderButton label="File Types" k="filetypes" />
            </th>
            <th scope="col" className="px-6 py-3 text-left">
              <HeaderButton label="Date Taken" k="date" />
            </th>
            <th scope="col" className="px-6 py-3 text-left">
              <HeaderButton label="Tags" k="tags" />
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {photos.map((photo) => {
            const isSelected = selectedPhotos?.has(photo.filename);
            const isRawFile = /\.(arw|cr2|nef|dng|raw)$/i.test(photo.filename);
            
            return (
            <tr 
              key={photo.id} 
              onClick={() => onToggleSelection(photo)} 
              className={`group cursor-pointer transition-colors ${
                isSelected 
                  ? 'bg-blue-100 hover:bg-blue-200' 
                  : 'bg-white hover:bg-gray-100'
              }`}
            >
              <td className={`${tcfg.cellPadX} ${tcfg.cellPadY} whitespace-nowrap`}>
                <div className={`relative group ${tcfg.box}`}>
                  <Thumbnail
                    photo={photo}
                    projectFolder={projectFolder}
                    className="w-full h-full"
                    rounded={false}
                    alt={`Thumbnail of ${photo.filename}`}
                  />
                  <div 
                    className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <button 
                      onClick={(e) => {
                        e.stopPropagation(); // Prevent row click from firing
                        onPhotoSelect(photo);
                      }}
                      className="text-white text-sm bg-gray-800 bg-opacity-75 px-3 py-1 hover:bg-gray-700"
                    >
                      View
                    </button>
                  </div>
                </div>
              </td>
              <td className={`${tcfg.cellPadX} ${tcfg.cellPadY} whitespace-nowrap text-sm font-medium text-gray-900`}>{photo.filename}</td>
              <td className={`${tcfg.cellPadX} ${tcfg.cellPadY} whitespace-nowrap text-sm text-gray-500`}>
                <div className="flex flex-col">
                  {photo.jpg_available && <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">JPG</span>}
                  {photo.raw_available && <span className="mt-1 px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800">RAW</span>}
                </div>
              </td>
              <td className={`${tcfg.cellPadX} ${tcfg.cellPadY} whitespace-nowrap text-sm text-gray-500`}>
                {photo.metadata?.date_time_original ? new Date(photo.metadata.date_time_original).toLocaleDateString() : 'N/A'}
              </td>
              <td className={`${tcfg.cellPadX} ${tcfg.cellPadY} whitespace-nowrap text-sm text-gray-500`}>
                {photo.tags.map(tag => (
                  <span key={tag} className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800 mr-1 mb-1">
                    {tag}
                  </span>
                ))}
              </td>
            </tr>
          )})}
        </tbody>
      </table>
    </div>
  );
};

export default PhotoTableView;