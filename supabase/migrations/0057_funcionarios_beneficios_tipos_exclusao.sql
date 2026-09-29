-- 0057_funcionarios_beneficios_tipos_exclusao.sql
-- FOLHA DE PAGAMENTO > CADASTRO E PARAMETRIZACOES -- Etapa A, ajuste de
-- "Gerenciar tipos de beneficio": exclusao permanente de um tipo NUNCA
-- utilizado (inativar continua sendo o caminho normal para tipos com
-- historico).
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor.
--
-- ============================================================
-- AUDITORIA (antes de propor esta migration)
-- ============================================================
-- public.funcionarios_beneficios.tipo_id referencia
-- public.funcionarios_beneficios_tipos(id) SEM "on delete cascade" nem
-- "on delete set null" (migration 0054) -- o default do Postgres quando
-- nenhuma acao e especificada e NO ACTION: tentar excluir um tipo que
-- ainda tenha 1+ linha em funcionarios_beneficios APONTANDO para ele falha
-- automaticamente com erro de chave estrangeira (23503), SEM precisar de
-- nenhuma logica adicional aqui -- a garantia "nao excluir tipo em uso" ja
-- existe estruturalmente desde a migration 0054, so nunca foi exercida
-- porque nao havia como excluir.
--
-- O que falta, e SOMENTE o que falta: funcionarios_beneficios_tipos tem
-- RLS habilitada (migration 0054) com policies de SELECT/INSERT/UPDATE,
-- mas NENHUMA policy de DELETE -- por decisao explicita daquela migration
-- ("exclusao fisica nunca e oferecida pela interface"). Com RLS habilitada
-- e nenhuma policy correspondente, um DELETE e negado para QUALQUER
-- usuario, inclusive proprietario_admin. Esta migration SOMENTE adiciona
-- essa 1 policy, restrita a quem ja tem funcionarios.editar -- exatamente
-- a mesma autorizacao ja usada para renomear/ativar/inativar tipos, sem
-- nenhuma permissao nova.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1 policy de DELETE em public.funcionarios_beneficios_tipos.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em funcionarios_beneficios (o vinculo em si) --
--     nunca remove historico em cascata;
--   * nenhuma permissao nova -- reaproveita funcionarios.editar;
--   * nenhuma alteracao em PIX (0056), Escala (0055), ou qualquer outro
--     modulo.
--
-- Envolvida em transacao explicita (BEGIN/COMMIT) -- so DDL padrao.

BEGIN;

drop policy if exists funcionarios_beneficios_tipos_delete on public.funcionarios_beneficios_tipos;
create policy funcionarios_beneficios_tipos_delete on public.funcionarios_beneficios_tipos
  for delete to authenticated
  using ((select public.has_permissao('funcionarios.editar')));

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- BEGIN;
-- drop policy if exists funcionarios_beneficios_tipos_delete on public.funcionarios_beneficios_tipos;
-- COMMIT;
