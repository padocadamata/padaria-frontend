-- 0078_folha_cartao_ponto.sql
-- FOLHA DE PAGAMENTO > CARTAO-PONTO -- fundacao completa (dados, atestados
-- de um ou varios dias, apuracao de TEMPO, conferencia, fechamento com
-- snapshot e reabertura).
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor,
-- depois de conferir a pre-auditoria (0078 PREAUDIT). Pre-requisitos:
-- 0003/0016 (has_permissao), 0054/0055 (funcionarios, Escala), 0010
-- (feriados_nacionais), 0065/0066 (vinculo historico, folha_hoje,
-- folha_tipo_vinculo_em, folha_travar_funcionario), 0077
-- (folha_documentos_config).
--
-- ============================================================
-- FINALIDADE (decisao do negocio)
-- ============================================================
-- Escala = PLANEJADO. Cartao-Ponto = REALIZADO/CONSIDERADO. O cartao
-- documenta a jornada, compara realizado x previsto em MINUTOS e gera
-- PDF/Excel para a contabilidade, que faz os calculos trabalhistas.
-- NENHUM valor em R$, NENHUMA ligacao com Pagamentos: esta migration nao
-- le nem escreve folha_pagamentos*, folha_lancamentos*, nem altera nenhuma
-- funcao/tabela existente (Escala inclusive -- o cartao so a LE).
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1. public.folha_ponto_cartoes -- 1 por funcionaria+competencia: status
--      em_preenchimento|fechado, versao (edicao concorrente), conferencia
--      (marca + hash do que foi conferido), fechamento + SNAPSHOT.
--   2. public.folha_ponto_dias -- lancamento de um dia (so existe quando ha
--      algo lancado): ajuste de situacao trabalho|folga|falta (com motivo e
--      a situacao que a Escala tinha no ajuste) e observacao.
--   3. public.folha_ponto_periodos -- N periodos realizados por dia.
--   4. public.folha_ponto_atestados -- ATESTADO como documento proprio da
--      funcionaria (nao do cartao): integral cobrindo quantos dias
--      consecutivos forem (sem limite; pode atravessar meses e incluir
--      datas FUTURAS) ou parcial (inicio/fim) num dia. Descricao
--      OPCIONAL (observacao administrativa; nunca CID/diagnostico).
--      Editavel/cancelavel com historico.
--   5. public.folha_ponto_eventos -- historico (abrir, ajustar situacao,
--      conferir, fechar, reabrir com o snapshot desfeito, registrar/alterar/
--      cancelar atestado com antes/depois).
--   6. Funcoes internas: leitura do mes (Escala + feriados + vinculo +
--      lancamentos + atestados) e APURACAO -- MESMAS regras de
--      lib/ponto/apuracao.js (paridade testada no PGlite).
--   7. RPCs (escrita SOMENTE por RPC, autoria do servidor): abrir, salvar
--      dias (lote), salvar/cancelar atestado, conferir, fechar, reabrir;
--      leitura: base do mes e resumo da competencia.
--   8. Guardas: cartao fechado nao muda (nem dias/periodos, nem atestados
--      que cobrem a competencia); nenhum PONTO em data futura; nada e
--      apagado (exceto o lancamento de um dia em cartao aberto); eventos
--      imutaveis; versao sempre +1.
--   9. RLS: SELECT por folha_ponto.visualizar; nenhuma escrita direta.
--  10. 4 permissoes novas, SOMENTE proprietario_admin.
--
-- Regra de tempo, minuto a minuto (P = previsto na Escala, R = realizado,
-- A = atestado; intervalos [inicio, fim)):
--   trabalhado no previsto = R n P;  trabalhado fora do previsto = R - P;
--   atestado = (A n P) - R;  previsto nao coberto = P - R - A.
--   previsto = no previsto + atestado + nao coberto (sem dupla contagem).
--   Saldo do DIA = fora do previsto - nao coberto -> extra (>0) ou
--   faltante (<0). Sem tolerancia, sem arredondamento, sem compensacao
--   ENTRE dias. Atestado integral = A cobre todo o previsto do dia.
--   Dia sem Escala: NUNCA folga, nunca previsto inventado -> pendente.
--
-- Competencias passadas: SEM limite de antiguidade -- o que trava e o
-- STATUS do cartao. Datas futuras (folha_hoje(), America/Sao_Paulo): nunca
-- recebem marcacao de ponto nem ajuste; atestado PODE ser registrado antes;
-- dia futuro nao e apurado, e a competencia so e conferida/fechada quando
-- todos os dias do vinculo ja passaram.
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
     or to_regprocedure('public.folha_tipo_vinculo_em(uuid,date)') is null
     or to_regprocedure('public.folha_travar_funcionario(uuid)') is null
     or to_regclass('public.funcionarios') is null
     or to_regclass('public.funcionarios_cargos') is null
     or to_regclass('public.funcionarios_vinculo_historico') is null
     or to_regclass('public.funcionarios_escala_dias') is null
     or to_regclass('public.funcionarios_escala_periodos') is null
     or to_regclass('public.funcionarios_escala_ocorrencias') is null
     or to_regclass('public.feriados_nacionais') is null
     or to_regclass('public.folha_documentos_config') is null
     or to_regclass('public.usuarios') is null
     or to_regclass('public.permissoes') is null
     or to_regclass('public.perfil_permissoes') is null then
    raise exception '0078 abortada: dependencias (has_permissao, folha_hoje, vinculo, Escala, feriados, documentos 0077, usuarios, permissoes) nao encontradas.';
  end if;

  if not exists (select 1 from public.perfis where nome = 'proprietario_admin') then
    raise exception '0078 abortada: perfil proprietario_admin nao encontrado.';
  end if;

  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'funcionarios'
      and column_name in ('id', 'nome', 'cargo_id', 'data_admissao', 'data_demissao', 'tipo_vinculo')) <> 6 then
    raise exception '0078 abortada: colunas esperadas de public.funcionarios (0054/0055) nao encontradas.';
  end if;

  -- folha_hoje (0066): "hoje" em America/Sao_Paulo -- limite de data futura.
  select md5(regexp_replace(lower(prosrc), '[[:space:]]+', '', 'g')) into v_fp from pg_proc
  where oid = to_regprocedure('public.folha_hoje()') and prorettype = 'date'::regtype;
  if v_fp is distinct from 'a1f96c34e9488c9cd3a6779bd2b18c1e' then
    raise exception '0078 abortada: folha_hoje() real difere da 0066 do repositorio (fingerprint %).', coalesce(v_fp, 'ausente');
  end if;

  -- folha_tipo_vinculo_em (0066): vinculo vigente na data (com fallback).
  select md5(regexp_replace(lower(prosrc), '[[:space:]]+', '', 'g')) into v_fp from pg_proc
  where oid = to_regprocedure('public.folha_tipo_vinculo_em(uuid,date)');
  if v_fp is distinct from 'f84ba99dc1276275ed84ce7b42ee4230' then
    raise exception '0078 abortada: folha_tipo_vinculo_em real difere da 0066 do repositorio (fingerprint %).', coalesce(v_fp, 'ausente');
  end if;

  -- folha_travar_funcionario (0066): mesma trava da Escala e de Pagamentos.
  select md5(regexp_replace(lower(prosrc), '[[:space:]]+', '', 'g')) into v_fp from pg_proc
  where oid = to_regprocedure('public.folha_travar_funcionario(uuid)');
  if v_fp is distinct from 'f6d2369f89f0b2dec2a17e4969d469df' then
    raise exception '0078 abortada: folha_travar_funcionario real difere da 0066 do repositorio (fingerprint %).', coalesce(v_fp, 'ausente');
  end if;

  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname like 'folha\_ponto%')
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname like 'folha\_ponto%')
     or exists (select 1 from public.permissoes where codigo like 'folha\_ponto.%') then
    raise exception '0078 abortada: objetos desta migration ja existem -- ela ja parece aplicada.';
  end if;
end $$;

-- ============================================================
-- 1. Funcoes internas de tempo/apuracao -- MESMAS regras de
--    lib/ponto/tempo.js e lib/ponto/apuracao.js. IMMUTABLE (so leem o
--    JSON recebido), search_path vazio, sem EXECUTE para ninguem.
-- ============================================================

