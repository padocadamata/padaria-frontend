// node --test supabase/tests/tarefas_cadastro_manutencao.test.mjs
//
// Manutencao pelo Cadastro com outubro/2026 ja programado e "hoje" = 30/09,
// quando TODAS as regras da carga ainda sao futuras (vigentes desde 01/10).
// Reproduz os parametros que o TarefaFormModal / InativarTarefaModal enviam
// depois da correcao (data de referencia = 1a versao; nova versao nunca
// antes da ultima gravada). Nenhuma migration nova: so o uso correto das
// RPCs da 0061.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comoUsuario, novoBanco, rpc } from './ambiente_tarefas.mjs';

const SALVAR = 'select public.salvar_tarefa($1, $2, $3, $4, $5, $6, $7::smallint[], $8::smallint[], $9, $10::date, $11, $12) as r';
const HOJE = '2026-09-30';
const LAVAR_FORMAS = 'Lavar formas e bandejas de pão de queijo';

async function bancoOutubroProgramado() {
  const db = await novoBanco({
    migrations: ['0061_folha_tarefas.sql', '0062_tarefas_execucoes.sql', '0064_tarefas_fechar_funcoes_internas.sql'],
    hoje: '2026-09-29',
  });
  await comoUsuario(db, { hoje: '2026-09-29' });
  await rpc(db, 'select public.programar_mes_tarefas($1::date, false)', ['2026-10-01']);
  await comoUsuario(db, { hoje: HOJE });
  return db;
}

const linhas = async (db, sql, p = []) => (await db.query(sql, p)).rows;
const impressaoDigital = async (db, onde = 'true') => (await linhas(db, `
  select count(*)::text || ':' || md5(string_agg(concat_ws('|', o.id, o.tarefa_id, o.data, o.origem, o.regra_id, o.posicao_programada,
    o.posicao, o.responsavel_nome, o.responsavel_avulso, o.ajustado_em, o.cancelada, o.concluida, o.concluido_em, o.concluido_por),
    ',' order by o.id)) as v
  from public.tarefas_ocorrencias as o where ${onde}`))[0].v;

async function tarefaComRegra(db, descricao) {
  const [t] = await linhas(db, `
    select t.id, t.ordem, t.categoria, r.tipo, r.dias_semana, r.semanas_do_mes, r.grupo_id, to_char(r.vigente_desde, 'YYYY-MM-DD') as desde
    from public.tarefas as t join public.tarefas_regras as r on r.tarefa_id = t.id
    where t.descricao = $1 order by r.vigente_desde desc limit 1`, [descricao]);
  return t;
}

test('rename antes da 1a vigencia: data de referencia = 01/10 -> mesma tarefa, sem regra nova, historico intacto', async () => {
  const db = await bancoOutubroProgramado();
  const v = await tarefaComRegra(db, 'Expositores - Vidros externos dos Balcões e estufa');
  const antes = await impressaoDigital(db);
  const args = (aplicar, simular) => [v.id, 'Vidros externos dos balcões', v.categoria, v.ordem, null, v.tipo, v.dias_semana, v.semanas_do_mes, v.grupo_id, aplicar, null, simular];

  // Como o modal enviava antes da correcao.
  await assert.rejects(rpc(db, SALVAR, args(HOJE, true)), /agendada para depois de 30\/09\/2026/);
  await assert.rejects(rpc(db, SALVAR, args(null, true)), /informe a partir de quando/);

  const previa = await rpc(db, SALVAR, args(v.desde, true));
  assert.equal(previa.programacao_alterada, false);
  const r = await rpc(db, SALVAR, args(v.desde, false));
  assert.equal(r.programacao_alterada, false);
  assert.equal(r.tarefa_id, v.id, 'mesmo ID');

  const [depois] = await linhas(db, `select t.descricao, (select count(*)::int from public.tarefas_regras as x where x.tarefa_id = t.id) as regras
    from public.tarefas as t where t.id = $1`, [v.id]);
  assert.deepEqual(depois, { descricao: 'Vidros externos dos balcões', regras: 1 });
  assert.equal(await impressaoDigital(db), antes, 'nenhuma ocorrencia tocada (a ocorrencia referencia a tarefa; o nome nao e copiado)');
});

