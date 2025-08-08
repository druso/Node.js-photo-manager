import React from 'react';

const PhotoTableView = ({ projectData, projectFolder, onPhotoSelect, selectedPhotos, onToggleSelection }) => {
  const photos = projectData?.photos || [];

  if (photos.length === 0) {
    return <p className="text-center text-gray-500 py-8">No photos to display in table view.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full bg-white divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Preview</th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Filename</th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Types</th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date Taken</th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tags</th>
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
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="relative group w-16 h-16">
                {(() => {
                  const isRawFile = /\.(arw|cr2|nef|dng|raw)$/i.test(photo.filename);
                  const hasThumbnail = photo.thumbnail_status === 'generated';
                  const thumbnailPending = photo.thumbnail_status === 'pending';
                  const thumbnailFailed = photo.thumbnail_status === 'failed';
                  
                  if (isRawFile || !hasThumbnail) {
                    return (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gray-300 text-gray-600 rounded-md">
                        <svg className="w-6 h-6 mb-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                        </svg>
                        {isRawFile ? (
                          <span className="text-xs font-medium">RAW</span>
                        ) : thumbnailPending ? (
                          <span className="text-xs font-medium">PROC</span>
                        ) : (
                          <span className="text-xs font-medium">NO PREV</span>
                        )}
                      </div>
                    );
                  } else {
                    return (
                      <img 
                        src={`/api/projects/${projectFolder}/thumbnail/${photo.filename}`}
                        alt={`Thumbnail of ${photo.filename}`}
                        className="w-full h-full object-cover rounded-md"
                        loading="lazy"
                      />
                    );
                  }
                })()}
                  <div 
                    className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-md"
                  >
                    <button 
                      onClick={(e) => {
                        e.stopPropagation(); // Prevent row click from firing
                        onPhotoSelect(photo);
                      }}
                      className="text-white text-sm bg-gray-800 bg-opacity-75 px-3 py-1 rounded-md hover:bg-gray-700"
                    >
                      View
                    </button>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{photo.filename}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <div className="flex flex-col">
                  {photo.jpg_available && <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">JPG</span>}
                  {photo.raw_available && <span className="mt-1 px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800">RAW</span>}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {photo.metadata?.date_time_original ? new Date(photo.metadata.date_time_original).toLocaleDateString() : 'N/A'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
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