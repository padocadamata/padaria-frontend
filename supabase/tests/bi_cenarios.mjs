// Cenários FICTÍCIOS do BI Gerencial (0083) sobre a Central de Importações
// do G3 (0081/0082). Os dados entram pelo fluxo REAL de importação (iniciar,
// enviar, prévia, confirmar), como no app -- nada é gravado direto nas
// tabelas g3_* (exceto no teste de volume, que usa o marcador de operação).
// Nenhum dado real.

import { createHash } from 'node:crypto';
import { ADMIN, como, valor } from './ambiente_pedidos.mjs';
import { vendasProdutoCliente, faturamentoGeral, vendasPeriodo } from '../../lib/importacoes/__tests__/relatoriosFicticios.mjs';

export const r2 = (x) => Math.round(x * 100) / 100;
const soma = (xs) => r2(xs.reduce((a, b) => a + b, 0));
export const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
export const n = (x) => (x === null || x === undefined ? x : Number(x));

export function dias(de, ate) {
  const out = [];
  for (let t = Date.parse(`${de}T00:00:00Z`); t <= Date.parse(`${ate}T00:00:00Z`); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// "Hoje" controlável nos testes (GUC teste.hoje), como contas_pagar_hoje().
export const HOJE_BI_TESTE = `
  create or replace function public.bi_hoje_int() returns date language sql stable set search_path = '' as $$
    select coalesce(nullif(current_setting('teste.hoje', true), '')::date, (now() at time zone 'America/Sao_Paulo')::date)
  $$;
  revoke execute on function public.bi_hoje_int() from public, anon, authenticated, service_role;
`;

// Executa fn como usuário logado (papel authenticated), com "hoje" fixo.
export async function comoUsuario(db, uid, hoje, fn) {
  await como(db, uid, { hoje });
  await db.exec('set role authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await como(db, ADMIN, { hoje });
  }
}

export async function importarConfirmar(db, layout, linhas, marca) {
  return comoUsuario(db, ADMIN, '', async () => {
    const id = await valor(db, 'select public.g3_iniciar_importacao($1,$2,$3,$4,$5::jsonb,$6)', [
      layout, 'relatorio.xlsx', 1000,
      createHash('sha256').update(JSON.stringify([layout, linhas, marca])).digest('hex'),
      JSON.stringify({ abas: 1, formulas: 0, macros: false, original: true, produtor: 'SheetJS' }), linhas.length]);
    for (let i = 0; i < linhas.length; i += 2000) {
      await db.query('select public.g3_enviar_linhas($1,$2,$3::jsonb)', [id, i + 1, JSON.stringify(linhas.slice(i, i + 2000))]);
    }
    const p = await valor(db, 'select public.g3_gerar_previa($1)', [id]);
    if (p.status !== 'previa') throw new Error(`prévia ${layout}: ${JSON.stringify(p.erros)}`);
    await valor(db, 'select public.g3_confirmar_importacao($1,$2,true)', [id, p.estado_base]);
    return { id, previa: p };
  });
}

// ---------------------------------------------------------------------------
// Produtos fictícios. 311 e 341 têm a MESMA descrição (códigos distintos);
// 900 tem quantidade decimal (o BI não presume "peso").
export const PRODUTOS = {
  100: ['PAO DE QUEIJO FICTICIO', 3.5],
  200: ['CAFE COADO FICTICIO', 4],
  311: ['OVO FICTICIO', 1],
  341: ['OVO FICTICIO', 1.1],
  500: ['BOLO FICTICIO', 20],
  900: ['PAO FRANCES FICTICIO', 18],
};
export function item(codigo, qtd, valorTotal) {
  return { produto: PRODUTOS[codigo][0], codigo, qtd, valor: valorTotal ?? r2(PRODUTOS[codigo][1] * qtd) };
}
const A = () => [item(100, 2), item(200, 1)]; // 11,00
const B = () => [item(900, 0.355, 6.39), item(311, 6)]; // 12,39
const C = () => [item(100, 1), item(100, 1), item(341, 6)]; // 13,60 (100 repetido na mesma venda)

// Cenário principal (julho/agosto de 2026):
//  - 05/07 pré-operação (2 vendas)
//  - 09/07..09/08: 3 vendas/dia às 07:15 (A), 12:30 (B), 18:45 (C, desconto rateado 0,60)
//      exceto 24/07 (sem vendas), 25/07 (1 venda -- exceção com vendas) e 02/08 (sem vendas)
//  - 20/07: venda A com desconto de item 1,00
//  - 15/07: venda só no FaturamGeral (sem itens) -> não conciliada
//  - 31/07 23:50: venda extra (fuso)
//  - 10/08: parcial (gerado às 12:46), vendas às 08:00 e 10:00
//  - 22/07: Vendas_Periodo com R$ 1,00 a mais (alerta_vp)
export const SEM_VENDAS = ['2026-07-24', '2026-08-02'];
export function vendasPrincipais({ alterarVenda10Jul = false } = {}) {
  let numero = 1000;
  const vs = [];
  const add = (dataHora, itens, extra = {}) => vs.push({ numero: numero++, dataHora, itens, ...extra });
  add('2026-07-05 10:00', A());
  add('2026-07-05 11:00', B());
  for (const d of dias('2026-07-09', '2026-08-09')) {
    if (['2026-07-24', '2026-07-25', '2026-08-02'].includes(d)) continue;
    const a = alterarVenda10Jul && d === '2026-07-10' ? [item(100, 3), item(200, 1)] : A();
    add(`${d} 07:15`, a, d === '2026-07-20' ? { descontoItem: 1 } : {});
    add(`${d} 12:30`, B());
    add(`${d} 18:45`, C(), { descontoRateado: 0.6 });
  }
  add('2026-07-25 09:00', [item(200, 1)]);
  add('2026-07-31 23:50', [item(200, 2)]);
  add('2026-07-15 15:00', [], { semItens: true, prod: 5 });
  add('2026-08-10 08:00', A());
  add('2026-08-10 10:00', B());
  return vs;
}

// Monta os 3 relatórios coerentes a partir das vendas.
export function relatorios(vendas, { inicio, fim, gerado, gerado_vpc = gerado, vpcAte = null, vpAjuste = {} }) {
  const itens = [];
  const fat = [];
  const porDia = new Map();
  for (const v of vendas) {
    const data = v.dataHora.slice(0, 10);
    const prod = v.prod ?? soma(v.itens.map((i) => i.valor));
    const di = v.descontoItem ?? 0;
    const dr = v.descontoRateado ?? 0;
    fat.push({ numero: v.numero, dataHora: v.dataHora, prod, descontoItem: di, descontoRateado: dr,
      ...(v.liquidoErrado !== undefined ? { liquido: v.liquidoErrado } : {}) });
    if (!v.semItens && (!vpcAte || v.dataHora <= vpcAte)) {
      for (const i of v.itens) itens.push({ ...i, numero: v.numero, data });
    }
    if (v.liquidoErrado === undefined) {
      const x = porDia.get(data) || { dia: data, venda: 0, liquido: 0 };
      x.venda = r2(x.venda + prod);
      x.liquido = r2(x.liquido + prod - di - dr);
      porDia.set(data, x);
    }
  }
  for (const [dia, aj] of Object.entries(vpAjuste)) {
    const x = porDia.get(dia);
    x.venda = r2(x.venda + aj);
    x.liquido = r2(x.liquido + aj);
  }
  itens.sort((a, b) => a.produto.localeCompare(b.produto) || a.numero - b.numero || a.codigo - b.codigo);
  return {
    vp: vendasPeriodo({ inicio, fim, gerado, dias: [...porDia.values()] }),
    fat: faturamentoGeral({ inicio, fim, gerado, vendas: fat }),
    vpc: vendasProdutoCliente({ inicio, fim, gerado: gerado_vpc, itens }),
  };
}

export async function carregar(db, rel, marca) {
  const vp = await importarConfirmar(db, 'vendas_periodo', rel.vp, `${marca}-vp`);
  const fat = await importarConfirmar(db, 'faturamento_geral', rel.fat, `${marca}-fat`);
  const vpc = await importarConfirmar(db, 'vendas_produto_cliente', rel.vpc, `${marca}-vpc`);
  return { vp, fat, vpc };
}

export const PERIODO_PRINCIPAL = { inicio: '2026-07-01', fim: '2026-08-31', gerado: '2026-08-10 12:46' };

// Cenário "meses": set/out de 2026, 1 venda por dia às 10:00 (set R$ 10,00 =
// 1 bolo de 0,5; out R$ 12,00 = 1 bolo de 0,6), código 500 com quantidade
// 1 em setembro e 2 em outubro (para comparar o mesmo produto).
export function vendasMeses() {
  let numero = 5000;
  const vs = [];
  for (const d of dias('2026-09-01', '2026-10-31')) {
    const out = d >= '2026-10-01';
    vs.push({ numero: numero++, dataHora: `${d} 10:00`, itens: [item(500, out ? 2 : 1, out ? 12 : 10)] });
  }
  return vs;
}
export const PERIODO_MESES = { inicio: '2026-09-01', fim: '2026-10-31', gerado: '2026-11-01 08:00' };
