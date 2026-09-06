-- 0037_pedidos_compras_presenciais.sql
-- Compras Presenciais dentro do modulo de Pedidos. Fecha a frente
-- deliberadamente adiada desde a migration 0022 (comentario original:
-- "compra_presencial fica fora do fluxo de Pedidos por desenho... futura
-- Fase E de documentos fiscais tratara compra presencial sem pedido
-- antecedente"). Reaproveita 100% de public.pedidos/pedido_itens/
-- produtos_historico_compras -- nenhuma tabela nova, nenhum modulo
-- paralelo.
--
-- RASCUNHO EM AUDITORIA -- NAO EXECUTAR ate autorizacao explicita.
-- Numeracao 0037 confirmada livre (ultima migration publicada e
-- 0036_producao_classificacoes_tipo_grupo.sql).
--
-- ============================================================
-- BASE DA AUDITORIA -- resultado real do banco, confirmado pelo usuario
-- apos rodar pre_auditoria_compras_presenciais_EXECUTAR.sql:
-- ============================================================
--   * fornecedores ativos: pedido_com_entrega=17, compra_presencial=7.
--   * pedidos: aguardando_entrega=1, recebido=11, total=12.
--   * TODOS os 12 pedidos existentes estao hoje vinculados a
--     fornecedores com modalidade_compra='pedido_com_entrega' -- coerente
--     com o fato estrutural de que criar_pedido() SEMPRE exigiu isso
--     desde a 0022 (nenhum outro caminho de INSERT existe em pedidos).
--   * pedidos sem fornecedor correspondente = 0.
--   * pedido_itens = 33.
--   * produtos_historico_compras: origem='recebimento_pedido'=29,
--     nao existe nenhum origem='compra_presencial' ainda.
--   * FK produtos_historico_compras.pedido_item_id -> pedido_itens.id
--     ON DELETE RESTRICT; indice UNICO parcial
--     produtos_historico_compras_pedido_item_id_unico_idx (pedido_item_id
--     is not null) -- confirmados.
--
-- ============================================================
-- ACHADO CRITICO desta rodada (motiva as secoes 6/7 abaixo):
-- ============================================================
-- pedidos_protecao() e pedido_itens_protecao() bloqueiam INCONDICIONALMENTE
-- qualquer INSERT/UPDATE/DELETE quando o pedido nao esta
-- status='aguardando_entrega' -- inclusive para uma funcao SECURITY
-- DEFINER (nao e RLS, e logica de trigger, BYPASSRLS nao afeta). Uma
-- compra presencial vive permanentemente em status='recebido' -- editar
-- exige abrir uma excecao ESTREITA nesses dois triggers.
--
-- O mecanismo de gate ja existe no projeto, criado pela propria migration
-- 0027 para o fluxo de reabertura: a condicao
--   coalesce((select rolbypassrls from pg_roles where rolname = current_user), false)
-- so e verdadeira dentro do contexto de uma funcao SECURITY DEFINER cujo
-- OWNER tenha o atributo BYPASSRLS -- nenhum papel authenticated/anon
-- jamais satisfaz isso via REST comum, mesmo tendo pedidos.editar. Esta
-- migration reaproveita EXATAMENTE o mesmo mecanismo (nao inventa um
-- novo), adicionando um SEGUNDO ramo de excecao (correcao de compra
-- presencial), ao lado do ramo de reabertura ja existente (inalterado).
--
-- ============================================================
-- INVENTARIO DE FUNCOES SECURITY DEFINER QUE TOCAM PEDIDOS/PEDIDO_ITENS
-- (exigido pelo cabecalho da migration 0027 a cada nova funcao elevada
-- adicionada -- reconferido aqui, nao presumido):
-- ============================================================
--   * criar_pedido() (0022) -- INSERT em pedidos/pedido_itens enquanto
--     nao ha linha ainda (sem conflito possivel com nenhum ramo de
--     protecao).
--   * receber_pedido() (0026) -- UPDATE de pedidos SOMENTE
--     aguardando_entrega->recebido (ramo normal, sem carve-out).
--   * excluir_pedido() (0025) -- so opera com status=aguardando_entrega,
--     nunca toca um pedido recebido.
--   * reabrir_recebimento_pedido() (0027) -- UPDATE
--     recebido->aguardando_entrega (ramo de reabertura) -- **recebe
--     nesta migration uma guarda nova que a impede de rodar sobre
--     modalidade_compra='compra_presencial'** (secao 8), entao nunca mais
--     colide com o ramo novo de correcao de compra presencial.
--   * registrar_compra_presencial() (NOVA, secao 9) -- INSERT em
--     pedidos/pedido_itens enquanto status ainda e aguardando_entrega
--     (DEFAULT da coluna), depois UPDATE aguardando_entrega->recebido
--     (ramo normal existente, sem carve-out novo).
--   * editar_compra_presencial() (NOVA, secao 10) -- UNICA funcao que
--     efetivamente aciona os dois ramos novos desta migration (UPDATE de
--     cabecalho mantendo recebido->recebido; INSERT/UPDATE/DELETE de
--     itens com o pedido-pai em recebido). Confirmado: nenhuma outra
--     funcao deste schema emite hoje um UPDATE/INSERT/DELETE compativel
--     com as condicoes dos ramos novos (modalidade_compra=
--     'compra_presencial' AND status='recebido' AND, no caso do
--     cabecalho, new.status tambem ='recebido') -- FATO verificado por
--     auditoria estatica nesta migration, precisa ser reconferido a cada
--     nova funcao SECURITY DEFINER que toque pedidos/pedido_itens.
--
-- ============================================================
-- DECISOES DE MODELAGEM:
-- ============================================================
--   1) pedidos.modalidade_compra -- SNAPSHOT proprio do pedido, NUNCA
--      derivado por JOIN do fornecedor (o fornecedor pode mudar de
--      modalidade depois sem reescrever o passado). Backfill dos 12
--      pedidos existentes: o proprio DEFAULT 'pedido_com_entrega' ja
--      cobre 100% deles (fato estrutural, nao inferencia -- todo INSERT
--      em pedidos SEMPRE passou por criar_pedido(), que SEMPRE exigiu
--      modalidade_compra='pedido_com_entrega' no fornecedor no momento da
--      criacao) -- guardado explicitamente no bloco de pre-condicoes.
--   2) pedidos.numero_nota_fiscal/data_documento_fiscal -- minimo pedido:
--      texto/data livres, sem serie/chave/XML/upload/tabela propria.
--   3) fornecedores.modalidade_compra -- INTOCADA. Fluxo "Novo Pedido"
--      continua exigindo modalidade_compra='pedido_com_entrega'; fluxo
--      "Nova Compra Presencial" aceita QUALQUER fornecedor ativo, sem
--      checagem de modalidade (decisao funcional explicita).
--   4) produtos_historico_compras.origem ganha 'compra_presencial' no
--      dominio -- auditoria de dependencias (rodada anterior) confirmou
--      zero impacto em RLS/trigger/view; so as 2 CHECKs de origem
--      precisam ser ampliadas.
--   5) receber_pedido() NAO e chamada por registrar_compra_presencial()
--      -- geraria origem='recebimento_pedido', nao 'compra_presencial'.
--      A logica de resolucao de produto_fornecedores (identica a secao 4
--      da migration 0026) e extraida para uma funcao auxiliar NOVA e
--      INTERNA, _resolver_config_comercial_historico() (secao 9.1) --
--      usada 3x nesta migration (criacao + os 2 pontos de edicao), NUNCA
--      por receber_pedido() (que permanece 100% intocada). Privilegio
--      minimo: sem GRANT a nenhum papel alem do dono (funcoes SECURITY
--      DEFINER chamam-na automaticamente sob o privilegio do proprio
--      dono); invisivel ao PostgREST (nunca aparece como RPC publica).
--   6) Estrategia de historico na edicao: REMOVER E RECRIAR
--      exclusivamente os historicos origem='compra_presencial' desta
--      compra (nunca UPDATE) -- produtos_historico_compras_protecao()
--      bloqueia incondicionalmente qualquer UPDATE em linha com
--      origem<>'manual', entao atualizar em lugar so seria possivel
--      alterando TAMBEM essa trigger (compartilhada com o lancamento
--      manual do Catalogo) -- descartado por maior risco/superficie de
--      mudanca sem beneficio real. DELETE nao passa por trigger nenhuma
--      nesta tabela (so BEFORE INSERT/UPDATE existe) -- so RLS bloquearia
--      um DELETE comum, e uma funcao SECURITY DEFINER ja contorna isso
--      (BYPASSRLS), exatamente como toda escrita "automatica" ja faz
--      hoje. ORDEM CRITICA: apaga o historico ANTES de tocar em
--      pedido_itens (FK pedido_item_id -> pedido_itens.id e ON DELETE
--      RESTRICT -- excluir o item primeiro com historico ainda vivo
--      falharia).
--   7) editar_compra_presencial() exige SOMENTE pedidos.editar (nao
--      pedidos.editar+pedidos.receber): o carve-out estrutural liberado
--      nos triggers (secoes 6/7) so verifica pedidos.editar de qualquer
--      forma -- exigir uma permissao extra na RPC criaria uma falsa
--      sensacao de dupla protecao sem fechar nenhuma lacuna real (o
--      verdadeiro portao contra uso indevido e o gate rolbypassrls, nao
--      a soma de permissoes).
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   * pedidos.modalidade_compra/numero_nota_fiscal/data_documento_fiscal
--     (colunas novas + constraint);
--   * ampliacao de 2 CHECKs em produtos_historico_compras (origem e
--     coerencia origem/pedido_item_id);
--   * CREATE OR REPLACE minimo de criar_pedido() (so explicita
--     modalidade_compra='pedido_com_entrega' no INSERT);
--   * CREATE OR REPLACE de pedidos_protecao() e pedido_itens_protecao()
--     -- 1 ramo novo em cada, estreito, gatilhado por
--     modalidade_compra='compra_presencial' + rolbypassrls +
--     pedidos.editar, nunca alcancavel via REST comum;
--   * CREATE OR REPLACE de reabrir_recebimento_pedido() -- guarda nova no
--     inicio, aborta se modalidade_compra='compra_presencial';
--   * funcao interna nova _resolver_config_comercial_historico();
--   * RPCs novas registrar_compra_presencial() e editar_compra_presencial().
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em receber_pedido(), excluir_pedido(),
--     cancelar_pedido(), marcar_pedido_recebido(), nem em qualquer coisa
--     das migrations 0001..0036;
--   * nenhuma tabela nova, nenhuma coluna de estoque, nenhuma
--     movimentacao de estoque;
--   * nenhuma alteracao em fornecedores.modalidade_compra (schema ou
--     dados) nem em fornecedor_regras_pedido;
--   * nenhuma alteracao em produtos_resumo_compras (view ja agnostica de
--     origem, confirmado na auditoria de codigo);
--   * nenhuma estrutura de nota fiscal alem dos 2 campos livres
--     (sem serie/chave/XML/upload/tabela separada);
--   * nenhuma alteracao de frontend dentro deste arquivo.

