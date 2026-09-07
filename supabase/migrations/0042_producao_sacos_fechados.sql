-- 0042_producao_sacos_fechados.sql
-- Controle de Sacos Fechados dentro de Producao -- estrutura completa da
-- V1 (telas manuais de entrada/abertura/edicao), SEM integracao
-- automatica com Pedidos ainda (fica para uma migration 0043 futura,
-- separada, so depois desta V1 validada em uso real -- mesmo padrao ja
-- usado em Pedidos: estrutura primeiro, testada manualmente, automacao
-- depois).
--
-- DECISOES DE MODELAGEM (fechadas antes desta migration, duas rodadas de
-- auditoria previas):
--   * peso_por_saco_kg e EXPLICITO em produto_fornecedores (nao
--     reaproveita quantidade_embalagem) -- decisao do usuario: Sacos
--     Fechados vai movimentar Estoque, nao queremos sobrecarregar
--     semanticamente uma coluna que ja significa outra coisa.
--   * Movimentacoes referenciam produto_fornecedor_id diretamente, NUNCA
--     produto_id+fornecedor_id -- produto_fornecedores nao tem
--     UNIQUE(produto_id, fornecedor_id) de proposito (0023, multiplas
--     configuracoes comerciais por par sao legitimas); referenciar a
--     configuracao exata elimina a ambiguidade sem precisar de nenhuma
--     restricao artificial nova sobre quantas configuracoes por par podem
--     controlar sacos.
--   * quantidade_sacos e INTEGER ASSINADO (nao numeric) -- entrada > 0,
--     abertura < 0, ajuste_manual/saldo_inicial podem ser qualquer sinal
--     nao-zero.
--   * peso_por_saco_kg_snapshot em CADA movimentacao -- preserva o peso
--     historico efetivamente usado, mesmo que a configuracao mude depois
--     (o que so pode acontecer enquanto nao houver movimentacao alguma --
--     ver item de protecao de peso abaixo).
--   * Saldo de sacos e saldo de estoque NUNCA armazenados -- sempre
--     SUM(quantidade_sacos)/SUM(quantidade), calculado na leitura. Kg
--     correspondente ao saldo de sacos = saldo_sacos * peso_por_saco_kg
--     ATUAL da configuracao (nao o snapshot -- o snapshot e so o valor
--     historico USADO em cada evento passado).
--   * Abertura manual MOVIMENTA ESTOQUE atomicamente (mesma transacao) --
--     nao existe versao operacional em que abrir saco baixe so o
--     controle de sacos.
--   * Idempotencia da abertura manual via operacao_id (uuid gerado UMA
--     VEZ pelo cliente); idempotencia da futura entrada automatica de
--     pedido via pedido_item_id (0043) -- mesmo padrao ja usado em
--     produtos_historico_compras (0026).
--   * Edicao e UPDATE transacional direto (nao trilha de estorno) --
--     corrige a movimentacao de sacos E a de estoque vinculada na mesma
--     RPC, registrando o antes/depois em logs_auditoria (0004, ainda sem
--     nenhum consumidor ate agora).
--   * Sem exclusao nesta V1 (RPC nenhuma) -- so 3 permissoes
--     (visualizar/operar/editar).
--
-- ACHADO DE AUDITORIA E DECISAO TECNICA TOMADA NESTA MIGRATION:
--   produto_fornecedores_protecao() (0023) e SECURITY INVOKER. A nova
--   regra "nao pode mudar peso_por_saco_kg se ja existe movimentacao de
--   sacos" precisa ler sacos_fechados_movimentacoes, mas rodando como
--   SECURITY INVOKER isso ficaria sujeito a RLS do CHAMADOR (que edita
--   produto_fornecedores com catalogo_produtos.editar, nao
--   necessariamente com producao_sacos.visualizar) -- a policy de SELECT
--   de sacos_fechados_movimentacoes filtraria a linha e a checagem NUNCA
--   veria a movimentacao existente, furando a protecao. Mesma classe de
--   problema ja resolvida neste projeto por pedido_itens_protecao (0022,
--   que precisa SECURITY DEFINER para ler pedidos.status independente da
--   RLS de SELECT de pedidos do chamador) -- aplicada aqui a mesma
--   solucao: produto_fornecedores_protecao() passa de SECURITY INVOKER
--   para SECURITY DEFINER (dono com BYPASSRLS, todas as referencias
--   ja eram schema-qualificadas). Nenhuma outra logica da funcao muda.
--
-- ESCOPO -- SOMENTE:
--   1) public.produto_fornecedores: 2 colunas novas (controla_sacos_fechados,
--      peso_por_saco_kg) + CHECK de coerencia;
--   2) public.produto_fornecedores_protecao(): CREATE OR REPLACE (mesmo
--      corpo de 0023 + regra de peso imutavel apos movimentacao + eleva
--      para SECURITY DEFINER, ver acima) -- trigger em si (nome/evento/
--      timing) inalterada, ja existe desde 0023;
--   3) public.sacos_fechados_movimentacoes (nova) -- tabela, indices,
--      RLS, trigger de autoria/imutabilidade;
--   4) 3 codigos novos de permissao (producao_sacos.visualizar/operar/
--      editar) + concessao a proprietario_admin;
--   5) public.registrar_abertura_saco() (nova RPC);
--   6) public.editar_movimentacao_saco() (nova RPC).
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em receber_pedido(), registrar_compra_presencial()
--     ou editar_compra_presencial() -- integracao automatica com Pedidos
--     e a 0043, futura, separada;
--   * nenhuma RPC de exclusao;
--   * nenhuma alteracao em Agenda ou em qualquer tabela/RPC de Producao
--     ja existente (producao_registros, producao_expositor_lotes, etc.);
--   * nenhuma alteracao de frontend;
--   * nenhum backfill/carga inicial de planilha -- fica para depois da
--     planilha final ser recebida e analisada (fora do escopo de
--     qualquer migration ate aqui).
--
-- Pre-requisitos: 0001..0041 ja aplicadas (0041 cria
-- public.estoque_movimentacoes, consumida pelas duas RPCs desta migration).

