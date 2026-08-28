-- 0022_pedidos_fase_a_estrutura.sql
-- Fase A do modulo de Pedidos/Compras: estrutura essencial de pedidos a
-- fornecedores (cabecalho + itens), sem calendario automatico (Fase B),
-- sem recebimento por item/divergencia (Fase C), sem cotacao (Fase D), sem
-- documentos fiscais (Fase E) e sem qualquer consumo pelo Dashboard (Fase F
-- -- fora de escopo desta migration).
--
-- RASCUNHO EM AUDITORIA -- NAO COPIAR PARA supabase/migrations/ NEM EXECUTAR
-- ate autorizacao explicita. Gerado em scratchpad para revisao estatica,
-- SHA-256 e classificacao de risco.
--
-- Pre-requisitos: 0001..0021 ja aplicadas (usa public.has_permissao(),
-- public.is_admin(), public.logs_auditoria, public.fornecedores,
-- public.produtos -- nenhuma delas alterada aqui).
--
-- NAO TOCA em Dashboard, Producao ou Fornecedores -- nenhuma tabela,
-- coluna, funcao, trigger ou policy dessas frentes e criada, alterada ou
-- removida por este arquivo. A unica leitura feita em public.fornecedores
-- e public.produtos e dentro de criar_pedido(), para validar existencia/
-- estado -- nunca um INSERT/UPDATE/DELETE nessas duas tabelas.
--
-- Numeracao: 0021_dashboard_lembretes.sql (outra frente) e a ultima
-- migration publicada em origin/main (commit 5d1425c) no momento em que
-- este arquivo foi gerado -- 0022 foi reservada e confirmada livre antes
-- de escrever este arquivo.
--
-- ============================================================
-- DECISOES DE DESENHO JA APROVADAS (recapituladas aqui para quem ler este
-- arquivo isoladamente, sem o historico da conversa que o desenhou):
-- ============================================================
--   * fornecedor_regras_pedido (migration 0007) NAO e tocada -- a Fase B
--     (calendario automatico de previsao_entrega) vai so LER essa tabela
--     ja existente, nunca duplicar.
--   * Sem coluna valor_total (nem em pedidos, nem em pedido_itens) --
--     sempre derivado por soma dos itens, para nunca dessincronizar
--     cabecalho x itens.
--   * Sem coluna quantidade_recebida em pedido_itens nesta fase -- ainda
--     nao sabemos a forma certa (pode precisar de tabela propria de
--     remessas na Fase C); adicionar agora sem consumidor seria ruido.
--   * Sem coluna "atrasado" -- e sempre derivado por
--     (status='aguardando_entrega' AND previsao_entrega < hoje), com
--     "hoje" calculado no FRONTEND via lib/data/dataLocal.js
--     (America/Sao_Paulo), nunca via current_date/now() do Postgres --
--     evita risco de fuso horario (Supabase roda em UTC por padrao).
--   * Sem pedidos.excluir -- nao existe exclusao fisica de pedido nesta
--     arquitetura. Erro/desistencia usa status=cancelado, com motivo
--     obrigatorio, preservando cabecalho e itens.
--   * criar_pedido() e SECURITY DEFINER; marcar_pedido_recebido() e
--     cancelar_pedido() sao SECURITY INVOKER. Justificativa completa no
--     comentario da propria funcao criar_pedido(), secao 8 abaixo.
--   * A trigger pedidos_protecao e a UNICA fonte de autorizacao de
--     transicao de status E da auditoria de recebimento/cancelamento --
--     as RPCs de transicao sao wrappers finos, nao duplicam nada disso.
--     Isso garante que uma chamada direta ao Supabase (bypassando as
--     RPCs), com a permissao certa, e tao protegida e tao auditada quanto
--     uma chamada via RPC -- nao existe caminho "menos protegido".
--   * criar_pedido() so aceita fornecedor com
--     modalidade_compra='pedido_com_entrega' (coluna ja existente em
--     fornecedores, migration 0007) -- compra_presencial fica fora do
--     fluxo de Pedidos por desenho (ver comentario na propria funcao).
--
-- ACHADO NA AUDITORIA PRE-EXECUCAO DESTA MIGRATION (nao previsto no
-- desenho original): existe um PAR de tabelas LEGADAS, criadas fora do
-- historico de migrations deste repositorio (nenhuma migration
-- 0001..0021 cria nenhuma das duas -- mesma situacao de usuarios antes da
-- 0002 e de produtos, que nunca teve migration de criacao):
--   * public.pedidos -- estrutura incompativel com o desenho desta Fase A
--     (numero_pedido, data_entrega_esperada, data_entrega_real,
--     valor_total, status com check diferente -- sem RLS/policy/trigger
--     nenhuma no proposito desta frente);
--   * public.itens_pedidos -- descoberta na pre-auditoria como a origem
--     da unica FK externa apontando para public.pedidos
--     (itens_pedidos_pedido_id_fkey), com FK propria adicional para
--     public.produtos(id).
-- Confirmado por auditoria read-only, antes desta migration ser escrita:
-- as duas com 0 registros, sem uso em nenhum lugar do repositorio
-- (frontend ou migrations), e nenhuma FK externa alem da que liga as duas
-- entre si. A secao 0 abaixo REVALIDA tudo isso em tempo de execucao --
-- nao confia somente nesta auditoria previa -- valida as DUAS tabelas por
-- completo antes de remover qualquer uma delas, e so remove se a
-- assinatura estrutural completa do PAR bater exatamente com o legado
-- conhecido; caso contrario aborta a migration inteira sem remover nada.
-- Um estado parcial (uma existir sem a outra) tambem aborta -- nunca e
-- tratado como banco limpo.

BEGIN;

