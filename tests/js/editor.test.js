import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../public/assets/js/state.js';
import * as T from '../../public/assets/js/text.js';
import { createStorage } from '../../public/assets/js/storage.js';

test('abas: nova, ativa e numeração', () => {
  let s = S.initialState();
  s = S.addTab(s);
  assert.equal(s.tabs.length, 2);
  assert.equal(S.activeTab(s).title, 'Sem título 2');
  assert.equal(s.active, s.tabs[1].id);
});

test('abas: fechar ativa seleciona vizinha; última aba vira nova vazia', () => {
  let s = S.addTab(S.addTab(S.initialState()));
  const [a, b, c] = s.tabs.map((t) => t.id);
  s = S.setActive(s, b);
  s = S.closeTab(s, b);
  assert.equal(s.active, c);
  s = S.closeTab(S.closeTab(s, a), c);
  assert.equal(s.tabs.length, 1);
  assert.equal(s.tabs[0].content, '');
});

test('abas: renomear (sanitiza), reordenar e dirty', () => {
  let s = S.addTab(S.initialState());
  const [a, b] = s.tabs.map((t) => t.id);
  assert.equal(S.renameTab(s, a, '   ').tabs[0].title, 'Sem título 1');
  s = S.renameTab(s, a, 'nota\n.md');
  assert.equal(s.tabs[0].title, 'nota.md');
  s = S.moveTab(s, b, 0);
  assert.deepEqual(s.tabs.map((t) => t.id), [b, a]);
  assert.equal(S.isDirty(s.tabs[0]), false);
  s = S.updateTab(s, b, { content: 'x' });
  assert.equal(S.isDirty(S.activeTab(S.setActive(s, b))), true);
});

test('serialize/deserialize: ida e volta e rejeita lixo', () => {
  let s = S.updateTab(S.initialState(), S.initialState().tabs[0].id, {});
  s = S.addTab(s, 'a.md', 'olá');
  const back = S.deserialize(JSON.parse(JSON.stringify(S.serialize(s))));
  assert.equal(back.tabs[1].content, 'olá');
  assert.equal(back.active, s.active);
  for (const bad of [null, 1, {}, { tabs: [] }, { tabs: [{ id: 1 }] }, { tabs: 'x' }]) assert.equal(S.deserialize(bad), null);
  const evil = S.deserialize({ tabs: [{ id: 'a', title: 't', content: 'c', driveId: '../x' }, { id: 'a', title: 'dup', content: '' }] });
  assert.equal(evil.tabs.length, 1);
  assert.equal(evil.tabs[0].driveId, null);
});

test('texto: posição do cursor', () => {
  assert.deepEqual(T.cursorPosition('ab\ncde', 0), { line: 1, col: 1 });
  assert.deepEqual(T.cursorPosition('ab\ncde', 5), { line: 2, col: 3 });
  assert.equal(T.lineCount('a\nb\n'), 3);
});

test('texto: ir para linha', () => {
  const t = 'a\nbb\nccc';
  assert.equal(T.lineStartIndex(t, 1), 0);
  assert.equal(T.lineStartIndex(t, 3), 5);
  assert.equal(T.lineStartIndex(t, 99), 5);
  assert.equal(T.lineStartIndex(t, 0), 0);
});

test('texto: localizar, contar e substituir tudo', () => {
  assert.equal(T.countMatches('Aa aA', 'aa'), 2);
  assert.equal(T.countMatches('Aa aA', 'aa', { matchCase: true }), 0);
  const r = T.replaceAll('um dois um', 'um', 'X');
  assert.deepEqual(r, { text: 'X dois X', count: 2 });
  assert.deepEqual(T.replaceAll('aaa', 'aa', 'b'), { text: 'ba', count: 1 });
  assert.deepEqual(T.replaceAll('x', '', 'y'), { text: 'x', count: 0 });
  assert.equal(T.findNext('abcabc', 'b', 2), 4);
  assert.equal(T.findNext('abcabc', 'b', 5), 1);
  assert.equal(T.findNext('abc', 'z', 0), -1);
  assert.equal(T.findNext('abcabc', 'b', 4, { backwards: true }), 1);
});

test('storage: funciona e degrada com falha', () => {
  const mem = new Map();
  const ok = createStorage({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) });
  assert.equal(ok.load(), null);
  assert.equal(ok.save({ a: 1 }), true);
  assert.deepEqual(ok.load(), { a: 1 });
  const bad = createStorage({ getItem() { throw new Error('x'); }, setItem() { throw new Error('QuotaExceeded'); } });
  assert.equal(bad.load(), null);
  assert.equal(bad.save({}), false);
  assert.equal(bad.available, false);
});
