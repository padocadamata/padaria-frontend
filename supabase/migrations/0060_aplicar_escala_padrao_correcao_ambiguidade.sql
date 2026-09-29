-- 0060_aplicar_escala_padrao_correcao_ambiguidade.sql
-- CORRECAO da RPC public.aplicar_escala_padrao (criada na migration 0059,
-- ja executada e publicada no banco real -- 0059 permanece HISTORICA,
-- INALTERADA; esta e uma migration corretiva nova, aditiva).
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor.
--
-- ============================================================
-- CAUSA EXATA DO ERRO 42702 ("column reference funcionario_id is
-- ambiguous"), confirmada pelo Postgres REAL ao aplicar a Escala Padrao
-- da funcionaria Laura Beatriz Ribeiro Soeira (id=
-- 5ba342a4-7b6a-49d3-a955-6cc37990916e):
-- ============================================================
-- aplicar_escala_padrao usa "returns table (funcionario_id uuid, data
-- date, situacao text)" -- em PL/pgSQL, os nomes de colunas de saida de
-- RETURNS TABLE viram OUT PARAMETERS implicitos, ou seja, variaveis
-- chamadas literalmente funcionario_id/data/situacao dentro do corpo da
-- funcao (usadas de proposito para os "funcionario_id := ...; return
-- next;").
--
-- O trecho:
--   insert into public.funcionarios_escala_dias (funcionario_id, data, tipo_dia)
--   values (v_par.funcionario_id, v_par.data, v_tipo_dia)
--   on conflict (funcionario_id, data) do nothing
--   returning id into v_novo_dia_id;
--
-- tem DOIS lugares com "funcionario_id"/"data" nao qualificados: a lista
-- de colunas do INSERT ("insert into t (funcionario_id, data, ...)") e o
-- alvo do ON CONFLICT ("on conflict (funcionario_id, data)"). Os dois
-- PARECEM identicos a primeira vista, mas o Postgres os trata de forma
-- diferente:
--   * a lista de colunas do INSERT e resolvida SOMENTE contra a tabela-
--     alvo (nunca passa pela resolucao geral de "ColumnRef" onde o
--     PL/pgSQL verifica conflito com variaveis) -- por isso NAO e
--     ambigua, mesmo com um OUT parameter de mesmo nome.
--   * o alvo do ON CONFLICT PODE conter expressoes arbitrarias (ex.:
--     indices funcionais, "on conflict (lower(coluna))"), entao o
--     Postgres analisa cada elemento como uma expressao comum -- e
--     EXPRESSOES comuns SIM passam pela resolucao onde um identificador
--     que bate tanto com uma coluna da tabela quanto com uma variavel/OUT
--     parameter do PL/pgSQL de mesmo nome e rejeitado com 42702, a menos
--     que a ambiguidade seja resolvida explicitamente.
--
-- Ou seja: "on conflict (funcionario_id, data)" e o EXATO trecho que
-- produz o erro -- "funcionario_id" e "data" ali colidem com os OUT
-- parameters de mesmo nome de "returns table".
--
-- ============================================================
-- AUDITORIA COMPLETA -- eliminando a CLASSE inteira do problema, nao so o
-- primeiro ponto suspeito (releitura linha a linha de TODAS as ocorrencias
-- de funcionario_id/data/situacao no corpo da funcao):
-- ============================================================
-- Toda outra ocorrencia de funcionario_id/data e SEMPRE qualificada --
-- "v_par.funcionario_id", "v_par.data" (campo de um record PL/pgSQL,
-- resolvido pelo proprio PL/pgSQL antes de qualquer ColumnRef do SQL,
-- nunca ambiguo), "f.funcionario_id"/"d.data" (alias de tabela, sempre
-- qualificado), "pd.funcionario_id" (idem). A lista de colunas do INSERT
-- ("funcionario_id, data, tipo_dia") e, pelo raciocinio acima, imune (nao
-- e uma expressao). "situacao" nunca aparece em nenhum contexto de
-- expressao SQL dentro da funcao -- so em atribuicoes diretas PL/pgSQL
-- ("situacao := '...';"), que sao a forma CORRETA e pretendida de
-- preencher um OUT parameter para "return next" (nao um bug). O segundo
-- INSERT (em funcionarios_escala_periodos) usa colunas
-- escala_dia_id/hora_inicio/hora_fim -- nomes completamente distintos,
-- sem nenhuma relacao com os OUT parameters, e nao tem ON CONFLICT.
--
-- CONCLUSAO: o UNICO ponto ambiguo em toda a funcao e o alvo do ON
-- CONFLICT. Esta migration corrige SOMENTE esse trecho.
--
-- ============================================================
-- ESTRATEGIA DE CORRECAO
-- ============================================================
-- Trocado "on conflict (funcionario_id, data)" por
-- "on conflict on constraint funcionarios_escala_dias_funcionario_data_unico"
-- -- essa e a UNIQUE CONSTRAINT REAL criada pela migration 0055
-- (supabase/migrations/0055_funcionarios_escala.sql, tabela
-- funcionarios_escala_dias):
--   constraint funcionarios_escala_dias_funcionario_data_unico
--     unique (funcionario_id, data)
-- (nome confirmado por leitura direta do arquivo da migration 0055, nunca
-- presumido). "ON CONFLICT ON CONSTRAINT <nome>" identifica o indice pelo
-- NOME da constraint, sem nenhuma lista de colunas -- elimina
-- estruturalmente a ambiguidade (nao ha identificador de coluna nesse
-- lugar da sintaxe para colidir com os OUT parameters). Mesma semantica
-- de conflito (mesma constraint), mesmo comportamento em concorrencia.
--
-- Alternativa CONSIDERADA E DESCARTADA: declarar
-- "#variable_conflict use_column" no topo da funcao. Descartada porque
-- muda o comportamento de resolucao de ambiguidade para TODA a funcao
-- (presente e futura), inclusive pontos que hoje sao inofensivos --
-- poderia mascarar silenciosamente um bug real futuro em vez de acusa-lo
-- na hora. A correcao cirurgica via ON CONSTRAINT resolve exatamente o
-- unico ponto ambiguo, sem alterar nenhum outro comportamento de
-- resolucao de nomes na funcao.
--
-- ============================================================
-- CONTRATOS PRESERVADOS (nada disto muda nesta migration):
-- ============================================================
--   * assinatura publica: aplicar_escala_padrao(p_funcionario_ids uuid[],
--     p_datas date[]);
--   * retorno: table(funcionario_id uuid, data date, situacao text);
--   * dias operacionais ja existentes NUNCA sao sobrescritos (ainda
--     "on conflict ... do nothing", nunca "do update");
--   * concorrencia: a materializacao continua atomica via
--     "insert ... on conflict ... do nothing returning id" -- so a forma
--     de identificar o conflito mudou (por nome de constraint em vez de
--     lista de colunas), a garantia de atomicidade do proprio Postgres
--     (a constraint UNIQUE) e EXATAMENTE A MESMA;
--   * um concorrente que perde a corrida continua recebendo
--     v_novo_dia_id = null e sendo reportado como "ignorado", nunca
--     sobrescrito;
--   * periodos continuam inseridos SOMENTE usando v_novo_dia_id (o id
--     devolvido pelo RETURNING desta propria insercao) -- nenhum periodo
--     pode ser anexado a um dia preexistente ou criado por um
--     concorrente;
--   * funcionario inativo e dia sem padrao continuam com a mesma logica
--     (situacao 'funcionario_inativo'/'sem_padrao', sem nenhuma escrita);
--   * SECURITY DEFINER, search_path='', checagem explicita de
--     escala.editar, GRANT/REVOKE: inalterados;
--   * aplicar_escala_em_lote (0055) NAO e tocada por esta migration.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1. CREATE OR REPLACE FUNCTION public.aplicar_escala_padrao(uuid[], date[])
--      -- corpo identico ao da 0059, so com o ON CONFLICT corrigido.
--   2. Reafirma GRANT/REVOKE (idempotente -- CREATE OR REPLACE FUNCTION
--      preserva os privilegios ja concedidos ao OID existente, mas
--      reafirmar aqui e defensivo e sem custo, mesmo padrao ja usado nas
--      migrations anteriores desta area).
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em tabelas, indices, constraints, triggers, RLS
--     ou policies (nada disso precisa mudar -- o problema era so a
--     sintaxe de UMA clausula dentro da funcao);
--   * nenhuma alteracao em salvar_escala_padrao ou aplicar_escala_em_lote;
--   * nenhuma alteracao de permissao.
--
-- Envolvida em transacao explicita (BEGIN/COMMIT) -- so CREATE OR REPLACE
-- FUNCTION e GRANT/REVOKE.

BEGIN;

create or replace function public.aplicar_escala_padrao(
  p_funcionario_ids uuid[],
  p_datas date[]
)
returns table (
  funcionario_id uuid,
  data           date,
  situacao       text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_par           record;
  v_ativo         boolean;
  v_dia_semana    smallint;
  v_padrao_dia_id uuid;
  v_tipo_dia      text;
  v_novo_dia_id   uuid;
begin
  if not (select public.has_permissao('escala.editar')) then
    raise exception using errcode = '42501',
      message = 'aplicar_escala_padrao: requer a permissao escala.editar.';
  end if;

  if p_funcionario_ids is null or array_length(p_funcionario_ids, 1) is null then
    raise exception 'aplicar_escala_padrao: informe pelo menos 1 funcionario.';
  end if;

  if p_datas is null or array_length(p_datas, 1) is null then
    raise exception 'aplicar_escala_padrao: informe pelo menos 1 data.';
  end if;

  for v_par in
    select distinct f.funcionario_id, d.data
    from unnest(p_funcionario_ids) as f(funcionario_id)
    cross join unnest(p_datas) as d(data)
  loop
    select f.ativo into v_ativo
    from public.funcionarios f
    where f.id = v_par.funcionario_id;

    if v_ativo is null or not v_ativo then
      funcionario_id := v_par.funcionario_id;
      data := v_par.data;
      situacao := 'funcionario_inativo';
      return next;
      continue;
    end if;

    v_dia_semana := extract(dow from v_par.data)::smallint;

    select pd.id, pd.tipo_dia
      into v_padrao_dia_id, v_tipo_dia
      from public.funcionarios_escala_padrao_dias pd
      where pd.funcionario_id = v_par.funcionario_id
        and pd.dia_semana = v_dia_semana;

    if v_padrao_dia_id is null then
      funcionario_id := v_par.funcionario_id;
      data := v_par.data;
      situacao := 'sem_padrao';
      return next;
      continue;
    end if;

    -- Materializacao atomica: nunca UPDATE. CORRIGIDO nesta migration --
    -- "on conflict on constraint funcionarios_escala_dias_funcionario_data_unico"
    -- (constraint real da migration 0055) no lugar de
    -- "on conflict (funcionario_id, data)", que colidia com os OUT
    -- parameters funcionario_id/data de "returns table" (erro 42702, ver
    -- comentario no topo do arquivo). A garantia de atomicidade e a MESMA
    -- -- e a MESMA unique constraint, so identificada pelo nome em vez de
    -- pela lista de colunas. Se outra transacao concorrente ja inseriu
    -- (ou o dia ja existia de antes), esta instrucao devolve zero linhas
    -- e o dia existente permanece INTOCADO.
    insert into public.funcionarios_escala_dias (funcionario_id, data, tipo_dia)
    values (v_par.funcionario_id, v_par.data, v_tipo_dia)
    on conflict on constraint funcionarios_escala_dias_funcionario_data_unico do nothing
    returning id into v_novo_dia_id;

    if v_novo_dia_id is null then
      funcionario_id := v_par.funcionario_id;
      data := v_par.data;
      situacao := 'ignorado';
      return next;
      continue;
    end if;

    -- Periodos SOMENTE para o dia que ESTA chamada acabou de inserir
    -- (v_novo_dia_id veio do RETURNING da instrucao acima) -- nunca de um
    -- SELECT solto que poderia enxergar um dia de outra transacao.
    if v_tipo_dia = 'trabalho' then
      insert into public.funcionarios_escala_periodos (escala_dia_id, hora_inicio, hora_fim)
      select v_novo_dia_id, pp.hora_inicio, pp.hora_fim
      from public.funcionarios_escala_padrao_periodos pp
      where pp.padrao_dia_id = v_padrao_dia_id;
    end if;

    funcionario_id := v_par.funcionario_id;
    data := v_par.data;
    situacao := 'preenchido';
    return next;
  end loop;

  return;
end;
$$;

comment on function public.aplicar_escala_padrao(uuid[], date[]) is
  'Materializa a Escala Padrao na escala operacional para os funcionarios/datas informados, SOMENTE nos dias ainda "nao definidos" -- nunca sobrescreve um dia ja existente (nunca faz UPDATE em funcionarios_escala_dias). Atomicidade por linha via "insert ... on conflict on constraint funcionarios_escala_dias_funcionario_data_unico do nothing returning id" (CORRIGIDO na migration 0060 -- antes usava "on conflict (funcionario_id, data)", que colidia com os OUT parameters funcionario_id/data de "returns table" e causava erro 42702 "column reference is ambiguous"; identificar a constraint pelo nome elimina essa ambiguidade sem mudar a garantia de atomicidade, que continua vindo da mesma UNIQUE constraint da migration 0055). Uma corrida entre 2 transacoes concorrentes resulta em, no maximo, 1 insercao real; a outra recebe zero linhas e o dia e reportado como "ignorado", nunca sobrescrito. Periodos do padrao so sao inseridos para o dia que a PROPRIA chamada inseriu (via o id do RETURNING), nunca por um SELECT separado. Funcionario inativo ou sem padrao para aquele dia da semana e reportado sem nenhuma escrita. Retorna 1 linha por (funcionario_id, data) com situacao em preenchido/ignorado/sem_padrao/funcionario_inativo, para a UI resumir o resultado. SECURITY DEFINER + checagem explicita de escala.editar, mesmo raciocinio das demais RPCs desta area.';

revoke execute on function public.aplicar_escala_padrao(uuid[], date[]) from public;
revoke execute on function public.aplicar_escala_padrao(uuid[], date[]) from anon;
revoke execute on function public.aplicar_escala_padrao(uuid[], date[]) from service_role;
grant execute on function public.aplicar_escala_padrao(uuid[], date[]) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO: isto reverte aplicar_escala_padrao para a versao com o BUG de
-- ambiguidade (42702) -- so use se precisar reverter temporariamente por
-- outro motivo. Nao apaga nenhum dado (a funcao so passa a ter o
-- comportamento antigo, quebrado, de novo). Repete literalmente o corpo
-- publicado pela migration 0059.
-- BEGIN;
-- create or replace function public.aplicar_escala_padrao(
--   p_funcionario_ids uuid[],
--   p_datas date[]
-- )
-- returns table (
--   funcionario_id uuid,
--   data           date,
--   situacao       text
-- )
-- language plpgsql
-- security definer
-- set search_path = ''
-- as $$
-- declare
--   v_par           record;
--   v_ativo         boolean;
--   v_dia_semana    smallint;
--   v_padrao_dia_id uuid;
--   v_tipo_dia      text;
--   v_novo_dia_id   uuid;
-- begin
--   if not (select public.has_permissao('escala.editar')) then
--     raise exception using errcode = '42501',
--       message = 'aplicar_escala_padrao: requer a permissao escala.editar.';
--   end if;
--   if p_funcionario_ids is null or array_length(p_funcionario_ids, 1) is null then
--     raise exception 'aplicar_escala_padrao: informe pelo menos 1 funcionario.';
--   end if;
--   if p_datas is null or array_length(p_datas, 1) is null then
--     raise exception 'aplicar_escala_padrao: informe pelo menos 1 data.';
--   end if;
--   for v_par in
--     select distinct f.funcionario_id, d.data
--     from unnest(p_funcionario_ids) as f(funcionario_id)
--     cross join unnest(p_datas) as d(data)
--   loop
--     select f.ativo into v_ativo from public.funcionarios f where f.id = v_par.funcionario_id;
--     if v_ativo is null or not v_ativo then
--       funcionario_id := v_par.funcionario_id; data := v_par.data; situacao := 'funcionario_inativo';
--       return next; continue;
--     end if;
--     v_dia_semana := extract(dow from v_par.data)::smallint;
--     select pd.id, pd.tipo_dia into v_padrao_dia_id, v_tipo_dia
--       from public.funcionarios_escala_padrao_dias pd
--       where pd.funcionario_id = v_par.funcionario_id and pd.dia_semana = v_dia_semana;
--     if v_padrao_dia_id is null then
--       funcionario_id := v_par.funcionario_id; data := v_par.data; situacao := 'sem_padrao';
--       return next; continue;
--     end if;
--     insert into public.funcionarios_escala_dias (funcionario_id, data, tipo_dia)
--     values (v_par.funcionario_id, v_par.data, v_tipo_dia)
--     on conflict (funcionario_id, data) do nothing
--     returning id into v_novo_dia_id;
--     if v_novo_dia_id is null then
--       funcionario_id := v_par.funcionario_id; data := v_par.data; situacao := 'ignorado';
--       return next; continue;
--     end if;
--     if v_tipo_dia = 'trabalho' then
--       insert into public.funcionarios_escala_periodos (escala_dia_id, hora_inicio, hora_fim)
--       select v_novo_dia_id, pp.hora_inicio, pp.hora_fim
--       from public.funcionarios_escala_padrao_periodos pp
--       where pp.padrao_dia_id = v_padrao_dia_id;
--     end if;
--     funcionario_id := v_par.funcionario_id; data := v_par.data; situacao := 'preenchido';
--     return next;
--   end loop;
--   return;
-- end;
-- $$;
-- COMMIT;
