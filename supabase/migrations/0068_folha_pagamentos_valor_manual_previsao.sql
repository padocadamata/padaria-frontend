-- 0068_folha_pagamentos_valor_manual_previsao.sql
-- FOLHA DE PAGAMENTO > PAGAMENTOS -- pendencias finais da FOPAG.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor,
-- depois de conferir a pre-auditoria. Pre-requisito: 0065, 0066 e 0067
-- aplicadas (abortada logo no inicio se a 0067 nao estiver aplicada).
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1. VALOR MANUAL POR JORNADA (folha_pagamentos_itens):
--      * colunas novas valor_calculado (sugestao automatica = duracao/60 *
--        valor/hora vigente na data; NULL quando nao ha valor/hora
--        vigente), valor_manual (true quando o valor pago difere do
--        calculado ou nao havia calculo) e observacao_ajuste (opcional);
--      * valor_hora_aplicado deixa de ser NOT NULL (somente a
--        regularizacao historica -- item 8 -- grava sem valor/hora; nunca
--        se inventa taxa retroativa);
--      * backfill das linhas existentes (valor_calculado = valor,
--        valor_manual = false -- exatamente o que a 0066/0067 gravavam);
--      * CHECKs de coerencia entre valor/hora, calculado, pago e manual.
--      O valor/hora GLOBAL (folha_valor_hora) NAO e alterado; o ajuste
--      pertence somente aquela jornada (funcionario+data+hora_inicio+
--      hora_fim) daquele pagamento.
--   2. CREATE OR REPLACE folha_criar_pagamento_por_hora e
--      folha_criar_pagamento_mensal (MESMAS assinaturas): cada jornada/
--      extra aceita opcionalmente "valor" (valor a pagar) e
--      "observacao_ajuste". Sem "valor" = automatico (comportamento
--      anterior). Jornada/extra anterior ao corte = recusado, com
--      indicacao da regularizacao historica (item 8). A remuneracao-base mensal NUNCA vira valor por
--      jornada: o ajuste manual so existe nos itens (jornadas por hora e
--      extras remunerados); a regra Integral da 0067 e todas as regras da
--      0066 permanecem identicas.
--   3. Pendencias (folha_calcular_pendencias_por_hora /
--      folha_calcular_pendencia_mensal): DROP + CREATE para acrescentar
--      a coluna data_prevista (somente informativa). Mesmas regras de
--      elegibilidade da 0066, apenas restritas a datas >= corte (as
--      anteriores aparecem na listagem de regularizacao historica).
--   4. DATA PREVISTA de pagamento (somente previsao/organizacao -- nunca
--      bloqueia, nunca altera elegibilidade): helpers internos que
--      resolvem a preferencia (funcionarios_preferencia_pagamento) numa
--      data real. Dia util = segunda a sexta, exceto datas cadastradas em
--      public.feriados_nacionais (0010, fonte unica de feriados do
--      sistema -- reaproveitada, nenhuma tabela nova de calendario).
--   5. Feriados: RPCs folha_registrar_feriado / folha_remover_feriado
--      (folha_pagamentos.regras) para manter public.feriados_nacionais
--      pela tela de Configuracoes. Nenhum seed (nada e inventado).
--   6. PROTECAO FALTA/ATESTADO x JORNADA PAGA: trigger BEFORE INSERT/
--      UPDATE em funcionarios_escala_ocorrencias -- nao permite registrar
--      falta/atestado num dia que tenha jornada/extra em pagamento ATIVO
--      (cancelar o pagamento libera). Cobre a RPC registrar_ocorrencia_
--      escala e qualquer escrita direta.
--   7. IMUTABILIDADE dos pagamentos confirmados (defesa em profundidade):
--      triggers que impedem UPDATE de valores/snapshot em folha_pagamentos,
--      folha_pagamentos_itens e folha_pagamentos_descontos -- so o
--      cancelamento logico (status/pagamento_cancelado) e o
--      desligamento automatico de escala_periodo_id (FK on delete set
--      null) continuam possiveis.
--
--   8. REGULARIZACAO HISTORICA (jornadas anteriores ao CORTE):
--      CORTE = MIN(folha_valor_hora.vigente_desde) -- a primeira vigencia
--      global de valor/hora (hoje 01/10/2026; nunca fixo no codigo; sem
--      nenhuma vigencia cadastrada nao existe corte nem excecao). Antes
--      do corte nao existe valor/hora, entao NAO existe calculo -- e nao
--      e criada forma de remuneracao nem valor/hora retroativos. Uma
--      jornada da Escala com data < corte, sem falta/atestado, sem
--      pagamento ativo, pode ser registrada financeiramente com VALOR
--      MANUAL OBRIGATORIO (> 0), independente da forma cadastrada depois
--      (por_hora, mensal ou nenhuma). Excecao de seguranca: periodo NORMAL
--      de quem ja estava com forma MENSAL vigente naquela data fica de
--      fora (seria pago pela remuneracao-base; periodo extra_remunerado
--      continua regularizavel).
--      * cabecalho natureza = 'regularizacao_historica' (sem competencia,
--        sem base mensal, sem valor/hora) -- nunca consome saldo mensal,
--        nunca cria competencia, nunca vira "por_hora";
--      * item origem_valor = 'regularizacao_historica', valor_hora_aplicado
--        e valor_calculado NULL, valor = informado, valor_manual = true;
--      * RPCs folha_calcular_pendencias_historicas() e
--        folha_criar_pagamento_regularizacao_historica(...);
--      * a partir do corte nada muda: por_hora/mensal recusam jornada/
--        extra anterior ao corte (indicando a regularizacao historica) e
--        as pendencias normais so listam datas >= corte.
--   9. ORIGEM DO VALOR por item (folha_pagamentos_itens.origem_valor):
--      automatico | manual | regularizacao_historica -- distingue sem
--      ambiguidade calculo automatico, ajuste manual de jornada normal e
--      regularizacao historica (valor_manual continua existindo como
--      atalho coerente: true para manual e regularizacao_historica).
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em public.pagamentos (fornecedores/NF-e);
--   * nenhuma alteracao em 0065/0066/0067 (arquivos ja aplicados);
--   * nenhuma alteracao de folha_valor_hora, forma de remuneracao,
--     remuneracao-base ou preferencia de pagamento (dados);
--   * nenhum seed de feriados; nenhuma periodicidade quinzenal;
--   * nenhuma alteracao em aplicar_escala_em_lote (protecao K intacta).
--
-- Envolvida em transacao explicita (BEGIN/COMMIT).

BEGIN;

-- ============================================================
-- 0. Premissas -- aborta (sem nenhuma alteracao) se o banco nao estiver
--    no estado esperado.
-- ============================================================
do $$
declare
  v_src text;
