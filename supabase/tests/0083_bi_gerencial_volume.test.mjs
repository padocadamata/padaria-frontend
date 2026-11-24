// Cenário 33 da 0083 (BI Gerencial): volume de ~3 anos FICTÍCIOS.
// Arquivo separado (pesado): rodar sozinho.
//   node --test supabase/tests/0083_bi_gerencial_volume.test.mjs
// Para montar 110 mil vendas rapidamente, os lotes e as vendas são gravados
// DIRETO nas tabelas g3_* com o marcador de operação da 0081 (g3.operacao),
// SÓ neste banco de teste. O critério de aprovação da Etapa 2 é 300 ms por
// função no PostgreSQL; aqui (PGlite/WASM, mais lento) os tempos são
// registrados e só falham acima de um teto de segurança.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, fabricaDeBancos, fecharBancos } from './ambiente_pedidos.mjs';
import { HOJE_BI_TESTE, comoUsuario } from './bi_cenarios.mjs';

after(fecharBancos);
const banco = fabricaDeBancos({ extras: ['0073_contas_pagar.sql', '0074_sacos_ajuste_estoque.sql',
  '0075_preferencias_usuario_mensagem_pedido.sql', '0080_central_notificacoes.sql', '0081_importacoes_g3.sql',
  '0082_g3_analisar_where.sql', '0083_bi_gerencial.sql'] });

const VENDAS = 110000;
const DIAS = 1100; // 09/07/2026 .. 12/07/2029
const HOJE = '2029-07-20';
const TETO_MS = 15000;

test('33. volume de 3 anos: todas as funções respondem; tempos registrados', async () => {
  const db = await banco();
  await db.exec(HOJE_BI_TESTE);
  await db.exec(`
    select set_config('g3.operacao', 'on', false);
    insert into public.g3_importacoes (layout, status, arquivo_nome, arquivo_tamanho, arquivo_sha256, linhas_total, linhas_recebidas,
                                       gerado_em, periodo_inicio, periodo_fim, cobertura_completa_fim, confirmado_em)
    select l, 'confirmado', 'volume.xlsx', 1000, md5(l) || md5(l || 'x'), 1, 1,
           timestamptz '2029-07-13 08:00-03', date '2026-07-09', date '2029-07-12', date '2029-07-12', now()
    from unnest(array['faturamento_geral', 'vendas_produto_cliente', 'vendas_periodo']) l;
    insert into public.g3_vendas (numero, itens_estado, itens_lote_id, itens_data, itens_total, itens_linhas, itens_quantidade,
                                  fat_estado, fat_lote_id, fat_data, data_hora, prod, acrescimo_item, desconto_item, subtotal,
                                  acrescimo_rateado, desconto_rateado, taxa_servico, liquido)
    select g, 'presente', (select id from public.g3_importacoes where layout = 'vendas_produto_cliente'),
           date '2026-07-09' + (g % ${DIAS}), 10.00, 2, 2,
           'presente', (select id from public.g3_importacoes where layout = 'faturamento_geral'),
           date '2026-07-09' + (g % ${DIAS}),
           ((date '2026-07-09' + (g % ${DIAS}))::timestamp + make_interval(hours => 6 + g % 14, mins => g % 60)) at time zone 'America/Sao_Paulo',
           10.00, 0, 0, 10.00, 0, 0.10, 0, 9.90
    from generate_series(1, ${VENDAS}) g;
    insert into public.g3_venda_itens (numero, codigo, ordinal, descricao, quantidade, desconto, valor)
    select g, (100 + g % 300)::text, 1, 'PRODUTO VOLUME ' || (100 + g % 300), 1, 0, 6.00 from generate_series(1, ${VENDAS}) g
    union all
    select g, (400 + g % 100)::text, 1, 'PRODUTO VOLUME ' || (400 + g % 100), 0.5, 0, 4.00 from generate_series(1, ${VENDAS}) g;
    select set_config('g3.operacao', '', false);
    analyze public.g3_vendas; analyze public.g3_venda_itens;
  `);

  const chamadas = [
    ['bi_status', 'select public.bi_status()', []],
    ['bi_calendario (400 dias)', 'select count(*) from public.bi_calendario($1,$2)', ['2028-06-01', '2029-07-05']],
    ['bi_resumo (3 anos)', 'select public.bi_resumo($1,$2)', ['2026-07-09', '2029-07-12']],
    ['bi_serie dia (400 dias)', "select count(*) from public.bi_serie($1,$2,'dia')", ['2028-06-01', '2029-07-05']],
    ['bi_serie mes (3 anos)', "select count(*) from public.bi_serie($1,$2,'mes')", ['2026-07-09', '2029-07-12']],
    ['bi_produtos (3 anos, top 20)', "select jsonb_array_length(public.bi_produtos($1,$2,null,null,'bruto','desc',20,0) -> 'produtos') as n", ['2026-07-09', '2029-07-12']],
    ['bi_produtos (1 mes, pagina 3)', "select jsonb_array_length(public.bi_produtos($1,$2,null,null,'descricao','asc',50,100) -> 'produtos') as n", ['2029-06-01', '2029-06-30']],
    ['bi_produto_serie (5 codigos, mes, 3 anos)', "select count(*) from public.bi_produto_serie(array['100','101','102','400','401'],$1,$2,'mes')", ['2026-07-09', '2029-07-12']],
    ['bi_horarios (3 anos)', 'select count(*) from public.bi_horarios($1,$2)', ['2026-07-09', '2029-07-12']],
    ['bi_produtos_horario (1 ano)', "select count(*) from public.bi_produtos_horario($1,$2,0::smallint,23::smallint,'bruto',10)", ['2028-07-01', '2029-06-30']],
    ['bi_comparar mes', "select public.bi_comparar('mes', null, $1)", ['2029-06-30']],
    ['bi_comparar periodo produto (90 dias)', "select public.bi_comparar('periodo', $1, $2, '100')", ['2029-04-01', '2029-06-29']],
  ];
  const tempos = [];
  for (const [rotulo, sql, params] of chamadas) {
    const t0 = Date.now();
    const r = await comoUsuario(db, ADMIN, HOJE, () => db.query(sql, params));
    const ms = Date.now() - t0;
    tempos.push(`${rotulo}: ${ms} ms`);
    console.log(`[0083 volume] ${rotulo}: ${ms} ms`);
    assert.ok(r.rows.length >= 1, rotulo);
    assert.ok(ms < TETO_MS, `${rotulo} levou ${ms} ms`);
  }
  const resumo = await comoUsuario(db, ADMIN, HOJE, () => db.query('select public.bi_resumo($1,$2) as r', ['2026-07-09', '2029-07-12']));
  // 24 e 25/07/2026 (dias 15 e 16 da série) são "cobertura não confirmada": suas 200 vendas ficam fora
  const naExcecao = 2 * (VENDAS / DIAS);
  assert.equal(resumo.rows[0].r.registrado.vendas, VENDAS - naExcecao);
  assert.equal(Number(resumo.rows[0].r.registrado.bruto), (VENDAS - naExcecao) * 10);
  assert.equal(resumo.rows[0].r.dias.cobertura_nao_confirmada, 2);
  console.log(`[0083 volume] ${VENDAS} vendas / ${VENDAS * 2} itens em ${DIAS} dias\n  ${tempos.join('\n  ')}`);
});
