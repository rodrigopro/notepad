# Tasks

## 1. Fundação e segurança do backend

- [x] 1.1 Criar estrutura (`public/`, `api/`, `auth/`, `lib/`, `tests/`), `.gitignore` (config.local.php, node_modules, vendor) e `.htaccess`/`.user.ini` de hardening; verificar com teste que `/lib`, `/tests` e `config.local.php` retornam 403/404 em `php -S`.
- [x] 1.2 Implementar front controller `public/api.php` com roteamento por allowlist, cabeçalhos de segurança/CSP, limite de corpo, rejeição de `multipart/form-data` (415) e checagem de Origin/`X-Notepad`; verificar com testes CLI de cada rejeição.
- [x] 1.3 Implementar health check e verificação de versão mínima do PHP (8.2.35/8.3.36/8.4.27/8.5.12) sem expor versão; verificar com testes de comparação de versões.
- [x] 1.4 Implementar cookie cifrado AES-256-GCM (sem `$_SESSION`) e testes de adulteração, expiração e chave errada; documentar rotação de chave em `README.md`.

## 2. Autenticação Google

- [x] 2.1 Implementar cliente HTTP com cURL (TLS verificado, timeouts) em `lib/` e verificar com teste contra servidor local simulado.
- [x] 2.2 Implementar `auth/start` e `auth/callback` com PKCE e `state`; verificar com testes de state inválido, negação e troca de código simulada.
- [ ] 2.3 Implementar `auth/me` e `auth/logout` com revogação do token; verificar com testes e fluxo manual real com conta Google.

## 3. Integração com o Drive

- [x] 3.1 Implementar API `drive/workspace` (GET/PUT) na `appDataFolder` com detecção de conflito por versão; verificar com testes de mock e conflito.
- [ ] 3.2 Implementar `drive/files` (listar, abrir, criar/atualizar) na pasta "Notepad" com validação de IDs; verificar com testes de entrada inválida e teste manual no Drive.
- [x] 3.3 Tratar 401/refresh, 429 e erros do Google com respostas padronizadas; verificar com testes de cada status.

## 4. Front-end: editor

- [x] 4.1 Criar `index.html`, `app.css` e shell do app sem scripts/estilos inline; verificar CSP sem violações no console.
- [x] 4.2 Implementar abas (novo, fechar, renomear, reordenar, confirmação) com testes `node --test` do módulo de estado.
- [x] 4.3 Implementar gutter de linhas, localizar/substituir, ir para linha, barra de status e atalhos; verificar com testes das funções puras e checagem manual.
- [x] 4.4 Implementar autosave/restauração em `localStorage` com tratamento de falha e teste dos cenários cheio/bloqueado.

## 5. Front-end: Drive

- [ ] 5.1 Implementar login/logout na UI e estado de sessão; verificar manualmente o fluxo e que tokens não aparecem em JS/storage.
- [ ] 5.2 Implementar sync com debounce, fila offline, indicador de estado e diálogo de conflito; verificar com testes da fila e cenário manual offline/online.
- [ ] 5.3 Implementar "Abrir/Salvar no Drive"; verificar manualmente criando e reabrindo um arquivo.

## 6. Markdown e impressão

- [x] 6.1 Implementar parser Markdown (blocos e inline) renderizando por DOM; verificar com testes de cada sintaxe suportada.
- [x] 6.2 Adicionar corpus de payloads XSS (script, `javascript:`, `onerror`, `data:`) e verificar que nada executa nem vira âncora/atributo perigoso.
- [x] 6.3 Implementar painel de preview ao vivo alternável e verificação manual de desempenho com documento grande.
- [x] 6.4 Implementar `print.css` e botão "Imprimir / PDF"; verificar visualmente a pré-visualização de impressão e "Salvar como PDF" (tabelas, código, links).

## 7. CI/CD

- [ ] 7.1 Criar workflow `test` (php -l, testes PHP CLI, ESLint, `node --test`, varredura de segredos); verificar execução verde e falha proposital.
- [x] 7.2 Criar script de empacotamento `dist/` com exclusões e geração de config a partir de secrets; verificar localmente que `dist/` não contém itens excluídos nem segredos no log.
- [ ] 7.3 Criar job `deploy` com `lftp` via FTPS, `needs: test`, só em `main`; confirmar nomes dos secrets existentes e verificar um deploy real.
- [x] 7.4 Adicionar verificação pós-deploy (health check, versão mínima de PHP, acesso negado a arquivos internos) e verificar que falha quando simulada.

## 8. Integração final

- [ ] 8.1 Executar roteiro ponta a ponta em produção (login, abas, sync em dois navegadores, Markdown, PDF) e registrar o resultado.
- [ ] 8.2 Escrever `README.md` com setup do Google Cloud, secrets, requisitos de PHP corrigido e rollback; verificar seguindo-o do zero.
