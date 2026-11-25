# BI Gerencial — contratos das RPCs (0083 + 0084)

Referência para o frontend da página única `/bi`. Todas as RPCs são **somente
leitura**, exigem **proprietario_admin ativo** (senão erro `42501`) e validam
as entradas com erro `22023` (sem *fallback* silencioso). Datas em
`YYYY-MM-DD`; fuso `America/Sao_Paulo`; dias da semana `0 = domingo … 6 = sábado`.

## Situação em produção (2026-11-25)

- **0083** aplicada e versionada (`7baef66`).
- **0084** (`supabase/migrations/0084_bi_complementar.sql`, SHA-256
  `24b0c94e2a1e3eab05bd1923218be84bccd3f96d2944c8cf5301abe13bd85b6f`) **aplicada
  manualmente no Supabase de produção e homologada** — não reaplicar:
  - PRE/POS aprovadas: 9 funções novas com as assinaturas previstas; 22 funções
    `bi_*`; 16 RPCs públicas para `authenticated` (todas exigem admin); funções
    internas sem execução direta; 13 funções da 0083 intactas (MD5 da guarda
    `5ee708f0dfe2d632233c4fe72cb5ad9f`); retrato do schema sem as funções novas
    idêntico antes/depois (328 funções, 105 tabelas, 194 policies);
  - validação funcional: 19 verificações (17 OK, 2 INFO, 0 FALHA); equivalência
    v1 × v2 aprovada;
  - segurança: `VALIDACAO_SEGURANCA: APROVADA` (admin ativo 16/16 permitidas;
    admin inativo simulado, perfil operacional, authenticated sem usuário e anon
    16/16 bloqueadas; 5 funções internas bloqueadas). Limitação conhecida: o
    admin inativo é simulado dentro da transação (nenhum usuário foi criado);
  - desempenho: 17/17 consultas abaixo de 300 ms (máx. 142,1 ms); sem novos
    índices.

## Regras comuns (não mudam entre as RPCs)

| Regra | Comportamento |
|---|---|
| Início oficial | `bi_status().data_inicio_operacao` (09/07/2026). Antes disso: pré-operação, fora dos indicadores. |
| Sem cobertura | valores **nulos**, nunca zero. Zero só em dia coberto sem vendas (`completo_sem_vendas`, entra na média). |
| `registrado` | dias com dados importados (completo, completo_sem_vendas, parcial, com_pendencias). |
| `base_media` / médias / comparativos | **só dias completos** (completo, completo_sem_vendas). |
| Bases separadas | `vendas` (FaturamGeral) para faturamento; `itens` (FaturamGeral + Vendas_ProdCliente) para produtos. |
| Produtos | só vendas conciliadas; valor **bruto do item**; identificação pelo **código G3** (descrições iguais não são somadas). |
| Ticket | líquido / vendas. |
| Descontos | `desconto_item + desconto_rateado` por **venda**; nunca atribuídos a produto. |
| Unidade | quantidades são as **registradas**; o painel **não** deve escrever "un" ou "kg" sem confirmação (decimal não prova unidade). |
| Filtro de dias da semana (`p_dias_semana`) | `null` = todos; 1–7 valores 0..6 (repetidos são ignorados). Os dias fora do filtro saem da **base**: numerador, denominador, médias, cobertura e contagens. |

## RPCs da 0083 (homologadas; contrato congelado)

`bi_status`, `bi_calendario`, `bi_resumo`, `bi_serie`, `bi_produtos`,
`bi_produto_serie`, `bi_horarios` (já tem `p_dias_semana`), `bi_produtos_horario`,
`bi_comparar`. Continuam disponíveis e idênticas. Para o painel novo, usar as
versões `_v2` abaixo (com `p_dias_semana = null` devolvem exatamente os mesmos
valores, mais campos novos) e manter `bi_status`, `bi_calendario`, `bi_horarios`.

