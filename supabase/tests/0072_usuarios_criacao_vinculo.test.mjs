// Testes da migration 0072 (criação/vínculo de usuários) sobre as
// migrations REAIS de autorização (0001 perfis/permissões, 0003 is_admin/
// has_permissao, 0004 logs_auditoria com trigger de autoria, 0016
// overrides), em PostgreSQL embutido (PGlite), simulando os default
// privileges do Supabase (EXECUTE para anon/authenticated em toda função
// nova). Também roda os SQLs de PRE/POS auditoria da raiz para validar a
// sintaxe deles. Nada aqui toca o Supabase real.
//
//   npm i --no-save @electric-sql/pglite
//   node --test supabase/tests/0072_usuarios_criacao_vinculo.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { PGlite } = await import('@electric-sql/pglite');

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..', '..');
const migration = (nome) => readFileSync(join(aqui, '..', 'migrations', nome), 'utf8');
const PRE = join(raiz, '0072_pre_auditoria_usuarios_criacao_vinculo_EXECUTAR.sql');
const POS = join(raiz, '0072_pos_auditoria_usuarios_criacao_vinculo_EXECUTAR.sql');
const EXECUTAR = join(raiz, '0072_usuarios_criacao_vinculo_EXECUTAR.sql');
const M72 = '0072_usuarios_criacao_vinculo.sql';

const ADMIN = '00000000-0000-0000-0000-00000000000a';
const ADMIN_INATIVO = '00000000-0000-0000-0000-00000000000b';
const OPERACIONAL = '00000000-0000-0000-0000-00000000000c';
const ORFAO = '00000000-0000-0000-0000-00000000000d';
const ORFAO_2 = '00000000-0000-0000-0000-00000000000e';
const ORFAO_EMAIL_REPETIDO = '00000000-0000-0000-0000-00000000000f';
const INEXISTENTE = '00000000-0000-0000-0000-0000000000ff';

const STUBS = `
  create role anon; create role authenticated; create role service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key,
    email varchar(255),
    created_at timestamptz not null default now(),
    email_confirmed_at timestamptz,
    last_sign_in_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('teste.uid', true), '')::uuid
  $$;
`;

// public.usuarios é legado (CREATE não versionado); este stub reproduz o
// estado pós-0002b: PK id -> auth.users, email UNIQUE, perfil -> perfis.
const USUARIOS = `
  create table public.usuarios (
    id uuid primary key references auth.users(id) on delete cascade,
    nome text,
    email text unique,
    perfil text references public.perfis(nome),
    ativo boolean not null default true,
    criado_em timestamptz not null default now(),
    ultimo_acesso_em timestamptz
  );
`;

const DADOS = `
  insert into auth.users (id, email, created_at, email_confirmed_at) values
    ('${ADMIN}', 'admin@padoca.test', now() - interval '30 days', now()),
    ('${ADMIN_INATIVO}', 'ex-admin@padoca.test', now() - interval '20 days', now()),
    ('${OPERACIONAL}', 'producao@padoca.test', now() - interval '10 days', now()),
    ('${ORFAO}', 'Nova.Pessoa@Padoca.TEST', now() - interval '1 day', now()),
    ('${ORFAO_2}', 'outra@padoca.test', now() - interval '2 days', null),
    ('${ORFAO_EMAIL_REPETIDO}', 'PRODUCAO@padoca.test', now() - interval '3 days', now());
  insert into public.usuarios (id, nome, email, perfil, ativo) values
    ('${ADMIN}', 'Admin', 'admin@padoca.test', 'proprietario_admin', true),
    ('${ADMIN_INATIVO}', 'Ex Admin', 'ex-admin@padoca.test', 'proprietario_admin', false),
    ('${OPERACIONAL}', 'Producao', 'producao@padoca.test', 'operacional', true);
`;

