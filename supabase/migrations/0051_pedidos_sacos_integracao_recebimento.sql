-- 0051_pedidos_sacos_integracao_recebimento.sql
-- Numeracao confirmada em disco/git antes de nomear este arquivo: maior
-- migration em supabase/migrations/ e 0050 (Sacos, ja commitada e
-- publicada em 23ec4a5); 0049 e Expositores (ja commitada, publicada em
-- 2e019b9); nenhum arquivo 0051+ existe em disco em nenhum diretorio do
-- repositorio no momento em que este arquivo foi escrito. 0051 e o
-- proximo numero livre confirmado.
--
-- ============================================================
-- REVISAO 2 (esta versao) -- BLOQUEIO CONCEITUAL REAL, CONFIRMADO POR
-- DADOS REAIS (diagnostico_quantidade_recebida_sacos_CONSOLIDADO_
-- EXECUTAR.sql, executado pelo usuario):
-- ============================================================
--   PAO FRANCES / GoldPao (produto_fornecedor_id
--   53c93769-3a4c-4d47-acd7-ab8de050de9b): unidade_comercial=KG,
--   quantidade_embalagem=NULL, peso_por_saco_kg=8.000,
--   controla_sacos_fechados=true. Pedido real: unidade_pedida=KG,
--   quantidade_pedida=10.000, unidade_recebida=KG,
--   quantidade_recebida=10.000.
--
--   CONCLUSAO: quantidade_recebida=10/unidade_recebida=KG significa 10
--   KG, NAO 10 sacos -- a hipotese da REVISAO 1 desta migration
--   ("quantidade_sacos = quantidade_recebida quando a unidade comercial
--   bate") esta REFUTADA pelos dados reais: a unidade comercial desta
--   configuracao E O PROPRIO KG (o fornecedor vende PAO FRANCES a granel
--   por peso, empacotado depois em sacos fechados de 8kg cada -- a
--   "unidade comercial de compra" e KG, nao "1 saco"). NENHUMA
--   inferencia a partir de quantidade_recebida/unidade_recebida pode
--   determinar quantos sacos fisicos foram recebidos -- essa informacao
--   simplesmente NAO EXISTE em nenhum dado hoje capturado.
--
--   DECISAO DE ARQUITETURA (usuario, corrigida nesta revisao): NAO
--   alterar a semantica de quantidade_recebida (continua "quantidade
--   efetivamente recebida na unidade comercial do pedido" -- para PAO
--   FRANCES, KG, sem mudanca). Para itens cuja configuracao comercial
--   EXATA resolvida tenha controla_sacos_fechados=true, o recebimento
--   passa a exigir um dado NOVO e EXPLICITO: quantidade_sacos_recebidos
--   -- nunca calculado, sempre informado pelo operador. Exemplo real:
--   quantidade_recebida=40 (KG) + quantidade_sacos_recebidos=5 (sacos de
--   8kg) -- os dois numeros sao validados como COERENTES entre si (5 x 8
--   = 40), nunca um derivando o outro silenciosamente.
--
-- ============================================================
-- DIAGNOSTICO COMPLETO (mantido da revisao anterior, ainda valido -- ver
-- tambem relatorio consolidado entregue ao usuario)
-- ============================================================
--   A) receber_pedido(uuid,date,jsonb) (0026) e o UNICO caminho de
--      recebimento de pedidos COM ENTREGA. Compra presencial (0037) e um
--      caminho SEPARADO e INDEPENDENTE -- fora de escopo desta migration
--      (ver secao "FORA DE ESCOPO" abaixo). A nova coluna em pedido_itens
--      e NULLABLE e nao exige nenhuma alteracao em registrar_compra_
--      presencial/editar_compra_presencial (INSERT com lista de colunas
--      explicita, nao "select *" -- uma coluna nova nullable sem default
--      nao quebra INSERT existente, fica NULL automaticamente).
--   B) pedido_itens NAO guarda produto_fornecedor_id no momento da
--      CRIACAO do pedido -- a configuracao comercial so e resolvida no
--      RECEBIMENTO, dentro da propria receber_pedido(), reaproveitando o
--      mesmo v_config_id ja calculado para o historico do Catalogo.
--   C) sacos_fechados_movimentacoes (0042) JA aceita tipo=entrada/
--      origem=recebimento_pedido (CHECK constraints desde a 0042) -- SEM
--      NENHUMA alteracao de schema necessaria nesta tabela.
--   D) estoque_movimentacoes (0041): origem/origem_id sao texto
--      livre/uuid nullable -- aceita a nova origem
--      'sacos_fechados_recebimento_pedido' sem alteracao de schema.
--      PROVADO POR GREP (nao presumido) que NENHUMA outra RPC deste
--      projeto, alem das RPCs de Sacos (registrar_abertura_saco/
--      registrar_saldo_inicial_sacos/editar_movimentacao_saco/
--      excluir_movimentacao_saco), jamais escreveu em
--      estoque_movimentacoes -- produtos_historico_compras/receber_pedido
--      NUNCA tocaram estoque_movimentacoes (o cabecalho da 0037 confirma
--      isso explicitamente: "nenhuma movimentacao de estoque" e listado
--      como exclusao deliberada de escopo daquela migration). CONCLUSAO:
--      para um item de 40kg/5 sacos, o saldo geral de estoque aumenta
--      EXATAMENTE +40kg (a nova entrada de Sacos desta migration), NUNCA
--      +80kg -- nao ha nenhum outro caminho que ja movimente estoque para
--      duplicar.
--   E) IDEMPOTENCIA -- inalterada desde a revisao anterior: nenhum
--      operacao_id novo e necessario (transicao de status do pedido e a
--      unica saida possivel de aguardando_entrega; indice unico parcial
--      de pedido_item_id em sacos_fechados_movimentacoes, 0042, e defesa
--      em profundidade).
--   F) CANCELAMENTO/EXCLUSAO -- inalterado: um pedido RECEBIDO nunca pode
--      ser excluido/cancelado (auditado na revisao anterior, sem mudanca
--      nesta).
--   G) REABERTURA -- inalterado na essencia (desfaz atomicamente a
--      entrada automatica de Sacos+Estoque, bloqueia se deixar saldo
--      negativo), mas agora TAMBEM limpa quantidade_sacos_recebidos do
--      pedido_item junto dos demais snapshots de recebimento -- exige
--      tambem CREATE OR REPLACE de pedido_itens_protecao() (ver secao
--      nova H abaixo).
--   H) NOVO NESTA REVISAO -- pedido_itens_protecao() (0022/0027) precisa
--      de CREATE OR REPLACE: a janela estreita de limpeza da reabertura
--      (ramo "v_status = 'recebido'") hoje so verifica que unidade_
--      recebida/quantidade_recebida/valor_unitario_recebido ficam NULL
--      apos a limpeza -- sem esta alteracao, a nova coluna
--      quantidade_sacos_recebidos NAO seria protegida por essa checagem
--      (o trigger simplesmente nao saberia que ela existe, deixando uma
--      lacuna na garantia "reabertura so pode limpar os campos de
--      recebimento"). Corrigido: o mesmo ramo agora TAMBEM exige
--      quantidade_sacos_recebidos NULL apos a limpeza. Nenhuma outra
--      parte do trigger muda.
--
-- ============================================================
-- REGRA FINAL PARA quantidade_sacos_recebidos
-- ============================================================
-- SEMPRE explicito, NUNCA calculado a partir de quantidade_recebida/
-- unidade_recebida/quantidade_embalagem. Quando o item resolve, sem
-- ambiguidade, para uma configuracao comercial com controla_sacos_
-- fechados=true:
--   1) quantidade_sacos_recebidos e OBRIGATORIO no payload deste item --
--      ausente = erro claro, nunca assume 0 nem deriva de outro campo;
--   2) precisa ser um INTEIRO MAIOR QUE ZERO (mesmo dominio de
--      quantidade_sacos em sacos_fechados_movimentacoes);
--   3) COERENCIA EXATA, em aritmetica numeric (nunca float/JS frouxo):
--      quantidade_recebida = quantidade_sacos_recebidos * peso_por_saco_kg
--      da configuracao -- se nao bater EXATAMENTE, o recebimento INTEIRO
--      e abortado com mensagem explicando os dois valores e o esperado.
--      SEM TOLERANCIA/EPSILON -- pedido explicito do usuario (V1 assume
--      peso fixo por saco, cadastrado uma vez em Catalogo).
-- Quando o item NAO resolve para uma configuracao controla_sacos_
-- fechados=true (config resolvida com controla=false, OU sem config
-- determinavel e nenhuma config candidata controla sacos): se o payload
-- MESMO ASSIM informou quantidade_sacos_recebidos, o recebimento e
-- abortado (nao ignora silenciosamente um dado incoerente enviado pelo
-- cliente -- mesma filosofia ja usada para fator_conversao_base
-- incompativel, 0026). Se houver configuracao controla_sacos_fechados=
-- true para o produto/fornecedor mas ela nao puder ser resolvida sem
-- ambiguidade, o recebimento e bloqueado exigindo produto_fornecedor_id
-- explicito (inalterado da revisao anterior).
--
-- ============================================================
-- ONDE PERSISTIR quantidade_sacos_recebidos
-- ============================================================
-- pedido_itens.quantidade_sacos_recebidos integer NULL -- preferencia
-- arquitetural do usuario, confirmada compativel:
--   * pedido_itens_protecao (0022/0027): fora da janela de reabertura,
--     QUALQUER coluna pode mudar enquanto o pedido-pai e
--     aguardando_entrega -- sem restricao nenhuma, SEM PRECISAR DE
--     ALTERACAO para o UPDATE que receber_pedido ja faz normalmente.
--     DENTRO da janela de reabertura, precisa da alteracao pontual
--     descrita na secao H acima -- feita nesta migration.
--   * receber_pedido: grava o snapshot com um UPDATE proprio, DEPOIS de
--     confirmar que a config controla sacos (a coluna so e setada
--     quando aplicavel -- nunca um valor arbitrario para item que nao
--     controla sacos).
--   * reabrir_recebimento_pedido: limpa junto dos demais 3 campos de
--     recebimento, no mesmo UPDATE.
--   * registrar_compra_presencial/editar_compra_presencial (0037): INSERT
--     com lista de colunas explicita -- coluna nova nullable sem
--     default nao exige nenhuma mudanca nelas, fica NULL
--     automaticamente. Confirmado compativel, nao alterado nesta
--     migration (integracao Compra Presencial <-> Sacos fica para uma
--     frente futura).
--   * produtos_historico_compras: nao ganha coluna nenhuma -- continua
--     registrando quantidade_comercial=quantidade_recebida (KG),
--     inalterado.
--   * NAO reinterpreta pedidos ja recebidos -- coluna nova, NULL para
--     toda linha existente, sem backfill (ver secao "PEDIDOS ANTIGOS"
--     abaixo).
--
-- ============================================================
-- ARQUITETURA TRANSACIONAL
-- ============================================================
-- Tudo dentro da propria receber_pedido() -- sem RPC nova. Apos o INSERT
-- em produtos_historico_compras (que continua identico, byte a byte, e
-- continua gravando quantidade_comercial=quantidade_recebida em KG, sem
-- nenhuma mudanca de significado), no mesmo loop por item:
--   1) se v_config_id nulo:
--      a) se existe config controla_sacos_fechados=true para este
--         produto+fornecedor -> ABORTA pedindo produto_fornecedor_id
--         explicito;
--      b) senao, se o payload informou quantidade_sacos_recebidos para
--         este item -> ABORTA (dado incoerente, nenhuma config de sacos
--         aplicavel);
--      c) senao, nada muda.
--   2) se v_config_id nao nulo -> busca controla_sacos_fechados/
--      peso_por_saco_kg da config, com FOR UPDATE (mesma ordem de lock
--      ja usada pelas 4 RPCs de escrita de Sacos, evita deadlock);
--   3) se controla_sacos_fechados=false -> se o payload informou
--      quantidade_sacos_recebidos, ABORTA (dado incoerente); senao, nada
--      muda;
--   4) se controla_sacos_fechados=true -> exige quantidade_sacos_
--      recebidos no payload (inteiro>0), valida coerencia EXATA
--      (quantidade_recebida = quantidade_sacos_recebidos x
--      peso_por_saco_kg), valida unidade-base do produto=KG (mesma
--      validacao das demais RPCs de Sacos) -> grava o snapshot em
--      pedido_itens.quantidade_sacos_recebidos -> insere
--      sacos_fechados_movimentacoes (tipo=entrada,
--      origem=recebimento_pedido, quantidade_sacos=quantidade_sacos_
--      recebidos, peso_por_saco_kg_snapshot, pedido_item_id) -> insere
--      estoque_movimentacoes (quantidade=quantidade_sacos_recebidos x
--      peso_por_saco_kg, origem=sacos_fechados_recebimento_pedido,
--      origem_id=<movimentacao de sacos>).
-- Qualquer falha em qualquer etapa desfaz a transacao INTEIRA.
--
-- ============================================================
-- REABERTURA
-- ============================================================
-- Mantido o desenho ja aprovado (desfaz Sacos+Estoque atomicamente,
-- bloqueia se deixar saldo negativo, nunca toca movimento manual --
-- filtro sempre por origem='recebimento_pedido', que estruturalmente
-- nunca e um movimento manual, CHECK sacos_fechados_movimentacoes_
-- tipo_origem_coerente_check, 0042), com UM acrescimo: o UPDATE que
-- limpa pedido_itens agora TAMBEM zera quantidade_sacos_recebidos, ao
-- lado dos outros 3 campos de recebimento.
--
-- ============================================================
-- PEDIDOS ANTIGOS
-- ============================================================
-- Coluna nova, NULL para toda linha ja existente -- nenhum UPDATE de
-- backfill nesta migration. Nenhum movimento automatico retroativo e
-- criado. A integracao vale so para recebimentos NOVOS, feitos depois
-- desta migration estar aplicada.
--
-- ============================================================
-- FRONTEND
-- ============================================================
-- ReceberPedidoModal.js ganha, SOMENTE quando a configuracao EXATA
-- resolvida (explicita ou automatica-sem-ambiguidade) tiver controla_
-- sacos_fechados=true: um campo NOVO "Quantidade de sacos recebidos"
-- (obrigatorio, inteiro, >0) + um resumo (peso por saco, quantidade
-- recebida em kg, sacos recebidos, peso teorico dos sacos) + validacao
-- client-side de coerencia EXATA (arredondada a 3 casas decimais, mesma
-- precisao de numeric(12,3), para evitar ruido de ponto flutuante em
-- JS -- SO PARA UX; o backend e sempre a autoridade real). O campo so
-- aparece quando aplicavel -- nenhum item que nao controla sacos ganha
-- campo novo.
--
-- ============================================================
-- SERVICE_ROLE
-- ============================================================
-- Mesma decisao da revisao anterior, mantida: grant legado de EXECUTE a
-- service_role em receber_pedido/reabrir_recebimento_pedido (bootstrap
-- automatico do Supabase desde 0026/0027, nunca revogado explicitamente
-- por aquelas migrations originais) NAO e tocado por esta migration --
-- os REVOKE desta migration cobrem so public/anon, deliberadamente. Nem
-- pedido_itens_protecao() precisa de nenhuma consideracao de grant (e
-- uma funcao de trigger, nunca invocavel como RPC).
--
-- ============================================================
-- FORA DE ESCOPO NESTA RODADA (deliberado, nao esquecido):
-- ============================================================
--   * compra presencial -- continua sem integracao com Sacos;
--   * recebimento parcial -- nao existe hoje, nao alterado;
--   * nenhuma alteracao em Expositores, Solicitacoes, Catalogo, ou em
--     qualquer RPC alem das listadas no ESCOPO abaixo;
--   * nenhuma correcao do grant legado de service_role.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1) public.pedido_itens -- ALTER TABLE (1 coluna nova nullable + 1
--      CHECK simples);
--   2) public.pedido_itens_protecao() -- CREATE OR REPLACE (corpo
--      IDENTICO ao de 0022/0027 + 1 linha na janela de reabertura, para
--      proteger a coluna nova);
--   3) public.receber_pedido(uuid, date, jsonb) -- CREATE OR REPLACE
--      (corpo IDENTICO ao da 0026 + o bloco de integracao com Sacos
--      Fechados via quantidade_sacos_recebidos explicito);
--   4) public.reabrir_recebimento_pedido(uuid) -- CREATE OR REPLACE
--      (corpo IDENTICO ao da 0027 + desfazimento atomico e seguro da
--      entrada automatica de Sacos Fechados + limpeza do snapshot
--      quantidade_sacos_recebidos).
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em registrar_abertura_saco, registrar_saldo_
--     inicial_sacos, editar_movimentacao_saco, excluir_movimentacao_saco,
--     listar_sacos_fechados_configuracoes;
--   * nenhuma alteracao em registrar_compra_presencial,
--     editar_compra_presencial, _resolver_config_comercial_historico,
--     criar_pedido, excluir_pedido, excluir_pedido_com_solicitacoes,
--     marcar_pedido_recebido, cancelar_pedido, pedidos_protecao;
--   * nenhuma alteracao em Expositores;
--   * nenhum codigo de permissao novo;
--   * nenhuma carga real de dados, nenhum backfill retroativo;
--   * nenhuma correcao do grant legado de service_role.
--
-- Pre-requisitos: 0001..0050 ja aplicadas.

