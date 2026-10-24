# Spec Delta

## Purpose

Permite imprimir o Markdown renderizado ou gerá-lo como PDF usando o recurso de impressão do navegador.

## ADDED Requirements

### Requirement: Impressão do preview
O sistema SHALL oferecer a ação "Imprimir / PDF" que imprime somente o conteúdo renderizado, sem interface do editor.

#### Scenario: Imprimir
- **WHEN** o usuário aciona "Imprimir / PDF"
- **THEN** o diálogo de impressão abre exibindo apenas o preview, com título do documento

### Requirement: Layout de impressão
O CSS de impressão SHALL usar fundo branco, texto escuro, quebras de página evitando cortar títulos, tabelas e blocos de código, e mostrar URLs de links.

#### Scenario: Bloco de código longo
- **WHEN** um bloco de código excede o espaço da página
- **THEN** o texto quebra linha sem ser cortado

### Requirement: Geração de PDF sem dependências
O PDF SHALL ser obtido via "Salvar como PDF" do diálogo de impressão, sem biblioteca ou serviço externo.

#### Scenario: Salvar como PDF
- **WHEN** o usuário escolhe "Salvar como PDF" no diálogo
- **THEN** um PDF com o conteúdo renderizado é gerado localmente
