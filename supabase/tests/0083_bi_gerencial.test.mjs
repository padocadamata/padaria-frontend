// Testes da migration 0083 (BI Gerencial) sobre PGlite com as migrations
// REAIS (0081 + 0082 + 0083) e dados FICTÍCIOS importados pelo fluxo real da
// Central de Importações. Nada aqui toca o Supabase.
//
//   node --test --test-concurrency=1 supabase/tests/0083_bi_gerencial.test.mjs
//
// Numeração = matriz de testes aprovada (Etapa 2, seção D), com os ajustes
// F1 (dia coberto sem vendas ENTRA na média) e F2 (24-25/07 = cobertura não
// confirmada) e o cenário 34 (dia com pendência de importação).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ADMIN, GESTAO, RECEBEDOR, RAIZ, como, fabricaDeBancos, fecharBancos, valor, aplicarMigration, lerMigration,
} from './ambiente_pedidos.mjs';
import { executarComoEditorPorInstrucao } from './editorSql.mjs';
import { comandosSemWhere } from './semWhere.mjs';
import {
  HOJE_BI_TESTE, comoUsuario, importarConfirmar, relatorios, carregar, vendasPrincipais, vendasMeses,
  PERIODO_PRINCIPAL, PERIODO_MESES, dias, iso, n, r2,
} from './bi_cenarios.mjs';

const { PGlite } = await import('@electric-sql/pglite');

const BASE = ['0073_contas_pagar.sql', '0074_sacos_ajuste_estoque.sql', '0075_preferencias_usuario_mensagem_pedido.sql',
  '0080_central_notificacoes.sql', '0081_importacoes_g3.sql', '0082_g3_analisar_where.sql'];
const M83 = '0083_bi_gerencial.sql';
const PRE = join(RAIZ, '0083_pre_auditoria_bi_gerencial_EXECUTAR.sql');
const POS = join(RAIZ, '0083_pos_auditoria_bi_gerencial_EXECUTAR.sql');
const EXECUTAR = join(RAIZ, '0083_bi_gerencial_EXECUTAR.sql');

const bancoSem83 = fabricaDeBancos({ extras: BASE });
const bancoCom83 = fabricaDeBancos({ extras: [...BASE, M83] });

const extras = new Set();
after(async () => {
  for (const db of extras) { try { await db.close(); } catch { /* fechado */ } }
  await fecharBancos();
});
async function copia(snapshot) {
  const db = new PGlite({ loadDataDir: snapshot });
  await db.waitReady;
  extras.add(db);
  await como(db, ADMIN);
  return db;
}
async function novo83() {
  const db = await bancoCom83();
  await db.exec(HOJE_BI_TESTE);
  return db;
}

// Cenários montados UMA vez e copiados por teste.
const snapshots = {};
async function cenario(nome, montar) {
  if (!snapshots[nome]) {
    const db = await novo83();
    await montar(db);
    snapshots[nome] = await db.dumpDataDir('none');
  }
  return copia(snapshots[nome]);
}
const principal = () => cenario('principal', (db) => carregar(db, relatorios(vendasPrincipais(),
  { ...PERIODO_PRINCIPAL, vpAjuste: { '2026-07-22': 1 } }), 'principal'));
const meses = () => cenario('meses', (db) => carregar(db, relatorios(vendasMeses(), PERIODO_MESES), 'meses'));

const HOJE = '2026-08-12';
const HOJE_MESES = '2026-11-05';
const admin = (db, sql, params = [], hoje = HOJE) => comoUsuario(db, ADMIN, hoje, () => db.query(sql, params).then((r) => r.rows));
const adminValor = (db, sql, params = [], hoje = HOJE) => comoUsuario(db, ADMIN, hoje, () => valor(db, sql, params));
// bi_produtos devolve jsonb { periodo, motivo, avisos, cobertura, totais, paginacao, produtos[] }
const produtos = (db, args, params, hoje = HOJE) => adminValor(db, `select public.bi_produtos(${args})`, params, hoje);
async function erroDe(promessa) {
  try { await promessa; } catch (e) { return e; }
  return null;
}
const porDia = (linhas) => Object.fromEntries(linhas.map((l) => [iso(l.dia), l]));

// Valores esperados do cenário principal entre 09/07 e 09/08 (base 'vendas').
// 29 dias normais (3 vendas: 11,00 + 12,39 + 13,60 = 36,99 bruto; 36,39 líquido)
// + 31/07 23:50 (8,00) + 15/07 sem itens (5,00); 20/07 com desconto de item 1,00.
const ESPERADO = {
  bruto: r2(29 * 36.99 + 8 + 5), // 1085,71
  liquido: r2(29 * 36.39 + 8 + 5 - 1), // 1067,31
  vendas: 29 * 3 + 2, // 89
  descontos: r2(29 * 0.6 + 1), // 18,40
  diasValidos: 30, // 29 com vendas + 02/08 coberto sem vendas (F1)
};

// ---------------------------------------------------------------------------
// 1 a 8, 9: classificação, registrado x base_media, descontos
// ---------------------------------------------------------------------------

test('1. pré-operação: período iniciado antes de 09/07 é ajustado e as vendas de 05/07 ficam fora', async () => {
  const db = await principal();
  const r = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-07-01', '2026-07-09']);
  assert.equal(r.periodo.de, '2026-07-09');
  assert.ok(r.avisos.includes('inicio_ajustado_operacao'));
  assert.equal(r.registrado.vendas, 3, 'só as 3 vendas de 09/07');
  const sem = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-07-01', '2026-07-08']);
  assert.equal(sem.motivo, 'periodo_pre_operacao');
  assert.equal(sem.registrado, null);
  // exceção antes do início oficial é recusada
  const e = await erroDe(db.query("insert into public.bi_calendario_excecoes values ('2026-07-01', 'sem_operacao', 'teste')"));
  assert.equal(e?.code, '22023');
  // os registros de pré-operação continuam preservados no banco
  assert.equal(Number(await valor(db, "select count(*) from public.g3_vendas where data = '2026-07-05'")), 2);
});