BEGIN;

do $$
declare
  v_data_type       text;
  v_max_len         integer;
  v_nullable        text;
  v_check_def       text;
  v_qtd             int;
  v_total_pedidos   int;
  v_total_itens     int;
begin
  -- ============================================================
  -- 1) GUARDA -- pedidos.status continua exatamente com os 3 valores
  --    conhecidos.
  -- ============================================================
  select pg_get_constraintdef(oid) into v_check_def
  from pg_constraint
  where conrelid = 'public.pedidos'::regclass and conname = 'pedidos_status_check';

  if v_check_def is null then
    raise exception 'compras_presenciais: pedidos_status_check nao encontrada -- abortando.';
  end if;
  if v_check_def not ilike '%aguardando_entrega%' or v_check_def not ilike '%recebido%' or v_check_def not ilike '%cancelado%' then
    raise exception 'compras_presenciais: pedidos_status_check nao contem os valores esperados (definicao atual: %) -- abortando.', v_check_def;
  end if;

  -- ============================================================
  -- 2) GUARDA -- produtos_historico_compras.origem ainda so aceita
  --    manual/recebimento_pedido (antes da ampliacao desta migration).
  -- ============================================================
  select pg_get_constraintdef(oid) into v_check_def
  from pg_constraint
  where conrelid = 'public.produtos_historico_compras'::regclass
    and conname = 'produtos_historico_compras_origem_valida_check';

  if v_check_def is null then
    raise exception 'compras_presenciais: produtos_historico_compras_origem_valida_check nao encontrada -- abortando.';
  end if;
  if v_check_def not ilike '%manual%' or v_check_def not ilike '%recebimento_pedido%' then
    raise exception 'compras_presenciais: produtos_historico_compras_origem_valida_check nao contem os valores esperados (definicao atual: %) -- abortando.', v_check_def;
  end if;
  if v_check_def ilike '%compra_presencial%' then
    raise exception 'compras_presenciais: produtos_historico_compras_origem_valida_check ja contem compra_presencial -- migration ja parece ter sido aplicada, abortando para evitar duplicidade.';
  end if;

  -- ============================================================
  -- 3) GUARDA -- constraint de coerencia origem/pedido_item_id existe
  --    (sera ampliada na secao 3 abaixo).
  -- ============================================================
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.produtos_historico_compras'::regclass
      and conname = 'produtos_historico_compras_origem_pedido_item_coerente_check'
  ) then
    raise exception 'compras_presenciais: produtos_historico_compras_origem_pedido_item_coerente_check nao encontrada -- abortando.';
  end if;

  -- ============================================================
  -- 4) GUARDA -- indice unico parcial e FK de pedido_item_id continuam
  --    exatamente como esperado.
  -- ============================================================
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'produtos_historico_compras'
      and indexname = 'produtos_historico_compras_pedido_item_id_unico_idx'
  ) then
    raise exception 'compras_presenciais: indice produtos_historico_compras_pedido_item_id_unico_idx nao encontrado -- abortando.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.produtos_historico_compras'::regclass
      and conname = 'produtos_historico_compras_pedido_item_id_fkey'
      and confdeltype = 'r'
  ) then
    raise exception 'compras_presenciais: FK produtos_historico_compras_pedido_item_id_fkey ausente ou sem ON DELETE RESTRICT -- abortando.';
  end if;

  -- ============================================================
  -- 5) GUARDA -- pedidos.modalidade_compra ainda nao existe (protege
  --    contra reexecucao parcial).
  -- ============================================================
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pedidos' and column_name = 'modalidade_compra'
  ) then
    raise exception 'compras_presenciais: pedidos.modalidade_compra ja existe -- migration ja parece ter sido aplicada, abortando.';
  end if;

  -- ============================================================
  -- 6) GUARDA -- contagens reais confirmadas na pre-auditoria (protege
  --    contra o estado do banco ter mudado desde entao).
  -- ============================================================
  select count(*) into v_total_pedidos from public.pedidos;
  if v_total_pedidos <> 12 then
    raise exception 'compras_presenciais: total de pedidos e %, esperado exatamente 12 (confirmado pela pre-auditoria) -- abortando, situacao mudou.', v_total_pedidos;
  end if;

  select count(*) into v_total_itens from public.pedido_itens;
  if v_total_itens <> 33 then
    raise exception 'compras_presenciais: total de pedido_itens e %, esperado exatamente 33 -- abortando, situacao mudou.', v_total_itens;
  end if;

  -- Fato estrutural (nao inferencia): todo pedido existente foi criado
  -- via criar_pedido(), que sempre exigiu modalidade_compra=
  -- 'pedido_com_entrega' no fornecedor no momento da criacao -- este
  -- cruzamento com o fornecedor ATUAL e so uma reconfirmacao defensiva
  -- extra (mesma que a pre-auditoria ja fez), nao a garantia real.
  select count(*) into v_qtd
  from public.pedidos p
  join public.fornecedores f on f.id = p.fornecedor_id
  where f.modalidade_compra <> 'pedido_com_entrega';
  if v_qtd <> 0 then
    raise exception 'compras_presenciais: % pedido(s) vinculado(s) a fornecedor cuja modalidade atual nao e pedido_com_entrega -- revisar antes do backfill, abortando.', v_qtd;
  end if;

  select count(*) into v_qtd from public.produtos_historico_compras where origem = 'recebimento_pedido';
  if v_qtd <> 29 then
    raise exception 'compras_presenciais: total de historico origem=recebimento_pedido e %, esperado exatamente 29 -- abortando, situacao mudou.', v_qtd;
  end if;

  select count(*) into v_qtd from public.produtos_historico_compras where origem not in ('manual', 'recebimento_pedido');
  if v_qtd <> 0 then
    raise exception 'compras_presenciais: ja existe(m) % registro(s) de historico com origem fora de manual/recebimento_pedido -- abortando.', v_qtd;
  end if;

  raise notice 'compras_presenciais: todas as guardas previas passaram (12 pedidos / 33 itens / 29 historicos recebimento_pedido, todos os pedidos ligados a fornecedor pedido_com_entrega, sem coluna/valor de compra_presencial pre-existente). Prosseguindo.';
end $$;


-- ============================================================
-- 7) public.pedidos -- 3 colunas novas.
-- ============================================================
alter table public.pedidos
  add column if not exists modalidade_compra text not null default 'pedido_com_entrega';

do $$
begin
  alter table public.pedidos
    add constraint pedidos_modalidade_compra_check
    check (modalidade_compra in ('pedido_com_entrega', 'compra_presencial'));
exception
  when duplicate_object then null;
end $$;

alter table public.pedidos
  add column if not exists numero_nota_fiscal text,
  add column if not exists data_documento_fiscal date;

comment on column public.pedidos.modalidade_compra is
  'Snapshot da modalidade EFETIVA desta compra especifica -- NUNCA derivado por JOIN de fornecedores.modalidade_compra (que pode mudar depois sem reescrever o passado). pedido_com_entrega: fluxo normal (criar_pedido -> aguardando_entrega -> receber_pedido). compra_presencial: nasce direto em recebido, via registrar_compra_presencial() -- nao existe fase de aguardando_entrega para esta modalidade. Os 12 pedidos existentes na migration 0037 foram classificados retroativamente como pedido_com_entrega (fato estrutural: criar_pedido() sempre exigiu essa modalidade no fornecedor, nunca houve outro caminho de INSERT).';

comment on column public.pedidos.numero_nota_fiscal is
  'Numero da nota/documento fiscal, texto livre, opcional. Sem serie/chave de acesso/XML -- fora de escopo desta versao (migration 0037). Preenchido tipicamente em compras presenciais, mas nao restrito a elas.';

comment on column public.pedidos.data_documento_fiscal is
  'Data do documento/nota fiscal, opcional -- independente da data_pedido/data da compra (podem divergir por motivo operacional, sem regra de coerencia imposta).';


-- ============================================================
-- 8) public.produtos_historico_compras -- amplia o dominio de origem
--    para incluir 'compra_presencial'.
-- ============================================================
alter table public.produtos_historico_compras
  drop constraint produtos_historico_compras_origem_valida_check;

alter table public.produtos_historico_compras
  add constraint produtos_historico_compras_origem_valida_check
  check (origem in ('manual', 'recebimento_pedido', 'compra_presencial'));

alter table public.produtos_historico_compras
  drop constraint produtos_historico_compras_origem_pedido_item_coerente_check;

alter table public.produtos_historico_compras
  add constraint produtos_historico_compras_origem_pedido_item_coerente_check
  check (
    (origem = 'manual' and pedido_item_id is null)
    or (origem in ('recebimento_pedido', 'compra_presencial') and pedido_item_id is not null)
  );

comment on column public.produtos_historico_compras.origem is
  'manual: lancamento historico digitado no Catalogo. recebimento_pedido: gerado por receber_pedido() (pedido de entrega). compra_presencial: gerado por registrar_compra_presencial()/editar_compra_presencial() (migration 0037). RLS de INSERT/UPDATE normal so permite origem=manual -- os outros 2 valores so existem via RPC SECURITY DEFINER.';


-- ============================================================
-- 9) CREATE OR REPLACE minimo de criar_pedido() -- so explicita
--    modalidade_compra='pedido_com_entrega' no INSERT (o DEFAULT ja
--    cobriria, mas ficar explicito documenta a intencao e protege contra
--    um futuro DEFAULT diferente passar despercebido). NENHUMA outra
--    linha desta funcao muda.
-- ============================================================
create or replace function public.criar_pedido(
  p_fornecedor_id     uuid,
  p_data_pedido       date,
  p_previsao_entrega  date,
  p_observacoes       text,
  p_itens             jsonb
)
returns public.pedidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido        public.pedidos%rowtype;
  v_item          jsonb;
  v_quantidade    numeric;
  v_valor_texto   text;
  v_valor         numeric;
  v_produto_texto text;
  v_produto_id    uuid;
