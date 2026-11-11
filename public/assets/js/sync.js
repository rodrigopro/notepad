// Sincronização do workspace com o Drive: debounce, consulta periódica, fila offline e mescla automática.
// Toda divergência é resolvida por mescla em três vias contra o último estado sincronizado (base),
// então nada é sobrescrito às cegas. Dependências externas (API, timers, UI) são injetadas para teste.
import { ApiError } from './api.js';
import { mergeWorkspaces, fingerprint as defaultFp, isBlank } from './merge.js';

export function createSync({
  api, getWorkspace, applyRemote, onStatus, onReauth, onBase,
  merge = mergeWorkspaces, fingerprint = defaultFp,
  delay = 1500, retryDelay = 15000, setTimer = setTimeout, clearTimer = clearTimeout, isOnline = () => true,
}) {
  let enabled = false;
  let baseVersion = null;
  let baseData = null; // conteúdo do Drive na versão baseVersion
  let timer = null;
  let running = false;
  let wantPull = false;
  let generation = 0; // incrementa a cada edição; detecta mudança durante o envio
  let syncedGeneration = 0;

  const status = (s) => onStatus && onStatus(s);
  const pending = () => syncedGeneration !== generation;

  function setBase(v, data) {
    baseVersion = v;
    baseData = data;
    if (onBase) onBase(v, data);
  }

  function arm(ms) {
    if (timer) clearTimer(timer);
    timer = setTimer(() => { timer = null; return run(); }, ms);
  }

  /** Se o local difere da base e nada está marcado como pendente, marca para envio. */
  function markIfDiverged() {
    if (!pending() && (baseData === null || fingerprint(getWorkspace()) !== fingerprint(baseData))) generation++;
  }

  /** O Drive está em `version` com `remote`: mescla com o local e decide se ainda há o que enviar. */
  function reconcile(version, remote) {
    const local = getWorkspace();
    // Sem base, um local vazio (aparelho novo) se comporta como "intacto": o remoto prevalece por inteiro.
    const base = baseData ?? (isBlank(local) ? local : null);
    const { data, conflicts } = merge(base, local, remote);
    setBase(version, remote);
    if (fingerprint(data) !== fingerprint(local) || conflicts) applyRemote(data, conflicts);
    if (fingerprint(data) === fingerprint(remote)) syncedGeneration = generation;
    else generation++; // o resultado tem algo que o Drive ainda não tem
  }

  async function pull() {
    const r = await api.getWorkspace(baseData !== null ? baseVersion : null);
    if (!r.exists) { setBase(null, null); markIfDiverged(); return; }
    if (r.unchanged) { markIfDiverged(); return; }
    reconcile(r.version, r.data);
  }

  async function push() {
    const target = generation;
    const sent = getWorkspace();
    try {
      const res = await api.saveWorkspace(sent, baseVersion);
      setBase(res.version, sent);
      syncedGeneration = target; // se houve edição durante o envio, o laço envia de novo
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) throw e;
      const d = e.data || {};
      if (d.data && typeof d.data === 'object' && typeof d.version === 'string') reconcile(d.version, d.data);
      else wantPull = true;
    }
  }

  async function run() {
    if (!enabled || running) return;
    if (!isOnline()) { if (pending() || wantPull) status('offline'); return; }
    if (timer) { clearTimer(timer); timer = null; }
    running = true;
    let pulling = false;
    try {
      for (let rounds = 0; wantPull || pending(); rounds++) {
        if (rounds >= 8) { arm(retryDelay); status('pending'); return; } // Drive mudando sem parar: tenta depois
        status('syncing');
        if (wantPull) { wantPull = false; pulling = true; await pull(); pulling = false; } else await push();
      }
      status('synced');
    } catch (e) {
      if (pulling) wantPull = true;
      if (e instanceof ApiError && e.status === 401) {
        enabled = false;
        status('reauth');
        if (onReauth) onReauth();
      } else if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
        status('error'); // 400/413...: reenviar o mesmo conteúdo não adianta
      } else {
        status('offline'); // rede ou erro 5xx: mantém o pendente e tenta de novo
        arm(retryDelay);
      }
    } finally {
      running = false;
    }
  }

  return {
    get pending() { return pending(); },
    get enabled() { return enabled; },
    /** Edição local: envia após uma pausa na digitação. */
    changed() {
      generation++;
      if (!enabled) return;
      status('pending');
      arm(delay);
    },
    /** Envia já o que estiver pendente (ex.: a página vai ficar oculta). */
    flush() { return run(); },
    /** Busca mudanças feitas em outros aparelhos (e envia as pendentes). */
    pull() { if (!enabled) return Promise.resolve(); wantPull = true; return run(); },
    /** Após o login. `base`: {version, data} do último sync deste usuário neste navegador, ou null. */
    start(base = null) {
      enabled = true;
      setBase(base ? base.version : null, base ? base.data : null);
      wantPull = true;
      return run();
    },
    /** Outra aba deste navegador gravou estado mais novo e esta o adotou: herda a base dela. */
    adopt(base) {
      setBase(base ? base.version : null, base ? base.data : null);
      syncedGeneration = generation; // quem gravou é que envia; ao voltar a ficar visível, esta confere
    },
    stop() { enabled = false; if (timer) clearTimer(timer); timer = null; status('local'); },
    online() { if (enabled) { wantPull = true; run(); } },
  };
}
