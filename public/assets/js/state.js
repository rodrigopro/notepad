// Estado das abas: funções puras, sem DOM.
export const MAX_TABS = 200;

let counter = 0;
export function newId() {
  counter += 1;
  return 't' + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
}

export function makeTab(title, content = '') {
  return { id: newId(), title, content, savedContent: content, driveId: null, driveVersion: null, preview: false };
}

export function initialState() {
  const tab = makeTab('Sem título 1');
  return { tabs: [tab], active: tab.id, seq: 1 };
}

export function isDirty(tab) {
  return tab.content !== tab.savedContent;
}

export function activeTab(state) {
  return state.tabs.find((t) => t.id === state.active) || state.tabs[0];
}

export function addTab(state, title, content = '') {
  if (state.tabs.length >= MAX_TABS) return state;
  const seq = title ? state.seq : state.seq + 1;
  const tab = makeTab(title || `Sem título ${seq}`, content);
  return { ...state, tabs: [...state.tabs, tab], active: tab.id, seq };
}

export function closeTab(state, id) {
  const i = state.tabs.findIndex((t) => t.id === id);
  if (i < 0) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (tabs.length === 0) {
    const seq = state.seq + 1;
    const tab = makeTab(`Sem título ${seq}`);
    return { tabs: [tab], active: tab.id, seq };
  }
  const active = state.active === id ? tabs[Math.min(i, tabs.length - 1)].id : state.active;
  return { ...state, tabs, active };
}

export function setActive(state, id) {
  return state.tabs.some((t) => t.id === id) ? { ...state, active: id } : state;
}

export function updateTab(state, id, patch) {
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export function renameTab(state, id, title) {
  const clean = String(title).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
  return clean ? updateTab(state, id, { title: clean }) : state;
}

export function moveTab(state, id, toIndex) {
  const from = state.tabs.findIndex((t) => t.id === id);
  if (from < 0) return state;
  const tabs = state.tabs.slice();
  const [tab] = tabs.splice(from, 1);
  tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
  return { ...state, tabs };
}

/** Formato persistido (localStorage e Drive). */
export function serialize(state) {
  return {
    v: 1,
    active: state.active,
    seq: state.seq,
    tabs: state.tabs.map((t) => ({
      id: t.id, title: t.title, content: t.content, savedContent: t.savedContent,
      driveId: t.driveId, driveVersion: t.driveVersion, preview: t.preview,
    })),
  };
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);

/** Valida dados externos; devolve estado válido ou null. */
export function deserialize(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.tabs) || data.tabs.length === 0) return null;
  const seen = new Set();
  const tabs = [];
  for (const raw of data.tabs.slice(0, MAX_TABS)) {
    const id = str(raw && raw.id, 64);
    const title = str(raw && raw.title, 120);
    const content = str(raw && raw.content, 5 * 1024 * 1024);
    if (!id || seen.has(id) || title === null || content === null) continue;
    seen.add(id);
    const saved = str(raw.savedContent, 5 * 1024 * 1024);
    tabs.push({
      id, title: title || 'Sem título', content,
      savedContent: saved === null ? content : saved,
      driveId: /^[A-Za-z0-9_-]{10,128}$/.test(raw.driveId || '') ? raw.driveId : null,
      driveVersion: str(raw.driveVersion, 32),
      preview: raw.preview === true,
    });
  }
  if (tabs.length === 0) return null;
  const active = tabs.some((t) => t.id === data.active) ? data.active : tabs[0].id;
  return { tabs, active, seq: Number.isInteger(data.seq) && data.seq > 0 ? data.seq : tabs.length };
}
