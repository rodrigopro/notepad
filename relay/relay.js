// Relé do OAuth: recebe o retorno do Google (query com `iss=https://…`, que o ModSecurity da hospedagem
// bloqueia) e repassa só code/state/error ao app no #fragmento, que nunca é enviado ao servidor.
// `target.js` é gerado no deploy (workflow pages.yml) a partir de GOOGLE_REDIRECT_URI.
(function () {
  var target = window.NOTEPAD_CALLBACK;
  var q = new URLSearchParams(location.search);
  history.replaceState(null, '', location.pathname);
  if (typeof target !== 'string' || target.indexOf('https://') !== 0) { document.body.textContent = 'Relé não configurado.'; return; }
  var out = new URLSearchParams();
  ['code', 'state', 'error'].forEach(function (k) { if (q.has(k)) { out.set(k, q.get(k)); } });
  location.replace(target + '#' + out.toString());
})();
