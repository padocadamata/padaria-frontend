# BI Gerencial — exportação geral (Excel e PDF) e acesso rápido

Melhorias pós-publicação (2026-11-25), **homologadas e publicadas em
produção** no commit "feat: adiciona exportacao geral do BI e acesso rapido
no Dashboard". Sem migration, sem RPC nova, sem dependência nova. A exportação individual da Tabela de produtos continua
igual (mesmo botão, mesmo arquivo `bi-produtos_*`).

## Onde

- Cabeçalho do `/bi`: botões **Exportar Excel** e **Exportar PDF** (componente
  oficial `Button`, ícone `download`) na linha do título; no celular, abaixo do
  título em largura total. Durante a geração: botões bloqueados, texto
  "Coletando dados (n/N)… / Montando …"; cliques repetidos são ignorados.
- Dashboard → **Acesso rápido**: atalho "BI Gerencial" (mesmo ícone `chart` do
  menu lateral, rota `/bi`) IMEDIATAMENTE APÓS Financeiro (sem Financeiro
  visível, no fim), só para `proprietario_admin` ativo — mesma regra do menu
  (`atalhosDashboard` em `lib/nav/navegacao.js`). A grade do Acesso rápido usa
  linhas de altura igual (`grid-auto-rows: 1fr`), então o atalho numa 2ª linha
  tem as mesmas dimensões dos demais. A personalização do Dashboard (widgets)
  não afeta o Acesso rápido.

## Solução técnica

1. **Registro por bloco** (`useRegistroExportacao`, `components/bi/contexto.js`):
   cada bloco publica, a cada render, os filtros efetivos, os parâmetros da
   tela (métrica, ordenação, Top N, indicador, modo, períodos A/B…) e os
   argumentos EXATOS das consultas (os mesmos do `useConsulta`, sem a condição
   de visibilidade).
2. **Instantâneo no clique**: cópia profunda do registro + filtros gerais +
   seleção + cores (`capturarInstantaneo`). Mudar os filtros durante a geração
   não afeta o arquivo.
3. **Coleta** (`coletarDadosExportacao`): as consultas registradas, pelo MESMO
   cliente do painel (cache + fila de 3 simultâneas): o que já foi carregado
   não é consultado de novo; blocos ainda fora da tela são consultados agora.
   Tabela: todas as páginas (lotes de 500), na ordem/busca da tela.
4. **Modelo** (`montarExportacaoGeral`, `lib/bi/exportacaoGeral.js`): linhas
   montadas pelas MESMAS funções de `lib/bi/modelos.js` usadas pelos gráficos
   e tabelas (pontosSerie, juntarSeries, analisarHorarios, escalaCalor,
   segmentosParticipacao, curvasProdutoHorario, topPorHora, compararValores,
   situacaoVariacaoCartao, linhaComparativoGeral). As duas últimas passaram a
   ser usadas também pela tela (Indicadores e Comparativo) — uma única regra.
5. **Geração**: Excel pelo gerador próprio (`lib/exportacao/xlsx.js`) e PDF
   pelo renderizador do sistema (`lib/exportacao/pdf.js`, jsPDF carregado só
   no clique), com gráficos VETORIAIS desenhados a partir dos mesmos dados
   (`lib/exportacao/graficosPdf.js`) — não é captura de tela. O código da
   exportação também só é carregado no clique (import dinâmico).
6. **Extensões aditivas** (sem uso, a saída é idêntica à de antes — testes da
   Escala e do Cartão-Ponto inalterados):
   - xlsx: `notas` acima da tabela (cabeçalho, congelamento e autofiltro
     acompanham) e célula com tipo próprio `{ valor, tipo }`;
   - pdf: seções com `texto`, `grafico` (com tabela ao lado opcional),
     `numerosADireita` e `modelo.linhaCabecalho`.

## Regras preservadas

Sem dados nunca vira zero (célula vazia; "sem dados" no PDF); dias parciais,
sem importação, com pendências e cobertura não confirmada sinalizados e fora
das médias; período pré-operacional excluído; variações só quando a
comparação é válida (totais só no critério pareado); participação pelo
denominador de todos os itens conciliados (proporções pelos valores em R$);
descontos nunca atribuídos a produtos; códigos G3 separados; quantidades sem
unidade; sem custo, lucro ou margem; autorização: as RPCs continuam exigindo
`proprietario_admin` ativo.

**Bloco com erro** (ou referência B indisponível): o arquivo diz isso no topo
da aba do bloco (`SITUAÇÃO: ERRO/PARCIAL`), na aba "Filtros e Cobertura", na
capa do PDF ("exportação INCOMPLETA") com o quadro "Situação dos blocos", e
na mensagem ao lado dos botões. Blocos "sem dados" ou "indisponível" (ex.:
nenhum produto selecionado, período acima do limite) refletem o próprio
painel e também são declarados.

