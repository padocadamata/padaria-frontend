-- 0061_folha_tarefas.sql
-- FOLHA DE PAGAMENTO > TAREFAS -- V1: cadastro de tarefas operacionais
-- recorrentes, regra de programacao versionada por vigencia, motor
-- DETERMINISTICO de distribuicao F1/F2/F3 e ocorrencias MATERIALIZADAS
-- (fotografia historica) com conclusao, ajuste, cancelamento e avulsas.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor.
--
-- ============================================================
-- NUMERACAO
-- ============================================================
-- origin/main vai ate 0058. A frente paralela "Escala Padrao" ja reservou
-- 0059 e 0060 (ainda nao publicadas, existentes so na worktree dela).
-- 0061 e o primeiro numero livre acima delas -- conferido no diretorio
-- principal e em todas as worktrees antes de nomear este arquivo. Esta
-- migration NAO depende de 0059/0060 (so de 0001..0058).
--
-- ============================================================
-- DECISOES FECHADAS (usuario, rodada de diagnostico)
-- ============================================================
--   * F1/F2/F3 sao POSICOES de distribuicao, nunca funcionarios -- nenhum
--     vinculo com public.funcionarios. Nome livre opcional por posicao,
--     com vigencia por data (tarefas_posicoes_nomes).
--   * REGRA x OCORRENCIA: a regra de programacao e versionada por
--     vigencia (tarefas_regras); o calendario le SOMENTE ocorrencias
--     materializadas (tarefas_ocorrencias), nunca recalcula na leitura.
--   * A ocorrencia guarda a fotografia completa: posicao_programada (o
--     que o motor calculou), posicao efetiva, responsavel_nome (nome da
--     posicao vigente NAQUELA data, materializado), responsavel_avulso
--     (nome livre digitado so para aquela ocorrencia), regra_id
--     (rastreabilidade), conclusao, ajuste e cancelamento.
--   * Rotacao CONTINUA entre meses, deterministica (data + regra +
--     deslocamento + ancora). Nunca usa "ultima posicao gravada".
--   * Distribuicao equilibrada (nao copia a concentracao da planilha).
--
-- ============================================================
-- MOTOR DE DISTRIBUICAO
-- ============================================================
--   ANCORA: 2024-01-01 (segunda-feira ISO). Fixa, documentada aqui e em
--   public.tarefas_posicao_calculada -- NUNCA muda (mudar a ancora muda a
--   posicao de toda ocorrencia futura ainda intocada).
--
--   indice diario  = (data - 2024-01-01)                 -- 1 por dia
--   indice semanal = floor((data - 2024-01-01) / 7)       -- 1 por semana
--                    ISO (segunda a domingo), continua entre meses/anos
--   posicao        = ((indice + deslocamento) mod 3) + 1  -- 1=F1 2=F2 3=F3
--
--   A "unidade de distribuicao" de uma ocorrencia e o GRUPO da regra
--   vigente (se houver) ou a propria tarefa:
--     * grupo  -> usa tarefas_grupos.rotacao + tarefas_grupos.deslocamento
--       (todas as tarefas do grupo recebem a MESMA posicao no dia);
--     * tarefa -> rotacao 'diaria' se regra.tipo='diaria', senao
--       'semanal'; deslocamento = regra.deslocamento.
--   Consequencias:
--     * 3 blocos de fechamento (rotacao diaria, deslocamentos 0/1/2) nunca
--       coincidem no mesmo dia;
--     * Tapetes + Lixeiras (grupo semanal) sempre juntos;
--     * nenhum reinicio no dia 1: 31/10 -> 01/11 continua a sequencia;
--     * resultado independe da ordem em que os meses sao programados.
--   O deslocamento e detalhe INTERNO: a carga inicial usa valores
--   escolhidos por busca exaustiva (custo de desequilibrio semanal 18 -> 6
--   em relacao aos deslocamentos da planilha); tarefas novas recebem um
--   deslocamento sugerido automaticamente (tarefas_deslocamento_sugerido).
--
-- ============================================================
-- MATERIALIZACAO / SINCRONIZACAO
-- ============================================================
--   Ocorrencia INTOCADA = origem='programada' AND nao concluida AND nao
--   cancelada AND nunca ajustada. So intocadas podem ser removidas/
--   religadas/renomeadas automaticamente, e so em datas >= hoje
--   (America/Sao_Paulo) -- exceto a PRIMEIRA programacao de um mes, que
--   materializa o mes inteiro (nao ha nada a alterar ainda).
--   Nunca modificadas automaticamente: datas passadas, concluidas,
--   ajustadas, canceladas, avulsas.
--   PLANO x APLICACAO: o calculo vive numa unica funcao SOMENTE LEITURA
--   (tarefas_plano_sincronizacao / tarefas_plano_a_partir_de) que devolve
--   as acoes (remover/religar/renomear/criar/preservar). A execucao grava
--   a mudanca pedida (regra, nome, mes) e aplica o plano com
--   tarefas_aplicar_plano -- o unico ponto de escrita da sincronizacao.
--   PREVIA (p_simular=true): NENHUMA escrita, nenhum trigger, nenhum
--   log, nenhum advisory lock. A mudanca pedida entra no plano como
--   hipotese em memoria (parametros p_h_*, com a mesma semantica do upsert
--   real) e a previa devolve so o resumo do plano. Nao existe "escrever e
--   desfazer".
--   Concorrencia: as execucoes serializam num advisory lock de transacao;
--   RPCs de ocorrencia travam a linha (FOR UPDATE); tarefas_aplicar_plano
--   reconfirma "intocada" linha a linha antes de remover/alterar.
--
-- ============================================================
-- ESCOPO
-- ============================================================
--   1. Funcoes puras/internas do motor (posicao, regra, esperadas, nome
--      vigente, sincronizacao, deslocamento sugerido).
--   2. 7 tabelas: tarefas_categorias, tarefas_grupos, tarefas,
--      tarefas_regras, tarefas_posicoes_nomes, tarefas_meses,
--      tarefas_ocorrencias -- com triggers de autoria/protecao e RLS.
--   3. Permissoes tarefas.visualizar/.editar/.concluir (so
--      proprietario_admin nesta rodada; demais perfis via override).
--   4. RPCs SECURITY DEFINER de escrita (nenhuma policy de escrita).
--   5. Carga inicial (planilha Calendario_Tarefas_Padoca.xlsx): 3
--      categorias, 4 grupos, 38 tarefas e 38 regras vigentes desde
--      2026-10-01. So roda se public.tarefas estiver vazia.
--
-- NAO faz: nenhuma alteracao em funcionarios/escala/agenda/producao/
-- pedidos/catalogo; nenhuma integracao com Escala, faltas, ponto ou login
-- de funcionarias; nenhuma geracao automatica de mes (so por RPC
-- explicita).

BEGIN;

-- ============================================================
-- 1. Funcoes puras do motor
-- ============================================================

-- "Hoje" operacional da Padoca -- mesmo criterio de 0022/0026/0038:
-- nunca current_date do servidor (UTC).
create or replace function public.tarefas_hoje()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

comment on function public.tarefas_hoje() is
  'Data de hoje em America/Sao_Paulo (0061). Base de todas as regras "somente hoje em diante" de Tarefas.';

-- Posicao (1=F1, 2=F2, 3=F3) de uma unidade de distribuicao numa data.
-- ANCORA FIXA 2024-01-01 (segunda-feira). Divisao/modulo sempre nao
-- negativos (datas anteriores a ancora continuam deterministicas).
create or replace function public.tarefas_posicao_calculada(
  p_data         date,
  p_rotacao      text,
  p_deslocamento smallint
)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select (
    (
      (
        case
          when p_rotacao = 'diaria' then (p_data - date '2024-01-01')
          else floor((p_data - date '2024-01-01')::numeric / 7)::integer
        end
        + p_deslocamento
      ) % 3 + 3
    ) % 3 + 1
  )::smallint
$$;

comment on function public.tarefas_posicao_calculada(date, text, smallint) is
  'Motor de rotacao continua de Tarefas (0061). ANCORA 2024-01-01 (segunda ISO). rotacao=diaria: indice = dias desde a ancora; qualquer outra: indice = semanas ISO desde a ancora. posicao = ((indice + deslocamento) mod 3) + 1. Pura/imutavel: mesma data + rotacao + deslocamento => mesma posicao, independente de qualquer dado materializado.';