async function novoBanco({ aplicar72 = true } = {}) {
  const db = new PGlite();
  await db.exec(STUBS);
  await db.exec(migration('0001_perfis_e_permissoes.sql'));
  await db.exec(USUARIOS);
  await db.exec(migration('0003_funcoes_autorizacao.sql'));
  await db.exec(migration('0004_logs_auditoria.sql'));
  await db.exec(migration('0016_permissoes_individuais.sql').replace(
    // 0016 também mexe em RLS de tabelas de Produção que não existem neste
    // banco mínimo -- só a parte de usuario_permissoes/has_permissao importa.
    /-- =+\s*\n-- 6\. RLS de receitas[\s\S]*?(?=-- =+\s*\n-- 8\.)/,
    '',
  ));
  await db.exec(DADOS);
  if (aplicar72) await db.exec(migration(M72));
  return db;
}

async function como(db, uid) {
  await db.query("select set_config('teste.uid', $1, false)", [uid ?? '']);
}

const vincular = (db, id, nome, perfil) =>
  db.query('select * from public.admin_vincular_usuario_auth($1::uuid, $2, $3)', [id, nome, perfil]);

async function contar(db, sql) {
  const r = await db.query(sql);
  return Number(Object.values(r.rows[0])[0]);
}

async function fotografia(db) {
  const r = await db.query(`select
    (select count(*) from public.usuarios)::int as usuarios,
    (select count(*) from public.logs_auditoria)::int as logs,
    (select coalesce(string_agg(id::text || nome || email || perfil || ativo::text, ',' order by id), '') from public.usuarios) as conteudo`);
  return r.rows[0];
}

test('admin vincula login órfão: e-mail vem do Auth em minúsculas, nasce ativo, auditado com autoria do admin', async () => {
  const db = await novoBanco();
  await como(db, ADMIN);
  const { rows } = await vincular(db, ORFAO, '  Nova Pessoa  ', 'operacional');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, ORFAO);
  assert.equal(rows[0].nome, 'Nova Pessoa');
  assert.equal(rows[0].email, 'nova.pessoa@padoca.test');
  assert.equal(rows[0].perfil, 'operacional');
  assert.equal(rows[0].ativo, true);

  const log = await db.query(`select usuario_id, usuario_nome, entidade, registro_id, acao, campo, valor_novo
    from public.logs_auditoria where registro_id = $1`, [ORFAO]);
  assert.deepEqual(log.rows, [{
    usuario_id: ADMIN, usuario_nome: 'Admin', entidade: 'usuario', registro_id: ORFAO,
    acao: 'criou_vinculo', campo: 'perfil', valor_novo: 'operacional',
  }]);
});

test('usuário vinculado herda exatamente as permissões do perfil (operacional existente segue igual)', async () => {
  const db = await novoBanco();
  await como(db, ADMIN);
  await vincular(db, ORFAO, 'Nova', 'operacional');

  const efetivas = async (uid) => {
    await como(db, uid);
    const r = await db.query(`select string_agg(codigo, ',' order by codigo) as c
      from public.permissoes where public.has_permissao(codigo)`);
    return r.rows[0].c;
  };
  const novo = await efetivas(ORFAO);
  const existente = await efetivas(OPERACIONAL);
  assert.equal(novo, existente);
  assert.match(novo, /producao\.visualizar/);
  assert.doesNotMatch(novo, /usuarios\.administrar/);

  await como(db, ORFAO);
  assert.equal((await db.query('select public.is_admin() as a')).rows[0].a, false);
  await como(db, ADMIN);
  assert.equal((await db.query('select public.is_admin() as a')).rows[0].a, true);
});

test('não-admin, admin inativo e sessão anônima são barrados (42501) e nada é gravado', async () => {
  const db = await novoBanco();
  const antes = await fotografia(db);
  for (const uid of [OPERACIONAL, ADMIN_INATIVO, null]) {
    await como(db, uid);
    await assert.rejects(vincular(db, ORFAO, 'X', 'proprietario_admin'), (e) => e.code === '42501');
    await assert.rejects(db.query('select * from public.admin_listar_auth_sem_vinculo()'), (e) => e.code === '42501');
  }
  assert.deepEqual(await fotografia(db), antes);
});

