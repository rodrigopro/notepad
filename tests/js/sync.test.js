import test from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from '../../public/assets/js/sync.js';
import { mergeWorkspaces, fingerprint } from '../../public/assets/js/merge.js';
import { ApiError, createApi } from '../../public/assets/js/api.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const tab = (id, content, title = id) => ({ id, title, content, savedContent: content, driveId: null, driveVersion: null, preview: false });
const ws = (...tabs) => ({ v: 1, active: tabs[0] ? tabs[0].id : null, seq: tabs.length, tabs });
const contents = (d) => Object.fromEntries(d.tabs.map((t) => [t.id, t.content]));

/** Drive falso com a mesma semântica do api/drive.php (versão, 409 com o remoto, `known`). */
function fakeDrive() {
  const drive = { version: 0, data: null, saves: 0, gets: 0, downloads: 0, fail: null };
  drive.api = () => ({
    async getWorkspace(known = null) {
      drive.gets++;
      if (drive.fail) throw drive.fail;
      if (drive.data === null) return { exists: false };
      if (known !== null && known === String(drive.version)) return { exists: true, version: known, unchanged: true };
      drive.downloads++;
      return { exists: true, version: String(drive.version), data: clone(drive.data) };
    },
    async saveWorkspace(data, base) {
      drive.saves++;
      if (drive.fail) throw drive.fail;
      if (drive.data !== null && base !== String(drive.version)) {
        throw new ApiError(409, 'conflict', { error: 'conflict', version: String(drive.version), data: clone(drive.data) });
      }
      drive.data = clone(data); drive.version++;
      return { version: String(drive.version) };
    },
  });
  return drive;
}

/** Um aparelho: estado local + sync com timers manuais. */
function device(drive, initial, opts = {}) {
  const d = { ws: clone(initial), statuses: [], timers: [], applied: [], bases: [], reauth: 0 };
  d.sync = createSync({
    api: opts.api || drive.api(),
    getWorkspace: () => clone(d.ws),
    applyRemote: (data, conflicts) => { d.ws = clone(data); d.applied.push(conflicts); },
    onStatus: (s) => d.statuses.push(s),
    onReauth: () => d.reauth++,
    onBase: (v, data) => d.bases.push({ version: v, data: data && clone(data) }),
    setTimer: (fn, ms) => { d.timers.push({ fn, ms }); return d.timers.length; },
    clearTimer: () => {},
    isOnline: opts.isOnline || (() => true),
  });
  d.base = () => d.bases.at(-1) || null;
  d.edit = (id, content) => {
    const t = d.ws.tabs.find((x) => x.id === id);
    if (t) t.content = content; else d.ws.tabs.push(tab(id, content));
    d.sync.changed();
  };
  d.tick = () => d.timers.at(-1).fn();
  return d;
}

// ---------- Mescla ----------

test('merge: abas diferentes editadas em cada lado → as duas edições sobrevivem', () => {
  const base = ws(tab('a', '1'), tab('b', '1'));
  const local = ws(tab('a', 'local'), tab('b', '1'));
  const remote = ws(tab('a', '1'), tab('b', 'remoto'));
  const { data, conflicts } = mergeWorkspaces(base, local, remote);
  assert.deepEqual(contents(data), { a: 'local', b: 'remoto' });
  assert.equal(conflicts, 0);
});

test('merge: mesma aba editada nos dois lados → local fica e remoto vira aba (conflito) ao lado', () => {
  const base = ws(tab('a', 'x'), tab('b', 'y'));
  const { data, conflicts } = mergeWorkspaces(base, ws(tab('a', 'L'), tab('b', 'y')), ws(tab('a', 'R'), tab('b', 'y')));
  assert.equal(conflicts, 1);
  assert.deepEqual(data.tabs.map((t) => t.content), ['L', 'R', 'y']);
  assert.match(data.tabs[1].title, /\(conflito\)$/);
  // repetir a mescla com o resultado não duplica a cópia
  const again = mergeWorkspaces(base, data, ws(tab('a', 'R'), tab('b', 'y')));
  assert.equal(again.data.tabs.length, 3);
});