test('2. primeiro dia oficial (09/07) entra e é contado em dias_validos', async () => {
  const db = await principal();
  const cal = porDia(await admin(db, 'select * from public.bi_calendario($1,$2)', ['2026-07-09', '2026-07-09']));
  assert.equal(cal['2026-07-09'].classe_vendas, 'completo');
  const r = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-07-09', '2026-07-09']);
  assert.equal(r.base_media.dias_validos, 1);
  assert.equal(n(r.base_media.bruto), 36.99);
});

test('3/3b. 24 e 25/07: cobertura não confirmada, valores nulos, fora da média; 25/07 com venda gera aviso', async () => {
  const db = await principal();
  const cal = porDia(await admin(db, 'select * from public.bi_calendario($1,$2)', ['2026-07-23', '2026-07-26']));
  for (const d of ['2026-07-24', '2026-07-25']) {
    assert.equal(cal[d].classe_vendas, 'cobertura_nao_confirmada');
    assert.equal(cal[d].entra_media_vendas, false);
    assert.match(cal[d].excecao_motivo, /nao confirmada/);
  }
  assert.equal(cal['2026-07-24'].aviso, null);
  assert.equal(cal['2026-07-25'].aviso, 'excecao_com_vendas');
  assert.equal(cal['2026-07-25'].vendas_registradas, 1);
  const serie = porDia((await admin(db, "select inicio as dia, * from public.bi_serie($1,$2,'dia')", ['2026-07-23', '2026-07-26'])));
  assert.equal(serie['2026-07-24'].bruto, null, 'nunca zero');
  assert.equal(serie['2026-07-25'].bruto, null, 'exceção não soma a venda registrada');
  assert.equal(serie['2026-07-24'].cobertura, 'sem_dados');
  const r = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-07-23', '2026-07-26']);
  assert.equal(r.dias.cobertura_nao_confirmada, 2);
  assert.equal(r.base_media.dias_validos, 2);
  assert.ok(r.avisos.includes('excecao_com_vendas'));
});

test('4. dia completo com vendas: somas de g3_vendas; ticket = líquido / vendas', async () => {
  const db = await principal();
  const r = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-07-10', '2026-07-10']);
  assert.equal(n(r.registrado.bruto), 36.99);
  assert.equal(n(r.registrado.liquido), 36.39);
  assert.equal(r.registrado.vendas, 3);
  assert.equal(n(r.registrado.ticket), 12.13);
});

test('5. (F1) dia coberto sem vendas: R$ 0 e ENTRA no divisor da média', async () => {
  const db = await principal();
  const cal = porDia(await admin(db, 'select * from public.bi_calendario($1,$2)', ['2026-08-02', '2026-08-02']));
  assert.equal(cal['2026-08-02'].classe_vendas, 'completo_sem_vendas');
  assert.equal(cal['2026-08-02'].entra_media_vendas, true);
  const s = (await admin(db, "select * from public.bi_serie($1,$2,'dia')", ['2026-08-01', '2026-08-03']));
  assert.equal(n(s[1].bruto), 0);
  assert.equal(s[1].cobertura, 'completa');
  const r = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-08-01', '2026-08-03']);
  assert.equal(r.base_media.dias_validos, 3);
  assert.equal(n(r.base_media.media_diaria_bruto), r2((36.99 * 2) / 3));
  // com exceção "sem_operacao" o mesmo dia sai da média
  await db.exec("insert into public.bi_calendario_excecoes values ('2026-08-02', 'sem_operacao', 'loja fechada (teste)')");
  const r2x = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-08-01', '2026-08-03']);
  assert.equal(r2x.base_media.dias_validos, 2);
  assert.equal(r2x.dias.sem_operacao, 1);
});

test('6. dia parcial (gerado 12:46): valores registrados com hora limite; fora da base_media e dos horários', async () => {
  const db = await principal();
  const cal = porDia(await admin(db, 'select * from public.bi_calendario($1,$2)', ['2026-08-10', '2026-08-10']));
  assert.equal(cal['2026-08-10'].classe_vendas, 'parcial');
  assert.equal(cal['2026-08-10'].hora_limite_vendas, '12:46:00');
  const r = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-08-10', '2026-08-10']);
  assert.equal(n(r.registrado.bruto), 23.39);
  assert.equal(r.registrado.dias_parciais, 1);
  assert.equal(r.base_media.dias_validos, 0);
  assert.equal(r.base_media.media_diaria_bruto, null);
  assert.ok(r.avisos.includes('contem_dia_parcial'));
  const h = await admin(db, 'select * from public.bi_horarios($1,$2)', ['2026-08-10', '2026-08-10']);
  assert.equal(h.length, 0, 'dia parcial não entra em horários');
});

test('7. dia sem importação (e "hoje"/"ontem"): nulo, nunca zero; datas futuras ajustadas', async () => {
  const db = await principal();
  const cal = porDia(await admin(db, 'select * from public.bi_calendario($1,$2)', ['2026-08-11', '2026-08-20']));
  assert.deepEqual(Object.keys(cal), ['2026-08-11', '2026-08-12'], 'ajustado até hoje');
  assert.equal(cal['2026-08-11'].classe_vendas, 'sem_importacao');
  assert.equal(cal['2026-08-12'].classe_vendas, 'sem_importacao');
  const r = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-08-11', '2026-08-20']);
  assert.ok(r.avisos.includes('fim_ajustado_hoje'));
  assert.equal(r.registrado, null);
  assert.ok(r.avisos.includes('sem_dados'));
  const fut = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-08-13', '2026-08-20']);
  assert.equal(fut.motivo, 'periodo_futuro');
});