BEGIN;

-- ============================================================
-- 1. public.produto_fornecedores -- 2 colunas novas
-- ============================================================
alter table public.produto_fornecedores
  add column if not exists controla_sacos_fechados boolean not null default false,
  add column if not exists peso_por_saco_kg numeric(12,3);

do $$
begin
  alter table public.produto_fornecedores
    add constraint produto_fornecedores_peso_saco_coerente_check
    check (
      controla_sacos_fechados = false
      or (peso_por_saco_kg is not null and peso_por_saco_kg > 0)
    );
exception
  when duplicate_object then null;
end $$;

comment on column public.produto_fornecedores.controla_sacos_fechados is
  'Marca esta configuracao comercial especifica (nao o par produto+fornecedor inteiro -- pode haver outras linhas do mesmo par sem esta marcacao, ou ate com marcacao propria e peso proprio) como controlada pelo modulo Sacos Fechados (0042). Quando true, peso_por_saco_kg e obrigatorio e > 0.';

comment on column public.produto_fornecedores.peso_por_saco_kg is
  'Peso, em kg, de 1 saco fechado desta configuracao comercial -- EXPLICITO, independente de quantidade_embalagem (que continua servindo so a conversao comercial de produtos_historico_compras/recebimento de pedidos). So obrigatorio quando controla_sacos_fechados=true. Depois que existir qualquer linha em sacos_fechados_movimentacoes para esta configuracao, este valor fica IMUTAVEL (ver produto_fornecedores_protecao) -- peso comercial novo exige uma NOVA configuracao (nova linha em produto_fornecedores), nunca a edicao desta.';


-- ============================================================
-- 2. public.sacos_fechados_movimentacoes (nova)
-- ============================================================
-- Livro-razao de sacos fechados -- saldo por produto_fornecedor_id =
-- SUM(quantidade_sacos), nunca armazenado. Cada linha referencia
-- diretamente a CONFIGURACAO COMERCIAL (nao produto_id+fornecedor_id) --
-- ver decisao de modelagem no cabecalho desta migration.
create table if not exists public.sacos_fechados_movimentacoes (
  id                        uuid primary key default gen_random_uuid(),

  produto_fornecedor_id     uuid not null
    references public.produto_fornecedores(id) on delete restrict,

  -- Assinada: entrada > 0, abertura < 0, ajuste_manual/saldo_inicial
  -- podem ser qualquer sinal nao-zero (ver constraint de coerencia
  -- abaixo, que amarra tipo a faixa de sinal permitida).
  quantidade_sacos          integer not null,

  -- Peso EFETIVAMENTE usado nesta operacao -- preserva o historico
  -- mesmo que produto_fornecedores.peso_por_saco_kg venha a mudar no
  -- futuro (so possivel enquanto esta configuracao nao tiver nenhuma
  -- movimentacao -- ver produto_fornecedores_protecao).
  peso_por_saco_kg_snapshot numeric(12,3) not null,

  tipo                      text not null,
  origem                    text not null,

  -- Preenchido so quando origem='recebimento_pedido' (0043, futura) --
  -- chave de idempotencia da entrada automatica, mesmo padrao de
  -- produtos_historico_compras.pedido_item_id (0026).
  pedido_item_id            uuid
    references public.pedido_itens(id) on delete restrict,

  -- Gerado UMA VEZ pelo cliente (frontend) para cada acao manual real --
  -- chave de idempotencia de abertura/ajuste manual (duplo clique, retry
  -- de rede, recarregamento nao geram uma segunda baixa).
  operacao_id               uuid,

  observacao                text,

  -- Autoria/timestamps -- nunca setados pelo cliente, forcados pela
  -- trigger sacos_fechados_movimentacoes_protecao abaixo.
  criado_por                uuid references auth.users(id) on delete set null,
  criado_em                 timestamptz not null default now(),
  atualizado_por            uuid references auth.users(id) on delete set null,
  atualizado_em             timestamptz not null default now(),

  constraint sacos_fechados_movimentacoes_quantidade_nao_zero_check
    check (quantidade_sacos <> 0),

  constraint sacos_fechados_movimentacoes_peso_snapshot_positivo_check
    check (peso_por_saco_kg_snapshot > 0),

  constraint sacos_fechados_movimentacoes_tipo_check
    check (tipo in ('entrada', 'abertura', 'ajuste_manual', 'saldo_inicial')),

  constraint sacos_fechados_movimentacoes_origem_check
    check (origem in ('recebimento_pedido', 'retirada', 'abertura_manual', 'ajuste_manual', 'carga_inicial')),

  -- Amarra o SINAL de quantidade_sacos ao tipo -- solucao de banco, nao
  -- so de frontend/RPC (pedido explicito do usuario).
  constraint sacos_fechados_movimentacoes_sinal_coerente_check
    check (
      (tipo = 'entrada' and quantidade_sacos > 0)
      or (tipo = 'abertura' and quantidade_sacos < 0)
      or (tipo in ('ajuste_manual', 'saldo_inicial'))
    ),

  -- Amarra tipo a origem -- evita combinacoes sem sentido (ex.: tipo
  -- abertura vindo de origem recebimento_pedido).
  constraint sacos_fechados_movimentacoes_tipo_origem_coerente_check
    check (
      (tipo = 'entrada' and origem in ('recebimento_pedido', 'retirada', 'carga_inicial'))
      or (tipo = 'abertura' and origem = 'abertura_manual')
      or (tipo = 'ajuste_manual' and origem = 'ajuste_manual')
      or (tipo = 'saldo_inicial' and origem = 'carga_inicial')
    ),

  -- pedido_item_id so faz sentido (e so e exigido) quando
  -- origem='recebimento_pedido' -- mesmo raciocinio de
  -- produtos_historico_compras_origem_pedido_item_coerente_check (0026).
  constraint sacos_fechados_movimentacoes_pedido_item_coerente_check
    check (
      (origem = 'recebimento_pedido' and pedido_item_id is not null)
      or (origem <> 'recebimento_pedido' and pedido_item_id is null)
    )
);