-- A regra gera ocorrencia nesta data?
--   diaria          -> todo dia (inclui sabado/domingo);
--   dias_semana     -> dia ISO (1=seg..7=dom) contido em dias_semana;
--   semanas_do_mes  -> dia ISO em dias_semana E n-esima ocorrencia desse
--                      dia no mes (= ceil(dia/7)) em semanas_do_mes
--                      (ex.: 2a e 4a quarta = dias {3}, semanas {2,4});
--   sem_programacao -> nunca.
create or replace function public.tarefas_regra_ocorre(
  p_tipo           text,
  p_dias_semana    smallint[],
  p_semanas_do_mes smallint[],
  p_data           date
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_tipo
    when 'diaria' then true
    when 'dias_semana' then extract(isodow from p_data)::smallint = any(p_dias_semana)
    when 'semanas_do_mes' then
      extract(isodow from p_data)::smallint = any(p_dias_semana)
      and ((extract(day from p_data)::integer + 6) / 7)::smallint = any(p_semanas_do_mes)
    else false
  end
$$;

comment on function public.tarefas_regra_ocorre(text, smallint[], smallint[], date) is
  'Recorrencia de Tarefas (0061): diaria | dias_semana (ISO 1=seg..7=dom) | semanas_do_mes (n-esimo dia da semana no mes, ceil(dia/7)) | sem_programacao.';

-- Normalizacao de texto livre (nome de pessoa/descricao): trim + espacos
-- internos colapsados; vazio -> NULL. NAO altera maiusculas/minusculas.
create or replace function public.tarefas_normalizar_texto(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(btrim(coalesce(p_texto, '')), '\s+', ' ', 'g'), '')
$$;

-- ============================================================
-- 2. Tabelas
-- ============================================================

-- ------------------------------------------------------------
-- 2.1 tarefas_categorias -- secoes da matriz (master-data curto,
--     maiusculas, mesmo padrao de agenda_categorias/0038).
-- ------------------------------------------------------------
create table if not exists public.tarefas_categorias (
  valor     text primary key,
  ordem     smallint not null,
  criado_em timestamptz not null default now(),

  constraint tarefas_categorias_valor_normalizado
    check (valor = upper(btrim(valor)) and valor <> ''),
  constraint tarefas_categorias_ordem_unica unique (ordem)
);

comment on table public.tarefas_categorias is
  'Secoes da matriz de Tarefas (0061): LIMPEZA, ABASTECIMENTO E CONTROLE, FECHAMENTO. Master-data curto em maiusculas (mesmo padrao de agenda_categorias). Escrita somente por migration nesta V1.';

-- ------------------------------------------------------------
-- 2.2 tarefas_grupos -- unidades de distribuicao (todas as tarefas do
--     grupo recebem a mesma posicao no dia).
-- ------------------------------------------------------------
create table if not exists public.tarefas_grupos (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  rotacao        text not null,
  deslocamento   smallint not null,
  ordem          smallint not null default 0,

  criado_por     uuid references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em  timestamptz,

  constraint tarefas_grupos_nome_valido
    check (nome = btrim(nome) and nome <> '' and char_length(nome) <= 80),
  constraint tarefas_grupos_rotacao_valida
    check (rotacao in ('diaria', 'semanal')),
  constraint tarefas_grupos_deslocamento_valido
    check (deslocamento between 0 and 2)
);

create unique index if not exists tarefas_grupos_nome_unico_idx
  on public.tarefas_grupos (lower(nome));

comment on table public.tarefas_grupos is
  'Unidade de distribuicao de Tarefas (0061): toda ocorrencia de tarefa cuja regra vigente aponta para o grupo recebe a posicao calculada com rotacao+deslocamento DO GRUPO -- ex.: Fechamento Bloco 1/2/3 (diaria, 0/1/2, nunca coincidem) e Tapetes + Lixeiras (semanal). rotacao e imutavel apos criado (ver salvar_grupo_tarefas).';

comment on column public.tarefas_grupos.deslocamento is
  'Detalhe interno do motor (0..2). Escolhido automaticamente na criacao (tarefas_grupo_deslocamento_sugerido) ou fixado pela carga inicial. Nunca exibido como "k modulo 3" na interface.';

-- ------------------------------------------------------------
-- 2.3 tarefas -- cadastro (sem regra: a regra e versionada a parte).
-- ------------------------------------------------------------
create table if not exists public.tarefas (
  id             uuid primary key default gen_random_uuid(),
  descricao      text not null,
  categoria      text not null references public.tarefas_categorias(valor) on update cascade on delete restrict,
  ordem          smallint not null default 0,
  ativo          boolean not null default true,
  observacao     text,

  criado_por     uuid references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em  timestamptz,

  constraint tarefas_descricao_valida
    check (descricao = btrim(descricao) and descricao <> '' and char_length(descricao) <= 300),
  constraint tarefas_observacao_valida
    check (observacao is null or (btrim(observacao) <> '' and char_length(observacao) <= 1000))
);

create unique index if not exists tarefas_descricao_unica_idx
  on public.tarefas (lower(descricao));

create index if not exists tarefas_categoria_ordem_idx
  on public.tarefas (categoria, ordem);

comment on table public.tarefas is
  'Cadastro de tarefas operacionais (0061). descricao/categoria/ordem/observacao sao CORRECOES (valem tambem para o historico, que referencia a tarefa). Mudanca de programacao (tipo, dias, semanas, grupo) nunca e feita aqui: gera nova versao em tarefas_regras "a partir de" uma data. ativo=false so esconde a tarefa do cadastro/matriz futura -- quem para a geracao e a versao de regra sem_programacao gravada por inativar_tarefa. Exclusao fisica so se NUNCA teve ocorrencia (FK restrict de tarefas_ocorrencias).';

-- ------------------------------------------------------------
-- 2.4 tarefas_regras -- programacao versionada por vigencia.
-- ------------------------------------------------------------
create table if not exists public.tarefas_regras (
  id             uuid primary key default gen_random_uuid(),
  tarefa_id      uuid not null references public.tarefas(id) on delete cascade,
  vigente_desde  date not null,
  tipo           text not null,
  dias_semana    smallint[],
  semanas_do_mes smallint[],
  grupo_id       uuid references public.tarefas_grupos(id) on delete restrict,
  deslocamento   smallint not null default 0,

  criado_por     uuid references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em  timestamptz,

  constraint tarefas_regras_tarefa_vigencia_unica unique (tarefa_id, vigente_desde),
  constraint tarefas_regras_tipo_valido
    check (tipo in ('diaria', 'dias_semana', 'semanas_do_mes', 'sem_programacao')),
  constraint tarefas_regras_dias_validos
    check (dias_semana is null or (
      cardinality(dias_semana) between 1 and 7
      and array_position(dias_semana, null) is null
      and dias_semana <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
    )),
  constraint tarefas_regras_semanas_validas
    check (semanas_do_mes is null or (
      cardinality(semanas_do_mes) between 1 and 5
      and array_position(semanas_do_mes, null) is null
      and semanas_do_mes <@ array[1, 2, 3, 4, 5]::smallint[]
    )),
  constraint tarefas_regras_coerencia
    check (
      (tipo = 'diaria' and dias_semana is null and semanas_do_mes is null)
      or (tipo = 'dias_semana' and dias_semana is not null and semanas_do_mes is null)
      or (tipo = 'semanas_do_mes' and dias_semana is not null and semanas_do_mes is not null)
      or (tipo = 'sem_programacao' and dias_semana is null and semanas_do_mes is null and grupo_id is null)
    ),
  constraint tarefas_regras_deslocamento_valido
    check (deslocamento between 0 and 2)
);

create index if not exists tarefas_regras_grupo_idx
  on public.tarefas_regras (grupo_id) where grupo_id is not null;

comment on table public.tarefas_regras is
  'Programacao VERSIONADA de uma tarefa (0061). Regra vigente numa data = linha com o maior vigente_desde <= data. Versoes com vigente_desde < hoje sao imutaveis (trigger). Uma alteracao "a partir de D" (D >= hoje) grava/atualiza a versao de D e sincroniza so ocorrencias futuras intocadas. grupo_id tambem e versionado aqui (entrar/sair de um grupo e mudanca de programacao). deslocamento e ignorado quando grupo_id nao e nulo (vale o do grupo).';

-- ------------------------------------------------------------
-- 2.5 tarefas_posicoes_nomes -- identificacao opcional de F1/F2/F3.
-- ------------------------------------------------------------
create table if not exists public.tarefas_posicoes_nomes (
  id             uuid primary key default gen_random_uuid(),
  posicao        smallint not null,
  vigente_desde  date not null,
  nome           text,

  criado_por     uuid references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em  timestamptz,

  constraint tarefas_posicoes_nomes_posicao_valida check (posicao between 1 and 3),
  constraint tarefas_posicoes_nomes_posicao_vigencia_unica unique (posicao, vigente_desde),
  constraint tarefas_posicoes_nomes_nome_valido
    check (nome is null or (nome = btrim(nome) and nome <> '' and char_length(nome) <= 60))
);

comment on table public.tarefas_posicoes_nomes is
  'Nome livre de F1/F2/F3 com vigencia (0061) -- SEM vinculo com funcionarios. nome NULL = sem identificacao (interface mostra F1/F2/F3). E so a FONTE usada ao materializar: a ocorrencia guarda o nome em responsavel_nome, entao o historico nunca depende desta tabela. Vigencias novas so a partir de hoje (definir_nome_posicao_tarefas).';

-- ------------------------------------------------------------
-- 2.6 tarefas_meses -- meses explicitamente programados.
-- ------------------------------------------------------------
create table if not exists public.tarefas_meses (
  mes              date primary key,
  programado_por   uuid references auth.users(id) on delete set null,
  programado_em    timestamptz not null default now(),
  sincronizado_por uuid references auth.users(id) on delete set null,
  sincronizado_em  timestamptz,

  constraint tarefas_meses_primeiro_dia check (mes = date_trunc('month', mes)::date)
);

comment on table public.tarefas_meses is
  'Meses programados de Tarefas (0061). Linha existe = mes materializado ao menos uma vez por programar_mes_tarefas (distingue "mes nao programado" de "mes sem tarefas"). Mudancas de regra/nome so sincronizam meses presentes aqui -- nunca programam um mes novo implicitamente.';

-- ------------------------------------------------------------
-- 2.7 tarefas_ocorrencias -- fotografia materializada.
-- ------------------------------------------------------------
create table if not exists public.tarefas_ocorrencias (
  id                  uuid primary key default gen_random_uuid(),
  tarefa_id           uuid not null references public.tarefas(id) on delete restrict,
  data                date not null,
  origem              text not null,
  regra_id            uuid references public.tarefas_regras(id) on delete restrict,

  posicao_programada  smallint not null,
  posicao             smallint not null,
  responsavel_nome    text,
  responsavel_avulso  text,

  ajustado_por        uuid references auth.users(id) on delete set null,
  ajustado_em         timestamptz,

  cancelada           boolean not null default false,
  cancelado_motivo    text,
  cancelado_por       uuid references auth.users(id) on delete set null,
  cancelado_em        timestamptz,

  concluida           boolean not null default false,
  concluido_por       uuid references auth.users(id) on delete set null,
  concluido_em        timestamptz,

  criado_por          uuid references auth.users(id) on delete set null,
  criado_em           timestamptz not null default now(),
  atualizado_por      uuid references auth.users(id) on delete set null,
  atualizado_em       timestamptz,

  constraint tarefas_ocorrencias_tarefa_data_unica unique (tarefa_id, data),
  constraint tarefas_ocorrencias_origem_valida check (origem in ('programada', 'avulsa')),
  constraint tarefas_ocorrencias_origem_regra_coerente
    check ((origem = 'programada') = (regra_id is not null)),
  constraint tarefas_ocorrencias_posicoes_validas
    check (posicao_programada between 1 and 3 and posicao between 1 and 3),
  constraint tarefas_ocorrencias_responsavel_nome_valido
    check (responsavel_nome is null or (responsavel_nome = btrim(responsavel_nome) and responsavel_nome <> '')),
  constraint tarefas_ocorrencias_responsavel_avulso_valido
    check (responsavel_avulso is null or (responsavel_avulso = btrim(responsavel_avulso) and responsavel_avulso <> '' and char_length(responsavel_avulso) <= 60)),
  constraint tarefas_ocorrencias_ajuste_coerente
    check (ajustado_por is null or ajustado_em is not null),
  constraint tarefas_ocorrencias_cancelamento_coerente
    check (
      cancelada = (cancelado_em is not null)
      and cancelada = (cancelado_motivo is not null)
      and (cancelado_por is null or cancelada)
      and (cancelado_motivo is null or btrim(cancelado_motivo) <> '')
    ),
  constraint tarefas_ocorrencias_conclusao_coerente
    check (concluida = (concluido_em is not null) and (concluido_por is null or concluida)),
  constraint tarefas_ocorrencias_cancelada_nao_concluida
    check (not (cancelada and concluida))
);

create index if not exists tarefas_ocorrencias_data_idx
  on public.tarefas_ocorrencias (data);

create index if not exists tarefas_ocorrencias_regra_idx
  on public.tarefas_ocorrencias (regra_id) where regra_id is not null;

comment on table public.tarefas_ocorrencias is
  'Ocorrencia MATERIALIZADA de uma tarefa numa data (0061) -- a fotografia que o calendario exibe. Nunca recalculada na leitura. Exibicao do responsavel = coalesce(responsavel_avulso, responsavel_nome, ''F'' || posicao). Intocada (pode ser sincronizada automaticamente, so em datas >= hoje) = origem programada, nao concluida, nao cancelada, ajustado_em nulo. Sem policy de escrita: tudo via RPC.';

comment on column public.tarefas_ocorrencias.posicao_programada is
  'Posicao calculada pelo motor no momento da materializacao (ou escolhida na criacao da avulsa). Imutavel -- preservada para comparacao/rastreabilidade mesmo depois de ajustes.';
comment on column public.tarefas_ocorrencias.responsavel_nome is
  'Nome da posicao EFETIVA vigente NAQUELA data, materializado (tarefas_posicoes_nomes) -- NULL = sem identificacao (exibe F1/F2/F3). Atualizado automaticamente so em ocorrencias intocadas >= hoje.';
comment on column public.tarefas_ocorrencias.responsavel_avulso is
  'Nome livre digitado SOMENTE para esta ocorrencia (ex.: freelancer do dia). Prevalece sobre responsavel_nome na exibicao.';

-- ============================================================
-- 3. Triggers de autoria e protecao
-- ============================================================
create or replace function public.tarefas_auditoria()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.atualizado_por := null;
    new.atualizado_em := null;
  else
    new.criado_por := old.criado_por;
    new.criado_em := old.criado_em;
    new.atualizado_por := auth.uid();
    new.atualizado_em := now();
  end if;
  return new;
end;
$$;

comment on function public.tarefas_auditoria() is
  'BEFORE INSERT/UPDATE comum as tabelas de Tarefas (0061): INSERT forca criado_por=auth.uid()/criado_em=now() e zera atualizado_*; UPDATE preserva criado_* e forca atualizado_por=auth.uid()/atualizado_em=now(). Nunca confia em valores enviados pelo cliente.';

drop trigger if exists tarefas_grupos_auditoria_trigger on public.tarefas_grupos;
create trigger tarefas_grupos_auditoria_trigger
  before insert or update on public.tarefas_grupos
  for each row execute function public.tarefas_auditoria();

drop trigger if exists tarefas_auditoria_trigger on public.tarefas;
create trigger tarefas_auditoria_trigger
  before insert or update on public.tarefas
  for each row execute function public.tarefas_auditoria();

drop trigger if exists tarefas_regras_auditoria_trigger on public.tarefas_regras;
create trigger tarefas_regras_auditoria_trigger
  before insert or update on public.tarefas_regras
  for each row execute function public.tarefas_auditoria();

drop trigger if exists tarefas_posicoes_nomes_auditoria_trigger on public.tarefas_posicoes_nomes;
create trigger tarefas_posicoes_nomes_auditoria_trigger
  before insert or update on public.tarefas_posicoes_nomes
  for each row execute function public.tarefas_auditoria();

drop trigger if exists tarefas_ocorrencias_auditoria_trigger on public.tarefas_ocorrencias;
create trigger tarefas_ocorrencias_auditoria_trigger
  before insert or update on public.tarefas_ocorrencias
  for each row execute function public.tarefas_auditoria();

-- Versoes de regra ja vigentes antes de hoje sao historia: imutaveis.
create or replace function public.tarefas_regras_protecao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tarefa_id is distinct from old.tarefa_id or new.vigente_desde is distinct from old.vigente_desde then
    raise exception 'tarefas_regras: tarefa_id e vigente_desde sao imutaveis.';
  end if;
  if old.vigente_desde < public.tarefas_hoje() then
    raise exception 'tarefas_regras: a versao vigente desde % ja esta em vigor e nao pode ser alterada. Registre uma nova versao a partir de hoje.', old.vigente_desde;
  end if;
  return new;
end;
$$;

drop trigger if exists tarefas_regras_protecao_trigger on public.tarefas_regras;
create trigger tarefas_regras_protecao_trigger
  before update on public.tarefas_regras
  for each row execute function public.tarefas_regras_protecao();

-- Identidade da ocorrencia e imutavel.
create or replace function public.tarefas_ocorrencias_protecao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tarefa_id is distinct from old.tarefa_id
     or new.data is distinct from old.data
     or new.origem is distinct from old.origem
     or new.posicao_programada is distinct from old.posicao_programada then
    raise exception 'tarefas_ocorrencias: tarefa_id, data, origem e posicao_programada sao imutaveis.';
  end if;
  return new;
end;
$$;

drop trigger if exists tarefas_ocorrencias_protecao_trigger on public.tarefas_ocorrencias;
create trigger tarefas_ocorrencias_protecao_trigger
  before update on public.tarefas_ocorrencias
  for each row execute function public.tarefas_ocorrencias_protecao();

-- Rotacao de um grupo e imutavel (mudaria a posicao de todas as tarefas).
create or replace function public.tarefas_grupos_protecao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.rotacao is distinct from old.rotacao or new.deslocamento is distinct from old.deslocamento then
    raise exception 'tarefas_grupos: rotacao e deslocamento de um grupo sao imutaveis.';
  end if;
  return new;
end;
$$;

drop trigger if exists tarefas_grupos_protecao_trigger on public.tarefas_grupos;
create trigger tarefas_grupos_protecao_trigger
  before update on public.tarefas_grupos
  for each row execute function public.tarefas_grupos_protecao();

revoke execute on function public.tarefas_auditoria() from public;
revoke execute on function public.tarefas_regras_protecao() from public;
revoke execute on function public.tarefas_ocorrencias_protecao() from public;
revoke execute on function public.tarefas_grupos_protecao() from public;

-- ============================================================
-- 4. Funcoes internas do motor (nao expostas ao cliente)
-- ============================================================

-- Ocorrencias que as regras GERARIAM no intervalo. Os parametros p_h_*
-- descrevem UMA versao de regra HIPOTETICA (usada so pela previa): ela
-- substitui, em memoria, a versao real da mesma tarefa/data (mesma
-- semantica do upsert que a execucao faria) e, se a tarefa ainda nao
-- existe (tarefa nova), entra como tarefa virtual. Nada e gravado.
create or replace function public.tarefas_ocorrencias_esperadas(
  p_inicio          date,
  p_fim             date,
  p_h_tarefa_id     uuid     default null,
  p_h_vigente_desde date     default null,
  p_h_tipo          text     default null,
  p_h_dias          smallint[] default null,
  p_h_semanas       smallint[] default null,
  p_h_grupo_id      uuid     default null,
  p_h_deslocamento  smallint default null
)
returns table (e_tarefa_id uuid, e_data date, e_regra_id uuid, e_posicao smallint)
language sql
stable
set search_path = ''
as $$
  with regras_efetivas as (
    select r.tarefa_id, r.vigente_desde, r.id as regra_id, r.tipo, r.dias_semana,
           r.semanas_do_mes, r.grupo_id, r.deslocamento
    from public.tarefas_regras as r
    where not (p_h_tarefa_id is not null
               and r.tarefa_id = p_h_tarefa_id
               and r.vigente_desde = p_h_vigente_desde)
    union all
    select p_h_tarefa_id, p_h_vigente_desde, null::uuid, p_h_tipo, p_h_dias,
           p_h_semanas, p_h_grupo_id, coalesce(p_h_deslocamento, 0::smallint)
    where p_h_tarefa_id is not null
  ),
  tarefas_efetivas as (
    select t.id as tarefa_id from public.tarefas as t
    union
    select p_h_tarefa_id where p_h_tarefa_id is not null
  ),
  dias as (
    select gs::date as data
    from generate_series(p_inicio::timestamp, p_fim::timestamp, interval '1 day') as gs
  ),
  vigentes as (
    select te.tarefa_id, d.data, r.regra_id, r.tipo, r.dias_semana, r.semanas_do_mes, r.grupo_id, r.deslocamento
    from dias as d
    cross join tarefas_efetivas as te
    join lateral (
      select re.regra_id, re.tipo, re.dias_semana, re.semanas_do_mes, re.grupo_id, re.deslocamento
      from regras_efetivas as re
      where re.tarefa_id = te.tarefa_id
        and re.vigente_desde <= d.data
      order by re.vigente_desde desc
      limit 1
    ) as r on true
  )
  select
    v.tarefa_id,
    v.data,
    v.regra_id,
    public.tarefas_posicao_calculada(
      v.data,
      coalesce(g.rotacao, case when v.tipo = 'diaria' then 'diaria' else 'semanal' end),
      coalesce(g.deslocamento, v.deslocamento)
    )
  from vigentes as v
  left join public.tarefas_grupos as g on g.id = v.grupo_id
  where public.tarefas_regra_ocorre(v.tipo, v.dias_semana, v.semanas_do_mes, v.data)
$$;

comment on function public.tarefas_ocorrencias_esperadas(date, date, uuid, date, text, smallint[], smallint[], uuid, smallint) is
  'Conjunto de ocorrencias que as regras gerariam em [p_inicio, p_fim] (0061). Somente leitura. p_h_* = versao de regra hipotetica em memoria (previa), com a mesma semantica do upsert real. Colunas com prefixo e_.';

-- Nome vigente de uma posicao numa data (NULL = sem identificacao).
-- p_h_* = vigencia hipotetica em memoria (previa de definir_nome_posicao
-- _tarefas), com a mesma semantica do upsert real. p_h_posicao nulo = sem
-- hipotese; p_h_nome nulo com p_h_posicao preenchido = "sem nome".
create or replace function public.tarefas_nome_posicao(
  p_posicao  smallint,
  p_data     date,
  p_h_posicao smallint default null,
  p_h_desde   date     default null,
  p_h_nome    text     default null
)
returns text
language sql
stable
set search_path = ''
as $$
  select n.nome
  from (
    select v.posicao, v.vigente_desde, v.nome
    from public.tarefas_posicoes_nomes as v
    where not (p_h_posicao is not null
               and v.posicao = p_h_posicao
               and v.vigente_desde = p_h_desde)
    union all
    select p_h_posicao, p_h_desde, p_h_nome
    where p_h_posicao is not null
  ) as n
  where n.posicao = p_posicao
    and n.vigente_desde <= p_data
  order by n.vigente_desde desc
  limit 1
$$;

-- PLANO de sincronizacao de UM intervalo -- SOMENTE LEITURA. Compartilhado
-- pela previa (que so resume o plano) e pela execucao (que aplica o
-- plano com tarefas_aplicar_plano). Acoes:
--   remover   -> ocorrencia intocada que as regras nao geram mais
--                (ou geram em outra posicao);
--   religar   -> intocada mantida, mas agora gerada por outra versao de
--                regra (so rastreabilidade: regra_id);
--   renomear  -> intocada mantida cujo nome materializado difere do nome
--                vigente da posicao naquela data;
--   criar     -> ocorrencia esperada sem nenhuma ocorrencia (tarefa, data)
--                que permaneca;
--   preservar -> concluida/cancelada/ajustada/avulsa: nunca tocada.
-- Intocada = origem programada, nao concluida, nao cancelada, ajustado_em
-- nulo. Quem chama garante o intervalo permitido (>= hoje, exceto a
-- primeira programacao do mes). Colunas com prefixo plano_.
create or replace function public.tarefas_plano_sincronizacao(
  p_inicio          date,
  p_fim             date,
  p_h_tarefa_id     uuid     default null,
  p_h_vigente_desde date     default null,
  p_h_tipo          text     default null,
  p_h_dias          smallint[] default null,
  p_h_semanas       smallint[] default null,
  p_h_grupo_id      uuid     default null,
  p_h_deslocamento  smallint default null,
  p_h_posicao       smallint default null,
  p_h_nome_desde    date     default null,
  p_h_nome          text     default null
)
returns table (
  plano_acao          text,
  plano_ocorrencia_id uuid,
  plano_tarefa_id     uuid,
  plano_data          date,
  plano_regra_id      uuid,
  plano_posicao       smallint,
  plano_nome          text
)
language sql
stable
set search_path = ''
as $$
  with esperadas as materialized (
    select e.e_tarefa_id, e.e_data, e.e_regra_id, e.e_posicao
    from public.tarefas_ocorrencias_esperadas(
      p_inicio, p_fim, p_h_tarefa_id, p_h_vigente_desde, p_h_tipo,
      p_h_dias, p_h_semanas, p_h_grupo_id, p_h_deslocamento
    ) as e
  ),
  existentes as materialized (
    select
      o.id, o.tarefa_id, o.data, o.regra_id, o.posicao, o.posicao_programada, o.responsavel_nome,
      (o.origem = 'programada' and not o.concluida and not o.cancelada and o.ajustado_em is null) as intocada
    from public.tarefas_ocorrencias as o
    where o.data between p_inicio and p_fim
  ),
  classificadas as materialized (
    select
      x.id, x.tarefa_id, x.data, x.regra_id, x.posicao, x.responsavel_nome, x.intocada,
      e.e_regra_id,
      (e.e_tarefa_id is not null) as mantida,
      public.tarefas_nome_posicao(x.posicao, x.data, p_h_posicao, p_h_nome_desde, p_h_nome) as nome_vigente
    from existentes as x
    left join esperadas as e
      on e.e_tarefa_id = x.tarefa_id
     and e.e_data = x.data
     and e.e_posicao = x.posicao_programada
  )
  select 'remover'::text, c.id, c.tarefa_id, c.data, c.regra_id, c.posicao, c.responsavel_nome
  from classificadas as c
  where c.intocada and not c.mantida

  union all
  select 'religar'::text, c.id, c.tarefa_id, c.data, c.e_regra_id, c.posicao, c.responsavel_nome
  from classificadas as c
  where c.intocada and c.mantida and c.regra_id is distinct from c.e_regra_id

  union all
  select 'renomear'::text, c.id, c.tarefa_id, c.data, c.regra_id, c.posicao, c.nome_vigente
  from classificadas as c
  where c.intocada and c.mantida and c.responsavel_nome is distinct from c.nome_vigente

  union all
  select 'criar'::text, null::uuid, e.e_tarefa_id, e.e_data, e.e_regra_id, e.e_posicao,
         public.tarefas_nome_posicao(e.e_posicao, e.e_data, p_h_posicao, p_h_nome_desde, p_h_nome)
  from esperadas as e
  where not exists (
    select 1 from classificadas as c
    where c.tarefa_id = e.e_tarefa_id
      and c.data = e.e_data
      and not (c.intocada and not c.mantida)
  )

  union all
  select 'preservar'::text, c.id, c.tarefa_id, c.data, c.regra_id, c.posicao, c.responsavel_nome
  from classificadas as c
  where not c.intocada
$$;

comment on function public.tarefas_plano_sincronizacao(date, date, uuid, date, text, smallint[], smallint[], uuid, smallint, smallint, date, text) is
  'PLANO (somente leitura) de sincronizacao de um intervalo (0061): remover/religar/renomear/criar/preservar. Unica fonte de calculo da previa e da execucao -- a previa so resume o plano (sem nenhuma escrita), a execucao aplica o mesmo plano (tarefas_aplicar_plano). p_h_* = regra/nome hipoteticos em memoria para a previa.';

-- Plano de todos os meses JA PROGRAMADOS de p_data em diante (nunca
-- inclui mes nao programado). Somente leitura.
create or replace function public.tarefas_plano_a_partir_de(
  p_data            date,
  p_h_tarefa_id     uuid     default null,
  p_h_vigente_desde date     default null,
  p_h_tipo          text     default null,
  p_h_dias          smallint[] default null,
  p_h_semanas       smallint[] default null,
  p_h_grupo_id      uuid     default null,
  p_h_deslocamento  smallint default null,
  p_h_posicao       smallint default null,
  p_h_nome_desde    date     default null,
  p_h_nome          text     default null
)
returns table (
  plano_acao          text,
  plano_ocorrencia_id uuid,
  plano_tarefa_id     uuid,
  plano_data          date,
  plano_regra_id      uuid,
  plano_posicao       smallint,
  plano_nome          text
)
language sql
stable
set search_path = ''
as $$
  select pl.plano_acao, pl.plano_ocorrencia_id, pl.plano_tarefa_id, pl.plano_data,
         pl.plano_regra_id, pl.plano_posicao, pl.plano_nome
  from public.tarefas_meses as m
  cross join lateral public.tarefas_plano_sincronizacao(
    greatest(p_data, m.mes),
    (m.mes + interval '1 month' - interval '1 day')::date,
    p_h_tarefa_id, p_h_vigente_desde, p_h_tipo, p_h_dias, p_h_semanas,
    p_h_grupo_id, p_h_deslocamento, p_h_posicao, p_h_nome_desde, p_h_nome
  ) as pl
  where (m.mes + interval '1 month' - interval '1 day')::date >= p_data
$$;

-- Resumo (contagens) de um plano serializado em jsonb -- o que a previa
-- devolve. Somente leitura.
create or replace function public.tarefas_resumir_plano(p_plano jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'criadas',           count(*) filter (where x.plano_acao = 'criar'),
    'removidas',         count(*) filter (where x.plano_acao = 'remover'),
    'nomes_atualizados', count(*) filter (where x.plano_acao = 'renomear'),
    'regras_religadas',  count(*) filter (where x.plano_acao = 'religar'),
    'preservadas',       count(*) filter (where x.plano_acao = 'preservar')
  )
  from jsonb_to_recordset(coalesce(p_plano, '[]'::jsonb)) as x(plano_acao text)
$$;

-- APLICA um plano (unico ponto de escrita da sincronizacao). Cada escrita
-- reconfirma a condicao "intocada" na propria linha -- se uma conclusao/
-- ajuste/cancelamento concorrente chegou entre o calculo e a aplicacao, a
-- linha simplesmente nao e tocada. Devolve as contagens EFETIVAS.
create or replace function public.tarefas_aplicar_plano(p_plano jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_removidas   integer := 0;
  v_religadas   integer := 0;
  v_renomeadas  integer := 0;
  v_criadas     integer := 0;
begin
  delete from public.tarefas_ocorrencias as o
  using jsonb_to_recordset(coalesce(p_plano, '[]'::jsonb)) as x(plano_acao text, plano_ocorrencia_id uuid)
  where x.plano_acao = 'remover'
    and o.id = x.plano_ocorrencia_id
    and o.origem = 'programada'
    and not o.concluida
    and not o.cancelada
    and o.ajustado_em is null;
  get diagnostics v_removidas = row_count;

  update public.tarefas_ocorrencias as o
     set regra_id = x.plano_regra_id
    from jsonb_to_recordset(coalesce(p_plano, '[]'::jsonb)) as x(plano_acao text, plano_ocorrencia_id uuid, plano_regra_id uuid)
   where x.plano_acao = 'religar'
     and o.id = x.plano_ocorrencia_id
     and o.origem = 'programada'
     and not o.concluida
     and not o.cancelada
     and o.ajustado_em is null;
  get diagnostics v_religadas = row_count;

  update public.tarefas_ocorrencias as o
     set responsavel_nome = x.plano_nome
    from jsonb_to_recordset(coalesce(p_plano, '[]'::jsonb)) as x(plano_acao text, plano_ocorrencia_id uuid, plano_nome text)
   where x.plano_acao = 'renomear'
     and o.id = x.plano_ocorrencia_id
     and o.origem = 'programada'
     and not o.concluida
     and not o.cancelada
     and o.ajustado_em is null;
  get diagnostics v_renomeadas = row_count;

  insert into public.tarefas_ocorrencias
    (tarefa_id, data, origem, regra_id, posicao_programada, posicao, responsavel_nome)
  select x.plano_tarefa_id, x.plano_data, 'programada', x.plano_regra_id, x.plano_posicao, x.plano_posicao, x.plano_nome
  from jsonb_to_recordset(coalesce(p_plano, '[]'::jsonb))
    as x(plano_acao text, plano_tarefa_id uuid, plano_data date, plano_regra_id uuid, plano_posicao smallint, plano_nome text)
  where x.plano_acao = 'criar'
  on conflict on constraint tarefas_ocorrencias_tarefa_data_unica do nothing;
  get diagnostics v_criadas = row_count;

  return jsonb_build_object(
    'criadas', v_criadas,
    'removidas', v_removidas,
    'nomes_atualizados', v_renomeadas,
    'regras_religadas', v_religadas,
    'preservadas', (
      select count(*) from jsonb_to_recordset(coalesce(p_plano, '[]'::jsonb)) as x(plano_acao text)
      where x.plano_acao = 'preservar'
    )
  );
end;
$$;

comment on function public.tarefas_aplicar_plano(jsonb) is
  'Unico ponto de ESCRITA da sincronizacao de Tarefas (0061): aplica um plano de tarefas_plano_sincronizacao/tarefas_plano_a_partir_de. Reconfirma "intocada" linha a linha (concorrencia segura) e insere com ON CONFLICT ON CONSTRAINT tarefas_ocorrencias_tarefa_data_unica DO NOTHING. Nunca chamada pela previa.';

-- Deslocamento sugerido para uma TAREFA independente: escolhe 0..2 que
-- minimiza o desequilibrio (max - min) de carga por posicao nos dias em
-- que ela ocorre, considerando as regras vigentes em p_data das demais
-- tarefas com a mesma rotacao. Empate: menor carga total, depois menor
-- deslocamento. Deterministico para o mesmo estado do cadastro.
create or replace function public.tarefas_deslocamento_sugerido(
  p_tarefa_id uuid,
  p_rotacao   text,
  p_dias      smallint[],
  p_data      date
)
returns smallint
language plpgsql
stable
set search_path = ''
as $$
declare
  v_dias        smallint[];
  v_dia         smallint;
  v_candidato   smallint;
  v_carga       integer[];
  v_custo       integer;
  v_total       integer;
  v_melhor      smallint := 0;
  v_melhor_c    integer := null;
  v_melhor_t    integer := null;
  v_slot        smallint;
begin
  v_dias := case when p_rotacao = 'diaria' then array[1]::smallint[] else coalesce(p_dias, array[1]::smallint[]) end;

  for v_candidato in 0..2 loop
    v_custo := 0;
    v_total := 0;
    foreach v_dia in array v_dias loop
      v_carga := array[0, 0, 0];
      for v_slot in
        select coalesce(g.deslocamento, r.deslocamento)
        from public.tarefas as t
        join lateral (
          select r2.tipo, r2.dias_semana, r2.grupo_id, r2.deslocamento
          from public.tarefas_regras as r2
          where r2.tarefa_id = t.id and r2.vigente_desde <= p_data
          order by r2.vigente_desde desc
          limit 1
        ) as r on true
        left join public.tarefas_grupos as g on g.id = r.grupo_id
        where t.id is distinct from p_tarefa_id
          and r.tipo <> 'sem_programacao'
          and coalesce(g.rotacao, case when r.tipo = 'diaria' then 'diaria' else 'semanal' end) = p_rotacao
          and (p_rotacao = 'diaria' or r.tipo = 'diaria' or v_dia = any(r.dias_semana))
      loop
        v_carga[v_slot + 1] := v_carga[v_slot + 1] + 1;
      end loop;
      v_total := v_total + v_carga[v_candidato + 1];
      v_carga[v_candidato + 1] := v_carga[v_candidato + 1] + 1;
      v_custo := v_custo + (greatest(v_carga[1], v_carga[2], v_carga[3]) - least(v_carga[1], v_carga[2], v_carga[3]));
    end loop;

    if v_melhor_c is null
       or v_custo < v_melhor_c
       or (v_custo = v_melhor_c and v_total < v_melhor_t) then
      v_melhor := v_candidato;
      v_melhor_c := v_custo;
      v_melhor_t := v_total;
    end if;
  end loop;

  return v_melhor;
end;
$$;

-- Deslocamento sugerido para um GRUPO novo: posicao menos carregada entre
-- as unidades da mesma rotacao (grupos contam todas as tarefas membro).
create or replace function public.tarefas_grupo_deslocamento_sugerido(p_rotacao text)
returns smallint
language sql
stable
set search_path = ''
as $$
  select s.slot::smallint
  from generate_series(0, 2) as s(slot)
  left join lateral (
    select count(*) as n
    from public.tarefas as t
    join lateral (
      select r2.tipo, r2.dias_semana, r2.grupo_id, r2.deslocamento
      from public.tarefas_regras as r2
      where r2.tarefa_id = t.id and r2.vigente_desde <= public.tarefas_hoje()
      order by r2.vigente_desde desc
      limit 1
    ) as r on true
    left join public.tarefas_grupos as g on g.id = r.grupo_id
    where r.tipo <> 'sem_programacao'
      and coalesce(g.rotacao, case when r.tipo = 'diaria' then 'diaria' else 'semanal' end) = p_rotacao
      and coalesce(g.deslocamento, r.deslocamento) = s.slot
  ) as c on true
  order by c.n, s.slot
  limit 1
$$;

-- Nenhuma funcao interna fica executavel pelo cliente.
revoke execute on function public.tarefas_hoje() from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_posicao_calculada(date, text, smallint) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_regra_ocorre(text, smallint[], smallint[], date) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_normalizar_texto(text) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_ocorrencias_esperadas(date, date, uuid, date, text, smallint[], smallint[], uuid, smallint) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_nome_posicao(smallint, date, smallint, date, text) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_plano_sincronizacao(date, date, uuid, date, text, smallint[], smallint[], uuid, smallint, smallint, date, text) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_plano_a_partir_de(date, uuid, date, text, smallint[], smallint[], uuid, smallint, smallint, date, text) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_resumir_plano(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_aplicar_plano(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_deslocamento_sugerido(uuid, text, smallint[], date) from public, anon, authenticated, service_role;
revoke execute on function public.tarefas_grupo_deslocamento_sugerido(text) from public, anon, authenticated, service_role;

-- ============================================================
-- 5. Permissoes
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('tarefas.visualizar', 'tarefas', 'visualizar', 'Ver Folha de Pagamento > Tarefas: calendario mensal, resumo do dia e cadastro de tarefas (somente leitura).'),
  ('tarefas.editar',     'tarefas', 'editar',     'Editar Tarefas: cadastro, regras de programacao, grupos, identificacao de F1/F2/F3, programar/sincronizar mes e ajustar/cancelar/criar ocorrencias. NAO inclui marcar conclusao (tarefas.concluir).'),
  ('tarefas.concluir',   'tarefas', 'concluir',   'Marcar e desmarcar a conclusao de ocorrencias de Tarefas. NAO permite alterar programacao nem cadastro.')
on conflict on constraint permissoes_pkey do nothing;

insert into public.perfil_permissoes (perfil, permissao) values
  ('proprietario_admin', 'tarefas.visualizar'),
  ('proprietario_admin', 'tarefas.editar'),
  ('proprietario_admin', 'tarefas.concluir')
on conflict on constraint perfil_permissoes_pkey do nothing;

-- ============================================================
-- 6. RLS -- leitura por tarefas.visualizar; NENHUMA policy de escrita
--    (toda escrita passa pelas RPCs SECURITY DEFINER abaixo).
-- ============================================================
alter table public.tarefas_categorias     enable row level security;
alter table public.tarefas_grupos         enable row level security;
alter table public.tarefas                enable row level security;
alter table public.tarefas_regras         enable row level security;
alter table public.tarefas_posicoes_nomes enable row level security;
alter table public.tarefas_meses          enable row level security;
alter table public.tarefas_ocorrencias    enable row level security;

drop policy if exists tarefas_categorias_select on public.tarefas_categorias;
create policy tarefas_categorias_select on public.tarefas_categorias
  for select to authenticated using ((select public.has_permissao('tarefas.visualizar')));

drop policy if exists tarefas_grupos_select on public.tarefas_grupos;
create policy tarefas_grupos_select on public.tarefas_grupos
  for select to authenticated using ((select public.has_permissao('tarefas.visualizar')));

drop policy if exists tarefas_select on public.tarefas;
create policy tarefas_select on public.tarefas
  for select to authenticated using ((select public.has_permissao('tarefas.visualizar')));

drop policy if exists tarefas_regras_select on public.tarefas_regras;
create policy tarefas_regras_select on public.tarefas_regras
  for select to authenticated using ((select public.has_permissao('tarefas.visualizar')));

drop policy if exists tarefas_posicoes_nomes_select on public.tarefas_posicoes_nomes;
create policy tarefas_posicoes_nomes_select on public.tarefas_posicoes_nomes
  for select to authenticated using ((select public.has_permissao('tarefas.visualizar')));

drop policy if exists tarefas_meses_select on public.tarefas_meses;
create policy tarefas_meses_select on public.tarefas_meses
  for select to authenticated using ((select public.has_permissao('tarefas.visualizar')));

drop policy if exists tarefas_ocorrencias_select on public.tarefas_ocorrencias;
create policy tarefas_ocorrencias_select on public.tarefas_ocorrencias
  for select to authenticated using ((select public.has_permissao('tarefas.visualizar')));

-- ============================================================
-- 7. RPCs
-- ============================================================
-- Convencoes de todas as RPCs abaixo: SECURITY DEFINER, search_path='',
-- tabelas sempre qualificadas (public.), exigem auth.uid() nao nulo e a
-- permissao adequada, variaveis v_*/parametros p_* (sem colisao com
-- colunas), ON CONFLICT sempre por constraint nomeada. Previa (p_simular)
-- = somente leitura: resume o plano calculado com a mudanca hipotetica em
-- memoria; so a execucao escreve (e so ela pega o advisory lock).

-- ------------------------------------------------------------
-- 7.1 programar_mes_tarefas
-- ------------------------------------------------------------
create or replace function public.programar_mes_tarefas(
  p_mes     date,
  p_simular boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mes        date;
  v_fim        date;
  v_hoje       date := public.tarefas_hoje();
  v_programado boolean;
  v_inicio     date;
  v_plano      jsonb;
  v_resultado  jsonb;
begin
  if auth.uid() is null then
    raise exception 'programar_mes_tarefas: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.editar')) then
    raise exception using errcode = '42501', message = 'programar_mes_tarefas: requer a permissao tarefas.editar.';
  end if;
  if p_mes is null then
    raise exception 'programar_mes_tarefas: informe o mes.';
  end if;

  v_mes := date_trunc('month', p_mes)::date;
  v_fim := (v_mes + interval '1 month' - interval '1 day')::date;

  if v_fim < v_hoje then
    raise exception 'programar_mes_tarefas: o mes % ja terminou e nao pode ser programado.', to_char(v_mes, 'MM/YYYY');
  end if;

  -- A execucao serializa com as demais execucoes ANTES de ler o estado; a
  -- previa e somente leitura e nao pega lock nenhum.
  if not coalesce(p_simular, true) then
    perform pg_advisory_xact_lock(hashtext('public.tarefas_programacao'));
  end if;

  v_programado := exists (select 1 from public.tarefas_meses as m where m.mes = v_mes);
  -- Primeira programacao: o mes inteiro (nada materializado ainda).
  -- Reprogramacao: so de hoje em diante (nunca altera o passado).
  v_inicio := case when v_programado then greatest(v_mes, v_hoje) else v_mes end;

  select coalesce(jsonb_agg(to_jsonb(pl)), '[]'::jsonb) into v_plano
  from public.tarefas_plano_sincronizacao(v_inicio, v_fim) as pl;

  if coalesce(p_simular, true) then
    v_resultado := public.tarefas_resumir_plano(v_plano);
  else
    insert into public.tarefas_meses (mes, programado_por, programado_em)
    values (v_mes, auth.uid(), now())
    on conflict on constraint tarefas_meses_pkey
    do update set sincronizado_por = auth.uid(), sincronizado_em = now();

    v_resultado := public.tarefas_aplicar_plano(v_plano);
  end if;

  v_resultado := v_resultado || jsonb_build_object(
    'total_mes',
    (select count(*) from public.tarefas_ocorrencias as o where o.data between v_mes and v_fim)
      + case when coalesce(p_simular, true)
             then (v_resultado->>'criadas')::integer - (v_resultado->>'removidas')::integer
             else 0 end
  );

  return v_resultado || jsonb_build_object(
    'mes', v_mes,
    'inicio', v_inicio,
    'fim', v_fim,
    'primeira_programacao', not v_programado,
    'simulacao', coalesce(p_simular, true)
  );
end;
$$;

comment on function public.programar_mes_tarefas(date, boolean) is
  'Materializa (ou re-sincroniza) as ocorrencias de um mes (0061). Primeira vez: mes inteiro; depois: so de hoje em diante. Nunca duplica (ON CONFLICT na constraint tarefas_ocorrencias_tarefa_data_unica), nunca toca concluida/ajustada/cancelada/avulsa. p_simular=true (padrao) devolve a previa sem gravar. Exige tarefas.editar.';

-- ------------------------------------------------------------
-- 7.2 salvar_tarefa -- cria ou edita; programacao "a partir de"
-- ------------------------------------------------------------
create or replace function public.salvar_tarefa(
  p_tarefa_id           uuid,
  p_descricao           text,
  p_categoria           text,
  p_ordem               integer,
  p_observacao          text,
  p_tipo                text,
  p_dias_semana         smallint[],
  p_semanas_do_mes      smallint[],
  p_grupo_id            uuid,
  p_aplicar_a_partir_de date,
  p_ativo               boolean default null,
  p_simular             boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje        date := public.tarefas_hoje();
  v_descricao   text := public.tarefas_normalizar_texto(p_descricao);
  v_observacao  text := public.tarefas_normalizar_texto(p_observacao);
  v_dias        smallint[];
  v_semanas     smallint[];
  v_grupo_id    uuid := p_grupo_id;
  v_tarefa      public.tarefas%rowtype;
  v_nova        boolean := p_tarefa_id is null;
  v_vigente     public.tarefas_regras%rowtype;
  v_mudou       boolean;
  v_rotacao     text;
  v_deslocamento smallint;
  v_ordem       smallint;
  v_plano       jsonb;
  v_resultado   jsonb := jsonb_build_object('criadas', 0, 'removidas', 0, 'nomes_atualizados', 0, 'regras_religadas', 0, 'preservadas', 0);
begin
  if auth.uid() is null then
    raise exception 'salvar_tarefa: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.editar')) then
    raise exception using errcode = '42501', message = 'salvar_tarefa: requer a permissao tarefas.editar.';
  end if;

  -- ---------- validacao ----------
  if v_descricao is null then
    raise exception 'salvar_tarefa: a descricao e obrigatoria.';
  end if;
  if char_length(v_descricao) > 300 then
    raise exception 'salvar_tarefa: a descricao pode ter no maximo 300 caracteres.';
  end if;
  if not exists (select 1 from public.tarefas_categorias as c where c.valor = p_categoria) then
    raise exception 'salvar_tarefa: categoria invalida.';
  end if;
  if p_tipo is null or p_tipo not in ('diaria', 'dias_semana', 'semanas_do_mes', 'sem_programacao') then
    raise exception 'salvar_tarefa: tipo de programacao invalido.';
  end if;

  select array_agg(distinct x order by x) into v_dias from unnest(p_dias_semana) as x where x is not null;
  select array_agg(distinct x order by x) into v_semanas from unnest(p_semanas_do_mes) as x where x is not null;

  if p_tipo in ('diaria', 'sem_programacao') then
    v_dias := null;
    v_semanas := null;
  elsif p_tipo = 'dias_semana' then
    v_semanas := null;
    if v_dias is null then
      raise exception 'salvar_tarefa: escolha ao menos um dia da semana.';
    end if;
  else
    if v_dias is null or v_semanas is null then
      raise exception 'salvar_tarefa: escolha o dia da semana e ao menos uma semana do mes.';
    end if;
  end if;
  if v_dias is not null and not (v_dias <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]) then
    raise exception 'salvar_tarefa: dia da semana invalido.';
  end if;
  if v_semanas is not null and not (v_semanas <@ array[1, 2, 3, 4, 5]::smallint[]) then
    raise exception 'salvar_tarefa: semana do mes invalida.';
  end if;

  if p_tipo = 'sem_programacao' then
    v_grupo_id := null;
  end if;
  if v_grupo_id is not null and not exists (select 1 from public.tarefas_grupos as g where g.id = v_grupo_id) then
    raise exception 'salvar_tarefa: grupo nao encontrado.';
  end if;

  -- So a execucao serializa/trava; a previa e somente leitura.
  if not coalesce(p_simular, true) then
    perform pg_advisory_xact_lock(hashtext('public.tarefas_programacao'));
  end if;

  if not v_nova then
    if coalesce(p_simular, true) then
      select * into v_tarefa from public.tarefas as t where t.id = p_tarefa_id;
    else
      select * into v_tarefa from public.tarefas as t where t.id = p_tarefa_id for update;
    end if;
    if v_tarefa.id is null then
      raise exception 'salvar_tarefa: tarefa nao encontrada.';
    end if;
  end if;

  if exists (
    select 1 from public.tarefas as t
    where lower(t.descricao) = lower(v_descricao)
      and t.id is distinct from p_tarefa_id
  ) then
    raise exception 'salvar_tarefa: ja existe uma tarefa com esta descricao.';
  end if;

  -- ---------- programacao mudou? ----------
  if not v_nova then
    select * into v_vigente
    from public.tarefas_regras as r
    where r.tarefa_id = p_tarefa_id
      and r.vigente_desde <= coalesce(p_aplicar_a_partir_de, v_hoje)
    order by r.vigente_desde desc
    limit 1;
  end if;

  v_mudou := v_nova
    or v_vigente.id is null
    or v_vigente.tipo is distinct from p_tipo
    or v_vigente.dias_semana is distinct from v_dias
    or v_vigente.semanas_do_mes is distinct from v_semanas
    or v_vigente.grupo_id is distinct from v_grupo_id;

  if v_mudou then
    if p_aplicar_a_partir_de is null then
      raise exception 'salvar_tarefa: informe a partir de quando a programacao vale.';
    end if;
    if p_aplicar_a_partir_de < v_hoje then
      raise exception 'salvar_tarefa: a programacao so pode mudar a partir de hoje (%).', to_char(v_hoje, 'DD/MM/YYYY');
    end if;
    if not v_nova and exists (
      select 1 from public.tarefas_regras as r
      where r.tarefa_id = p_tarefa_id and r.vigente_desde > p_aplicar_a_partir_de
    ) then
      raise exception 'salvar_tarefa: ja existe uma alteracao de programacao agendada para depois de %. Edite a partir daquela data.', to_char(p_aplicar_a_partir_de, 'DD/MM/YYYY');
    end if;

    -- Deslocamento: interno. Mantem o atual se a forma da regra nao mudou;
    -- senao sugere o mais equilibrado. Irrelevante dentro de grupo.
    v_rotacao := case when p_tipo = 'diaria' then 'diaria' else 'semanal' end;
    if v_grupo_id is not null or p_tipo = 'sem_programacao' then
      v_deslocamento := 0;
    elsif v_vigente.id is not null
          and v_vigente.grupo_id is null
          and v_vigente.tipo is not distinct from p_tipo
          and v_vigente.dias_semana is not distinct from v_dias then
      v_deslocamento := v_vigente.deslocamento;
    else
      v_deslocamento := public.tarefas_deslocamento_sugerido(p_tarefa_id, v_rotacao, v_dias, p_aplicar_a_partir_de);
    end if;
  end if;

  v_ordem := coalesce(
    p_ordem::smallint,
    v_tarefa.ordem,
    (select coalesce(max(t.ordem), 0) + 1 from public.tarefas as t where t.categoria = p_categoria)::smallint
  );

  if coalesce(p_simular, true) then
    -- PREVIA: nenhuma escrita. A versao de regra pedida entra no plano como
    -- hipotese em memoria; tarefa nova = id virtual so para o calculo.
    if v_mudou then
      select coalesce(jsonb_agg(to_jsonb(pl)), '[]'::jsonb) into v_plano
      from public.tarefas_plano_a_partir_de(
        p_aplicar_a_partir_de,
        coalesce(p_tarefa_id, gen_random_uuid()), p_aplicar_a_partir_de, p_tipo,
        v_dias, v_semanas, v_grupo_id, v_deslocamento
      ) as pl;
      v_resultado := public.tarefas_resumir_plano(v_plano);
    end if;
    v_resultado := v_resultado || jsonb_build_object('tarefa_id', p_tarefa_id);
  else
    if v_nova then
      insert into public.tarefas (descricao, categoria, ordem, observacao, ativo)
      values (v_descricao, p_categoria, v_ordem, v_observacao, coalesce(p_ativo, true))
      returning * into v_tarefa;
    else
      update public.tarefas as t
         set descricao = v_descricao,
             categoria = p_categoria,
             ordem = v_ordem,
             observacao = v_observacao,
             ativo = coalesce(p_ativo, t.ativo)
       where t.id = p_tarefa_id
      returning * into v_tarefa;
    end if;

    if v_mudou then
      insert into public.tarefas_regras
        (tarefa_id, vigente_desde, tipo, dias_semana, semanas_do_mes, grupo_id, deslocamento)
      values
        (v_tarefa.id, p_aplicar_a_partir_de, p_tipo, v_dias, v_semanas, v_grupo_id, v_deslocamento)
      on conflict on constraint tarefas_regras_tarefa_vigencia_unica
      do update set
        tipo = excluded.tipo,
        dias_semana = excluded.dias_semana,
        semanas_do_mes = excluded.semanas_do_mes,
        grupo_id = excluded.grupo_id,
        deslocamento = excluded.deslocamento;

      select coalesce(jsonb_agg(to_jsonb(pl)), '[]'::jsonb) into v_plano
      from public.tarefas_plano_a_partir_de(p_aplicar_a_partir_de) as pl;
      v_resultado := public.tarefas_aplicar_plano(v_plano);
    end if;

    v_resultado := v_resultado || jsonb_build_object('tarefa_id', v_tarefa.id);
  end if;

  return v_resultado || jsonb_build_object(
    'programacao_alterada', v_mudou,
    'aplicar_a_partir_de', case when v_mudou then p_aplicar_a_partir_de end,
    'simulacao', coalesce(p_simular, true)
  );
end;
$$;

comment on function public.salvar_tarefa(uuid, text, text, integer, text, text, smallint[], smallint[], uuid, date, boolean, boolean) is
  'Cria (p_tarefa_id nulo) ou edita uma tarefa (0061). Descricao/categoria/ordem/observacao: correcao imediata. Tipo/dias/semanas/grupo diferentes da regra vigente: nova versao em tarefas_regras a partir de p_aplicar_a_partir_de (>= hoje) + sincronizacao so de ocorrencias futuras intocadas em meses ja programados. Deslocamento escolhido internamente. p_simular=true (padrao) = previa sem gravar. Exige tarefas.editar.';

-- ------------------------------------------------------------
-- 7.3 inativar_tarefa / excluir_tarefa
-- ------------------------------------------------------------
create or replace function public.inativar_tarefa(
  p_tarefa_id   uuid,
  p_a_partir_de date,
  p_simular     boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje      date := public.tarefas_hoje();
  v_tarefa    public.tarefas%rowtype;
  v_plano     jsonb;
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'inativar_tarefa: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.editar')) then
    raise exception using errcode = '42501', message = 'inativar_tarefa: requer a permissao tarefas.editar.';
  end if;
  if p_a_partir_de is null or p_a_partir_de < v_hoje then
    raise exception 'inativar_tarefa: a inativacao so pode valer a partir de hoje (%).', to_char(v_hoje, 'DD/MM/YYYY');
  end if;

  if coalesce(p_simular, true) then
    select * into v_tarefa from public.tarefas as t where t.id = p_tarefa_id;
  else
    perform pg_advisory_xact_lock(hashtext('public.tarefas_programacao'));
    select * into v_tarefa from public.tarefas as t where t.id = p_tarefa_id for update;
  end if;
  if v_tarefa.id is null then
    raise exception 'inativar_tarefa: tarefa nao encontrada.';
  end if;
  if exists (
    select 1 from public.tarefas_regras as r
    where r.tarefa_id = p_tarefa_id and r.vigente_desde > p_a_partir_de
  ) then
    raise exception 'inativar_tarefa: ja existe uma alteracao de programacao agendada para depois de %.', to_char(p_a_partir_de, 'DD/MM/YYYY');
  end if;

  if coalesce(p_simular, true) then
    -- PREVIA: versao sem_programacao so como hipotese em memoria.
    select coalesce(jsonb_agg(to_jsonb(pl)), '[]'::jsonb) into v_plano
    from public.tarefas_plano_a_partir_de(
      p_a_partir_de,
      p_tarefa_id, p_a_partir_de, 'sem_programacao', null, null, null, 0::smallint
    ) as pl;
    v_resultado := public.tarefas_resumir_plano(v_plano);
  else
    update public.tarefas as t set ativo = false where t.id = p_tarefa_id;

    insert into public.tarefas_regras (tarefa_id, vigente_desde, tipo, dias_semana, semanas_do_mes, grupo_id, deslocamento)
    values (p_tarefa_id, p_a_partir_de, 'sem_programacao', null, null, null, 0)
    on conflict on constraint tarefas_regras_tarefa_vigencia_unica
    do update set tipo = 'sem_programacao', dias_semana = null, semanas_do_mes = null, grupo_id = null, deslocamento = 0;

    select coalesce(jsonb_agg(to_jsonb(pl)), '[]'::jsonb) into v_plano
    from public.tarefas_plano_a_partir_de(p_a_partir_de) as pl;
    v_resultado := public.tarefas_aplicar_plano(v_plano);
  end if;

  return v_resultado || jsonb_build_object('tarefa_id', p_tarefa_id, 'aplicar_a_partir_de', p_a_partir_de, 'simulacao', coalesce(p_simular, true));
