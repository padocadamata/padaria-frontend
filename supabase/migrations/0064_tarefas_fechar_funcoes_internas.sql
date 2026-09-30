-- 0064_tarefas_fechar_funcoes_internas.sql
-- FOLHA DE PAGAMENTO > TAREFAS -- fecha ao cliente as funcoes INTERNAS
-- (auxiliares e de trigger) criadas pelas migrations 0061 e 0062.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor.
-- Numeracao: 0063 pertence a frente Vinculo PJ/Funcionarios (ja
-- executada). Esta e a proxima livre da frente Tarefas.
--
-- ============================================================
-- CAUSA (confirmada no banco real pelo diagnostico da 0062)
-- ============================================================
--   No Supabase, os DEFAULT PRIVILEGES do schema public concedem EXECUTE
--   EXPLICITO a anon, authenticated e service_role em toda funcao nova.
--   "REVOKE ... FROM public" remove so o grant a PUBLIC -- nao esses
--   grants diretos. As 6 funcoes de TRIGGER de Tarefas (4 da 0061, 2 da
--   0062) foram revogadas apenas de PUBLIC e ficaram com
--   {anon=X, authenticated=X, service_role=X}. As 13 auxiliares ja tinham
--   sido revogadas explicitamente dos 4 papeis (revogadas de novo aqui,
--   de forma idempotente, para o estado final nao depender do historico).
--   Risco pratico era nulo (o Postgres recusa chamar funcao de trigger
--   diretamente), mas viola o criterio "funcao interna fechada ao
--   cliente".
--
-- ============================================================
-- ESCOPO -- SOMENTE privilegios
-- ============================================================
--   REVOKE EXECUTE de PUBLIC, anon, authenticated e service_role nas 19
--   funcoes internas (13 auxiliares + 6 trigger). O dono (postgres)
--   mantem EXECUTE. Triggers continuam disparando normalmente: o Postgres
--   so checa EXECUTE da funcao de trigger no CREATE TRIGGER, nunca no
--   disparo; e as auxiliares so rodam dentro das RPCs SECURITY DEFINER
--   (como o dono).
--   NAO altera: corpo/logica de nenhuma funcao, triggers, tabelas, dados,
--   ocorrencias, regras, grupos, programacao de Outubro, as 17 RPCs
--   publicas (continuam executaveis por authenticated) nem frontend.
--
--   Defensiva: aborta (rollback total) se alguma das 19 funcoes ou dos 3
--   papeis nao existir, e valida ao final que nenhuma funcao interna ficou
--   executavel pelos 4 papeis E que as 17 RPCs continuam executaveis por
--   authenticated (e nao por anon/service_role/PUBLIC). Idempotente.

BEGIN;

-- ------------------------------------------------------------
-- 1. Pre-condicoes
-- ------------------------------------------------------------
do $pre$
declare
  v_faltando text;
begin
  select string_agg(r.papel, ', ') into v_faltando
  from (values ('anon'), ('authenticated'), ('service_role')) as r(papel)
  where not exists (select 1 from pg_catalog.pg_roles as pr where pr.rolname = r.papel);
  if v_faltando is not null then
    raise exception '0064 abortada: papeis inexistentes: %', v_faltando;
  end if;

  select string_agg(f.assinatura, ', ') into v_faltando
  from (values
    ('public.tarefas_hoje()'),
    ('public.tarefas_posicao_calculada(date, text, smallint)'),
    ('public.tarefas_regra_ocorre(text, smallint[], smallint[], date)'),
    ('public.tarefas_normalizar_texto(text)'),
    ('public.tarefas_ocorrencias_esperadas(date, date, uuid, date, text, smallint[], smallint[], uuid, smallint)'),
    ('public.tarefas_nome_posicao(smallint, date, smallint, date, text)'),
    ('public.tarefas_plano_sincronizacao(date, date, uuid, date, text, smallint[], smallint[], uuid, smallint, smallint, date, text)'),
    ('public.tarefas_plano_a_partir_de(date, uuid, date, text, smallint[], smallint[], uuid, smallint, smallint, date, text)'),
    ('public.tarefas_resumir_plano(jsonb)'),
    ('public.tarefas_aplicar_plano(jsonb)'),
    ('public.tarefas_deslocamento_sugerido(uuid, text, smallint[], date)'),
    ('public.tarefas_grupo_deslocamento_sugerido(text)'),
    ('public.tarefas_ocorrencia_com_execucoes(uuid)'),
    ('public.tarefas_auditoria()'),
    ('public.tarefas_regras_protecao()'),
    ('public.tarefas_ocorrencias_protecao()'),
    ('public.tarefas_grupos_protecao()'),
    ('public.tarefas_execucoes_protecao()'),
    ('public.tarefas_execucoes_espelhar_ocorrencia()')
  ) as f(assinatura)
  where to_regprocedure(f.assinatura) is null;
  if v_faltando is not null then
    raise exception '0064 abortada: funcoes internas ausentes: %', v_faltando;
  end if;
end
$pre$;

