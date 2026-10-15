-- 0076_folha_lancamentos.sql
-- FOLHA DE PAGAMENTO > PAGAMENTOS -- LANCAMENTOS PENDENTES POR FUNCIONARIA.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor,
-- depois de conferir a pre-auditoria (0076 PREAUDIT). Pre-requisito: 0065
-- a 0068 aplicadas, com as RPCs de pagamento IDENTICAS as do repositorio
-- (a guarda abaixo compara o corpo real de cada funcao substituida e
-- aborta se for diferente -- esta migration nunca sobrescreve uma versao
-- desconhecida).
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1. public.folha_lancamentos_tipos -- catalogo PARAMETRIZAVEL de tipos
--      de lancamento (nome unico sem diferenciar maiusculas, natureza
--      padrao desconto|acrescimo, ativo/inativo). Sem exclusao fisica.
--      SEED: 3 tipos iniciais de DESCONTO, ativos (Compra na Padoca,
--      Adiantamento, Vale). Ajuste/Outros NAO sao criados (natureza
--      ambigua). Os demais tipos sao criados em Pagamentos > Configuracoes.
--   2. public.folha_lancamentos -- lancamento financeiro vinculado a
--      funcionaria, INDEPENDENTE de pagamento: natureza (desconto|
--      acrescimo), tipo, valor, data, observacao, status pendente|
--      utilizado|cancelado, autoria do servidor (auth.uid()) e vinculo com
--      o pagamento que o utilizou. DATA NUNCA NO FUTURO: data_lancamento <=
--      public.folha_hoje() (hoje em America/Sao_Paulo, mesmo criterio da
--      Folha desde a 0066 -- nunca current_date/UTC), imposta nas RPCs e no
--      trigger de guarda (inclusive para escrita direta do dono).
--   3. public.folha_pagamentos.total_acrescimos (default 0) e a regra do
--      liquido passa a ser: valor_liquido = valor_bruto + total_acrescimos
--      - total_descontos (pagamentos antigos: acrescimos = 0, mesma conta
--      de antes). total_descontos continua sendo o TOTAL de descontos do
--      pagamento (descontos digitados no pagamento + lancamentos de
--      desconto).
--   4. public.folha_pagamentos_lancamentos -- SNAPSHOT imutavel dos
--      lancamentos considerados em cada pagamento (tipo/nome/natureza/
--      valor/data/observacao congelados). Indice unico parcial impede o
--      mesmo lancamento em 2 pagamentos ativos.
--   5. RPCs de criacao de pagamento (por_hora, mensal, regularizacao
--      historica): DROP + CREATE com o MESMO corpo da 0068 e um parametro
--      novo opcional p_lancamentos uuid[] DEFAULT NULL. Sem lancamentos o
--      comportamento e identico ao atual (chamadas antigas continuam
--      funcionando). Com lancamentos: trava + valida (mesma funcionaria,
--      pendente) + soma + snapshot + pendente -> utilizado, tudo na MESMA
--      transacao da criacao do pagamento. Regra existente mantida:
--      liquido negativo e recusado (descontos > bruto + acrescimos).
--   6. folha_cancelar_pagamento: CREATE OR REPLACE com o MESMO corpo da
--      0066 + os lancamentos do pagamento cancelado voltam a PENDENTE (o
--      snapshot permanece no historico do pagamento cancelado) -- mesmo
--      criterio que ja vale para as jornadas.
--   7. RPCs folha_lancamento_criar / _editar / _cancelar e
--      folha_lancamento_tipo_salvar -- escrita SOMENTE por RPC (padrao da
--      Folha desde a 0066): autoria e status nunca vem do navegador.
--   8. Triggers de guarda: maquina de estados do lancamento, nada e
--      apagado, lancamento utilizado e cancelado sao imutaveis, snapshot
--      imutavel.
--   9. RLS: SELECT por folha_pagamentos.visualizar nas 3 tabelas novas;
--      nenhuma escrita direta (sem INSERT/UPDATE/DELETE para authenticated).
--
-- Permissoes (nenhum codigo novo -- reaproveita as 5 da 0065):
--   visualizar = ver lancamentos/tipos; editar = criar/editar/cancelar
--   lancamento pendente; confirmar = incluir lancamentos num pagamento;
--   cancelar = cancelar pagamento (lancamentos voltam a pendente);
--   regras = cadastrar/alterar tipos de lancamento.
--
-- NAO FAZ: nenhuma alteracao em public.pagamentos (fornecedores/NF-e);
-- nenhum backfill (nenhum lancamento e criado em pagamento antigo); nenhuma
-- mudanca de calculo de jornadas, competencias, saldo-base, escala,
-- beneficios, PIX ou historico; nenhuma permissao nova.
--
-- Transacional (BEGIN/COMMIT): aborta sem criar nada se os pressupostos
-- nao forem verdadeiros.

BEGIN;

-- ============================================================
-- 0. Guarda de ambiente.
-- ============================================================
do $$
declare
  v_fp text;
begin
  if to_regprocedure('public.has_permissao(text)') is null
     or to_regprocedure('public.folha_hoje()') is null
     or to_regprocedure('public.folha_travar_funcionario(uuid)') is null
     or to_regprocedure('public.folha_resolver_valor_item(jsonb,integer,numeric,text)') is null
     or to_regclass('public.funcionarios') is null
     or to_regclass('public.usuarios') is null
     or to_regclass('public.folha_pagamentos') is null
     or to_regclass('public.folha_pagamentos_descontos') is null
     or to_regclass('public.folha_pagamentos_cancelamentos') is null then
    raise exception '0076 abortada: objetos da Folha de Pagamento (0065-0068) nao encontrados.';
  end if;

  if (select count(*) from public.permissoes where codigo in (
        'folha_pagamentos.visualizar', 'folha_pagamentos.editar', 'folha_pagamentos.confirmar',
        'folha_pagamentos.cancelar', 'folha_pagamentos.regras')) <> 5 then
    raise exception '0076 abortada: permissoes folha_pagamentos.* (0065) incompletas.';
  end if;

  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.folha_pagamentos'::regclass and conname = 'folha_pagamentos_valor_liquido_coerente') then
    raise exception '0076 abortada: constraint folha_pagamentos_valor_liquido_coerente (0065) nao encontrada.';
  end if;

  -- As 4 funcoes substituidas precisam ser EXATAMENTE as do repositorio
  -- (corpo normalizado: minusculas, sem espacos).
  select md5(regexp_replace(lower(prosrc), '[[:space:]]+', '', 'g')) into v_fp from pg_proc
  where oid = to_regprocedure('public.folha_criar_pagamento_por_hora(uuid,jsonb,jsonb,date,text)');
  if v_fp is distinct from '4cdda74a89331271450a564ed205281a' then
    raise exception '0076 abortada: folha_criar_pagamento_por_hora real difere da 0068 do repositorio (fingerprint %).', coalesce(v_fp, 'ausente');
  end if;

  select md5(regexp_replace(lower(prosrc), '[[:space:]]+', '', 'g')) into v_fp from pg_proc
  where oid = to_regprocedure('public.folha_criar_pagamento_mensal(uuid,date,text,numeric,jsonb,jsonb,date,text)');
  if v_fp is distinct from '38e35cd7cdf79c079469e42d2bd11186' then
    raise exception '0076 abortada: folha_criar_pagamento_mensal real difere da 0068 do repositorio (fingerprint %).', coalesce(v_fp, 'ausente');
  end if;

  select md5(regexp_replace(lower(prosrc), '[[:space:]]+', '', 'g')) into v_fp from pg_proc
  where oid = to_regprocedure('public.folha_criar_pagamento_regularizacao_historica(uuid,jsonb,jsonb,date,text)');
  if v_fp is distinct from 'f347e6350f0cfe18e6db1d74622571a2' then
    raise exception '0076 abortada: folha_criar_pagamento_regularizacao_historica real difere da 0068 do repositorio (fingerprint %).', coalesce(v_fp, 'ausente');
  end if;

  select md5(regexp_replace(lower(prosrc), '[[:space:]]+', '', 'g')) into v_fp from pg_proc
  where oid = to_regprocedure('public.folha_cancelar_pagamento(uuid,text)');
  if v_fp is distinct from '70a5f141d310755ade3bafd8d92d4cab' then
    raise exception '0076 abortada: folha_cancelar_pagamento real difere da 0066 do repositorio (fingerprint %).', coalesce(v_fp, 'ausente');
  end if;

  -- folha_hoje (0066) e a referencia de "hoje" da regra de data nao futura:
  -- precisa ser exatamente hoje em America/Sao_Paulo.
  select md5(regexp_replace(lower(prosrc), '[[:space:]]+', '', 'g')) into v_fp from pg_proc
  where oid = to_regprocedure('public.folha_hoje()') and prorettype = 'date'::regtype;
  if v_fp is distinct from 'a1f96c34e9488c9cd3a6779bd2b18c1e' then
    raise exception '0076 abortada: folha_hoje() real difere da 0066 do repositorio (fingerprint %).', coalesce(v_fp, 'ausente');
  end if;

  if to_regclass('public.folha_lancamentos_tipos') is not null
     or to_regclass('public.folha_lancamentos') is not null
     or to_regclass('public.folha_pagamentos_lancamentos') is not null
     or exists (select 1 from pg_attribute where attrelid = 'public.folha_pagamentos'::regclass
                and attname = 'total_acrescimos' and not attisdropped)
     or to_regprocedure('public.folha_lancamentos_preparar(uuid,uuid[],text)') is not null
     or to_regprocedure('public.folha_lancamento_criar(uuid,uuid,text,numeric,date,text)') is not null then
    raise exception '0076 abortada: objetos desta migration ja existem -- ela ja parece aplicada.';
  end if;
end $$;

-- ============================================================
-- 1. public.folha_lancamentos_tipos -- catalogo parametrizavel.
-- ============================================================
create table public.folha_lancamentos_tipos (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  natureza        text not null,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  criado_por      uuid references auth.users(id) on delete set null,
  atualizado_em   timestamptz,
  atualizado_por  uuid references auth.users(id) on delete set null,

  constraint folha_lancamentos_tipos_nome_valido check (btrim(nome) <> '' and char_length(nome) <= 60),
  constraint folha_lancamentos_tipos_natureza_valida check (natureza in ('desconto', 'acrescimo'))
);

create unique index folha_lancamentos_tipos_nome_unico_idx
  on public.folha_lancamentos_tipos (lower(btrim(nome)));

comment on table public.folha_lancamentos_tipos is
  'Migration 0076. Catalogo de TIPOS de lancamento da Folha (seed: Compra na Padoca, Adiantamento, Vale -- todos desconto). natureza = natureza PADRAO sugerida ao lancar (o lancamento guarda a sua propria natureza). Nome unico sem diferenciar maiusculas. Sem exclusao fisica: tipo em desuso e inativado (nao aparece para novos lancamentos; historico e pendentes ja criados continuam validos). Escrita somente via folha_lancamento_tipo_salvar (folha_pagamentos.regras).';

