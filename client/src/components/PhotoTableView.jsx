import React from 'react';
import Thumbnail from './Thumbnail';

const PhotoTableView = ({ projectData, projectFolder, onPhotoSelect, selectedPhotos, onToggleSelection, sortKey, sortDir, onSortChange, sizeLevel = 's', showEmptyDropHint = true }) => {
  const photos = projectData?.photos || [];

  if (photos.length === 0) {
    if (showEmptyDropHint) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center text-gray-600">
          <div className="mb-3 text-gray-400" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-8 w-8">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
          </div>
          <p className="max-w-md">
            <span className="font-medium text-gray-800">Drop images anywhere on this page</span> to add them to the current project,
            or click the <span className="inline-flex items-center gap-1 align-middle"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" /></svg><span>add</span></span> icon above.
          </p>
        </div>
      );
    }
    return null;
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
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Visibility
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
              const isSelected = selectedPhotos?.has(photo.filename) || selectedPhotos?.has(`${photo.project_folder || projectFolder}::${photo.filename}`);
              const isRawFile = /\.(arw|cr2|nef|dng|raw)$/i.test(photo.filename);

              return (
                <tr
                  key={photo.id}
                  onClick={() => onToggleSelection(photo)}
                  className={`group cursor-pointer transition-colors ${isSelected
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
                        className={`absolute top-1 left-1 z-10 flex items-center justify-center h-6 w-6 rounded-full border transition shadow-sm ${isSelected ? 'bg-blue-600 text-white border-blue-600 opacity-100' : 'bg-white/80 text-gray-600 border-gray-300 opacity-0 group-hover:opacity-100'
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
                  <td className={`${tcfg.cellPadX} ${tcfg.cellPadY} whitespace-nowrap text-sm`}>
                    {(() => {
                      const visibility = (photo.visibility || 'private').toLowerCase();
                      const isPublic = visibility === 'public';
                      const label = isPublic ? 'Public' : 'Private';
                      const badgeClass = isPublic
                        ? 'bg-green-100 text-green-800 border border-green-300'
                        : 'bg-purple-100 text-purple-800 border border-purple-300';
                      return (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${badgeClass}`} title={`Visibility: ${label}`}>
                          {isPublic ? (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                              <path d="M12 4.5c-4.97 0-9 3.582-9 8s4.03 8 9 8 9-3.582 9-8-4.03-8-9-8Zm0 2c3.866 0 7 2.91 7 6s-3.134 6-7 6-7-2.91-7-6 3.134-6 7-6Zm0 2.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z" />
                            </svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
                              <path fillRule="evenodd" d="M3.53 2.47a.75.75 0 0 0-1.06 1.06l2.092 2.093C3.048 7.098 1.658 8.91 1.09 10.7a1.52 1.52 0 0 0 0 .6C2.163 14.228 6.322 18.5 12 18.5c1.53 0 2.973-.317 4.28-.882l4.19 4.192a.75.75 0 1 0 1.06-1.06l-18-18Zm9.164 10.224 2.612 2.611a3.75 3.75 0 0 1-2.35.695 3.75 3.75 0 0 1-3.75-3.75c0-.865.29-1.663.78-2.285l1.695 1.695a1.5 1.5 0 0 0 1.913 1.913Zm7.038-4.657-2.94 2.94a3.75 3.75 0 0 0-4.768-4.768l-2.533-2.533A10.47 10.47 0 0 1 12 5.5c5.678 0 9.837 4.272 10.91 7.2.085.236.085.364 0 .6a10.11 10.11 0 0 1-1.566 2.802l-2.612-2.612a3.73 3.73 0 0 0 .232-1.298 3.75 3.75 0 0 0-3.75-3.75c-.44 0-.865.077-1.255.218l2.49-2.49c.502.33.98.7 1.43 1.111Z" clipRule="evenodd" />
                            </svg>
                          )}
                          {label}
                        </span>
                      );
                    })()}
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
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PhotoTableView;