BEGIN;

-- ============================================================
-- 1. public.pedido_itens -- snapshot explicito de sacos recebidos
-- ============================================================
alter table public.pedido_itens
  add column if not exists quantidade_sacos_recebidos integer;

comment on column public.pedido_itens.quantidade_sacos_recebidos is
  'Quantidade FISICA de sacos fechados efetivamente recebida para este item -- SEMPRE explicita (informada pelo operador no recebimento), NUNCA calculada a partir de quantidade_recebida/unidade_recebida/quantidade_embalagem (esses tres nao determinam quantos sacos fisicos foram recebidos -- ver migration 0051). Preenchida por receber_pedido() SOMENTE quando a configuracao comercial resolvida para o item tem controla_sacos_fechados=true, validada como coerente com quantidade_recebida (quantidade_recebida = quantidade_sacos_recebidos * peso_por_saco_kg, exato). NULL para itens que nao controlam sacos, e para todo pedido_item ja existente antes desta migration (sem backfill retroativo). Limpa (volta a NULL) por reabrir_recebimento_pedido() junto dos demais campos de recebimento.';

do $$
begin
  alter table public.pedido_itens
    add constraint pedido_itens_quantidade_sacos_recebidos_positiva_check
    check (quantidade_sacos_recebidos is null or quantidade_sacos_recebidos > 0);
