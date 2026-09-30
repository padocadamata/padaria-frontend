// Testes da migration 0064 (fecha as funcoes internas de Tarefas) sobre a
// 0061 + 0062 REAIS, em PostgreSQL embutido (PGlite), SIMULANDO os default
// privileges do Supabase (grant explicito de EXECUTE a anon/authenticated/
// service_role em toda funcao nova) -- o cenario que a 0062 nao cobriu.
//
//   npm i --no-save @electric-sql/pglite
//   node --test supabase/tests/0064_tarefas_fechar_funcoes_internas.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEFAULT_PRIVILEGES_SUPABASE, USUARIO, aplicar, comoUsuario, novoBanco, rpc } from './ambiente_tarefas.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lerRaiz = (arq) => readFileSync(join(raiz, arq), 'utf8');
const PRE = lerRaiz('0064_pre_auditoria_funcoes_internas_tarefas_EXECUTAR.sql');
const POS = lerRaiz('0064_pos_auditoria_funcoes_internas_tarefas_EXECUTAR.sql');
const M61 = '0061_folha_tarefas.sql';
const M62 = '0062_tarefas_execucoes.sql';
const M64 = '0064_tarefas_fechar_funcoes_internas.sql';

const TRIGGERS = [
  'tarefas_auditoria()', 'tarefas_regras_protecao()', 'tarefas_ocorrencias_protecao()',
  'tarefas_grupos_protecao()', 'tarefas_execucoes_protecao()', 'tarefas_execucoes_espelhar_ocorrencia()',
];

const IMPRESSAO = `select count(*)::text || ':' || coalesce(md5(string_agg(
  concat_ws('|', o.id, o.tarefa_id, o.data, o.origem, o.regra_id, o.posicao_programada, o.posicao,
            o.responsavel_nome, o.responsavel_avulso, o.ajustado_em, o.cancelada, o.concluida, o.concluido_em, o.concluido_por),
  ',' order by o.id)), '-') from public.tarefas_ocorrencias as o`;

async function bancoRealista() {
  const db = await novoBanco({ migrations: [M61, M62], hoje: '2026-09-29', preparacao: DEFAULT_PRIVILEGES_SUPABASE });
  await rpc(db, 'select public.programar_mes_tarefas($1::date, false)', ['2026-10-01']);
  await comoUsuario(db, { hoje: '2026-10-05' });
  return db;
}

test('reproduz o estado real: 6 funcoes de trigger expostas, 13 auxiliares fechadas', async () => {
  const db = await bancoRealista();
  const pre = (await db.query(PRE)).rows;
  const expostas = pre.filter((r) => r.categoria !== 'rpc_publica' && r.categoria !== 'RESUMO' && r.categoria !== 'INFO' && r.status === 'FALHA');
  assert.deepEqual(expostas.map((r) => r.assinatura.replace('public.', '')).sort(), [...TRIGGERS].sort());
  for (const r of expostas) {
    assert.equal(r.authenticated_explicito, true, r.assinatura);
    assert.equal(r.anon_explicito, true, r.assinatura);
    assert.equal(r.public_explicito, false, r.assinatura);
  }
  assert.equal(pre.filter((r) => r.categoria === 'auxiliar' && r.status === 'OK').length, 13);
  assert.equal(pre.filter((r) => r.categoria === 'rpc_publica' && r.status === 'INFO').length, 17);
  assert.equal(pre.find((r) => r.categoria === 'RESUMO').status, 'FALHA');
});

test('0064 fecha as 19 internas, preserva RPCs e dados, e e idempotente', async () => {
  const db = await bancoRealista();
  const impressaoAntes = await rpc(db, IMPRESSAO);
  const execAntes = await rpc(db, 'select count(*)::int from public.tarefas_ocorrencias_execucoes');

  await aplicar(db, M64);
  await aplicar(db, M64); // idempotente

  assert.equal(await rpc(db, IMPRESSAO), impressaoAntes, 'nenhuma ocorrencia alterada');
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_ocorrencias_execucoes'), execAntes);
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_ocorrencias'), 675);

  const pre = (await db.query(PRE)).rows;
  assert.equal(pre.find((r) => r.categoria === 'RESUMO').status, 'OK');
  assert.equal(pre.filter((r) => ['auxiliar', 'trigger'].includes(r.categoria) && r.status !== 'OK').length, 0);

  const pos = (await db.query(POS)).rows;
  const status = Object.fromEntries(pos.map((r) => [r.ordem, r.status]));
  for (const n of [1, 2, 3, 4, 5, 6, 7, 9, 10]) assert.equal(status[n], 'OK', `pos-auditoria linha ${n}: ${pos.find((r) => r.ordem === n).detalhe}`);
  // Linha 8 compara com a impressao do banco REAL; aqui os uuids sao outros.
  assert.equal(pos.find((r) => r.ordem === 8).detalhe, impressaoAntes);
  assert.equal(pos.find((r) => r.ordem === 9).detalhe, '2026-10: F1=225 F2=225 F3=225');

  // Dono continua com EXECUTE.
  assert.equal(await rpc(db, "select has_function_privilege(current_user, 'public.tarefas_auditoria()', 'execute')"), true);
});

