// Utilidades de texto puras para o editor.
export function lineCount(text) {
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export function cursorPosition(text, index) {
  const before = text.slice(0, Math.max(0, Math.min(index, text.length)));
  const nl = before.lastIndexOf('\n');
  return { line: lineCount(before), col: before.length - nl };
}

/** Índice do início da linha (1-based); limita ao intervalo válido. */
export function lineStartIndex(text, line) {
  const target = Math.max(1, Math.min(Math.floor(line) || 1, lineCount(text)));
  let idx = 0;
  for (let l = 1; l < target; l++) idx = text.indexOf('\n', idx) + 1;
  return idx;
}

function norm(s, matchCase) {
  return matchCase ? s : s.toLowerCase();
}

export function countMatches(text, term, { matchCase = false } = {}) {
  if (!term) return 0;
  const t = norm(text, matchCase);
  const q = norm(term, matchCase);
  let n = 0;
  for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + q.length)) n++;
  return n;
}

/** Próxima ocorrência a partir de `from` (com volta ao início). -1 se não houver. */
export function findNext(text, term, from, { matchCase = false, backwards = false } = {}) {
  if (!term) return -1;
  const t = norm(text, matchCase);
  const q = norm(term, matchCase);
  if (backwards) {
    const i = t.lastIndexOf(q, Math.max(0, from - 1));
    return i !== -1 && i < from ? i : t.lastIndexOf(q);
  }
  const i = t.indexOf(q, from);
  return i !== -1 ? i : t.indexOf(q);
}

export function replaceAll(text, term, replacement, { matchCase = false } = {}) {
  if (!term) return { text, count: 0 };
  const t = norm(text, matchCase);
  const q = norm(term, matchCase);
  let out = '';
  let last = 0;
  let count = 0;
  for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, last)) {
    out += text.slice(last, i) + replacement;
    last = i + q.length;
    count++;
  }
  return { text: out + text.slice(last), count };
}
