// Cliente da API PHP. Nenhum token passa por aqui: a autenticação é um cookie HttpOnly.
export class ApiError extends Error {
  constructor(status, code, data) {
    super(code || 'error');
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export function createApi(fetchFn = globalThis.fetch.bind(globalThis), base = 'api.php') {
  async function call(route, { method = 'GET', body, query = {} } = {}) {
    const qs = new URLSearchParams({ r: route, ...query }).toString();
    const init = { method, credentials: 'same-origin', headers: { 'X-Notepad': '1' } };
    if (method !== 'GET') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body ?? {});
    }
    const res = await fetchFn(`${base}?${qs}`, init); // rede indisponível lança TypeError
    let data = null;
    try { data = await res.json(); } catch { /* corpo vazio ou inválido */ }
    if (!res.ok) throw new ApiError(res.status, data && data.error, data);
    return data;
  }
  return {
    me: () => call('auth/me'),
    exchange: (code, state) => call('auth/exchange', { method: 'POST', body: { code, state } }),
    logout: () => call('auth/logout', { method: 'POST' }),
    getWorkspace: () => call('drive/workspace'),
    saveWorkspace: (data, baseVersion, force = false) => call('drive/workspace/save', { method: 'POST', body: { data, baseVersion, force } }),
    listFiles: () => call('drive/files'),
    openFile: (id) => call('drive/file', { query: { id } }),
    saveFile: (file) => call('drive/file/save', { method: 'POST', body: file }),
  };
}