-- ============================================================
-- 0. REMOCAO DEFENSIVA do PAR de estruturas legadas: public.pedidos +
--    public.itens_pedidos
-- ============================================================
-- Achado na pre-auditoria desta migration: alem de public.pedidos
-- (legada, fora do historico de migrations -- ver comentario de
-- cabecalho), existe uma FK externa apontando para ela, vinda de uma
-- SEGUNDA tabela legada, public.itens_pedidos (tambem fora do historico
-- de migrations, tambem 0 registros, tambem sem uso confirmado em
-- nenhum lugar do repositorio).
--
-- As duas sao validadas por COMPLETO antes de qualquer DROP -- nenhum
-- DROP acontece antes de as DUAS terem passado em todas as checagens.
-- So depois disso, na ordem obrigatoria itens_pedidos (filha) primeiro,
-- pedidos (pai) depois -- porque a FK itens_pedidos_pedido_id_fkey
-- (RESTRICT implicito do Postgres, sem CASCADE em lugar nenhum deste
-- arquivo) impediria remover o pai primeiro enquanto a filha ainda
-- existisse.
--
-- Estado parcial (uma existe sem a outra) NUNCA e tratado como "banco
-- limpo" -- aborta com excecao propria, distinta da checagem de
-- assinatura estrutural. So os dois extremos sao aceitos sem excecao:
-- nenhuma das duas existe (banco limpo, segue normal), ou as duas
-- existem E batem exatamente com a assinatura legada conhecida (validada
-- por completo, depois removidas). Qualquer outra combinacao aborta a
-- migration inteira, sem remover nada.
do $$
declare
  v_pedidos_existe        boolean;
  v_itens_pedidos_existe  boolean;

  -- public.pedidos (legada)
  v_linhas                bigint;
  v_total_colunas         integer;
  v_colunas_conferem      integer;
  v_nulabilidade_ok       boolean;
  v_total_constraints     integer;
  v_pk_ok                 boolean;
  v_unique_ok             boolean;
  v_fk_ok                 boolean;
  v_check_def             text;
  v_valores_encontrados   text[];
  v_rls_ativa             boolean;
  v_force_rls             boolean;
  v_total_policies        integer;
  v_total_triggers        integer;
  v_fks_externas_pedidos  integer;
  v_indices_encontrados   text;

  -- public.itens_pedidos (legada)
  v_ip_linhas              bigint;
  v_ip_total_colunas       integer;
  v_ip_colunas_conferem    integer;
  v_ip_nulabilidade_ok     boolean;
  v_ip_total_constraints   integer;
  v_ip_pk_ok               boolean;
  v_ip_fk_pedido_ok        boolean;
  v_ip_fk_produto_ok       boolean;
  v_ip_rls_ativa           boolean;
  v_ip_force_rls           boolean;
  v_ip_total_policies      integer;
  v_ip_total_triggers      integer;
  v_ip_fks_externas        integer;
  v_ip_indices_encontrados text;
