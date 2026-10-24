// Markdown → AST (puro) e AST → DOM. O HTML bruto nunca é interpretado: vira texto.

const SAFE_LINK = new Set(['http', 'https', 'mailto']);
const SAFE_IMG_DATA = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i;

/** Retorna a URL limpa ou null se o esquema não for permitido. */
export function sanitizeUrl(raw, { image = false } = {}) {
  // Remove controle/espaços para impedir "java\tscript:" e similares.
  const url = String(raw).replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '');
  if (!url || url.length > 4096) return null;
  if (image && SAFE_IMG_DATA.test(url)) return url;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (m) {
    const scheme = m[1].toLowerCase();
    return SAFE_LINK.has(scheme) && !(image && scheme === 'mailto') ? url : null;
  }
  if (!image && url[0] === '#') return url;
  return null;
}

const text = (v) => ({ t: 'text', v });

// ---------- Inline ----------
export function parseInline(src) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push(text(buf)); buf = ''; } };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!~|<>]/.test(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
    if (c === '`') {
      const m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(src.slice(i));
      if (m) { flush(); out.push({ t: 'code', v: m[2].replace(/^ (.*) $/, '$1') }); i += m[0].length; continue; }
    }
    if (c === '!' && src[i + 1] === '[') {
      const l = matchLink(src, i + 1);
      if (l) {
        flush();
        const href = sanitizeUrl(l.url, { image: true });
        out.push(href ? { t: 'img', src: href, alt: l.label, title: l.title } : text(src.slice(i, i + 1 + l.len)));
        i += 1 + l.len; continue;
      }
    }
    if (c === '[') {
      const l = matchLink(src, i);
      if (l) {
        flush();
        const href = sanitizeUrl(l.url);
        out.push(href ? { t: 'link', href, title: l.title, c: parseInline(l.label) } : { t: 'span', c: parseInline(l.label) });
        i += l.len; continue;
      }
    }
    if (c === '<') {
      const m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(src.slice(i));
      if (m) {
        flush();
        const href = sanitizeUrl(m[1]);
        out.push(href ? { t: 'link', href, title: null, c: [text(m[1])] } : text(m[0]));
        i += m[0].length; continue;
      }
    }
    if (c === '*' || c === '_' || c === '~') {
      const delim = src.startsWith(c + c, i) ? c + c : c;
      if (!(c === '~' && delim.length === 1)) {
        const end = findClose(src, i + delim.length, delim);
        const word = c === '_' && /\w/.test(src[i - 1] || '');
        if (end > i + delim.length && !word) {
          flush();
          const inner = parseInline(src.slice(i + delim.length, end));
          out.push({ t: c === '~' ? 'del' : delim.length === 2 ? 'strong' : 'em', c: inner });
          i = end + delim.length; continue;
        }
      }
    }
    if (c === ' ' && src.startsWith('  \n', i)) { flush(); out.push({ t: 'br' }); i += 3; continue; }
    buf += c; i++;
  }
  flush();
  return out;
}

function findClose(src, from, delim) {
  for (let j = from; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === '`') { const e = src.indexOf('`', j + 1); if (e > 0) j = e; continue; }
    if (src.startsWith(delim, j) && j > from && !/\s/.test(src[j - 1])) {
      if (delim.length === 1 && src[j + 1] === delim) { j++; continue; }
      return j;
    }
  }
  return -1;
}

/** Reconhece [rótulo](url "título") a partir de src[start]==='['. */
function matchLink(src, start) {
  let depth = 0;
  let j = start;
  for (; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === '[') depth++;
    else if (src[j] === ']' && --depth === 0) break;
  }
  if (j >= src.length || src[j + 1] !== '(') return null;
  const m = /^\(\s*(<[^>]*>|[^\s)]*(?:\([^\s)]*\)[^\s)]*)*)(?:\s+"([^"]*)")?\s*\)/.exec(src.slice(j + 1));
  if (!m) return null;
  return { label: src.slice(start + 1, j), url: m[1].replace(/^<|>$/g, ''), title: m[2] ?? null, len: j + 1 + m[0].length - start };
}