comment on table public.sacos_fechados_movimentacoes is
  'Livro-razao de Sacos Fechados -- saldo por produto_fornecedor_id = SUM(quantidade_sacos), NUNCA uma coluna de saldo armazenada. Referencia a CONFIGURACAO COMERCIAL especifica (produto_fornecedor_id), nunca produto_id+fornecedor_id soltos -- produto_fornecedores permite multiplas configuracoes por par de proposito (0023), entao a configuracao exata e a unica identidade sem ambiguidade. Escrita SOMENTE via registrar_abertura_saco()/editar_movimentacao_saco() (SECURITY DEFINER) -- sem nenhuma policy de INSERT/UPDATE/DELETE nesta tabela.';

comment on column public.sacos_fechados_movimentacoes.quantidade_sacos is
  'Inteiro assinado -- positivo em entrada, negativo em abertura. ajuste_manual/saldo_inicial podem ser qualquer sinal nao-zero. NUNCA numeric -- sacos sao sempre contados em unidades inteiras.';

comment on column public.sacos_fechados_movimentacoes.peso_por_saco_kg_snapshot is
  'Peso EFETIVAMENTE usado nesta operacao especifica -- congelado no INSERT, nunca recalculado a partir de produto_fornecedores.peso_por_saco_kg depois. E o valor usado para derivar a movimentacao de estoque correspondente (quantidade_sacos * peso_por_saco_kg_snapshot).';

comment on column public.sacos_fechados_movimentacoes.operacao_id is
  'Gerado UMA VEZ pelo cliente antes de chamar registrar_abertura_saco -- chave de idempotencia: reenviar a mesma chamada (duplo clique, retry, recarregamento) devolve a movimentacao ja criada, nunca gera uma segunda baixa. Unico quando informado (ver indice abaixo). Nao usado ainda por nenhuma entrada automatica (essas usam pedido_item_id).';

create index if not exists sacos_fechados_movimentacoes_produto_fornecedor_id_idx
  on public.sacos_fechados_movimentacoes (produto_fornecedor_id);

create index if not exists sacos_fechados_movimentacoes_criado_em_idx
  on public.sacos_fechados_movimentacoes (criado_em desc);

create unique index if not exists sacos_fechados_movimentacoes_pedido_item_id_unico_idx
  on public.sacos_fechados_movimentacoes (pedido_item_id)
  where pedido_item_id is not null;

create unique index if not exists sacos_fechados_movimentacoes_operacao_id_unico_idx
  on public.sacos_fechados_movimentacoes (operacao_id)
  where operacao_id is not null;


-- ------------------------------------------------------------
-- 2.1 RLS -- SELECT liberado por permissao; escrita so via RPC.
-- ------------------------------------------------------------
alter table public.sacos_fechados_movimentacoes enable row level security;
-- Sem FORCE ROW LEVEL SECURITY -- mesma convencao ja documentada em
-- 0005b/0010/0022/0023/0041.

