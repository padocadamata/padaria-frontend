-- 0048_sacos_listagem_cast_tipos.sql
-- Numeracao confirmada em disco/git antes de nomear este arquivo: maior
-- migration em supabase/migrations/ e 0047 (Sacos, ja preparada mas AINDA
-- NAO aplicada); maior arquivo *_EXECUTAR.sql na raiz tambem e 0047; git
-- log --all nao mostra nenhum commit ou ref com numero 0048+; nenhum
-- arquivo 0048 existe em disco em nenhum diretorio do repositorio no
-- momento em que este arquivo foi escrito. Existe uma frente paralela de
-- Expositores trabalhando neste mesmo repositorio (nao commitada, logo
-- invisivel via git), mas a checagem em disco e a autoridade real aqui --
-- 0048 e o proximo numero livre confirmado.
--
-- CAUSA RAIZ COMPROVADA (teste real, autenticado, no navegador, contra o
-- Supabase de producao -- reportado pelo usuario a partir da aba Network
-- do DevTools, chamando listar_sacos_fechados_configuracoes()):
--   {"code":"42804","details":"Returned type character varying(255) does
--   not match expected type text in column 2.","hint":null,
--   "message":"structure of query does not match function result type"}
--
-- DIAGNOSTICO EXATO:
--   RETORNS TABLE (0044) declara a coluna 2 como `produto_nome text`.
--   O RETURN QUERY (0044) devolve, na posicao 2, `p.nome` (a coluna
--   `nome` de public.produtos) SEM cast algum. `produtos` e uma tabela
--   legada (criada fora do historico de migrations rastreado -- nunca
--   houve um `create table public.produtos` em nenhum arquivo desta
--   pasta) cuja coluna `nome` e `character varying(255)`, nao `text`.
--
--   PL/pgSQL, em RETURN QUERY, exige que o tipo (OID) de cada coluna do
--   SELECT bata EXATAMENTE com o tipo declarado em RETURNS TABLE -- ao
--   contrario da maioria dos contextos SQL, onde varchar->text e uma
--   conversao implicita tranquila, RETURN QUERY NAO faz esse cast
--   sozinho. `character varying` e `text` sao dois OIDs de tipo
--   diferentes (1043 e 25) mesmo sendo binario-compativeis -- daí o erro
--   42804 especificamente na coluna 2.
--
--   COMPARACAO COMPLETA -- TODAS as 7 colunas do RETURN QUERY contra
--   TODAS as 7 colunas do RETURNS TABLE (nenhuma assumida, cada uma
--   verificada contra a migration onde a coluna-fonte foi declarada):
--     1) produto_fornecedor_id uuid      <- pf.id (produto_fornecedores.id
--        uuid, 0023) -- MESMO OID, sem incompatibilidade.
--     2) produto_nome           text      <- p.nome (produtos.nome
--        varchar(255), tabela legada) -- INCOMPATIVEL, causa do erro
--        real. CORRIGIDO nesta migration com `p.nome::text`.
--     3) fornecedor_nome        text      <- coalesce(f.nome_fantasia,
--        f.razao_social, f.nome) -- nome_fantasia/razao_social sao
--        `text` (adicionadas explicitamente como text na 0007); f.nome e
--        legado (provavelmente varchar, como produtos.nome, mas NUNCA
--        testado isoladamente pois esta expressao passa por COALESCE).
--        Estruturalmente esta coluna NAO deveria ter quebrado: a regra de
--        resolucao de tipo do Postgres para COALESCE/CASE, quando os
--        argumentos combinam `text` e `character varying` (mesma
--        categoria "string"), resolve para o tipo PREFERIDO da
--        categoria, que e `text` -- e exatamente por isso o erro real
--        reportado apontou so a coluna 2, nunca a 3. Mesmo assim, esta
--        migration adiciona um `::text` explicito nesta expressao tambem
--        (defensivo, nao reativo a um erro real) -- para nao depender
--        implicitamente dessa regra de resolucao de tipo caso o
--        COALESCE um dia passe a ter so 1 argumento nao-unknown (ex.: se
--        nome_fantasia e razao_social forem ambos NULL e alguem reordenar
--        os argumentos), o que mudaria o tipo resultante para o do
--        argumento restante.
--     4) peso_por_saco_kg       numeric   <- pf.peso_por_saco_kg
--        (produto_fornecedores.peso_por_saco_kg numeric(12,3), 0042) --
--        MESMO OID (1700, numeric) -- precisao/escala sao typmod, nao
--        tipo, RETURN QUERY nao compara typmod. Sem incompatibilidade.
--     5) ativo                  boolean   <- pf.ativo
--        (produto_fornecedores.ativo boolean, 0023) -- MESMO OID, sem
--        incompatibilidade.
--     6) controla_sacos_fechados boolean  <- pf.controla_sacos_fechados
--        (produto_fornecedores.controla_sacos_fechados boolean, 0042) --
--        MESMO OID, sem incompatibilidade.
--     7) saldo_sacos            integer   <- coalesce((select
--        sum(...)::integer from ...), 0) -- cast explicito ja existente
--        desde a 0044 (sum() de integer retorna bigint, por isso o cast
--        ja estava ali) + coalesce com literal integer 0 -- MESMO OID
--        (23, int4). Sem incompatibilidade.
--
--   CONCLUSAO: uma unica incompatibilidade REAL (coluna 2), mais uma
--   correcao DEFENSIVA (coluna 3) que nao era estruturalmente quebrada
--   hoje mas remove uma dependencia implicita da regra de resolucao de
--   tipo do COALESCE. As outras 5 colunas nao tem nenhuma incompatibilidade,
--   confirmada coluna a coluna contra a migration que declarou cada
--   coluna-fonte.
--
-- CORRECAO -- ESCOPO MINIMO:
--   CREATE OR REPLACE de public.listar_sacos_fechados_configuracoes(),
--   corpo IDENTICO ao da 0044 exceto os dois casts `::text` nas colunas
--   2 e 3 do RETURN QUERY. Preserva integralmente: assinatura (sem
--   parametros), RETURNS TABLE (mesmos 7 campos/nomes/tipos/ordem),
--   SECURITY DEFINER, search_path='', a checagem de
--   producao_sacos.visualizar, o filtro
--   `controla_sacos_fechados = true or exists(movimentacao)`, os JOINs,
--   grants (revoke/grant re-declarados por convencao desta frente, sem
--   mudanca de comportamento). NAO toca em nenhuma tabela, em nenhuma
--   outra RPC de Sacos (registrar_abertura_saco, registrar_saldo_inicial_
--   sacos, editar_movimentacao_saco), em estoque_movimentacoes, em
--   Pedidos/Solicitacoes nem em Expositores.
--
-- ESCOPO -- SOMENTE:
--   1) public.listar_sacos_fechados_configuracoes() -- CREATE OR REPLACE
--      (mesmo corpo da 0044 + os 2 casts ::text).
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em 0041..0047;
--   * nenhuma alteracao no schema de produtos/fornecedores/
--     produto_fornecedores (os tipos varchar(255)/text legados
--     continuam exatamente como estao -- corrigimos a RPC, nao o
--     schema, por pedido explicito);
--   * nenhuma alteracao em Pedidos/Solicitacoes nem Expositores;
--   * nenhuma carga real de dados.
--
-- Pre-requisitos: 0001..0047 ja aplicadas (0047 ainda pendente de
-- execucao manual no momento em que este arquivo foi escrito -- esta
-- migration 0048 pode ser aplicada logo em seguida, na mesma sessao, ou
-- depois, indiferente -- nao ha dependencia funcional entre as duas alem
-- da ordem numerica).