exception
  when duplicate_object then null;
end $$;


-- ============================================================
-- 2. public.pedido_itens_protecao -- CREATE OR REPLACE: protege a
--    coluna nova na janela estreita de reabertura
-- ============================================================
create or replace function public.pedido_itens_protecao()
returns trigger
language plpgsql
security definer  -- le public.pedidos independente de quem chama ter
                   -- pedidos.visualizar; mesmo motivo de
                   -- logs_auditoria_preencher_usuario precisar ler auth.users
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op = 'INSERT' then
    new.criado_em := now();
    new.atualizado_em := now();

    select status into v_status from public.pedidos where id = new.pedido_id;

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

    select status into v_status from public.pedidos where id = old.pedido_id;

    -- REABERTURA: excecao estreita -- permite limpar SOMENTE os campos
    -- de recebimento de um item cujo pedido-pai AINDA esta
    -- status=recebido (a transicao do pedido em si so acontece DEPOIS,
    -- ver reabrir_recebimento_pedido()). Mesmo gate estrutural de
    -- pedidos_protecao -- rolbypassrls identifica "contexto elevado de
    -- ALGUMA funcao SECURITY DEFINER", nao exclusivamente esta RPC (ver
    -- nota completa no ramo equivalente de pedidos_protecao, 0027).
    -- NOVO (0051): quantidade_sacos_recebidos agora tambem faz parte
    -- dos "campos de recebimento" que precisam ficar NULL apos a
    -- limpeza -- sem isso, a coluna nova ficaria sem protecao alguma
    -- nesta janela.
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
      if new.unidade_recebida is not null or new.quantidade_recebida is not null or new.valor_unitario_recebido is not null or new.quantidade_sacos_recebidos is not null then
        raise exception 'pedido_itens: reabertura de recebimento deve limpar os campos de recebimento (definir como NULL).';
      end if;
      return new;
    end if;

    if v_status is distinct from 'aguardando_entrega' then
      raise exception 'pedido_itens: nao e possivel alterar item de pedido com status=%.', coalesce(v_status, 'inexistente');
    end if;

    return new;

  elsif tg_op = 'DELETE' then
    select status into v_status from public.pedidos where id = old.pedido_id;

    if v_status is distinct from 'aguardando_entrega' then
      raise exception 'pedido_itens: nao e possivel remover item de pedido com status=%.', coalesce(v_status, 'inexistente');
    end if;

    return old;
  end if;

  return null;
end;
$$;

comment on function public.pedido_itens_protecao() is
  'BEFORE INSERT/UPDATE/DELETE em pedido_itens, TG_OP explicito. Forca criado_em/atualizado_em; bloqueia pedido_id e criado_em imutaveis; bloqueia qualquer INSERT/UPDATE/DELETE quando o pedido-pai nao esta aguardando_entrega -- EXCETO um UPDATE que limpa SOMENTE unidade_recebida/quantidade_recebida/valor_unitario_recebido/quantidade_sacos_recebidos (0051, NOVO) para NULL enquanto o pedido-pai ainda e recebido, liberado apenas quando o papel efetivo tem rolbypassrls e a permissao pedidos.reabrir_recebimento. SECURITY DEFINER para ler pedidos.status independente da RLS de SELECT de pedidos do chamador.';

revoke execute on function public.pedido_itens_protecao() from public;

-- Trigger em si (nome, evento, timing) NAO muda -- so o CORPO da funcao.


-- ============================================================
-- 3. public.receber_pedido -- CREATE OR REPLACE: integracao com Sacos
--    Fechados via quantidade_sacos_recebidos EXPLICITO
-- ============================================================
create or replace function public.receber_pedido(
  p_pedido_id        uuid,
  p_data_recebimento date,
  p_itens            jsonb
)
returns public.pedidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido                     public.pedidos%rowtype;
  v_ids_reais                  uuid[];
  v_ids_payload                 uuid[];
  v_item                        jsonb;
  v_item_id                     uuid;
  v_unidade_recebida            text;
  v_quantidade_recebida         numeric;
  v_valor_unitario_recebido     numeric;
  v_fator_texto                 text;
  v_fator                       numeric;
  v_fator_final                 numeric;
  v_produto_id                  uuid;
  v_produto_fornecedor_informado uuid;
  v_config_id                   uuid;
  v_config_unidade              text;
  v_config_fator                numeric;
  v_qtd_configs                 integer;
  v_hoje_sp                     date;
  -- Novas (0051) -- integracao com Sacos Fechados, quantidade explicita.
  v_qtd_sacos_texto             text;
  v_qtd_sacos_recebidos         integer;
  v_controla_sacos              boolean;
  v_peso_por_saco               numeric;
  v_unidade_produto_sacos       text;
  v_sacos_mov_id                uuid;