create policy sacos_fechados_movimentacoes_select on public.sacos_fechados_movimentacoes
  for select to authenticated
  using ((select public.has_permissao('producao_sacos.visualizar')));

-- Sem policy de INSERT/UPDATE/DELETE -- toda escrita passa por
-- registrar_abertura_saco()/editar_movimentacao_saco() (SECURITY
-- DEFINER, BYPASSRLS do dono), nunca por acesso direto do cliente. Mesmo
-- padrao de pedidos/pedido_itens (0022): a ausencia de policy e a
-- protecao real, nao um esquecimento.


-- ------------------------------------------------------------
-- 2.2 Trigger de protecao -- autoria/timestamps, campos imutaveis
-- ------------------------------------------------------------
-- SECURITY INVOKER: nenhuma dependencia cruzada com outra tabela (ao
-- contrario de produto_fornecedores_protecao abaixo).
create or replace function public.sacos_fechados_movimentacoes_protecao()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.atualizado_por := auth.uid();
    new.atualizado_em := now();
    return new;

  elsif tg_op = 'UPDATE' then
    if new.produto_fornecedor_id is distinct from old.produto_fornecedor_id then
      raise exception 'sacos_fechados_movimentacoes: produto_fornecedor_id e imutavel.';
    end if;
    if new.peso_por_saco_kg_snapshot is distinct from old.peso_por_saco_kg_snapshot then
      raise exception 'sacos_fechados_movimentacoes: peso_por_saco_kg_snapshot e imutavel.';
    end if;
    if new.tipo is distinct from old.tipo then
      raise exception 'sacos_fechados_movimentacoes: tipo e imutavel.';
    end if;
    if new.origem is distinct from old.origem then
      raise exception 'sacos_fechados_movimentacoes: origem e imutavel.';
    end if;
    if new.pedido_item_id is distinct from old.pedido_item_id then
      raise exception 'sacos_fechados_movimentacoes: pedido_item_id e imutavel.';
    end if;
    if new.operacao_id is distinct from old.operacao_id then
      raise exception 'sacos_fechados_movimentacoes: operacao_id e imutavel.';
    end if;
    if new.criado_por is distinct from old.criado_por then
      raise exception 'sacos_fechados_movimentacoes: criado_por e imutavel.';
    end if;
    if new.criado_em is distinct from old.criado_em then
      raise exception 'sacos_fechados_movimentacoes: criado_em e imutavel.';
    end if;

    -- quantidade_sacos e observacao PODEM mudar -- e exatamente o que
    -- editar_movimentacao_saco() corrige.
    new.atualizado_por := auth.uid();
    new.atualizado_em := now();
    return new;
  end if;

  return null;
end;
$$;

comment on function public.sacos_fechados_movimentacoes_protecao() is
  'BEFORE INSERT/UPDATE em sacos_fechados_movimentacoes. INSERT: forca criado_por/criado_em/atualizado_por/atualizado_em. UPDATE: bloqueia produto_fornecedor_id/peso_por_saco_kg_snapshot/tipo/origem/pedido_item_id/operacao_id/criado_por/criado_em imutaveis -- so quantidade_sacos/observacao podem mudar (via editar_movimentacao_saco), forca atualizado_por/atualizado_em mesmo numa correcao.';

drop trigger if exists sacos_fechados_movimentacoes_protecao_trigger on public.sacos_fechados_movimentacoes;
create trigger sacos_fechados_movimentacoes_protecao_trigger
  before insert or update on public.sacos_fechados_movimentacoes
  for each row
  execute function public.sacos_fechados_movimentacoes_protecao();

revoke execute on function public.sacos_fechados_movimentacoes_protecao() from public;


-- ============================================================
-- 3. public.produto_fornecedores_protecao() -- CREATE OR REPLACE
-- ============================================================
-- Corpo IDENTICO ao de 0023, com 2 mudancas pontuais:
--   a) nova regra: peso_por_saco_kg fica imutavel assim que existir
--      qualquer movimentacao de sacos para esta configuracao;
--   b) SECURITY INVOKER -> SECURITY DEFINER, exigido pela nova regra
--      (ver "ACHADO DE AUDITORIA" no cabecalho desta migration) --
--      dono do papel tem BYPASSRLS, mesmo mecanismo real ja usado por
--      toda funcao SECURITY DEFINER deste projeto (0022 em diante).
create or replace function public.produto_fornecedores_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.atualizado_em := now();
    return new;

  elsif tg_op = 'UPDATE' then
    if new.produto_id is distinct from old.produto_id then
      raise exception 'produto_fornecedores: produto_id e imutavel.';
    end if;
    if new.fornecedor_id is distinct from old.fornecedor_id then
      raise exception 'produto_fornecedores: fornecedor_id e imutavel.';
    end if;
    if new.criado_por is distinct from old.criado_por then
      raise exception 'produto_fornecedores: criado_por e imutavel.';
    end if;
    if new.criado_em is distinct from old.criado_em then
      raise exception 'produto_fornecedores: criado_em e imutavel.';
    end if;

    -- Peso por saco fica IMUTAVEL assim que existir qualquer
    -- movimentacao de sacos para esta configuracao (0042) -- peso
    -- comercial novo exige uma NOVA linha em produto_fornecedores, nunca
    -- a edicao desta. SECURITY DEFINER (ver cabecalho da 0042) garante
    -- que esta checagem enxerga TODAS as movimentacoes, independente da
    -- RLS/permissao de quem esta editando o Catalogo.
    if new.peso_por_saco_kg is distinct from old.peso_por_saco_kg
       and exists (
         select 1 from public.sacos_fechados_movimentacoes
         where produto_fornecedor_id = old.id
       )
    then
      raise exception 'produto_fornecedores: peso_por_saco_kg nao pode ser alterado depois que ja existem movimentacoes de sacos fechados para esta configuracao (%). Cadastre uma nova configuracao comercial se o peso do saco mudou.', old.id;
    end if;

    new.atualizado_em := now();
    return new;
  end if;

  return null;
