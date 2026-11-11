// localStorage defensivo: pode lançar exceção (modo privado, bloqueado, cheio).
export const KEY = 'notepad.workspace.v1';

export function createStorage(backend, key = KEY) {
  let ok = true;
  const get = () => {
    try { return backend || globalThis.localStorage; } catch { return null; }
  };
  return {
    get available() { return ok; },
    load() {
      try {
        const raw = get().getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    save(data) {
      try {
        get().setItem(key, JSON.stringify(data));
        ok = true;
      } catch {
        ok = false;
      }
      return ok;
    },
  };
}
