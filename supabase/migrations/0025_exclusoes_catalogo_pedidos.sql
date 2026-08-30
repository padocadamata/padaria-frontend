-- 0025_exclusoes_catalogo_pedidos.sql
-- Exclusao definitiva, auditavel e SOMENTE VIA RPC, para 3 casos:
--   * public.produto_fornecedores (Catalogo -- configuracao comercial);
--   * public.produtos_historico_compras, SOMENTE origem='manual';
--   * public.pedidos + public.pedido_itens, SOMENTE status='aguardando_entrega'.
--
-- REESCRITA (3a versao). Historico das duas revisoes anteriores, para
-- quem ler este arquivo isoladamente:
--   * 1a versao: policy de DELETE (catalogo_produtos.editar) + RPC
--     SECURITY INVOKER para as duas tabelas do Catalogo -- corrigida
--     porque nao garantia "somente via RPC" (RLS nao distingue chamada
--     via RPC de chamada direta via supabase.from(...).delete()).
--     Pedidos usava uma GUC (set_config/current_setting) como sinal
--     transacional para a trigger de "pedido vazio" -- rejeitada por
--     ser uma flag autodeclarada, nao um fato verificavel do banco.
--   * 2a versao: Catalogo corrigido para SECURITY DEFINER + zero policy
--     de DELETE (mantido nesta versao, sem mudanca). Pedidos passou a
--     tornar a FK pedido_itens->pedidos DEFERRABLE (mantendo ON DELETE
--     RESTRICT) e excluir_pedido() deferia essa FK -- CORRIGIDA NESTA
--     3a VERSAO porque a documentacao do Postgres estabelece que
--     RESTRICT nunca e deferivel, independente de condeferrable ser
--     marcado true no catalogo: "RESTRICT... is the same as NO ACTION
--     except that the check is not deferrable." O DELETE do cabecalho
--     antes dos itens teria falhado imediatamente com violacao de FK,
--     mesmo com SET CONSTRAINTS DEFERRED.
--   * 3a versao (esta): a FK pedido_itens_pedido_id_fkey NAO E TOCADA
--     DE FORMA ALGUMA -- permanece ON DELETE RESTRICT, NOT DEFERRABLE,
--     exatamente como sempre foi (migration 0022). Em vez disso, e o
--     CONSTRAINT TRIGGER pedido_itens_impedir_pedido_vazio_trigger
--     (que JA e DEFERRABLE INITIALLY IMMEDIATE desde a 0022, sem
--     nenhuma alteracao de definicao de trigger necessaria) que e
--     adiado -- so dentro da transacao de excluir_pedido(), via
--     SET CONSTRAINTS ... DEFERRED. Ordem de exclusao invertida em
--     relacao a 2a versao: ITENS PRIMEIRO, cabecalho depois -- ordem
--     que a propria FK RESTRICT (imediata, intocada) ja aceita
--     naturalmente, sem precisar de nenhum adiamento nela.
--
-- RASCUNHO EM AUDITORIA -- NAO COPIAR PARA supabase/migrations/ NEM
-- EXECUTAR ate autorizacao explicita, E ate a pre-auditoria real (ja
-- executada uma vez, aprovada como baseline) ser reconfirmada apos esta
-- reescrita. Gerado em scratchpad para revisao estatica, SHA-256 e
-- classificacao de risco.
--
-- Pre-requisitos: 0001..0024 ja aplicadas. Numeracao confirmada livre:
-- 0024 e a ultima migration em origin/main, nenhuma 0025 publicada ainda.
--
-- ============================================================
-- REGRA GERAL (aplicada aos 3 casos, sem excecao):
-- ============================================================
--   * NENHUMA policy de DELETE e criada em NENHUMA das 4 tabelas
--     envolvidas (produto_fornecedores, produtos_historico_compras,
--     pedidos, pedido_itens) -- RLS habilitada + zero policy de DELETE =
--     negacao por padrao para authenticated, para QUALQUER permissao que
--     o usuario tenha;
--   * as 3 RPCs sao SECURITY DEFINER -- unico jeito de o DELETE interno
--     delas conseguir rodar, ja que nao existe mais nenhuma policy que
--     autorize;
--   * cada RPC exige explicitamente sessao autenticada (auth.uid() is not
--     null) e a permissao correta (public.has_permissao(...)), ambas
--     checadas ANTES de qualquer leitura/escrita;
--   * snapshot em public.logs_auditoria, na MESMA transacao, ANTES do
--     DELETE;
--   * cada operacao inteira roda dentro do corpo de UMA funcao plpgsql --
--     atomica por natureza: qualquer excecao desfaz tudo;
--   * nenhum ON DELETE CASCADE em nenhuma FK, nenhuma FK alterada;
--   * REVOKE EXECUTE FROM PUBLIC, REVOKE EXECUTE FROM anon, GRANT EXECUTE
--     somente para authenticated, nas 3 RPCs;
--   * nenhuma GUC customizada como mecanismo de autorizacao.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   * public.excluir_produto_fornecedor(uuid) -- SECURITY DEFINER, sem
--     nenhuma policy de DELETE nova em produto_fornecedores;
--   * public.excluir_historico_compra_manual(uuid) -- SECURITY DEFINER,
--     sem nenhuma policy de DELETE nova em produtos_historico_compras;
--     valida origem='manual' no CORPO da funcao (unica camada, ja que
--     nao ha policy de RLS reforcando isso) ANTES do DELETE;
--   * 1 codigo de permissao novo: pedidos.excluir, concedido SOMENTE a
--     proprietario_admin;
--   * public.pedido_itens_impedir_pedido_vazio(): CREATE OR REPLACE com
--     UM bloco condicional novo no INICIO (se o pedido-pai ja nao
--     existe, nao ha invariante a proteger) -- toda a logica original
--     preservada para o caso em que o pedido-pai ainda existe. A
--     TRIGGER em si (pedido_itens_impedir_pedido_vazio_trigger) NAO e
--     recriada -- continua CONSTRAINT TRIGGER, AFTER DELETE, DEFERRABLE,
--     INITIALLY IMMEDIATE, exatamente como a 0022 a criou;
--   * public.excluir_pedido(uuid) -- SECURITY DEFINER, sem nenhuma
--     policy de DELETE nova em pedidos nem em pedido_itens, sem alargar
--     pedido_itens_delete. Defere ESPECIFICAMENTE o constraint trigger
--     pedido_itens_impedir_pedido_vazio_trigger via SET CONSTRAINTS,
--     dentro da propria transacao -- NUNCA a FK.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * NENHUMA alteracao na FK pedido_itens_pedido_id_fkey -- nem
--     ALTER CONSTRAINT, nem DROP/recriacao, nem SET CONSTRAINTS
--     aplicado a ela. Permanece byte-a-byte: ON DELETE RESTRICT,
--     NOT DEFERRABLE, INITIALLY IMMEDIATE;
--   * nenhuma alteracao na configuracao DEFERRABLE/INITIALLY do
--     constraint trigger de pedido vazio (continua INITIALLY IMMEDIATE
--     por padrao -- o adiamento e so dentro da transacao da RPC, via
--     SET CONSTRAINTS, nunca uma mudanca permanente);
--   * nenhuma policy de DELETE em nenhuma das 4 tabelas;
--   * nenhuma mudanca na policy pedido_itens_delete existente;
--   * nenhuma mudanca nas triggers pedidos_protecao, pedido_itens_protecao,
--     produto_fornecedores_protecao, produtos_historico_compras_protecao;
--   * nenhuma mudanca em criar_pedido, marcar_pedido_recebido,
--     cancelar_pedido;
--   * nenhuma alteracao de frontend;
--   * nenhuma concessao de pedidos.excluir a nenhum perfil alem de
--     proprietario_admin;
--   * nenhum uso de GUC customizada.

