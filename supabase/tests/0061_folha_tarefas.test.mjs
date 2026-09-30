// Testes de integracao da migration 0061 (Folha de Pagamento > Tarefas).
//
// Executa a migration REAL num PostgreSQL embutido (PGlite, WASM) com
// stubs minimos do ambiente Supabase (auth.uid(), has_permissao, roles,
// permissoes, logs_auditoria). Nada aqui toca o Supabase real.
//
// Como rodar (numa copia isolada do projeto, fora do Google Drive):
//   npm i --no-save @electric-sql/pglite
//   node --test supabase/tests/0061_folha_tarefas.test.mjs
//
// "Hoje" e controlado por teste: public.tarefas_hoje() e substituida
// DEPOIS da migration por uma versao que le a GUC teste.hoje.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { PGlite } = await import('@electric-sql/pglite');

const aqui = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(aqui, '..', 'migrations', '0061_folha_tarefas.sql'), 'utf8');
const USUARIO = '11111111-1111-1111-1111-111111111111';

const STUBS = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${USUARIO}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('teste.uid', true), '')::uuid
  $$;
  create table public.perfis (nome text primary key);
  insert into public.perfis values ('proprietario_admin');
  create table public.permissoes (codigo text primary key, modulo text not null, acao text not null, descricao text not null default '', criado_em timestamptz not null default now());
  create table public.perfil_permissoes (perfil text references public.perfis(nome), permissao text references public.permissoes(codigo), primary key (perfil, permissao));
  create table public.usuario_permissoes (usuario_id uuid, permissao text);
  create table public.logs_auditoria (id uuid primary key default gen_random_uuid(), usuario_id uuid default nullif(current_setting('teste.uid', true), '')::uuid, data_hora timestamptz default now(), entidade text not null, registro_id text not null, acao text not null, campo text, valor_anterior text, valor_novo text);
  create function public.has_permissao(perm text) returns boolean language sql stable as $$
    select auth.uid() is not null
       and not (perm = any(string_to_array(coalesce(current_setting('teste.negar', true), ''), ',')))
  $$;
`;

const HOJE_TESTE = `
  create or replace function public.tarefas_hoje() returns date language sql stable set search_path = '' as $$
    select coalesce(nullif(current_setting('teste.hoje', true), '')::date, (now() at time zone 'America/Sao_Paulo')::date)
  $$;
