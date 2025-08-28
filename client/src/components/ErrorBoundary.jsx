import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-black/80 text-white z-50 flex items-center justify-center">
          <div className="max-w-md p-4 text-center">
            <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
            <p className="text-sm opacity-80 mb-4">Viewer crashed. Close and try again.</p>
            <button className="px-4 py-2 bg-white text-gray-900 rounded" onClick={() => this.setState({ hasError: false, error: null })}>
              Dismiss
            </button>
          </div>
        </div>
      );
    }
    // eslint-disable-next-line react/prop-types
    return this.props.children;
  }
}

export default ErrorBoundary;
