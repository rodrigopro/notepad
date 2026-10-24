#!/usr/bin/env bash
# Publica dist/ por FTPS. Variáveis: FTP_SERVER, FTP_USERNAME, FTP_PASSWORD, FTP_DESTINATION. DRY_RUN=1 só mostra o plano.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${FTP_SERVER:?}" "${FTP_USERNAME:?}" "${FTP_PASSWORD:?}" "${FTP_DESTINATION:?}"
SRC="${1:-dist}"
[[ -f "$SRC/api.php" ]] || { echo "ERRO: $SRC inválido (sem api.php)" >&2; exit 1; }

DEST="${FTP_DESTINATION%/}"
if [[ -z "$DEST" || "$DEST" == "." ]]; then DEST="/"; fi
HOST="${FTP_SERVER#ftp://}"; HOST="${HOST#ftps://}"; HOST="${HOST%%/*}"

LFTP_SET='set cmd:fail-exit yes; set net:max-retries 2; set net:timeout 20; set ftp:ssl-allow yes; set ftp:ssl-force yes; set ftp:ssl-protect-data yes; set ssl:verify-certificate yes; set ftp:passive-mode yes'
run() { lftp -e "$LFTP_SET; $1; bye" -u "$FTP_USERNAME,$FTP_PASSWORD" "ftp://$HOST"; }

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "[dry-run] host=$HOST destino=$DEST arquivos=$(find "$SRC" -type f | wc -l | tr -d ' ')"
  exit 0
fi

# --delete só é seguro se o destino for dedicado ao Notepad (vazio ou com o marcador .notepad-app).
listing="$(run "mkdir -p -f '$DEST'; cd '$DEST'; cls -a" 2>/dev/null | grep -vE '^\.{1,2}/?$' || true)"
DELETE=""
if [[ -z "$listing" ]] || grep -qx '.notepad-app' <<<"$listing"; then
  DELETE="--delete"
else
  echo "AVISO: destino não está vazio e não tem o marcador .notepad-app; publicando sem --delete." >&2
  echo "       Para habilitar a limpeza de arquivos antigos, crie um arquivo vazio .notepad-app em $DEST." >&2
fi
: > "$SRC/.notepad-app"

run "cd '$DEST'; mirror -R --parallel=4 --verbose=1 $DELETE --exclude-glob .git* '$SRC' ."
run "cd '$DEST'; chmod 600 app/config.local.php" || echo "AVISO: não foi possível aplicar chmod 600 em config.local.php" >&2
echo "deploy concluído"
