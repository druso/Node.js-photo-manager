import React from 'react';

// Shared thumbnail renderer with consistent placeholder logic
// Props:
// - photo: manifest photo object
// - projectFolder: string
// - className: optional class names for sizing/styling
// - rounded: apply rounded corners (default true)
// - alt: alt text
export default function Thumbnail({ photo, projectFolder, className = '', rounded = true, alt, objectFit = 'cover' }) {
  const isRawFile = /\.(arw|cr2|nef|dng|raw)$/i.test(photo.filename);

  const hasThumbnail = photo.thumbnail_status === 'generated';
  const thumbnailPending = photo.thumbnail_status === 'pending' || (!photo.thumbnail_status && !hasThumbnail);
  const thumbnailFailed = photo.thumbnail_status === 'failed';

  const commonClasses = `${className} ${rounded ? 'rounded-md' : ''}`.trim();
  const fitClass = objectFit === 'contain' ? 'object-contain' : 'object-cover';
  // Use DB-updated timestamp to break cache when a thumbnail/preview gets generated
  const versionParam = encodeURIComponent(photo.updated_at || '0');

  // If a thumbnail exists, always show it (even for RAW files)
  if (hasThumbnail) {
    return (
      <img
        src={`/api/projects/${projectFolder}/thumbnail/${photo.filename}?v=${versionParam}`}
        alt={alt || photo.filename}
        className={`${commonClasses} ${fitClass}`}
        loading="lazy"
      />
    );
  }

  return (
    <div className={`${commonClasses} bg-gray-200 text-gray-600 relative overflow-hidden`}> 
      {/* Ensure square placeholder regardless of container width */}
      <div className="w-full aspect-square flex items-center justify-center">
        {thumbnailPending ? (
          <span className="inline-block h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" title="Processing" />
        ) : (
          <>
            <svg className="w-6 h-6 mb-1" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
            </svg>
            {isRawFile ? (
              <span className="text-[10px] font-medium">RAW</span>
            ) : (
              <span className="text-[10px] font-medium">NO PREVIEW</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