test('o próprio órfão não consegue se autovincular (não é admin)', async () => {
  const db = await novoBanco();
  await como(db, ORFAO);
  await assert.rejects(vincular(db, ORFAO, 'Eu', 'proprietario_admin'), (e) => e.code === '42501');
});

test('premissas violadas abortam sem gravar nada', async () => {
  const db = await novoBanco();
  await como(db, ADMIN);
  const antes = await fotografia(db);

  const casos = [
    [ORFAO, '   ', 'operacional', /nome obrigatorio/],
    [ORFAO, 'x'.repeat(121), 'operacional', /120 caracteres/],
    [ORFAO, null, 'operacional', /nome obrigatorio/],
    [INEXISTENTE, 'Fantasma', 'operacional', /nao encontrado no Authentication/],
    [OPERACIONAL, 'Duplicado', 'operacional', /ja esta vinculado/],
    [ORFAO_EMAIL_REPETIDO, 'Mesmo email', 'operacional', /ja usado por outro usuario/],
    [ORFAO, 'Nova', 'perfil_que_nao_existe', /nao existe ou nao esta ativo/],
    [ORFAO, 'Nova', null, /nao existe ou nao esta ativo/],
  ];
  for (const [id, nome, perfil, erro] of casos) {
    await assert.rejects(vincular(db, id, nome, perfil), erro);
  }

  await db.exec("update public.perfis set ativo = false where nome = 'gestao'");
  await assert.rejects(vincular(db, ORFAO, 'Nova', 'gestao'), /nao existe ou nao esta ativo/);

  const depois = await fotografia(db);
  assert.equal(depois.usuarios, antes.usuarios);
  assert.equal(depois.logs, antes.logs);
  assert.equal(depois.conteudo, antes.conteudo);
});

test('auth.users sem e-mail é recusado', async () => {
  const db = await novoBanco();
  await db.exec(`insert into auth.users (id, email) values ('${INEXISTENTE}', null)`);
  await como(db, ADMIN);
  await assert.rejects(vincular(db, INEXISTENTE, 'Sem email', 'operacional'), /nao tem e-mail/);
});

test('listar sem vínculo: só órfãos, mais recentes primeiro, e some depois de vincular', async () => {
  const db = await novoBanco();
  await como(db, ADMIN);
  const lista = async () => (await db.query('select id, email from public.admin_listar_auth_sem_vinculo()')).rows;

  assert.deepEqual((await lista()).map((r) => r.id), [ORFAO, ORFAO_2, ORFAO_EMAIL_REPETIDO]);
  await vincular(db, ORFAO, 'Nova', 'operacional');
  assert.deepEqual((await lista()).map((r) => r.id), [ORFAO_2, ORFAO_EMAIL_REPETIDO]);
  const colunas = (await db.query('select * from public.admin_listar_auth_sem_vinculo() limit 1')).fields.map((f) => f.name);
  assert.deepEqual(colunas, ['id', 'email', 'criado_em', 'email_confirmado_em', 'ultimo_login_em']);
});

test('grants reais: anon e service_role sem EXECUTE (mesmo com default privileges do Supabase), authenticated com', async () => {
  const db = await novoBanco();
  for (const assinatura of ['public.admin_vincular_usuario_auth(uuid,text,text)', 'public.admin_listar_auth_sem_vinculo()']) {
    const r = await db.query(`select
      has_function_privilege('anon', $1, 'EXECUTE') as anon,
      has_function_privilege('service_role', $1, 'EXECUTE') as service,
      has_function_privilege('authenticated', $1, 'EXECUTE') as auth`, [assinatura]);
    assert.deepEqual(r.rows[0], { anon: false, service: false, auth: true }, assinatura);
  }

  await como(db, ADMIN);
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from public.admin_listar_auth_sem_vinculo()'), /permission denied/);
  await db.exec('reset role');

  await db.exec('set role authenticated');
  const r = await db.query('select count(*)::int as n from public.admin_listar_auth_sem_vinculo()');
  assert.equal(r.rows[0].n, 3);
  await db.exec('reset role');
});