test('merge: aba apagada num lado e intacta no outro é apagada; editada no outro é mantida', () => {
  const base = ws(tab('a', '1'), tab('b', '1'));
  assert.deepEqual(contents(mergeWorkspaces(base, ws(tab('a', '1')), base).data), { a: '1' });
  assert.deepEqual(contents(mergeWorkspaces(base, ws(tab('a', '1')), ws(tab('a', '1'), tab('b', 'editado'))).data), { a: '1', b: 'editado' });
});

test('merge: abas novas dos dois lados entram na posição certa', () => {
  const base = ws(tab('a', '1'));
  const { data } = mergeWorkspaces(base, ws(tab('a', '1'), tab('l', 'n')), ws(tab('a', '1'), tab('r', 'n')));
  assert.deepEqual(data.tabs.map((t) => t.id).sort(), ['a', 'l', 'r']);
  assert.equal(data.tabs[0].id, 'a');
});

test('merge: sem base nada é apagado', () => {
  const { data } = mergeWorkspaces(null, ws(tab('a', 'A')), ws(tab('b', 'B')));
  assert.deepEqual(contents(data), { a: 'A', b: 'B' });
});

test('merge: renomear num lado e editar no outro combina os dois', () => {
  const base = ws(tab('a', 'x', 'Velho'));
  const { data, conflicts } = mergeWorkspaces(base, ws(tab('a', 'x', 'Novo')), ws({ ...tab('a', 'texto', 'Velho'), savedContent: 'x' }));
  assert.equal(conflicts, 0);
  assert.equal(data.tabs[0].title, 'Novo');
  assert.equal(data.tabs[0].content, 'texto');
});

test('merge: aba ativa e preview são locais', () => {
  const base = ws(tab('a', '1'), tab('b', '1'));
  const local = { ...ws(tab('a', '1'), { ...tab('b', '1'), preview: true }), active: 'b' };
  const { data } = mergeWorkspaces(base, local, ws(tab('a', '1'), tab('b', '1')));
  assert.equal(data.active, 'b');
  assert.equal(data.tabs[1].preview, true);
  assert.equal(fingerprint(local), fingerprint(base));
});

// ---------- Dois aparelhos (os cenários que perdiam trabalho) ----------

test('aparelho aberto e parado recebe a edição feita em outro, sem recarregar', async () => {
  const drive = fakeDrive();
  const A = device(drive, ws(tab('a', 'início')));
  await A.sync.start(null);
  const B = device(drive, ws(tab('t0', '')));
  await B.sync.start(null);
  assert.deepEqual(contents(B.ws), { a: 'início' }, 'aparelho novo recebe tudo');
  B.edit('a', 'escrito no celular'); await B.tick();
  await A.sync.pull(); // consulta periódica / ao voltar o foco
  assert.equal(A.ws.tabs[0].content, 'escrito no celular');
  assert.equal(A.sync.pending, false);
});

test('aparelho com dados velhos que edita outra aba não apaga o trabalho do outro', async () => {
  const drive = fakeDrive();
  const A = device(drive, ws(tab('a', '1'), tab('b', '1')));
  await A.sync.start(null);
  const B = device(drive, ws(tab('t0', '')));
  await B.sync.start(null);
  B.edit('a', 'B escreveu'); await B.tick();
  A.edit('b', 'A escreveu'); await A.tick(); // A ainda não sabia da edição de B → 409 → mescla
  assert.deepEqual(contents(drive.data), { a: 'B escreveu', b: 'A escreveu' });
  await B.sync.pull();
  assert.deepEqual(contents(B.ws), { a: 'B escreveu', b: 'A escreveu' });
  assert.deepEqual(contents(A.ws), contents(drive.data));
});

test('os dois editam a mesma aba ao mesmo tempo → nenhum texto se perde', async () => {
  const drive = fakeDrive();
  const A = device(drive, ws(tab('a', 'base')));
  await A.sync.start(null);
  const B = device(drive, ws(tab('t0', '')));
  await B.sync.start(null);
  B.edit('a', 'versão B'); await B.tick();
  A.edit('a', 'versão A'); await A.tick();
  const all = drive.data.tabs.map((t) => t.content).sort();
  assert.deepEqual(all, ['versão A', 'versão B']);
  assert.equal(A.applied.at(-1), 1, 'avisou do conflito');
  await B.sync.pull();
  assert.deepEqual(B.ws.tabs.map((t) => t.content).sort(), ['versão A', 'versão B']);
});

