// Migration 0079 (escala_listar_funcionarios) num Postgres LOCAL em memória
// (PGlite) -- nunca o Supabase. Opcional, mesmo padrão de
// lib/documentos/__tests__/paridadeSql.test.mjs:
//
//   PGLITE_MODULE=<pasta>/node_modules/@electric-sql/pglite/dist/index.js \
//     node --test lib/funcionarios/__tests__/escalaListarFuncionariosSql.test.mjs
//
// Sem PGLITE_MODULE os testes são PULADOS. Cobre: autenticação,
// escala.visualizar (perfil, concede, nega, expirado, usuário inativo),
// EXECUTE (anon x authenticated), colunas expostas, só ativas, ordem,
// RLS de funcionarios/funcionarios_cargos intacta e reexecução recusada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulo = process.env.PGLITE_MODULE;
const pular = modulo ? false : 'defina PGLITE_MODULE para rodar a paridade com o SQL (PGlite local)';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0079_escala_listar_funcionarios.sql', import.meta.url), 'utf8');

const ADMIN = '00000000-0000-0000-0000-00000000000a';
const PRODUCAO = '00000000-0000-0000-0000-00000000000b'; // operacional + concede escala.visualizar
const SEM_ESCALA = '00000000-0000-0000-0000-00000000000c'; // operacional puro
const NEGADO = '00000000-0000-0000-0000-00000000000d'; // admin com nega escala.visualizar
const EXPIRADO = '00000000-0000-0000-0000-00000000000e'; // operacional com concede expirado
const INATIVO = '00000000-0000-0000-0000-00000000000f'; // operacional + concede, mas inativo
const FANTASMA = '00000000-0000-0000-0000-0000000000ff'; // autenticado sem linha em usuarios

let db;
async function banco() {
  if (db) return db;
  const { PGlite } = await import(pathToFileURL(modulo).href);
  db = new PGlite();
  await db.exec(readFileSync(new URL('./sql/ambiente_escala_0079.sql', import.meta.url), 'utf8'));
  await db.exec(`
    insert into auth.users values ('${ADMIN}'), ('${PRODUCAO}'), ('${SEM_ESCALA}'), ('${NEGADO}'), ('${EXPIRADO}'), ('${INATIVO}'), ('${FANTASMA}');
    insert into public.usuarios values
      ('${ADMIN}', 'Admin', 'proprietario_admin', true),
      ('${PRODUCAO}', 'Produção', 'operacional', true),
      ('${SEM_ESCALA}', 'Operacional', 'operacional', true),
      ('${NEGADO}', 'Negado', 'proprietario_admin', true),
      ('${EXPIRADO}', 'Expirado', 'operacional', true),
      ('${INATIVO}', 'Inativo', 'operacional', false);
    insert into public.usuario_permissoes values
      ('${PRODUCAO}', 'escala.visualizar', 'concede', null),
      ('${NEGADO}', 'escala.visualizar', 'nega', null),
      ('${EXPIRADO}', 'escala.visualizar', 'concede', now() - interval '1 day'),
      ('${INATIVO}', 'escala.visualizar', 'concede', null);
    insert into public.funcionarios_cargos (id, nome) values
      ('10000000-0000-0000-0000-000000000001', 'PADEIRO'),
      ('10000000-0000-0000-0000-000000000002', 'ATENDENTE');
    insert into public.funcionarios (nome, cpf, telefone, endereco, cargo_id, ativo, tipo_vinculo) values
      ('Bruna', '111', '9999', 'Rua A', '10000000-0000-0000-0000-000000000002', true, 'funcionario'),
      ('Ana', '222', '8888', 'Rua B', '10000000-0000-0000-0000-000000000001', true, 'freelancer'),
      ('Carla', '333', '7777', 'Rua C', null, true, 'pj'),
      ('Laura', '444', '6666', 'Rua D', null, false, 'funcionario');
  `);
  await db.exec(MIGRATION);
  return db;
}

