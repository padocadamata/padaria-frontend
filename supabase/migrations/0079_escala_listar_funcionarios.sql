-- 0079_escala_listar_funcionarios.sql
-- FOLHA DE PAGAMENTO > ESCALA -- lista de funcionarias para quem tem
-- escala.visualizar sem funcionarios.visualizar.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor
-- ANTES de publicar o frontend que chama escala_listar_funcionarios()
-- (pages/funcionarios/escala.js). Pre-requisitos (verificados abaixo,
-- secao 0): 0016 (has_permissao), 0054 (funcionarios, funcionarios_cargos),
-- 0055 (tipo_vinculo, escala.visualizar).
--
-- ============================================================
-- PROBLEMA
-- ============================================================
-- A tela Escala carregava as funcionarias com SELECT direto em
-- public.funcionarios. A policy funcionarios_select (0054) exige
-- funcionarios.visualizar. Um usuario com escala.visualizar mas SEM
-- funcionarios.visualizar (ex.: perfil operacional com override so de
-- Escala) recebia 0 linhas, sem erro -- Escala vazia. As tabelas da
-- escala (0055/0059) e as RPCs de escrita (security definer) ja eram
-- liberadas so por escala.*; faltava apenas a lista de nomes.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1. public.escala_listar_funcionarios() -- SECURITY DEFINER, STABLE,
--      search_path vazio, exige usuario autenticado + has_permissao(
--      'escala.visualizar'), devolve SO as colunas que a Escala ja usava
--      (id, nome, ativo, tipo_vinculo, cargo_id, cargo_nome) das
--      funcionarias ATIVAS. Nunca CPF, salario, endereco, contato,
--      usuario_id ou qualquer outro campo do cadastro.
--   2. EXECUTE so para authenticated (revogado de PUBLIC e anon).
--
-- NAO FAZ: nenhuma alteracao de policy/RLS existente, de permissoes,
-- perfis, usuarios, usuario_permissoes, funcionarios ou tabelas da Escala.
-- Nenhuma permissao nova; nenhuma concessao. Toda a migration roda numa
-- transacao: se qualquer verificacao falhar, NADA e aplicado.

BEGIN;

-- ============================================================
-- 0. Pre-requisitos (aborta a transacao se faltar algo)
-- ============================================================
do $$
begin
  if to_regprocedure('public.has_permissao(text)') is null then
    raise exception '0079: public.has_permissao(text) nao existe (migration 0016).';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'funcionarios'
         and column_name in ('id', 'nome', 'ativo', 'tipo_vinculo', 'cargo_id')) <> 5 then
    raise exception '0079: public.funcionarios sem alguma coluna esperada (id, nome, ativo, tipo_vinculo, cargo_id).';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'funcionarios_cargos'
         and column_name in ('id', 'nome')) <> 2 then
    raise exception '0079: public.funcionarios_cargos sem id/nome.';
  end if;
  if not exists (select 1 from public.permissoes where codigo = 'escala.visualizar') then
    raise exception '0079: permissao escala.visualizar nao existe no catalogo (migration 0055).';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'escala_listar_funcionarios') then
    raise exception '0079: public.escala_listar_funcionarios ja existe -- migration ja aplicada? Nada foi alterado.';
  end if;
end;
$$;

-- ============================================================
-- 1. Funcao
-- ============================================================
create function public.escala_listar_funcionarios()
returns table (
  id uuid,
  nome text,
  ativo boolean,
  tipo_vinculo text,
  cargo_id uuid,
  cargo_nome text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not (select public.has_permissao('escala.visualizar')) then
    raise exception 'Sem permissao para visualizar a escala.' using errcode = '42501';
  end if;

  return query
    select f.id, f.nome, f.ativo, f.tipo_vinculo, f.cargo_id, c.nome
    from public.funcionarios f
    left join public.funcionarios_cargos c on c.id = f.cargo_id
    where f.ativo = true
    order by f.nome;
end;
$$;

comment on function public.escala_listar_funcionarios() is
  'Migration 0079. Lista minima de funcionarias ATIVAS para a tela Escala (id, nome, ativo, tipo_vinculo, cargo_id, cargo_nome), exigindo usuario autenticado + escala.visualizar -- independente de funcionarios.visualizar (RLS de public.funcionarios continua intacta). Nunca devolve dados pessoais/financeiros do cadastro.';

-- ============================================================
-- 2. Privilegios de execucao
-- ============================================================
revoke execute on function public.escala_listar_funcionarios() from public, anon;
grant execute on function public.escala_listar_funcionarios() to authenticated;

-- ============================================================
-- 3. Verificacoes de seguranca (abortam a transacao se falharem)
-- ============================================================
do $$
declare
  v_oid oid := to_regprocedure('public.escala_listar_funcionarios()');
begin
  if v_oid is null then
    raise exception '0079: funcao nao foi criada.';
  end if;
  if not (select prosecdef from pg_proc where oid = v_oid) then
    raise exception '0079: funcao deveria ser SECURITY DEFINER.';
  end if;
  if not exists (select 1 from pg_proc where oid = v_oid and 'search_path=""' = any (proconfig)) then
    raise exception '0079: funcao deveria ter search_path vazio.';
  end if;
  if has_function_privilege('anon', v_oid, 'execute') then
    raise exception '0079: anon NAO deveria executar a funcao.';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception '0079: authenticated deveria executar a funcao.';
  end if;
  -- Sem usuario autenticado (contexto do SQL Editor: auth.uid() nulo) a
  -- funcao TEM de recusar com 42501.
  begin
    perform * from public.escala_listar_funcionarios();
    raise exception '0079: funcao devolveu dados sem usuario autenticado.';
  exception
    when insufficient_privilege then null; -- esperado
  end;
end;
$$;

COMMIT;

-- ============================================================
-- ROLLBACK (manual, se necessario)
-- ============================================================
-- drop function if exists public.escala_listar_funcionarios();
-- (e reverter pages/funcionarios/escala.js para o SELECT direto)
