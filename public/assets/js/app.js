import * as S from './state.js';
import * as T from './text.js';
import { createStorage, KEY } from './storage.js';
import { createApi, ApiError } from './api.js';
import { createSync } from './sync.js';
import { fingerprint } from './merge.js';
import { renderInto } from './markdown.js';

const $ = (id) => document.getElementById(id);
const el = {
  tabs: $('tabs'), text: $('text'), gutter: $('gutter'), preview: $('preview'), toolbar: $('toolbar'),
  pos: $('st-pos'), size: $('st-size'), warn: $('st-warn'), sync: $('sync-state'), account: $('account'),
  findbar: $('findbar'), term: $('find-term'), repl: $('find-repl'), matchCase: $('find-case'), count: $('find-count'),
  toast: $('toast'), dlgFiles: $('dlg-files'), fileList: $('file-list'), fileEmpty: $('file-empty'),
};

const storage = createStorage();
const api = createApi();
let user = null; // {name, picture} quando logado
// base: conteúdo do Drive no último sync. Fica na mesma chave que as abas, para os dois nunca se desencontrarem.
let meta = { syncVersion: null, syncFp: null, syncUser: null, base: null };

const SYNC_LABEL = {
  local: 'Local', pending: 'Alterações pendentes…', syncing: 'Sincronizando…', synced: 'Sincronizado',
  offline: 'Offline — pendente', error: 'Erro ao sincronizar', reauth: 'Entre novamente',
};

// ---------- Estado ----------
const saved = storage.load();
let state = S.deserialize(saved) || S.initialState();
if (saved && saved.meta) meta = readMeta(saved.meta);
function readMeta(m) {
  return {
    syncVersion: m.syncVersion == null ? null : String(m.syncVersion), syncFp: m.syncFp == null ? null : String(m.syncFp),
    syncUser: m.syncUser == null ? null : String(m.syncUser), base: m.base && S.deserialize(m.base) ? m.base : null,
  };
}
let renderedTab = null;

function persist() {
  // Sem espaço para a base, grava só as abas: a próxima mescla fica conservadora (não apaga nada), mas nada se perde.
  const ok = storage.save({ ...S.serialize(state), meta }) || (meta.base !== null && storage.save({ ...S.serialize(state), meta: { ...meta, base: null } }));
  el.warn.textContent = ok ? '' : 'Autosave local desativado (armazenamento indisponível)';
}
let persistTimer = null;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 300);
}
function commit(next, { structural = true } = {}) {
  state = next;
  persistSoon();
  if (user) sync.changed();
  if (structural) renderTabs();
}

const tab = () => S.activeTab(state);

// ---------- Sincronização ----------
const sync = createSync({
  api,
  getWorkspace: () => S.serialize(state),
  // Resultado da mescla com o Drive. Roda de forma síncrona logo após ler o estado: nenhuma tecla se perde.
  applyRemote(data, conflicts) {
    const next = S.deserialize(data);
    if (!next) return;
    replaceState(next);
    persist();
    if (conflicts) toast(`${conflicts} aba(s) foram editadas em dois lugares ao mesmo tempo. Nada foi perdido: a outra versão está na aba "(conflito)" ao lado.`);
  },
  onStatus(s) {
    el.sync.textContent = SYNC_LABEL[s] || s;
    el.sync.dataset.s = s;
  },
  onReauth() { toast('Sessão do Google expirada. Entre novamente — seu conteúdo local está preservado.'); renderAccount(); },
  onBase(version, data) {
    meta = { syncVersion: version, syncFp: null, syncUser: user ? user.id : null, base: data };
    persistSoon();
  },
});

/** Troca o estado inteiro (vindo do Drive ou de outra aba) sem tirar o cursor do lugar quando possível. */
function replaceState(next) {
  const sameTab = next.active === state.active && renderedTab === state.active;
  const { selectionStart: a, selectionEnd: b, scrollTop } = el.text;
  state = next;
  if (!sameTab) { renderedTab = null; renderTabs(); return; }
  renderTabs();
  const content = tab().content;
  if (el.text.value !== content) {
    el.text.value = content;
    if (document.activeElement === el.text) el.text.setSelectionRange(Math.min(a, content.length), Math.min(b, content.length));
    el.text.scrollTop = scrollTop;
    updateGutter(true);
    updateStatus();
    schedulePreview();
  }
  updatePreviewVisibility();
}

// ---------- Toast ----------
let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 5000);
}

