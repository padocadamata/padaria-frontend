-- 0081_importacoes_g3.sql
-- Central de Importacoes do G3ERP (fase 1): Vendas_ProdCliente,
-- FaturamGeral e Vendas_Periodo, com previa, validacao, conciliacao
-- cruzada, versoes, pendencias e reversao por atestados.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Aplicar manualmente no SQL Editor, depois do
-- PREAUDIT (0081_pre_auditoria_importacoes_g3_EXECUTAR.sql); conferir com o
-- POSTAUDIT (0081_pos_auditoria_importacoes_g3_EXECUTAR.sql).
--
-- ACESSO: EXCLUSIVO do perfil proprietario_admin ATIVO, via public.is_admin()
-- (0003) -- que ignora overrides individuais. NENHUM codigo novo em
-- permissoes; nada aparece em "Gerenciar acessos"; nada pode ser concedido.
--   * Tabelas g3_*: RLS ligada, UMA policy de SELECT (is_admin()) para
--     authenticated, NENHUMA policy/grant de INSERT/UPDATE/DELETE.
--   * Escrita SOMENTE pelas RPCs SECURITY DEFINER abaixo; a 1a instrucao de
--     cada uma e g3_exigir_admin() (erro 42501).
--   * Gatilhos de protecao: g3_conteudos/g3_atestados/g3_pendencias sao
--     imutaveis (nem o dono altera/apaga); as demais tabelas so mudam dentro
--     das funcoes (marca transacional g3.operacao). TRUNCATE bloqueado.
--
-- MODELO ("atestados"):
--   faceta 'itens'       <- Vendas_ProdCliente (chave = numero da venda)
--   faceta 'faturamento' <- FaturamGeral       (chave = numero da venda)
--   faceta 'dia'         <- Vendas_Periodo     (chave = dia AAAA-MM-DD)
--   Cada lote confirmado ATESTA o conteudo de cada chave que traz
--   (g3_atestados -> g3_conteudos, conteudo enderecado por hash). O estado
--   vigente de cada (faceta, chave) e o atestado do lote de MAIOR precedencia
--   (gerado_em no G3, depois a ordem de criacao do lote) entre os lotes
--   confirmados e nao revertidos. Um lote que cobre COMPLETAMENTE o dia da
--   chave e nao a traz atesta implicitamente a AUSENCIA dela (venda que
--   sumiu do G3). O estado e funcao pura do conjunto de lotes confirmados:
--   confirmar/reverter em qualquer ordem da o mesmo resultado.
--   g3_estado + g3_vendas/g3_venda_itens/g3_vendas_diarias sao
--   materializacoes desse estado (recalculadas so para as chaves afetadas).
--
-- REGRAS: sem estoque fisico, movimentacao ou validade; nome/CPF de cliente
-- nunca chegam ao banco (mascarados no navegador; o servidor recusa o bloco
-- que contiver dado pessoal, antes de gravar); valores <= 0 e linhas
-- inconsistentes bloqueiam a venda/dia inteiro (pendencia; a ultima versao
-- valida e preservada); relatorio filtrado (secao/categoria/produto/cliente)
-- e recusado; saltos de numeracao nunca sao analisados.
--
-- NAO FAZ: nenhuma alteracao em tabela/funcao/policy/permissao existente;
-- nenhuma permissao nova; nenhuma notificacao; nenhum dado importado.
--
-- Transacional (BEGIN/COMMIT). Aborta sem criar nada se os pressupostos nao
-- forem verdadeiros ou se algum objeto desta migration ja existir.

BEGIN;

-- ============================================================
-- 0. Guarda de ambiente
-- ============================================================
DO $$
begin
  if to_regprocedure('public.is_admin()') is null
     or to_regclass('public.usuarios') is null
     or to_regclass('public.logs_auditoria') is null
     or to_regclass('auth.users') is null
     or to_regprocedure('auth.uid()') is null then
    raise exception '0081 abortada: objetos base (is_admin/usuarios/logs_auditoria/auth) nao encontrados.';
  end if;

  if to_regclass('public.notificacoes') is null then
    raise exception '0081 abortada: a 0080 (Central de Notificacoes) precisa estar aplicada antes.';
  end if;

  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname like 'g3\_%')
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname like 'g3\_%') then
    raise exception '0081 abortada: objetos g3_* ja existem -- ela ja parece aplicada.';
  end if;
end $$;

-- ============================================================
-- 1. Tabelas
-- ============================================================

-- 1.1 Configuracao (linha unica). O CNPJ e dado publico da empresa.
create table public.g3_configuracao (
  id                        boolean primary key default true,
  cnpj                      text not null,
  razao_social              text not null,
  empresa_filtro            text not null,
  empresa_coluna            text not null,
  max_linhas_dados          integer not null default 80000,
  horas_expiracao           integer not null default 24,
  dias_retencao_revertido   integer not null default 90,
  versao_estado             bigint not null default 0,
  atualizado_em             timestamptz not null default now(),
  constraint g3_configuracao_unica check (id),
  constraint g3_configuracao_cnpj check (cnpj ~ '^[0-9]{14}$'),
  constraint g3_configuracao_limites check (
    max_linhas_dados between 1000 and 200000
    and horas_expiracao between 1 and 720
    and dias_retencao_revertido between 1 and 3650
    and versao_estado >= 0)
);

insert into public.g3_configuracao (cnpj, razao_social, empresa_filtro, empresa_coluna)
values ('65214016000142', 'PADOCA DA MATA LTDA', 'PADOCA DA MATA - PADOCA DA MATA LTDA', 'PADOCA DA MATA');

-- 1.2 Lotes de importacao (1 por arquivo enviado).
create table public.g3_importacoes (
  id                      uuid primary key default gen_random_uuid(),
  seq                     bigint generated always as identity,
  layout                  text not null,
  layout_versao           smallint not null default 1,
  status                  text not null default 'recebendo',
  arquivo_nome            text not null,
  arquivo_tamanho         bigint not null,
  arquivo_sha256          text not null,
  arquivo_metadados       jsonb not null default '{}'::jsonb,
  linhas_total            integer not null,
  linhas_recebidas        integer not null default 0,
  gerado_em               timestamptz,
  usuario_g3              text,
  periodo_inicio          date,
  periodo_fim             date,
  cobertura_completa_fim  date,
  dia_parcial             date,
  filtros                 jsonb,
  erros                   jsonb not null default '[]'::jsonb,
  alertas                 jsonb not null default '[]'::jsonb,
  resumo                  jsonb,
  totais                  jsonb,
  estado_base             bigint,
  criado_por              uuid,
  criado_por_nome         text,
  criado_em               timestamptz not null default now(),
  previa_em               timestamptz,
  confirmado_por          uuid,
  confirmado_por_nome     text,
  confirmado_em           timestamptz,
  revertido_por           uuid,
  revertido_por_nome      text,
  revertido_em            timestamptz,
  motivo_reversao         text,
  encerrado_em            timestamptz,
  linhas_purgadas_em      timestamptz,
  constraint g3_importacoes_seq_unica unique (seq),
  constraint g3_importacoes_layout check (layout in ('vendas_produto_cliente', 'faturamento_geral', 'vendas_periodo')),
  constraint g3_importacoes_status check (status in ('recebendo', 'previa', 'rejeitado', 'confirmado', 'descartado', 'expirado', 'revertido')),
  constraint g3_importacoes_arquivo check (
    char_length(arquivo_nome) between 1 and 255
    and arquivo_tamanho between 1 and 31457280
    and arquivo_sha256 ~ '^[0-9a-f]{64}$'
    and jsonb_typeof(arquivo_metadados) = 'object'),
  constraint g3_importacoes_linhas check (linhas_total between 1 and 400000 and linhas_recebidas between 0 and linhas_total),
  constraint g3_importacoes_jsons check (jsonb_typeof(erros) = 'array' and jsonb_typeof(alertas) = 'array'),
  constraint g3_importacoes_periodo check (periodo_inicio is null or periodo_fim is null or periodo_inicio <= periodo_fim),
  constraint g3_importacoes_confirmado check (
    status not in ('confirmado', 'revertido')
    or (gerado_em is not null and periodo_inicio is not null and periodo_fim is not null
        and cobertura_completa_fim is not null and confirmado_em is not null)),
  constraint g3_importacoes_revertido check (
    status <> 'revertido' or (revertido_em is not null and motivo_reversao is not null)),
  constraint g3_importacoes_motivo check (motivo_reversao is null or char_length(motivo_reversao) between 3 and 500)
);

create unique index g3_importacoes_sha_confirmado on public.g3_importacoes (arquivo_sha256) where status = 'confirmado';
create index g3_importacoes_status_idx on public.g3_importacoes (status, criado_em);
create index g3_importacoes_layout_idx on public.g3_importacoes (layout, status);

-- 1.3 Linhas brutas (celulas ja mascaradas no navegador). celulas NULL =
-- linha "igual" de lote confirmado (conteudo identico ja guardado; retencao).
create table public.g3_importacao_linhas (
  lote_id       uuid not null references public.g3_importacoes(id) on delete restrict,
  numero_linha  integer not null,
  celulas       jsonb,
  constraint g3_importacao_linhas_pk primary key (lote_id, numero_linha),
  constraint g3_importacao_linhas_numero check (numero_linha >= 1),
  constraint g3_importacao_linhas_array check (celulas is null or jsonb_typeof(celulas) = 'array')
);

-- 1.4 Previa (temporaria: existe so enquanto o lote esta em previa).
create table public.g3_previa (
  lote_id   uuid not null references public.g3_importacoes(id) on delete restrict,
  faceta    text not null,
  chave     text not null,
  data      date,
  hash      text,
  conteudo  jsonb,
  valor     numeric(16,2),
  acao      text,
  motivo    text,
  detalhe   jsonb,
  linhas    integer[],
  constraint g3_previa_pk primary key (lote_id, faceta, chave),
  constraint g3_previa_faceta check (faceta in ('itens', 'faturamento', 'dia')),
  constraint g3_previa_acao check (acao is null or acao in ('nova', 'alterada', 'igual', 'reaparecida', 'superada', 'bloqueada', 'ausente'))
);

-- 1.5 Conteudos (versoes), enderecados por (faceta, chave, hash). Imutavel.
create table public.g3_conteudos (
  id           bigint generated always as identity primary key,
  faceta       text not null,
  chave        text not null,
  hash         text not null,
  conteudo     jsonb not null,
  lote_origem  uuid not null references public.g3_importacoes(id) on delete restrict,
  criado_em    timestamptz not null default now(),
  constraint g3_conteudos_unico unique (faceta, chave, hash),
  constraint g3_conteudos_faceta check (faceta in ('itens', 'faturamento', 'dia')),
  constraint g3_conteudos_hash check (hash ~ '^[0-9a-f]{64}$'),
  constraint g3_conteudos_objeto check (jsonb_typeof(conteudo) = 'object')
);

-- 1.6 Atestados: o que cada lote confirmado disse de cada chave. Imutavel.
-- acao 'ausente' = registro informativo (chave que o lote marcou como
-- sumida); a ausencia em si e derivada da cobertura do lote.
create table public.g3_atestados (
  lote_id      uuid not null references public.g3_importacoes(id) on delete restrict,
  faceta       text not null,
  chave        text not null,
  conteudo_id  bigint references public.g3_conteudos(id) on delete restrict,
  acao         text not null,
  data         date not null,
  constraint g3_atestados_pk primary key (lote_id, faceta, chave),
  constraint g3_atestados_faceta check (faceta in ('itens', 'faturamento', 'dia')),
  constraint g3_atestados_acao check (acao in ('nova', 'alterada', 'igual', 'reaparecida', 'superada', 'ausente')),
  constraint g3_atestados_conteudo check ((acao = 'ausente') = (conteudo_id is null))
);
create index g3_atestados_chave_idx on public.g3_atestados (faceta, chave);

-- 1.7 Pendencias (vendas/dias bloqueados). Imutavel; "aberta" e derivado.
create table public.g3_pendencias (
  id        bigint generated always as identity primary key,
  lote_id   uuid not null references public.g3_importacoes(id) on delete restrict,
  faceta    text not null,
  chave     text not null,
  data      date,
  motivo    text not null,
  detalhe   jsonb,
  linhas    integer[],
  valor     numeric(16,2),
  constraint g3_pendencias_unica unique (lote_id, faceta, chave),
  constraint g3_pendencias_faceta check (faceta in ('itens', 'faturamento', 'dia')),
  constraint g3_pendencias_motivo check (motivo in ('valor_nao_positivo', 'aritmetica_linha', 'datas_divergentes', 'conflito_numero'))
);
create index g3_pendencias_chave_idx on public.g3_pendencias (faceta, chave);
create index g3_pendencias_data_idx on public.g3_pendencias (data);

-- 1.8 Estado vigente por (faceta, chave). conteudo_id = ultima versao
-- presente (mantida tambem quando a chave esta ausente, para consulta).
create table public.g3_estado (
  faceta       text not null,
  chave        text not null,
  estado       text not null,
  lote_id      uuid not null references public.g3_importacoes(id) on delete restrict,
  conteudo_id  bigint not null references public.g3_conteudos(id) on delete restrict,
  data         date not null,
  constraint g3_estado_pk primary key (faceta, chave),
  constraint g3_estado_estado check (estado in ('presente', 'ausente'))
);
create index g3_estado_data_idx on public.g3_estado (faceta, data);

-- 1.9 Fatos para consulta/BI (materializados a partir de g3_estado).
create table public.g3_vendas (
  numero             bigint primary key,
  itens_estado       text,
  itens_lote_id      uuid references public.g3_importacoes(id) on delete restrict,
  itens_data         date,
  itens_total        numeric(16,2),
  itens_linhas       integer,
  itens_quantidade   numeric(16,4),
  fat_estado         text,
  fat_lote_id        uuid references public.g3_importacoes(id) on delete restrict,
  fat_data           date,
  data_hora          timestamptz,
  prod               numeric(16,2),
  acrescimo_item     numeric(16,2),
  desconto_item      numeric(16,2),
  subtotal           numeric(16,2),
  acrescimo_rateado  numeric(16,2),
  desconto_rateado   numeric(16,2),
  taxa_servico       numeric(16,2),
  liquido            numeric(16,2),
  data               date generated always as (coalesce(fat_data, itens_data)) stored,
  conciliacao        text generated always as (
    case
      when itens_estado = 'ausente' or fat_estado = 'ausente' then 'ausente'
      when itens_estado is null then 'sem_itens'
      when fat_estado is null then 'sem_faturamento'
      when itens_data <> fat_data or itens_total <> prod then 'divergente'
      else 'conciliada'
    end) stored,
  constraint g3_vendas_estados check (
    (itens_estado is null or itens_estado in ('presente', 'ausente'))
    and (fat_estado is null or fat_estado in ('presente', 'ausente')))
);
create index g3_vendas_data_idx on public.g3_vendas (data);
create index g3_vendas_conciliacao_idx on public.g3_vendas (conciliacao, data);

create table public.g3_venda_itens (
  numero          bigint not null references public.g3_vendas(numero) on delete cascade,
  codigo          text not null,
  ordinal         integer not null,
  descricao       text not null,
  quantidade      numeric(16,4) not null,
  desconto        numeric(16,2) not null,
  valor           numeric(16,2) not null,
  preco_unitario  numeric(16,4) generated always as (round(valor / nullif(quantidade, 0), 4)) stored,
  constraint g3_venda_itens_pk primary key (numero, codigo, ordinal)
);
create index g3_venda_itens_codigo_idx on public.g3_venda_itens (codigo);