begin
  if not (select public.has_permissao('pedidos.inserir')) then
    raise exception using errcode = '42501',
      message = 'criar_pedido: requer a permissao pedidos.inserir.';
  end if;

  if p_fornecedor_id is null
     or not exists (
       select 1 from public.fornecedores
       where id = p_fornecedor_id
         and ativo = true
         and modalidade_compra = 'pedido_com_entrega'
     ) then
    raise exception 'criar_pedido: fornecedor % nao encontrado, inativo, ou nao usa modalidade de pedido com entrega.', p_fornecedor_id;
  end if;

  if p_data_pedido is null then
    raise exception 'criar_pedido: data_pedido e obrigatoria.';
  end if;

  if p_previsao_entrega is not null and p_previsao_entrega < p_data_pedido then
    raise exception 'criar_pedido: previsao_entrega nao pode ser anterior a data_pedido.';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'criar_pedido: e obrigatorio informar ao menos 1 item.';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'criar_pedido: cada item deve ser um objeto JSON, recebido: %', v_item;
    end if;

    if coalesce(btrim(v_item->>'descricao'), '') = '' then
      raise exception 'criar_pedido: item sem descricao valida: %', v_item;
    end if;
    if coalesce(btrim(v_item->>'unidade'), '') = '' then
      raise exception 'criar_pedido: item sem unidade valida: %', v_item;
    end if;

    begin
      v_quantidade := (v_item->>'quantidade_pedida')::numeric;
    exception when invalid_text_representation then
      raise exception 'criar_pedido: quantidade_pedida invalida (nao numerica) no item: %', v_item;
    end;
    if v_quantidade is null or v_quantidade <= 0 then
      raise exception 'criar_pedido: quantidade_pedida deve ser maior que zero no item: %', v_item;
    end if;

    v_valor_texto := nullif(btrim(coalesce(v_item->>'valor_unitario', '')), '');
    if v_valor_texto is not null then
      begin
        v_valor := v_valor_texto::numeric;
      exception when invalid_text_representation then
        raise exception 'criar_pedido: valor_unitario invalido (nao numerico) no item: %', v_item;
      end;
      if v_valor < 0 then
        raise exception 'criar_pedido: valor_unitario nao pode ser negativo no item: %', v_item;
      end if;
    end if;

    v_produto_texto := nullif(btrim(coalesce(v_item->>'produto_id', '')), '');
    if v_produto_texto is not null then
      begin
        v_produto_id := v_produto_texto::uuid;
      exception when invalid_text_representation then
        raise exception 'criar_pedido: produto_id invalido (nao e um UUID) no item: %', v_item;
      end;
      if not exists (select 1 from public.produtos where id = v_produto_id) then
        raise exception 'criar_pedido: produto_id % nao existe.', v_produto_id;
      end if;
    end if;
  end loop;

  insert into public.pedidos (fornecedor_id, data_pedido, previsao_entrega, observacoes, modalidade_compra)
  values (p_fornecedor_id, p_data_pedido, p_previsao_entrega, nullif(btrim(p_observacoes), ''), 'pedido_com_entrega')
  returning * into v_pedido;

  insert into public.pedido_itens (pedido_id, produto_id, descricao, quantidade_pedida, unidade, valor_unitario, observacao)
  select
    v_pedido.id,
    nullif(btrim(coalesce(item->>'produto_id', '')), '')::uuid,
    btrim(item->>'descricao'),
    (item->>'quantidade_pedida')::numeric,
    btrim(item->>'unidade'),
    nullif(btrim(coalesce(item->>'valor_unitario', '')), '')::numeric,
    nullif(btrim(coalesce(item->>'observacao', '')), '')
  from jsonb_array_elements(p_itens) as item;

  return v_pedido;
end;
$$;

comment on function public.criar_pedido(uuid, date, date, text, jsonb) is
  'Unico caminho de criacao de pedido COM ENTREGA (cabecalho + itens), em uma unica transacao. SECURITY DEFINER -- ver comentario historico na migration 0022. Exige pedidos.inserir. Valida fornecedor (ativo + modalidade_compra=pedido_com_entrega), pelo menos 1 item, e cada item completamente ANTES de qualquer escrita. Grava explicitamente modalidade_compra=pedido_com_entrega (migration 0037) -- inalterado em todo o resto.';

revoke execute on function public.criar_pedido(uuid, date, date, text, jsonb) from public;
revoke execute on function public.criar_pedido(uuid, date, date, text, jsonb) from anon;
grant execute on function public.criar_pedido(uuid, date, date, text, jsonb) to authenticated;


-- ============================================================
-- 10) CREATE OR REPLACE de pedidos_protecao() -- 1 ramo novo: correcao
--     de compra presencial (recebido -> recebido, so campos livres).
--     Ramo de reabertura (0027) e todo o resto: INALTERADOS.
-- ============================================================
create or replace function public.pedidos_protecao()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_mudou_status boolean;
begin
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.atualizado_em := now();
    return new;

  elsif tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'pedidos: id e imutavel.';
    end if;
    if new.criado_por is distinct from old.criado_por then
      raise exception 'pedidos: criado_por e imutavel.';
    end if;
    if new.criado_em is distinct from old.criado_em then
      raise exception 'pedidos: criado_em e imutavel.';
    end if;

    new.atualizado_em := now();

    -- REABERTURA (recebido -> aguardando_entrega) -- ramo existente da
    -- migration 0027, INALTERADO.
    if old.status = 'recebido' and new.status = 'aguardando_entrega' then
      if not coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) then
        raise exception 'pedidos: reabertura de recebimento so pode ser feita via reabrir_recebimento_pedido().';
      end if;
      if not (select public.has_permissao('pedidos.reabrir_recebimento')) then
        raise exception 'pedidos: reabrir recebimento requer a permissao pedidos.reabrir_recebimento.';
      end if;

      new.recebido_em := null;

      if new.fornecedor_id is distinct from old.fornecedor_id
        or new.data_pedido is distinct from old.data_pedido
        or new.previsao_entrega is distinct from old.previsao_entrega
        or new.observacoes is distinct from old.observacoes
        or new.cancelado_em is distinct from old.cancelado_em
        or new.motivo_cancelamento is distinct from old.motivo_cancelamento then
        raise exception 'pedidos: reabertura deve alterar somente status/recebido_em.';
      end if;

      return new;
    end if;

    -- CORRECAO DE COMPRA PRESENCIAL (recebido -> recebido) -- ramo NOVO
    -- desta migration (0037). Mesmo gate estrutural do ramo de
    -- reabertura acima: rolbypassrls identifica contexto elevado de
    -- alguma funcao SECURITY DEFINER cujo owner tenha esse atributo --
    -- nenhum papel authenticated/anon jamais satisfaz isso via REST
    -- comum, mesmo com pedidos.editar. Hoje, comprovadamente, so
    -- editar_compra_presencial() emite um UPDATE compativel com esta
    -- condicao exata (ver INVENTARIO no cabecalho desta migration).
    -- Permite corrigir fornecedor_id/data_pedido/numero_nota_fiscal/
    -- data_documento_fiscal/observacoes de uma compra presencial JA
    -- recebida -- nunca muda status, nunca toca
    -- recebido_em/cancelado_em/motivo_cancelamento/modalidade_compra.
    if old.status = 'recebido' and old.modalidade_compra = 'compra_presencial' and new.status = 'recebido' then
      if not coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) then
        raise exception 'pedidos: correcao de compra presencial so pode ser feita via editar_compra_presencial().';
      end if;
      if not (select public.has_permissao('pedidos.editar')) then
        raise exception 'pedidos: corrigir compra presencial requer a permissao pedidos.editar.';
      end if;

      if new.modalidade_compra is distinct from old.modalidade_compra
        or new.recebido_em is distinct from old.recebido_em
        or new.cancelado_em is distinct from old.cancelado_em
        or new.motivo_cancelamento is distinct from old.motivo_cancelamento then
        raise exception 'pedidos: correcao de compra presencial nao pode alterar modalidade_compra/recebido_em/cancelado_em/motivo_cancelamento.';
      end if;

      return new;
    end if;

    -- Pedido finalizado (recebido ou cancelado) e imutavel -- os dois
    -- ramos acima sao as UNICAS excecoes, e so alcancaveis como descrito.
    if old.status <> 'aguardando_entrega' then
      raise exception 'pedidos: pedido % ja esta finalizado (status=%), nao pode ser alterado.', old.id, old.status;
    end if;

    v_mudou_status := new.status <> old.status;

    if v_mudou_status then
      if new.status = 'recebido' then
        if not (select public.has_permissao('pedidos.receber')) then
          raise exception 'pedidos: marcar como recebido requer a permissao pedidos.receber.';
        end if;

        new.recebido_em := now();

        if new.fornecedor_id is distinct from old.fornecedor_id
          or new.data_pedido is distinct from old.data_pedido
          or new.previsao_entrega is distinct from old.previsao_entrega
          or new.observacoes is distinct from old.observacoes
          or new.cancelado_em is distinct from old.cancelado_em
          or new.motivo_cancelamento is distinct from old.motivo_cancelamento
          or new.modalidade_compra is distinct from old.modalidade_compra
          or new.numero_nota_fiscal is distinct from old.numero_nota_fiscal
          or new.data_documento_fiscal is distinct from old.data_documento_fiscal then
          raise exception 'pedidos: recebimento deve alterar somente status/recebido_em.';
        end if;

        insert into public.logs_auditoria (entidade, registro_id, acao, valor_novo)
        values ('pedido', new.id::text, 'recebeu', 'recebido_em=' || new.recebido_em::text);

      elsif new.status = 'cancelado' then
        if not (select public.has_permissao('pedidos.cancelar')) then
          raise exception 'pedidos: cancelar requer a permissao pedidos.cancelar.';
        end if;
        if new.motivo_cancelamento is null or btrim(new.motivo_cancelamento) = '' then
          raise exception 'pedidos: motivo do cancelamento e obrigatorio.';
        end if;

        new.cancelado_em := now();
        new.motivo_cancelamento := btrim(new.motivo_cancelamento);

        if new.fornecedor_id is distinct from old.fornecedor_id
          or new.data_pedido is distinct from old.data_pedido
          or new.previsao_entrega is distinct from old.previsao_entrega
          or new.observacoes is distinct from old.observacoes
          or new.recebido_em is distinct from old.recebido_em
          or new.modalidade_compra is distinct from old.modalidade_compra
          or new.numero_nota_fiscal is distinct from old.numero_nota_fiscal
          or new.data_documento_fiscal is distinct from old.data_documento_fiscal then
          raise exception 'pedidos: cancelamento deve alterar somente status/cancelado_em/motivo_cancelamento.';
        end if;

        insert into public.logs_auditoria (entidade, registro_id, acao, valor_novo)
        values ('pedido', new.id::text, 'cancelou', new.motivo_cancelamento);

      else
        raise exception 'pedidos: transicao de status invalida (% -> %).', old.status, new.status;
      end if;

    else
      if not (select public.has_permissao('pedidos.editar')) then
        raise exception 'pedidos: editar requer a permissao pedidos.editar.';
      end if;
      if new.recebido_em is distinct from old.recebido_em
        or new.cancelado_em is distinct from old.cancelado_em
        or new.motivo_cancelamento is distinct from old.motivo_cancelamento then
        raise exception 'pedidos: estes campos so mudam via marcar_pedido_recebido/cancelar_pedido.';
      end if;
    end if;

    return new;
  end if;

  return null;