-- Tipos iniciais (decisao do negocio): somente DESCONTO e ativos. A tabela
-- acabou de ser criada nesta transacao (a guarda aborta se ja existir), e o
-- NOT EXISTS pela mesma chave do indice unico (lower(btrim(nome))) impede
-- duplicidade mesmo assim. Autoria nula = criado pela migration.
insert into public.folha_lancamentos_tipos (nome, natureza, ativo)
select v.nome, 'desconto', true
from (values ('Compra na Padoca'), ('Adiantamento'), ('Vale')) as v(nome)
where not exists (
  select 1 from public.folha_lancamentos_tipos t where lower(btrim(t.nome)) = lower(btrim(v.nome))
);

-- ============================================================
-- 2. public.folha_lancamentos -- lancamento independente de pagamento.
-- ============================================================
create table public.folha_lancamentos (
  id                    uuid primary key default gen_random_uuid(),
  funcionario_id        uuid not null references public.funcionarios(id),
  tipo_id               uuid not null references public.folha_lancamentos_tipos(id),
  natureza              text not null,
  valor                 numeric(12,2) not null,
  data_lancamento       date not null,
  observacao            text,

  status                text not null default 'pendente',
  pagamento_id          uuid references public.folha_pagamentos(id),
  utilizado_em          timestamptz,

  criado_em             timestamptz not null default now(),
  criado_por            uuid references auth.users(id) on delete set null,
  criado_por_nome       text,
  atualizado_em         timestamptz,
  atualizado_por        uuid references auth.users(id) on delete set null,
  atualizado_por_nome   text,
  cancelado_em          timestamptz,
  cancelado_por         uuid references auth.users(id) on delete set null,
  cancelado_por_nome    text,
  motivo_cancelamento   text,

  constraint folha_lancamentos_natureza_valida check (natureza in ('desconto', 'acrescimo')),
  constraint folha_lancamentos_valor_positivo check (valor > 0),
  constraint folha_lancamentos_observacao_valida check (observacao is null or btrim(observacao) <> ''),
  constraint folha_lancamentos_status_valido check (status in ('pendente', 'utilizado', 'cancelado')),
  constraint folha_lancamentos_estado_coerente check (
    (status = 'pendente' and pagamento_id is null and utilizado_em is null and cancelado_em is null and motivo_cancelamento is null)
    or (status = 'utilizado' and pagamento_id is not null and utilizado_em is not null and cancelado_em is null and motivo_cancelamento is null)
    or (status = 'cancelado' and pagamento_id is null and utilizado_em is null and cancelado_em is not null
        and motivo_cancelamento is not null and btrim(motivo_cancelamento) <> '')
  )
);

create index folha_lancamentos_pendentes_idx on public.folha_lancamentos (funcionario_id) where status = 'pendente';
create index folha_lancamentos_pagamento_id_idx on public.folha_lancamentos (pagamento_id) where pagamento_id is not null;
create index folha_lancamentos_tipo_id_idx on public.folha_lancamentos (tipo_id);

comment on table public.folha_lancamentos is
  'Migration 0076. Lancamento financeiro (desconto ou acrescimo) de uma funcionaria, registrado SEM pagamento (ex.: compra na Padoca hoje). status: pendente (disponivel para um pagamento futuro; editavel/cancelavel) -> utilizado (incluido num pagamento confirmado, pagamento_id preenchido; imutavel) -> volta a pendente se esse pagamento for cancelado; pendente -> cancelado (logico, com motivo; final). Nunca apagado. Autoria (criado_por/atualizado_por/cancelado_por + nomes) sempre do servidor (auth.uid()). Escrita somente via RPCs folha_lancamento_* e pelas RPCs de pagamento.';
comment on column public.folha_lancamentos.natureza is
  'desconto (reduz o liquido) | acrescimo (aumenta o liquido). Sugerida pelo tipo, mas propria do lancamento -- mudar a natureza padrao do tipo nunca altera lancamentos existentes.';
comment on column public.folha_lancamentos.data_lancamento is
  'Data do fato (ex.: dia da compra). Nunca no futuro: <= public.folha_hoje() (hoje em America/Sao_Paulo) ao criar e ao editar -- imposto pelo trigger de guarda e pelas RPCs. Datas passadas sao aceitas.';

-- ============================================================
-- 3. folha_pagamentos -- acrescimos no cabecalho.
-- ============================================================
alter table public.folha_pagamentos
  add column total_acrescimos numeric(12,2) not null default 0;

alter table public.folha_pagamentos
  add constraint folha_pagamentos_total_acrescimos_valido check (total_acrescimos >= 0);

alter table public.folha_pagamentos drop constraint folha_pagamentos_valor_liquido_coerente;
alter table public.folha_pagamentos
  add constraint folha_pagamentos_valor_liquido_coerente
  check (valor_liquido = valor_bruto + total_acrescimos - total_descontos);

comment on column public.folha_pagamentos.total_acrescimos is
  'Migration 0076. Soma dos lancamentos de ACRESCIMO incluidos neste pagamento (snapshot; 0 em todo pagamento anterior a 0076). valor_liquido = valor_bruto + total_acrescimos - total_descontos.';
comment on column public.folha_pagamentos.total_descontos is
  'Total de descontos do pagamento (snapshot): descontos digitados no proprio pagamento (folha_pagamentos_descontos) + lancamentos de DESCONTO incluidos (folha_pagamentos_lancamentos, desde a 0076).';

-- ============================================================
-- 4. public.folha_pagamentos_lancamentos -- snapshot por pagamento.
-- ============================================================
create table public.folha_pagamentos_lancamentos (
  id                    uuid primary key default gen_random_uuid(),
  pagamento_id          uuid not null references public.folha_pagamentos(id) on delete cascade,
  lancamento_id         uuid not null references public.folha_lancamentos(id),
  funcionario_id        uuid not null references public.funcionarios(id),
  natureza              text not null,
  tipo_id               uuid not null references public.folha_lancamentos_tipos(id),
  tipo_nome             text not null,
  valor                 numeric(12,2) not null,
  data_lancamento       date not null,
  observacao            text,
  pagamento_cancelado   boolean not null default false,
  criado_em             timestamptz not null default now(),

  constraint folha_pagamentos_lancamentos_natureza_valida check (natureza in ('desconto', 'acrescimo')),
  constraint folha_pagamentos_lancamentos_valor_positivo check (valor > 0),
  constraint folha_pagamentos_lancamentos_tipo_nome_valido check (btrim(tipo_nome) <> '')
);

create unique index folha_pagamentos_lancamentos_ativo_unico_idx
  on public.folha_pagamentos_lancamentos (lancamento_id)
  where not pagamento_cancelado;
create index folha_pagamentos_lancamentos_pagamento_id_idx on public.folha_pagamentos_lancamentos (pagamento_id);

comment on table public.folha_pagamentos_lancamentos is
  'Migration 0076. SNAPSHOT dos lancamentos considerados num pagamento: natureza, tipo (id + NOME congelado), valor, data e observacao do momento da confirmacao -- renomear/inativar o tipo ou editar algo depois nunca muda o historico. pagamento_cancelado espelha o cancelamento do pagamento (mesmo padrao de folha_pagamentos_itens) e libera o indice unico: um lancamento so pode estar em 1 pagamento ATIVO.';
comment on index public.folha_pagamentos_lancamentos_ativo_unico_idx is
  'Migration 0076. Um lancamento nunca e consumido por 2 pagamentos ativos (ultima barreira, alem da trava por funcionario e do FOR UPDATE).';

-- ============================================================
-- 5. Triggers de guarda.
-- ============================================================

-- 5a. Maquina de estados de folha_lancamentos (vale para QUALQUER escrita,
-- inclusive das proprias RPCs): nasce pendente; pendente edita livremente;
-- pendente -> utilizado so com snapshot ativo de um pagamento confirmado da
-- mesma funcionaria; utilizado -> pendente so com o pagamento cancelado;
-- pendente -> cancelado (final). Nada e apagado.
create function public.folha_lancamentos_guarda_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_negocio_igual boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'folha_lancamentos: lancamento nunca e apagado -- cancele o lancamento pendente.';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pendente' or new.pagamento_id is not null then
      raise exception 'folha_lancamentos: lancamento sempre nasce pendente e sem pagamento.';
    end if;
    if new.data_lancamento > public.folha_hoje() then
      raise exception 'folha_lancamentos: data do lancamento (%) nao pode ser no futuro (hoje em America/Sao_Paulo: %).',
        new.data_lancamento, public.folha_hoje();
    end if;
    return new;
  end if;

  if new.id <> old.id or new.funcionario_id <> old.funcionario_id or new.criado_em <> old.criado_em
     or new.criado_por is distinct from old.criado_por or new.criado_por_nome is distinct from old.criado_por_nome then
    raise exception 'folha_lancamentos: funcionaria e autoria do lancamento sao imutaveis.';
  end if;

  v_negocio_igual := (new.tipo_id, new.natureza, new.valor, new.data_lancamento, new.observacao)
                     is not distinct from (old.tipo_id, old.natureza, old.valor, old.data_lancamento, old.observacao);

  if old.status = 'pendente' and new.status = 'pendente' then
    if new.data_lancamento is distinct from old.data_lancamento and new.data_lancamento > public.folha_hoje() then
      raise exception 'folha_lancamentos: data do lancamento (%) nao pode ser no futuro (hoje em America/Sao_Paulo: %).',
        new.data_lancamento, public.folha_hoje();
    end if;
    return new;
  end if;

  if old.status = 'pendente' and new.status = 'utilizado' then
    if not v_negocio_igual then
      raise exception 'folha_lancamentos: o lancamento nao pode mudar ao ser incluido num pagamento.';
    end if;
    if not exists (
      select 1 from public.folha_pagamentos_lancamentos s
      join public.folha_pagamentos p on p.id = s.pagamento_id
      where s.lancamento_id = new.id and s.pagamento_id = new.pagamento_id and not s.pagamento_cancelado
        and p.status = 'confirmado' and p.funcionario_id = new.funcionario_id
    ) then
      raise exception 'folha_lancamentos: so um pagamento confirmado desta funcionaria, que registrou o lancamento, pode utiliza-lo.';
    end if;
    return new;
  end if;

  if old.status = 'pendente' and new.status = 'cancelado' then
    if not v_negocio_igual then
      raise exception 'folha_lancamentos: o cancelamento nao pode alterar o lancamento.';
    end if;
    return new;
  end if;

  if old.status = 'utilizado' and new.status = 'pendente' then
    if not v_negocio_igual then
      raise exception 'folha_lancamentos: o lancamento nao pode mudar ao voltar a pendente.';
    end if;
    if not exists (select 1 from public.folha_pagamentos p where p.id = old.pagamento_id and p.status = 'cancelado') then
      raise exception 'folha_lancamentos: lancamento utilizado so volta a pendente com o cancelamento do pagamento.';
    end if;
    return new;
  end if;

  if old.status = 'utilizado' then
    raise exception 'folha_lancamentos: lancamento ja utilizado em pagamento e imutavel -- cancele o pagamento para libera-lo.';
  end if;
  raise exception 'folha_lancamentos: lancamento cancelado e imutavel.';
end;
$$;