`;

async function novoBanco({ hoje = '2026-09-29' } = {}) {
  const db = new PGlite();
  await db.exec(STUBS);
  await db.exec(MIGRATION);
  await db.exec(HOJE_TESTE);
  await comoUsuario(db, { hoje });
  return db;
}

async function comoUsuario(db, { hoje, negar = '', uid = USUARIO } = {}) {
  await db.query(`select set_config('teste.uid', $1, false), set_config('teste.negar', $2, false)${hoje ? ", set_config('teste.hoje', $3, false)" : ''}`,
    hoje ? [uid ?? '', negar, hoje] : [uid ?? '', negar]);
}

async function rpc(db, sql, params = []) {
  const r = await db.query(sql, params);
  return r.rows[0] ? Object.values(r.rows[0])[0] : undefined;
}

const programar = (db, mes, simular = false) =>
  rpc(db, 'select public.programar_mes_tarefas($1::date, $2) as r', [mes, simular]);

async function ocorrencias(db, inicio, fim) {
  const r = await db.query(
    `select t.descricao, o.* , to_char(o.data, 'YYYY-MM-DD') as dia
       from public.tarefas_ocorrencias o join public.tarefas t on t.id = o.tarefa_id
      where o.data between $1 and $2 order by o.data, t.descricao`, [inicio, fim]);
  return r.rows;
}

async function idTarefa(db, prefixo) {
  return rpc(db, 'select id from public.tarefas where descricao like $1', [`${prefixo}%`]);
}

function metricas(rows) {
  const total = { 1: 0, 2: 0, 3: 0 };
  const porDia = new Map();
  for (const o of rows) {
    total[o.posicao] += 1;
    const c = porDia.get(o.dia) || { 1: 0, 2: 0, 3: 0 };
    c[o.posicao] += 1;
    porDia.set(o.dia, c);
  }
  const difs = [...porDia.values()].map((c) => Math.max(c[1], c[2], c[3]) - Math.min(c[1], c[2], c[3]));
  return { total, dias: porDia.size, maxDif: Math.max(...difs), diasDif3: difs.filter((d) => d >= 3).length, mediaDif: +(difs.reduce((a, b) => a + b, 0) / difs.length).toFixed(2) };
}

// ---------------------------------------------------------------------------

test('carga inicial: 3 categorias, 4 grupos, 38 tarefas, 38 regras', async () => {
  const db = await novoBanco();
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_categorias'), 3);
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_grupos'), 4);
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas'), 38);
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_regras'), 38);
  const porTipo = (await db.query('select tipo, count(*)::int n from public.tarefas_regras group by tipo order by tipo')).rows;
  assert.deepEqual(Object.fromEntries(porTipo.map((r) => [r.tipo, r.n])), { diaria: 18, dias_semana: 17, semanas_do_mes: 1, sem_programacao: 2 });
  assert.equal(await rpc(db, "select count(*)::int from public.tarefas_regras r join public.tarefas_grupos g on g.id = r.grupo_id"), 15);
  assert.equal(await rpc(db, "select count(*)::int from public.permissoes where codigo like 'tarefas.%'"), 3);
  assert.equal(await rpc(db, "select count(*)::int from public.perfil_permissoes where permissao like 'tarefas.%' and perfil = 'proprietario_admin'"), 3);
  // Reexecutar a migration nao duplica nada.
  await db.exec(MIGRATION);
  await db.exec(HOJE_TESTE);
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas'), 38);
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_grupos'), 4);
});

test('motor puro: deterministico, continuo e com ancora 2024-01-01', async () => {
  const db = await novoBanco();
  const pos = (d, rot, k) => rpc(db, 'select public.tarefas_posicao_calculada($1::date, $2, $3::smallint)', [d, rot, k]);
  assert.equal(await pos('2024-01-01', 'diaria', 0), 1);
  assert.equal(await pos('2024-01-02', 'diaria', 0), 2);
  assert.equal(await pos('2024-01-03', 'diaria', 0), 3);
  assert.equal(await pos('2024-01-04', 'diaria', 0), 1);
  assert.equal(await pos('2023-12-31', 'diaria', 0), 3); // antes da ancora: continua
  assert.equal(await pos('2024-01-07', 'semanal', 0), 1); // domingo = mesma semana ISO
  assert.equal(await pos('2024-01-08', 'semanal', 0), 2);
  assert.equal(await pos('2026-10-31', 'diaria', 1), await pos('2026-10-31', 'diaria', 1));
  // Virada 31/10 -> 01/11 avanca 1 posicao (nao reinicia).
  for (const k of [0, 1, 2]) {
    const a = await pos('2026-10-31', 'diaria', k);
    const b = await pos('2026-11-01', 'diaria', k);
    assert.equal(b, (a % 3) + 1);
  }
});

test('ordem de programacao dos meses nao altera o resultado', async () => {
  const a = await novoBanco();
  await programar(a, '2026-10-01');
  await programar(a, '2026-11-01');
  const b = await novoBanco();
  await programar(b, '2026-11-01');
  await programar(b, '2026-10-01');
  const chave = (rows) => rows.map((o) => `${o.dia}|${o.descricao}|${o.posicao}|${o.posicao_programada}`).join('\n');
  assert.equal(chave(await ocorrencias(a, '2026-10-01', '2026-11-30')), chave(await ocorrencias(b, '2026-10-01', '2026-11-30')));
});

test('outubro e novembro/2026: dia 31, distribuicao equilibrada e metricas', async () => {
  const db = await novoBanco();
  const rOut = await programar(db, '2026-10-01');
  await programar(db, '2026-11-01');
  const out = await ocorrencias(db, '2026-10-01', '2026-10-31');
  const nov = await ocorrencias(db, '2026-11-01', '2026-11-30');
  assert.equal(rOut.criadas, out.length);
  // 31/10/2026 (sabado): 18 diarias + suco.
  assert.equal(out.filter((o) => o.dia === '2026-10-31').length, 19);
  const mOut = metricas(out);
  const mNov = metricas(nov);
  console.log('METRICAS out/2026', JSON.stringify(mOut));
  console.log('METRICAS nov/2026', JSON.stringify(mNov));
  assert.deepEqual(mOut.total, { 1: 225, 2: 225, 3: 225 });
  assert.deepEqual(mNov.total, { 1: 219, 2: 220, 3: 220 });
  assert.equal(mOut.maxDif, 1);
  assert.equal(mNov.maxDif, 1);
  assert.equal(mOut.diasDif3 + mNov.diasDif3, 0);
});

test('viradas 31->1 e fevereiro->marco sem repeticao nas diarias', async () => {
  const db = await novoBanco();
  for (const mes of ['2026-10-01', '2026-11-01', '2027-02-01', '2027-03-01']) await programar(db, mes);
  const diarias = (await db.query("select t.id from public.tarefas t join public.tarefas_regras r on r.tarefa_id = t.id where r.tipo = 'diaria'")).rows.map((r) => r.id);
  for (const [a, b] of [['2026-10-31', '2026-11-01'], ['2027-02-28', '2027-03-01']]) {
    const rows = (await db.query('select tarefa_id, data::text, posicao from public.tarefas_ocorrencias where data in ($1, $2)', [a, b])).rows;
    for (const id of diarias) {
      const pa = rows.find((r) => r.tarefa_id === id && r.data === a).posicao;
      const pb = rows.find((r) => r.tarefa_id === id && r.data === b).posicao;
      assert.equal(pb, (pa % 3) + 1, `diaria ${id} ${a}->${b}`);
    }
  }
});

test('grupos: 3 blocos distintos no dia e Tapetes + Lixeiras juntos', async () => {
  const db = await novoBanco();
  await programar(db, '2026-10-01');
  await programar(db, '2026-11-01');
  const rows = (await db.query(`
    select o.data::text dia, g.nome grupo, array_agg(distinct o.posicao) posicoes
      from public.tarefas_ocorrencias o
      join public.tarefas_regras r on r.id = o.regra_id
      join public.tarefas_grupos g on g.id = r.grupo_id
     group by o.data, g.nome order by 1, 2`)).rows;
  const porDia = new Map();
  for (const r of rows) {
    assert.equal(r.posicoes.length, 1, `${r.grupo} em ${r.dia} tem posicoes diferentes`);
    if (!porDia.has(r.dia)) porDia.set(r.dia, {});
    porDia.get(r.dia)[r.grupo] = r.posicoes[0];
  }
  for (const [dia, g] of porDia) {
    const blocos = [g['Fechamento — Bloco 1'], g['Fechamento — Bloco 2'], g['Fechamento — Bloco 3']];
    assert.equal(new Set(blocos).size, 3, `blocos coincidem em ${dia}`);
  }
  // Tapetes + Lixeiras so segunda e sexta.
  const tl = rows.filter((r) => r.grupo === 'Tapetes + Lixeiras').map((r) => new Date(`${r.dia}T12:00:00`).getDay());
  assert.ok(tl.length > 0 && tl.every((d) => d === 1 || d === 5));
});

test('recorrencias: semanal, 2x, 3x, quinzenal, suco sab/dom e sem programacao', async () => {
  const db = await novoBanco();
  await programar(db, '2026-10-01');
  const out = await ocorrencias(db, '2026-10-01', '2026-10-31');
  const dias = (prefixo) => out.filter((o) => o.descricao.startsWith(prefixo)).map((o) => o.dia);
  const dow = (d) => new Date(`${d}T12:00:00`).getDay();
  assert.deepEqual(dias('Forno Microondas'), ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']);
  assert.ok(dias('Expositores - Vidros internos').every((d) => [2, 5].includes(dow(d))));
  assert.equal(dias('Expositores - Vidros internos').length, 9);
  assert.ok(dias('Reabastecer a máquina de café').every((d) => [1, 3, 5].includes(dow(d))));
  assert.equal(dias('Reabastecer a máquina de café').length, 13);
  assert.deepEqual(dias('Coifa'), ['2026-10-14', '2026-10-28']);
  const suco = dias('Preparar o suco');
  assert.equal(suco.length, 9);
  assert.ok(suco.every((d) => [0, 6].includes(dow(d))));
  assert.equal(dias('Preparar / Verificar os lanches').length, 0);
  assert.equal(dias('Higienizar alface').length, 0);
  assert.equal(dias('Lavar e secar toda a louça').length, 31);
  // Semanais do mesmo dia NAO ficam todas na mesma posicao.
  const quartas = out.filter((o) => o.dia === '2026-10-07' && ['Forno Pão de Queijo', 'Armários Produção', 'Suplats', 'Repor estação'].some((p) => o.descricao.startsWith(p)));
  assert.ok(new Set(quartas.map((o) => o.posicao)).size >= 2);
});

test('programar de novo e idempotente e a previa nao grava', async () => {
  const db = await novoBanco();
  const previa = await programar(db, '2026-10-01', true);
  assert.equal(previa.simulacao, true);
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_ocorrencias'), 0);
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_meses'), 0);
  const real = await programar(db, '2026-10-01');
  assert.equal(real.criadas, previa.criadas);
  const denovo = await programar(db, '2026-10-01');
  assert.equal(denovo.criadas, 0);
  assert.equal(denovo.removidas, 0);
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_ocorrencias'), real.criadas);
  await assert.rejects(programar(db, '2026-08-01'), /ja terminou/);
});

test('mudanca de vigencia: so futuro intocado muda; concluida/ajustada/cancelada ficam', async () => {
  const db = await novoBanco({ hoje: '2026-09-29' });
  await programar(db, '2026-10-01');
  await programar(db, '2026-11-01');
  const forno = await idTarefa(db, 'Forno Pão de Queijo');
  const occ = async (d) => (await db.query('select * from public.tarefas_ocorrencias where tarefa_id = $1 and data = $2', [forno, d])).rows[0];

  await comoUsuario(db, { hoje: '2026-10-10' });
  await rpc(db, 'select public.marcar_conclusao_tarefa($1, true)', [(await occ('2026-10-07')).id]);
  await rpc(db, 'select public.ajustar_ocorrencia_tarefa($1, 3::smallint, null)', [(await occ('2026-10-21')).id]);
  await rpc(db, "select public.cancelar_ocorrencia_tarefa($1, 'Equipamento em manutencao')", [(await occ('2026-10-28')).id]);

  const args = [forno, 'Forno Pão de Queijo', 'LIMPEZA', null, null, 'dias_semana', '{2,5}', null, null, '2026-10-15', null];
  const sql = 'select public.salvar_tarefa($1, $2, $3, $4, $5, $6, $7::smallint[], $8::smallint[], $9, $10::date, $11, $12) as r';
  const antes = await rpc(db, 'select count(*)::int from public.tarefas_ocorrencias');
  const previa = await rpc(db, sql, [...args, true]);
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_ocorrencias'), antes, 'previa nao pode gravar');
  const real = await rpc(db, sql, [...args, false]);
  assert.deepEqual({ ...real, simulacao: null }, { ...previa, simulacao: null });
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_regras where tarefa_id = $1', [forno]), 2);

  const rows = (await db.query("select to_char(data,'YYYY-MM-DD') dia, concluida, cancelada, ajustado_em is not null ajustada from public.tarefas_ocorrencias where tarefa_id = $1 order by data", [forno])).rows;
  const dias = rows.map((r) => r.dia);
  // Antes de 15/10: quartas intactas (07 concluida, 14 intocada).
  assert.ok(dias.includes('2026-10-07') && dias.includes('2026-10-14') && !dias.includes('2026-10-13'));
  // A partir de 15/10: quartas intocadas removidas; ajustada e cancelada preservadas; ter/sex criadas.
  assert.ok(dias.includes('2026-10-21') && dias.includes('2026-10-28'));
  assert.ok(!dias.includes('2026-11-04') && !dias.includes('2026-11-11'));
  assert.ok(dias.includes('2026-10-16') && dias.includes('2026-10-20') && dias.includes('2026-11-03') && dias.includes('2026-11-06'));
  assert.equal(rows.find((r) => r.dia === '2026-10-07').concluida, true);
  assert.equal(rows.find((r) => r.dia === '2026-10-21').ajustada, true);
  assert.equal(rows.find((r) => r.dia === '2026-10-28').cancelada, true);
  assert.equal(real.preservadas >= 2, true);

  // Reprogramar o mes depois disso nao desfaz nada.
  await programar(db, '2026-10-01');
  const depois = (await db.query('select count(*)::int n from public.tarefas_ocorrencias where tarefa_id = $1', [forno])).rows[0].n;
  assert.equal(depois, rows.length);

  // Passado e versao ja vigente sao imutaveis.
  await assert.rejects(rpc(db, sql, [forno, 'Forno Pão de Queijo', 'LIMPEZA', null, null, 'diaria', null, null, null, '2026-10-01', null, false]), /a partir de hoje/);
});

test('nomes de F1/F2/F3 por vigencia e materializados na ocorrencia', async () => {
  const db = await novoBanco({ hoje: '2026-09-29' });
  const definir = (pos, nome, desde, simular = false) =>
    rpc(db, 'select public.definir_nome_posicao_tarefas($1::smallint, $2, $3::date, $4)', [pos, nome, desde, simular]);
  await definir(1, '  Laura   Souza ', '2026-10-01');
  await programar(db, '2026-10-01');
  const nomeEm = async (d) => (await db.query('select distinct responsavel_nome from public.tarefas_ocorrencias where data = $1 and posicao = 1', [d])).rows.map((r) => r.responsavel_nome);
  assert.deepEqual(await nomeEm('2026-10-05'), ['Laura Souza']);
  assert.deepEqual((await db.query('select distinct responsavel_nome from public.tarefas_ocorrencias where posicao = 2')).rows.map((r) => r.responsavel_nome), [null]);

  await comoUsuario(db, { hoje: '2026-10-10' });
  // Ajustada F1 depois de 15/10 guarda Laura mesmo com a troca.
  const ajustada = (await db.query("select id from public.tarefas_ocorrencias where data = '2026-10-20' and posicao = 1 limit 1")).rows[0].id;
  await rpc(db, 'select public.ajustar_ocorrencia_tarefa($1, 1::smallint, null)', [ajustada]);
  await assert.rejects(definir(1, 'Maria', '2026-10-05'), /a partir de hoje/);
  const r = await definir(1, 'Maria', '2026-10-15');
  assert.ok(r.nomes_atualizados > 0);
  assert.deepEqual(await nomeEm('2026-10-14'), ['Laura Souza']);
  const dia20 = (await db.query("select id, responsavel_nome from public.tarefas_ocorrencias where data = '2026-10-20' and posicao = 1")).rows;
  assert.equal(dia20.find((o) => o.id === ajustada).responsavel_nome, 'Laura Souza');
  assert.ok(dia20.filter((o) => o.id !== ajustada).every((o) => o.responsavel_nome === 'Maria'));
  // Vazio volta a exibir F1 (nome nulo).
  await definir(1, '   ', '2026-10-25');
  assert.deepEqual(await nomeEm('2026-10-26'), [null]);
  // Tabela de nomes preserva as vigencias.
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_posicoes_nomes where posicao = 1'), 3);
});

test('conclusao, cancelamento, ajuste, avulsa e permissoes', async () => {
  const db = await novoBanco({ hoje: '2026-09-29' });
  await programar(db, '2026-10-01');
  await comoUsuario(db, { hoje: '2026-10-10' });
  const id = (await db.query("select id from public.tarefas_ocorrencias where data = '2026-10-09' limit 1")).rows[0].id;
  const futura = (await db.query("select id from public.tarefas_ocorrencias where data = '2026-10-20' limit 1")).rows[0].id;
  const marcar = (oid, v) => rpc(db, 'select to_jsonb(public.marcar_conclusao_tarefa($1, $2))', [oid, v]);

  const c = await marcar(id, true);
  assert.equal(c.concluida, true);
  assert.equal(c.concluido_por, USUARIO);
  assert.ok(c.concluido_em);
  assert.equal((await marcar(id, true)).concluido_em, c.concluido_em, 'idempotente');
  await assert.rejects(marcar(futura, true), /data futura/);
  await assert.rejects(rpc(db, "select public.cancelar_ocorrencia_tarefa($1, 'x')", [id]), /desmarque/);
  const d = await marcar(id, false);
  assert.equal(d.concluida, false);
  assert.equal(d.concluido_em, null);
  assert.equal(d.concluido_por, null);
  assert.equal(await rpc(db, "select count(*)::int from public.logs_auditoria where acao = 'desmarcou_conclusao'"), 1);

  await assert.rejects(rpc(db, 'select public.cancelar_ocorrencia_tarefa($1, $2)', [id, '  ']), /motivo/);
  await rpc(db, "select public.cancelar_ocorrencia_tarefa($1, 'Loja fechada')", [id]);
  await assert.rejects(marcar(id, true), /cancelada/);
  await assert.rejects(rpc(db, 'select public.ajustar_ocorrencia_tarefa($1, 2::smallint, null)', [id]), /cancelada/);
  await rpc(db, 'select public.restaurar_ocorrencia_tarefa($1)', [id]);

  const aj = await rpc(db, "select to_jsonb(public.ajustar_ocorrencia_tarefa($1, 2::smallint, '  Joana  '))", [id]);
  assert.equal(aj.posicao, 2);
  assert.equal(aj.responsavel_avulso, 'Joana');
  assert.notEqual(aj.ajustado_em, null);
  const desf = await rpc(db, 'select to_jsonb(public.desfazer_ajuste_ocorrencia_tarefa($1))', [id]);
  assert.equal(desf.posicao, desf.posicao_programada);
  assert.equal(desf.responsavel_avulso, null);
  assert.equal(desf.ajustado_em, null);

  // Avulsa em tarefa sem programacao.
  const lanches = await idTarefa(db, 'Preparar / Verificar');
  const av = await rpc(db, "select to_jsonb(public.criar_ocorrencia_avulsa_tarefa($1, '2026-10-12', 3::smallint, null))", [lanches]);
  assert.equal(av.origem, 'avulsa');
  await assert.rejects(rpc(db, "select public.criar_ocorrencia_avulsa_tarefa($1, '2026-10-12', 1::smallint, null)", [lanches]), /ja tem ocorrencia/);
  await programar(db, '2026-10-01');
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_ocorrencias where id = $1', [av.id]), 1, 'reprogramar nao remove avulsa');
  await rpc(db, 'select public.excluir_ocorrencia_avulsa_tarefa($1)', [av.id]);
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas_ocorrencias where id = $1', [av.id]), 0);

  // concluir sem editar: pode concluir, nao pode programar/ajustar.
  await comoUsuario(db, { hoje: '2026-10-10', negar: 'tarefas.editar' });
  assert.equal((await marcar(id, true)).concluida, true);
  await assert.rejects(programar(db, '2026-11-01'), /tarefas\.editar/);
  await assert.rejects(rpc(db, 'select public.ajustar_ocorrencia_tarefa($1, 1::smallint, null)', [id]), /tarefas\.editar/);
  // editar sem concluir: nao conclui.
  await comoUsuario(db, { hoje: '2026-10-10', negar: 'tarefas.concluir' });
  await assert.rejects(marcar(id, false), /tarefas\.concluir/);
  // sem sessao.
  await comoUsuario(db, { hoje: '2026-10-10', uid: '' });
  await assert.rejects(programar(db, '2026-11-01'), /sessao autenticada/);
});

test('cadastro: nova tarefa equilibrada, grupo, inativar e excluir', async () => {
  const db = await novoBanco({ hoje: '2026-09-29' });
  await programar(db, '2026-10-01');
  const sql = 'select public.salvar_tarefa($1, $2, $3, $4, $5, $6, $7::smallint[], $8::smallint[], $9, $10::date, $11, $12) as r';

  const nova = await rpc(db, sql, [null, 'Limpar  prateleiras ', 'LIMPEZA', null, null, 'dias_semana', '{4}', null, null, '2026-10-01', null, false]);
  assert.ok(nova.criadas >= 5);
  assert.equal(await rpc(db, 'select descricao from public.tarefas where id = $1', [nova.tarefa_id]), 'Limpar prateleiras');
  await assert.rejects(rpc(db, sql, [null, 'limpar prateleiras', 'LIMPEZA', null, null, 'diaria', null, null, null, '2026-10-01', null, false]), /ja existe/);

  // Tarefa nova numa quarta: a quarta continua equilibrada (<= 1) fora das semanas da Coifa.
  const q = await rpc(db, sql, [null, 'Nova tarefa de quarta', 'LIMPEZA', null, null, 'dias_semana', '{3}', null, null, '2026-10-01', null, false]);
  const carga = (await db.query("select posicao, count(*)::int n from public.tarefas_ocorrencias where data = '2026-10-07' group by posicao")).rows;
  const ns = carga.map((r) => r.n);
  assert.ok(Math.max(...ns) - Math.min(...ns) <= 1, JSON.stringify(carga));

  // Grupo novo: rotacao imutavel; excluir so se nunca usado.
  const g = await rpc(db, "select public.salvar_grupo_tarefas(null, 'Bloco teste', 'semanal', null)");
  await assert.rejects(db.query("update public.tarefas_grupos set rotacao = 'diaria' where id = $1", [g]), /imutaveis/);
  await rpc(db, 'select public.excluir_grupo_tarefas($1)', [g]);
  const bloco1 = await rpc(db, "select id from public.tarefas_grupos where nome = 'Fechamento — Bloco 1'");
  await assert.rejects(rpc(db, 'select public.excluir_grupo_tarefas($1)', [bloco1]), /ja foi usado/);

  // Inativar a partir de 20/10: some do futuro, fica no passado.
  await comoUsuario(db, { hoje: '2026-10-10' });
  const r = await rpc(db, 'select public.inativar_tarefa($1, $2::date, false)', [q.tarefa_id, '2026-10-20']);
  assert.ok(r.removidas >= 2);
  const restantes = (await db.query("select to_char(data,'YYYY-MM-DD') d from public.tarefas_ocorrencias where tarefa_id = $1 order by data", [q.tarefa_id])).rows.map((x) => x.d);
  assert.deepEqual(restantes, ['2026-10-07', '2026-10-14']);
  assert.equal(await rpc(db, 'select ativo from public.tarefas where id = $1', [q.tarefa_id]), false);
  await assert.rejects(rpc(db, 'select public.excluir_tarefa($1)', [q.tarefa_id]), /Inative/);

  // Tarefa nunca usada pode ser excluida.
  const semUso = await rpc(db, sql, [null, 'Tarefa sem uso', 'LIMPEZA', null, null, 'sem_programacao', null, null, null, '2026-10-10', null, false]);
  await rpc(db, 'select public.excluir_tarefa($1)', [semUso.tarefa_id]);
  assert.equal(await rpc(db, 'select count(*)::int from public.tarefas where id = $1', [semUso.tarefa_id]), 0);
});

// ---------------------------------------------------------------------------
// Previa sem efeitos: estado COMPLETO antes/depois + prova de que nenhuma
// escrita (nem temporaria) aconteceu dentro da transacao da previa.
// ---------------------------------------------------------------------------

const TABELAS_ESTADO = [
  'tarefas_categorias', 'tarefas_grupos', 'tarefas', 'tarefas_regras',
  'tarefas_posicoes_nomes', 'tarefas_meses', 'tarefas_ocorrencias', 'logs_auditoria',
];

async function estado(db) {
  const r = {};
  for (const t of TABELAS_ESTADO) {
    r[t] = await rpc(db, `select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text)), '-') from public.${t} as x`);
  }
  return r;
}

// Executa a previa numa transacao explicita e mede, DENTRO dela, as
// escritas contadas pelo Postgres (inclusive as desfeitas) e os advisory
// locks -- um "escreve e desfaz" apareceria aqui.
// Os contadores de pg_stat_xact_user_tables podem carregar escritas ainda
// nao descarregadas de transacoes anteriores (PGlite: backend unico), entao
// a medicao e o DELTA dentro da mesma transacao, antes x depois da chamada.
const SQL_ESCRITAS = `
  select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::int
  from pg_stat_xact_user_tables
  where relname like 'tarefas%' or relname = 'logs_auditoria'`;

async function previaIsolada(db, sql, params) {
  await db.exec('begin');
  try {
    const antes = await rpc(db, SQL_ESCRITAS);
    const resultado = await rpc(db, sql, params);
    const escritas = (await rpc(db, SQL_ESCRITAS)) - antes;
    const locks = await rpc(db, "select count(*)::int from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()");
    return { resultado, escritas, locks };
  } finally {
    await db.exec('rollback');
  }
}

test('previa (p_simular=true) nao escreve nada: estado, logs, escritas da transacao e locks', async () => {
  const db = await novoBanco({ hoje: '2026-09-29' });
  await rpc(db, 'select public.definir_nome_posicao_tarefas(1::smallint, $1, $2::date, false)', ['Laura', '2026-10-01']);
  await programar(db, '2026-10-01');
  await comoUsuario(db, { hoje: '2026-10-10' });
  const conclui = (await db.query("select id from public.tarefas_ocorrencias where data = '2026-10-09' limit 1")).rows[0].id;
  await rpc(db, 'select public.marcar_conclusao_tarefa($1, true)', [conclui]);
  await rpc(db, 'select public.marcar_conclusao_tarefa($1, false)', [conclui]); // gera 1 log
  const forno = await idTarefa(db, 'Forno Pão de Queijo');
  const salvar = 'select public.salvar_tarefa($1, $2, $3, $4, $5, $6, $7::smallint[], $8::smallint[], $9, $10::date, $11, true) as r';

  const previas = [
    ['programar mes ja programado', 'select public.programar_mes_tarefas($1::date, true)', ['2026-10-01']],
    ['programar mes novo (sem tarefas_meses)', 'select public.programar_mes_tarefas($1::date, true)', ['2026-11-01']],
    ['editar regra', salvar, [forno, 'Forno Pão de Queijo', 'LIMPEZA', null, null, 'dias_semana', '{2,5}', null, null, '2026-10-15', null]],
    ['nova tarefa', salvar, [null, 'Tarefa de previa', 'LIMPEZA', null, null, 'diaria', null, null, null, '2026-10-12', null]],
    ['inativar', 'select public.inativar_tarefa($1, $2::date, true)', [forno, '2026-10-20']],
    ['nome F1', 'select public.definir_nome_posicao_tarefas(1::smallint, $1, $2::date, true)', ['Maria', '2026-10-15']],
  ];

  const antes = await estado(db);
  assert.equal(antes.logs_auditoria.startsWith('1:'), true);
  for (const [nome, sql, params] of previas) {
    const { resultado, escritas, locks } = await previaIsolada(db, sql, params);
    assert.equal(resultado.simulacao, true, nome);
    assert.equal(escritas, 0, `${nome}: previa escreveu ${escritas} linha(s)`);
    assert.equal(locks, 0, `${nome}: previa pegou advisory lock`);
    // Tambem em modo autocommit (sem transacao externa).
    await rpc(db, sql, params);
    assert.deepEqual(await estado(db), antes, `${nome}: estado mudou`);
  }
  // Controle positivo: a mesma medicao detecta a escrita da execucao real.
  const real = await previaIsolada(db, 'select public.programar_mes_tarefas($1::date, false)', ['2026-11-01']);
  assert.ok(real.escritas > 600, `execucao real deveria escrever (${real.escritas})`);
  assert.equal(real.locks, 1);
});

test('previa == execucao para todos os tipos de mudanca', async () => {
  const db = await novoBanco({ hoje: '2026-09-29' });
  await programar(db, '2026-10-01');
  await programar(db, '2026-11-01');
  await comoUsuario(db, { hoje: '2026-10-10' });
  const sem = (r) => { const { simulacao, tarefa_id, ...resto } = r; return resto; };
  const salvar = 'select public.salvar_tarefa($1, $2, $3, $4, $5, $6, $7::smallint[], $8::smallint[], $9, $10::date, $11, $12) as r';
  const casos = [
    ['nova tarefa', salvar, [null, 'Tarefa nova', 'LIMPEZA', null, null, 'dias_semana', '{1,4}', null, null, '2026-10-12', null]],
    ['entrar num grupo', salvar, [await idTarefa(db, 'Reabastecer os itens de mesa'), 'Reabastecer os itens de mesa.', 'ABASTECIMENTO E CONTROLE', null, null, 'diaria', null, null,
      await rpc(db, "select id from public.tarefas_grupos where nome = 'Fechamento — Bloco 2'"), '2026-10-20', null]],
    ['inativar', 'select public.inativar_tarefa($1, $2::date, $3)', [await idTarefa(db, 'Suplats'), '2026-10-14']],
    ['nome', 'select public.definir_nome_posicao_tarefas(2::smallint, $1, $2::date, $3)', ['Sabrina', '2026-10-11']],
  ];
  for (const [nome, sql, params] of casos) {
    const previa = await rpc(db, sql, [...params, true]);
    const real = await rpc(db, sql, [...params, false]);
    assert.deepEqual(sem(real), sem(previa), nome);
    assert.ok(real.criadas + real.removidas + real.nomes_atualizados > 0, `${nome}: caso sem efeito nao prova nada`);
  }
});

test('Itens de mesa x Bloco 1: coincidencia de deslocamento, sem acoplamento estrutural', async () => {
  const db = await novoBanco({ hoje: '2026-09-29' });
  const mesa = await idTarefa(db, 'Reabastecer os itens de mesa');
  const regra = (await db.query('select grupo_id, deslocamento, tipo from public.tarefas_regras where tarefa_id = $1', [mesa])).rows;
  assert.deepEqual(regra, [{ grupo_id: null, deslocamento: 0, tipo: 'diaria' }]);
  // Nenhuma tarefa sem grupo aponta para grupo; so as 15 dos 4 grupos tem grupo_id.
  const membros = (await db.query(`select g.nome, array_agg(t.descricao order by t.ordem) m from public.tarefas_regras r
    join public.tarefas t on t.id = r.tarefa_id join public.tarefas_grupos g on g.id = r.grupo_id group by g.nome order by g.nome`)).rows;
  assert.ok(membros.every((g) => !g.m.some((d) => d.startsWith('Reabastecer os itens de mesa') || d.startsWith('Conferir a validade'))));

  await programar(db, '2026-10-01');
  const posMesa = async () => (await db.query("select to_char(data,'YYYY-MM-DD') d, posicao from public.tarefas_ocorrencias where tarefa_id = $1 order by data", [mesa])).rows;
  const antes = await posMesa();
  // Mexer no Bloco 1 (tirar uma tarefa do bloco e inativar outra) nao arrasta Itens de mesa.
  await comoUsuario(db, { hoje: '2026-10-05' });
  const louca = await idTarefa(db, 'Lavar e secar toda a louça');
  const chapa = await idTarefa(db, 'Limpeza da chapa e bancadas');
  await rpc(db, 'select public.salvar_tarefa($1, $2, $3, $4, $5, $6, $7::smallint[], $8::smallint[], $9, $10::date, $11, false)',
    [louca, 'Lavar e secar toda a louça.', 'FECHAMENTO', null, null, 'dias_semana', '{1,2,3,4,5}', null, null, '2026-10-06', null]);
  await rpc(db, 'select public.inativar_tarefa($1, $2::date, false)', [chapa, '2026-10-06']);
  assert.deepEqual(await posMesa(), antes);
});

test('seed: grafia corrigida (refrigeradores)', async () => {
  const db = await novoBanco();
  assert.equal(await rpc(db, "select count(*)::int from public.tarefas where descricao like '%refrigeradores%'"), 1);
  assert.equal(await rpc(db, "select count(*)::int from public.tarefas where descricao like '%refriferadores%'"), 0);
});

test('seguranca: sem policy de escrita e RPCs SECURITY DEFINER com search_path vazio', async () => {
  const db = await novoBanco();
  const policies = (await db.query("select tablename, cmd from pg_policies where tablename like 'tarefas%'")).rows;
  assert.equal(policies.length, 7);
  assert.ok(policies.every((p) => p.cmd === 'SELECT'));
  const fns = (await db.query(`
    select p.proname, p.prosecdef, p.proconfig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('programar_mes_tarefas','salvar_tarefa','inativar_tarefa','excluir_tarefa','salvar_grupo_tarefas','excluir_grupo_tarefas','definir_nome_posicao_tarefas','ajustar_ocorrencia_tarefa','desfazer_ajuste_ocorrencia_tarefa','cancelar_ocorrencia_tarefa','restaurar_ocorrencia_tarefa','criar_ocorrencia_avulsa_tarefa','excluir_ocorrencia_avulsa_tarefa','marcar_conclusao_tarefa')`)).rows;
  assert.equal(fns.length, 14);
  for (const f of fns) {
    assert.equal(f.prosecdef, true, f.proname);
    assert.ok((f.proconfig || []).includes('search_path=""'), `${f.proname} ${f.proconfig}`);
  }
  const anonPode = await rpc(db, "select has_function_privilege('anon', 'public.programar_mes_tarefas(date, boolean)', 'execute')");
  const authPode = await rpc(db, "select has_function_privilege('authenticated', 'public.programar_mes_tarefas(date, boolean)', 'execute')");
  const authInterno = await rpc(db, "select has_function_privilege('authenticated', 'public.tarefas_aplicar_plano(jsonb)', 'execute')")
    || await rpc(db, "select has_function_privilege('authenticated', 'public.tarefas_plano_sincronizacao(date, date, uuid, date, text, smallint[], smallint[], uuid, smallint, smallint, date, text)', 'execute')");
  assert.equal(anonPode, false);
  assert.equal(authPode, true);
  assert.equal(authInterno, false);
});