// ---------- Blocos ----------
const RE_FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const RE_HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const RE_ATX = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RE_ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const RE_QUOTE = /^ {0,3}>\s?(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const splitRow = (line) => {
  const cells = [];
  let cur = '';
  const s = line.trim().replace(/^\|/, '');
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; }
    else if (s[i] === '|') { cells.push(cur.trim()); cur = ''; }
    else cur += s[i];
  }
  if (cur.trim() !== '' || !s.endsWith('|')) cells.push(cur.trim());
  return cells;
};

const startsBlock = (l) => RE_FENCE.test(l) || RE_HR.test(l) || RE_ATX.test(l) || RE_QUOTE.test(l) || (RE_ITEM.test(l) && RE_ITEM.exec(l)[4] !== '');

export function parseBlocks(src) {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    let m = RE_FENCE.exec(line);
    if (m) {
      const fence = m[1];
      const body = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++;
      out.push({ t: 'codeblock', lang: m[2].replace(/[^\w+#.-]/g, '').slice(0, 30), v: body.join('\n') });
      continue;
    }
    if ((m = RE_ATX.exec(line))) { out.push({ t: 'h', level: m[1].length, c: parseInline(m[2]) }); i++; continue; }
    if (RE_HR.test(line)) { out.push({ t: 'hr' }); i++; continue; }
    if (RE_QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) inner.push(RE_QUOTE.exec(lines[i++])[1]);
      out.push({ t: 'quote', c: parseBlocks(inner.join('\n')) });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
      if (head.length === align.length) {
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
          const cells = splitRow(lines[i++]);
          rows.push(align.map((_, k) => parseInline(cells[k] || '')));
        }
        out.push({ t: 'table', align, head: head.map(parseInline), rows });
        continue;
      }
    }
    if ((m = RE_ITEM.exec(line)) && m[2]) {
      const res = parseList(lines, i);
      out.push(res.node); i = res.next; continue;
    }
    if (/^ {4,}\S/.test(line)) {
      const body = [];
      while (i < lines.length && (/^ {4}/.test(lines[i]) || lines[i].trim() === '')) body.push(lines[i++].slice(4));
      while (body.length && body[body.length - 1].trim() === '') body.pop();
      out.push({ t: 'codeblock', lang: '', v: body.join('\n') });
      continue;
    }
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines[i])) para.push(lines[i++].replace(/^\s+/, ''));
    out.push({ t: 'p', c: parseInline(para.join('\n')) });
  }
  return out;
}

function parseList(lines, start) {
  const first = RE_ITEM.exec(lines[start]);
  const ordered = /\d/.test(first[2]);
  const baseIndent = first[1].length;
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = RE_ITEM.exec(lines[i]);
    if (!m || m[1].length > baseIndent + 3 || /\d/.test(m[2]) !== ordered || m[1].length < baseIndent) break;
    const contentIndent = m[1].length + m[2].length + Math.max(1, Math.min(m[3].length, 4));
    const body = [m[4]];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === '') {
        let k = i; while (k < lines.length && lines[k].trim() === '') k++;
        if (k < lines.length && lines[k].search(/\S/) >= contentIndent) { body.push(''); i++; continue; }
        break;
      }
      if (l.search(/\S/) >= contentIndent) { body.push(l.slice(contentIndent)); i++; continue; }
      if (!startsBlock(l) && lines[i - 1].trim() !== '') { body.push(l.trim()); i++; continue; }
      break;
    }
    let task = null;
    const t = /^\[([ xX])\]\s+/.exec(body[0]);
    if (t) { task = t[1] !== ' '; body[0] = body[0].slice(t[0].length); }
    items.push({ task, c: parseBlocks(body.join('\n')) });
    while (i < lines.length && lines[i].trim() === '' && i + 1 < lines.length && RE_ITEM.test(lines[i + 1])) i++;
  }
  return { node: { t: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, items }, next: i };
}