end;
$$;

comment on function public.pedidos_protecao() is
  'BEFORE INSERT/UPDATE em pedidos. INSERT: forca criado_por/criado_em/atualizado_em. UPDATE: bloqueia id/criado_por/criado_em imutaveis, forca atualizado_em, bloqueia qualquer alteracao de pedido finalizado (status<>aguardando_entrega) -- EXCETO (a) a transicao recebido->aguardando_entrega (reabertura, 0027) e (b) a correcao de cabecalho de uma compra presencial mantendo recebido->recebido (0037) -- ambas liberadas SOMENTE quando o papel efetivo tem rolbypassrls (contexto elevado de funcao SECURITY DEFINER) mais a permissao especifica; exige pedidos.receber/pedidos.cancelar para as transicoes normais; exige pedidos.editar para edicao comum. Ver INVENTARIO DE FUNCOES SECURITY DEFINER no cabecalho da migration 0037 -- reconferir a cada nova funcao elevada que toque pedidos.';


-- ============================================================
-- 11) CREATE OR REPLACE de pedido_itens_protecao() -- 1 ramo novo em
--     INSERT/UPDATE/DELETE: correcao de itens de compra presencial. Ramo
--     de reabertura (0027) e todo o resto: INALTERADOS.
-- ============================================================
create or replace function public.pedido_itens_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status      text;
  v_modalidade  text;
begin
  if tg_op = 'INSERT' then
    new.criado_em := now();
    new.atualizado_em := now();

    select status, modalidade_compra into v_status, v_modalidade from public.pedidos where id = new.pedido_id;

    -- CORRECAO DE COMPRA PRESENCIAL (novo, 0037) -- permite inserir item
    -- novo enquanto o pedido-pai continua recebido, desde que seja
    -- compra_presencial. Mesmo gate de rolbypassrls + pedidos.editar dos
    -- demais ramos novos desta migration.
    if v_status = 'recebido' and v_modalidade = 'compra_presencial' then
      if not coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) then
        raise exception 'pedido_itens: nao e possivel inserir item em pedido com status=%.', v_status;
      end if;
      if not (select public.has_permissao('pedidos.editar')) then
        raise exception 'pedido_itens: nao e possivel inserir item em pedido com status=%.', v_status;
      end if;
      return new;
    end if;

    if v_status is distinct from 'aguardando_entrega' then
      raise exception 'pedido_itens: nao e possivel inserir item em pedido com status=%.', coalesce(v_status, 'inexistente');
    end if;

    return new;

  elsif tg_op = 'UPDATE' then
    if new.pedido_id is distinct from old.pedido_id then
      raise exception 'pedido_itens: pedido_id e imutavel -- um item nao pode ser movido entre pedidos.';
    end if;
    if new.criado_em is distinct from old.criado_em then
      raise exception 'pedido_itens: criado_em e imutavel.';
    end if;

    new.atualizado_em := now();

    select status, modalidade_compra into v_status, v_modalidade from public.pedidos where id = old.pedido_id;

    -- CORRECAO DE COMPRA PRESENCIAL (novo, 0037) -- permite alterar
    -- livremente produto_id/descricao/quantidade_pedida/unidade/
    -- valor_unitario/observacao e os 3 campos _recebido (sempre
    -- mantidos em sincronia por editar_compra_presencial(), que grava os
    -- dois pares juntos -- nao ha distincao pedida x recebida numa
    -- compra presencial). Mesmo gate estrutural dos demais ramos novos.
    if v_status = 'recebido' and v_modalidade = 'compra_presencial' then
      if not coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) then
        raise exception 'pedido_itens: nao e possivel alterar item de pedido com status=%.', v_status;
      end if;
      if not (select public.has_permissao('pedidos.editar')) then
        raise exception 'pedido_itens: nao e possivel alterar item de pedido com status=%.', v_status;
      end if;
      return new;
    end if;

    -- REABERTURA -- ramo existente da migration 0027, INALTERADO
    -- (nunca alcancado por uma compra presencial: v_modalidade so seria
    -- compra_presencial quando v_status='recebido', e o ramo acima ja
    -- teria retornado antes de chegar aqui).
    if v_status = 'recebido' then
      if not coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) then
        raise exception 'pedido_itens: nao e possivel alterar item de pedido com status=%.', v_status;
      end if;
      if not (select public.has_permissao('pedidos.reabrir_recebimento')) then
        raise exception 'pedido_itens: nao e possivel alterar item de pedido com status=%.', v_status;
      end if;
      if new.produto_id is distinct from old.produto_id
        or new.descricao is distinct from old.descricao
        or new.quantidade_pedida is distinct from old.quantidade_pedida
        or new.unidade is distinct from old.unidade
        or new.valor_unitario is distinct from old.valor_unitario
        or new.observacao is distinct from old.observacao then
        raise exception 'pedido_itens: reabertura de recebimento so pode limpar os campos de recebimento.';
      end if;
      if new.unidade_recebida is not null or new.quantidade_recebida is not null or new.valor_unitario_recebido is not null then
        raise exception 'pedido_itens: reabertura de recebimento deve limpar os campos de recebimento (definir como NULL).';
      end if;
      return new;
    end if;

    if v_status is distinct from 'aguardando_entrega' then
      raise exception 'pedido_itens: nao e possivel alterar item de pedido com status=%.', coalesce(v_status, 'inexistente');
    end if;

    return new;

  elsif tg_op = 'DELETE' then
    select status, modalidade_compra into v_status, v_modalidade from public.pedidos where id = old.pedido_id;

    -- CORRECAO DE COMPRA PRESENCIAL (novo, 0037) -- permite remover item
    -- lancado por engano enquanto o pedido-pai continua recebido.
    if v_status = 'recebido' and v_modalidade = 'compra_presencial' then
      if not coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) then
        raise exception 'pedido_itens: nao e possivel remover item de pedido com status=%.', v_status;
      end if;
      if not (select public.has_permissao('pedidos.editar')) then
        raise exception 'pedido_itens: nao e possivel remover item de pedido com status=%.', v_status;
      end if;
      return old;
    end if;

    if v_status is distinct from 'aguardando_entrega' then
      raise exception 'pedido_itens: nao e possivel remover item de pedido com status=%.', coalesce(v_status, 'inexistente');
    end if;

    return old;
  end if;

  return null;
end;
$$;

comment on function public.pedido_itens_protecao() is
  'BEFORE INSERT/UPDATE/DELETE em pedido_itens, TG_OP explicito. Forca criado_em/atualizado_em; bloqueia pedido_id/criado_em imutaveis; bloqueia qualquer INSERT/UPDATE/DELETE quando o pedido-pai nao esta aguardando_entrega -- EXCETO (a) limpeza dos 3 campos de recebimento durante reabertura de pedido de entrega (0027) e (b) INSERT/UPDATE/DELETE livre de item durante correcao de compra presencial (0037), ambas liberadas SOMENTE sob rolbypassrls + permissao especifica. SECURITY DEFINER para ler pedidos.status/modalidade_compra independente da RLS de SELECT de pedidos do chamador. Ver INVENTARIO DE FUNCOES SECURITY DEFINER no cabecalho da migration 0037.';

revoke execute on function public.pedido_itens_protecao() from public;


-- ============================================================
-- 12) CREATE OR REPLACE de reabrir_recebimento_pedido() -- guarda nova
--     no inicio: aborta se modalidade_compra='compra_presencial'.
--     Resto da funcao: INALTERADO.
-- ============================================================
create or replace function public.reabrir_recebimento_pedido(p_pedido_id uuid)
returns public.pedidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido               public.pedidos%rowtype;
  v_ids_itens            uuid[];
  v_snapshot_itens       jsonb;
  v_snapshot_historicos  jsonb;
begin
  if auth.uid() is null then
    raise exception 'reabrir_recebimento_pedido: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('pedidos.reabrir_recebimento')) then
    raise exception using errcode = '42501',
      message = 'reabrir_recebimento_pedido: requer a permissao pedidos.reabrir_recebimento.';
  end if;

  select * into v_pedido
  from public.pedidos
  where id = p_pedido_id
  for update;

  if v_pedido.id is null then
    raise exception 'reabrir_recebimento_pedido: pedido % nao encontrado.', p_pedido_id;
  end if;

  if v_pedido.status <> 'recebido' then
    raise exception 'reabrir_recebimento_pedido: pedido % tem status=%, somente pedidos recebidos podem ter o recebimento reaberto.',
      p_pedido_id, v_pedido.status;
  end if;

  -- GUARDA NOVA (0037) -- compra presencial nunca passa por aqui: nao
  -- existe fase de aguardando_entrega para ela, e a correcao de uma
  -- compra presencial ja recebida tem RPC propria (editar_compra_
  -- presencial()). Sem esta guarda, esta RPC ainda mudaria o pedido para
  -- aguardando_entrega e limparia os campos _recebido de pedido_itens
  -- (deixando pedido_itens e o historico origem=compra_presencial --
  -- que esta RPC nao apaga, so filtra origem=recebimento_pedido --
  -- divergentes entre si).
  if v_pedido.modalidade_compra = 'compra_presencial' then
    raise exception 'reabrir_recebimento_pedido: nao aplicavel a compra presencial (pedido %, modalidade_compra=compra_presencial) -- use editar_compra_presencial().', p_pedido_id;
  end if;

  select array_agg(id) into v_ids_itens
  from public.pedido_itens
  where pedido_id = p_pedido_id;

  select jsonb_agg(to_jsonb(pi.*)) into v_snapshot_itens
  from public.pedido_itens pi
  where pi.pedido_id = p_pedido_id;

  select jsonb_agg(to_jsonb(phc.*)) into v_snapshot_historicos
  from public.produtos_historico_compras phc
  where phc.pedido_item_id = any(v_ids_itens)
    and phc.origem = 'recebimento_pedido';

  insert into public.logs_auditoria (entidade, registro_id, acao, valor_anterior)
  values (
    'pedido',
    p_pedido_id::text,
    'pedido_recebimento_reaberto',
    jsonb_build_object(
      'pedido', to_jsonb(v_pedido.*),
      'itens', coalesce(v_snapshot_itens, '[]'::jsonb),
      'historicos_removidos', coalesce(v_snapshot_historicos, '[]'::jsonb),
      'usuario', auth.uid(),
      'reaberto_em', now()
    )::text
  );

  delete from public.produtos_historico_compras
  where pedido_item_id = any(v_ids_itens)
    and origem = 'recebimento_pedido';

  update public.pedido_itens
  set unidade_recebida = null,
      quantidade_recebida = null,
      valor_unitario_recebido = null
  where pedido_id = p_pedido_id;

  update public.pedidos
  set status = 'aguardando_entrega'
  where id = p_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

