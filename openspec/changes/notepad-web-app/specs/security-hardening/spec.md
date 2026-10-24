# Spec Delta

## Purpose

Reduz a superfície de ataque do Notepad e garante resiliência às falhas PHP2Shell (CVE-2026-109618, CVE-2026-109619) e a classes de risco semelhantes.

## ADDED Requirements

### Requirement: Versão de PHP corrigida
O deploy SHALL falhar ou alertar se o PHP do servidor estiver abaixo de 8.2.35, 8.3.36, 8.4.27 ou 8.5.12 (ou sem backport comprovado), e o app MUST expor apenas um health check sem revelar a versão.

#### Scenario: PHP vulnerável
- **WHEN** a verificação pós-deploy detecta versão abaixo da corrigida
- **THEN** o pipeline termina com erro indicando a necessidade de atualizar o PHP

### Requirement: Mitigações de configuração
O app SHALL desativar `session.upload_progress` e `file_uploads`, `allow_url_include`, `expose_php` e `display_errors` quando permitido pela hospedagem, e MUST NOT usar sessões, uploads, `unserialize`, `eval`, `include` dinâmico nem execução de comandos.

#### Scenario: Requisição com upload
- **WHEN** um cliente envia `multipart/form-data` a qualquer endpoint
- **THEN** a requisição é rejeitada com 415 antes de qualquer processamento

### Requirement: Superfície PHP mínima
Apenas os endpoints PHP declarados SHALL ser acessíveis; código de aplicação, configuração e segredos MUST NOT ser servidos pela web, e o diretório público MUST NOT permitir execução de PHP fora do front controller.

#### Scenario: Acesso a arquivo interno
- **WHEN** alguém requisita `/lib/...`, `/config.local.php` ou `/tests/...`
- **THEN** o servidor responde 403 ou 404

### Requirement: Cabeçalhos e CSP
Todas as respostas SHALL incluir CSP restritiva (sem `unsafe-inline` e sem `unsafe-eval`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors 'none'` e HSTS em HTTPS.

#### Scenario: Cabeçalhos presentes
- **WHEN** qualquer página é carregada
- **THEN** os cabeçalhos exigidos estão presentes

### Requirement: Proteção CSRF e entrada
Requisições mutáveis à API SHALL exigir método POST/PUT, cabeçalho customizado, `Origin` igual ao do site e `Content-Type: application/json`, com tamanho de corpo limitado e validação estrita.

#### Scenario: Origem externa
- **WHEN** uma página de outro domínio dispara POST à API
- **THEN** a resposta é 403 e nada é alterado

### Requirement: Segredos fora do repositório
Credenciais OAuth, chave de cifragem e acessos FTP MUST NOT constar no repositório nem em logs.

#### Scenario: Varredura de segredos
- **WHEN** a pipeline varre o repositório
- **THEN** nenhum segredo é encontrado