comment on function public.folha_lancamentos_guarda_fn() is
  'Migration 0076. BEFORE INSERT/UPDATE/DELETE em folha_lancamentos: maquina de estados (pendente -> utilizado | cancelado; utilizado -> pendente so com o pagamento cancelado), sem DELETE, funcionaria/autoria imutaveis, dados do lancamento so mudam enquanto pendente, data_lancamento nunca no futuro (folha_hoje, America/Sao_Paulo) ao inserir ou ao mudar a data.';

create trigger folha_lancamentos_guarda_trigger
  before insert or update or delete on public.folha_lancamentos
  for each row execute function public.folha_lancamentos_guarda_fn();

-- 5b. Snapshot imutavel: so pagamento_cancelado false -> true, e so com o
-- pagamento ja cancelado. Nada e apagado.
create function public.folha_pagamentos_lancamentos_imutavel_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'folha_pagamentos_lancamentos: o historico de lancamentos de um pagamento nunca e apagado.';
  end if;
  if (to_jsonb(new) - 'pagamento_cancelado') is distinct from (to_jsonb(old) - 'pagamento_cancelado')
     or (old.pagamento_cancelado and not new.pagamento_cancelado) then
    raise exception 'folha_pagamentos_lancamentos: snapshot de lancamento e imutavel -- so a liberacao por cancelamento do pagamento e permitida.';
  end if;
  if new.pagamento_cancelado and not old.pagamento_cancelado
     and not exists (select 1 from public.folha_pagamentos p where p.id = new.pagamento_id and p.status = 'cancelado') then
    raise exception 'folha_pagamentos_lancamentos: so o cancelamento do pagamento libera o lancamento.';
  end if;
  return new;
end;
$$;

comment on function public.folha_pagamentos_lancamentos_imutavel_fn() is
  'Migration 0076. BEFORE UPDATE/DELETE em folha_pagamentos_lancamentos: snapshot imutavel; so pagamento_cancelado false -> true quando o pagamento ja esta cancelado; sem DELETE.';

create trigger folha_pagamentos_lancamentos_imutavel_trigger
  before update or delete on public.folha_pagamentos_lancamentos
  for each row execute function public.folha_pagamentos_lancamentos_imutavel_fn();

revoke execute on function public.folha_lancamentos_guarda_fn() from public, anon, authenticated, service_role;
revoke execute on function public.folha_pagamentos_lancamentos_imutavel_fn() from public, anon, authenticated, service_role;

-- ============================================================
-- 6. Helpers internos de consumo (sem EXECUTE para papeis de API;
--    chamados somente pelas RPCs de pagamento, depois da trava por
--    funcionario).
-- ============================================================

-- Valida e soma os lancamentos selecionados, SEM escrita: trava as linhas
-- (FOR UPDATE), exige que existam, sejam da mesma funcionaria, estejam
-- pendentes e nao se repitam. Devolve o snapshot que sera gravado.
create function public.folha_lancamentos_preparar(
  p_funcionario_id uuid,
  p_lancamentos    uuid[],
  p_contexto       text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_qtd          integer;
  v_distintos    integer;
  v_encontrados  integer;
  v_lanc         record;
  v_itens        jsonb := '[]'::jsonb;
  v_acrescimos   numeric(12,2) := 0;
  v_descontos    numeric(12,2) := 0;
begin
  if p_lancamentos is null or cardinality(p_lancamentos) = 0 then
    return jsonb_build_object('itens', '[]'::jsonb, 'total_acrescimos', 0, 'total_descontos', 0);
  end if;

  if array_position(p_lancamentos, null) is not null then
    raise exception '%: lancamento invalido (identificador vazio).', p_contexto;
  end if;

  select count(*), count(distinct x) into v_qtd, v_distintos from unnest(p_lancamentos) as x;
  if v_qtd <> v_distintos then
    raise exception '%: lancamento repetido no mesmo pagamento.', p_contexto;
  end if;

  perform 1 from public.folha_lancamentos l where l.id = any(p_lancamentos) order by l.id for update;

  select count(*) into v_encontrados from public.folha_lancamentos l where l.id = any(p_lancamentos);
  if v_encontrados <> v_qtd then
    raise exception '%: lancamento nao encontrado -- atualize a lista e tente novamente.', p_contexto;
  end if;

  for v_lanc in
    select l.id, l.funcionario_id, l.status, l.natureza, l.valor, l.data_lancamento, l.observacao, l.tipo_id, t.nome as tipo_nome
    from public.folha_lancamentos l
    join public.folha_lancamentos_tipos t on t.id = l.tipo_id
    where l.id = any(p_lancamentos)
    order by l.data_lancamento, l.criado_em, l.id
  loop
    if v_lanc.funcionario_id <> p_funcionario_id then
      raise exception '%: o lancamento % pertence a outra funcionaria.', p_contexto, v_lanc.id;
    end if;
    if v_lanc.status <> 'pendente' then
      raise exception '%: o lancamento % nao esta pendente (ja utilizado ou cancelado) -- atualize a lista e tente novamente.', p_contexto, v_lanc.id;
    end if;
    if v_lanc.natureza = 'acrescimo' then
      v_acrescimos := v_acrescimos + v_lanc.valor;
    else
      v_descontos := v_descontos + v_lanc.valor;
    end if;
    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'lancamento_id', v_lanc.id, 'natureza', v_lanc.natureza, 'tipo_id', v_lanc.tipo_id, 'tipo_nome', v_lanc.tipo_nome,
      'valor', v_lanc.valor, 'data_lancamento', v_lanc.data_lancamento, 'observacao', v_lanc.observacao
    ));
  end loop;

  return jsonb_build_object('itens', v_itens, 'total_acrescimos', v_acrescimos, 'total_descontos', v_descontos);
end;
$$;

comment on function public.folha_lancamentos_preparar(uuid, uuid[], text) is
  'Migration 0076 (interna). Valida (existem, mesma funcionaria, pendentes, sem repeticao) e soma os lancamentos selecionados para um pagamento, travando as linhas (FOR UPDATE). Sem escrita. Devolve {itens (snapshot), total_acrescimos, total_descontos}. Lancamento de tipo inativado continua utilizavel (foi criado validamente).';