test('como authenticated: RPCs e triggers funcionam; internas e triggers nao sao chamaveis', async () => {
  const db = await bancoRealista();
  await aplicar(db, M64);
  await comoUsuario(db, { hoje: '2026-10-05' });
  await db.exec('set role authenticated');
  try {
    assert.equal(await rpc(db, 'select current_user'), 'authenticated');
    const id = await rpc(db, "select id from public.tarefas_ocorrencias where data = '2026-10-06' order by id limit 1");
    // Execucao (trigger de auditoria + protecao + espelho disparam).
    const r = await rpc(db, 'select public.registrar_execucao_tarefa($1, $2)', [id, 'Laura']);
    assert.equal(r.ocorrencia.concluida, true);
    assert.equal(r.execucoes[0].criado_por, USUARIO);
    const r2 = await rpc(db, 'select public.renomear_execucao_tarefa($1, $2)', [r.execucoes[0].id, 'Laura Souza']);
    assert.equal(r2.execucoes[0].responsavel_nome, 'Laura Souza');
    const r3 = await rpc(db, 'select public.remover_execucao_tarefa($1)', [r.execucoes[0].id]);
    assert.equal(r3.ocorrencia.concluida, false);
    // Programacao/regras (auxiliares do motor + triggers de regras/ocorrencias).
    const previa = await rpc(db, "select public.programar_mes_tarefas('2026-11-01'::date, true)");
    assert.ok(previa.criadas > 0);
    const forno = await rpc(db, "select id from public.tarefas where descricao like 'Forno Pão de Queijo%'");
    const salvo = await rpc(db, 'select public.salvar_tarefa($1, $2, $3, null, null, $4, $5::smallint[], null, null, $6::date, null, false)',
      [forno, 'Forno Pão de Queijo', 'LIMPEZA', 'dias_semana', '{2}', '2026-10-06']);
    assert.ok(salvo.criadas > 0 && salvo.removidas > 0);
    const aj = await rpc(db, 'select to_jsonb(public.ajustar_ocorrencia_tarefa($1, 3::smallint, null))', [id]);
    assert.ok(aj.ajustado_em);
    await rpc(db, "select public.cancelar_ocorrencia_tarefa($1, 'teste')", [id]);
    await rpc(db, 'select public.restaurar_ocorrencia_tarefa($1)', [id]);

    // Internas e triggers fechadas.
    await assert.rejects(rpc(db, 'select public.tarefas_hoje()'), /permission denied/);
    await assert.rejects(rpc(db, "select public.tarefas_normalizar_texto('x')"), /permission denied/);
    await assert.rejects(rpc(db, 'select public.tarefas_auditoria()'), /permission denied|trigger functions can only be called as triggers/);
    await assert.rejects(rpc(db, 'select public.tarefas_execucoes_espelhar_ocorrencia()'), /permission denied|trigger functions can only be called as triggers/);
  } finally {
    await db.exec('reset role');
  }
});

test('0064 aborta (sem efeito) se faltar funcao interna', async () => {
  const db = await novoBanco({ migrations: [M61], hoje: '2026-09-29', preparacao: DEFAULT_PRIVILEGES_SUPABASE });
  await assert.rejects(aplicar(db, M64), /funcoes internas ausentes: .*tarefas_ocorrencia_com_execucoes/);
  await db.exec('rollback');
  // Nada foi revogado: a trigger da 0061 continua com o grant de antes.
  assert.equal(await rpc(db, "select has_function_privilege('authenticated', 'public.tarefas_auditoria()', 'execute')"), true);
});

test('0064 so contem REVOKE de privilegios (nenhum DDL/DML de dados ou logica)', () => {
  const sql = lerRaiz(join('supabase', 'migrations', M64)).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const comandos = sql.match(/^\s*(create|alter|drop|insert|update|delete|truncate|grant)\b/gim) || [];
  assert.deepEqual(comandos, []);
  const revokes = sql.match(/^revoke execute on function public\.\w+\([^)]*\) from public, anon, authenticated, service_role;$/gm) || [];
  assert.equal(revokes.length, 19);
  assert.equal(/programar_mes_tarefas|registrar_execucao_tarefa|salvar_tarefa\(/.test(sql.replace(/\$pos\$[\s\S]*?\$pos\$/, '')), false, 'nenhuma RPC publica tocada fora da verificacao');
});
