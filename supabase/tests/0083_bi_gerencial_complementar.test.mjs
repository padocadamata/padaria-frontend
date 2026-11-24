// Validações complementares da 0083 (BI Gerencial) -- Etapa 3 da homologação.
// PGlite com as migrations REAIS (0081 + 0082 + 0083) e dados FICTÍCIOS
// importados pelo fluxo real da Central. Nada aqui toca o Supabase.
//
//   node --test --test-concurrency=1 supabase/tests/0083_bi_gerencial_complementar.test.mjs
//
// C1  pendência resolvida -> dia reclassificado sozinho
// C2  pendência SÓ de itens -> vendas intactas; produtos fora da média
// C3  dia sem cobertura válida -> nulos (inclusive horários), nunca zero
// C4  dia com vendas e NENHUMA conciliada -> produtos sem dado (nunca R$ 0)
// C5  relatórios parciais em horários diferentes -> produtos até o corte comum
// C6  período anterior com faturamento/quantidade zero -> sem divisão por zero
// C7  participação invariável a filtros, busca, ordem, página e Top N
// C8  período inteiramente anterior à abertura
// C9  limites de intervalo das RPCs x filtros gerais do BI
// C10 metadados de cobertura e paginação mesmo sem produtos

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, como, fabricaDeBancos, fecharBancos, valor } from './ambiente_pedidos.mjs';
import {
  HOJE_BI_TESTE, comoUsuario, importarConfirmar, relatorios, carregar, vendasPrincipais, item,
  PERIODO_PRINCIPAL, iso, n, r2,
} from './bi_cenarios.mjs';

const { PGlite } = await import('@electric-sql/pglite');

const banco = fabricaDeBancos({ extras: ['0073_contas_pagar.sql', '0074_sacos_ajuste_estoque.sql',
  '0075_preferencias_usuario_mensagem_pedido.sql', '0080_central_notificacoes.sql', '0081_importacoes_g3.sql',
  '0082_g3_analisar_where.sql', '0083_bi_gerencial.sql'] });

const extras = new Set();
after(async () => {
  for (const db of extras) { try { await db.close(); } catch { /* fechado */ } }
  await fecharBancos();
});
async function novo() {
  const db = await banco();
  await db.exec(HOJE_BI_TESTE);
  return db;
}
let snapPrincipal = null;
async function principal() {
  if (!snapPrincipal) {
    const db = await novo();
    await carregar(db, relatorios(vendasPrincipais(), PERIODO_PRINCIPAL), 'principal');
    snapPrincipal = await db.dumpDataDir('none');
  }
  const db = new PGlite({ loadDataDir: snapPrincipal });
  await db.waitReady;
  extras.add(db);
  await como(db, ADMIN);
  return db;
}

const HOJE = '2026-08-12';
const admin = (db, sql, params = [], hoje = HOJE) => comoUsuario(db, ADMIN, hoje, () => db.query(sql, params).then((r) => r.rows));
const adminValor = (db, sql, params = [], hoje = HOJE) => comoUsuario(db, ADMIN, hoje, () => valor(db, sql, params));
const produtos = (db, args, params, hoje = HOJE) => adminValor(db, `select public.bi_produtos(${args})`, params, hoje);
const calendario = async (db, de, ate, hoje = HOJE) => Object.fromEntries(
  (await admin(db, 'select * from public.bi_calendario($1,$2)', [de, ate], hoje)).map((l) => [iso(l.dia), l]));
const resumo = (db, de, ate, hoje = HOJE) => adminValor(db, 'select public.bi_resumo($1,$2)', [de, ate], hoje);
async function erroDe(promessa) {
  try { await promessa; } catch (e) { return e; }
  return null;
}
const somaBruto = (lista) => r2(lista.reduce((a, l) => a + n(l.bruto), 0));