BEGIN;

-- ============================================================
-- 1. public.excluir_produto_fornecedor -- SECURITY DEFINER, RPC-only
-- ============================================================
create or replace function public.excluir_produto_fornecedor(p_produto_fornecedor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registro public.produto_fornecedores;
begin
  if auth.uid() is null then
    raise exception 'excluir_produto_fornecedor: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('catalogo_produtos.editar')) then
    raise exception
      'excluir_produto_fornecedor: requer a permissao catalogo_produtos.editar.';
  end if;

  select * into v_registro
  from public.produto_fornecedores
  where id = p_produto_fornecedor_id;

  if v_registro.id is null then
    raise exception
      'excluir_produto_fornecedor: configuracao % nao encontrada.', p_produto_fornecedor_id;
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('produto_fornecedor', p_produto_fornecedor_id::text, 'excluiu', 'produto_id',
      v_registro.produto_id::text, null),
    ('produto_fornecedor', p_produto_fornecedor_id::text, 'excluiu', 'fornecedor_id',
      v_registro.fornecedor_id::text, null),
    ('produto_fornecedor', p_produto_fornecedor_id::text, 'excluiu', 'unidade_comercial',
      v_registro.unidade_comercial, null),
    ('produto_fornecedor', p_produto_fornecedor_id::text, 'excluiu', 'apresentacao',
      v_registro.apresentacao, null),
    ('produto_fornecedor', p_produto_fornecedor_id::text, 'excluiu', 'quantidade_embalagem',
      v_registro.quantidade_embalagem::text, null),
    ('produto_fornecedor', p_produto_fornecedor_id::text, 'excluiu', 'codigo_produto_fornecedor',
      v_registro.codigo_produto_fornecedor, null),
    ('produto_fornecedor', p_produto_fornecedor_id::text, 'excluiu', 'ativo',
      v_registro.ativo::text, null),
    ('produto_fornecedor', p_produto_fornecedor_id::text, 'excluiu', 'observacao',
      v_registro.observacao, null),
    ('produto_fornecedor', p_produto_fornecedor_id::text, 'excluiu', 'criado_por',
      v_registro.criado_por::text, null),
    ('produto_fornecedor', p_produto_fornecedor_id::text, 'excluiu', 'criado_em',
      v_registro.criado_em::text, null);

  delete from public.produto_fornecedores where id = p_produto_fornecedor_id;
end;
$$;

comment on function public.excluir_produto_fornecedor(uuid) is
  'Exclui definitivamente uma configuracao comercial de produto_fornecedores. RPC-only por desenho: NENHUMA policy de DELETE existe nesta tabela -- o DELETE interno so roda porque esta funcao e SECURITY DEFINER. Exige sessao autenticada + catalogo_produtos.editar, checados explicitamente. Snapshot completo em logs_auditoria antes do DELETE, mesma transacao. Sem cascata: nenhuma tabela referencia produto_fornecedores.id.';

revoke execute on function public.excluir_produto_fornecedor(uuid) from public;
revoke execute on function public.excluir_produto_fornecedor(uuid) from anon;
grant execute on function public.excluir_produto_fornecedor(uuid) to authenticated;


-- ============================================================
-- 2. public.excluir_historico_compra_manual -- SECURITY DEFINER, RPC-only
-- ============================================================
create or replace function public.excluir_historico_compra_manual(p_historico_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registro public.produtos_historico_compras;
begin
  if auth.uid() is null then
    raise exception 'excluir_historico_compra_manual: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('catalogo_produtos.editar')) then
    raise exception
      'excluir_historico_compra_manual: requer a permissao catalogo_produtos.editar.';
  end if;

  select * into v_registro
  from public.produtos_historico_compras
  where id = p_historico_id;

  if v_registro.id is null then
    raise exception
      'excluir_historico_compra_manual: lancamento % nao encontrado.', p_historico_id;
  end if;

  -- UNICA camada que impede excluir origem<>manual -- nao ha policy de
  -- RLS reforcando isso neste desenho.
  if v_registro.origem <> 'manual' then
    raise exception
      'excluir_historico_compra_manual: lancamento % tem origem=%, somente origem=manual pode ser excluido por esta funcao.',
      p_historico_id, v_registro.origem;
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('historico_compra', p_historico_id::text, 'excluiu', 'produto_id',
      v_registro.produto_id::text, null),
    ('historico_compra', p_historico_id::text, 'excluiu', 'fornecedor_id',
      v_registro.fornecedor_id::text, null),
    ('historico_compra', p_historico_id::text, 'excluiu', 'unidade_comercial',
      v_registro.unidade_comercial, null),
    ('historico_compra', p_historico_id::text, 'excluiu', 'quantidade_comercial',
      v_registro.quantidade_comercial::text, null),
    ('historico_compra', p_historico_id::text, 'excluiu', 'preco_unitario_comercial',
      v_registro.preco_unitario_comercial::text, null),
    ('historico_compra', p_historico_id::text, 'excluiu', 'fator_conversao_base',
      v_registro.fator_conversao_base::text, null),
    ('historico_compra', p_historico_id::text, 'excluiu', 'preco_unitario_base',
      v_registro.preco_unitario_base::text, null),
    ('historico_compra', p_historico_id::text, 'excluiu', 'data_compra',
      v_registro.data_compra::text, null),
    ('historico_compra', p_historico_id::text, 'excluiu', 'origem',
      v_registro.origem, null),
    ('historico_compra', p_historico_id::text, 'excluiu', 'observacao',
      v_registro.observacao, null),
    ('historico_compra', p_historico_id::text, 'excluiu', 'criado_por',
      v_registro.criado_por::text, null),
    ('historico_compra', p_historico_id::text, 'excluiu', 'criado_em',
      v_registro.criado_em::text, null);

  delete from public.produtos_historico_compras where id = p_historico_id;
end;
$$;

comment on function public.excluir_historico_compra_manual(uuid) is
  'Exclui definitivamente um lancamento de produtos_historico_compras, SOMENTE origem=manual -- garantido EXCLUSIVAMENTE pela checagem explicita nesta funcao (nao ha policy de DELETE nesta tabela). origem=recebimento_pedido e estruturalmente impossivel de excluir por aqui. RPC-only por desenho. Exige sessao autenticada + catalogo_produtos.editar. Snapshot completo em logs_auditoria antes do DELETE, mesma transacao.';

revoke execute on function public.excluir_historico_compra_manual(uuid) from public;
revoke execute on function public.excluir_historico_compra_manual(uuid) from anon;
grant execute on function public.excluir_historico_compra_manual(uuid) to authenticated;


-- ============================================================
-- 3. SEED -- novo codigo de permissao pedidos.excluir
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('pedidos.excluir', 'pedidos', 'excluir',
   'Excluir definitivamente um pedido ainda aguardando_entrega (cabecalho + itens), via excluir_pedido(). Acao irreversivel, registrada em logs_auditoria. Nunca aplicavel a pedido recebido ou cancelado.');

insert into public.perfil_permissoes (perfil, permissao)
select 'proprietario_admin', codigo
from public.permissoes
where codigo = 'pedidos.excluir';


-- ============================================================
-- 4. public.pedido_itens_impedir_pedido_vazio() -- adaptada: protecao so
--    se aplica quando o pedido-pai AINDA EXISTE. NENHUMA MUDANCA na FK,
--    NENHUMA MUDANCA na configuracao deferrable/initially da trigger em
--    si (permanece exatamente DEFERRABLE INITIALLY IMMEDIATE, herdada
--    da 0022 -- so o CORPO da funcao muda).
-- ============================================================
-- MUDANCA MINIMA e ESTRUTURAL (nao uma flag): um bloco condicional novo
-- no INICIO da funcao. Se o pedido-pai (public.pedidos.id = old.pedido_id)
-- ja nao existe, nao ha invariante "pedido aguardando sem item" para
-- proteger. Essa condicao so pode ser verdadeira ao final de uma
-- transacao que TAMBEM apagou o cabecalho -- e apagar o cabecalho exige
-- passar por excluir_pedido() (SECURITY DEFINER, unico caminho de
-- DELETE em pedidos, ja que nenhuma policy de DELETE existe nessa
-- tabela). Fluxo normal de edicao (pedido continua existindo, disparo
-- nao-adiado ou adiado) tem o comportamento ORIGINAL, sem nenhuma
-- mudanca.
create or replace function public.pedido_itens_impedir_pedido_vazio()
returns trigger
language plpgsql
security definer  -- inalterado: mesmo motivo ja documentado na 0022 (le
                   -- pedido_itens/pedidos independente de
                   -- pedidos.visualizar do chamador)
set search_path = ''
as $$
begin
  -- Pedido-pai ja nao existe -- nada a proteger. So acontece quando
  -- excluir_pedido() ja apagou o cabecalho na mesma transacao, ANTES
  -- deste disparo (adiado) ser finalmente executado.
  if not exists (select 1 from public.pedidos where id = old.pedido_id) then
    return null;
  end if;

  -- Pedido-pai ainda existe: protecao ORIGINAL, sem nenhuma alteracao.
  -- Cobre tanto o disparo imediato (fluxo normal de edicao) quanto um
  -- disparo adiado cujo cabecalho, por qualquer motivo, NAO tenha sido
  -- apagado na mesma transacao (ex.: excluir_pedido() falhar antes do
  -- DELETE do cabecalho) -- nesse caso, esta excecao aborta a transacao
  -- inteira, desfazendo tambem os DELETEs de itens ja feitos.
  if not exists (select 1 from public.pedido_itens where pedido_id = old.pedido_id) then
    raise exception 'pedido_itens: pedido % ficaria sem nenhum item -- operacao bloqueada.', old.pedido_id;
  end if;
  return null; -- AFTER trigger: valor de retorno e ignorado
end;
$$;

comment on function public.pedido_itens_impedir_pedido_vazio() is
  'AFTER DELETE em pedido_itens (constraint trigger, deferrable initially immediate -- configuracao herdada da migration 0022, INTOCADA por esta migration). Impede que um pedido fique com zero itens ENQUANTO O PEDIDO-PAI AINDA EXISTE -- protecao original, intocada para esse caso. Quando o pedido-pai ja nao existe (unico jeito: dentro da transacao de excluir_pedido(), que defere especificamente este constraint trigger via SET CONSTRAINTS e apaga os itens ANTES do cabecalho), a checagem e pulada -- nao ha mais invariante a proteger. Nao depende de nenhuma flag/GUC: a condicao e um FATO verificavel do banco (existe ou nao existe a linha em pedidos).';

-- A TRIGGER em si (pedido_itens_impedir_pedido_vazio_trigger) NAO e
-- recriada aqui -- so o CORPO da funcao muda (CREATE OR REPLACE FUNCTION
-- acima). Continua exatamente: CONSTRAINT TRIGGER, AFTER DELETE, FOR
-- EACH ROW, DEFERRABLE INITIALLY IMMEDIATE -- sem nenhum DROP/CREATE
-- TRIGGER, sem nenhum ALTER de deferrability nesta migration.


-- ============================================================
-- 5. RPC excluir_pedido -- exclusao atomica de cabecalho + itens,
--    SOMENTE status='aguardando_entrega', SECURITY DEFINER
-- ============================================================
-- SECURITY DEFINER pelo MESMO motivo ja documentado nas versoes
-- anteriores: a policy pedido_itens_delete (0022) exige pedidos.editar,
-- permissao diferente da exigida aqui (pedidos.excluir, por decisao
-- explicita). Alargar aquela policy concederia a qualquer usuario com
-- so pedidos.excluir a capacidade de apagar itens AVULSOS de um pedido
-- ainda ativo, fora do fluxo de exclusao completa -- por isso NAO e
-- feito. Nenhuma policy de DELETE e criada em pedidos nem em
-- pedido_itens -- mesmo padrao ja usado por criar_pedido() para INSERT.
--
-- MECANISMO DE ADIAMENTO (3a versao, definitivo): SET CONSTRAINTS aplica
-- SOMENTE ao constraint trigger pedido_itens_impedir_pedido_vazio_trigger
-- -- NUNCA a FK pedido_itens_pedido_id_fkey, que permanece RESTRICT/
-- NOT DEFERRABLE o tempo todo, sem necessidade de qualquer adiamento:
-- apagando os ITENS primeiro (antes do cabecalho), a FK RESTRICT
-- (imediata, intocada) nunca e violada -- RESTRICT so bloqueia apagar o
-- PAI enquanto ha filhos, nunca bloqueia apagar os filhos primeiro. O
-- constraint trigger, adiado, so dispara (um evento por item apagado) no
-- fim da transacao -- momento em que o cabecalho ja foi apagado tambem
-- (passo seguinte desta funcao), entao cada disparo adiado encontra
-- "pedido-pai nao existe mais" e nao bloqueia (secao 4 acima).
--
-- CREATE CONSTRAINT TRIGGER sempre cria uma linha correspondente em
-- pg_constraint (contype='t') com o MESMO nome do trigger -- e assim que
-- SET CONSTRAINTS consegue endereca-lo pelo nome, exatamente como
-- endereca uma FK ou UNIQUE deferravel. Nome usado aqui SEMPRE
-- schema-qualificado (public.pedido_itens_impedir_pedido_vazio_trigger),
-- coerente com search_path = '' desta funcao e com o padrao de
-- referencias totalmente qualificadas usado em todas as RPCs deste
-- projeto.
--
-- RISCO DOCUMENTADO (mesmo aviso ja registrado para criar_pedido() na
-- 0022): se esta funcao tiver seu OWNER alterado para um papel sem
-- BYPASSRLS e sem ser dono de pedidos/pedido_itens, toda chamada passa a
-- falhar por violacao de RLS, sem nenhuma mudanca de codigo visivel.
create or replace function public.excluir_pedido(p_pedido_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido     public.pedidos%rowtype;
  v_itens_json jsonb;
begin
  -- 1) sessao autenticada obrigatoria.
  if auth.uid() is null then
    raise exception 'excluir_pedido: requer sessao autenticada.';
  end if;

  -- 2) checagem explicita de permissao -- PORTAO real desta operacao.
  if not (select public.has_permissao('pedidos.excluir')) then
    raise exception using errcode = '42501',
      message = 'excluir_pedido: requer a permissao pedidos.excluir.';
  end if;

  -- 3) localiza e BLOQUEIA o pedido (FOR UPDATE) -- impede corrida com
  --    marcar_pedido_recebido/cancelar_pedido ou outra chamada
  --    concorrente a excluir_pedido. Como efeito colateral do lock de FK
  --    automatico do Postgres (FOR KEY SHARE tomado por qualquer
  --    INSERT/UPDATE de pedido_itens referenciando este pedido_id),
  --    tambem bloqueia insercao/edicao de itens deste pedido enquanto a
  --    exclusao estiver em andamento.
  select * into v_pedido
  from public.pedidos
  where id = p_pedido_id
  for update;

  if v_pedido.id is null then
    raise exception 'excluir_pedido: pedido % nao encontrado.', p_pedido_id;
  end if;

  -- 4) confirma status -- SOMENTE aguardando_entrega. recebido/cancelado/
  --    qualquer estado futuro sao proibidos por padrao (allowlist).
  if v_pedido.status <> 'aguardando_entrega' then
    raise exception
      'excluir_pedido: pedido % tem status=%, somente pedidos aguardando_entrega podem ser excluidos definitivamente.',
      p_pedido_id, v_pedido.status;
  end if;

  -- 5) snapshot AGREGADO -- UM registro logico de auditoria contendo
  --    cabecalho + TODOS os itens. Itens ordenados deterministicamente
  --    (criado_em, id) dentro do array JSON. Guardado em valor_anterior;
  --    valor_novo fica null (nao ha "novo" apos um DELETE).
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', pi.id,
      'produto_id', pi.produto_id,
      'descricao', pi.descricao,
      'quantidade_pedida', pi.quantidade_pedida,
      'unidade', pi.unidade,
      'valor_unitario', pi.valor_unitario,
      'observacao', pi.observacao,
      'criado_em', pi.criado_em,
      'atualizado_em', pi.atualizado_em
    ) order by pi.criado_em, pi.id
  ), '[]'::jsonb) into v_itens_json
  from public.pedido_itens pi
  where pi.pedido_id = p_pedido_id;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values (
    'pedido',
    p_pedido_id::text,
    'excluiu',
    'snapshot_completo',
    jsonb_build_object(
      'pedido', jsonb_build_object(
        'id', v_pedido.id,
        'fornecedor_id', v_pedido.fornecedor_id,
        'data_pedido', v_pedido.data_pedido,
        'previsao_entrega', v_pedido.previsao_entrega,
        'status', v_pedido.status,
        'observacoes', v_pedido.observacoes,
        'criado_por', v_pedido.criado_por,
        'criado_em', v_pedido.criado_em,
        'atualizado_em', v_pedido.atualizado_em
      ),
      'itens', v_itens_json
    )::text,
    null
  );

  -- 6) defere ESPECIFICAMENTE o constraint trigger de "pedido vazio" --
  --    so nesta transacao (efeito de SET CONSTRAINTS nunca sobrevive ao
  --    fim da transacao corrente). A FK NAO e tocada aqui nem em
  --    nenhum outro ponto desta funcao.
  set constraints public.pedido_itens_impedir_pedido_vazio_trigger deferred;

  -- 7) itens PRIMEIRO -- ordem que a FK RESTRICT (imediata, intocada)
  --    ja aceita naturalmente: apagar filhos nunca viola RESTRICT,
  --    RESTRICT so bloqueia apagar o PAI enquanto ha filhos. Cada linha
  --    apagada enfileira um disparo adiado de
  --    pedido_itens_impedir_pedido_vazio_trigger (nao dispara ainda).
  delete from public.pedido_itens where pedido_id = p_pedido_id;

  -- 8) cabecalho DEPOIS -- a essa altura zero itens referenciam este
  --    pedido (todos apagados no passo 7), entao a checagem RESTRICT
  --    (imediata, nunca adiada) passa trivialmente.
  delete from public.pedidos where id = p_pedido_id;

  -- 9) fim da funcao: ao commit desta transacao (implicito, ao retornar
  --    desta chamada de RPC), os disparos adiados do passo 7 finalmente
  --    executam -- cada um encontra que o pedido-pai ja nao existe
  --    (apagado no passo 8, na mesma transacao) e nao bloqueia (secao 4
  --    acima). Se o passo 8 nao tivesse acontecido por qualquer motivo,
  --    esses mesmos disparos adiados encontrariam o pedido ainda
  --    existindo e ja vazio, levantariam a excecao original, e TODA a
  --    transacao (inclusive os DELETEs de itens do passo 7) reverteria.
