# Design

## Context

Projeto greenfield. Existem pastas vazias `public/`, `api/`, `auth/`, `lib/`, `tests/`, `.github/workflows/`, além de `vendor/` (google, firebase, guzzle, monolog) e `node_modules/` (eslint), que não serão usados em runtime. Motivação em proposal.md.
Restrições: PHP e JS puros; hospedagem compartilhada acessada por FTP (docroot e estrutura de diretórios do servidor desconhecidos); PHP2Shell é falha do interpretador, então o app não a corrige — só pode exigir PHP corrigido e evitar o caminho de ataque citado (session upload progress) e reduzir impacto.

## Goals / Non-Goals

**Goals:**
- Zero dependências de terceiros em runtime; PHP ≥ 8.2 corrigido.
- Tokens do Google nunca expostos ao JS.
- Deploy reprodutível, sem segredos no repositório.

**Non-Goals:**
- Syntax highlighting multi-linguagem, colaboração em tempo real, plugins.
- PDF gerado no servidor.
- Corrigir o PHP do servidor (responsabilidade da hospedagem).

## Decisions

1. **Layout**: `public/` (index.html, `assets/app.js` em módulos ES, `assets/app.css`, `assets/print.css`) como docroot; `public/api.php` como único front controller PHP, que carrega `lib/` e `auth/` por caminhos fixos (`require` estático, sem input do usuário). Se a hospedagem só tiver um docroot, `lib/`, `auth/`, `api/` ficam ao lado dele com `.htaccess` `Require all denied`. Alternativa descartada: roteamento por vários PHPs públicos (mais superfície).
2. **Sem sessões PHP**: identidade em cookie `__Host-notepad` HttpOnly/Secure/SameSite=Strict contendo payload cifrado com AES-256-GCM (`openssl_*`, extensão padrão). Como o repositório só tem os secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI` (sem chave dedicada), a chave de 32 bytes é derivada por HKDF do `GOOGLE_CLIENT_SECRET`. Contém refresh token e ID do usuário; access tokens são renegociados por request. Evita `session.upload_progress` (vetor citado nas análises do PHP2Shell) e armazenamento em disco. Alternativa: tokens em arquivo/DB no servidor — mais estado e risco de path/permissões. Trade-off: cookie ~1 KB; rotacionar o client secret invalida os logins.
3. **OAuth**: Authorization Code + PKCE + `state` com `response_mode=fragment`: o retorno vai para a página estática `callback.html`, que troca o código via `POST auth/exchange` (a query do Google com `iss=https://…` é bloqueada pelo ModSecurity da hospedagem, HTTP 406, e `SecRuleEngine Off` em `.htaccess` causa 500 lá). O `state` e o verifier ficam em cookie curto cifrado (Lax), válidos por 10 min. Chamadas HTTP ao Google com `curl` (extensão padrão), TLS verificado, timeouts. Escopos: `openid email profile drive.file drive.appdata`. Alternativa: google/apiclient em `vendor/` — descartada por requisito.
4. **Drive**: `workspace.json` na `appDataFolder` (upload multipart/media, controle por `modifiedTime`/`headRevisionId` para conflito); arquivos explícitos na pasta "Notepad" (`drive.file`). O front-end fala só com `/api`, que faz proxy fino e allowlist de operações (sem repassar URLs ou IDs arbitrários além dos ID válidos por regex).
5. **Editor**: `<textarea>` com gutter de números de linha sincronizado por scroll; abas como estado em memória serializado em `localStorage` (debounce). Sync com debounce de ~2 s, fila de pendências, `navigator.onLine`.
6. **Markdown**: parser próprio (blocos → inline) que produz nós via `createElement`/`textContent`, nunca `innerHTML`; HTML bruto vira texto; allowlist de esquemas de URL. Testes com corpus de payloads XSS.
7. **Impressão/PDF**: `window.print()` com `@media print` ocultando UI e mostrando só `#preview`; PDF = "Salvar como PDF" do navegador. Alternativa: gerador de PDF em JS/PHP próprio — grande, frágil, fora do valor.
8. **Segurança transversal**: CSP `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, sem scripts/estilos inline. API aceita só `application/json`, rejeita `multipart/form-data` com 415, limita corpo (256 KB, workspace até ~2 MB), valida `Origin` e header `X-Notepad: 1`. `.user.ini`/`.htaccess` tentam `session.upload_progress=0`, `file_uploads=0`, `expose_php=0`, `display_errors=0`. Sem `unserialize`/`eval`/`exec`. Erros logados sem segredos.
9. **CVE-2026-115560**: não localizado em fontes públicas; tratado como risco não verificado. Mitigação: manter política de PHP corrigido, superfície mínima e reavaliar com o advisory real.
10. **Deploy**: workflow GitHub Actions com jobs `test` (php -l, testes PHP próprios via CLI sem PHPUnit, ESLint existente em node_modules/testes JS com `node --test`) e `deploy` (needs: test, só `main`). Publica com `lftp` (instalado na runner) via FTPS explícito, `mirror -R --only-newer` de um pacote montado em `dist/` (sem `vendor`/`node_modules`). Config de produção gerada em `dist/` a partir de secrets (permissões restritas). Pós-deploy: `curl` ao health check e conferência de versão mínima do PHP por endpoint de verificação que só responde "ok/outdated". Sem action de terceiros. Nomes dos secrets reais: `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`, `FTP_DESTINATION`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. A URL do site para o pós-deploy é derivada de `GOOGLE_REDIRECT_URI`. `--delete` no mirror só é usado se o destino estiver vazio ou tiver o marcador `.notepad-app`.

## Risks / Trade-offs

- [PHP do servidor vulnerável a PHP2Shell] → verificação no deploy e documentação; o app não substitui o patch.
- [FTP sem TLS vaza credenciais] → exigir FTPS; falhar se indisponível.
- [Hospedagem ignora `.htaccess`/`.user.ini` (Nginx)] → doc de config equivalente; teste pós-deploy de acesso a arquivos internos.
- [Parser Markdown próprio com bugs] → escopo de sintaxe limitado, testes e saída por DOM seguro.
- [Verificação do app Google (escopos) e limites de quota] → escopos não sensíveis (`drive.file`, `drive.appdata`).
- [Perda de dados em conflito] → nunca sobrescrever sem decisão; cópia local mantida.
- [Cookie cifrado com chave única] → chave só em secret, rotação documentada.

## Migration Plan

1. Usuário cria OAuth client no Google Cloud (redirect = valor de `GOOGLE_REDIRECT_URI`).
2. Primeiro deploy em `main`; health check e verificação de PHP.
3. Rollback: reexecutar workflow de um commit anterior (mirror restaura arquivos); rotacionar o client secret invalida sessões.

## Open Questions

- Docroot real e se o servidor é Apache ou Nginx (afeta só os arquivos de configuração incluídos, não os specs).
