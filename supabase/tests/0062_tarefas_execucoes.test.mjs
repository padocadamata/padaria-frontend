// Testes de integracao da migration 0062 (execucoes por ocorrencia) sobre
// a 0061 REAL, em PostgreSQL embutido (PGlite). Nada toca o Supabase real.
//
// Como rodar (copia isolada do projeto, fora do Google Drive):
//   npm i --no-save @electric-sql/pglite
//   node --test supabase/tests/0062_tarefas_execucoes.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USUARIO, aplicar, comoUsuario, lerMigration, novoBanco, rpc } from './ambiente_tarefas.mjs';

const M61 = '0061_folha_tarefas.sql';
const M62 = '0062_tarefas_execucoes.sql';

const programar = (db, mes) => rpc(db, 'select public.programar_mes_tarefas($1::date, false)', [mes]);
const registrar = (db, id, nome = null) => rpc(db, 'select public.registrar_execucao_tarefa($1, $2)', [id, nome]);
const remover = (db, execId) => rpc(db, 'select public.remover_execucao_tarefa($1)', [execId]);
const ocorrencia = async (db, id) => (await db.query('select * from public.tarefas_ocorrencias where id = $1', [id])).rows[0];
const execucoes = async (db, id) => (await db.query('select * from public.tarefas_ocorrencias_execucoes where ocorrencia_id = $1 order by concluido_em, ordem', [id])).rows;
const idOcorrencia = async (db, data, prefixo = '') => (await db.query(
  `select o.id from public.tarefas_ocorrencias o join public.tarefas t on t.id = o.tarefa_id
    where o.data = $1 and t.descricao like $2 order by t.descricao limit 1`, [data, `${prefixo}%`])).rows[0].id;

async function fotografia(db) {
  return rpc(db, `select count(*)::text || ':' || md5(string_agg(
      concat_ws('|', id, tarefa_id, data, origem, regra_id, posicao_programada, posicao, responsavel_nome, responsavel_avulso,
                ajustado_em, cancelada, concluida, concluido_em, concluido_por, criado_em, atualizado_em), ',' order by id))
    from public.tarefas_ocorrencias`);
}

async function distribuicao(db, inicio, fim) {
  const rows = (await db.query('select posicao, count(*)::int n from public.tarefas_ocorrencias where data between $1 and $2 group by posicao order by posicao', [inicio, fim])).rows;
  return Object.fromEntries(rows.map((r) => [`F${r.posicao}`, r.n]));
}

async function bancoOutubro() {
  const db = await novoBanco({ migrations: [M61, M62], hoje: '2026-09-29' });
  await programar(db, '2026-10-01');
  await comoUsuario(db, { hoje: '2026-10-05' });
  return db;
}

// ---------------------------------------------------------------------------

test('compatibilidade: 0062 sobre Outubro ja programado e concluido pela 0061', async () => {
  const db = await novoBanco({ migrations: [M61], hoje: '2026-09-29' });
  await rpc(db, 'select public.definir_nome_posicao_tarefas(2::smallint, $1, $2::date, false)', ['Maria', '2026-10-01']);
  await programar(db, '2026-10-01');
  await comoUsuario(db, { hoje: '2026-10-10' });
  const concluidas = (await db.query("select id from public.tarefas_ocorrencias where data between '2026-10-01' and '2026-10-08' order by id limit 5")).rows.map((r) => r.id);
  for (const id of concluidas) await rpc(db, 'select public.marcar_conclusao_tarefa($1, true)', [id]);
  const cancelada = (await db.query("select id from public.tarefas_ocorrencias where data = '2026-10-09' order by id limit 1")).rows[0].id;
  await rpc(db, "select public.cancelar_ocorrencia_tarefa($1, 'teste')", [cancelada]);

  const antes = await fotografia(db);
  const distAntes = await distribuicao(db, '2026-10-01', '2026-10-31');
  const logsAntes = await rpc(db, 'select count(*)::int from public.logs_auditoria');

  await aplicar(db, M62);
  await comoUsuario(db, { hoje: '2026-10-10' });

  assert.equal(await fotografia(db), antes, 'ocorrencias existentes nao podem mudar em nada');
  const distDepois = await distribuicao(db, '2026-10-01', '2026-10-31');
  assert.deepEqual(distDepois, distAntes);
  console.log('OUTUBRO antes/depois da 0062', JSON.stringify(distAntes), JSON.stringify(distDepois));
  assert.deepEqual(distDepois, { F1: 225, F2: 225, F3: 225 });

  const migradas = (await db.query(`select e.*, o.concluido_em as oc_em, o.concluido_por as oc_por
    from public.tarefas_ocorrencias_execucoes e join public.tarefas_ocorrencias o on o.id = e.ocorrencia_id`)).rows;
  assert.equal(migradas.length, 5);
  for (const e of migradas) {
    assert.equal(e.ordem, 1);
    assert.equal(e.responsavel_nome, 'NÃO INFORMADO', 'legado migra com marcador sistemico');
    assert.equal(e.concluido_em.getTime(), e.oc_em.getTime());
    assert.equal(e.concluido_por, e.oc_por);
  }
  assert.equal(await rpc(db, 'select count(*)::int from public.logs_auditoria'), logsAntes, 'migracao nao gera log');

  // Reaplicar a 0062 e idempotente.
  await aplicar(db, M62);
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_ocorrencias_execucoes'), 5);
  assert.equal(await fotografia(db), antes);

  // Outubro nao e recriado.
  const r = await programar(db, '2026-10-01');
  assert.equal(r.criadas, 0);
  assert.equal(r.removidas, 0);
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_ocorrencias'), 675);
  // Ocorrencia migrada continua podendo receber a 2a execucao.
  const res = await registrar(db, concluidas[0], 'Sabrina');
  assert.equal(res.execucoes.length, 2);
});

