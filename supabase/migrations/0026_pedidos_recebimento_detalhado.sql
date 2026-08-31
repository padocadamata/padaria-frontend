-- 0026_pedidos_recebimento_detalhado.sql
-- Recebimento detalhado de pedidos: ao confirmar o recebimento, o
-- operador informa os dados EFETIVOS de cada item (unidade, quantidade,
-- preco unitario realmente pagos) -- em vez de so marcar o pedido como
-- recebido sem registrar nada. Tudo dentro de /pedidos, sem pagina/aba
-- nova. Gera automaticamente historico de compra real no Catalogo
-- (produtos_historico_compras, origem='recebimento_pedido') para cada
-- item que tenha produto_id.
--
-- 2a VERSAO -- revisao tecnica consolidada apos a 1a rodada de auditoria.
-- Mudancas em relacao a 1a versao, resumidas (detalhes em cada secao):
--   * NOVO: validacao do fator informado contra produto_fornecedores
--     quando existir configuracao determinavel (secao 1), com coluna
--     nova produto_fornecedor_id no historico guardando QUAL config foi
--     usada;
--   * NOVO: p_data_recebimento nao pode ser anterior a data_pedido nem
--     posterior a hoje em America/Sao_Paulo (secao 8, itens 3-4 do RPC);
--   * confirmado (sem mudanca de codigo): valor_unitario_recebido=0
--     continua permitido (bonificacao/cortesia); interacao com
--     pedidos_protecao verificada linha a linha contra o codigo real da
--     trigger (nao presumida); concorrencia/atomicidade reconfirmadas.
--
-- RASCUNHO EM AUDITORIA -- NAO COPIAR PARA supabase/migrations/ NEM
-- EXECUTAR ate autorizacao explicita, e ate a pre-auditoria real
-- confirmar as premissas abaixo. Gerado em scratchpad para revisao
-- estatica, SHA-256 e classificacao de risco.
--
-- Pre-requisitos: 0001..0025 ja aplicadas. Numeracao confirmada livre:
-- 0025 e a ultima migration em origin/main no momento em que este
-- arquivo foi gerado, nenhuma 0026 publicada ainda.
--
-- ============================================================
-- DECISOES DE MODELAGEM:
-- ============================================================
--
-- 1) QUANTIDADE vs PESO -- uma unica coluna decimal + unidade, NAO duas
--    colunas separadas. "1,842 kg" e simplesmente
--    quantidade_recebida=1.842, unidade_recebida='KG' -- mesmo padrao ja
--    usado em produtos_historico_compras (quantidade_comercial +
--    unidade_comercial, migration 0023).
--
-- 2) VALOR TOTAL -- DERIVADO (coluna GENERATED), NAO armazenado
--    separadamente. valor_total_recebido = round(quantidade_recebida *
--    valor_unitario_recebido, 2), mesmo padrao ja aprovado para
--    preco_unitario_base (0023). PRECISAO/OVERFLOW revisados: quantidade
--    numeric(12,3) x valor_unitario numeric(12,4) alimentando um total
--    numeric(12,2) -- mesmo em cenarios de estresse deliberadamente
--    exagerados para uma padaria (ex.: 100.000 unidades a R$10.000,00
--    cada = R$1.000.000.000,00), o total fica bem dentro do limite de
--    numeric(12,2) (ate R$9.999.999.999,99). So combinacoes proximas dos
--    MAXIMOS simultaneos das duas colunas de origem estourariam --
--    cenario nao realista, e mesmo assim o Postgres rejeitaria com um
--    erro limpo de overflow (numeric_field_overflow), nunca com
--    truncamento silencioso. numeric(12,2) mantido por consistencia com
--    a familia numeric(12,x) ja usada em todo o projeto para este tipo
--    de valor.
--
--    valor_unitario_recebido = 0 CONTINUA PERMITIDO (bonificacao/
--    cortesia) -- o CHECK existente (>= 0, nao > 0) ja cobre isso, sem
--    necessidade de alteracao.
--
-- 3) SNAPSHOT DE UNIDADE-BASE -- produtos_historico_compras ganha
--    unidade_base_no_momento, preenchida automaticamente (nunca pelo
--    cliente) a partir de produtos.unidade_medida NO INSTANTE do
--    INSERT. Registro final por linha, semanticamente autossuficiente,
--    fica com: produto_id, fornecedor_id, data_compra, unidade_comercial,
--    quantidade_comercial, preco_unitario_comercial,
--    fator_conversao_base (o FATOR EFETIVAMENTE UTILIZADO, ja resolvido/
--    validado -- ver secao 1 abaixo), unidade_base_no_momento,
--    preco_unitario_base (GENERATED a partir do fator snapshot),
--    origem, pedido_item_id, produto_fornecedor_id (config utilizada,
--    quando houver). Uma mudanca futura em produtos.unidade_medida ou em
--    produto_fornecedores.quantidade_embalagem NUNCA reinterpreta uma
--    linha ja gravada -- todos os valores relevantes sao capturados por
--    linha, no momento do INSERT, nunca recalculados na leitura.
--
-- 4) PRODUTO x FORNECEDOR -- REGRA DETERMINISTICA (revisada nesta
--    versao) para evitar fator incompativel informado silenciosamente:
--
--    (a) payload do item pode INFORMAR produto_fornecedor_id
--        explicitamente (quando o operador escolheu uma configuracao
--        especifica no frontend, fase futura). Se informado: precisa
--        corresponder a uma linha REAL de produto_fornecedores para o
--        MESMO produto_id do item e o MESMO fornecedor_id do pedido
--        (senao, erro); a unidade_recebida informada precisa bater
--        (case/espaco-insensivel) com produto_fornecedores.unidade_comercial
--        dessa config (senao, erro); se a config tiver
--        quantidade_embalagem (fator) conhecido, o fator_conversao_base
--        informado (se houver) TEM que bater exatamente com ele (senao,
--        erro) -- e se nao informado, e preenchido automaticamente a
--        partir da config.
--
--    (b) se produto_fornecedor_id NAO for informado, a RPC tenta
--        resolver AUTOMATICAMENTE por (produto_id, fornecedor_id,
--        unidade_comercial=unidade_recebida, ativo=true) -- MAS SOMENTE
--        quando existe EXATAMENTE UMA configuracao compativel. Se
--        existirem VARIAS configuracoes ativas com a mesma unidade
--        comercial para o mesmo produto/fornecedor (legitimo desde a
--        0023 -- ex. duas apresentacoes diferentes com a mesma unidade),
--        a resolucao automatica e AMBIGUA -- tratada exatamente como
--        "sem configuracao determinavel" (nao adivinha qual das duas).
--
--    (c) sem configuracao determinavel (0 ou >1 candidatas, ou produto
--        sem NENHUMA configuracao cadastrada para aquele fornecedor):
--        o fator_conversao_base informado pelo operador (podendo ser
--        NULL) e aceito SEM validacao contra nada -- mesmo modelo de
--        confianca ja usado no lancamento manual de historico
--        (LancarCompraForm.js). NUNCA inventa nem sobrescreve
--        produto_fornecedores -- essa tabela nunca e escrita por esta
--        RPC, so lida.
--
--    Em QUALQUER caso (a/b/c), o historico grava o snapshot
--    EFETIVAMENTE UTILIZADO: fator_conversao_base = o fator resolvido
--    (da config OU do payload, conforme o caso acima), e
--    produto_fornecedor_id = a config usada (ou NULL quando nao houve).
--
--    SEMANTICA CONFIRMADA (sem mudanca -- ja era este o desenho):
--    fator_conversao_base = quantas unidades-base equivalem a 1 unidade
--    comercial. Produto base UN, recebido em CX com 12 unidades -> fator
--    = 12. Produto base KG, recebido em KG -> fator = 1.
--    preco_unitario_base = preco_unitario_comercial / fator_conversao_base
--    (formula intocada, coluna GENERATED existente desde a 0023).
--    Produto cadastrado em UN recebido em KG SEM nenhuma configuracao
--    comercial conhecida para essa combinacao: cai no caso (c) -- fator
--    fica o que o operador informar manualmente (ou NULL, se
--    desconhecido) -- NUNCA um fator arbitrario inventado pela RPC.
--
-- 5) VINCULO COM O PEDIDO -- produtos_historico_compras ganha
--    pedido_item_id (nullable, FK ON DELETE RESTRICT -- mesmo padrao de
--    produto_id/fornecedor_id nesta MESMA tabela, ja que e identidade
--    central do registro) e produto_fornecedor_id (nullable, FK ON
--    DELETE SET NULL -- mesmo padrao ja usado para criado_por nestas
--    tabelas: e so uma referencia de RASTREABILIDADE de qual config foi
--    usada, os valores efetivos ja estao todos capturados como colunas
--    proprias na mesma linha, entao perder o vinculo nao perde nenhum
--    dado real -- e o que permite excluir_produto_fornecedor continuar
--    utilizavel mesmo para configs ja usadas historicamente).
--    Indice unico parcial em pedido_item_id garante, no proprio banco,
--    que um pedido_item nunca gera mais de UM registro de historico.
--
-- 6) ATOMICIDADE -- RPC UNICA (receber_pedido), SECURITY DEFINER.
--    Justificativa (mesmo raciocinio de excluir_pedido, 0025): a policy
--    de INSERT de produtos_historico_compras exige origem='manual' no
--    WITH CHECK -- estruturalmente IMPOSSIVEL para qualquer
--    authenticated inserir origem='recebimento_pedido' via RLS normal.
--    A policy de UPDATE de pedido_itens exige pedidos.editar, nao
--    pedidos.receber. Nenhuma combinacao de policies normais cobre esta
--    operacao com SOMENTE pedidos.receber -- so SECURITY DEFINER com
--    checagem explicita propria permite.
--
-- 7) marcar_pedido_recebido (0022) -- NAO TOCADA nesta migration.
--    ESTRATEGIA DE TRANSICAO (revisada, avaliadas 3 opcoes):
--      A) manter a antiga temporariamente, remover/revogar so numa
--         migration FUTURA (0027), aplicada DEPOIS do frontend novo
--         estar publicado -- ESCOLHIDA;
--      B) "adaptar" a antiga para nao completar recebimento incompleto
--         sem quebrar o frontend atual -- CONTRADITORIO na pratica: a
--         assinatura atual (so p_pedido_id, sem nenhum dado de item) nao
--         tem NENHUM dado de item para validar -- qualquer mudanca de
--         comportamento que a torne "mais rigorosa" ou falha
--         incondicionalmente (quebra o frontend publicado agora, antes
--         do novo estar no ar) ou nao muda nada de fato (equivalente a
--         nao fazer nada, ou seja, igual a opcao A durante a janela de
--         transicao). Descartada por nao oferecer ganho real sobre A sem
--         violar a restricao explicita de nao quebrar producao;
--      C) nenhuma alternativa adicional identificada que resolva a
--         contradicao entre "nao quebrar o botao atual" e "invalidar o
--         caminho antigo" na MESMA migration -- as duas exigencias so
--         sao conciliaveis com um intervalo de tempo real entre elas,
--         que e exatamente o que a opcao A propoe.
--    MONITORAMENTO GRATUITO (nenhum codigo extra necessario): um pedido
--    recebido pelo caminho ANTIGO fica trivialmente identificavel --
--    status='recebido' com TODOS os pedido_itens.quantidade_recebida
--    ainda NULL (so receber_pedido() preenche essas colunas). Query
--    sugerida para decidir quando aplicar 0027 com seguranca:
--      select p.id, p.recebido_em from public.pedidos p
--      where p.status = 'recebido'
--        and not exists (
--          select 1 from public.pedido_itens pi
--          where pi.pedido_id = p.id and pi.quantidade_recebida is not null
--        )
--        and p.recebido_em > '<data do deploy do novo frontend>';
--    Zero linhas depois do deploy = seguro aplicar 0027. 0027 NAO e
--    criada nesta migration -- fica para quando essa condicao for
--    confirmada.
--
-- 8) DATA DO RECEBIMENTO -- p_data_recebimento obrigatoria e explicita
--    (nunca current_date/now() do servidor). Validacoes acrescentadas
--    nesta versao: (i) nao pode ser anterior a pedidos.data_pedido; (ii)
--    nao pode ser POSTERIOR a hoje em America/Sao_Paulo -- calculado
--    como (now() at time zone 'America/Sao_Paulo')::date, NUNCA
--    current_date puro (que reflete o fuso da SESSAO, UTC por padrao no
--    Supabase -- o mesmo cuidado ja documentado em toda a migration
--    0022 para data_pedido). Alimenta SOMENTE
--    produtos_historico_compras.data_compra -- NAO altera
--    pedidos.recebido_em (continua now(), forcado pela trigger
--    pedidos_protecao, intocada).
--
-- 9) INTERACAO COM pedidos_protecao -- VERIFICADA LINHA A LINHA contra o
--    codigo real da trigger (migration 0022), nao presumida:
--      * has_permissao('pedidos.receber') dentro da trigger roda com
--        base em auth.uid() da sessao real -- NAO e afetado por
--        receber_pedido() ser SECURITY DEFINER (SECURITY DEFINER muda o
--        papel usado para AVALIAR RLS/privilegios de tabela, nao o que
--        auth.uid() retorna, que reflete sempre o JWT da chamada real).
--        Ou seja: a checagem da trigger e REDUNDANTE, nao conflitante,
--        com a checagem explicita desta RPC -- defesa em profundidade,
--        mesmo padrao ja usado em excluir_producao_registro (0020).
--      * o UPDATE desta RPC (`update pedidos set status = 'recebido'
--        where id = ...`) altera SOMENTE a coluna status -- todas as
--        outras colunas (fornecedor_id, data_pedido, previsao_entrega,
--        observacoes, cancelado_em, motivo_cancelamento) permanecem
--        implicitamente iguais a OLD por nao estarem no SET, satisfazendo
--        automaticamente a checagem da trigger "recebimento deve alterar
--        somente status/recebido_em" -- exatamente o mesmo UPDATE que
--        marcar_pedido_recebido() ja faz hoje, com sucesso, em producao.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   * public.pedido_itens: 4 colunas novas (unidade_recebida,
--     quantidade_recebida, valor_unitario_recebido,
--     valor_total_recebido GENERATED) + 4 constraints de coerencia/valor;
--   * public.produtos_historico_compras: 3 colunas novas
--     (pedido_item_id, produto_fornecedor_id, unidade_base_no_momento) +
--     2 FKs + indice unico parcial + CHECK de coerencia origem/vinculo;
--   * public.produtos_historico_compras_protecao(): CREATE OR REPLACE
--     -- forca unidade_base_no_momento no INSERT, bloqueia
--     pedido_item_id/produto_fornecedor_id/unidade_base_no_momento no
--     UPDATE;
--   * public.receber_pedido(uuid, date, jsonb) -- NOVA, SECURITY
--     DEFINER.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em marcar_pedido_recebido, cancelar_pedido,
--     criar_pedido, excluir_pedido, pedidos_protecao,
--     pedido_itens_protecao, pedido_itens_impedir_pedido_vazio,
--     produto_fornecedores_protecao;
--   * nenhuma policy de DELETE/INSERT nova em pedidos/pedido_itens;
--   * nenhuma alteracao em produto_fornecedores (schema ou dados) --
--     lida, nunca escrita, por esta RPC;
--   * nenhuma alteracao em produtos_resumo_compras (view ja agnostica
--     de origem);
--   * nenhum backfill das colunas novas para linhas ja existentes;
--   * nenhuma migration 0027 (fica para depois do deploy do frontend,
--     ver secao 7 acima);
--   * nenhuma comparacao pedido x recebido, divergencia, falta/sobra,
--     devolucao, XML/NFC-e, Cotacoes, nova pagina/aba;
--   * nenhuma alteracao de frontend.