begin
  -- 1) sessao autenticada + permissao -- unico portao real, ja que
  --    pedido_itens_update (pedidos.editar) e
  --    produtos_historico_compras_insert (origem='manual') NAO cobririam
  --    este fluxo, que deve exigir SOMENTE pedidos.receber.
  if auth.uid() is null then
    raise exception 'receber_pedido: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('pedidos.receber')) then
    raise exception using errcode = '42501',
      message = 'receber_pedido: requer a permissao pedidos.receber.';
  end if;

  if p_data_recebimento is null then
    raise exception 'receber_pedido: data do recebimento e obrigatoria.';
  end if;

  -- "Hoje" em America/Sao_Paulo -- NUNCA current_date puro (reflete o
  -- fuso da sessao, UTC por padrao no Supabase). Mesmo cuidado ja
  -- documentado para data_pedido em criar_pedido (0022).
  v_hoje_sp := (now() at time zone 'America/Sao_Paulo')::date;
  if p_data_recebimento > v_hoje_sp then
    raise exception 'receber_pedido: data do recebimento (%) nao pode ser no futuro (hoje em America/Sao_Paulo: %).',
      p_data_recebimento, v_hoje_sp;
  end if;

  -- 2) localiza e BLOQUEIA o pedido (FOR UPDATE) -- impede corrida entre
  --    duas chamadas concorrentes tentando receber o mesmo pedido, ou
  --    entre esta chamada e marcar_pedido_recebido/cancelar_pedido. Uma
  --    segunda chamada concorrente so prossegue depois que a primeira
  --    commitar (ou reverter) -- e ai encontra status<>aguardando_entrega
  --    e falha no proximo passo, nunca reprocessando o mesmo pedido.
  select * into v_pedido
  from public.pedidos
  where id = p_pedido_id
  for update;

  if v_pedido.id is null then
    raise exception 'receber_pedido: pedido % nao encontrado.', p_pedido_id;
  end if;

  if v_pedido.status <> 'aguardando_entrega' then
    raise exception 'receber_pedido: pedido % tem status=%, somente pedidos aguardando_entrega podem ser recebidos.',
      p_pedido_id, v_pedido.status;
  end if;

  if p_data_recebimento < v_pedido.data_pedido then
    raise exception 'receber_pedido: data do recebimento (%) nao pode ser anterior a data do pedido (%).',
      p_data_recebimento, v_pedido.data_pedido;
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'receber_pedido: e obrigatorio informar os itens recebidos.';
  end if;

  select array_agg(id) into v_ids_reais
  from public.pedido_itens
  where pedido_id = p_pedido_id;

  -- 3) 1a passada -- valida CADA item estruturalmente, ANTES de
  --    qualquer escrita.
  v_ids_payload := array[]::uuid[];

  for v_item in select * from jsonb_array_elements(p_itens) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'receber_pedido: cada item deve ser um objeto JSON, recebido: %', v_item;
    end if;

    begin
      v_item_id := nullif(btrim(coalesce(v_item->>'pedido_item_id', '')), '')::uuid;
    exception when invalid_text_representation then
      raise exception 'receber_pedido: pedido_item_id invalido (nao e um UUID) no item: %', v_item;
    end;

    if v_item_id is null then
      raise exception 'receber_pedido: pedido_item_id e obrigatorio em cada item: %', v_item;
    end if;

    v_ids_payload := v_ids_payload || v_item_id;

    if coalesce(btrim(v_item->>'unidade_recebida'), '') = '' then
      raise exception 'receber_pedido: item % sem unidade_recebida valida.', v_item_id;
    end if;

    begin
      v_quantidade_recebida := (v_item->>'quantidade_recebida')::numeric;
    exception when invalid_text_representation then
      raise exception 'receber_pedido: quantidade_recebida invalida (nao numerica) no item %.', v_item_id;
    end;
    if v_quantidade_recebida is null or v_quantidade_recebida <= 0 then
      raise exception 'receber_pedido: quantidade_recebida deve ser maior que zero no item %.', v_item_id;
    end if;

    begin
      v_valor_unitario_recebido := (v_item->>'valor_unitario_recebido')::numeric;
    exception when invalid_text_representation then
      raise exception 'receber_pedido: valor_unitario_recebido invalido (nao numerico) no item %.', v_item_id;
    end;
    if v_valor_unitario_recebido is null or v_valor_unitario_recebido < 0 then
      raise exception 'receber_pedido: valor_unitario_recebido invalido no item % (obrigatorio, pode ser 0 -- bonificacao/cortesia -- mas nunca negativo).', v_item_id;
    end if;

    v_fator_texto := nullif(btrim(coalesce(v_item->>'fator_conversao_base', '')), '');
    if v_fator_texto is not null then
      begin
        v_fator := v_fator_texto::numeric;
      exception when invalid_text_representation then
        raise exception 'receber_pedido: fator_conversao_base invalido (nao numerico) no item %.', v_item_id;
      end;
      if v_fator <= 0 then
        raise exception 'receber_pedido: fator_conversao_base deve ser maior que zero no item %.', v_item_id;
      end if;
    end if;

    if nullif(btrim(coalesce(v_item->>'produto_fornecedor_id', '')), '') is not null then
      begin
        perform nullif(btrim(v_item->>'produto_fornecedor_id'), '')::uuid;
      exception when invalid_text_representation then
        raise exception 'receber_pedido: produto_fornecedor_id invalido (nao e um UUID) no item %.', v_item_id;
      end;
    end if;

    -- NOVO (0051): validacao de FORMATO de quantidade_sacos_recebidos
    -- (inteiro > 0, quando informado) -- a validacao de OBRIGATORIEDADE/
    -- COERENCIA (depende de saber se a config controla sacos) so
    -- acontece na 2a passada, depois da resolucao de produto_
    -- fornecedores.
    v_qtd_sacos_texto := nullif(btrim(coalesce(v_item->>'quantidade_sacos_recebidos', '')), '');
    if v_qtd_sacos_texto is not null then
      begin
        v_qtd_sacos_recebidos := v_qtd_sacos_texto::integer;
      exception when invalid_text_representation then
        raise exception 'receber_pedido: quantidade_sacos_recebidos invalida (nao e um numero inteiro) no item %.', v_item_id;
      end;
      if v_qtd_sacos_recebidos <= 0 then
        raise exception 'receber_pedido: quantidade_sacos_recebidos deve ser maior que zero no item %.', v_item_id;
      end if;
    end if;
  end loop;

  -- 4) cobertura EXATA -- mesma contagem, sem duplicidade, todos
  --    pertencentes a este pedido. As tres checagens juntas garantem
  --    uma bijecao completa payload <-> itens reais.
  if array_length(v_ids_payload, 1) is distinct from array_length(v_ids_reais, 1) then
    raise exception 'receber_pedido: numero de itens informados (%) nao bate com o numero de itens do pedido (%).',
      coalesce(array_length(v_ids_payload, 1), 0), coalesce(array_length(v_ids_reais, 1), 0);
  end if;

  if (select count(distinct x) from unnest(v_ids_payload) as x) <> array_length(v_ids_payload, 1) then
    raise exception 'receber_pedido: ha item duplicado no payload.';
  end if;

  if exists (select 1 from unnest(v_ids_payload) as pid where pid <> all(v_ids_reais)) then
    raise exception 'receber_pedido: ha item no payload que nao pertence a este pedido.';
  end if;

  -- 5) 2a passada -- resolve produto_fornecedores (secao 4 do
  --    cabecalho da 0026) e escreve. Cada UPDATE de pedido_itens roda
  --    enquanto o pedido AINDA esta aguardando_entrega (status so muda
  --    no passo 6) -- pedido_itens_protecao permite normalmente.
  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_item_id := (v_item->>'pedido_item_id')::uuid;
    v_unidade_recebida := btrim(v_item->>'unidade_recebida');
    v_quantidade_recebida := (v_item->>'quantidade_recebida')::numeric;
    v_valor_unitario_recebido := (v_item->>'valor_unitario_recebido')::numeric;
    v_fator_texto := nullif(btrim(coalesce(v_item->>'fator_conversao_base', '')), '');
    v_fator := v_fator_texto::numeric; -- ja validado na 1a passada
    v_produto_fornecedor_informado := nullif(btrim(coalesce(v_item->>'produto_fornecedor_id', '')), '')::uuid;
    v_qtd_sacos_texto := nullif(btrim(coalesce(v_item->>'quantidade_sacos_recebidos', '')), '');
    v_qtd_sacos_recebidos := case when v_qtd_sacos_texto is not null then v_qtd_sacos_texto::integer else null end; -- ja validado na 1a passada

    -- produto_id vem do proprio pedido_itens (nao do payload) -- nunca
    -- confiamos em produto_id enviado pelo cliente para decidir se cria
    -- historico ou resolve configuracao comercial.
    update public.pedido_itens
    set unidade_recebida = v_unidade_recebida,
        quantidade_recebida = v_quantidade_recebida,
        valor_unitario_recebido = v_valor_unitario_recebido
    where id = v_item_id
      and pedido_id = p_pedido_id
    returning produto_id into v_produto_id;

    -- Item legado sem produto_id (pedido criado antes da exigencia de
    -- Catalogo no frontend): dado efetivo ja foi gravado acima em
    -- pedido_itens -- so nao gera historico (a FK produto_id NOT NULL
    -- de produtos_historico_compras nao permitiria de qualquer forma).
    -- Nao bloqueia o recebimento do pedido. Tambem nao pode ter
    -- quantidade_sacos_recebidos (sem produto, nao ha config
    -- determinavel).
    if v_produto_id is null then
      if v_qtd_sacos_recebidos is not null then
        raise exception 'receber_pedido: item % informou quantidade_sacos_recebidos, mas nao tem produto_id vinculado -- nao ha configuracao comercial possivel.', v_item_id;
      end if;
      continue;
    end if;

    -- Resolucao da configuracao comercial -- ver secao 4 do cabecalho
    -- da 0026 para a regra completa.
    v_config_id := null;
    v_fator_final := v_fator;

    if v_produto_fornecedor_informado is not null then
      select id, unidade_comercial, quantidade_embalagem
        into v_config_id, v_config_unidade, v_config_fator
      from public.produto_fornecedores
      where id = v_produto_fornecedor_informado
        and produto_id = v_produto_id
        and fornecedor_id = v_pedido.fornecedor_id;

      if v_config_id is null then
        raise exception 'receber_pedido: produto_fornecedor_id informado no item % nao corresponde a uma configuracao valida para este produto/fornecedor.', v_item_id;
      end if;
      if lower(btrim(v_config_unidade)) <> lower(btrim(v_unidade_recebida)) then
        raise exception 'receber_pedido: unidade informada (%) nao bate com a configuracao comercial selecionada (%) no item %.',
          v_unidade_recebida, v_config_unidade, v_item_id;
      end if;
      if v_config_fator is not null then
        if v_fator is not null and v_fator <> v_config_fator then
          raise exception 'receber_pedido: fator_conversao_base informado (%) nao bate com a configuracao comercial cadastrada (%) no item %.',
            v_fator, v_config_fator, v_item_id;
        end if;
        v_fator_final := v_config_fator;
      end if;
    else
      select count(*) into v_qtd_configs
      from public.produto_fornecedores
      where produto_id = v_produto_id
        and fornecedor_id = v_pedido.fornecedor_id
        and ativo = true
        and lower(btrim(unidade_comercial)) = lower(btrim(v_unidade_recebida));

      if v_qtd_configs = 1 then
        select id, quantidade_embalagem into v_config_id, v_config_fator
        from public.produto_fornecedores
        where produto_id = v_produto_id
          and fornecedor_id = v_pedido.fornecedor_id
          and ativo = true
          and lower(btrim(unidade_comercial)) = lower(btrim(v_unidade_recebida));

        if v_config_fator is not null then
          if v_fator is not null and v_fator <> v_config_fator then
            raise exception 'receber_pedido: fator_conversao_base informado (%) nao bate com a configuracao comercial cadastrada (%) no item %.',
              v_fator, v_config_fator, v_item_id;
          end if;
          v_fator_final := v_config_fator;
        end if;
      end if;
      -- v_qtd_configs = 0 ou > 1: sem configuracao determinavel
      -- automaticamente -- v_config_id permanece null, v_fator_final
      -- permanece o que veio do payload (pode ser null), sem validar
      -- contra nada (secao 4(c) do cabecalho da 0026).
    end if;

    insert into public.produtos_historico_compras (
      produto_id, fornecedor_id, unidade_comercial, quantidade_comercial,
      preco_unitario_comercial, fator_conversao_base, data_compra, origem,
      pedido_item_id, produto_fornecedor_id
    ) values (
      v_produto_id, v_pedido.fornecedor_id, v_unidade_recebida, v_quantidade_recebida,
      v_valor_unitario_recebido, v_fator_final, p_data_recebimento, 'recebimento_pedido',
      v_item_id, v_config_id
    );

    -- ============================================================
    -- NOVO (0051, REVISADO) -- integracao automatica com Sacos
    -- Fechados via quantidade_sacos_recebidos EXPLICITO. NUNCA calcula
    -- a partir de quantidade_recebida -- ver "REGRA FINAL" no cabecalho
    -- desta migration.
    -- ============================================================
    if v_config_id is null then
      if exists (
        select 1 from public.produto_fornecedores
        where produto_id = v_produto_id
          and fornecedor_id = v_pedido.fornecedor_id
          and ativo = true
          and controla_sacos_fechados = true
      ) then
        raise exception 'receber_pedido: existe configuracao comercial controlada por Sacos Fechados para o produto do item %, mas nao foi possivel resolve-la automaticamente (unidade/configuracao ambigua ou nao encontrada) -- informe produto_fornecedor_id explicitamente neste item.', v_item_id;
      end if;

      if v_qtd_sacos_recebidos is not null then
        raise exception 'receber_pedido: item % informou quantidade_sacos_recebidos, mas nenhuma configuracao comercial de Sacos Fechados foi resolvida para este item.', v_item_id;
      end if;
    else
      -- Trava a CONFIGURACAO (FOR UPDATE) -- mesma ordem de lock ja
      -- usada pelas 4 RPCs de escrita de Sacos, evita deadlock entre
      -- receber_pedido e qualquer uma delas para a mesma configuracao.
      select controla_sacos_fechados, peso_por_saco_kg
        into v_controla_sacos, v_peso_por_saco
      from public.produto_fornecedores
      where id = v_config_id
      for update;

      if v_controla_sacos then
        if v_qtd_sacos_recebidos is null then
          raise exception 'receber_pedido: item % esta vinculado a configuracao comercial controlada por Sacos Fechados -- informe quantidade_sacos_recebidos (quantidade fisica de sacos recebidos).', v_item_id;
        end if;

        -- Coerencia EXATA, em aritmetica numeric (nunca float) -- sem
        -- tolerancia/epsilon, pedido explicito do usuario (V1: peso
        -- fixo por saco).
        if v_quantidade_recebida <> (v_qtd_sacos_recebidos::numeric * v_peso_por_saco) then
          raise exception 'receber_pedido: item % -- quantidade recebida (% %) nao corresponde a % saco(s) de %kg cada (esperado % kg).',
            v_item_id, v_quantidade_recebida, v_unidade_recebida, v_qtd_sacos_recebidos, v_peso_por_saco, (v_qtd_sacos_recebidos::numeric * v_peso_por_saco);
        end if;

        select unidade_medida into v_unidade_produto_sacos
        from public.produtos
        where id = v_produto_id;

        if upper(btrim(coalesce(v_unidade_produto_sacos, ''))) <> 'KG' then
          raise exception 'receber_pedido: produto do item % tem unidade_medida=%, mas Sacos Fechados so opera sobre produtos cuja unidade-base seja KG.',
            v_item_id, v_unidade_produto_sacos;
        end if;

        update public.pedido_itens
        set quantidade_sacos_recebidos = v_qtd_sacos_recebidos
        where id = v_item_id;

        insert into public.sacos_fechados_movimentacoes (
          produto_fornecedor_id, quantidade_sacos, peso_por_saco_kg_snapshot,
          tipo, origem, pedido_item_id
        ) values (
          v_config_id, v_qtd_sacos_recebidos, v_peso_por_saco,
          'entrada', 'recebimento_pedido', v_item_id
        )
        returning id into v_sacos_mov_id;

        insert into public.estoque_movimentacoes (
          produto_id, quantidade, unidade, origem, origem_id
        ) values (
          v_produto_id, v_qtd_sacos_recebidos::numeric * v_peso_por_saco, v_unidade_produto_sacos,
          'sacos_fechados_recebimento_pedido', v_sacos_mov_id
        );
      else
        if v_qtd_sacos_recebidos is not null then
          raise exception 'receber_pedido: item % informou quantidade_sacos_recebidos, mas a configuracao comercial resolvida nao controla Sacos Fechados.', v_item_id;
        end if;
      end if;
    end if;
  end loop;

  -- 6) transicao formal -- reaproveita EXATAMENTE o mesmo caminho de
  --    marcar_pedido_recebido: so UPDATE status. recebido_em, a
  --    checagem de pedidos.receber (redundante com o passo 1, defesa em
  --    profundidade) e o log em logs_auditoria continuam sendo
  --    responsabilidade EXCLUSIVA da trigger pedidos_protecao (0022,
  --    intocada por esta migration).
  update public.pedidos
  set status = 'recebido'
  where id = p_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

