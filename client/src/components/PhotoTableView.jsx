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

  // Thumbnail width fixed by size; height auto based on aspect ratio
  const thumbWidthBySize = { s: 120, m: 180, l: 240 };
  const tcfg = { boxW: thumbWidthBySize[sizeLevel] || thumbWidthBySize.s, cellPadX: 'px-3', cellPadY: 'py-2' };

  return (
    <div className="relative w-full">
      {/* Horizontally scrollable container for the table */}
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white divide-y divide-gray-200 border-separate border-spacing-0">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Preview</th>
              <th scope="col" className="px-6 py-3 text-left">
                <HeaderButton label="Filename" k="name" />
              </th>
              <th scope="col" className="px-6 py-3 text-left">
                <HeaderButton label="File Types Available" k="filetypes" />
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
                  <div className={`relative group border-2 ${isSelected ? 'border-blue-600 ring-2 ring-blue-400' : 'border-transparent ring-0'}`}
                       style={{ width: `${tcfg.boxW}px` }}>
                    {/* Selection toggle top-left */}
                    <button
                      type="button"
                      aria-label={isSelected ? 'Deselect photo' : 'Select photo'}
                      onClick={(e) => { e.stopPropagation(); onToggleSelection(photo); }}
                      className={`absolute top-1 left-1 z-10 flex items-center justify-center h-6 w-6 rounded-full border transition shadow-sm ${
                        isSelected ? 'bg-blue-600 text-white border-blue-600 opacity-100' : 'bg-white/80 text-gray-600 border-gray-300 opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      {isSelected ? (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414L8.5 11.086l6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <span className="block h-3.5 w-3.5 rounded-full border border-gray-400" />
                      )}
                    </button>

                    <Thumbnail
                      photo={photo}
                      projectFolder={projectFolder}
                      className="w-full h-auto"
                      objectFit="contain"
                      rounded={false}
                      alt={`Thumbnail of ${photo.filename}`}
                    />
                    {/* Hover overlay with larger View button */}
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity p-2">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent row click from firing
                          onPhotoSelect(photo);
                        }}
                        className="px-4 py-2 text-base font-semibold text-white bg-gray-900/90 rounded-md hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white"
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
                  {(photo.tags ?? []).map(tag => (
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
    </div>
  );
};

export default PhotoTableView;