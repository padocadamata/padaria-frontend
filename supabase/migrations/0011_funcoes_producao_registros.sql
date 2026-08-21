-- 0011_funcoes_producao_registros.sql
-- Duas funções RPC de apoio ao módulo de Produção (Fase 1 do frontend):
--   public.adicionar_producao(uuid, integer)
--   public.reabrir_producao_registro(uuid, text)
--
-- NÃO EXECUTADA AUTOMATICAMENTE. Este arquivo é uma PROPOSTA de migration.
-- Rode manualmente no Supabase SQL Editor (ou via `supabase db push` se o CLI
-- for adotado depois).
--
-- Pré-requisitos reais (dependências de SQL):
--   * public.producao_registros, sua UNIQUE(data,turno,receita_id), suas
--     CHECK constraints e a trigger producao_registros_protecao — todas da
--     migration 0010_producao_registros.sql, já aplicada. Esta migration
--     NÃO altera nenhum desses objetos.
--   * public.logs_auditoria e o trigger
--     logs_auditoria_preencher_usuario() — da migration 0004, já aplicada.
--   * public.has_permissao(text) e public.is_admin() — da migration 0003,
--     já aplicadas (usadas indiretamente, ver explicação abaixo).
--
-- ESCOPO — SOMENTE estas 2 funções. Esta migration NÃO faz:
--   * qualquer alteração em tabelas (nenhum ALTER TABLE, nenhuma coluna
--     nova, nenhuma constraint nova);
--   * qualquer alteração na migration 0010 (tabelas, trigger, policies
--     de producao_registros/producao_dias/planejamento_producao/
--     feriados_nacionais permanecem exatamente como estão);
--   * qualquer permissão nova no catálogo public.permissoes — reaproveita
--     só producao.editar/producao.cancelar (já seedadas na 0001) e
--     is_admin() (já existe na 0003);
--   * qualquer INSERT/UPDATE/DELETE de dado de negócio.
--
-- Por que cada função continua sujeita à RLS (ponto central do desenho):
--   Ambas são `SECURITY INVOKER` (o padrão do Postgres, mas declarado
--   explicitamente para não depender do default implícito). Isso significa
--   que o UPDATE (e, no caso da segunda função, o INSERT em
--   logs_auditoria) executado DENTRO da função roda com os privilégios e a
--   sessão do usuário que CHAMOU a função via RPC — não do dono da
--   função. Logo:
--     * o UPDATE em producao_registros continua sendo avaliado pela
--       policy producao_registros_update (exige has_permissao(
--       'producao.editar')), exatamente como se o UPDATE tivesse sido
--       feito direto pelo cliente;
--     * a trigger producao_registros_protecao roda normalmente e enxerga
--       auth.uid() do usuário real — em reabrir_producao_registro, ela é
--       quem decide se a transição fechado->reaberto exige
--       has_permissao('producao.cancelar') (origem manual) ou is_admin()
--       (origem historico), sem essa função duplicar essa lógica;
--     * o INSERT em logs_auditoria continua sendo avaliado pela RLS
--       daquela tabela (INSERT só para o próprio usuário autenticado) e
--       pelo trigger logs_auditoria_preencher_usuario, que deriva
--       usuario_id de auth.uid() e já lança exceção se não houver sessão.
--   Se qualquer uma das duas fosse SECURITY DEFINER, o corpo rodaria com
--   os privilégios de quem criou a função (o papel usado para aplicar
--   esta migration), que tipicamente ignora RLS — um usuário sem
--   producao.editar/producao.cancelar conseguiria chamar a RPC e ela
--   funcionaria mesmo assim. SECURITY INVOKER fecha essa brecha por
--   desenho, sem precisar reimplementar checagem de permissão aqui.
--
-- Segurança de EXECUTE: REVOKE de PUBLIC e anon + GRANT somente para
-- authenticated, explícitos nesta migration (não dependemos do
-- privilégio padrão de EXECUTE que o Postgres concede a PUBLIC em
-- funções novas por padrão).
--
-- Envolvida em transação explícita (BEGIN/COMMIT) — só DDL padrão.

BEGIN;

-- ============================================================
-- 1. public.adicionar_producao(p_registro_id uuid, p_quantidade_adicional integer)
-- ============================================================
-- Soma p_quantidade_adicional a quantidade_produzida de um registro
-- origem='manual' e status='aberto', de forma atômica (um único UPDATE
-- com expressão de coluna, sem leitura prévia no cliente). Não altera
-- nenhum outro campo. Retorna a linha atualizada.

