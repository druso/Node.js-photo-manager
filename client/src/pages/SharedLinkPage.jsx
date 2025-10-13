import React, { useState } from 'react';
import AllPhotosPane from '../components/AllPhotosPane';
import PhotoViewer from '../components/PhotoViewer';
import { PublicHashProvider } from '../contexts/PublicHashContext';
import { useSharedLinkData } from '../hooks/useSharedLinkData';

function SharedLinkPage({ hashedKey }) {
  const [viewerState, setViewerState] = useState({ isOpen: false, startIndex: 0 });
  const [viewerList, setViewerList] = useState([]);

  // Use the same hook as authenticated users
  const {
    photos,
    metadata,
    total,
    nextCursor,
    prevCursor,
    loading,
    error,
    loadMore,
    loadPrev,
    hasMore,
    hasPrev,
  } = useSharedLinkData({
    hashedKey,
    isAuthenticated: false, // Public user
    limit: 100,
  });

  const handlePhotoSelect = (photo) => {
    const index = photos.findIndex(p => p.id === photo.id);
    if (index !== -1) {
      setViewerList(photos);
      setViewerState({ isOpen: true, startIndex: index });
    }
  };

  const handleCloseViewer = () => {
    setViewerState({ isOpen: false, startIndex: 0 });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Loading shared photos...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="text-6xl mb-4">🔗</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Link Not Found</h1>
          <p className="text-gray-600 mb-6">{error.message || 'Failed to load shared link'}</p>
          <p className="text-sm text-gray-500">
            This shared link may have been removed or the URL may be incorrect.
          </p>
        </div>
      </div>
    );
  }

  return (
    <PublicHashProvider>
      <div className="min-h-screen bg-gray-50">
        {/* App Header */}
        <header className="bg-gray-100 shadow-none border-b-0 relative sticky top-0 z-20">
          <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <h1 className="text-2xl font-bold text-gray-900">
                Druso Photo Manager
              </h1>
              
              {/* Login button for public users */}
              <button
                onClick={() => window.location.href = '/'}
                className="inline-flex items-center gap-2 rounded-md border shadow-sm px-3 py-2 text-sm font-medium bg-white text-gray-700 hover:bg-gray-50 border-gray-300"
                title="Login"
                aria-label="Login"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                Login
              </button>
            </div>
            
            {/* Shared link title and description */}
            <div className="pb-3 space-y-1">
              <h2 className="text-lg font-semibold text-gray-900">{metadata.title || 'Shared Gallery'}</h2>
              {metadata.description && (
                <p className="text-sm text-gray-600 whitespace-pre-line">{metadata.description}</p>
              )}
            </div>
          </div>
        </header>

        {/* Photo Grid - Using AllPhotosPane for consistency */}
        <div className="w-full px-4 sm:px-6 lg:px-8 pt-2 pb-8">
          <AllPhotosPane
            viewMode="grid"
            sortKey="date"
            sortDir="desc"
            sizeLevel={2}
            onSortChange={() => {}} // Public users can't sort
            photos={photos}
            hasMore={hasMore}
            onLoadMore={loadMore}
            hasPrev={hasPrev}
            onLoadPrev={loadPrev}
            anchorIndex={null}
            onAnchored={() => {}}
            lazyLoadThreshold={100}
            dwellMs={300}
            onPhotoSelect={handlePhotoSelect}
            onToggleSelection={() => {}} // Public users can't select
            selectedPhotos={new Set()} // No selection for public
            onEnterSelectionMode={() => {}} // Public users can't enter selection mode
            loading={loading}
          />
        </div>

        {/* Photo Viewer */}
        {viewerState.isOpen && (
          <PhotoViewer
            projectData={{ photos: viewerList }}
            projectFolder={viewerList[viewerState.startIndex]?.project_folder}
            startIndex={viewerState.startIndex}
            onClose={handleCloseViewer}
            config={{}}
            selectedPhotos={new Set()}
            onToggleSelect={() => {}}
            onKeepUpdated={() => {}}
            onCurrentIndexChange={() => {}}
            fromAllMode={false}
            onRequestMove={() => {}}
            onShowInfoChange={() => {}}
            isPublicView={true}
          />
        )}
      </div>
    </PublicHashProvider>
  );
}

export default SharedLinkPage;
