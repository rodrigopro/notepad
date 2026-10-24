# Spec Delta

## Purpose

Define o editor de texto multiabas do Notepad: criação, edição, fechamento e recuperação de abas no navegador, com recursos básicos inspirados no Notepad++.

## ADDED Requirements

### Requirement: Gerenciamento de abas
O sistema SHALL permitir criar, renomear, alternar, reordenar e fechar abas, cada uma com conteúdo independente.

#### Scenario: Nova aba
- **WHEN** o usuário aciona "Novo" (botão ou Ctrl+N)
- **THEN** uma aba vazia "Sem título N" é criada e recebe o foco

#### Scenario: Fechar aba com alterações não salvas
- **WHEN** o usuário fecha uma aba modificada e ainda não sincronizada
- **THEN** o sistema pede confirmação antes de descartar

### Requirement: Edição de texto
O sistema SHALL oferecer numeração de linhas, desfazer/refazer, localizar e substituir, ir para linha e barra de status com linha, coluna e total de caracteres.

#### Scenario: Localizar e substituir
- **WHEN** o usuário informa um termo e aciona "Substituir tudo"
- **THEN** todas as ocorrências na aba ativa são substituídas e a contagem é exibida

#### Scenario: Posição do cursor
- **WHEN** o cursor se move
- **THEN** a barra de status mostra linha e coluna atualizadas

### Requirement: Persistência local e recuperação
O sistema SHALL salvar automaticamente as abas no armazenamento local do navegador e restaurá-las ao reabrir o app, mesmo sem login.

#### Scenario: Recarregar a página
- **WHEN** o usuário recarrega a página com abas abertas
- **THEN** as mesmas abas, conteúdo e aba ativa são restaurados

#### Scenario: Armazenamento indisponível
- **WHEN** o armazenamento local está bloqueado ou cheio
- **THEN** o app continua funcionando e avisa que o autosave está desativado