begin
  select exists (select 1 from pg_tables where schemaname='public' and tablename='pedidos') into v_pedidos_existe;
  select exists (select 1 from pg_tables where schemaname='public' and tablename='itens_pedidos') into v_itens_pedidos_existe;

  if not v_pedidos_existe and not v_itens_pedidos_existe then
    raise notice 'Nem public.pedidos nem public.itens_pedidos existem -- banco limpo, seguindo normalmente.';

  elsif v_pedidos_existe and not v_itens_pedidos_existe then
    raise exception 'Migration 0022 abortada: public.pedidos (legada) existe mas public.itens_pedidos nao existe -- estado parcial inesperado, nao reconhecido nem como banco limpo nem como o par legado completo conhecido. Investigar manualmente.';

  elsif not v_pedidos_existe and v_itens_pedidos_existe then
    raise exception 'Migration 0022 abortada: public.itens_pedidos existe mas public.pedidos nao existe -- estado parcial inesperado. Investigar manualmente.';

  else
    -- ============================================================
    -- Validacao completa de public.pedidos (legada) -- exceto a FK
    -- externa, que so e confirmada depois de itens_pedidos tambem
    -- estar validada (checagem cruzada, ao final).
    -- ============================================================
    execute 'select count(*) from public.pedidos' into v_linhas;
    if v_linhas <> 0 then
      raise exception 'Migration 0022 abortada: public.pedidos (legada) contem % registro(s) -- remocao automatica bloqueada. Trate manualmente antes de reexecutar.', v_linhas;
    end if;

    select count(*) into v_total_colunas
      from information_schema.columns
      where table_schema = 'public' and table_name = 'pedidos';

    select count(*) into v_colunas_conferem
      from information_schema.columns c
      join (values
        ('id',                     'uuid'),
        ('numero_pedido',          'character varying'),
        ('fornecedor_id',          'uuid'),
        ('data_pedido',            'date'),
        ('data_entrega_esperada',  'date'),
        ('data_entrega_real',      'date'),
        ('status',                 'character varying'),
        ('valor_total',            'numeric'),
        ('observacoes',            'text'),
        ('criado_em',              'timestamp without time zone'),
        ('atualizado_em',          'timestamp without time zone')
      ) as esperado(coluna, tipo)
        on c.column_name = esperado.coluna and c.data_type = esperado.tipo
      where c.table_schema = 'public' and c.table_name = 'pedidos';

    if v_total_colunas <> 11 or v_colunas_conferem <> 11 then
      raise exception 'Migration 0022 abortada: public.pedidos tem % coluna(s) no total, % batendo com a assinatura legada esperada (esperado: 11 e 11).', v_total_colunas, v_colunas_conferem;
    end if;

    select bool_and(is_nullable = 'NO') into v_nulabilidade_ok
      from information_schema.columns
      where table_schema = 'public' and table_name = 'pedidos'
        and column_name in ('id', 'fornecedor_id', 'data_pedido');

    if v_nulabilidade_ok is not true then
      raise exception 'Migration 0022 abortada: public.pedidos nao tem id/fornecedor_id/data_pedido todos NOT NULL como esperado no legado.';
    end if;

    select count(*) into v_total_constraints
      from pg_constraint where conrelid = 'public.pedidos'::regclass;

    if v_total_constraints <> 4 then
      raise exception 'Migration 0022 abortada: public.pedidos tem % constraint(s), esperado exatamente 4 (pedidos_pkey, pedidos_numero_pedido_key, pedidos_fornecedor_id_fkey, pedidos_status_check).', v_total_constraints;
    end if;

    select exists (
      select 1 from pg_constraint
      where conrelid = 'public.pedidos'::regclass and conname = 'pedidos_pkey' and contype = 'p'
    ) into v_pk_ok;

    select exists (
      select 1 from pg_constraint
      where conrelid = 'public.pedidos'::regclass and conname = 'pedidos_numero_pedido_key' and contype = 'u'
    ) into v_unique_ok;

    -- Reforco conkey/confkey (mesma tecnica ja documentada nas migrations
    -- 0002/0002b deste projeto): nome+tipo+tabela-referenciada nao bastam
    -- para garantir QUAL coluna aponta para QUAL -- confirma explicitamente
    -- fornecedor_id -> fornecedores(id) pelas posicoes reais de coluna.
    select exists (
      select 1 from pg_constraint
      where conrelid = 'public.pedidos'::regclass and conname = 'pedidos_fornecedor_id_fkey'
        and contype = 'f' and confrelid = 'public.fornecedores'::regclass
        and conkey = array[(select attnum from pg_attribute where attrelid = 'public.pedidos'::regclass and attname = 'fornecedor_id')]
        and confkey = array[(select attnum from pg_attribute where attrelid = 'public.fornecedores'::regclass and attname = 'id')]
    ) into v_fk_ok;

    if not (v_pk_ok and v_unique_ok and v_fk_ok) then
      raise exception 'Migration 0022 abortada: pk/unique/fk de public.pedidos nao correspondem ao legado esperado por nome, tipo ou tabela referenciada.';
    end if;

    select pg_get_constraintdef(oid) into v_check_def
      from pg_constraint
      where conrelid = 'public.pedidos'::regclass and conname = 'pedidos_status_check';

    if v_check_def is null then
      raise exception 'Migration 0022 abortada: pedidos_status_check nao encontrada em public.pedidos.';
    end if;

    select array_agg(m[1] order by m[1]) into v_valores_encontrados
      from regexp_matches(v_check_def, '''([a-z]+)''', 'g') as m;

    if v_valores_encontrados is distinct from array['cancelado','confirmado','entregue','pendente'] then
      raise exception 'Migration 0022 abortada: pedidos_status_check nao corresponde exatamente aos valores esperados (pendente, confirmado, entregue, cancelado) -- encontrado: %.', v_valores_encontrados;
    end if;

    select relrowsecurity, relforcerowsecurity into v_rls_ativa, v_force_rls
      from pg_class where oid = 'public.pedidos'::regclass;

    if v_rls_ativa is not true or v_force_rls is not false then
      raise exception 'Migration 0022 abortada: RLS de public.pedidos fora do estado esperado (rowsecurity=true, force=false) -- encontrado rowsecurity=%, force=%.', v_rls_ativa, v_force_rls;
    end if;

    select count(*) into v_total_policies
      from pg_policies where schemaname = 'public' and tablename = 'pedidos';

    if v_total_policies <> 0 then
      raise exception 'Migration 0022 abortada: public.pedidos tem % policy(ies) inesperada(s) -- esperado 0.', v_total_policies;
    end if;

    select count(*) into v_total_triggers
      from pg_trigger where tgrelid = 'public.pedidos'::regclass and not tgisinternal;

    if v_total_triggers <> 0 then
      raise exception 'Migration 0022 abortada: public.pedidos tem % trigger(s) nao interno(s) inesperado(s) -- esperado 0.', v_total_triggers;
    end if;

    -- ============================================================
    -- Validacao completa de public.itens_pedidos (legada)
    -- ============================================================
    execute 'select count(*) from public.itens_pedidos' into v_ip_linhas;
    if v_ip_linhas <> 0 then
      raise exception 'Migration 0022 abortada: public.itens_pedidos (legada) contem % registro(s) -- remocao automatica bloqueada. Trate manualmente antes de reexecutar.', v_ip_linhas;
    end if;

    select count(*) into v_ip_total_colunas
      from information_schema.columns
      where table_schema = 'public' and table_name = 'itens_pedidos';

    select count(*) into v_ip_colunas_conferem
      from information_schema.columns c
      join (values
        ('id',              'uuid'),
        ('pedido_id',       'uuid'),
        ('produto_id',      'uuid'),
        ('quantidade',      'numeric'),
        ('unidade_medida',  'character varying'),
        ('preco_unitario',  'numeric'),
        ('preco_total',     'numeric'),
        ('criado_em',       'timestamp without time zone')
      ) as esperado(coluna, tipo)
        on c.column_name = esperado.coluna and c.data_type = esperado.tipo
      where c.table_schema = 'public' and c.table_name = 'itens_pedidos';

    if v_ip_total_colunas <> 8 or v_ip_colunas_conferem <> 8 then
      raise exception 'Migration 0022 abortada: public.itens_pedidos tem % coluna(s) no total, % batendo com a assinatura legada esperada (esperado: 8 e 8).', v_ip_total_colunas, v_ip_colunas_conferem;
    end if;

    select bool_and(is_nullable = 'NO') into v_ip_nulabilidade_ok
      from information_schema.columns
      where table_schema = 'public' and table_name = 'itens_pedidos'
        and column_name in ('id', 'pedido_id', 'quantidade');

    if v_ip_nulabilidade_ok is not true then
      raise exception 'Migration 0022 abortada: public.itens_pedidos nao tem id/pedido_id/quantidade todos NOT NULL como esperado no legado.';
    end if;

    select count(*) into v_ip_total_constraints
      from pg_constraint where conrelid = 'public.itens_pedidos'::regclass;

    if v_ip_total_constraints <> 3 then
      raise exception 'Migration 0022 abortada: public.itens_pedidos tem % constraint(s), esperado exatamente 3 (itens_pedidos_pkey, itens_pedidos_pedido_id_fkey, itens_pedidos_produto_id_fkey).', v_ip_total_constraints;
    end if;

    select exists (
      select 1 from pg_constraint
      where conrelid = 'public.itens_pedidos'::regclass and conname = 'itens_pedidos_pkey' and contype = 'p'
    ) into v_ip_pk_ok;

    -- Mesmo reforco conkey/confkey do bloco de pedidos acima -- confirma
    -- explicitamente pedido_id -> pedidos(id) pelas posicoes reais de
    -- coluna, nao so pelo nome da constraint e a tabela referenciada.
    select exists (
      select 1 from pg_constraint
      where conrelid = 'public.itens_pedidos'::regclass and conname = 'itens_pedidos_pedido_id_fkey'
        and contype = 'f' and confrelid = 'public.pedidos'::regclass
        and conkey = array[(select attnum from pg_attribute where attrelid = 'public.itens_pedidos'::regclass and attname = 'pedido_id')]
        and confkey = array[(select attnum from pg_attribute where attrelid = 'public.pedidos'::regclass and attname = 'id')]
    ) into v_ip_fk_pedido_ok;

    -- Idem para produto_id -> produtos(id).
    select exists (
      select 1 from pg_constraint
      where conrelid = 'public.itens_pedidos'::regclass and conname = 'itens_pedidos_produto_id_fkey'
        and contype = 'f' and confrelid = 'public.produtos'::regclass
        and conkey = array[(select attnum from pg_attribute where attrelid = 'public.itens_pedidos'::regclass and attname = 'produto_id')]
        and confkey = array[(select attnum from pg_attribute where attrelid = 'public.produtos'::regclass and attname = 'id')]
    ) into v_ip_fk_produto_ok;

    if not (v_ip_pk_ok and v_ip_fk_pedido_ok and v_ip_fk_produto_ok) then
      raise exception 'Migration 0022 abortada: pk/fk de public.itens_pedidos nao correspondem ao legado esperado por nome, tipo ou tabela referenciada.';
    end if;

    select relrowsecurity, relforcerowsecurity into v_ip_rls_ativa, v_ip_force_rls
      from pg_class where oid = 'public.itens_pedidos'::regclass;

    if v_ip_rls_ativa is not true or v_ip_force_rls is not false then
      raise exception 'Migration 0022 abortada: RLS de public.itens_pedidos fora do estado esperado (rowsecurity=true, force=false) -- encontrado rowsecurity=%, force=%.', v_ip_rls_ativa, v_ip_force_rls;
    end if;

    select count(*) into v_ip_total_policies
      from pg_policies where schemaname = 'public' and tablename = 'itens_pedidos';

    if v_ip_total_policies <> 0 then
      raise exception 'Migration 0022 abortada: public.itens_pedidos tem % policy(ies) inesperada(s) -- esperado 0.', v_ip_total_policies;
    end if;

    select count(*) into v_ip_total_triggers
      from pg_trigger where tgrelid = 'public.itens_pedidos'::regclass and not tgisinternal;

    if v_ip_total_triggers <> 0 then
      raise exception 'Migration 0022 abortada: public.itens_pedidos tem % trigger(s) nao interno(s) inesperado(s) -- esperado 0.', v_ip_total_triggers;
    end if;

    select count(*) into v_ip_fks_externas
      from pg_constraint where confrelid = 'public.itens_pedidos'::regclass;

    if v_ip_fks_externas <> 0 then
      raise exception 'Migration 0022 abortada: existe(m) % foreign key(s) de outra tabela apontando para public.itens_pedidos -- remocao automatica bloqueada. Investigar manualmente antes de reexecutar.', v_ip_fks_externas;
    end if;

    -- ============================================================
    -- Checagem cruzada final: a UNICA FK externa apontando para
    -- public.pedidos precisa ser exatamente itens_pedidos_pedido_id_fkey,
    -- agora que public.itens_pedidos ja foi confirmada como o legado
    -- esperado (nao antes -- so faz sentido checar isso depois de saber
    -- que a tabela de origem da FK e' de fato o que esperamos).
    -- ============================================================
    select count(*) into v_fks_externas_pedidos
      from pg_constraint where confrelid = 'public.pedidos'::regclass;

    if v_fks_externas_pedidos <> 1 then
      raise exception 'Migration 0022 abortada: public.pedidos tem % FK(s) externa(s) apontando para ela, esperado exatamente 1 (itens_pedidos_pedido_id_fkey).', v_fks_externas_pedidos;
    end if;

    if not exists (
      select 1 from pg_constraint
      where confrelid = 'public.pedidos'::regclass
        and conname = 'itens_pedidos_pedido_id_fkey'
        and conrelid = 'public.itens_pedidos'::regclass
    ) then
      raise exception 'Migration 0022 abortada: a FK externa encontrada em public.pedidos nao e itens_pedidos_pedido_id_fkey de public.itens_pedidos -- nao corresponde ao legado conhecido.';
    end if;

    -- Indices: so informativo, nunca bloqueia o DROP por si so -- PK/
    -- UNIQUE/FK ja foram validados nominalmente acima; diferenca so em
    -- indice secundario nao e motivo de abortar, decisao aprovada
    -- explicitamente.
    select string_agg(indexname, ', ' order by indexname) into v_indices_encontrados
      from pg_indexes where schemaname = 'public' and tablename = 'pedidos';

    select string_agg(indexname, ', ' order by indexname) into v_ip_indices_encontrados
      from pg_indexes where schemaname = 'public' and tablename = 'itens_pedidos';

    raise notice 'Par legado validado por completo -- public.pedidos (indices: %) e public.itens_pedidos (indices: %). Removendo, nesta ordem (filha primeiro, pai depois).',
      coalesce(v_indices_encontrados, '(nenhum)'), coalesce(v_ip_indices_encontrados, '(nenhum)');

    -- Ordem obrigatoria: itens_pedidos (filha) primeiro, pedidos (pai)
    -- depois -- a FK itens_pedidos_pedido_id_fkey bloquearia (RESTRICT)
    -- remover o pai primeiro enquanto a filha ainda existisse. Sem IF
    -- EXISTS (ja confirmamos existencia de ambas acima) e sem CASCADE em
    -- nenhuma das duas -- qualquer dependencia nao coberta pelas
    -- checagens acima faz o proprio Postgres recusar o DROP em vez de
    -- arrastar silenciosamente, e essa excecao tambem aborta a migration
    -- inteira (mesma transacao, mesmo BEGIN/COMMIT).
    drop table public.itens_pedidos restrict;
    drop table public.pedidos restrict;
  end if;
end $$;

-- ============================================================
-- 1. TABELA public.pedidos
-- ============================================================
create table public.pedidos (
  id                   uuid primary key default gen_random_uuid(),

  fornecedor_id        uuid not null
    references public.fornecedores(id) on delete restrict,

  -- Sem default current_date de proposito: current_date depende do fuso
  -- da sessao do Postgres (Supabase roda em UTC por padrao), que pode
  -- divergir do dia operacional real da Padoca (America/Sao_Paulo).
  -- data_pedido tem que vir sempre explicita do frontend, calculada com
  -- lib/data/dataLocal.js -- mesma fonte unica de verdade ja usada em
  -- toda a frente de Producao para "hoje".
  data_pedido          date not null,

  previsao_entrega     date,

  status               text not null default 'aguardando_entrega',

  recebido_em          timestamptz,
  cancelado_em         timestamptz,
  motivo_cancelamento  text,

  observacoes          text,

  -- Autoria/timestamps -- nunca setados pelo cliente. A trigger
  -- pedidos_protecao (secao 6) forca estes 3 campos no INSERT e bloqueia
  -- qualquer tentativa de altera-los depois.
  criado_por           uuid references auth.users(id),
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),

  constraint pedidos_status_check
    check (status in ('aguardando_entrega', 'recebido', 'cancelado')),

  constraint pedidos_recebido_coerente_check
    check (
      (status = 'recebido' and recebido_em is not null)
      or (status <> 'recebido' and recebido_em is null)
    ),

  constraint pedidos_cancelamento_coerente_check
    check (
      (status = 'cancelado' and cancelado_em is not null
        and motivo_cancelamento is not null and btrim(motivo_cancelamento) <> '')
      or (status <> 'cancelado' and cancelado_em is null and motivo_cancelamento is null)
    ),

  constraint pedidos_previsao_entrega_coerente_check
    check (previsao_entrega is null or previsao_entrega >= data_pedido)
);

