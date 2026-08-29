-- 0024_produtos_codigo_barras_opcional.sql
-- Torna public.produtos.codigo_barras opcional -- pre-requisito para o
-- cadastro de produto novo em /catalogo/novo (Catalogo de Produtos,
-- frontend futuro, ainda nao implementado). codigo_barras hoje e
-- NOT NULL + UNIQUE (confirmado por auditoria read-only: character
-- varying(50), constraint produtos_codigo_barras_key), o que torna
-- impossivel cadastrar um produto novo sem inventar um valor -- nenhuma
-- opcao de UI resolve isso sem mudar a constraint (ja avaliado e
-- descartado: codigo ficticio, UUID como codigo de barras, sequencia
-- artificial, reaproveitar codigo_g3 -- nenhuma dessas e aceitavel).
--
-- RASCUNHO EM AUDITORIA -- NAO COPIAR PARA supabase/migrations/ NEM
-- EXECUTAR ate autorizacao explicita. Gerado em scratchpad para revisao
-- estatica, SHA-256 e classificacao de risco.
--
-- Pre-requisitos: 0001..0023 ja aplicadas. Numeracao confirmada livre:
-- 0023 e a ultima migration em origin/main no momento em que este
-- arquivo foi gerado (Catalogo de Produtos, estrutura), nenhuma 0024
-- publicada ainda.
--
-- ESCOPO -- SOMENTE:
--   * public.produtos.codigo_barras: DROP NOT NULL (nada mais muda no
--     tipo/tamanho -- continua character varying(50));
--   * 1 CHECK nova, equivalente ao mesmo padrao ja usado em
--     produtos.codigo_g3 (migration 0023) e receitas.codigo_g3
--     (migration 0013): nulo e permitido, mas se preenchido nao pode
--     ser string vazia/so espaco.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhum UPDATE, nenhum TRIM, nenhum backfill, nenhuma normalizacao
--     dos 390 valores existentes -- os 390 produtos ja cadastrados
--     continuam com o valor exato que tinham antes, byte a byte;
--   * nenhuma alteracao de tipo/tamanho (character varying(50)
--     preservado);
--   * nenhuma alteracao na constraint UNIQUE existente
--     (produtos_codigo_barras_key) nem no indice unico correspondente --
--     DROP NOT NULL nao exige nem justifica tocar em UNIQUE: o
--     comportamento padrao do Postgres para UNIQUE ja trata multiplos
--     NULL como nao-conflitantes entre si, sem precisar de indice unico
--     parcial (diferente de codigo_g3, onde a exigencia era outra: unico
--     so quando preenchido, exigencia que ali JA exigia indice parcial
--     desde a criacao -- aqui a constraint já preexistente nao muda);
--   * nenhuma alteracao em codigo_g3, nas demais colunas de produtos,
--     em RLS/policies/triggers de produtos, ou em qualquer objeto criado
--     pela migration 0023 (produto_fornecedores,
--     produtos_historico_compras, produtos_resumo_compras, permissoes
--     catalogo_produtos.*);
--   * nenhuma alteracao em nenhuma outra tabela do projeto;
--   * nenhuma alteracao de frontend -- /catalogo/novo continua nao
--     implementado, esta migration so remove o impedimento estrutural.

BEGIN;

-- ============================================================
-- 1. public.produtos.codigo_barras -- DROP NOT NULL
-- ============================================================
-- Idempotente por natureza: se a coluna ja estiver nullable quando esta
-- linha rodar, o Postgres nao faz nada e nao gera erro (mesmo
-- comportamento de "ja esta assim, segue"). Nao precisa de guarda
-- condicional adicional.
alter table public.produtos
  alter column codigo_barras drop not null;

-- ============================================================
-- 2. CHECK nova -- mesmo padrao ja aprovado para codigo_g3
-- ============================================================
-- Nulo permitido (produto sem codigo de barras conhecido); se
-- preenchido, nao pode ser string vazia nem so espacos em branco.
-- Nao normaliza nenhum valor existente -- so valida daqui pra frente
-- (os 390 valores atuais, todos NOT NULL e presumivelmente nao-vazios
-- ate aqui, sao verificados por esta mesma CHECK no momento em que ela
-- e adicionada -- se algum dos 390 fosse string vazia ou so espaco, esta
-- migration falharia e abortaria inteira, nada seria commitado; a
-- pre-auditoria abaixo confirma que isso nao acontece antes de
-- autorizar a execucao).
do $$
begin
  alter table public.produtos
    add constraint produtos_codigo_barras_nao_vazio_check
    check (codigo_barras is null or btrim(codigo_barras) <> '');
exception
  when duplicate_object then null;
end $$;

comment on column public.produtos.codigo_barras is
  'Codigo de barras/identificador legado do produto, character varying(50), agora OPCIONAL (migration 0024 -- antes NOT NULL, impedia cadastrar produto novo sem inventar valor). Natureza mista confirmada por auditoria anterior (mistura de EAN de 8-14 digitos e codigos internos curtos) -- continua sem nenhuma tentativa de separar/validar isso aqui. UNIQUE (produtos_codigo_barras_key) preservada sem alteracao -- Postgres trata multiplos NULL como nao-conflitantes por padrao.';

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO: reverter exige que TODOS os produtos com codigo_barras NULL
-- (inclusive os que vierem a ser cadastrados via /catalogo/novo depois
-- desta migration) recebam um valor antes do ALTER COLUMN ... SET NOT
-- NULL conseguir rodar -- o Postgres recusa SET NOT NULL se existir
-- qualquer linha NULL na coluna nesse momento. Este rollback não faz
-- esse preenchimento automaticamente (seria inventar valor, exatamente
-- o que esta migration existe para evitar) -- precisa de decisao manual
-- caso a caso antes de reativar NOT NULL.
-- BEGIN;
-- alter table public.produtos drop constraint if exists produtos_codigo_barras_nao_vazio_check;
-- alter table public.produtos alter column codigo_barras set not null; -- SO funciona se nao houver nenhuma linha NULL
-- COMMIT;
