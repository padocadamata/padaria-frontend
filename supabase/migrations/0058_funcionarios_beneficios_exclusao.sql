-- 0058_funcionarios_beneficios_exclusao.sql
-- FOLHA DE PAGAMENTO > CADASTRO E PARAMETRIZACOES -- Etapa A, ajuste na
-- aba Beneficios do funcionario: exclusao PERMANENTE de um vinculo
-- individual (distinta de "Encerrar", que continua sendo logica --
-- ativo=false -- e preserva historico normalmente). Excluir e so para
-- lancamento feito por engano.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor.
--
-- ============================================================
-- AUDITORIA (antes de propor esta migration)
-- ============================================================
-- public.funcionarios_beneficios (migration 0054): id uuid PK,
-- funcionario_id (FK para funcionarios, on delete cascade -- nao mexido
-- aqui), tipo_id (FK para funcionarios_beneficios_tipos, sem cascade --
-- nao mexido aqui), ativo/valor/periodicidade/datas/observacoes.
--
-- NENHUMA outra tabela em NENHUMA migration do projeto referencia
-- funcionarios_beneficios.id como chave estrangeira (busca por
-- "references public.funcionarios_beneficios(" em todo supabase/
-- migrations/ antes de escrever esta migration: zero ocorrencias) -- e
-- uma tabela FOLHA. Excluir uma linha aqui nao pode deixar nenhuma outra
-- linha orfa em nenhum lugar do banco. Nenhum modulo futuro (Pagamentos/
-- FOPAG) existe ainda e nenhuma funcao/RPC hoje le desta tabela para
-- calculo algum.
--
-- funcionarios_beneficios tem RLS habilitada (migration 0054) com
-- policies de SELECT/INSERT/UPDATE, mas NENHUMA policy de DELETE --
-- mesma situacao (auditada de novo, nao presumida) ja corrigida para
-- funcionarios_beneficios_tipos na migration 0057. Sem policy de DELETE e
-- com RLS habilitada, o DELETE e negado para QUALQUER usuario, inclusive
-- proprietario_admin. Esta migration adiciona SOMENTE essa 1 policy,
-- restrita a quem ja tem funcionarios.editar -- exatamente a mesma
-- autorizacao ja usada para editar/encerrar um beneficio, sem nenhuma
-- permissao nova.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1 policy de DELETE em public.funcionarios_beneficios.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em funcionarios_beneficios_tipos (0057, ja
--     aplicada) ou em qualquer outra tabela;
--   * nenhuma permissao nova -- reaproveita funcionarios.editar;
--   * nenhuma alteracao em PIX (0056), Escala (0055), ou qualquer outro
--     modulo.
--
-- Envolvida em transacao explicita (BEGIN/COMMIT) -- so DDL padrao.

BEGIN;

drop policy if exists funcionarios_beneficios_delete on public.funcionarios_beneficios;
create policy funcionarios_beneficios_delete on public.funcionarios_beneficios
  for delete to authenticated
  using ((select public.has_permissao('funcionarios.editar')));

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- BEGIN;
-- drop policy if exists funcionarios_beneficios_delete on public.funcionarios_beneficios;
-- COMMIT;