end;
$$;

comment on function public.produto_fornecedores_protecao() is
  'BEFORE INSERT/UPDATE em produto_fornecedores. INSERT: forca criado_por/criado_em/atualizado_em. UPDATE: bloqueia produto_id/fornecedor_id/criado_por/criado_em imutaveis; bloqueia peso_por_saco_kg quando ja existe movimentacao de sacos fechados para esta configuracao (0042); forca atualizado_em. SECURITY DEFINER (desde 0042, era SECURITY INVOKER em 0023) -- necessario para a checagem de sacos_fechados_movimentacoes enxergar todas as linhas independente da RLS/permissao de quem chama.';

-- Trigger em si (nome, evento, timing) NAO muda -- ja existe desde 0023,
-- so o CORPO da funcao muda via CREATE OR REPLACE acima.


-- ============================================================
-- 4. SEED -- 3 codigos novos de permissao (modulo producao_sacos)
-- ============================================================
-- Concedidas a proprietario_admin nesta propria migration -- mesmo
-- padrao dos modulos administrativos mais recentes (producao_expositores,
-- catalogo_produtos.excluir, pedidos.excluir). Sem producao_sacos.excluir
-- -- nenhuma RPC de exclusao existe nesta V1 (decisao explicita).
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('producao_sacos.visualizar', 'producao_sacos', 'visualizar',
   'Ver a aba Producao > Sacos Fechados: saldo por configuracao comercial e lista de movimentacoes. RLS real de sacos_fechados_movimentacoes (SELECT).'),
  ('producao_sacos.operar', 'producao_sacos', 'operar',
   'Operacao rotineira: registrar abertura de saco (registrar_abertura_saco). Futuramente tambem lancamento manual de entrada/ajuste, quando essas RPCs existirem.'),
  ('producao_sacos.editar', 'producao_sacos', 'editar',
   'Corrigir uma movimentacao manual (abertura ou ajuste) ja registrada, via editar_movimentacao_saco -- nunca uma entrada automatica de pedido. Mais restritiva que .operar -- correcao administrativa de um fato ja lancado.')
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil, permissao)
select 'proprietario_admin', codigo
from public.permissoes
where codigo in ('producao_sacos.visualizar', 'producao_sacos.operar', 'producao_sacos.editar')
on conflict do nothing;


-- ============================================================
-- 5. RPC registrar_abertura_saco -- unico caminho de abertura manual
-- ============================================================
-- Uma unica transacao (corpo da funcao): valida, trava a configuracao
-- (FOR UPDATE, ANTES de somar as movimentacoes existentes -- mesmo
-- padrao ja auditado em 0032 de lock na linha PAI antes de agregar os
-- filhos, serializa duas aberturas concorrentes da MESMA configuracao),
-- confere saldo suficiente, insere a movimentacao de sacos (negativa) E
-- a movimentacao de estoque correspondente (negativa, origem_id apontando
-- para a movimentacao de sacos) -- ou tudo, ou nada.
create or replace function public.registrar_abertura_saco(
  p_produto_fornecedor_id uuid,
  p_quantidade_sacos      integer,
  p_operacao_id           uuid,
  p_observacao            text default null
)
returns public.sacos_fechados_movimentacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config          public.produto_fornecedores%rowtype;
  v_saldo_atual     integer;
  v_existente       public.sacos_fechados_movimentacoes%rowtype;
  v_movimentacao    public.sacos_fechados_movimentacoes%rowtype;
  v_unidade_produto text;