begin
  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.folha_criar_pagamento_mensal(uuid,date,text,numeric,jsonb,jsonb,date,text)');
  if v_src is null or position('lancamento integral precisa quitar exatamente' in v_src) = 0 then
    raise exception '0068 abortada: a migration 0067 (integral = saldo) nao esta aplicada.';
  end if;
  if to_regprocedure('public.folha_criar_pagamento_por_hora(uuid,jsonb,jsonb,date,text)') is null
     or to_regprocedure('public.folha_travar_funcionario(uuid)') is null
     or to_regprocedure('public.folha_hoje()') is null
     or to_regprocedure('public.folha_tipo_vinculo_em(uuid,date)') is null then
    raise exception '0068 abortada: funcoes da 0066 ausentes.';
  end if;
  if to_regclass('public.feriados_nacionais') is null then
    raise exception '0068 abortada: public.feriados_nacionais (0010) nao existe.';
  end if;
  if to_regclass('public.funcionarios_preferencia_pagamento') is null then
    raise exception '0068 abortada: public.funcionarios_preferencia_pagamento (0065) nao existe.';
  end if;
  -- constraints do cabecalho que serao recriadas para a natureza nova
  if not exists (select 1 from pg_constraint where conrelid = 'public.folha_pagamentos'::regclass and conname = 'folha_pagamentos_competencia_coerente_com_natureza')
     or not exists (select 1 from pg_constraint where conrelid = 'public.folha_pagamentos'::regclass and conname = 'folha_pagamentos_lancamento_mensal_coerente') then
    raise exception '0068 abortada: constraints esperadas de folha_pagamentos (0065/0066) nao encontradas.';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.folha_pagamentos'::regclass and conname = 'folha_pagamentos_natureza_check')
     and not exists (select 1 from pg_constraint where conrelid = 'public.folha_pagamentos'::regclass and conname = 'folha_pagamentos_natureza_valida') then
    raise exception '0068 abortada: constraint de natureza de folha_pagamentos nao encontrada.';
  end if;
end $$;

-- ============================================================
-- 1. folha_pagamentos_itens -- valor manual por jornada.
-- ============================================================
alter table public.folha_pagamentos_itens
  add column if not exists valor_calculado numeric(12,2),
  add column if not exists valor_manual boolean not null default false,
  add column if not exists observacao_ajuste text,
  add column if not exists origem_valor text not null default 'automatico';

-- Backfill: tudo que a 0066/0067 gravou era automatico (valor =
-- duracao/60 * valor_hora_aplicado), sem ajuste.
update public.folha_pagamentos_itens
set valor_calculado = valor
where valor_calculado is null
  and valor_manual = false
  and valor_hora_aplicado is not null;

alter table public.folha_pagamentos_itens
  alter column valor_hora_aplicado drop not null;

do $$
begin
  alter table public.folha_pagamentos_itens
    add constraint folha_pagamentos_itens_valor_calculado_positivo
    check (valor_calculado is null or valor_calculado > 0);
exception when duplicate_object then null;
end $$;

do $$
begin
  -- sem valor/hora vigente <=> sem valor calculado
  alter table public.folha_pagamentos_itens
    add constraint folha_pagamentos_itens_calculo_coerente
    check ((valor_hora_aplicado is null) = (valor_calculado is null));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.folha_pagamentos_itens
    add constraint folha_pagamentos_itens_origem_valor_valida
    check (origem_valor in ('automatico', 'manual', 'regularizacao_historica'));
exception when duplicate_object then null;
end $$;