test('8. período misto (completo, parcial, sem importação, exceção, sem vendas): contagens e média só nos válidos', async () => {
  const db = await principal();
  const r = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-07-09', '2026-08-12']);
  assert.deepEqual(r.dias, {
    completo: 29, completo_sem_vendas: 1, parcial: 1, com_pendencias: 0, sem_importacao: 2,
    cobertura_nao_confirmada: 2, sem_operacao: 0, pre_operacao: 0, futuro: 0,
  });
  assert.equal(n(r.registrado.bruto), r2(ESPERADO.bruto + 23.39));
  assert.equal(r.registrado.vendas, ESPERADO.vendas + 2);
  assert.equal(r.base_media.dias_validos, ESPERADO.diasValidos);
  assert.equal(n(r.base_media.bruto), ESPERADO.bruto);
  assert.equal(n(r.base_media.liquido), ESPERADO.liquido);
  assert.equal(r.base_media.vendas, ESPERADO.vendas);
  assert.equal(n(r.base_media.media_diaria_bruto), r2(ESPERADO.bruto / 30));
  assert.equal(n(r.base_media.ticket), r2(ESPERADO.liquido / ESPERADO.vendas));
  // a série soma o mesmo que o resumo
  const s = await admin(db, "select * from public.bi_serie($1,$2,'dia')", ['2026-07-09', '2026-08-12']);
  assert.equal(r2(s.reduce((a, l) => a + n(l.bruto ?? 0), 0)), n(r.registrado.bruto));
  assert.equal(s.find((l) => iso(l.inicio) === '2026-08-11').bruto, null);
});

test('9. descontos: item + rateado; líquido = coluna gravada; Vendas_Periodo nunca alimenta valores', async () => {
  const db = await principal();
  const r = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-07-09', '2026-08-09']);
  assert.equal(n(r.registrado.descontos), ESPERADO.descontos);
  assert.equal(n(r.registrado.liquido), ESPERADO.liquido);
  assert.equal(r2(n(r.registrado.bruto) - n(r.registrado.descontos)), n(r.registrado.liquido));
  const d20 = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-07-20', '2026-07-20']);
  assert.equal(n(d20.registrado.descontos), 1.6);
  assert.equal(n(d20.registrado.liquido), r2(36.99 - 1.6));
});

// ---------------------------------------------------------------------------
// 10 a 14: produtos e horários
// ---------------------------------------------------------------------------

test('10/11/12. produtos: decimal informativo, repetido na mesma venda conta 1 venda, mesma descrição em códigos distintos', async () => {
  const db = await principal();
  const r = await produtos(db, "$1,$2,null,null,'codigo','asc',500,0", ['2026-07-09', '2026-08-09']);
  const p = r.produtos;
  const m = Object.fromEntries(p.map((l) => [l.codigo, l]));
  assert.deepEqual(Object.keys(m), ['100', '200', '311', '341', '900']);
  // 10: quantidade decimal só sinalizada
  assert.equal(m['900'].quantidade_decimal, true);
  assert.equal(n(m['900'].quantidade), r2(29 * 0.355 * 1000) / 1000);
  assert.equal(m['100'].quantidade_decimal, false);
  // 11: 100 aparece em A (2 un) e 2x em C -> 3 linhas/dia, 2 vendas/dia
  assert.equal(n(m['100'].quantidade), 116);
  assert.equal(Number(m['100'].linhas), 87);
  assert.equal(Number(m['100'].vendas), 58);
  assert.equal(n(m['100'].bruto), 406);
  // 12: mesma descrição, códigos distintos
  assert.equal(m['311'].descricao, m['341'].descricao);
  assert.equal(m['311'].descricao_compartilhada, true);
  assert.equal(m['341'].descricao_compartilhada, true);
  assert.equal(m['100'].descricao_compartilhada, false);
  // bruto dos produtos = bruto das vendas CONCILIADAS (15/07 sem itens fica fora e é contada)
  const total = r2(p.reduce((a, l) => a + n(l.bruto), 0));
  assert.equal(total, r2(ESPERADO.bruto - 5));
  assert.equal(n(r.totais.bruto_total_periodo), total);
  assert.equal(Number(r.totais.vendas_excluidas_nao_conciliadas), 1);
  assert.equal(r.paginacao.total_linhas, 5);
  assert.equal(r.cobertura.dias_validos, 30);
  assert.equal(r2(p.reduce((a, l) => a + n(l.participacao), 0)), 1);
  assert.equal(n(m['200'].preco_medio), 4);
});

test('13/14. produtos por horário: soma do ITEM por hora (sem duplicar a venda); fuso America/Sao_Paulo', async () => {
  const db = await principal();
  const ph = await admin(db, "select * from public.bi_produtos_horario($1,$2,0::smallint,23::smallint,'bruto',50)", ['2026-07-09', '2026-08-09']);
  const porHora = {};
  for (const l of ph) porHora[l.hora] = r2((porHora[l.hora] ?? 0) + n(l.bruto));
  assert.equal(porHora[7], r2(29 * 11), 'hora 7 = itens da venda A');
  assert.equal(porHora[18], r2(29 * 13.6), 'hora 18 = itens de C (13,60), não 3x o total da venda');
  assert.equal(porHora[23], 8, '31/07 23:50 na hora 23');
  assert.equal(r2(Object.values(porHora).reduce((a, b) => a + b, 0)), r2(ESPERADO.bruto - 5));
  const h100 = ph.filter((l) => l.codigo === '100');
  assert.deepEqual(h100.map((l) => l.hora).sort((a, b) => a - b), [7, 18]);
  assert.equal(Number(ph.find((l) => l.codigo === '100' && l.hora === 18).vendas), 29, 'repetido na venda conta 1');
  assert.equal(Number(ph[0].dias_considerados), 30);
  // horários (vendas): hora 23 em 31/07 (sexta = 5)
  const h = await admin(db, 'select * from public.bi_horarios($1,$2)', ['2026-07-09', '2026-08-09']);
  const sexta23 = h.find((l) => l.dia_semana === 5 && l.hora === 23);
  assert.equal(Number(sexta23.vendas), 1);
  const todos7 = h.find((l) => l.dia_semana === null && l.hora === 7);
  assert.equal(Number(todos7.vendas), 29);
  assert.equal(Number(todos7.dias_considerados), 30);
  assert.equal(n(todos7.media_vendas_dia), r2(29 / 30));
  const domingo = await admin(db, 'select * from public.bi_horarios($1,$2,$3::smallint[])', ['2026-07-09', '2026-08-09', [0]]);
  assert.ok(domingo.every((l) => l.dia_semana === 0 || l.dia_semana === null));
});

