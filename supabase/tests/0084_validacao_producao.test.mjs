// Confere LOCALMENTE (PGlite, dados FICTICIOS) os arquivos SQL de homologacao
// da 0084 em producao (0084_validacao_*_EXECUTAR.sql, na raiz): uma unica
// instrucao cada (o SQL Editor roda instrucao por instrucao), admin simulado
// so dentro dela, nada fica na sessao, nenhuma FALHA num banco correto.
// Nada aqui toca o Supabase. Os arquivos da raiz nao sao versionados: sem
// eles, os testes sao pulados.
//
//   node --test --test-concurrency=1 supabase/tests/0084_validacao_producao.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ, como, fabricaDeBancos, fecharBancos } from './ambiente_pedidos.mjs';
import { dividirInstrucoes } from './editorSql.mjs';
import { HOJE_BI_TESTE, carregar, relatorios, vendasPrincipais, PERIODO_PRINCIPAL } from './bi_cenarios.mjs';

const { PGlite } = await import('@electric-sql/pglite');

const BASE = ['0073_contas_pagar.sql', '0074_sacos_ajuste_estoque.sql', '0075_preferencias_usuario_mensagem_pedido.sql',
  '0080_central_notificacoes.sql', '0081_importacoes_g3.sql', '0082_g3_analisar_where.sql', '0083_bi_gerencial.sql',
  '0084_bi_complementar.sql'];
const fabrica = fabricaDeBancos({ extras: BASE });
const HOJE = '2026-08-12';
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
  await como(db, '', { hoje: HOJE });
  return db;
}
const arquivo = (n) => join(RAIZ, n);
function instrucaoUnica(nome) {
  const instr = dividirInstrucoes(readFileSync(arquivo(nome), 'utf8'));
  assert.equal(instr.length, 1, `${nome}: deve ter exatamente 1 instrucao (tem ${instr.length})`);
  return instr[0];
}
async function sessaoLimpa(db) {
  const r = await db.query(`select coalesce(current_setting('request.jwt.claims', true), '') as c,
                                   coalesce(current_setting('request.jwt.claim.sub', true), '') as s,
                                   current_setting('transaction_read_only') as ro, current_user as u`);
  return r.rows[0];
}

const FUNCIONAL = '0084_validacao_1_funcional_EXECUTAR.sql';
test(`${FUNCIONAL}: 1 instrucao, nenhuma FALHA, nada fica na sessao, idempotente`, { skip: !existsSync(arquivo(FUNCIONAL)) }, async () => {
  const db = await banco();
  const sql = instrucaoUnica(FUNCIONAL);
  const { rows } = await db.query(sql);
  console.log(`\n=== ${FUNCIONAL}`);
  for (const l of rows) console.log(`${l.ordem} | ${l.status} | ${l.verificacao} | ${l.detalhe}`);
  assert.equal(rows[0].status, 'OK');
  assert.ok(rows.length >= 19);
  for (const l of rows) assert.ok(['OK', 'INFO'].includes(l.status), `${l.ordem} ${l.verificacao}: ${l.status} -- ${l.detalhe}`);
  const s = await sessaoLimpa(db);
  assert.equal(s.c, '');
  assert.equal(s.s, '');
  assert.equal(s.ro, 'off');
  const de_novo = await db.query(sql);
  assert.deepEqual(de_novo.rows.map((l) => l.status), rows.map((l) => l.status));
});