test('execucoes: futura, 1a conclui, 2a permitida, 3a rejeitada (RPC e estrutura)', async () => {
  const db = await bancoOutubro();
  const id = await idOcorrencia(db, '2026-10-06', 'Forno Microondas');
  const antes = await ocorrencia(db, id);
  assert.ok(antes.data > new Date('2026-10-05T12:00:00'), 'ocorrencia futura em relacao a hoje');

  const r1 = await registrar(db, id, '  Laura  ');
  assert.equal(r1.ocorrencia.concluida, true, 'futura pode ser concluida');
  assert.equal(r1.execucoes.length, 1);
  assert.equal(r1.execucoes[0].responsavel_nome, 'Laura');
  assert.equal(r1.execucoes[0].concluido_por, USUARIO);
  assert.equal(r1.ocorrencia.concluido_por, USUARIO);

  const r2 = await registrar(db, id, 'Sabrina');
  assert.equal(r2.execucoes.length, 2);
  assert.deepEqual(r2.execucoes.map((e) => e.ordem), [1, 2]);
  await assert.rejects(registrar(db, id, 'Terceira'), /ja tem 2 execucoes/);

  // Estrutura: mesmo sem a RPC, ordem 3 e ordem repetida sao impossiveis.
  await assert.rejects(db.query("insert into public.tarefas_ocorrencias_execucoes (ocorrencia_id, ordem, responsavel_nome, concluido_em) values ($1, 3, 'Terceira', now())", [id]), /tarefas_execucoes_ordem_valida/);
  await assert.rejects(db.query("insert into public.tarefas_ocorrencias_execucoes (ocorrencia_id, ordem, responsavel_nome, concluido_em) values ($1, 1, 'Repetida', now())", [id]), /tarefas_execucoes_ocorrencia_ordem_unica/);

  // Programacao intacta; ocorrencia nao duplicada.
  const depois = await ocorrencia(db, id);
  assert.equal(depois.posicao, antes.posicao);
  assert.equal(depois.posicao_programada, antes.posicao_programada);
  assert.equal(depois.responsavel_nome, antes.responsavel_nome);
  assert.equal(depois.responsavel_avulso, antes.responsavel_avulso);
  assert.equal(depois.ajustado_em, null);
  assert.equal(await rpc(db, "select count(*)::int from public.tarefas_ocorrencias where tarefa_id = $1 and data = '2026-10-06'", [depois.tarefa_id]), 1);

  // Outra data futura, pelo caminho normal (nome obrigatorio).
  const outra = await idOcorrencia(db, '2026-10-20', 'Lavar e secar');
  const m = await registrar(db, outra, 'Vanessa');
  assert.equal(m.ocorrencia.concluida, true);
  assert.equal((await execucoes(db, outra)).length, 1);
});