BEGIN;

-- ============================================================
-- 1. public.pedido_itens -- colunas de recebimento efetivo
-- ============================================================
-- Ficam NULL ate o pedido ser recebido -- so sao preenchidas, uma unica
-- vez, dentro de receber_pedido() (secao 4). Depois disso, a trigger
-- pedido_itens_protecao (0022, INTOCADA) ja bloqueia QUALQUER UPDATE em
-- pedido_itens assim que o pedido deixa de ser aguardando_entrega --
-- essas colunas ficam automaticamente imutaveis pelo mecanismo ja
-- existente, sem precisar de nenhum codigo novo de protecao.
alter table public.pedido_itens
  add column if not exists unidade_recebida text,
  add column if not exists quantidade_recebida numeric(12,3),
  add column if not exists valor_unitario_recebido numeric(12,4),
  add column if not exists valor_total_recebido numeric(12,2)
    generated always as (round(quantidade_recebida * valor_unitario_recebido, 2)) stored;

comment on column public.pedido_itens.unidade_recebida is
  'Unidade efetiva da compra (ex.: UN, CX, KG) -- preenchida uma unica vez por receber_pedido(). NULL ate o pedido ser recebido.';
comment on column public.pedido_itens.quantidade_recebida is
  'Quantidade efetivamente comprada, na unidade_recebida (ex.: 1.842 quando unidade_recebida=KG representa 1,842kg -- sem coluna de peso separada, o significado vem da unidade).';