comment on function public.reabrir_recebimento_pedido(uuid) is
  'Desfaz atomicamente o recebimento de um pedido DE ENTREGA: grava snapshot completo em logs_auditoria, exclui origem=recebimento_pedido vinculado a itens deste pedido, limpa campos _recebido, transiciona recebido->aguardando_entrega. Exige sessao autenticada + pedidos.reabrir_recebimento. NAO aplicavel a compra presencial (guarda adicionada na migration 0037: aborta se modalidade_compra=compra_presencial) -- essa modalidade nunca teve fase de aguardando_entrega, e sua correcao usa editar_compra_presencial(), que preserva status=recebido. Bloqueia a linha do pedido (FOR UPDATE). SECURITY DEFINER -- ver INVENTARIO DE FUNCOES SECURITY DEFINER no cabecalho da migration 0037.';

revoke execute on function public.reabrir_recebimento_pedido(uuid) from public;
revoke execute on function public.reabrir_recebimento_pedido(uuid) from anon;
grant execute on function public.reabrir_recebimento_pedido(uuid) to authenticated;


-- ============================================================
-- 13) FUNCAO INTERNA NOVA -- _resolver_config_comercial_historico()
-- ============================================================
-- Extrai a logica de resolucao de produto_fornecedores/fator_conversao_base
-- JA CONSOLIDADA em receber_pedido() (migration 0026, secao 4 do
-- cabecalho) -- reproduzida aqui EXATAMENTE (mesma regra a/b/c), usada
-- 3 vezes nesta migration (registrar_compra_presencial + 2 pontos de
-- editar_compra_presencial). NUNCA chamada por receber_pedido(), que
-- permanece 100% intocada -- zero risco ao fluxo de recebimento de
-- pedidos de entrega ja em producao.
--
-- Retorna jsonb {"config_id": uuid|null, "fator_final": numeric|null}
-- em vez de OUT params -- escolha deliberada de simplicidade/clareza
-- (evita ambiguidade de sintaxe de chamada com multiplos OUT params),
-- mesmo estilo ->>'chave' ja usado em toda esta migration.
--
-- SECURITY INVOKER (nao SECURITY DEFINER): so le produto_fornecedores,
-- cuja policy de SELECT ja e liberal para qualquer authenticated com
-- catalogo_produtos.visualizar -- o chamador (registrar_compra_
-- presencial/editar_compra_presencial, ambas SECURITY DEFINER) ja tem
-- esse privilegio garantido pelo proprio contexto elevado. Sem GRANT a
-- nenhum papel alem do dono -- invisivel ao PostgREST, nunca aparece
-- como RPC publica; funcoes SECURITY DEFINER chamam-na automaticamente
-- sob o privilegio do proprio dono (ownership implica privilegio nos
-- proprios objetos).
create or replace function public._resolver_config_comercial_historico(
  p_produto_id                    uuid,
  p_fornecedor_id                 uuid,
  p_unidade                       text,
  p_fator_informado               numeric,
  p_produto_fornecedor_informado  uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_config_id      uuid;
  v_config_unidade text;
  v_config_fator   numeric;
  v_fator_final    numeric;
  v_qtd_configs    integer;
begin
  v_config_id := null;
  v_fator_final := p_fator_informado;

  -- (a) produto_fornecedor_id informado explicitamente -- precisa
  --     corresponder a uma config real do MESMO produto/fornecedor, com
  --     unidade batendo; se a config tiver fator conhecido, o fator
  --     informado (se houver) tem que bater exatamente.
  if p_produto_fornecedor_informado is not null then
    select id, unidade_comercial, quantidade_embalagem
      into v_config_id, v_config_unidade, v_config_fator
    from public.produto_fornecedores
    where id = p_produto_fornecedor_informado
      and produto_id = p_produto_id
      and fornecedor_id = p_fornecedor_id;

    if v_config_id is null then
      raise exception 'produto_fornecedor_id % nao corresponde a uma configuracao valida para produto % e fornecedor %.',
        p_produto_fornecedor_informado, p_produto_id, p_fornecedor_id;
    end if;
    if lower(btrim(v_config_unidade)) <> lower(btrim(p_unidade)) then
      raise exception 'unidade informada (%) nao bate com a configuracao comercial selecionada (%).',
        p_unidade, v_config_unidade;
    end if;
    if v_config_fator is not null then
      if p_fator_informado is not null and p_fator_informado <> v_config_fator then
        raise exception 'fator_conversao_base informado (%) nao bate com a configuracao comercial cadastrada (%).',
          p_fator_informado, v_config_fator;
      end if;
      v_fator_final := v_config_fator;
    end if;

    return jsonb_build_object('config_id', v_config_id, 'fator_final', v_fator_final);
  end if;

  -- (b)/(c) resolucao automatica -- so quando EXATAMENTE 1 configuracao
  --         ativa bate por produto+fornecedor+unidade comercial. Ambiguo
  --         (>1) ou inexistente (0): sem configuracao determinavel --
  --         fator fica o informado (pode ser null), sem validar contra
  --         nada.
  select count(*) into v_qtd_configs
  from public.produto_fornecedores
  where produto_id = p_produto_id
    and fornecedor_id = p_fornecedor_id
    and ativo = true
    and lower(btrim(unidade_comercial)) = lower(btrim(p_unidade));

  if v_qtd_configs = 1 then
    select id, quantidade_embalagem into v_config_id, v_config_fator
    from public.produto_fornecedores
    where produto_id = p_produto_id
      and fornecedor_id = p_fornecedor_id
      and ativo = true
      and lower(btrim(unidade_comercial)) = lower(btrim(p_unidade));

    if v_config_fator is not null then
      if p_fator_informado is not null and p_fator_informado <> v_config_fator then
        raise exception 'fator_conversao_base informado (%) nao bate com a configuracao comercial cadastrada (%).',
          p_fator_informado, v_config_fator;
      end if;
      v_fator_final := v_config_fator;
    end if;
  end if;

  return jsonb_build_object('config_id', v_config_id, 'fator_final', v_fator_final);
end;
$$;

comment on function public._resolver_config_comercial_historico(uuid, uuid, text, numeric, uuid) is
  'Funcao INTERNA (sem GRANT a anon/authenticated/PUBLIC, invisivel ao PostgREST) -- reproduz a regra de resolucao de produto_fornecedores/fator_conversao_base ja consolidada em receber_pedido() (migration 0026, secao 4), reaproveitada por registrar_compra_presencial()/editar_compra_presencial() (migration 0037). NUNCA chamada por receber_pedido(), que permanece intocada.';

-- IMPORTANTE -- diferente das funcoes de TRIGGER deste projeto
-- (pedido_itens_protecao, pedido_itens_impedir_pedido_vazio), que so
-- fazem "revoke ... from public" porque "returns trigger" ja as torna
-- estruturalmente inchamaveis via RPC independente de qualquer GRANT:
-- esta funcao retorna jsonb (tipo normal, exposto ao PostgREST) -- NAO
-- tem essa barreira estrutural, entao depende inteiramente do GRANT
-- estar correto. "revoke ... from public" sozinho NAO bloqueia
-- anon/authenticated: o Postgres concede EXECUTE a PUBLIC
-- automaticamente na criacao de qualquer funcao, e este projeto Supabase
-- tambem concede EXECUTE por padrao a anon/authenticated/service_role em
-- funcoes novas do schema public (mecanismo de bootstrap do proprio
-- Supabase, fora do historico de migrations) -- sao grants EXPLICITOS e
-- NOMEADOS para esses papeis, independentes do pseudo-papel PUBLIC;
-- revogar de PUBLIC nao os remove. Mesmo padrao ja usado por TODA
-- funcao "de verdade" (nao-trigger) deste projeto que precisa ficar
-- fora do alcance de anon (ex.: excluir_pedido, receber_pedido,
-- marcar_produto_producao) -- todas fazem "revoke ... from public" E
-- "revoke ... from anon" juntos, nunca so o primeiro.
revoke execute on function public._resolver_config_comercial_historico(uuid, uuid, text, numeric, uuid) from public;
revoke execute on function public._resolver_config_comercial_historico(uuid, uuid, text, numeric, uuid) from anon;
revoke execute on function public._resolver_config_comercial_historico(uuid, uuid, text, numeric, uuid) from authenticated;
revoke execute on function public._resolver_config_comercial_historico(uuid, uuid, text, numeric, uuid) from service_role;


-- ============================================================
-- 14) RPC NOVA -- registrar_compra_presencial()
-- ============================================================
-- SECURITY DEFINER -- mesmo motivo estrutural de criar_pedido()/
-- receber_pedido(): nenhuma combinacao de policies normais autoriza
-- criar+finalizar um pedido nesta unica chamada. Exige pedidos.inserir
-- E pedidos.receber (decisao funcional confirmada) -- esta operacao faz
-- as DUAS coisas ao mesmo tempo (cria e ja recebe).
create or replace function public.registrar_compra_presencial(
  p_fornecedor_id          uuid,
  p_data_compra            date,
  p_numero_nota_fiscal     text,
  p_data_documento_fiscal  date,
  p_observacoes            text,
  p_itens                  jsonb
)
returns public.pedidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido         public.pedidos%rowtype;
  v_hoje_sp        date;
  v_item           jsonb;
  v_quantidade     numeric;
  v_valor          numeric;
  v_produto_texto  text;
  v_produto_id     uuid;
  v_fator_texto    text;
  v_fator          numeric;
  v_pf_texto       text;
  v_pf_informado   uuid;
  v_novo_item_id   uuid;
  v_resolvido      jsonb;
  v_config_id      uuid;
  v_fator_final    numeric;
