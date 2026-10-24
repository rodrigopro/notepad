import test from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from '../../public/assets/js/sync.js';
import { ApiError, createApi } from '../../public/assets/js/api.js';

function harness(apiOverrides = {}, opts = {}) {
  const calls = [];
  const statuses = [];
  const timers = [];
  const applied = [];
  let ws = { tabs: [{ id: 'a' }] };
  const api = {
    getWorkspace: async () => ({ exists: false }),
    saveWorkspace: async (data, base, force) => { calls.push({ data, base, force }); return { version: String(calls.length) }; },
    ...apiOverrides,
  };
  const sync = createSync({
    api, getWorkspace: () => ws, applyRemote: (d, m) => applied.push([d, m]), onStatus: (s) => statuses.push(s),
    onConflict: opts.onConflict || (async () => 'local'), onReauth: opts.onReauth,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
    isOnline: opts.isOnline || (() => true),
  });
  return { sync, calls, statuses, timers, applied, setWs: (w) => { ws = w; } };
}

test('debounce: várias edições geram um envio e terminam em synced', async () => {
  const h = harness();
  await h.sync.start(false);
  h.calls.length = 0;
  h.sync.changed(); h.sync.changed(); h.sync.changed();
  assert.equal(h.statuses.at(-1), 'pending');
  await h.timers.at(-1).fn();
  assert.equal(h.calls.length, 1);
  assert.equal(h.statuses.at(-1), 'synced');
  assert.equal(h.sync.pending, false);
});

test('usa a versão devolvida como base do próximo envio', async () => {
  const h = harness();
  await h.sync.start(false);
  h.sync.changed(); await h.timers.at(-1).fn();
  h.sync.changed(); await h.timers.at(-1).fn();
  assert.equal(h.calls.at(-1).base, h.calls.at(-2).base === null ? '1' : String(h.calls.length - 1));
});

test('edição durante o envio é reenviada', async () => {
  let release;
  let gate = false;
  const h = harness({ saveWorkspace: async function () { h.calls.push(1); if (gate && h.calls.length === 1) await new Promise((r) => { release = r; }); return { version: 'v' + h.calls.length }; } });
  await h.sync.start(false); h.calls.length = 0; gate = true;
  h.sync.changed();
  const p = h.timers.at(-1).fn();
  h.sync.changed();
  release(); await p;
  assert.equal(h.calls.length, 2);
  assert.equal(h.sync.pending, false);
});

test('offline: mantém pendente e reenvia quando volta', async () => {
  let online = false;
  const h = harness({}, { isOnline: () => online });
  await h.sync.start(false);
  h.sync.changed(); await h.timers.at(-1).fn();
  assert.equal(h.statuses.at(-1), 'offline');
  assert.equal(h.sync.pending, true);
  online = true; h.calls.length = 0;
  await h.sync.online();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.calls.length, 1);
  assert.equal(h.statuses.at(-1), 'synced');
});

test('falha de rede agenda nova tentativa sem perder pendência', async () => {
  let fail = false;
  const h = harness({ saveWorkspace: async () => { if (fail) throw new TypeError('Failed to fetch'); return { version: '1' }; } });
  await h.sync.start(false); fail = true;
  h.sync.changed(); await h.timers.at(-1).fn();
  assert.equal(h.statuses.at(-1), 'offline');
  assert.equal(h.timers.at(-1).ms, 15000);
  assert.equal(h.sync.pending, true);
});

test('401: pede novo login e mantém o conteúdo pendente', async () => {
  let reauth = 0; let fail = false;
  const h = harness({ saveWorkspace: async () => { if (fail) throw new ApiError(401, 'reauth', {}); return { version: '1' }; } }, { onReauth: () => reauth++ });
  await h.sync.start(false); fail = true;
  h.sync.changed(); await h.timers.at(-1).fn();
  assert.equal(h.statuses.at(-1), 'reauth'); assert.equal(reauth, 1);
  assert.equal(h.sync.pending, true);
});

function conflictApi(h) {
  let conflict = false;
  return {
    arm: () => { conflict = true; },
    api: { saveWorkspace: async (d, b, f) => {
      h.calls.push({ b, f });
      if (conflict && !f) { conflict = false; throw new ApiError(409, 'conflict', { version: '9', data: { tabs: [{ id: 'r' }] } }); }
      return { version: '10' };
    } },
  };
}

for (const [choice, mode, forced] of [['local', null, true], ['remote', 'replace', false], ['copy', 'merge', true]]) {
  test(`conflito: ${choice}`, async () => {
    const box = {};
    const h = harness({ saveWorkspace: (...a) => box.c.api.saveWorkspace(...a) }, { onConflict: async () => choice });
    box.c = conflictApi(h);
    await h.sync.start(false); h.calls.length = 0;
    box.c.arm();
    h.sync.changed(); await h.timers.at(-1).fn();
    assert.equal(h.applied.at(-1)?.[1] ?? null, mode);
    assert.equal(h.calls.some((c) => c.f === true && c.b === '9'), forced);
    assert.equal(h.sync.pending, false);
    assert.equal(h.statuses.at(-1), 'synced');
  });
}