comment on column public.pedido_itens.valor_unitario_recebido is
  'Preco unitario efetivamente pago, na unidade_recebida. Pode ser 0 (bonificacao/cortesia) -- nunca negativo.';
comment on column public.pedido_itens.valor_total_recebido is
  'SEMPRE derivado (GENERATED ALWAYS AS, STORED) -- round(quantidade_recebida * valor_unitario_recebido, 2). Nunca informado pelo cliente, estruturalmente impossivel de divergir dos dois campos que o originam.';

do $$
begin
  alter table public.pedido_itens
    add constraint pedido_itens_recebimento_coerente_check
    check (
      (unidade_recebida is null and quantidade_recebida is null and valor_unitario_recebido is null)
      or (unidade_recebida is not null and quantidade_recebida is not null and valor_unitario_recebido is not null)
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.pedido_itens
    add constraint pedido_itens_unidade_recebida_nao_vazia_check
    check (unidade_recebida is null or btrim(unidade_recebida) <> '');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.pedido_itens
    add constraint pedido_itens_quantidade_recebida_positiva_check
    check (quantidade_recebida is null or quantidade_recebida > 0);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.pedido_itens
    add constraint pedido_itens_valor_unitario_recebido_nao_negativo_check
    check (valor_unitario_recebido is null or valor_unitario_recebido >= 0);
exception
  when duplicate_object then null;
end $$;


-- ============================================================
-- 2. public.produtos_historico_compras -- vinculo com pedido_itens,
--    vinculo opcional com produto_fornecedores, snapshot de unidade-base
-- ============================================================
alter table public.produtos_historico_compras
  add column if not exists pedido_item_id uuid,
  add column if not exists produto_fornecedor_id uuid,
  add column if not exists unidade_base_no_momento text;

comment on column public.produtos_historico_compras.pedido_item_id is
  'Vinculo com o item de pedido que originou este registro, SOMENTE para origem=recebimento_pedido (NULL para origem=manual, garantido pela check produtos_historico_compras_origem_pedido_item_coerente_check). ON DELETE RESTRICT -- mesmo padrao de produto_id/fornecedor_id nesta tabela: identidade central do registro.';
comment on column public.produtos_historico_compras.produto_fornecedor_id is
  'Configuracao comercial (produto_fornecedores) efetivamente usada para resolver/validar o fator_conversao_base deste recebimento, quando havia uma determinavel (ver receber_pedido()). NULL quando nao havia configuracao aplicavel -- nao impede o registro. ON DELETE SET NULL -- so rastreabilidade: os valores efetivos ja estao capturados nas colunas proprias desta linha, perder o vinculo nao perde nenhum dado real, e mantem excluir_produto_fornecedor() utilizavel mesmo para configs ja usadas historicamente.';
comment on column public.produtos_historico_compras.unidade_base_no_momento is
  'Snapshot de produtos.unidade_medida no INSTANTE deste INSERT -- preenchido automaticamente pela trigger, nunca pelo cliente, nunca recalculado depois. Torna preco_unitario_base semanticamente estavel mesmo que o cadastro do produto mude de unidade-base no futuro. NULL para registros anteriores a esta migration (sem backfill retroativo).';

do $$
begin
  alter table public.produtos_historico_compras
    add constraint produtos_historico_compras_pedido_item_id_fkey
    foreign key (pedido_item_id) references public.pedido_itens(id) on delete restrict;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.produtos_historico_compras
    add constraint produtos_historico_compras_produto_fornecedor_id_fkey
    foreign key (produto_fornecedor_id) references public.produto_fornecedores(id) on delete set null;
exception
  when duplicate_object then null;
end $$;

-- Garantia estrutural (nao so "a RPC so roda uma vez"): um pedido_item
-- nunca pode gerar mais de UM registro de historico, em nenhuma
-- circunstancia, mesmo hipotetica.
create unique index if not exists produtos_historico_compras_pedido_item_id_unico_idx
  on public.produtos_historico_compras (pedido_item_id)
  where pedido_item_id is not null;

do $$
begin
  alter table public.produtos_historico_compras
    add constraint produtos_historico_compras_origem_pedido_item_coerente_check
    check (
      (origem = 'manual' and pedido_item_id is null)
      or (origem = 'recebimento_pedido' and pedido_item_id is not null)
    );
exception
  when duplicate_object then null;
end $$;


-- ============================================================
-- 3. public.produtos_historico_compras_protecao() -- CREATE OR REPLACE:
--    forca unidade_base_no_momento no INSERT; bloqueia
--    pedido_item_id/produto_fornecedor_id/unidade_base_no_momento no
--    UPDATE
-- ============================================================
-- SECURITY INVOKER preservado (sem mudanca de modelo de seguranca) --
-- ler produtos.unidade_medida nao exige privilegio elevado: a policy de
-- SELECT de produtos e liberal para qualquer authenticated desde a
-- 0005b, entao o chamador desta trigger sempre consegue ler essa coluna.
create or replace function public.produtos_historico_compras_protecao()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.atualizado_em := now();
    -- Snapshot automatico -- nunca vem do cliente, mesmo se enviado no
    -- payload do INSERT (sobrescrito incondicionalmente).
    new.unidade_base_no_momento := (select unidade_medida from public.produtos where id = new.produto_id);
    return new;

  elsif tg_op = 'UPDATE' then
    if new.produto_id is distinct from old.produto_id then
      raise exception 'produtos_historico_compras: produto_id e imutavel.';
    end if;
    if new.fornecedor_id is distinct from old.fornecedor_id then
      raise exception 'produtos_historico_compras: fornecedor_id e imutavel.';
    end if;
    if new.origem is distinct from old.origem then
      raise exception 'produtos_historico_compras: origem e imutavel -- nao e possivel transformar um lancamento manual em recebimento_pedido, nem o contrario.';
    end if;
    if new.pedido_item_id is distinct from old.pedido_item_id then
      raise exception 'produtos_historico_compras: pedido_item_id e imutavel.';
    end if;
    if new.produto_fornecedor_id is distinct from old.produto_fornecedor_id then
      raise exception 'produtos_historico_compras: produto_fornecedor_id e imutavel.';
    end if;
    if new.unidade_base_no_momento is distinct from old.unidade_base_no_momento then
      raise exception 'produtos_historico_compras: unidade_base_no_momento e imutavel (snapshot fixado no momento do INSERT).';
    end if;
    if new.criado_por is distinct from old.criado_por then
      raise exception 'produtos_historico_compras: criado_por e imutavel.';
    end if;
    if new.criado_em is distinct from old.criado_em then
      raise exception 'produtos_historico_compras: criado_em e imutavel.';
    end if;

    if old.origem <> 'manual' then
      raise exception 'produtos_historico_compras: registro de origem=% nao pode ser editado pelo Catalogo.', old.origem;
    end if;

    new.atualizado_em := now();
    return new;
  end if;

  return null;
end;
$$;

comment on function public.produtos_historico_compras_protecao() is
  'BEFORE INSERT/UPDATE em produtos_historico_compras. INSERT: forca criado_por/criado_em/atualizado_em/unidade_base_no_momento (snapshot de produtos.unidade_medida no instante do INSERT, nunca do cliente). UPDATE: bloqueia produto_id/fornecedor_id/origem/pedido_item_id/produto_fornecedor_id/unidade_base_no_momento/criado_por/criado_em imutaveis, bloqueia qualquer UPDATE quando a linha ja nao e origem=manual, forca atualizado_em.';

-- Trigger em si (nome, evento, timing) NAO muda -- so o CORPO da funcao.


-- ============================================================
-- 4. RPC receber_pedido -- confirmacao atomica de recebimento detalhado
-- ============================================================
-- SECURITY DEFINER -- justificativa completa na secao 6 do cabecalho.
-- RISCO DOCUMENTADO (mesmo aviso ja registrado para criar_pedido/
-- excluir_pedido): se esta funcao tiver seu OWNER alterado para um
-- papel sem BYPASSRLS e sem ser dono das tabelas envolvidas, toda
-- chamada passa a falhar por violacao de RLS, sem nenhuma mudanca de
-- codigo visivel.
--
-- p_itens: array JSON, um objeto por item DO PEDIDO -- {pedido_item_id,
-- unidade_recebida, quantidade_recebida, valor_unitario_recebido,
-- fator_conversao_base (opcional), produto_fornecedor_id (opcional)}.
-- Validacao estrutural em 1a passada (casts protegidos, mesmo padrao de
-- criar_pedido), cobertura exata contra os itens reais do pedido em
-- seguida (bijecao completa: mesma contagem + sem duplicidade + todos
-- pertencentes a este pedido); so entao a 2a passada resolve
-- produto_fornecedores e escreve. A resolucao de produto_fornecedores
-- fica DENTRO da 2a passada (nao numa 3a passada separada) -- decisao
-- deliberada: como toda a funcao ja roda dentro de UMA transacao, um
-- erro levantado no meio da 2a passada desfaz TUDO que ja tinha sido
-- escrito antes dele automaticamente (semantica de transacao do
-- Postgres) -- nao ha necessidade de uma passada extra so para
--"escrever depois de validar tudo", que so faria sentido para evitar
-- efeitos colaterais fora da transacao (nao e o caso aqui).
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
  --    cabecalho) e escreve. Cada UPDATE de pedido_itens roda enquanto
  --    o pedido AINDA esta aguardando_entrega (status so muda no passo
  --    6) -- pedido_itens_protecao (0022, intocada) permite normalmente.
  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_item_id := (v_item->>'pedido_item_id')::uuid;
    v_unidade_recebida := btrim(v_item->>'unidade_recebida');
    v_quantidade_recebida := (v_item->>'quantidade_recebida')::numeric;
    v_valor_unitario_recebido := (v_item->>'valor_unitario_recebido')::numeric;
    v_fator_texto := nullif(btrim(coalesce(v_item->>'fator_conversao_base', '')), '');
    v_fator := v_fator_texto::numeric; -- ja validado na 1a passada
    v_produto_fornecedor_informado := nullif(btrim(coalesce(v_item->>'produto_fornecedor_id', '')), '')::uuid;

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
    -- Nao bloqueia o recebimento do pedido.
    if v_produto_id is null then
      continue;
    end if;

    -- Resolucao da configuracao comercial -- ver secao 4 do cabecalho
    -- para a regra completa.
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
      -- contra nada (secao 4(c) do cabecalho).
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
  end loop;

  -- 6) transicao formal -- reaproveita EXATAMENTE o mesmo caminho de
  --    marcar_pedido_recebido: so UPDATE status. recebido_em, a
  --    checagem de pedidos.receber (redundante com o passo 1, defesa em
  --    profundidade -- ver secao 9 do cabecalho) e o log em
  --    logs_auditoria continuam sendo responsabilidade EXCLUSIVA da
  --    trigger pedidos_protecao (0022, intocada).
  update public.pedidos
  set status = 'recebido'
  where id = p_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