test('edição offline num aparelho + edição online no outro → as duas chegam ao Drive', async () => {
  const drive = fakeDrive();
  let online = true;
  const A = device(drive, ws(tab('a', '1'), tab('b', '1')), { isOnline: () => online });
  await A.sync.start(null);
  const B = device(drive, ws(tab('t0', '')));
  await B.sync.start(null);
  online = false;
  A.edit('a', 'offline'); await A.tick();
  assert.equal(A.statuses.at(-1), 'offline');
  B.edit('b', 'online'); await B.tick();
  online = true;
  A.sync.online(); await new Promise((r) => setImmediate(r));
  assert.deepEqual(contents(drive.data), { a: 'offline', b: 'online' });
  assert.equal(A.sync.pending, false);
});

test('reabrir a página com edição local não enviada e remoto alterado → mescla, sem perguntar', async () => {
  const drive = fakeDrive();
  const A = device(drive, ws(tab('a', '1'), tab('b', '1')));
  await A.sync.start(null);
  const saved = A.base(); // o que ficaria no localStorage
  const B = device(drive, ws(tab('t0', '')));
  await B.sync.start(null);
  B.edit('b', 'de B'); await B.tick();
  // A fechou a página com 'a' editado e não enviado; reabre:
  const A2 = device(drive, ws(tab('a', 'não enviado'), tab('b', '1')));
  await A2.sync.start(saved);
  assert.deepEqual(contents(drive.data), { a: 'não enviado', b: 'de B' });
  assert.deepEqual(contents(A2.ws), contents(drive.data));
});

test('aparelho novo (sem base) com notas próprias junta às do Drive em vez de sobrescrever', async () => {
  const drive = fakeDrive();
  const A = device(drive, ws(tab('a', 'do Drive')));
  await A.sync.start(null);
  const B = device(drive, ws(tab('n', 'nota offline antes do login')));
  await B.sync.start(null);
  assert.deepEqual(contents(drive.data), { a: 'do Drive', n: 'nota offline antes do login' });
});

test('aba apagada num aparelho some no outro', async () => {
  const drive = fakeDrive();
  const A = device(drive, ws(tab('a', '1'), tab('b', '1')));
  await A.sync.start(null);
  const B = device(drive, ws(tab('t0', '')));
  await B.sync.start(null);
  B.ws.tabs = B.ws.tabs.filter((t) => t.id !== 'b'); B.sync.changed(); await B.tick();
  await A.sync.pull();
  assert.deepEqual(contents(A.ws), { a: '1' });
});

// ---------- Mecânica do envio ----------

test('debounce: várias edições geram um envio e terminam em synced', async () => {
  const drive = fakeDrive();
  const A = device(drive, ws(tab('a', '')));
  await A.sync.start(null);
  const before = drive.saves;
  A.edit('a', '1'); A.edit('a', '12'); A.edit('a', '123');
  assert.equal(A.statuses.at(-1), 'pending');
  await A.tick();
  assert.equal(drive.saves - before, 1);
  assert.equal(A.statuses.at(-1), 'synced');
  assert.equal(A.sync.pending, false);
});

test('consulta periódica sem mudança não baixa o conteúdo nem envia', async () => {
  const drive = fakeDrive();
  const A = device(drive, ws(tab('a', 'x')));
  await A.sync.start(null);
  const [saves, downloads] = [drive.saves, drive.downloads];
  await A.sync.pull(); await A.sync.pull();
  assert.equal(drive.saves, saves);
  assert.equal(drive.downloads, downloads);
});

test('edição durante o envio é reenviada', async () => {
  const drive = fakeDrive();
  const inner = drive.api();
  let release = null;
  const api = { ...inner, async saveWorkspace(...a) { if (release === false) await new Promise((r) => { release = r; }); return inner.saveWorkspace(...a); } };
  const A = device(drive, ws(tab('a', '')), { api });
  await A.sync.start(null);
  release = false;
  A.edit('a', 'primeiro');
  const p = A.tick();
  await new Promise((r) => setImmediate(r));
  A.edit('a', 'segundo');
  const r = release; release = null; r(); await p;
  assert.equal(drive.data.tabs[0].content, 'segundo');
  assert.equal(A.sync.pending, false);
});