-- Grava o snapshot e marca os lancamentos como utilizados, na mesma
-- transacao da criacao do pagamento.
create function public.folha_lancamentos_consumir(
  p_pagamento_id   uuid,
  p_funcionario_id uuid,
  p_preparado      jsonb,
  p_contexto       text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_qtd          integer;
  v_atualizados  integer;
begin
  v_qtd := coalesce(jsonb_array_length(p_preparado->'itens'), 0);
  if v_qtd = 0 then
    return;
  end if;

  begin
    insert into public.folha_pagamentos_lancamentos (
      pagamento_id, lancamento_id, funcionario_id, natureza, tipo_id, tipo_nome, valor, data_lancamento, observacao
    )
    select
      p_pagamento_id, (x->>'lancamento_id')::uuid, p_funcionario_id, x->>'natureza', (x->>'tipo_id')::uuid,
      x->>'tipo_nome', (x->>'valor')::numeric(12,2), (x->>'data_lancamento')::date, x->>'observacao'
    from jsonb_array_elements(p_preparado->'itens') as x;
  exception
    when unique_violation then
      raise exception '%: um ou mais lancamentos selecionados ja foram incluidos em outro pagamento (condicao de corrida) -- atualize a lista e tente novamente.', p_contexto;
  end;

  update public.folha_lancamentos l
  set status = 'utilizado', pagamento_id = p_pagamento_id, utilizado_em = now()
  where l.id in (select (x->>'lancamento_id')::uuid from jsonb_array_elements(p_preparado->'itens') as x)
    and l.status = 'pendente'
    and l.funcionario_id = p_funcionario_id;
  get diagnostics v_atualizados = row_count;

  if v_atualizados <> v_qtd then
    raise exception '%: os lancamentos selecionados mudaram durante o pagamento -- atualize a lista e tente novamente.', p_contexto;
  end if;
end;
$$;

comment on function public.folha_lancamentos_consumir(uuid, uuid, jsonb, text) is
  'Migration 0076 (interna). Grava o snapshot (folha_pagamentos_lancamentos) e marca os lancamentos como utilizados (pagamento_id), na mesma transacao do pagamento. Indice unico parcial + contagem de linhas atualizadas impedem consumo duplo.';

revoke execute on function public.folha_lancamentos_preparar(uuid, uuid[], text) from public, anon, authenticated, service_role;
revoke execute on function public.folha_lancamentos_consumir(uuid, uuid, jsonb, text) from public, anon, authenticated, service_role;

-- ============================================================
-- 7. RPCs de cadastro (escrita somente por RPC; autoria do servidor).
-- ============================================================

-- Tipos de lancamento -- folha_pagamentos.regras. p_tipo_id NULL = novo.
create function public.folha_lancamento_tipo_salvar(
  p_tipo_id  uuid,
  p_nome     text,
  p_natureza text,
  p_ativo    boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_id   uuid;
begin
  if not (select public.has_permissao('folha_pagamentos.regras')) then
    raise exception using errcode = '42501',
      message = 'folha_lancamento_tipo_salvar: requer a permissao folha_pagamentos.regras.';
  end if;

  v_nome := nullif(btrim(coalesce(p_nome, '')), '');
  if v_nome is null then
    raise exception 'folha_lancamento_tipo_salvar: informe o nome do tipo.';
  end if;
  if char_length(v_nome) > 60 then
    raise exception 'folha_lancamento_tipo_salvar: nome do tipo muito longo (maximo 60 caracteres).';
  end if;
  if p_natureza is null or p_natureza not in ('desconto', 'acrescimo') then
    raise exception 'folha_lancamento_tipo_salvar: natureza invalida (desconto ou acrescimo).';
  end if;

  begin
    if p_tipo_id is null then
      insert into public.folha_lancamentos_tipos (nome, natureza, ativo, criado_por)
      values (v_nome, p_natureza, coalesce(p_ativo, true), auth.uid())
      returning id into v_id;
    else
      update public.folha_lancamentos_tipos
      set nome = v_nome, natureza = p_natureza, ativo = coalesce(p_ativo, ativo),
          atualizado_em = now(), atualizado_por = auth.uid()
      where id = p_tipo_id
      returning id into v_id;
      if v_id is null then
        raise exception 'folha_lancamento_tipo_salvar: tipo de lancamento nao encontrado.';
      end if;
    end if;
  exception
    when unique_violation then
      raise exception 'folha_lancamento_tipo_salvar: ja existe um tipo de lancamento com este nome.';
  end;

  return v_id;
end;
$$;

comment on function public.folha_lancamento_tipo_salvar(uuid, text, text, boolean) is
  'Migration 0076. Cria (p_tipo_id NULL) ou altera um tipo de lancamento: nome (unico, ate 60), natureza padrao (desconto|acrescimo), ativo. Nunca apaga. Alterar o tipo nao muda lancamentos existentes nem o historico (snapshot). Requer folha_pagamentos.regras.';

-- Lancamento novo -- folha_pagamentos.editar. Sempre nasce pendente.
create function public.folha_lancamento_criar(
  p_funcionario_id  uuid,
  p_tipo_id         uuid,
  p_natureza        text,
  p_valor           numeric,
  p_data_lancamento date,
  p_observacao      text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funcionario_ativo boolean;
  v_tipo_ativo        boolean;
  v_valor             numeric(12,2);
  v_id                uuid;
begin
  if not (select public.has_permissao('folha_pagamentos.editar')) then
    raise exception using errcode = '42501',
      message = 'folha_lancamento_criar: requer a permissao folha_pagamentos.editar.';
  end if;

  select f.ativo into v_funcionario_ativo from public.funcionarios f where f.id = p_funcionario_id;
  if not found then
    raise exception 'folha_lancamento_criar: funcionaria nao encontrada.';
  end if;
  if not v_funcionario_ativo then
    raise exception 'folha_lancamento_criar: funcionaria inativa -- nao recebe novos lancamentos.';
  end if;

  select t.ativo into v_tipo_ativo from public.folha_lancamentos_tipos t where t.id = p_tipo_id;
  if not found then
    raise exception 'folha_lancamento_criar: tipo de lancamento nao encontrado.';
  end if;
  if not v_tipo_ativo then
    raise exception 'folha_lancamento_criar: tipo de lancamento inativo -- escolha um tipo ativo.';
  end if;

  if p_natureza is null or p_natureza not in ('desconto', 'acrescimo') then
    raise exception 'folha_lancamento_criar: natureza invalida (desconto ou acrescimo).';
  end if;

  v_valor := round(p_valor, 2);
  if v_valor is null or v_valor <= 0 then
    raise exception 'folha_lancamento_criar: o valor precisa ser maior que zero.';
  end if;

  if p_data_lancamento is null then
    raise exception 'folha_lancamento_criar: informe a data do lancamento.';
  end if;
  -- Hoje em America/Sao_Paulo (folha_hoje, 0066) -- nunca current_date/UTC,
  -- que bloquearia lancamentos feitos a noite no horario da Padoca.
  if p_data_lancamento > public.folha_hoje() then
    raise exception 'folha_lancamento_criar: a data do lancamento (%) nao pode ser no futuro (hoje: %).',
      p_data_lancamento, public.folha_hoje();
  end if;

  insert into public.folha_lancamentos (
    funcionario_id, tipo_id, natureza, valor, data_lancamento, observacao, criado_por, criado_por_nome
  ) values (
    p_funcionario_id, p_tipo_id, p_natureza, v_valor, p_data_lancamento, nullif(btrim(coalesce(p_observacao, '')), ''),
    auth.uid(), (select u.nome from public.usuarios u where u.id = auth.uid())
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.folha_lancamento_criar(uuid, uuid, text, numeric, date, text) is
  'Migration 0076. Registra um lancamento PENDENTE (sem pagamento) para uma funcionaria ativa: tipo ativo, natureza desconto|acrescimo, valor > 0 (2 casas), data <= hoje (America/Sao_Paulo), observacao opcional. Autoria = auth.uid(). Requer folha_pagamentos.editar.';

-- Edicao -- somente pendente; trava a funcionaria (mesma trava das RPCs de
-- pagamento) para nunca correr com um pagamento em andamento.
create function public.folha_lancamento_editar(
  p_lancamento_id   uuid,
  p_tipo_id         uuid,
  p_natureza        text,
  p_valor           numeric,
  p_data_lancamento date,
  p_observacao      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funcionario_id uuid;
  v_status         text;
  v_tipo_atual     uuid;
  v_tipo_ativo     boolean;
  v_valor          numeric(12,2);
begin
  if not (select public.has_permissao('folha_pagamentos.editar')) then
    raise exception using errcode = '42501',
      message = 'folha_lancamento_editar: requer a permissao folha_pagamentos.editar.';
  end if;

  select l.funcionario_id into v_funcionario_id from public.folha_lancamentos l where l.id = p_lancamento_id;
  if not found then
    raise exception 'folha_lancamento_editar: lancamento nao encontrado.';
  end if;

  perform public.folha_travar_funcionario(v_funcionario_id);

  select l.status, l.tipo_id into v_status, v_tipo_atual from public.folha_lancamentos l where l.id = p_lancamento_id for update;
  if v_status <> 'pendente' then
    raise exception 'folha_lancamento_editar: so lancamento pendente pode ser editado (este esta %).', v_status;
  end if;

  select t.ativo into v_tipo_ativo from public.folha_lancamentos_tipos t where t.id = p_tipo_id;
  if not found then
    raise exception 'folha_lancamento_editar: tipo de lancamento nao encontrado.';
  end if;
  if p_tipo_id is distinct from v_tipo_atual and not v_tipo_ativo then
    raise exception 'folha_lancamento_editar: tipo de lancamento inativo -- escolha um tipo ativo.';
  end if;

  if p_natureza is null or p_natureza not in ('desconto', 'acrescimo') then
    raise exception 'folha_lancamento_editar: natureza invalida (desconto ou acrescimo).';
  end if;

  v_valor := round(p_valor, 2);
  if v_valor is null or v_valor <= 0 then
    raise exception 'folha_lancamento_editar: o valor precisa ser maior que zero.';
  end if;

  if p_data_lancamento is null then
    raise exception 'folha_lancamento_editar: informe a data do lancamento.';
  end if;
  -- Hoje em America/Sao_Paulo (folha_hoje, 0066) -- nunca current_date/UTC,
  -- que bloquearia lancamentos feitos a noite no horario da Padoca.
  if p_data_lancamento > public.folha_hoje() then
    raise exception 'folha_lancamento_editar: a data do lancamento (%) nao pode ser no futuro (hoje: %).',
      p_data_lancamento, public.folha_hoje();
  end if;

  update public.folha_lancamentos
  set tipo_id = p_tipo_id, natureza = p_natureza, valor = v_valor, data_lancamento = p_data_lancamento,
      observacao = nullif(btrim(coalesce(p_observacao, '')), ''),
      atualizado_em = now(), atualizado_por = auth.uid(),
      atualizado_por_nome = (select u.nome from public.usuarios u where u.id = auth.uid())
  where id = p_lancamento_id;
end;
$$;

comment on function public.folha_lancamento_editar(uuid, uuid, text, numeric, date, text) is
  'Migration 0076. Edita um lancamento PENDENTE (tipo, natureza, valor, data <= hoje em America/Sao_Paulo, observacao). Utilizado ou cancelado nao muda. Trava a funcionaria + FOR UPDATE. Requer folha_pagamentos.editar.';

-- Cancelamento logico -- somente pendente, motivo obrigatorio.
create function public.folha_lancamento_cancelar(
  p_lancamento_id uuid,
  p_motivo        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funcionario_id uuid;
  v_status         text;
  v_motivo         text;
begin
  if not (select public.has_permissao('folha_pagamentos.editar')) then
    raise exception using errcode = '42501',
      message = 'folha_lancamento_cancelar: requer a permissao folha_pagamentos.editar.';
  end if;

  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
  if v_motivo is null then
    raise exception 'folha_lancamento_cancelar: o motivo do cancelamento e obrigatorio.';
  end if;

  select l.funcionario_id into v_funcionario_id from public.folha_lancamentos l where l.id = p_lancamento_id;
  if not found then
    raise exception 'folha_lancamento_cancelar: lancamento nao encontrado.';
  end if;

  perform public.folha_travar_funcionario(v_funcionario_id);

  select l.status into v_status from public.folha_lancamentos l where l.id = p_lancamento_id for update;
  if v_status <> 'pendente' then
    raise exception 'folha_lancamento_cancelar: so lancamento pendente pode ser cancelado (este esta %).', v_status;
  end if;

  update public.folha_lancamentos
  set status = 'cancelado', cancelado_em = now(), cancelado_por = auth.uid(),
      cancelado_por_nome = (select u.nome from public.usuarios u where u.id = auth.uid()),
      motivo_cancelamento = v_motivo
  where id = p_lancamento_id;
end;
$$;

comment on function public.folha_lancamento_cancelar(uuid, text) is
  'Migration 0076. Cancela LOGICAMENTE um lancamento PENDENTE (motivo obrigatorio; quem/quando do servidor). Lancamento utilizado so e liberado cancelando o pagamento. Requer folha_pagamentos.editar.';

revoke execute on function public.folha_lancamento_tipo_salvar(uuid, text, text, boolean) from public, anon, service_role;
revoke execute on function public.folha_lancamento_criar(uuid, uuid, text, numeric, date, text) from public, anon, service_role;
revoke execute on function public.folha_lancamento_editar(uuid, uuid, text, numeric, date, text) from public, anon, service_role;
revoke execute on function public.folha_lancamento_cancelar(uuid, text) from public, anon, service_role;
grant execute on function public.folha_lancamento_tipo_salvar(uuid, text, text, boolean) to authenticated;
grant execute on function public.folha_lancamento_criar(uuid, uuid, text, numeric, date, text) to authenticated;
grant execute on function public.folha_lancamento_editar(uuid, uuid, text, numeric, date, text) to authenticated;
grant execute on function public.folha_lancamento_cancelar(uuid, text) to authenticated;

-- ============================================================
-- 8. RPCs de criacao de pagamento -- mesmo corpo da 0068 + lancamentos.
--    DROP + CREATE (assinatura nova, p_lancamentos opcional no fim).
-- ============================================================
drop function public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text);
drop function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text);
drop function public.folha_criar_pagamento_regularizacao_historica(uuid, jsonb, jsonb, date, text);

create function public.folha_criar_pagamento_por_hora(
  p_funcionario_id uuid,
  p_jornadas       jsonb,
  p_descontos      jsonb,
  p_data_efetiva   date,
  p_observacao     text,
  p_lancamentos     uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jornada             jsonb;
  v_desconto            jsonb;
  v_data                date;
  v_hora_inicio         time;
  v_hora_fim            time;
  v_duracao_minutos     integer;
  v_valor_hora          numeric(12,2);
  v_resolvido           jsonb;
  v_periodo_id          uuid;
  v_natureza            text;
  v_itens               jsonb := '[]'::jsonb;
  v_total_jornadas      integer;
  v_total_distintas     integer;
  v_bruto               numeric(12,2) := 0;
  v_total_descontos     numeric(12,2) := 0;
  v_liquido             numeric(12,2);
  v_lancamentos         jsonb;
  v_total_acrescimos    numeric(12,2) := 0;
  v_tipo_desconto       text;
  v_valor_desconto      numeric(12,2);
  v_tipo_vinculo_snap   text;
  v_valor_hora_snap     numeric(12,2);
  v_data_max            date;
  v_pagamento_id        uuid;
  v_descontos_norm      jsonb;
  v_corte               date := public.folha_data_corte_historica();
begin
  if not (select public.has_permissao('folha_pagamentos.confirmar')) then
    raise exception using errcode = '42501',
      message = 'folha_criar_pagamento_por_hora: requer a permissao folha_pagamentos.confirmar.';
  end if;

  if p_funcionario_id is null or not exists (select 1 from public.funcionarios where id = p_funcionario_id) then
    raise exception 'folha_criar_pagamento_por_hora: funcionario % nao encontrado.', p_funcionario_id;
  end if;

  if p_jornadas is null or jsonb_typeof(p_jornadas) <> 'array' or jsonb_array_length(p_jornadas) = 0 then
    raise exception 'folha_criar_pagamento_por_hora: p_jornadas precisa ser um array JSON com pelo menos 1 jornada.';
  end if;

  v_descontos_norm := coalesce(p_descontos, '[]'::jsonb);
  if jsonb_typeof(v_descontos_norm) <> 'array' then
    raise exception 'folha_criar_pagamento_por_hora: p_descontos precisa ser um array JSON.';
  end if;

  if p_data_efetiva is null then
    raise exception 'folha_criar_pagamento_por_hora: p_data_efetiva e obrigatoria.';
  end if;

  perform public.folha_travar_funcionario(p_funcionario_id);

  select count(*), count(distinct (j->>'data') || '|' || (j->>'hora_inicio') || '|' || (j->>'hora_fim'))
  into v_total_jornadas, v_total_distintas
  from jsonb_array_elements(p_jornadas) as j;

  if v_total_jornadas <> v_total_distintas then
    raise exception 'folha_criar_pagamento_por_hora: p_jornadas contem jornada duplicada no mesmo pedido.';
  end if;

  -- Passe 1 -- valida e resolve cada jornada SEM nenhuma escrita.
  for v_jornada in select * from jsonb_array_elements(p_jornadas)
  loop
    v_data        := nullif(v_jornada->>'data', '')::date;
    v_hora_inicio := nullif(v_jornada->>'hora_inicio', '')::time;
    v_hora_fim    := nullif(v_jornada->>'hora_fim', '')::time;

    if v_data is null or v_hora_inicio is null or v_hora_fim is null then
      raise exception 'folha_criar_pagamento_por_hora: jornada invalida: %', v_jornada;
    end if;

    if v_data > public.folha_hoje() then
      raise exception 'folha_criar_pagamento_por_hora: a jornada % e futura -- so jornadas ate hoje podem ser pagas.', v_data;
    end if;

    if v_corte is not null and v_data < v_corte then
      raise exception 'folha_criar_pagamento_por_hora: a jornada % e anterior a primeira vigencia do valor/hora (%) -- use a regularizacao historica.', v_data, to_char(v_corte, 'DD/MM/YYYY');
    end if;

    select p.id, p.natureza_financeira into v_periodo_id, v_natureza
    from public.funcionarios_escala_periodos p
    join public.funcionarios_escala_dias d on d.id = p.escala_dia_id
    where d.funcionario_id = p_funcionario_id and d.data = v_data and d.tipo_dia = 'trabalho'
      and p.hora_inicio = v_hora_inicio and p.hora_fim = v_hora_fim
    limit 1;
    if v_periodo_id is null then
      raise exception 'folha_criar_pagamento_por_hora: jornada % %-% nao encontrada na Escala deste funcionario.', v_data, v_hora_inicio, v_hora_fim;
    end if;

    if exists (
      select 1 from public.funcionarios_escala_ocorrencias o
      join public.funcionarios_escala_dias d on d.id = o.escala_dia_id
      where d.funcionario_id = p_funcionario_id and d.data = v_data
    ) then
      raise exception 'folha_criar_pagamento_por_hora: % tem falta/atestado registrado -- jornada nao pagavel.', v_data;
    end if;

    if (
      select fr.forma from public.funcionarios_forma_remuneracao fr
      where fr.funcionario_id = p_funcionario_id and fr.vigente_desde <= v_data
      order by fr.vigente_desde desc limit 1
    ) is distinct from 'por_hora' then
      raise exception 'folha_criar_pagamento_por_hora: funcionario nao esta configurado como por_hora em %.', v_data;
    end if;

    if exists (
      select 1 from public.folha_pagamentos_itens i
      where i.funcionario_id = p_funcionario_id and i.data = v_data
        and i.hora_inicio = v_hora_inicio and i.hora_fim = v_hora_fim
        and not i.pagamento_cancelado
    ) then
      raise exception 'folha_criar_pagamento_por_hora: a jornada % %-% ja foi paga em outro pagamento.', v_data, v_hora_inicio, v_hora_fim;
    end if;

    v_valor_hora := (
      select vh.valor from public.folha_valor_hora vh
      where vh.vigente_desde <= v_data
      order by vh.vigente_desde desc limit 1
    );
    v_duracao_minutos := (extract(epoch from (v_hora_fim - v_hora_inicio)) / 60)::integer;

    v_resolvido := public.folha_resolver_valor_item(v_jornada, v_duracao_minutos, v_valor_hora, 'folha_criar_pagamento_por_hora');

    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'data', v_data, 'hora_inicio', v_hora_inicio, 'hora_fim', v_hora_fim,
      'duracao', v_duracao_minutos, 'natureza', coalesce(v_natureza, 'normal'),
      'valor_hora', v_valor_hora, 'periodo_id', v_periodo_id
    ) || v_resolvido);

    v_bruto := v_bruto + (v_resolvido->>'valor')::numeric(12,2);
  end loop;

  select max(nullif(j->>'data', '')::date) into v_data_max from jsonb_array_elements(p_jornadas) as j;

  v_tipo_vinculo_snap := public.folha_tipo_vinculo_em(p_funcionario_id, v_data_max);
  v_valor_hora_snap := (
    select vh.valor from public.folha_valor_hora vh
    where vh.vigente_desde <= v_data_max
    order by vh.vigente_desde desc limit 1
  );

  for v_desconto in select * from jsonb_array_elements(v_descontos_norm)
  loop
    v_tipo_desconto  := nullif(btrim(coalesce(v_desconto->>'tipo', '')), '');
    v_valor_desconto := nullif(v_desconto->>'valor', '')::numeric(12,2);

    if v_tipo_desconto is null then
      raise exception 'folha_criar_pagamento_por_hora: desconto sem tipo: %', v_desconto;
    end if;
    if v_valor_desconto is null or v_valor_desconto <= 0 then
      raise exception 'folha_criar_pagamento_por_hora: desconto com valor invalido: %', v_desconto;
    end if;

    v_total_descontos := v_total_descontos + v_valor_desconto;
  end loop;

  -- 0076: lancamentos pendentes selecionados (trava das linhas + validacao + soma).
  v_lancamentos := public.folha_lancamentos_preparar(p_funcionario_id, p_lancamentos, 'folha_criar_pagamento_por_hora');
  v_total_acrescimos := (v_lancamentos->>'total_acrescimos')::numeric(12,2);
  v_total_descontos := v_total_descontos + (v_lancamentos->>'total_descontos')::numeric(12,2);

  v_liquido := v_bruto + v_total_acrescimos - v_total_descontos;
  if v_liquido < 0 then
    raise exception 'folha_criar_pagamento_por_hora: descontos (%) ultrapassam o valor bruto (%) mais acrescimos (%).', v_total_descontos, v_bruto, v_total_acrescimos;
  end if;

  -- Passe 2 -- escrita atomica.
  insert into public.folha_pagamentos (
    funcionario_id, natureza, competencia, tipo_vinculo_snapshot,
    valor_mensal_base_snapshot, valor_hora_snapshot,
    tipo_lancamento, valor_base_pago,
    valor_bruto, total_acrescimos, total_descontos, valor_liquido,
    data_efetiva, observacao, confirmado_por, confirmado_por_nome, criado_por
  ) values (
    p_funcionario_id, 'por_hora', null, v_tipo_vinculo_snap,
    null, v_valor_hora_snap,
    null, null,
    v_bruto, v_total_acrescimos, v_total_descontos, v_liquido,
    p_data_efetiva, nullif(btrim(coalesce(p_observacao, '')), ''),
    auth.uid(), (select u.nome from public.usuarios u where u.id = auth.uid()), auth.uid()
  )
  returning id into v_pagamento_id;

  begin
    insert into public.folha_pagamentos_itens (
      pagamento_id, funcionario_id, data, hora_inicio, hora_fim,
      duracao_minutos, natureza_financeira, valor_hora_aplicado,
      valor_calculado, valor, valor_manual, observacao_ajuste, origem_valor, escala_periodo_id
    )
    select
      v_pagamento_id, p_funcionario_id,
      (x->>'data')::date, (x->>'hora_inicio')::time, (x->>'hora_fim')::time,
      (x->>'duracao')::integer, x->>'natureza', (x->>'valor_hora')::numeric(12,2),
      (x->>'valor_calculado')::numeric(12,2), (x->>'valor')::numeric(12,2),
      (x->>'valor_manual')::boolean, x->>'observacao_ajuste', x->>'origem_valor', (x->>'periodo_id')::uuid
    from jsonb_array_elements(v_itens) as x;
  exception
    when unique_violation then
      raise exception 'folha_criar_pagamento_por_hora: uma ou mais jornadas selecionadas ja foram pagas por outro pagamento (condicao de corrida) -- atualize a lista e tente novamente.';
  end;

  insert into public.folha_pagamentos_descontos (pagamento_id, tipo, valor, observacao)
  select v_pagamento_id, btrim(d->>'tipo'), (d->>'valor')::numeric(12,2), nullif(btrim(coalesce(d->>'observacao', '')), '')
  from jsonb_array_elements(v_descontos_norm) as d;

  -- 0076: snapshot dos lancamentos + pendente -> utilizado (mesma transacao).
  perform public.folha_lancamentos_consumir(v_pagamento_id, p_funcionario_id, v_lancamentos, 'folha_criar_pagamento_por_hora');

  return v_pagamento_id;
end;
$$;

comment on function public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text, uuid[]) is
  'Migration 0066 (+0068, +0076). Cria e confirma atomicamente 1 pagamento natureza=por_hora: p_jornadas = subconjunto (>=1) de {data,hora_inicio,hora_fim, valor?, observacao_ajuste?} pendentes (existem na Escala, dia de trabalho, corte <= data <= hoje, sem falta/atestado, forma por_hora NA DATA, nao pagas). Sem "valor" = automatico; com "valor" diferente do calculado = ajuste manual. p_lancamentos (0076, opcional) = ids de lancamentos PENDENTES da mesma funcionaria: acrescimos somam e descontos subtraem do liquido (liquido = bruto + acrescimos - descontos, nunca negativo); snapshot em folha_pagamentos_lancamentos e lancamento -> utilizado na mesma transacao. Anti-duplicidade: trava por funcionario + checagem + indices unicos parciais. Requer folha_pagamentos.confirmar.';

revoke execute on function public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text, uuid[]) from public;
revoke execute on function public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text, uuid[]) from anon;
revoke execute on function public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text, uuid[]) from service_role;
grant execute on function public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text, uuid[]) to authenticated;

