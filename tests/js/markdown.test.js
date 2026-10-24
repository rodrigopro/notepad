import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, sanitizeUrl } from '../../public/assets/js/markdown.js';

// Renderizador mínimo de HTML a partir do AST de DOM falso, para checar a saída final.
class El {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.kids = []; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...n) { this.kids.push(...n); }
  set textContent(v) { this.kids = [String(v)]; }
  replaceChildren(f) { this.kids = f.kids; }
  get ownerDocument() { return doc; }
}
const doc = {
  createElement: (t) => new El(t),
  createTextNode: (v) => String(v),
  createDocumentFragment: () => new El('#frag'),
};
import { renderInto } from '../../public/assets/js/markdown.js';
const render = (src) => { const c = new El('div'); renderInto(c, src); return c; };
const html = (n) => (typeof n === 'string' ? n.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  : `<${n.tag}${Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}>${n.kids.map(html).join('')}</${n.tag}>`);
const tags = (n, acc = []) => { if (typeof n !== 'string') { acc.push(n.tag); n.kids.forEach((k) => tags(k, acc)); } return acc; };

test('títulos, parágrafos, hr, código', () => {
  const ast = parseMarkdown('# Oi\n\ntexto **forte** e *em* `x`\n\n---\n\n```js\nlet a = 1;\n```');
  assert.deepEqual(ast.map((b) => b.t), ['h', 'p', 'hr', 'codeblock']);
  assert.equal(ast[0].level, 1);
  assert.equal(ast[3].lang, 'js');
  assert.equal(ast[3].v, 'let a = 1;');
  assert.deepEqual(ast[1].c.map((n) => n.t), ['text', 'strong', 'text', 'em', 'text', 'code']);
});

test('listas: ordenada, tarefas e aninhadas', () => {
  const [ul] = parseMarkdown('- a\n- [x] feito\n- [ ] aberto\n  - filho\n');
  assert.equal(ul.t, 'list');
  assert.deepEqual(ul.items.map((i) => i.task), [null, true, false]);
  assert.equal(ul.items[2].c[1].t, 'list');
  const [ol] = parseMarkdown('3. a\n4. b');
  assert.equal(ol.ordered, true); assert.equal(ol.start, 3); assert.equal(ol.items.length, 2);
});

test('tabela vira <table> com alinhamento', () => {
  const root = render('| A | B |\n|:--|--:|\n| 1 | 2 |\n| 3 | 4 |');
  const t = root.kids[0];
  assert.equal(t.tag, 'table');
  assert.deepEqual(tags(t).filter((x) => x === 'tr').length, 3);
  assert.equal(t.kids[0].kids[0].kids[1].attrs.class, 'a-right');
});

test('citação, link e imagem', () => {
  const root = render('> citado\n\n[site](https://a.com "t") ![img](https://a.com/x.png)');
  assert.equal(root.kids[0].tag, 'blockquote');
  const p = root.kids[1];
  assert.equal(p.kids[0].attrs.href, 'https://a.com');
  assert.equal(p.kids[0].attrs.rel, 'noopener noreferrer');
  assert.equal(p.kids[2].tag, 'img');
});

test('XSS: HTML bruto vira texto', () => {
  const root = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<b>oi</b>');
  const all = tags(root);
  for (const bad of ['script', 'b']) assert.ok(!all.includes(bad), bad);
  assert.ok(!all.includes('img'));
  assert.match(html(root), /&lt;script>alert\(1\)&lt;\/script>/);
});

test('XSS: esquemas perigosos em links e imagens', () => {
  const payloads = [
    '[x](javascript:alert(1))', '[x](JaVaScRiPt:alert(1))', '[x](java\tscript:alert(1))', '[x]( javascript:alert(1))',
    '[x](&#106;avascript:alert(1))', '[x](data:text/html,<script>alert(1)</script>)', '[x](vbscript:msgbox(1))',
    '[x](//evil.com)', '[x](/caminho)', '![x](javascript:alert(1))', '![x](data:image/svg+xml;base64,PHN2Zz4=)',
    '![x](data:text/html;base64,AAAA)', '[x](file:///etc/passwd)', '<javascript:alert(1)>', '![x](mailto:a@b.c)',
  ];
  for (const p of payloads) {
    const root = render(p);
    const attrs = JSON.stringify(root, (k, v) => (k === 'attrs' ? v : v));
    assert.ok(!/"href":"(?!https?:|mailto:|#)/i.test(attrs), p);
    assert.ok(!/"src":"(?!https?:|data:image\/(png|jpe?g|gif|webp))/i.test(attrs), p);
    assert.ok(!tags(root).includes('script'), p);
    assert.ok(!/"on\w+"/.test(attrs), p);
  }
});

test('sanitizeUrl: permitidos e bloqueados', () => {
  assert.equal(sanitizeUrl('https://a.com/x?y=1'), 'https://a.com/x?y=1');
  assert.equal(sanitizeUrl('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(sanitizeUrl('#secao'), '#secao');
  assert.equal(sanitizeUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeUrl('data:image/png;base64,AAAA', { image: true }), 'data:image/png;base64,AAAA');
  assert.equal(sanitizeUrl('data:image/svg+xml;base64,AAAA', { image: true }), null);
  assert.equal(sanitizeUrl('#x', { image: true }), null);
});

test('título com aspas não quebra atributos (usa setAttribute, nunca HTML)', () => {
  const root = render('[x](https://a.com "a\\"onmouseover=alert(1) b")');
  assert.ok(!/onmouseover/.test(JSON.stringify(root.kids[0].attrs || {})));
  assert.ok(!JSON.stringify(root, (k, v) => v).includes('"onmouseover"'));
});

test('texto escapado e entrada vazia/grande', () => {
  assert.deepEqual(parseInline('\\*não\\*')[0], { t: 't'.replace('t', 'text'), v: '*não*' });
  assert.deepEqual(parseMarkdown(''), []);
  const t0 = Date.now();
  parseMarkdown(('# t\n\n- a **b** [c](https://d.com)\n\n' + '*'.repeat(50)).repeat(1500));
  assert.ok(Date.now() - t0 < 3000, 'desempenho');
});