// ---------------------------------------------------------------------------
test('C1. pendência aberta (faturamento) resolvida por reimportação: o dia é reclassificado automaticamente', async () => {
  const db = await novo();
  const vs = vendasPrincipais();
  vs.push({ numero: 9999, dataHora: '2026-08-03 16:00', itens: [item(200, 1)], liquidoErrado: 3 }); // aritmética errada
  await carregar(db, relatorios(vs, PERIODO_PRINCIPAL), 'c1');

  let cal = await calendario(db, '2026-08-03', '2026-08-04');
  assert.equal(cal['2026-08-03'].classe_vendas, 'com_pendencias');
  assert.equal(cal['2026-08-03'].classe_itens, 'com_pendencias');
  assert.equal(cal['2026-08-03'].pendencias_faturamento, 1);
  assert.equal(cal['2026-08-03'].pendencias_produtos, 0);
  assert.equal(cal['2026-08-03'].entra_media_vendas, false);
  assert.equal(cal['2026-08-03'].aviso, 'dados_incompletos_pendencia', 'indicação clara de dado incompleto');
  assert.equal(cal['2026-08-04'].classe_vendas, 'completo');
  let r = await resumo(db, '2026-08-03', '2026-08-04');
  assert.equal(r.registrado.vendas, 6, 'consulta mostra o que foi registrado (a venda bloqueada não entra)');
  assert.equal(r.registrado.dias_com_pendencias, 1);
  assert.equal(r.base_media.dias_validos, 1, 'dia com pendência fora da média');
  assert.equal(n(r.base_media.media_diaria_bruto), 36.99);
  let c = await adminValor(db, "select public.bi_comparar('periodo', $1, $2)", ['2026-08-03', '2026-08-03']);
  assert.equal(c.comparavel, false);
  assert.equal(c.pares_excluidos[0].motivo, 'atual_com_pendencias');

  // correção: novo FaturamGeral (gerado depois) com a venda 9999 válida
  const vs2 = vendasPrincipais();
  vs2.push({ numero: 9999, dataHora: '2026-08-03 16:00', itens: [item(200, 1)] });
  await importarConfirmar(db, 'faturamento_geral', relatorios(vs2, { ...PERIODO_PRINCIPAL, gerado: '2026-08-11 09:00' }).fat, 'c1-fix');

  cal = await calendario(db, '2026-08-03', '2026-08-03');
  assert.equal(cal['2026-08-03'].classe_vendas, 'completo', 'reclassificado sem nenhuma ação no BI');
  assert.equal(cal['2026-08-03'].classe_itens, 'completo');
  assert.equal(cal['2026-08-03'].pendencias_faturamento, 0);
  assert.equal(cal['2026-08-03'].entra_media_vendas, true);
  assert.equal(cal['2026-08-03'].aviso, null);
  r = await resumo(db, '2026-08-03', '2026-08-03');
  assert.equal(r.registrado.vendas, 4);
  assert.equal(n(r.registrado.bruto), r2(36.99 + 4));
  assert.equal(r.base_media.dias_validos, 1);
  assert.equal(r.qualidade.vendas_nao_conciliadas, 0);
  const p = await produtos(db, "$1,$2,array['200']", ['2026-08-03', '2026-08-03']);
  assert.equal(n(p.produtos[0].quantidade), 2, 'itens da venda corrigida passam a contar');
  c = await adminValor(db, "select public.bi_comparar('periodo', $1, $2)", ['2026-08-03', '2026-08-03']);
  assert.equal(c.comparavel, true);
});