create function public.folha_criar_pagamento_mensal(
  p_funcionario_id   uuid,
  p_competencia      date,
  p_tipo_lancamento  text,
  p_valor_base       numeric,
  p_extras           jsonb,
  p_descontos        jsonb,
  p_data_efetiva     date,
  p_observacao       text,
  p_lancamentos     uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_competencia         date;
  v_fim_mes             date;
  v_forma               text;
  v_valor_mensal_base   numeric(12,2);
  v_ja_pago             numeric(12,2);
  v_saldo               numeric(12,2);
  v_valor_base          numeric(12,2);
  v_valor_hora_snap     numeric(12,2);
  v_tipo_vinculo_snap   text;
  v_extra               jsonb;
  v_desconto            jsonb;
  v_data                date;
  v_hora_inicio         time;
  v_hora_fim            time;
  v_duracao_minutos     integer;
  v_valor_hora          numeric(12,2);
  v_resolvido           jsonb;
  v_periodo_id          uuid;
  v_itens               jsonb := '[]'::jsonb;
  v_bruto               numeric(12,2);
  v_total_descontos     numeric(12,2) := 0;
  v_liquido             numeric(12,2);
  v_lancamentos         jsonb;
  v_total_acrescimos    numeric(12,2) := 0;
  v_total_extras        integer;
  v_total_extras_dist   integer;
  v_tipo_desconto       text;
  v_valor_desconto      numeric(12,2);
  v_pagamento_id        uuid;
  v_extras_norm         jsonb;
  v_descontos_norm      jsonb;
  v_corte               date := public.folha_data_corte_historica();
begin
  if not (select public.has_permissao('folha_pagamentos.confirmar')) then
    raise exception using errcode = '42501',
      message = 'folha_criar_pagamento_mensal: requer a permissao folha_pagamentos.confirmar.';
  end if;

  if p_funcionario_id is null or not exists (select 1 from public.funcionarios where id = p_funcionario_id) then
    raise exception 'folha_criar_pagamento_mensal: funcionario % nao encontrado.', p_funcionario_id;
  end if;

  if p_competencia is null then
    raise exception 'folha_criar_pagamento_mensal: p_competencia e obrigatoria.';
  end if;
  if p_data_efetiva is null then
    raise exception 'folha_criar_pagamento_mensal: p_data_efetiva e obrigatoria.';
  end if;
  if p_tipo_lancamento is null or p_tipo_lancamento not in ('integral', 'adiantamento', 'parcial', 'complemento') then
    raise exception 'folha_criar_pagamento_mensal: tipo de lancamento invalido "%" -- use integral, adiantamento, parcial ou complemento.', p_tipo_lancamento;
  end if;
  if p_valor_base is null or p_valor_base < 0 then
    raise exception 'folha_criar_pagamento_mensal: valor da base invalido (%).', p_valor_base;
  end if;
  v_valor_base := round(p_valor_base, 2);

  v_extras_norm := coalesce(p_extras, '[]'::jsonb);
  if jsonb_typeof(v_extras_norm) <> 'array' then
    raise exception 'folha_criar_pagamento_mensal: p_extras precisa ser um array JSON.';
  end if;
  v_descontos_norm := coalesce(p_descontos, '[]'::jsonb);
  if jsonb_typeof(v_descontos_norm) <> 'array' then
    raise exception 'folha_criar_pagamento_mensal: p_descontos precisa ser um array JSON.';
  end if;

  perform public.folha_travar_funcionario(p_funcionario_id);

  v_competencia := date_trunc('month', p_competencia)::date;
  v_fim_mes := (v_competencia + interval '1 month' - interval '1 day')::date;

  v_forma := (
    select fr.forma from public.funcionarios_forma_remuneracao fr
    where fr.funcionario_id = p_funcionario_id and fr.vigente_desde <= v_fim_mes
    order by fr.vigente_desde desc limit 1
  );
  if v_forma is distinct from 'mensal' then
    raise exception 'folha_criar_pagamento_mensal: funcionario nao esta configurado como mensal na competencia %.', to_char(v_competencia, 'MM/YYYY');
  end if;

  v_valor_mensal_base := (
    select rb.valor from public.funcionarios_remuneracao_base rb
    where rb.funcionario_id = p_funcionario_id and rb.vigente_desde <= v_fim_mes
    order by rb.vigente_desde desc limit 1
  );
  if v_valor_mensal_base is null then
    raise exception 'folha_criar_pagamento_mensal: nao ha remuneracao-base mensal configurada para a competencia %.', to_char(v_competencia, 'MM/YYYY');
  end if;

  select coalesce(sum(fp.valor_base_pago), 0) into v_ja_pago
  from public.folha_pagamentos fp
  where fp.funcionario_id = p_funcionario_id and fp.natureza = 'mensal'
    and fp.competencia = v_competencia and fp.status = 'confirmado';

  v_saldo := greatest(v_valor_mensal_base - v_ja_pago, 0);
  if v_valor_base > v_saldo then
    raise exception 'folha_criar_pagamento_mensal: o valor da base (%) excede o saldo da competencia % (base %, ja pago %, saldo %).',
      v_valor_base, to_char(v_competencia, 'MM/YYYY'), v_valor_mensal_base, v_ja_pago, v_saldo;
  end if;

  -- (migration 0067, preservado) -- Integral = quitar EXATAMENTE o saldo.
  if p_tipo_lancamento = 'integral' and v_saldo = 0 then
    raise exception 'folha_criar_pagamento_mensal: lancamento integral sem saldo -- a base da competencia % ja foi quitada; use complemento para lancar apenas extras.',
      to_char(v_competencia, 'MM/YYYY');
  end if;
  if p_tipo_lancamento = 'integral' and v_valor_base <> v_saldo then
    raise exception 'folha_criar_pagamento_mensal: lancamento integral precisa quitar exatamente o saldo da competencia % (saldo %, informado %); para valor menor use adiantamento ou parcial.',
      to_char(v_competencia, 'MM/YYYY'), v_saldo, v_valor_base;
  end if;

  v_tipo_vinculo_snap := public.folha_tipo_vinculo_em(p_funcionario_id, v_fim_mes);
  v_valor_hora_snap := (
    select vh.valor from public.folha_valor_hora vh
    where vh.vigente_desde <= v_fim_mes
    order by vh.vigente_desde desc limit 1
  );

  select count(*), count(distinct (e->>'data') || '|' || (e->>'hora_inicio') || '|' || (e->>'hora_fim'))
  into v_total_extras, v_total_extras_dist
  from jsonb_array_elements(v_extras_norm) as e;
  if v_total_extras <> v_total_extras_dist then
    raise exception 'folha_criar_pagamento_mensal: p_extras contem item duplicado no mesmo pedido.';
  end if;

  v_bruto := v_valor_base;

  for v_extra in select * from jsonb_array_elements(v_extras_norm)
  loop
    v_data        := nullif(v_extra->>'data', '')::date;
    v_hora_inicio := nullif(v_extra->>'hora_inicio', '')::time;
    v_hora_fim    := nullif(v_extra->>'hora_fim', '')::time;

    if v_data is null or v_hora_inicio is null or v_hora_fim is null then
      raise exception 'folha_criar_pagamento_mensal: extra invalido: %', v_extra;
    end if;
    if v_data < v_competencia or v_data > v_fim_mes then
      raise exception 'folha_criar_pagamento_mensal: extra % fora da competencia %.', v_data, to_char(v_competencia, 'MM/YYYY');
    end if;
    if v_data > public.folha_hoje() then
      raise exception 'folha_criar_pagamento_mensal: o extra % e futuro -- so extras ate hoje podem ser pagos.', v_data;
    end if;
    if v_corte is not null and v_data < v_corte then
      raise exception 'folha_criar_pagamento_mensal: o extra % e anterior a primeira vigencia do valor/hora (%) -- use a regularizacao historica.', v_data, to_char(v_corte, 'DD/MM/YYYY');
    end if;

    v_periodo_id := null;
    select p.id into v_periodo_id
    from public.funcionarios_escala_periodos p
    join public.funcionarios_escala_dias d on d.id = p.escala_dia_id
    where d.funcionario_id = p_funcionario_id and d.data = v_data and d.tipo_dia = 'trabalho'
      and p.hora_inicio = v_hora_inicio and p.hora_fim = v_hora_fim
      and p.natureza_financeira = 'extra_remunerado'
    limit 1;
    if v_periodo_id is null then
      raise exception 'folha_criar_pagamento_mensal: % %-% nao esta marcado como extra remunerado na Escala.', v_data, v_hora_inicio, v_hora_fim;
    end if;

    if exists (
      select 1 from public.funcionarios_escala_ocorrencias o
      join public.funcionarios_escala_dias d on d.id = o.escala_dia_id
      where d.funcionario_id = p_funcionario_id and d.data = v_data
    ) then
      raise exception 'folha_criar_pagamento_mensal: % tem falta/atestado registrado -- extra nao pagavel.', v_data;
    end if;

    if (
      select fr.forma from public.funcionarios_forma_remuneracao fr
      where fr.funcionario_id = p_funcionario_id and fr.vigente_desde <= v_data
      order by fr.vigente_desde desc limit 1
    ) is distinct from 'mensal' then
      raise exception 'folha_criar_pagamento_mensal: funcionario nao esta configurado como mensal em % -- extra nao e adicional.', v_data;
    end if;

    if exists (
      select 1 from public.folha_pagamentos_itens i
      where i.funcionario_id = p_funcionario_id and i.data = v_data
        and i.hora_inicio = v_hora_inicio and i.hora_fim = v_hora_fim
        and not i.pagamento_cancelado
    ) then
      raise exception 'folha_criar_pagamento_mensal: o extra % %-% ja foi pago em outro pagamento.', v_data, v_hora_inicio, v_hora_fim;
    end if;

    v_valor_hora := (
      select vh.valor from public.folha_valor_hora vh
      where vh.vigente_desde <= v_data
      order by vh.vigente_desde desc limit 1
    );
    v_duracao_minutos := (extract(epoch from (v_hora_fim - v_hora_inicio)) / 60)::integer;

    v_resolvido := public.folha_resolver_valor_item(v_extra, v_duracao_minutos, v_valor_hora, 'folha_criar_pagamento_mensal');

    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'data', v_data, 'hora_inicio', v_hora_inicio, 'hora_fim', v_hora_fim,
      'duracao', v_duracao_minutos, 'valor_hora', v_valor_hora, 'periodo_id', v_periodo_id
    ) || v_resolvido);

    v_bruto := v_bruto + (v_resolvido->>'valor')::numeric(12,2);
  end loop;

  if v_bruto <= 0 then
    raise exception 'folha_criar_pagamento_mensal: pagamento sem valor -- informe um valor de base e/ou selecione extras.';
  end if;

  for v_desconto in select * from jsonb_array_elements(v_descontos_norm)
  loop
    v_tipo_desconto  := nullif(btrim(coalesce(v_desconto->>'tipo', '')), '');
    v_valor_desconto := nullif(v_desconto->>'valor', '')::numeric(12,2);
    if v_tipo_desconto is null then
      raise exception 'folha_criar_pagamento_mensal: desconto sem tipo: %', v_desconto;
    end if;
    if v_valor_desconto is null or v_valor_desconto <= 0 then
      raise exception 'folha_criar_pagamento_mensal: desconto com valor invalido: %', v_desconto;
    end if;
    v_total_descontos := v_total_descontos + v_valor_desconto;
  end loop;

  -- 0076: lancamentos pendentes selecionados (trava das linhas + validacao + soma).
  v_lancamentos := public.folha_lancamentos_preparar(p_funcionario_id, p_lancamentos, 'folha_criar_pagamento_mensal');
  v_total_acrescimos := (v_lancamentos->>'total_acrescimos')::numeric(12,2);
  v_total_descontos := v_total_descontos + (v_lancamentos->>'total_descontos')::numeric(12,2);

  v_liquido := v_bruto + v_total_acrescimos - v_total_descontos;
  if v_liquido < 0 then
    raise exception 'folha_criar_pagamento_mensal: descontos (%) ultrapassam o valor bruto (%) mais acrescimos (%).', v_total_descontos, v_bruto, v_total_acrescimos;
  end if;

  insert into public.folha_pagamentos (
    funcionario_id, natureza, competencia, tipo_vinculo_snapshot,
    valor_mensal_base_snapshot, valor_hora_snapshot,
    tipo_lancamento, valor_base_pago,
    valor_bruto, total_acrescimos, total_descontos, valor_liquido,
    data_efetiva, observacao, confirmado_por, confirmado_por_nome, criado_por
  ) values (
    p_funcionario_id, 'mensal', v_competencia, v_tipo_vinculo_snap,
    v_valor_mensal_base, v_valor_hora_snap,
    p_tipo_lancamento, v_valor_base,
    v_bruto, v_total_acrescimos, v_total_descontos, v_liquido,
    p_data_efetiva, nullif(btrim(coalesce(p_observacao, '')), ''),
    auth.uid(), (select u.nome from public.usuarios u where u.id = auth.uid()), auth.uid()
  )
  returning id into v_pagamento_id;

  if jsonb_array_length(v_itens) > 0 then
    begin
      insert into public.folha_pagamentos_itens (
        pagamento_id, funcionario_id, data, hora_inicio, hora_fim,
        duracao_minutos, natureza_financeira, valor_hora_aplicado,
        valor_calculado, valor, valor_manual, observacao_ajuste, origem_valor, escala_periodo_id
      )
      select
        v_pagamento_id, p_funcionario_id,
        (x->>'data')::date, (x->>'hora_inicio')::time, (x->>'hora_fim')::time,
        (x->>'duracao')::integer, 'extra_remunerado', (x->>'valor_hora')::numeric(12,2),
        (x->>'valor_calculado')::numeric(12,2), (x->>'valor')::numeric(12,2),
        (x->>'valor_manual')::boolean, x->>'observacao_ajuste', x->>'origem_valor', (x->>'periodo_id')::uuid
      from jsonb_array_elements(v_itens) as x;
    exception
      when unique_violation then
        raise exception 'folha_criar_pagamento_mensal: um ou mais extras selecionados ja foram pagos por outro pagamento (condicao de corrida) -- atualize a lista e tente novamente.';
    end;
  end if;

  insert into public.folha_pagamentos_descontos (pagamento_id, tipo, valor, observacao)
  select v_pagamento_id, btrim(d->>'tipo'), (d->>'valor')::numeric(12,2), nullif(btrim(coalesce(d->>'observacao', '')), '')
  from jsonb_array_elements(v_descontos_norm) as d;

  -- 0076: snapshot dos lancamentos + pendente -> utilizado (mesma transacao).
  perform public.folha_lancamentos_consumir(v_pagamento_id, p_funcionario_id, v_lancamentos, 'folha_criar_pagamento_mensal');

  return v_pagamento_id;
