// HOMOLOGAÇÃO LOCAL DO BI GERENCIAL -- roda NA CÓPIA temporária (chamado
// por preparar.mjs): monta o banco PGlite com as migrations REAIS até a 0084
// (mesmo ambiente dos testes automatizados, supabase/tests/ambiente_pedidos.mjs),
// carrega ~4 meses de vendas FICTÍCIAS (dados-ficticios.mjs) e grava o
// retrato em homologacao/bi-gerencial/banco.retrato, lido pela API local.
//
// Para montar dezenas de milhares de vendas rapidamente, lotes e vendas são
// gravados DIRETO nas tabelas g3_* com o marcador de operação da 0081
// (g3.operacao) -- SÓ neste banco fictício, como no teste de volume. As
// RPCs do BI leem essas tabelas exatamente como em produção.
//
// Usuários fictícios: ADMIN (proprietario_admin) e GESTAO (gestao).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { novoBanco } from '../../supabase/tests/ambiente_pedidos.mjs';
import { HOJE_BI_TESTE } from '../../supabase/tests/bi_cenarios.mjs';
import { HOJE, INICIO, PARCIAL, gerarVendas } from './dados-ficticios.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const t0 = Date.now();
const db = await novoBanco({
  extras: ['0073_contas_pagar.sql', '0074_sacos_ajuste_estoque.sql', '0075_preferencias_usuario_mensagem_pedido.sql',
    '0080_central_notificacoes.sql', '0081_importacoes_g3.sql', '0082_g3_analisar_where.sql', '0083_bi_gerencial.sql',
    '0084_bi_complementar.sql'],
});
await db.exec(HOJE_BI_TESTE);

const LAYOUTS = ['faturamento_geral', 'vendas_produto_cliente', 'vendas_periodo'];
await db.exec(`select set_config('g3.operacao', 'on', false);`);
// Lote 1: 09/07 a 18/11 (completo). Lote 2: 20/11 a 25/11 (completo até 24/11; 25/11 parcial às 12:44).
for (const layout of LAYOUTS) {
  await db.query(
    `insert into public.g3_importacoes (layout, status, arquivo_nome, arquivo_tamanho, arquivo_sha256, linhas_total, linhas_recebidas,
       gerado_em, periodo_inicio, periodo_fim, cobertura_completa_fim, dia_parcial, confirmado_em)
     values ($1, 'confirmado', 'ficticio-1.xlsx', 1000, md5($1 || '1') || md5($1 || '1x'), 1, 1,
             timestamptz '2026-11-19 07:30-03', $2::date, date '2026-11-18', date '2026-11-18', null, timestamptz '2026-11-19 07:40-03'),
            ($1, 'confirmado', 'ficticio-2.xlsx', 1000, md5($1 || '2') || md5($1 || '2x'), 1, 1,
             $3::timestamptz, date '2026-11-20', $4::date, date '2026-11-24', $4::date, $3::timestamptz + interval '6 minutes')`,
    [layout, INICIO, `${PARCIAL.dia} ${PARCIAL.hora}-03`, PARCIAL.dia]
  );
}
const lotes = {};
for (const r of (await db.query(`select id, layout, periodo_inicio::text as ini from public.g3_importacoes`)).rows) {
  lotes[`${r.layout}:${r.ini >= '2026-11-20' ? 2 : 1}`] = r.id;
}
const lote = (layout, dia) => lotes[`${layout}:${dia >= '2026-11-20' ? 2 : 1}`];

const { vendas, itens } = gerarVendas();
const esc = (s) => `'${String(s).replace(/'/g, "''")}'`;
const BLOCO = 800;
for (let i = 0; i < vendas.length; i += BLOCO) {
  const valores = vendas.slice(i, i + BLOCO).map((v) => {
    const itensCols = v.semItens
      ? 'null, null, null, null, null, null'
      : `'presente', ${esc(lote('vendas_produto_cliente', v.dia))}, ${esc(v.dia)}, ${v.itensTotal}, ${v.nLinhas}, ${Math.round(v.qtdTotal * 1000) / 1000}`;
    return `(${v.numero}, ${itensCols}, 'presente', ${esc(lote('faturamento_geral', v.dia))}, ${esc(v.dia)},
      (${esc(`${v.dia} ${v.hhmm}`)}::timestamp at time zone 'America/Sao_Paulo'), ${v.prod}, 0, 0, ${v.prod}, 0, ${v.desconto}, 0, ${v.liquido})`;
  });
  await db.exec(`insert into public.g3_vendas (numero, itens_estado, itens_lote_id, itens_data, itens_total, itens_linhas, itens_quantidade,
    fat_estado, fat_lote_id, fat_data, data_hora, prod, acrescimo_item, desconto_item, subtotal, acrescimo_rateado, desconto_rateado, taxa_servico, liquido)
    values ${valores.join(',\n')};`);
}
for (let i = 0; i < itens.length; i += 2000) {
  const valores = itens.slice(i, i + 2000).map((l) => `(${l.numero}, ${esc(l.codigo)}, ${l.ordinal}, ${esc(l.descricao)}, ${l.quantidade}, 0, ${l.valor})`);
  await db.exec(`insert into public.g3_venda_itens (numero, codigo, ordinal, descricao, quantidade, desconto, valor) values ${valores.join(',')};`);
}
// Relatório diário (Vendas_Periodo) coerente com o faturamento.
await db.exec(`
  insert into public.g3_vendas_diarias (dia, estado, lote_id, venda, custo_g3, acrescimo, desconto_g3, liquido_sem_taxa, taxa_servico, ganho_g3)
  select v.data, 'presente',
         (select l.id from public.g3_importacoes l where l.layout = 'vendas_periodo' and v.data between l.periodo_inicio and l.periodo_fim),
         sum(v.prod), 0, 0, sum(v.desconto_rateado), sum(v.liquido), 0, 0
  from public.g3_vendas v where v.fat_estado = 'presente' group by v.data;
  select set_config('g3.operacao', '', false);
  analyze public.g3_vendas; analyze public.g3_venda_itens;
  update public.usuarios set nome = 'Admin Teste' where perfil = 'proprietario_admin';
  update public.usuarios set nome = 'Gestão Teste' where id = '00000000-0000-0000-0000-00000000000c';
  select set_config('teste.uid', '', false);
`);

const retrato = await db.dumpDataDir('none');
writeFileSync(path.join(aqui, 'banco.retrato'), Buffer.from(await retrato.arrayBuffer()));
await db.close();
console.log(`[homologação BI] banco montado (migrations até a 0084): ${vendas.length} vendas, ${itens.length} itens fictícios, "hoje" = ${HOJE} (${Math.round((Date.now() - t0) / 1000)} s).`);
