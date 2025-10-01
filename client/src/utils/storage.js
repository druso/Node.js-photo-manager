// Centralized persistent storage
// Canonical schema:
// - localStorage 'ui_prefs': { viewMode, sizeLevel }
// - SESSION-ONLY single key `session_ui_state` for current tab session:
//     { windowY?: number, mainY?: number, pagination?: { [mode]: { cursors, pages } } }
//
// NOTE: Viewer state, filters, and other navigation state are now managed via URL parameters

const safeParse = (s, fallback = null) => {
  try { return JSON.parse(s); } catch { return fallback; }
};

export function getUiPrefs() {
  const raw = localStorage.getItem('ui_prefs');
  return raw ? safeParse(raw, {}) : {};
}

export function setUiPrefs(prefs) {
  try { localStorage.setItem('ui_prefs', JSON.stringify(prefs || {})); } catch {}
}

export function getLastProject() {
  try { return localStorage.getItem('druso-last-project') || null; } catch { return null; }
}

export function setLastProject(folder) {
  try { if (folder) localStorage.setItem('druso-last-project', folder); } catch {}
}

// -------------------------------
// Session-only state (single key)
// -------------------------------
const SESSION_KEY = 'session_ui_state';

export function getSessionState() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? safeParse(raw, {}) : {};
  } catch {
    return {};
  }
}

export function setSessionState(partial) {
  const prev = getSessionState();
  const next = { ...prev, ...(partial || {}) };
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(next)); } catch {}
}

export function clearSessionState() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

export function setSessionWindowY(y) { setSessionState({ windowY: Number(y) || 0 }); }
export function setSessionMainY(y) { setSessionState({ mainY: Number(y) || 0 }); }

// Pagination cursor persistence
export function getSessionPagination(mode) {
  const state = getSessionState();
  return state?.pagination?.[mode] || null;
}

export function setSessionPagination(mode, paginationState) {
  const prev = getSessionState();
  const pagination = { ...(prev.pagination || {}), [mode]: paginationState };
  setSessionState({ pagination });
}

export function clearSessionPagination(mode) {
  const prev = getSessionState();
  if (!prev.pagination) return;
  const pagination = { ...prev.pagination };
  delete pagination[mode];
  setSessionState({ pagination });
}
