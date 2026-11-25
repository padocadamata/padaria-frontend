// BI Gerencial -- modelo de exportação da Tabela de produtos (Excel/PDF),
// no formato de lib/exportacao (mesmo gerador da Escala e do Cartão-Ponto).
//
// Exporta o CONJUNTO FILTRADO INTEIRO (todas as páginas, na ordem escolhida),
// com os mesmos números da tela: faturamento = valor bruto do ITEM, vendas =
// vendas distintas que contêm o código (não somáveis entre produtos),
// quantidade como registrada no G3 (sem unidade). Descontos não aparecem:
// existem só por venda e nunca são atribuídos a produto.

import { intervalo, moeda, nomeDosDias, numero, percentual, quantidade } from './formatos.js';

const n = (v) => (v === null || v === undefined ? null : Number(v));

export function mediaPorDia(produto, cobertura) {
  // Só quando todos os dias com dados são completos (sem parcial no meio):
  // senão o bruto inclui dia parcial e a média ficaria distorcida.
  if (!cobertura || !cobertura.dias_validos || cobertura.dias_com_dados !== cobertura.dias_validos) return null;
  return n(produto.bruto) / cobertura.dias_validos;
}

export function montarExportacaoProdutos({ produtos, cobertura, filtros, busca, ordemRotulo, geradoEm }) {
  const periodoRotulo = intervalo(filtros.de, filtros.ate);
  const diasRotulo = nomeDosDias(filtros.dias);
  const linhasTela = produtos.map((p) => ({
    codigo: p.codigo,
    descricao: p.descricao,
    quantidade: n(p.quantidade),
    vendas: n(p.vendas),
    bruto: n(p.bruto),
    media: mediaPorDia(p, cobertura),
    preco: n(p.preco_medio),
    participacao: n(p.participacao),
    compartilhada: !!p.descricao_compartilhada,
  }));

  const identificacao = [
    ['Período', periodoRotulo],
    ['Dias da semana', diasRotulo],
    ['Dias completos (base itens)', cobertura ? String(cobertura.dias_validos ?? 0) : '—'],
    ['Dias com dados', cobertura ? String(cobertura.dias_com_dados ?? 0) : '—'],
    ['Busca', busca ? busca : '(nenhuma)'],
    ['Ordenação', ordemRotulo],
    ['Faturamento', 'Valor bruto do item; só vendas conciliadas'],
    ['Vendas', 'Vendas distintas que contêm o código (não somar entre produtos)'],
    ['Quantidade', 'Como registrada no G3 (sem unidade)'],
    ['Gerado em', geradoEm],
  ];

  return {
    titulo: 'BI Gerencial · Produtos',
    periodoRotulo,
    nomeArquivo: `bi-produtos_${filtros.de}_a_${filtros.ate}`,
    geradoEm,
    filtros: {},
    pdf: {
      secoes: [
        {
          titulo: `Produtos (${linhasTela.length})`,
          nota: `Dias: ${diasRotulo}${busca ? ` · Busca: ${busca}` : ''} · Ordenação: ${ordemRotulo}`,
          cabecalho: ['Código', 'Descrição', 'Quantidade', 'Vendas', 'Faturamento', 'Média/dia', 'Preço médio', 'Participação'],
          larguras: { 0: 20, 1: 80 },
          colunasTexto: 2,
          linhas: linhasTela.map((l) => [
            l.codigo,
            l.compartilhada ? `${l.descricao} (descrição em mais de um código)` : l.descricao,
            quantidade(l.quantidade),
            numero(l.vendas),
            moeda(l.bruto),
            l.media === null ? '—' : moeda(l.media),
            l.preco === null ? '—' : moeda(l.preco),
            percentual(l.participacao, 2),
          ]),
          vazio: 'Nenhum produto para este filtro.',
        },
      ],
      legenda:
        'Faturamento = valor bruto do item (vendas conciliadas). Vendas = vendas que contêm o código (não somar entre produtos). Quantidade como registrada no G3, sem unidade. Média/dia só quando todos os dias com dados são completos.',
    },
    planilhas: [
      {
        nome: 'Produtos',
        colunas: [
          { titulo: 'Código', tipo: 'texto', largura: 10 },
          { titulo: 'Descrição', tipo: 'texto', largura: 40 },
          { titulo: 'Quantidade', tipo: 'decimal3', largura: 13 },
          { titulo: 'Vendas', tipo: 'numero', largura: 10 },
          { titulo: 'Faturamento (R$)', tipo: 'decimal', largura: 16 },
          { titulo: 'Média por dia (R$)', tipo: 'decimal', largura: 16 },
          { titulo: 'Preço médio (R$)', tipo: 'decimal', largura: 15 },
          { titulo: 'Participação', tipo: 'percentual', largura: 13 },
          { titulo: 'Descrição em mais de um código', tipo: 'texto', largura: 14 },
        ],
        linhas: linhasTela.map((l) => [l.codigo, l.descricao, l.quantidade, l.vendas, l.bruto, l.media, l.preco, l.participacao, l.compartilhada ? 'sim' : '']),
      },
      {
        nome: 'Identificação',
        semFiltro: true,
        colunas: [
          { titulo: 'Campo', tipo: 'texto', largura: 28 },
          { titulo: 'Valor', tipo: 'texto', largura: 60 },
        ],
        linhas: identificacao,
      },
    ],
  };
}