comment on function public.receber_pedido(uuid, date, jsonb) is
  'Confirma o recebimento de um pedido com dados EFETIVOS por item -- substitui, para o fluxo detalhado, o simples marcar_pedido_recebido (0022). Exige sessao autenticada + pedidos.receber. Valida data do recebimento. Bloqueia a linha do pedido (FOR UPDATE). Exige TODOS os itens do pedido no payload. Para cada item com produto_id, resolve a configuracao comercial aplicavel em produto_fornecedores e cria um registro em produtos_historico_compras (origem=recebimento_pedido, quantidade_comercial=quantidade_recebida, sem mudanca de significado). NOVO (0051, revisado): quando a configuracao resolvida esta controla_sacos_fechados=true, EXIGE quantidade_sacos_recebidos explicito no payload (nunca calculado a partir de quantidade_recebida), valida coerencia EXATA (quantidade_recebida = quantidade_sacos_recebidos * peso_por_saco_kg) e unidade-base KG, grava o snapshot em pedido_itens.quantidade_sacos_recebidos, e insere atomicamente uma entrada em sacos_fechados_movimentacoes (tipo=entrada, origem=recebimento_pedido, pedido_item_id) + a movimentacao de estoque_movimentacoes correspondente (origem=sacos_fechados_recebimento_pedido). Rejeita quantidade_sacos_recebidos informada para item cuja config nao controla sacos, ou sem config de sacos resolvivel. Idempotente via a propria transicao de status do pedido + indice unico parcial de pedido_item_id (0042). SECURITY DEFINER: necessario porque nenhuma combinacao de policies normais autoriza este fluxo so com pedidos.receber. Qualquer falha em qualquer etapa desfaz a transacao inteira.';

-- NAO revoga de service_role -- grant legado desde a 0026 (bootstrap
-- automatico de privilegios padrao do Supabase, nunca revogado
-- explicitamente por aquela migration original), fora de escopo desta
-- frente por decisao explicita do usuario. CREATE OR REPLACE FUNCTION
-- nao altera ACL existente -- sem um REVOKE explicito aqui, o grant
-- legado de service_role permanece byte a byte como estava antes desta
-- migration.
revoke execute on function public.receber_pedido(uuid, date, jsonb) from public;
revoke execute on function public.receber_pedido(uuid, date, jsonb) from anon;
grant execute on function public.receber_pedido(uuid, date, jsonb) to authenticated;