-- Erro de validacao com codigo estavel (lib/ponto/lancamento.js MENSAGENS).
create function public.folha_ponto_falhar(p_codigo text, p_mensagem text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  raise exception 'folha_ponto: [%] %', p_codigo, p_mensagem using errcode = 'P0001';
end;
$$;

-- 'HH:MM' (ou 'HH:MM:SS') -> minutos desde 00:00; null se nao for hora.
create function public.folha_ponto_minutos(p_hora text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_hora ~ '^[0-9]{2}:[0-9]{2}'
              then substr(p_hora, 1, 2)::integer * 60 + substr(p_hora, 4, 2)::integer end;
$$;

-- Hora de lancamento valida: 'HH:MM' de 00:00 a 23:59.
create function public.folha_ponto_hora_valida(p_hora text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false);
$$;

-- Minutos cobertos por uma lista de intervalos [ini, fim) (sem contar
-- sobreposicao duas vezes).
create function public.folha_ponto_duracao(p_lista jsonb, p_ini text, p_fim text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select count(distinct m)::integer
  from jsonb_array_elements(coalesce(p_lista, '[]'::jsonb)) e,
       generate_series(public.folha_ponto_minutos(e ->> p_ini), public.folha_ponto_minutos(e ->> p_fim) - 1) m;
$$;

-- Lacunas entre o primeiro inicio e o ultimo fim (intervalo realizado).
create function public.folha_ponto_lacunas(p_lista jsonb, p_ini text, p_fim text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select max(public.folha_ponto_minutos(e ->> p_fim)) - min(public.folha_ponto_minutos(e ->> p_ini))
    from jsonb_array_elements(coalesce(p_lista, '[]'::jsonb)) e
    where public.folha_ponto_minutos(e ->> p_ini) is not null and public.folha_ponto_minutos(e ->> p_fim) is not null
  ), 0) - public.folha_ponto_duracao(p_lista, p_ini, p_fim);
$$;

-- As 4 categorias do dia, minuto a minuto (apuracao.js categorias):
-- [trabalhado no previsto, trabalhado fora do previsto, atestado,
-- previsto nao coberto]. Previstos/atestados {inicio, fim}; realizados
-- {entrada, saida}.
create function public.folha_ponto_categorias(p_previstos jsonb, p_realizados jsonb, p_atestados jsonb)
returns integer[]
language sql
immutable
set search_path = ''
as $$
  with p as (
    select distinct m from jsonb_array_elements(coalesce(p_previstos, '[]'::jsonb)) e,
      generate_series(public.folha_ponto_minutos(e ->> 'inicio'), public.folha_ponto_minutos(e ->> 'fim') - 1) m),
  r as (
    select distinct m from jsonb_array_elements(coalesce(p_realizados, '[]'::jsonb)) e,
      generate_series(public.folha_ponto_minutos(e ->> 'entrada'), public.folha_ponto_minutos(e ->> 'saida') - 1) m),
  a as (
    select distinct m from jsonb_array_elements(coalesce(p_atestados, '[]'::jsonb)) e,
      generate_series(public.folha_ponto_minutos(e ->> 'inicio'), public.folha_ponto_minutos(e ->> 'fim') - 1) m),
  g as (
    select m in (select m from p) as ep, m in (select m from r) as er, m in (select m from a) as ea
    from generate_series(0, 1439) m)
  select array[
    count(*) filter (where ep and er),
    count(*) filter (where er and not ep),
    count(*) filter (where ea and ep and not er),
    count(*) filter (where ep and not er and not ea)]::integer[]
  from g;
$$;

-- Situacao que a Escala, sozinha, da ao dia (apuracao.js situacaoDaEscala).
create function public.folha_ponto_situacao_escala(p_escala jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_escala is null or p_escala = 'null'::jsonb then 'nao_definido'
    when p_escala ->> 'tipo' = 'folga' then 'folga'
    else coalesce(p_escala -> 'ocorrencia' ->> 'tipo', 'trabalho')
  end;
$$;

-- Apuracao de UM dia (apuracao.js apurarDia) -- mesmas chaves, mesma ordem
-- de pendencias: sem_escala, sem_previsto, sem_lancamento,
-- escala_incoerente (e lancamento_fora_vinculo).
create function public.folha_ponto_apurar_dia(p_dia jsonb, p_funcionario jsonb, p_atestados jsonb, p_hoje date)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_data          date := (p_dia ->> 'data')::date;
  v_escala        jsonb := nullif(p_dia -> 'escala', 'null'::jsonb);
  v_lanc          jsonb := nullif(p_dia -> 'lancamento', 'null'::jsonb);
  v_periodos      jsonb;
  v_n_periodos    integer;
  v_sit_escala    text;
  v_fora          text;
  v_futuro        boolean;
  v_base          text;
  v_sit           text;
  v_integral      boolean;
  v_parciais      jsonb;
  v_cobertura     text;
  v_prev_escala   integer;
  v_pend          text[] := '{}';
  v_previstos     jsonb;
  v_realizados    jsonb;
  v_justificados  jsonb;
  v_cat           integer[];
  v_saldo         integer;
  v_prev          integer;
  v_trab          integer;
  v_no_prev       integer;
  v_fora_prev     integer;
  v_int           integer;
  v_atest         integer;
  v_nao_coberto   integer;
  v_extra         integer;
  v_falt          integer;
begin
  v_sit_escala := public.folha_ponto_situacao_escala(v_escala);
  v_futuro := v_data > p_hoje;
  v_periodos := coalesce(nullif(v_lanc -> 'periodos', 'null'::jsonb), '[]'::jsonb);
  v_n_periodos := jsonb_array_length(v_periodos);

  if (p_funcionario ->> 'data_admissao') is not null and v_data < (p_funcionario ->> 'data_admissao')::date then
    v_fora := 'antes_admissao';
  elsif (p_funcionario ->> 'data_demissao') is not null and v_data > (p_funcionario ->> 'data_demissao')::date then
    v_fora := 'apos_desligamento';
  elsif (p_dia ->> 'vinculo') is distinct from 'funcionario' then
    v_fora := 'outro_vinculo';
  end if;

  select coalesce(bool_or(a ->> 'abrangencia' = 'integral'), false),
         coalesce(jsonb_agg(jsonb_build_object('inicio', a ->> 'hora_inicio', 'fim', a ->> 'hora_fim'))
                  filter (where a ->> 'abrangencia' = 'parcial'), '[]'::jsonb)
  into v_integral, v_parciais
  from jsonb_array_elements(coalesce(p_atestados, '[]'::jsonb)) a
  where (a ->> 'data_inicio')::date <= v_data and (a ->> 'data_fim')::date >= v_data;

  v_base := case when v_fora is not null then 'fora_vinculo' else coalesce(v_lanc ->> 'situacao', v_sit_escala) end;
  v_sit := case when v_integral and v_base in ('trabalho', 'falta', 'atestado') then 'atestado' else v_base end;
  v_cobertura := case when v_fora is not null then null
                      when v_integral then 'integral' when jsonb_array_length(v_parciais) > 0 then 'parcial' end;
  v_prev_escala := case
    when v_escala is null then null
    when v_escala ->> 'tipo' <> 'trabalho' then 0
    else public.folha_ponto_duracao(v_escala -> 'periodos', 'inicio', 'fim')
  end;

  if v_fora is not null then
    if v_lanc is not null then
      v_pend := array_append(v_pend, 'lancamento_fora_vinculo');
    end if;
  elsif v_futuro then
    null;
  elsif v_sit = 'nao_definido' then
    v_pend := array_append(v_pend, 'sem_escala');
    if v_n_periodos > 0 then
      v_pend := array_append(v_pend, 'escala_incoerente');
    end if;
  elsif v_sit in ('trabalho', 'falta', 'atestado') and v_escala is null then
    v_pend := array_append(v_pend, 'sem_previsto');
    if v_sit = 'trabalho' then
      v_trab := public.folha_ponto_duracao(v_periodos, 'entrada', 'saida');
      v_int := public.folha_ponto_lacunas(v_periodos, 'entrada', 'saida');
      if v_n_periodos = 0 and jsonb_array_length(v_parciais) = 0 then
        v_pend := array_append(v_pend, 'sem_lancamento');
      end if;
    elsif v_n_periodos > 0 then
      v_pend := array_append(v_pend, 'escala_incoerente');
    end if;
  elsif v_sit in ('falta', 'atestado') and v_escala ->> 'tipo' <> 'trabalho' then
    v_pend := array_append(v_pend, 'escala_incoerente');
  else
    v_previstos := case when v_sit <> 'folga' and v_escala ->> 'tipo' = 'trabalho'
                        then coalesce(v_escala -> 'periodos', '[]'::jsonb) else '[]'::jsonb end;
    v_realizados := case when v_sit = 'trabalho' then v_periodos else '[]'::jsonb end;
    v_justificados := case when v_sit = 'atestado' then v_previstos else v_parciais end;
    v_cat := public.folha_ponto_categorias(v_previstos, v_realizados, v_justificados);
    v_prev := public.folha_ponto_duracao(v_previstos, 'inicio', 'fim');
    v_trab := public.folha_ponto_duracao(v_realizados, 'entrada', 'saida');
    v_no_prev := v_cat[1];
    v_fora_prev := v_cat[2];
    v_int := public.folha_ponto_lacunas(v_realizados, 'entrada', 'saida');
    v_atest := v_cat[3];
    v_nao_coberto := v_cat[4];
    v_saldo := v_fora_prev - v_nao_coberto;
    v_extra := greatest(0, v_saldo);
    v_falt := greatest(0, -v_saldo);
    if v_sit = 'trabalho' and v_n_periodos = 0 and jsonb_array_length(v_parciais) = 0 then
      v_pend := array_append(v_pend, 'sem_lancamento');
    end if;
    if v_sit <> 'trabalho' and v_n_periodos > 0 then
      v_pend := array_append(v_pend, 'escala_incoerente');
    end if;
  end if;

  return jsonb_build_object(
    'data', p_dia ->> 'data',
    'dia_semana', extract(dow from v_data)::integer,
    'feriado', p_dia -> 'feriado',
    'fora_vinculo', v_fora,
    'futuro', v_futuro,
    'situacao_escala', v_sit_escala,
    'situacao', v_sit,
    'ajustado', v_fora is null and (v_lanc ->> 'situacao') is not null,
    'atestado_cobertura', v_cobertura,
    'previsto_escala_min', v_prev_escala,
    'previsto_min', v_prev,
    'trabalhado_min', v_trab,
    'trabalhado_no_previsto_min', v_no_prev,
    'trabalhado_fora_previsto_min', v_fora_prev,
    'intervalo_min', v_int,
    'atestado_min', v_atest,
    'previsto_nao_coberto_min', v_nao_coberto,
    'extra_min', v_extra,
    'faltante_min', v_falt,
    'pendencias', to_jsonb(v_pend)
  );
end;
$$;

-- Apuracao do mes (apuracao.js apurarCartao): dias + totais (so somam --
-- sem compensacao entre dias) + competencia_encerrada.
create function public.folha_ponto_apurar(p_base jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_hoje        date := (p_base ->> 'hoje')::date;
  v_item        jsonb;
  v_dia         jsonb;
  v_dias        jsonb := '[]'::jsonb;
  v_campos      text[] := array['previsto_min', 'trabalhado_min', 'trabalhado_no_previsto_min', 'trabalhado_fora_previsto_min',
                                'intervalo_min', 'atestado_min', 'previsto_nao_coberto_min', 'extra_min', 'faltante_min'];
  v_somas       integer[] := array[0, 0, 0, 0, 0, 0, 0, 0, 0];
  v_i           integer;
  v_totais      jsonb := '{}'::jsonb;
  v_faltas      integer := 0;
  v_atestados   integer := 0;
  v_trabalhados integer := 0;
  v_pendentes   integer := 0;
  v_dentro      integer := 0;
  v_futuros     integer := 0;
begin
  for v_item in select e.value from jsonb_array_elements(coalesce(p_base -> 'dias', '[]'::jsonb)) with ordinality as e(value, ordem) order by e.ordem loop
    v_dia := public.folha_ponto_apurar_dia(v_item, p_base -> 'funcionario', p_base -> 'atestados', v_hoje);
    v_dias := v_dias || jsonb_build_array(v_dia);
    for v_i in 1 .. 9 loop
      v_somas[v_i] := v_somas[v_i] + coalesce((v_dia ->> v_campos[v_i])::integer, 0);
    end loop;
    if (v_dia ->> 'fora_vinculo') is null then
      v_dentro := v_dentro + 1;
      if (v_dia ->> 'futuro')::boolean then
        v_futuros := v_futuros + 1;
      else
        if v_dia ->> 'situacao' = 'falta' then v_faltas := v_faltas + 1; end if;
        if v_dia ->> 'situacao' = 'atestado' then v_atestados := v_atestados + 1; end if;
      end if;
    end if;
    if coalesce((v_dia ->> 'trabalhado_min')::integer, 0) > 0 then v_trabalhados := v_trabalhados + 1; end if;
    if jsonb_array_length(v_dia -> 'pendencias') > 0 then v_pendentes := v_pendentes + 1; end if;
  end loop;

  for v_i in 1 .. 9 loop
    v_totais := v_totais || jsonb_build_object(v_campos[v_i], v_somas[v_i]);
  end loop;
  v_totais := v_totais || jsonb_build_object('faltas_qtd', v_faltas, 'atestados_integrais_qtd', v_atestados,
                                             'dias_trabalhados', v_trabalhados, 'dias_pendentes', v_pendentes);

  return jsonb_build_object(
    'calculo_versao', 1,
    'dias', v_dias,
    'totais', v_totais,
    'competencia_encerrada', v_dentro > 0 and v_futuros = 0
  );
end;
$$;

-- ============================================================
-- 2. Tabelas.
-- ============================================================

-- 2a. Cartao -- 1 por funcionaria+competencia (dia 1 do mes).
create table public.folha_ponto_cartoes (
  id                   uuid primary key default gen_random_uuid(),
  funcionario_id       uuid not null references public.funcionarios(id),
  competencia          date not null,
  status               text not null default 'em_preenchimento',
  versao               integer not null default 1,

  conferido_em         timestamptz,
  conferido_por        uuid references auth.users(id) on delete set null,
  conferido_por_nome   text,
  conferido_hash       text,

  fechado_em           timestamptz,
  fechado_por          uuid references auth.users(id) on delete set null,
  fechado_por_nome     text,
  snapshot             jsonb,

  criado_em            timestamptz not null default now(),
  criado_por           uuid references auth.users(id) on delete set null,
  criado_por_nome      text,
  atualizado_em        timestamptz,
  atualizado_por       uuid references auth.users(id) on delete set null,
  atualizado_por_nome  text,

  constraint folha_ponto_cartoes_competencia_unica unique (funcionario_id, competencia),
  constraint folha_ponto_cartoes_competencia_mes check (extract(day from competencia) = 1),
  constraint folha_ponto_cartoes_status_valido check (status in ('em_preenchimento', 'fechado')),
  constraint folha_ponto_cartoes_versao_valida check (versao >= 1),
  constraint folha_ponto_cartoes_conferencia_coerente check ((conferido_em is null) = (conferido_hash is null)),
  constraint folha_ponto_cartoes_estado_coerente check (
    (status = 'em_preenchimento' and fechado_em is null and fechado_por is null and fechado_por_nome is null and snapshot is null)
    or (status = 'fechado' and fechado_em is not null and conferido_em is not null and snapshot is not null
        and jsonb_typeof(snapshot) = 'object' and snapshot ? 'base' and snapshot ? 'apuracao')
  )
);

create index folha_ponto_cartoes_competencia_idx on public.folha_ponto_cartoes (competencia);

comment on table public.folha_ponto_cartoes is
  'Migration 0078. Cartao-Ponto de UMA funcionaria (vinculo CLT) numa competencia (dia 1 do mes). SOMENTE controle de TEMPO -- nenhum valor em R$, nenhuma ligacao com Pagamentos. status: em_preenchimento (editavel) | fechado (congelado; snapshot autossuficiente com a base do mes -- Escala, feriados, vinculo, lancamentos, atestados -- e a apuracao). Conferencia = marca (conferido_*) + hash do que foi conferido; qualquer alteracao do cartao (ou de atestado que o cubra) a desfaz, e o fechamento recusa se a Escala/cartao mudou desde a conferencia. versao avanca +1 a cada escrita (edicao concorrente). Sem limite de antiguidade: o que trava e o status. Nunca apagado. Escrita somente pelas RPCs folha_ponto_*.';
comment on column public.folha_ponto_cartoes.snapshot is
  'Preenchido SO no fechamento: {snapshot_versao, calculo_versao, base (o mes inteiro como estava -- Escala, feriados, vinculo, lancamentos, atestados), apuracao (dias + totais), empresa, conferido_*, fechado_*}. Cartao fechado e exibido/exportado SOMENTE a partir daqui -- alterar a Escala depois nunca muda o documento. Reabrir move o snapshot para o evento de reabertura.';
comment on column public.folha_ponto_cartoes.conferido_hash is
  'md5 da base do mes (funcionaria + dias + atestados) no momento da conferencia. Fechar compara com a base atual: Escala, lancamento ou atestado diferente = conferencia desatualizada.';

-- 2b. Lancamento de um dia -- so existe quando ha algo lancado.
create table public.folha_ponto_dias (
  id                         uuid primary key default gen_random_uuid(),
  cartao_id                  uuid not null references public.folha_ponto_cartoes(id),
  data                       date not null,
  situacao                   text,
  motivo                     text,
  situacao_escala_no_ajuste  text,
  observacao                 text,

  criado_em                  timestamptz not null default now(),
  criado_por                 uuid references auth.users(id) on delete set null,
  criado_por_nome            text,
  atualizado_em              timestamptz,
  atualizado_por             uuid references auth.users(id) on delete set null,
  atualizado_por_nome        text,

  constraint folha_ponto_dias_data_unica unique (cartao_id, data),
  constraint folha_ponto_dias_situacao_valida check (situacao is null or situacao in ('trabalho', 'folga', 'falta')),
  constraint folha_ponto_dias_origem_valida check (
    situacao_escala_no_ajuste is null or situacao_escala_no_ajuste in ('trabalho', 'folga', 'falta', 'atestado', 'nao_definido')),
  constraint folha_ponto_dias_ajuste_coerente check (
    (situacao is null) = (motivo is null) and (situacao is null) = (situacao_escala_no_ajuste is null)),
  constraint folha_ponto_dias_motivo_valido check (motivo is null or (btrim(motivo) <> '' and char_length(motivo) <= 500)),
  constraint folha_ponto_dias_observacao_valida check (observacao is null or (btrim(observacao) <> '' and char_length(observacao) <= 500))
);

comment on table public.folha_ponto_dias is
  'Migration 0078. Lancamento de UM dia do cartao. situacao NULL = segue a Escala. situacao preenchida = AJUSTE do cartao (trabalho em folga, dispensa, falta nao registrada na Escala, regularizacao de dia sem Escala como folga), sempre com motivo e com a situacao que a Escala tinha no momento do ajuste (situacao_escala_no_ajuste) -- a Escala NUNCA e alterada. Atestado nao e ajuste: e folha_ponto_atestados. Periodos realizados sao filhos. Sem lancamento em data futura (folha_hoje) nem fora do vinculo (RPC). Cartao fechado: imutavel.';

-- 2c. Periodos realizados (N por dia).
create table public.folha_ponto_periodos (
  id        uuid primary key default gen_random_uuid(),
  dia_id    uuid not null references public.folha_ponto_dias(id) on delete cascade,
  entrada   time not null,
  saida     time not null,
  criado_em timestamptz not null default now(),

  constraint folha_ponto_periodos_horas_coerentes check (saida > entrada),
  constraint folha_ponto_periodos_minuto_exato check (extract(second from entrada) = 0 and extract(second from saida) = 0),
  constraint folha_ponto_periodos_entrada_unica unique (dia_id, entrada)
);

create index folha_ponto_periodos_dia_idx on public.folha_ponto_periodos (dia_id);

comment on table public.folha_ponto_periodos is
  'Migration 0078. Periodo REALIZADO (entrada/saida, por minuto, mesmo dia -- sem virada de meia-noite, como na Escala). N por dia; a tela mostra os 2 primeiros como Entrada | Saida intervalo | Retorno intervalo | Saida. Sobreposicao recusada pela RPC. Intervalo = lacuna entre periodos (calculado, nunca gravado). Sempre substituidos inteiros ao salvar o dia.';

-- 2d. Atestado -- documento da FUNCIONARIA (nao do cartao): um registro
--     cobre N dias consecutivos (integral, sem limite) ou parte de um dia
--     (parcial). Descricao opcional.
create table public.folha_ponto_atestados (
  id                   uuid primary key default gen_random_uuid(),
  funcionario_id       uuid not null references public.funcionarios(id),
  tipo                 text not null,
  abrangencia          text not null,
  data_inicio          date not null,
  data_fim             date not null,
  hora_inicio          time,
  hora_fim             time,
  descricao            text,
  status               text not null default 'ativo',
  versao               integer not null default 1,

  criado_em            timestamptz not null default now(),
  criado_por           uuid references auth.users(id) on delete set null,
  criado_por_nome      text,
  atualizado_em        timestamptz,
  atualizado_por       uuid references auth.users(id) on delete set null,
  atualizado_por_nome  text,
  cancelado_em         timestamptz,
  cancelado_por        uuid references auth.users(id) on delete set null,
  cancelado_por_nome   text,
  motivo_cancelamento  text,

  constraint folha_ponto_atestados_tipo_valido check (tipo in ('atestado_medico', 'comparecimento', 'outro')),
  constraint folha_ponto_atestados_abrangencia_valida check (abrangencia in ('integral', 'parcial')),
  constraint folha_ponto_atestados_periodo_valido check (data_fim >= data_inicio),
  constraint folha_ponto_atestados_horario_coerente check (
    (abrangencia = 'integral' and hora_inicio is null and hora_fim is null)
    or (abrangencia = 'parcial' and data_inicio = data_fim and hora_inicio is not null and hora_fim is not null and hora_fim > hora_inicio
        and extract(second from hora_inicio) = 0 and extract(second from hora_fim) = 0)),
  constraint folha_ponto_atestados_descricao_valida check (descricao is null or (btrim(descricao) <> '' and char_length(descricao) <= 500)),
  constraint folha_ponto_atestados_status_valido check (status in ('ativo', 'cancelado')),
  constraint folha_ponto_atestados_versao_valida check (versao >= 1),
  constraint folha_ponto_atestados_estado_coerente check (
    (status = 'ativo' and cancelado_em is null and cancelado_por is null and cancelado_por_nome is null and motivo_cancelamento is null)
    or (status = 'cancelado' and cancelado_em is not null and motivo_cancelamento is not null and btrim(motivo_cancelamento) <> ''
        and char_length(motivo_cancelamento) <= 500))
);

create index folha_ponto_atestados_funcionario_idx on public.folha_ponto_atestados (funcionario_id, data_inicio) where status = 'ativo';

comment on table public.folha_ponto_atestados is
  'Migration 0078. ATESTADO como documento proprio da funcionaria: integral (N dias consecutivos, sem limite -- pode atravessar meses e cobrir datas FUTURAS, ex.: atestado de 3 dias entregue hoje ou afastamento de 6 meses) ou parcial (comparecimento: inicio/fim num unico dia). Um unico registro cobre todos os dias -- nada e duplicado por dia. Na apuracao: integral torna "Atestado" o dia que tinha jornada (trabalho ou falta da Escala -- a Falta original fica preservada na Escala e no snapshot), folga coberta continua folga, dia sem Escala continua pendente; horas de atestado = so a parte DENTRO do previsto e NAO trabalhada. Sem sobreposicao entre atestados ativos; integral nao cobre dia com horario trabalhado (use parcial). Editavel (versao) e cancelavel (motivo) com historico em folha_ponto_eventos; nunca apagado; com competencia FECHADA coberta: nao cancela nem muda conteudo, so a ponta em competencia aberta pode ser encurtada/alongada. Descricao opcional (observacao administrativa; nunca CID/diagnostico). Sem anexo nesta versao. O cartao NAO calcula afastamento previdenciario nem quem paga (empregador/INSS) -- isso e da contabilidade.';

-- 2e. Historico (somente inclusao).
create table public.folha_ponto_eventos (
  id                 uuid primary key default gen_random_uuid(),
  funcionario_id     uuid not null references public.funcionarios(id),
  cartao_id          uuid references public.folha_ponto_cartoes(id),
  atestado_id        uuid references public.folha_ponto_atestados(id),
  acao               text not null,
  data               date,
  situacao_anterior  text,
  situacao_nova      text,
  motivo             text,
  dados              jsonb,
  versao             integer not null,
  criado_em          timestamptz not null default now(),
  criado_por         uuid references auth.users(id) on delete set null,
  criado_por_nome    text,

  constraint folha_ponto_eventos_acao_valida check (acao in ('abrir', 'ajustar_situacao', 'conferir', 'fechar', 'reabrir',
                                                              'atestado_registrar', 'atestado_alterar', 'atestado_cancelar')),
  constraint folha_ponto_eventos_alvo_coerente check (
    (acao like 'atestado\_%' and atestado_id is not null and cartao_id is null)
    or (acao not like 'atestado\_%' and cartao_id is not null and atestado_id is null)),
  constraint folha_ponto_eventos_data_coerente check ((acao = 'ajustar_situacao') = (data is not null)),
  constraint folha_ponto_eventos_motivo_obrigatorio check (
    acao not in ('reabrir', 'atestado_cancelar') or (motivo is not null and btrim(motivo) <> ''))
);

create index folha_ponto_eventos_cartao_idx on public.folha_ponto_eventos (cartao_id, criado_em) where cartao_id is not null;
create index folha_ponto_eventos_atestado_idx on public.folha_ponto_eventos (atestado_id, criado_em) where atestado_id is not null;

comment on table public.folha_ponto_eventos is
  'Migration 0078. Historico (somente inclusao, imutavel): abrir, ajustar_situacao (dia, anterior -> nova, motivo, situacao da Escala; anterior/nova NULL = seguia a Escala), conferir, fechar (totais), reabrir (motivo + snapshot do fechamento desfeito em dados), atestado_registrar/alterar/cancelar (antes/depois em dados; cancelar com motivo). Autoria do servidor.';

-- ============================================================
-- 3. Leitura do mes e apoio (internas, SECURITY DEFINER: leem Escala/
--    feriados/vinculo sem depender das permissoes da Escala do usuario --
--    quem ve o cartao ve o previsto que ele usa).
-- ============================================================

create function public.folha_ponto_funcionario_json(p_funcionario_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', f.id,
    'nome', f.nome,
    'cargo', cg.nome,
    'data_admissao', to_char(f.data_admissao, 'YYYY-MM-DD'),
    'data_demissao', to_char(f.data_demissao, 'YYYY-MM-DD'))
  from public.funcionarios f
  left join public.funcionarios_cargos cg on cg.id = f.cargo_id
  where f.id = p_funcionario_id;
$$;

-- Escala do dia: {tipo, observacao, periodos [{inicio, fim}], ocorrencia
-- {tipo, observacao}|null}; NULL = dia nao definido.
create function public.folha_ponto_escala_dia(p_funcionario_id uuid, p_data date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tipo', ed.tipo_dia,
    'observacao', ed.observacao,
    'periodos', coalesce((
      select jsonb_agg(jsonb_build_object('inicio', substr(p.hora_inicio::text, 1, 5), 'fim', substr(p.hora_fim::text, 1, 5))
                       order by p.hora_inicio, p.hora_fim)
      from public.funcionarios_escala_periodos p where p.escala_dia_id = ed.id), '[]'::jsonb),
    'ocorrencia', (
      select jsonb_build_object('tipo', o.tipo, 'observacao', o.observacao)
      from public.funcionarios_escala_ocorrencias o where o.escala_dia_id = ed.id))
  from public.funcionarios_escala_dias ed
  where ed.funcionario_id = p_funcionario_id and ed.data = p_data;
$$;

-- Lancamento do dia no cartao da competencia; NULL = nada lancado.
create function public.folha_ponto_lancamento_dia(p_funcionario_id uuid, p_competencia date, p_data date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'situacao', pd.situacao,
    'motivo', pd.motivo,
    'origem', pd.situacao_escala_no_ajuste,
    'observacao', pd.observacao,
    'periodos', coalesce((
      select jsonb_agg(jsonb_build_object('entrada', substr(pp.entrada::text, 1, 5), 'saida', substr(pp.saida::text, 1, 5)) order by pp.entrada)
      from public.folha_ponto_periodos pp where pp.dia_id = pd.id), '[]'::jsonb),
    'atualizado_em', to_char(coalesce(pd.atualizado_em, pd.criado_em) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'atualizado_por_nome', coalesce(pd.atualizado_por_nome, pd.criado_por_nome))
  from public.folha_ponto_dias pd
  join public.folha_ponto_cartoes c on c.id = pd.cartao_id
  where c.funcionario_id = p_funcionario_id and c.competencia = p_competencia and pd.data = p_data;
$$;

-- Atestados ATIVOS da funcionaria que tocam [inicio, fim].
create function public.folha_ponto_atestados_json(p_funcionario_id uuid, p_inicio date, p_fim date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'tipo', a.tipo,
    'abrangencia', a.abrangencia,
    'data_inicio', to_char(a.data_inicio, 'YYYY-MM-DD'),
    'data_fim', to_char(a.data_fim, 'YYYY-MM-DD'),
    'hora_inicio', substr(a.hora_inicio::text, 1, 5),
    'hora_fim', substr(a.hora_fim::text, 1, 5),
    'descricao', a.descricao,
    'versao', a.versao,
    'registrado_em', to_char(a.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'registrado_por_nome', a.criado_por_nome,
    'atualizado_em', to_char(a.atualizado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'atualizado_por_nome', a.atualizado_por_nome) order by a.data_inicio, a.hora_inicio nulls first, a.id), '[]'::jsonb)
  from public.folha_ponto_atestados a
  where a.funcionario_id = p_funcionario_id and a.status = 'ativo'
    and a.data_inicio <= p_fim and a.data_fim >= p_inicio;
$$;

-- Base do mes -- mesma forma que lib/ponto/apuracao.js recebe.
create function public.folha_ponto_montar_base(p_funcionario_id uuid, p_competencia date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'versao_base', 1,
    'hoje', to_char(public.folha_hoje(), 'YYYY-MM-DD'),
    'competencia', to_char(p_competencia, 'YYYY-MM-DD'),
    'funcionario', public.folha_ponto_funcionario_json(p_funcionario_id),
    'atestados', public.folha_ponto_atestados_json(p_funcionario_id, p_competencia,
                                                   (p_competencia + interval '1 month' - interval '1 day')::date),
    'dias', (
      select jsonb_agg(jsonb_build_object(
        'data', to_char(d.data, 'YYYY-MM-DD'),
        'vinculo', public.folha_tipo_vinculo_em(p_funcionario_id, d.data),
        'feriado', (select fe.nome from public.feriados_nacionais fe where fe.data = d.data),
        'escala', public.folha_ponto_escala_dia(p_funcionario_id, d.data),
        'lancamento', public.folha_ponto_lancamento_dia(p_funcionario_id, p_competencia, d.data)
      ) order by d.data)
      from (select g::date as data
            from generate_series(p_competencia::timestamp, (p_competencia + interval '1 month' - interval '1 day')::timestamp, interval '1 day') g) d));
$$;

-- Impressao digital do que foi conferido (funcionaria + dias + atestados;
-- sem "hoje").
create function public.folha_ponto_hash(p_base jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(jsonb_build_object('funcionario', p_base -> 'funcionario', 'dias', p_base -> 'dias',
                                'atestados', p_base -> 'atestados')::text);
$$;

-- A data esta dentro do vinculo CLT (admissao/desligamento + vinculo vigente).
create function public.folha_ponto_vinculo_dia(p_funcionario_id uuid, p_data date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select (f.data_admissao is null or p_data >= f.data_admissao)
           and (f.data_demissao is null or p_data <= f.data_demissao)
           and public.folha_tipo_vinculo_em(p_funcionario_id, p_data) = 'funcionario'
    from public.funcionarios f where f.id = p_funcionario_id), false);
$$;

-- Algum dia da competencia dentro do vinculo CLT.
create function public.folha_ponto_tem_vinculo(p_funcionario_id uuid, p_competencia date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from generate_series(p_competencia::timestamp, (p_competencia + interval '1 month' - interval '1 day')::timestamp, interval '1 day') g
    where public.folha_ponto_vinculo_dia(p_funcionario_id, g::date));
$$;

-- Ha cartao FECHADO em alguma competencia tocada por [inicio, fim]?
create function public.folha_ponto_periodo_fechado(p_funcionario_id uuid, p_inicio date, p_fim date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.folha_ponto_cartoes c
    where c.funcionario_id = p_funcionario_id and c.status = 'fechado'
      and c.competencia between date_trunc('month', p_inicio)::date and date_trunc('month', p_fim)::date);
$$;

-- Alterar um atestado ja registrado toca cartao FECHADO? Mesmo conteudo
-- (tipo, abrangencia, horas, descricao) e periodos que se encostam: so os
-- dias cuja cobertura MUDA contam -- encurtar/alongar a ponta de um
-- afastamento longo e permitido enquanto essa ponta esta em competencia
-- aberta (a parte ja fechada nao muda). Conteudo diferente ou periodos
-- disjuntos: o periodo antigo e o novo inteiros.
create function public.folha_ponto_alteracao_toca_fechado(
  p_funcionario_id  uuid,
  p_antigo_inicio   date,
  p_antigo_fim      date,
  p_novo_inicio     date,
  p_novo_fim        date,
  p_mesmo_conteudo  boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not p_mesmo_conteudo or p_novo_fim < p_antigo_inicio or p_novo_inicio > p_antigo_fim then
      public.folha_ponto_periodo_fechado(p_funcionario_id, p_antigo_inicio, p_antigo_fim)
      or public.folha_ponto_periodo_fechado(p_funcionario_id, p_novo_inicio, p_novo_fim)
    else
      (p_antigo_inicio <> p_novo_inicio
       and public.folha_ponto_periodo_fechado(p_funcionario_id, least(p_antigo_inicio, p_novo_inicio),
                                              greatest(p_antigo_inicio, p_novo_inicio) - 1))
      or (p_antigo_fim <> p_novo_fim
          and public.folha_ponto_periodo_fechado(p_funcionario_id, least(p_antigo_fim, p_novo_fim) + 1,
                                                 greatest(p_antigo_fim, p_novo_fim)))
  end;
$$;

-- Atestado mudou: os cartoes ABERTOS das competencias tocadas avancam a
-- versao e perdem a conferencia (o conteudo apurado mudou).
create function public.folha_ponto_invalidar_cartoes(p_funcionario_id uuid, p_inicio date, p_fim date, p_usuario text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.folha_ponto_cartoes c
  set versao = c.versao + 1,
      conferido_em = null, conferido_por = null, conferido_por_nome = null, conferido_hash = null,
      atualizado_em = now(), atualizado_por = auth.uid(), atualizado_por_nome = p_usuario
  where c.funcionario_id = p_funcionario_id and c.status = 'em_preenchimento'
    and c.competencia between date_trunc('month', p_inicio)::date and date_trunc('month', p_fim)::date;
$$;

-- ============================================================
-- 4. Guardas.
-- ============================================================
create function public.folha_ponto_bloquear_exclusao_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception '%: registros nunca sao apagados.', tg_table_name;
end;
$$;

create function public.folha_ponto_eventos_guarda_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'folha_ponto_eventos: historico imutavel.';
end;
$$;

-- Cartao: nasce em preenchimento/versao 1/sem conferencia; identificacao e
-- autoria de criacao imutaveis; versao sempre +1; fechado nao muda (so a
-- reabertura -- fechado -> em_preenchimento -- e aceita).
create function public.folha_ponto_cartoes_guarda_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'em_preenchimento' or new.versao <> 1 or new.conferido_em is not null then
      raise exception 'folha_ponto_cartoes: cartao sempre nasce em preenchimento, versao 1, sem conferencia.';
    end if;
    return new;
  end if;

  if new.id <> old.id or new.funcionario_id <> old.funcionario_id or new.competencia <> old.competencia
     or new.criado_em <> old.criado_em or new.criado_por is distinct from old.criado_por
     or new.criado_por_nome is distinct from old.criado_por_nome then
    raise exception 'folha_ponto_cartoes: identificacao e autoria de criacao sao imutaveis.';
  end if;
  if new.versao <> old.versao + 1 then
    raise exception 'folha_ponto_cartoes: a versao avanca exatamente 1 a cada alteracao.';
  end if;
  if old.status = 'fechado' and new.status = 'fechado' then
    raise exception 'folha_ponto_cartoes: cartao fechado e imutavel (reabra antes).';
  end if;
  return new;
end;
$$;

-- Dia: so em cartao em preenchimento; data dentro da competencia e nunca
-- futura; cartao/data imutaveis.
create function public.folha_ponto_dias_guarda_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cartao      uuid;
  v_status      text;
  v_competencia date;
begin
  if tg_op = 'DELETE' then
    v_cartao := old.cartao_id;
  else
    v_cartao := new.cartao_id;
  end if;

  select c.status, c.competencia into v_status, v_competencia from public.folha_ponto_cartoes c where c.id = v_cartao;
  if v_status is distinct from 'em_preenchimento' then
    raise exception 'folha_ponto_dias: so cartao em preenchimento aceita alteracao.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.id <> old.id or new.cartao_id <> old.cartao_id or new.data <> old.data) then
    raise exception 'folha_ponto_dias: cartao e data do lancamento sao imutaveis.';
  end if;
  if new.data < v_competencia or new.data >= (v_competencia + interval '1 month')::date then
    raise exception 'folha_ponto_dias: data % fora da competencia do cartao.', new.data;
  end if;
  if new.data > public.folha_hoje() then
    raise exception 'folha_ponto_dias: nao ha lancamento de ponto em data futura (%).', new.data;
  end if;
  return new;
end;
$$;

-- Periodos: so em dia de cartao em preenchimento. Na exclusao em cascata
-- (dia ja removido -- e o dia ja passou pela guarda acima) aceita.
create function public.folha_ponto_periodos_guarda_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dia    uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then
    v_dia := old.dia_id;
  else
    v_dia := new.dia_id;
  end if;

  select c.status into v_status
  from public.folha_ponto_dias d join public.folha_ponto_cartoes c on c.id = d.cartao_id
  where d.id = v_dia;
  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception 'folha_ponto_periodos: dia % nao encontrado.', v_dia;
  end if;
  if v_status <> 'em_preenchimento' then
    raise exception 'folha_ponto_periodos: so cartao em preenchimento aceita alteracao.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and new.dia_id <> old.dia_id then
    raise exception 'folha_ponto_periodos: o dia do registro e imutavel.';
  end if;
  return new;
end;
$$;

-- Atestado: nasce ativo/versao 1; identificacao e autoria de criacao
-- imutaveis; versao +1; cancelado e final; nunca toca competencia com
-- cartao fechado (nem o periodo antigo, nem o novo).
create function public.folha_ponto_atestados_guarda_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'ativo' or new.versao <> 1 then
      raise exception 'folha_ponto_atestados: atestado sempre nasce ativo, versao 1.';
    end if;
  else
    if old.status = 'cancelado' then
      raise exception 'folha_ponto_atestados: atestado cancelado e imutavel.';
    end if;
    if new.id <> old.id or new.funcionario_id <> old.funcionario_id or new.criado_em <> old.criado_em
       or new.criado_por is distinct from old.criado_por or new.criado_por_nome is distinct from old.criado_por_nome then
      raise exception 'folha_ponto_atestados: identificacao e autoria de criacao sao imutaveis.';
    end if;
    if new.versao <> old.versao + 1 then
      raise exception 'folha_ponto_atestados: a versao avanca exatamente 1 a cada alteracao.';
    end if;
    -- Cancelar afeta todos os dias; alterar, so os dias que mudam.
    if (new.status = 'cancelado' and public.folha_ponto_periodo_fechado(old.funcionario_id, old.data_inicio, old.data_fim))
       or (new.status = 'ativo' and public.folha_ponto_alteracao_toca_fechado(old.funcionario_id, old.data_inicio, old.data_fim,
             new.data_inicio, new.data_fim,
             (new.tipo, new.abrangencia, new.hora_inicio, new.hora_fim, new.descricao)
               is not distinct from (old.tipo, old.abrangencia, old.hora_inicio, old.hora_fim, old.descricao))) then
      raise exception 'folha_ponto_atestados: a alteracao atinge competencia com cartao fechado.';
    end if;
  end if;
  if tg_op = 'INSERT' and public.folha_ponto_periodo_fechado(new.funcionario_id, new.data_inicio, new.data_fim) then
    raise exception 'folha_ponto_atestados: o atestado cobre competencia com cartao fechado.';
  end if;
  return new;
end;
$$;

create trigger folha_ponto_cartoes_guarda
  before insert or update on public.folha_ponto_cartoes
  for each row execute function public.folha_ponto_cartoes_guarda_fn();
create trigger folha_ponto_cartoes_sem_exclusao
  before delete on public.folha_ponto_cartoes
  for each row execute function public.folha_ponto_bloquear_exclusao_fn();
create trigger folha_ponto_cartoes_sem_truncate
  before truncate on public.folha_ponto_cartoes
  for each statement execute function public.folha_ponto_bloquear_exclusao_fn();

create trigger folha_ponto_dias_guarda
  before insert or update or delete on public.folha_ponto_dias
  for each row execute function public.folha_ponto_dias_guarda_fn();
create trigger folha_ponto_dias_sem_truncate
  before truncate on public.folha_ponto_dias
  for each statement execute function public.folha_ponto_bloquear_exclusao_fn();

create trigger folha_ponto_periodos_guarda
  before insert or update or delete on public.folha_ponto_periodos
  for each row execute function public.folha_ponto_periodos_guarda_fn();
create trigger folha_ponto_periodos_sem_truncate
  before truncate on public.folha_ponto_periodos
  for each statement execute function public.folha_ponto_bloquear_exclusao_fn();

create trigger folha_ponto_atestados_guarda
  before insert or update on public.folha_ponto_atestados
  for each row execute function public.folha_ponto_atestados_guarda_fn();
create trigger folha_ponto_atestados_sem_exclusao
  before delete on public.folha_ponto_atestados
  for each row execute function public.folha_ponto_bloquear_exclusao_fn();
create trigger folha_ponto_atestados_sem_truncate
  before truncate on public.folha_ponto_atestados
  for each statement execute function public.folha_ponto_bloquear_exclusao_fn();

create trigger folha_ponto_eventos_imutavel
  before update or delete on public.folha_ponto_eventos
  for each row execute function public.folha_ponto_eventos_guarda_fn();
create trigger folha_ponto_eventos_sem_truncate
  before truncate on public.folha_ponto_eventos
  for each statement execute function public.folha_ponto_bloquear_exclusao_fn();

-- ============================================================
-- 5. RPCs (escrita somente por RPC; autoria e "hoje" do servidor). Toda
--    escrita: trava por funcionaria (a mesma da Escala e de Pagamentos),
--    FOR UPDATE no registro, versao esperada, versao +1.
-- ============================================================

-- Abre (ou devolve) o cartao da competencia -- folha_ponto.lancar. SEM
-- limite de antiguidade; competencia futura e recusada; exige ao menos 1
-- dia do mes dentro do vinculo CLT. Devolve {cartao_id, versao, criado}.
create function public.folha_ponto_cartao_abrir(p_funcionario_id uuid, p_competencia date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_competencia date;
  v_id          uuid;
  v_versao      integer;
  v_usuario     text;
begin
  if not (select public.has_permissao('folha_ponto.lancar')) then
    raise exception using errcode = '42501',
      message = 'folha_ponto_cartao_abrir: requer a permissao folha_ponto.lancar.';
  end if;
  if p_competencia is null then
    perform public.folha_ponto_falhar('competencia_invalida', 'informe a competencia.');
  end if;
  v_competencia := date_trunc('month', p_competencia)::date;
  if p_funcionario_id is null or not exists (select 1 from public.funcionarios f where f.id = p_funcionario_id) then
    perform public.folha_ponto_falhar('funcionario_inexistente', 'funcionaria nao encontrada.');
  end if;
  if v_competencia > date_trunc('month', public.folha_hoje())::date then
    perform public.folha_ponto_falhar('competencia_futura', 'competencia futura ainda nao tem cartao-ponto.');
  end if;
  if not public.folha_ponto_tem_vinculo(p_funcionario_id, v_competencia) then
    perform public.folha_ponto_falhar('sem_vinculo_na_competencia', 'nenhum dia da competencia dentro do vinculo CLT.');
  end if;

  perform public.folha_travar_funcionario(p_funcionario_id);

  select c.id, c.versao into v_id, v_versao
  from public.folha_ponto_cartoes c
  where c.funcionario_id = p_funcionario_id and c.competencia = v_competencia;
  if v_id is not null then
    return jsonb_build_object('cartao_id', v_id, 'versao', v_versao, 'criado', false);
  end if;

  v_usuario := (select u.nome from public.usuarios u where u.id = auth.uid());
  insert into public.folha_ponto_cartoes (funcionario_id, competencia, criado_por, criado_por_nome)
  values (p_funcionario_id, v_competencia, auth.uid(), v_usuario)
  returning id into v_id;

  insert into public.folha_ponto_eventos (funcionario_id, cartao_id, acao, versao, criado_por, criado_por_nome)
  values (p_funcionario_id, v_id, 'abrir', 1, auth.uid(), v_usuario);

  return jsonb_build_object('cartao_id', v_id, 'versao', 1, 'criado', true);
end;
$$;

comment on function public.folha_ponto_cartao_abrir(uuid, date) is
  'Migration 0078. Abre (ou devolve, se ja existir) o Cartao-Ponto de uma funcionaria numa competencia -- qualquer mes passado (sem limite de antiguidade) ou o atual; competencia futura recusada; exige ao menos 1 dia do mes no vinculo CLT (admissao/desligamento + folha_tipo_vinculo_em). Devolve {cartao_id, versao, criado}. Requer folha_ponto.lancar.';

-- Salva 1+ dias de uma vez (lancar horas, "Repetir horarios", ajustes) --
-- folha_ponto.lancar. Cada item SUBSTITUI o lancamento do dia: {data,
-- situacao (null = segue a Escala; ajuste: trabalho|folga|falta), motivo,
-- observacao, periodos [{entrada, saida}]}. Item vazio apaga o lancamento
-- do dia. MESMAS validacoes (e codigos) de lib/ponto/lancamento.js
-- validarItemDia. Tudo ou nada. Devolve a nova versao do cartao (a
-- conferencia e desfeita).
create function public.folha_ponto_dias_salvar(p_cartao_id uuid, p_versao_esperada integer, p_dias jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cartao      public.folha_ponto_cartoes%rowtype;
  v_func        uuid;
  v_hoje        date := public.folha_hoje();
  v_fim_comp    date;
  v_usuario     text;
  v_item        jsonb;
  v_data        date;
  v_vistas      date[] := '{}';
  v_escala      jsonb;
  v_sit_escala  text;
  v_sit         text;
  v_motivo      text;
  v_obs         text;
  v_periodos    jsonb;
  v_el          jsonb;
  v_outro       jsonb;
  v_i           integer;
  v_j           integer;
  v_dia_id      uuid;
  v_sit_ant     text;
  v_origem_ant  text;
  v_existe      boolean;
begin
  if not (select public.has_permissao('folha_ponto.lancar')) then
    raise exception using errcode = '42501',
      message = 'folha_ponto_dias_salvar: requer a permissao folha_ponto.lancar.';
  end if;

  select c.funcionario_id into v_func from public.folha_ponto_cartoes c where c.id = p_cartao_id;
  if v_func is null then
    perform public.folha_ponto_falhar('cartao_inexistente', 'cartao-ponto nao encontrado.');
  end if;
  perform public.folha_travar_funcionario(v_func);
  select * into v_cartao from public.folha_ponto_cartoes c where c.id = p_cartao_id for update;
  if v_cartao.status <> 'em_preenchimento' then
    perform public.folha_ponto_falhar('cartao_fechado', 'cartao fechado -- reabra antes de alterar.');
  end if;
  if p_versao_esperada is distinct from v_cartao.versao then
    perform public.folha_ponto_falhar('cartao_alterado',
      format('o cartao foi alterado (versao %s, a tela abriu a %s). Recarregue.', v_cartao.versao, coalesce(p_versao_esperada::text, '-')));
  end if;

  if p_dias is null or jsonb_typeof(p_dias) <> 'array' or jsonb_array_length(p_dias) = 0 then
    perform public.folha_ponto_falhar('lote_vazio', 'nenhum dia para salvar.');
  end if;
  if jsonb_array_length(p_dias) > 62 then
    perform public.folha_ponto_falhar('lote_grande', 'no maximo 62 dias por envio.');
  end if;

  v_fim_comp := (v_cartao.competencia + interval '1 month' - interval '1 day')::date;
  v_usuario := (select u.nome from public.usuarios u where u.id = auth.uid());

  for v_item in select e.value from jsonb_array_elements(p_dias) with ordinality as e(value, ordem) order by e.ordem loop
    -- Data: real, dentro da competencia, uma vez so, nunca futura, no vinculo.
    if jsonb_typeof(v_item) <> 'object' or coalesce(v_item ->> 'data', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      perform public.folha_ponto_falhar('data_fora_competencia', 'data invalida.');
    end if;
    begin
      v_data := (v_item ->> 'data')::date;
    exception when others then
      v_data := null;
    end;
    if v_data is null or v_data < v_cartao.competencia or v_data > v_fim_comp then
      perform public.folha_ponto_falhar('data_fora_competencia', format('%s fora da competencia do cartao.', v_item ->> 'data'));
    end if;
    if v_data = any(v_vistas) then
      perform public.folha_ponto_falhar('data_repetida', format('%s enviado duas vezes.', v_data));
    end if;
    v_vistas := v_vistas || v_data;
    if v_data > v_hoje then
      perform public.folha_ponto_falhar('data_futura', format('%s ainda nao ocorreu.', v_data));
    end if;
    if not public.folha_ponto_vinculo_dia(v_func, v_data) then
      perform public.folha_ponto_falhar('fora_vinculo', format('%s fora do vinculo CLT.', v_data));
    end if;

    -- Situacao: igual a da Escala = segue a Escala (null); ajuste exige motivo.
    v_escala := public.folha_ponto_escala_dia(v_func, v_data);
    v_sit_escala := public.folha_ponto_situacao_escala(v_escala);
    v_sit := v_item ->> 'situacao';
    if v_sit = v_sit_escala then
      v_sit := null;
    end if;
    if v_sit is not null and v_sit not in ('trabalho', 'folga', 'falta') then
      perform public.folha_ponto_falhar('situacao_invalida', format('situacao invalida (%s) -- atestado e registrado como atestado.', v_sit));
    end if;
    v_motivo := case when v_sit is null then null
                     else nullif(btrim(coalesce(v_item ->> 'motivo', ''), E' \t\n\r'), '') end;
    if v_sit is not null and v_motivo is null then
      perform public.folha_ponto_falhar('motivo_obrigatorio', format('%s: informe o motivo do ajuste.', v_data));
    end if;
    if char_length(v_motivo) > 500 then
      perform public.folha_ponto_falhar('motivo_longo', 'motivo ate 500 caracteres.');
    end if;
    if v_sit = 'falta' and v_escala ->> 'tipo' = 'folga' then
      perform public.folha_ponto_falhar('ajuste_invalido', format('%s: falta nao se aplica a folga da Escala.', v_data));
    end if;

    -- Periodos realizados.
    v_periodos := coalesce(nullif(v_item -> 'periodos', 'null'::jsonb), '[]'::jsonb);
    if jsonb_typeof(v_periodos) <> 'array' then
      perform public.folha_ponto_falhar('hora_invalida', 'periodos deve ser uma lista.');
    end if;
    if jsonb_array_length(v_periodos) > 0 and coalesce(v_sit, v_sit_escala) <> 'trabalho' then
      perform public.folha_ponto_falhar('lancamento_exige_trabalho', format('%s: horarios so em dia de trabalho.', v_data));
    end if;
    if jsonb_array_length(v_periodos) > 0 and exists (
         select 1 from public.folha_ponto_atestados a
         where a.funcionario_id = v_func and a.status = 'ativo' and a.abrangencia = 'integral'
           and a.data_inicio <= v_data and a.data_fim >= v_data) then
      perform public.folha_ponto_falhar('dia_com_atestado_integral', format('%s coberto por atestado integral.', v_data));
    end if;
    if jsonb_array_length(v_periodos) > 6 then
      perform public.folha_ponto_falhar('periodos_demais', 'no maximo 6 periodos por dia.');
    end if;
    for v_i in 0 .. jsonb_array_length(v_periodos) - 1 loop
      v_el := v_periodos -> v_i;
      if not (public.folha_ponto_hora_valida(v_el ->> 'entrada') and public.folha_ponto_hora_valida(v_el ->> 'saida')) then
        perform public.folha_ponto_falhar('hora_invalida', 'horario invalido (HH:MM).');
      end if;
      if public.folha_ponto_minutos(v_el ->> 'saida') <= public.folha_ponto_minutos(v_el ->> 'entrada') then
        perform public.folha_ponto_falhar('periodo_invalido', 'a saida precisa ser depois da entrada.');
      end if;
      for v_j in 0 .. v_i - 1 loop
        v_outro := v_periodos -> v_j;
        if public.folha_ponto_minutos(v_el ->> 'entrada') < public.folha_ponto_minutos(v_outro ->> 'saida')
           and public.folha_ponto_minutos(v_outro ->> 'entrada') < public.folha_ponto_minutos(v_el ->> 'saida') then
          perform public.folha_ponto_falhar('periodos_sobrepostos', 'periodos trabalhados sobrepostos.');
        end if;
      end loop;
    end loop;

    v_obs := nullif(btrim(coalesce(v_item ->> 'observacao', ''), E' \t\n\r'), '');
    if char_length(v_obs) > 500 then
      perform public.folha_ponto_falhar('observacao_longa', 'observacao ate 500 caracteres.');
    end if;

    -- Grava (substitui o dia inteiro).
    select d.id, d.situacao, d.situacao_escala_no_ajuste into v_dia_id, v_sit_ant, v_origem_ant
    from public.folha_ponto_dias d where d.cartao_id = p_cartao_id and d.data = v_data;
    v_existe := found;

    if v_sit is null and v_obs is null and jsonb_array_length(v_periodos) = 0 then
      if v_existe then
        delete from public.folha_ponto_dias where id = v_dia_id;
      end if;
    else
      if v_existe then
        update public.folha_ponto_dias
        set situacao = v_sit,
            motivo = v_motivo,
            situacao_escala_no_ajuste = case when v_sit is null then null
                                             when v_sit is not distinct from v_sit_ant then v_origem_ant
                                             else v_sit_escala end,
            observacao = v_obs,
            atualizado_em = now(),
            atualizado_por = auth.uid(),
            atualizado_por_nome = v_usuario
        where id = v_dia_id;
        delete from public.folha_ponto_periodos where dia_id = v_dia_id;
      else
        insert into public.folha_ponto_dias (cartao_id, data, situacao, motivo, situacao_escala_no_ajuste, observacao, criado_por, criado_por_nome)
        values (p_cartao_id, v_data, v_sit, v_motivo, case when v_sit is null then null else v_sit_escala end, v_obs, auth.uid(), v_usuario)
        returning id into v_dia_id;
      end if;
      insert into public.folha_ponto_periodos (dia_id, entrada, saida)
      select v_dia_id, (e ->> 'entrada')::time, (e ->> 'saida')::time
      from jsonb_array_elements(v_periodos) e;
    end if;

    if v_sit is distinct from v_sit_ant then
      insert into public.folha_ponto_eventos (funcionario_id, cartao_id, acao, data, situacao_anterior, situacao_nova, motivo, dados,
                                              versao, criado_por, criado_por_nome)
      values (v_func, p_cartao_id, 'ajustar_situacao', v_data, v_sit_ant, v_sit, v_motivo,
              jsonb_build_object('situacao_escala', v_sit_escala), v_cartao.versao + 1, auth.uid(), v_usuario);
    end if;
  end loop;

  update public.folha_ponto_cartoes
  set versao = versao + 1,
      conferido_em = null, conferido_por = null, conferido_por_nome = null, conferido_hash = null,
      atualizado_em = now(), atualizado_por = auth.uid(), atualizado_por_nome = v_usuario
  where id = p_cartao_id;

  return v_cartao.versao + 1;
end;
$$;

comment on function public.folha_ponto_dias_salvar(uuid, integer, jsonb) is
  'Migration 0078. Salva 1 a 62 dias do cartao (lancar horas, ajustar situacao trabalho/folga/falta com motivo, observacao, "Repetir horarios"), tudo ou nada. Cada item substitui o lancamento do dia; item vazio apaga. Recusa: data fora da competencia/repetida/FUTURA (folha_hoje)/fora do vinculo; ajuste sem motivo; atestado como ajuste (use folha_ponto_atestado_salvar); falta em folga da Escala; horarios fora de dia de trabalho ou em dia coberto por atestado integral; horario invalido, saida <= entrada, sobreposicao. Situacao igual a da Escala = segue a Escala. Data passada: sempre aceita (sem limite de antiguidade). Cartao em preenchimento e na versao esperada; versao +1 e conferencia desfeita. Requer folha_ponto.lancar.';

-- Registra (p_atestado_id NULL) ou altera um atestado -- folha_ponto.lancar.
-- Integral: data_inicio..data_fim (N dias, sem limite, PODE incluir datas
-- futuras; descricao opcional). Parcial: um dia, hora_inicio..hora_fim. MESMAS validacoes de
-- campo de lib/ponto/lancamento.js validarAtestado; aqui tambem: todos os
-- dias no vinculo CLT, nenhum cartao fechado nas competencias tocadas
-- (antes e depois), integral nao cobre dia com horario trabalhado. Os
-- cartoes abertos tocados perdem a conferencia. Devolve {atestado_id,
-- versao}.
create function public.folha_ponto_atestado_salvar(
  p_atestado_id      uuid,
  p_versao_esperada  integer,
  p_funcionario_id   uuid,
  p_tipo             text,
  p_abrangencia      text,
  p_data_inicio      date,
  p_data_fim         date,
  p_hora_inicio      text,
  p_hora_fim         text,
  p_descricao        text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antigo     public.folha_ponto_atestados%rowtype;
  v_func       uuid;
  v_descricao  text;
  v_hora_ini   text;
  v_hora_fim   text;
  v_id         uuid;
  v_versao     integer;
  v_usuario    text;
  v_antes      jsonb;
begin
  if not (select public.has_permissao('folha_ponto.lancar')) then
    raise exception using errcode = '42501',
      message = 'folha_ponto_atestado_salvar: requer a permissao folha_ponto.lancar.';
  end if;

  if p_atestado_id is not null then
    select a.funcionario_id into v_func from public.folha_ponto_atestados a where a.id = p_atestado_id;
    if v_func is null then
      perform public.folha_ponto_falhar('atestado_inexistente', 'atestado nao encontrado.');
    end if;
  else
    if p_funcionario_id is null or not exists (select 1 from public.funcionarios f where f.id = p_funcionario_id) then
      perform public.folha_ponto_falhar('funcionario_inexistente', 'funcionaria nao encontrada.');
    end if;
    v_func := p_funcionario_id;
  end if;

  perform public.folha_travar_funcionario(v_func);

  if p_atestado_id is not null then
    select * into v_antigo from public.folha_ponto_atestados a where a.id = p_atestado_id for update;
    if v_antigo.status <> 'ativo' then
      perform public.folha_ponto_falhar('atestado_cancelado', 'atestado cancelado nao pode ser alterado.');
    end if;
    if p_versao_esperada is distinct from v_antigo.versao then
      perform public.folha_ponto_falhar('atestado_alterado',
        format('o atestado foi alterado (versao %s, a tela abriu a %s). Recarregue.', v_antigo.versao, coalesce(p_versao_esperada::text, '-')));
    end if;
  end if;

  -- Campos (mesma ordem de validarAtestado).
  if p_tipo is null or p_tipo not in ('atestado_medico', 'comparecimento', 'outro') then
    perform public.folha_ponto_falhar('atestado_tipo_invalido', 'tipo de atestado invalido.');
  end if;
  v_descricao := nullif(btrim(coalesce(p_descricao, ''), E' \t\n\r'), '');
  if char_length(v_descricao) > 500 then
    perform public.folha_ponto_falhar('observacao_longa', 'descricao ate 500 caracteres.');
  end if;
  if p_abrangencia is null or p_abrangencia not in ('integral', 'parcial') then
    perform public.folha_ponto_falhar('atestado_abrangencia_invalida', 'abrangencia invalida.');
  end if;
  if p_data_inicio is null or p_data_fim is null or p_data_fim < p_data_inicio then
    perform public.folha_ponto_falhar('atestado_periodo_invalido', 'periodo do atestado invalido.');
  end if;
  if p_abrangencia = 'parcial' then
    if p_data_inicio <> p_data_fim then
      perform public.folha_ponto_falhar('atestado_parcial_um_dia', 'atestado parcial vale para um unico dia.');
    end if;
    if not (public.folha_ponto_hora_valida(p_hora_inicio) and public.folha_ponto_hora_valida(p_hora_fim)) then
      perform public.folha_ponto_falhar('hora_invalida', 'horario invalido (HH:MM).');
    end if;
    if public.folha_ponto_minutos(p_hora_fim) <= public.folha_ponto_minutos(p_hora_inicio) then
      perform public.folha_ponto_falhar('atestado_horario_invalido', 'o fim do atestado precisa ser depois do inicio.');
    end if;
    v_hora_ini := p_hora_inicio;
    v_hora_fim := p_hora_fim;
  end if;
  if exists (
       select 1 from public.folha_ponto_atestados o
       where o.funcionario_id = v_func and o.status = 'ativo' and o.id is distinct from p_atestado_id
         and o.data_inicio <= p_data_fim and o.data_fim >= p_data_inicio
         and (o.abrangencia = 'integral' or p_abrangencia = 'integral'
              or (o.hora_inicio < v_hora_fim::time and v_hora_ini::time < o.hora_fim))) then
    perform public.folha_ponto_falhar('atestado_sobreposto', 'ja existe atestado ativo nesse periodo.');
  end if;

  -- Regras que dependem do banco. Vinculo: na alteracao so os dias
  -- ACRESCENTADOS -- o documento original e mantido mesmo que o
  -- desligamento venha depois (a apuracao ignora os dias fora do vinculo).
  if exists (select 1 from generate_series(p_data_inicio::timestamp, p_data_fim::timestamp, interval '1 day') g
             where (p_atestado_id is null or g::date not between v_antigo.data_inicio and v_antigo.data_fim)
               and not public.folha_ponto_vinculo_dia(v_func, g::date)) then
    perform public.folha_ponto_falhar('fora_vinculo', 'o atestado cobre dia fora do vinculo CLT.');
  end if;
  if (p_atestado_id is null and public.folha_ponto_periodo_fechado(v_func, p_data_inicio, p_data_fim))
     or (p_atestado_id is not null and public.folha_ponto_alteracao_toca_fechado(v_func, v_antigo.data_inicio, v_antigo.data_fim,
           p_data_inicio, p_data_fim,
           (p_tipo, p_abrangencia, v_hora_ini::time, v_hora_fim::time, v_descricao)
             is not distinct from (v_antigo.tipo, v_antigo.abrangencia, v_antigo.hora_inicio, v_antigo.hora_fim, v_antigo.descricao))) then
    perform public.folha_ponto_falhar('cartao_fechado', 'o atestado cobre competencia com cartao fechado (so a ponta em competencia aberta pode mudar).');
  end if;
  if p_abrangencia = 'integral' and exists (
       select 1 from public.folha_ponto_periodos pp
       join public.folha_ponto_dias d on d.id = pp.dia_id
       join public.folha_ponto_cartoes c on c.id = d.cartao_id
       where c.funcionario_id = v_func and d.data between p_data_inicio and p_data_fim) then
    perform public.folha_ponto_falhar('atestado_com_trabalho', 'ha horario trabalhado num dos dias -- use atestado parcial.');
  end if;

  v_usuario := (select u.nome from public.usuarios u where u.id = auth.uid());

  if p_atestado_id is null then
    insert into public.folha_ponto_atestados (funcionario_id, tipo, abrangencia, data_inicio, data_fim, hora_inicio, hora_fim, descricao,
                                              criado_por, criado_por_nome)
    values (v_func, p_tipo, p_abrangencia, p_data_inicio, p_data_fim, v_hora_ini::time, v_hora_fim::time, v_descricao, auth.uid(), v_usuario)
    returning id, versao into v_id, v_versao;
  else
    v_antes := jsonb_build_object('tipo', v_antigo.tipo, 'abrangencia', v_antigo.abrangencia,
                                  'data_inicio', v_antigo.data_inicio, 'data_fim', v_antigo.data_fim,
                                  'hora_inicio', substr(v_antigo.hora_inicio::text, 1, 5), 'hora_fim', substr(v_antigo.hora_fim::text, 1, 5),
                                  'descricao', v_antigo.descricao);
    update public.folha_ponto_atestados
    set tipo = p_tipo, abrangencia = p_abrangencia, data_inicio = p_data_inicio, data_fim = p_data_fim,
        hora_inicio = v_hora_ini::time, hora_fim = v_hora_fim::time, descricao = v_descricao,
        versao = versao + 1, atualizado_em = now(), atualizado_por = auth.uid(), atualizado_por_nome = v_usuario
    where id = p_atestado_id
    returning id, versao into v_id, v_versao;
    perform public.folha_ponto_invalidar_cartoes(v_func, v_antigo.data_inicio, v_antigo.data_fim, v_usuario);
  end if;

  perform public.folha_ponto_invalidar_cartoes(v_func, p_data_inicio, p_data_fim, v_usuario);

  insert into public.folha_ponto_eventos (funcionario_id, atestado_id, acao, dados, versao, criado_por, criado_por_nome)
  values (v_func, v_id, case when p_atestado_id is null then 'atestado_registrar' else 'atestado_alterar' end,
          jsonb_build_object('antes', v_antes,
                             'depois', jsonb_build_object('tipo', p_tipo, 'abrangencia', p_abrangencia,
                                                          'data_inicio', p_data_inicio, 'data_fim', p_data_fim,
                                                          'hora_inicio', v_hora_ini, 'hora_fim', v_hora_fim, 'descricao', v_descricao)),
          v_versao, auth.uid(), v_usuario);

  return jsonb_build_object('atestado_id', v_id, 'versao', v_versao);
end;
$$;

comment on function public.folha_ponto_atestado_salvar(uuid, integer, uuid, text, text, date, date, text, text, text) is
  'Migration 0078. Registra ou altera (versao esperada) um ATESTADO: integral de N dias consecutivos, sem limite (datas futuras permitidas -- nunca vira marcacao de ponto) ou parcial (um dia, inicio/fim). Descricao opcional (observacao administrativa; vazia = null, nunca texto ficticio). Recusa sobreposicao com outro atestado ativo, dia fora do vinculo CLT (na alteracao, so os dias acrescentados: desligamento posterior nao invalida o documento; a apuracao so considera os dias dentro do vinculo), competencia com cartao fechado (na alteracao, so contam os dias cuja cobertura muda: a ponta de um afastamento longo em competencia aberta pode ser encurtada/alongada mesmo com meses anteriores fechados; tipo/abrangencia/horas/descricao so mudam se nenhum mes coberto estiver fechado) e integral sobre dia com horario trabalhado. Falta da Escala coberta por atestado integral passa a ser considerada Atestado no cartao (a Escala nao muda). Cartoes abertos tocados avancam a versao e perdem a conferencia. Historico com antes/depois. Requer folha_ponto.lancar.';

-- Cancela (logicamente) um atestado -- folha_ponto.lancar. Motivo
-- obrigatorio; nunca em competencia com cartao fechado.
create function public.folha_ponto_atestado_cancelar(p_atestado_id uuid, p_versao_esperada integer, p_motivo text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atestado public.folha_ponto_atestados%rowtype;
  v_func     uuid;
  v_motivo   text;
  v_usuario  text;
begin
  if not (select public.has_permissao('folha_ponto.lancar')) then
    raise exception using errcode = '42501',
      message = 'folha_ponto_atestado_cancelar: requer a permissao folha_ponto.lancar.';
  end if;
  v_motivo := nullif(btrim(coalesce(p_motivo, ''), E' \t\n\r'), '');
  if v_motivo is null then
    perform public.folha_ponto_falhar('cancelamento_motivo_obrigatorio', 'informe o motivo do cancelamento.');
  end if;
  if char_length(v_motivo) > 500 then
    perform public.folha_ponto_falhar('motivo_longo', 'motivo ate 500 caracteres.');
  end if;

  select a.funcionario_id into v_func from public.folha_ponto_atestados a where a.id = p_atestado_id;
  if v_func is null then
    perform public.folha_ponto_falhar('atestado_inexistente', 'atestado nao encontrado.');
  end if;
  perform public.folha_travar_funcionario(v_func);
  select * into v_atestado from public.folha_ponto_atestados a where a.id = p_atestado_id for update;
  if v_atestado.status <> 'ativo' then
    perform public.folha_ponto_falhar('atestado_cancelado', 'atestado ja cancelado.');
  end if;
  if p_versao_esperada is distinct from v_atestado.versao then
    perform public.folha_ponto_falhar('atestado_alterado',
      format('o atestado foi alterado (versao %s, a tela abriu a %s). Recarregue.', v_atestado.versao, coalesce(p_versao_esperada::text, '-')));
  end if;
  if public.folha_ponto_periodo_fechado(v_func, v_atestado.data_inicio, v_atestado.data_fim) then
    perform public.folha_ponto_falhar('cartao_fechado', 'o atestado cobre competencia com cartao fechado.');
  end if;

  v_usuario := (select u.nome from public.usuarios u where u.id = auth.uid());
  update public.folha_ponto_atestados
  set status = 'cancelado', versao = versao + 1,
      cancelado_em = now(), cancelado_por = auth.uid(), cancelado_por_nome = v_usuario, motivo_cancelamento = v_motivo
  where id = p_atestado_id;

  perform public.folha_ponto_invalidar_cartoes(v_func, v_atestado.data_inicio, v_atestado.data_fim, v_usuario);

  insert into public.folha_ponto_eventos (funcionario_id, atestado_id, acao, motivo, versao, criado_por, criado_por_nome)
  values (v_func, p_atestado_id, 'atestado_cancelar', v_motivo, v_atestado.versao + 1, auth.uid(), v_usuario);

  return v_atestado.versao + 1;
end;
$$;

comment on function public.folha_ponto_atestado_cancelar(uuid, integer, text) is
  'Migration 0078. Cancela LOGICAMENTE um atestado ativo (motivo obrigatorio, ate 500; quem/quando do servidor). O registro permanece consultavel; cancelado e final. Recusa se cobre competencia com cartao fechado. Cartoes abertos tocados perdem a conferencia. Requer folha_ponto.lancar.';

-- Conferir -- folha_ponto.fechar. Exige competencia encerrada para a
-- funcionaria e nenhum dia pendente; grava quem/quando + hash da base.
create function public.folha_ponto_cartao_conferir(p_cartao_id uuid, p_versao_esperada integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cartao  public.folha_ponto_cartoes%rowtype;
  v_func    uuid;
  v_base    jsonb;
  v_apur    jsonb;
  v_usuario text;
begin
  if not (select public.has_permissao('folha_ponto.fechar')) then
    raise exception using errcode = '42501',
      message = 'folha_ponto_cartao_conferir: requer a permissao folha_ponto.fechar.';
  end if;

  select c.funcionario_id into v_func from public.folha_ponto_cartoes c where c.id = p_cartao_id;
  if v_func is null then
    perform public.folha_ponto_falhar('cartao_inexistente', 'cartao-ponto nao encontrado.');
  end if;
  perform public.folha_travar_funcionario(v_func);
  select * into v_cartao from public.folha_ponto_cartoes c where c.id = p_cartao_id for update;
  if v_cartao.status <> 'em_preenchimento' then
    perform public.folha_ponto_falhar('cartao_fechado', 'cartao ja fechado.');
  end if;
  if p_versao_esperada is distinct from v_cartao.versao then
    perform public.folha_ponto_falhar('cartao_alterado',
      format('o cartao foi alterado (versao %s, a tela abriu a %s). Recarregue.', v_cartao.versao, coalesce(p_versao_esperada::text, '-')));
  end if;

  v_base := public.folha_ponto_montar_base(v_func, v_cartao.competencia);
  v_apur := public.folha_ponto_apurar(v_base);
  if not (v_apur ->> 'competencia_encerrada')::boolean then
    perform public.folha_ponto_falhar('competencia_em_andamento', 'a competencia ainda tem dias por vir para esta funcionaria.');
  end if;
  if (v_apur -> 'totais' ->> 'dias_pendentes')::integer > 0 then
    perform public.folha_ponto_falhar('pendencias', format('%s dia(s) pendente(s).', v_apur -> 'totais' ->> 'dias_pendentes'));
  end if;

  v_usuario := (select u.nome from public.usuarios u where u.id = auth.uid());
  update public.folha_ponto_cartoes
  set versao = versao + 1,
      conferido_em = now(), conferido_por = auth.uid(), conferido_por_nome = v_usuario,
      conferido_hash = public.folha_ponto_hash(v_base)
  where id = p_cartao_id;

  insert into public.folha_ponto_eventos (funcionario_id, cartao_id, acao, dados, versao, criado_por, criado_por_nome)
  values (v_func, p_cartao_id, 'conferir', jsonb_build_object('totais', v_apur -> 'totais'), v_cartao.versao + 1, auth.uid(), v_usuario);

  return v_cartao.versao + 1;
end;
$$;

comment on function public.folha_ponto_cartao_conferir(uuid, integer) is
  'Migration 0078. Marca o cartao como CONFERIDO (quem/quando + hash da base do mes): exige competencia encerrada para a funcionaria (nenhum dia do vinculo no futuro) e nenhum dia pendente (dia sem Escala inclusive), recalculando no banco (mesmas regras de lib/ponto/apuracao.js). Qualquer salvamento posterior (dia ou atestado) desfaz a conferencia. Requer folha_ponto.fechar.';

-- Fechar -- folha_ponto.fechar. Exige conferencia ATUAL (hash igual) e
-- recalcula tudo; grava o SNAPSHOT autossuficiente.
create function public.folha_ponto_cartao_fechar(p_cartao_id uuid, p_versao_esperada integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cartao   public.folha_ponto_cartoes%rowtype;
  v_func     uuid;
  v_base     jsonb;
  v_apur     jsonb;
  v_usuario  text;
  v_snapshot jsonb;
begin
  if not (select public.has_permissao('folha_ponto.fechar')) then
    raise exception using errcode = '42501',
      message = 'folha_ponto_cartao_fechar: requer a permissao folha_ponto.fechar.';
  end if;

  select c.funcionario_id into v_func from public.folha_ponto_cartoes c where c.id = p_cartao_id;
  if v_func is null then
    perform public.folha_ponto_falhar('cartao_inexistente', 'cartao-ponto nao encontrado.');
  end if;
  perform public.folha_travar_funcionario(v_func);
  select * into v_cartao from public.folha_ponto_cartoes c where c.id = p_cartao_id for update;
  if v_cartao.status <> 'em_preenchimento' then
    perform public.folha_ponto_falhar('cartao_fechado', 'cartao ja fechado.');
  end if;
  if p_versao_esperada is distinct from v_cartao.versao then
    perform public.folha_ponto_falhar('cartao_alterado',
      format('o cartao foi alterado (versao %s, a tela abriu a %s). Recarregue.', v_cartao.versao, coalesce(p_versao_esperada::text, '-')));
  end if;
  if v_cartao.conferido_em is null then
    perform public.folha_ponto_falhar('nao_conferido', 'confira o cartao antes de fechar.');
  end if;

  v_base := public.folha_ponto_montar_base(v_func, v_cartao.competencia);
  v_apur := public.folha_ponto_apurar(v_base);
  if not (v_apur ->> 'competencia_encerrada')::boolean then
    perform public.folha_ponto_falhar('competencia_em_andamento', 'a competencia ainda tem dias por vir para esta funcionaria.');
  end if;
  if (v_apur -> 'totais' ->> 'dias_pendentes')::integer > 0 then
    perform public.folha_ponto_falhar('pendencias', format('%s dia(s) pendente(s).', v_apur -> 'totais' ->> 'dias_pendentes'));
  end if;
  if public.folha_ponto_hash(v_base) is distinct from v_cartao.conferido_hash then
    perform public.folha_ponto_falhar('conferencia_desatualizada', 'a Escala ou o cartao mudou depois da conferencia.');
  end if;

  v_usuario := (select u.nome from public.usuarios u where u.id = auth.uid());
  v_snapshot := jsonb_build_object(
    'snapshot_versao', 1,
    'calculo_versao', v_apur -> 'calculo_versao',
    'base', v_base,
    'apuracao', v_apur,
    'empresa', (select jsonb_build_object('nome_fantasia', e.nome_fantasia, 'razao_social', e.razao_social,
                                          'cnpj', e.cnpj, 'cidade_uf', e.cidade_uf)
                from public.folha_documentos_config e where e.id),
    'conferido_em', v_cartao.conferido_em,
    'conferido_por_nome', v_cartao.conferido_por_nome,
    'fechado_em', now(),
    'fechado_por_nome', v_usuario);

  update public.folha_ponto_cartoes
  set versao = versao + 1,
      status = 'fechado',
      fechado_em = now(), fechado_por = auth.uid(), fechado_por_nome = v_usuario,
      snapshot = v_snapshot
  where id = p_cartao_id;

  insert into public.folha_ponto_eventos (funcionario_id, cartao_id, acao, dados, versao, criado_por, criado_por_nome)
  values (v_func, p_cartao_id, 'fechar', jsonb_build_object('totais', v_apur -> 'totais'), v_cartao.versao + 1, auth.uid(), v_usuario);

  return v_cartao.versao + 1;
end;
$$;

comment on function public.folha_ponto_cartao_fechar(uuid, integer) is
  'Migration 0078. FECHA o cartao: exige conferencia ATUAL (a base do mes -- Escala + lancamentos + atestados -- igual a conferida), competencia encerrada e nenhum pendente (recalculado no banco). Grava snapshot autossuficiente {base, apuracao, empresa, conferido/fechado} -- a partir daqui o cartao so e lido do snapshot; mudar a Escala nunca altera o documento; atestados que cobrem a competencia ficam travados. Nao gera nada em Pagamentos. Requer folha_ponto.fechar.';

-- Reabrir -- folha_ponto.reabrir. Motivo obrigatorio; o snapshot desfeito
-- fica no evento; volta para em preenchimento sem conferencia.
create function public.folha_ponto_cartao_reabrir(p_cartao_id uuid, p_versao_esperada integer, p_motivo text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cartao  public.folha_ponto_cartoes%rowtype;
  v_func    uuid;
  v_motivo  text;
  v_usuario text;
begin
  if not (select public.has_permissao('folha_ponto.reabrir')) then
    raise exception using errcode = '42501',
      message = 'folha_ponto_cartao_reabrir: requer a permissao folha_ponto.reabrir.';
  end if;
  v_motivo := nullif(btrim(coalesce(p_motivo, ''), E' \t\n\r'), '');
  if v_motivo is null then
    perform public.folha_ponto_falhar('reabertura_motivo_obrigatorio', 'informe o motivo da reabertura.');
  end if;
  if char_length(v_motivo) > 500 then
    perform public.folha_ponto_falhar('motivo_longo', 'motivo ate 500 caracteres.');
  end if;

  select c.funcionario_id into v_func from public.folha_ponto_cartoes c where c.id = p_cartao_id;
  if v_func is null then
    perform public.folha_ponto_falhar('cartao_inexistente', 'cartao-ponto nao encontrado.');
  end if;
  perform public.folha_travar_funcionario(v_func);
  select * into v_cartao from public.folha_ponto_cartoes c where c.id = p_cartao_id for update;
  if v_cartao.status <> 'fechado' then
    perform public.folha_ponto_falhar('cartao_aberto', 'o cartao nao esta fechado.');
  end if;
  if p_versao_esperada is distinct from v_cartao.versao then
    perform public.folha_ponto_falhar('cartao_alterado',
      format('o cartao foi alterado (versao %s, a tela abriu a %s). Recarregue.', v_cartao.versao, coalesce(p_versao_esperada::text, '-')));
  end if;

  v_usuario := (select u.nome from public.usuarios u where u.id = auth.uid());
  insert into public.folha_ponto_eventos (funcionario_id, cartao_id, acao, motivo, dados, versao, criado_por, criado_por_nome)
  values (v_func, p_cartao_id, 'reabrir', v_motivo,
          jsonb_build_object('snapshot', v_cartao.snapshot, 'fechado_em', v_cartao.fechado_em, 'fechado_por_nome', v_cartao.fechado_por_nome),
          v_cartao.versao + 1, auth.uid(), v_usuario);

  update public.folha_ponto_cartoes
  set versao = versao + 1,
      status = 'em_preenchimento',
      snapshot = null, fechado_em = null, fechado_por = null, fechado_por_nome = null,
      conferido_em = null, conferido_por = null, conferido_por_nome = null, conferido_hash = null,
      atualizado_em = now(), atualizado_por = auth.uid(), atualizado_por_nome = v_usuario
  where id = p_cartao_id;

  return v_cartao.versao + 1;
end;
$$;

comment on function public.folha_ponto_cartao_reabrir(uuid, integer, text) is
  'Migration 0078. REABRE um cartao fechado (motivo obrigatorio, ate 500): o snapshot desfeito e guardado no evento reabrir (historico completo de cada fechamento); volta para em preenchimento, sem conferencia. Sem trava financeira (o cartao nao alimenta Pagamentos). Requer folha_ponto.reabrir.';

-- Leitura do mes -- folha_ponto.visualizar. Qualquer competencia (passada,
-- atual ou futura so para ver o planejado e os atestados ja registrados).
-- Devolve a base (mesma forma de lib/ponto/apuracao.js) + cartao {id,
-- status, versao, conferencia (conferencia_atual = base igual a
-- conferida), fechamento, snapshot} ou null.
create function public.folha_ponto_base(p_funcionario_id uuid, p_competencia date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_competencia date;
  v_base        jsonb;
  v_cartao      jsonb;
begin
  if not (select public.has_permissao('folha_ponto.visualizar')) then
    raise exception using errcode = '42501',
      message = 'folha_ponto_base: requer a permissao folha_ponto.visualizar.';
  end if;
  if p_competencia is null then
    perform public.folha_ponto_falhar('competencia_invalida', 'informe a competencia.');
  end if;
  if p_funcionario_id is null or not exists (select 1 from public.funcionarios f where f.id = p_funcionario_id) then
    perform public.folha_ponto_falhar('funcionario_inexistente', 'funcionaria nao encontrada.');
  end if;
  v_competencia := date_trunc('month', p_competencia)::date;
  v_base := public.folha_ponto_montar_base(p_funcionario_id, v_competencia);

  select jsonb_build_object(
    'id', c.id,
    'status', c.status,
    'versao', c.versao,
    'conferido_em', c.conferido_em,
    'conferido_por_nome', c.conferido_por_nome,
    'conferencia_atual', c.conferido_hash is not null and c.conferido_hash = public.folha_ponto_hash(v_base),
    'fechado_em', c.fechado_em,
    'fechado_por_nome', c.fechado_por_nome,
    'criado_em', c.criado_em,
    'criado_por_nome', c.criado_por_nome,
    'atualizado_em', c.atualizado_em,
    'atualizado_por_nome', c.atualizado_por_nome,
    'snapshot', c.snapshot)
  into v_cartao
  from public.folha_ponto_cartoes c
  where c.funcionario_id = p_funcionario_id and c.competencia = v_competencia;

  return v_base || jsonb_build_object('cartao', v_cartao);
end;
$$;

comment on function public.folha_ponto_base(uuid, date) is
  'Migration 0078. Leitura do Cartao-Ponto de 1 funcionaria numa competencia: base do mes (funcionaria, hoje, atestados ativos que tocam o mes, vinculo/feriado/Escala/lancamento por dia -- entrada de lib/ponto/apuracao.js) + cartao (ou null). Cartao fechado: a tela/PDF/Excel usam SO cartao.snapshot. Le a Escala por SECURITY DEFINER (quem ve o cartao ve o previsto que ele usa). Requer folha_ponto.visualizar.';

-- Resumo da competencia (lista da tela) -- folha_ponto.visualizar:
-- funcionarias com algum dia no vinculo CLT no mes (ou que ja tenham
-- cartao nela) + status do cartao.
create function public.folha_ponto_competencia_resumo(p_competencia date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_competencia date;
begin
  if not (select public.has_permissao('folha_ponto.visualizar')) then
    raise exception using errcode = '42501',
      message = 'folha_ponto_competencia_resumo: requer a permissao folha_ponto.visualizar.';
  end if;
  if p_competencia is null then
    perform public.folha_ponto_falhar('competencia_invalida', 'informe a competencia.');
  end if;
  v_competencia := date_trunc('month', p_competencia)::date;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'funcionario_id', f.id,
      'nome', f.nome,
      'cargo', cg.nome,
      'ativo', f.ativo,
      'cartao_id', c.id,
      'status', c.status,
      'versao', c.versao,
      'conferido', c.conferido_em is not null) order by lower(f.nome), f.id)
    from public.funcionarios f
    left join public.funcionarios_cargos cg on cg.id = f.cargo_id
    left join public.folha_ponto_cartoes c on c.funcionario_id = f.id and c.competencia = v_competencia
    where c.id is not null or public.folha_ponto_tem_vinculo(f.id, v_competencia)), '[]'::jsonb);
end;
$$;

comment on function public.folha_ponto_competencia_resumo(date) is
  'Migration 0078. Funcionarias da competencia para o Cartao-Ponto (algum dia do mes no vinculo CLT, ou cartao ja existente) com o status do cartao. Requer folha_ponto.visualizar.';

-- ============================================================
-- 6. EXECUTE -- internas para ninguem; RPCs so para authenticated.
-- ============================================================
revoke execute on function public.folha_ponto_falhar(text, text) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_minutos(text) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_hora_valida(text) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_duracao(jsonb, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_lacunas(jsonb, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_categorias(jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_situacao_escala(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_apurar_dia(jsonb, jsonb, jsonb, date) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_apurar(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_hash(jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_funcionario_json(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_escala_dia(uuid, date) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_lancamento_dia(uuid, date, date) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_atestados_json(uuid, date, date) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_montar_base(uuid, date) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_vinculo_dia(uuid, date) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_tem_vinculo(uuid, date) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_periodo_fechado(uuid, date, date) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_alteracao_toca_fechado(uuid, date, date, date, date, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_invalidar_cartoes(uuid, date, date, text) from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_bloquear_exclusao_fn() from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_eventos_guarda_fn() from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_cartoes_guarda_fn() from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_dias_guarda_fn() from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_periodos_guarda_fn() from public, anon, authenticated, service_role;
revoke execute on function public.folha_ponto_atestados_guarda_fn() from public, anon, authenticated, service_role;

revoke execute on function public.folha_ponto_cartao_abrir(uuid, date) from public, anon, service_role;
revoke execute on function public.folha_ponto_dias_salvar(uuid, integer, jsonb) from public, anon, service_role;
revoke execute on function public.folha_ponto_atestado_salvar(uuid, integer, uuid, text, text, date, date, text, text, text) from public, anon, service_role;
revoke execute on function public.folha_ponto_atestado_cancelar(uuid, integer, text) from public, anon, service_role;
revoke execute on function public.folha_ponto_cartao_conferir(uuid, integer) from public, anon, service_role;
revoke execute on function public.folha_ponto_cartao_fechar(uuid, integer) from public, anon, service_role;
revoke execute on function public.folha_ponto_cartao_reabrir(uuid, integer, text) from public, anon, service_role;
revoke execute on function public.folha_ponto_base(uuid, date) from public, anon, service_role;
revoke execute on function public.folha_ponto_competencia_resumo(date) from public, anon, service_role;
grant execute on function public.folha_ponto_cartao_abrir(uuid, date) to authenticated;
grant execute on function public.folha_ponto_dias_salvar(uuid, integer, jsonb) to authenticated;
grant execute on function public.folha_ponto_atestado_salvar(uuid, integer, uuid, text, text, date, date, text, text, text) to authenticated;
grant execute on function public.folha_ponto_atestado_cancelar(uuid, integer, text) to authenticated;
grant execute on function public.folha_ponto_cartao_conferir(uuid, integer) to authenticated;
grant execute on function public.folha_ponto_cartao_fechar(uuid, integer) to authenticated;
grant execute on function public.folha_ponto_cartao_reabrir(uuid, integer, text) to authenticated;
grant execute on function public.folha_ponto_base(uuid, date) to authenticated;
grant execute on function public.folha_ponto_competencia_resumo(date) to authenticated;

-- ============================================================
-- 7. Permissoes -- 4 codigos, SOMENTE proprietario_admin.
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('folha_ponto.visualizar', 'folha_ponto', 'visualizar', 'Ver o Cartao-Ponto das funcionarias (jornada prevista x realizada, atestados, totais em horas) e exportar PDF/Excel.'),
  ('folha_ponto.lancar',     'folha_ponto', 'lancar',     'Abrir o cartao da competencia e lancar horarios realizados, ajustes de situacao (com motivo), observacoes e atestados (registrar/alterar/cancelar).'),
  ('folha_ponto.fechar',     'folha_ponto', 'fechar',     'Conferir e fechar o Cartao-Ponto da competencia (congela o documento).'),
  ('folha_ponto.reabrir',    'folha_ponto', 'reabrir',    'Reabrir um Cartao-Ponto fechado (motivo obrigatorio, registrado no historico).')
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil, permissao) values
  ('proprietario_admin', 'folha_ponto.visualizar'),
  ('proprietario_admin', 'folha_ponto.lancar'),
  ('proprietario_admin', 'folha_ponto.fechar'),
  ('proprietario_admin', 'folha_ponto.reabrir')
on conflict do nothing;

-- ============================================================
-- 8. RLS e grants -- SOMENTE leitura para authenticated.
-- ============================================================
alter table public.folha_ponto_cartoes enable row level security;
alter table public.folha_ponto_dias enable row level security;
alter table public.folha_ponto_periodos enable row level security;
alter table public.folha_ponto_atestados enable row level security;
alter table public.folha_ponto_eventos enable row level security;

create policy folha_ponto_cartoes_select on public.folha_ponto_cartoes
  for select to authenticated using ((select public.has_permissao('folha_ponto.visualizar')));
create policy folha_ponto_dias_select on public.folha_ponto_dias
  for select to authenticated using ((select public.has_permissao('folha_ponto.visualizar')));
create policy folha_ponto_periodos_select on public.folha_ponto_periodos
  for select to authenticated using ((select public.has_permissao('folha_ponto.visualizar')));
create policy folha_ponto_atestados_select on public.folha_ponto_atestados
  for select to authenticated using ((select public.has_permissao('folha_ponto.visualizar')));
create policy folha_ponto_eventos_select on public.folha_ponto_eventos
  for select to authenticated using ((select public.has_permissao('folha_ponto.visualizar')));

revoke all on public.folha_ponto_cartoes, public.folha_ponto_dias, public.folha_ponto_periodos,
              public.folha_ponto_atestados, public.folha_ponto_eventos from public, anon;
revoke all on public.folha_ponto_cartoes, public.folha_ponto_dias, public.folha_ponto_periodos,
              public.folha_ponto_atestados, public.folha_ponto_eventos from authenticated;
grant select on public.folha_ponto_cartoes, public.folha_ponto_dias, public.folha_ponto_periodos,
                public.folha_ponto_atestados, public.folha_ponto_eventos to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (manual, SO antes de existir cartao/atestado real -- as guardas
-- impedem apagar linhas; drop table remove tudo):
-- BEGIN;
-- drop function if exists public.folha_ponto_competencia_resumo(date);
-- drop function if exists public.folha_ponto_base(uuid, date);
-- drop function if exists public.folha_ponto_cartao_reabrir(uuid, integer, text);
-- drop function if exists public.folha_ponto_cartao_fechar(uuid, integer);
-- drop function if exists public.folha_ponto_cartao_conferir(uuid, integer);
-- drop function if exists public.folha_ponto_atestado_cancelar(uuid, integer, text);
-- drop function if exists public.folha_ponto_atestado_salvar(uuid, integer, uuid, text, text, date, date, text, text, text);
-- drop function if exists public.folha_ponto_dias_salvar(uuid, integer, jsonb);
-- drop function if exists public.folha_ponto_cartao_abrir(uuid, date);
-- drop table if exists public.folha_ponto_eventos;
-- drop table if exists public.folha_ponto_atestados;
-- drop table if exists public.folha_ponto_periodos;
-- drop table if exists public.folha_ponto_dias;
-- drop table if exists public.folha_ponto_cartoes;
-- drop function if exists public.folha_ponto_atestados_guarda_fn();
-- drop function if exists public.folha_ponto_periodos_guarda_fn();
-- drop function if exists public.folha_ponto_dias_guarda_fn();
-- drop function if exists public.folha_ponto_cartoes_guarda_fn();
-- drop function if exists public.folha_ponto_eventos_guarda_fn();
-- drop function if exists public.folha_ponto_bloquear_exclusao_fn();
-- drop function if exists public.folha_ponto_invalidar_cartoes(uuid, date, date, text);
-- drop function if exists public.folha_ponto_alteracao_toca_fechado(uuid, date, date, date, date, boolean);
-- drop function if exists public.folha_ponto_periodo_fechado(uuid, date, date);
-- drop function if exists public.folha_ponto_tem_vinculo(uuid, date);
-- drop function if exists public.folha_ponto_vinculo_dia(uuid, date);
-- drop function if exists public.folha_ponto_hash(jsonb);
-- drop function if exists public.folha_ponto_montar_base(uuid, date);
-- drop function if exists public.folha_ponto_atestados_json(uuid, date, date);
-- drop function if exists public.folha_ponto_lancamento_dia(uuid, date, date);
-- drop function if exists public.folha_ponto_escala_dia(uuid, date);
-- drop function if exists public.folha_ponto_funcionario_json(uuid);
-- drop function if exists public.folha_ponto_apurar(jsonb);
-- drop function if exists public.folha_ponto_apurar_dia(jsonb, jsonb, jsonb, date);
-- drop function if exists public.folha_ponto_situacao_escala(jsonb);
-- drop function if exists public.folha_ponto_categorias(jsonb, jsonb, jsonb);
-- drop function if exists public.folha_ponto_lacunas(jsonb, text, text);
-- drop function if exists public.folha_ponto_duracao(jsonb, text, text);
-- drop function if exists public.folha_ponto_hora_valida(text);
-- drop function if exists public.folha_ponto_minutos(text);
-- drop function if exists public.folha_ponto_falhar(text, text);
-- delete from public.perfil_permissoes where permissao like 'folha\_ponto.%';
-- delete from public.usuario_permissoes where permissao like 'folha\_ponto.%';
-- delete from public.permissoes where codigo like 'folha\_ponto.%';
-- COMMIT;
-- ============================================================