end;
$$;

comment on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text, uuid[]) is
  'Migration 0066 (+0067 integral = saldo exato, +0068 valor manual nos extras, +0076 lancamentos). Cria e confirma atomicamente 1 pagamento natureza=mensal na competencia. Remuneracao-base: p_valor_base (0..saldo; integral = saldo exato > 0) -- NUNCA calculada por jornada. p_extras = extras remunerados pendentes da competencia (automatico ou ajuste manual). Descontos 0..N; p_lancamentos (0076, opcional) = lancamentos PENDENTES da mesma funcionaria (acrescimos somam, descontos subtraem). Bloqueia liquido negativo e bruto = 0. Requer folha_pagamentos.confirmar.';

revoke execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text, uuid[]) from public;
revoke execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text, uuid[]) from anon;
revoke execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text, uuid[]) from service_role;
grant execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text, uuid[]) to authenticated;

create function public.folha_criar_pagamento_regularizacao_historica(
  p_funcionario_id uuid,
  p_jornadas       jsonb,
  p_descontos      jsonb,
  p_data_efetiva   date,
  p_observacao     text,
  p_lancamentos     uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_corte               date := public.folha_data_corte_historica();
  v_jornada             jsonb;
  v_desconto            jsonb;
  v_data                date;
  v_hora_inicio         time;
  v_hora_fim            time;
  v_duracao_minutos     integer;
  v_resolvido           jsonb;
  v_periodo_id          uuid;
  v_natureza            text;
  v_itens               jsonb := '[]'::jsonb;
  v_total_jornadas      integer;
  v_total_distintas     integer;
  v_bruto               numeric(12,2) := 0;
  v_total_descontos     numeric(12,2) := 0;
  v_liquido             numeric(12,2);
  v_lancamentos         jsonb;
  v_total_acrescimos    numeric(12,2) := 0;
  v_tipo_desconto       text;
  v_valor_desconto      numeric(12,2);
  v_data_max            date;
  v_pagamento_id        uuid;
  v_descontos_norm      jsonb;
begin
  if not (select public.has_permissao('folha_pagamentos.confirmar')) then
    raise exception using errcode = '42501',
      message = 'folha_criar_pagamento_regularizacao_historica: requer a permissao folha_pagamentos.confirmar.';
  end if;

  if p_funcionario_id is null or not exists (select 1 from public.funcionarios where id = p_funcionario_id) then
    raise exception 'folha_criar_pagamento_regularizacao_historica: funcionario % nao encontrado.', p_funcionario_id;
  end if;

  if v_corte is null then
    raise exception 'folha_criar_pagamento_regularizacao_historica: nao ha vigencia de valor/hora cadastrada -- nao existe periodo historico a regularizar.';
  end if;

  if p_jornadas is null or jsonb_typeof(p_jornadas) <> 'array' or jsonb_array_length(p_jornadas) = 0 then
    raise exception 'folha_criar_pagamento_regularizacao_historica: p_jornadas precisa ser um array JSON com pelo menos 1 jornada.';
  end if;

  v_descontos_norm := coalesce(p_descontos, '[]'::jsonb);
  if jsonb_typeof(v_descontos_norm) <> 'array' then
    raise exception 'folha_criar_pagamento_regularizacao_historica: p_descontos precisa ser um array JSON.';
  end if;

  if p_data_efetiva is null then
    raise exception 'folha_criar_pagamento_regularizacao_historica: p_data_efetiva e obrigatoria.';
  end if;

  perform public.folha_travar_funcionario(p_funcionario_id);

  select count(*), count(distinct (j->>'data') || '|' || (j->>'hora_inicio') || '|' || (j->>'hora_fim'))
  into v_total_jornadas, v_total_distintas
  from jsonb_array_elements(p_jornadas) as j;
  if v_total_jornadas <> v_total_distintas then
    raise exception 'folha_criar_pagamento_regularizacao_historica: p_jornadas contem jornada duplicada no mesmo pedido.';
  end if;

  for v_jornada in select * from jsonb_array_elements(p_jornadas)
  loop
    v_data        := nullif(v_jornada->>'data', '')::date;
    v_hora_inicio := nullif(v_jornada->>'hora_inicio', '')::time;
    v_hora_fim    := nullif(v_jornada->>'hora_fim', '')::time;

    if v_data is null or v_hora_inicio is null or v_hora_fim is null then
      raise exception 'folha_criar_pagamento_regularizacao_historica: jornada invalida: %', v_jornada;
    end if;

    if v_data >= v_corte then
      raise exception 'folha_criar_pagamento_regularizacao_historica: a jornada % nao e historica -- a excecao so vale antes de % (primeira vigencia do valor/hora); use o pagamento normal.', v_data, to_char(v_corte, 'DD/MM/YYYY');
    end if;

    v_periodo_id := null;
    v_natureza := null;
    select p.id, p.natureza_financeira into v_periodo_id, v_natureza
    from public.funcionarios_escala_periodos p
    join public.funcionarios_escala_dias d on d.id = p.escala_dia_id
    where d.funcionario_id = p_funcionario_id and d.data = v_data and d.tipo_dia = 'trabalho'
      and p.hora_inicio = v_hora_inicio and p.hora_fim = v_hora_fim
    limit 1;
    if v_periodo_id is null then
      raise exception 'folha_criar_pagamento_regularizacao_historica: jornada % %-% nao encontrada na Escala deste funcionario.', v_data, v_hora_inicio, v_hora_fim;
    end if;

    if exists (
      select 1 from public.funcionarios_escala_ocorrencias o
      join public.funcionarios_escala_dias d on d.id = o.escala_dia_id
      where d.funcionario_id = p_funcionario_id and d.data = v_data
    ) then
      raise exception 'folha_criar_pagamento_regularizacao_historica: % tem falta/atestado registrado -- jornada nao regularizavel.', v_data;
    end if;

    if v_natureza = 'normal' and (
      select fr.forma from public.funcionarios_forma_remuneracao fr
      where fr.funcionario_id = p_funcionario_id and fr.vigente_desde <= v_data
      order by fr.vigente_desde desc limit 1
    ) is not distinct from 'mensal' then
      raise exception 'folha_criar_pagamento_regularizacao_historica: em % o funcionario ja era mensal -- periodo normal coberto pela remuneracao-base.', v_data;
    end if;

    if exists (
      select 1 from public.folha_pagamentos_itens i
      where i.funcionario_id = p_funcionario_id and i.data = v_data
        and i.hora_inicio = v_hora_inicio and i.hora_fim = v_hora_fim
        and not i.pagamento_cancelado
    ) then
      raise exception 'folha_criar_pagamento_regularizacao_historica: a jornada % %-% ja foi paga em outro pagamento.', v_data, v_hora_inicio, v_hora_fim;
    end if;

    v_duracao_minutos := (extract(epoch from (v_hora_fim - v_hora_inicio)) / 60)::integer;

    -- sem valor/hora (p_valor_hora NULL) => o "valor" informado e obrigatorio.
    v_resolvido := public.folha_resolver_valor_item(v_jornada, v_duracao_minutos, null, 'folha_criar_pagamento_regularizacao_historica');

    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'data', v_data, 'hora_inicio', v_hora_inicio, 'hora_fim', v_hora_fim,
      'duracao', v_duracao_minutos, 'natureza', coalesce(v_natureza, 'normal'), 'periodo_id', v_periodo_id
    ) || v_resolvido);

    v_bruto := v_bruto + (v_resolvido->>'valor')::numeric(12,2);
  end loop;

  select max(nullif(j->>'data', '')::date) into v_data_max from jsonb_array_elements(p_jornadas) as j;

  for v_desconto in select * from jsonb_array_elements(v_descontos_norm)
  loop
    v_tipo_desconto  := nullif(btrim(coalesce(v_desconto->>'tipo', '')), '');
    v_valor_desconto := nullif(v_desconto->>'valor', '')::numeric(12,2);
    if v_tipo_desconto is null then
      raise exception 'folha_criar_pagamento_regularizacao_historica: desconto sem tipo: %', v_desconto;
    end if;
    if v_valor_desconto is null or v_valor_desconto <= 0 then
      raise exception 'folha_criar_pagamento_regularizacao_historica: desconto com valor invalido: %', v_desconto;
    end if;
    v_total_descontos := v_total_descontos + v_valor_desconto;
  end loop;

  -- 0076: lancamentos pendentes selecionados (trava das linhas + validacao + soma).
  v_lancamentos := public.folha_lancamentos_preparar(p_funcionario_id, p_lancamentos, 'folha_criar_pagamento_regularizacao_historica');
  v_total_acrescimos := (v_lancamentos->>'total_acrescimos')::numeric(12,2);
  v_total_descontos := v_total_descontos + (v_lancamentos->>'total_descontos')::numeric(12,2);

  v_liquido := v_bruto + v_total_acrescimos - v_total_descontos;
  if v_liquido < 0 then
    raise exception 'folha_criar_pagamento_regularizacao_historica: descontos (%) ultrapassam o valor bruto (%) mais acrescimos (%).', v_total_descontos, v_bruto, v_total_acrescimos;
  end if;

  insert into public.folha_pagamentos (
    funcionario_id, natureza, competencia, tipo_vinculo_snapshot,
    valor_mensal_base_snapshot, valor_hora_snapshot,
    tipo_lancamento, valor_base_pago,
    valor_bruto, total_acrescimos, total_descontos, valor_liquido,
    data_efetiva, observacao, confirmado_por, confirmado_por_nome, criado_por
  ) values (
    p_funcionario_id, 'regularizacao_historica', null, public.folha_tipo_vinculo_em(p_funcionario_id, v_data_max),
    null, null,
    null, null,
    v_bruto, v_total_acrescimos, v_total_descontos, v_liquido,
    p_data_efetiva, nullif(btrim(coalesce(p_observacao, '')), ''),
    auth.uid(), (select u.nome from public.usuarios u where u.id = auth.uid()), auth.uid()
  )
  returning id into v_pagamento_id;

  begin
    insert into public.folha_pagamentos_itens (
      pagamento_id, funcionario_id, data, hora_inicio, hora_fim,
      duracao_minutos, natureza_financeira, valor_hora_aplicado,
      valor_calculado, valor, valor_manual, observacao_ajuste, origem_valor, escala_periodo_id
    )
    select
      v_pagamento_id, p_funcionario_id,
      (x->>'data')::date, (x->>'hora_inicio')::time, (x->>'hora_fim')::time,
      (x->>'duracao')::integer, x->>'natureza', null,
      null, (x->>'valor')::numeric(12,2),
      true, x->>'observacao_ajuste', 'regularizacao_historica', (x->>'periodo_id')::uuid
    from jsonb_array_elements(v_itens) as x;
  exception
    when unique_violation then
      raise exception 'folha_criar_pagamento_regularizacao_historica: uma ou mais jornadas selecionadas ja foram pagas por outro pagamento (condicao de corrida) -- atualize a lista e tente novamente.';
  end;

  insert into public.folha_pagamentos_descontos (pagamento_id, tipo, valor, observacao)
  select v_pagamento_id, btrim(d->>'tipo'), (d->>'valor')::numeric(12,2), nullif(btrim(coalesce(d->>'observacao', '')), '')
  from jsonb_array_elements(v_descontos_norm) as d;

  -- 0076: snapshot dos lancamentos + pendente -> utilizado (mesma transacao).
  perform public.folha_lancamentos_consumir(v_pagamento_id, p_funcionario_id, v_lancamentos, 'folha_criar_pagamento_regularizacao_historica');

  return v_pagamento_id;
