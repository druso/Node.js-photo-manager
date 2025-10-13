import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { login as apiLogin, refreshAccessToken as apiRefresh, logout as apiLogout } from '../api/authApi';
import { setAuthAccessToken } from '../api/httpClient';

const AuthContext = createContext(null);

const INITIAL_STATE = {
  status: 'loading',
  admin: null,
  error: null,
  isLoggingIn: false,
};

const REFRESH_LEEWAY_MS = 30_000;
const REFRESH_OPT_IN_KEY = 'auth.refresh.optin';

const setRefreshOptIn = (enabled) => {
  if (typeof window === 'undefined') return;
  try {
    const storage = window.localStorage;
    if (!storage) return;
    if (enabled) {
      storage.setItem(REFRESH_OPT_IN_KEY, '1');
    } else {
      storage.removeItem(REFRESH_OPT_IN_KEY);
    }
  } catch {
    // Ignore storage access errors (e.g., privacy mode)
  }
};

const hasRefreshOptIn = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem(REFRESH_OPT_IN_KEY) === '1';
  } catch {
    return false;
  }
};

export function AuthProvider({ children }) {
  const [state, setState] = useState(INITIAL_STATE);
  const refreshTimerRef = useRef(null);
  const refreshFnRef = useRef(null);
  const mountedRef = useRef(true);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const scheduleRefresh = useCallback((expiresInSeconds) => {
    clearRefreshTimer();
    if (!expiresInSeconds || !Number.isFinite(expiresInSeconds)) return;
    const timeoutMs = Math.max(5_000, (expiresInSeconds * 1000) - REFRESH_LEEWAY_MS);
    refreshTimerRef.current = setTimeout(() => {
      if (refreshFnRef.current) {
        void refreshFnRef.current();
      }
    }, timeoutMs);
  }, [clearRefreshTimer]);

  const applyAuthenticatedState = useCallback((data, options = {}) => {
    const admin = data?.admin ?? { role: 'admin' };
    const accessToken = data?.accessToken ?? null;
    const expiresInSeconds = data?.accessTokenExpiresIn ?? null;

    if (accessToken) {
      setAuthAccessToken(accessToken);
    }

    setState(prev => ({
      status: 'authenticated',
      admin,
      error: options.error ?? null,
      isLoggingIn: false,
    }));

    setRefreshOptIn(true);
    scheduleRefresh(expiresInSeconds);
  }, [scheduleRefresh]);

  const setUnauthenticatedState = useCallback((errorMessage = null) => {
    setAuthAccessToken(null);
    clearRefreshTimer();
    setRefreshOptIn(false);
    setState({
      status: 'unauthenticated',
      admin: null,
      error: errorMessage,
      isLoggingIn: false,
    });
  }, [clearRefreshTimer]);

  const performRefresh = useCallback(async () => {
    try {
      const data = await apiRefresh();
      if (!mountedRef.current) return null;
      applyAuthenticatedState(data);
      return data;
    } catch (error) {
      if (!mountedRef.current) return null;
      if (error?.status === 401) {
        setUnauthenticatedState('Session expired. Please log in again.');
      } else {
        setUnauthenticatedState(error?.message || 'Unable to refresh session.');
      }
      return null;
    }
  }, [applyAuthenticatedState, setUnauthenticatedState]);

  useEffect(() => {
    refreshFnRef.current = performRefresh;
  }, [performRefresh]);

  const handleLogin = useCallback(async (password) => {
    setState(prev => ({ ...prev, isLoggingIn: true, error: null }));
    try {
      const data = await apiLogin(password);
      if (!mountedRef.current) return { ok: false };
      applyAuthenticatedState(data);
      return { ok: true };
    } catch (error) {
      if (!mountedRef.current) return { ok: false };
      const message = error?.message || 'Login failed.';
      setUnauthenticatedState(message);
      return { ok: false, error: message };
    }
  }, [applyAuthenticatedState, setUnauthenticatedState]);

  const handleLogout = useCallback(async () => {
    try {
      await apiLogout();
    } catch (error) {
      // swallow logout errors but log for debugging
      if (process?.env?.NODE_ENV !== 'production') {
        console.warn('logout failed', error);
      }
    } finally {
      if (!mountedRef.current) return;
      setUnauthenticatedState(null);
    }
  }, [setUnauthenticatedState]);

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const isSharedRoute = (() => {
      if (typeof window === 'undefined') return false;
      try {
        return (window.location?.pathname || '').startsWith('/shared/');
      } catch {
        return false;
      }
    })();

    const refreshOptIn = hasRefreshOptIn();

    if (isSharedRoute && !refreshOptIn) {
      setRefreshOptIn(false);
      setState(prev => (
        prev.status === 'loading'
          ? { status: 'unauthenticated', admin: null, error: prev.error, isLoggingIn: false }
          : prev
      ));
      return () => {
        mountedRef.current = false;
        clearRefreshTimer();
        setAuthAccessToken(null);
      };
    }

    if (!refreshOptIn) {
      setState(prev => (
        prev.status === 'loading'
          ? { status: 'unauthenticated', admin: null, error: prev.error, isLoggingIn: false }
          : prev
      ));
      return () => {
        mountedRef.current = false;
        clearRefreshTimer();
        setAuthAccessToken(null);
      };
    }

    (async () => {
      const data = await performRefresh();
      if (!mountedRef.current && data) {
        setAuthAccessToken(null);
      }
      if (!mountedRef.current && refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      if (!mountedRef.current) return;
      if (!data) {
        // performRefresh already transitioned to unauthenticated state on failure
        setState(prev => ({ ...prev, status: prev.status === 'loading' ? 'unauthenticated' : prev.status }));
      }
    })();
    return () => {
      mountedRef.current = false;
      clearRefreshTimer();
      setAuthAccessToken(null);
    };
  }, [performRefresh, clearRefreshTimer]);

  const value = useMemo(() => ({
    status: state.status,
    admin: state.admin,
    error: state.error,
    isLoggingIn: state.isLoggingIn,
    isAuthenticated: state.status === 'authenticated',
    login: handleLogin,
    logout: handleLogout,
    refresh: performRefresh,
    clearError,
  }), [state, handleLogin, handleLogout, performRefresh, clearError]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