// ---------------------------------------------------------------------------
// 15 a 19: comparativos
// ---------------------------------------------------------------------------

test('15. mês x mês com tamanhos diferentes: 31/10 sem par sai dos dois lados', async () => {
  const db = await meses();
  const c = await adminValor(db, "select public.bi_comparar('mes', null, $1)", ['2026-10-31'], HOJE_MESES);
  assert.equal(c.dias_pareaveis, 30);
  assert.equal(c.dias_comparados, 30);
  assert.equal(c.comparavel, true);
  assert.equal(c.atual.de, '2026-10-01');
  assert.equal(c.anterior.de, '2026-09-01');
  assert.equal(c.anterior.ate, '2026-09-30');
  assert.equal(n(c.atual.bruto), 360);
  assert.equal(n(c.anterior.bruto), 300);
  assert.equal(n(c.variacoes.bruto), 0.2);
  assert.equal(n(c.variacoes.vendas), 0);
});

test('16. cobertura mínima de 80%: 7/10 indisponível com motivo; 8/10 comparável', async () => {
  const db = await meses();
  await db.exec(`insert into public.bi_calendario_excecoes values
    ('2026-09-21', 'sem_operacao', 'teste'), ('2026-09-22', 'sem_operacao', 'teste'), ('2026-09-23', 'sem_operacao', 'teste')`);
  const c = await adminValor(db, "select public.bi_comparar('periodo', $1, $2)", ['2026-10-01', '2026-10-10'], HOJE_MESES);
  assert.equal(c.dias_pareaveis, 10);
  assert.equal(c.dias_comparados, 7);
  assert.equal(c.comparavel, false);
  assert.equal(c.motivo, 'cobertura_insuficiente');
  assert.equal(c.variacoes, null);
  assert.equal(c.pares_excluidos.length, 3);
  assert.equal(c.pares_excluidos[0].motivo, 'anterior_sem_operacao');
  // os dois lados somam só os dias comparados (7 x 7)
  assert.equal(n(c.atual.bruto), 84);
  assert.equal(n(c.anterior.bruto), 70);
  const db2 = await meses();
  await db2.exec(`insert into public.bi_calendario_excecoes values ('2026-09-21', 'sem_operacao', 'teste'), ('2026-09-22', 'sem_operacao', 'teste')`);
  const c2 = await adminValor(db2, "select public.bi_comparar('periodo', $1, $2)", ['2026-10-01', '2026-10-10'], HOJE_MESES);
  assert.equal(c2.cobertura, 0.8);
  assert.equal(c2.comparavel, true);
});

test('17. comparação com período anterior na pré-operação: indisponível', async () => {
  const db = await principal();
  const c = await adminValor(db, "select public.bi_comparar('mes', null, $1)", ['2026-08-09']);
  assert.equal(c.comparavel, false);
  assert.equal(c.motivo, 'periodo_anterior_pre_operacao');
  assert.equal(c.dias_pareaveis, 9);
});

test('18. semana x semana anterior, a partir de uma quarta-feira: pareia segunda..quarta', async () => {
  const db = await meses();
  const ate = '2026-10-14';
  const dow = new Date(`${ate}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const isoDow = dow === 0 ? 7 : dow;
  const c = await adminValor(db, "select public.bi_comparar('semana', null, $1)", [ate], HOJE_MESES);
  assert.equal(c.dias_pareaveis, isoDow);
  const seg = new Date(Date.parse(`${ate}T00:00:00Z`) - (isoDow - 1) * 86400000).toISOString().slice(0, 10);
  assert.equal(c.atual.de, seg);
  assert.equal(c.anterior.de, new Date(Date.parse(`${seg}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10));
  assert.equal(c.comparavel, true);
});

test('19. comparar a quantidade registrada do MESMO produto entre períodos', async () => {
  const db = await meses();
  const c = await adminValor(db, "select public.bi_comparar('mes', null, $1, '500')", ['2026-10-31'], HOJE_MESES);
  assert.equal(c.codigo, '500');
  assert.equal(n(c.atual.quantidade), 60);
  assert.equal(n(c.anterior.quantidade), 30);
  assert.equal(n(c.variacoes.quantidade), 1);
  assert.equal(c.atual.liquido, undefined, 'produto não tem líquido');
});

// ---------------------------------------------------------------------------
// 20 a 23: filtros, ordenação, paginação, validações
// ---------------------------------------------------------------------------