do $$
begin
  -- automatico: pago = calculado (com valor/hora), sem ajuste;
  -- manual: havia calculo e o administrador pagou valor diferente;
  -- regularizacao_historica: sem valor/hora e sem calculo, valor informado.
  alter table public.folha_pagamentos_itens
    add constraint folha_pagamentos_itens_origem_coerente
    check (
      (origem_valor = 'automatico' and not valor_manual and valor_calculado is not null and valor = valor_calculado)
      or (origem_valor = 'manual' and valor_manual and valor_calculado is not null and valor <> valor_calculado)
      or (origem_valor = 'regularizacao_historica' and valor_manual and valor_hora_aplicado is null and valor_calculado is null)
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.folha_pagamentos_itens
    add constraint folha_pagamentos_itens_observacao_ajuste_coerente
    check (observacao_ajuste is null or (valor_manual and btrim(observacao_ajuste) <> ''));
exception when duplicate_object then null;
end $$;

comment on column public.folha_pagamentos_itens.valor_calculado is
  'Migration 0068. Valor sugerido automaticamente (duracao_minutos/60 * valor_hora_aplicado vigente na data). NULL quando nao havia valor/hora vigente na data da jornada (ex.: antes de 01/10/2026).';
comment on column public.folha_pagamentos_itens.valor is
  'Valor EFETIVAMENTE pago por esta jornada (snapshot imutavel). Igual a valor_calculado quando valor_manual=false; informado pelo administrador quando valor_manual=true.';
comment on column public.folha_pagamentos_itens.valor_manual is
  'Migration 0068. true = valor informado pelo administrador (origem_valor manual ou regularizacao_historica). Nunca altera o valor/hora global.';
comment on column public.folha_pagamentos_itens.observacao_ajuste is
  'Migration 0068. Observacao opcional do ajuste manual (so existe quando valor_manual=true).';
comment on column public.folha_pagamentos_itens.valor_hora_aplicado is
  'Valor/hora vigente na data da jornada no momento da confirmacao. NULL desde 0068 somente em regularizacao historica (data anterior a primeira vigencia global de valor/hora).';
comment on column public.folha_pagamentos_itens.origem_valor is
  'Migration 0068. automatico = valor calculado (duracao/60 * valor/hora vigente na data); manual = administrador substituiu o valor de uma jornada que tinha calculo; regularizacao_historica = jornada anterior a primeira vigencia global de valor/hora, sem calculo, registrada com valor informado.';

-- ============================================================
-- 1b. folha_pagamentos -- natureza 'regularizacao_historica'.
--     Recria as 3 constraints que conhecem natureza (nomes conferidos nas
--     premissas). Linhas existentes (mensal/por_hora) continuam validas.
-- ============================================================
alter table public.folha_pagamentos drop constraint if exists folha_pagamentos_natureza_check;
alter table public.folha_pagamentos drop constraint if exists folha_pagamentos_natureza_valida;
alter table public.folha_pagamentos
  add constraint folha_pagamentos_natureza_valida
  check (natureza in ('mensal', 'por_hora', 'regularizacao_historica'));

alter table public.folha_pagamentos drop constraint if exists folha_pagamentos_competencia_coerente_com_natureza;
alter table public.folha_pagamentos
  add constraint folha_pagamentos_competencia_coerente_com_natureza
  check ((natureza = 'mensal' and competencia is not null) or (natureza in ('por_hora', 'regularizacao_historica') and competencia is null));

alter table public.folha_pagamentos drop constraint if exists folha_pagamentos_lancamento_mensal_coerente;
alter table public.folha_pagamentos
  add constraint folha_pagamentos_lancamento_mensal_coerente
  check (
    (natureza = 'mensal'
      and tipo_lancamento in ('integral', 'adiantamento', 'parcial', 'complemento')
      and valor_base_pago is not null and valor_base_pago >= 0)
    or
    (natureza in ('por_hora', 'regularizacao_historica') and tipo_lancamento is null and valor_base_pago is null)
  );

do $$
begin
  alter table public.folha_pagamentos
    add constraint folha_pagamentos_regularizacao_coerente
    check (natureza <> 'regularizacao_historica' or (valor_mensal_base_snapshot is null and valor_hora_snapshot is null));
exception when duplicate_object then null;
end $$;

comment on column public.folha_pagamentos.natureza is
  'mensal | por_hora | regularizacao_historica (migration 0068: registro financeiro manual de jornadas da Escala anteriores a primeira vigencia global de valor/hora -- nao e pagamento por hora nem mensal; sem competencia, sem base, sem valor/hora).';

-- ============================================================
-- 2. Imutabilidade dos pagamentos confirmados (defesa em profundidade).
-- ============================================================
create or replace function public.folha_pagamentos_imutavel_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'folha_pagamentos' then
    if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
       or not (old.status = new.status or (old.status = 'confirmado' and new.status = 'cancelado')) then
      raise exception 'folha_pagamentos: pagamento confirmado e imutavel -- so o cancelamento logico (folha_cancelar_pagamento) e permitido.';
    end if;
  elsif tg_table_name = 'folha_pagamentos_itens' then
    if (to_jsonb(new) - 'pagamento_cancelado' - 'escala_periodo_id') is distinct from (to_jsonb(old) - 'pagamento_cancelado' - 'escala_periodo_id')
       or (old.pagamento_cancelado and not new.pagamento_cancelado)
       or (new.escala_periodo_id is not null and new.escala_periodo_id is distinct from old.escala_periodo_id) then
      raise exception 'folha_pagamentos_itens: item de pagamento confirmado e imutavel -- so a liberacao por cancelamento e permitida.';
    end if;
  else
    raise exception 'folha_pagamentos_descontos: desconto de pagamento confirmado e imutavel.';
  end if;
  return new;
end;
$$;

comment on function public.folha_pagamentos_imutavel_fn() is
  'Migration 0068. BEFORE UPDATE em folha_pagamentos / folha_pagamentos_itens / folha_pagamentos_descontos. Snapshot imutavel: cabecalho so muda status confirmado->cancelado; item so muda pagamento_cancelado false->true e escala_periodo_id para NULL (FK on delete set null); desconto nunca muda. Correcao = cancelar e lancar de novo.';

revoke execute on function public.folha_pagamentos_imutavel_fn() from public;
revoke execute on function public.folha_pagamentos_imutavel_fn() from anon;
revoke execute on function public.folha_pagamentos_imutavel_fn() from authenticated;
revoke execute on function public.folha_pagamentos_imutavel_fn() from service_role;

drop trigger if exists folha_pagamentos_imutavel_trigger on public.folha_pagamentos;
create trigger folha_pagamentos_imutavel_trigger
  before update on public.folha_pagamentos
  for each row execute function public.folha_pagamentos_imutavel_fn();

drop trigger if exists folha_pagamentos_itens_imutavel_trigger on public.folha_pagamentos_itens;
create trigger folha_pagamentos_itens_imutavel_trigger
  before update on public.folha_pagamentos_itens
  for each row execute function public.folha_pagamentos_imutavel_fn();

drop trigger if exists folha_pagamentos_descontos_imutavel_trigger on public.folha_pagamentos_descontos;
create trigger folha_pagamentos_descontos_imutavel_trigger
  before update on public.folha_pagamentos_descontos
  for each row execute function public.folha_pagamentos_imutavel_fn();

-- ============================================================
-- 2b. CORTE da regularizacao historica -- helper interno.
-- ============================================================
create or replace function public.folha_data_corte_historica()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select min(vh.vigente_desde) from public.folha_valor_hora vh;
$$;

comment on function public.folha_data_corte_historica() is
  'Migration 0068 (interna). Corte da regularizacao historica = PRIMEIRA vigencia global de valor/hora (MIN(folha_valor_hora.vigente_desde); hoje 01/10/2026). Jornadas com data anterior nao tem calculo automatico e so podem ser registradas por regularizacao historica (valor manual). NULL sem nenhuma vigencia = sem excecao.';

revoke execute on function public.folha_data_corte_historica() from public, anon, authenticated, service_role;

-- ============================================================
-- 3. Data prevista -- helpers internos (sem EXECUTE para papeis de API).
--    Dia util = segunda a sexta que nao esteja em public.feriados_nacionais.
-- ============================================================
create or replace function public.folha_eh_dia_util(p_data date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select extract(isodow from p_data) < 6
     and not exists (select 1 from public.feriados_nacionais f where f.data = p_data);
$$;

-- N-esimo dia util a partir do dia 1 do mes de p_mes (N >= 1). Se o mes
-- tiver menos de N dias uteis, a contagem continua no mes seguinte.
create or replace function public.folha_enesimo_dia_util(p_mes date, p_n integer)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dia   date := date_trunc('month', p_mes)::date;
  v_conta integer := 0;
  v_guarda integer := 0;
begin
  if p_n is null or p_n < 1 then
    return null;
  end if;
  loop
    if public.folha_eh_dia_util(v_dia) then
      v_conta := v_conta + 1;
      if v_conta = p_n then
        return v_dia;
      end if;
    end if;
    v_dia := v_dia + 1;
    v_guarda := v_guarda + 1;
    if v_guarda > 400 then
      return null;
    end if;
  end loop;
end;
$$;

-- Resolve a preferencia numa data prevista a partir de uma data de
-- referencia (data da jornada, ou o ultimo dia da competencia):
--   diario  -> a propria data de referencia;
--   semanal -> fechamento = DOMINGO da semana operacional (segunda a
--              domingo) da referencia; prevista = primeira ocorrencia do
--              dia da semana configurado no fechamento ou depois (sem dia
--              configurado = o proprio domingo);
--   mensal  -> fechamento = ultimo dia do mes da referencia; prevista =
--              primeira data da regra no fechamento ou depois:
--              mensal:ultimo_dia -> o proprio ultimo dia;
--              dia_fixo:N        -> dia N (limitado ao tamanho do mes);
--              dia_util:N        -> N-esimo dia util do mes;
--              sem regra         -> o ultimo dia do mes;
--              regra desconhecida -> NULL (nunca inventa).
create or replace function public.folha_data_prevista_regra(
  p_periodicidade text,
  p_dia_semana    smallint,
  p_regra_mes     text,
  p_referencia    date
)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_domingo   date;
  v_alvo      integer;
  v_fim_mes   date;
  v_regra     text := nullif(btrim(coalesce(p_regra_mes, '')), '');
  v_tipo      text;
  v_n         integer;
  v_mes       date;
  v_candidata date;
  v_tentativa integer;
begin
  if p_referencia is null or p_periodicidade is null then
    return null;
  end if;

  if p_periodicidade = 'diario' then
    return p_referencia;
  end if;

  if p_periodicidade = 'semanal' then
    v_domingo := p_referencia + (7 - extract(isodow from p_referencia)::integer);
    if p_dia_semana is null then
      return v_domingo;
    end if;
    v_alvo := case when p_dia_semana = 0 then 7 else p_dia_semana end; -- isodow
    return v_domingo + (v_alvo % 7);
  end if;

  if p_periodicidade <> 'mensal' then
    return null;
  end if;

  v_fim_mes := (date_trunc('month', p_referencia) + interval '1 month' - interval '1 day')::date;

  if v_regra is null or v_regra = 'mensal:ultimo_dia' then
    return v_fim_mes;
  end if;

  if v_regra ~ '^(dia_util|dia_fixo):[0-9]{1,2}$' then
    v_tipo := split_part(v_regra, ':', 1);
    v_n := split_part(v_regra, ':', 2)::integer;
  else
    return null;
  end if;

  if (v_tipo = 'dia_fixo' and (v_n < 1 or v_n > 31)) or (v_tipo = 'dia_util' and (v_n < 1 or v_n > 23)) then
    return null;
  end if;

  v_mes := date_trunc('month', p_referencia)::date;
  for v_tentativa in 0 .. 1 loop
    if v_tipo = 'dia_fixo' then
      v_candidata := v_mes + (least(v_n, extract(day from (v_mes + interval '1 month' - interval '1 day'))::integer) - 1);
    else
      v_candidata := public.folha_enesimo_dia_util(v_mes, v_n);
    end if;
    if v_candidata is not null and v_candidata >= v_fim_mes then
      return v_candidata;
    end if;
    v_mes := (v_mes + interval '1 month')::date;
  end loop;
  return v_candidata;
end;
$$;

-- Data prevista de 1 funcionario (preferencia atual) para uma data de
-- referencia. NULL = sem preferencia cadastrada (ou regra desconhecida).
create or replace function public.folha_data_prevista(p_funcionario_id uuid, p_referencia date)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select public.folha_data_prevista_regra(pp.periodicidade, pp.dia_semana_habitual, pp.dia_mes_habitual, p_referencia)
  from public.funcionarios_preferencia_pagamento pp
  where pp.funcionario_id = p_funcionario_id;
$$;

comment on function public.folha_eh_dia_util(date) is
  'Migration 0068 (interna). Dia util = segunda a sexta que nao esteja em public.feriados_nacionais.';
comment on function public.folha_enesimo_dia_util(date, integer) is
  'Migration 0068 (interna). N-esimo dia util contado a partir do dia 1 do mes informado (continua no mes seguinte se o mes nao tiver N dias uteis).';
comment on function public.folha_data_prevista_regra(text, smallint, text, date) is
  'Migration 0068 (interna). Converte a preferencia de pagamento (diario|semanal|mensal + dia da semana / regra do mes) numa DATA PREVISTA a partir de uma data de referencia (jornada ou ultimo dia da competencia). Somente previsao/organizacao -- nunca bloqueia pagamento. Semana operacional segunda->domingo; mensal = primeira data da regra no fechamento do mes ou depois.';
comment on function public.folha_data_prevista(uuid, date) is
  'Migration 0068 (interna). Data prevista pela preferencia ATUAL do funcionario. NULL sem preferencia.';

revoke execute on function public.folha_eh_dia_util(date) from public, anon, authenticated, service_role;
revoke execute on function public.folha_enesimo_dia_util(date, integer) from public, anon, authenticated, service_role;
revoke execute on function public.folha_data_prevista_regra(text, smallint, text, date) from public, anon, authenticated, service_role;
revoke execute on function public.folha_data_prevista(uuid, date) from public, anon, authenticated, service_role;

-- ============================================================
-- 4. Pendencias -- + data_prevista (DROP + CREATE: tipo de retorno muda).
-- ============================================================
drop function if exists public.folha_calcular_pendencias_por_hora(uuid);

create function public.folha_calcular_pendencias_por_hora(
  p_funcionario_id uuid
)
returns table (
  data                 date,
  hora_inicio          time,
  hora_fim             time,
  duracao_minutos      integer,
  natureza_financeira  text,
  valor_hora_aplicado  numeric(12,2),
  valor                numeric(12,2),
  data_prevista        date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_corte date := public.folha_data_corte_historica();
begin
  if not (select public.has_permissao('folha_pagamentos.visualizar')) then
    raise exception using errcode = '42501',
      message = 'folha_calcular_pendencias_por_hora: requer a permissao folha_pagamentos.visualizar.';
  end if;

  if p_funcionario_id is null or not exists (select 1 from public.funcionarios where id = p_funcionario_id) then
    raise exception 'folha_calcular_pendencias_por_hora: funcionario % nao encontrado.', p_funcionario_id;
  end if;

  return query
  select
    x.data, x.hora_inicio, x.hora_fim, x.duracao_minutos, x.natureza_financeira,
    x.valor_hora_aplicado,
    round((x.duracao_minutos / 60.0) * x.valor_hora_aplicado, 2)::numeric(12,2),
    public.folha_data_prevista(p_funcionario_id, x.data)
  from (
    select
      d.data,
      p.hora_inicio,
      p.hora_fim,
      (extract(epoch from (p.hora_fim - p.hora_inicio)) / 60)::integer as duracao_minutos,
      p.natureza_financeira,
      (select vh.valor from public.folha_valor_hora vh where vh.vigente_desde <= d.data order by vh.vigente_desde desc limit 1) as valor_hora_aplicado
    from public.funcionarios_escala_dias d
    join public.funcionarios_escala_periodos p on p.escala_dia_id = d.id
    where d.funcionario_id = p_funcionario_id
      and d.tipo_dia = 'trabalho'
      and d.data <= public.folha_hoje()
      -- antes do corte so existe regularizacao historica (0068).
      and (v_corte is null or d.data >= v_corte)
      and not exists (select 1 from public.funcionarios_escala_ocorrencias o where o.escala_dia_id = d.id)
      and (
        select fr.forma from public.funcionarios_forma_remuneracao fr
        where fr.funcionario_id = d.funcionario_id and fr.vigente_desde <= d.data
        order by fr.vigente_desde desc limit 1
      ) = 'por_hora'
      and not exists (
        select 1 from public.folha_pagamentos_itens i
        where i.funcionario_id = d.funcionario_id and i.data = d.data
          and i.hora_inicio = p.hora_inicio and i.hora_fim = p.hora_fim
          and not i.pagamento_cancelado
      )
  ) as x
  order by x.data, x.hora_inicio;
end;
$$;

comment on function public.folha_calcular_pendencias_por_hora(uuid) is
  'Migration 0066 (+0068). Jornadas da Escala ainda nao pagas, elegiveis para pagamento por_hora: dia de trabalho, data <= hoje, sem falta/atestado, forma vigente NA DATA = por_hora, sem item ativo para a identidade (funcionario+data+hora_inicio+hora_fim). valor = duracao/60 * valor/hora vigente na data. Desde 0068 so lista datas >= corte (primeira vigencia global de valor/hora); anteriores = folha_calcular_pendencias_historicas. data_prevista = previsao pela preferencia de pagamento (informativa; NULL sem preferencia).';

revoke execute on function public.folha_calcular_pendencias_por_hora(uuid) from public;
revoke execute on function public.folha_calcular_pendencias_por_hora(uuid) from anon;
revoke execute on function public.folha_calcular_pendencias_por_hora(uuid) from service_role;
grant execute on function public.folha_calcular_pendencias_por_hora(uuid) to authenticated;

drop function if exists public.folha_calcular_pendencia_mensal(uuid, date);

create function public.folha_calcular_pendencia_mensal(
  p_funcionario_id uuid,
  p_competencia    date
)
returns table (
  competencia               date,
  forma_vigente             text,
  valor_mensal_base         numeric(12,2),
  valor_base_ja_pago        numeric(12,2),
  saldo_base                numeric(12,2),
  pagamentos_ativos_qtd     integer,
  faltas_qtd                integer,
  atestados_qtd             integer,
  sugestao_desconto_falta   numeric(12,2),
  extras_pendentes          jsonb,
  valor_extras_pendentes    numeric(12,2),
  data_prevista             date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_competencia       date;
  v_fim_mes           date;
  v_forma             text;
  v_valor_base        numeric(12,2);
  v_ja_pago           numeric(12,2);
  v_qtd_pagamentos    integer;
  v_faltas            integer;
  v_atestados         integer;
  v_extras            jsonb;
  v_valor_extras      numeric(12,2);
  v_corte             date := public.folha_data_corte_historica();
begin
  if not (select public.has_permissao('folha_pagamentos.visualizar')) then
    raise exception using errcode = '42501',
      message = 'folha_calcular_pendencia_mensal: requer a permissao folha_pagamentos.visualizar.';
  end if;

  if p_funcionario_id is null or not exists (select 1 from public.funcionarios where id = p_funcionario_id) then
    raise exception 'folha_calcular_pendencia_mensal: funcionario % nao encontrado.', p_funcionario_id;
  end if;

  if p_competencia is null then
    raise exception 'folha_calcular_pendencia_mensal: p_competencia e obrigatoria.';
  end if;

  v_competencia := date_trunc('month', p_competencia)::date;
  v_fim_mes := (v_competencia + interval '1 month' - interval '1 day')::date;

  v_forma := (
    select fr.forma from public.funcionarios_forma_remuneracao fr
    where fr.funcionario_id = p_funcionario_id and fr.vigente_desde <= v_fim_mes
    order by fr.vigente_desde desc limit 1
  );

  v_valor_base := (
    select rb.valor from public.funcionarios_remuneracao_base rb
    where rb.funcionario_id = p_funcionario_id and rb.vigente_desde <= v_fim_mes
    order by rb.vigente_desde desc limit 1
  );

  select coalesce(sum(fp.valor_base_pago), 0), count(*)
  into v_ja_pago, v_qtd_pagamentos
  from public.folha_pagamentos fp
  where fp.funcionario_id = p_funcionario_id
    and fp.natureza = 'mensal'
    and fp.competencia = v_competencia
    and fp.status = 'confirmado';

  select
    count(*) filter (where o.tipo = 'falta'),
    count(*) filter (where o.tipo = 'atestado')
  into v_faltas, v_atestados
  from public.funcionarios_escala_ocorrencias o
  join public.funcionarios_escala_dias d on d.id = o.escala_dia_id
  where d.funcionario_id = p_funcionario_id
    and d.data between v_competencia and v_fim_mes;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'data', x.data,
      'hora_inicio', x.hora_inicio,
      'hora_fim', x.hora_fim,
      'duracao_minutos', x.duracao_minutos,
      'valor_hora_aplicado', x.valor_hora_aplicado,
      'valor', x.valor
    ) order by x.data, x.hora_inicio), '[]'::jsonb),
    coalesce(sum(x.valor), 0)
  into v_extras, v_valor_extras
  from (
    select
      y.data, y.hora_inicio, y.hora_fim, y.duracao_minutos, y.valor_hora_aplicado,
      round((y.duracao_minutos / 60.0) * y.valor_hora_aplicado, 2) as valor
    from (
      select
        d.data, p.hora_inicio, p.hora_fim,
        (extract(epoch from (p.hora_fim - p.hora_inicio)) / 60)::integer as duracao_minutos,
        (select vh.valor from public.folha_valor_hora vh where vh.vigente_desde <= d.data order by vh.vigente_desde desc limit 1) as valor_hora_aplicado
      from public.funcionarios_escala_dias d
      join public.funcionarios_escala_periodos p on p.escala_dia_id = d.id
      where d.funcionario_id = p_funcionario_id
        and d.tipo_dia = 'trabalho'
        and p.natureza_financeira = 'extra_remunerado'
        and d.data between v_competencia and least(v_fim_mes, public.folha_hoje())
        and (v_corte is null or d.data >= v_corte)
        and not exists (select 1 from public.funcionarios_escala_ocorrencias o where o.escala_dia_id = d.id)
        and (
          select fr.forma from public.funcionarios_forma_remuneracao fr
          where fr.funcionario_id = d.funcionario_id and fr.vigente_desde <= d.data
          order by fr.vigente_desde desc limit 1
        ) = 'mensal'
        and not exists (
          select 1 from public.folha_pagamentos_itens i
          where i.funcionario_id = d.funcionario_id and i.data = d.data
            and i.hora_inicio = p.hora_inicio and i.hora_fim = p.hora_fim
            and not i.pagamento_cancelado
        )
    ) as y
  ) as x;

  return query
  select
    v_competencia,
    v_forma,
    v_valor_base,
    v_ja_pago,
    case when v_valor_base is null then null else greatest(v_valor_base - v_ja_pago, 0) end::numeric(12,2),
    v_qtd_pagamentos,
    v_faltas,
    v_atestados,
    case when v_valor_base is not null and v_faltas > 0 then round(v_valor_base / 30 * v_faltas, 2) else null end::numeric(12,2),
    v_extras,
    v_valor_extras::numeric(12,2),
    public.folha_data_prevista(p_funcionario_id, v_fim_mes);
end;
$$;

comment on function public.folha_calcular_pendencia_mensal(uuid, date) is
  'Migration 0066 (+0068). Resumo de 1 competencia: forma e remuneracao-base vigentes no fim do mes, base ja quitada por pagamentos ATIVOS e saldo, faltas (sugestao base/30 -- nunca aplicada automaticamente) e atestados (so contados), extras remunerados pendentes (so datas >= corte; anteriores = regularizacao historica), soma dos extras, e data_prevista (preferencia aplicada ao ultimo dia da competencia; informativa).';

revoke execute on function public.folha_calcular_pendencia_mensal(uuid, date) from public;
revoke execute on function public.folha_calcular_pendencia_mensal(uuid, date) from anon;
revoke execute on function public.folha_calcular_pendencia_mensal(uuid, date) from service_role;
grant execute on function public.folha_calcular_pendencia_mensal(uuid, date) to authenticated;

-- ============================================================
-- 5. Helper interno: valor efetivo de 1 jornada/extra (calculado x manual).
-- ============================================================
create or replace function public.folha_resolver_valor_item(
  p_item        jsonb,
  p_duracao     integer,
  p_valor_hora  numeric,
  p_contexto    text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_calculado numeric(12,2);
  v_texto     text;
  v_informado numeric(12,2);
  v_manual    boolean;
  v_obs       text;
begin
  v_calculado := case when p_valor_hora is null then null else round((p_duracao / 60.0) * p_valor_hora, 2) end;

  v_texto := nullif(btrim(coalesce(p_item->>'valor', '')), '');
  if v_texto is not null then
    begin
      v_informado := round(v_texto::numeric, 2);
    exception when others then
      raise exception '%: valor a pagar invalido para % %-%: %', p_contexto, p_item->>'data', p_item->>'hora_inicio', p_item->>'hora_fim', v_texto;
    end;
    if v_informado <= 0 then
      raise exception '%: o valor a pagar precisa ser maior que zero (% %-%).', p_contexto, p_item->>'data', p_item->>'hora_inicio', p_item->>'hora_fim';
    end if;
  end if;

  if v_calculado is null and v_informado is null then
    raise exception '%: a jornada % %-% nao tem valor/hora vigente -- informe o valor a pagar.', p_contexto, p_item->>'data', p_item->>'hora_inicio', p_item->>'hora_fim';
  end if;

  v_manual := v_informado is not null and (v_calculado is null or v_informado <> v_calculado);
  v_obs := case when v_manual then nullif(btrim(coalesce(p_item->>'observacao_ajuste', '')), '') else null end;

  return jsonb_build_object(
    'valor_calculado', v_calculado,
    'valor', coalesce(v_informado, v_calculado),
    'valor_manual', v_manual,
    'observacao_ajuste', v_obs,
    'origem_valor', case when v_manual then 'manual' else 'automatico' end
  );
end;
$$;

comment on function public.folha_resolver_valor_item(jsonb, integer, numeric, text) is
  'Migration 0068 (interna). Resolve o valor de 1 item: calculado = duracao/60 * valor/hora (NULL sem vigencia); "valor" informado (> 0) substitui o calculado e marca valor_manual quando diferente (ou quando nao ha calculo); sem calculo e sem valor informado = erro claro. observacao_ajuste so e guardada quando ha ajuste manual.';

revoke execute on function public.folha_resolver_valor_item(jsonb, integer, numeric, text) from public, anon, authenticated, service_role;

-- ============================================================
-- 6. folha_criar_pagamento_por_hora -- + valor manual por jornada.
--    Mesma assinatura; mesmas validacoes da 0066.
-- ============================================================
create or replace function public.folha_criar_pagamento_por_hora(
  p_funcionario_id uuid,
  p_jornadas       jsonb,
  p_descontos      jsonb,
  p_data_efetiva   date,
  p_observacao     text
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

  v_liquido := v_bruto - v_total_descontos;
  if v_liquido < 0 then
    raise exception 'folha_criar_pagamento_por_hora: descontos (%) ultrapassam o valor bruto (%).', v_total_descontos, v_bruto;
  end if;

  -- Passe 2 -- escrita atomica.
  insert into public.folha_pagamentos (
    funcionario_id, natureza, competencia, tipo_vinculo_snapshot,
    valor_mensal_base_snapshot, valor_hora_snapshot,
    tipo_lancamento, valor_base_pago,
    valor_bruto, total_descontos, valor_liquido,
    data_efetiva, observacao, confirmado_por, confirmado_por_nome, criado_por
  ) values (
    p_funcionario_id, 'por_hora', null, v_tipo_vinculo_snap,
    null, v_valor_hora_snap,
    null, null,
    v_bruto, v_total_descontos, v_liquido,
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

  return v_pagamento_id;
end;
$$;

comment on function public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text) is
  'Migration 0066 (+0068). Cria e confirma atomicamente 1 pagamento natureza=por_hora: p_jornadas = subconjunto (>=1) de {data,hora_inicio,hora_fim, valor?, observacao_ajuste?} pendentes (existem na Escala, dia de trabalho, corte <= data <= hoje, sem falta/atestado, forma por_hora NA DATA, nao pagas). Sem "valor" = automatico (duracao/60 * valor/hora vigente na data; origem_valor automatico); com "valor" (> 0) diferente do calculado = ajuste manual (origem_valor manual). Jornada anterior ao corte = recusada (regularizacao historica). Snapshot por item: valor_hora_aplicado, valor_calculado, valor pago, valor_manual, observacao_ajuste. Valor/hora global nunca e alterado. Anti-duplicidade: trava por funcionario + checagem + indice unico parcial. Requer folha_pagamentos.confirmar.';

revoke execute on function public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text) from public;
revoke execute on function public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text) from anon;
revoke execute on function public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text) from service_role;
grant execute on function public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text) to authenticated;

