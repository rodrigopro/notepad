# Spec Delta

## Purpose

Sincroniza as abas do usuário com o Google Drive e permite abrir e salvar arquivos de texto na pasta "Notepad".

## ADDED Requirements

### Requirement: Sincronização do workspace
O sistema SHALL salvar o conjunto de abas (títulos, conteúdo, aba ativa) na `appDataFolder` do usuário e restaurá-lo em qualquer dispositivo após login.

#### Scenario: Sincronizar após edição
- **WHEN** o usuário autenticado edita uma aba e pausa a digitação
- **THEN** o workspace é enviado ao Drive e o indicador mostra "Sincronizado"

#### Scenario: Abrir em outro dispositivo
- **WHEN** o usuário faz login em outro navegador
- **THEN** as abas do Drive são carregadas

### Requirement: Salvar e abrir arquivos no Drive
O sistema SHALL permitir "Salvar no Drive" e "Abrir do Drive" para arquivos criados pelo app na pasta "Notepad".

#### Scenario: Salvar no Drive
- **WHEN** o usuário aciona "Salvar no Drive" em uma aba
- **THEN** um arquivo de texto é criado ou atualizado na pasta "Notepad" e a aba fica vinculada a ele

### Requirement: Resolução de conflitos
O sistema SHALL detectar alteração concorrente (versão remota mais nova) e MUST NOT sobrescrever sem decisão do usuário.

#### Scenario: Conflito
- **WHEN** o workspace remoto foi modificado depois da última sincronização local
- **THEN** o usuário escolhe entre manter local, manter remoto ou salvar cópia

### Requirement: Resiliência offline
O sistema SHALL continuar editando offline e reenviar as alterações pendentes quando houver conexão e sessão válidas.

#### Scenario: Retorno da conexão
- **WHEN** a conexão volta com alterações pendentes
- **THEN** elas são sincronizadas automaticamente

#### Scenario: Token expirado
- **WHEN** o Drive responde 401 e o refresh falha
- **THEN** o app pede novo login sem perder conteúdo local