test('20. filtros: códigos, busca (com curingas escapados), dias da semana; inválidos dão 22023', async () => {
  const db = await principal();
  const per = ['2026-07-09', '2026-08-09'];
  const sel = await produtos(db, "$1,$2,array['311','900'],null,'codigo','asc',50,0", per);
  assert.deepEqual(sel.produtos.map((l) => l.codigo), ['311', '900']);
  assert.equal(n(sel.totais.bruto_total_periodo), r2(ESPERADO.bruto - 5), 'participação continua sobre o período inteiro');
  const busca = await produtos(db, "$1,$2,null,'ovo','codigo','asc',50,0", per);
  assert.deepEqual(busca.produtos.map((l) => l.codigo), ['311', '341']);
  const curinga = await produtos(db, "$1,$2,null,'%_','codigo','asc',50,0", per);
  assert.equal(curinga.produtos.length, 0, '% e _ são literais na busca');
  assert.equal(curinga.paginacao.total_linhas, 0);
  const codigo = await produtos(db, "$1,$2,null,'200','codigo','asc',50,0", per);
  assert.deepEqual(codigo.produtos.map((l) => l.codigo), ['200']);
  const serieProd = await admin(db, "select * from public.bi_produto_serie(array['100','999'],$1,$2,'semana')", per);
  assert.ok(serieProd.some((l) => l.codigo === '999' && n(l.bruto) === 0), 'código sem vendas: zero nos períodos cobertos');
  for (const [sql, params] of [
    ["select * from public.bi_horarios($1,$2,$3::smallint[])", [...per, [7]]],
    ["select * from public.bi_produto_serie(array['1','2','3','4','5','6'],$1,$2,'dia')", per],
    ["select * from public.bi_produto_serie(array['1','1'],$1,$2,'dia')", per],
    ["select * from public.bi_produtos($1,$2,null,'x','bruto','desc',10,0)", per],
    ["select * from public.bi_serie($1,$2,'ano')", per],
    ["select * from public.bi_produtos_horario($1,$2,10::smallint,9::smallint,'bruto',10)", per],
    ["select public.bi_comparar('trimestre', null, $1)", ['2026-08-09']],
  ]) {
    const e = await erroDe(admin(db, sql, params));
    assert.equal(e?.code, '22023', sql);
  }
});

test('21. ordenação sobre o conjunto INTEIRO antes da paginação, nos dois sentidos, com desempate estável', async () => {
  const db = await principal();
  const per = ['2026-07-09', '2026-08-09'];
  const colunas = { codigo: 'codigo', descricao: 'descricao', quantidade: 'quantidade', vendas: 'vendas', linhas: 'linhas',
    bruto: 'bruto', participacao: 'participacao', preco_medio: 'preco_medio' };
  for (const ordem of Object.keys(colunas)) {
    for (const dir of ['asc', 'desc']) {
      const rt = await produtos(db, '$1,$2,null,null,$3,$4,500,0', [...per, ordem, dir]);
      const tudo = rt.produtos;
      const pag = [];
      for (let off = 0; off < 5; off += 2) {
        const pg = await produtos(db, '$1,$2,null,null,$3,$4,2,$5', [...per, ordem, dir, off]);
        assert.equal(pg.paginacao.tem_mais, off + 2 < 5);
        pag.push(...pg.produtos);
      }
      assert.deepEqual(pag.map((l) => l.codigo), tudo.map((l) => l.codigo), `${ordem} ${dir}: páginas = conjunto`);
      assert.equal(rt.paginacao.total_linhas, 5);
      const chave = (l) => (['codigo', 'descricao'].includes(ordem) ? null : n(l[colunas[ordem]]));
      if (chave(tudo[0]) !== null) {
        for (let i = 1; i < tudo.length; i += 1) {
          const a = chave(tudo[i - 1]); const b = chave(tudo[i]);
          assert.ok(dir === 'asc' ? a <= b : a >= b, `${ordem} ${dir} fora de ordem`);
          if (a === b) assert.ok(tudo[i - 1].codigo.padStart(18, '0') < tudo[i].codigo.padStart(18, '0'), 'desempate por código');
        }
      }
    }
  }
  const cod = (await produtos(db, "$1,$2,null,null,'codigo','desc',500,0", per)).produtos;
  assert.deepEqual(cod.map((l) => l.codigo), ['900', '341', '311', '200', '100']);
});

test('22. ordem fora da lista / injeção / limites inválidos: erro 22023, sem fallback silencioso', async () => {
  const db = await principal();
  const per = ['2026-07-09', '2026-08-09'];
  for (const [ordem, dir, lim, off] of [
    ['bruto; drop table public.bi_calendario_regras', 'desc', 10, 0], ['custo', 'desc', 10, 0],
    ['bruto', 'DESC', 10, 0], ['bruto', 'desc', 0, 0], ['bruto', 'desc', 501, 0], ['bruto', 'desc', 10, -1],
    ['bruto', 'desc', 10, 100001], [null, 'desc', 10, 0],
  ]) {
    const e = await erroDe(admin(db, 'select * from public.bi_produtos($1,$2,null,null,$3,$4,$5,$6)', [...per, ordem, dir, lim, off]));
    assert.equal(e?.code, '22023', `${ordem}/${dir}/${lim}/${off}`);
  }
  assert.equal(Number(await valor(db, 'select count(*) from public.bi_calendario_regras')), 1);
});

test('23. período: maior que o máximo, inicial depois da final, nulo -> erro; inteiramente futuro -> vazio', async () => {
  const db = await principal();
  for (const [sql, params] of [
    ["select * from public.bi_serie($1,$2,'dia')", ['2025-01-01', '2026-02-05']], // 401 dias
    ['select public.bi_resumo($1,$2)', ['2021-01-01', '2026-01-05']], // > 1830
    ['select public.bi_resumo($1,$2)', ['2026-08-05', '2026-08-01']],
    ['select public.bi_resumo($1,$2)', [null, '2026-08-01']],
    ["select public.bi_comparar('periodo', $1, $2)", ['2025-01-01', '2026-08-01']],
  ]) {
    const e = await erroDe(admin(db, sql, params));
    assert.equal(e?.code, '22023', `${sql} ${params}`);
  }
  assert.equal((await admin(db, "select * from public.bi_serie($1,$2,'dia')", ['2026-09-01', '2026-09-30'])).length, 0);
  const pf = await produtos(db, '$1,$2', ['2026-09-01', '2026-09-30']);
  assert.equal(pf.motivo, 'periodo_futuro');
  assert.deepEqual(pf.produtos, []);
  const c = await adminValor(db, "select public.bi_comparar('periodo', $1, $2)", ['2026-09-01', '2026-09-30']);
  assert.equal(c.motivo, 'periodo_futuro');
});

