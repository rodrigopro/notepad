// localStorage defensivo: pode lançar exceção (modo privado, bloqueado, cheio).
const KEY = 'notepad.workspace.v1';

export function createStorage(backend) {
  let ok = true;
  const get = () => {
    try { return backend || globalThis.localStorage; } catch { return null; }
  };
  return {
    get available() { return ok; },
    load() {
      try {
        const raw = get().getItem(KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    save(data) {
      try {
        get().setItem(KEY, JSON.stringify(data));
        ok = true;
      } catch {
        ok = false;
      }
      return ok;
    },
  };
}
