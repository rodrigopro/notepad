# Proposal

## Why

Não há um editor de texto leve, estilo Notepad++, acessível pelo navegador e com as abas persistidas na nuvem do próprio usuário. Queremos o **Notepad**: um app web em PHP, HTML e JavaScript puros (zero bibliotecas de terceiros em runtime), que sincroniza abas com o Google Drive, renderiza Markdown com opção de impressão/PDF e é publicado automaticamente por FTP.
O momento exige cuidado extra: as falhas **PHP2Shell** (CVE-2026-109618 e CVE-2026-109619, RCE não autenticado no interpretador, corrigidas em PHP 8.2.35 / 8.3.36 / 8.4.27 / 8.5.12) foram divulgadas e há relatos de exploração. A segurança precisa ser requisito de primeira classe, não um ajuste posterior.

## What Changes

- Novo app web "Notepad" com editor multiabas (numeração de linhas, localizar/substituir, barra de status, atalhos), com autosave local.
- Login com Google (OAuth 2.0 Authorization Code + PKCE) feito em PHP puro, sem `$_SESSION` do PHP.
- Sincronização de abas com o Google Drive: workspace (lista de abas) na `appDataFolder` e arquivos salvos explicitamente na pasta "Notepad" (escopos `drive.appdata` e `drive.file`).
- Preview de Markdown com parser próprio e seguro, painel dividido ao vivo.
- Impressão do preview e exportação em PDF via diálogo de impressão do navegador (CSS `@media print`).
- Camada de segurança: verificação de versão do PHP corrigida, mitigações para PHP2Shell, CSP estrita, proteção CSRF, cabeçalhos, sem upload de arquivos, sem execução de código dinâmico.
- Pipeline GitHub Actions: testes, lint, bloqueio de deploy em caso de falha e publicação por FTP/FTPS a cada push em `main`, usando os Repository secrets já criados.
- **Dependências**: `vendor/` e `node_modules/` existentes ficam apenas para desenvolvimento/testes e **não** são enviados ao servidor.

## Capabilities

### New Capabilities
- `editor-tabs`: editor de texto multiabas com operações básicas de edição e persistência local.
- `google-auth`: login/logout com Google via OAuth2 + PKCE e custódia segura de tokens.
- `drive-sync`: sincronização das abas e salvamento/abertura de arquivos no Google Drive.
- `markdown-preview`: renderização segura de Markdown ao lado do editor.
- `print-export`: impressão do preview e geração de PDF pelo navegador.
- `security-hardening`: requisitos de segurança transversais (PHP2Shell, CSP, CSRF, superfície de ataque mínima).
- `ci-cd-deploy`: build, testes e publicação automática por FTP.

### Modified Capabilities
<!-- Nenhuma: não existem specs principais. -->

## Impact

- Código novo: `public/` (HTML/JS/CSS e front controller), `api/`, `auth/`, `lib/` (PHP), `tests/`, `.github/workflows/deploy.yml`.
- Sistemas externos: Google OAuth 2.0 e Drive API v3; servidor FTP/FTPS de hospedagem com PHP corrigido.
- Operacional: o Google Cloud (OAuth client, tela de consentimento) e a conferência dos nomes dos Repository secrets são pré-requisitos do usuário.
- Fora de escopo: colaboração em tempo real, syntax highlighting multi-linguagem, plugins, app mobile nativo, PDF gerado no servidor.
- Observação: o CVE-2026-115560 não foi localizado em fontes públicas na pesquisa feita; o plano o trata como "falha complementar não verificada" e cobre a classe de risco (RCE no interpretador/upload/sessão) com defesas genéricas. Reavaliar quando houver advisory.