create table public.g3_vendas_diarias (
  dia               date primary key,
  estado            text not null,
  lote_id           uuid not null references public.g3_importacoes(id) on delete restrict,
  venda             numeric(16,2) not null,
  custo_g3          numeric(16,2) not null,
  acrescimo         numeric(16,2) not null,
  desconto_g3       numeric(16,2) not null,
  liquido_sem_taxa  numeric(16,2) not null,
  taxa_servico      numeric(16,2) not null,
  ganho_g3          numeric(16,2) not null,
  percentual        numeric(16,4),
  markup            numeric(16,4),
  markdown          numeric(16,4),
  constraint g3_vendas_diarias_estado check (estado in ('presente', 'ausente'))
);

comment on table public.g3_configuracao is 'Central G3 (0081): empresa esperada nos relatorios e limites. Alteracao so por SQL com set_config(''g3.operacao'',''on'',true).';
comment on table public.g3_importacoes is 'Central G3 (0081): lotes de importacao (1 por arquivo). Somente proprietario_admin.';
comment on table public.g3_importacao_linhas is 'Central G3 (0081): linhas brutas mascaradas (sem nome/CPF de cliente). celulas NULL = linha igual a versao ja guardada (retencao).';
comment on table public.g3_previa is 'Central G3 (0081): previa temporaria do lote.';
comment on table public.g3_conteudos is 'Central G3 (0081): versoes de cada venda/dia, enderecadas por hash. Imutavel.';
comment on table public.g3_atestados is 'Central G3 (0081): o que cada lote confirmado atestou. Imutavel.';
comment on table public.g3_pendencias is 'Central G3 (0081): vendas/dias bloqueados (valor <= 0, aritmetica, conflito). Imutavel; aberta/resolvida e derivado.';
comment on table public.g3_estado is 'Central G3 (0081): estado vigente por faceta/chave (derivado dos atestados).';
comment on table public.g3_vendas is 'Central G3 (0081): vendas (itens x faturamento) com conciliacao. Derivado.';
comment on table public.g3_venda_itens is 'Central G3 (0081): itens das vendas (valores brutos). Derivado.';
comment on table public.g3_vendas_diarias is 'Central G3 (0081): Vendas_Periodo diario. custo_g3/ganho_g3 = importados do G3, NAO validados. Derivado.';

-- ============================================================
-- 2. Funcoes auxiliares (internas, imutaveis)
-- ============================================================

