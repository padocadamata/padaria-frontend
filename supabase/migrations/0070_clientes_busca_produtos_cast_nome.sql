-- 0070_clientes_busca_produtos_cast_nome.sql
-- CLIENTES -- correcao CIRURGICA de public.buscar_produtos_interesse_cliente
-- (0069, ja aplicada no banco real).
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor,
-- depois de conferir a pre-auditoria (pre_auditoria_0070_clientes_EXECUTAR.sql).
--
-- ============================================================
-- CAUSA RAIZ (reproduzida tecnicamente)
-- ============================================================
-- No teste manual real, o seletor "Produtos de interesse" mostrava "Nao foi
-- possivel buscar produtos." para qualquer termo. A RPC da 0069 declara
--   returns table (id uuid, nome text)
-- e devolve, no RETURN QUERY, `p.nome` SEM cast. public.produtos e tabela
-- legada (criada fora das migrations) e sua coluna `nome` e
-- character varying(255) -- o mesmo defeito ja documentado e corrigido na
-- migration 0048 para listar_sacos_fechados_configuracoes(). Em PL/pgSQL,
-- RETURN QUERY exige o tipo EXATO declarado (varchar e text sao OIDs
-- diferentes), entao TODA chamada falha com:
--   42804 structure of query does not match function result type --
--   Returned type character varying(255) does not match expected type
--   text in column "nome" (position 2).
-- Reproduzido no harness local com produtos.nome varchar(255) (o harness
-- original usava text e por isso nao pegou). A pre-auditoria desta
-- migration mostra o tipo real da coluna no banco.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   * CREATE OR REPLACE de public.buscar_produtos_interesse_cliente com a
--     MESMA assinatura (text, integer default 50), o MESMO tipo de retorno
--     (id uuid, nome text) e o MESMO corpo da 0069, mudando apenas
--     `p.nome` -> `p.nome::text` no SELECT. Regras preservadas: so
--     produtos ativo = true e disponivel_interesse_cliente = true, limite
--     50 (padrao e teto), busca ilike com curingas do termo tratados como
--     texto, nomes que comecam com o termo primeiro, permissao
--     clientes.visualizar.
--   * Reafirma comment e grants (EXECUTE so para authenticated).
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao de tabela, coluna, dado, policy, permissao ou de
--     qualquer outra funcao (salvar_cliente, definir_status_cliente,
--     clientes_produto_elegivel, clientes_normalizar_telefone intactas);
--   * nenhuma alteracao em public.produtos (o tipo varchar(255) de nome
--     permanece -- e legado e usado por outros modulos);
--   * nenhuma alteracao em public.pagamentos (fornecedores/NF-e).
--
-- Envolvida em transacao explicita (BEGIN/COMMIT).

BEGIN;

do $$
begin
  if to_regprocedure('public.buscar_produtos_interesse_cliente(text,integer)') is null then
    raise exception '0070 abortada: buscar_produtos_interesse_cliente(text, integer) da 0069 nao encontrada.';
  end if;
  if pg_get_function_result(to_regprocedure('public.buscar_produtos_interesse_cliente(text,integer)')) <> 'TABLE(id uuid, nome text)' then
    raise exception '0070 abortada: tipo de retorno inesperado: %', pg_get_function_result(to_regprocedure('public.buscar_produtos_interesse_cliente(text,integer)'));
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'produtos' and column_name = 'disponivel_interesse_cliente') then
    raise exception '0070 abortada: produtos.disponivel_interesse_cliente (0069) nao encontrada.';
  end if;
end $$;

create or replace function public.buscar_produtos_interesse_cliente(p_termo text, p_limite integer default 50)
returns table (
  id    uuid,
  nome  text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_termo  text := btrim(coalesce(p_termo, ''));
  v_padrao text := replace(replace(replace(btrim(coalesce(p_termo, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_limite integer := least(greatest(coalesce(p_limite, 50), 1), 50);
begin
  if not (select public.has_permissao('clientes.visualizar')) then
    raise exception using errcode = '42501',
      message = 'buscar_produtos_interesse_cliente: requer a permissao clientes.visualizar.';
  end if;

  -- (migration 0070) p.nome::text -- produtos.nome e varchar(255) (tabela
  -- legada); RETURN QUERY exige o tipo exato declarado em RETURNS TABLE.
  return query
  select p.id, p.nome::text
  from public.produtos p
  where p.ativo
    and p.disponivel_interesse_cliente
    and (v_termo = '' or p.nome ilike '%' || v_padrao || '%')
  order by
    case when v_termo <> '' and p.nome ilike v_padrao || '%' then 0 else 1 end,
    p.nome
  limit v_limite;
end;
$$;

comment on function public.buscar_produtos_interesse_cliente(text, integer) is
  'Migration 0069 (+0070: nome::text -- produtos.nome e varchar(255)). Busca (por nome, ilike, curingas do termo tratados como texto) produtos com ativo = true e disponivel_interesse_cliente = true -- no maximo 50 por chamada (padrao e teto), nomes que comecam com o termo primeiro. Nunca devolve o Catalogo inteiro. Requer clientes.visualizar.';

revoke execute on function public.buscar_produtos_interesse_cliente(text, integer) from public;
revoke execute on function public.buscar_produtos_interesse_cliente(text, integer) from anon;
revoke execute on function public.buscar_produtos_interesse_cliente(text, integer) from service_role;
grant execute on function public.buscar_produtos_interesse_cliente(text, integer) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- Recriar a funcao com o corpo da 0069 (sem o ::text) faria a busca voltar
-- a falhar -- nao ha motivo para reverter. Nenhum dado e afetado.