-- ------------------------------------------------------------
-- 2. Auxiliares (13) -- ja fechadas; revogacao idempotente
-- ------------------------------------------------------------
revoke execute on function public.tarefas_hoje() from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_posicao_calculada(date, text, smallint) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_regra_ocorre(text, smallint[], smallint[], date) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_normalizar_texto(text) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_ocorrencias_esperadas(date, date, uuid, date, text, smallint[], smallint[], uuid, smallint) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_nome_posicao(smallint, date, smallint, date, text) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_plano_sincronizacao(date, date, uuid, date, text, smallint[], smallint[], uuid, smallint, smallint, date, text) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_plano_a_partir_de(date, uuid, date, text, smallint[], smallint[], uuid, smallint, smallint, date, text) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_resumir_plano(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_aplicar_plano(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_deslocamento_sugerido(uuid, text, smallint[], date) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_grupo_deslocamento_sugerido(text) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_ocorrencia_com_execucoes(uuid) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Trigger (6) -- a correcao efetiva
-- ------------------------------------------------------------
revoke execute on function public.tarefas_auditoria() from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_regras_protecao() from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_ocorrencias_protecao() from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_grupos_protecao() from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_execucoes_protecao() from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_execucoes_espelhar_ocorrencia() from public, anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 4. Pos-condicoes (qualquer falha desfaz a transacao inteira)
-- ------------------------------------------------------------
do $pos$
declare
  v_expostas text;
  v_rpcs     text;
begin
  select string_agg(f.assinatura || ' [' || r.papel || ']', ', ') into v_expostas
  from (values
    ('public.tarefas_hoje()'),
    ('public.tarefas_posicao_calculada(date, text, smallint)'),
    ('public.tarefas_regra_ocorre(text, smallint[], smallint[], date)'),
    ('public.tarefas_normalizar_texto(text)'),
    ('public.tarefas_ocorrencias_esperadas(date, date, uuid, date, text, smallint[], smallint[], uuid, smallint)'),
    ('public.tarefas_nome_posicao(smallint, date, smallint, date, text)'),
    ('public.tarefas_plano_sincronizacao(date, date, uuid, date, text, smallint[], smallint[], uuid, smallint, smallint, date, text)'),
    ('public.tarefas_plano_a_partir_de(date, uuid, date, text, smallint[], smallint[], uuid, smallint, smallint, date, text)'),
    ('public.tarefas_resumir_plano(jsonb)'),
    ('public.tarefas_aplicar_plano(jsonb)'),
    ('public.tarefas_deslocamento_sugerido(uuid, text, smallint[], date)'),
    ('public.tarefas_grupo_deslocamento_sugerido(text)'),
    ('public.tarefas_ocorrencia_com_execucoes(uuid)'),
    ('public.tarefas_auditoria()'),
    ('public.tarefas_regras_protecao()'),
    ('public.tarefas_ocorrencias_protecao()'),
    ('public.tarefas_grupos_protecao()'),
    ('public.tarefas_execucoes_protecao()'),
    ('public.tarefas_execucoes_espelhar_ocorrencia()')
  ) as f(assinatura)
  cross join (values ('public'), ('anon'), ('authenticated'), ('service_role')) as r(papel)
  where has_function_privilege(r.papel, to_regprocedure(f.assinatura), 'execute');
  if v_expostas is not null then
    raise exception '0064 abortada: funcoes internas ainda executaveis: %', v_expostas;
  end if;

  select string_agg(f.assinatura, ', ') into v_rpcs
  from (values
    ('public.programar_mes_tarefas(date, boolean)'),
    ('public.salvar_tarefa(uuid, text, text, integer, text, text, smallint[], smallint[], uuid, date, boolean, boolean)'),
    ('public.inativar_tarefa(uuid, date, boolean)'),
    ('public.excluir_tarefa(uuid)'),
    ('public.salvar_grupo_tarefas(uuid, text, text, integer)'),
    ('public.excluir_grupo_tarefas(uuid)'),
    ('public.definir_nome_posicao_tarefas(smallint, text, date, boolean)'),
    ('public.ajustar_ocorrencia_tarefa(uuid, smallint, text)'),
    ('public.desfazer_ajuste_ocorrencia_tarefa(uuid)'),
    ('public.cancelar_ocorrencia_tarefa(uuid, text)'),
    ('public.restaurar_ocorrencia_tarefa(uuid)'),
    ('public.criar_ocorrencia_avulsa_tarefa(uuid, date, smallint, text)'),
    ('public.excluir_ocorrencia_avulsa_tarefa(uuid)'),
    ('public.marcar_conclusao_tarefa(uuid, boolean)'),
    ('public.registrar_execucao_tarefa(uuid, text)'),
    ('public.remover_execucao_tarefa(uuid)'),
    ('public.renomear_execucao_tarefa(uuid, text)')
  ) as f(assinatura)
  where to_regprocedure(f.assinatura) is null
     or not has_function_privilege('authenticated', to_regprocedure(f.assinatura), 'execute')
     or has_function_privilege('anon', to_regprocedure(f.assinatura), 'execute')
     or has_function_privilege('service_role', to_regprocedure(f.assinatura), 'execute')
     or has_function_privilege('public', to_regprocedure(f.assinatura), 'execute');
  if v_rpcs is not null then
    raise exception '0064 abortada: RPCs publicas fora do estado esperado (so authenticated): %', v_rpcs;
  end if;
end
$pos$;

COMMIT;

-- ============================================================
-- ROLLBACK (manual) -- NAO recomendado: reabriria as funcoes internas.
-- So para voltar exatamente ao estado anterior das 6 funcoes de trigger:
-- ============================================================
-- BEGIN;
-- grant execute on function public.tarefas_auditoria() to anon, authenticated, service_role;
-- grant execute on function public.tarefas_regras_protecao() to anon, authenticated, service_role;
-- grant execute on function public.tarefas_ocorrencias_protecao() to anon, authenticated, service_role;
-- grant execute on function public.tarefas_grupos_protecao() to anon, authenticated, service_role;
-- grant execute on function public.tarefas_execucoes_protecao() to anon, authenticated, service_role;
-- grant execute on function public.tarefas_execucoes_espelhar_ocorrencia() to anon, authenticated, service_role;
-- COMMIT;
