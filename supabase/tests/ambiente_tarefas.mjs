// Ambiente de teste de Tarefas: PostgreSQL embutido (PGlite, WASM) com
// stubs minimos do Supabase (auth.uid(), has_permissao, roles,
// permissoes, logs_auditoria). Nada aqui toca o Supabase real.
// "Hoje" e controlado substituindo public.tarefas_hoje() DEPOIS das
// migrations por uma versao que le a GUC teste.hoje.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { PGlite } = await import('@electric-sql/pglite');

const aqui = dirname(fileURLToPath(import.meta.url));
export const USUARIO = '11111111-1111-1111-1111-111111111111';

export function lerMigration(nome) {
  return readFileSync(join(aqui, '..', 'migrations', nome), 'utf8');
}

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
  create table public.funcionarios (id uuid primary key default gen_random_uuid(), nome text not null);
  create function public.has_permissao(perm text) returns boolean language sql stable as $$
    select auth.uid() is not null
       and not (perm = any(string_to_array(coalesce(current_setting('teste.negar', true), ''), ',')))
  $$;
`;

export const HOJE_TESTE = `
  create or replace function public.tarefas_hoje() returns date language sql stable set search_path = '' as $$
    select coalesce(nullif(current_setting('teste.hoje', true), '')::date, (now() at time zone 'America/Sao_Paulo')::date)
  $$;
`;

export async function comoUsuario(db, { hoje, negar = '', uid = USUARIO } = {}) {
  const params = [uid ?? '', negar];
  let sql = "select set_config('teste.uid', $1, false), set_config('teste.negar', $2, false)";
  if (hoje) {
    sql += ", set_config('teste.hoje', $3, false)";
    params.push(hoje);
  }
  await db.query(sql, params);
}

// Default privileges equivalentes aos do Supabase real (confirmados pelo
// diagnostico da 0062): toda funcao/tabela nova no schema public ganha
// grant EXPLICITO para anon, authenticated e service_role.
export const DEFAULT_PRIVILEGES_SUPABASE = `
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
`;

// Banco limpo com as migrations informadas (na ordem). `preparacao` (SQL
// opcional) roda depois dos stubs e antes das migrations.
export async function novoBanco({ migrations, hoje = '2026-09-29', preparacao = '' }) {
  const db = new PGlite();
  await db.exec(STUBS);
  if (preparacao) await db.exec(preparacao);
  for (const m of migrations) await db.exec(lerMigration(m));
  await db.exec(HOJE_TESTE);
  await comoUsuario(db, { hoje });
  return db;
}

export async function aplicar(db, migration) {
  await db.exec(lerMigration(migration));
  await db.exec(HOJE_TESTE);
}

export async function rpc(db, sql, params = []) {
  const r = await db.query(sql, params);
  return r.rows[0] ? Object.values(r.rows[0])[0] : undefined;
}