end;
$$;

comment on function public.inativar_tarefa(uuid, date, boolean) is
  'Inativa uma tarefa a partir de uma data >= hoje (0061): ativo=false + versao de regra sem_programacao + remocao das ocorrencias futuras intocadas. Concluidas/ajustadas/canceladas/avulsas e todo o passado permanecem. Reativar = salvar_tarefa com p_ativo=true e uma nova regra. Exige tarefas.editar.';

create or replace function public.excluir_tarefa(p_tarefa_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'excluir_tarefa: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.editar')) then
    raise exception using errcode = '42501', message = 'excluir_tarefa: requer a permissao tarefas.editar.';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.tarefas_programacao'));

  if not exists (select 1 from public.tarefas as t where t.id = p_tarefa_id) then
    raise exception 'excluir_tarefa: tarefa nao encontrada.';
  end if;
  if exists (select 1 from public.tarefas_ocorrencias as o where o.tarefa_id = p_tarefa_id) then
    raise exception 'excluir_tarefa: esta tarefa ja tem ocorrencias no calendario e nao pode ser excluida. Inative-a.';
  end if;

  delete from public.tarefas as t where t.id = p_tarefa_id;
end;
$$;

comment on function public.excluir_tarefa(uuid) is
  'Exclusao fisica de tarefa que NUNCA teve ocorrencia (0061); regras vao junto (cascade). Com ocorrencias, recusa e orienta inativar. Exige tarefas.editar.';