begin
  -- 1) sessao + permissoes -- PORTAO real (sem policy de INSERT em
  --    pedidos; a de pedido_itens exige so pedidos.editar, nao a
  --    combinacao que esta operacao exige).
  if auth.uid() is null then
    raise exception 'registrar_compra_presencial: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('pedidos.inserir')) then
    raise exception using errcode = '42501',
      message = 'registrar_compra_presencial: requer a permissao pedidos.inserir.';
  end if;

  if not (select public.has_permissao('pedidos.receber')) then
    raise exception using errcode = '42501',
      message = 'registrar_compra_presencial: requer a permissao pedidos.receber.';
  end if;

  -- 2) fornecedor -- existe e ativo, SEM checagem de modalidade_compra
  --    (decisao funcional explicita: qualquer fornecedor ativo serve
  --    para compra presencial).
  if p_fornecedor_id is null
     or not exists (select 1 from public.fornecedores where id = p_fornecedor_id and ativo = true) then
    raise exception 'registrar_compra_presencial: fornecedor % nao encontrado ou inativo.', p_fornecedor_id;
  end if;

  -- 3) data da compra -- obrigatoria, nao futura (America/Sao_Paulo).
  if p_data_compra is null then
    raise exception 'registrar_compra_presencial: data da compra e obrigatoria.';
  end if;

  v_hoje_sp := (now() at time zone 'America/Sao_Paulo')::date;
  if p_data_compra > v_hoje_sp then
    raise exception 'registrar_compra_presencial: data da compra (%) nao pode ser no futuro (hoje em America/Sao_Paulo: %).',
      p_data_compra, v_hoje_sp;
  end if;

  -- 4) pelo menos 1 item.
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'registrar_compra_presencial: e obrigatorio informar ao menos 1 item.';
  end if;

  -- 5) validacao COMPLETA de cada item, ANTES de qualquer escrita.
  --    valor_unitario e OBRIGATORIO (nao opcional como em criar_pedido):
  --    numa compra presencial o preco e sempre o EFETIVAMENTE pago,
  --    nunca uma estimativa -- pode ser 0 (bonificacao/cortesia, mesma
  --    regra de receber_pedido()), nunca negativo.
  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'registrar_compra_presencial: cada item deve ser um objeto JSON, recebido: %', v_item;
    end if;

    if coalesce(btrim(v_item->>'descricao'), '') = '' then
      raise exception 'registrar_compra_presencial: item sem descricao valida: %', v_item;
    end if;
    if coalesce(btrim(v_item->>'unidade'), '') = '' then
      raise exception 'registrar_compra_presencial: item sem unidade valida: %', v_item;
    end if;

    begin
      v_quantidade := (v_item->>'quantidade_pedida')::numeric;
    exception when invalid_text_representation then
      raise exception 'registrar_compra_presencial: quantidade_pedida invalida (nao numerica) no item: %', v_item;
    end;
    if v_quantidade is null or v_quantidade <= 0 then
      raise exception 'registrar_compra_presencial: quantidade_pedida deve ser maior que zero no item: %', v_item;
    end if;

    begin
      v_valor := (v_item->>'valor_unitario')::numeric;
    exception when invalid_text_representation then
      raise exception 'registrar_compra_presencial: valor_unitario invalido (nao numerico) no item: %', v_item;
    end;
    if v_valor is null or v_valor < 0 then
      raise exception 'registrar_compra_presencial: valor_unitario invalido no item % (obrigatorio, pode ser 0, nunca negativo).', v_item;
    end if;

    v_produto_texto := nullif(btrim(coalesce(v_item->>'produto_id', '')), '');
    if v_produto_texto is not null then
      begin
        v_produto_id := v_produto_texto::uuid;
      exception when invalid_text_representation then
        raise exception 'registrar_compra_presencial: produto_id invalido (nao e um UUID) no item: %', v_item;
      end;
      if not exists (select 1 from public.produtos where id = v_produto_id) then
        raise exception 'registrar_compra_presencial: produto_id % nao existe.', v_produto_id;
      end if;
    end if;

    v_fator_texto := nullif(btrim(coalesce(v_item->>'fator_conversao_base', '')), '');
    if v_fator_texto is not null then
      begin
        v_fator := v_fator_texto::numeric;
      exception when invalid_text_representation then
        raise exception 'registrar_compra_presencial: fator_conversao_base invalido (nao numerico) no item: %', v_item;
      end;
      if v_fator <= 0 then
        raise exception 'registrar_compra_presencial: fator_conversao_base deve ser maior que zero no item: %', v_item;
      end if;
    end if;

    v_pf_texto := nullif(btrim(coalesce(v_item->>'produto_fornecedor_id', '')), '');
    if v_pf_texto is not null then
      begin
        perform v_pf_texto::uuid;
      exception when invalid_text_representation then
        raise exception 'registrar_compra_presencial: produto_fornecedor_id invalido (nao e um UUID) no item: %', v_item;
      end;
    end if;
  end loop;

  -- 6) cabecalho -- status fica no DEFAULT (aguardando_entrega); a
  --    transicao para recebido so acontece no passo 8, depois de itens e
  --    historico -- pedidos_protecao/pedido_itens_protecao tratam este
  --    INSERT normalmente, nenhum carve-out novo e alcancado aqui.
  insert into public.pedidos (
    fornecedor_id, data_pedido, previsao_entrega, observacoes,
    modalidade_compra, numero_nota_fiscal, data_documento_fiscal
  ) values (
    p_fornecedor_id, p_data_compra, null, nullif(btrim(p_observacoes), ''),
    'compra_presencial', nullif(btrim(p_numero_nota_fiscal), ''), p_data_documento_fiscal
  )
  returning * into v_pedido;

  -- 7) itens -- quantidade_pedida/unidade/valor_unitario recebem os
  --    valores REAIS informados, e unidade_recebida/quantidade_recebida/
  --    valor_unitario_recebido sao preenchidos JUNTO no MESMO INSERT
  --    (nunca ha distincao pedida x recebida numa compra presencial --
  --    e a mesma compra) -- pedido_itens_recebimento_coerente_check
  --    (migration 0026) fica satisfeita desde a primeira linha.
  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_quantidade := (v_item->>'quantidade_pedida')::numeric;
    v_valor := (v_item->>'valor_unitario')::numeric;
    v_produto_texto := nullif(btrim(coalesce(v_item->>'produto_id', '')), '');
    v_produto_id := case when v_produto_texto is not null then v_produto_texto::uuid else null end;
    v_fator_texto := nullif(btrim(coalesce(v_item->>'fator_conversao_base', '')), '');
    v_fator := case when v_fator_texto is not null then v_fator_texto::numeric else null end;
    v_pf_texto := nullif(btrim(coalesce(v_item->>'produto_fornecedor_id', '')), '');
    v_pf_informado := case when v_pf_texto is not null then v_pf_texto::uuid else null end;

    insert into public.pedido_itens (
      pedido_id, produto_id, descricao, quantidade_pedida, unidade, valor_unitario,
      unidade_recebida, quantidade_recebida, valor_unitario_recebido
    ) values (
      v_pedido.id, v_produto_id, btrim(v_item->>'descricao'), v_quantidade, btrim(v_item->>'unidade'), v_valor,
      btrim(v_item->>'unidade'), v_quantidade, v_valor
    )
    returning id into v_novo_item_id;

    -- Item sem produto_id: dado efetivo ja gravado acima -- so nao gera
    -- historico (FK produto_id NOT NULL de produtos_historico_compras
    -- nao permitiria de qualquer forma). Mesma regra de receber_pedido().
    if v_produto_id is null then
      continue;
    end if;

    v_resolvido := public._resolver_config_comercial_historico(
      v_produto_id, p_fornecedor_id, btrim(v_item->>'unidade'), v_fator, v_pf_informado
    );
    v_config_id := nullif(v_resolvido->>'config_id', '')::uuid;
    v_fator_final := nullif(v_resolvido->>'fator_final', '')::numeric;

    insert into public.produtos_historico_compras (
      produto_id, fornecedor_id, unidade_comercial, quantidade_comercial,
      preco_unitario_comercial, fator_conversao_base, data_compra, origem,
      pedido_item_id, produto_fornecedor_id
    ) values (
      v_produto_id, p_fornecedor_id, btrim(v_item->>'unidade'), v_quantidade,
      v_valor, v_fator_final, p_data_compra, 'compra_presencial',
      v_novo_item_id, v_config_id
    );
  end loop;

  -- 8) transicao formal para recebido -- caminho comum e ja auditado de
  --    pedidos_protecao (ramo normal de recebimento, sem carve-out
  --    novo): forca recebido_em=now() e grava logs_auditoria
  --    (acao=recebeu), exatamente como receber_pedido() ja faz hoje.
  update public.pedidos
  set status = 'recebido'
  where id = v_pedido.id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

comment on function public.registrar_compra_presencial(uuid, date, text, date, text, jsonb) is
  'Registra uma compra presencial (cabecalho + itens + historico), ja nascendo status=recebido -- nao existe fase de aguardando_entrega para esta modalidade. SECURITY DEFINER. Exige pedidos.inserir E pedidos.receber (a operacao cria e ja recebe na mesma chamada). Fornecedor: ativo=true, SEM checagem de modalidade_compra (decisao funcional -- qualquer fornecedor ativo serve). Gera produtos_historico_compras com origem=compra_presencial para cada item com produto_id, usando a mesma regra de resolucao de produto_fornecedores de receber_pedido() (via _resolver_config_comercial_historico(), migration 0037) -- NUNCA chama receber_pedido() diretamente (geraria origem=recebimento_pedido). Qualquer falha em qualquer etapa desfaz a transacao inteira.';

revoke execute on function public.registrar_compra_presencial(uuid, date, text, date, text, jsonb) from public;
revoke execute on function public.registrar_compra_presencial(uuid, date, text, date, text, jsonb) from anon;
grant execute on function public.registrar_compra_presencial(uuid, date, text, date, text, jsonb) to authenticated;


-- ============================================================
-- 15) RPC NOVA -- editar_compra_presencial()
-- ============================================================
-- SECURITY DEFINER -- necessario tanto para a escrita (nenhuma
-- combinacao de policies normais autoriza corrigir uma compra ja
-- recebida) quanto para SER o mecanismo que faz current_user ter
-- rolbypassrls dentro dos 2 ramos novos de pedidos_protecao/
-- pedido_itens_protecao (secoes 10/11 acima). Exige SOMENTE
-- pedidos.editar (ver decisao no cabecalho desta migration).
create or replace function public.editar_compra_presencial(
  p_pedido_id              uuid,
  p_fornecedor_id          uuid,
  p_data_compra            date,
  p_numero_nota_fiscal     text,
  p_data_documento_fiscal  date,
  p_observacoes            text,
  p_itens                  jsonb
)
returns public.pedidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido                  public.pedidos%rowtype;
  v_pedido_antes            jsonb;
  v_itens_antes             jsonb;
  v_historicos_antes        jsonb;
  v_itens_depois            jsonb;
  v_historicos_depois       jsonb;
  v_ids_atuais              uuid[];
  v_ids_payload_existentes  uuid[];
  v_hoje_sp                 date;
  v_item                    jsonb;
  v_item_id_texto           text;
  v_item_id                 uuid;
  v_quantidade              numeric;
  v_valor                   numeric;
  v_produto_texto           text;
  v_produto_id              uuid;
  v_fator_texto             text;
  v_fator                   numeric;
  v_pf_texto                text;
  v_pf_informado            uuid;
  v_resolvido               jsonb;
  v_config_id               uuid;
  v_fator_final             numeric;