## RPCs da 0084

### `bi_resumo_v2(p_de, p_ate, p_dias_semana = null) → jsonb`
Contrato de `bi_resumo` + :
- `filtro`: `{ dias_semana, dias_calendario, dias_fora_filtro }`
- `registrado.percentual_descontos`
- `base_media.descontos`, `base_media.media_diaria_descontos`, `base_media.percentual_descontos`
- `motivo = 'nenhum_dia_no_filtro'` quando nenhum dia do período cai no filtro.
Limite: 1830 dias. Período fora: `motivo` `periodo_pre_operacao` / `periodo_futuro`.

### `bi_serie_v2(p_de, p_ate, p_agrupamento, p_dias_semana = null) → table`
Colunas de `bi_serie` + `descontos_media`, `media_diaria_bruto`,
`media_diaria_liquido`, `media_diaria_vendas`, `media_diaria_descontos`,
`percentual_descontos` (registrado), `percentual_descontos_media` (base),
`dias_fora_filtro`. `dia` (até 400 dias): só os dias do filtro geram linha.
`semana`/`mes`: os dias fora do filtro saem de todas as contagens
(`dias_calendario + dias_fora_filtro` = dias do agrupamento).

### `bi_produtos_v2(p_de, p_ate, p_codigos, p_busca, p_ordem, p_direcao, p_limite, p_deslocamento, p_dias_semana = null) → jsonb`
Contrato de `bi_produtos` + `filtro`. O filtro de dias define a base do
período (inclusive o **denominador da participação**); códigos, busca, ordem,
página e limite continuam sem alterar o denominador.

### `bi_produto_serie_v2(p_codigos[1..5], p_de, p_ate, p_agrupamento, p_dias_semana = null) → table`
Colunas de `bi_produto_serie` + `quantidade_media_dia`, `vendas_media_dia`,
`bruto_media_dia` (por dia válido da base itens) e `dias_fora_filtro`.

### `bi_produtos_horario_v2(p_de, p_ate, p_hora_inicio, p_hora_fim, p_ordem, p_limite, p_dias_semana = null) → table`
Colunas de `bi_produtos_horario` + `media_quantidade_dia`, `media_vendas_dia`,
`media_bruto_dia`.

### `bi_produto_horarios(p_codigos[1..10], p_de, p_ate, p_dias_semana = null) → table`
Qualquer código G3, **independente do ranking**. Só dias completos da base
itens; soma do **item** (nunca o total da venda).

| Linha | `dia_semana` | `hora` |
|---|---|---|
| célula do mapa de calor | 0..6 | 0..23 |
| curva do dia (todos os dias do filtro) | `null` | 0..23 |
| total por dia da semana | 0..6 | `null` |
| total do produto | `null` | `null` |

Colunas: `codigo, descricao, quantidade, vendas, bruto, dias_considerados,
media_quantidade_dia, media_vendas_dia, media_bruto_dia,
participacao_no_produto` (linha ÷ total do produto na linha-total
correspondente), `participacao_no_horario` (produto ÷ todos os itens da mesma
célula), `bruto_todos_itens`. Sem dia válido: nenhuma linha. Manhã/tarde:
somar as horas no painel (médias = soma ÷ `dias_considerados`).

Denominadores: `participacao_no_produto` — célula dia × hora ÷ total do produto
**naquele dia da semana**; curva por hora e total por dia da semana ÷ **total
geral do produto** no recorte. `participacao_no_horario` = valor do produto ÷
`bruto_todos_itens` (**todos os itens** vendidos na mesma célula). `vendas` =
vendas distintas que contêm **aquele código**: não somar entre produtos (uma
venda com 2 códigos conta nos dois). A grade é **completa**: todo código ×
dia da semana com dia válido × 24 horas aparece, com 0 onde não vendeu;
`participacao_no_produto` fica nula se o produto não vendeu no recorte.
Comparar a distribuição horária de um produto entre dois períodos: duas
chamadas (uma por período) e comparar `participacao_no_produto` ou `media_*_dia`
hora a hora (nunca os totais, se as durações forem diferentes).