test('start: remoto existe e local tem conteúdo → pergunta; sem conteúdo → aplica', async () => {
  const remote = { exists: true, version: '5', data: { tabs: [{ id: 'r' }] } };
  let asked = 0;
  const a = harness({ getWorkspace: async () => remote }, { onConflict: async () => { asked++; return 'remote'; } });
  await a.sync.start(true);
  assert.equal(asked, 1);
  const b = harness({ getWorkspace: async () => remote }, { onConflict: async () => { asked++; return 'local'; } });
  await b.sync.start(false);
  assert.equal(asked, 1);
  assert.equal(b.applied[0][1], 'replace');
});

test('start: sem workspace remoto envia o local', async () => {
  const h = harness();
  await h.sync.start(true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].base, null);
});

test('api: monta requisições com header CSRF, JSON e converte erros', async () => {
  const seen = [];
  const f = async (url, init) => { seen.push({ url, init }); return { ok: false, status: 409, json: async () => ({ error: 'conflict', version: '1' }) }; };
  const api = createApi(f, 'api.php');
  await assert.rejects(() => api.saveWorkspace({ tabs: [] }, '1'), (e) => e instanceof ApiError && e.status === 409 && e.data.version === '1');
  assert.equal(seen[0].url, 'api.php?r=drive%2Fworkspace%2Fsave');
  assert.equal(seen[0].init.headers['X-Notepad'], '1');
  assert.equal(seen[0].init.headers['Content-Type'], 'application/json');
  assert.equal(seen[0].init.credentials, 'same-origin');
  await assert.rejects(() => createApi(async () => { throw new TypeError('x'); }).me(), TypeError);
});

test('start: versão conhecida igual à remota não gera conflito', async () => {
  let asked = 0;
  const h = harness({ getWorkspace: async () => ({ exists: true, version: '5', data: { tabs: [] } }) }, { onConflict: async () => { asked++; return 'remote'; } });
  await h.sync.start(true, '5');
  assert.equal(asked, 0);
  assert.deepEqual({ b: h.calls[0].base }, { b: '5' });
});

test('erro 4xx (ex.: 413) não entra em loop de retentativas', async () => {
  let fail = false;
  const h = harness({ saveWorkspace: async () => { if (fail) throw new ApiError(413, 'payload_too_large', {}); return { version: '1' }; } });
  await h.sync.start(false); fail = true;
  const before = h.timers.length;
  h.sync.changed(); const t = h.timers.length; await h.timers.at(-1).fn();
  assert.equal(h.statuses.at(-1), 'error');
  assert.equal(h.timers.length, t, 'sem novo timer');
  assert.ok(t > before);
});

test('429 é tratado como temporário e reagenda', async () => {
  let fail = false;
  const h = harness({ saveWorkspace: async () => { if (fail) throw new ApiError(429, 'rate_limited', {}); return { version: '1' }; } });
  await h.sync.start(false); fail = true;
  h.sync.changed(); const t = h.timers.length; await h.timers.at(-1).fn();
  assert.equal(h.statuses.at(-1), 'offline');
  assert.ok(h.timers.length > t, 'nova tentativa agendada');
});

test('start: conteúdo igual ao remoto não gera conflito, mesmo com versão diferente', async () => {
  let asked = 0;
  const h = harness({ getWorkspace: async () => ({ exists: true, version: '9', data: { tabs: [{ id: 'a' }] } }) }, { onConflict: async () => { asked++; return 'local'; } });
  await h.sync.start(true, '5');
  assert.equal(asked, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(h.statuses.at(-1), 'synced');
});

test('start: local intacto desde o último sync e remoto mudou → aplica remoto sem perguntar', async () => {
  let asked = 0;
  const fp = (d) => JSON.stringify(d);
  const h = harness({ getWorkspace: async () => ({ exists: true, version: '9', data: { tabs: [{ id: 'novo' }] } }) }, { onConflict: async () => { asked++; return 'local'; } });
  await h.sync.start(true, '5', fp({ tabs: [{ id: 'a' }] }));
  assert.equal(asked, 0);
  assert.deepEqual(h.applied, [[{ tabs: [{ id: 'novo' }] }, 'replace']]);
});

test('start: só o local mudou desde o último sync → envia sem perguntar', async () => {
  let asked = 0;
  const fp = (d) => JSON.stringify(d);
  const h = harness({ getWorkspace: async () => ({ exists: true, version: '9', data: { tabs: [{ id: 'velho' }] } }) }, { onConflict: async () => { asked++; return 'local'; } });
  await h.sync.start(true, '5', fp({ tabs: [{ id: 'velho' }] }));
  assert.equal(asked, 0);
  assert.equal(h.calls.length, 1);
});

test('start: os dois mudaram desde o último sync → conflito', async () => {
  let asked = 0;
  const h = harness({ getWorkspace: async () => ({ exists: true, version: '9', data: { tabs: [{ id: 'r' }] } }) }, { onConflict: async () => { asked++; return 'local'; } });
  await h.sync.start(true, '5', JSON.stringify({ tabs: [{ id: 'base' }] }));
  assert.equal(asked, 1);
});