// ---------------------------------------------------------------------------
// 24 e 25: acesso
// ---------------------------------------------------------------------------

const PUBLICAS = [
  ['select public.bi_status()', []],
  ['select * from public.bi_calendario($1,$2)', ['2026-07-09', '2026-07-10']],
  ['select public.bi_resumo($1,$2)', ['2026-07-09', '2026-07-10']],
  ["select * from public.bi_serie($1,$2,'dia')", ['2026-07-09', '2026-07-10']],
  ['select * from public.bi_produtos($1,$2)', ['2026-07-09', '2026-07-10']],
  ["select * from public.bi_produto_serie(array['100'],$1,$2,'dia')", ['2026-07-09', '2026-07-10']],
  ['select * from public.bi_horarios($1,$2)', ['2026-07-09', '2026-07-10']],
  ['select * from public.bi_produtos_horario($1,$2)', ['2026-07-09', '2026-07-10']],
  ["select public.bi_comparar('periodo',$1,$2)", ['2026-07-09', '2026-07-10']],
];

test('24. proprietario_admin ativo: todas as funções públicas respondem; status traz cobertura e período padrão', async () => {
  const db = await principal();
  for (const [sql, params] of PUBLICAS) await admin(db, sql, params);
  const s = await adminValor(db, 'select public.bi_status()');
  assert.equal(s.data_inicio_operacao, '2026-07-09');
  assert.equal(s.padrao_ate, '2026-08-09');
  assert.equal(s.padrao_de, '2026-08-03');
  const fat = s.relatorios.find((r) => r.layout === 'faturamento_geral');
  assert.equal(fat.ultimo_dia_completo, '2026-08-09');
  assert.equal(fat.dia_parcial, '2026-08-10');
  assert.equal(fat.hora_limite, '12:46');
  assert.ok(s.ultima_importacao_em);
  const regras = await admin(db, 'select * from public.bi_calendario_regras');
  assert.equal(regras.length, 1);
});

test('25. admin inativo, usuário comum (inclusive com permissões individuais) e anon: nada executa nem lê', async () => {
  const db = await principal();
  const INATIVO = '00000000-0000-0000-0000-0000000000aa';
  await db.exec(`insert into auth.users (id, email) values ('${INATIVO}', 'inativo@padoca.test');
    insert into public.usuarios (id, nome, email, perfil, ativo) values ('${INATIVO}', 'INATIVO', 'inativo@padoca.test', 'proprietario_admin', false);`);
  for (const uid of [INATIVO, GESTAO, RECEBEDOR]) {
    for (const [sql, params] of PUBLICAS) {
      const e = await erroDe(comoUsuario(db, uid, HOJE, () => db.query(sql, params)));
      assert.equal(e?.code, '42501', `${uid} ${sql}`);
    }
    const linhas = await comoUsuario(db, uid, HOJE, () => db.query('select * from public.bi_calendario_regras').then((r) => r.rows));
    assert.equal(linhas.length, 0, 'RLS esconde as regras');
  }
  // funções internas: nem o admin chama direto
  for (const sql of ["select * from public.bi_dias_int('2026-07-09','2026-07-10')", 'select public.bi_hoje_int()',
    "select * from public.bi_periodo_int('2026-07-09','2026-07-10', 10)"]) {
    const e = await erroDe(admin(db, sql));
    assert.equal(e?.code, '42501', sql);
  }
  // anon
  await db.exec('set role anon');
  try {
    for (const [sql, params] of [...PUBLICAS, ['select * from public.bi_calendario_regras', []], ['select * from public.bi_calendario_excecoes', []]]) {
      const e = await erroDe(db.query(sql, params));
      assert.equal(e?.code, '42501', `anon ${sql}`);
    }
  } finally {
    await db.exec('reset role');
  }
  // escrita direta nas tabelas do calendário: negada até para o admin logado
  const e = await erroDe(admin(db, "insert into public.bi_calendario_excecoes values ('2026-09-01', 'sem_operacao', 'x')"));
  assert.equal(e?.code, '42501');
});

// ---------------------------------------------------------------------------
// 26 a 31, 34: reimportação, reversão, coberturas desiguais, qualidade, fuso
// ---------------------------------------------------------------------------

test('26. reimportação corrigindo uma venda: o BI mostra o valor novo, sem duplicar; parcial vira completo', async () => {
  const db = await principal();
  const corr = { ...PERIODO_PRINCIPAL, gerado: '2026-08-11 09:00', vpAjuste: { '2026-07-22': 1 } };
  await carregar(db, relatorios(vendasPrincipais({ alterarVenda10Jul: true }), corr), 'correcao');
  const r = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-07-10', '2026-07-10']);
  assert.equal(n(r.registrado.bruto), r2(36.99 + 3.5));
  assert.equal(r.registrado.vendas, 3);
  const cal = porDia(await admin(db, 'select * from public.bi_calendario($1,$2)', ['2026-08-10', '2026-08-11']));
  assert.equal(cal['2026-08-10'].classe_vendas, 'completo');
  assert.equal(cal['2026-08-11'].classe_vendas, 'parcial');
  assert.equal(cal['2026-08-11'].hora_limite_vendas, '09:00:00');
  const p = (await produtos(db, "$1,$2,array['100']", ['2026-07-10', '2026-07-10'])).produtos;
  assert.equal(n(p[0].quantidade), 5);
});

