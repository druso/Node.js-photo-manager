import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';

export default function LoginPage() {
  const { login, isLoggingIn, error, clearError } = useAuth();
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (error) {
      setFormError(error);
    }
  }, [error]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!password) {
      setFormError('Password is required.');
      return;
    }
    const result = await login(password);
    if (!result.ok) {
      setFormError(result.error || 'Access denied.');
      setPassword('');
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  };

  const handleChange = (event) => {
    setPassword(event.target.value);
    if (formError) {
      setFormError(null);
      clearError();
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-gray-200 border-b border-gray-300">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-xl font-semibold text-gray-900 tracking-wide">Druso Photo Manager</h1>
        </div>
      </header>
      <main className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-white shadow-lg rounded-lg p-8">
          <h2 className="text-2xl font-semibold text-center mb-6 text-gray-900">Private area</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Access password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                ref={inputRef}
                value={password}
                onChange={handleChange}
                className="block w-full border border-gray-300 rounded-md px-3 sm:px-4 py-1.5 sm:py-2 shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                disabled={isLoggingIn}
                autoComplete="current-password"
                placeholder="Enter password"
              />
            </div>
            {formError && (
              <div className="text-sm text-red-600" role="alert">
                {formError}
              </div>
            )}
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-300"
            >
              {isLoggingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="mt-6 text-xs text-gray-500 text-center">
            Access restricted to authorized users. Sessions refresh automatically while active.
          </p>
        </div>
      </main>
    </div>
  );
}