comment on function public.receber_pedido(uuid, date, jsonb) is
  'Confirma o recebimento de um pedido com dados EFETIVOS por item -- substitui, para o fluxo detalhado, o simples marcar_pedido_recebido (0022, que continua existindo sem alteracao ate uma migration futura pos-deploy do frontend, ver cabecalho desta migration). Exige sessao autenticada + pedidos.receber. Valida data do recebimento (nao anterior a data_pedido, nao posterior a hoje em America/Sao_Paulo). Bloqueia a linha do pedido (FOR UPDATE). Exige TODOS os itens do pedido no payload, exatamente uma vez cada. Para cada item com produto_id, resolve a configuracao comercial aplicavel em produto_fornecedores (explicita via produto_fornecedor_id, ou automatica quando inequivoca), valida que o fator informado nao contradiz uma configuracao existente, e cria um registro em produtos_historico_compras (origem=recebimento_pedido, vinculado via pedido_item_id, protegido por indice unico parcial). SECURITY DEFINER: necessario porque nenhuma combinacao de policies normais autoriza este fluxo so com pedidos.receber. Qualquer falha em qualquer etapa desfaz a transacao inteira.';

revoke execute on function public.receber_pedido(uuid, date, jsonb) from public;
revoke execute on function public.receber_pedido(uuid, date, jsonb) from anon;
grant execute on function public.receber_pedido(uuid, date, jsonb) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO -- NAO REVERSIVEL EM UM PONTO: recebimentos ja confirmados via
-- receber_pedido() antes do rollback NAO tem seus dados restaurados a
-- "nao recebido" -- pedidos.status='recebido' e imutavel por design, e
-- os registros de produtos_historico_compras origem=recebimento_pedido
-- ja criados nao sao apagados por este rollback.
-- BEGIN;
--
--   revoke execute on function public.receber_pedido(uuid, date, jsonb) from authenticated;
--   drop function if exists public.receber_pedido(uuid, date, jsonb);
--
--   -- Restaura o corpo ORIGINAL de produtos_historico_compras_protecao
--   -- (migration 0023, sem unidade_base_no_momento/pedido_item_id/
--   -- produto_fornecedor_id).
--   create or replace function public.produtos_historico_compras_protecao()
--   returns trigger
--   language plpgsql
--   security invoker
--   set search_path = ''
--   as $$
--   begin
--     if tg_op = 'INSERT' then
--       new.criado_por := auth.uid();
--       new.criado_em := now();
--       new.atualizado_em := now();
--       return new;
--     elsif tg_op = 'UPDATE' then
--       if new.produto_id is distinct from old.produto_id then
--         raise exception 'produtos_historico_compras: produto_id e imutavel.';
--       end if;
--       if new.fornecedor_id is distinct from old.fornecedor_id then
--         raise exception 'produtos_historico_compras: fornecedor_id e imutavel.';
--       end if;
--       if new.origem is distinct from old.origem then
--         raise exception 'produtos_historico_compras: origem e imutavel.';
--       end if;
--       if new.criado_por is distinct from old.criado_por then
--         raise exception 'produtos_historico_compras: criado_por e imutavel.';
--       end if;
--       if new.criado_em is distinct from old.criado_em then
--         raise exception 'produtos_historico_compras: criado_em e imutavel.';
--       end if;
--       if old.origem <> 'manual' then
--         raise exception 'produtos_historico_compras: registro de origem=% nao pode ser editado pelo Catalogo.', old.origem;
--       end if;
--       new.atualizado_em := now();
--       return new;
--     end if;
--     return null;
--   end;
--   $$;
--
--   alter table public.produtos_historico_compras
--     drop constraint if exists produtos_historico_compras_origem_pedido_item_coerente_check;
--   drop index if exists produtos_historico_compras_pedido_item_id_unico_idx;
--   alter table public.produtos_historico_compras
--     drop constraint if exists produtos_historico_compras_produto_fornecedor_id_fkey;
--   alter table public.produtos_historico_compras
--     drop constraint if exists produtos_historico_compras_pedido_item_id_fkey;
--   alter table public.produtos_historico_compras
--     drop column if exists unidade_base_no_momento; -- ATENCAO: apaga snapshot ja gravado
--   alter table public.produtos_historico_compras
--     drop column if exists produto_fornecedor_id; -- ATENCAO: apaga vinculo ja gravado
--   alter table public.produtos_historico_compras
--     drop column if exists pedido_item_id; -- ATENCAO: apaga vinculo ja gravado
--
--   alter table public.pedido_itens
--     drop constraint if exists pedido_itens_valor_unitario_recebido_nao_negativo_check;
--   alter table public.pedido_itens
--     drop constraint if exists pedido_itens_quantidade_recebida_positiva_check;
--   alter table public.pedido_itens
--     drop constraint if exists pedido_itens_unidade_recebida_nao_vazia_check;
--   alter table public.pedido_itens
--     drop constraint if exists pedido_itens_recebimento_coerente_check;
--   alter table public.pedido_itens
--     drop column if exists valor_total_recebido;
--   alter table public.pedido_itens
--     drop column if exists valor_unitario_recebido; -- ATENCAO: apaga dados ja gravados
--   alter table public.pedido_itens
--     drop column if exists quantidade_recebida; -- ATENCAO: apaga dados ja gravados
--   alter table public.pedido_itens
--     drop column if exists unidade_recebida; -- ATENCAO: apaga dados ja gravados
--
-- COMMIT;
