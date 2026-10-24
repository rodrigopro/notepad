# Spec Delta

## Purpose

Autentica o usuário com a conta Google e mantém credenciais de forma segura para que o app acesse o Drive em nome dele, sem expor tokens ao JavaScript.

## ADDED Requirements

### Requirement: Login com OAuth 2.0 e PKCE
O sistema SHALL autenticar via Authorization Code com PKCE e parâmetro `state`, solicitando apenas os escopos `drive.file`, `drive.appdata` e identificação básica.

#### Scenario: Login bem-sucedido
- **WHEN** o usuário clica em "Entrar com Google" e autoriza
- **THEN** retorna ao app autenticado e o nome/avatar é exibido

#### Scenario: State inválido
- **WHEN** o callback chega com `state` ausente ou diferente do emitido
- **THEN** o login é rejeitado com erro genérico e nenhum token é armazenado

#### Scenario: Usuário nega consentimento
- **WHEN** o Google retorna `error=access_denied`
- **THEN** o app permanece em modo local com mensagem informativa

### Requirement: Custódia de tokens
Tokens SHALL permanecer apenas no servidor ou em cookie HttpOnly, Secure, SameSite=Strict e cifrado; o JavaScript MUST NOT ter acesso a access/refresh tokens.

#### Scenario: Inspeção do navegador
- **WHEN** o script da página tenta ler `document.cookie` ou o storage
- **THEN** nenhum token do Google está acessível

### Requirement: Logout e revogação
O sistema SHALL encerrar a sessão e revogar o refresh token no Google ao fazer logout.

#### Scenario: Logout
- **WHEN** o usuário aciona "Sair"
- **THEN** o cookie de sessão é invalidado, o token é revogado e o app volta ao modo local

### Requirement: Sessão sem sessões nativas do PHP
O sistema MUST NOT depender de `$_SESSION`, `session_start` nem de `session.upload_progress`.

#### Scenario: Requisição autenticada
- **WHEN** uma chamada `/api` chega com cookie válido
- **THEN** a identidade é obtida do cookie assinado/cifrado, sem iniciar sessão PHP
