// Geradores de relatórios do G3 FICTÍCIOS (mesmo layout dos originais, dados
// inventados) para os testes da Central de Importações (migration 0081).
// O repositório é público: NENHUM dado real de venda entra aqui.
//
// Cada função devolve as linhas da planilha como arrays de células (texto,
// número ou null), exatamente como o leitor do navegador entrega -- já com a
// linha de cliente na forma anônima do G3.

export const CNPJ = '65214016000142';
export const RAZAO = 'PADOCA DA MATA LTDA';
export const EMPRESAS = 'PADOCA DA MATA - PADOCA DA MATA LTDA';
export const EMPRESA_COLUNA = 'PADOCA DA MATA';
export const CLIENTE_ANONIMO = 'Cliente: Consumidor Não Identificado - CPF/CNPJ: Não informado';
export const CONSUMIDOR = 'Consumidor Não Identificado';

const centavos = (v) => Math.round(v * 100);
const reais = (c) => Math.round(c) / 100;
const soma = (lista) => reais(lista.reduce((s, v) => s + centavos(v), 0));

// '2026-06-03' -> '03/06/2026'; '2026-06-03 12:29' -> '03/06/2026 12:29'
export function br(iso) {
  const [data, hora] = iso.split(' ');
  const [a, m, d] = data.split('-');
  return hora ? `${d}/${m}/${a} ${hora}` : `${d}/${m}/${a}`;
}

export const COLUNAS_VPC = ['Produto', 'Código', 'Nº Pedido', 'Data Emissão', 'Qtd.', 'Desconto (R$)', 'Valor Total (R$)'];
export const COLUNAS_FAT = ['Cód.', 'Cliente', 'Empresa', 'Data', 'Prod. (R$)', 'Acres. It. (R$)', 'Desc. It. (R$)',
  'Subtotal (R$)', 'Acres. Rat. (R$)', 'Desc. Rat. (R$)', 'Taxa Serv. (R$)', 'Líquido (R$)'];
export const COLUNAS_VP = ['Ano', 'Mês', 'Dia', 'Percentual (%)', 'Venda (R$)', 'Custo (R$)', 'Acréscimo (R$)',
  'Desconto (R$)', 'Líq. s/ Taxa (R$)', 'Taxa Serv. (R$)', 'Ganho (R$)', 'Markup (%)', 'Markdown (%)'];

// Vendas_ProdCliente. itens: [{ produto, codigo, numero, data:'AAAA-MM-DD', qtd, desconto?, valor }]
export function vendasProdutoCliente({
  inicio, fim, gerado, itens, filtrosExtras = [], situacoes = 'FINALIZADO', cnpj = CNPJ, razao = RAZAO,
  cliente = CLIENTE_ANONIMO, ajusteSubtotal = 0, ajusteTotal = 0, titulo = 'VENDAS DE PRODUTOS POR CLIENTE',
}) {
  const subtotal = reais(centavos(soma(itens.map((i) => i.valor))) + centavos(ajusteSubtotal));
  return [
    [titulo],
    [razao],
    [cnpj],
    [`Gerado em: ${br(gerado)}`, 'Usuário: PADOCA DA MATA'],
    [],
    ['Filtros Utilizados:'],
    ['Período', `${br(inicio)} a ${br(fim)}`],
    ...filtrosExtras,
    ['Situações', situacoes],
    [],
    [cliente],
    COLUNAS_VPC,
    ...itens.map((i) => [i.produto, String(i.codigo), String(i.numero), br(i.data), i.qtd, i.desconto ?? 0, i.valor]),
    ['SUBTOTAL DO CLIENTE', null, null, null, null, null, subtotal],
    [],
    [],
    ['Resumo / Totais'],
    ['Total Geral de Vendas', reais(centavos(subtotal) + centavos(ajusteTotal))],
  ];
}

// FaturamGeral. vendas: [{ numero, dataHora:'AAAA-MM-DD HH:MM', prod, acrescimoItem?, descontoItem?,
// acrescimoRateado?, descontoRateado?, taxa?, liquido? (calculado se omitido) }]
export function faturamentoGeral({
  inicio, fim, gerado, vendas, empresas = EMPRESAS, empresaColuna = EMPRESA_COLUNA, ajusteRodape = {},
  cliente = CONSUMIDOR, filtrosExtras = [],
}) {
  const linhas = [...vendas]
    .sort((a, b) => b.numero - a.numero)
    .map((v) => {
      const ai = v.acrescimoItem ?? 0;
      const di = v.descontoItem ?? 0;
      const ar = v.acrescimoRateado ?? 0;
      const dr = v.descontoRateado ?? 0;
      const tx = v.taxa ?? 0;
      const sub = v.subtotal ?? reais(centavos(v.prod) + centavos(ai) - centavos(di));
      const liq = v.liquido ?? reais(centavos(sub) + centavos(ar) - centavos(dr) + centavos(tx));
      return [v.numero, cliente, empresaColuna, br(v.dataHora), v.prod, ai, di, sub, ar, dr, tx, liq];
    });
  const col = (i) => soma(linhas.map((l) => l[i]));
  const totalLiquido = col(11);
  const r = {
    Subtotal: col(7),
    Descontos: reais(centavos(col(6)) + centavos(col(9))),
    'Acréscimos': reais(centavos(col(5)) + centavos(col(8))),
    'Taxa de Serviço': col(10),
    'Total Líquido': totalLiquido,
    Vendas: linhas.length,
    'Ticket Médio': linhas.length ? Math.round((totalLiquido / linhas.length) * 100) / 100 : 0,
    ...ajusteRodape,
  };
  return [
    ['RELATÓRIO DE FATURAMENTO GERAL'],
    ['G3 ERP'],
    [`Gerado em: ${br(gerado)}`, 'Usuário: PADOCA DA MATA'],
    [],
    ['Filtros Utilizados:'],
    ['Período', `${br(inicio)} a ${br(fim)}`],
    ['Empresas', empresas],
    ...filtrosExtras,
    [],
    COLUNAS_FAT,
    ...linhas,
    [],
    ['Resumo / Totais'],
    ...Object.entries(r).map(([k, v]) => [k, v]),
  ];
}

