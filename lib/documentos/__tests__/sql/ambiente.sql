-- Ambiente MÍNIMO para aplicar a migration 0077 num Postgres LOCAL e
-- descartável (PGlite, em memória) -- usado só por paridadeSql.test.mjs.
-- Reproduz apenas o que a 0077 usa do Supabase/migrations anteriores:
-- papéis, auth.uid(), usuários/permissões (has_permissao da 0016),
-- funcionários/cargos (0054) e folha_hoje (0066, corpo idêntico -- a
-- guarda da 0077 confere a impressão digital). NUNCA rodar no Supabase.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;
grant usage on schema auth to authenticated, anon, service_role;
grant usage on schema public to authenticated, anon, service_role;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
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

create or replace function public.folha_hoje()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

create table public.funcionarios_cargos (id uuid primary key default gen_random_uuid(), nome text not null);
create table public.funcionarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cpf text,
  rg text,
  cargo_id uuid references public.funcionarios_cargos(id),
  data_admissao date,
  ativo boolean not null default true
);
grant select on public.funcionarios, public.funcionarios_cargos to authenticated;