export function parseMarkdown(src) {
  return parseBlocks(String(src));
}

// ---------- DOM ----------
const INLINE_TAG = { em: 'em', strong: 'strong', del: 'del', span: 'span' };

function renderInline(doc, nodes, parent) {
  for (const n of nodes) {
    switch (n.t) {
      case 'text': parent.append(doc.createTextNode(n.v)); break;
      case 'br': parent.append(doc.createElement('br')); break;
      case 'code': { const e = doc.createElement('code'); e.textContent = n.v; parent.append(e); break; }
      case 'link': {
        const a = doc.createElement('a');
        a.setAttribute('href', n.href);
        a.setAttribute('rel', 'noopener noreferrer');
        a.setAttribute('target', '_blank');
        if (n.title) a.setAttribute('title', n.title);
        renderInline(doc, n.c, a); parent.append(a); break;
      }
      case 'img': {
        const im = doc.createElement('img');
        im.setAttribute('src', n.src); im.setAttribute('alt', n.alt);
        im.setAttribute('referrerpolicy', 'no-referrer'); im.setAttribute('loading', 'lazy');
        if (n.title) im.setAttribute('title', n.title);
        parent.append(im); break;
      }
      default: { const e = doc.createElement(INLINE_TAG[n.t] || 'span'); renderInline(doc, n.c, e); parent.append(e); }
    }
  }
}

function renderBlocks(doc, blocks, parent, tight = false) {
  for (const b of blocks) {
    let el;
    switch (b.t) {
      case 'h': el = doc.createElement('h' + b.level); renderInline(doc, b.c, el); break;
      case 'p':
        if (tight) { renderInline(doc, b.c, parent); continue; }
        el = doc.createElement('p'); renderInline(doc, b.c, el); break;
      case 'hr': el = doc.createElement('hr'); break;
      case 'quote': el = doc.createElement('blockquote'); renderBlocks(doc, b.c, el); break;
      case 'codeblock': {
        el = doc.createElement('pre');
        const code = doc.createElement('code');
        if (b.lang) code.setAttribute('class', 'lang-' + b.lang);
        code.textContent = b.v; el.append(code); break;
      }
      case 'list': {
        el = doc.createElement(b.ordered ? 'ol' : 'ul');
        if (b.ordered && b.start !== 1) el.setAttribute('start', String(b.start));
        for (const it of b.items) {
          const li = doc.createElement('li');
          if (it.task !== null) {
            const cb = doc.createElement('input');
            cb.setAttribute('type', 'checkbox'); cb.setAttribute('disabled', ''); if (it.task) cb.setAttribute('checked', '');
            li.append(cb, doc.createTextNode(' '));
            li.setAttribute('class', 'task');
          }
          renderBlocks(doc, it.c, li, it.c.length > 0 && it.c[0].t === 'p' && it.c.filter((x) => x.t === 'p').length === 1);
          el.append(li);
        }
        break;
      }
      case 'table': {
        el = doc.createElement('table');
        const mk = (tag, cells) => {
          const tr = doc.createElement('tr');
          cells.forEach((c, k) => {
            const cell = doc.createElement(tag);
            if (b.align[k]) cell.setAttribute('class', 'a-' + b.align[k]);
            renderInline(doc, c, cell); tr.append(cell);
          });
          return tr;
        };
        const th = doc.createElement('thead'); th.append(mk('th', b.head));
        const tb = doc.createElement('tbody'); b.rows.forEach((r) => tb.append(mk('td', r)));
        el.append(th, tb); break;
      }
      default: continue;
    }
    parent.append(el);
  }
}

/** Renderiza Markdown dentro de `container`, substituindo seu conteúdo. */
export function renderInto(container, src) {
  const doc = container.ownerDocument;
  const frag = doc.createDocumentFragment();
  renderBlocks(doc, parseMarkdown(src), frag);
  container.replaceChildren(frag);
}