-- ------------------------------------------------------------
-- 7.4 Grupos
-- ------------------------------------------------------------
create or replace function public.salvar_grupo_tarefas(
  p_grupo_id uuid,
  p_nome     text,
  p_rotacao  text,
  p_ordem    integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := public.tarefas_normalizar_texto(p_nome);
  v_id   uuid;
begin
  if auth.uid() is null then
    raise exception 'salvar_grupo_tarefas: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.editar')) then
    raise exception using errcode = '42501', message = 'salvar_grupo_tarefas: requer a permissao tarefas.editar.';
  end if;
  if v_nome is null or char_length(v_nome) > 80 then
    raise exception 'salvar_grupo_tarefas: informe um nome de ate 80 caracteres.';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.tarefas_programacao'));

  if exists (select 1 from public.tarefas_grupos as g where lower(g.nome) = lower(v_nome) and g.id is distinct from p_grupo_id) then
    raise exception 'salvar_grupo_tarefas: ja existe um grupo com este nome.';
  end if;

  if p_grupo_id is null then
    if p_rotacao is null or p_rotacao not in ('diaria', 'semanal') then
      raise exception 'salvar_grupo_tarefas: rotacao invalida (diaria ou semanal).';
    end if;
    insert into public.tarefas_grupos (nome, rotacao, deslocamento, ordem)
    values (
      v_nome,
      p_rotacao,
      public.tarefas_grupo_deslocamento_sugerido(p_rotacao),
      coalesce(p_ordem, (select coalesce(max(g.ordem), 0) + 1 from public.tarefas_grupos as g))::smallint
    )
    returning id into v_id;
  else
    update public.tarefas_grupos as g
       set nome = v_nome,
           ordem = coalesce(p_ordem::smallint, g.ordem)
     where g.id = p_grupo_id
    returning g.id into v_id;
    if v_id is null then
      raise exception 'salvar_grupo_tarefas: grupo nao encontrado.';
    end if;
  end if;

  return v_id;