comment on table public.pedidos is
  'Pedido de compra a um fornecedor (cabecalho). Nasce sempre com status=aguardando_entrega -- nao existe rascunho: a linha existir ja significa "pedido realizado". Sem policy de DELETE nem de INSERT direto (ver secao 7) -- criacao so via criar_pedido(), historico preservado para sempre. status=recebido/cancelado sao terminais e imutaveis (ver trigger pedidos_protecao, secao 6). "Atrasado" nunca e persistido aqui -- e sempre status=aguardando_entrega AND previsao_entrega < hoje, calculado no frontend.';

comment on column public.pedidos.previsao_entrega is
  'Data prevista de entrega. Nesta Fase A e sempre preenchida/ajustada manualmente. A Fase B vai passar a SUGERIR este valor a partir de fornecedor_regras_pedido (migration 0007), sempre deixando o ajuste manual disponivel -- nenhuma mudanca de schema necessaria para isso.';

comment on column public.pedidos.criado_por is
  'Preenchido pela trigger pedidos_protecao a partir de auth.uid() no INSERT -- nunca vem do cliente, imutavel depois.';


-- ============================================================
-- 2. TABELA public.pedido_itens
-- ============================================================
create table public.pedido_itens (
  id                  uuid primary key default gen_random_uuid(),

  pedido_id           uuid not null
    references public.pedidos(id) on delete restrict,

  -- Nullable: pode-se comprar algo que ainda nao esteja no catalogo. Nao
  -- e RESTRICT de proposito -- e uma referencia auxiliar (comparacao de
  -- preco/catalogo futura), nao a fonte de verdade do que foi pedido (ver
  -- descricao/unidade abaixo). Se o produto for removido de public.produtos
  -- no futuro, o item do pedido sobrevive intacto, so perde o vinculo.
  produto_id          uuid references public.produtos(id) on delete set null,

  -- Snapshot do momento do pedido -- nunca recalculado a partir de
  -- produtos, mesmo quando produto_id esta preenchido. Uma alteracao
  -- futura no cadastro do produto (nome, unidade padrao) nunca deve mudar
  -- a leitura historica de um pedido ja feito.
  descricao           text not null,
  quantidade_pedida   numeric(12,3) not null,
  unidade             text not null,

  -- numeric(12,4): custo unitario derivado de compra a granel (ex.:
  -- R$45,90 / 25kg = R$1,8360/kg) perde precisao real com so 2 casas. O
  -- FRONTEND sempre formata como R$ com 2 casas para exibicao -- a
  -- precisao extra fica so armazenada, nunca aparece "errada" na tela.
  valor_unitario      numeric(12,4),

  observacao          text,

  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),

  constraint pedido_itens_descricao_nao_vazia_check
    check (btrim(descricao) <> ''),

  constraint pedido_itens_unidade_nao_vazia_check
    check (btrim(unidade) <> ''),

  constraint pedido_itens_quantidade_positiva_check
    check (quantidade_pedida > 0),

  constraint pedido_itens_valor_unitario_nao_negativo_check
    check (valor_unitario is null or valor_unitario >= 0)
);