begin
  if auth.uid() is null then
    raise exception 'registrar_abertura_saco: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('producao_sacos.operar')) then
    raise exception using errcode = '42501',
      message = 'registrar_abertura_saco: requer a permissao producao_sacos.operar.';
  end if;

  if p_produto_fornecedor_id is null then
    raise exception 'registrar_abertura_saco: produto_fornecedor_id e obrigatorio.';
  end if;

  if p_quantidade_sacos is null or p_quantidade_sacos <= 0 then
    raise exception 'registrar_abertura_saco: quantidade_sacos deve ser um inteiro maior que zero.';
  end if;

  if p_operacao_id is null then
    raise exception 'registrar_abertura_saco: operacao_id e obrigatorio (idempotencia -- gere um uuid novo no cliente antes de chamar esta funcao).';
  end if;

  -- Idempotencia: reenviar a MESMA chamada (duplo clique, retry de rede,
  -- recarregamento com o mesmo operacao_id) devolve a movimentacao ja
  -- criada, em vez de gerar uma segunda baixa. Verificado ANTES de
  -- travar/validar qualquer coisa -- um retry legitimo nao deve falhar
  -- por saldo insuficiente na segunda tentativa so porque a primeira ja
  -- consumiu o saldo.
  select * into v_existente
  from public.sacos_fechados_movimentacoes
  where operacao_id = p_operacao_id;

  if found then
    return v_existente;
  end if;

  -- Trava a linha de CONFIGURACAO antes de somar as movimentacoes
  -- existentes -- mesmo padrao ja auditado em 0032 (lock na linha pai
  -- antes de agregar os filhos). Uma segunda chamada concorrente para a
  -- MESMA configuracao so prossegue depois que esta transacao commitar
  -- (ou reverter) -- nunca ve um saldo desatualizado.
  select * into v_config
  from public.produto_fornecedores
  where id = p_produto_fornecedor_id
  for update;

  if v_config.id is null then
    raise exception 'registrar_abertura_saco: configuracao comercial % nao encontrada.', p_produto_fornecedor_id;
  end if;

  if not v_config.ativo then
    raise exception 'registrar_abertura_saco: configuracao comercial % esta inativa.', p_produto_fornecedor_id;
  end if;

  if not v_config.controla_sacos_fechados then
    raise exception 'registrar_abertura_saco: configuracao comercial % nao esta marcada para controle de sacos fechados.', p_produto_fornecedor_id;
  end if;

  if v_config.peso_por_saco_kg is null or v_config.peso_por_saco_kg <= 0 then
    raise exception 'registrar_abertura_saco: configuracao comercial % nao tem peso_por_saco_kg valido cadastrado.', p_produto_fornecedor_id;
  end if;

  -- Sacos Fechados so opera sobre produtos cuja unidade-base seja KG --
  -- peso_por_saco_kg so faz sentido fisico quando o estoque do produto
  -- tambem e medido em peso. Comparacao case-insensitive SO PARA
  -- VALIDAR (produtos.unidade_medida e texto livre em todo o projeto,
  -- sem dominio fechado -- confirmado por auditoria ate a 0040, valores
  -- reais incluem 'KG'/'UN'/'CX'/etc., sempre em maiusculas neste banco,
  -- mas a comparacao nao deve depender de exatamente essa grafia) --
  -- o valor GRAVADO em estoque_movimentacoes.unidade abaixo continua
  -- sendo o snapshot ORIGINAL (v_unidade_produto), nunca um literal fixo,
  -- para nunca misturar grafias diferentes do mesmo produto ao longo do
  -- tempo.
  select unidade_medida into v_unidade_produto
  from public.produtos
  where id = v_config.produto_id;

  if upper(btrim(coalesce(v_unidade_produto, ''))) <> 'KG' then
    raise exception 'registrar_abertura_saco: produto % tem unidade_medida=%, mas Sacos Fechados so opera sobre produtos cuja unidade-base seja KG.',
      v_config.produto_id, v_unidade_produto;
  end if;

  select coalesce(sum(quantidade_sacos), 0) into v_saldo_atual
  from public.sacos_fechados_movimentacoes
  where produto_fornecedor_id = p_produto_fornecedor_id;

  if v_saldo_atual - p_quantidade_sacos < 0 then
    raise exception 'registrar_abertura_saco: saldo insuficiente (saldo atual: % sacos, tentando abrir: %).',
      v_saldo_atual, p_quantidade_sacos;
  end if;

  insert into public.sacos_fechados_movimentacoes (
    produto_fornecedor_id, quantidade_sacos, peso_por_saco_kg_snapshot,
    tipo, origem, operacao_id, observacao
  ) values (
    p_produto_fornecedor_id, -p_quantidade_sacos, v_config.peso_por_saco_kg,
    'abertura', 'abertura_manual', p_operacao_id, nullif(btrim(coalesce(p_observacao, '')), '')
  )
  returning * into v_movimentacao;

  insert into public.estoque_movimentacoes (
    produto_id, quantidade, unidade, origem, origem_id, observacao
  ) values (
    v_config.produto_id,
    -(p_quantidade_sacos::numeric * v_config.peso_por_saco_kg),
    v_unidade_produto,
    'sacos_fechados_abertura',
    v_movimentacao.id,
    nullif(btrim(coalesce(p_observacao, '')), '')
  );

  return v_movimentacao;
end;
$$;