BEGIN;

create or replace function public.listar_sacos_fechados_configuracoes()
returns table (
  produto_fornecedor_id  uuid,
  produto_nome           text,
  fornecedor_nome        text,
  peso_por_saco_kg       numeric,
  ativo                  boolean,
  controla_sacos_fechados boolean,
  saldo_sacos            integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.has_permissao('producao_sacos.visualizar')) then
    raise exception using errcode = '42501',
      message = 'listar_sacos_fechados_configuracoes: requer a permissao producao_sacos.visualizar.';
  end if;

  return query
  select
    pf.id,
    p.nome::text,
    coalesce(f.nome_fantasia, f.razao_social, f.nome)::text,
    pf.peso_por_saco_kg,
    pf.ativo,
    pf.controla_sacos_fechados,
    coalesce((
      select sum(sfm.quantidade_sacos)::integer
      from public.sacos_fechados_movimentacoes sfm
      where sfm.produto_fornecedor_id = pf.id
    ), 0)
  from public.produto_fornecedores pf
  join public.produtos p on p.id = pf.produto_id
  join public.fornecedores f on f.id = pf.fornecedor_id
  where pf.controla_sacos_fechados = true
     or exists (
       select 1 from public.sacos_fechados_movimentacoes sfm
       where sfm.produto_fornecedor_id = pf.id
     );