test('C2. pendência SÓ de itens: indicadores de vendas intactos; produtos registrados mas fora da média; resolve sozinha', async () => {
  const db = await novo();
  const vs = vendasPrincipais();
  vs.push({ numero: 9998, dataHora: '2026-08-04 16:00', itens: [item(200, 1, 0)], prod: 4 }); // item com valor 0 -> bloqueado
  await carregar(db, relatorios(vs, PERIODO_PRINCIPAL), 'c2');

  let cal = await calendario(db, '2026-08-04', '2026-08-04');
  const d = cal['2026-08-04'];
  assert.equal(d.classe_vendas, 'completo', 'vendas não são afetadas pela pendência de itens');
  assert.equal(d.entra_media_vendas, true);
  assert.equal(d.pendencias_faturamento, 0);
  assert.equal(d.classe_itens, 'com_pendencias');
  assert.equal(d.entra_media_itens, false);
  assert.equal(d.pendencias_produtos, 1);
  assert.equal(d.aviso, 'dados_incompletos_pendencia');

  const r = await resumo(db, '2026-08-04', '2026-08-04');
  assert.equal(r.registrado.vendas, 4);
  assert.equal(n(r.registrado.bruto), r2(36.99 + 4));
  assert.equal(r.base_media.dias_validos, 1, 'média de vendas inclui o dia');
  assert.equal(r.registrado.dias_com_pendencias, 0, 'resumo (vendas) não acusa pendência de itens');
  const h = await admin(db, 'select * from public.bi_horarios($1,$2)', ['2026-08-04', '2026-08-04']);
  assert.equal(Number(h.find((l) => l.dia_semana === null && l.hora === 16).vendas), 1, 'horários de vendas usam o dia');
  const cv = await adminValor(db, "select public.bi_comparar('periodo', $1, $2)", ['2026-08-04', '2026-08-04']);
  assert.equal(cv.comparavel, true);

  const p = await produtos(db, '$1,$2', ['2026-08-04', '2026-08-04']);
  assert.equal(somaBruto(p.produtos), 36.99, 'produtos registrados das vendas conciliadas continuam consultáveis');
  assert.equal(p.cobertura.com_pendencias, 1);
  assert.equal(p.cobertura.dias_validos, 0);
  assert.ok(p.avisos.includes('contem_dia_com_pendencias'));
  const ph = await admin(db, 'select * from public.bi_produtos_horario($1,$2)', ['2026-08-04', '2026-08-04']);
  assert.equal(ph.length, 0, 'produtos por horário só com dias válidos de itens');
  const cp = await adminValor(db, "select public.bi_comparar('periodo', $1, $2, '100')", ['2026-08-04', '2026-08-04']);
  assert.equal(cp.comparavel, false);
  assert.equal(cp.pares_excluidos[0].motivo, 'atual_com_pendencias');

  // correção do Vendas_ProdCliente
  const vs2 = vendasPrincipais();
  vs2.push({ numero: 9998, dataHora: '2026-08-04 16:00', itens: [item(200, 1)] });
  await importarConfirmar(db, 'vendas_produto_cliente', relatorios(vs2, { ...PERIODO_PRINCIPAL, gerado: '2026-08-11 09:00' }).vpc, 'c2-fix');
  cal = await calendario(db, '2026-08-04', '2026-08-04');
  assert.equal(cal['2026-08-04'].classe_itens, 'completo');
  assert.equal(cal['2026-08-04'].pendencias_produtos, 0);
  assert.equal(cal['2026-08-04'].entra_media_itens, true);
  const p2 = await produtos(db, '$1,$2', ['2026-08-04', '2026-08-04']);
  assert.equal(somaBruto(p2.produtos), r2(36.99 + 4));
  assert.equal(p2.totais.vendas_excluidas_nao_conciliadas, 0);
});

