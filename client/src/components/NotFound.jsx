import React from 'react';

/**
 * 404 Not Found component
 * Displayed when user navigates to a non-existent URL
 */
export default function NotFound({ message = 'Page not found', details = null }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-8">
          <h1 className="text-9xl font-bold text-gray-300">404</h1>
        </div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-4">
          {message}
        </h2>
        {details && (
          <p className="text-gray-600 mb-8">
            {details}
          </p>
        )}
        <div className="space-y-3">
          <a
            href="/"
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Go to Home
          </a>
          <div>
            <a
              href="/all"
              className="inline-block px-6 py-3 text-blue-600 hover:text-blue-700 transition-colors"
            >
              View All Photos
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