test('falha de rede agenda nova tentativa sem perder pendência', async () => {
  const drive = fakeDrive();
  const A = device(drive, ws(tab('a', '')));
  await A.sync.start(null);
  drive.fail = new TypeError('Failed to fetch');
  A.edit('a', 'x'); await A.tick();
  assert.equal(A.statuses.at(-1), 'offline');
  assert.equal(A.timers.at(-1).ms, 15000);
  assert.equal(A.sync.pending, true);
  drive.fail = null; await A.tick();
  assert.equal(drive.data.tabs[0].content, 'x');
});

test('401: pede novo login e mantém o conteúdo pendente', async () => {
  const drive = fakeDrive();
  const A = device(drive, ws(tab('a', '')));
  await A.sync.start(null);
  drive.fail = new ApiError(401, 'reauth', {});
  A.edit('a', 'x'); await A.tick();
  assert.equal(A.statuses.at(-1), 'reauth'); assert.equal(A.reauth, 1);
  assert.equal(A.sync.pending, true);
});

test('erro 4xx (ex.: 413) não entra em loop de retentativas', async () => {
  const drive = fakeDrive();
  const A = device(drive, ws(tab('a', '')));
  await A.sync.start(null);
  drive.fail = new ApiError(413, 'payload_too_large', {});
  A.edit('a', 'x'); const t = A.timers.length; await A.tick();
  assert.equal(A.statuses.at(-1), 'error');
  assert.equal(A.timers.length, t, 'sem novo timer');
});

test('429 é tratado como temporário e reagenda', async () => {
  const drive = fakeDrive();
  const A = device(drive, ws(tab('a', '')));
  await A.sync.start(null);
  drive.fail = new ApiError(429, 'rate_limited', {});
  A.edit('a', 'x'); const t = A.timers.length; await A.tick();
  assert.equal(A.statuses.at(-1), 'offline');
  assert.ok(A.timers.length > t, 'nova tentativa agendada');
});

test('start: sem workspace remoto envia o local', async () => {
  const drive = fakeDrive();
  const A = device(drive, ws(tab('a', 'x')));
  await A.sync.start(null);
  assert.equal(drive.saves, 1);
  assert.deepEqual(contents(drive.data), { a: 'x' });
});

test('start: conteúdo igual ao remoto não envia nada', async () => {
  const drive = fakeDrive();
  drive.data = ws(tab('a', 'x')); drive.version = 9;
  const A = device(drive, ws(tab('a', 'x')));
  await A.sync.start(null);
  assert.equal(drive.saves, 0);
  assert.equal(A.statuses.at(-1), 'synced');
});

test('adopt: aba oculta herda a base da outra e não reenvia', async () => {
  const drive = fakeDrive();
  const A = device(drive, ws(tab('a', 'x')));
  await A.sync.start(null);
  A.edit('a', 'y');
  A.sync.adopt({ version: String(drive.version), data: clone(drive.data) });
  assert.equal(A.sync.pending, false);
});

test('api: monta requisições com header CSRF, JSON, keepalive e converte erros', async () => {
  const seen = [];
  const f = async (url, init) => { seen.push({ url, init }); return { ok: false, status: 409, json: async () => ({ error: 'conflict', version: '1' }) }; };
  const api = createApi(f, 'api.php');
  await assert.rejects(() => api.saveWorkspace({ tabs: [] }, '1'), (e) => e instanceof ApiError && e.status === 409 && e.data.version === '1');
  assert.equal(seen[0].url, 'api.php?r=drive%2Fworkspace%2Fsave');
  assert.equal(seen[0].init.headers['X-Notepad'], '1');
  assert.equal(seen[0].init.headers['Content-Type'], 'application/json');
  assert.equal(seen[0].init.credentials, 'same-origin');
  assert.equal(seen[0].init.keepalive, true);
  await assert.rejects(() => api.saveWorkspace({ tabs: [{ content: 'x'.repeat(70000) }] }, '1'));
  assert.equal(seen[1].init.keepalive, undefined, 'corpo grande não usa keepalive (limite do navegador)');
  await assert.rejects(() => api.getWorkspace('7'));
  assert.equal(seen[2].url, 'api.php?r=drive%2Fworkspace&known=7');
  await assert.rejects(() => createApi(async () => { throw new TypeError('x'); }).me(), TypeError);
});