test('27. reversão do lote que cobria o período: dias viram sem_importacao, valores somem (não viram zero)', async () => {
  const db = await principal();
  const fat = await valor(db, "select id from public.g3_importacoes where layout = 'faturamento_geral' and status = 'confirmado'");
  await comoUsuario(db, ADMIN, '', () => db.query('select public.g3_reverter_importacao($1, $2)', [fat, 'teste de reversao']));
  const r = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-07-09', '2026-08-09']);
  assert.equal(r.registrado, null);
  assert.equal(r.dias.sem_importacao, 30);
  assert.equal(r.base_media.dias_validos, 0);
  assert.equal(r.base_media.bruto, null);
  const s = await admin(db, "select * from public.bi_serie($1,$2,'mes')", ['2026-07-09', '2026-08-09']);
  assert.ok(s.every((l) => l.bruto === null && l.cobertura === 'sem_dados'));
});

test('28/34. coberturas desiguais (itens até 05/08 10:00) e dia com pendência aberta', async () => {
  const db = await novo83();
  const vs = vendasPrincipais();
  vs.push({ numero: 9999, dataHora: '2026-08-03 16:00', itens: [], semItens: true, prod: 5, liquidoErrado: 4 });
  await carregar(db, relatorios(vs, { ...PERIODO_PRINCIPAL, gerado_vpc: '2026-08-05 10:00', vpcAte: '2026-08-05 10:00' }), 'desigual');
  const cal = porDia(await admin(db, 'select * from public.bi_calendario($1,$2)', ['2026-08-01', '2026-08-07']));
  assert.equal(cal['2026-08-04'].classe_vendas, 'completo');
  assert.equal(cal['2026-08-04'].classe_itens, 'completo');
  assert.equal(cal['2026-08-05'].classe_vendas, 'completo');
  assert.equal(cal['2026-08-05'].classe_itens, 'parcial');
  assert.equal(cal['2026-08-05'].hora_limite_itens, '10:00:00');
  assert.equal(cal['2026-08-06'].classe_vendas, 'completo');
  assert.equal(cal['2026-08-06'].classe_itens, 'sem_importacao');
  // 34: venda bloqueada (pendência) em 03/08
  assert.equal(cal['2026-08-03'].classe_vendas, 'com_pendencias');
  assert.equal(cal['2026-08-03'].entra_media_vendas, false);
  const r = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-08-03', '2026-08-03']);
  assert.equal(r.registrado.vendas, 3, 'mostra o que foi registrado');
  assert.equal(r.registrado.dias_com_pendencias, 1);
  assert.equal(r.base_media.dias_validos, 0);
  // produtos não usam dias sem cobertura de itens
  const p = await produtos(db, '$1,$2', ['2026-08-06', '2026-08-09']);
  assert.equal(p.produtos.length, 0);
  assert.equal(p.totais.bruto_total_periodo, null, 'sem cobertura de itens: nulo, nunca zero');
  assert.equal(p.cobertura.sem_importacao, 4);
  // comparativo só com a mesma base
  const c = await adminValor(db, "select public.bi_comparar('periodo', $1, $2, '100')", ['2026-08-06', '2026-08-09']);
  assert.equal(c.comparavel, false);
});

test('29. venda não conciliada: entra no faturamento, sai de produtos e é contada', async () => {
  const db = await principal();
  const r = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-07-15', '2026-07-15']);
  assert.equal(r.registrado.vendas, 4);
  assert.equal(n(r.registrado.bruto), r2(36.99 + 5));
  assert.equal(r.qualidade.vendas_nao_conciliadas, 1);
  assert.equal(n(r.qualidade.bruto_nao_conciliado), 5);
  const p = (await produtos(db, '$1,$2', ['2026-07-15', '2026-07-15'])).produtos;
  assert.equal(r2(p.reduce((a, l) => a + n(l.bruto), 0)), 36.99);
});

test('30. Vendas_Periodo diferente da soma das vendas: alerta_vp, valores continuam do FaturamGeral', async () => {
  const db = await principal();
  const cal = porDia(await admin(db, 'select * from public.bi_calendario($1,$2)', ['2026-07-21', '2026-07-22']));
  assert.equal(cal['2026-07-22'].alerta_vp, true);
  assert.equal(cal['2026-07-21'].alerta_vp, false);
  const r = await adminValor(db, 'select public.bi_resumo($1,$2)', ['2026-07-22', '2026-07-22']);
  assert.equal(n(r.registrado.bruto), 36.99);
  assert.equal(r.qualidade.dias_alerta_vp, 1);
});

test('31. fuso: venda às 23:50 de 31/07 conta em 31/07, hora 23', async () => {
  const db = await principal();
  const s = await admin(db, "select * from public.bi_serie($1,$2,'dia')", ['2026-07-31', '2026-08-01']);
  assert.equal(n(s[0].bruto), r2(36.99 + 8));
  assert.equal(n(s[1].bruto), 36.99);
  const h = await admin(db, 'select * from public.bi_horarios($1,$2)', ['2026-07-31', '2026-07-31']);
  assert.equal(Number(h.find((l) => l.dia_semana === null && l.hora === 23).vendas), 1);
  assert.equal(Number(h.find((l) => l.dia_semana === null && l.hora === 2).vendas), 0);
});

test('mês de julho: identificado como início da operação, cobertura parcial e dias explicados', async () => {
  const db = await principal();
  const s = await admin(db, "select * from public.bi_serie($1,$2,'mes')", ['2026-07-09', '2026-08-09']);
  const jul = s[0];
  assert.equal(jul.mes_inicio_operacao, true);
  assert.equal(jul.cobertura, 'parcial');
  assert.equal(Number(jul.dias_calendario), 31);
  assert.equal(Number(jul.dias_pre_operacao), 8);
  assert.equal(Number(jul.dias_nao_confirmados), 2);
  assert.equal(Number(jul.dias_validos), 21);
  assert.equal(s[1].mes_inicio_operacao, false);
  assert.equal(Number(s[1].dias_fora_periodo), 3, 'agosto: 10 a 12 fora do período pedido');
  assert.equal(Number(s[1].dias_futuros), 19, 'agosto: 13 a 31 no futuro');
});