create or replace function public.adicionar_producao(
  p_registro_id uuid,
  p_quantidade_adicional integer
)
returns public.producao_registros
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_registro public.producao_registros;
begin
  if p_quantidade_adicional is null or p_quantidade_adicional <= 0 then
    raise exception
      'adicionar_producao: quantidade_adicional deve ser maior que zero.';
  end if;

  update public.producao_registros
  set quantidade_produzida = quantidade_produzida + p_quantidade_adicional
  where id = p_registro_id
    and origem = 'manual'
    and status = 'aberto'
  returning * into v_registro;

  if v_registro.id is null then
    raise exception
      'adicionar_producao: registro % nao encontrado, nao e origem=manual, ou nao esta status=aberto.',
      p_registro_id;
  end if;

  return v_registro;
end;
$$;

comment on function public.adicionar_producao(uuid, integer) is
  'Soma p_quantidade_adicional a quantidade_produzida de um registro manual/aberto, atomicamente (UPDATE com expressao de coluna, sem leitura previa no cliente). Nao altera nenhum outro campo. SECURITY INVOKER: o UPDATE roda como o usuario chamador, entao a policy producao_registros_update (has_permissao(producao.editar)) e a trigger producao_registros_protecao continuam valendo normalmente. Rejeita quantidade_adicional NULL ou <= 0, e rejeita registros que nao sejam origem=manual e status=aberto.';

revoke execute on function public.adicionar_producao(uuid, integer) from public;
revoke execute on function public.adicionar_producao(uuid, integer) from anon;
grant execute on function public.adicionar_producao(uuid, integer) to authenticated;


-- ============================================================
-- 2. public.reabrir_producao_registro(p_registro_id uuid, p_motivo text)
-- ============================================================
-- Transição atômica status='fechado' -> status='reaberto', SEM alterar
-- nenhum valor de produção/venda/sobra (a trigger 0010 já bloqueia isso
-- na mesma operação), seguida do registro de auditoria correspondente na
-- MESMA transação: se o INSERT em logs_auditoria falhar por qualquer
-- motivo, o UPDATE inteiro é revertido junto (nenhuma reabertura "muda
-- mas não fica registrada por quê").

create or replace function public.reabrir_producao_registro(
  p_registro_id uuid,
  p_motivo text
)
returns public.producao_registros
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_registro public.producao_registros;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception
      'reabrir_producao_registro: motivo e obrigatorio.';
  end if;

  update public.producao_registros
  set status = 'reaberto'
  where id = p_registro_id
    and status = 'fechado'
  returning * into v_registro;

  if v_registro.id is null then
    raise exception
      'reabrir_producao_registro: registro % nao encontrado ou nao esta status=fechado.',
      p_registro_id;
  end if;

  -- usuario_id/usuario_nome/usuario_email sao preenchidos pelo trigger
  -- logs_auditoria_preencher_usuario (migration 0004), que tambem ja
  -- lanca excecao se nao houver sessao autenticada (auth.uid() nulo) —
  -- nao duplicamos essa checagem aqui. Se este INSERT falhar por
  -- qualquer razao (RLS, trigger, constraint), a excecao propaga e o
  -- UPDATE acima e revertido junto, pois ambos estao na mesma transacao
  -- implicita desta chamada de funcao.
  insert into public.logs_auditoria (entidade, registro_id, acao, valor_novo)
  values ('producao', p_registro_id::text, 'reabriu', p_motivo);

  return v_registro;
end;
$$;

comment on function public.reabrir_producao_registro(uuid, text) is
  'Transicao atomica status=fechado -> status=reaberto em producao_registros, sem alterar nenhum valor de producao/venda/sobra (a trigger producao_registros_protecao da 0010 bloqueia isso na mesma operacao), seguida do INSERT correspondente em logs_auditoria (entidade=producao, acao=reabriu, valor_novo=motivo) na MESMA transacao — se o log falhar, a reabertura inteira falha junto. SECURITY INVOKER: o UPDATE e o INSERT rodam como o usuario chamador, entao a policy producao_registros_update (has_permissao(producao.editar)), a trigger producao_registros_protecao (has_permissao(producao.cancelar) para origem manual, is_admin() para origem historico) e a RLS de logs_auditoria continuam valendo normalmente. Exige motivo nao nulo/nao vazio (apos btrim).';

revoke execute on function public.reabrir_producao_registro(uuid, text) from public;
revoke execute on function public.reabrir_producao_registro(uuid, text) from anon;
grant execute on function public.reabrir_producao_registro(uuid, text) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro: esta migration só cria as 2 funções (com seus GRANT/REVOKE),
-- não cria nem altera nenhuma tabela, não insere nenhum dado. Nenhuma
-- outra migration depende destas funções (nenhuma trigger nem policy as
-- referencia — elas são só RPCs chamadas pelo frontend).
-- BEGIN;
-- drop function if exists public.reabrir_producao_registro(uuid, text);
-- drop function if exists public.adicionar_producao(uuid, integer);
-- COMMIT;
