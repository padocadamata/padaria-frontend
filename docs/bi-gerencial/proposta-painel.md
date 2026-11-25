# BI Gerencial — proposta de organização do painel único `/bi`

**Status: APROVADA e HOMOLOGADA em 2026-11-25; publicada em `/bi` (migration 0084 já aplicada em produção). Menu lateral = o oficial do sistema.**
Ajustes finais da homologação visual: ver `ajustes-homologacao-visual.md`.
Uma única página, sem abas e sem subpáginas. Os blocos ficam empilhados
(desktop em grade de 12 colunas; celular em uma coluna) e todos obedecem aos
filtros gerais, salvo quando o próprio bloco os substitui.

## 1. Estrutura (de cima para baixo)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ BI Gerencial            Atualizado: 22/11 12:44 (parcial) · Ver cobertura │  <- bi_status
├──────────────────────────────────────────────────────────────────────────┤
│ FILTROS GERAIS (fixos no topo ao rolar)                                    │
│ [Últimos 7 dias ▾] [15/11 – 21/11]  Dias: (D)(S)(T)(Q)(Q)(S)(S)  [Dia|Sem|Mês] │
│ Cobertura do período: ▮▮▮▮▮▮▯ 6/7 dias completos · 1 parcial                │  <- bi_calendario
├──────────────────────────────────────────────────────────────────────────┤
│ A. INDICADORES (cartões)                                                   │  <- bi_resumo_v2
│ [Bruto] [Líquido] [Vendas] [Ticket] [Média/dia] [Descontos e %]            │
│  cada cartão: valor da base de dias completos + "registrado c/ parcial"    │
│  e (opcional) variação vs. período anterior equivalente                    │  <- bi_comparar_periodos
├──────────────────────────────────────────────────────────────────────────┤
│ B. EVOLUÇÃO (linha/colunas)              [métrica ▾] [herdar filtros ⟲]   │  <- bi_serie_v2
│  faturamento, vendas, ticket, descontos; dias sem dados = lacuna (não 0)   │
├───────────────────────────────────────┬──────────────────────────────────┤
│ C. RANKING DE PRODUTOS (barras)       │ D. TABELA DE PRODUTOS             │  <- bi_produtos_v2
│  top N por bruto/qtd/vendas           │  busca, ordenação, paginação,     │
│  clique = seleciona p/ E, F e G       │  participação, preço médio         │
├───────────────────────────────────────┴──────────────────────────────────┤
│ E. EVOLUÇÃO DE PRODUTOS (até 5)   [selecionados: 100 ✕  900 ✕  +]          │  <- bi_produto_serie_v2
├──────────────────────────────────────────────────────────────────────────┤
│ F. HORÁRIOS                                                               │
│  F1 curva do dia (faturamento/vendas/ticket por hora)                     │  <- bi_horarios
│  F2 mapa de calor dia da semana × hora                                    │  <- bi_horarios
│  F3 produtos por horário: [Top N por hora] | [Produtos escolhidos (1–10)]  │  <- bi_produtos_horario_v2 / bi_produto_horarios
├──────────────────────────────────────────────────────────────────────────┤
│ G. COMPARATIVOS                                                            │  <- bi_comparar_periodos
│  modo: [Período anterior] [Mês] [Semana] [Mesmo dia da semana] [Livre A×B] │
│  A: [__/__ – __/__]  B: [__/__ – __/__]   dias: (filtro)   produtos: (até 5)│
│  tabela A | B | diferença | variação  + critério, pares, cobertura, motivo │
└──────────────────────────────────────────────────────────────────────────┘
```

## 2. Filtros

- **Gerais** (topo): período (atalhos aprovados na seção 6; padrão: últimos 7 dias), dias da semana
  (chips; nenhum marcado = todos), agrupamento (dia/semana/mês).
- **Individuais** (por bloco, no ícone ⚙): o bloco pode **substituir** período,
  dias da semana ou agrupamento. Enquanto substituído, aparece um selo
  "Filtro próprio: sextas, out/2026 ⟲" com botão **restaurar** (volta a herdar).
  O critério efetivamente aplicado aparece sempre no rodapé do bloco.
- **Produtos**: a seleção (ranking/tabela) alimenta E, F3 e G; **não** filtra os
  indicadores financeiros gerais (A, B), por não haver metodologia válida.
- Estado dos filtros na URL (link compartilhável) e lembrado por usuário
  (padrão já usado no sistema para filtros persistidos).

## 3. Exibição obrigatória

- Sem dados = "sem dados" (nunca R$ 0); dias parciais e não confirmados
  marcados nos gráficos (faixa/hachura) com legenda.
- Comparativo não comparável: sem %, com o motivo em linguagem simples.
- Critério "média": rótulo "média por dia válido".
- Quantidades sem "un"/"kg".
- Rodapé de cada bloco: período efetivo, dias considerados, cobertura.

## 4. Carregamento

- **Progressivo**: `bi_status` → filtros → A e B (acima da dobra) → demais
  blocos ao entrar na tela (*lazy*, IntersectionObserver).
- **Estados independentes** por bloco (carregando / erro com "tentar de novo" /
  vazio / ok); um erro não derruba o painel.
- **Máximo de 3 chamadas simultâneas** (fila); *cache* por chave
  (RPC + parâmetros) durante a sessão; reaproveitar a mesma resposta entre
  blocos (ex.: `bi_produtos_v2` alimenta C e D; `bi_horarios` alimenta F1 e F2).
- Mudança de filtro: *debounce* de ~300 ms e cancelamento das respostas antigas.
- Volume estimado na abertura: 5 chamadas (status, calendário, resumo, série,
  comparativo); demais sob demanda.

## 5. Responsividade

Desktop: grade de 12 colunas (C+D lado a lado). Tablet: 2 colunas. Celular:
1 coluna, filtros gerais em gaveta, mapa de calor com rolagem horizontal
interna (sem rolagem da página), tabelas com colunas prioritárias.

## 6. Decisões

Aprovadas em 2026-11-25:

- **Recharts** como biblioteca de gráficos (instalação só na implementação autorizada).
- **Variação nos cartões**: automática contra o período anterior equivalente, exibida só com cobertura suficiente (≥ 80% em cada lado) e comparação válida (`comparavel = true`); o usuário pode **desativar** ou **trocar a referência** (mesmo período do mês anterior, semana anterior ou período livre A × B).
- **Atalhos de período**: Hoje, Ontem, Últimos 7 dias, Últimos 30 dias, Semana atual, Semana anterior, Mês atual, Mês anterior e Personalizado. Semana = segunda a domingo. "Últimos 7/30 dias" terminam no último dia completo.
- **Comparação livre** entre períodos escolhidos continua disponível (bloco G e referência livre dos cartões).
- **Dias parciais e sem importação** identificados na faixa de cobertura, nos gráficos (hachura/lacuna, nunca zero) e nos cartões (selo "parcial", sem variação). "Cobertura não confirmada" (24–25/07) tem marcação própria.
- Página única, sem abas, com filtros gerais e individuais.

Pendente: ordem dos blocos e distribuição visual (após análise do mockup).