// ---------- Abas ----------
function needsConfirm(t) {
  const synced = user && !sync.pending;
  return S.isDirty(t) && (t.driveId || !synced) && (t.content !== '');
}

function renderTabs() {
  const frag = document.createDocumentFragment();
  for (const t of state.tabs) {
    const d = document.createElement('div');
    d.className = 'tab';
    d.setAttribute('role', 'tab');
    d.setAttribute('aria-selected', String(t.id === state.active));
    d.dataset.id = t.id;
    d.draggable = !renaming || renaming.id !== t.id;
    if (renaming && renaming.id === t.id) {
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'rename'; input.value = renaming.value; input.maxLength = 120;
      input.setAttribute('aria-label', 'Novo nome da aba'); input.size = Math.max(8, Math.min(30, renaming.value.length + 1));
      d.append(input);
    } else {
      const title = document.createElement('button');
      title.type = 'button'; title.className = 'title'; title.textContent = t.title; title.title = 'Duplo clique ou F2 para renomear';
      d.append(title);
    }
    if (S.isDirty(t) && (t.driveId || !user)) {
      const dot = document.createElement('span');
      dot.className = 'dirty'; dot.textContent = '●'; dot.title = 'Não salvo'; d.append(dot);
    }
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'close'; close.textContent = '×'; close.setAttribute('aria-label', 'Fechar ' + t.title);
    d.append(close);
    frag.append(d);
  }
  const focusRename = renaming && document.activeElement && document.activeElement.classList.contains('rename');
  const sel = focusRename ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  el.tabs.replaceChildren(frag);
  el.tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const input = el.tabs.querySelector('input.rename');
  if (input && (focusRename || renaming.fresh)) {
    input.focus();
    if (sel) input.setSelectionRange(sel[0], sel[1]); else input.select();
    renaming.fresh = false;
  }
  if (renderedTab !== state.active) loadEditor();
}

function loadEditor() {
  renderedTab = state.active;
  el.text.value = tab().content;
  updateGutter(true);
  updateStatus();
  updatePreviewVisibility();
}

function renderAll() {
  renderTabs();
  loadEditor();
}

el.tabs.addEventListener('click', (e) => {
  const d = e.target.closest('.tab');
  if (!d || e.target.classList.contains('rename')) return;
  if (e.target.classList.contains('close')) closeTab(d.dataset.id);
  else { commit(S.setActive(state, d.dataset.id)); el.text.focus(); }
});
el.tabs.addEventListener('dblclick', (e) => {
  const d = e.target.closest('.tab');
  if (!d || e.target.classList.contains('close') || e.target.classList.contains('rename')) return;
  startRename(d.dataset.id);
});

// ---------- Renomear (direto na aba) ----------
let renaming = null; // { id, value, fresh }
function startRename(id = state.active) {
  const t = state.tabs.find((x) => x.id === id);
  if (!t) return;
  if (state.active !== id) state = S.setActive(state, id);
  renaming = { id, value: t.title, fresh: true };
  renderTabs();
}
function finishRename(save) {
  if (!renaming) return;
  const { id, value } = renaming;
  renaming = null;
  if (save && state.tabs.some((t) => t.id === id)) {
    const next = S.renameTab(state, id, value); // nome vazio mantém o anterior
    if (next !== state && next.tabs.find((t) => t.id === id).title !== state.tabs.find((t) => t.id === id).title) { commit(next); el.text.focus(); return; }
  }
  renderTabs();
  el.text.focus();
}
el.tabs.addEventListener('input', (e) => {
  if (!renaming || !e.target.classList.contains('rename')) return;
  renaming.value = e.target.value;
  e.target.size = Math.max(8, Math.min(30, e.target.value.length + 1));
});
el.tabs.addEventListener('keydown', (e) => {
  if (!renaming || !e.target.classList.contains('rename')) return;
  if (e.key === 'Enter') { e.preventDefault(); finishRename(true); }
  else if (e.key === 'Escape') { e.preventDefault(); finishRename(false); }
  e.stopPropagation(); // atalhos globais não agem enquanto digita o nome
});
el.tabs.addEventListener('focusout', (e) => {
  // Re-render durante a edição (ex.: sync) troca o input; só conclui se o foco saiu de fato.
  if (renaming && e.target.classList.contains('rename')) {
    setTimeout(() => { if (renaming && !(document.activeElement && document.activeElement.classList.contains('rename'))) finishRename(true); });
  }
});
el.tabs.addEventListener('auxclick', (e) => {
  const d = e.target.closest('.tab');
  if (d && e.button === 1) closeTab(d.dataset.id);
});
let dragId = null;
el.tabs.addEventListener('dragstart', (e) => { const d = e.target.closest('.tab'); if (d) { dragId = d.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); } });
el.tabs.addEventListener('dragover', (e) => { if (dragId) { e.preventDefault(); } });
el.tabs.addEventListener('drop', (e) => {
  e.preventDefault();
  const d = e.target.closest('.tab');
  if (dragId && d && d.dataset.id !== dragId) commit(S.moveTab(state, dragId, state.tabs.findIndex((t) => t.id === d.dataset.id)));
  dragId = null;
});
el.tabs.addEventListener('dragend', () => { dragId = null; });