-- ============================================================
-- 4. public.reabrir_recebimento_pedido -- CREATE OR REPLACE: desfaz
--    tambem a entrada automatica de Sacos Fechados e o snapshot
--    quantidade_sacos_recebidos, com protecao contra saldo negativo
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
  -- Novas (0051) -- desfazimento seguro da entrada automatica de Sacos.
  v_snapshot_sacos       jsonb;
  v_sacos_row            public.sacos_fechados_movimentacoes%rowtype;
  v_saldo_outros         integer;
begin
  -- 1) sessao autenticada + permissao -- portao explicito de aplicacao
  --    (redundante com o gate estrutural das triggers, defesa em
  --    profundidade, mesmo padrao das demais RPCs deste modulo).
  if auth.uid() is null then
    raise exception 'reabrir_recebimento_pedido: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('pedidos.reabrir_recebimento')) then
    raise exception using errcode = '42501',
      message = 'reabrir_recebimento_pedido: requer a permissao pedidos.reabrir_recebimento.';
  end if;

  -- 2) localiza e BLOQUEIA o pedido -- mesma razao de receber_pedido/
  --    excluir_pedido: impede duas reaberturas concorrentes do mesmo
  --    pedido, ou uma reabertura concorrente com qualquer outra
  --    transicao. Uma segunda chamada so prossegue apos a primeira
  --    commitar (ou reverter) -- e ai encontra status<>recebido e falha
  --    no proximo passo, nunca reprocessando o mesmo pedido.
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

  select array_agg(id) into v_ids_itens
  from public.pedido_itens
  where pedido_id = p_pedido_id;

  -- 3) SNAPSHOT completo -- ANTES de qualquer exclusao/limpeza (secao 3
  --    do cabecalho da 0027: pedido, itens com os dados efetivos ainda
  --    presentes -- INCLUINDO quantidade_sacos_recebidos, capturado
  --    automaticamente por to_jsonb(pi.*) sem nenhuma mudanca de codigo
  --    -- os proprios registros de historico que serao removidos, e
  --    (0051) as movimentacoes de Sacos Fechados que serao removidas).
  select jsonb_agg(to_jsonb(pi.*)) into v_snapshot_itens
  from public.pedido_itens pi
  where pi.pedido_id = p_pedido_id;

  select jsonb_agg(to_jsonb(phc.*)) into v_snapshot_historicos
  from public.produtos_historico_compras phc
  where phc.pedido_item_id = any(v_ids_itens)
    and phc.origem = 'recebimento_pedido';

  select jsonb_agg(to_jsonb(sfm.*)) into v_snapshot_sacos
  from public.sacos_fechados_movimentacoes sfm
  where sfm.pedido_item_id = any(v_ids_itens)
    and sfm.origem = 'recebimento_pedido';

  insert into public.logs_auditoria (entidade, registro_id, acao, valor_anterior)
  values (
    'pedido',
    p_pedido_id::text,
    'pedido_recebimento_reaberto',
    jsonb_build_object(
      'pedido', to_jsonb(v_pedido.*),
      'itens', coalesce(v_snapshot_itens, '[]'::jsonb),
      'historicos_removidos', coalesce(v_snapshot_historicos, '[]'::jsonb),
      'sacos_removidos', coalesce(v_snapshot_sacos, '[]'::jsonb),
      'usuario', auth.uid(),
      'reaberto_em', now()
    )::text
  );

  -- 4) exclui SOMENTE historico origem=recebimento_pedido vinculado a
  --    itens DESTE pedido -- ver secao 2 do cabecalho da 0027 para a
  --    prova de que isso nunca atinge historico manual nem de outro
  --    pedido.
  delete from public.produtos_historico_compras
  where pedido_item_id = any(v_ids_itens)
    and origem = 'recebimento_pedido';

  -- 4b) NOVO (0051) -- desfaz atomicamente a entrada automatica de Sacos
  --     Fechados vinculada a cada item deste pedido, MAS SOMENTE quando
  --     isso nao deixar o saldo de sacos negativo (ex.: alguem ja abriu
  --     um saco depois deste recebimento) -- exatamente o mesmo
  --     raciocinio/formula ja usado por excluir_movimentacao_saco (0050).
  --     Se qualquer uma bloquear, a REABERTURA INTEIRA e abortada (a
  --     transacao inteira desfaz, inclusive o DELETE de historico acima e
  --     o INSERT de auditoria) -- nunca deixa metade reaberta. O filtro
  --     origem='recebimento_pedido' garante estruturalmente (CHECK
  --     sacos_fechados_movimentacoes_tipo_origem_coerente_check, 0042)
  --     que NENHUM movimento manual do usuario (abertura/ajuste_manual/
  --     saldo_inicial, todos com origem diferente) e tocado aqui.
  for v_sacos_row in
    select * from public.sacos_fechados_movimentacoes
    where pedido_item_id = any(v_ids_itens)
      and origem = 'recebimento_pedido'
    order by criado_em
  loop
    -- Trava a CONFIGURACAO (FOR UPDATE) -- mesma ordem de lock das
    -- demais RPCs de Sacos, evita deadlock.
    perform 1 from public.produto_fornecedores
    where id = v_sacos_row.produto_fornecedor_id
    for update;

    v_saldo_outros := (
      select coalesce(sum(quantidade_sacos), 0)
      from public.sacos_fechados_movimentacoes
      where produto_fornecedor_id = v_sacos_row.produto_fornecedor_id
        and id <> v_sacos_row.id
    );

    if v_saldo_outros < 0 then
      raise exception 'reabrir_recebimento_pedido: nao e possivel desfazer a entrada automatica de Sacos Fechados do item % -- sacos ja foram consumidos (abertos) depois deste recebimento, e desfazer deixaria o saldo negativo (% sacos). Ajuste as movimentacoes manuais de Sacos Fechados (ex.: exclua ou edite a abertura correspondente) antes de reabrir este recebimento.',
        v_sacos_row.pedido_item_id, v_saldo_outros;
    end if;

    delete from public.estoque_movimentacoes
    where origem = 'sacos_fechados_recebimento_pedido'
      and origem_id = v_sacos_row.id;

    delete from public.sacos_fechados_movimentacoes
    where id = v_sacos_row.id;
  end loop;

  -- 5) limpa os campos de recebimento -- roda ENQUANTO o pedido ainda e
  --    recebido (a transicao de status so acontece no passo 6);
  --    pedido_itens_protecao (0051, ver secao 2 desta migration) permite
  --    esta UPDATE especifica e SO esta -- INCLUINDO agora
  --    quantidade_sacos_recebidos junto dos demais 3 campos.
  update public.pedido_itens
  set unidade_recebida = null,
      quantidade_recebida = null,
      valor_unitario_recebido = null,
      quantidade_sacos_recebidos = null
  where pedido_id = p_pedido_id;

  -- 6) transicao formal -- pedidos_protecao (0027, intocada) libera esta
  --    UPDATE especifica, forca recebido_em=null.
  update public.pedidos
  set status = 'aguardando_entrega'
  where id = p_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

comment on function public.reabrir_recebimento_pedido(uuid) is
  'Desfaz atomicamente o recebimento de um pedido: grava snapshot completo (pedido+itens, incluindo quantidade_sacos_recebidos+historicos removidos+sacos removidos) em logs_auditoria, exclui de produtos_historico_compras todo registro origem=recebimento_pedido vinculado a itens deste pedido, desfaz atomicamente qualquer entrada automatica de sacos_fechados_movimentacoes/estoque_movimentacoes vinculada (origem=recebimento_pedido) -- abortando a reabertura INTEIRA se isso deixaria o saldo de sacos negativo (mesma formula de excluir_movimentacao_saco, 0050), nunca toca movimento manual --, limpa unidade_recebida/quantidade_recebida/valor_unitario_recebido/quantidade_sacos_recebidos (0051) em pedido_itens, e transiciona pedidos.status de recebido para aguardando_entrega. Exige sessao autenticada + pedidos.reabrir_recebimento. Bloqueia a linha do pedido (FOR UPDATE) e cada configuracao comercial de Sacos envolvida (FOR UPDATE, mesma ordem de lock das demais RPCs de Sacos). SECURITY DEFINER: necessario tanto para a escrita quanto para satisfazer o gate rolbypassrls das triggers pedidos_protecao/pedido_itens_protecao. Qualquer falha em qualquer etapa desfaz a transacao inteira. Pedidos legados (sem dados detalhados/historico/sacos) sao suportados sem nenhuma logica especial.';