end;
$$;

comment on function public.salvar_grupo_tarefas(uuid, text, text, integer) is
  'Cria (rotacao diaria/semanal, deslocamento escolhido internamente) ou renomeia/reordena um grupo de distribuicao (0061). Rotacao e deslocamento sao imutaveis apos criado. Exige tarefas.editar.';

create or replace function public.excluir_grupo_tarefas(p_grupo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'excluir_grupo_tarefas: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.editar')) then
    raise exception using errcode = '42501', message = 'excluir_grupo_tarefas: requer a permissao tarefas.editar.';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.tarefas_programacao'));

  if exists (select 1 from public.tarefas_regras as r where r.grupo_id = p_grupo_id) then
    raise exception 'excluir_grupo_tarefas: este grupo ja foi usado em alguma programacao e nao pode ser excluido.';
  end if;
  delete from public.tarefas_grupos as g where g.id = p_grupo_id;
end;
$$;

-- ------------------------------------------------------------
-- 7.5 Identificacao de F1/F2/F3
-- ------------------------------------------------------------
create or replace function public.definir_nome_posicao_tarefas(
  p_posicao     smallint,
  p_nome        text,
  p_a_partir_de date,
  p_simular     boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje      date := public.tarefas_hoje();
  v_nome      text := public.tarefas_normalizar_texto(p_nome);
  v_plano     jsonb;
  v_resultado jsonb;
begin
  if auth.uid() is null then
    raise exception 'definir_nome_posicao_tarefas: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.editar')) then
    raise exception using errcode = '42501', message = 'definir_nome_posicao_tarefas: requer a permissao tarefas.editar.';
  end if;
  if p_posicao is null or p_posicao not between 1 and 3 then
    raise exception 'definir_nome_posicao_tarefas: posicao invalida (1, 2 ou 3).';
  end if;
  if v_nome is not null and char_length(v_nome) > 60 then
    raise exception 'definir_nome_posicao_tarefas: o nome pode ter no maximo 60 caracteres.';
  end if;
  if p_a_partir_de is null or p_a_partir_de < v_hoje then
    raise exception 'definir_nome_posicao_tarefas: a identificacao so pode valer a partir de hoje (%).', to_char(v_hoje, 'DD/MM/YYYY');
  end if;

  if coalesce(p_simular, true) then
    -- PREVIA: a nova vigencia entra so como hipotese em memoria.
    select coalesce(jsonb_agg(to_jsonb(pl)), '[]'::jsonb) into v_plano
    from public.tarefas_plano_a_partir_de(
      p_a_partir_de,
      null, null, null, null, null, null, null,
      p_posicao, p_a_partir_de, v_nome
    ) as pl;
    v_resultado := public.tarefas_resumir_plano(v_plano);
  else
    perform pg_advisory_xact_lock(hashtext('public.tarefas_programacao'));

    insert into public.tarefas_posicoes_nomes (posicao, vigente_desde, nome)
    values (p_posicao, p_a_partir_de, v_nome)
    on conflict on constraint tarefas_posicoes_nomes_posicao_vigencia_unica
    do update set nome = excluded.nome;

    select coalesce(jsonb_agg(to_jsonb(pl)), '[]'::jsonb) into v_plano
    from public.tarefas_plano_a_partir_de(p_a_partir_de) as pl;
    v_resultado := public.tarefas_aplicar_plano(v_plano);
  end if;

  return v_resultado || jsonb_build_object('posicao', p_posicao, 'nome', v_nome, 'aplicar_a_partir_de', p_a_partir_de, 'simulacao', coalesce(p_simular, true));