## Excel — `bi-gerencial_<de>_a_<ate>.xlsx`

Toda aba de bloco começa com: título, filtros efetivos do bloco (período,
dias, agrupamento, referência B, "Filtros gerais" ou "Filtro próprio do
bloco: …"), parâmetros (métrica/ordenação/indicador/modo) e data de geração;
cabeçalho congelado, autofiltro, larguras ajustadas; R$ em `#,##0.00`,
quantidades em `#,##0.###`, percentuais em `0.00%`, datas como data.

| Aba | Conteúdo |
|---|---|
| Resumo Gerencial | Indicadores dos cartões + extras: Valor (A), Unidade, Referência (B), Diferença, Variação (só válida), Observação; dias completos; bruto registrado (com parciais). Notas: período, referência/critério/cobertura A-B, cobertura, dias fora das médias, avisos. |
| Evolução do Faturamento | Série A e B (uma linha por dia/semana/mês): situação, dias completos/no filtro, médias diárias (bruto, líquido, vendas, ticket, descontos), registrados, e para a métrica do gráfico: B pareado, diferença, variação. |
| Média por Dia da Semana | A e B por dia da semana (média/dia e dias completos), diferença, variação, situação. |
| Ranking de Produtos | Top N na ordenação escolhida: posição, código, descrição, faturamento, quantidade, vendas, participação, selecionado. |
| Participação | 5 maiores + demais (R$ e %), selecionados, total (denominador). |
| Produtos | Tabela de produtos INTEIRA (todas as páginas), mesmas colunas da exportação individual. |
| Evolução dos Produtos | Por código e período: situação, dias, médias/dia (quantidade, vendas, faturamento) e totais. |
| Vendas por Horário | Por hora: A e B (faturamento médio/dia, vendas médias/dia, ticket, dias), diferença e variação da métrica exibida. |
| Mapa de Calor | Dia da semana × hora: dias completos, faturamento médio/dia, vendas médias/dia, ticket (líquido ÷ vendas), situação (sem dados / sem vendas). |
| Produtos por Horário | Modo da tela: top 3 por hora OU produtos escolhidos (A e B): % do produto, faturamento médio/dia na hora, vendas, % no horário, dias. |
| Comparativos Gerais | Indicador, A, B, diferença, variação, observação (critério, cobertura, comparabilidade nas notas). |
| Comparativos por Produto | A/dia, B/dia, diferença, variação, preço médio A/B, participação A/B, comparável/motivo. |
| Filtros e Cobertura | Filtros gerais, última importação, cobertura e, por bloco: período, dias, agrupamento, referência, origem dos filtros, parâmetros, situação na exportação. |
| Calendário | Cada dia do período geral (até 400 dias): situação de vendas/itens, hora limite, entra nas médias, registrados (vazios em dia sem registro), avisos. |

## PDF — `bi-gerencial_<de>_a_<ate>.pdf` (A4 paisagem)

Cabeçalho em todas as páginas (Padoca da Mata · BI Gerencial · período ·
última importação · dados completos até · parcial) e rodapé com paginação.

1. Capa: período analisado, última importação, filtros gerais, produtos
   selecionados, situação da exportação (completa / INCOMPLETA + quadro).
2. Indicadores gerais: cobertura, dias fora das médias, referência/critério,
   avisos, 6 cartões (com selo "parcial" quando for o caso) e tabela detalhada.
3. Evolução do faturamento (linhas A/B, faixas por situação do dia) e média
   por dia da semana (colunas A/B).
4. Ranking (tabela) e participação (rosca com total no centro + legenda).
5. Evolução dos produtos selecionados (cores fixas por produto), vendas por
   horário (colunas A/B).
6. Mapa de calor (indicador da tela; hachura = sem dados; tracejado = não se
   aplica) e produtos por horário (tabela top 3 ou linhas por produto).
7. Comparativos geral e por produto.
8. Filtros e parâmetros de cada bloco (com a situação).
9. Anexo: detalhamento completo dos produtos (cabeçalho repetido por página).

Cada seção traz, logo abaixo do título, os filtros efetivos do bloco.

## Desempenho observado (homologação local, dados fictícios)

Com o painel carregado: Excel 0,1–0,2 s, PDF 0,2–0,3 s. Período inteiro
(141 dias, blocos fora da tela ainda não carregados): Excel 3,4 s (inclui as
consultas que faltavam) e PDF 0,2 s em seguida (cache). Memória JS: +2 a +16 MB
durante a geração. Arquivos de 70 KB a 560 KB.
