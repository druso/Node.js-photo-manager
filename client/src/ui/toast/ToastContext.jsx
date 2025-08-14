import React, { createContext, useCallback, useContext, useMemo, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import ToastContainer from './ToastContainer';
import { variantPresets } from './toastPresets';

const ToastContext = createContext(null);

export function ToastProvider({ children, position = 'bottom-right', max = 3, defaultDurations = { info: 2000, success: 2000, notification: 2000, warning: 4000, error: 6000 } }) {
  const [toasts, setToasts] = useState([]); // {id, emoji, message, variant, duration, createdAt, expiresAt, remainingMs, _leaving?}
  const timersRef = useRef(new Map());
  const idRef = useRef(1);
  // dynamic offsets (top and bottom). Multiple elements can register by name; we take the max for each edge.
  const offsetsRef = useRef(new Map()); // name -> { top?: px, bottom?: px }
  const [bottomOffset, setBottomOffset] = useState(0);
  const [topOffset, setTopOffset] = useState(0);

  const finalizeRemove = useCallback((id) => {
    setToasts((prev) => prev.filter(t => t.id !== id));
  }, []);

  const remove = useCallback((id) => {
    // mark leaving to allow exit animation, then actually remove shortly after
    setToasts((prev) => prev.map(t => t.id === id ? { ...t, _leaving: true } : t));
    const tm = timersRef.current.get(id);
    if (tm) { clearTimeout(tm); timersRef.current.delete(id); }
    setTimeout(() => finalizeRemove(id), 200); // match CSS exit duration
  }, [finalizeRemove]);

  const scheduleAutoClose = useCallback((toast) => {
    const dur = toast.remainingMs ?? toast.duration ?? defaultDurations[toast.variant] ?? 2500;
    if (dur <= 0) { remove(toast.id); return; }
    const timer = setTimeout(() => remove(toast.id), dur);
    timersRef.current.set(toast.id, timer);
  }, [defaultDurations, remove]);

  const show = useCallback(({ emoji, message, variant = 'notification', duration }) => {
    const id = idRef.current++;
    setToasts((prev) => {
      const now = Date.now();
      const dur = duration ?? defaultDurations[variant] ?? 2500;
      const next = [...prev, { id, emoji, message, variant, duration: dur, createdAt: now, expiresAt: now + dur, remainingMs: dur }];
      // enforce max stack by removing oldest first
      if (next.length > max) next.splice(0, next.length - max);
      return next;
    });
    scheduleAutoClose({ id, variant, duration });
    return id;
  }, [defaultDurations, max, scheduleAutoClose]);

  const clearAll = useCallback(() => {
    setToasts([]);
    for (const tm of timersRef.current.values()) clearTimeout(tm);
    timersRef.current.clear();
  }, []);

  // Pause/resume for hover
  const pause = useCallback((id) => {
    setToasts((prev) => prev.map(t => {
      if (t.id !== id) return t;
      const now = Date.now();
      const remaining = Math.max(0, (t.expiresAt ?? now) - now);
      const tm = timersRef.current.get(id);
      if (tm) { clearTimeout(tm); timersRef.current.delete(id); }
      return { ...t, remainingMs: remaining };
    }));
  }, []);

  const resume = useCallback((id) => {
    const t = toasts.find(x => x.id === id);
    if (!t) return;
    const now = Date.now();
    const remaining = t.remainingMs ?? Math.max(0, (t.expiresAt ?? now) - now);
    const updated = { ...t, expiresAt: now + remaining };
    setToasts((prev) => prev.map(x => x.id === id ? updated : x));
    scheduleAutoClose({ id, variant: t.variant, duration: remaining, remainingMs: remaining });
  }, [scheduleAutoClose, toasts]);

  // promise helper
  const promise = useCallback((p, { pending, success, error }) => {
    const pendingId = show({ emoji: pending?.emoji ?? '⏳', message: pending?.message ?? 'Working...', variant: pending?.variant ?? 'info', duration: pending?.duration ?? 60000 });
    return Promise.resolve(p)
      .then((val) => {
        remove(pendingId);
        if (success) show({ emoji: success.emoji ?? '✅', message: success.message ?? 'Done', variant: success.variant ?? 'success', duration: success.duration });
        return val;
      })
      .catch((err) => {
        remove(pendingId);
        if (error) show({ emoji: error.emoji ?? '⚠️', message: error.message ?? (err?.message || 'Failed'), variant: error.variant ?? 'error', duration: error.duration });
        throw err;
      });
  }, [remove, show]);

  useEffect(() => () => {
    for (const tm of timersRef.current.values()) clearTimeout(tm);
    timersRef.current.clear();
  }, []);

  // Offset management
  const recomputeOffsets = () => {
    const values = Array.from(offsetsRef.current.values());
    const maxBottom = Math.max(0, ...values.map(v => Math.max(0, Number(v?.bottom ?? 0))));
    const maxTop = Math.max(0, ...values.map(v => Math.max(0, Number(v?.top ?? 0))));
    setBottomOffset(maxBottom);
    setTopOffset(maxTop);
  };

  const setOffset = useCallback((name, value) => {
    if (typeof value === 'number') {
      offsetsRef.current.set(name, { bottom: Math.max(0, Number(value) || 0) });
    } else if (value && (typeof value.top === 'number' || typeof value.bottom === 'number')) {
      offsetsRef.current.set(name, {
        top: Math.max(0, Number(value.top) || 0),
        bottom: Math.max(0, Number(value.bottom) || 0),
      });
    } else {
      offsetsRef.current.set(name, { bottom: 0, top: 0 });
    }
    recomputeOffsets();
  }, []);
  const clearOffset = useCallback((name) => {
    offsetsRef.current.delete(name);
    recomputeOffsets();
  }, []);

  const value = useMemo(() => ({ show, remove, clearAll, pause, resume, promise, setOffset, clearOffset, bottomOffset, topOffset }), [show, remove, clearAll, pause, resume, promise, setOffset, clearOffset, bottomOffset, topOffset]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <ToastContainer toasts={toasts} position={position} topOffset={topOffset} bottomOffset={bottomOffset} onClose={remove} onPause={pause} onResume={resume} />, document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