end;
$$;

comment on function public.definir_nome_posicao_tarefas(smallint, text, date, boolean) is
  'Registra o nome livre (ou nenhum) de F1/F2/F3 a partir de uma data >= hoje (0061) e materializa o nome nas ocorrencias futuras intocadas dos meses ja programados. O passado e as ocorrencias concluidas/ajustadas/canceladas/avulsas mantem o nome gravado. Exige tarefas.editar.';

-- ------------------------------------------------------------
-- 7.6 Ocorrencia: ajuste de responsavel / desfazer ajuste
-- ------------------------------------------------------------
create or replace function public.ajustar_ocorrencia_tarefa(
  p_ocorrencia_id      uuid,
  p_posicao            smallint,
  p_responsavel_avulso text default null
)
returns public.tarefas_ocorrencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ocorrencia public.tarefas_ocorrencias%rowtype;
  v_avulso     text := public.tarefas_normalizar_texto(p_responsavel_avulso);
begin
  if auth.uid() is null then
    raise exception 'ajustar_ocorrencia_tarefa: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.editar')) then
    raise exception using errcode = '42501', message = 'ajustar_ocorrencia_tarefa: requer a permissao tarefas.editar.';
  end if;
  if p_posicao is null or p_posicao not between 1 and 3 then
    raise exception 'ajustar_ocorrencia_tarefa: posicao invalida (1, 2 ou 3).';
  end if;
  if v_avulso is not null and char_length(v_avulso) > 60 then
    raise exception 'ajustar_ocorrencia_tarefa: o nome do responsavel pode ter no maximo 60 caracteres.';
  end if;

  select * into v_ocorrencia from public.tarefas_ocorrencias as o where o.id = p_ocorrencia_id for update;
  if v_ocorrencia.id is null then
    raise exception 'ajustar_ocorrencia_tarefa: ocorrencia nao encontrada.';
  end if;
  if v_ocorrencia.cancelada then
    raise exception 'ajustar_ocorrencia_tarefa: ocorrencia cancelada -- restaure-a antes de ajustar.';
  end if;

  update public.tarefas_ocorrencias as o
     set posicao = p_posicao,
         responsavel_avulso = v_avulso,
         responsavel_nome = public.tarefas_nome_posicao(p_posicao, o.data),
         ajustado_por = auth.uid(),
         ajustado_em = now()
   where o.id = p_ocorrencia_id
  returning * into v_ocorrencia;

  return v_ocorrencia;
end;
$$;

comment on function public.ajustar_ocorrencia_tarefa(uuid, smallint, text) is
  'Ajuste pontual de UMA ocorrencia (0061): posicao efetiva e/ou responsavel avulso (nome livre). Materializa o nome vigente da nova posicao naquela data. posicao_programada preservada; marca ajustado_em/ajustado_por (a sincronizacao automatica nunca mais toca esta ocorrencia). Recusa cancelada. Exige tarefas.editar.';

create or replace function public.desfazer_ajuste_ocorrencia_tarefa(p_ocorrencia_id uuid)
returns public.tarefas_ocorrencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ocorrencia public.tarefas_ocorrencias%rowtype;
begin
  if auth.uid() is null then
    raise exception 'desfazer_ajuste_ocorrencia_tarefa: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.editar')) then
    raise exception using errcode = '42501', message = 'desfazer_ajuste_ocorrencia_tarefa: requer a permissao tarefas.editar.';
  end if;

  select * into v_ocorrencia from public.tarefas_ocorrencias as o where o.id = p_ocorrencia_id for update;
  if v_ocorrencia.id is null then
    raise exception 'desfazer_ajuste_ocorrencia_tarefa: ocorrencia nao encontrada.';
  end if;
  if v_ocorrencia.ajustado_em is null then
    return v_ocorrencia;
  end if;
  if v_ocorrencia.cancelada then
    raise exception 'desfazer_ajuste_ocorrencia_tarefa: ocorrencia cancelada -- restaure-a antes.';
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('tarefa_ocorrencia', p_ocorrencia_id::text, 'desfez_ajuste', 'responsavel',
          format('posicao=F%s; avulso=%s; ajustado_em=%s', v_ocorrencia.posicao, coalesce(v_ocorrencia.responsavel_avulso, '-'), v_ocorrencia.ajustado_em),
          format('posicao=F%s', v_ocorrencia.posicao_programada));

  update public.tarefas_ocorrencias as o
     set posicao = o.posicao_programada,
         responsavel_avulso = null,
         responsavel_nome = public.tarefas_nome_posicao(o.posicao_programada, o.data),
         ajustado_por = null,
         ajustado_em = null
   where o.id = p_ocorrencia_id
  returning * into v_ocorrencia;

  return v_ocorrencia;
end;
$$;

-- ------------------------------------------------------------
-- 7.7 Ocorrencia: cancelar / restaurar
-- ------------------------------------------------------------
create or replace function public.cancelar_ocorrencia_tarefa(p_ocorrencia_id uuid, p_motivo text)
returns public.tarefas_ocorrencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ocorrencia public.tarefas_ocorrencias%rowtype;
  v_motivo     text := public.tarefas_normalizar_texto(p_motivo);
begin
  if auth.uid() is null then
    raise exception 'cancelar_ocorrencia_tarefa: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.editar')) then
    raise exception using errcode = '42501', message = 'cancelar_ocorrencia_tarefa: requer a permissao tarefas.editar.';
  end if;
  if v_motivo is null or char_length(v_motivo) > 300 then
    raise exception 'cancelar_ocorrencia_tarefa: informe o motivo (ate 300 caracteres).';
  end if;

  select * into v_ocorrencia from public.tarefas_ocorrencias as o where o.id = p_ocorrencia_id for update;
  if v_ocorrencia.id is null then
    raise exception 'cancelar_ocorrencia_tarefa: ocorrencia nao encontrada.';
  end if;
  if v_ocorrencia.concluida then
    raise exception 'cancelar_ocorrencia_tarefa: ocorrencia concluida -- desmarque a conclusao antes de cancelar.';
  end if;
  if v_ocorrencia.cancelada then
    return v_ocorrencia;
  end if;

  update public.tarefas_ocorrencias as o
     set cancelada = true,
         cancelado_motivo = v_motivo,
         cancelado_por = auth.uid(),
         cancelado_em = now()
   where o.id = p_ocorrencia_id
  returning * into v_ocorrencia;

  return v_ocorrencia;
