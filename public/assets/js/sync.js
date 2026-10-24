// Sincronização do workspace com o Drive: debounce, fila offline e conflitos.
// Toda dependência externa (API, timers, UI) é injetada para permitir teste.
import { ApiError } from './api.js';

export function createSync({
  api, getWorkspace, applyRemote, onStatus, onConflict, onReauth,
  onVersion, delay = 2000, retryDelay = 15000, setTimer = setTimeout, clearTimer = clearTimeout, isOnline = () => true,
}) {
  let enabled = false;
  let baseVersion = null;
  let timer = null;
  let running = false;
  let generation = 0; // incrementa a cada edição; detecta mudança durante o envio
  let syncedGeneration = 0;

  const status = (s) => onStatus && onStatus(s);

  function setBase(v) {
    baseVersion = v;
    if (onVersion) onVersion(v);
  }

  function arm(ms) {
    if (timer) clearTimer(timer);
    timer = setTimer(() => { timer = null; return flush(); }, ms);
  }

  function changed() {
    generation++;
    if (!enabled) return;
    status('pending');
    arm(delay);
  }

  async function resolveConflict(remote) {
    status('conflict');
    const choice = await onConflict(remote);
    if (choice === 'remote') {
      applyRemote(remote.data, 'replace');
      setBase(remote.version);
      syncedGeneration = generation;
      return true;
    }
    if (choice === 'copy') applyRemote(remote.data, 'merge');
    if (choice !== 'local' && choice !== 'copy') return false;
    const res = await api.saveWorkspace(getWorkspace(), remote.version, true);
    setBase(res.version);
    syncedGeneration = generation;
    return true;
  }

  async function flush() {
    if (!enabled || running) return;
    if (!isOnline()) { status('offline'); return; }
    running = true;
    try {
      while (syncedGeneration !== generation) {
        const target = generation;
        status('syncing');
        try {
          const res = await api.saveWorkspace(getWorkspace(), baseVersion);
          setBase(res.version);
          syncedGeneration = target;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            if (!(await resolveConflict(e.data))) { status('conflict'); return; }
          } else throw e;
        }
      }
      status('synced');
    } catch (e) {
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
    changed,
    flush,
    get pending() { return syncedGeneration !== generation; },
    /** Chamado após login: compara local x remoto e decide o ponto de partida. */
    async start(localHasContent, knownVersion = null) {
      enabled = true;
      status('syncing');
      try {
        const remote = await api.getWorkspace();
        if (!remote.exists) {
          setBase(null);
          generation++;
        } else {
          setBase(remote.version);
          if (knownVersion !== null && knownVersion === remote.version) {
            generation++; // local descende desta versão: o local vence, sem perguntar
          } else if (localHasContent) {
            if (!(await resolveConflict({ data: remote.data, version: remote.version }))) { status('conflict'); return; }
          } else {
            applyRemote(remote.data, 'replace');
            syncedGeneration = generation;
          }
        }
        await flush();
        if (syncedGeneration === generation) status('synced');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) { enabled = false; status('reauth'); if (onReauth) onReauth(); } else { status('offline'); arm(retryDelay); }
      }
    },
    stop() { enabled = false; if (timer) clearTimer(timer); timer = null; status('local'); },
    online() { if (enabled && this.pending) flush(); },
  };
}