function closeTab(id) {
  const t = state.tabs.find((x) => x.id === id);
  if (t && needsConfirm(t) && !confirm(`"${t.title}" tem alterações não salvas. Fechar mesmo assim?`)) return;
  commit(S.closeTab(state, id));
}

function newTab(title, content, extra = {}) {
  let next = S.addTab(state, title, content);
  if (next === state) { toast('Limite de abas atingido.'); return; }
  const added = next.tabs[next.tabs.length - 1];
  next = S.updateTab(next, added.id, { savedContent: content ?? '', ...extra });
  commit(next);
  el.text.focus();
}

// ---------- Editor ----------
let lastLines = -1;
function updateGutter(force = false) {
  const n = T.lineCount(el.text.value);
  if (force || n !== lastLines) {
    lastLines = n;
    let s = '';
    for (let i = 1; i <= n; i++) s += i + (i < n ? '\n' : '');
    el.gutter.textContent = s;
    el.gutter.style.minWidth = String(n).length + 3 + 'ch';
  }
  el.gutter.scrollTop = el.text.scrollTop;
}

function updateStatus() {
  const v = el.text.value;
  const { line, col } = T.cursorPosition(v, el.text.selectionStart);
  el.pos.textContent = `Ln ${line}, Col ${col}`;
  el.size.textContent = `${v.length.toLocaleString('pt-BR')} caracteres · ${T.lineCount(v).toLocaleString('pt-BR')} linhas`;
}

el.text.addEventListener('input', () => {
  const t = tab();
  const wasDirty = S.isDirty(t);
  state = S.updateTab(state, t.id, { content: el.text.value });
  persistSoon();
  if (user) sync.changed();
  if (wasDirty !== S.isDirty(tab())) renderTabs();
  updateGutter();
  updateStatus();
  schedulePreview();
});
for (const ev of ['keyup', 'click', 'select']) el.text.addEventListener(ev, updateStatus);
el.text.addEventListener('scroll', () => { el.gutter.scrollTop = el.text.scrollTop; });
el.text.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    document.execCommand('insertText', false, '    '); // mantém o histórico de desfazer
  }
});

function gotoLine() {
  const n = parseInt(prompt(`Ir para a linha (1–${T.lineCount(el.text.value)}):`, ''), 10);
  if (!Number.isFinite(n)) return;
  const idx = T.lineStartIndex(el.text.value, n);
  el.text.focus();
  el.text.setSelectionRange(idx, idx);
  updateStatus();
}

// ---------- Localizar / substituir ----------
const opts = () => ({ matchCase: el.matchCase.checked });
function showFind() {
  el.findbar.hidden = false;
  const sel = el.text.value.slice(el.text.selectionStart, el.text.selectionEnd);
  if (sel && !sel.includes('\n')) el.term.value = sel;
  el.term.focus(); el.term.select();
  updateFindCount();
}
function updateFindCount() {
  const n = T.countMatches(el.text.value, el.term.value, opts());
  el.count.textContent = el.term.value ? `${n} ocorrência(s)` : '';
}
function findStep(backwards) {
  const term = el.term.value;
  if (!term) return;
  const from = backwards ? el.text.selectionStart : el.text.selectionEnd;
  const i = T.findNext(el.text.value, term, from, { ...opts(), backwards });
  if (i < 0) { el.count.textContent = 'Não encontrado'; return; }
  el.text.focus();
  el.text.setSelectionRange(i, i + term.length);
  updateStatus();
}
el.findbar.addEventListener('submit', (e) => { e.preventDefault(); findStep(false); });
el.findbar.addEventListener('click', (e) => {
  const a = e.target.dataset && e.target.dataset.find;
  if (a === 'next') findStep(false);
  else if (a === 'prev') findStep(true);
  else if (a === 'close') { el.findbar.hidden = true; el.text.focus(); }
  else if (a === 'replace-all') {
    const r = T.replaceAll(el.text.value, el.term.value, el.repl.value, opts());
    if (r.count) {
      el.text.focus(); el.text.select();
      document.execCommand('insertText', false, r.text); // preserva desfazer e dispara 'input'
      if (el.text.value !== r.text) { el.text.value = r.text; el.text.dispatchEvent(new Event('input')); }
    }
    el.count.textContent = `${r.count} substituição(ões)`;
  }
});
el.term.addEventListener('input', updateFindCount);
el.matchCase.addEventListener('change', updateFindCount);
el.findbar.addEventListener('keydown', (e) => { if (e.key === 'Escape') { el.findbar.hidden = true; el.text.focus(); } });

