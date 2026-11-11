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
O sistema SHALL detectar alteração concorrente (versão remota mais nova) e mesclá-la automaticamente, aba por aba, contra o último estado sincronizado (mescla em três vias). O sistema MUST NOT descartar texto de nenhum dos lados.

#### Scenario: Abas diferentes editadas em aparelhos diferentes
- **WHEN** um aparelho edita a aba A e outro edita a aba B desde o último sync
- **THEN** o Drive e os dois aparelhos ficam com as duas edições, sem perguntar nada

#### Scenario: Mesma aba editada nos dois aparelhos
- **WHEN** os dois lados mudaram o conteúdo da mesma aba de forma diferente
- **THEN** a versão local fica na aba, a do outro aparelho vira uma aba "(conflito)" ao lado e o usuário é avisado

#### Scenario: Aba apagada num aparelho
- **WHEN** uma aba é fechada num aparelho e não foi editada no outro
- **THEN** ela some nos dois; se foi editada no outro, é mantida

### Requirement: Atualização contínua
O sistema SHALL trazer as mudanças de outros aparelhos sem recarregar a página: ao voltar o foco, ao reconectar e periodicamente enquanto a página estiver visível, usando uma consulta leve que só baixa o conteúdo quando a versão mudou. Ao ocultar ou fechar a página, as alterações pendentes SHALL ser gravadas localmente e enviadas imediatamente.

#### Scenario: Página aberta em outro aparelho
- **WHEN** o usuário edita no celular e volta ao computador com a página já aberta
- **THEN** o computador mostra a edição do celular antes de o usuário continuar escrevendo

### Requirement: Resiliência offline
O sistema SHALL continuar editando offline e reenviar as alterações pendentes quando houver conexão e sessão válidas.

#### Scenario: Retorno da conexão
- **WHEN** a conexão volta com alterações pendentes
- **THEN** elas são sincronizadas automaticamente

#### Scenario: Token expirado
- **WHEN** o Drive responde 401 e o refresh falha
- **THEN** o app pede novo login sem perder conteúdo local