end;
$$;

comment on function public.listar_sacos_fechados_configuracoes() is
  'Leitura READ-ONLY para a tela Producao > Sacos Fechados, independente de catalogo_produtos.visualizar (a RLS normal de produto_fornecedores exige esse codigo, nao producao_sacos.*) -- SECURITY DEFINER, exige so producao_sacos.visualizar. Devolve so os campos necessarios (produto/fornecedor/peso/ativo/controla_sacos_fechados/saldo_sacos ja somado), nunca as colunas inteiras de produto_fornecedores. Inclui configuracoes ativas+controladas (tabela de Saldo) e qualquer configuracao historica com movimentacao existente (para a tabela de Movimentacoes continuar resolvendo nomes mesmo apos a configuracao ser desativada/desmarcada). NAO grava nada. CORRIGIDO na 0048: produto_nome e fornecedor_nome agora tem cast explicito ::text -- produtos.nome e fornecedores.nome sao colunas legadas character varying(255), e PL/pgSQL RETURN QUERY exige tipo EXATO (nao so compativel) com o RETURNS TABLE declarado, causando erro 42804 em producao antes desta correcao.';

revoke execute on function public.listar_sacos_fechados_configuracoes() from public;
revoke execute on function public.listar_sacos_fechados_configuracoes() from anon;
revoke execute on function public.listar_sacos_fechados_configuracoes() from service_role;
grant execute on function public.listar_sacos_fechados_configuracoes() to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Restaura listar_sacos_fechados_configuracoes() para o corpo EXATO da
-- 0044 (sem os casts ::text -- volta a reproduzir o erro 42804 real).
-- Seguro a qualquer momento -- esta funcao e 100% leitura, nenhum dado
-- gravado por ela.
-- BEGIN;
--   create or replace function public.listar_sacos_fechados_configuracoes()
--   returns table (
--     produto_fornecedor_id  uuid,
--     produto_nome           text,
--     fornecedor_nome        text,
--     peso_por_saco_kg       numeric,
--     ativo                  boolean,
--     controla_sacos_fechados boolean,
--     saldo_sacos            integer
--   )
--   language plpgsql
--   security definer
--   set search_path = ''
--   as $$
--   begin
--     if not (select public.has_permissao('producao_sacos.visualizar')) then
--       raise exception using errcode = '42501',
--         message = 'listar_sacos_fechados_configuracoes: requer a permissao producao_sacos.visualizar.';
--     end if;
--     return query
--     select
--       pf.id,
--       p.nome,
--       coalesce(f.nome_fantasia, f.razao_social, f.nome),
--       pf.peso_por_saco_kg,
--       pf.ativo,
--       pf.controla_sacos_fechados,
--       coalesce((select sum(sfm.quantidade_sacos)::integer from public.sacos_fechados_movimentacoes sfm where sfm.produto_fornecedor_id = pf.id), 0)
--     from public.produto_fornecedores pf
--     join public.produtos p on p.id = pf.produto_id
--     join public.fornecedores f on f.id = pf.fornecedor_id
--     where pf.controla_sacos_fechados = true
--        or exists (select 1 from public.sacos_fechados_movimentacoes sfm where sfm.produto_fornecedor_id = pf.id);
--   end;
--   $$;
--   revoke execute on function public.listar_sacos_fechados_configuracoes() from public;
--   revoke execute on function public.listar_sacos_fechados_configuracoes() from anon;
--   revoke execute on function public.listar_sacos_fechados_configuracoes() from service_role;
--   grant execute on function public.listar_sacos_fechados_configuracoes() to authenticated;
-- COMMIT;
