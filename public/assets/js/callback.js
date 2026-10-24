// Recebe o retorno do Google no #fragmento (nunca enviado ao servidor), troca o código e volta ao app.
import { createApi } from './api.js';

const params = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, '', location.pathname); // tira código e state da URL/histórico

const go = (suffix) => location.replace('./' + suffix);
const code = params.get('code');
const state = params.get('state');

if (params.get('error') === 'access_denied') go('?login=denied');
else if (!code || !state) go('?login=error');
else {
  createApi().exchange(code, state).then(() => go(''), () => go('?login=error'));
}