// ---------- Preview / impressão ----------
let previewTimer = null;
function updatePreviewVisibility() {
  const on = tab().preview;
  el.preview.hidden = !on;
  document.querySelector('[data-action="preview"]').setAttribute('aria-pressed', String(on));
  if (on) renderPreview();
}
function renderPreview() { renderInto(el.preview, tab().content); }
function schedulePreview() {
  if (!tab().preview) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 150);
}
function togglePreview() {
  commit(S.updateTab(state, tab().id, { preview: !tab().preview }), { structural: false });
  updatePreviewVisibility();
}

function printPreview() {
  renderPreview();
  const prev = document.title;
  document.title = tab().title.replace(/\.(md|markdown|txt)$/i, '');
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); document.title = prev; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

// ---------- Conta e Drive ----------
function renderAccount() {
  el.account.replaceChildren();
  if (user) {
    if (user.picture) {
      const img = document.createElement('img');
      img.src = user.picture; img.alt = ''; img.referrerPolicy = 'no-referrer'; el.account.append(img);
    }
    const name = document.createElement('span'); name.textContent = user.name; el.account.append(name);
    const out = document.createElement('button'); out.type = 'button'; out.textContent = 'Sair'; out.dataset.action = 'logout';
    el.account.append(out);
  } else {
    const a = document.createElement('a'); a.href = 'api.php?r=auth/start'; a.textContent = 'Entrar com Google';
    el.account.append(a);
  }
}

async function login() {
  try {
    const me = await api.me();
    if (me.authenticated) {
      user = { name: me.name, picture: me.picture, id: me.uid };
      renderAccount();
      await sync.start(storedBase());
      return;
    }
  } catch { /* offline: segue em modo local */ }
  renderAccount();
}

/** Base da mescla salva neste navegador para o usuário atual (null se não houver). */
function storedBase() {
  if (meta.syncUser !== user.id) return null;
  if (meta.syncVersion && meta.base) return { version: meta.syncVersion, data: meta.base };
  // Migração do formato antigo (só a impressão digital): se o local está intacto desde então, ele é a base.
  if (meta.syncVersion && meta.syncFp && meta.syncFp === legacyFp(S.serialize(state))) {
    return { version: meta.syncVersion, data: S.serialize(state) };
  }
  return null;
}
const legacyFp = (d) => JSON.stringify(d.tabs.map((t) => [t.id, t.title, t.content, t.savedContent, t.driveId || null]));

async function logout() {
  try { await api.logout(); } catch { /* cookie expira de qualquer forma */ }
  user = null; meta = { syncVersion: null, syncFp: null, syncUser: null, base: null };
  sync.stop(); persist(); renderAccount(); renderTabs();
  toast('Você saiu. As abas continuam neste navegador.');
}

async function saveToDrive() {
  if (!user) { toast('Entre com o Google para salvar no Drive.'); return; }
  const t = tab();
  const body = { id: t.driveId || undefined, name: t.title, content: t.content, baseVersion: t.driveVersion };
  try {
    let res;
    try { res = await api.saveFile(body); } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (!confirm('Este arquivo foi alterado no Drive depois da última sincronização. Sobrescrever com a versão local?')) return;
        res = await api.saveFile({ ...body, force: true });
      } else throw e;
    }
    state = S.updateTab(state, t.id, { driveId: res.id, driveVersion: res.version, savedContent: t.content });
    persistSoon(); sync.changed(); renderTabs();
    toast(`"${res.name}" salvo no Drive.`);
  } catch (e) { toast(driveError(e)); }
}

