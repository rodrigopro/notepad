# Spec Delta

## Purpose

Exibe uma prévia renderizada do Markdown da aba ativa, de forma segura e atualizada em tempo real.

## ADDED Requirements

### Requirement: Preview ao vivo
O sistema SHALL oferecer painel de preview, alternável, atualizado conforme a digitação.

#### Scenario: Ativar preview
- **WHEN** o usuário ativa o preview em uma aba
- **THEN** o painel exibe o Markdown renderizado e acompanha as edições

### Requirement: Sintaxe suportada
O sistema SHALL renderizar títulos, ênfase, listas (inclusive tarefas), citações, código inline e em bloco, links, imagens, tabelas e linhas horizontais.

#### Scenario: Tabela
- **WHEN** o texto contém uma tabela Markdown válida
- **THEN** ela é exibida como tabela HTML

### Requirement: Saída sanitizada
HTML bruto no Markdown MUST be exibido como texto; URLs MUST ser limitadas aos esquemas http, https e mailto (imagens: http, https e data:image raster).

#### Scenario: Script embutido
- **WHEN** o texto contém `<script>alert(1)</script>`
- **THEN** nada é executado e o texto aparece literal

#### Scenario: Link javascript
- **WHEN** o texto contém `[x](javascript:alert(1))`
- **THEN** o link não é gerado como âncora clicável