test('C3. dia sem nenhuma cobertura válida: valores nulos em todas as consultas, inclusive por horário', async () => {
  const db = await principal();
  for (const dia of ['2026-08-11', '2026-07-24']) { // sem importação; cobertura não confirmada
    const r = await resumo(db, dia, dia);
    assert.equal(r.registrado, null, dia);
    assert.equal(r.base_media.bruto, null, dia);
    assert.equal(r.base_media.media_diaria_bruto, null, dia);
    assert.ok(r.avisos.includes('sem_dados'), dia);
    const s = await admin(db, "select * from public.bi_serie($1,$2,'dia')", [dia, dia]);
    assert.equal(s[0].bruto, null, dia);
    assert.equal(s[0].vendas, null, dia);
    assert.equal(s[0].cobertura, 'sem_dados', dia);
    const h = await admin(db, 'select * from public.bi_horarios($1,$2)', [dia, dia]);
    assert.equal(h.length, 0, `${dia}: horários sem linhas (nenhum zero inventado)`);
    const ph = await admin(db, 'select * from public.bi_produtos_horario($1,$2)', [dia, dia]);
    assert.equal(ph.length, 0, dia);
    const ps = await admin(db, "select * from public.bi_produto_serie(array['100'],$1,$2,'dia')", [dia, dia]);
    assert.equal(ps[0].bruto, null, dia);
    assert.equal(ps[0].quantidade, null, dia);
    assert.equal(ps[0].cobertura, 'sem_dados', dia);
    const p = await produtos(db, '$1,$2', [dia, dia]);
    assert.equal(p.totais.bruto_total_periodo, null, dia);
    assert.ok(p.avisos.includes('sem_dados'), dia);
  }
  // horários de um período misto: só os dias válidos entram no divisor
  const h = await admin(db, 'select * from public.bi_horarios($1,$2)', ['2026-08-09', '2026-08-11']);
  assert.equal(Number(h.find((l) => l.dia_semana === null && l.hora === 7).dias_considerados), 1, '10/08 parcial e 11/08 sem importação fora');
});

test('C4. dia com vendas e NENHUMA conciliada: produtos sem dado (nunca R$ 0); vendas intactas', async () => {
  const db = await novo();
  const vs = [];
  let numero = 7000;
  for (const d of ['2026-07-09', '2026-07-10', '2026-07-11']) {
    const sem = d === '2026-07-10' ? { semItens: true } : {};
    vs.push({ numero: numero++, dataHora: `${d} 08:00`, itens: [item(100, 2)], ...sem });
    vs.push({ numero: numero++, dataHora: `${d} 09:00`, itens: [item(200, 1)], ...sem });
  }
  await carregar(db, relatorios(vs, { inicio: '2026-07-09', fim: '2026-07-11', gerado: '2026-07-12 08:00' }), 'c4');

  const cal = await calendario(db, '2026-07-09', '2026-07-11');
  assert.equal(cal['2026-07-10'].classe_vendas, 'completo');
  assert.equal(cal['2026-07-10'].entra_media_vendas, true);
  assert.equal(cal['2026-07-10'].classe_itens, 'sem_conciliacao');
  assert.equal(cal['2026-07-10'].entra_media_itens, false);
  assert.equal(cal['2026-07-10'].vendas_nao_conciliadas, 2);
  assert.equal(cal['2026-07-10'].aviso, 'produtos_sem_conciliacao');
  assert.equal(cal['2026-07-09'].classe_itens, 'completo');

  const r = await resumo(db, '2026-07-10', '2026-07-10');
  assert.equal(n(r.registrado.bruto), 11, 'faturamento do dia aparece');
  assert.equal(r.base_media.dias_validos, 1);
  assert.equal(r.qualidade.vendas_nao_conciliadas, 2);

  const p = await produtos(db, '$1,$2', ['2026-07-10', '2026-07-10']);
  assert.deepEqual(p.produtos, []);
  assert.equal(p.totais.bruto_total_periodo, null, 'nunca R$ 0 de produtos');
  assert.equal(p.totais.vendas_conciliadas, null);
  assert.equal(p.totais.vendas_excluidas_nao_conciliadas, 2);
  assert.ok(p.avisos.includes('sem_dados') && p.avisos.includes('contem_dia_sem_conciliacao'));
  assert.equal(p.cobertura.sem_conciliacao, 1);

  const p3 = await produtos(db, '$1,$2', ['2026-07-09', '2026-07-11']);
  assert.equal(n(p3.totais.bruto_total_periodo), 22, 'só 09 e 11/07');
  assert.equal(p3.cobertura.dias_com_dados, 2);
  assert.equal(p3.totais.vendas_excluidas_nao_conciliadas, 2);

  const ps = await admin(db, "select * from public.bi_produto_serie(array['100'],$1,$2,'dia')", ['2026-07-09', '2026-07-11']);
  const s10 = ps.find((l) => iso(l.inicio) === '2026-07-10');
  assert.equal(s10.bruto, null);
  assert.equal(s10.cobertura, 'sem_dados');
  assert.equal(n(ps.find((l) => iso(l.inicio) === '2026-07-09').bruto), 7);
  const ph = await admin(db, 'select * from public.bi_produtos_horario($1,$2)', ['2026-07-10', '2026-07-10']);
  assert.equal(ph.length, 0);
  const cp = await adminValor(db, "select public.bi_comparar('periodo', $1, $2, '100')", ['2026-07-10', '2026-07-10']);
  assert.equal(cp.comparavel, false);
  assert.equal(cp.pares_excluidos[0].motivo, 'atual_sem_conciliacao');
  const cv = await adminValor(db, "select public.bi_comparar('periodo', $1, $2)", ['2026-07-10', '2026-07-10']);
  assert.equal(cv.comparavel, true, 'comparativo de vendas não é afetado');
});

