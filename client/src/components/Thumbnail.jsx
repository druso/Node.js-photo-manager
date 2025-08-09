import React from 'react';

// Shared thumbnail renderer with consistent placeholder logic
// Props:
// - photo: manifest photo object
// - projectFolder: string
// - className: optional class names for sizing/styling
// - rounded: apply rounded corners (default true)
// - alt: alt text
export default function Thumbnail({ photo, projectFolder, className = '', rounded = true, alt }) {
  const isRawFile = /\.(arw|cr2|nef|dng|raw)$/i.test(photo.filename);
  const hasThumbnail = photo.thumbnail_status === 'generated';
  const thumbnailPending = photo.thumbnail_status === 'pending';
  const thumbnailFailed = photo.thumbnail_status === 'failed';

  const commonClasses = `${className} ${rounded ? 'rounded-md' : ''}`.trim();

  if (!isRawFile && hasThumbnail) {
    return (
      <img
        src={`/api/projects/${projectFolder}/thumbnail/${photo.filename}`}
        alt={alt || photo.filename}
        className={`${commonClasses} object-cover`}
        loading="lazy"
      />
    );
  }

  return (
    <div className={`${commonClasses} flex flex-col items-center justify-center bg-gray-300 text-gray-600`}> 
      <svg className="w-6 h-6 mb-1" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
      </svg>
      {isRawFile ? (
        <span className="text-xs font-medium">RAW</span>
      ) : thumbnailPending ? (
        <span className="text-xs font-medium">PROCESSING</span>
      ) : thumbnailFailed ? (
        <span className="text-xs font-medium">NO PREVIEW</span>
      ) : (
        <span className="text-xs font-medium">NO PREVIEW</span>
      )}
    </div>
  );
}