comment on table public.pedido_itens is
  'Itens de um pedido. Sem valor_total persistido (sempre quantidade_pedida * valor_unitario, calculado na leitura) e sem quantidade_recebida nesta fase (ver comentario de cabecalho). pedido_id e criado_em sao imutaveis (trigger pedido_itens_protecao, secao 6); so podem ser inseridos/alterados/removidos enquanto o pedido-pai estiver status=aguardando_entrega. Um pedido nunca pode ficar com zero itens (trigger pedido_itens_impedir_pedido_vazio, secao 6).';

comment on column public.pedido_itens.descricao is
  'Snapshot do nome do item no momento do pedido -- nao e recalculado a partir de produtos.nome mesmo quando produto_id esta preenchido.';

comment on column public.pedido_itens.unidade is
  'Snapshot da unidade no momento do pedido -- mesmo raciocinio de descricao.';


-- ============================================================
-- 3. INDICES
-- ============================================================
create index pedidos_fornecedor_id_idx
  on public.pedidos (fornecedor_id);

create index pedidos_status_previsao_entrega_idx
  on public.pedidos (status, previsao_entrega);

create index pedido_itens_pedido_id_idx
  on public.pedido_itens (pedido_id);

create index pedido_itens_produto_id_idx
  on public.pedido_itens (produto_id);


-- ============================================================
-- 4. SEED -- novos codigos no catalogo de permissoes
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('pedidos.visualizar', 'pedidos', 'visualizar', 'Ver pedidos a fornecedores e seus itens.'),
  ('pedidos.inserir',    'pedidos', 'inserir',    'Criar um novo pedido (cabecalho + itens), via criar_pedido(). Nao permite INSERT direto de cabecalho nem de item.'),
  ('pedidos.editar',     'pedidos', 'editar',     'Editar dados de um pedido ainda aguardando_entrega (inclusive seus itens). Nao permite marcar como recebido/cancelado.'),
  ('pedidos.receber',    'pedidos', 'receber',    'Marcar um pedido aguardando_entrega como recebido.'),
  ('pedidos.cancelar',   'pedidos', 'cancelar',   'Cancelar um pedido aguardando_entrega, com motivo obrigatorio.');

-- proprietario_admin preserva "acesso total": concede os 5 codigos novos
-- explicitamente (mesmo padrao ja usado nas migrations 0016/0018 -- o seed
-- original de "todas as permissoes" da 0001 nao e retroativo a codigos
-- criados depois). Nenhum outro perfil recebe por padrao -- conservador,
-- quem precisar usa a tela Usuarios e Acessos (usuario_permissoes,
-- migration 0016) para conceder individualmente.
insert into public.perfil_permissoes (perfil, permissao)
select 'proprietario_admin', codigo
from public.permissoes
where codigo in (
  'pedidos.visualizar', 'pedidos.inserir', 'pedidos.editar',
  'pedidos.receber', 'pedidos.cancelar'
);


-- ============================================================
-- 5. RLS de pedidos e pedido_itens
-- ============================================================
alter table public.pedidos enable row level security;
alter table public.pedido_itens enable row level security;
-- Sem FORCE ROW LEVEL SECURITY em nenhuma das duas -- mesma convencao ja
-- documentada em 0005b/0010. O mecanismo real que protege criar_pedido()
-- e o atributo BYPASSRLS do papel dono das funcoes (ver secao 8), que
-- FORCE nao afeta de qualquer forma -- ligar FORCE aqui nao adicionaria
-- protecao nenhuma contra o cenario que importa (usuario comum tentando
-- contornar via chamada direta), so criaria risco de comportamento
-- inesperado se o ownership de tabela/funcao um dia divergir.

-- ----------------- pedidos -----------------
create policy pedidos_select on public.pedidos
  for select to authenticated
  using ((select public.has_permissao('pedidos.visualizar')));

-- Deliberadamente NENHUMA policy de INSERT em pedidos -- ninguem consegue
-- criar um pedido via INSERT direto, nem com pedidos.inserir. O UNICO
-- caminho de criacao e a RPC criar_pedido() (SECURITY DEFINER, secao 8),
-- que bypassa esta ausencia de policy por ser dona de privilegio proprio,
-- com sua propria checagem explicita de pedidos.inserir. Isso e o que
-- garante que todo pedido nasce com pelo menos 1 item -- nao existe
-- caminho para um INSERT de cabecalho "solto".
create policy pedidos_update on public.pedidos
  for update to authenticated
  using (
    (select public.has_permissao('pedidos.editar'))
    or (select public.has_permissao('pedidos.receber'))
    or (select public.has_permissao('pedidos.cancelar'))
  )
  with check (
    (select public.has_permissao('pedidos.editar'))
    or (select public.has_permissao('pedidos.receber'))
    or (select public.has_permissao('pedidos.cancelar'))
  );

-- Deliberadamente NENHUMA policy de DELETE em pedidos -- exclusao fisica
-- indisponivel para todo mundo, inclusive admin (mesmo padrao de
-- usuarios/fornecedores/producao_registros). Erro/desistencia usa
-- status=cancelado.

-- ----------------- pedido_itens -----------------
create policy pedido_itens_select on public.pedido_itens
  for select to authenticated
  using ((select public.has_permissao('pedidos.visualizar')));