begin
  -- 1) sessao + permissao -- SOMENTE pedidos.editar (ver justificativa
  --    no cabecalho desta migration).
  if auth.uid() is null then
    raise exception 'editar_compra_presencial: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('pedidos.editar')) then
    raise exception using errcode = '42501',
      message = 'editar_compra_presencial: requer a permissao pedidos.editar.';
  end if;

  -- 2) localiza e BLOQUEIA o pedido -- serializa edicoes concorrentes
  --    desta mesma compra.
  select * into v_pedido
  from public.pedidos
  where id = p_pedido_id
  for update;

  if v_pedido.id is null then
    raise exception 'editar_compra_presencial: pedido % nao encontrado.', p_pedido_id;
  end if;

  if v_pedido.modalidade_compra <> 'compra_presencial' then
    raise exception 'editar_compra_presencial: pedido % nao e uma compra presencial (modalidade_compra=%).', p_pedido_id, v_pedido.modalidade_compra;
  end if;

  if v_pedido.status <> 'recebido' then
    raise exception 'editar_compra_presencial: pedido % tem status=%, esperado recebido.', p_pedido_id, v_pedido.status;
  end if;

  -- 3) fornecedor -- existe e ativo, SEM checagem de modalidade_compra
  --    (mesma regra da criacao).
  if p_fornecedor_id is null
     or not exists (select 1 from public.fornecedores where id = p_fornecedor_id and ativo = true) then
    raise exception 'editar_compra_presencial: fornecedor % nao encontrado ou inativo.', p_fornecedor_id;
  end if;

  -- 4) data da compra -- obrigatoria, nao futura.
  if p_data_compra is null then
    raise exception 'editar_compra_presencial: data da compra e obrigatoria.';
  end if;

  v_hoje_sp := (now() at time zone 'America/Sao_Paulo')::date;
  if p_data_compra > v_hoje_sp then
    raise exception 'editar_compra_presencial: data da compra (%) nao pode ser no futuro (hoje em America/Sao_Paulo: %).',
      p_data_compra, v_hoje_sp;
  end if;

  -- 5) pelo menos 1 item no estado final.
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'editar_compra_presencial: e obrigatorio informar ao menos 1 item.';
  end if;

  -- 6) itens ATUALMENTE pertencentes a esta compra -- usado para validar
  --    pertencimento de cada pedido_item_id do payload e para escopar
  --    com precisao o DELETE de historico (passo 9) e a remocao de itens
  --    excluidos (passo 11c).
  select array_agg(id) into v_ids_atuais
  from public.pedido_itens
  where pedido_id = p_pedido_id;

  -- 7) validacao COMPLETA de cada item do payload, ANTES de qualquer
  --    escrita -- mesmo passe de registrar_compra_presencial, mais a
  --    checagem de pertencimento e de duplicidade de pedido_item_id.
  v_ids_payload_existentes := array[]::uuid[];

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'editar_compra_presencial: cada item deve ser um objeto JSON, recebido: %', v_item;
    end if;

    v_item_id_texto := nullif(btrim(coalesce(v_item->>'pedido_item_id', '')), '');
    if v_item_id_texto is not null then
      begin
        v_item_id := v_item_id_texto::uuid;
      exception when invalid_text_representation then
        raise exception 'editar_compra_presencial: pedido_item_id invalido (nao e um UUID) no item: %', v_item;
      end;
      if v_item_id <> all(coalesce(v_ids_atuais, array[]::uuid[])) then
        raise exception 'editar_compra_presencial: pedido_item_id % nao pertence a esta compra.', v_item_id;
      end if;
      v_ids_payload_existentes := v_ids_payload_existentes || v_item_id;
    end if;

    if coalesce(btrim(v_item->>'descricao'), '') = '' then
      raise exception 'editar_compra_presencial: item sem descricao valida: %', v_item;
    end if;
    if coalesce(btrim(v_item->>'unidade'), '') = '' then
      raise exception 'editar_compra_presencial: item sem unidade valida: %', v_item;
    end if;

    begin
      v_quantidade := (v_item->>'quantidade_pedida')::numeric;
    exception when invalid_text_representation then
      raise exception 'editar_compra_presencial: quantidade_pedida invalida (nao numerica) no item: %', v_item;
    end;
    if v_quantidade is null or v_quantidade <= 0 then
      raise exception 'editar_compra_presencial: quantidade_pedida deve ser maior que zero no item: %', v_item;
    end if;

    begin
      v_valor := (v_item->>'valor_unitario')::numeric;
    exception when invalid_text_representation then
      raise exception 'editar_compra_presencial: valor_unitario invalido (nao numerico) no item: %', v_item;
    end;
    if v_valor is null or v_valor < 0 then
      raise exception 'editar_compra_presencial: valor_unitario invalido no item % (obrigatorio, pode ser 0, nunca negativo).', v_item;
    end if;

    v_produto_texto := nullif(btrim(coalesce(v_item->>'produto_id', '')), '');
    if v_produto_texto is not null then
      begin
        v_produto_id := v_produto_texto::uuid;
      exception when invalid_text_representation then
        raise exception 'editar_compra_presencial: produto_id invalido (nao e um UUID) no item: %', v_item;
      end;
      if not exists (select 1 from public.produtos where id = v_produto_id) then
        raise exception 'editar_compra_presencial: produto_id % nao existe.', v_produto_id;
      end if;
    end if;

    v_fator_texto := nullif(btrim(coalesce(v_item->>'fator_conversao_base', '')), '');
    if v_fator_texto is not null then
      begin
        v_fator := v_fator_texto::numeric;
      exception when invalid_text_representation then
        raise exception 'editar_compra_presencial: fator_conversao_base invalido (nao numerico) no item: %', v_item;
      end;
      if v_fator <= 0 then
        raise exception 'editar_compra_presencial: fator_conversao_base deve ser maior que zero no item: %', v_item;
      end if;
    end if;

    v_pf_texto := nullif(btrim(coalesce(v_item->>'produto_fornecedor_id', '')), '');
    if v_pf_texto is not null then
      begin
        perform v_pf_texto::uuid;
      exception when invalid_text_representation then
        raise exception 'editar_compra_presencial: produto_fornecedor_id invalido (nao e um UUID) no item: %', v_item;
      end;
    end if;
  end loop;

  -- array_length de array vazio retorna NULL (nao 0) -- guarda explicita
  -- para nao disparar falso-positivo quando TODOS os itens do payload
  -- sao novos (v_ids_payload_existentes fica array[]::uuid[]).
  if array_length(v_ids_payload_existentes, 1) is not null
     and (select count(distinct x) from unnest(v_ids_payload_existentes) as x) <> array_length(v_ids_payload_existentes, 1) then
    raise exception 'editar_compra_presencial: ha pedido_item_id duplicado no payload.';
  end if;

  -- 8) SNAPSHOT completo ANTES de qualquer escrita -- para logs_auditoria
  --    (secao 11 do cabecalho desta migration).
  v_pedido_antes := to_jsonb(v_pedido.*);
  select jsonb_agg(to_jsonb(pi.*)) into v_itens_antes
  from public.pedido_itens pi
  where pi.pedido_id = p_pedido_id;
  select jsonb_agg(to_jsonb(phc.*)) into v_historicos_antes
  from public.produtos_historico_compras phc
  where phc.pedido_item_id = any(coalesce(v_ids_atuais, array[]::uuid[]))
    and phc.origem = 'compra_presencial';

  -- 9) apaga EXCLUSIVAMENTE o historico origem=compra_presencial desta
  --    compra -- ANTES de tocar em pedido_itens (FK pedido_item_id ->
  --    pedido_itens.id e ON DELETE RESTRICT: apagar o historico primeiro
  --    evita qualquer conflito ao remover itens no passo 11c). Nunca
  --    toca origem=manual nem origem=recebimento_pedido (filtro de
  --    origem explicito); nunca toca historico de outro pedido (filtro
  --    por v_ids_atuais -- exclusivamente os itens ATUAIS desta compra,
  --    capturados no passo 6, antes de qualquer mutacao).
  delete from public.produtos_historico_compras
  where pedido_item_id = any(coalesce(v_ids_atuais, array[]::uuid[]))
    and origem = 'compra_presencial';

  -- 10) cabecalho -- alcanca o carve-out novo de pedidos_protecao (secao
  --     10 acima); esta RPC roda sob rolbypassrls, unica forma de
  --     alcanca-lo.
  update public.pedidos
  set fornecedor_id = p_fornecedor_id,
      data_pedido = p_data_compra,
      numero_nota_fiscal = nullif(btrim(p_numero_nota_fiscal), ''),
      data_documento_fiscal = p_data_documento_fiscal,
      observacoes = nullif(btrim(p_observacoes), '')
  where id = p_pedido_id
  returning * into v_pedido;

  -- 11) itens -- ordem obrigatoria (mesma logica de PedidoForm.
  --     salvarEdicao(), e do mesmo raciocinio para nunca deixar o
  --     pedido momentaneamente vazio): (a) INSERT dos novos primeiro,
  --     gerando historico logo em seguida; (b) UPDATE dos existentes,
  --     regenerando historico logo em seguida; (c) DELETE dos removidos
  --     por ultimo (historico deles ja foi apagado no passo 9).
  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_item_id_texto := nullif(btrim(coalesce(v_item->>'pedido_item_id', '')), '');
    continue when v_item_id_texto is not null; -- 11a: so os NOVOS aqui

    v_quantidade := (v_item->>'quantidade_pedida')::numeric;
    v_valor := (v_item->>'valor_unitario')::numeric;
    v_produto_texto := nullif(btrim(coalesce(v_item->>'produto_id', '')), '');
    v_produto_id := case when v_produto_texto is not null then v_produto_texto::uuid else null end;
    v_fator_texto := nullif(btrim(coalesce(v_item->>'fator_conversao_base', '')), '');
    v_fator := case when v_fator_texto is not null then v_fator_texto::numeric else null end;
    v_pf_texto := nullif(btrim(coalesce(v_item->>'produto_fornecedor_id', '')), '');
    v_pf_informado := case when v_pf_texto is not null then v_pf_texto::uuid else null end;

    insert into public.pedido_itens (
      pedido_id, produto_id, descricao, quantidade_pedida, unidade, valor_unitario,
      unidade_recebida, quantidade_recebida, valor_unitario_recebido
    ) values (
      p_pedido_id, v_produto_id, btrim(v_item->>'descricao'), v_quantidade, btrim(v_item->>'unidade'), v_valor,
      btrim(v_item->>'unidade'), v_quantidade, v_valor
    )
    returning id into v_item_id;

    if v_produto_id is null then
      continue;
    end if;

    v_resolvido := public._resolver_config_comercial_historico(
      v_produto_id, p_fornecedor_id, btrim(v_item->>'unidade'), v_fator, v_pf_informado
    );
    v_config_id := nullif(v_resolvido->>'config_id', '')::uuid;
    v_fator_final := nullif(v_resolvido->>'fator_final', '')::numeric;

    insert into public.produtos_historico_compras (
      produto_id, fornecedor_id, unidade_comercial, quantidade_comercial,
      preco_unitario_comercial, fator_conversao_base, data_compra, origem,
      pedido_item_id, produto_fornecedor_id
    ) values (
      v_produto_id, p_fornecedor_id, btrim(v_item->>'unidade'), v_quantidade,
      v_valor, v_fator_final, p_data_compra, 'compra_presencial',
      v_item_id, v_config_id
    );
  end loop;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_item_id_texto := nullif(btrim(coalesce(v_item->>'pedido_item_id', '')), '');
    continue when v_item_id_texto is null; -- 11b: so os EXISTENTES aqui
    v_item_id := v_item_id_texto::uuid;

    v_quantidade := (v_item->>'quantidade_pedida')::numeric;
    v_valor := (v_item->>'valor_unitario')::numeric;
    v_produto_texto := nullif(btrim(coalesce(v_item->>'produto_id', '')), '');
    v_produto_id := case when v_produto_texto is not null then v_produto_texto::uuid else null end;
    v_fator_texto := nullif(btrim(coalesce(v_item->>'fator_conversao_base', '')), '');
    v_fator := case when v_fator_texto is not null then v_fator_texto::numeric else null end;
    v_pf_texto := nullif(btrim(coalesce(v_item->>'produto_fornecedor_id', '')), '');
    v_pf_informado := case when v_pf_texto is not null then v_pf_texto::uuid else null end;

    update public.pedido_itens
    set produto_id = v_produto_id,
        descricao = btrim(v_item->>'descricao'),
        quantidade_pedida = v_quantidade,
        unidade = btrim(v_item->>'unidade'),
        valor_unitario = v_valor,
        unidade_recebida = btrim(v_item->>'unidade'),
        quantidade_recebida = v_quantidade,
        valor_unitario_recebido = v_valor
    where id = v_item_id
      and pedido_id = p_pedido_id;

    if v_produto_id is null then
      continue;
    end if;

    v_resolvido := public._resolver_config_comercial_historico(
      v_produto_id, p_fornecedor_id, btrim(v_item->>'unidade'), v_fator, v_pf_informado
    );
    v_config_id := nullif(v_resolvido->>'config_id', '')::uuid;
    v_fator_final := nullif(v_resolvido->>'fator_final', '')::numeric;

    insert into public.produtos_historico_compras (
      produto_id, fornecedor_id, unidade_comercial, quantidade_comercial,
      preco_unitario_comercial, fator_conversao_base, data_compra, origem,
      pedido_item_id, produto_fornecedor_id
    ) values (
      v_produto_id, p_fornecedor_id, btrim(v_item->>'unidade'), v_quantidade,
      v_valor, v_fator_final, p_data_compra, 'compra_presencial',
      v_item_id, v_config_id
    );
  end loop;

  -- 11c) remove os itens que existiam antes e nao vieram no payload
  --      final -- historico deles ja foi apagado no passo 9. So executa
  --      se havia itens antes (v_ids_atuais nao nulo).
  if v_ids_atuais is not null then
    delete from public.pedido_itens
    where pedido_id = p_pedido_id
      and id = any(v_ids_atuais)
      and id <> all(v_ids_payload_existentes);
  end if;

  -- 12) SNAPSHOT final + auditoria (secao 11 do cabecalho desta
  --     migration) -- acao dedicada, distinta de qualquer transicao de
  --     status (o status NUNCA muda aqui). Sem dado sensivel -- so
  --     colunas de pedido/pedido_itens/produtos_historico_compras, todas
  --     ja visiveis a quem tem pedidos.visualizar/catalogo_produtos.
  --     visualizar.
  select jsonb_agg(to_jsonb(pi.*)) into v_itens_depois
  from public.pedido_itens pi
  where pi.pedido_id = p_pedido_id;

  select jsonb_agg(to_jsonb(phc.*)) into v_historicos_depois
  from public.produtos_historico_compras phc
  join public.pedido_itens pi on pi.id = phc.pedido_item_id
  where pi.pedido_id = p_pedido_id
    and phc.origem = 'compra_presencial';

  insert into public.logs_auditoria (entidade, registro_id, acao, valor_anterior, valor_novo)
  values (
    'pedido',
    p_pedido_id::text,
    'compra_presencial_editada',
    jsonb_build_object(
      'pedido', v_pedido_antes,
      'itens', coalesce(v_itens_antes, '[]'::jsonb),
      'historicos', coalesce(v_historicos_antes, '[]'::jsonb)
    )::text,
    jsonb_build_object(
      'pedido', to_jsonb(v_pedido.*),
      'itens', coalesce(v_itens_depois, '[]'::jsonb),
      'historicos', coalesce(v_historicos_depois, '[]'::jsonb),
      'usuario', auth.uid(),
      'editado_em', now()
    )::text
  );

  return v_pedido;