-- ============================================================
-- 7. folha_criar_pagamento_mensal -- + valor manual nos EXTRAS.
--    Mesma assinatura; regras 0066 + Integral 0067 identicas. A
--    remuneracao-base continua sendo valor_base (nunca por jornada).
-- ============================================================
create or replace function public.folha_criar_pagamento_mensal(
  p_funcionario_id   uuid,
  p_competencia      date,
  p_tipo_lancamento  text,
  p_valor_base       numeric,
  p_extras           jsonb,
  p_descontos        jsonb,
  p_data_efetiva     date,
  p_observacao       text
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

  v_liquido := v_bruto - v_total_descontos;
  if v_liquido < 0 then
    raise exception 'folha_criar_pagamento_mensal: descontos (%) ultrapassam o valor bruto (%).', v_total_descontos, v_bruto;
  end if;

  insert into public.folha_pagamentos (
    funcionario_id, natureza, competencia, tipo_vinculo_snapshot,
    valor_mensal_base_snapshot, valor_hora_snapshot,
    tipo_lancamento, valor_base_pago,
    valor_bruto, total_descontos, valor_liquido,
    data_efetiva, observacao, confirmado_por, confirmado_por_nome, criado_por
  ) values (
    p_funcionario_id, 'mensal', v_competencia, v_tipo_vinculo_snap,
    v_valor_mensal_base, v_valor_hora_snap,
    p_tipo_lancamento, v_valor_base,
    v_bruto, v_total_descontos, v_liquido,
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

  return v_pagamento_id;
end;
$$;

comment on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text) is
  'Migration 0066 (+0067 integral = saldo exato, +0068 valor manual nos extras). Cria e confirma atomicamente 1 pagamento natureza=mensal na competencia. Remuneracao-base: p_valor_base (0..saldo; integral = saldo exato > 0) -- NUNCA calculada por jornada. p_extras = {data,hora_inicio,hora_fim, valor?, observacao_ajuste?} marcados extra_remunerado, no mes, corte <= data <= hoje, sem falta/atestado, forma mensal NA DATA, nao pagos: sem "valor" = duracao/60 * valor/hora vigente na data (automatico); com "valor" diferente = ajuste manual. Extra anterior ao corte = recusado (regularizacao historica). Descontos 0..N; bloqueia descontos > bruto e bruto = 0. Requer folha_pagamentos.confirmar.';

revoke execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text) from public;
revoke execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text) from anon;
revoke execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text) from service_role;
grant execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text) to authenticated;

