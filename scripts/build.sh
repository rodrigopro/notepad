#!/usr/bin/env bash
# Monta dist/ apenas com arquivos de runtime. Uso: scripts/build.sh [diretório-de-saída]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-dist}"
rm -rf "$OUT"
mkdir -p "$OUT/app"
cp -R public/. "$OUT/"
cp -R lib auth api "$OUT/app/"
printf 'Require all denied\n' > "$OUT/app/.htaccess"

if [[ -n "${GOOGLE_CLIENT_ID:-}" ]]; then
  : "${GOOGLE_CLIENT_SECRET:?}" "${GOOGLE_REDIRECT_URI:?}"
  umask 077
  php -r '
    $c = ["client_id" => getenv("GOOGLE_CLIENT_ID"), "client_secret" => getenv("GOOGLE_CLIENT_SECRET"), "redirect_uri" => getenv("GOOGLE_REDIRECT_URI")];
    file_put_contents($argv[1], "<?php\ndeclare(strict_types=1);\nif (!defined(\"NP_APP\")) { http_response_code(404); exit; }\nreturn " . var_export($c, true) . ";\n");
  ' "$OUT/app/config.local.php"
fi
echo "dist pronto em $OUT"