end;
$$;

comment on function public.folha_criar_pagamento_regularizacao_historica(uuid, jsonb, jsonb, date, text, uuid[]) is
  'Migration 0068 (+0076 lancamentos). REGULARIZACAO HISTORICA: registro financeiro manual de jornadas da Escala anteriores ao corte (MIN(folha_valor_hora.vigente_desde)), valor manual obrigatorio por jornada, sem forma de remuneracao/valor-hora/competencia. p_lancamentos (0076, opcional) = lancamentos PENDENTES da mesma funcionaria (acrescimos somam, descontos subtraem; liquido nunca negativo). Mesma trava por funcionario, anti-duplicidade, imutabilidade e cancelamento dos demais pagamentos. Requer folha_pagamentos.confirmar.';

revoke execute on function public.folha_criar_pagamento_regularizacao_historica(uuid, jsonb, jsonb, date, text, uuid[]) from public;
revoke execute on function public.folha_criar_pagamento_regularizacao_historica(uuid, jsonb, jsonb, date, text, uuid[]) from anon;
revoke execute on function public.folha_criar_pagamento_regularizacao_historica(uuid, jsonb, jsonb, date, text, uuid[]) from service_role;
grant execute on function public.folha_criar_pagamento_regularizacao_historica(uuid, jsonb, jsonb, date, text, uuid[]) to authenticated;