end;
$$;

create or replace function public.restaurar_ocorrencia_tarefa(p_ocorrencia_id uuid)
returns public.tarefas_ocorrencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ocorrencia public.tarefas_ocorrencias%rowtype;
begin
  if auth.uid() is null then
    raise exception 'restaurar_ocorrencia_tarefa: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.editar')) then
    raise exception using errcode = '42501', message = 'restaurar_ocorrencia_tarefa: requer a permissao tarefas.editar.';
  end if;

  select * into v_ocorrencia from public.tarefas_ocorrencias as o where o.id = p_ocorrencia_id for update;
  if v_ocorrencia.id is null then
    raise exception 'restaurar_ocorrencia_tarefa: ocorrencia nao encontrada.';
  end if;
  if not v_ocorrencia.cancelada then
    return v_ocorrencia;
  end if;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('tarefa_ocorrencia', p_ocorrencia_id::text, 'restaurou', 'cancelada',
          format('cancelada em %s: %s', v_ocorrencia.cancelado_em, v_ocorrencia.cancelado_motivo), 'ativa');

  update public.tarefas_ocorrencias as o
     set cancelada = false,
         cancelado_motivo = null,
         cancelado_por = null,
         cancelado_em = null
   where o.id = p_ocorrencia_id
  returning * into v_ocorrencia;

  return v_ocorrencia;
end;
$$;

-- ------------------------------------------------------------
-- 7.8 Ocorrencia avulsa: criar / excluir
-- ------------------------------------------------------------
create or replace function public.criar_ocorrencia_avulsa_tarefa(
  p_tarefa_id          uuid,
  p_data               date,
  p_posicao            smallint,
  p_responsavel_avulso text default null
)
returns public.tarefas_ocorrencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ocorrencia public.tarefas_ocorrencias%rowtype;
  v_avulso     text := public.tarefas_normalizar_texto(p_responsavel_avulso);
begin
  if auth.uid() is null then
    raise exception 'criar_ocorrencia_avulsa_tarefa: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.editar')) then
    raise exception using errcode = '42501', message = 'criar_ocorrencia_avulsa_tarefa: requer a permissao tarefas.editar.';
  end if;
  if p_data is null then
    raise exception 'criar_ocorrencia_avulsa_tarefa: informe a data.';
  end if;
  if p_posicao is null or p_posicao not between 1 and 3 then
    raise exception 'criar_ocorrencia_avulsa_tarefa: posicao invalida (1, 2 ou 3).';
  end if;
  if v_avulso is not null and char_length(v_avulso) > 60 then
    raise exception 'criar_ocorrencia_avulsa_tarefa: o nome do responsavel pode ter no maximo 60 caracteres.';
  end if;
  if not exists (select 1 from public.tarefas as t where t.id = p_tarefa_id) then
    raise exception 'criar_ocorrencia_avulsa_tarefa: tarefa nao encontrada.';
  end if;

  insert into public.tarefas_ocorrencias
    (tarefa_id, data, origem, regra_id, posicao_programada, posicao, responsavel_nome, responsavel_avulso)
  values
    (p_tarefa_id, p_data, 'avulsa', null, p_posicao, p_posicao, public.tarefas_nome_posicao(p_posicao, p_data), v_avulso)
  on conflict on constraint tarefas_ocorrencias_tarefa_data_unica do nothing
  returning * into v_ocorrencia;

  if v_ocorrencia.id is null then
    raise exception 'criar_ocorrencia_avulsa_tarefa: esta tarefa ja tem ocorrencia em %.', to_char(p_data, 'DD/MM/YYYY');
  end if;

  return v_ocorrencia;
end;
$$;

create or replace function public.excluir_ocorrencia_avulsa_tarefa(p_ocorrencia_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ocorrencia public.tarefas_ocorrencias%rowtype;
begin
  if auth.uid() is null then
    raise exception 'excluir_ocorrencia_avulsa_tarefa: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.editar')) then
    raise exception using errcode = '42501', message = 'excluir_ocorrencia_avulsa_tarefa: requer a permissao tarefas.editar.';
  end if;

  select * into v_ocorrencia from public.tarefas_ocorrencias as o where o.id = p_ocorrencia_id for update;
  if v_ocorrencia.id is null then
    return;
  end if;
  if v_ocorrencia.origem <> 'avulsa' then
    raise exception 'excluir_ocorrencia_avulsa_tarefa: so ocorrencias avulsas podem ser excluidas (programadas: use cancelar).';
  end if;
  if v_ocorrencia.concluida then
    raise exception 'excluir_ocorrencia_avulsa_tarefa: ocorrencia concluida -- desmarque a conclusao antes.';
  end if;

  delete from public.tarefas_ocorrencias as o where o.id = p_ocorrencia_id;
end;
$$;

-- ------------------------------------------------------------
-- 7.9 Conclusao (tarefas.concluir -- nunca exige/concede editar)
-- ------------------------------------------------------------
create or replace function public.marcar_conclusao_tarefa(p_ocorrencia_id uuid, p_concluida boolean)
returns public.tarefas_ocorrencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ocorrencia public.tarefas_ocorrencias%rowtype;
begin
  if auth.uid() is null then
    raise exception 'marcar_conclusao_tarefa: requer sessao autenticada.';
  end if;
  if not (select public.has_permissao('tarefas.concluir')) then
    raise exception using errcode = '42501', message = 'marcar_conclusao_tarefa: requer a permissao tarefas.concluir.';
  end if;
  if p_concluida is null then
    raise exception 'marcar_conclusao_tarefa: informe se a ocorrencia esta concluida.';
  end if;

  select * into v_ocorrencia from public.tarefas_ocorrencias as o where o.id = p_ocorrencia_id for update;
  if v_ocorrencia.id is null then
    raise exception 'marcar_conclusao_tarefa: ocorrencia nao encontrada.';
  end if;

  if p_concluida then
    if v_ocorrencia.concluida then
      return v_ocorrencia;
    end if;
    if v_ocorrencia.cancelada then
      raise exception 'marcar_conclusao_tarefa: ocorrencia cancelada nao pode ser concluida.';
    end if;
    if v_ocorrencia.data > public.tarefas_hoje() then
      raise exception 'marcar_conclusao_tarefa: nao e possivel concluir uma tarefa de data futura.';
    end if;
    update public.tarefas_ocorrencias as o
       set concluida = true,
           concluido_em = now(),
           concluido_por = auth.uid()
     where o.id = p_ocorrencia_id
    returning * into v_ocorrencia;
  else
    if not v_ocorrencia.concluida then
      return v_ocorrencia;
    end if;
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('tarefa_ocorrencia', p_ocorrencia_id::text, 'desmarcou_conclusao', 'concluida',
            format('concluida em %s por %s', v_ocorrencia.concluido_em, coalesce(v_ocorrencia.concluido_por::text, '-')), 'pendente');
    update public.tarefas_ocorrencias as o
       set concluida = false,
           concluido_em = null,
           concluido_por = null
     where o.id = p_ocorrencia_id
    returning * into v_ocorrencia;
  end if;

  return v_ocorrencia;
end;
$$;

comment on function public.marcar_conclusao_tarefa(uuid, boolean) is
  'Marca/desmarca conclusao de UMA ocorrencia (0061). Marcar: concluida=true, concluido_em=now(), concluido_por=auth.uid(); recusa cancelada e data futura. Desmarcar: limpa os 3 campos e registra o valor anterior em logs_auditoria. Idempotente. Trava a linha (FOR UPDATE). Exige SOMENTE tarefas.concluir.';

-- ------------------------------------------------------------
-- 7.10 Grants das RPCs
-- ------------------------------------------------------------
revoke execute on function public.programar_mes_tarefas(date, boolean) from public, anon, service_role;
revoke execute on function public.salvar_tarefa(uuid, text, text, integer, text, text, smallint[], smallint[], uuid, date, boolean, boolean) from public, anon, service_role;
revoke execute on function public.inativar_tarefa(uuid, date, boolean) from public, anon, service_role;
revoke execute on function public.excluir_tarefa(uuid) from public, anon, service_role;
revoke execute on function public.salvar_grupo_tarefas(uuid, text, text, integer) from public, anon, service_role;
revoke execute on function public.excluir_grupo_tarefas(uuid) from public, anon, service_role;
revoke execute on function public.definir_nome_posicao_tarefas(smallint, text, date, boolean) from public, anon, service_role;
revoke execute on function public.ajustar_ocorrencia_tarefa(uuid, smallint, text) from public, anon, service_role;
revoke execute on function public.desfazer_ajuste_ocorrencia_tarefa(uuid) from public, anon, service_role;
revoke execute on function public.cancelar_ocorrencia_tarefa(uuid, text) from public, anon, service_role;
revoke execute on function public.restaurar_ocorrencia_tarefa(uuid) from public, anon, service_role;
revoke execute on function public.criar_ocorrencia_avulsa_tarefa(uuid, date, smallint, text) from public, anon, service_role;
revoke execute on function public.excluir_ocorrencia_avulsa_tarefa(uuid) from public, anon, service_role;
revoke execute on function public.marcar_conclusao_tarefa(uuid, boolean) from public, anon, service_role;

grant execute on function public.programar_mes_tarefas(date, boolean) to authenticated;
grant execute on function public.salvar_tarefa(uuid, text, text, integer, text, text, smallint[], smallint[], uuid, date, boolean, boolean) to authenticated;
grant execute on function public.inativar_tarefa(uuid, date, boolean) to authenticated;
grant execute on function public.excluir_tarefa(uuid) to authenticated;
grant execute on function public.salvar_grupo_tarefas(uuid, text, text, integer) to authenticated;
grant execute on function public.excluir_grupo_tarefas(uuid) to authenticated;
grant execute on function public.definir_nome_posicao_tarefas(smallint, text, date, boolean) to authenticated;
grant execute on function public.ajustar_ocorrencia_tarefa(uuid, smallint, text) to authenticated;
grant execute on function public.desfazer_ajuste_ocorrencia_tarefa(uuid) to authenticated;
grant execute on function public.cancelar_ocorrencia_tarefa(uuid, text) to authenticated;
grant execute on function public.restaurar_ocorrencia_tarefa(uuid) to authenticated;
grant execute on function public.criar_ocorrencia_avulsa_tarefa(uuid, date, smallint, text) to authenticated;
grant execute on function public.excluir_ocorrencia_avulsa_tarefa(uuid) to authenticated;
grant execute on function public.marcar_conclusao_tarefa(uuid, boolean) to authenticated;

-- ============================================================
-- 8. Carga inicial (planilha Calendario_Tarefas_Padoca.xlsx, aba
--    "Calendario Matriz") -- so se public.tarefas estiver vazia.
-- ============================================================
-- Diferencas INTENCIONAIS em relacao a planilha (decisoes J1-J5):
--   * dia 31 existe normalmente (a planilha so tinha colunas 1..30);
--   * rotacao continua (ancora 2024-01-01) em vez de reiniciar no dia 1;
--   * semana = semana ISO continua, nao blocos 1-7/8-14 reiniciados;
--   * deslocamentos reequilibrados: diarias 6/6/6 por dia (Validade e
--     Itens de mesa com o Bloco 1; Reabastecer geladeiras e Bandejas com
--     o Bloco 2; Vidros externos com o Bloco 3) e semanais espalhadas
--     (Forno PQ 2->0, Dispenser 1->2, Tapetes+Lixeiras 1->2, Banheiros
--     2->1, Sacos 0->1; demais = k mod 3 da planilha);
--   * Suco de laranja: sabado e domingo com revezamento (a Matriz deixava
--     sem programacao);
--   * descricoes da Matriz (J4), com UMA correcao ortografica:
--     "refriferadores" -> "refrigeradores" (Conferir a validade...);
--   * 3 categorias da Matriz (J5).
-- Acoplamentos da planilha que eram so coincidencia de deslocamento
-- (ex.: Validade sempre com o Bloco 1) NAO viraram grupo rigido.
-- ITENS DE MESA x BLOCO 1: Itens de mesa NAO pertence a grupo nenhum
-- (grupo_id nulo na propria regra). Recebeu deslocamento 0 escolhido so
-- pelo balanceamento: os 3 blocos diarios ocupam os deslocamentos 0/1/2
-- com 4/4/5 tarefas, entao TODA tarefa diaria independente coincide, no
-- dia, com algum bloco (inevitavel com 3 posicoes). Para fechar 6/6/6
-- por dia, 2 diarias independentes vao para o deslocamento 0 (Validade,
-- Itens de mesa), 2 para o 1 (Reabastecer geladeiras, Bandejas) e 1 para
-- o 2 (Vidros externos). E coincidencia matematica: nenhuma FK/grupo liga
-- essas tarefas; mudar a regra/membros do Bloco 1 nao arrasta nenhuma
-- delas (o deslocamento do grupo e imutavel e o delas e proprio).
insert into public.tarefas_categorias (valor, ordem) values
  ('LIMPEZA', 1),
  ('ABASTECIMENTO E CONTROLE', 2),
  ('FECHAMENTO', 3)
