// Volume da 0084 (BI complementar): os mesmos ~3 anos FICTÍCIOS do cenário 33
// da 0083. Arquivo separado (pesado): rodar sozinho.
//   node --test supabase/tests/0084_bi_complementar_volume.test.mjs
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
  '0082_g3_analisar_where.sql', '0083_bi_gerencial.sql', '0084_bi_complementar.sql'] });

const VENDAS = 110000;
const DIAS = 1100; // 09/07/2026 .. 12/07/2029
const HOJE = '2029-07-20';
const TETO_MS = 15000;

test('V1. volume de 3 anos: as 7 RPCs da 0084 respondem; tempos registrados', async () => {
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

  const FDS = 'array[0,6]::smallint[]';
  const chamadas = [
    ['bi_resumo_v2 (3 anos)', 'select public.bi_resumo_v2($1,$2)', ['2026-07-09', '2029-07-12']],
    ['bi_resumo_v2 (3 anos, fins de semana)', `select public.bi_resumo_v2($1,$2,${FDS})`, ['2026-07-09', '2029-07-12']],
    ['bi_serie_v2 dia (400 dias, sextas)', "select count(*) from public.bi_serie_v2($1,$2,'dia',array[5]::smallint[])", ['2028-06-01', '2029-07-05']],
    ['bi_serie_v2 mes (3 anos)', "select count(*) from public.bi_serie_v2($1,$2,'mes')", ['2026-07-09', '2029-07-12']],
    ['bi_produtos_v2 (3 anos, top 20, segundas)', "select jsonb_array_length(public.bi_produtos_v2($1,$2,null,null,'bruto','desc',20,0,array[1]::smallint[]) -> 'produtos') as n", ['2026-07-09', '2029-07-12']],
    ['bi_produto_serie_v2 (5 codigos, mes, 3 anos, fds)', `select count(*) from public.bi_produto_serie_v2(array['100','101','102','400','401'],$1,$2,'mes',${FDS})`, ['2026-07-09', '2029-07-12']],
    ['bi_produtos_horario_v2 (1 ano, fds)', `select count(*) from public.bi_produtos_horario_v2($1,$2,0::smallint,23::smallint,'bruto',10,${FDS})`, ['2028-07-01', '2029-06-30']],
    ['bi_produto_horarios (10 codigos, 1 ano)', "select count(*) from public.bi_produto_horarios(array['100','101','102','103','104','400','401','402','403','404'],$1,$2)", ['2028-07-01', '2029-06-30']],
    ['bi_produto_horarios (1 codigo, 3 anos)', "select count(*) from public.bi_produto_horarios(array['100'],$1,$2)", ['2026-07-09', '2029-07-12']],
    ['bi_comparar_periodos mes x mes (pareado)', 'select public.bi_comparar_periodos($1,$2,$3,$4)', ['2029-06-01', '2029-06-30', '2029-05-01', '2029-05-30']],
    ['bi_comparar_periodos 1 ano x 1 ano, 5 produtos', "select public.bi_comparar_periodos($1,$2,$3,$4,null,array['100','101','102','400','401'])", ['2028-07-01', '2029-06-30', '2027-07-01', '2028-06-30']],
    ['bi_comparar_periodos sextas (media)', "select public.bi_comparar_periodos($1,$2,$3,$4,array[5]::smallint[],array['100'])", ['2029-06-01', '2029-06-30', '2029-03-01', '2029-05-31']],
  ];
  const tempos = [];
  for (const [rotulo, sql, params] of chamadas) {
    const t0 = Date.now();
    const r = await comoUsuario(db, ADMIN, HOJE, () => db.query(sql, params));
    const ms = Date.now() - t0;
    tempos.push(`${rotulo}: ${ms} ms`);
    console.log(`[0084 volume] ${rotulo}: ${ms} ms`);
    assert.ok(r.rows.length >= 1, rotulo);
    assert.ok(ms < TETO_MS, `${rotulo} levou ${ms} ms`);
  }
  // conferência de coerência no volume: v2 sem filtro = v1; fins de semana + dias úteis = total
  const um = async (sql, p) => (await comoUsuario(db, ADMIN, HOJE, () => db.query(sql, p))).rows[0].r;
  const P = ['2026-07-09', '2029-07-12'];
  const v1 = await um('select public.bi_resumo($1,$2) as r', P);
  const v2 = await um('select public.bi_resumo_v2($1,$2) as r', P);
  assert.equal(v2.base_media.bruto, v1.base_media.bruto);
  const fds = await um(`select public.bi_resumo_v2($1,$2,${FDS}) as r`, P);
  const uteis = await um('select public.bi_resumo_v2($1,$2,array[1,2,3,4,5]::smallint[]) as r', P);
  assert.equal(fds.base_media.vendas + uteis.base_media.vendas, v1.base_media.vendas);
  assert.equal(fds.base_media.dias_validos + uteis.base_media.dias_validos, v1.base_media.dias_validos);
  console.log(`[0084 volume] ${VENDAS} vendas / ${VENDAS * 2} itens em ${DIAS} dias\n  ${tempos.join('\n  ')}`);
});