test('C5a. parciais em horários diferentes (FaturamGeral 12:46, ProdCliente 10:00): produtos até o corte comum', async () => {
  const db = await novo();
  const vs = vendasPrincipais();
  vs.push({ numero: 9997, dataHora: '2026-08-10 11:00', itens: [item(100, 1), item(341, 6)] }); // depois do corte dos itens
  await carregar(db, relatorios(vs, { ...PERIODO_PRINCIPAL, gerado_vpc: '2026-08-10 10:00', vpcAte: '2026-08-10 10:00' }), 'c5a');

  const cal = await calendario(db, '2026-08-10', '2026-08-10');
  const d = cal['2026-08-10'];
  assert.equal(d.classe_vendas, 'parcial');
  assert.equal(d.hora_limite_vendas, '12:46:00');
  assert.equal(d.classe_itens, 'parcial');
  assert.equal(d.hora_limite_itens, '10:00:00', 'corte comum = o mais cedo');
  assert.equal(d.vendas_fora_corte, 1);
  assert.equal(d.vendas_nao_conciliadas, 0, 'venda depois do corte não é problema de conciliação');

  const r = await resumo(db, '2026-08-10', '2026-08-10');
  assert.equal(r.registrado.vendas, 3, 'vendas (FaturamGeral) até 12:46');
  assert.equal(n(r.registrado.bruto), r2(11 + 12.39 + 10.1));
  assert.equal(r.qualidade.vendas_nao_conciliadas, 0);
  assert.equal(r.qualidade.vendas_fora_corte_parcial, 1);

  const p = await produtos(db, '$1,$2', ['2026-08-10', '2026-08-10']);
  assert.equal(n(p.totais.bruto_total_periodo), r2(11 + 12.39), 'produtos só até 10:00');
  assert.equal(p.cobertura.hora_limite_parcial, '10:00');
  assert.equal(p.totais.vendas_fora_corte_parcial, 1);
  assert.equal(p.totais.vendas_excluidas_nao_conciliadas, 0);
  assert.ok(p.avisos.includes('contem_dia_parcial'));
});