on conflict on constraint tarefas_categorias_pkey do nothing;

do $carga$
begin
  if exists (select 1 from public.tarefas) then
    raise notice 'Carga inicial de Tarefas ignorada: public.tarefas ja tem dados.';
    return;
  end if;

  insert into public.tarefas_grupos (nome, rotacao, deslocamento, ordem)
  select v.nome, v.rotacao, v.deslocamento, v.ordem
  from (values
    ('Fechamento — Bloco 1', 'diaria',  0::smallint, 1::smallint),
    ('Fechamento — Bloco 2', 'diaria',  1::smallint, 2::smallint),
    ('Fechamento — Bloco 3', 'diaria',  2::smallint, 3::smallint),
    ('Tapetes + Lixeiras',   'semanal', 2::smallint, 4::smallint)
  ) as v(nome, rotacao, deslocamento, ordem)
  where not exists (select 1 from public.tarefas_grupos as g where lower(g.nome) = lower(v.nome));

  with dados(ordem, categoria, descricao, grupo, tipo, dias, semanas, deslocamento) as (
    values
      ( 1::smallint, 'LIMPEZA', 'Coifa', null::text, 'semanas_do_mes', '{3}'::smallint[], '{2,4}'::smallint[], 0::smallint),
      ( 2::smallint, 'LIMPEZA', 'Forno Microondas / Filtro Água', null::text, 'dias_semana', '{2}'::smallint[], null::smallint[], 1::smallint),
      ( 3::smallint, 'LIMPEZA', 'Forno Pão de Queijo', null::text, 'dias_semana', '{3}'::smallint[], null::smallint[], 0::smallint),
      ( 4::smallint, 'LIMPEZA', 'Geladeiras Produção/Atendimento - Limpeza interna', null::text, 'dias_semana', '{1}'::smallint[], null::smallint[], 0::smallint),
      ( 5::smallint, 'LIMPEZA', 'Espelhos dos Banheiros', null::text, 'dias_semana', '{2}'::smallint[], null::smallint[], 1::smallint),
      ( 6::smallint, 'LIMPEZA', 'Armários Produção (Gavetas, Trilhos)', null::text, 'dias_semana', '{3}'::smallint[], null::smallint[], 2::smallint),
      ( 7::smallint, 'LIMPEZA', 'Armários Atendimento (Gavetas, Trilhos, Portas de entrada)', null::text, 'dias_semana', '{1}'::smallint[], null::smallint[], 0::smallint),
      ( 8::smallint, 'LIMPEZA', 'Lavar dispenser de Papel/Sabonete', null::text, 'dias_semana', '{2}'::smallint[], null::smallint[], 2::smallint),
      ( 9::smallint, 'LIMPEZA', 'Suplats', null::text, 'dias_semana', '{3}'::smallint[], null::smallint[], 2::smallint),
      (10::smallint, 'LIMPEZA', 'Expositores - Vidros internos dos Balcões', null::text, 'dias_semana', '{2,5}'::smallint[], null::smallint[], 0::smallint),
      (11::smallint, 'LIMPEZA', 'Lavar Tapetes', 'Tapetes + Lixeiras', 'dias_semana', '{1,5}'::smallint[], null::smallint[], 0::smallint),
      (12::smallint, 'LIMPEZA', 'Lavar Lixeiras', 'Tapetes + Lixeiras', 'dias_semana', '{1,5}'::smallint[], null::smallint[], 0::smallint),
      (13::smallint, 'LIMPEZA', 'Expositores - Vidros externos dos Balcões e estufa', null::text, 'diaria', null::smallint[], null::smallint[], 2::smallint),
      ( 1::smallint, 'ABASTECIMENTO E CONTROLE', 'Conferir a validade de todos os produtos (etiquetas dos refrigeradores e revendas)', null::text, 'diaria', null::smallint[], null::smallint[], 0::smallint),
      ( 2::smallint, 'ABASTECIMENTO E CONTROLE', 'Reabastecer as geladeiras e itens de revenda secos.', null::text, 'diaria', null::smallint[], null::smallint[], 1::smallint),
      ( 3::smallint, 'ABASTECIMENTO E CONTROLE', 'Reabastecer os itens de mesa.', null::text, 'diaria', null::smallint[], null::smallint[], 0::smallint),
      ( 4::smallint, 'ABASTECIMENTO E CONTROLE', 'Preparar as bandejas de frios e reabastecer o expositor (3 unid)', null::text, 'diaria', null::smallint[], null::smallint[], 1::smallint),
      ( 5::smallint, 'ABASTECIMENTO E CONTROLE', 'Verificar e reabastecer os insumos dos banheiros (papel higiênico, papel-toalha e sabonete, quando necessário).', null::text, 'dias_semana', '{1,3,5}'::smallint[], null::smallint[], 1::smallint),
      ( 6::smallint, 'ABASTECIMENTO E CONTROLE', 'Reabastecer a máquina de café (se necessário).', null::text, 'dias_semana', '{1,3,5}'::smallint[], null::smallint[], 0::smallint),
      ( 7::smallint, 'ABASTECIMENTO E CONTROLE', 'Reabastecer o recipiente de detergente e álcool.', null::text, 'dias_semana', '{1,3,5}'::smallint[], null::smallint[], 1::smallint),
      ( 8::smallint, 'ABASTECIMENTO E CONTROLE', 'Repor estação de produção (manteiga, canela, choc., sal, orég...).', null::text, 'dias_semana', '{3}'::smallint[], null::smallint[], 2::smallint),
      ( 9::smallint, 'ABASTECIMENTO E CONTROLE', 'Repor os sacos para pão e embalagens de isopor.', null::text, 'dias_semana', '{1}'::smallint[], null::smallint[], 1::smallint),
      (10::smallint, 'ABASTECIMENTO E CONTROLE', 'Preparar o suco de laranja', null::text, 'dias_semana', '{6,7}'::smallint[], null::smallint[], 0::smallint),
      (11::smallint, 'ABASTECIMENTO E CONTROLE', 'Preparar / Verificar os lanches naturais', null::text, 'sem_programacao', null::smallint[], null::smallint[], 0::smallint),
      (12::smallint, 'ABASTECIMENTO E CONTROLE', 'Higienizar alface e tomate.', null::text, 'sem_programacao', null::smallint[], null::smallint[], 0::smallint),
      ( 1::smallint, 'FECHAMENTO', 'Lavar e secar toda a louça.', 'Fechamento — Bloco 1', 'diaria', null::smallint[], null::smallint[], 0::smallint),
      ( 2::smallint, 'FECHAMENTO', 'Limpeza da máquina de café e fatiador de frios', 'Fechamento — Bloco 1', 'diaria', null::smallint[], null::smallint[], 0::smallint),
      ( 3::smallint, 'FECHAMENTO', 'Esvaziar as bacias localizadas abaixo dos freezers.', 'Fechamento — Bloco 1', 'diaria', null::smallint[], null::smallint[], 0::smallint),
      ( 4::smallint, 'FECHAMENTO', 'Limpeza da chapa e bancadas.', 'Fechamento — Bloco 1', 'diaria', null::smallint[], null::smallint[], 0::smallint),
      ( 5::smallint, 'FECHAMENTO', 'Tirar e varrer tapetes.', 'Fechamento — Bloco 2', 'diaria', null::smallint[], null::smallint[], 0::smallint),
      ( 6::smallint, 'FECHAMENTO', 'Tirar todos os lixos.', 'Fechamento — Bloco 2', 'diaria', null::smallint[], null::smallint[], 0::smallint),
      ( 7::smallint, 'FECHAMENTO', 'Limpeza do chão.', 'Fechamento — Bloco 2', 'diaria', null::smallint[], null::smallint[], 0::smallint),
      ( 8::smallint, 'FECHAMENTO', 'Lavar e recolher os panos de chão.', 'Fechamento — Bloco 2', 'diaria', null::smallint[], null::smallint[], 0::smallint),
      ( 9::smallint, 'FECHAMENTO', 'Pesar as sobras (salgados, pão francês, pão de queijo, etc).', 'Fechamento — Bloco 3', 'diaria', null::smallint[], null::smallint[], 0::smallint),
      (10::smallint, 'FECHAMENTO', 'Limpeza da Estufa de Pão de Queijo', 'Fechamento — Bloco 3', 'diaria', null::smallint[], null::smallint[], 0::smallint),
      (11::smallint, 'FECHAMENTO', 'Proteger pães nos expositores com os sacos plásticos.', 'Fechamento — Bloco 3', 'diaria', null::smallint[], null::smallint[], 0::smallint),
      (12::smallint, 'FECHAMENTO', 'Guardar os bolos na geladeira.', 'Fechamento — Bloco 3', 'diaria', null::smallint[], null::smallint[], 0::smallint),
      (13::smallint, 'FECHAMENTO', 'Conferir tomadas e desligar água e equipamentos (máq. de café, luzes dos expositores, balanças, microondas, chapa e notebook)', 'Fechamento — Bloco 3', 'diaria', null::smallint[], null::smallint[], 0::smallint)
  ),
  inseridas as (
    insert into public.tarefas (descricao, categoria, ordem)
    select d.descricao, d.categoria, d.ordem from dados as d
    returning id, descricao
  )
  insert into public.tarefas_regras (tarefa_id, vigente_desde, tipo, dias_semana, semanas_do_mes, grupo_id, deslocamento)
  select i.id, date '2026-10-01', d.tipo, d.dias, d.semanas, g.id, d.deslocamento
  from dados as d
  join inseridas as i on i.descricao = d.descricao
  left join public.tarefas_grupos as g on g.nome = d.grupo;
end
$carga$;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO: apaga cadastro, regras, nomes e TODAS as ocorrencias/conclusoes
-- de Tarefas. So use antes de haver uso real.
-- BEGIN;
-- drop function if exists public.marcar_conclusao_tarefa(uuid, boolean);
-- drop function if exists public.excluir_ocorrencia_avulsa_tarefa(uuid);
-- drop function if exists public.criar_ocorrencia_avulsa_tarefa(uuid, date, smallint, text);
-- drop function if exists public.restaurar_ocorrencia_tarefa(uuid);
-- drop function if exists public.cancelar_ocorrencia_tarefa(uuid, text);
-- drop function if exists public.desfazer_ajuste_ocorrencia_tarefa(uuid);
-- drop function if exists public.ajustar_ocorrencia_tarefa(uuid, smallint, text);
-- drop function if exists public.definir_nome_posicao_tarefas(smallint, text, date, boolean);
-- drop function if exists public.excluir_grupo_tarefas(uuid);
-- drop function if exists public.salvar_grupo_tarefas(uuid, text, text, integer);
-- drop function if exists public.excluir_tarefa(uuid);
-- drop function if exists public.inativar_tarefa(uuid, date, boolean);
-- drop function if exists public.salvar_tarefa(uuid, text, text, integer, text, text, smallint[], smallint[], uuid, date, boolean, boolean);
-- drop function if exists public.programar_mes_tarefas(date, boolean);
-- drop table if exists public.tarefas_ocorrencias;
-- drop table if exists public.tarefas_meses;
-- drop table if exists public.tarefas_posicoes_nomes;
-- drop table if exists public.tarefas_regras;
-- drop table if exists public.tarefas;
-- drop table if exists public.tarefas_grupos;
-- drop table if exists public.tarefas_categorias;
-- drop function if exists public.tarefas_grupo_deslocamento_sugerido(text);
-- drop function if exists public.tarefas_deslocamento_sugerido(uuid, text, smallint[], date);
-- drop function if exists public.tarefas_aplicar_plano(jsonb);
-- drop function if exists public.tarefas_resumir_plano(jsonb);
-- drop function if exists public.tarefas_plano_a_partir_de(date, uuid, date, text, smallint[], smallint[], uuid, smallint, smallint, date, text);
-- drop function if exists public.tarefas_plano_sincronizacao(date, date, uuid, date, text, smallint[], smallint[], uuid, smallint, smallint, date, text);
-- drop function if exists public.tarefas_nome_posicao(smallint, date, smallint, date, text);
-- drop function if exists public.tarefas_ocorrencias_esperadas(date, date, uuid, date, text, smallint[], smallint[], uuid, smallint);
-- drop function if exists public.tarefas_grupos_protecao();
-- drop function if exists public.tarefas_ocorrencias_protecao();
-- drop function if exists public.tarefas_regras_protecao();
-- drop function if exists public.tarefas_auditoria();
-- drop function if exists public.tarefas_normalizar_texto(text);
-- drop function if exists public.tarefas_regra_ocorre(text, smallint[], smallint[], date);
-- drop function if exists public.tarefas_posicao_calculada(date, text, smallint);
-- drop function if exists public.tarefas_hoje();
-- delete from public.perfil_permissoes where permissao in ('tarefas.visualizar', 'tarefas.editar', 'tarefas.concluir');
-- delete from public.usuario_permissoes where permissao in ('tarefas.visualizar', 'tarefas.editar', 'tarefas.concluir');
-- delete from public.permissoes where codigo in ('tarefas.visualizar', 'tarefas.editar', 'tarefas.concluir');
-- COMMIT;