test('funções são SECURITY DEFINER com search_path vazio', async () => {
  const db = await novoBanco();
  const r = await db.query(`select proname, prosecdef, proconfig from pg_proc
    where proname in ('admin_vincular_usuario_auth', 'admin_listar_auth_sem_vinculo') order by proname`);
  assert.equal(r.rows.length, 2);
  for (const f of r.rows) {
    assert.equal(f.prosecdef, true, f.proname);
    assert.deepEqual(f.proconfig, ['search_path=""'], f.proname);
  }
});

test('aplicar a migration não altera dados e é reaplicável', async () => {
  const db = await novoBanco({ aplicar72: false });
  const antes = await fotografia(db);
  await db.exec(migration(M72));
  await db.exec(migration(M72));
  assert.deepEqual(await fotografia(db), antes);
});

test('guarda de ambiente: aborta sem criar nada se faltar coluna ou o trigger de autoria', async () => {
  const sabotagens = [
    ['alter table auth.users drop column last_sign_in_at', /colunas esperadas ausentes/],
    ['alter table public.perfis drop column ativo cascade', /colunas esperadas ausentes/],
    ['drop trigger logs_auditoria_preencher_usuario_trigger on public.logs_auditoria', /trigger logs_auditoria_preencher_usuario_trigger/],
  ];
  for (const [sql, erro] of sabotagens) {
    const db = await novoBanco({ aplicar72: false });
    await db.exec(sql);
    await assert.rejects(db.exec(migration(M72)), erro);
    await db.exec('rollback'); // o SQL Editor faz isso sozinho ao abortar o script
    const r = await db.query(`select count(*)::int as n from pg_proc
      where proname in ('admin_vincular_usuario_auth', 'admin_listar_auth_sem_vinculo')`);
    assert.equal(r.rows[0].n, 0, sql);
  }
});

test('arquivo _EXECUTAR é idêntico à migration versionada', { skip: !existsSync(EXECUTAR) }, () => {
  assert.equal(readFileSync(EXECUTAR, 'utf8'), migration(M72));
});

test('PRE e POS auditoria: sintaxe válida, um resultset, tudo OK no cenário esperado', { skip: !existsSync(PRE) || !existsSync(POS) }, async () => {
  const db = await novoBanco({ aplicar72: false });
  const pre = await db.query(readFileSync(PRE, 'utf8'));
  // Banco de teste não tem a 0071: o marcador de catálogo é o único FALHA esperado aqui.
  const falhasPre = pre.rows.filter((r) => r.resultado !== 'OK' && r.resultado !== 'INFO').map((r) => r.checagem);
  assert.deepEqual(falhasPre, ['catalogo: 0071 aplicada (encomendas.visualizar)']);
  assert.deepEqual(Object.keys(pre.rows[0]), ['checagem', 'resultado', 'detalhe']);

  await db.exec(migration(M72));
  const pos = await db.query(readFileSync(POS, 'utf8'));
  const falhasPos = pos.rows.filter((r) => r.resultado !== 'OK' && r.resultado !== 'INFO').map((r) => r.checagem);
  assert.deepEqual(falhasPos, []);
  assert.equal(pos.rows.filter((r) => r.resultado === 'OK').length, 9);
  assert.equal(pre.rows.filter((r) => r.resultado === 'OK').length, 11);

  // POS denuncia search_path inseguro e service_role com EXECUTE.
  await db.exec(`alter function public.admin_listar_auth_sem_vinculo() set search_path = public;
    grant execute on function public.admin_vincular_usuario_auth(uuid, text, text) to service_role`);
  const posRuim = await db.query(readFileSync(POS, 'utf8'));
  assert.deepEqual(
    posRuim.rows.filter((r) => r.resultado === 'FALHA').map((r) => r.checagem).sort(),
    ['search_path vazio fixo nas 2', 'service_role NAO pode executar'],
  );

  const preDepois = await db.query(readFileSync(PRE, 'utf8'));
  const jaAplicada = preDepois.rows.filter((r) => r.resultado === 'JA APLICADA').length;
  assert.equal(jaAplicada, 2);
});