// Vendas_Periodo (DIÁRIO). dias: [{ dia:'AAAA-MM-DD', venda, custo?, acrescimo?, desconto?, liquido?, taxa? }]
export function vendasPeriodo({ inicio, fim, gerado, dias, agrupado = 'DIÁRIO', empresas = EMPRESAS, ajusteRodape = {} }) {
  const linhas = [...dias]
    .sort((a, b) => a.dia.localeCompare(b.dia))
    .map((d) => {
      const [a, m, dd] = d.dia.split('-').map(Number);
      const custo = d.custo ?? reais(centavos(d.venda) / 2);
      const liq = d.liquido ?? d.venda;
      const tx = d.taxa ?? 0;
      const ganho = d.ganho ?? reais(centavos(liq) + centavos(tx) - centavos(custo));
      return [a, m, dd, 0.5, d.venda, custo, d.acrescimo ?? 0, d.desconto ?? 0, liq, tx, ganho, 100, 0];
    });
  const col = (i) => soma(linhas.map((l) => l[i]));
  const r = {
    'Total Vendas': col(4),
    'Total Custo': col(5),
    'Total Acréscimo': col(6),
    'Total Desconto': col(7),
    'Total Líq. s/ Taxa': col(8),
    'Total Taxa Serv.': col(9),
    'Total Ganho': col(10),
    ...ajusteRodape,
  };
  return [
    ['RELATÓRIO DE VENDAS POR DIA/MÊS/ANO'],
    ['G3 ERP'],
    [`Gerado em: ${br(gerado)}`, 'Usuário: PADOCA DA MATA'],
    [],
    ['Filtros Utilizados:'],
    ['Período', `${br(inicio)} a ${br(fim)}`],
    ['Empresas', empresas],
    ['Agrupado por', agrupado],
    [],
    COLUNAS_VP,
    ...linhas,
    [],
    ['Resumo / Totais'],
    ...Object.entries(r).map(([k, v]) => [k, v]),
  ];
}

// Cenário coerente entre os 3 relatórios a partir de vendas completas:
// [{ numero, dataHora, itens:[{ produto, codigo, qtd, valor }], descontoRateado? }]
export function cenario(vendas) {
  const itens = [];
  const fat = [];
  const porDia = new Map();
  for (const v of vendas) {
    const data = v.dataHora.slice(0, 10);
    for (const i of v.itens) itens.push({ ...i, numero: v.numero, data });
    const prod = soma(v.itens.map((i) => i.valor));
    const dr = v.descontoRateado ?? 0;
    fat.push({ numero: v.numero, dataHora: v.dataHora, prod, descontoRateado: dr });
    const d = porDia.get(data) || { dia: data, venda: 0, liquido: 0 };
    d.venda = reais(centavos(d.venda) + centavos(prod));
    d.liquido = reais(centavos(d.liquido) + centavos(prod) - centavos(dr));
    porDia.set(data, d);
  }
  itens.sort((a, b) => a.produto.localeCompare(b.produto) || a.numero - b.numero);
  return { itens, fat, dias: [...porDia.values()] };
}

// Gera N vendas fictícias determinísticas (para volume/desempenho).
export function vendasEmMassa({ quantidade, inicio = '2026-06-01', dias = 30, itensPorVenda = 3, primeiroNumero = 1 }) {
  const base = new Date(`${inicio}T12:00:00Z`);
  const produtos = Array.from({ length: 40 }, (_, k) => ({ produto: `PRODUTO FICTICIO ${String(k + 1).padStart(2, '0')}`, codigo: 100 + k, preco: 2 + (k % 13) * 1.5 }));
  const vendas = [];
  for (let n = 0; n < quantidade; n += 1) {
    const dia = new Date(base.getTime() + Math.floor((n * dias) / quantidade) * 86400000).toISOString().slice(0, 10);
    const minuto = 6 * 60 + (n % 840);
    const hora = `${String(Math.floor(minuto / 60)).padStart(2, '0')}:${String(minuto % 60).padStart(2, '0')}`;
    const itens = [];
    for (let k = 0; k < itensPorVenda; k += 1) {
      const p = produtos[(n * 7 + k * 3) % produtos.length];
      const qtd = 1 + ((n + k) % 3);
      itens.push({ produto: p.produto, codigo: p.codigo, qtd, valor: Math.round(p.preco * qtd * 100) / 100 });
    }
    vendas.push({ numero: primeiroNumero + n, dataHora: `${dia} ${hora}`, itens });
  }
  return vendas;
}
