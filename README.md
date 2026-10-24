# Notepad

Editor de texto multiabas no navegador, com abas sincronizadas no Google Drive, preview de Markdown e impressão/PDF.
PHP, HTML e JavaScript puros: **nenhuma biblioteca de terceiros em runtime** (`vendor/` e `node_modules/` são só de desenvolvimento e nunca são publicados).

## Recursos

- Abas (novo, renomear com duplo clique, arrastar para reordenar, fechar), numeração de linhas, localizar/substituir, ir para linha, barra de status.
- Autosave local (`localStorage`) — funciona sem login.
- Login com Google (OAuth 2.0 + PKCE). Workspace de abas na `appDataFolder` do Drive; arquivos salvos explicitamente na pasta **Notepad**. Escopos: `drive.file` e `drive.appdata` (sem acesso ao resto do Drive).
- Preview de Markdown ao vivo, com HTML bruto sempre exibido como texto e URLs filtradas.
- **Imprimir / PDF**: usa o diálogo de impressão do navegador; escolha "Salvar como PDF".

Atalhos: `Ctrl+S` salvar no Drive · `Ctrl+F`/`Ctrl+H` localizar/substituir · `Ctrl+G` ir para linha · `Ctrl+P` imprimir/PDF · `Ctrl+Alt+N` nova aba · `Ctrl+Alt+W` fechar aba · `Ctrl+Alt+M` preview (use `Cmd` no macOS).

## Requisitos do servidor

- **PHP corrigido para o PHP2Shell (CVE-2026-109618 / CVE-2026-109619): 8.2.35, 8.3.36, 8.4.27, 8.5.12 ou superior** (ou backport comprovado do seu provedor). O pós-deploy falha se o servidor estiver desatualizado.
- Extensões `curl` e `openssl`, HTTPS e FTPS (explícito) habilitados.
- Apache com `.htaccess` (já incluído). Em Nginx, veja abaixo.
- Se possível, no `php.ini` do servidor: `file_uploads=Off`, `expose_php=Off`, `allow_url_include=Off`, `session.upload_progress.enabled=Off`, `display_errors=Off`. O app não usa sessões nem uploads.

> O **CVE-2026-115560** não foi localizado em fontes públicas durante o planejamento. As defesas (sem sessões/uploads, superfície PHP mínima, PHP corrigido) cobrem a classe de risco; reavalie quando houver advisory.

## Configuração (uma vez)

1. **Google Cloud Console** → APIs e serviços:
   - ative a *Google Drive API*;
   - configure a tela de consentimento (escopos `drive.file` e `drive.appdata` não são sensíveis);
   - crie um *ID do cliente OAuth* do tipo **Aplicativo da Web** e cadastre como **URI de redirecionamento autorizado** exatamente o valor de `GOOGLE_REDIRECT_URI`, por exemplo `https://seu-dominio.com/notepad/api.php?r=auth/callback`.
2. **Repository secrets** no GitHub (Settings → Secrets and variables → Actions):

   | Secret | Conteúdo |
   |---|---|
   | `FTP_SERVER` | host FTP (ex.: `ftp.seu-dominio.com`) |
   | `FTP_USERNAME` / `FTP_PASSWORD` | credenciais FTP |
   | `FTP_DESTINATION` | pasta remota que serve o site (ex.: `/public_html/notepad`) |
   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | credenciais OAuth |
   | `GOOGLE_REDIRECT_URI` | `https://…/api.php?r=auth/callback` (HTTPS obrigatório) |

3. Faça push em `main`. O workflow roda testes, monta `dist/`, publica por FTPS e verifica o resultado.

**Limpeza de arquivos antigos:** o deploy só apaga arquivos remotos (`--delete`) se `FTP_DESTINATION` estiver vazio ou contiver um arquivo `.notepad-app` (criado no primeiro deploy). Em pasta compartilhada com outros arquivos ele publica sem apagar nada.

### Chave de cifragem das sessões

Não há segredo separado: a chave AES-256-GCM dos cookies é derivada (HKDF) de `GOOGLE_CLIENT_SECRET`. **Rotacionar o client secret invalida todas as sessões** (os usuários só precisam entrar de novo; nada é perdido, pois as abas estão no Drive e no navegador).

### Nginx

```nginx
location ^~ /app/ { return 404; }
location ~ /\. { deny all; }
location = /api.php { include fastcgi_params; fastcgi_param SCRIPT_FILENAME $document_root/api.php; fastcgi_pass unix:/run/php/php-fpm.sock; }
location ~ \.php$ { return 404; }
add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" always;
add_header X-Content-Type-Options nosniff always;
```

## Desenvolvimento

```bash
# testes (PHP + JS)
npm test            # ou: php tests/run.php && node --test tests/js/*.test.js

# rodar localmente
GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… GOOGLE_REDIRECT_URI='http://localhost:8080/api.php?r=auth/callback' \
  php -S localhost:8080 -t public
```

Estrutura: `public/` (front-end e `api.php`), `lib/`, `auth/`, `api/` (PHP — vão para `app/` no deploy), `tests/`, `scripts/` (build, deploy, verificação, varredura de segredos).

## Rollback

Reexecute o workflow de um commit anterior (Actions → *Testes e deploy* → *Run workflow* na versão desejada) ou faça `git revert` e push.