-- So pedidos.editar -- NAO inclui pedidos.inserir de proposito. Um
-- usuario com so pedidos.inserir nao consegue inserir item em NENHUM
-- pedido diretamente (nem no proprio, nem em outro), porque a unica forma
-- de criar itens e via criar_pedido() (SECURITY DEFINER, bypassa esta
-- policy). Isso fecha o vetor "pedidos.inserir sozinho permite injetar
-- item em pedido alheio", identificado na auditoria desta migration.
create policy pedido_itens_insert on public.pedido_itens
  for insert to authenticated
  with check ((select public.has_permissao('pedidos.editar')));

create policy pedido_itens_update on public.pedido_itens
  for update to authenticated
  using ((select public.has_permissao('pedidos.editar')))
  with check ((select public.has_permissao('pedidos.editar')));

create policy pedido_itens_delete on public.pedido_itens
  for delete to authenticated
  using ((select public.has_permissao('pedidos.editar')));


-- ============================================================
-- 6. TRIGGERS de protecao
-- ============================================================

-- ------------------------------------------------------------
-- 6.1 pedidos_protecao -- fonte UNICA de autorizacao de transicao E de
--     auditoria de recebimento/cancelamento (Alternativa A, decisao
--     definitiva). Nao existe caminho -- RPC ou UPDATE direto -- que
--     produza uma transicao valida sem passar por aqui, e nao existe
--     caminho que produza log duplicado (as RPCs de transicao, secao 9,
--     nao inserem em logs_auditoria).
-- ------------------------------------------------------------
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
    -- Autoria/timestamps nunca vem do cliente -- sobrescritos
    -- incondicionalmente, mesmo padrao anti-spoofing de
    -- logs_auditoria_preencher_usuario (migration 0004).
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

    -- atualizado_em: sempre now(), nunca o que o cliente mandou.
    new.atualizado_em := now();

    -- Pedido finalizado (recebido ou cancelado) e imutavel -- nenhum
    -- UPDATE passa daqui pra frente, nem para "so corrigir uma
    -- observacao". Bloqueia tanto receber->cancelar/cancelar->receber
    -- quanto qualquer edicao comum de um pedido ja finalizado.
    if old.status <> 'aguardando_entrega' then
      raise exception 'pedidos: pedido % ja esta finalizado (status=%), nao pode ser alterado.', old.id, old.status;
    end if;

    v_mudou_status := new.status <> old.status;

    if v_mudou_status then
      if new.status = 'recebido' then
        if not (select public.has_permissao('pedidos.receber')) then
          raise exception 'pedidos: marcar como recebido requer a permissao pedidos.receber.';
        end if;

        -- Timestamp SEMPRE determinado pelo banco -- qualquer valor
        -- enviado pelo cliente/RPC e descartado, nunca lido.
        new.recebido_em := now();

        -- Separacao atomica: recebimento so pode alterar status/
        -- recebido_em -- nada mais junto (mesma logica de
        -- producao_registros_protecao, migrations 0010/0015).
        if new.fornecedor_id is distinct from old.fornecedor_id
          or new.data_pedido is distinct from old.data_pedido
          or new.previsao_entrega is distinct from old.previsao_entrega
          or new.observacoes is distinct from old.observacoes
          or new.cancelado_em is distinct from old.cancelado_em
          or new.motivo_cancelamento is distinct from old.motivo_cancelamento then
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
          or new.recebido_em is distinct from old.recebido_em then
          raise exception 'pedidos: cancelamento deve alterar somente status/cancelado_em/motivo_cancelamento.';
        end if;

        insert into public.logs_auditoria (entidade, registro_id, acao, valor_novo)
        values ('pedido', new.id::text, 'cancelou', new.motivo_cancelamento);

      else
        raise exception 'pedidos: transicao de status invalida (% -> %).', old.status, new.status;
      end if;

    else
      -- status nao mudou: edicao comum dos dados.
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
  'BEFORE INSERT/UPDATE em pedidos. INSERT: forca criado_por/criado_em/atualizado_em. UPDATE: bloqueia id/criado_por/criado_em imutaveis, forca atualizado_em, bloqueia qualquer alteracao de pedido finalizado (status<>aguardando_entrega), exige pedidos.receber/pedidos.cancelar para as respectivas transicoes (forcando recebido_em/cancelado_em e gravando a auditoria correspondente em logs_auditoria dentro desta mesma trigger -- fonte unica, sem duplicidade com as RPCs de transicao), exige pedidos.editar para edicao comum e bloqueia essa edicao de tocar em recebido_em/cancelado_em/motivo_cancelamento fora de uma transicao formal.';

drop trigger if exists pedidos_protecao_trigger on public.pedidos;
create trigger pedidos_protecao_trigger
  before insert or update on public.pedidos
  for each row
  execute function public.pedidos_protecao();


-- ------------------------------------------------------------
-- 6.2 pedido_itens_protecao -- pedido_id/criado_em imutaveis, atualizado_em
--     automatico, bloqueio de alteracao quando o pedido-pai nao esta
--     aguardando_entrega. TG_OP explicito (sem COALESCE(NEW,OLD)).
-- ------------------------------------------------------------
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
  'BEFORE INSERT/UPDATE/DELETE em pedido_itens, TG_OP explicito. Forca criado_em/atualizado_em; bloqueia pedido_id e criado_em imutaveis; bloqueia qualquer INSERT/UPDATE/DELETE quando o pedido-pai (public.pedidos.status) nao esta aguardando_entrega. SECURITY DEFINER para ler pedidos.status independente da RLS de SELECT de pedidos do chamador.';

-- Menor privilegio: funcao SECURITY DEFINER que existe so para servir de
-- trigger, nunca para ser chamada diretamente. Uma funcao returns trigger
-- nao pode ser invocada via SQL comum (select public.pedido_itens_protecao())
-- de qualquer forma -- o Postgres rejeita, porque o tipo de retorno
-- "trigger" so e valido dentro do mecanismo de trigger, independente de
-- GRANT/REVOKE (mesma garantia ja documentada para
-- logs_auditoria_preencher_usuario, migration 0004). O REVOKE abaixo e
-- reforco explicito de menor privilegio -- nao a unica barreira -- e
-- evita listar esta funcao como candidata a RPC no schema do PostgREST.
-- Nenhum GRANT e feito para nenhum papel (nem authenticated, nem anon):
-- esta funcao nunca deve ser chamavel diretamente, so pela trigger.
revoke execute on function public.pedido_itens_protecao() from public;

drop trigger if exists pedido_itens_protecao_trigger on public.pedido_itens;
create trigger pedido_itens_protecao_trigger
  before insert or update or delete on public.pedido_itens
  for each row
  execute function public.pedido_itens_protecao();


