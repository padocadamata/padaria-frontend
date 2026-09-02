-- 0033_saneamento_catalogo_producao.sql
-- Saneamento pontual, pre-requisito da futura unificacao Catalogo x
-- Producao (receitas.catalogo_produto_id -> produtos.id, NAO
-- implementada nesta migration). Remove DEFINITIVAMENTE, por UUID
-- exato (nunca so por nome), 6 registros ja auditados manualmente no
-- Supabase e confirmados sem nenhuma dependencia real:
--
--   4 receitas orfas (sem produto correspondente no Catalogo, sem uso
--   em nenhuma tabela de Producao) -- nomes EXATOS confirmados pelo
--   usuario apos consulta real no Supabase, usados como guarda de
--   igualdade estrita (nao normalizada) na migration:
--     - c0f658d5-da59-494b-b5ee-9e9f5a0b044f  MASSA DOCE BOLA
--     - 07fe6a5d-a72f-48fd-b27c-383d8eac51c6  MAX BAGUETE
--     - ad22c2a0-0fd1-4ce0-8782-e2fd0a541189  Pão 12 grãos
--     - 01d0ce9f-ce22-4795-96b8-2e4473579847  PAO BAGUETE INTEGRAL
--
--   2 produtos duplicados INATIVOS do Catalogo (o par ATIVO de cada um
--   NAO e tocado por esta migration):
--     - 43667479-2c05-495c-8090-feee80174dc3  OVO BRANCO   (inativo, cod. barras 7897372300226)
--     - 0e15db63-bc38-407e-b246-6a725310aaeb  OVO VERMELHO (inativo, cod. barras 7897372300523)
--
-- RASCUNHO EM AUDITORIA -- NAO COPIAR PARA supabase/migrations/ NEM
-- EXECUTAR ate autorizacao explicita. Numeracao 0033 confirmada livre
-- (ultima migration publicada em supabase/migrations/ e 0032; nenhuma
-- 0033 publicada ainda -- os arquivos 0033_pre_auditoria_... e
-- 0033_exclusoes_orfas_ovos_... na raiz sao scratchpads read-only de
-- rodadas anteriores desta mesma numeracao, nao migrations).
--
-- ============================================================
-- BASE DA AUDITORIA -- resultado real colado pelo usuario apos rodar
-- 0033_exclusoes_orfas_ovos_EXECUTAR.sql manualmente no SQL Editor:
-- ============================================================
--   * as 4 receitas acima: ZERO linhas em producao_registros,
--     planejamento_producao, receita_ingredientes e (indiretamente, via
--     producao_registros) producao_expositor_lotes. public.producao_diaria
--     existe mas tem ZERO linhas no banco inteiro (nao e dependencia de
--     nada hoje).
--   * OVO BRANCO ativo (37db9983-fce8-4be0-8d3d-99299672d1fe, cod.
--     barras 7897624400025) e OVO VERMELHO ativo (88898f6f-9f41-4d97-
--     8c3c-100c62df2444, cod. barras 7897624400063): tem uso real
--     (pedido_itens=1, produtos_historico_compras=1 cada) -- por isso
--     NAO SAO TOCADOS por esta migration, nem lidos para escrita, so
--     citados aqui como contexto para os revisores nao confundirem os
--     4 UUIDs de produtos com os 2 que devem ser preservados.
--   * OVO BRANCO inativo e OVO VERMELHO inativo (os 2 UUIDs que este
--     arquivo apaga): ZERO dependencias em pedido_itens,
--     produto_fornecedores, produtos_historico_compras,
--     receita_ingredientes, cotacoes.
--   * CONTAGEM RESOLVIDA (nao e mais divergencia em aberto): a
--     pre-auditoria real (0033_pre_auditoria_unificacao_catalogo_
--     producao_EXECUTAR.sql) confirmou total_receitas_hoje = 34, das
--     quais exatamente 30 tem 1 correspondencia unica por nome
--     normalizado no Catalogo, 4 nao tem nenhuma (as 4 alvo deste
--     saneamento) e 0 tem multiplas. Apos o DELETE das 4, o total
--     esperado e exatamente 30 -- verificado como guarda dura na
--     migration (secao 6) e reconfirmado no arquivo de pos-auditoria.
--
-- ============================================================
-- DECISAO -- logs_auditoria: NAO usado nesta migration (documentado)
-- ============================================================
-- Auditado o padrao existente (migration 0004 + as 4 RPCs de exclusao
-- do projeto: excluir_produto_catalogo/excluir_produto_fornecedor/
-- excluir_catalogo_secao/excluir_catalogo_categoria). TODAS elas
-- inserem em logs_auditoria, mas SEMPRE dentro de uma function SECURITY
-- DEFINER chamada via RPC por um usuario autenticado do frontend -- ou
-- seja, sempre com auth.uid() preenchido. A propria migration 0004 tem
-- uma trigger BEFORE INSERT (logs_auditoria_preencher_usuario) que
-- ABORTA com raise exception se auth.uid() for nulo, e documenta
-- explicitamente (comentario final da 0004) que gravar auditoria sem
-- sessao de usuario real (ex.: script rodado direto no SQL Editor, sem
-- JWT) e um caso EM ABERTO, deliberadamente adiado ate aparecer o
-- primeiro caso real, com 2 estrategias possiveis (usuario "sistema"
-- dedicado, ou GUC de sessao) -- nenhuma delas implementada ainda.
--
-- Esta migration roda exatamente nesse contexto sem sessao (SQL Editor,
-- execucao manual, sem JWT) -- logo, um INSERT em logs_auditoria aqui
-- FALHARIA com a mesma excecao, abortando a transacao inteira. O
-- PRECEDENTE DIRETO ja existe no proprio repositorio: a migration 0014
-- (limpeza fisica de 12 receitas invalidas, mesmo formato: guardas de
-- pre-condicao, DELETE restrito por UUID, assert de pos-condicao,
-- tambem rodada manualmente no SQL Editor) tambem NAO usa
-- logs_auditoria, pelo mesmo motivo estrutural.
--
-- DECISAO (seguindo esse precedente, sem inventar mecanismo novo fora
-- do escopo desta migration pequena e isolada -- criar um usuario
-- "sistema" ou estender a trigger com GUC seria uma mudanca de
-- schema/seguranca a parte, nao um saneamento pontual): esta migration
-- NAO grava em logs_auditoria. O rastro de auditoria desta exclusao e:
-- (1) este proprio arquivo, versionado no git com a justificativa e os
-- UUIDs exatos; (2) os 2 scratchpads read-only que comprovam a auditoria
-- manual antes do DELETE (0033_exclusoes_orfas_ovos_EXECUTAR.sql) e
-- depois dele (0033_pos_auditoria_saneamento_catalogo_producao_
-- EXECUTAR.sql); (3) os proprios NOTICE emitidos abaixo, visiveis no
-- log de execucao do SQL Editor. Se no futuro este projeto adotar a
-- estrategia (a) ou (b) do comentario da 0004, exclusoes administrativas
-- futuras via SQL Editor poderao logar normalmente -- fora do escopo
-- de agora.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   * DELETE fisico das 4 receitas listadas acima, restrito a estes 4
--     UUIDs exatos;
--   * DELETE fisico dos 2 produtos INATIVOS listados acima, restrito a
--     estes 2 UUIDs exatos;
--   * guardas de pre-condicao (existencia + nome esperado + zero
--     dependencia, re-checadas no momento da execucao, nao reaproveitando
--     cegamente o resultado da auditoria anterior) ANTES de qualquer
--     DELETE;
--   * assert de pos-condicao (contagem de linhas removidas) logo apos
--     cada DELETE.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao de schema, constraint, RLS, policy, trigger ou
--     funcao -- somente DELETE de linhas ja identificadas;
--   * nenhum UPDATE em nenhuma linha (nem nos 2 produtos ATIVOS
--     preservados, nem em nenhuma outra receita/produto);
--   * nenhuma exclusao em cascata nem qualquer alteracao de FK;
--   * nenhuma implementacao da unificacao Catalogo x Producao
--     (receitas.catalogo_produto_id fica para migration futura, separada);
--   * nenhuma alteracao de frontend;
--   * nenhuma normalizacao de maiusculas (fica para etapa posterior,
--     separada, conforme decisao ja registrada).
--
-- CONCORRENCIA -- mesma tecnica ja usada e comentada em
-- excluir_produto_catalogo (migration 0029): "select ... for update" em
-- cada linha ANTES de checar qualquer dependencia toma um lock FOR
-- UPDATE nela. Qualquer INSERT/UPDATE concorrente em qualquer tabela
-- filha que referencie este id precisa, por mecanismo interno do
-- Postgres (RI_FKey_check disparado pela FK em si, independente do ON
-- DELETE escolhido), tomar um lock FOR KEY SHARE na linha referenciada
-- antes de confirmar seu proprio INSERT/UPDATE -- FOR UPDATE conflita
-- com FOR KEY SHARE, entao nenhuma dependencia nova pode aparecer entre
-- a checagem e o DELETE desta transacao.
--
-- IRREVERSIVEL: DELETE fisico de dado nao e desfazivel por um bloco de
-- ROLLBACK em SQL. Reverter exigiria restaurar as 6 linhas a partir de
-- um backup/snapshot do banco anterior a execucao desta migration.