-- ============================================================
-- 9. folha_cancelar_pagamento -- mesmo corpo da 0066 + lancamentos voltam
--    a pendente (snapshot permanece no historico do pagamento cancelado).
--    Mesma assinatura: CREATE OR REPLACE (grants preservados).
-- ============================================================
create or replace function public.folha_cancelar_pagamento(
  p_pagamento_id uuid,
  p_motivo       text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status         text;
  v_funcionario_id uuid;
  v_motivo         text;
begin
  if not (select public.has_permissao('folha_pagamentos.cancelar')) then
    raise exception using errcode = '42501',
      message = 'folha_cancelar_pagamento: requer a permissao folha_pagamentos.cancelar.';
  end if;

  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
  if v_motivo is null then
    raise exception 'folha_cancelar_pagamento: o motivo do cancelamento e obrigatorio.';
  end if;

  select funcionario_id into v_funcionario_id from public.folha_pagamentos where id = p_pagamento_id;
  if not found then
    raise exception 'folha_cancelar_pagamento: pagamento % nao encontrado.', p_pagamento_id;
  end if;

  perform public.folha_travar_funcionario(v_funcionario_id);

  select status into v_status from public.folha_pagamentos where id = p_pagamento_id for update;
  if v_status = 'cancelado' then
    raise exception 'folha_cancelar_pagamento: este pagamento ja esta cancelado.';
  end if;

  update public.folha_pagamentos set status = 'cancelado' where id = p_pagamento_id;
  update public.folha_pagamentos_itens set pagamento_cancelado = true where pagamento_id = p_pagamento_id;

  -- 0076: lancamentos incluidos neste pagamento voltam a ficar pendentes
  -- (o snapshot permanece no historico do pagamento cancelado).
  update public.folha_pagamentos_lancamentos set pagamento_cancelado = true where pagamento_id = p_pagamento_id;
  update public.folha_lancamentos
  set status = 'pendente', pagamento_id = null, utilizado_em = null
  where pagamento_id = p_pagamento_id and status = 'utilizado';

  insert into public.folha_pagamentos_cancelamentos (pagamento_id, cancelado_por, cancelado_por_nome, motivo)
  values (p_pagamento_id, auth.uid(), (select u.nome from public.usuarios u where u.id = auth.uid()), v_motivo);
end;
$$;

comment on function public.folha_cancelar_pagamento(uuid, text) is
  'Migration 0066 (+0076). Estorno LOGICO (nunca DELETE) de 1 pagamento: status=cancelado, libera os itens (a jornada volta a ser pendente), devolve o valor_base_pago ao saldo da competencia, LIBERA OS LANCAMENTOS (0076: snapshot marcado pagamento_cancelado e cada lancamento volta a PENDENTE, disponivel para outro pagamento) e grava quem/quando/motivo (OBRIGATORIO) + nome em folha_pagamentos_cancelamentos. Snapshot, itens, descontos e lancamentos do pagamento permanecem consultaveis. Trava por funcionario + FOR UPDATE. Requer folha_pagamentos.cancelar.';

-- ============================================================
-- 10. RLS e grants -- SOMENTE leitura para authenticated.
-- ============================================================
alter table public.folha_lancamentos_tipos enable row level security;
alter table public.folha_lancamentos enable row level security;
alter table public.folha_pagamentos_lancamentos enable row level security;

create policy folha_lancamentos_tipos_select on public.folha_lancamentos_tipos
  for select to authenticated
  using ((select public.has_permissao('folha_pagamentos.visualizar')));
create policy folha_lancamentos_select on public.folha_lancamentos
  for select to authenticated
  using ((select public.has_permissao('folha_pagamentos.visualizar')));
create policy folha_pagamentos_lancamentos_select on public.folha_pagamentos_lancamentos
  for select to authenticated
  using ((select public.has_permissao('folha_pagamentos.visualizar')));

comment on policy folha_lancamentos_tipos_select on public.folha_lancamentos_tipos is 'Quem ve Pagamentos ve os tipos de lancamento. Escrita so por RPC.';
comment on policy folha_lancamentos_select on public.folha_lancamentos is 'Quem ve Pagamentos ve os lancamentos. Escrita so por RPC.';
comment on policy folha_pagamentos_lancamentos_select on public.folha_pagamentos_lancamentos is 'Quem ve Pagamentos ve o snapshot. Escrita so pelas RPCs de pagamento.';

revoke all on public.folha_lancamentos_tipos, public.folha_lancamentos, public.folha_pagamentos_lancamentos from public, anon;
revoke all on public.folha_lancamentos_tipos, public.folha_lancamentos, public.folha_pagamentos_lancamentos from authenticated;
grant select on public.folha_lancamentos_tipos, public.folha_lancamentos, public.folha_pagamentos_lancamentos to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (manual, so antes de haver lancamento real relevante):
-- reverter exige recriar as 3 RPCs de pagamento e folha_cancelar_pagamento
-- com o corpo EXATO da 0068/0066 (nao reproduzido aqui), depois:
-- BEGIN;
-- drop function if exists public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text, uuid[]);
-- drop function if exists public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text, uuid[]);
-- drop function if exists public.folha_criar_pagamento_regularizacao_historica(uuid, jsonb, jsonb, date, text, uuid[]);
-- -- (recriar as 3 versoes 0068 e folha_cancelar_pagamento 0066 aqui)
-- drop table if exists public.folha_pagamentos_lancamentos;
-- drop table if exists public.folha_lancamentos;
-- drop table if exists public.folha_lancamentos_tipos;
-- alter table public.folha_pagamentos drop constraint if exists folha_pagamentos_valor_liquido_coerente;
-- alter table public.folha_pagamentos add constraint folha_pagamentos_valor_liquido_coerente check (valor_liquido = valor_bruto - total_descontos);
-- alter table public.folha_pagamentos drop constraint if exists folha_pagamentos_total_acrescimos_valido;
-- alter table public.folha_pagamentos drop column if exists total_acrescimos;
-- drop function if exists public.folha_lancamento_cancelar(uuid, text);
-- drop function if exists public.folha_lancamento_editar(uuid, uuid, text, numeric, date, text);
-- drop function if exists public.folha_lancamento_criar(uuid, uuid, text, numeric, date, text);
-- drop function if exists public.folha_lancamento_tipo_salvar(uuid, text, text, boolean);
-- drop function if exists public.folha_lancamentos_consumir(uuid, uuid, jsonb, text);
-- drop function if exists public.folha_lancamentos_preparar(uuid, uuid[], text);
-- drop function if exists public.folha_pagamentos_lancamentos_imutavel_fn();
-- drop function if exists public.folha_lancamentos_guarda_fn();
-- COMMIT;
-- (So funciona se nenhum pagamento tiver acrescimos -- a constraint antiga
-- recusaria esses pagamentos.)
-- ============================================================