-- ============================================================
-- 7b. REGULARIZACAO HISTORICA -- listagem e criacao.
--     Elegivel: periodo de trabalho da Escala com data < corte (primeira
--     vigencia global de valor/hora), sem falta/atestado no dia, sem
--     pagamento ativo; qualquer forma cadastrada depois (ou nenhuma).
--     Unica exclusao por forma: periodo NORMAL de quem ja tinha forma
--     MENSAL vigente NAQUELA data (coberto pela remuneracao-base).
-- ============================================================
create or replace function public.folha_calcular_pendencias_historicas()
returns table (
  funcionario_id       uuid,
  funcionario_nome     text,
  tipo_vinculo         text,
  data                 date,
  hora_inicio          time,
  hora_fim             time,
  duracao_minutos      integer,
  natureza_financeira  text,
  data_corte           date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_corte date := public.folha_data_corte_historica();
begin
  if not (select public.has_permissao('folha_pagamentos.visualizar')) then
    raise exception using errcode = '42501',
      message = 'folha_calcular_pendencias_historicas: requer a permissao folha_pagamentos.visualizar.';
  end if;

  if v_corte is null then
    return;
  end if;

  return query
  select
    f.id, f.nome, f.tipo_vinculo,
    d.data, p.hora_inicio, p.hora_fim,
    (extract(epoch from (p.hora_fim - p.hora_inicio)) / 60)::integer,
    p.natureza_financeira,
    v_corte
  from public.funcionarios_escala_dias d
  join public.funcionarios_escala_periodos p on p.escala_dia_id = d.id
  join public.funcionarios f on f.id = d.funcionario_id
  where d.tipo_dia = 'trabalho'
    and d.data < v_corte
    and d.data <= public.folha_hoje()
    and not exists (select 1 from public.funcionarios_escala_ocorrencias o where o.escala_dia_id = d.id)
    and not exists (
      select 1 from public.folha_pagamentos_itens i
      where i.funcionario_id = d.funcionario_id and i.data = d.data
        and i.hora_inicio = p.hora_inicio and i.hora_fim = p.hora_fim
        and not i.pagamento_cancelado
    )
    and not (
      p.natureza_financeira = 'normal'
      and (
        select fr.forma from public.funcionarios_forma_remuneracao fr
        where fr.funcionario_id = d.funcionario_id and fr.vigente_desde <= d.data
        order by fr.vigente_desde desc limit 1
      ) is not distinct from 'mensal'
    )
  order by f.nome, d.data, p.hora_inicio;
end;
$$;

comment on function public.folha_calcular_pendencias_historicas() is
  'Migration 0068. Jornadas da Escala elegiveis para REGULARIZACAO HISTORICA: data < corte (MIN(folha_valor_hora.vigente_desde)), dia de trabalho, sem falta/atestado, sem pagamento ativo, para qualquer funcionario (ativo ou nao), com qualquer forma cadastrada depois ou nenhuma -- exceto periodo normal de quem tinha forma mensal vigente NAQUELA data. Nao existe valor calculado (nao ha valor/hora antes do corte). Sem vigencia de valor/hora = lista vazia.';

revoke execute on function public.folha_calcular_pendencias_historicas() from public;
revoke execute on function public.folha_calcular_pendencias_historicas() from anon;
revoke execute on function public.folha_calcular_pendencias_historicas() from service_role;
grant execute on function public.folha_calcular_pendencias_historicas() to authenticated;

create or replace function public.folha_criar_pagamento_regularizacao_historica(
  p_funcionario_id uuid,
  p_jornadas       jsonb,
  p_descontos      jsonb,
  p_data_efetiva   date,
  p_observacao     text
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

  v_liquido := v_bruto - v_total_descontos;
  if v_liquido < 0 then
    raise exception 'folha_criar_pagamento_regularizacao_historica: descontos (%) ultrapassam o valor bruto (%).', v_total_descontos, v_bruto;
  end if;

  insert into public.folha_pagamentos (
    funcionario_id, natureza, competencia, tipo_vinculo_snapshot,
    valor_mensal_base_snapshot, valor_hora_snapshot,
    tipo_lancamento, valor_base_pago,
    valor_bruto, total_descontos, valor_liquido,
    data_efetiva, observacao, confirmado_por, confirmado_por_nome, criado_por
  ) values (
    p_funcionario_id, 'regularizacao_historica', null, public.folha_tipo_vinculo_em(p_funcionario_id, v_data_max),
    null, null,
    null, null,
    v_bruto, v_total_descontos, v_liquido,
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

  return v_pagamento_id;
end;
$$;

comment on function public.folha_criar_pagamento_regularizacao_historica(uuid, jsonb, jsonb, date, text) is
  'Migration 0068. REGULARIZACAO HISTORICA: registro financeiro manual de jornadas da Escala anteriores ao corte (MIN(folha_valor_hora.vigente_desde)). Nao e pagamento por hora nem mensal: nao exige forma de remuneracao, nao cria forma/valor-hora retroativos, nao calcula valor, nao usa competencia nem saldo-base. p_jornadas = {data,hora_inicio,hora_fim, valor (OBRIGATORIO > 0), observacao_ajuste?}; cada uma: data < corte, periodo existente na Escala (dia de trabalho), sem falta/atestado, sem pagamento ativo, e nao ser periodo normal de quem ja era mensal na data. Snapshot: cabecalho natureza=regularizacao_historica (sem competencia/base/valor-hora); itens origem_valor=regularizacao_historica, valor_hora_aplicado/valor_calculado NULL, valor_manual=true. Mesma trava por funcionario, anti-duplicidade (indice unico), descontos, imutabilidade e cancelamento dos demais pagamentos. Requer folha_pagamentos.confirmar.';

revoke execute on function public.folha_criar_pagamento_regularizacao_historica(uuid, jsonb, jsonb, date, text) from public;
revoke execute on function public.folha_criar_pagamento_regularizacao_historica(uuid, jsonb, jsonb, date, text) from anon;
revoke execute on function public.folha_criar_pagamento_regularizacao_historica(uuid, jsonb, jsonb, date, text) from service_role;
grant execute on function public.folha_criar_pagamento_regularizacao_historica(uuid, jsonb, jsonb, date, text) to authenticated;

-- ============================================================
-- 8. Protecao FALTA/ATESTADO x jornada com pagamento ATIVO.
--    Falta/atestado e uma ocorrencia do DIA (1 por escala_dia) -- num dia
--    com qualquer jornada/extra em pagamento ativo, registrar ocorrencia
--    deixaria o estado financeiro contraditorio. Cancelar o pagamento
--    libera. Nao interfere em: remover ocorrencia, folga, regravacao da
--    escala (protecao K), nem em dias sem pagamento ativo.
-- ============================================================
create or replace function public.folha_ocorrencia_x_pagamento_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_funcionario_id uuid;
  v_data           date;
begin
  select d.funcionario_id, d.data into v_funcionario_id, v_data
  from public.funcionarios_escala_dias d
  where d.id = new.escala_dia_id;

  if v_funcionario_id is null then
    return new; -- a trigger de protecao da 0055 ja rejeita dia inexistente.
  end if;

  perform public.folha_travar_funcionario(v_funcionario_id);

  if exists (
    select 1 from public.folha_pagamentos_itens i
    where i.funcionario_id = v_funcionario_id and i.data = v_data and not i.pagamento_cancelado
  ) then
    raise exception 'Este dia já possui jornada com pagamento confirmado. Cancele o pagamento antes de registrar falta ou atestado.';
  end if;

  return new;
end;
$$;

comment on function public.folha_ocorrencia_x_pagamento_fn() is
  'Migration 0068. BEFORE INSERT/UPDATE em funcionarios_escala_ocorrencias: recusa falta/atestado num dia (funcionario+data) que tenha item em pagamento ATIVO (folha_pagamentos_itens.pagamento_cancelado=false). Trava por funcionario (mesma de pagamentos/Escala) contra corrida. Cancelar o pagamento libera o registro.';

revoke execute on function public.folha_ocorrencia_x_pagamento_fn() from public;
revoke execute on function public.folha_ocorrencia_x_pagamento_fn() from anon;
revoke execute on function public.folha_ocorrencia_x_pagamento_fn() from authenticated;
revoke execute on function public.folha_ocorrencia_x_pagamento_fn() from service_role;

drop trigger if exists funcionarios_escala_ocorrencias_pagamento_trigger on public.funcionarios_escala_ocorrencias;
create trigger funcionarios_escala_ocorrencias_pagamento_trigger
  before insert or update on public.funcionarios_escala_ocorrencias
  for each row execute function public.folha_ocorrencia_x_pagamento_fn();

-- ============================================================
-- 9. Feriados (dia util) -- manutencao de public.feriados_nacionais pela
--    tela de Configuracoes de Pagamentos. Nenhum seed.
-- ============================================================
create or replace function public.folha_registrar_feriado(p_data date, p_nome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := nullif(btrim(coalesce(p_nome, '')), '');
begin
  if not (select public.has_permissao('folha_pagamentos.regras')) then
    raise exception using errcode = '42501',
      message = 'folha_registrar_feriado: requer a permissao folha_pagamentos.regras.';
  end if;
  if p_data is null then
    raise exception 'folha_registrar_feriado: a data e obrigatoria.';
  end if;
  if v_nome is null then
    raise exception 'folha_registrar_feriado: informe o nome do feriado.';
  end if;

  insert into public.feriados_nacionais (data, nome)
  values (p_data, v_nome)
  on conflict (data) do update set nome = excluded.nome;
end;
$$;

create or replace function public.folha_remover_feriado(p_data date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.has_permissao('folha_pagamentos.regras')) then
    raise exception using errcode = '42501',
      message = 'folha_remover_feriado: requer a permissao folha_pagamentos.regras.';
  end if;
  if p_data is null then
    raise exception 'folha_remover_feriado: a data e obrigatoria.';
  end if;
  delete from public.feriados_nacionais where data = p_data;
end;
$$;

comment on function public.folha_registrar_feriado(date, text) is
  'Migration 0068. Cadastra/renomeia um feriado em public.feriados_nacionais (fonte unica de feriados, 0010) -- usado no calculo de dia util das datas previstas de pagamento e exibido no planejamento de Producao. Requer folha_pagamentos.regras.';
comment on function public.folha_remover_feriado(date) is
  'Migration 0068. Remove um feriado de public.feriados_nacionais (correcao de cadastro). Afeta apenas previsoes (dia util) e a exibicao informativa no planejamento de Producao -- nenhum pagamento confirmado depende disso. Requer folha_pagamentos.regras.';

revoke execute on function public.folha_registrar_feriado(date, text) from public;
revoke execute on function public.folha_registrar_feriado(date, text) from anon;
revoke execute on function public.folha_registrar_feriado(date, text) from service_role;
grant execute on function public.folha_registrar_feriado(date, text) to authenticated;

revoke execute on function public.folha_remover_feriado(date) from public;
revoke execute on function public.folha_remover_feriado(date) from anon;
revoke execute on function public.folha_remover_feriado(date) from service_role;
grant execute on function public.folha_remover_feriado(date) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- So e trivial ANTES de existir item com valor_manual=true ou
-- valor_hora_aplicado NULL (ambos dependem desta migration). Ordem:
-- 1) recriar folha_criar_pagamento_por_hora (0066, secao 4c) e
--    folha_criar_pagamento_mensal (0067) com os corpos publicados;
-- 2) DROP + CREATE folha_calcular_pendencias_por_hora /
--    folha_calcular_pendencia_mensal com os corpos da 0066 (sem
--    data_prevista) + grants;
-- 3) drop trigger funcionarios_escala_ocorrencias_pagamento_trigger,
--    folha_pagamentos_imutavel_trigger, folha_pagamentos_itens_imutavel_trigger,
--    folha_pagamentos_descontos_imutavel_trigger;
-- 3b) drop function folha_criar_pagamento_regularizacao_historica,
--    folha_calcular_pendencias_historicas, folha_data_corte_historica; recriar
--    as 3 constraints de natureza de folha_pagamentos com os textos de
--    0065/0066 (so se nao existir pagamento regularizacao_historica);
-- 4) drop function folha_ocorrencia_x_pagamento_fn, folha_pagamentos_imutavel_fn,
--    folha_resolver_valor_item, folha_data_prevista, folha_data_prevista_regra,
--    folha_enesimo_dia_util, folha_eh_dia_util, folha_registrar_feriado,
--    folha_remover_feriado;
-- 5) alter table folha_pagamentos_itens drop constraint (5 novas), drop
--    column origem_valor/observacao_ajuste/valor_manual/valor_calculado; valor_hora_aplicado
--    set not null (so se nenhuma linha NULL).
