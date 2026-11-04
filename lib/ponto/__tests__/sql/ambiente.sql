-- Ambiente MÍNIMO para aplicar a migration 0078 num Postgres LOCAL e
-- descartável (PGlite, em memória) -- usado só por paridadeSql.test.mjs.
-- Reproduz apenas o que a 0078 usa do Supabase/migrations anteriores:
-- papéis, auth.uid(), usuários/permissões (has_permissao da 0016),
-- funcionários/cargos/vínculo (0054/0055/0065), Escala (0055), feriados
-- (0010), dados da empresa (0077) e folha_hoje / folha_tipo_vinculo_em /
-- folha_travar_funcionario (0066, corpos IDÊNTICOS -- a guarda da 0078
-- confere a impressão digital). NUNCA rodar no Supabase.

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
  cargo_id uuid references public.funcionarios_cargos(id),
  data_admissao date,
  data_demissao date,
  ativo boolean not null default true,
  tipo_vinculo text not null default 'funcionario',
  constraint funcionarios_tipo_vinculo_valido check (tipo_vinculo in ('funcionario', 'freelancer', 'pj'))
);
create table public.funcionarios_vinculo_historico (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id),
  tipo_vinculo text not null,
  vigente_desde date not null,
  unique (funcionario_id, vigente_desde)
);

create or replace function public.folha_tipo_vinculo_em(p_funcionario_id uuid, p_data date)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select h.tipo_vinculo from public.funcionarios_vinculo_historico h
      where h.funcionario_id = p_funcionario_id and h.vigente_desde <= p_data
      order by h.vigente_desde desc limit 1),
    (select h.tipo_vinculo from public.funcionarios_vinculo_historico h
      where h.funcionario_id = p_funcionario_id
      order by h.vigente_desde asc limit 1),
    (select f.tipo_vinculo from public.funcionarios f where f.id = p_funcionario_id)
  );
$$;

create or replace function public.folha_travar_funcionario(p_funcionario_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('folha_jornadas:' || p_funcionario_id::text, 0));
end;
$$;

create table public.funcionarios_escala_dias (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id),
  data date not null,
  tipo_dia text not null check (tipo_dia in ('trabalho', 'folga')),
  observacao text,
  constraint funcionarios_escala_dias_funcionario_data_unico unique (funcionario_id, data)
);
create table public.funcionarios_escala_periodos (
  id uuid primary key default gen_random_uuid(),
  escala_dia_id uuid not null references public.funcionarios_escala_dias(id) on delete cascade,
  hora_inicio time not null,
  hora_fim time not null check (hora_fim > hora_inicio)
);
create table public.funcionarios_escala_ocorrencias (
  id uuid primary key default gen_random_uuid(),
  escala_dia_id uuid not null unique references public.funcionarios_escala_dias(id) on delete cascade,
  tipo text not null check (tipo in ('falta', 'atestado')),
  observacao text
);
create table public.feriados_nacionais (data date primary key, nome text not null);
create table public.folha_documentos_config (
  id boolean primary key default true,
  nome_fantasia text,
  razao_social text,
  cnpj text,
  cidade_uf text
);
create table public.folha_documentos (id uuid primary key default gen_random_uuid());
insert into public.folha_documentos_config (id, nome_fantasia, razao_social) values (true, 'Padoca Teste', 'Padoca Teste Ltda');
grant select on public.funcionarios, public.funcionarios_cargos to authenticated;
