-- 0063_funcionarios_tipo_vinculo_pj.sql
-- FOLHA DE PAGAMENTO > FUNCIONARIOS -- acrescenta 'pj' como terceiro valor
-- valido de funcionarios.tipo_vinculo (hoje so 'funcionario'|'freelancer',
-- migration 0055).
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor.
--
-- ============================================================
-- AUDITORIA (antes de propor esta migration)
-- ============================================================
-- public.funcionarios.tipo_vinculo: text not null default 'funcionario'
-- (migration 0055), com CHECK funcionarios_tipo_vinculo_valido
-- ("tipo_vinculo in ('funcionario', 'freelancer')").
--
-- Buscado em TODO o repositorio (migrations + frontend) por "tipo_vinculo"
-- e "freelancer": NENHUMA RPC, trigger, policy ou query SQL usa o valor
-- literal 'funcionario'/'freelancer' para ramificar logica -- o campo e
-- só armazenado e exibido. As UNICAS ocorrencias fora desta migration sao:
--   * pages/funcionarios.js -- badge "freelancer" ao lado do nome
--     (removido nesta frente, ver arquivos de frontend);
--   * pages/funcionarios/escala.js -- badge "freelancer" na Visao Semanal
--     (idem);
--   * components/funcionarios/DadosFuncionarioForm.js -- <Select> com as
--     2 opcoes atuais (ganha a 3a opcao nesta frente).
-- Nenhum RPC (aplicar_escala_em_lote, aplicar_escala_padrao,
-- salvar_escala_padrao etc.) discrimina por tipo_vinculo -- portanto esta
-- migration NAO precisa alterar nenhuma RPC.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1. Substitui a CHECK constraint funcionarios_tipo_vinculo_valido por
--      uma versao que aceita 'funcionario' | 'freelancer' | 'pj'.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao no default (permanece 'funcionario' -- nenhum
--     cadastro existente muda de valor, decisao explicita do usuario:
--     "nao migrar registros existentes, nao reinterpretar funcionarios
--     atuais");
--   * nenhum UPDATE em linhas existentes;
--   * nenhuma alteracao em RPC, trigger, policy, permissao ou em qualquer
--     outra coluna/tabela;
--   * nenhuma alteracao nas migrations 0055-0060 (Escala/Escala Padrao,
--     ja aplicadas e publicadas -- intocadas);
--   * nenhuma relacao com a frente Folha de Pagamento > Tarefas
--     (migrations 0061/0062, de outra frente).
--
-- Envolvida em transacao explicita (BEGIN/COMMIT) -- so DDL padrao.

BEGIN;

alter table public.funcionarios
  drop constraint if exists funcionarios_tipo_vinculo_valido;

alter table public.funcionarios
  add constraint funcionarios_tipo_vinculo_valido
  check (tipo_vinculo in ('funcionario', 'freelancer', 'pj'));

comment on column public.funcionarios.tipo_vinculo is
  'Migration 0055: funcionario (CLT-style) | freelancer (avulso). Migration 0063: acrescenta pj (pessoa juridica) -- MESMA tabela, MESMO funcionario_id, sem reinterpretar cadastros existentes (default permanece funcionario, nenhum registro foi migrado/alterado por esta migration). Na UI: funcionario="CLT", freelancer="Freelancer", pj="PJ".';

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO: só é seguro rodar se NENHUM funcionario tiver sido cadastrado
-- com tipo_vinculo='pj' apos esta migration -- senao o rollback recria uma
-- CHECK que aquelas linhas existentes violam, e o ALTER TABLE falha (o que
-- é o comportamento correto e esperado: o Postgres nunca aplicaria uma
-- constraint mais restritiva sobre dados que já a violam).
-- BEGIN;
-- alter table public.funcionarios drop constraint if exists funcionarios_tipo_vinculo_valido;
-- alter table public.funcionarios
--   add constraint funcionarios_tipo_vinculo_valido
--   check (tipo_vinculo in ('funcionario', 'freelancer'));
-- COMMIT;