test('remover individualmente: 1a mantendo 2a, 2a mantendo 1a, unica volta a pendente', async () => {
  const db = await bancoOutubro();
  const a = await idOcorrencia(db, '2026-10-05', 'Lavar e secar');
  const r = await registrar(db, a, 'Laura');
  await registrar(db, a, 'Sabrina');
  const [laura, sabrina] = await execucoes(db, a);
  const s = await remover(db, laura.id);
  assert.deepEqual(s.execucoes.map((e) => e.responsavel_nome), ['Sabrina']);
  assert.equal(s.ocorrencia.concluida, true);
  // concluido_em/_por passam a refletir a execucao restante
  assert.equal(new Date(s.ocorrencia.concluido_em).getTime(), new Date(sabrina.concluido_em).getTime());
  // vaga 1 livre e reaproveitada
  const s2 = await registrar(db, a, 'Vanessa');
  assert.deepEqual(s2.execucoes.map((e) => [e.responsavel_nome, e.ordem]), [['Sabrina', 2], ['Vanessa', 1]]);

  const b = await idOcorrencia(db, '2026-10-05', 'Limpeza do chão');
  await registrar(db, b, 'Laura');
  await registrar(db, b, 'Sabrina');
  const [, segunda] = await execucoes(db, b);
  const t = await remover(db, segunda.id);
  assert.deepEqual(t.execucoes.map((e) => e.responsavel_nome), ['Laura']);

  const c = await idOcorrencia(db, '2026-10-05', 'Tirar todos os lixos');
  const u = await registrar(db, c, 'Laura');
  assert.equal(u.ocorrencia.concluida, true);
  const v = await remover(db, u.execucoes[0].id);
  assert.equal(v.execucoes.length, 0);
  assert.equal(v.ocorrencia.concluida, false);
  assert.equal(v.ocorrencia.concluido_em, null);
  assert.equal(v.ocorrencia.concluido_por, null);
  await assert.rejects(remover(db, u.execucoes[0].id), /execucao nao encontrada/);

  // marcar false remove todas de uma vez (compatibilidade).
  const w = await rpc(db, 'select to_jsonb(public.marcar_conclusao_tarefa($1, false))', [a]);
  assert.equal(w.concluida, false);
  assert.equal((await execucoes(db, a)).length, 0);
  assert.ok(r);
});

test('renomear, nomes livres sem funcionarios e logs de inclusao/remocao', async () => {
  const db = await bancoOutubro();
  const id = await idOcorrencia(db, '2026-10-05', 'Guardar os bolos');
  const r = await registrar(db, id, 'Joana');
  const ren = await rpc(db, 'select public.renomear_execucao_tarefa($1, $2)', [r.execucoes[0].id, 'Joana (freelancer)']);
  assert.equal(ren.execucoes[0].responsavel_nome, 'Joana (freelancer)');
  await assert.rejects(rpc(db, "update public.tarefas_ocorrencias_execucoes set ordem = 2 where id = $1", [r.execucoes[0].id]), /imutaveis/);
  await remover(db, r.execucoes[0].id);

  const logs = (await db.query("select acao, campo, valor_anterior, valor_novo, usuario_id from public.logs_auditoria where entidade = 'tarefa_execucao' order by data_hora, acao")).rows;
  assert.deepEqual(logs.map((l) => l.acao).sort(), ['registrou', 'removeu', 'renomeou']);
  assert.ok(logs.every((l) => l.usuario_id === USUARIO));
  assert.match(logs.find((l) => l.acao === 'removeu').valor_anterior, /nome=Joana \(freelancer\)/);
  assert.equal(logs.find((l) => l.acao === 'renomeou').valor_anterior, 'Joana');

  // Nenhuma FK para funcionarios em nenhuma tabela de Tarefas.
  const fks = await rpc(db, `select count(*)::int from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_class r on r.oid = c.confrelid
    where c.contype = 'f' and t.relname like 'tarefas%' and r.relname = 'funcionarios'`);
  assert.equal(fks, 0);
});