comment on function public.registrar_abertura_saco(uuid, integer, uuid, text) is
  'Unico caminho de abertura manual de saco fechado. Exige producao_sacos.operar. Trava a linha de produto_fornecedores (FOR UPDATE) antes de somar o saldo atual (mesmo padrao de lock-pai-antes-de-somar-filhos ja auditado em 0032), rejeita produto cuja unidade_medida (case-insensitive) nao seja KG, impede saldo negativo, e insere ATOMICAMENTE a movimentacao de sacos (negativa) e a movimentacao de estoque correspondente (negativa, unidade = snapshot ORIGINAL de produtos.unidade_medida, origem=sacos_fechados_abertura, origem_id apontando para a movimentacao de sacos). Idempotente via operacao_id: reenviar a mesma chamada devolve a movimentacao ja criada, sem duplicar a baixa. SECURITY DEFINER: nenhuma policy normal autoriza este fluxo so com producao_sacos.operar.';

revoke execute on function public.registrar_abertura_saco(uuid, integer, uuid, text) from public;
revoke execute on function public.registrar_abertura_saco(uuid, integer, uuid, text) from anon;
revoke execute on function public.registrar_abertura_saco(uuid, integer, uuid, text) from service_role;
grant execute on function public.registrar_abertura_saco(uuid, integer, uuid, text) to authenticated;


-- ============================================================
-- 6. RPC editar_movimentacao_saco -- correcao de movimento manual
-- ============================================================
-- Somente tipo IN ('abertura','ajuste_manual') sao editaveis -- entradas
-- automaticas de pedido (tipo='entrada', origem='recebimento_pedido'/
-- 'retirada', futuras) e cargas de saldo inicial (tipo='saldo_inicial')
-- NAO passam por esta RPC. UPDATE transacional direto (nao trilha de
-- estorno): corrige quantidade_sacos + a movimentacao de estoque
-- vinculada (via origem_id) na MESMA transacao, e registra o valor
-- anterior/novo em logs_auditoria (0004) -- nenhuma linha nova de
-- movimentacao e criada, o saldo por soma continua correto porque a
-- linha corrigida passa a ser, ela mesma, o valor certo.
create or replace function public.editar_movimentacao_saco(
  p_movimentacao_id       uuid,
  p_nova_quantidade_sacos integer,
  p_observacao            text default null
)
returns public.sacos_fechados_movimentacoes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movimentacao     public.sacos_fechados_movimentacoes%rowtype;
  v_saldo_outros     integer;
  v_saldo_resultante integer;
  v_valor_anterior   text;
begin
  if auth.uid() is null then
    raise exception 'editar_movimentacao_saco: requer sessao autenticada.';
  end if;

  if not (select public.has_permissao('producao_sacos.editar')) then
    raise exception using errcode = '42501',
      message = 'editar_movimentacao_saco: requer a permissao producao_sacos.editar.';
  end if;

  if p_movimentacao_id is null then
    raise exception 'editar_movimentacao_saco: movimentacao_id e obrigatorio.';
  end if;

  if p_nova_quantidade_sacos is null or p_nova_quantidade_sacos = 0 then
    raise exception 'editar_movimentacao_saco: nova quantidade nao pode ser zero.';
  end if;

  select * into v_movimentacao
  from public.sacos_fechados_movimentacoes
  where id = p_movimentacao_id;

  if v_movimentacao.id is null then
    raise exception 'editar_movimentacao_saco: movimentacao % nao encontrada.', p_movimentacao_id;
  end if;

  if v_movimentacao.tipo not in ('abertura', 'ajuste_manual') then
    raise exception 'editar_movimentacao_saco: movimentacao % tem tipo=%, somente aberturas e ajustes manuais podem ser corrigidos por esta funcao.',
      p_movimentacao_id, v_movimentacao.tipo;
  end if;

  if v_movimentacao.tipo = 'abertura' and p_nova_quantidade_sacos >= 0 then
    raise exception 'editar_movimentacao_saco: uma movimentacao do tipo abertura precisa continuar negativa (recebido: %).', p_nova_quantidade_sacos;
  end if;

  -- Trava a CONFIGURACAO (mesma ordem de lock de registrar_abertura_saco
  -- -- configuracao primeiro -- evita deadlock entre as duas RPCs) antes
  -- de recalcular o saldo, para que nenhuma abertura concorrente na
  -- mesma configuracao possa correr entre o calculo do saldo e o UPDATE
  -- abaixo.
  perform 1 from public.produto_fornecedores
  where id = v_movimentacao.produto_fornecedor_id
  for update;

  -- Trava tambem a propria linha da movimentacao, e recarrega -- fecha a
  -- janela entre o primeiro SELECT (antes do lock da configuracao) e
  -- agora, caso outra transacao tenha alterado esta mesma linha nesse
  -- meio-tempo.
  select * into v_movimentacao
  from public.sacos_fechados_movimentacoes
  where id = p_movimentacao_id
  for update;

  v_saldo_outros := (
    select coalesce(sum(quantidade_sacos), 0)
    from public.sacos_fechados_movimentacoes
    where produto_fornecedor_id = v_movimentacao.produto_fornecedor_id
      and id <> p_movimentacao_id
  );

  v_saldo_resultante := v_saldo_outros + p_nova_quantidade_sacos;

  if v_saldo_resultante < 0 then
    raise exception 'editar_movimentacao_saco: esta correcao deixaria o saldo negativo (resultante: % sacos).', v_saldo_resultante;
  end if;

  v_valor_anterior := v_movimentacao.quantidade_sacos::text;

  update public.sacos_fechados_movimentacoes
  set quantidade_sacos = p_nova_quantidade_sacos,
      observacao = coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao)
  where id = p_movimentacao_id;

  -- Movimentacao de estoque vinculada (1:1 via origem_id, garantido pelo
  -- indice unico de 0041) -- mesmo peso_por_saco_kg_snapshot da
  -- movimentacao original, nunca o peso ATUAL da configuracao.
  update public.estoque_movimentacoes
  set quantidade = p_nova_quantidade_sacos::numeric * v_movimentacao.peso_por_saco_kg_snapshot
  where origem = 'sacos_fechados_abertura'
    and origem_id = p_movimentacao_id;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('sacos_fechados_movimentacao', p_movimentacao_id::text, 'editou', 'quantidade_sacos', v_valor_anterior, p_nova_quantidade_sacos::text);

  select * into v_movimentacao
  from public.sacos_fechados_movimentacoes
  where id = p_movimentacao_id;

  return v_movimentacao;
