# BI Gerencial — ajustes finais da homologação visual (2026-11-25)

Estrutura, ordem dos blocos, identidade visual, menu lateral oficial e regras
das migrations 0083/0084 **inalteradas**. Nenhuma migration nova, nenhuma RPC
nova: tudo sai dos contratos homologados (`contratos-rpc.md`).

| # | Ajuste | Onde | Como |
|---|--------|------|------|
| 1 | Atualizar dados | `Topo.js` (`BotaoAtualizar`), `PainelBi.js` (`useAtualizacao`), `lib/bi/consultas.js` | Relê `bi_status` com `ignorarCache`, depois `invalidar()` (cache descartado + nova "geração" nas chaves): todos os blocos montados consultam de novo com os mesmos filtros e a mesma seleção. Botão bloqueado durante a atualização (sem chamadas duplicadas), ícone girando, "atualizado às hh:mm:ss". Não inicia importação do G3. |
| 2 | Filtros fixos compactos | `Topo.js` (`useBarraFixa`), `bi.module.css` | Controles mais baixos (34 px). Quando a barra gruda no topo (desktop): uma linha de ~44 px, rótulos visualmente ocultos (controles mantêm `aria-label`/`title`), "Restaurar" vira ícone. Letras dos dias inalteradas. `scroll-margin-top` nos blocos. Celular: botão "Filtros" + resumo, como antes. |
| 3 | Nomenclatura dos atalhos | `lib/bi/datas.js`, `Topo.js` | "Últimos 7 dias" / "Últimos 30 dias". Continuam terminando no último dia com importação completa; contam dias corridos; lacunas ficam no período (nunca compensadas). Nota discreta na faixa de cobertura + dica no seletor. |
| 4 | Tooltips e legendas | `Graficos.js` (`LinhaDica`, `ComparacaoDica`, `notasDasMarcas`), `Faturamento.js`, `Produtos.js`, `Horarios.js`, `lib/bi/modelos.js` | Data + dia da semana / horário / produto + código G3, valor exato de A e B, situação da cobertura de cada lado (parcial mostra o registrado até a hora, fora das médias), diferença absoluta e variação **só com os dois lados válidos** (`compararValores`); B = 0 → sem variação percentual. Faixas e legendas separadas para parcial, cobertura não confirmada, sem importação e sem operação. |
| 5 | Rosca da participação | `Produtos.js` (`ParticipacaoFaturamento`), `Graficos.js` (`GraficoRosca`) | Recharts `PieChart`. Fatias = valores monetários originais (bruto ÷ total da RPC, não a participação arredondada); "Demais" = total − 5 maiores. Total no centro. Denominador fixo (não muda com a seleção). Selecionado mantém a própria cor; não selecionado usa tom secundário (`PALETA_SECUNDARIA`). |
| 6 | Top 5/10/20 | `Produtos.js` (`RankingProdutos`), `lib/bi/filtros.js` | Seletor no cabeçalho do ranking; padrão Top 10; persistido. A RPC ordena todo o conjunto elegível e só então limita. |
| 7 | Seleção automática inicial | `contexto.js`, `lib/bi/filtros.js` | Sem seleção registrada (`selecaoIniciada = false` e nenhum código salvo): os 3 códigos G3 de maior faturamento do período geral (mesma consulta do ranking padrão). Qualquer escolha manual — inclusive remover todos — encerra a seleção automática; trocar período/filtros ou atualizar não a substitui. |
| 8 | Registros por página | `Produtos.js` (`TabelaProdutos`) | 10/20/50/100, padrão 20, persistido. Busca e ordenação continuam na RPC sobre todo o conjunto filtrado. |
| 9 | Campos de busca | `bi.module.css` | Busca da tabela com 300 px; campo "+ Adicionar por código ou descrição" com 260 px; 100% no celular. |
| 10 | Indicadores do mapa de calor | `Horarios.js` (`MapaCalor`), `lib/bi/modelos.js` (`analisarHorarios`, `escalaCalor`) | Faturamento médio (bruto da hora ÷ dias completos do dia da semana), vendas médias (vendas ÷ dias completos), ticket médio (líquido ÷ vendas da hora — razão dos totais). Escala, legenda com mínimo/máximo, unidade e tooltip por indicador. Calculável com `bi_horarios` (0083) — sem limitação. |
| 11 | Ausência × zero | todos os blocos | Mapa de calor: hachura para "sem dados" (dia da semana sem dia completo ou fora do filtro), contorno tracejado para "ticket não se aplica" (hora sem vendas), escala só para valores válidos; dia completo sem vendas aparece como zero real e é citado na faixa de cobertura; tooltips nomeiam cada situação. |

## Persistência

Novos campos em `FILTROS_BI` (mesma versão 1; campos ausentes voltam ao padrão):
`selecaoIniciada`, `rankingTop`, `porPagina`.

## Homologação local

O cliente falso da homologação passou a emitir um token com `session_id`
(um por login simulado), para que os filtros persistidos por sessão funcionem
como em produção. `capturar.mjs` abre um login novo a cada cenário, salvo
`manterSessao`. Roteiro com 20 cenários (`roteiro.mjs`).

## Refinamentos visuais definitivos (2026-11-25)

Só disposição (CSS e marcação); cálculos, regras, filtros e dados inalterados.

1. **Comparativo entre períodos** (`Comparativo.js`): comparativo geral em cima
   e produtos selecionados embaixo, ambos com a largura total do bloco, sob o
   mesmo cabeçalho (modos, períodos A/B, critério e cobertura). Produto numa
   coluna larga com `cód. G3` na mesma linha (sem quebra no desktop). Mesmos
   indicadores, valores completos, percentuais e critérios. No celular os
   botões de modo quebram em linhas (sem cortar o texto) e as tabelas rolam
   dentro do bloco, sem rolagem horizontal da página.
2. **Participação no faturamento** (`Produtos.js`): rosca centralizada no alto
   (232 px, total no centro) e legenda embaixo em largura total, uma linha por
   produto (identificação + código · faturamento · participação), com a marca
   "selecionado". Cores, tooltips, filtro do bloco e denominador inalterados.
   Altura do quadro acompanha o ranking ao lado.

Cenários novos: `18_participacao_e_comparativo_desktop` e
`19_participacao_e_comparativo_celular` (com recortes PNG só dos blocos;
`capturar.mjs` aceita `recortes: { sufixo: seletor }`).