end;
$$;

comment on function public.editar_compra_presencial(uuid, uuid, date, text, date, text, jsonb) is
  'Corrige uma compra presencial JA recebida (fornecedor, data, nota/documento, observacoes, itens) SEM sair de status=recebido -- nunca transiciona para aguardando_entrega. SECURITY DEFINER, exige SOMENTE pedidos.editar (ver decisao no cabecalho da migration 0037 sobre por que nao exigir tambem pedidos.receber). Bloqueia o pedido (FOR UPDATE). Estrategia de historico: REMOVE todo o historico origem=compra_presencial desta compra (nunca origem=manual/recebimento_pedido, nunca de outro pedido) e RECRIA do zero a partir do estado final dos itens, usando a mesma regra de produto_fornecedores de receber_pedido() (via _resolver_config_comercial_historico()). Ordem: apaga historico -> atualiza cabecalho -> insere itens novos (com historico) -> atualiza itens existentes (com historico) -> remove itens excluidos. Grava snapshot completo antes/depois em logs_auditoria (acao=compra_presencial_editada). Qualquer falha em qualquer etapa desfaz a transacao inteira.';

revoke execute on function public.editar_compra_presencial(uuid, uuid, date, text, date, text, jsonb) from public;
revoke execute on function public.editar_compra_presencial(uuid, uuid, date, text, date, text, jsonb) from anon;
grant execute on function public.editar_compra_presencial(uuid, uuid, date, text, date, text, jsonb) to authenticated;


-- ============================================================
-- 16) POS-CONDICOES DURAS
-- ============================================================
do $$
declare
  v_qtd int;
begin
  select count(*) into v_qtd from public.pedidos where modalidade_compra = 'pedido_com_entrega';
  if v_qtd <> 12 then
    raise exception 'compras_presenciais: apos backfill, % pedido(s) com modalidade_compra=pedido_com_entrega, esperado exatamente 12 -- abortando.', v_qtd;
  end if;

  select count(*) into v_qtd from public.pedidos where modalidade_compra = 'compra_presencial';
  if v_qtd <> 0 then
    raise exception 'compras_presenciais: apos a migration, % pedido(s) com modalidade_compra=compra_presencial, esperado exatamente 0 (nenhuma compra presencial foi registrada por esta migration, so a estrutura foi criada) -- abortando.', v_qtd;
  end if;

  select count(*) into v_qtd from public.pedido_itens;
  if v_qtd <> 33 then
    raise exception 'compras_presenciais: total de pedido_itens apos a migration e %, esperado exatamente 33 (nenhuma linha deveria ter sido tocada) -- abortando.', v_qtd;
  end if;

  select count(*) into v_qtd from public.produtos_historico_compras where origem = 'recebimento_pedido';
  if v_qtd <> 29 then
    raise exception 'compras_presenciais: total de historico origem=recebimento_pedido apos a migration e %, esperado exatamente 29 -- abortando.', v_qtd;
  end if;

  select count(*) into v_qtd from public.produtos_historico_compras where origem = 'compra_presencial';
  if v_qtd <> 0 then
    raise exception 'compras_presenciais: total de historico origem=compra_presencial apos a migration e %, esperado exatamente 0 -- abortando.', v_qtd;
  end if;

  raise notice 'compras_presenciais: migration concluida. pedidos.modalidade_compra/numero_nota_fiscal/data_documento_fiscal criadas (12 pedidos existentes classificados pedido_com_entrega). produtos_historico_compras.origem amplia para incluir compra_presencial (nenhum registro criado ainda). criar_pedido/pedidos_protecao/pedido_itens_protecao/reabrir_recebimento_pedido substituidas (CREATE OR REPLACE). Funcoes novas: _resolver_config_comercial_historico (interna), registrar_compra_presencial, editar_compra_presencial.';
end $$;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro somente enquanto NENHUMA compra presencial tiver sido
-- registrada ainda (nenhum registrar_compra_presencial() chamado em
-- producao) -- depois disso, reverter as colunas/constraints abaixo
-- destruiria dados reais (pedidos.modalidade_compra='compra_presencial',
-- historico origem='compra_presencial'). Restaura criar_pedido/
-- pedidos_protecao/pedido_itens_protecao/reabrir_recebimento_pedido para
-- os corpos exatos das migrations 0022/0026/0027 (sem os ramos/colunas
-- novas desta migration).
-- BEGIN;
--
--   revoke execute on function public.editar_compra_presencial(uuid, uuid, date, text, date, text, jsonb) from authenticated;
--   drop function if exists public.editar_compra_presencial(uuid, uuid, date, text, date, text, jsonb);
--
--   revoke execute on function public.registrar_compra_presencial(uuid, date, text, date, text, jsonb) from authenticated;
--   drop function if exists public.registrar_compra_presencial(uuid, date, text, date, text, jsonb);
--
--   drop function if exists public._resolver_config_comercial_historico(uuid, uuid, text, numeric, uuid);
--
--   -- Restaura reabrir_recebimento_pedido/pedido_itens_protecao/
--   -- pedidos_protecao para os corpos EXATOS da migration 0027 (copiar
--   -- os CREATE OR REPLACE de supabase/migrations/0027_pedidos_
--   -- reabrir_recebimento.sql, secoes 1/2/4) e criar_pedido para o corpo
--   -- exato da migration 0022 (secao 7) -- nao reproduzidos aqui por
--   -- extenso, ver os arquivos originais.
--
--   alter table public.produtos_historico_compras
--     drop constraint if exists produtos_historico_compras_origem_pedido_item_coerente_check;
--   alter table public.produtos_historico_compras
--     add constraint produtos_historico_compras_origem_pedido_item_coerente_check
--     check (
--       (origem = 'manual' and pedido_item_id is null)
--       or (origem = 'recebimento_pedido' and pedido_item_id is not null)
--     );
--
--   alter table public.produtos_historico_compras
--     drop constraint if exists produtos_historico_compras_origem_valida_check;
--   alter table public.produtos_historico_compras
--     add constraint produtos_historico_compras_origem_valida_check
--     check (origem in ('manual', 'recebimento_pedido'));
--
--   alter table public.pedidos drop column if exists data_documento_fiscal;
--   alter table public.pedidos drop column if exists numero_nota_fiscal;
--   alter table public.pedidos drop constraint if exists pedidos_modalidade_compra_check;
--   alter table public.pedidos drop column if exists modalidade_compra;
--
-- COMMIT;