test('cancelada continua protegida e sincronizacao preserva ocorrencia executada', async () => {
  const db = await bancoOutubro();
  const id = await idOcorrencia(db, '2026-10-07', 'Forno Pão de Queijo');
  await rpc(db, "select public.cancelar_ocorrencia_tarefa($1, 'manutencao')", [id]);
  await assert.rejects(registrar(db, id, 'Laura'), /cancelada nao pode ser concluida/);
  await assert.rejects(rpc(db, 'select public.marcar_conclusao_tarefa($1, true)', [id]), /cancelada/);
  await rpc(db, 'select public.restaurar_ocorrencia_tarefa($1)', [id]);
  await registrar(db, id, 'Laura');
  await assert.rejects(rpc(db, "select public.cancelar_ocorrencia_tarefa($1, 'x')", [id]), /desmarque/);

  // Mudar a regra do Forno a partir de 06/10: a ocorrencia executada em 07/10 fica.
  const forno = (await ocorrencia(db, id)).tarefa_id;
  const res = await rpc(db, 'select public.salvar_tarefa($1, $2, $3, null, null, $4, $5::smallint[], null, null, $6::date, null, false)',
    [forno, 'Forno Pão de Queijo', 'LIMPEZA', 'dias_semana', '{2}', '2026-10-06']);
  assert.ok(res.preservadas >= 1);
  assert.equal((await ocorrencia(db, id)).concluida, true);
  assert.equal((await execucoes(db, id)).length, 1);
});

test('permissoes: so tarefas.concluir registra/remove/renomeia; editar nao basta', async () => {
  const db = await bancoOutubro();
  const id = await idOcorrencia(db, '2026-10-05', 'Limpeza da chapa');
  await comoUsuario(db, { hoje: '2026-10-05', negar: 'tarefas.concluir' });
  await assert.rejects(registrar(db, id, 'Laura'), /tarefas\.concluir/);
  await comoUsuario(db, { hoje: '2026-10-05', negar: 'tarefas.editar' });
  const r = await registrar(db, id, 'Laura');
  await comoUsuario(db, { hoje: '2026-10-05', negar: 'tarefas.concluir' });
  await assert.rejects(remover(db, r.execucoes[0].id), /tarefas\.concluir/);
  await assert.rejects(rpc(db, 'select public.renomear_execucao_tarefa($1, $2)', [r.execucoes[0].id, 'X']), /tarefas\.concluir/);
  await comoUsuario(db, { hoje: '2026-10-05', uid: '' });
  await assert.rejects(registrar(db, id, 'Laura'), /sessao autenticada/);

  // Catalogo: RLS so SELECT; RPCs SECURITY DEFINER, search_path vazio, grants.
  assert.equal(await rpc(db, "select relrowsecurity from pg_class where relname = 'tarefas_ocorrencias_execucoes'"), true);
  const pol = (await db.query("select cmd from pg_policies where tablename = 'tarefas_ocorrencias_execucoes'")).rows;
  assert.deepEqual(pol.map((p) => p.cmd), ['SELECT']);
  for (const sig of ['public.registrar_execucao_tarefa(uuid, text)', 'public.remover_execucao_tarefa(uuid)', 'public.renomear_execucao_tarefa(uuid, text)', 'public.marcar_conclusao_tarefa(uuid, boolean)']) {
    const f = (await db.query('select prosecdef, proconfig from pg_proc where oid = $1::regprocedure', [sig])).rows[0];
    assert.equal(f.prosecdef, true, sig);
    assert.ok(f.proconfig.includes('search_path=""'), sig);
    assert.equal(await rpc(db, "select has_function_privilege('authenticated', $1, 'execute')", [sig]), true, sig);
    assert.equal(await rpc(db, "select has_function_privilege('anon', $1, 'execute')", [sig]), false, sig);
    assert.equal(await rpc(db, "select has_function_privilege('service_role', $1, 'execute')", [sig]), false, sig);
  }
  assert.equal(await rpc(db, "select has_function_privilege('authenticated', 'public.tarefas_ocorrencia_com_execucoes(uuid)', 'execute')"), false);
});

test('grupos continuam no motor (blocos distintos, Tapetes + Lixeiras juntos) apos a 0062', async () => {
  const db = await bancoOutubro();
  await programar(db, '2026-11-01');
  const rows = (await db.query(`select o.data::text dia, g.nome grupo, array_agg(distinct o.posicao) p
    from public.tarefas_ocorrencias o join public.tarefas_regras r on r.id = o.regra_id join public.tarefas_grupos g on g.id = r.grupo_id
    group by o.data, g.nome`)).rows;
  const porDia = new Map();
  for (const r of rows) {
    assert.equal(r.p.length, 1, `${r.grupo} ${r.dia}`);
    if (!porDia.has(r.dia)) porDia.set(r.dia, []);
    if (r.grupo.startsWith('Fechamento')) porDia.get(r.dia).push(r.p[0]);
  }
  for (const [dia, p] of porDia) assert.equal(new Set(p).size, 3, dia);
  assert.deepEqual(await distribuicao(db, '2026-11-01', '2026-11-30'), { F1: 219, F2: 220, F3: 220 });
});