test('inativar antes da 1a vigencia: 30/09 recusado, 01/10 (primeira data aceita) funciona', async () => {
  const db = await bancoOutubroProgramado();
  const f = await tarefaComRegra(db, 'Forno Pão de Queijo');
  await assert.rejects(rpc(db, 'select public.inativar_tarefa($1, $2::date, true)', [f.id, HOJE]), /agendada para depois/);
  const previa = await rpc(db, 'select public.inativar_tarefa($1, $2::date, true)', [f.id, f.desde]);
  assert.equal(previa.removidas, 4);
});

test('excluir: sem historico apaga; com historico recusa e preserva; nome duplicado recusado', async () => {
  const db = await bancoOutubroProgramado();
  const nova = await rpc(db, SALVAR, [null, LAVAR_FORMAS, 'LIMPEZA', null, null, 'diaria', null, null, null, HOJE, null, false]);
  assert.equal(nova.criadas, 31);
  await rpc(db, 'select public.inativar_tarefa($1, $2::date, false)', [nova.tarefa_id, HOJE]);
  assert.equal((await linhas(db, 'select count(*)::int as n from public.tarefas_ocorrencias where tarefa_id = $1', [nova.tarefa_id]))[0].n, 0);
  await rpc(db, 'select public.excluir_tarefa($1)', [nova.tarefa_id]);
  assert.equal((await linhas(db, 'select count(*)::int as n from public.tarefas where id = $1', [nova.tarefa_id]))[0].n, 0);

  const comHistorico = await rpc(db, SALVAR, [null, LAVAR_FORMAS, 'LIMPEZA', null, null, 'diaria', null, null, null, HOJE, null, false]);
  await rpc(db, 'select public.inativar_tarefa($1, $2::date, false)', [comHistorico.tarefa_id, '2026-10-15']);
  await assert.rejects(rpc(db, 'select public.excluir_tarefa($1)', [comHistorico.tarefa_id]), /ja tem ocorrencias no calendario/);
  assert.equal((await linhas(db, 'select count(*)::int as n from public.tarefas_ocorrencias where tarefa_id = $1', [comHistorico.tarefa_id]))[0].n, 14);
  await assert.rejects(
    rpc(db, SALVAR, [null, LAVAR_FORMAS, 'FECHAMENTO', 11, null, 'diaria', null, null, null, '2026-10-01', null, true]),
    /ja existe uma tarefa com esta descricao/,
  );
});

test('nova tarefa em FECHAMENTO, diaria no Bloco 3, ordem 11: so ACRESCENTA ocorrencias; as 675 existentes ficam identicas', async () => {
  const db = await bancoOutubroProgramado();
  const antes = await impressaoDigital(db);
  const [bloco3] = await linhas(db, `select id from public.tarefas_grupos where nome = 'Fechamento — Bloco 3'`);
  const r = await rpc(db, SALVAR, [null, LAVAR_FORMAS, 'FECHAMENTO', 11, null, 'diaria', null, null, bloco3.id, '2026-10-01', null, false]);
  assert.equal(r.criadas, 31);
  assert.equal(r.removidas, 0);
  assert.equal(await impressaoDigital(db, `o.tarefa_id <> '${r.tarefa_id}'`), antes, 'ocorrencias existentes intocadas');

  // Mesma posicao que "Limpeza da Estufa de Pão de Queijo" em todos os dias.
  const [dif] = await linhas(db, `
    select count(*)::int as n from public.tarefas_ocorrencias as a
    join public.tarefas_ocorrencias as b on b.data = a.data
    where a.tarefa_id = $1 and b.tarefa_id = (select id from public.tarefas where descricao = 'Limpeza da Estufa de Pão de Queijo')
      and a.posicao <> b.posicao`, [r.tarefa_id]);
  assert.equal(dif.n, 0);
  const total = await linhas(db, `select count(*)::int as n,
    count(*) filter (where posicao_programada = 1)::int as f1, count(*) filter (where posicao_programada = 2)::int as f2,
    count(*) filter (where posicao_programada = 3)::int as f3 from public.tarefas_ocorrencias`);
  assert.equal(total[0].n, 706);
  assert.equal(total[0].f1 + total[0].f2 + total[0].f3, 706);
});