end;
$$;

comment on function public.excluir_pedido(uuid) is
  'Exclui definitivamente um pedido (cabecalho + todos os itens), SOMENTE status=aguardando_entrega. Exige sessao autenticada + pedidos.excluir (checagem explicita -- unico portao real, sem policy de DELETE em pedidos nem em pedido_itens). Bloqueia a linha do pedido (FOR UPDATE) antes de validar status. Snapshot AGREGADO (cabecalho + array ordenado de itens) em UM registro de logs_auditoria, campo=snapshot_completo, antes de qualquer DELETE. SECURITY DEFINER: necessario porque a policy pedido_itens_delete existente exige pedidos.editar, permissao diferente da exigida aqui. A FK pedido_itens_pedido_id_fkey NUNCA e tocada (permanece RESTRICT/NOT DEFERRABLE) -- em vez disso, esta funcao defere especificamente o constraint trigger pedido_itens_impedir_pedido_vazio_trigger via SET CONSTRAINTS, apaga os itens ANTES do cabecalho (ordem que RESTRICT ja aceita sem adiamento), e deixa os disparos adiados do constraint trigger confirmarem, ao final da transacao, que o pedido-pai ja nao existe. Nenhuma GUC, nenhum CASCADE. Qualquer falha em qualquer etapa desfaz a transacao inteira.';