end;
$$;

comment on function public.editar_movimentacao_saco(uuid, integer, text) is
  'Corrige uma movimentacao de sacos MANUAL ja registrada (tipo abertura ou ajuste_manual -- nunca entrada automatica de pedido). Trava a configuracao (FOR UPDATE, mesma ordem de registrar_abertura_saco -- evita deadlock) e a propria movimentacao antes de recalcular o saldo excluindo a linha em edicao; impede que a correcao deixe o saldo negativo. UPDATE transacional direto (nao gera linha nova): corrige quantidade_sacos + a movimentacao de estoque vinculada (via origem_id, 1:1) na MESMA transacao, preservando peso_por_saco_kg_snapshot original. Registra valor anterior/novo em logs_auditoria. Exige producao_sacos.editar. SECURITY DEFINER: mesma razao de registrar_abertura_saco.';

revoke execute on function public.editar_movimentacao_saco(uuid, integer, text) from public;
revoke execute on function public.editar_movimentacao_saco(uuid, integer, text) from anon;
revoke execute on function public.editar_movimentacao_saco(uuid, integer, text) from service_role;
grant execute on function public.editar_movimentacao_saco(uuid, integer, text) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO -- NAO REVERSIVEL EM UM PONTO: movimentacoes ja registradas via
-- registrar_abertura_saco()/editar_movimentacao_saco() antes do rollback
-- NAO tem seus efeitos em estoque_movimentacoes desfeitos automaticamente
-- por este rollback -- avaliar manualmente antes de rodar, se ja houver
-- uso real.
-- BEGIN;
--
--   revoke execute on function public.editar_movimentacao_saco(uuid, integer, text) from authenticated;
--   drop function if exists public.editar_movimentacao_saco(uuid, integer, text);
--
--   revoke execute on function public.registrar_abertura_saco(uuid, integer, uuid, text) from authenticated;
--   drop function if exists public.registrar_abertura_saco(uuid, integer, uuid, text);
--
--   delete from public.perfil_permissoes where permissao like 'producao_sacos.%';
--   delete from public.permissoes where codigo like 'producao_sacos.%';
--
--   -- Restaura produto_fornecedores_protecao() para o corpo ORIGINAL de
--   -- 0023 (SECURITY INVOKER, sem a checagem de peso).
--   create or replace function public.produto_fornecedores_protecao()
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
--         raise exception 'produto_fornecedores: produto_id e imutavel.';
--       end if;
--       if new.fornecedor_id is distinct from old.fornecedor_id then
--         raise exception 'produto_fornecedores: fornecedor_id e imutavel.';
--       end if;
--       if new.criado_por is distinct from old.criado_por then
--         raise exception 'produto_fornecedores: criado_por e imutavel.';
--       end if;
--       if new.criado_em is distinct from old.criado_em then
--         raise exception 'produto_fornecedores: criado_em e imutavel.';
--       end if;
--       new.atualizado_em := now();
--       return new;
--     end if;
--     return null;
--   end;
--   $$;
--
--   drop trigger if exists sacos_fechados_movimentacoes_protecao_trigger on public.sacos_fechados_movimentacoes;
--   drop function if exists public.sacos_fechados_movimentacoes_protecao();
--   drop table if exists public.sacos_fechados_movimentacoes; -- ATENCAO: apaga dados ja gravados
--
--   alter table public.produto_fornecedores
--     drop constraint if exists produto_fornecedores_peso_saco_coerente_check;
--   alter table public.produto_fornecedores
--     drop column if exists peso_por_saco_kg; -- ATENCAO: apaga dados ja gravados
--   alter table public.produto_fornecedores
--     drop column if exists controla_sacos_fechados; -- ATENCAO: apaga dados ja gravados
--
-- COMMIT;