-- ------------------------------------------------------------
-- 6.3 pedido_itens_impedir_pedido_vazio -- invariante "todo pedido
--     existente tem pelo menos 1 item". CONSTRAINT TRIGGER (nao e
--     possivel combinar CONSTRAINT TRIGGER com FOR EACH STATEMENT/
--     tabelas de transicao no Postgres -- constraint trigger e sempre
--     FOR EACH ROW). DEFERRABLE INITIALLY IMMEDIATE: por padrao continua
--     checando imediatamente apos cada DELETE (identico a uma trigger
--     comum), mas fica disponivel a opcao de uma transacao futura rodar
--     SET CONSTRAINTS ... DEFERRED, sem precisar de nova migration, caso
--     um dia exista um fluxo legitimo de "substituir todos os itens"
--     (delete+insert na mesma transacao) -- nao existe esse fluxo hoje.
-- ------------------------------------------------------------
create or replace function public.pedido_itens_impedir_pedido_vazio()
returns trigger
language plpgsql
security definer  -- mesmo motivo de pedido_itens_protecao: le
                   -- pedido_itens independente de pedidos.visualizar
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pedido_itens where pedido_id = old.pedido_id) then
    raise exception 'pedido_itens: pedido % ficaria sem nenhum item -- operacao bloqueada.', old.pedido_id;
  end if;
  return null; -- AFTER trigger: valor de retorno e ignorado
end;
$$;

comment on function public.pedido_itens_impedir_pedido_vazio() is
  'AFTER DELETE em pedido_itens (constraint trigger, deferrable initially immediate). Impede que um pedido fique com zero itens: apos cada linha removida, verifica se ainda existe pelo menos uma linha para o mesmo pedido_id; se nao, levanta excecao, o que reverte -- via abort de transacao -- o DELETE inteiro, mesmo em remocao de varios itens no mesmo comando. Nao interfere em criar_pedido(): so reage a DELETE, nunca a INSERT.';

-- Menor privilegio, mesmo raciocinio de pedido_itens_protecao acima: so
-- serve de trigger, nunca chamavel diretamente (returns trigger bloqueia
-- isso por si so); REVOKE e reforco explicito, sem GRANT a nenhum papel.
revoke execute on function public.pedido_itens_impedir_pedido_vazio() from public;

drop trigger if exists pedido_itens_impedir_pedido_vazio_trigger on public.pedido_itens;
create constraint trigger pedido_itens_impedir_pedido_vazio_trigger
  after delete on public.pedido_itens
  deferrable initially immediate
  for each row
  execute function public.pedido_itens_impedir_pedido_vazio();


-- ============================================================
-- 7. RPC criar_pedido -- unico caminho de criacao (cabecalho + itens
--    atomicamente)
-- ============================================================
-- SECURITY DEFINER -- decisao auditada e deliberada, nao o padrao default
-- deste projeto (que e SECURITY INVOKER, ver 0011 e 0018). Motivo exato:
--
-- A RLS de pedidos NAO TEM policy de INSERT (secao 5) -- de proposito,
-- para eliminar por construcao o caminho "criar pedido sem item" (INSERT
-- de cabecalho isolado). A RLS de pedido_itens (INSERT) exige so
-- pedidos.editar, NAO pedidos.inserir -- de proposito, para eliminar o
-- caminho "usuario com so pedidos.inserir injeta item em pedido alheio
-- via INSERT direto". Com essas duas policies fechadas, NENHUMA
-- combinacao de permissao permite criar um pedido com INSERTs comuns
-- (SECURITY INVOKER) -- por isso a unica forma de existir um caminho de
-- criacao e uma funcao que rode com privilegio proprio (SECURITY
-- DEFINER), fazendo sua PROPRIA checagem explicita de pedidos.inserir.
--
-- Mecanismo real de bypass de RLS: o dono desta funcao (implicitamente,
-- quem aplicar esta migration via SQL Editor do Supabase) tem o atributo
-- BYPASSRLS -- e' esse atributo do PAPEL, nao "ser dono da tabela" por si
-- so, que faz os INSERTs abaixo ignorarem toda RLS de pedidos/
-- pedido_itens, independente de quais policies existem. BYPASSRLS
-- continua valendo mesmo se FORCE ROW LEVEL SECURITY fosse ligado (por
-- isso FORCE nao e usado aqui -- nao adicionaria protecao nenhuma contra
-- o cenario real, e so essa funcao dependeria dele).
--
-- RISCO DOCUMENTADO: se esta funcao algum dia tiver seu OWNER alterado
-- (ALTER FUNCTION ... OWNER TO) para um papel SEM BYPASSRLS e sem ser
-- dono de pedidos/pedido_itens, ela vai parar de funcionar -- toda
-- chamada vai falhar com violacao de RLS, sem nenhuma mudanca de codigo
-- visivel. Nao alterar o ownership desta funcao sem entender esta
-- dependencia.
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
  -- 1) checagem explicita de permissao -- obrigatoria: como nao existe
  --    policy de INSERT em pedidos, esta funcao E o portao.
  if not (select public.has_permissao('pedidos.inserir')) then
    raise exception using errcode = '42501',
      message = 'criar_pedido: requer a permissao pedidos.inserir.';
  end if;

  -- 2) validacao de fornecedor: precisa existir, estar ativo, e usar
  --    modalidade_compra='pedido_com_entrega' -- compra_presencial fica
  --    fora do fluxo de Pedidos por desenho (nao tem fase real de
  --    "aguardando entrega"; futura Fase E de documentos fiscais tratara
  --    compra presencial sem pedido antecedente).
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

  -- 3) validacao de pelo menos 1 item
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'criar_pedido: e obrigatorio informar ao menos 1 item.';
  end if;

  -- 4) validacao COMPLETA de cada item, ANTES de qualquer escrita.
  --    Campos desconhecidos no objeto JSON sao implicitamente ignorados
  --    (so lemos as chaves conhecidas abaixo) -- nao ha necessidade de
  --    checagem explicita para isso.
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

    -- quantidade_pedida: cast protegido, mensagem propria em vez do erro
    -- nativo de cast do Postgres.
    begin
      v_quantidade := (v_item->>'quantidade_pedida')::numeric;
    exception when invalid_text_representation then
      raise exception 'criar_pedido: quantidade_pedida invalida (nao numerica) no item: %', v_item;
    end;
    if v_quantidade is null or v_quantidade <= 0 then
      raise exception 'criar_pedido: quantidade_pedida deve ser maior que zero no item: %', v_item;
    end if;

    -- valor_unitario: '' e ausente viram NULL (campo opcional); qualquer
    -- outro valor precisa ser numerico e nao negativo.
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

    -- produto_id: '' e ausente viram NULL, sem cast obscuro; qualquer
    -- outro valor precisa ser um UUID valido e existir em produtos.
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

  -- 5) escrita -- so chega aqui se TUDO acima passou. criado_por/
  --    criado_em/atualizado_em nao sao setados aqui -- a trigger
  --    pedidos_protecao (BEFORE INSERT) e quem forca esses valores.
  insert into public.pedidos (fornecedor_id, data_pedido, previsao_entrega, observacoes)
  values (p_fornecedor_id, p_data_pedido, p_previsao_entrega, nullif(btrim(p_observacoes), ''))
  returning * into v_pedido;

  -- Repete a mesma normalizacao de '' -> NULL do passe de validacao --
  -- os casts aqui ja sao garantidos validos (passe 4 acima validou tudo),
  -- entao nao precisam de BEGIN/EXCEPTION de novo.
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
  'Unico caminho de criacao de pedido (cabecalho + itens), em uma unica transacao (tudo ou nada). SECURITY DEFINER -- ver comentario de cabecalho desta secao para a justificativa completa e o risco de mudanca de ownership. Exige pedidos.inserir explicitamente (RLS nao provê esse portao aqui). Valida fornecedor (ativo + modalidade_compra=pedido_com_entrega), pelo menos 1 item, e cada item completamente (descricao/unidade nao vazias, quantidade_pedida numerica >0, valor_unitario/produto_id opcionais com "" tratado como NULL, produto_id validado como UUID existente) ANTES de qualquer escrita. Sem auditoria de criacao em logs_auditoria -- pedidos.criado_por/criado_em ja capturam quem/quando, decisao registrada apos analise de custo/beneficio.';

