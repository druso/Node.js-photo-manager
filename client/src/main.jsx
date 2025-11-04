import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import LoginPage from './auth/LoginPage';
import reportWebVitals from './reportWebVitals';
import { ToastProvider } from './ui/toast/ToastContext';
import { AuthProvider, useAuth } from './auth/AuthContext';
import SharedLinkPage from './pages/SharedLinkPage';
import SharedLinksPage from './pages/SharedLinksPage';


// Protected route wrapper that requires authentication
function ProtectedApp({ sharedLinkHash = null }) {
  const { status } = useAuth();
  
  // Show loading state while checking authentication
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }
  
  // Show login page if not authenticated
  if (status === 'unauthenticated') {
    return (
      <ToastProvider>
        <LoginPage />
      </ToastProvider>
    );
  }
  
  // Render main app if authenticated
  return (
    <ToastProvider>
      <App sharedLinkHash={sharedLinkHash} />
    </ToastProvider>
  );
}

function SharedLinkRoute({ hashedKey, photoName }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading shared link...</p>
        </div>
      </div>
    );
  }

  if (status === 'authenticated') {
    return (
      <ToastProvider>
        <App sharedLinkHash={hashedKey} initialPhotoName={photoName} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <SharedLinkPage hashedKey={hashedKey} initialPhotoName={photoName} />
    </ToastProvider>
  );
}

// Simple router based on URL path
function Router() {
  const path = window.location.pathname;
  
  // Match both /shared/{token} and /shared/{token}/{photo}
  const sharedLinkMatch = path.match(/^\/shared\/([a-zA-Z0-9_-]{32})(?:\/(.+))?$/);
  
  if (sharedLinkMatch) {
    const hashedKey = sharedLinkMatch[1];
    const photoName = sharedLinkMatch[2]; // Optional photo name for deep linking
    return (
      <AuthProvider>
        <SharedLinkRoute hashedKey={hashedKey} photoName={photoName} />
      </AuthProvider>
    );
  }
  
  // Shared links management page (admin-only)
  if (path === '/sharedlinks') {
    return (
      <AuthProvider>
        <ProtectedSharedLinksPage />
      </AuthProvider>
    );
  }
  
  // All other routes require authentication
  return (
    <AuthProvider>
      <ProtectedApp />
    </AuthProvider>
  );
}

// Protected route for shared links management page
function ProtectedSharedLinksPage() {
  const { status } = useAuth();
  
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }
  
  if (status === 'unauthenticated') {
    return (
      <ToastProvider>
        <LoginPage />
      </ToastProvider>
    );
  }
  
  return (
    <ToastProvider>
      <SharedLinksPage />
    </ToastProvider>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>
);

reportWebVitals();