test('C5b. parciais invertidos (FaturamGeral 09:00, ProdCliente 12:46): produtos até 09:00', async () => {
  const db = await novo();
  const vs = vendasPrincipais(); // 10/08: 08:00 (A) e 10:00 (B)
  const corte = '2026-08-10 09:00';
  const cedo = relatorios(vs.filter((v) => v.dataHora <= corte), { ...PERIODO_PRINCIPAL, gerado: corte });
  const tarde = relatorios(vs, PERIODO_PRINCIPAL);
  await importarConfirmar(db, 'vendas_periodo', cedo.vp, 'c5b-vp');
  await importarConfirmar(db, 'faturamento_geral', cedo.fat, 'c5b-fat');
  await importarConfirmar(db, 'vendas_produto_cliente', tarde.vpc, 'c5b-vpc');

  const d = (await calendario(db, '2026-08-10', '2026-08-10'))['2026-08-10'];
  assert.equal(d.classe_vendas, 'parcial');
  assert.equal(d.hora_limite_vendas, '09:00:00');
  assert.equal(d.classe_itens, 'parcial');
  assert.equal(d.hora_limite_itens, '09:00:00');
  assert.equal(d.vendas_fora_corte, 1, 'B (10:00) tem itens mas ainda não tem faturamento');
  assert.equal(d.vendas_nao_conciliadas, 0);
  const p = await produtos(db, '$1,$2', ['2026-08-10', '2026-08-10']);
  assert.equal(n(p.totais.bruto_total_periodo), 11);
  assert.equal(p.totais.vendas_fora_corte_parcial, 1);
  assert.equal(p.cobertura.hora_limite_parcial, '09:00');
  const r = await resumo(db, '2026-08-10', '2026-08-10');
  assert.equal(r.registrado.vendas, 1);
  assert.equal(r.qualidade.vendas_nao_conciliadas, 0);
});

test('C6. período anterior com faturamento/quantidade zero: comparável, sem divisão por zero, variação nula + aviso', async () => {
  const db = await principal();
  // 03/08 x 02/08 (02/08 coberto e sem vendas: R$ 0 real, F1)
  const c = await adminValor(db, "select public.bi_comparar('periodo', $1, $2)", ['2026-08-03', '2026-08-03']);
  assert.equal(c.comparavel, true);
  assert.equal(n(c.anterior.bruto), 0);
  assert.equal(n(c.atual.bruto), 36.99);
  assert.equal(c.variacoes.bruto, null, 'sem percentual enganoso (+infinito)');
  assert.equal(c.variacoes.liquido, null);
  assert.equal(c.variacoes.vendas, null);
  assert.equal(c.variacoes.ticket, null);
  assert.equal(c.anterior.ticket, null);
  assert.ok(c.avisos.includes('base_zero'));
  const cp = await adminValor(db, "select public.bi_comparar('periodo', $1, $2, '100')", ['2026-08-03', '2026-08-03']);
  assert.equal(cp.comparavel, true);
  assert.equal(n(cp.anterior.quantidade), 0);
  assert.equal(cp.variacoes.quantidade, null);
  assert.equal(cp.variacoes.bruto, null);
  assert.ok(cp.avisos.includes('base_zero'));
  // produto inexistente nos dois lados: 0 x 0, variação nula
  const cz = await adminValor(db, "select public.bi_comparar('periodo', $1, $2, '999')", ['2026-08-04', '2026-08-05']);
  assert.equal(n(cz.atual.quantidade), 0);
  assert.equal(cz.variacoes.quantidade, null);
});