test(`${FUNCIONAL}: acusa FALHA se uma funcao v2 divergir da v1 (detector funciona)`, { skip: !existsSync(arquivo(FUNCIONAL)) }, async () => {
  // so no banco de teste: bi_resumo_v2 "quebrada" (soma 1 centavo ao bruto da base)
  const mig = readFileSync(join(RAIZ, 'supabase', 'migrations', '0084_bi_complementar.sql'), 'utf8');
  const ini = mig.indexOf('create function public.bi_resumo_v2');
  const fim = mig.indexOf('$fn$\n  $ddl$;', ini);
  const corpo = mig.slice(ini, fim + 4).replace(/\r/g, '')
    .replace('create function public.bi_resumo_v2', 'create or replace function public.bi_resumo_v2')
    .replace("'bruto', case when a.dias_med > 0 then coalesce(a.bruto_m, 0) end", "'bruto', case when a.dias_med > 0 then coalesce(a.bruto_m, 0) + 0.01 end");
  const db = await banco({ extra: corpo });
  const { rows } = await db.query(instrucaoUnica(FUNCIONAL));
  const falhas = rows.filter((l) => l.status === 'FALHA').map((l) => l.ordem);
  assert.ok(falhas.includes(2), `E1 deveria falhar: ${falhas}`);
  assert.ok(falhas.includes(7), `F1 deveria falhar: ${falhas}`);
});

test(`${FUNCIONAL}: sem proprietario_admin ativo, contexto FALHA e nenhuma RPC roda`, { skip: !existsSync(arquivo(FUNCIONAL)) }, async () => {
  const db = await banco({ extra: `alter table public.usuarios disable trigger user;
    update public.usuarios set ativo = false where perfil = 'proprietario_admin';` });
  const { rows } = await db.query(instrucaoUnica(FUNCIONAL));
  assert.equal(rows[0].status, 'FALHA');
});

const DESEMPENHO = '0084_validacao_3_desempenho_EXECUTAR.sql';
test(`${DESEMPENHO}: 1 instrucao, mede as 7 RPCs novas`, { skip: !existsSync(arquivo(DESEMPENHO)) }, async () => {
  const db = await banco();
  const { rows } = await db.query(instrucaoUnica(DESEMPENHO));
  console.log(`\n=== ${DESEMPENHO}`);
  for (const l of rows) console.log(`${l.ordem} | ${l.status} | ${l.rpc} | ${l.parametros} | ${l.periodo} | ${l.ms} ms | ${l.registros}`);
  const rpcs = new Set(rows.map((l) => l.rpc));
  for (const f of ['bi_resumo_v2', 'bi_serie_v2', 'bi_produtos_v2', 'bi_produto_serie_v2', 'bi_produtos_horario_v2',
    'bi_produto_horarios', 'bi_comparar_periodos']) assert.ok(rpcs.has(f), f);
  for (const l of rows) {
    assert.ok(['OK', 'ACIMA_DA_META', 'INFO'].includes(l.status), `${l.rpc} ${l.parametros}: ${l.status}`);
  }
  assert.equal((await sessaoLimpa(db)).c, '');
});

const SEGURANCA = '0084_validacao_2_seguranca_EXECUTAR.sql';
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
test(`${SEGURANCA}: aprovada num banco correto`, { skip: !existsSync(arquivo(SEGURANCA)) }, async () => {
  const msg = await rodarSeguranca(await banco());
  assert.match(msg, /^VALIDACAO_SEGURANCA: APROVADA/);
  assert.match(msg, /16\/16 permitidas/);
  assert.match(msg, /5\/5 bloqueadas/);
});
test(`${SEGURANCA}: reprova se uma RPC nova ficar aberta para outro perfil`, { skip: !existsSync(arquivo(SEGURANCA)) }, async () => {
  const db = await banco();
  await db.exec(`create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo = true) $$;`);
  assert.match(await rodarSeguranca(db), /^VALIDACAO_SEGURANCA: REPROVADA/);
});
test(`${SEGURANCA}: reprova se uma funcao interna da 0084 ficar executavel`, { skip: !existsSync(arquivo(SEGURANCA)) }, async () => {
  const db = await banco({ extra: 'grant execute on function public.bi_dias_valores_int(date, date) to authenticated;' });
  assert.match(await rodarSeguranca(db), /^VALIDACAO_SEGURANCA: REPROVADA/);
});