### `bi_comparar_periodos(p_a_de, p_a_ate, p_b_de, p_b_ate, p_dias_semana = null, p_codigos[1..5] = null, p_criterio = 'auto') → jsonb`
A = período analisado; B = referência; variação = (A − B) ÷ B.

| Critério | Quando | O que é comparado |
|---|---|---|
| `pareado` | mesma quantidade de dias (do filtro) nos dois lados | k-ésimo dia de A com o k-ésimo de B; par só conta se os 2 dias são completos; **totais e médias** |
| `media` | quantidades diferentes (ou forçado) | cada lado com seus dias completos; **só grandezas normalizadas** (médias diárias, ticket, % de desconto, preço médio, participação); totais exibidos **sem** variação |
| `auto` (padrão) | — | `pareado` se as quantidades forem iguais; senão `media` |

Resposta: `criterio_solicitado`, `criterio`, `filtro`, `cobertura_minima`,
`avisos` (`fim_a_ajustado_hoje`, `fim_b_ajustado_hoje`, `periodos_sobrepostos`,
`pares_com_dias_da_semana_diferentes` — pareado por posição juntou dias da semana distintos,
`quantidades_de_dias_diferentes` — A e B têm durações diferentes: só médias são comparadas),
`periodos.{a,b}` (`de_solicitado, ate_solicitado, de, ate, dias_filtrados, dias_fora_filtro`),
`pareamento` (`pares, pares_validos_vendas, pares_validos_itens, mesmo_dia_semana, pares_dias_semana_diferentes`, só no pareado),
`geral` (base vendas) e `produtos[]` (base itens), cada um com
`comparavel, motivo, a, b, diferencas, variacoes, base_zero` (+ `dias_excluidos` no geral).
Lado: `dias_filtrados, dias_considerados, cobertura, bruto, liquido, descontos,
vendas, ticket, media_diaria_*, percentual_descontos` (produto: `quantidade,
vendas, bruto, media_diaria_*, preco_medio, participacao`).

`motivo` (quando `comparavel = false`): `periodo_a_futuro`, `periodo_b_futuro`,
`nenhum_dia_no_filtro`, `quantidade_de_dias_diferente` (pareado forçado),
`periodo_a_pre_operacao`, `periodo_b_pre_operacao`, `contem_pre_operacao`,
`sem_dados`, `cobertura_insuficiente` (< `cobertura_minima`, 0,80, em algum lado).

**Receitas** (o painel calcula as datas a partir de `bi_status`):
- mês atual × anterior: A = 1º do mês … último dia completo; B = mesmo intervalo de dias do mês anterior (reproduz `bi_comparar('mes')`);
- uma segunda × a segunda anterior: A = B = 1 dia, B = A − 7;
- um domingo × os 4 domingos anteriores: A = o dia; B = [dia − 28, dia − 7], `p_dias_semana = [0]` (critério média);
- sextas de dois meses: A = mês X, B = mês Y, `p_dias_semana = [5]`;
- fins de semana: `p_dias_semana = [0, 6]`;
- dias úteis: `p_dias_semana = [1,2,3,4,5]`.

## Regras de exibição (obrigatórias no painel)
- `comparavel = false` → **não** mostrar variação percentual; mostrar o `motivo`.
- Lado sem dia válido → valores `null`: mostrar "sem dados", nunca R$ 0.
- Sempre mostrar os períodos **efetivamente** comparados, os dias pareados/considerados e a cobertura.
- `criterio = 'media'` → rotular como "média por dia válido".
- `base_zero = true` → variação nula por divisão por zero: explicar.
- Filtro de produto **não** se aplica aos indicadores financeiros gerais.
- Não usar custo/ganho do G3.