test('C7. participação invariável: códigos, busca, ordem, paginação e Top N não mudam o denominador', async () => {
  const db = await principal();
  const per = ['2026-07-09', '2026-08-09'];
  const tudo = await produtos(db, "$1,$2,null,null,'bruto','desc',500,0", per);
  const ref = Object.fromEntries(tudo.produtos.map((l) => [l.codigo, n(l.participacao)]));
  const total = n(tudo.totais.bruto_total_periodo);
  assert.equal(r2(Object.values(ref).reduce((a, b) => a + b, 0)), 1);
  const casos = [
    "$1,$2,array['100'],null,'bruto','desc',50,0",
    "$1,$2,array['311','900'],null,'codigo','asc',50,0",
    "$1,$2,null,'ovo','descricao','asc',50,0",
    "$1,$2,null,null,'bruto','desc',1,0", // Top 1
    "$1,$2,null,null,'bruto','desc',3,0", // Top 3
    "$1,$2,null,null,'participacao','asc',2,2", // página 2
    "$1,$2,null,null,'preco_medio','desc',1,4",
  ];
  for (const args of casos) {
    const r = await produtos(db, args, per);
    assert.equal(n(r.totais.bruto_total_periodo), total, args);
    assert.ok(r.produtos.length > 0, args);
    for (const l of r.produtos) assert.equal(n(l.participacao), ref[l.codigo], `${args} ${l.codigo}`);
  }
  const so = await produtos(db, "$1,$2,array['100']", per);
  assert.ok(n(so.produtos[0].participacao) < 1, 'produto selecionado sozinho não vira 100%');
});

test('C8. período inteiramente anterior à abertura (09/07/2026): indisponível com motivo, sem valores', async () => {
  const db = await principal();
  const per = ['2026-06-01', '2026-07-08'];
  const r = await resumo(db, ...per);
  assert.equal(r.motivo, 'periodo_pre_operacao');
  assert.equal(r.registrado, null);
  assert.equal(r.base_media, null);
  const p = await produtos(db, '$1,$2', per);
  assert.equal(p.motivo, 'periodo_pre_operacao');
  assert.deepEqual(p.produtos, []);
  assert.equal(p.paginacao.total_linhas, 0);
  for (const sql of ['select * from public.bi_calendario($1,$2)', "select * from public.bi_serie($1,$2,'mes')",
    "select * from public.bi_produto_serie(array['100'],$1,$2,'dia')", 'select * from public.bi_horarios($1,$2)',
    'select * from public.bi_produtos_horario($1,$2)']) {
    assert.equal((await admin(db, sql, per)).length, 0, sql);
  }
  const c = await adminValor(db, "select public.bi_comparar('periodo', $1, $2)", per);
  assert.equal(c.comparavel, false);
  assert.equal(c.motivo, 'periodo_pre_operacao');
  const cm = await adminValor(db, "select public.bi_comparar('mes', null, $1)", ['2026-06-30']);
  assert.equal(cm.motivo, 'periodo_pre_operacao');
  const cs = await adminValor(db, "select public.bi_comparar('semana', null, $1)", ['2026-07-05']);
  assert.equal(cs.motivo, 'periodo_pre_operacao');
});

