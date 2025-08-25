// Centralized persistent storage with migration from legacy session/local keys
// Canonical schema:
// - localStorage 'ui_prefs': { viewMode, sizeLevel, filtersCollapsed, activeFilters, activeTab }
// - SESSION-ONLY single key `session_ui_state` for current tab session:
//     { windowY?: number, mainY?: number, viewer?: { isOpen: boolean, startIndex?: number, filename?: string, showInfo?: boolean } }

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
export function setSessionViewer(viewer) {
  const prev = getSessionState();
  const mergedViewer = { ...(prev.viewer || {}), ...(viewer || {}) };
  setSessionState({ viewer: mergedViewer });
}
