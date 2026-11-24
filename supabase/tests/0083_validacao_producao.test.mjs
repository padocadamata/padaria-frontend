// Confere LOCALMENTE (PGlite, dados FICTICIOS) os arquivos SQL de validacao
// da 0083 em producao (0083_validacao_*_EXECUTAR.sql, na raiz). Cada arquivo
// precisa: ser uma unica instrucao (o SQL Editor roda instrucao por
// instrucao), simular o admin so dentro dela, nao deixar nada na sessao e
// nao acusar FALHA num banco correto. Nada aqui toca o Supabase.
//
//   node --test --test-concurrency=1 supabase/tests/0083_validacao_producao.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN, RAIZ, como, fabricaDeBancos, fecharBancos } from './ambiente_pedidos.mjs';
import { dividirInstrucoes } from './editorSql.mjs';
import { HOJE_BI_TESTE, carregar, relatorios, vendasPrincipais, PERIODO_PRINCIPAL } from './bi_cenarios.mjs';

const { PGlite } = await import('@electric-sql/pglite');

const BASE = ['0073_contas_pagar.sql', '0074_sacos_ajuste_estoque.sql', '0075_preferencias_usuario_mensagem_pedido.sql',
  '0080_central_notificacoes.sql', '0081_importacoes_g3.sql', '0082_g3_analisar_where.sql', '0083_bi_gerencial.sql'];
const fabrica = fabricaDeBancos({ extras: BASE });
const HOJE = '2026-08-12';

// auth.uid() como no Supabase: le request.jwt.claim.sub ou request.jwt.claims.
const AUTH_UID_SUPABASE = `
  create or replace function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
  $$;
`;

const abertos = new Set();
after(async () => {
  for (const db of abertos) { try { await db.close(); } catch { /* fechado */ } }
  await fecharBancos();
});

let snapshot;
async function banco({ extra } = {}) {
  if (!snapshot) {
    const db = await fabrica();
    await db.exec(HOJE_BI_TESTE);
    await carregar(db, relatorios(vendasPrincipais(), { ...PERIODO_PRINCIPAL, vpAjuste: { '2026-07-22': 1 } }), 'principal');
    await db.exec(AUTH_UID_SUPABASE);
    snapshot = await db.dumpDataDir('none');
  }
  const db = new PGlite({ loadDataDir: snapshot });
  await db.waitReady;
  abertos.add(db);
  if (extra) await db.exec(extra);
  // sessao "limpa" como a do SQL Editor: sem usuario simulado, so o "hoje" de teste
  await como(db, '', { hoje: HOJE });
  return db;
}

const arquivo = (n) => join(RAIZ, n);
function instrucaoUnica(nome) {
  const sql = readFileSync(arquivo(nome), 'utf8');
  const instr = dividirInstrucoes(sql);
  assert.equal(instr.length, 1, `${nome}: deve ter exatamente 1 instrucao (tem ${instr.length})`);
  return instr[0];
}
async function sessaoLimpa(db) {
  const r = await db.query(`select coalesce(current_setting('request.jwt.claims', true), '') as c,
                                   coalesce(current_setting('request.jwt.claim.sub', true), '') as s,
                                   current_setting('transaction_read_only') as ro, current_user as u`);
  return r.rows[0];
}
function imprimir(nome, linhas) {
  console.log(`\n=== ${nome}`);
  for (const l of linhas) console.log(`${l.ordem ?? ''} | ${l.status ?? ''} | ${l.verificacao ?? ''} | ${l.detalhe ?? ''}`);
}

const SELECTS = [
  '0083_validacao_1_calendario_EXECUTAR.sql',
  '0083_validacao_2_indicadores_EXECUTAR.sql',
  '0083_validacao_3_produtos_EXECUTAR.sql',
  '0083_validacao_4_horarios_EXECUTAR.sql',
  '0083_validacao_5_comparativos_EXECUTAR.sql',
  '0083_validacao_8_produtos_codigos_EXECUTAR.sql',
];