revoke execute on function public.excluir_pedido(uuid) from public;
revoke execute on function public.excluir_pedido(uuid) from anon;
grant execute on function public.excluir_pedido(uuid) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Mais simples que as versoes anteriores: como a FK nunca foi tocada,
-- nao ha nada a restaurar nela. Restaura o corpo ORIGINAL da funcao
-- pedido_itens_impedir_pedido_vazio() tal como capturada pela
-- pre-auditoria (0025_pre_auditoria.sql) -- CONFIRA contra o snapshot
-- real antes de aplicar.
--
-- ATENCAO -- NAO REVERSIVEL EM UM PONTO: se qualquer exclusao ja tiver
-- sido feita via estas RPCs antes do rollback, os registros excluidos NAO
-- voltam (DELETE e definitivo) -- o snapshot em logs_auditoria e a UNICA
-- forma de recuperar o que foi excluido, sempre manual.
-- BEGIN;
--
--   revoke execute on function public.excluir_pedido(uuid) from authenticated;
--   drop function if exists public.excluir_pedido(uuid);
--
--   -- Restaura o corpo ORIGINAL da migration 0022 (sem a checagem de
--   -- "pedido-pai ainda existe"). A TRIGGER em si nunca foi recriada,
--   -- entao nao ha nada a restaurar nela alem do corpo da funcao.
--   create or replace function public.pedido_itens_impedir_pedido_vazio()
--   returns trigger
--   language plpgsql
--   security definer
--   set search_path = ''
--   as $$
--   begin
--     if not exists (select 1 from public.pedido_itens where pedido_id = old.pedido_id) then
--       raise exception 'pedido_itens: pedido % ficaria sem nenhum item -- operacao bloqueada.', old.pedido_id;
--     end if;
--     return null;
--   end;
--   $$;
--
--   delete from public.perfil_permissoes where permissao = 'pedidos.excluir';
--   delete from public.permissoes where codigo = 'pedidos.excluir';
--
--   revoke execute on function public.excluir_historico_compra_manual(uuid) from authenticated;
--   drop function if exists public.excluir_historico_compra_manual(uuid);
--
--   revoke execute on function public.excluir_produto_fornecedor(uuid) from authenticated;
--   drop function if exists public.excluir_produto_fornecedor(uuid);
--
-- COMMIT;