BEGIN;

do $$
declare
  v_nome text;
  v_ativo boolean;
  v_codigo_barras text;
  v_qtd int;
  v_receitas_antes int;
  v_receitas_depois int;
  v_produtos_antes int;
  v_produtos_depois int;
  v_removido int;
begin
  select count(*) into v_receitas_antes from public.receitas;
  select count(*) into v_produtos_antes from public.produtos;

  -- GUARDA 0 -- condicao objetiva confirmada pela pre-auditoria real
  -- (0033_pre_auditoria_unificacao_catalogo_producao_EXECUTAR.sql,
  -- rodada manualmente pelo usuario): total de receitas ANTES desta
  -- migration deve ser exatamente 34 (30 com correspondencia unica no
  -- Catalogo + 4 orfas alvo deste saneamento). Nao e mais uma divergencia
  -- em aberto -- se o total mudou desde a auditoria (nova receita
  -- cadastrada, outra exclusao rodada por fora), abortar e reavaliar
  -- antes de prosseguir, em vez de assumir que a base ainda bate.
  if v_receitas_antes <> 34 then
    raise exception 'saneamento: total de receitas antes do DELETE e %, esperado exatamente 34 (confirmado pela pre-auditoria) -- abortando, situacao mudou desde a auditoria.', v_receitas_antes;
  end if;

  -- ============================================================
  -- 1) GUARDA -- as 4 receitas: existem, nome bate por IGUALDADE
  --    ESTRITA (case-sensitive, acento exato) contra os valores reais
  --    retornados pelo Supabase na auditoria manual desta rodada -- sem
  --    normalizacao, sem tolerancia de variacao. Lock FOR UPDATE
  --    tomado aqui.
  -- ============================================================

  select nome into v_nome from public.receitas
    where id = 'c0f658d5-da59-494b-b5ee-9e9f5a0b044f'::uuid for update;
  if v_nome is null then
    raise exception 'saneamento: receita c0f658d5-da59-494b-b5ee-9e9f5a0b044f nao encontrada -- abortando.';
  end if;
  if v_nome <> 'MASSA DOCE BOLA' then
    raise exception 'saneamento: receita c0f658d5-da59-494b-b5ee-9e9f5a0b044f tem nome "%", esperado exatamente "MASSA DOCE BOLA" -- abortando.', v_nome;
  end if;

  select nome into v_nome from public.receitas
    where id = '07fe6a5d-a72f-48fd-b27c-383d8eac51c6'::uuid for update;
  if v_nome is null then
    raise exception 'saneamento: receita 07fe6a5d-a72f-48fd-b27c-383d8eac51c6 nao encontrada -- abortando.';
  end if;
  if v_nome <> 'MAX BAGUETE' then
    raise exception 'saneamento: receita 07fe6a5d-a72f-48fd-b27c-383d8eac51c6 tem nome "%", esperado exatamente "MAX BAGUETE" -- abortando.', v_nome;
  end if;

  select nome into v_nome from public.receitas
    where id = 'ad22c2a0-0fd1-4ce0-8782-e2fd0a541189'::uuid for update;
  if v_nome is null then
    raise exception 'saneamento: receita ad22c2a0-0fd1-4ce0-8782-e2fd0a541189 nao encontrada -- abortando.';
  end if;
  if v_nome <> 'Pão 12 grãos' then
    raise exception 'saneamento: receita ad22c2a0-0fd1-4ce0-8782-e2fd0a541189 tem nome "%", esperado exatamente "Pão 12 grãos" -- abortando.', v_nome;
  end if;

  select nome into v_nome from public.receitas
    where id = '01d0ce9f-ce22-4795-96b8-2e4473579847'::uuid for update;
  if v_nome is null then
    raise exception 'saneamento: receita 01d0ce9f-ce22-4795-96b8-2e4473579847 nao encontrada -- abortando.';
  end if;
  if v_nome <> 'PAO BAGUETE INTEGRAL' then
    raise exception 'saneamento: receita 01d0ce9f-ce22-4795-96b8-2e4473579847 tem nome "%", esperado exatamente "PAO BAGUETE INTEGRAL" -- abortando.', v_nome;
  end if;

  -- ============================================================
  -- 2) GUARDA -- as 4 receitas: zero dependencia real, re-checada agora
  --    (nao reaproveita cegamente o resultado da auditoria anterior).
  -- ============================================================
  select count(*) into v_qtd
  from public.producao_registros
  where receita_id = any(array[
    'c0f658d5-da59-494b-b5ee-9e9f5a0b044f', '07fe6a5d-a72f-48fd-b27c-383d8eac51c6',
    'ad22c2a0-0fd1-4ce0-8782-e2fd0a541189', '01d0ce9f-ce22-4795-96b8-2e4473579847'
  ]::uuid[]);
  if v_qtd <> 0 then
    raise exception 'saneamento: % registro(s) em producao_registros referenciam alguma das 4 receitas alvo -- abortando, nenhum DELETE realizado.', v_qtd;
  end if;

  select count(*) into v_qtd
  from public.planejamento_producao
  where receita_id = any(array[
    'c0f658d5-da59-494b-b5ee-9e9f5a0b044f', '07fe6a5d-a72f-48fd-b27c-383d8eac51c6',
    'ad22c2a0-0fd1-4ce0-8782-e2fd0a541189', '01d0ce9f-ce22-4795-96b8-2e4473579847'
  ]::uuid[]);
  if v_qtd <> 0 then
    raise exception 'saneamento: % registro(s) em planejamento_producao referenciam alguma das 4 receitas alvo -- abortando, nenhum DELETE realizado.', v_qtd;
  end if;

  select count(*) into v_qtd
  from public.receita_ingredientes
  where receita_id = any(array[
    'c0f658d5-da59-494b-b5ee-9e9f5a0b044f', '07fe6a5d-a72f-48fd-b27c-383d8eac51c6',
    'ad22c2a0-0fd1-4ce0-8782-e2fd0a541189', '01d0ce9f-ce22-4795-96b8-2e4473579847'
  ]::uuid[]);
  if v_qtd <> 0 then
    raise exception 'saneamento: % registro(s) em receita_ingredientes referenciam alguma das 4 receitas alvo -- abortando, nenhum DELETE realizado.', v_qtd;
  end if;

  -- producao_expositor_lotes: dependencia INDIRETA (via
  -- producao_registros.receita_id) -- re-checada explicitamente, mesmo
  -- sabendo que o resultado acima (producao_registros=0) ja implica
  -- este tambem ser 0, por transparencia e simetria com a auditoria.
  select count(*) into v_qtd
  from public.producao_expositor_lotes pel
  join public.producao_registros pr on pr.id = pel.producao_registro_id
  where pr.receita_id = any(array[
    'c0f658d5-da59-494b-b5ee-9e9f5a0b044f', '07fe6a5d-a72f-48fd-b27c-383d8eac51c6',
    'ad22c2a0-0fd1-4ce0-8782-e2fd0a541189', '01d0ce9f-ce22-4795-96b8-2e4473579847'
  ]::uuid[]);
  if v_qtd <> 0 then
    raise exception 'saneamento: % lote(s) de expositor referenciam (indiretamente) alguma das 4 receitas alvo -- abortando, nenhum DELETE realizado.', v_qtd;
  end if;

  -- ============================================================
  -- 3) GUARDA -- os 2 produtos inativos: existem, ativo=false, nome
  --    (igualdade estrita) e codigo_barras batem, lock FOR UPDATE
  --    tomado aqui.
  -- ============================================================
  select nome, ativo, codigo_barras into v_nome, v_ativo, v_codigo_barras
  from public.produtos where id = '43667479-2c05-495c-8090-feee80174dc3'::uuid for update;
  if v_nome is null then
    raise exception 'saneamento: produto 43667479-2c05-495c-8090-feee80174dc3 nao encontrado -- abortando.';
  end if;
  if v_nome <> 'OVO BRANCO' then
    raise exception 'saneamento: produto 43667479-2c05-495c-8090-feee80174dc3 tem nome "%", esperado exatamente "OVO BRANCO" -- abortando.', v_nome;
  end if;
  if v_ativo is distinct from false then
    raise exception 'saneamento: produto 43667479-2c05-495c-8090-feee80174dc3 (OVO BRANCO) nao esta mais inativo (ativo=%) -- abortando, estado mudou desde a auditoria.', v_ativo;
  end if;
  if v_codigo_barras is distinct from '7897372300226' then
    raise exception 'saneamento: produto 43667479-2c05-495c-8090-feee80174dc3 (OVO BRANCO) tem codigo_barras "%", esperado "7897372300226" -- abortando.', v_codigo_barras;
  end if;

  select nome, ativo, codigo_barras into v_nome, v_ativo, v_codigo_barras
  from public.produtos where id = '0e15db63-bc38-407e-b246-6a725310aaeb'::uuid for update;
  if v_nome is null then
    raise exception 'saneamento: produto 0e15db63-bc38-407e-b246-6a725310aaeb nao encontrado -- abortando.';
  end if;
  if v_nome <> 'OVO VERMELHO' then
    raise exception 'saneamento: produto 0e15db63-bc38-407e-b246-6a725310aaeb tem nome "%", esperado exatamente "OVO VERMELHO" -- abortando.', v_nome;
  end if;
  if v_ativo is distinct from false then
    raise exception 'saneamento: produto 0e15db63-bc38-407e-b246-6a725310aaeb (OVO VERMELHO) nao esta mais inativo (ativo=%) -- abortando, estado mudou desde a auditoria.', v_ativo;
  end if;
  if v_codigo_barras is distinct from '7897372300523' then
    raise exception 'saneamento: produto 0e15db63-bc38-407e-b246-6a725310aaeb (OVO VERMELHO) tem codigo_barras "%", esperado "7897372300523" -- abortando.', v_codigo_barras;
  end if;

  -- ============================================================
  -- 4) GUARDA -- os 2 produtos inativos: zero dependencia real,
  --    re-checada agora, nas 5 tabelas conhecidas com FK para
  --    produtos.id (mesma lista da RPC excluir_produto_catalogo, 0029).
  -- ============================================================
  select count(*) into v_qtd from public.pedido_itens
  where produto_id = any(array['43667479-2c05-495c-8090-feee80174dc3', '0e15db63-bc38-407e-b246-6a725310aaeb']::uuid[]);
  if v_qtd <> 0 then
    raise exception 'saneamento: % registro(s) em pedido_itens referenciam algum dos 2 produtos alvo -- abortando, nenhum DELETE realizado.', v_qtd;
  end if;

  select count(*) into v_qtd from public.produto_fornecedores
  where produto_id = any(array['43667479-2c05-495c-8090-feee80174dc3', '0e15db63-bc38-407e-b246-6a725310aaeb']::uuid[]);
  if v_qtd <> 0 then
    raise exception 'saneamento: % registro(s) em produto_fornecedores referenciam algum dos 2 produtos alvo -- abortando, nenhum DELETE realizado.', v_qtd;
  end if;

  select count(*) into v_qtd from public.produtos_historico_compras
  where produto_id = any(array['43667479-2c05-495c-8090-feee80174dc3', '0e15db63-bc38-407e-b246-6a725310aaeb']::uuid[]);
  if v_qtd <> 0 then
    raise exception 'saneamento: % registro(s) em produtos_historico_compras referenciam algum dos 2 produtos alvo -- abortando, nenhum DELETE realizado.', v_qtd;
  end if;

  select count(*) into v_qtd from public.receita_ingredientes
  where produto_id = any(array['43667479-2c05-495c-8090-feee80174dc3', '0e15db63-bc38-407e-b246-6a725310aaeb']::uuid[]);
  if v_qtd <> 0 then
    raise exception 'saneamento: % registro(s) em receita_ingredientes referenciam algum dos 2 produtos alvo -- abortando, nenhum DELETE realizado.', v_qtd;
  end if;

  select count(*) into v_qtd from public.cotacoes
  where produto_id = any(array['43667479-2c05-495c-8090-feee80174dc3', '0e15db63-bc38-407e-b246-6a725310aaeb']::uuid[]);
  if v_qtd <> 0 then
    raise exception 'saneamento: % registro(s) em cotacoes referenciam algum dos 2 produtos alvo -- abortando, nenhum DELETE realizado.', v_qtd;
  end if;

  -- ============================================================
  -- 5) Todas as guardas passaram. A partir daqui, DELETE efetivo.
  -- ============================================================
  raise notice 'saneamento: todas as guardas de pre-condicao passaram para as 4 receitas e os 2 produtos inativos. Prosseguindo com DELETE.';

  delete from public.receitas
  where id = any(array[
    'c0f658d5-da59-494b-b5ee-9e9f5a0b044f', '07fe6a5d-a72f-48fd-b27c-383d8eac51c6',
    'ad22c2a0-0fd1-4ce0-8782-e2fd0a541189', '01d0ce9f-ce22-4795-96b8-2e4473579847'
  ]::uuid[]);

  get diagnostics v_removido = row_count;
  if v_removido <> 4 then
    raise exception 'saneamento: esperado remover exatamente 4 receitas, removido % -- abortando.', v_removido;
  end if;

  delete from public.produtos
  where id = any(array['43667479-2c05-495c-8090-feee80174dc3', '0e15db63-bc38-407e-b246-6a725310aaeb']::uuid[]);

  get diagnostics v_removido = row_count;
  if v_removido <> 2 then
    raise exception 'saneamento: esperado remover exatamente 2 produtos, removido % -- abortando.', v_removido;
  end if;

  -- ============================================================
  -- 6) Pos-condicao (guarda dura -- aborta se violada): total caiu
  --    exatamente 4 em receitas e exatamente 2 em produtos, E o total
  --    absoluto de receitas fechou em exatamente 30 -- condicao
  --    objetiva confirmada pela pre-auditoria real (34 - 4 = 30), nao
  --    mais uma divergencia em aberto.
  -- ============================================================
  select count(*) into v_receitas_depois from public.receitas;
  if v_receitas_depois <> v_receitas_antes - 4 then
    raise exception 'saneamento: total de receitas antes=% depois=%, esperado queda de exatamente 4 -- abortando.', v_receitas_antes, v_receitas_depois;
  end if;
  if v_receitas_depois <> 30 then
    raise exception 'saneamento: total de receitas depois do DELETE e %, esperado exatamente 30 -- abortando.', v_receitas_depois;
  end if;

  select count(*) into v_produtos_depois from public.produtos;
  if v_produtos_depois <> v_produtos_antes - 2 then
    raise exception 'saneamento: total de produtos antes=% depois=%, esperado queda de exatamente 2 -- abortando.', v_produtos_antes, v_produtos_depois;
  end if;

  raise notice 'saneamento concluido. receitas: % -> % (esperado 34 -> 30, confirmado). produtos: % -> %.',
    v_receitas_antes, v_receitas_depois, v_produtos_antes, v_produtos_depois;
end $$;

COMMIT;

-- ============================================================
-- ROLLBACK -- NAO EXISTE ROLLBACK AUTOMATICO PARA ESTA MIGRATION
-- ============================================================
-- DELETE fisico nao e desfazivel por um bloco de SQL. A unica forma de
-- reverter e restaurar as 6 linhas a partir de um backup/snapshot do
-- banco anterior a execucao desta migration (ou recria-las manualmente
-- com os mesmos UUIDs e os mesmos valores de coluna, se algum snapshot
-- externo -- ex.: os proprios resultados colados pelo usuario nesta
-- conversa -- ainda existir). Nao ha "BEGIN; ... COMMIT;" de rollback
-- aqui porque nao ha nada reversivel para desfazer (nenhuma funcao,
-- policy, permissao ou coluna nova foi criada por esta migration).
