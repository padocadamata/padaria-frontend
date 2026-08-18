
-- 0009_inativar_fornecedores_ficticios.sql
-- Inativação técnica dos 28 fornecedores fictícios legados (documento is null).
--
-- HISTÓRICO DESTA MIGRATION:
-- A primeira tentativa desta 0009 (update direto, sem tocar na constraint)
-- falhou com ERROR 23514 (fornecedores_identificacao_check), pois essa
-- constraint (criada NOT VALID na 0007) passou a ser checada em qualquer
-- update das linhas legadas, mesmo elas nunca tendo sido validadas
-- retroativamente. A transação foi revertida; nada foi alterado no banco.
-- Esta versão corrige o problema ajustando a própria constraint, na mesma
-- transação, antes da inativação.
--
-- Escopo: limpeza técnica de carga antiga. Não é uma edição operacional
-- feita por um usuário do sistema — por isso não gera registro em
-- logs_auditoria nesta migration. A auditoria operacional passa a valer
-- a partir das edições feitas pelo sistema em diante.
--
-- NÃO apaga nenhum registro (sem exclusão física).
-- NÃO altera documento, cnpj, nome, telefone, forma_pagamento ou qualquer
-- outro campo além de ativo/atualizado_em.
-- NÃO preenche nome_fantasia/razao_social artificialmente.
-- NÃO toca em fornecedor_regras_pedido.
-- NÃO toca nos 21 fornecedores reais (documento is not null).
-- NÃO altera RLS, policies ou grants.
--
-- Sobre a nova redação da constraint:
--   check (ativo is false or nome_fantasia is not null or razao_social is not null) not valid
-- Uso "ativo is false" em vez de "ativo = false" porque a coluna ativo é
-- nullable (default true). "=" propaga NULL (lógica de três valores): uma
-- linha hipotética com ativo NULL e sem identificação passaria pela
-- constraint (CHECK trata resultado NULL como satisfeito). "IS FALSE"
-- nunca retorna NULL, então essa mesma linha continuaria sendo barrada.
-- Continua NOT VALID propositalmente — não há validação retroativa
-- forçada dos dados legados nesta etapa.
--
-- Idempotência: a condição "ativo is distinct from false" garante que
-- reexecuções não alterem registros já inativados; a troca da constraint
-- é segura para reexecução por remover a versão existente antes de
-- recriá-la, sem risco de colisão de nome.
--
-- Pré-requisito: 0008_importar_fornecedores_reais.sql aplicada com sucesso.

BEGIN;

-- ============================================================
-- 1. Ajuste da constraint de identificação
-- ============================================================

alter table public.fornecedores
  drop constraint if exists fornecedores_identificacao_check;

alter table public.fornecedores
  add constraint fornecedores_identificacao_check
  check (
    ativo is false
    or nome_fantasia is not null
    or razao_social is not null
  ) not valid;

-- ============================================================
-- 2. Inativação dos 28 fornecedores fictícios
-- ============================================================

update public.fornecedores
set
  ativo = false,
  atualizado_em = current_timestamp
where documento is null
  and ativo is distinct from false;

COMMIT;


-- ============================================================
-- ROLLBACK
-- ============================================================
-- Não existe reversão automática segura para esta migration.
--
-- Fazer os 28 fornecedores fictícios voltarem ao estado ativo violaria a
-- constraint fornecedores_identificacao_check, tanto na sua redação
-- anterior quanto na redação criada por esta migration, porque nenhum
-- desses registros possui nome_fantasia ou razao_social preenchidos.
-- Qualquer tentativa de devolvê-los ao estado ativo reproduziria o mesmo
-- erro de violação de constraint apresentado por esta migration.
--
-- Por esse motivo, este bloco contém apenas explicação textual — nenhuma
-- instrução de modificação de esquema nem de atribuição de novos valores
-- é fornecida aqui, nem mesmo como documentação comentada. Restaurar
-- somente a redação anterior da constraint, sem devolver os registros ao
-- estado ativo, daria a falsa impressão de que a migration foi revertida,
-- quando na prática os 28 fornecedores continuariam inativos.
--
-- Reverter esta migration de forma real exige uma decisão específica e
-- separada — por exemplo, atribuir nome_fantasia/razao_social reais a
-- esses fornecedores antes de devolvê-los ao estado ativo, ou tratar o
-- caso de outra forma deliberada — e não deve ser feita de forma
-- automática ou genérica.