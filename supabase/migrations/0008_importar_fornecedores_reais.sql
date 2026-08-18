-- 0008_importar_fornecedores_reais.sql
-- ============================================================
-- MIGRATION HISTÓRICA — CARGA DE DADOS JÁ REALIZADA
-- ============================================================
-- Os dados utilizados na carga original foram removidos desta versão
-- por conterem informações reais de fornecedores e não devem ser
-- armazenados no repositório público.
--
-- Nenhuma operação é necessária ao executar esta versão.
--
-- Contexto histórico:
-- - A versão original realizou a carga inicial de 21 fornecedores
--   e 19 regras de pedido/entrega.
-- - A carga original dependia da estrutura criada pela migration 0007.
-- - Os dados identificáveis utilizados naquela carga foram
--   deliberadamente omitidos desta versão pública.
--
-- Regras de negócio preservadas apenas como documentação:
-- - registros de uma mesma origem puderam ser unificados por documento;
-- - filiais com documentos distintos permaneceram cadastros separados;
-- - fornecedores sem pedido programado foram classificados como
--   modalidade_compra = 'compra_presencial';
-- - prazos no formato D+N foram representados em dias_prazo;
-- - a carga original utilizava proteção contra duplicidade de
--   fornecedores e regras.
--
-- Esta versão NÃO contém dados reais de fornecedores e NÃO executa
-- INSERT, UPDATE, DELETE ou qualquer outra alteração de dados.
-- ============================================================

BEGIN;

-- Nenhuma operação nesta versão sanitizada.
-- Este arquivo existe apenas para preservar a sequência histórica
-- das migrations sem publicar os dados reais utilizados na carga.

COMMIT;