revoke execute on function public.criar_pedido(uuid, date, date, text, jsonb) from public;
revoke execute on function public.criar_pedido(uuid, date, date, text, jsonb) from anon;
grant execute on function public.criar_pedido(uuid, date, date, text, jsonb) to authenticated;


-- ============================================================
-- 8. RPCs de transicao -- wrappers finos (Alternativa A)
-- ============================================================
-- Nao escolhem timestamp, nao duplicam checagem de permissao, nao
-- inserem em logs_auditoria -- tudo isso e feito pela trigger
-- pedidos_protecao (secao 6.1), que roda identicamente para uma chamada
-- via RPC ou via UPDATE direto ao Supabase. SECURITY INVOKER: a
-- autorizacao real continua sendo a RLS de pedidos (secao 5) + a trigger.

create or replace function public.marcar_pedido_recebido(p_pedido_id uuid)
returns public.pedidos
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pedido public.pedidos%rowtype;
begin
  update public.pedidos
  set status = 'recebido'
  where id = p_pedido_id
  returning * into v_pedido;

  if not found then
    raise exception 'marcar_pedido_recebido: pedido % nao encontrado, sem permissao, ou nao esta aguardando entrega.', p_pedido_id;
  end if;

  return v_pedido;
end;
$$;

comment on function public.marcar_pedido_recebido(uuid) is
  'Wrapper fino: so faz UPDATE status=recebido. Timestamp (recebido_em), checagem de pedidos.receber e auditoria em logs_auditoria sao TODOS responsabilidade da trigger pedidos_protecao -- esta funcao nao duplica nada disso.';

revoke execute on function public.marcar_pedido_recebido(uuid) from public;
revoke execute on function public.marcar_pedido_recebido(uuid) from anon;
grant execute on function public.marcar_pedido_recebido(uuid) to authenticated;


create or replace function public.cancelar_pedido(p_pedido_id uuid, p_motivo text)
returns public.pedidos
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pedido public.pedidos%rowtype;
begin
  update public.pedidos
  set status = 'cancelado', motivo_cancelamento = p_motivo
  where id = p_pedido_id
  returning * into v_pedido;

  if not found then
    raise exception 'cancelar_pedido: pedido % nao encontrado, sem permissao, ou nao esta aguardando entrega.', p_pedido_id;
  end if;

  return v_pedido;
end;
$$;

comment on function public.cancelar_pedido(uuid, text) is
  'Wrapper fino: so faz UPDATE status=cancelado, repassando o motivo recebido do chamador (unico dado que so o chamador pode fornecer). Timestamp (cancelado_em), normalizacao/obrigatoriedade do motivo, checagem de pedidos.cancelar e auditoria em logs_auditoria sao TODOS responsabilidade da trigger pedidos_protecao -- esta funcao nao duplica nada disso.';

revoke execute on function public.cancelar_pedido(uuid, text) from public;
revoke execute on function public.cancelar_pedido(uuid, text) from anon;
grant execute on function public.cancelar_pedido(uuid, text) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro para tudo que esta migration CRIA: 2 tabelas NOVAS (sem dado
-- pre-existente a perder), 5 codigos de permissao novos, e funcoes/
-- triggers/policies proprias -- nenhuma outra migration/policy/trigger do
-- projeto depende de nada criado aqui.
--
-- ATENCAO -- NAO REVERSIVEL EM UM PONTO: este rollback NAO recria
-- public.pedidos (legada), removida na secao 0 no inicio desta migration.
-- Isso e deliberado, nao um esquecimento: a tabela legada estava vazia
-- (0 registros confirmados antes E durante a execucao), sem nenhum uso
-- confirmado em frontend ou migrations, e foi substituida de proposito
-- pela nova estrutura de Pedidos desta Fase A -- recriar um schema morto
-- so para o rollback "parecer completo" contrariaria o motivo de te-la
-- removido. Se por algum motivo extraordinario for necessario restaurar
-- o formato legado, isso exige recriacao manual, fora deste rollback
-- automatico, a partir da assinatura estrutural documentada na secao 0
-- acima (11 colunas, 4 constraints nomeadas, sem RLS/policy/trigger).
-- BEGIN;
-- drop function if exists public.cancelar_pedido(uuid, text);
-- drop function if exists public.marcar_pedido_recebido(uuid);
-- drop function if exists public.criar_pedido(uuid, date, date, text, jsonb);
--
-- drop trigger if exists pedido_itens_impedir_pedido_vazio_trigger on public.pedido_itens;
-- drop function if exists public.pedido_itens_impedir_pedido_vazio();
-- drop trigger if exists pedido_itens_protecao_trigger on public.pedido_itens;
-- drop function if exists public.pedido_itens_protecao();
-- drop trigger if exists pedidos_protecao_trigger on public.pedidos;
-- drop function if exists public.pedidos_protecao();
--
-- drop policy if exists pedido_itens_delete on public.pedido_itens;
-- drop policy if exists pedido_itens_update on public.pedido_itens;
-- drop policy if exists pedido_itens_insert on public.pedido_itens;
-- drop policy if exists pedido_itens_select on public.pedido_itens;
-- drop policy if exists pedidos_update on public.pedidos;
-- drop policy if exists pedidos_select on public.pedidos;
--
-- delete from public.perfil_permissoes where permissao in (
--   'pedidos.visualizar','pedidos.inserir','pedidos.editar',
--   'pedidos.receber','pedidos.cancelar');
-- delete from public.permissoes where codigo in (
--   'pedidos.visualizar','pedidos.inserir','pedidos.editar',
--   'pedidos.receber','pedidos.cancelar');
--
-- drop table if exists public.pedido_itens; -- ATENCAO: apaga todo item ja lancado
-- drop table if exists public.pedidos;      -- ATENCAO: apaga todo pedido ja lancado
-- COMMIT;