function driveError(e) {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Sessão expirada. Entre novamente.';
    if (e.status === 413 || e.status === 400) return 'Arquivo grande ou nome inválido para o Drive.';
  }
  return 'Não foi possível falar com o Drive. Tente novamente.';
}

async function openFromDrive() {
  if (!user) { toast('Entre com o Google para abrir arquivos do Drive.'); return; }
  try {
    const { files } = await api.listFiles();
    el.fileList.replaceChildren();
    el.fileEmpty.hidden = files.length > 0;
    for (const f of files) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.id = f.id; b.textContent = f.name;
      const small = document.createElement('small'); small.textContent = new Date(f.modifiedTime).toLocaleString('pt-BR');
      b.append(small); li.append(b); el.fileList.append(li);
    }
    el.dlgFiles.showModal();
  } catch (e) { toast(driveError(e)); }
}
el.fileList.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  el.dlgFiles.close();
  const open = state.tabs.find((t) => t.driveId === b.dataset.id);
  if (open) { commit(S.setActive(state, open.id)); return; }
  try {
    const f = await api.openFile(b.dataset.id);
    newTab(f.name, f.content, { driveId: f.id, driveVersion: f.version });
  } catch (err) { toast(err instanceof ApiError && err.status === 415 ? 'Arquivo não é texto UTF-8 suportado.' : driveError(err)); }
});

// ---------- Ações e atalhos ----------
const actions = {
  new: () => newTab(),
  'open-drive': openFromDrive,
  'save-drive': saveToDrive,
  find: showFind,
  rename: () => startRename(),
  goto: gotoLine,
  preview: togglePreview,
  print: printPreview,
  logout,
};
el.toolbar.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (a && actions[a.dataset.action]) actions[a.dataset.action]();
});
el.account.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (a && actions[a.dataset.action]) actions[a.dataset.action]();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'F2' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); startRename(); return; }
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  const map = { s: 'save-drive', f: 'find', h: 'find', g: 'goto', p: 'print' };
  if (e.altKey && k === 'n') actions.new();
  else if (e.altKey && k === 'm') actions.preview();
  else if (e.altKey && k === 'w') closeTab(state.active);
  else if (!e.altKey && map[k]) actions[map[k]]();
  else return;
  e.preventDefault();
});

window.addEventListener('online', () => sync.online());
window.addEventListener('offline', () => { if (user) el.sync.textContent = SYNC_LABEL.offline; });
window.addEventListener('beforeunload', (e) => {
  persist();
  if (user && sync.pending) { sync.flush(); e.preventDefault(); e.returnValue = ''; }
});
// No celular, trocar de app ou bloquear a tela não dispara beforeunload: salva e envia já ao ocultar.
function leaving() {
  clearTimeout(persistTimer);
  persist();
  if (user) sync.flush();
}
window.addEventListener('pagehide', leaving);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) leaving();
  else if (user) sync.pull(); // voltou: traz o que foi feito em outros aparelhos
});
window.addEventListener('focus', () => { if (user && !document.hidden) sync.pull(); });
// Com a página visível, confere periodicamente se outro aparelho mudou algo (consulta leve, sem baixar conteúdo).
setInterval(() => { if (user && !document.hidden) sync.pull(); }, 30000);

// Outra aba deste navegador gravou: a aba oculta adota o estado dela, para não sobrescrevê-lo depois com dados velhos.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY || !e.newValue || !document.hidden) return;
  let raw;
  try { raw = JSON.parse(e.newValue); } catch { return; }
  const next = S.deserialize(raw);
  if (!next || fingerprint(S.serialize(next)) === fingerprint(S.serialize(state)) && next.active === state.active) return;
  clearTimeout(persistTimer);
  replaceState(next);
  meta = readMeta(raw.meta || {});
  if (user) sync.adopt(meta.syncUser === user.id && meta.syncVersion && meta.base ? { version: meta.syncVersion, data: meta.base } : null);
});

// ---------- Início ----------
const params = new URLSearchParams(location.search);
if (params.has('login')) {
  toast(params.get('login') === 'denied' ? 'Login cancelado. Você continua em modo local.' : 'Não foi possível entrar com o Google. Tente novamente.' + (params.get('why') ? ` (${params.get('why').replace(/[^\w-]/g, '').slice(0, 40)})` : ''));
  history.replaceState(null, '', location.pathname);
}
persist();
renderAll();
renderAccount();
login();