// Como superusuário, como usuário logado (role authenticated + sub) ou como
// anon. Devolve { linhas, campos } ou { sqlstate, mensagem }.
async function rodar(sql, { usuario = null, papel = null } = {}) {
  const d = await banco();
  try {
    if (papel === 'anon') await d.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
    else if (usuario) await d.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${usuario}', false);`);
    else await d.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    const r = await d.query(sql);
    return { linhas: r.rows, campos: r.fields.map((f) => f.name) };
  } catch (e) {
    return { sqlstate: e.code, mensagem: e.message };
  } finally {
    await d.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

const RPC = 'select * from public.escala_listar_funcionarios()';

test('0079 aplica (pré-requisitos + verificações internas passam)', { skip: pular }, async () => {
  const r = await rodar(`select prosecdef, proconfig, provolatile from pg_proc where oid = to_regprocedure('public.escala_listar_funcionarios()')`);
  assert.equal(r.linhas.length, 1);
  assert.equal(r.linhas[0].prosecdef, true);
  assert.deepEqual(r.linhas[0].proconfig, ['search_path=""']);
  assert.equal(r.linhas[0].provolatile, 's');
});

test('Produção (operacional + concede escala.visualizar): só ativas, só colunas da escala, por nome', { skip: pular }, async () => {
  const r = await rodar(RPC, { usuario: PRODUCAO });
  assert.equal(r.sqlstate, undefined, r.mensagem);
  assert.deepEqual(r.campos, ['id', 'nome', 'ativo', 'tipo_vinculo', 'cargo_id', 'cargo_nome']);
  assert.deepEqual(r.linhas.map((l) => [l.nome, l.tipo_vinculo, l.cargo_nome, l.ativo]), [
    ['Ana', 'freelancer', 'PADEIRO', true],
    ['Bruna', 'funcionario', 'ATENDENTE', true],
    ['Carla', 'pj', null, true],
  ]);
});

test('Produção continua SEM acesso direto a funcionarios/funcionarios_cargos (RLS intacta)', { skip: pular }, async () => {
  assert.equal((await rodar('select * from public.funcionarios', { usuario: PRODUCAO })).linhas.length, 0);
  assert.equal((await rodar('select * from public.funcionarios_cargos', { usuario: PRODUCAO })).linhas.length, 0);
  const pol = await rodar(`select policyname from pg_policies where tablename in ('funcionarios', 'funcionarios_cargos') order by 1`);
  assert.deepEqual(pol.linhas.map((l) => l.policyname), ['funcionarios_cargos_select', 'funcionarios_select']);
});

test('admin pelo perfil-base também lista (comportamento antigo preservado)', { skip: pular }, async () => {
  const r = await rodar(RPC, { usuario: ADMIN });
  assert.equal(r.linhas.length, 3);
});

test('recusa com 42501: sem login, sem permissão, nega, expirado, inativo, sem linha em usuarios', { skip: pular }, async () => {
  for (const [rotulo, opcoes] of [
    ['superusuário sem auth.uid()', {}],
    ['operacional sem escala.visualizar', { usuario: SEM_ESCALA }],
    ['override nega vence o perfil', { usuario: NEGADO }],
    ['override concede expirado', { usuario: EXPIRADO }],
    ['usuário inativo', { usuario: INATIVO }],
    ['autenticado sem linha em usuarios', { usuario: FANTASMA }],
  ]) {
    const r = await rodar(RPC, opcoes);
    assert.equal(r.sqlstate, '42501', `${rotulo}: ${r.mensagem || 'devolveu linhas'}`);
  }
});

test('anon não executa; authenticated executa', { skip: pular }, async () => {
  const r = await rodar(RPC, { papel: 'anon' });
  assert.equal(r.sqlstate, '42501');
  assert.match(r.mensagem, /permission denied/i);
  const p = await rodar(`select has_function_privilege('anon', 'public.escala_listar_funcionarios()', 'execute') as anon,
                                has_function_privilege('authenticated', 'public.escala_listar_funcionarios()', 'execute') as auth`);
  assert.deepEqual(p.linhas[0], { anon: false, auth: true });
});

test('reexecutar a 0079 é recusado sem alterar nada', { skip: pular }, async () => {
  const d = await banco();
  await assert.rejects(d.exec(MIGRATION), /ja existe/);
  await d.exec('rollback;').catch(() => {});
  const r = await rodar(RPC, { usuario: PRODUCAO });
  assert.equal(r.linhas.length, 3);
});