// ---------------------------------------------------------------------------
// 32: estrutura -- a 0083 só cria objetos bi_*; atomicidade no SQL Editor
// ---------------------------------------------------------------------------

const RETRATO = `
  select 'f:' || p.oid::regprocedure::text || '|' || md5(replace(p.prosrc, chr(13), '')) || '|' || coalesce(p.proacl::text, '')
         || '|' || p.prosecdef || '|' || coalesce(p.proconfig::text, '') as x
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname not like 'bi\\_%'
  union all
  select 't:' || c.relname || '|' || coalesce(c.relacl::text, '') || '|' || c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname not like 'bi\\_%'
  union all
  select 'p:' || c.relname || '|' || pol.polname || '|' || pg_get_expr(pol.polqual, pol.polrelid)
  from pg_policy pol join pg_class c on c.oid = pol.polrelid where c.relname not like 'bi\\_%'
  union all
  select 'g:' || tgname || '|' || tgrelid::regclass::text from pg_trigger where not tgisinternal and tgname not like 'bi\\_%'
  order by 1`;

test('32. a 0083 só cria objetos bi_*: nada existente muda (0082 intacta); sem UPDATE/DELETE', async () => {
  const db = await bancoSem83();
  const antes = (await db.query(RETRATO)).rows.map((r) => r.x);
  await aplicarMigration(db, M83);
  const depois = (await db.query(RETRATO)).rows.map((r) => r.x);
  assert.deepEqual(depois, antes);
  assert.equal(await valor(db, "select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('public.g3_analisar(uuid)')"),
    '05e3f84a8e1ebbd2545e3f6a2edd1a04');
  const novos = (await db.query(`select c.relname as x from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'bi\\_%' and c.relkind = 'r' order by 1`)).rows.map((r) => r.x);
  assert.deepEqual(novos, ['bi_calendario_excecoes', 'bi_calendario_regras']);
  assert.equal(Number(await valor(db, "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'bi\\_%'")), 13);
  assert.deepEqual(comandosSemWhere(lerMigration(M83)), []);
  const semComentarios = lerMigration(M83).replace(/--[^\n]*/g, '');
  assert.doesNotMatch(semComentarios, /\bupdate\s+[\w."]+\s+set\b/i, 'nenhum UPDATE');
  assert.doesNotMatch(semComentarios, /\bdelete\s+from\b/i, 'nenhum DELETE');
  // reaplicar é barrado pela guarda, sem alterar nada
  const e = await erroDe(aplicarMigration(db, M83));
  assert.match(String(e?.message), /ja parece aplicada/);
});

test('32b. modo SQL Editor (instrução por instrução): a 0083 é atômica -- aplica tudo ou nada', async () => {
  const db = await bancoSem83();
  const r = await executarComoEditorPorInstrucao(db, lerMigration(M83));
  assert.equal(r.erro, null, String(r.erro?.message));
  assert.deepEqual(r.executadas, ['ok']);
  // falha forçada na conferência final: nada fica criado
  const ruim = await bancoSem83();
  const corrompida = lerMigration(M83).replace('if v_n <> 13 then', 'if v_n <> 99 then');
  const r2x = await executarComoEditorPorInstrucao(ruim, corrompida);
  assert.match(String(r2x.erro?.message), /conferencia/);
  assert.equal(Number(await valor(ruim, "select count(*) from pg_class where relname like 'bi\\_%'")), 0);
  assert.equal(Number(await valor(ruim, "select count(*) from pg_proc where proname like 'bi\\_%'")), 0);
  // sem a 0082: aborta antes de criar
  const sem82 = await fabricaDeBancos({ extras: BASE.slice(0, 5) })();
  const e = await erroDe(aplicarMigration(sem82, M83));
  assert.match(String(e?.message), /0082/);
});

test('PRE/POS da raiz rodam (somente leitura) e o EXECUTAR é byte-idêntico à migration', async (t) => {
  if (!existsSync(PRE) || !existsSync(POS) || !existsSync(EXECUTAR)) {
    t.skip('arquivos PRE/POS/EXECUTAR ausentes nesta cópia (não versionados)');
    return;
  }
  assert.ok(readFileSync(EXECUTAR).equals(readFileSync(join(RAIZ, 'supabase', 'migrations', M83))), 'EXECUTAR difere da migration');
  const falhas = (rows) => rows.filter((r) => r.status === 'FALHA').map((r) => `${r.verificacao}: ${r.detalhe}`);
  const db = await bancoSem83();
  const pre = (await db.query(readFileSync(PRE, 'utf8'))).rows;
  assert.deepEqual(falhas(pre), [], 'PRE antes da 0083');
  await aplicarMigration(db, M83);
  const pos = (await db.query(readFileSync(POS, 'utf8'))).rows;
  assert.deepEqual(falhas(pos), [], 'POS depois da 0083');
  const preDepois = (await db.query(readFileSync(PRE, 'utf8'))).rows;
  assert.ok(falhas(preDepois).length > 0, 'PRE depois da 0083 acusa "já aplicada"');
  // POS sem a 0083: a consulta é recusada (objetos bi_* inexistentes)
  const ePos = await erroDe((await bancoSem83()).query(readFileSync(POS, 'utf8')));
  assert.ok(['42P01', '42883'].includes(ePos?.code), `POS sem a 0083 não roda (${ePos?.code})`);
  console.log('[0083 POS]', pos.map((r) => `${r.status} ${r.verificacao}`).join(' | '));
});

// Utilitário exportado para depuração manual (não é teste).
export { dias };
