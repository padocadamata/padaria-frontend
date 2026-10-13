-- 0073_contas_pagar.sql
-- FINANCEIRO > CONTAS A PAGAR: obrigacoes de compra (integradas a
-- Pedidos/Compras) e despesas manuais, com parcelas, baixas (pagamentos)
-- com juros/multa/desconto explicitos, estorno e cancelamento logicos.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor,
-- depois de conferir a pre-auditoria. Pre-requisitos: 0001..0072.
--
-- ============================================================
-- DECISOES DE ARQUITETURA (resumo -- detalhes junto de cada objeto)
-- ============================================================
-- * Namespace proprio contas_pagar* / contas_pagar.*. As tabelas LEGADAS
--   public.pagamentos e public.nfes (existentes no banco real, fora do
--   historico de migrations) NAO sao lidas, alteradas nem reaproveitadas
--   (mesma decisao registrada na 0065).
-- * Cabecalho (contas_pagar) + parcelas (contas_pagar_parcelas) + baixas
--   (contas_pagar_baixas) + categorias de despesa (contas_pagar_categorias).
-- * UMA fonte de verdade para "paga": a existencia de uma baixa ATIVA
--   (estornado_em IS NULL) -- garantida por indice unico parcial. A parcela
--   NAO tem coluna de status. "Vencida" e derivada (sem baixa ativa e
--   vencimento < hoje em America/Sao_Paulo). Cancelamento e estado
--   explicito, mas so do CABECALHO (contas_pagar.status). A situacao da
--   conta (pendente/parcial/paga/cancelada) e derivada na leitura.
-- * Conta de origem COMPRA nao copia fornecedor nem total: ambos vem do
--   pedido. A regra "soma das parcelas = soma de valor_total_recebido da
--   compra, compra recebida" e verificada no fim de cada transacao por
--   constraint triggers DEFERRED em pedidos, pedido_itens, contas_pagar e
--   contas_pagar_parcelas -- vale para qualquer caminho de escrita, atual
--   ou futuro, sem depender de cada RPC lembrar de checar.
-- * Escrita SOMENTE por RPCs SECURITY DEFINER (search_path vazio,
--   autorizacao dentro de cada uma, auditoria na mesma transacao). As
--   tabelas nao tem policy de escrita e perdem INSERT/UPDATE/DELETE de
--   anon/authenticated. Triggers de imutabilidade bloqueiam DELETE fisico
--   e qualquer alteracao fora das transicoes permitidas.
-- * Leitura: tabelas contas_pagar* pela RLS (contas_pagar.visualizar);
--   dados de compra/fornecedor por 4 funcoes SECURITY DEFINER de leitura
--   (contas_pagar_listar_*), NAO por views -- security_invoker nao serve
--   (o Financeiro nao le pedidos/fornecedores pela RLS) e liberar essas
--   tabelas seria acesso amplo. Ver secao 14.
-- * Data de corte da implantacao: contas_pagar_config.implantado_em =
--   now() DO MOMENTO EM QUE ESTA MIGRATION RODA (nenhuma data escrita a
--   mao). So compras com pedidos.recebido_em >= implantado_em entram na
--   fila automatica "Compras sem lancamento". recebido_em e o mesmo relogio
--   (now() do servidor, gravado pela trigger pedidos_protecao), entao a
--   comparacao nao depende de fuso.
-- * pedidos.data_recebimento (date, NOVA): data EFETIVA do recebimento,
--   gravada por receber_pedido() (redefinida nesta migration -- secao 12,
--   unica mudanca: preencher a coluna com p_data_recebimento). Sem
--   backfill (recebimentos antigos ficam NULL). Compra presencial usa
--   data_pedido, que ja e a data da compra por definicao (0037).
--
-- ============================================================
-- INVENTARIO -- funcoes que escrevem em public.pedidos/pedido_itens
-- (exigido pelo cabecalho da 0027 a cada nova funcao elevada)
-- ============================================================
--   criar_pedido (0040, DEFINER) INSERT; marcar_pedido_recebido e
--   cancelar_pedido (0022, INVOKER) UPDATE de status; excluir_pedido
--   (0025, DEFINER) DELETE so aguardando_entrega; excluir_pedido_com_
--   solicitacoes (0045, DEFINER) chama excluir_pedido; receber_pedido
--   (0051, DEFINER -> redefinida aqui, mesma transicao aguardando->recebido
--   + data_recebimento); reabrir_recebimento_pedido (0052, DEFINER)
--   recebido->aguardando (redefinida aqui: guarda de compra presencial +
--   janela de reabertura); registrar_compra_presencial e
--   editar_compra_presencial (0037, DEFINER; redefinida aqui: janela de
--   correcao); concluir_solicitacao_com_
--   pedido (0043) NAO escreve em pedidos.
--   NOVAS desta migration: receber_pedido_com_financeiro e
--   registrar_compra_presencial_com_financeiro apenas CHAMAM receber_pedido
--   / registrar_compra_presencial (nenhum UPDATE/INSERT/DELETE proprio em
--   pedidos/pedido_itens) -- nao alcancam nenhum ramo de excecao novo das
--   triggers da 0027/0037. Nenhuma outra funcao desta migration escreve
--   em pedidos/pedido_itens.
--
-- ============================================================
-- CORRECOES EM PEDIDOS (secao 12b) -- arqueologia
-- ============================================================
--   (1) editar_compra_presencial quebrada: a 0037 acrescentou a
--       pedido_itens_protecao() tres ramos "CORRECAO DE COMPRA PRESENCIAL"
--       (INSERT/UPDATE/DELETE de item com pedido-pai recebido +
--       compra_presencial). A 0051 recriou a funcao a partir do corpo da
--       0022/0027 (para proteger quantidade_sacos_recebidos na reabertura)
--       e esses ramos sumiram; depois da 0072 o corpo vigente e o da 0051.
--       editar_compra_presencial() (que sempre regrava os itens) falha.
--   (2) gate de reabertura sem efeito: a 0027 criou a reabertura com o
--       gate rolbypassrls(current_user) + pedidos.reabrir_recebimento nos
--       ramos de pedidos_protecao (SECURITY INVOKER -- funciona) e de
--       pedido_itens_protecao (SECURITY DEFINER desde a 0022 -- current_
--       user e sempre o dono, com BYPASSRLS: o teste e sempre verdadeiro).
--       A 0037 e a 0051 mantiveram o gate. Efeito: quem tem pedidos.editar
--       (RLS) + pedidos.reabrir_recebimento limpa pela API os campos
--       recebidos de itens de qualquer pedido recebido, sem reabrir.
--   (3) compra presencial reabrivel: a 0037 pos em reabrir_recebimento_
--       pedido() a guarda "nao aplicavel a compra presencial -- use
--       editar_compra_presencial()". A 0051 recriou a RPC (Sacos) a partir
--       do corpo da 0027 sem essa guarda; a 0052 (vigente) herdou.
--   Correcao: corpos vigentes (0051 / 0037 / 0052) + o minimo -- janelas
--   transacionais por pedido (set_config LOCAL) abertas so pelas RPCs
--   legitimas, gate rolbypassrls removido de pedido_itens_protecao,
--   verificacao deferida de coerencia da reabertura e guarda de compra
--   presencial restaurada. Guardas na secao 0: md5 normalizado dos corpos
--   vigentes de receber_pedido, pedido_itens_protecao, editar_compra_
--   presencial e reabrir_recebimento_pedido; se divergirem, aborta sem
--   criar nada.
--
-- Protecoes da compra com financeiro ATIVO:
--   * total incompativel (editar presencial, reabertura que limpa valores,
--     qualquer escrita futura) -> constraint trigger deferred;
--   * troca de fornecedor -> bloqueada (trigger BEFORE UPDATE em pedidos);
--   * reabrir recebimento / qualquer saida de status=recebido -> bloqueada;
--   * excluir pedido com qualquer historico financeiro -> bloqueado;
--     cancelar pedido so existe a partir de aguardando_entrega, estado que
--     nunca tem financeiro ativo; FK ON DELETE RESTRICT como defesa extra.

BEGIN;

-- ============================================================
-- 0. Guarda de ambiente -- aborta sem criar nada se o banco nao for o
--    esperado (objetos, colunas, corpo atual de receber_pedido).
-- ============================================================
DO $$
declare
  v_src text;
begin
  if to_regprocedure('public.has_permissao(text)') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regclass('public.logs_auditoria') is null
     or to_regclass('public.usuarios') is null
     or to_regclass('public.fornecedores') is null
     or to_regclass('public.pedidos') is null
     or to_regclass('public.pedido_itens') is null
     or to_regclass('public.permissoes') is null
     or to_regclass('public.perfil_permissoes') is null
     or to_regclass('public.perfis') is null then
    raise exception '0073 abortada: objetos base (has_permissao/is_admin/logs_auditoria/usuarios/fornecedores/pedidos/pedido_itens/permissoes/perfis) nao encontrados.';
  end if;

  if to_regprocedure('public.receber_pedido(uuid,date,jsonb)') is null
     or to_regprocedure('public.registrar_compra_presencial(uuid,date,text,date,text,jsonb)') is null
     or to_regprocedure('public.reabrir_recebimento_pedido(uuid)') is null then
    raise exception '0073 abortada: RPCs de Pedidos (receber_pedido/registrar_compra_presencial/reabrir_recebimento_pedido) nao encontradas.';
  end if;

  if (select count(*) from pg_attribute
       where attrelid = 'public.pedidos'::regclass and attnum > 0 and not attisdropped
         and attname in ('id', 'fornecedor_id', 'data_pedido', 'status', 'recebido_em', 'modalidade_compra', 'numero_nota_fiscal')) <> 7
     or (select count(*) from pg_attribute
       where attrelid = 'public.pedido_itens'::regclass and attnum > 0 and not attisdropped
         and attname in ('pedido_id', 'valor_total_recebido')) <> 2
     or (select count(*) from pg_attribute
       where attrelid = 'public.fornecedores'::regclass and attnum > 0 and not attisdropped
         and attname in ('id', 'nome', 'nome_fantasia', 'razao_social', 'ativo')) <> 5 then
    raise exception '0073 abortada: colunas esperadas ausentes em pedidos/pedido_itens/fornecedores.';
  end if;

  if exists (select 1 from pg_attribute
       where attrelid = 'public.pedidos'::regclass and attname = 'data_recebimento' and not attisdropped) then
    raise exception '0073 abortada: pedidos.data_recebimento ja existe -- migration ja parece aplicada.';
  end if;

  if to_regclass('public.contas_pagar') is not null
     or to_regclass('public.contas_pagar_parcelas') is not null
     or to_regclass('public.contas_pagar_baixas') is not null
     or to_regclass('public.contas_pagar_categorias') is not null
     or to_regclass('public.contas_pagar_config') is not null
     or exists (select 1 from public.permissoes where codigo like 'contas_pagar.%') then
    raise exception '0073 abortada: objetos contas_pagar* ja existem -- migration ja parece aplicada.';
  end if;

  if not exists (select 1 from pg_trigger
       where tgrelid = 'public.logs_auditoria'::regclass
         and tgname = 'logs_auditoria_preencher_usuario_trigger' and not tgisinternal)
     or not exists (select 1 from pg_trigger
       where tgrelid = 'public.pedidos'::regclass
         and tgname = 'pedidos_protecao_trigger' and not tgisinternal) then
    raise exception '0073 abortada: triggers logs_auditoria_preencher_usuario_trigger (0004) / pedidos_protecao_trigger (0022) ausentes.';
  end if;

  -- receber_pedido e REDEFINIDA na secao 12 a partir do texto exato da
  -- 0051. Se o corpo no banco nao for o da 0051 (ex.: correcao manual
  -- feita fora do repositorio), aborta em vez de sobrescrever.
  select p.prosrc into v_src
    from pg_proc p
   where p.oid = 'public.receber_pedido(uuid,date,jsonb)'::regprocedure;
  -- Comparacao com espacos/quebras de linha normalizados (CRLF x LF do
  -- arquivo nao muda o resultado).
  if md5(btrim(regexp_replace(v_src, '[[:space:]]+', ' ', 'g'))) <> '54cac7fbf0554ebfd23ef8e8473d2ab8' then
    raise exception '0073 abortada: corpo atual de receber_pedido difere do publicado na 0051 (md5 normalizado %).', md5(btrim(regexp_replace(v_src, '[[:space:]]+', ' ', 'g')));
  end if;

  -- pedido_itens_protecao e editar_compra_presencial sao REDEFINIDAS na
  -- secao 12b a partir dos textos da 0051 e da 0037 -- mesma guarda.
  select p.prosrc into v_src
    from pg_proc p
   where p.oid = 'public.pedido_itens_protecao()'::regprocedure;
  if md5(btrim(regexp_replace(coalesce(v_src, ''), '[[:space:]]+', ' ', 'g'))) <> 'dc971ac26c6519ab570c4e95d02b629b' then
    raise exception '0073 abortada: corpo atual de pedido_itens_protecao difere do publicado na 0051 (md5 normalizado %).', md5(btrim(regexp_replace(coalesce(v_src, ''), '[[:space:]]+', ' ', 'g')));
  end if;
  if not exists (select 1 from pg_trigger
       where tgrelid = 'public.pedido_itens'::regclass and tgname = 'pedido_itens_protecao_trigger'
         and tgfoid = 'public.pedido_itens_protecao()'::regprocedure and not tgisinternal) then
    raise exception '0073 abortada: pedido_itens_protecao_trigger ausente ou ligada a outra funcao.';
  end if;

  select p.prosrc into v_src
    from pg_proc p
   where p.oid = to_regprocedure('public.editar_compra_presencial(uuid,uuid,date,text,date,text,jsonb)');
  if md5(btrim(regexp_replace(coalesce(v_src, ''), '[[:space:]]+', ' ', 'g'))) <> '2c0a0aa716f84eda4a13bdaa5f104c4a' then
    raise exception '0073 abortada: corpo atual de editar_compra_presencial difere do publicado na 0037 (md5 normalizado %).', md5(btrim(regexp_replace(coalesce(v_src, ''), '[[:space:]]+', ' ', 'g')));
  end if;

  select p.prosrc into v_src
    from pg_proc p
   where p.oid = 'public.reabrir_recebimento_pedido(uuid)'::regprocedure;
  if md5(btrim(regexp_replace(coalesce(v_src, ''), '[[:space:]]+', ' ', 'g'))) <> '3bb14b2380452030c76c545e3767d53f' then
    raise exception '0073 abortada: corpo atual de reabrir_recebimento_pedido difere do publicado na 0052 (md5 normalizado %).', md5(btrim(regexp_replace(coalesce(v_src, ''), '[[:space:]]+', ' ', 'g')));
  end if;

  if to_regprocedure('public.pedido_itens_correcao_presencial_autorizada(uuid)') is not null
     or to_regprocedure('public.pedido_itens_reabertura_autorizada(uuid)') is not null
     or to_regprocedure('public.pedido_itens_reabertura_coerente()') is not null then
    raise exception '0073 abortada: funcoes de janela de Pedidos (0073) ja existem -- migration ja parece aplicada.';
  end if;

  if not exists (select 1 from public.perfis where nome = 'proprietario_admin') then
    raise exception '0073 abortada: perfil proprietario_admin nao encontrado.';
  end if;
end $$;

-- ============================================================
-- 1. pedidos.data_recebimento -- data EFETIVA do recebimento.
-- ============================================================
alter table public.pedidos add column data_recebimento date;

comment on column public.pedidos.data_recebimento is
  'Migration 0073. Data EFETIVA do recebimento informada no recebimento detalhado (receber_pedido, p_data_recebimento) -- recebido_em continua sendo o instante tecnico da operacao. NULL em: pedidos nao recebidos, recebimentos anteriores a 0073 (sem backfill -- nenhuma data inventada), recebimentos pelo caminho legado marcar_pedido_recebido e compras presenciais (para estas a data da compra e data_pedido, por definicao da 0037). Limpa automaticamente na reabertura do recebimento. Nunca editavel diretamente.';

