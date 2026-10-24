#!/usr/bin/env bash
# Verificação pós-deploy. Uso: verify-deploy.sh <URL base, termina em />
set -uo pipefail
BASE="${1:?URL base}"
BASE="${BASE%/}/"
fail=0
bad() { echo "FALHA: $*" >&2; fail=1; }

body=""
for i in $(seq 1 18); do
  body="$(curl -fsS --max-time 15 "${BASE}api.php?r=health" 2>/dev/null)" && break
  sleep 5
done
if ! grep -q '"ok":true' <<<"$body"; then bad "health check inválido: ${body:-sem resposta}"; fi
if grep -q '"php":"outdated"' <<<"$body"; then bad "PHP do servidor está abaixo das versões corrigidas do PHP2Shell (8.2.35/8.3.36/8.4.27/8.5.12)"; fi

code() { curl -s -o /dev/null --max-time 15 -w '%{http_code}' "$@"; }
for p in app/config.local.php app/lib/util.php app/lib/crypto.php app/auth/handlers.php app/api/drive.php .user.ini .htaccess; do
  c="$(code "${BASE}${p}")"
  [[ "$c" == "403" || "$c" == "404" ]] || bad "${p} acessível (HTTP $c)"
done
if curl -s --max-time 15 "${BASE}app/config.local.php" | grep -qiE 'client_secret|<\?php'; then bad "config.local.php expõe conteúdo"; fi

c="$(code -X POST -H 'Content-Type: multipart/form-data; boundary=x' --data-binary $'--x\r\nContent-Disposition: form-data; name="a"\r\n\r\nb\r\n--x--\r\n' "${BASE}api.php?r=auth/logout")"
[[ "$c" == "415" ]] || bad "multipart deveria retornar 415 (HTTP $c)"
c="$(code -X POST -H 'Content-Type: application/json' -d '{}' "${BASE}api.php?r=auth/logout")"
[[ "$c" == "403" ]] || bad "POST sem CSRF deveria retornar 403 (HTTP $c)"

hdrs="$(curl -sI --max-time 15 "${BASE}api.php?r=health")"
grep -qi '^content-security-policy:' <<<"$hdrs" || bad "CSP ausente na API"
grep -qi '^x-powered-by:' <<<"$hdrs" && bad "X-Powered-By exposto"
curl -sI --max-time 15 "$BASE" | grep -qi '^content-security-policy:' || echo "AVISO: CSP não enviada em arquivos estáticos (usando só a <meta> do index.html); confira se o servidor processa .htaccess." >&2

[[ $fail -eq 0 ]] && echo "verificação pós-deploy: ok"
exit $fail