test('varredura: 0062 nao usa RETURNS TABLE em plpgsql e todo ON CONFLICT e por constraint', () => {
  const sql = lerMigration(M62).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const conflitos = sql.match(/on conflict[^\n]*/g) || [];
  assert.ok(conflitos.length >= 1);
  assert.ok(conflitos.every((c) => /on conflict on constraint \w+/.test(c)), conflitos.join('\n'));
  assert.equal(/returns table/i.test(sql), false);
});

test('nome obrigatorio em execucao nova (RPC e banco); legado e so compatibilidade', async () => {
  const db = await bancoOutubro();
  const id = await idOcorrencia(db, '2026-10-05', 'Proteger pães');
  await assert.rejects(registrar(db, id, null), /informe o nome de quem executou/);
  await assert.rejects(registrar(db, id, ''), /informe o nome de quem executou/);
  await assert.rejects(registrar(db, id, '   \t  '), /informe o nome de quem executou/);
  await assert.rejects(registrar(db, id, 'x'.repeat(61)), /no maximo 60/);
  assert.equal((await ocorrencia(db, id)).concluida, false, 'nenhuma tentativa invalida conclui');

  // Normalizacao corrigida na 0062 (vale tambem para as RPCs da 0061).
  assert.equal(await rpc(db, "select public.tarefas_normalizar_texto(E'\\t\\n  \\t')"), null);
  assert.equal(await rpc(db, "select public.tarefas_normalizar_texto(E' \\t Ana \\n Paula \\n')"), 'Ana Paula');
  await assert.rejects(rpc(db, "select public.definir_nome_posicao_tarefas(1::smallint, E'\\t', '2026-10-10'::date, false)").then(async () => {
    const n = await rpc(db, "select nome from public.tarefas_posicoes_nomes where posicao = 1 and vigente_desde = '2026-10-10'");
    if (n !== null) throw new Error('nome so de tab virou ' + JSON.stringify(n));
    throw new Error('ok-sem-nome');
  }), /ok-sem-nome/);

  const ok = await registrar(db, id, '  Maria   da  Silva ');
  assert.equal(ok.execucoes[0].responsavel_nome, 'Maria da Silva');
  const execId = ok.execucoes[0].id;
  await assert.rejects(rpc(db, 'select public.renomear_execucao_tarefa($1, $2)', [execId, '']), /informe o nome/);
  await assert.rejects(rpc(db, 'select public.renomear_execucao_tarefa($1, $2)', [execId, '    ']), /informe o nome/);
  await assert.rejects(rpc(db, 'select public.renomear_execucao_tarefa($1, $2)', [execId, null]), /informe o nome/);
  assert.equal((await execucoes(db, id))[0].responsavel_nome, 'Maria da Silva');

  // Banco rejeita mesmo sem passar pela RPC (NOT NULL + CHECK).
  const outra = await idOcorrencia(db, '2026-10-05', 'Guardar os bolos');
  for (const nome of [null, '', '   ', ' Laura']) {
    await assert.rejects(
      db.query('insert into public.tarefas_ocorrencias_execucoes (ocorrencia_id, ordem, responsavel_nome, concluido_em) values ($1, 1, $2, now())', [outra, nome]),
      /tarefas_execucoes_nome_valido|null value|not-null/,
      JSON.stringify(nome),
    );
  }
  await assert.rejects(rpc(db, "update public.tarefas_ocorrencias_execucoes set responsavel_nome = '  ' where id = $1", [execId]), /tarefas_execucoes_nome_valido/);

  // Compatibilidade: marcar_conclusao_tarefa(true) nao cria execucao sem nome.
  await assert.rejects(rpc(db, 'select public.marcar_conclusao_tarefa($1, true)', [outra]), /informe o nome de quem executou/);
  const idem = await rpc(db, 'select to_jsonb(public.marcar_conclusao_tarefa($1, true))', [id]);
  assert.equal(idem.concluida, true, 'ja concluida: idempotente');
  assert.equal((await execucoes(db, id)).length, 1);
  assert.equal(await rpc(db, "select count(*)::int from public.tarefas_ocorrencias_execucoes where responsavel_nome = 'NÃO INFORMADO'"), 0, 'marcador legado nunca nasce de execucao nova');
});