test('C9. limites de intervalo das RPCs x filtros gerais do BI (presets e intervalo personalizado)', async () => {
  const db = await principal();
  const dia = (s, k) => new Date(Date.parse(`${s}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
  // filtros gerais previstos: hoje, ontem, últimos 7 dias, mês atual, mês anterior, personalizado
  const presets = {
    hoje: [HOJE, HOJE], ontem: [dia(HOJE, -1), dia(HOJE, -1)], ultimos7: [dia(HOJE, -6), HOJE],
    mesAtual: ['2026-08-01', '2026-08-31'], mesAnterior: ['2026-07-01', '2026-07-31'],
    personalizado400: [dia(HOJE, -399), HOJE], personalizado366: [dia(HOJE, -365), HOJE],
  };
  for (const [nome, per] of Object.entries(presets)) {
    for (const sql of ['select * from public.bi_calendario($1,$2)', 'select public.bi_resumo($1,$2)',
      "select * from public.bi_serie($1,$2,'dia')", "select * from public.bi_serie($1,$2,'semana')",
      "select * from public.bi_serie($1,$2,'mes')", 'select public.bi_produtos($1,$2)',
      "select * from public.bi_produto_serie(array['100'],$1,$2,'dia')", 'select * from public.bi_horarios($1,$2)',
      'select * from public.bi_produtos_horario($1,$2)', "select public.bi_comparar('periodo',$1,$2)"]) {
      if (nome === 'personalizado400' && sql.includes('bi_comparar')) {
        // regra para o frontend: comparativo de período só até 366 dias (recusa explícita, nunca truncamento)
        assert.equal((await erroDe(admin(db, sql, per)))?.code, '22023');
        continue;
      }
      await admin(db, sql, per); // nenhum preset pode dar erro
    }
  }
  // hoje (sem importação) e mês atual (ajustado a hoje)
  const rh = await resumo(db, ...presets.hoje);
  assert.equal(rh.registrado, null);
  const rm = await resumo(db, ...presets.mesAtual);
  assert.equal(rm.periodo.ate, HOJE);
  assert.ok(rm.avisos.includes('fim_ajustado_hoje'));
  // limites exatos: aceita o máximo, recusa máximo + 1 (22023, nunca truncamento silencioso)
  const limites = [
    ['select * from public.bi_calendario($1,$2)', 400],
    ["select * from public.bi_serie($1,$2,'dia')", 400],
    ["select * from public.bi_produto_serie(array['100'],$1,$2,'dia')", 400],
    ['select public.bi_resumo($1,$2)', 1830],
    ["select * from public.bi_serie($1,$2,'semana')", 1830],
    ["select * from public.bi_serie($1,$2,'mes')", 1830],
    ['select public.bi_produtos($1,$2)', 1830],
    ["select * from public.bi_produto_serie(array['100'],$1,$2,'mes')", 1830],
    ['select * from public.bi_horarios($1,$2)', 1830],
    ['select * from public.bi_produtos_horario($1,$2)', 1830],
    ["select public.bi_comparar('periodo',$1,$2)", 366],
  ];
  for (const [sql, max] of limites) {
    await admin(db, sql, [dia(HOJE, -(max - 1)), HOJE]);
    const e = await erroDe(admin(db, sql, [dia(HOJE, -max), HOJE]));
    assert.equal(e?.code, '22023', `${sql}: ${max + 1} dias`);
  }
  // "Top todos": 1 página de até 500 produtos, com paginação indicada
  const todos = await produtos(db, "$1,$2,null,null,'bruto','desc',500,0", presets.personalizado400);
  assert.equal(todos.paginacao.tem_mais, false);
  assert.equal(todos.paginacao.total_linhas, todos.produtos.length);
});

test('C10. metadados de cobertura e paginação mesmo quando nenhum produto é retornado', async () => {
  const db = await principal();
  const per = ['2026-07-09', '2026-08-09'];
  const nada = await produtos(db, "$1,$2,array['999']", per);
  assert.deepEqual(nada.produtos, []);
  assert.equal(nada.paginacao.total_linhas, 0);
  assert.equal(nada.paginacao.retornadas, 0);
  assert.equal(nada.paginacao.tem_mais, false);
  assert.equal(nada.cobertura.dias_validos, 30);
  assert.equal(nada.cobertura.cobertura_nao_confirmada, 2);
  assert.equal(nada.periodo.de, '2026-07-09');
  assert.equal(n(nada.totais.bruto_total_periodo), r2(29 * 36.99 + 8), 'total do período mantido (denominador)');
  const alem = await produtos(db, "$1,$2,null,null,'bruto','desc',50,400", per);
  assert.deepEqual(alem.produtos, []);
  assert.equal(alem.paginacao.total_linhas, 5, 'página além do fim: total continua informado');
  const semCob = await produtos(db, '$1,$2', ['2026-08-11', '2026-08-11']);
  assert.deepEqual(semCob.produtos, []);
  assert.equal(semCob.cobertura.sem_importacao, 1);
  assert.equal(semCob.cobertura.dias_calendario, 1);
  assert.equal(semCob.totais.bruto_total_periodo, null);
  assert.equal(semCob.paginacao.limite, 50);
});