-- ============================================================
-- 2. Helpers internos (sem EXECUTE para nenhum papel de API).
-- ============================================================
create or replace function public.contas_pagar_hoje()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

comment on function public.contas_pagar_hoje() is
  'Migration 0073 (interna). Data de hoje em America/Sao_Paulo -- limite de pagamento (nunca no futuro) e de data de recebimento.';

-- Normalizacao de nomes curtos (politica de MAIUSCULAS do projeto, igual a
-- clientes 0069): trim, espacos colapsados, upper() preservando acentos.
create or replace function public.contas_pagar_normalizar_nome(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(upper(regexp_replace(btrim(coalesce(p_texto, '')), '\s+', ' ', 'g')), '');
$$;

comment on function public.contas_pagar_normalizar_nome(text) is
  'Migration 0073 (interna). upper(trim(colapsa espacos)) -- NULL se vazio. Usada nas RPCs e nos CHECKs de descricao/credor/categoria.';

create or replace function public.contas_pagar_nome_usuario()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.nome from public.usuarios u where u.id = auth.uid();
$$;

comment on function public.contas_pagar_nome_usuario() is
  'Migration 0073 (interna). Snapshot do nome de quem executa (auth.uid()) para as colunas *_por_nome.';

-- Total da obrigacao de uma compra: soma de valor_total_recebido. NULL
-- quando a compra nao tem itens ou algum item nao tem valor recebido
-- (recebimento anterior a 0026 / caminho legado) -- nunca soma parcial.
create or replace function public.contas_pagar_total_compra(p_pedido_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when count(*) = 0 or count(pi.valor_total_recebido) <> count(*) then null
           else sum(pi.valor_total_recebido)
         end
    from public.pedido_itens pi
   where pi.pedido_id = p_pedido_id;
$$;

comment on function public.contas_pagar_total_compra(uuid) is
  'Migration 0073 (interna). Soma de pedido_itens.valor_total_recebido do pedido; NULL se nao houver itens ou se algum item estiver sem valor recebido.';

-- Data efetiva da compra (base de vencimentos e do pagamento no ato).
create or replace function public.contas_pagar_data_compra(p_pedido_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when p.modalidade_compra = 'compra_presencial' then p.data_pedido
           else coalesce(p.data_recebimento, (p.recebido_em at time zone 'America/Sao_Paulo')::date)
         end
    from public.pedidos p
   where p.id = p_pedido_id;
$$;

comment on function public.contas_pagar_data_compra(uuid) is
  'Migration 0073 (interna). Compra presencial: data_pedido (a data da compra). Pedido com entrega: data_recebimento; para recebimentos anteriores a 0073 (sem data efetiva gravada) usa o dia do instante tecnico recebido_em em America/Sao_Paulo -- nunca le o historico de compras do Catalogo.';

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.contas_pagar_hoje()',
    'public.contas_pagar_normalizar_nome(text)',
    'public.contas_pagar_nome_usuario()',
    'public.contas_pagar_total_compra(uuid)',
    'public.contas_pagar_data_compra(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', f);
  end loop;
end $$;

-- ============================================================
-- 3. contas_pagar_config -- data de corte da implantacao (1 linha).
-- ============================================================
create table public.contas_pagar_config (
  id             boolean primary key default true check (id),
  implantado_em  timestamptz not null default now()
);

comment on table public.contas_pagar_config is
  'Migration 0073. Linha unica. implantado_em = now() da transacao que aplicou a 0073 (nenhuma data digitada). Compras com pedidos.recebido_em >= implantado_em entram automaticamente na fila "Compras sem lancamento"; as anteriores ficam fora (podem ser lancadas manualmente a partir do detalhe da compra, se tiverem valores recebidos completos). Imutavel.';

insert into public.contas_pagar_config (id, implantado_em) values (true, now());

-- ============================================================
-- 4. contas_pagar_categorias -- categorias de despesa (manuais).
-- ============================================================
create table public.contas_pagar_categorias (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz,

  constraint contas_pagar_categorias_nome_normalizado
    check (nome = public.contas_pagar_normalizar_nome(nome) and char_length(nome) <= 60)
);

create unique index contas_pagar_categorias_nome_unico on public.contas_pagar_categorias (nome);

comment on table public.contas_pagar_categorias is
  'Migration 0073. Categorias de despesas manuais, nome em MAIUSCULAS (politica do projeto). ativo controla so a oferta para lancamentos NOVOS; uma categoria usada continua valida depois de inativada. Sem DELETE. Escrita so pelas RPCs contas_pagar_salvar_categoria / contas_pagar_definir_categoria_ativa.';

insert into public.contas_pagar_categorias (nome) values
  ('ALUGUEL'),
  ('ENERGIA'),
  ('ÁGUA'),
  ('INTERNET E TELEFONE'),
  ('CONTABILIDADE'),
  ('MANUTENÇÃO'),
  ('IMPOSTOS E TAXAS'),
  ('OUTRAS DESPESAS');

-- ============================================================
-- 5. contas_pagar -- cabecalho da obrigacao.
-- ============================================================
create table public.contas_pagar (
  id                   uuid primary key default gen_random_uuid(),
  origem               text not null check (origem in ('compra', 'manual')),

  -- origem = compra: so o vinculo. Fornecedor, valor e data vem do pedido.
  pedido_id            uuid references public.pedidos(id) on delete restrict,

  -- origem = manual: campos proprios.
  descricao            text,
  categoria_id         uuid references public.contas_pagar_categorias(id) on delete restrict,
  fornecedor_id        uuid references public.fornecedores(id) on delete restrict,
  credor_nome          text,
  competencia          date,

  condicao             text not null check (condicao in ('no_ato', 'a_prazo')),
  forma_prevista       text not null check (forma_prevista in ('boleto', 'pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'transferencia', 'outro')),
  observacao           text check (observacao is null or char_length(observacao) <= 1000),

  status               text not null default 'ativa' check (status in ('ativa', 'cancelada')),
  cancelada_em         timestamptz,
  cancelada_por        uuid references auth.users(id) on delete set null,
  cancelada_por_nome   text,
  motivo_cancelamento  text,

  criado_por           uuid references auth.users(id) on delete set null,
  criado_por_nome      text,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz,

  constraint contas_pagar_origem_coerente check (
    (origem = 'compra' and pedido_id is not null
      and descricao is null and categoria_id is null and fornecedor_id is null
      and credor_nome is null and competencia is null)
    or
    (origem = 'manual' and pedido_id is null
      and descricao is not null and categoria_id is not null and competencia is not null
      and ((fornecedor_id is not null) <> (credor_nome is not null)))
  ),
  constraint contas_pagar_descricao_normalizada check (
    descricao is null or (descricao = public.contas_pagar_normalizar_nome(descricao) and char_length(descricao) <= 120)
  ),
  constraint contas_pagar_credor_normalizado check (
    credor_nome is null or (credor_nome = public.contas_pagar_normalizar_nome(credor_nome) and char_length(credor_nome) <= 120)
  ),
  constraint contas_pagar_competencia_mes check (
    competencia is null or extract(day from competencia) = 1
  ),
  -- Cartao e sempre pago no ato (a fatura e outra camada, futura); boleto
  -- nunca e pago no ato.
  constraint contas_pagar_forma_coerente check (
    (condicao = 'no_ato' and forma_prevista <> 'boleto')
    or (condicao = 'a_prazo' and forma_prevista not in ('cartao_debito', 'cartao_credito'))
  ),
  constraint contas_pagar_cancelamento_coerente check (
    (status = 'ativa' and cancelada_em is null and cancelada_por is null and cancelada_por_nome is null and motivo_cancelamento is null)
    or (status = 'cancelada' and cancelada_em is not null and motivo_cancelamento is not null and btrim(motivo_cancelamento) <> '')
  )
);

create unique index contas_pagar_compra_ativa_unica on public.contas_pagar (pedido_id) where status = 'ativa';
create index contas_pagar_pedido_id_idx on public.contas_pagar (pedido_id);
create index contas_pagar_fornecedor_id_idx on public.contas_pagar (fornecedor_id);
create index contas_pagar_categoria_id_idx on public.contas_pagar (categoria_id);

comment on table public.contas_pagar is
  'Migration 0073. Obrigacao a pagar (cabecalho). origem=compra: vinculo pedido_id, SEM copia de fornecedor/valor (vem do pedido; total = soma das parcelas = soma de valor_total_recebido, verificado no commit). origem=manual: descricao/categoria/credor (fornecedor cadastrado OU credor_nome livre)/competencia proprios. condicao no_ato = nasce com 1 parcela ja paga (nunca aparece em A Pagar). No maximo 1 conta ATIVA por compra. Cancelamento logico (motivo obrigatorio, so sem baixa ativa). Sem DELETE. Escrita so por RPC.';

comment on column public.contas_pagar.competencia is
  'Manual: mes de referencia da despesa (sempre dia 1).';

-- ============================================================
-- 6. contas_pagar_parcelas -- sem coluna de status (ver cabecalho).
-- ============================================================
create table public.contas_pagar_parcelas (
  id             uuid primary key default gen_random_uuid(),
  conta_id       uuid not null references public.contas_pagar(id) on delete restrict,
  numero         smallint not null check (numero between 1 and 60),
  vencimento     date not null,
  valor          numeric(12,2) not null check (valor > 0),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz,

  constraint contas_pagar_parcelas_numero_unico unique (conta_id, numero)
);

create index contas_pagar_parcelas_vencimento_idx on public.contas_pagar_parcelas (vencimento);

comment on table public.contas_pagar_parcelas is
  'Migration 0073. Parcela = numero + vencimento + valor ORIGINAL. Sem coluna de status: paga <=> existe baixa ativa (contas_pagar_baixas, indice unico parcial); vencida = sem baixa ativa e vencimento < hoje (America/Sao_Paulo), derivado; cancelada = cabecalho cancelado. Vencimento/valor so mudam por replanejamento e nunca enquanto a parcela tem baixa ativa. Sem DELETE.';

-- ============================================================
-- 7. contas_pagar_baixas -- pagamento integral de uma parcela.
-- ============================================================
create table public.contas_pagar_baixas (
  id                  uuid primary key default gen_random_uuid(),
  parcela_id          uuid not null references public.contas_pagar_parcelas(id) on delete restrict,

  pago_em             date not null,
  forma_pagamento     text not null check (forma_pagamento in ('boleto', 'pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'transferencia', 'outro')),

  -- Equacao (validada no banco):
  --   valor_pago = valor_original + juros + multa - desconto
  -- valor_original e o valor da parcela no momento do pagamento (conferido
  -- pela trigger); valor_pago e GERADO -- nunca informado nem divergente.
  valor_original      numeric(12,2) not null check (valor_original > 0),
  juros               numeric(12,2) not null default 0 check (juros >= 0),
  multa               numeric(12,2) not null default 0 check (multa >= 0),
  desconto            numeric(12,2) not null default 0 check (desconto >= 0),
  valor_pago          numeric(12,2) generated always as (valor_original + juros + multa - desconto) stored,

  observacao          text check (observacao is null or char_length(observacao) <= 1000),

  registrado_por      uuid references auth.users(id) on delete set null,
  registrado_por_nome text,
  registrado_em       timestamptz not null default now(),

  estornado_em        timestamptz,
  estornado_por       uuid references auth.users(id) on delete set null,
  estornado_por_nome  text,
  motivo_estorno      text,

  constraint contas_pagar_baixas_valor_pago_positivo check (valor_original + juros + multa - desconto > 0),
  constraint contas_pagar_baixas_estorno_coerente check (
    (estornado_em is null and estornado_por is null and estornado_por_nome is null and motivo_estorno is null)
    or (estornado_em is not null and motivo_estorno is not null and btrim(motivo_estorno) <> '')
  )
);

create unique index contas_pagar_baixas_ativa_unica on public.contas_pagar_baixas (parcela_id) where estornado_em is null;
create index contas_pagar_baixas_parcela_id_idx on public.contas_pagar_baixas (parcela_id);
create index contas_pagar_baixas_pago_em_idx on public.contas_pagar_baixas (pago_em);

comment on table public.contas_pagar_baixas is
  'Migration 0073. Baixa (pagamento) de uma parcela -- sempre INTEGRAL (pagamento parcial fora desta versao). valor_pago = valor_original + juros + multa - desconto (coluna gerada). No maximo 1 baixa ATIVA por parcela (indice unico parcial) -- e ela que define "parcela paga". Estorno logico: estornado_em/por/nome + motivo obrigatorio; a baixa estornada permanece no historico e a parcela volta a ficar pendente automaticamente. Sem DELETE.';

-- ============================================================
-- 8. Triggers de protecao / imutabilidade.
-- ============================================================
create or replace function public.contas_pagar_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'contas_pagar: exclusao fisica nao e permitida -- use o cancelamento.';
  end if;

  if tg_op = 'INSERT' then
    new.status := 'ativa';
    new.cancelada_em := null;
    new.cancelada_por := null;
    new.cancelada_por_nome := null;
    new.motivo_cancelamento := null;
    new.criado_por := auth.uid();
    new.criado_por_nome := public.contas_pagar_nome_usuario();
    new.criado_em := now();
    new.atualizado_em := null;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.origem is distinct from old.origem
     or new.pedido_id is distinct from old.pedido_id
     or new.condicao is distinct from old.condicao
     or new.criado_por is distinct from old.criado_por
     or new.criado_por_nome is distinct from old.criado_por_nome
     or new.criado_em is distinct from old.criado_em then
    raise exception 'contas_pagar: origem, vinculo, condicao e autoria sao imutaveis.';
  end if;

  if old.status = 'cancelada' then
    raise exception 'contas_pagar: conta cancelada nao pode ser alterada.';
  end if;

  if new.status = 'cancelada' then
    if new.descricao is distinct from old.descricao
       or new.categoria_id is distinct from old.categoria_id
       or new.fornecedor_id is distinct from old.fornecedor_id
       or new.credor_nome is distinct from old.credor_nome
       or new.competencia is distinct from old.competencia
       or new.forma_prevista is distinct from old.forma_prevista
       or new.observacao is distinct from old.observacao then
      raise exception 'contas_pagar: o cancelamento altera somente status e dados do cancelamento.';
    end if;
    if exists (
      select 1
        from public.contas_pagar_parcelas pa
        join public.contas_pagar_baixas b on b.parcela_id = pa.id and b.estornado_em is null
       where pa.conta_id = old.id
    ) then
      raise exception 'contas_pagar: a conta tem pagamento registrado -- estorne o(s) pagamento(s) antes de cancelar.';
    end if;
    new.cancelada_em := now();
    new.cancelada_por := auth.uid();
    new.cancelada_por_nome := public.contas_pagar_nome_usuario();
  end if;

  new.atualizado_em := now();
  return new;
end;
$$;

create or replace function public.contas_pagar_parcelas_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE' then
    raise exception 'contas_pagar_parcelas: exclusao fisica nao e permitida.';
  end if;

  select c.status into v_status from public.contas_pagar c where c.id = new.conta_id;
  if v_status is distinct from 'ativa' then
    raise exception 'contas_pagar_parcelas: a conta nao esta ativa.';
  end if;

  if tg_op = 'INSERT' then
    new.criado_em := now();
    new.atualizado_em := null;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.conta_id is distinct from old.conta_id
     or new.numero is distinct from old.numero
     or new.criado_em is distinct from old.criado_em then
    raise exception 'contas_pagar_parcelas: conta, numero e criacao sao imutaveis.';
  end if;

  if (new.vencimento is distinct from old.vencimento or new.valor is distinct from old.valor)
     and exists (select 1 from public.contas_pagar_baixas b where b.parcela_id = old.id and b.estornado_em is null) then
    raise exception 'contas_pagar_parcelas: parcela paga nao pode ter vencimento/valor alterados -- estorne o pagamento antes.';
  end if;

  new.atualizado_em := now();
  return new;
end;
$$;

create or replace function public.contas_pagar_baixas_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_valor  numeric;
begin
  if tg_op = 'DELETE' then
    raise exception 'contas_pagar_baixas: exclusao fisica nao e permitida -- use o estorno.';
  end if;

  if tg_op = 'INSERT' then
    select c.status, pa.valor into v_status, v_valor
      from public.contas_pagar_parcelas pa
      join public.contas_pagar c on c.id = pa.conta_id
     where pa.id = new.parcela_id;
    if v_status is distinct from 'ativa' then
      raise exception 'contas_pagar_baixas: a conta nao esta ativa.';
    end if;
    if new.valor_original is distinct from v_valor then
      raise exception 'contas_pagar_baixas: valor_original (%) difere do valor da parcela (%) -- pagamento parcial nao e permitido.', new.valor_original, v_valor;
    end if;
    if new.pago_em > public.contas_pagar_hoje() then
      raise exception 'contas_pagar_baixas: data de pagamento (%) nao pode ser no futuro.', new.pago_em;
    end if;
    new.registrado_por := auth.uid();
    new.registrado_por_nome := public.contas_pagar_nome_usuario();
    new.registrado_em := now();
    new.estornado_em := null;
    new.estornado_por := null;
    new.estornado_por_nome := null;
    new.motivo_estorno := null;
    return new;
  end if;

  -- UPDATE: a unica transicao permitida e ativa -> estornada.
  if old.estornado_em is not null then
    raise exception 'contas_pagar_baixas: baixa estornada e imutavel.';
  end if;
  -- valor_pago fica de fora da comparacao: e coluna GERADA (em BEFORE
  -- UPDATE ainda vem nula) e deriva so de colunas comparadas aqui.
  if (to_jsonb(new) - array['estornado_em', 'estornado_por', 'estornado_por_nome', 'motivo_estorno', 'valor_pago'])
     is distinct from (to_jsonb(old) - array['estornado_em', 'estornado_por', 'estornado_por_nome', 'motivo_estorno', 'valor_pago'])
     or new.estornado_em is null then
    raise exception 'contas_pagar_baixas: baixa registrada e imutavel -- so o estorno e permitido.';
  end if;
  new.estornado_em := now();
  new.estornado_por := auth.uid();
  new.estornado_por_nome := public.contas_pagar_nome_usuario();
  return new;
end;
$$;

create or replace function public.contas_pagar_config_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'contas_pagar_config: a data de implantacao e imutavel.';
end;
$$;

create or replace function public.contas_pagar_categorias_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'contas_pagar_categorias: exclusao fisica nao e permitida -- inative a categoria.';
  end if;
  new.nome := public.contas_pagar_normalizar_nome(new.nome);
  if new.nome is null then
    raise exception 'contas_pagar_categorias: nome da categoria obrigatorio.';
  end if;
  if tg_op = 'INSERT' then
    new.criado_em := now();
    new.atualizado_em := null;
  else
    if new.id is distinct from old.id or new.criado_em is distinct from old.criado_em then
      raise exception 'contas_pagar_categorias: id e criacao sao imutaveis.';
    end if;
    new.atualizado_em := now();
  end if;
  return new;
end;
$$;

create trigger contas_pagar_protecao_trigger
  before insert or update or delete on public.contas_pagar
  for each row execute function public.contas_pagar_protecao();

create trigger contas_pagar_parcelas_protecao_trigger
  before insert or update or delete on public.contas_pagar_parcelas
  for each row execute function public.contas_pagar_parcelas_protecao();

create trigger contas_pagar_baixas_protecao_trigger
  before insert or update or delete on public.contas_pagar_baixas
  for each row execute function public.contas_pagar_baixas_protecao();

create trigger contas_pagar_config_protecao_trigger
  before update or delete on public.contas_pagar_config
  for each row execute function public.contas_pagar_config_protecao();

create trigger contas_pagar_categorias_protecao_trigger
  before insert or update or delete on public.contas_pagar_categorias
  for each row execute function public.contas_pagar_categorias_protecao();

-- ============================================================
-- 9. Integridade compra x financeiro.
-- ============================================================
-- 9.1 Verificacao de uma conta (chamada no COMMIT pelas constraint
-- triggers): conta ativa precisa de >= 1 parcela; se for de compra, a
-- compra precisa estar recebida, com valores completos, e a soma das
-- parcelas precisa ser exatamente o total recebido.
create or replace function public.contas_pagar_verificar_conta(p_conta_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conta   public.contas_pagar%rowtype;
  v_status  text;
  v_total   numeric;
  v_soma    numeric;
  v_qtd     integer;
begin
  select * into v_conta from public.contas_pagar where id = p_conta_id;
  if not found or v_conta.status <> 'ativa' then
    return;
  end if;

  select count(*), sum(valor) into v_qtd, v_soma
    from public.contas_pagar_parcelas where conta_id = p_conta_id;
  if v_qtd = 0 then
    raise exception 'contas_pagar: a conta % precisa ter ao menos uma parcela.', p_conta_id;
  end if;

  if v_conta.origem = 'compra' then
    select status into v_status from public.pedidos where id = v_conta.pedido_id;
    if v_status is distinct from 'recebido' then
      raise exception 'contas_pagar: a compra % tem lancamento financeiro ativo e precisa permanecer recebida -- estorne os pagamentos e cancele o lancamento antes.', v_conta.pedido_id;
    end if;
    v_total := public.contas_pagar_total_compra(v_conta.pedido_id);
    if v_total is null then
      raise exception 'contas_pagar: a compra % tem lancamento financeiro ativo mas esta sem valores recebidos completos.', v_conta.pedido_id;
    end if;
    if v_soma <> v_total then
      raise exception 'contas_pagar: total da compra % (R$ %) diverge da soma das parcelas do lancamento financeiro ativo (R$ %) -- ajuste o financeiro (replanejar) ou cancele o lancamento antes de alterar a compra.', v_conta.pedido_id, v_total, v_soma;
    end if;
  end if;
end;
$$;

create or replace function public.contas_pagar_verificar_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido_id uuid;
  v_conta_id  uuid;
begin
  if tg_table_name = 'contas_pagar' then
    perform public.contas_pagar_verificar_conta(coalesce(new.id, old.id));
    return null;
  elsif tg_table_name = 'contas_pagar_parcelas' then
    perform public.contas_pagar_verificar_conta(coalesce(new.conta_id, old.conta_id));
    return null;
  elsif tg_table_name = 'pedidos' then
    v_pedido_id := coalesce(new.id, old.id);
  else
    v_pedido_id := coalesce(new.pedido_id, old.pedido_id);
  end if;

  select c.id into v_conta_id
    from public.contas_pagar c
   where c.pedido_id = v_pedido_id and c.status = 'ativa';
  if v_conta_id is not null then
    perform public.contas_pagar_verificar_conta(v_conta_id);
  end if;
  return null;
end;
$$;

create constraint trigger contas_pagar_verificar_trigger
  after insert or update on public.contas_pagar
  deferrable initially deferred
  for each row execute function public.contas_pagar_verificar_trigger_fn();

create constraint trigger contas_pagar_parcelas_verificar_trigger
  after insert or update on public.contas_pagar_parcelas
  deferrable initially deferred
  for each row execute function public.contas_pagar_verificar_trigger_fn();

create constraint trigger pedidos_contas_pagar_verificar_trigger
  after update on public.pedidos
  deferrable initially deferred
  for each row execute function public.contas_pagar_verificar_trigger_fn();

create constraint trigger pedido_itens_contas_pagar_verificar_trigger
  after insert or update or delete on public.pedido_itens
  deferrable initially deferred
  for each row execute function public.contas_pagar_verificar_trigger_fn();

-- 9.2 Protecoes imediatas em pedidos (mensagem clara antes do commit) +
-- coerencia de data_recebimento. Roda ANTES de pedidos_protecao_trigger
-- (ordem alfabetica dos nomes), sem alterar nada dela.
create or replace function public.pedidos_financeiro_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.contas_pagar c where c.pedido_id = old.id) then
      raise exception 'pedidos: a compra % tem historico no Financeiro (Contas a Pagar) e nao pode ser excluida.', old.id;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.data_recebimento is not null then
      raise exception 'pedidos: data_recebimento so e preenchida no recebimento.';
    end if;
    return new;
  end if;

  if exists (select 1 from public.contas_pagar c where c.pedido_id = old.id and c.status = 'ativa') then
    if new.status is distinct from old.status then
      raise exception 'pedidos: a compra tem lancamento financeiro ativo (Contas a Pagar) -- estorne os pagamentos e cancele o lancamento antes de reabrir ou alterar o status.';
    end if;
    if new.fornecedor_id is distinct from old.fornecedor_id then
      raise exception 'pedidos: a compra tem lancamento financeiro ativo (Contas a Pagar) -- o fornecedor nao pode ser alterado; cancele o lancamento antes.';
    end if;
  end if;

  if old.status = 'recebido' and new.status = 'aguardando_entrega' then
    new.data_recebimento := null;
  elsif old.status = 'aguardando_entrega' and new.status = 'recebido' then
    if new.data_recebimento is not null
       and (new.data_recebimento < new.data_pedido or new.data_recebimento > public.contas_pagar_hoje()) then
      raise exception 'pedidos: data_recebimento (%) fora do intervalo permitido (data do pedido ate hoje).', new.data_recebimento;
    end if;
  elsif new.data_recebimento is distinct from old.data_recebimento then
    raise exception 'pedidos: data_recebimento so muda no recebimento ou na reabertura.';
  end if;

  return new;
end;
$$;

create trigger pedidos_financeiro_protecao_trigger
  before insert or update or delete on public.pedidos
  for each row execute function public.pedidos_financeiro_protecao();

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.contas_pagar_protecao()',
    'public.contas_pagar_parcelas_protecao()',
    'public.contas_pagar_baixas_protecao()',
    'public.contas_pagar_config_protecao()',
    'public.contas_pagar_categorias_protecao()',
    'public.contas_pagar_verificar_conta(uuid)',
    'public.contas_pagar_verificar_trigger_fn()',
    'public.pedidos_financeiro_protecao()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', f);
  end loop;
end $$;

-- ============================================================
-- 10. RLS -- leitura por contas_pagar.visualizar; NENHUMA policy de
--     escrita; privilegios de escrita revogados de anon/authenticated.
-- ============================================================
alter table public.contas_pagar enable row level security;
alter table public.contas_pagar_parcelas enable row level security;
alter table public.contas_pagar_baixas enable row level security;
alter table public.contas_pagar_categorias enable row level security;
alter table public.contas_pagar_config enable row level security;

create policy contas_pagar_select on public.contas_pagar
  for select to authenticated using ((select public.has_permissao('contas_pagar.visualizar')));
create policy contas_pagar_parcelas_select on public.contas_pagar_parcelas
  for select to authenticated using ((select public.has_permissao('contas_pagar.visualizar')));
create policy contas_pagar_baixas_select on public.contas_pagar_baixas
  for select to authenticated using ((select public.has_permissao('contas_pagar.visualizar')));
create policy contas_pagar_categorias_select on public.contas_pagar_categorias
  for select to authenticated using ((select public.has_permissao('contas_pagar.visualizar')));
create policy contas_pagar_config_select on public.contas_pagar_config
  for select to authenticated using ((select public.has_permissao('contas_pagar.visualizar')));

revoke all on public.contas_pagar, public.contas_pagar_parcelas, public.contas_pagar_baixas,
  public.contas_pagar_categorias, public.contas_pagar_config from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.contas_pagar, public.contas_pagar_parcelas,
  public.contas_pagar_baixas, public.contas_pagar_categorias, public.contas_pagar_config from authenticated;
grant select on public.contas_pagar, public.contas_pagar_parcelas, public.contas_pagar_baixas,
  public.contas_pagar_categorias, public.contas_pagar_config to authenticated;

-- ============================================================
-- 11. Permissoes (4) e concessoes padrao.
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('contas_pagar.visualizar', 'contas_pagar', 'visualizar', 'Ver Contas a Pagar (contas, parcelas, pagamentos, compras sem lancamento) e a secao Financeiro das compras.'),
  ('contas_pagar.editar',     'contas_pagar', 'editar',     'Lancar o financeiro de compras, criar/editar despesas manuais, replanejar parcelas e gerenciar categorias de despesa.'),
  ('contas_pagar.pagar',      'contas_pagar', 'pagar',      'Confirmar pagamento de parcelas (inclui o pagamento no ato).'),
  ('contas_pagar.cancelar',   'contas_pagar', 'cancelar',   'Estornar pagamentos e cancelar contas (sempre logico, com motivo).');

insert into public.perfil_permissoes (perfil, permissao) values
  ('proprietario_admin', 'contas_pagar.visualizar'),
  ('proprietario_admin', 'contas_pagar.editar'),
  ('proprietario_admin', 'contas_pagar.pagar'),
  ('proprietario_admin', 'contas_pagar.cancelar');

insert into public.perfil_permissoes (perfil, permissao)
select pf.nome, x.codigo
  from public.perfis pf
 cross join (values ('contas_pagar.visualizar'), ('contas_pagar.editar'), ('contas_pagar.pagar')) as x(codigo)
 where pf.nome = 'financeiro_administrativo';

-- ============================================================
-- 12. receber_pedido -- REDEFINIDA. Texto IDENTICO ao da 0051 (a guarda
--     da secao 0 confere o md5 do corpo publicado antes), com UMA unica
--     mudanca: o UPDATE final tambem grava
--     data_recebimento = p_data_recebimento (marcado "0073" abaixo).
--     Assinatura, permissoes, validacoes, Sacos Fechados, historico do
--     Catalogo e grants permanecem os mesmos.
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
  set status = 'recebido',
      data_recebimento = p_data_recebimento  -- 0073: data efetiva do recebimento
  where id = p_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

comment on function public.receber_pedido(uuid, date, jsonb) is
  'Confirma o recebimento de um pedido com dados EFETIVOS por item -- substitui, para o fluxo detalhado, o simples marcar_pedido_recebido (0022). Exige sessao autenticada + pedidos.receber. Valida data do recebimento. Bloqueia a linha do pedido (FOR UPDATE). Exige TODOS os itens do pedido no payload. Para cada item com produto_id, resolve a configuracao comercial aplicavel em produto_fornecedores e cria um registro em produtos_historico_compras (origem=recebimento_pedido, quantidade_comercial=quantidade_recebida, sem mudanca de significado). NOVO (0051, revisado): quando a configuracao resolvida esta controla_sacos_fechados=true, EXIGE quantidade_sacos_recebidos explicito no payload (nunca calculado a partir de quantidade_recebida), valida coerencia EXATA (quantidade_recebida = quantidade_sacos_recebidos * peso_por_saco_kg) e unidade-base KG, grava o snapshot em pedido_itens.quantidade_sacos_recebidos, e insere atomicamente uma entrada em sacos_fechados_movimentacoes (tipo=entrada, origem=recebimento_pedido, pedido_item_id) + a movimentacao de estoque_movimentacoes correspondente (origem=sacos_fechados_recebimento_pedido). Rejeita quantidade_sacos_recebidos informada para item cuja config nao controla sacos, ou sem config de sacos resolvivel. Idempotente via a propria transicao de status do pedido + indice unico parcial de pedido_item_id (0042). SECURITY DEFINER: necessario porque nenhuma combinacao de policies normais autoriza este fluxo so com pedidos.receber. Qualquer falha em qualquer etapa desfaz a transacao inteira. 0073: grava pedidos.data_recebimento = p_data_recebimento (data efetiva).';

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
-- 12b. Pedidos: correcao de compra presencial e da reabertura --
--      pedido_itens_protecao(), editar_compra_presencial() e
--      reabrir_recebimento_pedido() REDEFINIDAS (guarda de md5 dos
--      corpos atuais na secao 0).
-- ============================================================
-- Causas (ver cabecalho):
--   (1) a 0051 recriou pedido_itens_protecao() a partir do corpo da
--       0022/0027 e perdeu os 3 ramos "CORRECAO DE COMPRA PRESENCIAL" da
--       0037 -- editar_compra_presencial() falha em qualquer edicao;
--   (2) o gate rolbypassrls(current_user) do ramo de REABERTURA de
--       pedido_itens_protecao() (0027) e sempre verdadeiro: a trigger e
--       SECURITY DEFINER, entao current_user e o dono (com BYPASSRLS).
--       Quem tem pedidos.reabrir_recebimento (+ pedidos.editar, da RLS)
--       limpa direto pela API os campos recebidos de qualquer item de
--       pedido recebido. (Em pedidos_protecao, que e SECURITY INVOKER, o
--       mesmo gate funciona e NAO e alterado.);
--   (3) a 0051 recriou reabrir_recebimento_pedido() sem a guarda da 0037
--       que recusava compra presencial (a 0052 herdou).
--
-- Correcao = corpos ATUAIS + o minimo, sem voltar aos textos antigos:
--   * janelas transacionais (set_config LOCAL, mesmo padrao da 0038),
--     cada uma com seu nome e o id do pedido como valor:
--       pedidos.compra_presencial_em_edicao  -- editar_compra_presencial()
--       pedidos.reabertura_recebimento_em_curso -- reabrir_recebimento_pedido()
--     O PostgREST/GraphQL nao deixa o cliente definir esses parametros;
--   * compra presencial: excecao so para ESSE pedido (compra_presencial,
--     recebido), com pedidos.editar, item coerente com o que a RPC grava
--     (recebidos = pedidos, sem sacos);
--   * reabertura: o gate rolbypassrls do ramo vira a janela de reabertura
--     para ESSE pedido (com entrega, recebido); permissao e regra de
--     campos (so limpar os 4 campos de recebimento) continuam iguais; e
--     uma constraint trigger DEFERRED garante no COMMIT que item com
--     campos limpos nao fica em pedido ainda recebido -- uma janela aberta
--     a mao sem a transicao de status (que pedidos_protecao so permite
--     dentro da RPC) e desfeita;
--   * reabrir_recebimento_pedido() volta a recusar compra presencial,
--     com ou sem Financeiro.
-- Com financeiro ATIVO, as protecoes da secao 9 continuam valendo.

create or replace function public.pedido_itens_correcao_presencial_autorizada(p_pedido_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return p_pedido_id is not null
    and coalesce(current_setting('pedidos.compra_presencial_em_edicao', true), '') = p_pedido_id::text
    and exists (
      select 1 from public.pedidos p
       where p.id = p_pedido_id and p.status = 'recebido' and p.modalidade_compra = 'compra_presencial'
    )
    and (select public.has_permissao('pedidos.editar'));
end;
$$;

comment on function public.pedido_itens_correcao_presencial_autorizada(uuid) is
  'Migration 0073. Interna (sem EXECUTE para papeis de API). Verdadeiro so dentro de editar_compra_presencial() para o proprio pedido (parametro local pedidos.compra_presencial_em_edicao), pedido compra_presencial recebido e usuario com pedidos.editar. Usada por pedido_itens_protecao().';

revoke execute on function public.pedido_itens_correcao_presencial_autorizada(uuid) from public, anon, authenticated, service_role;

create or replace function public.pedido_itens_reabertura_autorizada(p_pedido_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return p_pedido_id is not null
    and coalesce(current_setting('pedidos.reabertura_recebimento_em_curso', true), '') = p_pedido_id::text
    and exists (
      select 1 from public.pedidos p
       where p.id = p_pedido_id and p.status = 'recebido' and p.modalidade_compra is distinct from 'compra_presencial'
    );
end;
$$;

comment on function public.pedido_itens_reabertura_autorizada(uuid) is
  'Migration 0073. Interna (sem EXECUTE para papeis de API). Verdadeiro so dentro de reabrir_recebimento_pedido() para o proprio pedido (parametro local pedidos.reabertura_recebimento_em_curso), pedido recebido e nao presencial. A permissao pedidos.reabrir_recebimento continua checada em pedido_itens_protecao(). Substitui o gate rolbypassrls do ramo de reabertura.';

revoke execute on function public.pedido_itens_reabertura_autorizada(uuid) from public, anon, authenticated, service_role;

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

    -- 0073 -- CORRECAO DE COMPRA PRESENCIAL (excecao da 0037 perdida na
    -- 0051): so dentro de editar_compra_presencial() para ESTE pedido
    -- (ver pedido_itens_correcao_presencial_autorizada). Item novo nasce
    -- com os campos recebidos iguais aos pedidos e sem Sacos -- exatamente
    -- o que a RPC grava.
    if v_status = 'recebido' and public.pedido_itens_correcao_presencial_autorizada(new.pedido_id) then
      if new.unidade_recebida is distinct from new.unidade
         or new.quantidade_recebida is distinct from new.quantidade_pedida
         or new.valor_unitario_recebido is distinct from new.valor_unitario
         or new.quantidade_sacos_recebidos is not null then
        raise exception 'pedido_itens: item de compra presencial precisa ter os campos recebidos iguais aos pedidos (e sem sacos).';
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

    select status into v_status from public.pedidos where id = old.pedido_id;

    -- 0073 -- CORRECAO DE COMPRA PRESENCIAL (excecao da 0037 perdida na
    -- 0051): mesmo gate do INSERT. Fora de editar_compra_presencial() a
    -- condicao e falsa e o fluxo segue IDENTICO ao da 0051 (reabertura
    -- abaixo / bloqueio). quantidade_sacos_recebidos nao muda (compra
    -- presencial nao integra Sacos -- 0051).
    if v_status = 'recebido' and public.pedido_itens_correcao_presencial_autorizada(old.pedido_id) then
      if new.unidade_recebida is distinct from new.unidade
         or new.quantidade_recebida is distinct from new.quantidade_pedida
         or new.valor_unitario_recebido is distinct from new.valor_unitario
         or new.quantidade_sacos_recebidos is distinct from old.quantidade_sacos_recebidos then
        raise exception 'pedido_itens: item de compra presencial precisa ter os campos recebidos iguais aos pedidos (e sem sacos).';
      end if;
      return new;
    end if;

    -- REABERTURA: excecao estreita -- permite limpar SOMENTE os campos
    -- de recebimento de um item cujo pedido-pai AINDA esta
    -- status=recebido (a transicao do pedido em si so acontece DEPOIS,
    -- ver reabrir_recebimento_pedido()).
    -- NOVO (0051): quantidade_sacos_recebidos agora tambem faz parte
    -- dos "campos de recebimento" que precisam ficar NULL apos a
    -- limpeza -- sem isso, a coluna nova ficaria sem protecao alguma
    -- nesta janela.
    -- 0073: o gate rolbypassrls(current_user) daqui era sempre verdadeiro
    -- (trigger SECURITY DEFINER -> current_user = dono) e foi trocado pela
    -- janela aberta por reabrir_recebimento_pedido() para ESTE pedido
    -- (pedido_itens_reabertura_autorizada). Permissao e campos: iguais.
    -- A coerencia final (pedido sai de recebido na mesma transacao) e
    -- conferida no COMMIT por pedido_itens_reabertura_coerente_trigger.
    if v_status = 'recebido' then
      if not public.pedido_itens_reabertura_autorizada(old.pedido_id) then
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

    -- 0073 -- CORRECAO DE COMPRA PRESENCIAL: remocao de item lancado por
    -- engano, so dentro de editar_compra_presencial() para ESTE pedido.
    -- pedido_itens_impedir_pedido_vazio continua impedindo pedido vazio.
    if v_status = 'recebido' and public.pedido_itens_correcao_presencial_autorizada(old.pedido_id) then
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
  'BEFORE INSERT/UPDATE/DELETE em pedido_itens, TG_OP explicito. Forca criado_em/atualizado_em; bloqueia pedido_id e criado_em imutaveis; bloqueia qualquer INSERT/UPDATE/DELETE quando o pedido-pai nao esta aguardando_entrega -- EXCETO (a) reabertura: UPDATE que limpa SOMENTE unidade_recebida/quantidade_recebida/valor_unitario_recebido/quantidade_sacos_recebidos para NULL enquanto o pedido-pai ainda e recebido, com pedidos.reabrir_recebimento e SOMENTE dentro de reabrir_recebimento_pedido() para o proprio pedido (0073: pedido_itens_reabertura_autorizada, no lugar do gate rolbypassrls); (b) 0073: INSERT/UPDATE/DELETE de item de compra presencial recebida SOMENTE dentro de editar_compra_presencial() para o proprio pedido (pedido_itens_correcao_presencial_autorizada), com campos recebidos = pedidos e sem sacos. SECURITY DEFINER para ler pedidos.status independente da RLS de SELECT de pedidos do chamador.';

revoke execute on function public.pedido_itens_protecao() from public;

-- Coerencia da reabertura no COMMIT: item cujos campos de recebimento
-- foram limpos nesta transacao nao pode terminar em pedido ainda recebido
-- (so reabrir_recebimento_pedido() faz a transicao de status, via
-- pedidos_protecao). Dispara so quando a linha passa de "com recebimento"
-- para "sem recebimento".
create or replace function public.pedido_itens_reabertura_coerente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_item   record;
begin
  select pi.unidade_recebida, pi.quantidade_recebida, pi.valor_unitario_recebido
    into v_item
    from public.pedido_itens pi
   where pi.id = new.id;
  if not found then
    return null;
  end if;
  select status into v_status from public.pedidos where id = new.pedido_id;
  if v_status = 'recebido'
     and v_item.unidade_recebida is null and v_item.quantidade_recebida is null and v_item.valor_unitario_recebido is null then
    raise exception 'pedido_itens: campos de recebimento limpos sem reabrir o pedido % -- so reabrir_recebimento_pedido() pode limpar o recebimento.', new.pedido_id;
  end if;
  return null;
end;
$$;

comment on function public.pedido_itens_reabertura_coerente() is
  'Migration 0073. Constraint trigger DEFERRED em pedido_itens: no COMMIT, item cujos campos de recebimento foram limpos precisa pertencer a pedido que saiu de recebido (reabertura completa).';

revoke execute on function public.pedido_itens_reabertura_coerente() from public, anon, authenticated, service_role;

create constraint trigger pedido_itens_reabertura_coerente_trigger
  after update on public.pedido_itens
  deferrable initially deferred
  for each row
  when ((old.unidade_recebida is not null or old.quantidade_recebida is not null or old.valor_unitario_recebido is not null)
        and new.unidade_recebida is null and new.quantidade_recebida is null and new.valor_unitario_recebido is null)
  execute function public.pedido_itens_reabertura_coerente();

-- editar_compra_presencial: texto IDENTICO ao da 0037 + as 2 chamadas
-- set_config marcadas "0073" (abrem/fecham a janela de correcao de
-- itens). Assinatura, validacoes, historico, auditoria, comentario e
-- grants (CREATE OR REPLACE preserva a ACL) permanecem os mesmos.
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

  -- 0073 -- marca, LOCAL a esta transacao, que ESTE pedido esta em
  -- correcao por esta RPC. E o unico sinal que libera a excecao de compra
  -- presencial em pedido_itens_protecao() (via pedido_itens_correcao_
  -- presencial_autorizada). Desfeito logo depois do passo 11c e, em caso
  -- de erro, junto com a transacao. Mesmo padrao da 0038 (agenda.
  -- permitir_realocacao_ocorrencia).
  perform set_config('pedidos.compra_presencial_em_edicao', p_pedido_id::text, true);

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

  -- 0073 -- fim da janela de correcao de itens (ver passo 11).
  perform set_config('pedidos.compra_presencial_em_edicao', '', true);

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

-- reabrir_recebimento_pedido: texto IDENTICO ao da 0052 + a guarda de
-- compra presencial e as 2 chamadas set_config marcadas "0073".
-- Assinatura, validacoes de Sacos/estoque, auditoria e grants (CREATE OR
-- REPLACE preserva a ACL, inclusive o grant legado de service_role da
-- 0027) permanecem os mesmos.
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
  -- Novas/revisadas (0052) -- validacao completa ANTES de qualquer
  -- DELETE, saldo agregado por configuracao, cardinalidade exigida,
  -- snapshot de estoque incluido na auditoria.
  v_ids_sacos            uuid[];
  v_snapshot_sacos       jsonb;
  v_snapshot_estoque     jsonb;
  v_config_id            uuid;
  v_saldo_resultante     integer;
  v_sacos_row            public.sacos_fechados_movimentacoes%rowtype;
  v_qtd_estoque_vinculado integer;
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

  -- 0073 -- GUARDA DA 0037 RESTAURADA (perdida na 0051, herdada pela
  -- 0052): compra presencial nunca passa por aqui -- nao existe fase de
  -- aguardando_entrega para ela, e a correcao de uma compra presencial
  -- ja recebida tem RPC propria (editar_compra_presencial()). Vale com
  -- ou sem Financeiro.
  if v_pedido.modalidade_compra = 'compra_presencial' then
    raise exception 'reabrir_recebimento_pedido: compra presencial nao tem recebimento para reabrir (pedido %) -- para corrigir a compra use editar_compra_presencial().', p_pedido_id;
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

  -- PASSO A -- coleta todas as entradas automaticas de Sacos deste
  -- pedido (mesmo filtro da 0051 -- origem='recebimento_pedido' garante
  -- estruturalmente, via CHECK sacos_fechados_movimentacoes_tipo_
  -- origem_coerente_check (0042), que nenhum movimento manual do
  -- usuario e alcancado aqui).
  select array_agg(sfm.id) into v_ids_sacos
  from public.sacos_fechados_movimentacoes sfm
  where sfm.pedido_item_id = any(v_ids_itens)
    and sfm.origem = 'recebimento_pedido';

  -- PASSO B -- VALIDACAO DE SALDO, AGREGADA POR CONFIGURACAO (corrige o
  -- achado critico desta migration -- ver cabecalho). Para cada
  -- configuracao distinta entre as entradas deste pedido, na ORDEM do
  -- proprio id (determinismo, evita deadlock entre reaberturas
  -- concorrentes que toquem configuracoes em ordem cruzada): trava a
  -- configuracao, calcula o saldo excluindo TODAS as entradas deste
  -- pedido para ELA de uma vez (nao uma por vez), aborta se negativo.
  -- NENHUM DELETE acontece neste passo.
  for v_config_id in
    select distinct sfm.produto_fornecedor_id
    from public.sacos_fechados_movimentacoes sfm
    where sfm.id = any(coalesce(v_ids_sacos, array[]::uuid[]))
    order by sfm.produto_fornecedor_id
  loop
    perform 1 from public.produto_fornecedores
    where id = v_config_id
    for update;

    v_saldo_resultante := (
      select coalesce(sum(quantidade_sacos), 0)
      from public.sacos_fechados_movimentacoes
      where produto_fornecedor_id = v_config_id
        and id <> all(coalesce(v_ids_sacos, array[]::uuid[]))
    );

    if v_saldo_resultante < 0 then
      raise exception 'reabrir_recebimento_pedido: nao e possivel desfazer as entradas automaticas de Sacos Fechados da configuracao % -- removendo TODAS as entradas automaticas deste pedido para esta configuracao de uma vez, o saldo resultante seria negativo (% sacos). Sacos ja foram consumidos (abertos) depois deste(s) recebimento(s) -- ajuste as movimentacoes manuais de Sacos Fechados (ex.: exclua ou edite a abertura correspondente) antes de reabrir este recebimento.',
        v_config_id, v_saldo_resultante;
    end if;
  end loop;

  -- PASSO C -- VALIDACAO DE CARDINALIDADE, uma linha de sacos por vez
  -- (corrige o gap 1 originalmente reportado -- mesmo padrao ja usado
  -- por editar_movimentacao_saco/0046 e excluir_movimentacao_saco/0050,
  -- adaptado com mensagens SEPARADAS para 0 e >1, pedido explicito do
  -- usuario). NENHUM DELETE acontece neste passo tambem.
  for v_sacos_row in
    select * from public.sacos_fechados_movimentacoes
    where id = any(coalesce(v_ids_sacos, array[]::uuid[]))
  loop
    select count(*) into v_qtd_estoque_vinculado
    from public.estoque_movimentacoes
    where origem = 'sacos_fechados_recebimento_pedido'
      and origem_id = v_sacos_row.id;

    if v_qtd_estoque_vinculado = 0 then
      raise exception 'reabrir_recebimento_pedido: nenhuma movimentacao de estoque vinculada encontrada para a entrada automatica de Sacos % (item %, origem=sacos_fechados_recebimento_pedido, origem_id=%) -- inconsistencia estrutural, abortando sem alterar nada.',
        v_sacos_row.id, v_sacos_row.pedido_item_id, v_sacos_row.id;
    elsif v_qtd_estoque_vinculado > 1 then
      raise exception 'reabrir_recebimento_pedido: mais de uma movimentacao de estoque vinculada encontrada para a entrada automatica de Sacos % (item %, origem=sacos_fechados_recebimento_pedido, origem_id=%, encontradas=%) -- inconsistencia estrutural, abortando sem alterar nada.',
        v_sacos_row.id, v_sacos_row.pedido_item_id, v_sacos_row.id, v_qtd_estoque_vinculado;
    end if;
  end loop;

  -- PASSO D -- SNAPSHOTS COMPLETOS, so depois que B e C passaram por
  -- INTEIRO sem excecao (corrige o gap 2 originalmente reportado --
  -- estoque_removido agora ao lado de sacos_removidos). UNICO insert em
  -- logs_auditoria desta funcao, ANTES de qualquer DELETE.
  select jsonb_agg(to_jsonb(sfm.*)) into v_snapshot_sacos
  from public.sacos_fechados_movimentacoes sfm
  where sfm.id = any(coalesce(v_ids_sacos, array[]::uuid[]));

  select jsonb_agg(to_jsonb(em.*)) into v_snapshot_estoque
  from public.estoque_movimentacoes em
  where em.origem = 'sacos_fechados_recebimento_pedido'
    and em.origem_id = any(coalesce(v_ids_sacos, array[]::uuid[]));

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
      'estoque_removido', coalesce(v_snapshot_estoque, '[]'::jsonb),
      'usuario', auth.uid(),
      'reaberto_em', now()
    )::text
  );

  -- PASSO E -- exclui SOMENTE historico origem=recebimento_pedido
  -- vinculado a itens DESTE pedido (byte a byte igual a 0027/0051).
  delete from public.produtos_historico_compras
  where pedido_item_id = any(v_ids_itens)
    and origem = 'recebimento_pedido';

  -- Deletes em lote -- agora seguros, tudo ja validado nos passos B/C.
  -- Estoque primeiro, depois Sacos (mesma ordem da 0051).
  delete from public.estoque_movimentacoes
  where origem = 'sacos_fechados_recebimento_pedido'
    and origem_id = any(coalesce(v_ids_sacos, array[]::uuid[]));

  delete from public.sacos_fechados_movimentacoes
  where id = any(coalesce(v_ids_sacos, array[]::uuid[]));

  -- PASSO F -- limpa os campos de recebimento -- roda ENQUANTO o pedido
  -- ainda e recebido (a transicao de status so acontece no passo G);
  -- pedido_itens_protecao (0051) permite esta UPDATE especifica e SO
  -- esta -- byte a byte igual a 0051.
  -- 0073 -- janela de reabertura LOCAL a esta transacao e a ESTE pedido:
  -- e o unico sinal que libera a limpeza dos campos de recebimento em
  -- pedido_itens_protecao() (via pedido_itens_reabertura_autorizada), no
  -- lugar do gate rolbypassrls, que dentro daquela trigger SECURITY
  -- DEFINER era sempre verdadeiro. Fechada logo depois do UPDATE.
  perform set_config('pedidos.reabertura_recebimento_em_curso', p_pedido_id::text, true);

  update public.pedido_itens
  set unidade_recebida = null,
      quantidade_recebida = null,
      valor_unitario_recebido = null,
      quantidade_sacos_recebidos = null
  where pedido_id = p_pedido_id;

  perform set_config('pedidos.reabertura_recebimento_em_curso', '', true);

  -- PASSO G -- transicao formal -- pedidos_protecao (0027, intocada)
  -- libera esta UPDATE especifica, forca recebido_em=null -- byte a
  -- byte igual a 0027/0051.
  update public.pedidos
  set status = 'aguardando_entrega'
  where id = p_pedido_id
  returning * into v_pedido;

  return v_pedido;
end;
$$;

comment on function public.reabrir_recebimento_pedido(uuid) is
  'Desfaz atomicamente o recebimento de um pedido COM ENTREGA: grava snapshot completo (pedido+itens, incluindo quantidade_sacos_recebidos+historicos removidos+sacos removidos+estoque removido, 0052) em logs_auditoria ANTES de qualquer DELETE, exclui de produtos_historico_compras todo registro origem=recebimento_pedido vinculado a itens deste pedido, desfaz atomicamente qualquer entrada automatica de sacos_fechados_movimentacoes/estoque_movimentacoes vinculada (origem=recebimento_pedido), com protecao de saldo AGREGADA POR CONFIGURACAO e exigencia de EXATAMENTE 1 movimentacao de estoque por entrada de sacos (0052). Limpa unidade_recebida/quantidade_recebida/valor_unitario_recebido/quantidade_sacos_recebidos em pedido_itens e transiciona pedidos.status de recebido para aguardando_entrega. 0073: recusa compra presencial (guarda da 0037 restaurada) e abre, so durante a limpeza dos itens, a janela local pedidos.reabertura_recebimento_em_curso que pedido_itens_protecao exige (no lugar do gate rolbypassrls). Exige sessao autenticada + pedidos.reabrir_recebimento. Bloqueia a linha do pedido (FOR UPDATE). SECURITY DEFINER. Qualquer falha desfaz a transacao inteira.';
-- ============================================================
-- 13. RPCs de escrita (todas SECURITY DEFINER: as tabelas nao tem policy
--     de escrita; autorizacao explicita no inicio de cada uma; auditoria
--     em logs_auditoria na mesma transacao).
-- ============================================================

-- 13.1 Validacao de forma de pagamento (interna).
create or replace function public.contas_pagar_validar_forma(p_forma text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_forma is null or p_forma not in ('boleto', 'pix', 'dinheiro', 'cartao_debito', 'cartao_credito', 'transferencia', 'outro') then
    raise exception 'contas_pagar: forma de pagamento invalida (%).', coalesce(p_forma, 'vazia');
  end if;
end;
$$;

-- 13.2 Insere as parcelas de uma conta a partir de [{vencimento, valor}]
-- (interna). Numera por vencimento (empate: ordem informada). Devolve a
-- soma. Valores em reais com no maximo 2 casas -- o calculo/arredondamento
-- automatico em centavos e feito na interface; o banco so aceita valores
-- exatos e confere a soma final.
create or replace function public.contas_pagar_inserir_parcelas(
  p_conta_id           uuid,
  p_parcelas           jsonb,
  p_vencimento_minimo  date
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item   record;
  v_venc   date;
  v_valor  numeric;
  v_soma   numeric := 0;
begin
  if p_parcelas is null or jsonb_typeof(p_parcelas) <> 'array' or jsonb_array_length(p_parcelas) = 0 then
    raise exception 'contas_pagar: informe ao menos uma parcela.';
  end if;
  if jsonb_array_length(p_parcelas) > 60 then
    raise exception 'contas_pagar: no maximo 60 parcelas.';
  end if;

  for v_item in select e.value as item, e.ordinality as ord from jsonb_array_elements(p_parcelas) with ordinality e
  loop
    if jsonb_typeof(v_item.item) <> 'object' then
      raise exception 'contas_pagar: parcela % invalida.', v_item.ord;
    end if;
    begin
      v_venc := (v_item.item->>'vencimento')::date;
      v_valor := (v_item.item->>'valor')::numeric;
    exception when others then
      raise exception 'contas_pagar: parcela % com vencimento ou valor invalido.', v_item.ord;
    end;
    if v_venc is null then
      raise exception 'contas_pagar: parcela % sem vencimento.', v_item.ord;
    end if;
    if v_valor is null or v_valor <= 0 then
      raise exception 'contas_pagar: parcela % com valor invalido (precisa ser maior que zero).', v_item.ord;
    end if;
    if v_valor <> round(v_valor, 2) then
      raise exception 'contas_pagar: parcela % com mais de 2 casas decimais.', v_item.ord;
    end if;
    if p_vencimento_minimo is not null and v_venc < p_vencimento_minimo then
      raise exception 'contas_pagar: vencimento da parcela % (%) anterior a data minima (%).', v_item.ord, v_venc, p_vencimento_minimo;
    end if;
    v_soma := v_soma + v_valor;
  end loop;

  insert into public.contas_pagar_parcelas (conta_id, numero, vencimento, valor)
  select p_conta_id,
         row_number() over (order by x.venc, x.ord),
         x.venc,
         x.valor
    from (
      select (e.value->>'vencimento')::date as venc, (e.value->>'valor')::numeric as valor, e.ordinality as ord
        from jsonb_array_elements(p_parcelas) with ordinality e
    ) x;

  return v_soma;
end;
$$;

-- 13.3 Registra a baixa de uma parcela (interna -- quem chama ja checou
-- contas_pagar.pagar).
create or replace function public.contas_pagar_registrar_baixa(
  p_parcela_id       uuid,
  p_pago_em          date,
  p_forma_pagamento  text,
  p_juros            numeric,
  p_multa            numeric,
  p_desconto         numeric,
  p_valor_pago       numeric,
  p_observacao       text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parcela   public.contas_pagar_parcelas%rowtype;
  v_status    text;
  v_juros     numeric := coalesce(p_juros, 0);
  v_multa     numeric := coalesce(p_multa, 0);
  v_desconto  numeric := coalesce(p_desconto, 0);
  v_pago      numeric;
  v_obs       text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_baixa_id  uuid;
begin
  select pa.* into v_parcela from public.contas_pagar_parcelas pa where pa.id = p_parcela_id for update;
  if not found then
    raise exception 'contas_pagar: parcela % nao encontrada.', p_parcela_id;
  end if;
  select c.status into v_status from public.contas_pagar c where c.id = v_parcela.conta_id for update;
  if v_status <> 'ativa' then
    raise exception 'contas_pagar: a conta desta parcela esta cancelada.';
  end if;
  if exists (select 1 from public.contas_pagar_baixas b where b.parcela_id = p_parcela_id and b.estornado_em is null) then
    raise exception 'contas_pagar: esta parcela ja esta paga.';
  end if;

  if p_pago_em is null then
    raise exception 'contas_pagar: data do pagamento obrigatoria.';
  end if;
  if p_pago_em > public.contas_pagar_hoje() then
    raise exception 'contas_pagar: data do pagamento (%) nao pode ser no futuro (hoje em America/Sao_Paulo: %).', p_pago_em, public.contas_pagar_hoje();
  end if;
  perform public.contas_pagar_validar_forma(p_forma_pagamento);

  if v_juros < 0 or v_multa < 0 or v_desconto < 0 then
    raise exception 'contas_pagar: juros, multa e desconto nao podem ser negativos.';
  end if;
  if v_juros <> round(v_juros, 2) or v_multa <> round(v_multa, 2) or v_desconto <> round(v_desconto, 2) then
    raise exception 'contas_pagar: juros, multa e desconto com no maximo 2 casas decimais.';
  end if;

  v_pago := v_parcela.valor + v_juros + v_multa - v_desconto;
  if v_pago <= 0 then
    raise exception 'contas_pagar: o valor efetivamente pago precisa ser maior que zero.';
  end if;
  if p_valor_pago is not null and p_valor_pago <> v_pago then
    raise exception 'contas_pagar: valor pago informado (%) nao confere com valor original + juros + multa - desconto (%).', p_valor_pago, v_pago;
  end if;
  if v_obs is not null and char_length(v_obs) > 1000 then
    raise exception 'contas_pagar: observacao com mais de 1000 caracteres.';
  end if;

  insert into public.contas_pagar_baixas (parcela_id, pago_em, forma_pagamento, valor_original, juros, multa, desconto, observacao)
  values (p_parcela_id, p_pago_em, p_forma_pagamento, v_parcela.valor, v_juros, v_multa, v_desconto, v_obs)
  returning id into v_baixa_id;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('conta_pagar', v_parcela.conta_id::text, 'pagou', 'parcela ' || v_parcela.numero, null,
          format('pago_em=%s; forma=%s; original=%s; juros=%s; multa=%s; desconto=%s; pago=%s; baixa=%s',
                 p_pago_em, p_forma_pagamento, v_parcela.valor, v_juros, v_multa, v_desconto, v_pago, v_baixa_id));

  return v_baixa_id;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.contas_pagar_validar_forma(text)',
    'public.contas_pagar_inserir_parcelas(uuid, jsonb, date)',
    'public.contas_pagar_registrar_baixa(uuid, date, text, numeric, numeric, numeric, numeric, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', f);
  end loop;
end $$;

-- 13.4 Lancar o financeiro de uma compra recebida.
--   p_condicao 'no_ato': 1 parcela (vencimento = data da compra, valor =
--     total) + baixa imediata (p_pago_em, padrao data da compra; forma =
--     p_forma_prevista). Exige tambem contas_pagar.pagar.
--   p_condicao 'a_prazo': p_parcelas [{vencimento, valor}], soma = total.
-- Idempotente: no maximo 1 lancamento ATIVO por compra (indice unico); um
-- segundo lancamento e recusado com mensagem clara.
create or replace function public.contas_pagar_lancar_compra(
  p_pedido_id       uuid,
  p_condicao        text,
  p_forma_prevista  text,
  p_parcelas        jsonb,
  p_pago_em         date,
  p_observacao      text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido    public.pedidos%rowtype;
  v_total     numeric;
  v_data      date;
  v_obs       text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_conta_id  uuid;
  v_parcela   uuid;
  v_soma      numeric;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'contas_pagar_lancar_compra: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('contas_pagar.editar')) then
    raise exception using errcode = '42501', message = 'contas_pagar_lancar_compra: requer a permissao contas_pagar.editar.';
  end if;
  if p_condicao is null or p_condicao not in ('no_ato', 'a_prazo') then
    raise exception 'contas_pagar_lancar_compra: condicao invalida (use no_ato ou a_prazo).';
  end if;
  if p_condicao = 'no_ato' and not (select public.has_permissao('contas_pagar.pagar')) then
    raise exception using errcode = '42501', message = 'contas_pagar_lancar_compra: pagamento no ato requer a permissao contas_pagar.pagar.';
  end if;
  perform public.contas_pagar_validar_forma(p_forma_prevista);
  if p_condicao = 'no_ato' and p_forma_prevista = 'boleto' then
    raise exception 'contas_pagar_lancar_compra: boleto nao e pagamento no ato -- use a prazo.';
  end if;
  if p_condicao = 'a_prazo' and p_forma_prevista in ('cartao_debito', 'cartao_credito') then
    raise exception 'contas_pagar_lancar_compra: compra no cartao e paga no ato -- use pago no ato.';
  end if;
  if v_obs is not null and char_length(v_obs) > 1000 then
    raise exception 'contas_pagar_lancar_compra: observacao com mais de 1000 caracteres.';
  end if;

  select * into v_pedido from public.pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'contas_pagar_lancar_compra: compra % nao encontrada.', p_pedido_id;
  end if;
  if v_pedido.status <> 'recebido' then
    raise exception 'contas_pagar_lancar_compra: somente compras recebidas podem ter o financeiro lancado (status atual: %).', v_pedido.status;
  end if;
  if exists (select 1 from public.contas_pagar c where c.pedido_id = p_pedido_id and c.status = 'ativa') then
    raise exception 'contas_pagar_lancar_compra: esta compra ja tem lancamento financeiro ativo.';
  end if;

  v_total := public.contas_pagar_total_compra(p_pedido_id);
  if v_total is null then
    raise exception 'contas_pagar_lancar_compra: a compra nao tem valores recebidos completos (recebimento anterior ao controle detalhado) -- registre como despesa manual, se necessario.';
  end if;
  if v_total <= 0 then
    raise exception 'contas_pagar_lancar_compra: a compra nao tem valor a pagar (total R$ 0,00).';
  end if;
  v_data := public.contas_pagar_data_compra(p_pedido_id);

  insert into public.contas_pagar (origem, pedido_id, condicao, forma_prevista, observacao)
  values ('compra', p_pedido_id, p_condicao, p_forma_prevista, v_obs)
  returning id into v_conta_id;

  if p_condicao = 'no_ato' then
    insert into public.contas_pagar_parcelas (conta_id, numero, vencimento, valor)
    values (v_conta_id, 1, v_data, v_total)
    returning id into v_parcela;
    perform public.contas_pagar_registrar_baixa(v_parcela, coalesce(p_pago_em, v_data), p_forma_prevista, 0, 0, 0, null, null);
    v_soma := v_total;
  else
    v_soma := public.contas_pagar_inserir_parcelas(v_conta_id, p_parcelas, v_pedido.data_pedido);
    if v_soma <> v_total then
      raise exception 'contas_pagar_lancar_compra: a soma das parcelas (R$ %) precisa ser exatamente o total da compra (R$ %).', v_soma, v_total;
    end if;
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('conta_pagar', v_conta_id::text, 'criou', 'origem', null,
          format('compra=%s; condicao=%s; forma=%s; parcelas=%s; total=%s',
                 p_pedido_id, p_condicao, p_forma_prevista,
                 (select count(*) from public.contas_pagar_parcelas where conta_id = v_conta_id), v_total));
  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('pedido', p_pedido_id::text, 'lancou_financeiro', 'conta_pagar', null, v_conta_id::text);

  return v_conta_id;
end;
$$;

comment on function public.contas_pagar_lancar_compra(uuid, text, text, jsonb, date, text) is
  'Migration 0073. Lanca o financeiro de uma compra RECEBIDA com valores completos: total lido do banco (soma de valor_total_recebido), nunca do cliente. no_ato: 1 parcela + baixa imediata (exige contas_pagar.pagar). a_prazo: parcelas [{vencimento, valor}] com soma exata. Trava o pedido (FOR UPDATE); recusa segundo lancamento ativo. Requer contas_pagar.editar.';

-- 13.5 Recebimento + financeiro na MESMA transacao. Chama receber_pedido
-- (inalterada na regra; secao 12) e contas_pagar_lancar_compra -- se
-- qualquer uma falhar, nada e gravado. As permissoes financeiras sao
-- conferidas ANTES do recebimento (falha rapida, mensagem clara).
create or replace function public.receber_pedido_com_financeiro(
  p_pedido_id                uuid,
  p_data_recebimento         date,
  p_itens                    jsonb,
  p_condicao                 text,
  p_forma_prevista           text,
  p_parcelas                 jsonb,
  p_pago_em                  date,
  p_observacao_financeiro    text
)
returns public.pedidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos%rowtype;
begin
  if not (select public.has_permissao('contas_pagar.editar'))
     or (p_condicao = 'no_ato' and not (select public.has_permissao('contas_pagar.pagar'))) then
    raise exception using errcode = '42501',
      message = 'receber_pedido_com_financeiro: lancar o financeiro requer contas_pagar.editar (e contas_pagar.pagar no pagamento no ato) -- receba sem lancar o financeiro.';
  end if;

  v_pedido := public.receber_pedido(p_pedido_id, p_data_recebimento, p_itens);
  perform public.contas_pagar_lancar_compra(p_pedido_id, p_condicao, p_forma_prevista, p_parcelas, p_pago_em, p_observacao_financeiro);
  return v_pedido;
end;
$$;

comment on function public.receber_pedido_com_financeiro(uuid, date, jsonb, text, text, jsonb, date, text) is
  'Migration 0073. Wrapper transacional: receber_pedido + contas_pagar_lancar_compra atomicos. Nao escreve diretamente em pedidos/pedido_itens.';

create or replace function public.registrar_compra_presencial_com_financeiro(
  p_fornecedor_id            uuid,
  p_data_compra              date,
  p_numero_nota_fiscal       text,
  p_data_documento_fiscal    date,
  p_observacoes              text,
  p_itens                    jsonb,
  p_condicao                 text,
  p_forma_prevista           text,
  p_parcelas                 jsonb,
  p_pago_em                  date,
  p_observacao_financeiro    text
)
returns public.pedidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public.pedidos%rowtype;
begin
  if not (select public.has_permissao('contas_pagar.editar'))
     or (p_condicao = 'no_ato' and not (select public.has_permissao('contas_pagar.pagar'))) then
    raise exception using errcode = '42501',
      message = 'registrar_compra_presencial_com_financeiro: lancar o financeiro requer contas_pagar.editar (e contas_pagar.pagar no pagamento no ato) -- registre sem lancar o financeiro.';
  end if;

  v_pedido := public.registrar_compra_presencial(p_fornecedor_id, p_data_compra, p_numero_nota_fiscal, p_data_documento_fiscal, p_observacoes, p_itens);
  perform public.contas_pagar_lancar_compra(v_pedido.id, p_condicao, p_forma_prevista, p_parcelas, p_pago_em, p_observacao_financeiro);
  return v_pedido;
end;
$$;

comment on function public.registrar_compra_presencial_com_financeiro(uuid, date, text, date, text, jsonb, text, text, jsonb, date, text) is
  'Migration 0073. Wrapper transacional: registrar_compra_presencial + contas_pagar_lancar_compra atomicos. Nao escreve diretamente em pedidos/pedido_itens.';

-- 13.6 Despesa manual.
create or replace function public.contas_pagar_criar_manual(
  p_descricao       text,
  p_categoria_id    uuid,
  p_fornecedor_id   uuid,
  p_credor_nome     text,
  p_competencia     date,
  p_condicao        text,
  p_forma_prevista  text,
  p_parcelas        jsonb,
  p_pago_em         date,
  p_observacao      text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_descricao  text := public.contas_pagar_normalizar_nome(p_descricao);
  v_credor     text := public.contas_pagar_normalizar_nome(p_credor_nome);
  v_obs        text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_conta_id   uuid;
  v_parcela    uuid;
  v_valor      numeric;
  v_data       date;
  v_soma       numeric;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'contas_pagar_criar_manual: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('contas_pagar.editar')) then
    raise exception using errcode = '42501', message = 'contas_pagar_criar_manual: requer a permissao contas_pagar.editar.';
  end if;
  if p_condicao is null or p_condicao not in ('no_ato', 'a_prazo') then
    raise exception 'contas_pagar_criar_manual: condicao invalida (use no_ato ou a_prazo).';
  end if;
  if p_condicao = 'no_ato' and not (select public.has_permissao('contas_pagar.pagar')) then
    raise exception using errcode = '42501', message = 'contas_pagar_criar_manual: pagamento no ato requer a permissao contas_pagar.pagar.';
  end if;
  perform public.contas_pagar_validar_forma(p_forma_prevista);
  if p_condicao = 'no_ato' and p_forma_prevista = 'boleto' then
    raise exception 'contas_pagar_criar_manual: boleto nao e pagamento no ato -- use a prazo.';
  end if;
  if p_condicao = 'a_prazo' and p_forma_prevista in ('cartao_debito', 'cartao_credito') then
    raise exception 'contas_pagar_criar_manual: cartao e sempre pago no ato.';
  end if;

  if v_descricao is null then
    raise exception 'contas_pagar_criar_manual: descricao obrigatoria.';
  end if;
  if char_length(v_descricao) > 120 then
    raise exception 'contas_pagar_criar_manual: descricao com mais de 120 caracteres.';
  end if;
  if p_categoria_id is null
     or not exists (select 1 from public.contas_pagar_categorias where id = p_categoria_id and ativo) then
    raise exception 'contas_pagar_criar_manual: categoria inexistente ou inativa.';
  end if;
  if p_fornecedor_id is not null and v_credor is not null then
    raise exception 'contas_pagar_criar_manual: informe o fornecedor cadastrado OU o credor livre, nao os dois.';
  end if;
  if p_fornecedor_id is null and v_credor is null then
    raise exception 'contas_pagar_criar_manual: informe o fornecedor ou o credor.';
  end if;
  if p_fornecedor_id is not null
     and not exists (select 1 from public.fornecedores where id = p_fornecedor_id and ativo) then
    raise exception 'contas_pagar_criar_manual: fornecedor inexistente ou inativo.';
  end if;
  if v_credor is not null and char_length(v_credor) > 120 then
    raise exception 'contas_pagar_criar_manual: credor com mais de 120 caracteres.';
  end if;
  if p_competencia is null then
    raise exception 'contas_pagar_criar_manual: competencia obrigatoria.';
  end if;
  if v_obs is not null and char_length(v_obs) > 1000 then
    raise exception 'contas_pagar_criar_manual: observacao com mais de 1000 caracteres.';
  end if;

  insert into public.contas_pagar (origem, descricao, categoria_id, fornecedor_id, credor_nome, competencia, condicao, forma_prevista, observacao)
  values ('manual', v_descricao, p_categoria_id, p_fornecedor_id, v_credor,
          date_trunc('month', p_competencia)::date, p_condicao, p_forma_prevista, v_obs)
  returning id into v_conta_id;

  if p_condicao = 'no_ato' then
    if p_parcelas is null or jsonb_typeof(p_parcelas) <> 'array' or jsonb_array_length(p_parcelas) <> 1 then
      raise exception 'contas_pagar_criar_manual: pagamento no ato tem exatamente uma parcela (o valor pago).';
    end if;
    begin
      v_valor := (p_parcelas->0->>'valor')::numeric;
    exception when others then
      raise exception 'contas_pagar_criar_manual: valor invalido.';
    end;
    if v_valor is null or v_valor <= 0 or v_valor <> round(v_valor, 2) then
      raise exception 'contas_pagar_criar_manual: valor invalido (maior que zero, ate 2 casas decimais).';
    end if;
    v_data := coalesce(p_pago_em, public.contas_pagar_hoje());
    insert into public.contas_pagar_parcelas (conta_id, numero, vencimento, valor)
    values (v_conta_id, 1, v_data, v_valor)
    returning id into v_parcela;
    perform public.contas_pagar_registrar_baixa(v_parcela, v_data, p_forma_prevista, 0, 0, 0, null, null);
    v_soma := v_valor;
  else
    v_soma := public.contas_pagar_inserir_parcelas(v_conta_id, p_parcelas, null);
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('conta_pagar', v_conta_id::text, 'criou', 'origem', null,
          format('manual; descricao=%s; condicao=%s; forma=%s; parcelas=%s; total=%s',
                 v_descricao, p_condicao, p_forma_prevista,
                 (select count(*) from public.contas_pagar_parcelas where conta_id = v_conta_id), v_soma));

  return v_conta_id;
end;
$$;

comment on function public.contas_pagar_criar_manual(text, uuid, uuid, text, date, text, text, jsonb, date, text) is
  'Migration 0073. Cria despesa manual: descricao e credor em MAIUSCULAS; categoria ativa; fornecedor cadastrado ativo OU credor livre; competencia (mes); no_ato (1 parcela + baixa, exige contas_pagar.pagar) ou a_prazo (parcelas informadas; total = soma). Requer contas_pagar.editar.';

-- 13.7 Editar dados da conta (manual: descricao/categoria/credor/
-- competencia/observacao; compra: so observacao). Nunca mexe em parcelas
-- ou baixas.
create or replace function public.contas_pagar_editar_conta(
  p_conta_id       uuid,
  p_descricao      text,
  p_categoria_id   uuid,
  p_fornecedor_id  uuid,
  p_credor_nome    text,
  p_competencia    date,
  p_observacao     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes      public.contas_pagar%rowtype;
  v_descricao  text := public.contas_pagar_normalizar_nome(p_descricao);
  v_credor     text := public.contas_pagar_normalizar_nome(p_credor_nome);
  v_obs        text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_comp       date := date_trunc('month', p_competencia)::date;
begin
  if not (select public.has_permissao('contas_pagar.editar')) then
    raise exception using errcode = '42501', message = 'contas_pagar_editar_conta: requer a permissao contas_pagar.editar.';
  end if;
  select * into v_antes from public.contas_pagar where id = p_conta_id for update;
  if not found then
    raise exception 'contas_pagar_editar_conta: conta % nao encontrada.', p_conta_id;
  end if;
  if v_antes.status <> 'ativa' then
    raise exception 'contas_pagar_editar_conta: conta cancelada nao pode ser editada.';
  end if;
  if v_obs is not null and char_length(v_obs) > 1000 then
    raise exception 'contas_pagar_editar_conta: observacao com mais de 1000 caracteres.';
  end if;

  if v_antes.origem = 'compra' then
    if v_descricao is not null or p_categoria_id is not null or p_fornecedor_id is not null or v_credor is not null or p_competencia is not null then
      raise exception 'contas_pagar_editar_conta: conta de compra so permite editar a observacao (fornecedor e valores vem da compra).';
    end if;
    update public.contas_pagar set observacao = v_obs where id = p_conta_id;
  else
    if v_descricao is null or char_length(v_descricao) > 120 then
      raise exception 'contas_pagar_editar_conta: descricao obrigatoria (ate 120 caracteres).';
    end if;
    if p_categoria_id is null
       or (p_categoria_id is distinct from v_antes.categoria_id
           and not exists (select 1 from public.contas_pagar_categorias where id = p_categoria_id and ativo)) then
      raise exception 'contas_pagar_editar_conta: categoria inexistente ou inativa.';
    end if;
    if (p_fornecedor_id is not null) = (v_credor is not null) then
      raise exception 'contas_pagar_editar_conta: informe o fornecedor cadastrado OU o credor livre.';
    end if;
    if p_fornecedor_id is not null and p_fornecedor_id is distinct from v_antes.fornecedor_id
       and not exists (select 1 from public.fornecedores where id = p_fornecedor_id and ativo) then
      raise exception 'contas_pagar_editar_conta: fornecedor inexistente ou inativo.';
    end if;
    if v_credor is not null and char_length(v_credor) > 120 then
      raise exception 'contas_pagar_editar_conta: credor com mais de 120 caracteres.';
    end if;
    if v_comp is null then
      raise exception 'contas_pagar_editar_conta: competencia obrigatoria.';
    end if;
    update public.contas_pagar
       set descricao = v_descricao, categoria_id = p_categoria_id, fornecedor_id = p_fornecedor_id,
           credor_nome = v_credor, competencia = v_comp, observacao = v_obs
     where id = p_conta_id;
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  select 'conta_pagar', p_conta_id::text, 'editou', x.campo, x.antes, x.depois
    from (values
      ('descricao', v_antes.descricao, case when v_antes.origem = 'manual' then v_descricao else v_antes.descricao end),
      ('categoria_id', v_antes.categoria_id::text, case when v_antes.origem = 'manual' then p_categoria_id::text else v_antes.categoria_id::text end),
      ('fornecedor_id', v_antes.fornecedor_id::text, case when v_antes.origem = 'manual' then p_fornecedor_id::text else v_antes.fornecedor_id::text end),
      ('credor_nome', v_antes.credor_nome, case when v_antes.origem = 'manual' then v_credor else v_antes.credor_nome end),
      ('competencia', v_antes.competencia::text, case when v_antes.origem = 'manual' then v_comp::text else v_antes.competencia::text end),
      ('observacao', v_antes.observacao, v_obs)
    ) as x(campo, antes, depois)
   where x.antes is distinct from x.depois;
end;
$$;

comment on function public.contas_pagar_editar_conta(uuid, text, uuid, uuid, text, date, text) is
  'Migration 0073. Edita o cabecalho de uma conta ATIVA: manual (descricao/categoria/fornecedor ou credor/competencia/observacao) ou compra (so observacao). Auditoria campo a campo. Requer contas_pagar.editar.';

-- 13.8 Replanejar parcelas NAO pagas (vencimento/valor) e a forma
-- prevista (so a prazo). Parcelas pagas nunca mudam. Compra: a soma
-- continua exatamente o total da compra. Manual: o total pode mudar
-- (auditado).
create or replace function public.contas_pagar_replanejar(
  p_conta_id        uuid,
  p_forma_prevista  text,
  p_parcelas        jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conta        public.contas_pagar%rowtype;
  v_pendentes    uuid[];
  v_informadas   uuid[];
  v_item         record;
  v_parcela      public.contas_pagar_parcelas%rowtype;
  v_venc         date;
  v_valor        numeric;
  v_soma_antes   numeric;
  v_soma_depois  numeric;
  v_total        numeric;
  v_min          date;
begin
  if not (select public.has_permissao('contas_pagar.editar')) then
    raise exception using errcode = '42501', message = 'contas_pagar_replanejar: requer a permissao contas_pagar.editar.';
  end if;
  select * into v_conta from public.contas_pagar where id = p_conta_id for update;
  if not found then
    raise exception 'contas_pagar_replanejar: conta % nao encontrada.', p_conta_id;
  end if;
  if v_conta.status <> 'ativa' then
    raise exception 'contas_pagar_replanejar: conta cancelada nao pode ser replanejada.';
  end if;

  perform 1 from public.contas_pagar_parcelas where conta_id = p_conta_id for update;

  select coalesce(array_agg(pa.id order by pa.numero), array[]::uuid[]) into v_pendentes
    from public.contas_pagar_parcelas pa
   where pa.conta_id = p_conta_id
     and not exists (select 1 from public.contas_pagar_baixas b where b.parcela_id = pa.id and b.estornado_em is null);

  if p_parcelas is null or jsonb_typeof(p_parcelas) <> 'array' then
    raise exception 'contas_pagar_replanejar: informe a lista de parcelas pendentes.';
  end if;
  begin
    select coalesce(array_agg((e->>'parcela_id')::uuid), array[]::uuid[]) into v_informadas
      from jsonb_array_elements(p_parcelas) e;
  exception when others then
    raise exception 'contas_pagar_replanejar: parcela_id invalido.';
  end;
  if array_length(v_informadas, 1) is distinct from array_length(v_pendentes, 1)
     or (select count(distinct x) from unnest(v_informadas) x) <> coalesce(array_length(v_informadas, 1), 0)
     or not (v_informadas <@ v_pendentes and v_pendentes <@ v_informadas) then
    raise exception 'contas_pagar_replanejar: informe exatamente as parcelas ainda nao pagas desta conta (parcelas pagas nao podem ser alteradas).';
  end if;

  if p_forma_prevista is not null and p_forma_prevista is distinct from v_conta.forma_prevista then
    if v_conta.condicao <> 'a_prazo' then
      raise exception 'contas_pagar_replanejar: a forma de uma conta paga no ato nao muda.';
    end if;
    perform public.contas_pagar_validar_forma(p_forma_prevista);
    if p_forma_prevista in ('cartao_debito', 'cartao_credito') then
      raise exception 'contas_pagar_replanejar: cartao e sempre pago no ato.';
    end if;
  end if;

  select sum(valor) into v_soma_antes from public.contas_pagar_parcelas where conta_id = p_conta_id;
  v_min := case when v_conta.origem = 'compra' then (select data_pedido from public.pedidos where id = v_conta.pedido_id) end;

  for v_item in select e.value as item, e.ordinality as ord from jsonb_array_elements(p_parcelas) with ordinality e
  loop
    begin
      v_venc := (v_item.item->>'vencimento')::date;
      v_valor := (v_item.item->>'valor')::numeric;
    exception when others then
      raise exception 'contas_pagar_replanejar: parcela % com vencimento ou valor invalido.', v_item.ord;
    end;
    if v_venc is null or v_valor is null or v_valor <= 0 or v_valor <> round(v_valor, 2) then
      raise exception 'contas_pagar_replanejar: parcela % com vencimento ou valor invalido (valor maior que zero, ate 2 casas).', v_item.ord;
    end if;
    if v_min is not null and v_venc < v_min then
      raise exception 'contas_pagar_replanejar: vencimento (%) anterior a data da compra (%).', v_venc, v_min;
    end if;
    select * into v_parcela from public.contas_pagar_parcelas where id = (v_item.item->>'parcela_id')::uuid;
    if v_parcela.vencimento is distinct from v_venc then
      insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
      values ('conta_pagar', p_conta_id::text, 'replanejou', 'parcela ' || v_parcela.numero || ' vencimento', v_parcela.vencimento::text, v_venc::text);
    end if;
    if v_parcela.valor is distinct from v_valor then
      insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
      values ('conta_pagar', p_conta_id::text, 'replanejou', 'parcela ' || v_parcela.numero || ' valor', v_parcela.valor::text, v_valor::text);
    end if;
    update public.contas_pagar_parcelas set vencimento = v_venc, valor = v_valor where id = v_parcela.id;
  end loop;

  select sum(valor) into v_soma_depois from public.contas_pagar_parcelas where conta_id = p_conta_id;
  if v_conta.origem = 'compra' then
    v_total := public.contas_pagar_total_compra(v_conta.pedido_id);
    if v_soma_depois is distinct from v_total then
      raise exception 'contas_pagar_replanejar: a soma das parcelas (R$ %) precisa continuar igual ao total da compra (R$ %).', v_soma_depois, v_total;
    end if;
  elsif v_soma_depois <> v_soma_antes then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('conta_pagar', p_conta_id::text, 'replanejou', 'total', v_soma_antes::text, v_soma_depois::text);
  end if;

  if p_forma_prevista is not null and p_forma_prevista is distinct from v_conta.forma_prevista then
    update public.contas_pagar set forma_prevista = p_forma_prevista where id = p_conta_id;
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('conta_pagar', p_conta_id::text, 'replanejou', 'forma_prevista', v_conta.forma_prevista, p_forma_prevista);
  end if;
end;
$$;

comment on function public.contas_pagar_replanejar(uuid, text, jsonb) is
  'Migration 0073. Replaneja vencimento/valor das parcelas NAO pagas (todas devem ser informadas: [{parcela_id, vencimento, valor}]) e a forma prevista (so a prazo). Parcelas pagas nunca mudam. Compra: soma = total da compra. Auditoria campo a campo. Requer contas_pagar.editar.';

-- 13.9 Confirmar pagamento (integral) de uma parcela.
create or replace function public.contas_pagar_pagar_parcela(
  p_parcela_id       uuid,
  p_pago_em          date,
  p_forma_pagamento  text,
  p_juros            numeric,
  p_multa            numeric,
  p_desconto         numeric,
  p_valor_pago       numeric,
  p_observacao       text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select public.has_permissao('contas_pagar.pagar')) then
    raise exception using errcode = '42501', message = 'contas_pagar_pagar_parcela: requer a permissao contas_pagar.pagar.';
  end if;
  return public.contas_pagar_registrar_baixa(p_parcela_id, p_pago_em, p_forma_pagamento, p_juros, p_multa, p_desconto, p_valor_pago, p_observacao);
end;
$$;

comment on function public.contas_pagar_pagar_parcela(uuid, date, text, numeric, numeric, numeric, numeric, text) is
  'Migration 0073. Pagamento INTEGRAL de uma parcela pendente: valor_pago = valor original + juros + multa - desconto (p_valor_pago, quando informado, precisa conferir). Data nunca no futuro (America/Sao_Paulo). Requer contas_pagar.pagar.';

-- 13.10 Estorno logico de uma baixa.
create or replace function public.contas_pagar_estornar_baixa(p_baixa_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_baixa    public.contas_pagar_baixas%rowtype;
  v_parcela  public.contas_pagar_parcelas%rowtype;
  v_motivo   text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not (select public.has_permissao('contas_pagar.cancelar')) then
    raise exception using errcode = '42501', message = 'contas_pagar_estornar_baixa: requer a permissao contas_pagar.cancelar.';
  end if;
  if v_motivo is null then
    raise exception 'contas_pagar_estornar_baixa: o motivo do estorno e obrigatorio.';
  end if;
  if char_length(v_motivo) > 500 then
    raise exception 'contas_pagar_estornar_baixa: motivo com mais de 500 caracteres.';
  end if;
  select * into v_baixa from public.contas_pagar_baixas where id = p_baixa_id for update;
  if not found then
    raise exception 'contas_pagar_estornar_baixa: pagamento % nao encontrado.', p_baixa_id;
  end if;
  if v_baixa.estornado_em is not null then
    raise exception 'contas_pagar_estornar_baixa: este pagamento ja foi estornado.';
  end if;
  select * into v_parcela from public.contas_pagar_parcelas where id = v_baixa.parcela_id;

  update public.contas_pagar_baixas
     set estornado_em = now(), motivo_estorno = v_motivo
   where id = p_baixa_id;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('conta_pagar', v_parcela.conta_id::text, 'estornou_pagamento', 'parcela ' || v_parcela.numero,
          format('pago_em=%s; pago=%s; baixa=%s', v_baixa.pago_em, v_baixa.valor_pago, v_baixa.id), v_motivo);
end;
$$;

comment on function public.contas_pagar_estornar_baixa(uuid, text) is
  'Migration 0073. Estorno LOGICO de um pagamento (nunca DELETE): marca estornado_em/por/nome + motivo obrigatorio; a parcela volta a pendente por nao ter mais baixa ativa. Requer contas_pagar.cancelar.';

-- 13.11 Cancelar conta.
create or replace function public.contas_pagar_cancelar(p_conta_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conta   public.contas_pagar%rowtype;
  v_motivo  text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not (select public.has_permissao('contas_pagar.cancelar')) then
    raise exception using errcode = '42501', message = 'contas_pagar_cancelar: requer a permissao contas_pagar.cancelar.';
  end if;
  if v_motivo is null then
    raise exception 'contas_pagar_cancelar: o motivo do cancelamento e obrigatorio.';
  end if;
  if char_length(v_motivo) > 500 then
    raise exception 'contas_pagar_cancelar: motivo com mais de 500 caracteres.';
  end if;
  select * into v_conta from public.contas_pagar where id = p_conta_id for update;
  if not found then
    raise exception 'contas_pagar_cancelar: conta % nao encontrada.', p_conta_id;
  end if;
  if v_conta.status = 'cancelada' then
    raise exception 'contas_pagar_cancelar: esta conta ja esta cancelada.';
  end if;
  if exists (
    select 1 from public.contas_pagar_parcelas pa
      join public.contas_pagar_baixas b on b.parcela_id = pa.id and b.estornado_em is null
     where pa.conta_id = p_conta_id
  ) then
    raise exception 'contas_pagar_cancelar: a conta tem pagamento registrado -- estorne o(s) pagamento(s) antes de cancelar.';
  end if;

  update public.contas_pagar set status = 'cancelada', motivo_cancelamento = v_motivo where id = p_conta_id;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('conta_pagar', p_conta_id::text, 'cancelou', 'status', 'ativa', v_motivo);
  if v_conta.origem = 'compra' then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('pedido', v_conta.pedido_id::text, 'cancelou_financeiro', 'conta_pagar', p_conta_id::text, v_motivo);
  end if;
end;
$$;

comment on function public.contas_pagar_cancelar(uuid, text) is
  'Migration 0073. Cancelamento LOGICO da conta (motivo obrigatorio, autoria), so sem pagamento ativo -- estorne antes. Parcelas e baixas estornadas ficam no historico. Uma compra com lancamento cancelado volta a "Compras sem lancamento". Requer contas_pagar.cancelar.';

-- 13.12 Categorias de despesa.
create or replace function public.contas_pagar_salvar_categoria(p_id uuid, p_nome text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome   text := public.contas_pagar_normalizar_nome(p_nome);
  v_antes  text;
  v_id     uuid;
begin
  if not (select public.has_permissao('contas_pagar.editar')) then
    raise exception using errcode = '42501', message = 'contas_pagar_salvar_categoria: requer a permissao contas_pagar.editar.';
  end if;
  if v_nome is null then
    raise exception 'contas_pagar_salvar_categoria: nome da categoria obrigatorio.';
  end if;
  if char_length(v_nome) > 60 then
    raise exception 'contas_pagar_salvar_categoria: nome com mais de 60 caracteres.';
  end if;
  if exists (select 1 from public.contas_pagar_categorias where nome = v_nome and id is distinct from p_id) then
    raise exception 'contas_pagar_salvar_categoria: ja existe uma categoria com este nome.';
  end if;

  if p_id is null then
    insert into public.contas_pagar_categorias (nome) values (v_nome) returning id into v_id;
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('conta_pagar_categoria', v_id::text, 'criou', 'nome', null, v_nome);
  else
    select nome into v_antes from public.contas_pagar_categorias where id = p_id for update;
    if not found then
      raise exception 'contas_pagar_salvar_categoria: categoria % nao encontrada.', p_id;
    end if;
    update public.contas_pagar_categorias set nome = v_nome where id = p_id;
    v_id := p_id;
    if v_antes is distinct from v_nome then
      insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
      values ('conta_pagar_categoria', v_id::text, 'editou', 'nome', v_antes, v_nome);
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.contas_pagar_definir_categoria_ativa(p_id uuid, p_ativo boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes boolean;
begin
  if not (select public.has_permissao('contas_pagar.editar')) then
    raise exception using errcode = '42501', message = 'contas_pagar_definir_categoria_ativa: requer a permissao contas_pagar.editar.';
  end if;
  if p_ativo is null then
    raise exception 'contas_pagar_definir_categoria_ativa: informe ativo ou inativo.';
  end if;
  select ativo into v_antes from public.contas_pagar_categorias where id = p_id for update;
  if not found then
    raise exception 'contas_pagar_definir_categoria_ativa: categoria % nao encontrada.', p_id;
  end if;
  if v_antes is distinct from p_ativo then
    update public.contas_pagar_categorias set ativo = p_ativo where id = p_id;
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('conta_pagar_categoria', p_id::text, case when p_ativo then 'ativou' else 'inativou' end, 'ativo', v_antes::text, p_ativo::text);
  end if;
end;
$$;

-- Grants das RPCs publicas: so authenticated (anon, service_role e PUBLIC
-- revogados -- os default privileges do Supabase concedem a todos).
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.contas_pagar_lancar_compra(uuid, text, text, jsonb, date, text)',
    'public.receber_pedido_com_financeiro(uuid, date, jsonb, text, text, jsonb, date, text)',
    'public.registrar_compra_presencial_com_financeiro(uuid, date, text, date, text, jsonb, text, text, jsonb, date, text)',
    'public.contas_pagar_criar_manual(text, uuid, uuid, text, date, text, text, jsonb, date, text)',
    'public.contas_pagar_editar_conta(uuid, text, uuid, uuid, text, date, text)',
    'public.contas_pagar_replanejar(uuid, text, jsonb)',
    'public.contas_pagar_pagar_parcela(uuid, date, text, numeric, numeric, numeric, numeric, text)',
    'public.contas_pagar_estornar_baixa(uuid, text)',
    'public.contas_pagar_cancelar(uuid, text)',
    'public.contas_pagar_salvar_categoria(uuid, text)',
    'public.contas_pagar_definir_categoria_ativa(uuid, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ============================================================
-- 14. Leitura -- funcoes SECURITY DEFINER (NAO views).
-- ============================================================
-- Decisao (revisada antes da implantacao): views com security_invoker =
-- true sao INCOMPATIVEIS com o requisito -- quem tem contas_pagar.
-- visualizar (ex.: financeiro_administrativo) nao tem pedidos.visualizar
-- nem fornecedores.visualizar, entao a RLS de pedidos/pedido_itens/
-- fornecedores esconderia credor, data e total da compra. Conceder
-- SELECT nessas tabelas (policy nova) abriria TODAS as colunas de TODOS
-- os pedidos/itens/fornecedores -- acesso amplo, recusado. Views com o
-- privilegio do dono (security definer view) sao o que o Advisor aponta
-- e dependem so de um WHERE para nao vazar.
-- Escolha: 4 funcoes SECURITY DEFINER (mesmo padrao de autorizacao das
-- RPCs do projeto): search_path vazio, checagem explicita de
-- contas_pagar.visualizar (42501 se faltar), EXECUTE so para
-- authenticated, e saida restrita as colunas que o Financeiro precisa
-- (nome do fornecedor, data/modalidade/nota da compra, total). Nenhuma
-- view e criada; as tabelas contas_pagar* seguem lidas pela propria RLS.
-- O PostgREST aplica filtros/ordenacao sobre o resultado (rpc + filtros).

create or replace function public.contas_pagar_exigir_visualizar()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select public.has_permissao('contas_pagar.visualizar')) then
    raise exception using errcode = '42501',
      message = 'contas_pagar: requer a permissao contas_pagar.visualizar.';
  end if;
end;
$$;

-- 14.1 Contas (1 linha por conta, situacao DERIVADA).
create or replace function public.contas_pagar_listar_contas()
returns table (
  id                   uuid,
  origem               text,
  pedido_id            uuid,
  condicao             text,
  forma_prevista       text,
  status               text,
  observacao           text,
  descricao            text,
  categoria_id         uuid,
  categoria_nome       text,
  competencia          date,
  fornecedor_id        uuid,
  credor_exibicao      text,
  credor_nome          text,
  data_pedido          date,
  modalidade_compra    text,
  numero_nota_fiscal   text,
  data_compra          date,
  cancelada_em         timestamptz,
  cancelada_por_nome   text,
  motivo_cancelamento  text,
  criado_em            timestamptz,
  criado_por_nome      text,
  qtd_parcelas         integer,
  qtd_pagas            integer,
  valor_total          numeric,
  valor_em_aberto      numeric,
  valor_pago           numeric,
  proximo_vencimento   date,
  situacao             text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.contas_pagar_exigir_visualizar();

  return query
  select
    c.id,
    c.origem,
    c.pedido_id,
    c.condicao,
    c.forma_prevista,
    c.status,
    c.observacao,
    c.descricao,
    c.categoria_id,
    cat.nome::text,
    c.competencia,
    coalesce(c.fornecedor_id, p.fornecedor_id),
    coalesce(f.nome_fantasia, f.razao_social, f.nome, c.credor_nome)::text,
    c.credor_nome,
    p.data_pedido,
    p.modalidade_compra::text,
    p.numero_nota_fiscal::text,
    case
      when c.origem = 'compra' and p.modalidade_compra = 'compra_presencial' then p.data_pedido
      when c.origem = 'compra' then coalesce(p.data_recebimento, (p.recebido_em at time zone 'America/Sao_Paulo')::date)
    end,
    c.cancelada_em,
    c.cancelada_por_nome,
    c.motivo_cancelamento,
    c.criado_em,
    c.criado_por_nome,
    agg.qtd_parcelas,
    agg.qtd_pagas,
    agg.valor_total,
    agg.valor_em_aberto,
    agg.valor_pago,
    agg.proximo_vencimento,
    case
      when c.status = 'cancelada' then 'cancelada'
      when agg.qtd_pagas = agg.qtd_parcelas then 'paga'
      when agg.qtd_pagas > 0 then 'parcial'
      else 'pendente'
    end::text
  from public.contas_pagar c
  left join public.pedidos p on p.id = c.pedido_id
  left join public.fornecedores f on f.id = coalesce(c.fornecedor_id, p.fornecedor_id)
  left join public.contas_pagar_categorias cat on cat.id = c.categoria_id
  cross join lateral (
    select
      count(*)::integer as qtd_parcelas,
      count(b.id)::integer as qtd_pagas,
      coalesce(sum(pa.valor), 0)::numeric as valor_total,
      coalesce(sum(pa.valor) filter (where b.id is null), 0)::numeric as valor_em_aberto,
      coalesce(sum(b.valor_pago), 0)::numeric as valor_pago,
      min(pa.vencimento) filter (where b.id is null) as proximo_vencimento
    from public.contas_pagar_parcelas pa
    left join public.contas_pagar_baixas b on b.parcela_id = pa.id and b.estornado_em is null
    where pa.conta_id = c.id
  ) agg;
end;
$$;

comment on function public.contas_pagar_listar_contas() is
  'Migration 0073. Leitura. 1 linha por conta: credor (fornecedor da compra, fornecedor cadastrado ou credor livre), dados minimos da compra, totais e situacao DERIVADA (pendente/parcial/paga/cancelada). Exige contas_pagar.visualizar (42501).';

-- 14.2 Parcelas (1 linha por parcela, com a baixa ATIVA se houver).
create or replace function public.contas_pagar_listar_parcelas()
returns table (
  id                    uuid,
  conta_id              uuid,
  numero                integer,
  total_parcelas        integer,
  vencimento            date,
  valor                 numeric,
  origem                text,
  pedido_id             uuid,
  condicao              text,
  forma_prevista        text,
  status_conta          text,
  descricao             text,
  categoria_id          uuid,
  categoria_nome        text,
  competencia           date,
  fornecedor_id         uuid,
  credor_exibicao       text,
  data_compra           date,
  modalidade_compra     text,
  baixa_id              uuid,
  pago_em               date,
  forma_pagamento       text,
  juros                 numeric,
  multa                 numeric,
  desconto              numeric,
  valor_pago            numeric,
  observacao_pagamento  text,
  registrado_por_nome   text,
  registrado_em         timestamptz,
  situacao              text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.contas_pagar_exigir_visualizar();

  return query
  select
    pa.id,
    pa.conta_id,
    pa.numero::integer,
    (select count(*)::integer from public.contas_pagar_parcelas x where x.conta_id = pa.conta_id),
    pa.vencimento,
    pa.valor::numeric,
    c.origem,
    c.pedido_id,
    c.condicao,
    c.forma_prevista,
    c.status,
    c.descricao,
    c.categoria_id,
    cat.nome::text,
    c.competencia,
    coalesce(c.fornecedor_id, p.fornecedor_id),
    coalesce(f.nome_fantasia, f.razao_social, f.nome, c.credor_nome)::text,
    case
      when c.origem = 'compra' and p.modalidade_compra = 'compra_presencial' then p.data_pedido
      when c.origem = 'compra' then coalesce(p.data_recebimento, (p.recebido_em at time zone 'America/Sao_Paulo')::date)
    end,
    p.modalidade_compra::text,
    b.id,
    b.pago_em,
    b.forma_pagamento,
    b.juros::numeric,
    b.multa::numeric,
    b.desconto::numeric,
    b.valor_pago::numeric,
    b.observacao,
    b.registrado_por_nome,
    b.registrado_em,
    case
      when c.status = 'cancelada' then 'cancelada'
      when b.id is not null then 'paga'
      else 'pendente'
    end::text
  from public.contas_pagar_parcelas pa
  join public.contas_pagar c on c.id = pa.conta_id
  left join public.pedidos p on p.id = c.pedido_id
  left join public.fornecedores f on f.id = coalesce(c.fornecedor_id, p.fornecedor_id)
  left join public.contas_pagar_categorias cat on cat.id = c.categoria_id
  left join public.contas_pagar_baixas b on b.parcela_id = pa.id and b.estornado_em is null;
end;
$$;

comment on function public.contas_pagar_listar_parcelas() is
  'Migration 0073. Leitura. 1 linha por parcela com a baixa ATIVA (se houver). situacao derivada: cancelada (conta cancelada) / paga (baixa ativa) / pendente. "Vencida" e calculada pela interface (pendente e vencimento < hoje em America/Sao_Paulo). Exige contas_pagar.visualizar (42501).';

-- 14.3 Compras recebidas SEM lancamento financeiro ativo.
create or replace function public.contas_pagar_listar_compras_sem_lancamento()
returns table (
  pedido_id             uuid,
  fornecedor_id         uuid,
  fornecedor_nome       text,
  modalidade_compra     text,
  data_pedido           date,
  data_compra           date,
  recebido_em           timestamptz,
  numero_nota_fiscal    text,
  qtd_itens             integer,
  total                 numeric,
  elegivel              boolean,
  anterior_implantacao  boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.contas_pagar_exigir_visualizar();

  return query
  select
    p.id,
    p.fornecedor_id,
    coalesce(f.nome_fantasia, f.razao_social, f.nome)::text,
    p.modalidade_compra::text,
    p.data_pedido,
    case
      when p.modalidade_compra = 'compra_presencial' then p.data_pedido
      else coalesce(p.data_recebimento, (p.recebido_em at time zone 'America/Sao_Paulo')::date)
    end,
    p.recebido_em,
    p.numero_nota_fiscal::text,
    it.qtd_itens,
    case when it.qtd_itens > 0 and it.qtd_com_valor = it.qtd_itens then it.total end,
    (it.qtd_itens > 0 and it.qtd_com_valor = it.qtd_itens and it.total > 0),
    (p.recebido_em < cfg.implantado_em)
  from public.pedidos p
  cross join public.contas_pagar_config cfg
  left join public.fornecedores f on f.id = p.fornecedor_id
  cross join lateral (
    select count(*)::integer as qtd_itens,
           count(pi.valor_total_recebido)::integer as qtd_com_valor,
           sum(pi.valor_total_recebido)::numeric as total
      from public.pedido_itens pi
     where pi.pedido_id = p.id
  ) it
  where p.status = 'recebido'
    and not exists (select 1 from public.contas_pagar c where c.pedido_id = p.id and c.status = 'ativa');
end;
$$;

comment on function public.contas_pagar_listar_compras_sem_lancamento() is
  'Migration 0073. Leitura. Compras recebidas SEM lancamento financeiro ativo -- so cabecalho minimo (fornecedor, datas, nota, quantidade de itens, total), nunca os itens. A fila "Compras sem lancamento" e elegivel AND NOT anterior_implantacao. Exige contas_pagar.visualizar (42501).';

-- 14.4 Fornecedores para escolha/filtro no Financeiro: so id, nome de
-- exibicao e ativo (quem tem so contas_pagar.visualizar nao le a tabela
-- fornecedores, que exige fornecedores.visualizar).
create or replace function public.contas_pagar_listar_fornecedores()
returns table (
  id     uuid,
  nome   text,
  ativo  boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.contas_pagar_exigir_visualizar();

  return query
  select f.id, coalesce(f.nome_fantasia, f.razao_social, f.nome, f.id::text)::text, f.ativo
    from public.fornecedores f;
end;
$$;

comment on function public.contas_pagar_listar_fornecedores() is
  'Migration 0073. Leitura minima de fornecedores (id, nome de exibicao, ativo) para o Financeiro. Exige contas_pagar.visualizar (42501).';

revoke execute on function public.contas_pagar_exigir_visualizar() from public, anon, authenticated, service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.contas_pagar_listar_contas()',
    'public.contas_pagar_listar_parcelas()',
    'public.contas_pagar_listar_compras_sem_lancamento()',
    'public.contas_pagar_listar_fornecedores()'
  ] loop
    execute format('revoke execute on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO: apaga TODO o historico financeiro lancado (contas, parcelas,
-- pagamentos, estornos). So use antes de haver uso real, ou depois de
-- exportar os dados. pedidos.data_recebimento tambem e removida.
-- BEGIN;
-- drop function if exists public.contas_pagar_listar_fornecedores();
-- drop function if exists public.contas_pagar_listar_compras_sem_lancamento();
-- drop function if exists public.contas_pagar_listar_parcelas();
-- drop function if exists public.contas_pagar_listar_contas();
-- drop function if exists public.contas_pagar_exigir_visualizar();
-- drop function if exists public.receber_pedido_com_financeiro(uuid, date, jsonb, text, text, jsonb, date, text);
-- drop function if exists public.registrar_compra_presencial_com_financeiro(uuid, date, text, date, text, jsonb, text, text, jsonb, date, text);
-- drop function if exists public.contas_pagar_lancar_compra(uuid, text, text, jsonb, date, text);
-- drop function if exists public.contas_pagar_criar_manual(text, uuid, uuid, text, date, text, text, jsonb, date, text);
-- drop function if exists public.contas_pagar_editar_conta(uuid, text, uuid, uuid, text, date, text);
-- drop function if exists public.contas_pagar_replanejar(uuid, text, jsonb);
-- drop function if exists public.contas_pagar_pagar_parcela(uuid, date, text, numeric, numeric, numeric, numeric, text);
-- drop function if exists public.contas_pagar_estornar_baixa(uuid, text);
-- drop function if exists public.contas_pagar_cancelar(uuid, text);
-- drop function if exists public.contas_pagar_salvar_categoria(uuid, text);
-- drop function if exists public.contas_pagar_definir_categoria_ativa(uuid, boolean);
-- drop trigger if exists pedidos_financeiro_protecao_trigger on public.pedidos;
-- drop trigger if exists pedidos_contas_pagar_verificar_trigger on public.pedidos;
-- drop trigger if exists pedido_itens_contas_pagar_verificar_trigger on public.pedido_itens;
-- drop table if exists public.contas_pagar_baixas;
-- drop table if exists public.contas_pagar_parcelas;
-- drop table if exists public.contas_pagar;
-- drop table if exists public.contas_pagar_categorias;
-- drop table if exists public.contas_pagar_config;
-- drop function if exists public.pedidos_financeiro_protecao();
-- drop function if exists public.contas_pagar_verificar_trigger_fn();
-- drop function if exists public.contas_pagar_verificar_conta(uuid);
-- drop function if exists public.contas_pagar_registrar_baixa(uuid, date, text, numeric, numeric, numeric, numeric, text);
-- drop function if exists public.contas_pagar_inserir_parcelas(uuid, jsonb, date);
-- drop function if exists public.contas_pagar_validar_forma(text);
-- drop function if exists public.contas_pagar_protecao();
-- drop function if exists public.contas_pagar_parcelas_protecao();
-- drop function if exists public.contas_pagar_baixas_protecao();
-- drop function if exists public.contas_pagar_config_protecao();
-- drop function if exists public.contas_pagar_categorias_protecao();
-- drop function if exists public.contas_pagar_data_compra(uuid);
-- drop function if exists public.contas_pagar_total_compra(uuid);
-- drop function if exists public.contas_pagar_nome_usuario();
-- drop function if exists public.contas_pagar_normalizar_nome(text);
-- drop function if exists public.contas_pagar_hoje();
-- delete from public.perfil_permissoes where permissao like 'contas_pagar.%';
-- delete from public.usuario_permissoes where permissao like 'contas_pagar.%';
-- delete from public.permissoes where codigo like 'contas_pagar.%';
-- -- pedido_itens_protecao / editar_compra_presencial /
-- -- reabrir_recebimento_pedido: recriar as versoes da 0051 / 0037 / 0052
-- -- (copiar dos arquivos) e so entao:
-- drop trigger if exists pedido_itens_reabertura_coerente_trigger on public.pedido_itens;
-- drop function if exists public.pedido_itens_reabertura_coerente();
-- drop function if exists public.pedido_itens_reabertura_autorizada(uuid);
-- drop function if exists public.pedido_itens_correcao_presencial_autorizada(uuid);
-- -- receber_pedido: recriar a versao da 0051 (secao "create or replace
-- -- function public.receber_pedido" de 0051_pedidos_sacos_integracao_
-- -- recebimento.sql) ANTES de remover a coluna.
-- alter table public.pedidos drop column if exists data_recebimento;
-- COMMIT;
