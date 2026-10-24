# Spec Delta

## Purpose

Garante que o Notepad seja validado e publicado automaticamente no servidor via FTP a cada alteração aprovada na branch principal.

## ADDED Requirements

### Requirement: Deploy automático
O GitHub Actions SHALL publicar via FTP/FTPS a cada push em `main`, somente após testes e lint passarem, usando Repository secrets.

#### Scenario: Push em main
- **WHEN** um commit chega em `main` e os testes passam
- **THEN** os arquivos alterados são enviados ao servidor

#### Scenario: Testes falham
- **WHEN** qualquer teste ou lint falha
- **THEN** nenhum arquivo é enviado

### Requirement: Conteúdo publicado restrito
O pacote SHALL conter apenas arquivos de runtime e excluir `.git`, `.github`, `openspec`, `tests`, `node_modules`, `vendor` de desenvolvimento, `.claude` e `.opencode`.

#### Scenario: Pacote de deploy
- **WHEN** o pacote é montado
- **THEN** nenhum arquivo excluído está presente

### Requirement: Configuração de produção a partir de secrets
A configuração de produção (credenciais OAuth, chave de cifragem) SHALL ser gerada no deploy a partir de secrets e transferida por canal cifrado (FTPS), sem aparecer em logs.

#### Scenario: Log do workflow
- **WHEN** o deploy termina
- **THEN** o log não contém valores de secrets

### Requirement: Verificação pós-deploy
O pipeline SHALL consultar o health check após a publicação e falhar se a resposta for inválida.

#### Scenario: Health check falha
- **WHEN** o endpoint não responde 200 após o deploy
- **THEN** o workflow é marcado como falho