for (const nome of SELECTS) {
  test(`${nome}: 1 instrucao, sem FALHA, nada fica na sessao`, { skip: !existsSync(arquivo(nome)) }, async () => {
    const db = await banco();
    const sql = instrucaoUnica(nome);
    const { rows } = await db.query(sql);
    imprimir(nome, rows);
    assert.ok(rows.length >= 2);
    assert.equal(rows[0].status, 'OK', 'contexto admin');
    for (const l of rows) {
      assert.ok(['OK', 'INFO', 'ATENCAO'].includes(l.status), `${l.ordem} ${l.verificacao}: ${l.status} -- ${l.detalhe}`);
      if (l.status === 'ATENCAO') assert.match(l.verificacao, /^Referencia/, `ATENCAO fora de referencia: ${l.verificacao}`);
    }
    const s = await sessaoLimpa(db);
    assert.equal(s.c, '');
    assert.equal(s.s, '');
    assert.equal(s.ro, 'off');
    // nada gravado: a mesma instrucao de novo da o mesmo resultado
    const de_novo = await db.query(sql);
    assert.deepEqual(de_novo.rows.map((l) => l.status), rows.map((l) => l.status));
  });
}

test('0083_validacao_8: 6 codigos e as 2 conferencias de participacao', { skip: !existsSync(arquivo(SELECTS[5])) }, async () => {
  const db = await banco();
  const { rows } = await db.query(instrucaoUnica(SELECTS[5]));
  assert.deepEqual(rows.map((l) => Number(l.ordem)), [1, 11, 12, 13, 14, 15, 16, 20, 21]);
  assert.ok(rows.every((l) => l.status === 'OK'));
  // 311 e 341 existem nos dados ficticios e entram no ranking; os demais nunca foram vendidos
  assert.match(rows[1].detalhe, /presente no ranking/);
  assert.match(rows[3].detalhe, /nunca vendido/);
});

test('0083_validacao_8: codigo vendido so antes da abertura aparece como ausente, com o motivo', { skip: !existsSync(arquivo(SELECTS[5])) }, async () => {
  // so no banco de teste: a venda de pre-operacao do 311 passa a ser do 312
  const db = await banco({ extra: `alter table public.g3_venda_itens disable trigger user;
    update public.g3_venda_itens i set codigo = '312'
    from public.g3_vendas g where g.numero = i.numero and i.codigo = '311' and g.data < date '2026-07-09';` });
  const { rows } = await db.query(instrucaoUnica(SELECTS[5]));
  assert.ok(rows.every((l) => l.status === 'OK'));
  const l312 = rows.find((l) => Number(l.ordem) === 13);
  assert.match(l312.detalhe, /ANTES da abertura: 1 vendas/);
  assert.match(l312.detalhe, /ranking BI: ausente/);
  assert.match(l312.detalhe, /vendido somente ANTES da abertura/);
});

test('sem proprietario_admin ativo: arquivo 1 acusa FALHA no contexto e nao chama RPC', { skip: !existsSync(arquivo(SELECTS[0])) }, async () => {
  // so no banco de teste: desliga a protecao do ultimo admin para montar o cenario
  const db = await banco({ extra: `alter table public.usuarios disable trigger user;
    update public.usuarios set ativo = false where perfil = 'proprietario_admin';` });
  const { rows } = await db.query(instrucaoUnica(SELECTS[0]));
  assert.equal(rows[0].status, 'FALHA');
  assert.ok(rows.some((l) => l.status === 'FALHA' && l.ordem > 1));
});