-- Normaliza texto para comparacao: sem acento, maiusculo, espacos simples.
create function public.g3_norm(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(upper(translate(coalesce(p, ''),
    U&'\00E1\00E0\00E2\00E3\00E4\00E9\00E8\00EA\00EB\00ED\00EC\00EE\00EF\00F3\00F2\00F4\00F5\00F6\00FA\00F9\00FB\00FC\00E7\00C1\00C0\00C2\00C3\00C4\00C9\00C8\00CA\00CB\00CD\00CC\00CE\00CF\00D3\00D2\00D4\00D5\00D6\00DA\00D9\00DB\00DC\00C7\00A0\00BA\00AA',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC oa')), '\s+', ' ', 'g')), '')
$$;

-- Texto de uma celula (numero inteiro vira texto sem casas).
create function public.g3_texto(p jsonb)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case jsonb_typeof(p)
    when 'string' then nullif(btrim(p #>> '{}'), '')
    when 'number' then
      case when (p #>> '{}')::numeric = trunc((p #>> '{}')::numeric)
           then trunc((p #>> '{}')::numeric)::text
           else p #>> '{}' end
    else null
  end
$$;

-- Numero de uma celula (numero JSON ou texto no formato 1234.56).
create function public.g3_num(p jsonb)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case jsonb_typeof(p)
    when 'number' then (p #>> '{}')::numeric
    when 'string' then
      case when btrim(p #>> '{}') ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' then btrim(p #>> '{}')::numeric end
    else null
  end
$$;

-- Data dd/mm/aaaa (NULL se invalida).
create function public.g3_data_br(p text)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' then
    case when substr(p, 4, 2)::int between 1 and 12 and substr(p, 7, 4)::int between 2000 and 2100 then
      case when substr(p, 1, 2)::int between 1 and extract(day from (make_date(substr(p, 7, 4)::int, substr(p, 4, 2)::int, 1)
                                                         + interval '1 month' - interval '1 day'))::int
           then make_date(substr(p, 7, 4)::int, substr(p, 4, 2)::int, substr(p, 1, 2)::int) end
    end
  end
$$;

-- Data de uma celula: texto dd/mm/aaaa (original do G3) ou numero serial do
-- Excel (arquivo regravado).
create function public.g3_data_cel(p jsonb)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case jsonb_typeof(p)
    when 'string' then public.g3_data_br(btrim(p #>> '{}'))
    when 'number' then
      case when (p #>> '{}')::numeric between 36526 and 73050
                and (p #>> '{}')::numeric = trunc((p #>> '{}')::numeric)
           then date '1899-12-30' + (p #>> '{}')::numeric::int end
    else null
  end
$$;

-- Data e hora local de uma celula: 'dd/mm/aaaa hh:mm[:ss]' ou serial do Excel.
create function public.g3_data_hora_cel(p jsonb)
returns timestamp
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v text;
  m text[];
  d date;
  n numeric;
begin
  if jsonb_typeof(p) = 'string' then
    v := btrim(p #>> '{}');
    m := regexp_match(v, '^([0-9]{2}/[0-9]{2}/[0-9]{4}) ([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$');
    if m is null then
      return null;
    end if;
    d := public.g3_data_br(m[1]);
    if d is null or m[2]::int > 23 or m[3]::int > 59 or coalesce(m[4], '0')::int > 59 then
      return null;
    end if;
    return d + make_time(m[2]::int, m[3]::int, coalesce(m[4], '0')::int);
  elsif jsonb_typeof(p) = 'number' then
    n := (p #>> '{}')::numeric;
    if n < 36526 or n >= 73051 then
      return null;
    end if;
    return timestamp '1899-12-30 00:00' + make_interval(days => trunc(n)::int, secs => round((n - trunc(n)) * 86400)::double precision);
  end if;
  return null;
end;
$$;

create function public.g3_sha(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex')
$$;

-- Linha normalizada (para reconhecer cabecalhos de coluna), sem vazios finais.
create function public.g3_linha_norm(p jsonb)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(coalesce(public.g3_norm(public.g3_texto(x)), '') order by o), '{}'::text[])
  from jsonb_array_elements(p) with ordinality t(x, o)
  where o <= (select max(o2) from jsonb_array_elements(p) with ordinality t2(x2, o2)
              where coalesce(public.g3_texto(x2), '') <> '')
$$;

-- Dado pessoal de cliente numa celula? (CPF/CNPJ formatado ou "solto",
-- rotulo CPF ou linha "Cliente:" fora das formas mascaradas permitidas).
create function public.g3_celula_pessoal(p jsonb, p_cnpj text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case jsonb_typeof(p)
    when 'string' then
      (p #>> '{}') ~ '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}'
      or (p #>> '{}') ~ '[0-9]{2}\.[0-9]{3}\.[0-9]{3}/[0-9]{4}-[0-9]{2}'
      or btrim(p #>> '{}') ~ '^[0-9]{11}$'
      or (btrim(p #>> '{}') ~ '^[0-9]{14}$' and btrim(p #>> '{}') <> p_cnpj)
      or (coalesce(public.g3_norm(p #>> '{}'), '') like '%CPF%'
          and public.g3_norm(p #>> '{}') <> 'CLIENTE: CONSUMIDOR NAO IDENTIFICADO - CPF/CNPJ: NAO INFORMADO')
      or (coalesce(public.g3_norm(p #>> '{}'), '') like 'CLIENTE:%'
          and public.g3_norm(p #>> '{}') not in ('CLIENTE: CONSUMIDOR NAO IDENTIFICADO - CPF/CNPJ: NAO INFORMADO',
                                                 'CLIENTE: [CLIENTE IDENTIFICADO]'))
    when 'number' then
      (p #>> '{}')::numeric = trunc((p #>> '{}')::numeric)
      and ((abs((p #>> '{}')::numeric) between 1000000000 and 99999999999)
           or (abs((p #>> '{}')::numeric) between 1000000000000 and 99999999999999
               and trunc((p #>> '{}')::numeric)::text <> p_cnpj))
    else false
  end
$$;

-- Marca transacional: so dentro das funcoes as tabelas g3_* podem mudar.
create function public.g3_operacao()
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform set_config('g3.operacao', 'on', true);
end;
$$;

create function public.g3_exigir_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Acesso restrito ao perfil proprietario_admin.' using errcode = '42501';
  end if;
end;
$$;

create function public.g3_faceta_do_layout(p_layout text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_layout
    when 'vendas_produto_cliente' then 'itens'
    when 'faturamento_geral' then 'faturamento'
    when 'vendas_periodo' then 'dia'
  end
$$;

create function public.g3_layout_da_faceta(p_faceta text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_faceta
    when 'itens' then 'vendas_produto_cliente'
    when 'faturamento' then 'faturamento_geral'
    when 'dia' then 'vendas_periodo'
  end
$$;

create function public.g3_usuario_nome()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.nome from public.usuarios u where u.id = auth.uid()
$$;

-- ============================================================
-- 3. Protecao (defesa em profundidade)
-- ============================================================
-- Gatilhos POR INSTRUCAO (nao por linha): a checagem nao depende do
-- conteudo da linha, e um lote grande mexe em dezenas de milhares de linhas.
create function public.g3_protecao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('g3.operacao', true), '') <> 'on' then
    raise exception 'g3: alteracao direta nao permitida em %; use as funcoes da Central de Importacoes.', tg_table_name
      using errcode = '42501';
  end if;
  return null;
end;
$$;

create function public.g3_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'g3: % e imutavel (historico de auditoria).', tg_table_name using errcode = '42501';
end;
$$;

create trigger g3_configuracao_protecao before insert or update or delete on public.g3_configuracao
  for each statement execute function public.g3_protecao();
create trigger g3_importacoes_protecao before insert or update or delete on public.g3_importacoes
  for each statement execute function public.g3_protecao();
create trigger g3_importacao_linhas_protecao before insert or update or delete on public.g3_importacao_linhas
  for each statement execute function public.g3_protecao();
create trigger g3_previa_protecao before insert or update or delete on public.g3_previa
  for each statement execute function public.g3_protecao();
create trigger g3_estado_protecao before insert or update or delete on public.g3_estado
  for each statement execute function public.g3_protecao();
create trigger g3_vendas_protecao before insert or update or delete on public.g3_vendas
  for each statement execute function public.g3_protecao();
create trigger g3_venda_itens_protecao before insert or update or delete on public.g3_venda_itens
  for each statement execute function public.g3_protecao();
create trigger g3_vendas_diarias_protecao before insert or update or delete on public.g3_vendas_diarias
  for each statement execute function public.g3_protecao();

create trigger g3_conteudos_insercao before insert on public.g3_conteudos
  for each statement execute function public.g3_protecao();
create trigger g3_atestados_insercao before insert on public.g3_atestados
  for each statement execute function public.g3_protecao();
create trigger g3_pendencias_insercao before insert on public.g3_pendencias
  for each statement execute function public.g3_protecao();
create trigger g3_conteudos_imutavel before update or delete on public.g3_conteudos
  for each statement execute function public.g3_imutavel();
create trigger g3_atestados_imutavel before update or delete on public.g3_atestados
  for each statement execute function public.g3_imutavel();
create trigger g3_pendencias_imutavel before update or delete on public.g3_pendencias
  for each statement execute function public.g3_imutavel();

create trigger g3_configuracao_truncate before truncate on public.g3_configuracao
  for each statement execute function public.g3_imutavel();
create trigger g3_importacoes_truncate before truncate on public.g3_importacoes
  for each statement execute function public.g3_imutavel();
create trigger g3_importacao_linhas_truncate before truncate on public.g3_importacao_linhas
  for each statement execute function public.g3_imutavel();
create trigger g3_previa_truncate before truncate on public.g3_previa
  for each statement execute function public.g3_imutavel();
create trigger g3_conteudos_truncate before truncate on public.g3_conteudos
  for each statement execute function public.g3_imutavel();
create trigger g3_atestados_truncate before truncate on public.g3_atestados
  for each statement execute function public.g3_imutavel();
create trigger g3_pendencias_truncate before truncate on public.g3_pendencias
  for each statement execute function public.g3_imutavel();
create trigger g3_estado_truncate before truncate on public.g3_estado
  for each statement execute function public.g3_imutavel();
create trigger g3_vendas_truncate before truncate on public.g3_vendas
  for each statement execute function public.g3_imutavel();
create trigger g3_venda_itens_truncate before truncate on public.g3_venda_itens
  for each statement execute function public.g3_imutavel();
create trigger g3_vendas_diarias_truncate before truncate on public.g3_vendas_diarias
  for each statement execute function public.g3_imutavel();

-- ============================================================
-- 4. Retencao (interna): lotes interrompidos expiram; revertidos perdem as
-- linhas brutas depois do prazo. Chamada ao iniciar cada importacao e pela
-- RPC g3_limpar().
-- ============================================================
create function public.g3_limpar_interno()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cfg public.g3_configuracao%rowtype;
  v_expirados uuid[];
  v_revertidos uuid[];
begin
  perform public.g3_operacao();
  select * into v_cfg from public.g3_configuracao where id;

  select coalesce(array_agg(id), '{}') into v_expirados
  from public.g3_importacoes
  where status in ('recebendo', 'previa', 'rejeitado')
    and criado_em < now() - make_interval(hours => v_cfg.horas_expiracao);

  if cardinality(v_expirados) > 0 then
    delete from public.g3_previa where lote_id = any(v_expirados);
    delete from public.g3_importacao_linhas where lote_id = any(v_expirados);
    update public.g3_importacoes
       set status = 'expirado', encerrado_em = now(), linhas_purgadas_em = now()
     where id = any(v_expirados);
  end if;

  select coalesce(array_agg(id), '{}') into v_revertidos
  from public.g3_importacoes
  where status = 'revertido' and linhas_purgadas_em is null
    and revertido_em < now() - make_interval(days => v_cfg.dias_retencao_revertido);

  if cardinality(v_revertidos) > 0 then
    delete from public.g3_importacao_linhas where lote_id = any(v_revertidos);
    update public.g3_importacoes set linhas_purgadas_em = now() where id = any(v_revertidos);
  end if;

  return jsonb_build_object('expirados', cardinality(v_expirados), 'revertidos_purgados', cardinality(v_revertidos));
end;
$$;

-- ============================================================
-- 5. Recalculo do estado (interno): funcao pura do conjunto de lotes
-- confirmados nao revertidos, aplicada so as chaves informadas.
-- ============================================================
create function public.g3_recalcular(p_faceta text, p_chaves text[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_layout text := public.g3_layout_da_faceta(p_faceta);
begin
  perform public.g3_operacao();
  if v_layout is null then
    raise exception 'g3_recalcular: faceta invalida';
  end if;
  if p_chaves is null or cardinality(p_chaves) = 0 then
    return;
  end if;

  drop table if exists pg_temp.g3_rk;
  create temp table g3_rk (chave text primary key) on commit drop;
  insert into pg_temp.g3_rk select distinct unnest(p_chaves);
  analyze pg_temp.g3_rk;

  drop table if exists pg_temp.g3_venc;
  create temp table g3_venc on commit drop as
  with pres as (
    select a.chave, a.lote_id, a.conteudo_id, a.data, l.gerado_em, l.seq
    from public.g3_atestados a
    join pg_temp.g3_rk k on k.chave = a.chave
    join public.g3_importacoes l on l.id = a.lote_id and l.status = 'confirmado'
    where a.faceta = p_faceta and a.conteudo_id is not null
  ),
  ref as (
    select distinct on (chave) chave, conteudo_id, data
    from pres
    order by chave, gerado_em desc, seq desc
  ),
  aus as (
    select r.chave, l.id as lote_id, l.gerado_em, l.seq
    from ref r
    join public.g3_importacoes l
      on l.status = 'confirmado' and l.layout = v_layout
     and r.data between l.periodo_inicio and l.cobertura_completa_fim
    where not exists (select 1 from public.g3_atestados a
                       where a.lote_id = l.id and a.faceta = p_faceta and a.chave = r.chave and a.conteudo_id is not null)
      and not exists (select 1 from public.g3_pendencias p
                       where p.lote_id = l.id and p.faceta = p_faceta and p.chave = r.chave)
  ),
  cand as (
    select chave, lote_id, gerado_em, seq, 'presente'::text as estado from pres
    union all
    select chave, lote_id, gerado_em, seq, 'ausente'::text from aus
  ),
  win as (
    select distinct on (chave) chave, lote_id, estado
    from cand
    order by chave, gerado_em desc, seq desc
  )
  select w.chave, w.lote_id, w.estado, r.conteudo_id, r.data
  from win w join ref r on r.chave = w.chave;
  analyze pg_temp.g3_venc;

  delete from public.g3_estado e
   using pg_temp.g3_rk k
   where e.faceta = p_faceta and e.chave = k.chave
     and not exists (select 1 from pg_temp.g3_venc v where v.chave = k.chave);

  insert into public.g3_estado (faceta, chave, estado, lote_id, conteudo_id, data)
  select p_faceta, v.chave, v.estado, v.lote_id, v.conteudo_id, v.data from pg_temp.g3_venc v
  on conflict (faceta, chave) do update
    set estado = excluded.estado, lote_id = excluded.lote_id,
        conteudo_id = excluded.conteudo_id, data = excluded.data
    where (public.g3_estado.estado, public.g3_estado.lote_id, public.g3_estado.conteudo_id, public.g3_estado.data)
          is distinct from (excluded.estado, excluded.lote_id, excluded.conteudo_id, excluded.data);

  -- Materializacao dos fatos.
  if p_faceta = 'itens' then
    delete from public.g3_venda_itens i using pg_temp.g3_rk k where i.numero = k.chave::bigint;
    update public.g3_vendas g
       set itens_estado = null, itens_lote_id = null, itens_data = null,
           itens_total = null, itens_linhas = null, itens_quantidade = null
      from pg_temp.g3_rk k
     where g.numero = k.chave::bigint;
    insert into public.g3_vendas (numero, itens_estado, itens_lote_id, itens_data, itens_total, itens_linhas, itens_quantidade)
    select e.chave::bigint, e.estado, e.lote_id, e.data,
           (select sum((i ->> 'v')::numeric) from jsonb_array_elements(c.conteudo -> 'itens') i),
           jsonb_array_length(c.conteudo -> 'itens'),
           (select sum((i ->> 'q')::numeric) from jsonb_array_elements(c.conteudo -> 'itens') i)
    from public.g3_estado e
    join pg_temp.g3_rk k on k.chave = e.chave
    join public.g3_conteudos c on c.id = e.conteudo_id
    where e.faceta = 'itens'
    on conflict (numero) do update
      set itens_estado = excluded.itens_estado, itens_lote_id = excluded.itens_lote_id,
          itens_data = excluded.itens_data, itens_total = excluded.itens_total,
          itens_linhas = excluded.itens_linhas, itens_quantidade = excluded.itens_quantidade;
    insert into public.g3_venda_itens (numero, codigo, ordinal, descricao, quantidade, desconto, valor)
    select e.chave::bigint, i ->> 'c', (i ->> 'o')::int, i ->> 'n',
           (i ->> 'q')::numeric, (i ->> 'd')::numeric, (i ->> 'v')::numeric
    from public.g3_estado e
    join pg_temp.g3_rk k on k.chave = e.chave
    join public.g3_conteudos c on c.id = e.conteudo_id
    cross join lateral jsonb_array_elements(c.conteudo -> 'itens') i
    where e.faceta = 'itens';
    delete from public.g3_vendas g using pg_temp.g3_rk k
     where g.numero = k.chave::bigint and g.itens_estado is null and g.fat_estado is null;

  elsif p_faceta = 'faturamento' then
    update public.g3_vendas g
       set fat_estado = null, fat_lote_id = null, fat_data = null, data_hora = null, prod = null,
           acrescimo_item = null, desconto_item = null, subtotal = null, acrescimo_rateado = null,
           desconto_rateado = null, taxa_servico = null, liquido = null
      from pg_temp.g3_rk k
     where g.numero = k.chave::bigint;
    insert into public.g3_vendas (numero, fat_estado, fat_lote_id, fat_data, data_hora, prod, acrescimo_item,
                                  desconto_item, subtotal, acrescimo_rateado, desconto_rateado, taxa_servico, liquido)
    select e.chave::bigint, e.estado, e.lote_id, e.data,
           ((c.conteudo ->> 'data_hora')::timestamp at time zone 'America/Sao_Paulo'),
           (c.conteudo ->> 'prod')::numeric, (c.conteudo ->> 'acrescimo_item')::numeric,
           (c.conteudo ->> 'desconto_item')::numeric, (c.conteudo ->> 'subtotal')::numeric,
           (c.conteudo ->> 'acrescimo_rateado')::numeric, (c.conteudo ->> 'desconto_rateado')::numeric,
           (c.conteudo ->> 'taxa_servico')::numeric, (c.conteudo ->> 'liquido')::numeric
    from public.g3_estado e
    join pg_temp.g3_rk k on k.chave = e.chave
    join public.g3_conteudos c on c.id = e.conteudo_id
    where e.faceta = 'faturamento'
    on conflict (numero) do update
      set fat_estado = excluded.fat_estado, fat_lote_id = excluded.fat_lote_id, fat_data = excluded.fat_data,
          data_hora = excluded.data_hora, prod = excluded.prod, acrescimo_item = excluded.acrescimo_item,
          desconto_item = excluded.desconto_item, subtotal = excluded.subtotal,
          acrescimo_rateado = excluded.acrescimo_rateado, desconto_rateado = excluded.desconto_rateado,
          taxa_servico = excluded.taxa_servico, liquido = excluded.liquido;
    delete from public.g3_vendas g using pg_temp.g3_rk k
     where g.numero = k.chave::bigint and g.itens_estado is null and g.fat_estado is null;

  else
    delete from public.g3_vendas_diarias d using pg_temp.g3_rk k where d.dia = k.chave::date;
    insert into public.g3_vendas_diarias (dia, estado, lote_id, venda, custo_g3, acrescimo, desconto_g3,
                                          liquido_sem_taxa, taxa_servico, ganho_g3, percentual, markup, markdown)
    select e.chave::date, e.estado, e.lote_id,
           (c.conteudo ->> 'venda')::numeric, (c.conteudo ->> 'custo')::numeric, (c.conteudo ->> 'acrescimo')::numeric,
           (c.conteudo ->> 'desconto')::numeric, (c.conteudo ->> 'liquido_sem_taxa')::numeric,
           (c.conteudo ->> 'taxa_servico')::numeric, (c.conteudo ->> 'ganho')::numeric,
           (c.conteudo ->> 'percentual')::numeric, (c.conteudo ->> 'markup')::numeric, (c.conteudo ->> 'markdown')::numeric
    from public.g3_estado e
    join pg_temp.g3_rk k on k.chave = e.chave
    join public.g3_conteudos c on c.id = e.conteudo_id
    where e.faceta = 'dia';
  end if;
end;
$$;

-- ============================================================
-- 6. Analise do lote (interna): reconhece o layout, valida estrutura,
-- empresa, filtros, periodo, celulas, rodapes; monta a previa e classifica
-- contra o estado vigente. Fonte unica: as linhas brutas gravadas.
-- ============================================================
create function public.g3_analisar(p_lote uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_l public.g3_importacoes%rowtype;
  v_cfg public.g3_configuracao%rowtype;
  v_faceta text;
  v_erros jsonb := '[]'::jsonb;
  v_alertas jsonb := '[]'::jsonb;
  v_titulo text;
  v_colunas text[];
  v_rodape text[];
  v_filtros_permitidos text[];
  v_cab_esperado int;
  v_linhas_cab int[];
  v_n_filtros int;
  v_fim_cab int;
  v_resumo_n int;
  v_padrao text;
  v_padrao_ok text;
  v_gerado timestamp;
  v_gerado_tz timestamptz;
  v_usuario text;
  v_ini date;
  v_fim date;
  v_cob_fim date;
  v_parcial date;
  v_filtros jsonb := '{}'::jsonb;
  v_ndados int;
  v_totais jsonb;
  v_resumo jsonb;
  v_tmp text;
  v_tmp2 text;
  v_m text[];
  v_cnt int;
  v_rec record;
  v_conv int;
begin
  perform public.g3_operacao();
  select * into v_l from public.g3_importacoes where id = p_lote;
  select * into v_cfg from public.g3_configuracao where id;
  v_faceta := public.g3_faceta_do_layout(v_l.layout);

  delete from public.g3_previa where lote_id = p_lote;

  if v_l.layout = 'vendas_produto_cliente' then
    v_titulo := 'VENDAS DE PRODUTOS POR CLIENTE';
    v_colunas := array['PRODUTO', 'CODIGO', 'NO PEDIDO', 'DATA EMISSAO', 'QTD.', 'DESCONTO (R$)', 'VALOR TOTAL (R$)'];
    v_rodape := array['TOTAL GERAL DE VENDAS'];
    v_filtros_permitidos := array['PERIODO', 'SITUACOES'];
    v_cab_esperado := 4;
    v_padrao_ok := '^(GCS)*R$';
  elsif v_l.layout = 'faturamento_geral' then
    v_titulo := 'RELATORIO DE FATURAMENTO GERAL';
    v_colunas := array['COD.', 'CLIENTE', 'EMPRESA', 'DATA', 'PROD. (R$)', 'ACRES. IT. (R$)', 'DESC. IT. (R$)',
                       'SUBTOTAL (R$)', 'ACRES. RAT. (R$)', 'DESC. RAT. (R$)', 'TAXA SERV. (R$)', 'LIQUIDO (R$)'];
    v_rodape := array['SUBTOTAL', 'DESCONTOS', 'ACRESCIMOS', 'TAXA DE SERVICO', 'TOTAL LIQUIDO', 'VENDAS', 'TICKET MEDIO'];
    v_filtros_permitidos := array['PERIODO', 'EMPRESAS'];
    v_cab_esperado := 3;
    v_padrao_ok := '^CR$';
  else
    v_titulo := 'RELATORIO DE VENDAS POR DIA/MES/ANO';
    v_colunas := array['ANO', 'MES', 'DIA', 'PERCENTUAL (%)', 'VENDA (R$)', 'CUSTO (R$)', 'ACRESCIMO (R$)',
                       'DESCONTO (R$)', 'LIQ. S/ TAXA (R$)', 'TAXA SERV. (R$)', 'GANHO (R$)', 'MARKUP (%)', 'MARKDOWN (%)'];
    v_rodape := array['TOTAL VENDAS', 'TOTAL CUSTO', 'TOTAL ACRESCIMO', 'TOTAL DESCONTO', 'TOTAL LIQ. S/ TAXA',
                      'TOTAL TAXA SERV.', 'TOTAL GANHO'];
    v_filtros_permitidos := array['PERIODO', 'EMPRESAS', 'AGRUPADO POR'];
    v_cab_esperado := 3;
    v_padrao_ok := '^CR$';
  end if;

  drop table if exists pg_temp.g3_l;
  -- ncel = celulas preenchidas (SQL puro: roda em todas as linhas).
  create temp table g3_l on commit drop as
    select l.numero_linha as n, l.celulas as c,
           null::text as c0,
           (select count(*) from jsonb_array_elements(l.celulas) x
             where jsonb_typeof(x) = 'number' or (jsonb_typeof(x) = 'string' and btrim(x #>> '{}') <> ''))::int as ncel,
           null::text as tipo
    from public.g3_importacao_linhas l
    where l.lote_id = p_lote;
  create index on pg_temp.g3_l (n);
  -- c0 (1a celula normalizada) so onde pode haver marcador de estrutura:
  -- linhas curtas (titulo, filtros, grupo, subtotal, resumo, rodape) e
  -- cabecalhos de coluna (2a celula nao numerica). Linhas de dados ficam de fora.
  update pg_temp.g3_l
     set c0 = public.g3_norm(c ->> 0)
   where jsonb_typeof(c -> 0) = 'string'
     and (ncel <= 2 or coalesce(c ->> 1, '') !~ '^\s*[0-9]+\s*$');
  -- estatisticas da tabela temporaria (sem elas o planejador pode escolher
  -- laco aninhado nas atualizacoes por janela: quadratico em lotes grandes)
  analyze pg_temp.g3_l;

  if exists (select 1 from pg_temp.g3_l where c is null) then
    raise exception 'g3_analisar: lote com linhas purgadas nao pode ser analisado';
  end if;

  -- ---------- cabecalho ----------
  select array_agg(n order by n) into v_linhas_cab
  from pg_temp.g3_l
  where ncel > 0 and n < coalesce((select min(n) from pg_temp.g3_l where c0 = 'FILTROS UTILIZADOS:'), 2147483647);

  if (select c0 from pg_temp.g3_l where n = v_linhas_cab[1]) is distinct from v_titulo then
    v_erros := v_erros || jsonb_build_object('codigo', 'layout_nao_reconhecido',
      'mensagem', 'O titulo do relatorio nao corresponde ao layout escolhido.', 'linha', v_linhas_cab[1]);
  elsif not exists (select 1 from pg_temp.g3_l where c0 = 'FILTROS UTILIZADOS:') then
    v_erros := v_erros || jsonb_build_object('codigo', 'filtros_ausentes',
      'mensagem', 'Bloco "Filtros Utilizados" nao encontrado.', 'linha', null);
  elsif coalesce(cardinality(v_linhas_cab), 0) <> v_cab_esperado then
    v_erros := v_erros || jsonb_build_object('codigo', 'cabecalho_invalido',
      'mensagem', format('Cabecalho com %s linhas preenchidas; esperado %s.', coalesce(cardinality(v_linhas_cab), 0), v_cab_esperado),
      'linha', null);
  else
    if v_l.layout = 'vendas_produto_cliente' then
      if (select c0 from pg_temp.g3_l where n = v_linhas_cab[2]) is distinct from public.g3_norm(v_cfg.razao_social) then
        v_erros := v_erros || jsonb_build_object('codigo', 'empresa_divergente',
          'mensagem', 'Razao social do relatorio diferente da empresa configurada.', 'linha', v_linhas_cab[2]);
      end if;
      select case when jsonb_typeof(c -> 0) = 'number' then lpad(public.g3_texto(c -> 0), 14, '0') else public.g3_texto(c -> 0) end
        into v_tmp from pg_temp.g3_l where n = v_linhas_cab[3];
      if v_tmp is distinct from v_cfg.cnpj then
        v_erros := v_erros || jsonb_build_object('codigo', 'empresa_divergente',
          'mensagem', 'CNPJ do relatorio diferente do CNPJ configurado.', 'linha', v_linhas_cab[3]);
      end if;
    else
      if (select c0 from pg_temp.g3_l where n = v_linhas_cab[2]) is distinct from 'G3 ERP' then
        v_erros := v_erros || jsonb_build_object('codigo', 'cabecalho_invalido',
          'mensagem', 'Linha "G3 ERP" nao encontrada no cabecalho.', 'linha', v_linhas_cab[2]);
      end if;
    end if;

    select c0, public.g3_texto(c -> 1) into v_tmp, v_tmp2 from pg_temp.g3_l where n = v_linhas_cab[v_cab_esperado];
    v_m := regexp_match(coalesce(v_tmp, ''), '^GERADO EM: ([0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}(:[0-9]{2})?)$');
    if v_m is not null then
      v_gerado := public.g3_data_hora_cel(to_jsonb(v_m[1]));
    end if;
    if v_gerado is null then
      v_erros := v_erros || jsonb_build_object('codigo', 'cabecalho_invalido',
        'mensagem', 'Data de geracao ("Gerado em") ausente ou invalida.', 'linha', v_linhas_cab[v_cab_esperado]);
    else
      v_gerado_tz := v_gerado at time zone 'America/Sao_Paulo';
      if v_gerado_tz > now() + interval '10 minutes' then
        v_erros := v_erros || jsonb_build_object('codigo', 'cabecalho_invalido',
          'mensagem', 'Data de geracao no futuro.', 'linha', v_linhas_cab[v_cab_esperado]);
      end if;
    end if;
    v_usuario := left(btrim(regexp_replace(coalesce(v_tmp2, ''), '^[^:]*:', '')), 100);
  end if;

  -- ---------- filtros ----------
  if jsonb_array_length(v_erros) = 0 then
    select min(n) into v_fim_cab from pg_temp.g3_l where c0 = 'FILTROS UTILIZADOS:';
    -- linhas de filtro: as consecutivas, preenchidas, logo apos o titulo do bloco
    select coalesce(min(n), (select max(n) + 1 from pg_temp.g3_l)) - 1 into v_tmp
    from pg_temp.g3_l where n > v_fim_cab and ncel = 0;
    v_n_filtros := v_tmp::int - v_fim_cab;
    for v_rec in
      select n, public.g3_norm(public.g3_texto(c -> 0)) as rotulo, public.g3_texto(c -> 1) as valor, ncel
      from pg_temp.g3_l where n > v_fim_cab and n <= v_fim_cab + v_n_filtros order by n
    loop
      if v_rec.ncel <> 2 or v_rec.rotulo is null or v_rec.valor is null then
        v_erros := v_erros || jsonb_build_object('codigo', 'filtro_invalido',
          'mensagem', 'Linha de filtro mal formada.', 'linha', v_rec.n);
      elsif not (v_rec.rotulo = any(v_filtros_permitidos)) then
        v_erros := v_erros || jsonb_build_object('codigo', 'filtro_nao_permitido',
          'mensagem', format('Filtro "%s" nao permitido: exporte o relatorio sem filtros de secao, categoria, produto ou cliente.', left(v_rec.rotulo, 60)),
          'linha', v_rec.n);
      elsif v_filtros ? v_rec.rotulo then
        v_erros := v_erros || jsonb_build_object('codigo', 'filtro_invalido',
          'mensagem', format('Filtro "%s" repetido.', v_rec.rotulo), 'linha', v_rec.n);
      else
        v_filtros := v_filtros || jsonb_build_object(v_rec.rotulo, left(v_rec.valor, 200));
      end if;
    end loop;
    v_fim_cab := v_fim_cab + v_n_filtros;

    if jsonb_array_length(v_erros) = 0 then
      if exists (select 1 from unnest(v_filtros_permitidos) f where not (v_filtros ? f)) then
        v_erros := v_erros || jsonb_build_object('codigo', 'filtro_ausente',
          'mensagem', 'Filtros obrigatorios ausentes: ' ||
            (select string_agg(f, ', ') from unnest(v_filtros_permitidos) f where not (v_filtros ? f)), 'linha', null);
      else
        v_m := regexp_match(public.g3_norm(v_filtros ->> 'PERIODO'), '^([0-9]{2}/[0-9]{2}/[0-9]{4}) A ([0-9]{2}/[0-9]{2}/[0-9]{4})$');
        if v_m is not null then
          v_ini := public.g3_data_br(v_m[1]);
          v_fim := public.g3_data_br(v_m[2]);
        end if;
        if v_ini is null or v_fim is null or v_ini > v_fim then
          v_erros := v_erros || jsonb_build_object('codigo', 'periodo_invalido', 'mensagem', 'Periodo do relatorio invalido.', 'linha', null);
        elsif v_ini > v_gerado::date then
          v_erros := v_erros || jsonb_build_object('codigo', 'periodo_invalido',
            'mensagem', 'O periodo comeca depois da data de geracao do relatorio.', 'linha', null);
        else
          v_cob_fim := least(v_fim, v_gerado::date - 1);
          v_parcial := case when v_gerado::date between v_ini and v_fim then v_gerado::date end;
        end if;
        if v_filtros ? 'SITUACOES' and public.g3_norm(v_filtros ->> 'SITUACOES') <> 'FINALIZADO' then
          v_erros := v_erros || jsonb_build_object('codigo', 'filtro_nao_permitido',
            'mensagem', 'O filtro de situacoes precisa ser exatamente FINALIZADO.', 'linha', null);
        end if;
        if v_filtros ? 'EMPRESAS' and public.g3_norm(v_filtros ->> 'EMPRESAS') <> public.g3_norm(v_cfg.empresa_filtro) then
          v_erros := v_erros || jsonb_build_object('codigo', 'empresa_divergente',
            'mensagem', 'Filtro de empresas diferente da empresa configurada.', 'linha', null);
        end if;
        if v_filtros ? 'AGRUPADO POR' and public.g3_norm(v_filtros ->> 'AGRUPADO POR') <> 'DIARIO' then
          v_erros := v_erros || jsonb_build_object('codigo', 'filtro_nao_permitido',
            'mensagem', 'O relatorio precisa estar agrupado por DIARIO.', 'linha', null);
        end if;
      end if;
    end if;
  end if;

  -- ---------- estrutura (classificacao das linhas) ----------
  if jsonb_array_length(v_erros) = 0 then
    update pg_temp.g3_l set tipo = case
        when ncel = 0 then 'vazia'
        when n <= v_fim_cab then 'cabecalho'
        when c0 is not distinct from v_colunas[1] and public.g3_linha_norm(c) = v_colunas then 'colunas'
        when v_l.layout = 'vendas_produto_cliente' and c0 like 'CLIENTE:%' then 'grupo'
        when v_l.layout = 'vendas_produto_cliente' and c0 = 'SUBTOTAL DO CLIENTE' then 'subtotal'
        when c0 = 'RESUMO / TOTAIS' then 'resumo'
      end;
    select min(n) into v_resumo_n from pg_temp.g3_l where tipo = 'resumo';
    if v_resumo_n is not null then
      update pg_temp.g3_l set tipo = 'rodape' where n > v_resumo_n and tipo is null;
    end if;
    with w as (
      select n,
             max(n) filter (where tipo = 'colunas') over (order by n) as lc,
             max(n) filter (where tipo in ('grupo', 'subtotal', 'resumo')) over (order by n) as lf
      from pg_temp.g3_l
    )
    update pg_temp.g3_l l
       set tipo = case when w.lc is not null and w.lc > coalesce(w.lf, 0) then 'dado' else 'desconhecida' end
      from w
     where w.n = l.n and l.tipo is null;

    select string_agg(case tipo when 'grupo' then 'G' when 'colunas' then 'C' when 'subtotal' then 'S' when 'resumo' then 'R' end,
                      '' order by n)
      into v_padrao
    from pg_temp.g3_l where tipo in ('grupo', 'colunas', 'subtotal', 'resumo');

    if exists (select 1 from pg_temp.g3_l where tipo = 'desconhecida') then
      v_erros := v_erros || jsonb_build_object('codigo', 'linha_nao_reconhecida',
        'mensagem', 'Linhas fora da estrutura do relatorio original: ' ||
          (select string_agg(n::text, ', ' order by n) from (select n from pg_temp.g3_l where tipo = 'desconhecida' order by n limit 10) x),
        'linha', (select min(n) from pg_temp.g3_l where tipo = 'desconhecida'));
    end if;
    if coalesce(v_padrao, '') !~ v_padrao_ok then
      v_erros := v_erros || jsonb_build_object('codigo', 'estrutura_invalida',
        'mensagem', 'Sequencia de cabecalhos de coluna, grupos, subtotais e resumo diferente do relatorio original.', 'linha', null);
    end if;
    -- rodape: cada rotulo esperado exatamente uma vez, nada alem disso
    if exists (select 1 from pg_temp.g3_l where tipo = 'rodape' and (c0 is null or not (c0 = any(v_rodape)) or ncel <> 2)) then
      v_erros := v_erros || jsonb_build_object('codigo', 'rodape_invalido',
        'mensagem', 'Linha inesperada no resumo/totais do relatorio.',
        'linha', (select min(n) from pg_temp.g3_l where tipo = 'rodape' and (c0 is null or not (c0 = any(v_rodape)) or ncel <> 2)));
    elsif (select count(distinct c0) from pg_temp.g3_l where tipo = 'rodape') <> cardinality(v_rodape)
          or (select count(*) from pg_temp.g3_l where tipo = 'rodape') <> cardinality(v_rodape) then
      v_erros := v_erros || jsonb_build_object('codigo', 'rodape_invalido',
        'mensagem', 'Resumo/totais incompleto ou repetido.', 'linha', v_resumo_n);
    end if;
    select count(*) into v_ndados from pg_temp.g3_l where tipo = 'dado';
    if v_ndados > v_cfg.max_linhas_dados then
      v_erros := v_erros || jsonb_build_object('codigo', 'limite_linhas',
        'mensagem', format('O arquivo tem %s linhas de dados; o limite por lote e %s. Exporte um periodo menor.', v_ndados, v_cfg.max_linhas_dados),
        'linha', null);
    end if;
  end if;

  -- ---------- dados ----------
  if jsonb_array_length(v_erros) = 0 then
    drop table if exists pg_temp.g3_d;
    if v_l.layout = 'vendas_produto_cliente' then
      -- Conversoes escritas em SQL direto (sem chamar funcao por celula: um
      -- lote tem dezenas de milhares de linhas); datas repetem muito, entao
      -- cada valor distinto e convertido uma unica vez.
      drop table if exists pg_temp.g3_datas;
      create temp table g3_datas on commit drop as
        select x.cel, public.g3_data_cel(x.cel) as data
        from (select distinct l.c -> 3 as cel from pg_temp.g3_l l where l.tipo = 'dado') x;
      create temp table g3_d on commit drop as
        select l.n,
               case jsonb_typeof(l.c -> 0) when 'string' then nullif(btrim(l.c ->> 0), '') when 'number' then l.c ->> 0 end as produto,
               case jsonb_typeof(l.c -> 1) when 'string' then nullif(btrim(l.c ->> 1), '') when 'number' then l.c ->> 1 end as codigo,
               case jsonb_typeof(l.c -> 2) when 'string' then nullif(btrim(l.c ->> 2), '') when 'number' then l.c ->> 2 end as numero,
               dt.data,
               case jsonb_typeof(l.c -> 4) when 'number' then (l.c ->> 4)::numeric
                 when 'string' then case when btrim(l.c ->> 4) ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' then btrim(l.c ->> 4)::numeric end end as qtd,
               case jsonb_typeof(l.c -> 5) when 'number' then (l.c ->> 5)::numeric
                 when 'string' then case when btrim(l.c ->> 5) ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' then btrim(l.c ->> 5)::numeric end end as desconto,
               case jsonb_typeof(l.c -> 6) when 'number' then (l.c ->> 6)::numeric
                 when 'string' then case when btrim(l.c ->> 6) ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' then btrim(l.c ->> 6)::numeric end end as valor,
               jsonb_typeof(l.c -> 3) = 'number' as data_convertida,
               case when jsonb_array_length(l.c) > 7 then
                 (select count(*) from jsonb_array_elements(l.c) with ordinality t(x, o)
                   where o > 7 and (jsonb_typeof(x) = 'number' or (jsonb_typeof(x) = 'string' and btrim(x #>> '{}') <> '')))::int
                 else 0 end as extras,
               max(l.n) filter (where l.tipo = 'grupo') over (order by l.n) as grupo
        from pg_temp.g3_l l
        left join pg_temp.g3_datas dt on dt.cel = l.c -> 3
        where l.tipo in ('dado', 'grupo');
      delete from pg_temp.g3_d d using pg_temp.g3_l l where l.n = d.n and l.tipo = 'grupo';

      for v_rec in
        select n, case
            when extras > 0 then 'colunas extras preenchidas'
            when produto is null then 'Produto'
            when codigo is null or codigo !~ '^[0-9]{1,18}$' then 'Codigo'
            when numero is null or numero !~ '^[0-9]{1,15}$' then 'No Pedido'
            when data is null then 'Data Emissao'
            when qtd is null or scale(qtd) > 4 then 'Qtd.'
            when desconto is null or scale(desconto) > 2 then 'Desconto (R$)'
            when valor is null or scale(valor) > 2 then 'Valor Total (R$)'
          end as coluna
        from pg_temp.g3_d
        where extras > 0 or produto is null or codigo is null or codigo !~ '^[0-9]{1,18}$'
           or numero is null or numero !~ '^[0-9]{1,15}$' or data is null
           or qtd is null or scale(qtd) > 4 or desconto is null or scale(desconto) > 2
           or valor is null or scale(valor) > 2
        order by n limit 20
      loop
        v_erros := v_erros || jsonb_build_object('codigo', 'celula_ilegivel',
          'mensagem', format('Linha %s: coluna %s ilegivel ou fora do formato do G3.', v_rec.n, v_rec.coluna), 'linha', v_rec.n);
      end loop;

    elsif v_l.layout = 'faturamento_geral' then
      -- textos repetidos (cliente/empresa) normalizados uma vez por valor distinto
      drop table if exists pg_temp.g3_textos;
      create temp table g3_textos on commit drop as
        select x.cel, public.g3_norm(public.g3_texto(x.cel)) as texto
        from (select distinct l.c -> 1 as cel from pg_temp.g3_l l where l.tipo = 'dado'
              union select distinct l.c -> 2 from pg_temp.g3_l l where l.tipo = 'dado') x;
      create temp table g3_d on commit drop as
        select l.n,
               case when jsonb_typeof(l.c -> 0) = 'number' and (l.c ->> 0) ~ '^[0-9]{1,15}$' then l.c ->> 0 end as numero,
               tc.texto as cliente,
               te.texto as empresa,
               public.g3_data_hora_cel(l.c -> 3) as data_hora,
               case when jsonb_typeof(l.c -> 4) = 'number' then (l.c ->> 4)::numeric end as prod,
               case when jsonb_typeof(l.c -> 5) = 'number' then (l.c ->> 5)::numeric end as acrescimo_item,
               case when jsonb_typeof(l.c -> 6) = 'number' then (l.c ->> 6)::numeric end as desconto_item,
               case when jsonb_typeof(l.c -> 7) = 'number' then (l.c ->> 7)::numeric end as subtotal,
               case when jsonb_typeof(l.c -> 8) = 'number' then (l.c ->> 8)::numeric end as acrescimo_rateado,
               case when jsonb_typeof(l.c -> 9) = 'number' then (l.c ->> 9)::numeric end as desconto_rateado,
               case when jsonb_typeof(l.c -> 10) = 'number' then (l.c ->> 10)::numeric end as taxa_servico,
               case when jsonb_typeof(l.c -> 11) = 'number' then (l.c ->> 11)::numeric end as liquido,
               jsonb_typeof(l.c -> 3) = 'number' as data_convertida,
               case when jsonb_array_length(l.c) > 12 then
                 (select count(*) from jsonb_array_elements(l.c) with ordinality t(x, o)
                   where o > 12 and (jsonb_typeof(x) = 'number' or (jsonb_typeof(x) = 'string' and btrim(x #>> '{}') <> '')))::int
                 else 0 end as extras
        from pg_temp.g3_l l
        left join pg_temp.g3_textos tc on tc.cel = l.c -> 1
        left join pg_temp.g3_textos te on te.cel = l.c -> 2
        where l.tipo = 'dado';

      for v_rec in
        select n, case
            when extras > 0 then 'colunas extras preenchidas'
            when numero is null or numero !~ '^[0-9]{1,15}$' or numero ~ '^0+$' then 'Cod.'
            when cliente is null or cliente not in ('CONSUMIDOR NAO IDENTIFICADO', '[CLIENTE IDENTIFICADO]') then 'Cliente'
            when data_hora is null then 'Data'
            when prod is null or scale(prod) > 2 then 'Prod. (R$)'
            when acrescimo_item is null or scale(acrescimo_item) > 2 then 'Acres. It. (R$)'
            when desconto_item is null or scale(desconto_item) > 2 then 'Desc. It. (R$)'
            when subtotal is null or scale(subtotal) > 2 then 'Subtotal (R$)'
            when acrescimo_rateado is null or scale(acrescimo_rateado) > 2 then 'Acres. Rat. (R$)'
            when desconto_rateado is null or scale(desconto_rateado) > 2 then 'Desc. Rat. (R$)'
            when taxa_servico is null or scale(taxa_servico) > 2 then 'Taxa Serv. (R$)'
            when liquido is null or scale(liquido) > 2 then 'Liquido (R$)'
          end as coluna
        from pg_temp.g3_d
        where extras > 0 or numero is null or numero !~ '^[0-9]{1,15}$' or numero ~ '^0+$'
           or cliente is null or cliente not in ('CONSUMIDOR NAO IDENTIFICADO', '[CLIENTE IDENTIFICADO]')
           or data_hora is null
           or prod is null or scale(prod) > 2 or acrescimo_item is null or scale(acrescimo_item) > 2
           or desconto_item is null or scale(desconto_item) > 2 or subtotal is null or scale(subtotal) > 2
           or acrescimo_rateado is null or scale(acrescimo_rateado) > 2
           or desconto_rateado is null or scale(desconto_rateado) > 2
           or taxa_servico is null or scale(taxa_servico) > 2 or liquido is null or scale(liquido) > 2
        order by n limit 20
      loop
        v_erros := v_erros || jsonb_build_object('codigo', 'celula_ilegivel',
          'mensagem', format('Linha %s: coluna %s ilegivel ou fora do formato do G3.', v_rec.n, v_rec.coluna), 'linha', v_rec.n);
      end loop;

      if jsonb_array_length(v_erros) = 0 then
        if exists (select 1 from pg_temp.g3_d where empresa is distinct from public.g3_norm(v_cfg.empresa_coluna)) then
          v_erros := v_erros || jsonb_build_object('codigo', 'empresa_divergente',
            'mensagem', 'Coluna Empresa diferente da empresa configurada.',
            'linha', (select min(n) from pg_temp.g3_d where empresa is distinct from public.g3_norm(v_cfg.empresa_coluna)));
        end if;
        if exists (select numero from pg_temp.g3_d group by numero having count(*) > 1) then
          v_erros := v_erros || jsonb_build_object('codigo', 'venda_repetida',
            'mensagem', 'Numero de venda repetido no arquivo: ' ||
              (select string_agg(numero, ', ') from (select numero from pg_temp.g3_d group by numero having count(*) > 1 order by numero::bigint limit 10) x),
            'linha', null);
        end if;
      end if;

    else
      create temp table g3_d on commit drop as
        select l.n,
               public.g3_num(l.c -> 0) as ano,
               public.g3_num(l.c -> 1) as mes,
               public.g3_num(l.c -> 2) as dia_n,
               null::date as dia,
               public.g3_num(l.c -> 3) as percentual,
               public.g3_num(l.c -> 4) as venda,
               public.g3_num(l.c -> 5) as custo,
               public.g3_num(l.c -> 6) as acrescimo,
               public.g3_num(l.c -> 7) as desconto,
               public.g3_num(l.c -> 8) as liquido_sem_taxa,
               public.g3_num(l.c -> 9) as taxa_servico,
               public.g3_num(l.c -> 10) as ganho,
               public.g3_num(l.c -> 11) as markup,
               public.g3_num(l.c -> 12) as markdown,
               (select count(*) from jsonb_array_elements(l.c) with ordinality t(x, o)
                 where o > 13 and coalesce(public.g3_texto(x), '') <> '')::int as extras
        from pg_temp.g3_l l
        where l.tipo = 'dado';
      update pg_temp.g3_d
         set dia = public.g3_data_br(lpad(trunc(dia_n)::text, 2, '0') || '/' || lpad(trunc(mes)::text, 2, '0') || '/' || trunc(ano)::text)
       where ano is not null and mes is not null and dia_n is not null
         and ano = trunc(ano) and mes = trunc(mes) and dia_n = trunc(dia_n)
         and ano between 2000 and 2100 and mes between 1 and 12 and dia_n between 1 and 31;

      for v_rec in
        select n, case
            when extras > 0 then 'colunas extras preenchidas'
            when dia is null then 'Ano/Mes/Dia'
            when percentual is null or scale(percentual) > 4 then 'Percentual (%)'
            when venda is null or scale(venda) > 2 then 'Venda (R$)'
            when custo is null or scale(custo) > 2 then 'Custo (R$)'
            when acrescimo is null or scale(acrescimo) > 2 then 'Acrescimo (R$)'
            when desconto is null or scale(desconto) > 2 then 'Desconto (R$)'
            when liquido_sem_taxa is null or scale(liquido_sem_taxa) > 2 then 'Liq. s/ Taxa (R$)'
            when taxa_servico is null or scale(taxa_servico) > 2 then 'Taxa Serv. (R$)'
            when ganho is null or scale(ganho) > 2 then 'Ganho (R$)'
            when markup is null or scale(markup) > 4 then 'Markup (%)'
            when markdown is null or scale(markdown) > 4 then 'Markdown (%)'
          end as coluna
        from pg_temp.g3_d
        where extras > 0 or dia is null or percentual is null or scale(percentual) > 4
           or venda is null or scale(venda) > 2 or custo is null or scale(custo) > 2
           or acrescimo is null or scale(acrescimo) > 2 or desconto is null or scale(desconto) > 2
           or liquido_sem_taxa is null or scale(liquido_sem_taxa) > 2
           or taxa_servico is null or scale(taxa_servico) > 2 or ganho is null or scale(ganho) > 2
           or markup is null or scale(markup) > 4 or markdown is null or scale(markdown) > 4
        order by n limit 20
      loop
        v_erros := v_erros || jsonb_build_object('codigo', 'celula_ilegivel',
          'mensagem', format('Linha %s: coluna %s ilegivel ou fora do formato do G3.', v_rec.n, v_rec.coluna), 'linha', v_rec.n);
      end loop;

      if jsonb_array_length(v_erros) = 0 and exists (select dia from pg_temp.g3_d group by dia having count(*) > 1) then
        v_erros := v_erros || jsonb_build_object('codigo', 'dia_repetido',
          'mensagem', 'Dia repetido no arquivo: ' ||
            (select string_agg(to_char(dia, 'DD/MM/YYYY'), ', ') from (select dia from pg_temp.g3_d group by dia having count(*) > 1 order by dia limit 10) x),
          'linha', null);
      end if;
    end if;

    -- datas dentro do periodo declarado e nao posteriores a geracao
    if jsonb_array_length(v_erros) = 0 then
      if v_l.layout = 'vendas_produto_cliente' then
        select min(n) into v_cnt from pg_temp.g3_d where data < v_ini or data > least(v_fim, v_gerado::date);
      elsif v_l.layout = 'faturamento_geral' then
        select min(n) into v_cnt from pg_temp.g3_d where data_hora::date < v_ini or data_hora::date > least(v_fim, v_gerado::date)
                                                      or data_hora > v_gerado + interval '1 minute';
      else
        select min(n) into v_cnt from pg_temp.g3_d where dia < v_ini or dia > least(v_fim, v_gerado::date);
      end if;
      if v_cnt is not null then
        v_erros := v_erros || jsonb_build_object('codigo', 'data_fora_periodo',
          'mensagem', 'Ha registros com data fora do periodo do relatorio ou depois da data de geracao.', 'linha', v_cnt);
      end if;
    end if;
  end if;

  -- ---------- rodapes ----------
  if jsonb_array_length(v_erros) = 0 then
    if v_l.layout = 'vendas_produto_cliente' then
      with s as (
        select l.n, public.g3_num(l.c -> 6) as informado,
               (select coalesce(sum(d.valor), 0) from pg_temp.g3_d d
                 where d.grupo = (select max(g.n) from pg_temp.g3_l g where g.tipo = 'grupo' and g.n < l.n)) as calculado
        from pg_temp.g3_l l where l.tipo = 'subtotal'
      )
      select jsonb_build_object(
               'subtotais', coalesce(jsonb_agg(jsonb_build_object('linha', n, 'informado', informado, 'calculado', calculado) order by n), '[]'::jsonb),
               'total_informado', (select public.g3_num(c -> 1) from pg_temp.g3_l where tipo = 'rodape'),
               'total_subtotais', coalesce(sum(informado), 0),
               'total_itens', (select coalesce(sum(valor), 0) from pg_temp.g3_d))
        into v_totais
      from s;
      if exists (select 1 from jsonb_array_elements(v_totais -> 'subtotais') x where (x ->> 'informado') is null) then
        v_erros := v_erros || jsonb_build_object('codigo', 'rodape_invalido', 'mensagem', 'Subtotal do cliente ilegivel.', 'linha', null);
      elsif (v_totais ->> 'total_informado') is null
            or (v_totais ->> 'total_informado')::numeric <> (v_totais ->> 'total_subtotais')::numeric then
        v_erros := v_erros || jsonb_build_object('codigo', 'rodape_divergente',
          'mensagem', 'Total Geral de Vendas diferente da soma dos subtotais.', 'linha', null);
      else
        for v_rec in select x from jsonb_array_elements(v_totais -> 'subtotais') x
                      where (x ->> 'informado')::numeric <> (x ->> 'calculado')::numeric
        loop
          v_alertas := v_alertas || jsonb_build_object('codigo', 'rodape_itens_divergente',
            'mensagem', format('Subtotal informado (R$ %s) difere da soma das linhas (R$ %s) em R$ %s. A conferencia valida e a venda a venda contra o FaturamGeral.',
                               v_rec.x ->> 'informado', v_rec.x ->> 'calculado',
                               ((v_rec.x ->> 'calculado')::numeric - (v_rec.x ->> 'informado')::numeric)::text),
            'linha', (v_rec.x ->> 'linha')::int);
        end loop;
      end if;

    elsif v_l.layout = 'faturamento_geral' then
      select jsonb_build_object(
               'informado', (select jsonb_object_agg(c0, public.g3_num(c -> 1)) from pg_temp.g3_l where tipo = 'rodape'),
               'calculado', jsonb_build_object(
                 'prod', coalesce(sum(prod), 0), 'subtotal', coalesce(sum(subtotal), 0),
                 'acrescimo_item', coalesce(sum(acrescimo_item), 0), 'acrescimo_rateado', coalesce(sum(acrescimo_rateado), 0),
                 'desconto_item', coalesce(sum(desconto_item), 0), 'desconto_rateado', coalesce(sum(desconto_rateado), 0),
                 'taxa_servico', coalesce(sum(taxa_servico), 0), 'liquido', coalesce(sum(liquido), 0),
                 'vendas', count(*)))
        into v_totais
      from pg_temp.g3_d;
      if exists (select 1 from jsonb_each(v_totais -> 'informado') x where jsonb_typeof(x.value) <> 'number') then
        v_erros := v_erros || jsonb_build_object('codigo', 'rodape_invalido', 'mensagem', 'Valor ilegivel no resumo/totais.', 'linha', v_resumo_n);
      else
        v_totais := v_totais || jsonb_build_object('conferencia', jsonb_build_object(
          'total_liquido', (v_totais #>> '{informado,TOTAL LIQUIDO}')::numeric = (v_totais #>> '{calculado,liquido}')::numeric,
          'vendas', (v_totais #>> '{informado,VENDAS}')::numeric = (v_totais #>> '{calculado,vendas}')::numeric,
          'taxa', (v_totais #>> '{informado,TAXA DE SERVICO}')::numeric = (v_totais #>> '{calculado,taxa_servico}')::numeric,
          'subtotal', (v_totais #>> '{informado,SUBTOTAL}')::numeric in ((v_totais #>> '{calculado,subtotal}')::numeric, (v_totais #>> '{calculado,prod}')::numeric),
          'descontos', (v_totais #>> '{informado,DESCONTOS}')::numeric in ((v_totais #>> '{calculado,desconto_rateado}')::numeric,
                         (v_totais #>> '{calculado,desconto_rateado}')::numeric + (v_totais #>> '{calculado,desconto_item}')::numeric),
          'acrescimos', (v_totais #>> '{informado,ACRESCIMOS}')::numeric in ((v_totais #>> '{calculado,acrescimo_rateado}')::numeric,
                         (v_totais #>> '{calculado,acrescimo_rateado}')::numeric + (v_totais #>> '{calculado,acrescimo_item}')::numeric),
          'ticket_medio', (v_totais #>> '{calculado,vendas}')::numeric = 0
                          or abs((v_totais #>> '{informado,TICKET MEDIO}')::numeric
                                 - round((v_totais #>> '{calculado,liquido}')::numeric / (v_totais #>> '{calculado,vendas}')::numeric, 2)) <= 0.01));
        if exists (select 1 from jsonb_each(v_totais -> 'conferencia') x where x.value = 'false'::jsonb) then
          v_erros := v_erros || jsonb_build_object('codigo', 'rodape_divergente',
            'mensagem', 'Resumo/totais nao fecha com a soma das linhas: ' ||
              (select string_agg(x.key, ', ' order by x.key) from jsonb_each(v_totais -> 'conferencia') x where x.value = 'false'::jsonb),
            'linha', v_resumo_n);
        end if;
      end if;

    else
      select jsonb_build_object(
               'informado', (select jsonb_object_agg(c0, public.g3_num(c -> 1)) from pg_temp.g3_l where tipo = 'rodape'),
               'calculado', jsonb_build_object(
                 'TOTAL VENDAS', coalesce(sum(venda), 0), 'TOTAL CUSTO', coalesce(sum(custo), 0),
                 'TOTAL ACRESCIMO', coalesce(sum(acrescimo), 0), 'TOTAL DESCONTO', coalesce(sum(desconto), 0),
                 'TOTAL LIQ. S/ TAXA', coalesce(sum(liquido_sem_taxa), 0), 'TOTAL TAXA SERV.', coalesce(sum(taxa_servico), 0),
                 'TOTAL GANHO', coalesce(sum(ganho), 0)))
        into v_totais
      from pg_temp.g3_d;
      if exists (select 1 from jsonb_each(v_totais -> 'informado') x where jsonb_typeof(x.value) <> 'number') then
        v_erros := v_erros || jsonb_build_object('codigo', 'rodape_invalido', 'mensagem', 'Valor ilegivel no resumo/totais.', 'linha', v_resumo_n);
      else
        -- Venda/Acrescimo/Desconto/Liquido/Taxa: exatos. Custo/Ganho: o G3
        -- arredonda o custo de cada dia e totaliza sem arredondar (visto no
        -- arquivo real: R$ 0,02 em 165 dias) -> alerta ate R$ 0,01 por dia;
        -- acima disso, rejeita.
        if exists (select 1 from jsonb_each(v_totais -> 'calculado') x
                    where x.key not in ('TOTAL CUSTO', 'TOTAL GANHO')
                      and (x.value #>> '{}')::numeric <> (v_totais -> 'informado' ->> x.key)::numeric)
           or exists (select 1 from jsonb_each(v_totais -> 'calculado') x
                       where x.key in ('TOTAL CUSTO', 'TOTAL GANHO')
                         and abs((x.value #>> '{}')::numeric - (v_totais -> 'informado' ->> x.key)::numeric)
                             > 0.01 * greatest(v_ndados, 1)) then
          v_erros := v_erros || jsonb_build_object('codigo', 'rodape_divergente',
            'mensagem', 'Resumo/totais nao fecha com a soma das linhas: ' ||
              (select string_agg(x.key, ', ' order by x.key) from jsonb_each(v_totais -> 'calculado') x
                where (x.value #>> '{}')::numeric <> (v_totais -> 'informado' ->> x.key)::numeric),
            'linha', v_resumo_n);
        else
          for v_rec in select x.key, (x.value #>> '{}')::numeric as calculado, (v_totais -> 'informado' ->> x.key)::numeric as informado
                         from jsonb_each(v_totais -> 'calculado') x
                        where x.key in ('TOTAL CUSTO', 'TOTAL GANHO')
                          and (x.value #>> '{}')::numeric <> (v_totais -> 'informado' ->> x.key)::numeric
          loop
            v_alertas := v_alertas || jsonb_build_object('codigo', 'rodape_custo_arredondado',
              'mensagem', format('%s informado (R$ %s) difere da soma dos dias (R$ %s) em R$ %s: arredondamento do custo no G3 (custo importado, nao validado).',
                                 initcap(lower(v_rec.key)), v_rec.informado, v_rec.calculado, (v_rec.calculado - v_rec.informado)::text),
              'linha', v_resumo_n);
          end loop;
        end if;
      end if;
    end if;
  end if;

  -- ---------- rejeicao ----------
  if jsonb_array_length(v_erros) > 0 then
    update public.g3_importacoes
       set status = 'rejeitado', erros = v_erros, alertas = v_alertas, totais = v_totais, resumo = null,
           gerado_em = v_gerado_tz, usuario_g3 = v_usuario, periodo_inicio = v_ini, periodo_fim = v_fim,
           cobertura_completa_fim = v_cob_fim, dia_parcial = v_parcial, filtros = v_filtros,
           estado_base = null, previa_em = now()
     where id = p_lote;
    return;
  end if;

  -- ---------- montagem da previa ----------
  if v_l.layout = 'vendas_produto_cliente' then
    insert into public.g3_previa (lote_id, faceta, chave, data, hash, conteudo, valor, acao, motivo, detalhe, linhas)
    with itens as (
      select d.*, row_number() over (partition by d.numero, d.codigo order by d.qtd, d.valor, d.desconto, d.produto, d.n) as ordinal
      from pg_temp.g3_d d
    ),
    vendas as (
      select numero,
             count(distinct data) as n_datas,
             min(data) as data,
             bool_or(qtd <= 0 or valor <= 0 or desconto < 0) as invalida,
             array_agg(n order by n) as linhas,
             sum(valor) as valor,
             jsonb_build_object('data', min(data),
               'itens', jsonb_agg(jsonb_build_object('c', codigo, 'o', ordinal, 'q', qtd, 'd', desconto, 'v', valor, 'n', produto)
                                  order by lpad(codigo, 18, '0'), ordinal)) as conteudo,
             min(data)::text || '#' || string_agg(codigo || ':' || trim_scale(qtd)::text || ':' || trim_scale(desconto)::text || ':' || trim_scale(valor)::text,
                                                  ';' order by lpad(codigo, 18, '0'), ordinal) as canon
      from itens
      group by numero
    )
    select p_lote, 'itens', numero, data,
           case when n_datas = 1 and not invalida then encode(sha256(convert_to(canon, 'UTF8')), 'hex') end,
           case when n_datas = 1 and not invalida then conteudo end,
           valor,
           case when n_datas > 1 or invalida then 'bloqueada' end,
           case when n_datas > 1 then 'datas_divergentes' when invalida then 'valor_nao_positivo' end,
           case when n_datas > 1 or invalida then jsonb_build_object('itens', jsonb_array_length(conteudo -> 'itens')) end,
           linhas
    from vendas;
    select count(*) into v_conv from pg_temp.g3_d where data_convertida;

  elsif v_l.layout = 'faturamento_geral' then
    insert into public.g3_previa (lote_id, faceta, chave, data, hash, conteudo, valor, acao, motivo, detalhe, linhas)
    select p_lote, 'faturamento', numero, data_hora::date,
           case when not bloq then encode(sha256(convert_to(canon, 'UTF8')), 'hex') end,
           case when not bloq then conteudo end,
           liquido,
           case when bloq then 'bloqueada' end,
           case when invalida then 'valor_nao_positivo' when aritmetica then 'aritmetica_linha' end,
           case when bloq then jsonb_build_object('prod', prod, 'subtotal', subtotal, 'liquido', liquido) end,
           array[n]
    from (
      select d.*,
             (prod <= 0 or liquido <= 0 or acrescimo_item < 0 or desconto_item < 0 or subtotal <= 0
              or acrescimo_rateado < 0 or desconto_rateado < 0 or taxa_servico < 0) as invalida,
             (prod + acrescimo_item - desconto_item <> subtotal
              or subtotal + acrescimo_rateado - desconto_rateado + taxa_servico <> liquido) as aritmetica,
             jsonb_build_object('data', data_hora::date, 'data_hora', to_char(data_hora, 'YYYY-MM-DD"T"HH24:MI:SS'),
               'prod', prod, 'acrescimo_item', acrescimo_item, 'desconto_item', desconto_item, 'subtotal', subtotal,
               'acrescimo_rateado', acrescimo_rateado, 'desconto_rateado', desconto_rateado,
               'taxa_servico', taxa_servico, 'liquido', liquido) as conteudo,
             concat_ws('|', data_hora::date::text, to_char(data_hora, 'YYYY-MM-DD"T"HH24:MI:SS'), trim_scale(prod)::text,
                       trim_scale(acrescimo_item)::text, trim_scale(desconto_item)::text, trim_scale(subtotal)::text,
                       trim_scale(acrescimo_rateado)::text, trim_scale(desconto_rateado)::text,
                       trim_scale(taxa_servico)::text, trim_scale(liquido)::text) as canon
      from pg_temp.g3_d d
    ) x
    cross join lateral (select (x.invalida or x.aritmetica) as bloq) b;
    select count(*) into v_conv from pg_temp.g3_d where data_convertida;

  else
    insert into public.g3_previa (lote_id, faceta, chave, data, hash, conteudo, valor, acao, motivo, detalhe, linhas)
    select p_lote, 'dia', dia::text, dia,
           case when not bloq then encode(sha256(convert_to(canon, 'UTF8')), 'hex') end,
           case when not bloq then conteudo end,
           venda,
           case when bloq then 'bloqueada' end,
           case when invalida then 'valor_nao_positivo' when aritmetica then 'aritmetica_linha' end,
           case when bloq then jsonb_build_object('venda', venda, 'liquido_sem_taxa', liquido_sem_taxa) end,
           array[n]
    from (
      select d.*,
             (venda <= 0 or liquido_sem_taxa <= 0 or acrescimo < 0 or desconto < 0 or taxa_servico < 0) as invalida,
             (liquido_sem_taxa + taxa_servico - custo <> ganho) as aritmetica,
             jsonb_build_object('venda', venda, 'custo', custo, 'acrescimo', acrescimo, 'desconto', desconto,
               'liquido_sem_taxa', liquido_sem_taxa, 'taxa_servico', taxa_servico, 'ganho', ganho,
               'percentual', percentual, 'markup', markup, 'markdown', markdown) as conteudo,
             concat_ws('|', dia::text, trim_scale(venda)::text, trim_scale(custo)::text, trim_scale(acrescimo)::text,
                       trim_scale(desconto)::text, trim_scale(liquido_sem_taxa)::text, trim_scale(taxa_servico)::text,
                       trim_scale(ganho)::text, trim_scale(percentual)::text, trim_scale(markup)::text,
                       trim_scale(markdown)::text) as canon
      from pg_temp.g3_d d
    ) x
    cross join lateral (select (x.invalida or x.aritmetica) as bloq) b;
    v_conv := 0;
  end if;

  -- estatisticas atualizadas da previa recem-montada: sem isso o planejador
  -- pode cruzar previa x estado com laco aninhado (lento em lotes grandes).
  analyze public.g3_previa;

  -- ---------- classificacao contra o estado vigente ----------
  -- mesmo numero com outra data (so vendas): bloqueia, nunca sobrescreve
  update public.g3_previa p
     set acao = 'bloqueada', motivo = 'conflito_numero', hash = null, conteudo = null,
         detalhe = jsonb_build_object('data_atual', e.data, 'data_arquivo', p.data)
    from public.g3_estado e
   where p.lote_id = p_lote and p.acao is null and p.faceta in ('itens', 'faturamento')
     and e.faceta = p.faceta and e.chave = p.chave and e.data <> p.data;

  update public.g3_previa p
     set acao = x.acao
    from (
      select p2.chave,
             case
               when e.chave is null then 'nova'
               when (w.gerado_em, w.seq) > (v_gerado_tz, v_l.seq) then 'superada'
               when e.estado = 'presente' and ce.hash = p2.hash then 'igual'
               when e.estado = 'ausente' and ce.hash = p2.hash then 'reaparecida'
               else 'alterada'
             end as acao
      from public.g3_previa p2
      left join public.g3_estado e on e.faceta = p2.faceta and e.chave = p2.chave
      left join public.g3_importacoes w on w.id = e.lote_id
      left join public.g3_conteudos ce on ce.id = e.conteudo_id
      where p2.lote_id = p_lote and p2.acao is null
    ) x
   where p.lote_id = p_lote and p.chave = x.chave and p.acao is null;

  -- ausentes: vigentes no estado, em dias COMPLETAMENTE cobertos por este
  -- lote, que nao aparecem nele (nem bloqueados) e cujo atestado vencedor
  -- tem precedencia menor.
  if v_cob_fim >= v_ini then
    insert into public.g3_previa (lote_id, faceta, chave, data, valor, acao)
    select p_lote, e.faceta, e.chave, e.data,
           case e.faceta
             when 'itens' then (select sum((i ->> 'v')::numeric) from jsonb_array_elements(c.conteudo -> 'itens') i)
             when 'faturamento' then (c.conteudo ->> 'liquido')::numeric
             else (c.conteudo ->> 'venda')::numeric
           end,
           'ausente'
    from public.g3_estado e
    join public.g3_importacoes w on w.id = e.lote_id
    join public.g3_conteudos c on c.id = e.conteudo_id
    where e.faceta = v_faceta and e.estado = 'presente'
      and e.data between v_ini and v_cob_fim
      and (w.gerado_em, w.seq) < (v_gerado_tz, v_l.seq)
      and not exists (select 1 from public.g3_previa p where p.lote_id = p_lote and p.faceta = e.faceta and p.chave = e.chave);
  end if;

  -- ---------- alertas e resumo ----------
  if coalesce((v_l.arquivo_metadados ->> 'original')::boolean, false) is false then
    v_alertas := v_alertas || jsonb_build_object('codigo', 'arquivo_regravado',
      'mensagem', 'O arquivo nao e o original gerado pelo G3 (foi salvo de novo em outro programa). Ele passou em todas as validacoes de estrutura, conteudo e totais.',
      'linha', null);
  end if;
  if v_conv > 0 then
    v_alertas := v_alertas || jsonb_build_object('codigo', 'datas_convertidas',
      'mensagem', format('%s datas estavam gravadas como data do Excel (e nao como texto do G3) e foram convertidas.', v_conv), 'linha', null);
  end if;
  if v_cob_fim < v_ini then
    v_alertas := v_alertas || jsonb_build_object('codigo', 'sem_dias_completos',
      'mensagem', 'O relatorio cobre apenas o dia em que foi gerado: nenhum dia fica completo e nenhuma ausencia e analisada.', 'linha', null);
  end if;

  select jsonb_build_object(
           'faceta', v_faceta,
           'linhas_dados', v_ndados,
           'chaves', coalesce(sum(qtd) filter (where acao <> 'ausente'), 0),
           'por_acao', coalesce(jsonb_object_agg(acao, qtd) filter (where acao is not null), '{}'::jsonb),
           'valor_por_acao', coalesce(jsonb_object_agg(acao, soma) filter (where acao is not null), '{}'::jsonb),
           'ausentes', coalesce(sum(qtd) filter (where acao = 'ausente'), 0),
           'bloqueadas', coalesce(sum(qtd) filter (where acao = 'bloqueada'), 0))
    into v_resumo
  from (
    select acao, count(*)::int as qtd, coalesce(sum(valor), 0) as soma
    from public.g3_previa where lote_id = p_lote group by acao
  ) x;

  update public.g3_importacoes
     set status = 'previa', erros = '[]'::jsonb, alertas = v_alertas, totais = v_totais, resumo = v_resumo,
         gerado_em = v_gerado_tz, usuario_g3 = v_usuario, periodo_inicio = v_ini, periodo_fim = v_fim,
         cobertura_completa_fim = v_cob_fim, dia_parcial = v_parcial, filtros = v_filtros,
         estado_base = v_cfg.versao_estado, previa_em = now()
   where id = p_lote;
end;
$$;

-- ============================================================
-- 7. RPCs do app (somente proprietario_admin)
-- ============================================================

-- 7.1 Inicia um lote. O arquivo e lido no navegador; aqui chegam so os
-- metadados. Faz a limpeza de lotes expirados antes.
create function public.g3_iniciar_importacao(
  p_layout text,
  p_arquivo_nome text,
  p_arquivo_tamanho bigint,
  p_arquivo_sha256 text,
  p_metadados jsonb,
  p_linhas_total integer
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_id uuid;
  v_cfg public.g3_configuracao%rowtype;
  v_nome text;
  v_existente uuid;
begin
  perform public.g3_exigir_admin();
  perform public.g3_operacao();
  perform public.g3_limpar_interno();
  select * into v_cfg from public.g3_configuracao where id;

  if p_layout is null or p_layout not in ('vendas_produto_cliente', 'faturamento_geral', 'vendas_periodo') then
    raise exception 'Layout invalido.' using errcode = '22023';
  end if;
  v_nome := btrim(regexp_replace(coalesce(p_arquivo_nome, ''), '^.*[\\/]', ''));
  if char_length(v_nome) not between 6 and 255 or lower(v_nome) !~ '\.xlsx$' then
    raise exception 'Somente arquivos .xlsx sao aceitos.' using errcode = '22023';
  end if;
  if p_arquivo_tamanho is null or p_arquivo_tamanho not between 1 and 31457280 then
    raise exception 'Arquivo vazio ou maior que 30 MB.' using errcode = '22023';
  end if;
  if p_arquivo_sha256 is null or p_arquivo_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Impressao digital (sha256) do arquivo invalida.' using errcode = '22023';
  end if;
  if p_metadados is null or jsonb_typeof(p_metadados) <> 'object' or pg_column_size(p_metadados) > 4096 then
    raise exception 'Metadados do arquivo invalidos.' using errcode = '22023';
  end if;
  if coalesce((p_metadados ->> 'abas')::int, 0) <> 1 then
    raise exception 'O arquivo precisa ter exatamente uma aba (relatorio original do G3).' using errcode = '22023';
  end if;
  if coalesce((p_metadados ->> 'formulas')::int, 0) > 0 then
    raise exception 'O arquivo contem formulas: o relatorio do G3 nunca tem formulas; o arquivo foi editado.' using errcode = '22023';
  end if;
  if coalesce((p_metadados ->> 'macros')::boolean, false) then
    raise exception 'O arquivo contem macros.' using errcode = '22023';
  end if;
  if p_linhas_total is null or p_linhas_total not between 1 and v_cfg.max_linhas_dados + 20000 then
    raise exception 'Quantidade de linhas fora do limite (maximo % linhas de dados por lote).', v_cfg.max_linhas_dados using errcode = '22023';
  end if;

  select id into v_existente from public.g3_importacoes where arquivo_sha256 = p_arquivo_sha256 and status = 'confirmado';
  if v_existente is not null then
    raise exception 'Este arquivo ja foi importado e confirmado (lote %).', v_existente using errcode = '23505';
  end if;

  insert into public.g3_importacoes (layout, arquivo_nome, arquivo_tamanho, arquivo_sha256, arquivo_metadados,
                                     linhas_total, criado_por, criado_por_nome)
  values (p_layout, v_nome, p_arquivo_tamanho, p_arquivo_sha256,
          jsonb_build_object(
            'original', coalesce((p_metadados ->> 'original')::boolean, false),
            'produtor', left(p_metadados ->> 'produtor', 60),
            'abas', 1,
            'textos_compartilhados', coalesce((p_metadados ->> 'textos_compartilhados')::boolean, false),
            'formulas', 0,
            'clientes_mascarados', greatest(coalesce((p_metadados ->> 'clientes_mascarados')::int, 0), 0)),
          p_linhas_total, auth.uid(), public.g3_usuario_nome())
  returning id into v_id;
  return v_id;
end;
$$;

-- 7.2 Recebe um bloco de linhas (idempotente por linha). Recusa o bloco
-- INTEIRO, antes de gravar, se houver dado pessoal de cliente.
create function public.g3_enviar_linhas(p_lote uuid, p_inicio integer, p_linhas jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_l public.g3_importacoes%rowtype;
  v_cnpj text;
  v_n int;
  v_linha int;
  v_recebidas int;
begin
  perform public.g3_exigir_admin();
  perform public.g3_operacao();
  select * into v_l from public.g3_importacoes where id = p_lote for update;
  if not found then
    raise exception 'Lote nao encontrado.' using errcode = 'P0002';
  end if;
  if v_l.status <> 'recebendo' then
    raise exception 'O lote nao esta recebendo linhas (status %).', v_l.status using errcode = '22023';
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    raise exception 'Bloco de linhas invalido.' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_linhas);
  if v_n < 1 or v_n > 5000 then
    raise exception 'Bloco deve ter entre 1 e 5000 linhas.' using errcode = '22023';
  end if;
  if p_inicio is null or p_inicio < 1 or p_inicio + v_n - 1 > v_l.linhas_total then
    raise exception 'Faixa de linhas fora do total declarado.' using errcode = '22023';
  end if;
  select cnpj into v_cnpj from public.g3_configuracao where id;

  select min(p_inicio + o::int - 1) into v_linha
  from jsonb_array_elements(p_linhas) with ordinality t(c, o)
  where jsonb_typeof(c) <> 'array' or jsonb_array_length(c) > 40
     or exists (select 1 from jsonb_array_elements(c) x
                 where jsonb_typeof(x) not in ('null', 'string', 'number')
                    or (jsonb_typeof(x) = 'string' and char_length(x #>> '{}') > 1000));
  if v_linha is not null then
    raise exception 'Linha %: estrutura de celulas invalida.', v_linha using errcode = '22023';
  end if;

  -- pre-filtro barato no texto da linha; a checagem celula a celula so roda
  -- nas linhas suspeitas (CPF/CNPJ/Cliente ou sequencias longas de digitos).
  select min(p_inicio + o::int - 1) into v_linha
  from jsonb_array_elements(p_linhas) with ordinality t(c, o)
  where ((c::text ~* '(cpf|cnpj|cliente|[0-9]{10})'
          or c::text ~ '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}|[0-9]{2}\.[0-9]{3}\.[0-9]{3}/[0-9]{4}-[0-9]{2}')
         and exists (select 1 from jsonb_array_elements(c) x where public.g3_celula_pessoal(x, v_cnpj))
         and not (v_l.layout = 'vendas_produto_cliente' and p_inicio + o::int - 1 = 3 and jsonb_array_length(c) = 1))
     or (v_l.layout = 'faturamento_geral' and jsonb_array_length(c) >= 4 and jsonb_typeof(c -> 1) = 'string'
         and (c ->> 1) not in ('Cliente', U&'Consumidor N\00E3o Identificado', '[cliente identificado]')
         and coalesce(public.g3_norm(c ->> 1), '') not in ('CLIENTE', 'CONSUMIDOR NAO IDENTIFICADO', '[CLIENTE IDENTIFICADO]'));
  if v_linha is not null then
    raise exception 'Linha %: dado pessoal de cliente detectado. O arquivo precisa ser mascarado no navegador antes do envio; nada foi gravado.', v_linha
      using errcode = '22023';
  end if;

  select min(t.n) into v_linha
  from (select p_inicio + o::int - 1 as n, c from jsonb_array_elements(p_linhas) with ordinality x(c, o)) t
  join public.g3_importacao_linhas l on l.lote_id = p_lote and l.numero_linha = t.n
  where l.celulas is distinct from t.c;
  if v_linha is not null then
    raise exception 'Linha % ja recebida com conteudo diferente.', v_linha using errcode = '22023';
  end if;

  insert into public.g3_importacao_linhas (lote_id, numero_linha, celulas)
  select p_lote, p_inicio + o::int - 1, c from jsonb_array_elements(p_linhas) with ordinality t(c, o)
  on conflict (lote_id, numero_linha) do nothing;

  select count(*) into v_recebidas from public.g3_importacao_linhas where lote_id = p_lote;
  update public.g3_importacoes set linhas_recebidas = v_recebidas where id = p_lote;
  return v_recebidas;
end;
$$;

-- 7.3 Gera (ou refaz) a previa a partir das linhas brutas gravadas.
create function public.g3_gerar_previa(p_lote uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '45s'
as $$
declare
  v_l public.g3_importacoes%rowtype;
begin
  perform public.g3_exigir_admin();
  perform public.g3_operacao();
  select * into v_l from public.g3_importacoes where id = p_lote for update;
  if not found then
    raise exception 'Lote nao encontrado.' using errcode = 'P0002';
  end if;
  if v_l.status not in ('recebendo', 'previa', 'rejeitado') then
    raise exception 'A previa so pode ser gerada para lotes em recebimento, previa ou rejeitados (status %).', v_l.status using errcode = '22023';
  end if;
  if v_l.linhas_recebidas <> v_l.linhas_total then
    raise exception 'Faltam linhas: recebidas % de %.', v_l.linhas_recebidas, v_l.linhas_total using errcode = '22023';
  end if;

  perform public.g3_analisar(p_lote);

  select * into v_l from public.g3_importacoes where id = p_lote;
  return jsonb_build_object('status', v_l.status, 'erros', v_l.erros, 'alertas', v_l.alertas,
                            'resumo', v_l.resumo, 'totais', v_l.totais, 'estado_base', v_l.estado_base);
end;
$$;

-- 7.4 Lista a previa (lote em previa) ou o que o lote atestou (confirmado/
-- revertido), paginado e filtrado por acao.
create function public.g3_listar_lote(p_lote uuid, p_acao text default null, p_limite integer default 100, p_deslocamento integer default 0)
returns table (faceta text, chave text, data date, acao text, motivo text, detalhe jsonb, linhas integer[], valor numeric)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '20s'
as $$
declare
  v_status text;
begin
  perform public.g3_exigir_admin();
  select status into v_status from public.g3_importacoes where id = p_lote;
  if v_status is null then
    raise exception 'Lote nao encontrado.' using errcode = 'P0002';
  end if;
  p_limite := least(greatest(coalesce(p_limite, 100), 1), 500);
  p_deslocamento := greatest(coalesce(p_deslocamento, 0), 0);

  if v_status in ('confirmado', 'revertido') then
    return query
    select * from (
      select a.faceta, a.chave, a.data, a.acao, null::text, null::jsonb, null::integer[],
             case a.faceta
               when 'itens' then (select sum((i ->> 'v')::numeric) from jsonb_array_elements(c.conteudo -> 'itens') i)
               when 'faturamento' then (c.conteudo ->> 'liquido')::numeric
               else (c.conteudo ->> 'venda')::numeric
             end
      from public.g3_atestados a
      left join public.g3_conteudos c on c.id = a.conteudo_id
      where a.lote_id = p_lote and (p_acao is null or a.acao = p_acao)
      union all
      select p.faceta, p.chave, p.data, 'bloqueada'::text, p.motivo, p.detalhe, p.linhas, p.valor
      from public.g3_pendencias p
      where p.lote_id = p_lote and (p_acao is null or p_acao = 'bloqueada')
    ) x
    order by x.data nulls first, lpad(x.chave, 20, '0')
    limit p_limite offset p_deslocamento;
  else
    return query
    select p.faceta, p.chave, p.data, p.acao, p.motivo, p.detalhe, p.linhas, p.valor::numeric
    from public.g3_previa p
    where p.lote_id = p_lote and (p_acao is null or p.acao = p_acao)
    order by p.data nulls first, lpad(p.chave, 20, '0')
    limit p_limite offset p_deslocamento;
  end if;
end;
$$;

-- 7.5 Confirma: serializado, recusa previa desatualizada, exige reconhecer
-- ausencias, grava conteudos/atestados/pendencias e recalcula.
create function public.g3_confirmar_importacao(p_lote uuid, p_estado_base bigint, p_reconhecer_ausentes boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '45s'
set lock_timeout = '10s'
as $$
declare
  v_l public.g3_importacoes%rowtype;
  v_cfg public.g3_configuracao%rowtype;
  v_faceta text;
  v_ausentes int;
  v_chaves text[];
begin
  perform public.g3_exigir_admin();
  perform public.g3_operacao();
  perform pg_advisory_xact_lock(810081);

  select * into v_l from public.g3_importacoes where id = p_lote for update;
  if not found then
    raise exception 'Lote nao encontrado.' using errcode = 'P0002';
  end if;
  if v_l.status = 'confirmado' then
    raise exception 'Este lote ja foi confirmado.' using errcode = '22023';
  end if;
  if v_l.status <> 'previa' then
    raise exception 'Somente lotes em previa podem ser confirmados (status %).', v_l.status using errcode = '22023';
  end if;
  select * into v_cfg from public.g3_configuracao where id for update;
  if p_estado_base is null or v_l.estado_base is distinct from p_estado_base or v_cfg.versao_estado <> p_estado_base then
    raise exception 'Previa desatualizada: outra importacao foi confirmada ou revertida depois desta previa. Gere a previa novamente.'
      using errcode = '40001';
  end if;
  if exists (select 1 from public.g3_importacoes where arquivo_sha256 = v_l.arquivo_sha256 and status = 'confirmado') then
    raise exception 'Este arquivo ja foi importado e confirmado.' using errcode = '23505';
  end if;
  select count(*) into v_ausentes from public.g3_previa where lote_id = p_lote and acao = 'ausente';
  if v_ausentes > 0 and not coalesce(p_reconhecer_ausentes, false) then
    raise exception 'Ha % registros ausentes neste arquivo em relacao ao que ja foi importado. Confirme que voce reconhece as ausencias.', v_ausentes
      using errcode = '22023';
  end if;
  v_faceta := public.g3_faceta_do_layout(v_l.layout);

  insert into public.g3_conteudos (faceta, chave, hash, conteudo, lote_origem)
  select p.faceta, p.chave, p.hash, p.conteudo, p_lote
  from public.g3_previa p
  where p.lote_id = p_lote and p.acao in ('nova', 'alterada', 'igual', 'reaparecida', 'superada')
  on conflict (faceta, chave, hash) do nothing;

  insert into public.g3_atestados (lote_id, faceta, chave, conteudo_id, acao, data)
  select p_lote, p.faceta, p.chave, c.id, p.acao, p.data
  from public.g3_previa p
  join public.g3_conteudos c on c.faceta = p.faceta and c.chave = p.chave and c.hash = p.hash
  where p.lote_id = p_lote and p.acao in ('nova', 'alterada', 'igual', 'reaparecida', 'superada');

  insert into public.g3_atestados (lote_id, faceta, chave, conteudo_id, acao, data)
  select p_lote, p.faceta, p.chave, null, 'ausente', p.data
  from public.g3_previa p
  where p.lote_id = p_lote and p.acao = 'ausente';

  insert into public.g3_pendencias (lote_id, faceta, chave, data, motivo, detalhe, linhas, valor)
  select p_lote, p.faceta, p.chave, p.data, p.motivo, p.detalhe, p.linhas, p.valor
  from public.g3_previa p
  where p.lote_id = p_lote and p.acao = 'bloqueada';

  update public.g3_importacoes
     set status = 'confirmado', confirmado_por = auth.uid(), confirmado_por_nome = public.g3_usuario_nome(),
         confirmado_em = now()
   where id = p_lote;

  -- chaves afetadas: as do lote + as vigentes nos dias que ele cobre por completo
  select array_agg(distinct k) into v_chaves from (
    select p.chave as k from public.g3_previa p where p.lote_id = p_lote and p.acao <> 'bloqueada'
    union
    select e.chave from public.g3_estado e
     where e.faceta = v_faceta and e.data between v_l.periodo_inicio and v_l.cobertura_completa_fim
  ) x;
  perform public.g3_recalcular(v_faceta, v_chaves);

  -- retencao: linhas "iguais" nao precisam das celulas (conteudo identico ja guardado)
  update public.g3_importacao_linhas l
     set celulas = null
    from (select unnest(p.linhas) as n from public.g3_previa p where p.lote_id = p_lote and p.acao = 'igual') x
   where l.lote_id = p_lote and l.numero_linha = x.n;

  delete from public.g3_previa where lote_id = p_lote;
  update public.g3_configuracao set versao_estado = versao_estado + 1, atualizado_em = now() where id;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('g3_importacao', p_lote::text, 'confirmou', v_l.layout, null,
          format('arquivo=%s; periodo=%s a %s; resumo=%s', v_l.arquivo_nome, v_l.periodo_inicio, v_l.periodo_fim, v_l.resumo::text));

  return jsonb_build_object('status', 'confirmado', 'resumo', v_l.resumo);
end;
$$;

-- 7.6 Descarta um lote nao confirmado (apaga as linhas brutas e a previa).
create function public.g3_descartar_importacao(p_lote uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  v_l public.g3_importacoes%rowtype;
begin
  perform public.g3_exigir_admin();
  perform public.g3_operacao();
  select * into v_l from public.g3_importacoes where id = p_lote for update;
  if not found then
    raise exception 'Lote nao encontrado.' using errcode = 'P0002';
  end if;
  if v_l.status not in ('recebendo', 'previa', 'rejeitado') then
    raise exception 'Somente lotes nao confirmados podem ser descartados (status %).', v_l.status using errcode = '22023';
  end if;
  delete from public.g3_previa where lote_id = p_lote;
  delete from public.g3_importacao_linhas where lote_id = p_lote;
  update public.g3_importacoes
     set status = 'descartado', encerrado_em = now(), linhas_purgadas_em = now()
   where id = p_lote;
  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('g3_importacao', p_lote::text, 'descartou', v_l.layout, v_l.status, format('arquivo=%s', v_l.arquivo_nome));
end;
$$;

-- 7.7 Reverte um lote confirmado, em qualquer ordem: o estado e recalculado
-- a partir dos lotes confirmados restantes.
create function public.g3_reverter_importacao(p_lote uuid, p_motivo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '45s'
set lock_timeout = '10s'
as $$
declare
  v_l public.g3_importacoes%rowtype;
  v_faceta text;
  v_chaves text[];
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  perform public.g3_exigir_admin();
  perform public.g3_operacao();
  perform pg_advisory_xact_lock(810081);

  select * into v_l from public.g3_importacoes where id = p_lote for update;
  if not found then
    raise exception 'Lote nao encontrado.' using errcode = 'P0002';
  end if;
  if v_l.status <> 'confirmado' then
    raise exception 'Somente lotes confirmados podem ser revertidos (status %).', v_l.status using errcode = '22023';
  end if;
  if char_length(v_motivo) not between 3 and 500 then
    raise exception 'Informe o motivo da reversao (3 a 500 caracteres).' using errcode = '22023';
  end if;
  v_faceta := public.g3_faceta_do_layout(v_l.layout);

  update public.g3_importacoes
     set status = 'revertido', revertido_por = auth.uid(), revertido_por_nome = public.g3_usuario_nome(),
         revertido_em = now(), motivo_reversao = v_motivo
   where id = p_lote;

  select array_agg(distinct k) into v_chaves from (
    select a.chave as k from public.g3_atestados a where a.lote_id = p_lote
    union
    select p.chave from public.g3_pendencias p where p.lote_id = p_lote
    union
    select e.chave from public.g3_estado e
     where e.faceta = v_faceta and e.data between v_l.periodo_inicio and v_l.cobertura_completa_fim
  ) x;
  perform public.g3_recalcular(v_faceta, v_chaves);

  update public.g3_configuracao set versao_estado = versao_estado + 1, atualizado_em = now() where id;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('g3_importacao', p_lote::text, 'reverteu', v_l.layout, 'confirmado',
          format('arquivo=%s; motivo=%s; chaves_recalculadas=%s', v_l.arquivo_nome, v_motivo, coalesce(cardinality(v_chaves), 0)));

  return jsonb_build_object('status', 'revertido', 'chaves_recalculadas', coalesce(cardinality(v_chaves), 0));
end;
$$;

-- 7.8 Pendencias abertas (derivado): pendencia de lote confirmado ainda nao
-- superada por um lote posterior do mesmo layout que traga a chave valida
-- ou cubra o dia por completo sem pendencia propria para ela.
create function public.g3_pendencias_abertas_int()
returns table (id bigint, lote_id uuid, layout text, faceta text, chave text, data date, motivo text,
               detalhe jsonb, linhas integer[], valor numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.lote_id, l.layout, p.faceta, p.chave, p.data, p.motivo, p.detalhe, p.linhas, p.valor
  from public.g3_pendencias p
  join public.g3_importacoes l on l.id = p.lote_id and l.status = 'confirmado'
  where not exists (
    select 1 from public.g3_importacoes l2
    where l2.status = 'confirmado' and l2.layout = l.layout
      and (l2.gerado_em, l2.seq) > (l.gerado_em, l.seq)
      and (exists (select 1 from public.g3_atestados a
                    where a.lote_id = l2.id and a.faceta = p.faceta and a.chave = p.chave and a.conteudo_id is not null)
           or (p.data between l2.periodo_inicio and l2.cobertura_completa_fim
               and not exists (select 1 from public.g3_pendencias p2
                                where p2.lote_id = l2.id and p2.faceta = p.faceta and p2.chave = p.chave)))
  )
$$;

create function public.g3_listar_pendencias()
returns table (id bigint, lote_id uuid, layout text, faceta text, chave text, data date, motivo text,
               detalhe jsonb, linhas integer[], valor numeric)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '20s'
as $$
begin
  perform public.g3_exigir_admin();
  return query select * from public.g3_pendencias_abertas_int() x order by x.data nulls first, x.faceta, lpad(x.chave, 20, '0');
end;
$$;

-- 7.9 Cobertura diaria por layout: completo so se um lote confirmado cobre
-- o dia inteiro E nao ha pendencia aberta naquele dia.
create function public.g3_cobertura_int(p_inicio date, p_fim date)
returns table (dia date, layout text, estado text, pendencias integer)
language sql
stable
security definer
set search_path = ''
as $$
  with dias as (select d::date as dia from generate_series(p_inicio, p_fim, interval '1 day') d),
  lays as (select unnest(array['vendas_produto_cliente', 'faturamento_geral', 'vendas_periodo']) as layout),
  pend as (select layout, data, count(*)::int as qtd from public.g3_pendencias_abertas_int() group by layout, data)
  select d.dia, ly.layout,
         case
           when exists (select 1 from public.g3_importacoes l where l.status = 'confirmado' and l.layout = ly.layout
                         and d.dia between l.periodo_inicio and l.cobertura_completa_fim)
             then case when coalesce(p.qtd, 0) > 0 then 'com_pendencias' else 'completo' end
           when exists (select 1 from public.g3_importacoes l where l.status = 'confirmado' and l.layout = ly.layout
                         and l.dia_parcial = d.dia)
             then case when coalesce(p.qtd, 0) > 0 then 'com_pendencias' else 'parcial' end
           else 'sem_dados'
         end,
         coalesce(p.qtd, 0)
  from dias d cross join lays ly
  left join pend p on p.layout = ly.layout and p.data = d.dia
$$;

create function public.g3_cobertura(p_inicio date, p_fim date)
returns table (dia date, layout text, estado text, pendencias integer)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '20s'
as $$
begin
  perform public.g3_exigir_admin();
  if p_inicio is null or p_fim is null or p_inicio > p_fim or p_fim - p_inicio > 400 then
    raise exception 'Periodo invalido (maximo 400 dias).' using errcode = '22023';
  end if;
  return query select * from public.g3_cobertura_int(p_inicio, p_fim) x order by x.dia, x.layout;
end;
$$;

-- 7.10 Conciliacao diaria entre os 3 relatorios. Nunca esconde vendas: cada
-- divergencia aparece contada; "conciliado" so com os 3 completos, sem
-- pendencias e com todos os totais batendo.
create function public.g3_conciliacao_diaria(p_inicio date, p_fim date)
returns table (
  dia date,
  cobertura_itens text, cobertura_faturamento text, cobertura_periodo text,
  vendas integer, conciliadas integer, divergentes integer, sem_itens integer, sem_faturamento integer, ausentes integer,
  pendencias integer,
  soma_itens numeric, soma_prod numeric, soma_liquido numeric,
  periodo_venda numeric, periodo_liquido numeric,
  estado text
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '20s'
as $$
begin
  perform public.g3_exigir_admin();
  if p_inicio is null or p_fim is null or p_inicio > p_fim or p_fim - p_inicio > 400 then
    raise exception 'Periodo invalido (maximo 400 dias).' using errcode = '22023';
  end if;
  return query
  with cob as (
    select c.dia,
           max(c.estado) filter (where c.layout = 'vendas_produto_cliente') as ci,
           max(c.estado) filter (where c.layout = 'faturamento_geral') as cf,
           max(c.estado) filter (where c.layout = 'vendas_periodo') as cp,
           sum(c.pendencias)::int as pend
    from public.g3_cobertura_int(p_inicio, p_fim) c
    group by c.dia
  ),
  v as (
    select g.data,
           count(*)::int as vendas,
           count(*) filter (where g.conciliacao = 'conciliada')::int as conciliadas,
           count(*) filter (where g.conciliacao = 'divergente')::int as divergentes,
           count(*) filter (where g.conciliacao = 'sem_itens')::int as sem_itens,
           count(*) filter (where g.conciliacao = 'sem_faturamento')::int as sem_faturamento,
           count(*) filter (where g.conciliacao = 'ausente')::int as ausentes,
           coalesce(sum(g.itens_total) filter (where g.itens_estado = 'presente'), 0) as soma_itens,
           coalesce(sum(g.prod) filter (where g.fat_estado = 'presente'), 0) as soma_prod,
           coalesce(sum(g.liquido) filter (where g.fat_estado = 'presente'), 0) as soma_liquido
    from public.g3_vendas g
    where g.data between p_inicio and p_fim
    group by g.data
  ),
  p as (
    select d.dia, d.venda, d.liquido_sem_taxa from public.g3_vendas_diarias d
    where d.dia between p_inicio and p_fim and d.estado = 'presente'
  )
  select cob.dia, cob.ci, cob.cf, cob.cp,
         coalesce(v.vendas, 0), coalesce(v.conciliadas, 0), coalesce(v.divergentes, 0), coalesce(v.sem_itens, 0),
         coalesce(v.sem_faturamento, 0), coalesce(v.ausentes, 0), cob.pend,
         coalesce(v.soma_itens, 0), coalesce(v.soma_prod, 0), coalesce(v.soma_liquido, 0),
         coalesce(p.venda, 0), coalesce(p.liquido_sem_taxa, 0),
         case
           when cob.pend > 0 then 'com_pendencias'
           when cob.ci <> 'completo' or cob.cf <> 'completo' or cob.cp <> 'completo' then 'incompleto'
           when coalesce(v.divergentes, 0) + coalesce(v.sem_itens, 0) + coalesce(v.sem_faturamento, 0) + coalesce(v.ausentes, 0) = 0
                and coalesce(p.venda, 0) = coalesce(v.soma_prod, 0)
                and coalesce(v.soma_prod, 0) = coalesce(v.soma_itens, 0)
                and coalesce(p.liquido_sem_taxa, 0) = coalesce(v.soma_liquido, 0)
             then 'conciliado'
           else 'divergente'
         end
  from cob
  left join v on v.data = cob.dia
  left join p on p.dia = cob.dia
  order by cob.dia;
end;
$$;

-- 7.11 Espaco ocupado pelas tabelas g3_* (bytes, com indices).
create function public.g3_espaco_ocupado()
returns table (tabela text, bytes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.g3_exigir_admin();
  return query
  select c.relname::text, pg_total_relation_size(c.oid)::bigint
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'g3\_%'
  order by 2 desc;
end;
$$;

-- 7.12 Limpeza manual (mesma regra da automatica).
create function public.g3_limpar()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
begin
  perform public.g3_exigir_admin();
  return public.g3_limpar_interno();
end;
$$;

-- ============================================================
-- 8. RLS (somente leitura, somente proprietario_admin)
-- ============================================================
alter table public.g3_configuracao enable row level security;
alter table public.g3_importacoes enable row level security;
alter table public.g3_importacao_linhas enable row level security;
alter table public.g3_previa enable row level security;
alter table public.g3_conteudos enable row level security;
alter table public.g3_atestados enable row level security;
alter table public.g3_pendencias enable row level security;
alter table public.g3_estado enable row level security;
alter table public.g3_vendas enable row level security;
alter table public.g3_venda_itens enable row level security;
alter table public.g3_vendas_diarias enable row level security;

create policy g3_configuracao_select on public.g3_configuracao for select to authenticated using ((select public.is_admin()));
create policy g3_importacoes_select on public.g3_importacoes for select to authenticated using ((select public.is_admin()));
create policy g3_importacao_linhas_select on public.g3_importacao_linhas for select to authenticated using ((select public.is_admin()));
create policy g3_previa_select on public.g3_previa for select to authenticated using ((select public.is_admin()));
create policy g3_conteudos_select on public.g3_conteudos for select to authenticated using ((select public.is_admin()));
create policy g3_atestados_select on public.g3_atestados for select to authenticated using ((select public.is_admin()));
create policy g3_pendencias_select on public.g3_pendencias for select to authenticated using ((select public.is_admin()));
create policy g3_estado_select on public.g3_estado for select to authenticated using ((select public.is_admin()));
create policy g3_vendas_select on public.g3_vendas for select to authenticated using ((select public.is_admin()));
create policy g3_venda_itens_select on public.g3_venda_itens for select to authenticated using ((select public.is_admin()));
create policy g3_vendas_diarias_select on public.g3_vendas_diarias for select to authenticated using ((select public.is_admin()));

-- ============================================================
-- 9. Grants minimos
-- ============================================================
revoke all on public.g3_configuracao, public.g3_importacoes, public.g3_importacao_linhas, public.g3_previa,
              public.g3_conteudos, public.g3_atestados, public.g3_pendencias, public.g3_estado,
              public.g3_vendas, public.g3_venda_itens, public.g3_vendas_diarias
  from public, anon, authenticated;

grant select on public.g3_configuracao, public.g3_importacoes, public.g3_importacao_linhas, public.g3_previa,
                public.g3_conteudos, public.g3_atestados, public.g3_pendencias, public.g3_estado,
                public.g3_vendas, public.g3_venda_itens, public.g3_vendas_diarias
  to authenticated;

DO $$
declare
  r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'g3\_%'
  loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated', r.relname);
  end loop;

  -- Funcoes: ninguem executa, exceto as RPCs abaixo (so authenticated).
  for r in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'g3\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', r.assinatura);
  end loop;
end $$;

grant execute on function public.g3_iniciar_importacao(text, text, bigint, text, jsonb, integer) to authenticated;
grant execute on function public.g3_enviar_linhas(uuid, integer, jsonb) to authenticated;
grant execute on function public.g3_gerar_previa(uuid) to authenticated;
grant execute on function public.g3_listar_lote(uuid, text, integer, integer) to authenticated;
grant execute on function public.g3_confirmar_importacao(uuid, bigint, boolean) to authenticated;
grant execute on function public.g3_descartar_importacao(uuid) to authenticated;
grant execute on function public.g3_reverter_importacao(uuid, text) to authenticated;
grant execute on function public.g3_listar_pendencias() to authenticated;
grant execute on function public.g3_cobertura(date, date) to authenticated;
grant execute on function public.g3_conciliacao_diaria(date, date) to authenticated;
grant execute on function public.g3_espaco_ocupado() to authenticated;
grant execute on function public.g3_limpar() to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (manual, so se precisar desfazer -- APAGA todas as importacoes
-- do G3 gravadas depois da aplicacao; nao toca em nenhum dado anterior):
-- BEGIN;
-- drop function if exists public.g3_limpar();
-- drop function if exists public.g3_espaco_ocupado();
-- drop function if exists public.g3_conciliacao_diaria(date, date);
-- drop function if exists public.g3_cobertura(date, date);
-- drop function if exists public.g3_cobertura_int(date, date);
-- drop function if exists public.g3_listar_pendencias();
-- drop function if exists public.g3_pendencias_abertas_int();
-- drop function if exists public.g3_reverter_importacao(uuid, text);
-- drop function if exists public.g3_descartar_importacao(uuid);
-- drop function if exists public.g3_confirmar_importacao(uuid, bigint, boolean);
-- drop function if exists public.g3_listar_lote(uuid, text, integer, integer);
-- drop function if exists public.g3_gerar_previa(uuid);
-- drop function if exists public.g3_enviar_linhas(uuid, integer, jsonb);
-- drop function if exists public.g3_iniciar_importacao(text, text, bigint, text, jsonb, integer);
-- drop function if exists public.g3_analisar(uuid);
-- drop function if exists public.g3_recalcular(text, text[]);
-- drop function if exists public.g3_limpar_interno();
-- drop table if exists public.g3_venda_itens, public.g3_vendas, public.g3_vendas_diarias, public.g3_estado,
--   public.g3_pendencias, public.g3_atestados, public.g3_conteudos, public.g3_previa,
--   public.g3_importacao_linhas, public.g3_importacoes, public.g3_configuracao;
-- drop function if exists public.g3_imutavel();
-- drop function if exists public.g3_protecao();
-- drop function if exists public.g3_usuario_nome();
-- drop function if exists public.g3_layout_da_faceta(text);
-- drop function if exists public.g3_faceta_do_layout(text);
-- drop function if exists public.g3_exigir_admin();
-- drop function if exists public.g3_operacao();
-- drop function if exists public.g3_celula_pessoal(jsonb, text);
-- drop function if exists public.g3_linha_norm(jsonb);
-- drop function if exists public.g3_sha(text);
-- drop function if exists public.g3_data_hora_cel(jsonb);
-- drop function if exists public.g3_data_cel(jsonb);
-- drop function if exists public.g3_data_br(text);
-- drop function if exists public.g3_num(jsonb);
-- drop function if exists public.g3_texto(jsonb);
-- drop function if exists public.g3_norm(text);
-- COMMIT;
-- ============================================================
