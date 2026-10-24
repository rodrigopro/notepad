#!/usr/bin/env bash
# Falha se encontrar padrões típicos de segredos em arquivos versionados.
set -euo pipefail
cd "$(dirname "$0")/.."
PATTERNS='GOCSPX-[A-Za-z0-9_-]{20,}|[0-9]{8,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|(ftp|FTP)_?(pass|PASS)[A-Za-z_]*[ ]*[=:][ ]*["'"'"'][^"'"'"'$ ]{4,}'
found=0
while IFS= read -r -d '' f; do
  case "$f" in scripts/scan-secrets.sh|tests/*) continue;; esac
  [[ -f "$f" ]] || continue
  if grep -InE "$PATTERNS" "$f" /dev/null; then found=1; fi
done < <(git ls-files -z --cached --others --exclude-standard)
if [[ $found -eq 1 ]]; then
  echo "ERRO: possível segredo no repositório (veja acima)." >&2
  exit 1
fi
if git ls-files --cached | grep -qE '(^|/)config\.local\.php$'; then
  echo "ERRO: config.local.php está versionado." >&2
  exit 1
fi
echo "scan de segredos: ok"