const DESEMPENHO = '0083_validacao_7_desempenho_EXECUTAR.sql';
test(`${DESEMPENHO}: 1 instrucao, mede as 9 RPCs`, { skip: !existsSync(arquivo(DESEMPENHO)) }, async () => {
  const db = await banco();
  const { rows } = await db.query(instrucaoUnica(DESEMPENHO));
  console.log(`
=== ${DESEMPENHO}`);
  for (const l of rows) console.log(`${l.ordem} | ${l.status} | ${l.rpc} | ${l.parametros} | ${l.periodo} | ${l.ms} ms | ${l.registros} | ${l.detalhe}`);
  const rpcs = new Set(rows.map((l) => l.rpc));
  for (const f of ['bi_status', 'bi_calendario', 'bi_resumo', 'bi_serie', 'bi_produtos', 'bi_produto_serie',
    'bi_horarios', 'bi_produtos_horario', 'bi_comparar']) assert.ok(rpcs.has(f), f);
  for (const l of rows) {
    assert.ok(Number(l.ms) >= 0, `${l.rpc} ${l.parametros}`);
    assert.ok(['OK', 'ACIMA_DA_META', 'INFO', 'FALHA'].includes(l.status), l.status);
    assert.notEqual(l.status, 'FALHA', `${l.rpc} ${l.parametros}: ${l.detalhe}`);
  }
  assert.equal((await sessaoLimpa(db)).c, '');
});

const EXPLAIN = '0083_validacao_7b_explain_EXECUTAR.sql';
test(`${EXPLAIN}: 1 instrucao EXPLAIN ANALYZE`, { skip: !existsSync(arquivo(EXPLAIN)) }, async () => {
  const db = await banco();
  const { rows } = await db.query(instrucaoUnica(EXPLAIN));
  const texto = rows.map((l) => Object.values(l)[0]).join('\n');
  console.log(`\n=== ${EXPLAIN}\n${texto}`);
  assert.match(texto, /Execution Time/);
  assert.equal((await sessaoLimpa(db)).c, '');
});

const SEGURANCA = '0083_validacao_6_seguranca_EXECUTAR.sql';
async function rodarSeguranca(db) {
  const sql = instrucaoUnica(SEGURANCA);
  let erro = null;
  try { await db.exec(sql); } catch (e) { erro = e; }
  assert.ok(erro, 'o bloco sempre termina com erro proposital (garante o rollback)');
  console.log(`\n=== ${SEGURANCA}\n${erro.message.split(' | ').join('\n')}`);
  const s = await sessaoLimpa(db);
  assert.equal(s.c, '');
  assert.equal(s.ro, 'off');
  assert.equal(s.u, 'postgres');
  return erro.message;
}
test(`${SEGURANCA}: aprovada num banco correto (sem admin inativo cadastrado)`, { skip: !existsSync(arquivo(SEGURANCA)) }, async () => {
  const db = await banco();
  const msg = await rodarSeguranca(db);
  assert.match(msg, /^VALIDACAO_SEGURANCA: APROVADA/);
  assert.match(msg, /usuario inexistente/);
});
test(`${SEGURANCA}: com admin inativo real cadastrado`, { skip: !existsSync(arquivo(SEGURANCA)) }, async () => {
  const db = await banco({ extra: `
    insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a2', 'inativo@padoca.test');
    insert into public.usuarios (id, nome, email, perfil, ativo)
    values ('00000000-0000-0000-0000-0000000000a2', 'ADMIN INATIVO', 'inativo@padoca.test', 'proprietario_admin', false);` });
  const msg = await rodarSeguranca(db);
  assert.match(msg, /^VALIDACAO_SEGURANCA: APROVADA/);
  assert.doesNotMatch(msg, /usuario inexistente/);
});
test(`${SEGURANCA}: reprova se um perfil nao admin conseguir executar`, { skip: !existsSync(arquivo(SEGURANCA)) }, async () => {
  const db = await banco();
  // simula uma regra de admin quebrada: qualquer usuario ativo passaria
  await db.exec(`create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo = true) $$;`);
  const msg = await rodarSeguranca(db);
  assert.match(msg, /^VALIDACAO_SEGURANCA: REPROVADA/);
});
