// Mescla em três vias do workspace, aba por aba: base (último estado sincronizado), local e remoto.
// Regra de ouro: nunca descartar texto. Se os dois lados mudaram a mesma aba de forma diferente,
// o local fica na aba e o remoto vira uma aba "(conflito)" logo ao lado.
// Funções puras, sem DOM: o mesmo código roda no navegador e nos testes.

const FIELDS = ['title', 'content', 'savedContent', 'driveId', 'driveVersion'];

const tabsOf = (d) => (d && Array.isArray(d.tabs) ? d.tabs : []);

/** Impressão digital do que importa sincronizar: aba ativa e modo preview são preferência de cada aparelho. */
export function fingerprint(d) {
  return JSON.stringify(tabsOf(d).map((t) => [t.id, t.title, t.content, t.savedContent ?? t.content, t.driveId || null]));
}

/** Workspace sem nenhum texto (ex.: primeiro acesso num aparelho novo). */
export function isBlank(d) {
  return tabsOf(d).every((t) => !t.content);
}

// FNV-1a: id determinístico para a aba de conflito, para que mesclas repetidas não a dupliquem.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

const norm = (t, f) => (f === 'savedContent' ? t.savedContent ?? t.content : t[f] ?? null);
const sameTab = (a, b) => FIELDS.every((f) => norm(a, f) === norm(b, f));

function mergeTab(b, l, r) {
  const out = { ...l };
  let conflict = false;
  for (const f of FIELDS) {
    const lv = norm(l, f); const rv = norm(r, f);
    if (lv === rv) continue;
    if (b && lv === norm(b, f)) out[f] = rv; // só o remoto mudou este campo
    else if (b && rv === norm(b, f)) continue; // só o local mudou
    else if (f === 'content') conflict = true; // os dois mudaram: o local fica, o remoto vira cópia
  }
  return { tab: out, conflict };
}

function conflictCopy(r) {
  return {
    id: `${String(r.id).slice(0, 40)}~${hash(r.content)}`,
    title: `${r.title} (conflito)`.slice(0, 120),
    content: r.content, savedContent: r.content, driveId: null, driveVersion: null, preview: false,
  };
}

function sameOrder(a, b) {
  const sa = new Set(a); const sb = new Set(b);
  const x = a.filter((id) => sb.has(id)); const y = b.filter((id) => sa.has(id));
  return x.length === y.length && x.every((id, i) => id === y[i]);
}

/**
 * @returns {{ data: object, conflicts: number }} workspace mesclado e quantas abas viraram conflito.
 * `base` pode ser null (sem histórico): nada é apagado e diferenças viram conflito.
 */
export function mergeWorkspaces(base, local, remote) {
  const B = new Map(tabsOf(base).map((t) => [t.id, t]));
  const L = new Map(tabsOf(local).map((t) => [t.id, t]));
  const R = new Map(tabsOf(remote).map((t) => [t.id, t]));
  const kept = new Map();
  const copies = new Map(); // id da aba de origem → cópia de conflito
  let conflicts = 0;

  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const b = B.get(id); const l = L.get(id); const r = R.get(id);
    if (l && r) {
      const m = mergeTab(b, l, r);
      kept.set(id, m.tab);
      if (m.conflict) {
        const c = conflictCopy(r);
        if (!L.has(c.id) && !R.has(c.id)) { copies.set(id, c); conflicts++; }
      }
    } else if (l) {
      if (!b || !sameTab(l, b)) kept.set(id, l); // novo aqui, ou editado aqui e apagado lá: mantém
    } else if (!b || !sameTab(r, b)) {
      kept.set(id, { ...r, preview: r.preview === true }); // novo lá, ou editado lá e apagado aqui: mantém
    }
  }

  // Ordem: se a local não foi reordenada desde a base, segue a remota; senão, a local.
  const lo = tabsOf(local).map((t) => t.id); const ro = tabsOf(remote).map((t) => t.id);
  const [primary, secondary] = sameOrder(lo, tabsOf(base).map((t) => t.id)) ? [ro, lo] : [lo, ro];
  const order = primary.filter((id) => kept.has(id));
  secondary.forEach((id, i) => {
    if (!kept.has(id) || order.includes(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const k = order.indexOf(secondary[j]); if (k >= 0) { at = k + 1; break; } }
    order.splice(at, 0, id);
  });
  const tabs = [];
  for (const id of order) { tabs.push(kept.get(id)); if (copies.has(id)) tabs.push(copies.get(id)); }

  const has = (id) => tabs.some((t) => t.id === id);
  const active = has(local && local.active) ? local.active : has(remote && remote.active) ? remote.active : tabs[0] && tabs[0].id;
  const seq = Math.max(Number(local && local.seq) || 0, Number(remote && remote.seq) || 0) || tabs.length;
  return { data: { v: 1, active, seq, tabs }, conflicts };
}