-- NAO revoga de service_role -- mesma decisao/justificativa do bloco
-- equivalente de receber_pedido acima (grant legado desde a 0027,
-- fora de escopo desta frente).
revoke execute on function public.reabrir_recebimento_pedido(uuid) from public;
revoke execute on function public.reabrir_recebimento_pedido(uuid) from anon;
grant execute on function public.reabrir_recebimento_pedido(uuid) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO: qualquer recebimento/reabertura ja realizado APOS esta
-- migration ser aplicada (e antes do rollback) ja gravou/removeu dados
-- reais de Sacos Fechados -- este rollback restaura o CODIGO das tres
-- funcoes para o estado exato de 0022/0026/0027 (sem a integracao com
-- Sacos, sem a coluna nova), mas NAO desfaz nenhum efeito de dados ja
-- ocorrido. Remover a coluna quantidade_sacos_recebidos APAGA qualquer
-- snapshot ja gravado nela.
-- BEGIN;
--
--   create or replace function public.receber_pedido(
--     p_pedido_id        uuid,
--     p_data_recebimento date,
--     p_itens            jsonb
--   )
--   returns public.pedidos
--   language plpgsql
--   security definer
--   set search_path = ''
--   as $$
--   declare
--     v_pedido                     public.pedidos%rowtype;
--     v_ids_reais                  uuid[];
--     v_ids_payload                 uuid[];
--     v_item                        jsonb;
--     v_item_id                     uuid;
--     v_unidade_recebida            text;
--     v_quantidade_recebida         numeric;
--     v_valor_unitario_recebido     numeric;
--     v_fator_texto                 text;
--     v_fator                       numeric;
--     v_fator_final                 numeric;
--     v_produto_id                  uuid;
--     v_produto_fornecedor_informado uuid;
--     v_config_id                   uuid;
--     v_config_unidade              text;
--     v_config_fator                numeric;
--     v_qtd_configs                 integer;
--     v_hoje_sp                     date;
--   begin
--     if auth.uid() is null then
--       raise exception 'receber_pedido: requer sessao autenticada.';
--     end if;
--     if not (select public.has_permissao('pedidos.receber')) then
--       raise exception using errcode = '42501',
--         message = 'receber_pedido: requer a permissao pedidos.receber.';
--     end if;
--     if p_data_recebimento is null then
--       raise exception 'receber_pedido: data do recebimento e obrigatoria.';
--     end if;
--     v_hoje_sp := (now() at time zone 'America/Sao_Paulo')::date;
--     if p_data_recebimento > v_hoje_sp then
--       raise exception 'receber_pedido: data do recebimento (%) nao pode ser no futuro (hoje em America/Sao_Paulo: %).',
--         p_data_recebimento, v_hoje_sp;
--     end if;
--     select * into v_pedido from public.pedidos where id = p_pedido_id for update;
--     if v_pedido.id is null then
--       raise exception 'receber_pedido: pedido % nao encontrado.', p_pedido_id;
--     end if;
--     if v_pedido.status <> 'aguardando_entrega' then
--       raise exception 'receber_pedido: pedido % tem status=%, somente pedidos aguardando_entrega podem ser recebidos.',
--         p_pedido_id, v_pedido.status;
--     end if;
--     if p_data_recebimento < v_pedido.data_pedido then
--       raise exception 'receber_pedido: data do recebimento (%) nao pode ser anterior a data do pedido (%).',
--         p_data_recebimento, v_pedido.data_pedido;
--     end if;
--     if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
--       raise exception 'receber_pedido: e obrigatorio informar os itens recebidos.';
--     end if;
--     select array_agg(id) into v_ids_reais from public.pedido_itens where pedido_id = p_pedido_id;
--     v_ids_payload := array[]::uuid[];
--     for v_item in select * from jsonb_array_elements(p_itens) loop
--       if jsonb_typeof(v_item) <> 'object' then
--         raise exception 'receber_pedido: cada item deve ser um objeto JSON, recebido: %', v_item;
--       end if;
--       begin
--         v_item_id := nullif(btrim(coalesce(v_item->>'pedido_item_id', '')), '')::uuid;
--       exception when invalid_text_representation then
--         raise exception 'receber_pedido: pedido_item_id invalido (nao e um UUID) no item: %', v_item;
--       end;
--       if v_item_id is null then
--         raise exception 'receber_pedido: pedido_item_id e obrigatorio em cada item: %', v_item;
--       end if;
--       v_ids_payload := v_ids_payload || v_item_id;
--       if coalesce(btrim(v_item->>'unidade_recebida'), '') = '' then
--         raise exception 'receber_pedido: item % sem unidade_recebida valida.', v_item_id;
--       end if;
--       begin
--         v_quantidade_recebida := (v_item->>'quantidade_recebida')::numeric;
--       exception when invalid_text_representation then
--         raise exception 'receber_pedido: quantidade_recebida invalida (nao numerica) no item %.', v_item_id;
--       end;
--       if v_quantidade_recebida is null or v_quantidade_recebida <= 0 then
--         raise exception 'receber_pedido: quantidade_recebida deve ser maior que zero no item %.', v_item_id;
--       end if;
--       begin
--         v_valor_unitario_recebido := (v_item->>'valor_unitario_recebido')::numeric;
--       exception when invalid_text_representation then
--         raise exception 'receber_pedido: valor_unitario_recebido invalido (nao numerico) no item %.', v_item_id;
--       end;
--       if v_valor_unitario_recebido is null or v_valor_unitario_recebido < 0 then
--         raise exception 'receber_pedido: valor_unitario_recebido invalido no item % (obrigatorio, pode ser 0 -- bonificacao/cortesia -- mas nunca negativo).', v_item_id;
--       end if;
--       v_fator_texto := nullif(btrim(coalesce(v_item->>'fator_conversao_base', '')), '');
--       if v_fator_texto is not null then
--         begin
--           v_fator := v_fator_texto::numeric;
--         exception when invalid_text_representation then
--           raise exception 'receber_pedido: fator_conversao_base invalido (nao numerico) no item %.', v_item_id;
--         end;
--         if v_fator <= 0 then
--           raise exception 'receber_pedido: fator_conversao_base deve ser maior que zero no item %.', v_item_id;
--         end if;
--       end if;
--       if nullif(btrim(coalesce(v_item->>'produto_fornecedor_id', '')), '') is not null then
--         begin
--           perform nullif(btrim(v_item->>'produto_fornecedor_id'), '')::uuid;
--         exception when invalid_text_representation then
--           raise exception 'receber_pedido: produto_fornecedor_id invalido (nao e um UUID) no item %.', v_item_id;
--         end;
--       end if;
--     end loop;
--     if array_length(v_ids_payload, 1) is distinct from array_length(v_ids_reais, 1) then
--       raise exception 'receber_pedido: numero de itens informados (%) nao bate com o numero de itens do pedido (%).',
--         coalesce(array_length(v_ids_payload, 1), 0), coalesce(array_length(v_ids_reais, 1), 0);
--     end if;
--     if (select count(distinct x) from unnest(v_ids_payload) as x) <> array_length(v_ids_payload, 1) then
--       raise exception 'receber_pedido: ha item duplicado no payload.';
--     end if;
--     if exists (select 1 from unnest(v_ids_payload) as pid where pid <> all(v_ids_reais)) then
--       raise exception 'receber_pedido: ha item no payload que nao pertence a este pedido.';
--     end if;
--     for v_item in select * from jsonb_array_elements(p_itens) loop
--       v_item_id := (v_item->>'pedido_item_id')::uuid;
--       v_unidade_recebida := btrim(v_item->>'unidade_recebida');
--       v_quantidade_recebida := (v_item->>'quantidade_recebida')::numeric;
--       v_valor_unitario_recebido := (v_item->>'valor_unitario_recebido')::numeric;
--       v_fator_texto := nullif(btrim(coalesce(v_item->>'fator_conversao_base', '')), '');
--       v_fator := v_fator_texto::numeric;
--       v_produto_fornecedor_informado := nullif(btrim(coalesce(v_item->>'produto_fornecedor_id', '')), '')::uuid;
--       update public.pedido_itens
--       set unidade_recebida = v_unidade_recebida,
--           quantidade_recebida = v_quantidade_recebida,
--           valor_unitario_recebido = v_valor_unitario_recebido
--       where id = v_item_id and pedido_id = p_pedido_id
--       returning produto_id into v_produto_id;
--       if v_produto_id is null then
--         continue;
--       end if;
--       v_config_id := null;
--       v_fator_final := v_fator;
--       if v_produto_fornecedor_informado is not null then
--         select id, unidade_comercial, quantidade_embalagem
--           into v_config_id, v_config_unidade, v_config_fator
--         from public.produto_fornecedores
--         where id = v_produto_fornecedor_informado
--           and produto_id = v_produto_id
--           and fornecedor_id = v_pedido.fornecedor_id;
--         if v_config_id is null then
--           raise exception 'receber_pedido: produto_fornecedor_id informado no item % nao corresponde a uma configuracao valida para este produto/fornecedor.', v_item_id;
--         end if;
--         if lower(btrim(v_config_unidade)) <> lower(btrim(v_unidade_recebida)) then
--           raise exception 'receber_pedido: unidade informada (%) nao bate com a configuracao comercial selecionada (%) no item %.',
--             v_unidade_recebida, v_config_unidade, v_item_id;
--         end if;
--         if v_config_fator is not null then
--           if v_fator is not null and v_fator <> v_config_fator then
--             raise exception 'receber_pedido: fator_conversao_base informado (%) nao bate com a configuracao comercial cadastrada (%) no item %.',
--               v_fator, v_config_fator, v_item_id;
--           end if;
--           v_fator_final := v_config_fator;
--         end if;
--       else
--         select count(*) into v_qtd_configs
--         from public.produto_fornecedores
--         where produto_id = v_produto_id
--           and fornecedor_id = v_pedido.fornecedor_id
--           and ativo = true
--           and lower(btrim(unidade_comercial)) = lower(btrim(v_unidade_recebida));
--         if v_qtd_configs = 1 then
--           select id, quantidade_embalagem into v_config_id, v_config_fator
--           from public.produto_fornecedores
--           where produto_id = v_produto_id
--             and fornecedor_id = v_pedido.fornecedor_id
--             and ativo = true
--             and lower(btrim(unidade_comercial)) = lower(btrim(v_unidade_recebida));
--           if v_config_fator is not null then
--             if v_fator is not null and v_fator <> v_config_fator then
--               raise exception 'receber_pedido: fator_conversao_base informado (%) nao bate com a configuracao comercial cadastrada (%) no item %.',
--                 v_fator, v_config_fator, v_item_id;
--             end if;
--             v_fator_final := v_config_fator;
--           end if;
--         end if;
--       end if;
--       insert into public.produtos_historico_compras (
--         produto_id, fornecedor_id, unidade_comercial, quantidade_comercial,
--         preco_unitario_comercial, fator_conversao_base, data_compra, origem,
--         pedido_item_id, produto_fornecedor_id
--       ) values (
--         v_produto_id, v_pedido.fornecedor_id, v_unidade_recebida, v_quantidade_recebida,
--         v_valor_unitario_recebido, v_fator_final, p_data_recebimento, 'recebimento_pedido',
--         v_item_id, v_config_id
--       );
--     end loop;
--     update public.pedidos set status = 'recebido' where id = p_pedido_id returning * into v_pedido;
--     return v_pedido;
--   end;
--   $$;
--   revoke execute on function public.receber_pedido(uuid, date, jsonb) from public;
--   revoke execute on function public.receber_pedido(uuid, date, jsonb) from anon;
--   grant execute on function public.receber_pedido(uuid, date, jsonb) to authenticated;
--
--   create or replace function public.reabrir_recebimento_pedido(p_pedido_id uuid)
--   returns public.pedidos
--   language plpgsql
--   security definer
--   set search_path = ''
--   as $$
--   declare
--     v_pedido               public.pedidos%rowtype;
--     v_ids_itens            uuid[];
--     v_snapshot_itens       jsonb;
--     v_snapshot_historicos  jsonb;
--   begin
--     if auth.uid() is null then
--       raise exception 'reabrir_recebimento_pedido: requer sessao autenticada.';
--     end if;
--     if not (select public.has_permissao('pedidos.reabrir_recebimento')) then
--       raise exception using errcode = '42501',
--         message = 'reabrir_recebimento_pedido: requer a permissao pedidos.reabrir_recebimento.';
--     end if;
--     select * into v_pedido from public.pedidos where id = p_pedido_id for update;
--     if v_pedido.id is null then
--       raise exception 'reabrir_recebimento_pedido: pedido % nao encontrado.', p_pedido_id;
--     end if;
--     if v_pedido.status <> 'recebido' then
--       raise exception 'reabrir_recebimento_pedido: pedido % tem status=%, somente pedidos recebidos podem ter o recebimento reaberto.',
--         p_pedido_id, v_pedido.status;
--     end if;
--     select array_agg(id) into v_ids_itens from public.pedido_itens where pedido_id = p_pedido_id;
--     select jsonb_agg(to_jsonb(pi.*)) into v_snapshot_itens from public.pedido_itens pi where pi.pedido_id = p_pedido_id;
--     select jsonb_agg(to_jsonb(phc.*)) into v_snapshot_historicos from public.produtos_historico_compras phc where phc.pedido_item_id = any(v_ids_itens) and phc.origem = 'recebimento_pedido';
--     insert into public.logs_auditoria (entidade, registro_id, acao, valor_anterior)
--     values ('pedido', p_pedido_id::text, 'pedido_recebimento_reaberto',
--       jsonb_build_object('pedido', to_jsonb(v_pedido.*), 'itens', coalesce(v_snapshot_itens, '[]'::jsonb), 'historicos_removidos', coalesce(v_snapshot_historicos, '[]'::jsonb), 'usuario', auth.uid(), 'reaberto_em', now())::text);
--     delete from public.produtos_historico_compras where pedido_item_id = any(v_ids_itens) and origem = 'recebimento_pedido';
--     update public.pedido_itens set unidade_recebida = null, quantidade_recebida = null, valor_unitario_recebido = null where pedido_id = p_pedido_id;
--     update public.pedidos set status = 'aguardando_entrega' where id = p_pedido_id returning * into v_pedido;
--     return v_pedido;
--   end;
--   $$;
--   revoke execute on function public.reabrir_recebimento_pedido(uuid) from public;
--   revoke execute on function public.reabrir_recebimento_pedido(uuid) from anon;
--   grant execute on function public.reabrir_recebimento_pedido(uuid) to authenticated;
--
--   -- Restaura pedido_itens_protecao para o corpo da 0022/0027 (sem a
--   -- coluna nova na janela de reabertura).
--   create or replace function public.pedido_itens_protecao()
--   returns trigger
--   language plpgsql
--   security definer
--   set search_path = ''
--   as $$
--   declare
--     v_status text;
--   begin
--     if tg_op = 'INSERT' then
--       new.criado_em := now();
--       new.atualizado_em := now();
--       select status into v_status from public.pedidos where id = new.pedido_id;
--       if v_status is distinct from 'aguardando_entrega' then
--         raise exception 'pedido_itens: nao e possivel inserir item em pedido com status=%.', coalesce(v_status, 'inexistente');
--       end if;
--       return new;
--     elsif tg_op = 'UPDATE' then
--       if new.pedido_id is distinct from old.pedido_id then
--         raise exception 'pedido_itens: pedido_id e imutavel -- um item nao pode ser movido entre pedidos.';
--       end if;
--       if new.criado_em is distinct from old.criado_em then
--         raise exception 'pedido_itens: criado_em e imutavel.';
--       end if;
--       new.atualizado_em := now();
--       select status into v_status from public.pedidos where id = old.pedido_id;
--       if v_status = 'recebido' then
--         if not coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) then
--           raise exception 'pedido_itens: nao e possivel alterar item de pedido com status=%.', v_status;
--         end if;
--         if not (select public.has_permissao('pedidos.reabrir_recebimento')) then
--           raise exception 'pedido_itens: nao e possivel alterar item de pedido com status=%.', v_status;
--         end if;
--         if new.produto_id is distinct from old.produto_id
--           or new.descricao is distinct from old.descricao
--           or new.quantidade_pedida is distinct from old.quantidade_pedida
--           or new.unidade is distinct from old.unidade
--           or new.valor_unitario is distinct from old.valor_unitario
--           or new.observacao is distinct from old.observacao then
--           raise exception 'pedido_itens: reabertura de recebimento so pode limpar os campos de recebimento.';
--         end if;
--         if new.unidade_recebida is not null or new.quantidade_recebida is not null or new.valor_unitario_recebido is not null then
--           raise exception 'pedido_itens: reabertura de recebimento deve limpar os campos de recebimento (definir como NULL).';
--         end if;
--         return new;
--       end if;
--       if v_status is distinct from 'aguardando_entrega' then
--         raise exception 'pedido_itens: nao e possivel alterar item de pedido com status=%.', coalesce(v_status, 'inexistente');
--       end if;
--       return new;
--     elsif tg_op = 'DELETE' then
--       select status into v_status from public.pedidos where id = old.pedido_id;
--       if v_status is distinct from 'aguardando_entrega' then
--         raise exception 'pedido_itens: nao e possivel remover item de pedido com status=%.', coalesce(v_status, 'inexistente');
--       end if;
--       return old;
--     end if;
--     return null;
--   end;
--   $$;
--   revoke execute on function public.pedido_itens_protecao() from public;
--
--   alter table public.pedido_itens
--     drop constraint if exists pedido_itens_quantidade_sacos_recebidos_positiva_check;
--   alter table public.pedido_itens
--     drop column if exists quantidade_sacos_recebidos; -- ATENCAO: apaga qualquer snapshot ja gravado
--
-- COMMIT;
