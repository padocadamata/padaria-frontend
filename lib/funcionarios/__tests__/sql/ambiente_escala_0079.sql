-- Ambiente MÍNIMO para aplicar a migration 0079 num Postgres LOCAL e
-- descartável (PGlite, em memória) -- usado só por
-- escalaListarFuncionariosSql.test.mjs. Reproduz apenas o que a 0079 usa
-- do Supabase/migrations anteriores: papéis, auth.uid(), usuários/
-- permissões (has_permissao da 0016, corpo idêntico), funcionários/cargos
-- com as MESMAS policies de SELECT da 0054 e tipo_vinculo (0055/0063).
-- NUNCA rodar no Supabase.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;
grant usage on schema auth to authenticated, anon, service_role;
grant usage on schema public to authenticated, anon, service_role;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create table public.perfis (nome text primary key);
create table public.permissoes (codigo text primary key, modulo text not null, acao text not null, descricao text not null default '');
create table public.perfil_permissoes (
  perfil text not null references public.perfis(nome),
  permissao text not null references public.permissoes(codigo),
  primary key (perfil, permissao)
);
create table public.usuarios (
  id uuid primary key references auth.users(id),
  nome text,
  perfil text not null references public.perfis(nome),
  ativo boolean not null default true
);
create table public.usuario_permissoes (
  usuario_id uuid not null references public.usuarios(id),
  permissao text not null references public.permissoes(codigo),
  efeito text not null,
  expira_em timestamptz,
  primary key (usuario_id, permissao)
);
insert into public.perfis values ('proprietario_admin'), ('gestao'), ('operacional'), ('financeiro_administrativo');
insert into public.permissoes (codigo, modulo, acao) values
  ('funcionarios.visualizar', 'funcionarios', 'visualizar'),
  ('escala.visualizar', 'escala', 'visualizar'),
  ('escala.editar', 'escala', 'editar'),
  ('producao.visualizar', 'producao', 'visualizar');
insert into public.perfil_permissoes values
  ('proprietario_admin', 'funcionarios.visualizar'),
  ('proprietario_admin', 'escala.visualizar'),
  ('proprietario_admin', 'escala.editar'),
  ('operacional', 'producao.visualizar');

create or replace function public.has_permissao(perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when not exists (
        select 1 from public.usuarios u where u.id = auth.uid() and u.ativo = true
      ) then false
      when exists (
        select 1 from public.usuario_permissoes up
        where up.usuario_id = auth.uid() and up.permissao = perm and up.efeito = 'nega'
          and (up.expira_em is null or up.expira_em > now())
      ) then false
      when exists (
        select 1 from public.usuario_permissoes up
        where up.usuario_id = auth.uid() and up.permissao = perm and up.efeito = 'concede'
          and (up.expira_em is null or up.expira_em > now())
      ) then true
      else exists (
        select 1
        from public.usuarios u
        join public.perfil_permissoes pp on pp.perfil = u.perfil
        where u.id = auth.uid() and pp.permissao = perm
      )
    end;
$$;

create table public.funcionarios_cargos (id uuid primary key default gen_random_uuid(), nome text not null, ativo boolean not null default true);
create table public.funcionarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cpf text,
  telefone text,
  endereco text,
  cargo_id uuid references public.funcionarios_cargos(id),
  ativo boolean not null default true,
  usuario_id uuid unique references public.usuarios(id) on delete set null,
  tipo_vinculo text not null default 'funcionario',
  constraint funcionarios_tipo_vinculo_valido check (tipo_vinculo in ('funcionario', 'freelancer', 'pj'))
);
grant select, insert, update on public.funcionarios, public.funcionarios_cargos to authenticated;

-- Mesmas policies de SELECT da 0054.
alter table public.funcionarios_cargos enable row level security;
create policy funcionarios_cargos_select on public.funcionarios_cargos
  for select to authenticated
  using ((select public.has_permissao('funcionarios.visualizar')));
alter table public.funcionarios enable row level security;
create policy funcionarios_select on public.funcionarios
  for select to authenticated
  using ((select public.has_permissao('funcionarios.visualizar')));
