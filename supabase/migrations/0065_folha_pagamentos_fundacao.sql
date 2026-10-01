-- 0065_folha_pagamentos_fundacao.sql
-- FOLHA DE PAGAMENTO > PAGAMENTOS -- fundacao de dados (SOMENTE schema +
-- extensao retrocompativel de aplicar_escala_em_lote). NENHUMA RPC de
-- escrita de pagamento (criar/confirmar/cancelar) e NENHUM frontend nesta
-- migration -- ficam para fases seguintes, depois que o schema abaixo for
-- validado.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor,
-- depois de conferir a pre-auditoria.
--
-- ============================================================
-- CORRECAO CRITICA DESTA VERSAO -- COLISAO DE NOME DESCOBERTA
-- ============================================================
-- A versao anterior desta migration usava os nomes "pagamentos" /
-- "pagamentos_itens" / "pagamentos_descontos" / "pagamentos_cancelamentos"
-- / "pagamentos_valor_hora". A pre-auditoria (rodada anterior) encontrou
-- public.pagamentos JA EXISTINDO no banco real -- uma tabela de OUTRO
-- dominio (contas a pagar / fornecedores / NF-e: colunas fornecedor_id,
-- nfe_id, valor, data_vencimento, data_pagamento, forma_pagamento,
-- status, juros, desconto, observacoes; FKs para fornecedores(id) e
-- nfes(id); RLS habilitada; 0 registros hoje). NENHUMA migration deste
-- repositorio cria essa tabela -- ela nao pertence a Folha de Pagamento e
-- DEVE SER PRESERVADA INTOCADA (decisao explicita do usuario: nao
-- excluir, nao renomear, nao alterar, nao reaproveitar).
--
-- Esta versao RENOMEIA todas as 5 tabelas do dominio Folha para um
-- namespace explicito, eliminando qualquer ambiguidade futura:
--   pagamentos               -> folha_pagamentos
--   pagamentos_itens         -> folha_pagamentos_itens
--   pagamentos_descontos     -> folha_pagamentos_descontos
--   pagamentos_cancelamentos -> folha_pagamentos_cancelamentos
--   pagamentos_valor_hora    -> folha_valor_hora
-- Todas as PKs/FKs/indices/triggers/policies/comentarios internos foram
-- revisados para usar os novos nomes. As 5 permissoes novas tambem fugiram
-- do prefixo ambiguo "pagamentos.*" -> "folha_pagamentos.*" (extensao do
-- mesmo raciocinio -- nao foi pedido literalmente, mas evita a mesma
-- classe de colisao se um futuro modulo de Contas a Pagar precisar de
-- permissoes "pagamentos.*" para a tabela public.pagamentos real).
--
-- As 4 tabelas de parametrizacao ligadas a FUNCIONARIOS (nao a
-- "pagamentos" no nome) permanecem com os nomes originais, por nao terem
-- nenhuma colisao e continuarem semanticamente claras:
--   funcionarios_vinculo_historico
--   funcionarios_forma_remuneracao
--   funcionarios_remuneracao_base
--   funcionarios_preferencia_pagamento
--
-- public.pagamentos (fornecedores/NF-e) NAO E TOCADA EM NENHUMA LINHA
-- DESTA MIGRATION -- nenhuma referencia bare a "public.pagamentos" existe
-- neste arquivo (confirmado por grep antes de finalizar).
--
-- ============================================================
-- DECISOES FUNCIONAIS FECHADAS (substituem a proposta anterior de "regra
-- por duracao de jornada" -- CANCELADA, nunca chegou a ser implementada)
-- ============================================================
-- * Nao existe mais tabela de regras 4h=R$80/6h=R$100. A remuneracao por
--   hora agora e PROPORCIONAL: duracao_minutos/60 * valor_hora vigente.
--   Qualquer duracao valida da Escala e calculavel -- nunca mais existe
--   "jornada sem regra" por duracao.
-- * TIPO_VINCULO (funcionario/freelancer/pj) e FORMA_REMUNERACAO (mensal/
--   por_hora) sao conceitos INDEPENDENTES. Um CLT pode ser mensal (o
--   normal) ou, em tese, por_hora; um freelancer pode ser por_hora (o
--   normal) ou mensal fixo; PJ idem. A forma de remuneracao e configurada
--   por pessoa, nunca inferida do vinculo.
-- * Pessoa POR_HORA: cada periodo elegivel da Escala gera valor =
--   duracao_minutos/60 * valor_hora vigente NA DATA DA JORNADA.
--   natureza_financeira (normal/extra_remunerado) existe no periodo mas e
--   INERTE para por_hora -- todo periodo ja e remunerado, com ou sem a
--   marcacao.
-- * Pessoa MENSAL: periodos tipo "normal" sao cobertos pela remuneracao-
--   base mensal vigente (nao geram valor por hora). Periodos marcados
--   "extra_remunerado" geram valor ADICIONAL, calculado pela MESMA formula
--   de por_hora (duracao/60 * valor_hora vigente).
-- * valor_hora (folha_valor_hora) e GLOBAL (nao por funcionario, decisao
--   explicita para v1) e VERSIONADO por vigencia -- mesmo principio de
--   remuneracao-base mensal e historico de vinculo: nunca sobrescreve,
--   sempre uma linha nova.
-- * tipo_vinculo e forma_remuneracao podem MUDAR ao longo do tempo. Uma
--   jornada/competencia deve ser avaliada pelo que estava VIGENTE na data
--   dela, nunca pela configuracao atual -- por isso ambos tem historico
--   versionado.
-- * Pagamento confirmado continua snapshot imutavel; cancelamento continua
--   estorno logico auditavel (tabela propria, nunca DELETE).
-- * Identidade financeira de uma jornada continua sendo o VALOR
--   (funcionario_id, data, hora_inicio, hora_fim) -- NUNCA
--   funcionarios_escala_periodos.id, que e efemero (a RPC da Escala
--   sempre faz DELETE+INSERT dos periodos de um dia, mesmo quando o
--   conteudo nao muda). Auditoria real confirmou 0 duplicidades e 0
--   sobreposicoes hoje -- a identidade por valor e segura.
-- * Jornada ja paga (presente em folha_pagamentos_itens nao cancelado) nao
--   pode ter seu hora_inicio/hora_fim alterado/removido na Escala sem
--   cancelar o pagamento primeiro -- aplicado na FUTURA extensao de
--   validacao de aplicar_escala_em_lote (fase 2, nao nesta migration).
-- * FALTA/ATESTADO (decisao fechada nesta rodada, registrada aqui para a
--   fase 2 -- SEM nenhuma RPC ainda):
--     - forma_remuneracao=por_hora: FALTA nao gera pagamento automatico da
--       jornada daquele dia; ATESTADO TAMBEM nao gera pagamento automatico
--       da jornada daquele dia. A ocorrencia permanece registrada na
--       Escala normalmente. Se excepcionalmente precisar remunerar aquele
--       periodo mesmo assim, isso e tratado manualmente/conscientemente no
--       fluxo financeiro futuro -- nunca automatico.
--     - forma_remuneracao=mensal: FALTA sugere desconto =
--       remuneracao-base/30 (sugestao revisavel, nunca aplicada
--       silenciosamente); ATESTADO NAO gera nenhuma sugestao automatica de
--       desconto.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1. public.funcionarios_vinculo_historico (nova) + trigger automatica.
--   2. public.funcionarios_forma_remuneracao (nova, versionada).
--   3. public.funcionarios_remuneracao_base (nova, versionada).
--   4. public.folha_valor_hora (nova, versionada, global) + seed inicial
--      de R$18,00 vigente desde 01/10/2026.
--   5. public.funcionarios_preferencia_pagamento (nova, estado atual, sem
--      vigencia -- e so previsao/organizacao, nunca trava pagamento).
--   6. Coluna aditiva funcionarios_escala_periodos.natureza_financeira
--      (normal|extra_remunerado, default normal) + extensao
--      RETROCOMPATIVEL de aplicar_escala_em_lote (0055, ja publicada) para
--      aceitar o campo opcionalmente por periodo.
--   7. public.folha_pagamentos / public.folha_pagamentos_itens /
--      public.folha_pagamentos_descontos /
--      public.folha_pagamentos_cancelamentos (novas) -- SOMENTE estrutura
--      (tabelas + RLS de leitura). Nenhuma RPC de escrita ainda -- toda
--      escrita fica bloqueada (RLS sem policy de insert/update/delete para
--      authenticated) ate a fase 2 trazer as RPCs SECURITY DEFINER que vao
--      escrever nelas.
--   8. 5 permissoes novas: folha_pagamentos.visualizar/.editar/.confirmar/
--      .cancelar/.regras, concedidas SOMENTE a proprietario_admin.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * NENHUMA alteracao em public.pagamentos (tabela real, dominio
--     fornecedores/NF-e) -- confirmado por grep: zero referencia bare a
--     "public.pagamentos" neste arquivo;
--   * nenhuma RPC de criar/confirmar/cancelar pagamento, nem de calcular
--     pendencias -- fase 2, depois deste schema validado;
--   * nenhuma tela/componente de frontend;
--   * nenhuma tabela de "regra por duracao" (CANCELADA, substituida por
--     valor_hora proporcional);
--   * nenhuma alteracao na logica de calculo/validacao ja existente de
--     aplicar_escala_em_lote alem do campo aditivo natureza_financeira --
--     overlap, duplicidade, falta/atestado etc. permanecem EXATAMENTE
--     como estao;
--   * nenhuma alteracao nas migrations 0055-0064 ja publicadas, alem do
--     CREATE OR REPLACE FUNCTION pontual de aplicar_escala_em_lote (0055)
--     para o campo aditivo -- a funcao antiga continua funcionando
--     identica para quem nao enviar o campo novo;
--   * nenhuma relacao com a frente Folha de Pagamento > Tarefas
--     (migrations 0061/0062/0064);
--   * popular funcionarios_forma_remuneracao/funcionarios_remuneracao_base
--     para os 14 funcionarios existentes -- e uma decisao de negocio (quem
--     e mensal, quem e por_hora, qual valor) que so pode ser tomada pela
--     interface futura, nunca presumida numa migration. Ate la, qualquer
--     calculo de pendencia para um funcionario sem linha nessas tabelas
--     deve ser tratado como alerta "forma de remuneracao nao configurada"
--     -- nunca R$0 nem erro silencioso (regra de negocio para a RPC da
--     fase 2, nao ha nada a fazer no schema quanto a isso).
--
-- Envolvida em transacao explicita (BEGIN/COMMIT).

BEGIN;

-- ============================================================
-- 1. public.funcionarios_vinculo_historico -- qual tipo_vinculo estava
--    vigente em cada data. Mantida AUTOMATICAMENTE por trigger em
--    funcionarios (nunca por insercao direta do usuario) -- RLS so tem
--    SELECT para authenticated, nenhuma policy de insert/update (a
--    trigger, SECURITY DEFINER, bypassa RLS como dona da tabela, mesmo
--    padrao ja usado pelas triggers de protecao da Escala, 0055).
-- ============================================================
create table if not exists public.funcionarios_vinculo_historico (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  tipo_vinculo   text not null check (tipo_vinculo in ('funcionario', 'freelancer', 'pj')),
  vigente_desde  date not null,
  criado_por     uuid references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),

  constraint funcionarios_vinculo_historico_vigencia_unica unique (funcionario_id, vigente_desde)
);

comment on table public.funcionarios_vinculo_historico is
  'Historico versionado de tipo_vinculo por funcionario (migration 0065, frente Pagamentos). Para saber o vinculo vigente numa data X: maior vigente_desde <= X. Mantida SOMENTE por trigger automatica em funcionarios (funcionarios_vinculo_historico_trigger) -- nunca por insert direto do usuario. Motivo: Pagamentos precisa saber qual vinculo valia na DATA DA JORNADA/competencia, nunca o vinculo atual (que pode ja ter mudado quando o pagamento for finalmente processado -- pagamento parcial/atrasado e a norma).';

create index if not exists funcionarios_vinculo_historico_funcionario_id_idx
  on public.funcionarios_vinculo_historico (funcionario_id, vigente_desde desc);

create or replace function public.funcionarios_vinculo_historico_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.tipo_vinculo is distinct from old.tipo_vinculo then
    insert into public.funcionarios_vinculo_historico (funcionario_id, tipo_vinculo, vigente_desde, criado_por)
    values (new.id, new.tipo_vinculo, current_date, auth.uid())
    on conflict (funcionario_id, vigente_desde) do update
      set tipo_vinculo = excluded.tipo_vinculo,
          criado_por = excluded.criado_por;
  end if;
  return new;
end;
$$;

comment on function public.funcionarios_vinculo_historico_trigger_fn() is
  'AFTER UPDATE em funcionarios. So reage quando tipo_vinculo realmente muda -- insere uma nova vigencia em funcionarios_vinculo_historico com vigente_desde=CURRENT_DATE (a partir de hoje, pelo que sabemos, o vinculo passou a ser o novo valor -- nao ha como saber retroativamente quando a mudanca "deveria" ter ocorrido). ON CONFLICT (mesma funcionario+dia): se o vinculo mudar 2x no mesmo dia, a ultima alteracao do dia prevalece, nunca empilha 2 linhas com a mesma vigente_desde -- mudanca de vinculo nao e operacao de alta frequencia. SECURITY DEFINER: insere em funcionarios_vinculo_historico mesmo sem policy de INSERT para authenticated (bypassa RLS como dona da tabela).';

drop trigger if exists funcionarios_vinculo_historico_trigger on public.funcionarios;
create trigger funcionarios_vinculo_historico_trigger
  after update on public.funcionarios
  for each row
  execute function public.funcionarios_vinculo_historico_trigger_fn();

-- Seed inicial -- 1 linha por funcionario ja existente, com o tipo_vinculo
-- ATUAL e vigente_desde = data_admissao (quando houver) ou a data de
-- criacao do cadastro -- aproximacao honesta (nao e dado historico real
-- anterior, so garante que QUALQUER jornada ja lancada na Escala encontre
-- uma vigencia aplicavel). Idempotente via NOT EXISTS.
insert into public.funcionarios_vinculo_historico (funcionario_id, tipo_vinculo, vigente_desde)
select f.id, f.tipo_vinculo, coalesce(f.data_admissao, f.criado_em::date)
from public.funcionarios f
where not exists (
  select 1 from public.funcionarios_vinculo_historico h where h.funcionario_id = f.id
);

-- ============================================================
-- 2. public.funcionarios_forma_remuneracao -- mensal | por_hora,
--    versionada por vigencia, por funcionario. SEM seed (decisao de
--    negocio futura pela interface -- ver nota no cabecalho).
-- ============================================================
create table if not exists public.funcionarios_forma_remuneracao (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  forma          text not null check (forma in ('mensal', 'por_hora')),
  vigente_desde  date not null,
  criado_por     uuid references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),

  constraint funcionarios_forma_remuneracao_vigencia_unica unique (funcionario_id, vigente_desde)
);

comment on table public.funcionarios_forma_remuneracao is
  'Forma de remuneracao (mensal|por_hora) por funcionario, versionada por vigencia (migration 0065, frente Pagamentos) -- CONCEITO INDEPENDENTE de tipo_vinculo: CLT/freelancer/pj podem ter qualquer uma das duas formas (ex.: freelancer da producao pode ser mensal fixo; CLT normalmente mensal mas nao exclusivamente). Vigente numa data X: maior vigente_desde <= X. Nunca UPDATE numa linha existente -- mudar a forma e sempre inserir nova vigencia, preservando como jornadas/competencias passadas devem ser interpretadas. Sem linha = forma nao configurada (estado de alerta para a futura RPC de pendencias, nunca assumido como um dos dois valores).';

create index if not exists funcionarios_forma_remuneracao_funcionario_id_idx
  on public.funcionarios_forma_remuneracao (funcionario_id, vigente_desde desc);

-- ============================================================
-- 3. public.funcionarios_remuneracao_base -- valor mensal-base por
--    funcionario, versionado por vigencia. Usado quando a forma vigente e
--    'mensal' (CLT, freelancer mensal ou PJ mensal -- mesma estrutura para
--    os 3, nunca nomeada como exclusiva de CLT). SEM seed.
-- ============================================================
create table if not exists public.funcionarios_remuneracao_base (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  valor          numeric(12,2) not null check (valor > 0),
  vigente_desde  date not null,
  criado_por     uuid references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),

  constraint funcionarios_remuneracao_base_vigencia_unica unique (funcionario_id, vigente_desde)
);

comment on column public.funcionarios_remuneracao_base.valor is
  'Remuneracao-base mensal (rotulo na UI futura: "Salario base" ou "Valor mensal", a definir) -- vale para QUALQUER funcionario configurado como forma=mensal, independente de tipo_vinculo (CLT, freelancer mensal ou PJ mensal). Vigente numa competencia X: maior vigente_desde <= X. Nunca UPDATE -- mudanca de valor e sempre nova vigencia; competencias ja pagas usam o valor que estava vigente na data delas, nunca o atual.';

create index if not exists funcionarios_remuneracao_base_funcionario_id_idx
  on public.funcionarios_remuneracao_base (funcionario_id, vigente_desde desc);

-- ============================================================
-- 4. public.folha_valor_hora -- valor/hora GLOBAL (nao por funcionario,
--    decisao explicita para v1), versionado por vigencia. Usado para:
--    toda jornada de pessoa forma=por_hora, e todo periodo
--    extra_remunerado de pessoa forma=mensal. Nome explicito no namespace
--    "folha_" (nao "pagamentos_valor_hora") para nunca se confundir com o
--    dominio de public.pagamentos (fornecedores/NF-e, ja existente e
--    intocado). Seed inicial: R$18,00 desde 01/10/2026 (unico valor que ja
--    existiu -- aplicavel tambem a qualquer jornada anterior a essa data,
--    ja que nao ha outro valor historico para comparar).
-- ============================================================
create table if not exists public.folha_valor_hora (
  id            uuid primary key default gen_random_uuid(),
  valor         numeric(12,2) not null check (valor > 0),
  vigente_desde date not null,
  criado_por    uuid references auth.users(id) on delete set null,
  criado_em     timestamptz not null default now(),

  constraint folha_valor_hora_vigencia_unica unique (vigente_desde)
);

comment on table public.folha_valor_hora is
  'Valor/hora GLOBAL da Folha de Pagamento (nao por funcionario -- decisao explicita para v1, reavaliar se precisarmos de valor/hora individual no futuro), versionado por vigencia (migration 0065). Nome no namespace folha_* (nao pagamentos_*) para nunca se confundir com o dominio de public.pagamentos (fornecedores/NF-e, tabela ja existente e intocada por esta migration). Vigente numa data X: maior vigente_desde <= X. Jornada antiga sempre apurada pelo valor que estava vigente NA DATA DA JORNADA, mesmo que paga depois de uma mudanca de valor -- pagamento confirmado congela o valor aplicado em snapshot, nunca recalcula.';

-- Seed inicial -- so insere se a tabela ainda estiver vazia (nunca
-- sobrescreve um valor real ja cadastrado se esta migration for revisada
-- antes de rodar).
insert into public.folha_valor_hora (valor, vigente_desde)
select 18.00, date '2026-10-01'
where not exists (select 1 from public.folha_valor_hora);

-- ============================================================
-- 5. public.funcionarios_preferencia_pagamento -- preferencia
--    OPERACIONAL (previsao/organizacao/alertas), estado ATUAL, SEM
--    vigencia -- nunca afeta calculo de valor, entao nao precisa de
--    historico (diferente de tipo_vinculo/forma_remuneracao/valor_hora,
--    que SAO usados no calculo e por isso precisam saber o que valia no
--    passado).
-- ============================================================
create table if not exists public.funcionarios_preferencia_pagamento (
  funcionario_id      uuid primary key references public.funcionarios(id) on delete cascade,
  periodicidade       text not null check (periodicidade in ('diario', 'semanal', 'mensal')),
  dia_semana_habitual smallint check (dia_semana_habitual between 0 and 6),
  dia_mes_habitual    text,
  atualizado_por      uuid references auth.users(id) on delete set null,
  atualizado_em       timestamptz,

  constraint funcionarios_preferencia_pagamento_dia_semana_coerente
    check (dia_semana_habitual is null or periodicidade = 'semanal')
);

comment on table public.funcionarios_preferencia_pagamento is
  'Preferencia operacional de pagamento por funcionario (migration 0065) -- SOMENTE previsao/organizacao/alertas, NUNCA trava pagamento parcial, antecipado ou fora da data habitual. Conceito totalmente independente de forma_remuneracao (uma pessoa por_hora pode preferir receber semanalmente ou diariamente; uma pessoa mensal normalmente prefere mensal). Sem vigencia -- e config operacional atual, nao afeta calculo de valor retroativamente.';

comment on column public.funcionarios_preferencia_pagamento.dia_mes_habitual is
  'Codigo de regra ABSTRATO para dia habitual do mes (ex.: "dia_util:5", "dia_fixo:5", "mensal:ultimo_dia") -- NUNCA uma data pre-computada. Resolver o codigo numa data real e responsabilidade de uma funcao separada e trocavel (v1: calculo simples pulando sabado/domingo, sem feriados; se precisar de calendario de feriados no futuro, so troca essa funcao de resolucao, sem tocar este schema).';

drop trigger if exists funcionarios_preferencia_pagamento_atualizado_em_trigger on public.funcionarios_preferencia_pagamento;
create trigger funcionarios_preferencia_pagamento_atualizado_em_trigger
  before update on public.funcionarios_preferencia_pagamento
  for each row
  execute function public.funcionarios_aplicar_invariantes_generico();

-- ============================================================
-- 6. Extensao da Escala: natureza_financeira por periodo + extensao
--    RETROCOMPATIVEL de aplicar_escala_em_lote (0055, ja publicada).
-- ============================================================
alter table public.funcionarios_escala_periodos
  add column if not exists natureza_financeira text not null default 'normal';

do $$
begin
  alter table public.funcionarios_escala_periodos
    add constraint funcionarios_escala_periodos_natureza_valida
    check (natureza_financeira in ('normal', 'extra_remunerado'));
exception
  when duplicate_object then null;
end $$;

comment on column public.funcionarios_escala_periodos.natureza_financeira is
  'Migration 0065 (frente Pagamentos). normal (default) | extra_remunerado -- classificacao explicita, NUNCA inferida de horario/dia. So e semanticamente relevante para funcionario com forma_remuneracao=mensal: periodo normal e coberto pela remuneracao-base mensal; extra_remunerado gera valor ADICIONAL pela formula de valor/hora (folha_valor_hora). Para forma_remuneracao=por_hora o campo e INERTE -- todo periodo ja e remunerado por hora, com ou sem a marcacao (a UI futura so expoe o toggle "marcar como extra" para pessoa mensal). PRESERVADA atraves de qualquer regravacao do dia via o campo opcional natureza_financeira aceito por aplicar_escala_em_lote (ver abaixo) -- o FRONTEND futuro precisa buscar e reenviar o valor atual de cada periodo ao reabrir/resalvar um dia, senao o default normal apagaria silenciosamente uma classificacao extra_remunerado ja existente. Escala Padrao (funcionarios_escala_padrao_periodos, 0059) nunca materializa com outro valor alem do default normal -- o conceito de extra e sempre uma decisao ad-hoc sobre um dia real, nunca parte de um template.';

-- CREATE OR REPLACE FUNCTION: EXTENSAO CIRURGICA da RPC ja publicada
-- (0055). Unica mudanca de comportamento: cada periodo do payload pode
-- trazer um campo opcional "natureza_financeira" -- ausente/vazio
-- continua significando 'normal' (comportamento IDENTICO ao atual para
-- todo chamador existente, que nunca envia esse campo). Toda a logica de
-- validacao/aplicacao ja publicada (funcionario existe, tipo_dia valido,
-- periodos coerentes, sobreposicao, duplicidade de funcionario+data,
-- conflito com ocorrencia) permanece EXATAMENTE igual -- nao removida,
-- nao reordenada, so com 2 blocos novos (1 de validacao no passe 1, 1 no
-- INSERT do passe 2).
create or replace function public.aplicar_escala_em_lote(
  p_atribuicoes jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item                jsonb;
  v_periodo              jsonb;
  v_periodo_a            jsonb;
  v_periodo_b            jsonb;
  v_funcionario_id       uuid;
  v_data                 date;
  v_tipo_dia             text;
  v_observacao           text;
  v_periodos             jsonb;
  v_total_periodos       integer;
  v_total_itens          integer;
  v_total_distintos      integer;
  v_hora_inicio          time;
  v_hora_fim             time;
  v_natureza_financeira  text;
  v_idx_a                integer;
  v_idx_b                integer;
  v_dia_id               uuid;
  v_tem_ocorrencia       boolean;
begin
  if not (select public.has_permissao('escala.editar')) then
    raise exception using errcode = '42501',
      message = 'aplicar_escala_em_lote: requer a permissao escala.editar.';
  end if;

  if p_atribuicoes is null or jsonb_typeof(p_atribuicoes) <> 'array' then
    raise exception 'aplicar_escala_em_lote: p_atribuicoes precisa ser um array JSON.';
  end if;

  if jsonb_array_length(p_atribuicoes) = 0 then
    raise exception 'aplicar_escala_em_lote: p_atribuicoes nao pode ser vazio.';
  end if;

  -- ------------------------------------------------------------
  -- Passe 1 -- validacao completa, SEM nenhuma escrita.
  -- ------------------------------------------------------------
  select count(*), count(distinct (item->>'funcionario_id') || '|' || (item->>'data'))
  into v_total_itens, v_total_distintos
  from jsonb_array_elements(p_atribuicoes) as item;

  if v_total_itens <> v_total_distintos then
    raise exception 'aplicar_escala_em_lote: p_atribuicoes contem funcionario_id+data duplicado -- cada dia so pode aparecer uma vez por chamada.';
  end if;

  for v_item in select * from jsonb_array_elements(p_atribuicoes)
  loop
    v_funcionario_id := nullif(v_item->>'funcionario_id', '')::uuid;
    v_data           := nullif(v_item->>'data', '')::date;
    v_tipo_dia       := v_item->>'tipo_dia';
    v_periodos       := coalesce(v_item->'periodos', '[]'::jsonb);

    -- Defesa contra "periodos": null explicito (coalesce so substitui NULL
    -- SQL, nao null JSON) -- sem isso, jsonb_array_length adiante lancaria
    -- um erro cru do Postgres em vez desta mensagem clara.
    if jsonb_typeof(v_periodos) <> 'array' then
      raise exception 'aplicar_escala_em_lote: periodos precisa ser um array (% em %).', v_funcionario_id, v_data;
    end if;

    if v_funcionario_id is null then
      raise exception 'aplicar_escala_em_lote: item sem funcionario_id valido: %', v_item;
    end if;

    if not exists (select 1 from public.funcionarios where id = v_funcionario_id) then
      raise exception 'aplicar_escala_em_lote: funcionario % nao encontrado.', v_funcionario_id;
    end if;

    if v_data is null then
      raise exception 'aplicar_escala_em_lote: item sem data valida: %', v_item;
    end if;

    if v_tipo_dia is null or v_tipo_dia not in ('trabalho', 'folga', 'remover') then
      raise exception 'aplicar_escala_em_lote: tipo_dia invalido "%" para % em %; use trabalho, folga ou remover.', v_tipo_dia, v_funcionario_id, v_data;
    end if;

    if v_tipo_dia in ('folga', 'remover') then
      if jsonb_array_length(v_periodos) > 0 then
        raise exception 'aplicar_escala_em_lote: tipo_dia=% nao aceita periodos (% em %).', v_tipo_dia, v_funcionario_id, v_data;
      end if;

      -- Nunca perde uma falta/atestado silenciosamente: mudar para folga
      -- ou remover o dia inteiro quando ja existe ocorrencia exige
      -- remover a ocorrencia primeiro (remover_ocorrencia_escala).
      select exists (
        select 1
        from public.funcionarios_escala_ocorrencias o
        join public.funcionarios_escala_dias d on d.id = o.escala_dia_id
        where d.funcionario_id = v_funcionario_id and d.data = v_data
      ) into v_tem_ocorrencia;

      if v_tem_ocorrencia then
        raise exception 'aplicar_escala_em_lote: ja existe falta/atestado registrado para % em % -- remova a ocorrencia antes de marcar folga ou remover o dia.', v_funcionario_id, v_data;
      end if;

      continue;
    end if;

    -- tipo_dia = 'trabalho' daqui pra baixo.
    v_total_periodos := jsonb_array_length(v_periodos);
    if v_total_periodos = 0 then
      raise exception 'aplicar_escala_em_lote: trabalho precisa de pelo menos 1 periodo (% em %).', v_funcionario_id, v_data;
    end if;

    for v_periodo in select * from jsonb_array_elements(v_periodos)
    loop
      v_hora_inicio := nullif(v_periodo->>'hora_inicio', '')::time;
      v_hora_fim    := nullif(v_periodo->>'hora_fim', '')::time;

      if v_hora_inicio is null or v_hora_fim is null then
        raise exception 'aplicar_escala_em_lote: periodo sem hora_inicio/hora_fim validos (% em %): %', v_funcionario_id, v_data, v_periodo;
      end if;

      if v_hora_fim <= v_hora_inicio then
        raise exception 'aplicar_escala_em_lote: periodo com hora_fim <= hora_inicio (% em %): %', v_funcionario_id, v_data, v_periodo;
      end if;

      -- NOVO (migration 0065) -- campo opcional, ausente/vazio = 'normal'
      -- (retrocompativel: todo chamador antigo nunca envia isto, segue
      -- funcionando identico). Quando informado, so aceita os 2 valores
      -- validos -- mesma disciplina de mensagem clara ja usada para
      -- tipo_dia/hora_inicio/hora_fim acima.
      v_natureza_financeira := nullif(v_periodo->>'natureza_financeira', '');
      if v_natureza_financeira is not null and v_natureza_financeira not in ('normal', 'extra_remunerado') then
        raise exception 'aplicar_escala_em_lote: natureza_financeira invalida "%" (% em %); use normal ou extra_remunerado.', v_natureza_financeira, v_funcionario_id, v_data;
      end if;
    end loop;

    -- Sobreposicao entre periodos do MESMO item -- comparacao par a par
    -- (poucos periodos por dia na pratica, custo desprezivel).
    for v_idx_a in 0 .. v_total_periodos - 2 loop
      for v_idx_b in v_idx_a + 1 .. v_total_periodos - 1 loop
        v_periodo_a := v_periodos -> v_idx_a;
        v_periodo_b := v_periodos -> v_idx_b;

        if (v_periodo_a->>'hora_inicio')::time < (v_periodo_b->>'hora_fim')::time
           and (v_periodo_b->>'hora_inicio')::time < (v_periodo_a->>'hora_fim')::time
        then
          raise exception 'aplicar_escala_em_lote: periodos sobrepostos (% em %): % e %', v_funcionario_id, v_data, v_periodo_a, v_periodo_b;
        end if;
      end loop;
    end loop;
  end loop;

  -- ------------------------------------------------------------
  -- Passe 2 -- aplicacao. So chega aqui se TODO o array passou no passe 1.
  -- ------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(p_atribuicoes)
  loop
    v_funcionario_id := (v_item->>'funcionario_id')::uuid;
    v_data           := (v_item->>'data')::date;
    v_tipo_dia       := v_item->>'tipo_dia';
    v_observacao     := nullif(btrim(coalesce(v_item->>'observacao', '')), '');
    v_periodos       := coalesce(v_item->'periodos', '[]'::jsonb);

    if v_tipo_dia = 'remover' then
      delete from public.funcionarios_escala_dias
      where funcionario_id = v_funcionario_id and data = v_data;
      continue;
    end if;

    insert into public.funcionarios_escala_dias (funcionario_id, data, tipo_dia, observacao)
    values (v_funcionario_id, v_data, v_tipo_dia, v_observacao)
    on conflict (funcionario_id, data) do update
      set tipo_dia = excluded.tipo_dia,
          observacao = excluded.observacao
    returning id into v_dia_id;

    delete from public.funcionarios_escala_periodos where escala_dia_id = v_dia_id;

    if v_tipo_dia = 'trabalho' then
      -- NOVO (migration 0065): grava natureza_financeira -- ausente/vazio
      -- vira 'normal' (coalesce), mesmo default da coluna. A coluna
      -- tambem tem CHECK proprio (defesa em profundidade, mesmo padrao
      -- usado no resto do projeto).
      insert into public.funcionarios_escala_periodos (escala_dia_id, hora_inicio, hora_fim, natureza_financeira)
      select
        v_dia_id,
        (p->>'hora_inicio')::time,
        (p->>'hora_fim')::time,
        coalesce(nullif(p->>'natureza_financeira', ''), 'normal')
      from jsonb_array_elements(v_periodos) as p;
    end if;
  end loop;
end;
$$;

comment on function public.aplicar_escala_em_lote(jsonb) is
  'Primitivo UNICO de escrita da Escala: salva 1..N dias (funcionario+data) atomicamente -- salvar um dia, copiar dia, copiar semana e aplicar horario em lote (varios dias e/ou varios funcionarios) sao todos o MESMO array, so de tamanho diferente, montado no frontend. tipo_dia=trabalho substitui os periodos do dia (DELETE+INSERT); tipo_dia=folga limpa os periodos; tipo_dia=remover apaga a linha do dia inteiro (volta a "nao definido"). Nunca perde falta/atestado silenciosamente: folga/remover sao rejeitados se ja existir ocorrencia para aquele dia. Validacao completa (passe 1: funcionario existe, tipo_dia valido, periodos coerentes e sem sobreposicao dentro do mesmo dia, sem funcionario+data duplicado no array, sem conflito com ocorrencia existente, natureza_financeira valida quando informada) SEM nenhuma escrita, seguida da aplicacao (passe 2) -- tudo ou nada. SECURITY DEFINER + checagem explicita de escala.editar: necessario porque a validacao consulta public.funcionarios (RLS propria, funcionarios.visualizar) -- um usuario com escala.editar mas sem funcionarios.visualizar nao pode ficar bloqueado por essa checagem cruzada. Migration 0065 (frente Pagamentos): cada periodo aceita um campo opcional natureza_financeira (normal|extra_remunerado, default normal) -- 100% retrocompativel, chamadores antigos que nunca enviam o campo continuam funcionando identico. ATENCAO (fase 2, ainda NAO implementada nesta migration): falta ainda adicionar a validacao de bloqueio quando um periodo ja pertence a pagamento confirmado for alterado/removido -- ver folha_pagamentos_itens.';

revoke execute on function public.aplicar_escala_em_lote(jsonb) from public;
revoke execute on function public.aplicar_escala_em_lote(jsonb) from anon;
revoke execute on function public.aplicar_escala_em_lote(jsonb) from service_role;
grant execute on function public.aplicar_escala_em_lote(jsonb) to authenticated;

-- ============================================================
-- 7. public.folha_pagamentos -- cabecalho de um pagamento (mensal OU
--    por_hora) da FOLHA DE PAGAMENTO. Nome no namespace folha_* (nao
--    "pagamentos" sozinho) por decisao explicita, apos a pre-auditoria
--    confirmar que public.pagamentos JA EXISTE no banco real para outro
--    dominio (fornecedores/NF-e) -- essa tabela permanece intocada,
--    nenhuma referencia bare a ela existe neste arquivo. SOMENTE
--    estrutura nesta migration -- nenhuma RPC de escrita ainda (RLS so
--    com SELECT, nenhuma policy de insert/update/delete para authenticated
--    -- so uma futura RPC SECURITY DEFINER vai escrever aqui, fase 2).
-- ============================================================
create table if not exists public.folha_pagamentos (
  id                          uuid primary key default gen_random_uuid(),
  funcionario_id              uuid not null references public.funcionarios(id),

  natureza                    text not null check (natureza in ('mensal', 'por_hora')),
  competencia                 date,

  -- Snapshot congelado no momento da criacao -- nunca recalculado.
  tipo_vinculo_snapshot       text not null check (tipo_vinculo_snapshot in ('funcionario', 'freelancer', 'pj')),
  valor_mensal_base_snapshot  numeric(12,2),
  valor_hora_snapshot         numeric(12,2),

  valor_bruto                 numeric(12,2) not null check (valor_bruto >= 0),
  total_descontos             numeric(12,2) not null default 0 check (total_descontos >= 0),
  valor_liquido                numeric(12,2) not null,

  status                      text not null default 'confirmado' check (status in ('confirmado', 'cancelado')),

  data_prevista                date,
  data_efetiva                 date,
  observacao                   text,

  confirmado_por                uuid references auth.users(id) on delete set null,
  confirmado_em                 timestamptz not null default now(),
  criado_por                    uuid references auth.users(id) on delete set null,
  criado_em                     timestamptz not null default now(),

  constraint folha_pagamentos_competencia_coerente_com_natureza
    check ((natureza = 'mensal' and competencia is not null) or (natureza = 'por_hora' and competencia is null)),
  constraint folha_pagamentos_valor_liquido_coerente
    check (valor_liquido = valor_bruto - total_descontos)
);

comment on table public.folha_pagamentos is
  'Cabecalho de um pagamento da FOLHA DE PAGAMENTO (migration 0065) -- NAO CONFUNDIR com public.pagamentos (tabela ja existente, dominio fornecedores/NF-e, intocada). natureza=mensal (competencia + valor_mensal_base_snapshot, cobre CLT/freelancer/PJ configurados como mensal) ou natureza=por_hora (1+ linhas em folha_pagamentos_itens). SOMENTE 2 status: confirmado|cancelado -- nao existe "rascunho" persistido, o pagamento nasce ja confirmado (o "rascunho" e so estado de UI antes de chamar a RPC de criacao, que grava tudo atomicamente). Snapshot imutavel: tipo_vinculo_snapshot/valor_mensal_base_snapshot/valor_hora_snapshot congelam o que valia NA DATA RELEVANTE (jornada ou competencia), nunca o valor atual das tabelas de parametrizacao. Cancelamento e sempre logico (ver folha_pagamentos_cancelamentos) -- nunca DELETE.';

create unique index if not exists folha_pagamentos_competencia_unica_idx
  on public.folha_pagamentos (funcionario_id, competencia)
  where natureza = 'mensal' and status <> 'cancelado';

comment on index public.folha_pagamentos_competencia_unica_idx is
  'No maximo 1 pagamento mensal NAO cancelado por funcionario+competencia -- impede pagar o mesmo mes 2x. Um pagamento cancelado libera a competencia para um novo pagamento.';

create index if not exists folha_pagamentos_funcionario_id_idx on public.folha_pagamentos (funcionario_id);
create index if not exists folha_pagamentos_status_idx on public.folha_pagamentos (status);

-- ============================================================
-- 8. public.folha_pagamentos_itens -- 1 linha por jornada remunerada por
--    hora: todo o conteudo de um pagamento natureza=por_hora, OU os
--    extras de um pagamento natureza=mensal. Identidade financeira por
--    VALOR (funcionario_id+data+hora_inicio+hora_fim), nunca por
--    escala_periodo_id (que e so informativo/best-effort).
-- ============================================================
create table if not exists public.folha_pagamentos_itens (
  id                    uuid primary key default gen_random_uuid(),
  pagamento_id          uuid not null references public.folha_pagamentos(id) on delete cascade,
  funcionario_id        uuid not null references public.funcionarios(id),

  data                  date not null,
  hora_inicio           time not null,
  hora_fim              time not null,
  duracao_minutos       integer not null check (duracao_minutos > 0),

  natureza_financeira   text not null check (natureza_financeira in ('normal', 'extra_remunerado')),
  valor_hora_aplicado   numeric(12,2) not null check (valor_hora_aplicado > 0),
  valor                 numeric(12,2) not null check (valor > 0),

  -- Vinculo INFORMATIVO/best-effort com o periodo fisico de origem --
  -- NUNCA a fonte de verdade da identidade (essa e o valor, acima). Fica
  -- null se o periodo de origem for apagado/recriado depois -- o item de
  -- pagamento sobrevive normalmente (snapshot independente).
  escala_periodo_id     uuid references public.funcionarios_escala_periodos(id) on delete set null,

  -- Espelha folha_pagamentos.status para permitir indice unico parcial
  -- (nao da pra referenciar o status do pai dentro de um indice parcial
  -- diretamente) -- mantido pela FUTURA RPC de cancelamento (fase 2), que
  -- atualiza esta coluna ao cancelar o pagamento pai, na MESMA transacao.
  pagamento_cancelado   boolean not null default false,

  criado_em             timestamptz not null default now(),

  constraint folha_pagamentos_itens_horas_coerentes check (hora_fim > hora_inicio)
);

comment on table public.folha_pagamentos_itens is
  'Jornada individual remunerada por hora (migration 0065, Folha de Pagamento) -- todo o conteudo de um pagamento natureza=por_hora, OU os periodos extra_remunerado de um pagamento natureza=mensal. Identidade financeira e o VALOR (funcionario_id+data+hora_inicio+hora_fim) via indice unico parcial abaixo -- NUNCA escala_periodo_id, que e efemero (a RPC da Escala sempre recria fisicamente os periodos a cada regravacao do dia, mesmo sem mudanca de conteudo). pagamento_cancelado e mantido pela FUTURA RPC de cancelamento (fase 2) -- ainda nao existe nesta migration.';

create unique index if not exists folha_pagamentos_itens_jornada_unica_idx
  on public.folha_pagamentos_itens (funcionario_id, data, hora_inicio, hora_fim)
  where not pagamento_cancelado;

comment on index public.folha_pagamentos_itens_jornada_unica_idx is
  'Garante que a MESMA jornada (por valor, nunca por id de periodo) nao seja paga 2x entre pagamentos ativos -- pagamento cancelado libera a jornada para um novo pagamento.';

create index if not exists folha_pagamentos_itens_pagamento_id_idx on public.folha_pagamentos_itens (pagamento_id);
create index if not exists folha_pagamentos_itens_funcionario_data_idx on public.folha_pagamentos_itens (funcionario_id, data);

-- ============================================================
-- 9. public.folha_pagamentos_descontos -- 0..N por pagamento, cada um
--    independente (nunca um campo "desconto total" solto).
-- ============================================================
create table if not exists public.folha_pagamentos_descontos (
  id            uuid primary key default gen_random_uuid(),
  pagamento_id  uuid not null references public.folha_pagamentos(id) on delete cascade,
  tipo          text not null,
  valor         numeric(12,2) not null check (valor > 0),
  observacao    text,
  criado_em     timestamptz not null default now(),

  constraint folha_pagamentos_descontos_tipo_nao_vazio check (btrim(tipo) <> '')
);

comment on table public.folha_pagamentos_descontos is
  'Descontos de um pagamento da Folha de Pagamento (migration 0065) -- 0..N linhas independentes, cada uma com tipo+valor+observacao opcional. Soma congelada em folha_pagamentos.total_descontos no momento da criacao (snapshot, nunca recalculado por este motor). "tipo" e texto livre nesta v1 (sem cadastro administravel de tipos de desconto) -- decisao deliberada para nao fazer overengineering antes de saber se isso vai ser necessario.';

create index if not exists folha_pagamentos_descontos_pagamento_id_idx on public.folha_pagamentos_descontos (pagamento_id);

-- ============================================================
-- 10. public.folha_pagamentos_cancelamentos -- estorno logico e
--     auditavel. Pagamento NUNCA e apagado fisicamente.
-- ============================================================
create table if not exists public.folha_pagamentos_cancelamentos (
  id             uuid primary key default gen_random_uuid(),
  pagamento_id   uuid not null unique references public.folha_pagamentos(id) on delete cascade,
  cancelado_por  uuid references auth.users(id) on delete set null,
  cancelado_em   timestamptz not null default now(),
  motivo         text
);

comment on table public.folha_pagamentos_cancelamentos is
  'Registro de cancelamento/estorno logico de um pagamento da Folha de Pagamento (migration 0065) -- no maximo 1 por pagamento (UNIQUE). folha_pagamentos.status so vai para cancelado atraves desta tabela, pela FUTURA RPC cancelar_pagamento (fase 2, ainda nao existe). Jornadas incluidas no pagamento cancelado voltam a ficar disponiveis automaticamente (via folha_pagamentos_itens.pagamento_cancelado=true, que libera o indice unico de identidade).';

-- ============================================================
-- 11. Permissoes novas -- 5 codigos, concedidos SOMENTE a
--     proprietario_admin nesta rodada (mesmo padrao de toda a Folha de
--     Pagamento ate aqui). Prefixo folha_pagamentos.* (nao pagamentos.*)
--     -- mesma precaucao de namespace das tabelas, para nunca colidir com
--     um futuro modulo de Contas a Pagar que venha a usar
--     public.pagamentos (fornecedores/NF-e).
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('folha_pagamentos.visualizar', 'folha_pagamentos', 'visualizar', 'Ver pendencias, regras (valor/hora, remuneracao-base, forma de remuneracao) e historico de pagamentos da Folha.'),
  ('folha_pagamentos.editar',     'folha_pagamentos', 'editar',     'Montar pagamentos (selecionar jornadas/competencia, lancar descontos) e gerenciar preferencias de pagamento, antes da confirmacao.'),
  ('folha_pagamentos.confirmar',  'folha_pagamentos', 'confirmar',  'Confirmar um pagamento montado, congelando o snapshot definitivo.'),
  ('folha_pagamentos.cancelar',   'folha_pagamentos', 'cancelar',   'Cancelar (estornar logicamente) um pagamento ja confirmado.'),
  ('folha_pagamentos.regras',     'folha_pagamentos', 'regras',     'Cadastrar/alterar valor/hora global, remuneracao-base mensal e forma de remuneracao por funcionario -- sempre por nova vigencia, nunca sobrescrevendo historico.')
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil, permissao) values
  ('proprietario_admin', 'folha_pagamentos.visualizar'),
  ('proprietario_admin', 'folha_pagamentos.editar'),
  ('proprietario_admin', 'folha_pagamentos.confirmar'),
  ('proprietario_admin', 'folha_pagamentos.cancelar'),
  ('proprietario_admin', 'folha_pagamentos.regras')
on conflict do nothing;

-- ============================================================
-- 12. RLS -- todas as 9 tabelas novas.
-- ============================================================

-- funcionarios_vinculo_historico: SOMENTE SELECT (funcionarios.visualizar
-- -- e extensao do cadastro do funcionario). INSERT so pela trigger
-- (SECURITY DEFINER, bypassa RLS).
alter table public.funcionarios_vinculo_historico enable row level security;

drop policy if exists funcionarios_vinculo_historico_select on public.funcionarios_vinculo_historico;
create policy funcionarios_vinculo_historico_select on public.funcionarios_vinculo_historico
  for select to authenticated
  using ((select public.has_permissao('funcionarios.visualizar')));


-- funcionarios_forma_remuneracao: SELECT por folha_pagamentos.visualizar;
-- INSERT por folha_pagamentos.regras. SEM UPDATE/DELETE -- vigencia e
-- sempre uma linha nova, nunca editada/apagada.
alter table public.funcionarios_forma_remuneracao enable row level security;

drop policy if exists funcionarios_forma_remuneracao_select on public.funcionarios_forma_remuneracao;
create policy funcionarios_forma_remuneracao_select on public.funcionarios_forma_remuneracao
  for select to authenticated
  using ((select public.has_permissao('folha_pagamentos.visualizar')));

drop policy if exists funcionarios_forma_remuneracao_insert on public.funcionarios_forma_remuneracao;
create policy funcionarios_forma_remuneracao_insert on public.funcionarios_forma_remuneracao
  for insert to authenticated
  with check ((select public.has_permissao('folha_pagamentos.regras')));


-- funcionarios_remuneracao_base: mesmo padrao.
alter table public.funcionarios_remuneracao_base enable row level security;

drop policy if exists funcionarios_remuneracao_base_select on public.funcionarios_remuneracao_base;
create policy funcionarios_remuneracao_base_select on public.funcionarios_remuneracao_base
  for select to authenticated
  using ((select public.has_permissao('folha_pagamentos.visualizar')));

drop policy if exists funcionarios_remuneracao_base_insert on public.funcionarios_remuneracao_base;
create policy funcionarios_remuneracao_base_insert on public.funcionarios_remuneracao_base
  for insert to authenticated
  with check ((select public.has_permissao('folha_pagamentos.regras')));


-- folha_valor_hora: mesmo padrao (sem funcionario_id, global).
alter table public.folha_valor_hora enable row level security;

drop policy if exists folha_valor_hora_select on public.folha_valor_hora;
create policy folha_valor_hora_select on public.folha_valor_hora
  for select to authenticated
  using ((select public.has_permissao('folha_pagamentos.visualizar')));

drop policy if exists folha_valor_hora_insert on public.folha_valor_hora;
create policy folha_valor_hora_insert on public.folha_valor_hora
  for insert to authenticated
  with check ((select public.has_permissao('folha_pagamentos.regras')));


-- funcionarios_preferencia_pagamento: SELECT por
-- folha_pagamentos.visualizar; INSERT/UPDATE por folha_pagamentos.editar
-- (config operacional, nao financeira -- pode ser atualizada livremente,
-- diferente das tabelas versionadas acima).
alter table public.funcionarios_preferencia_pagamento enable row level security;

drop policy if exists funcionarios_preferencia_pagamento_select on public.funcionarios_preferencia_pagamento;
create policy funcionarios_preferencia_pagamento_select on public.funcionarios_preferencia_pagamento
  for select to authenticated
  using ((select public.has_permissao('folha_pagamentos.visualizar')));

drop policy if exists funcionarios_preferencia_pagamento_insert on public.funcionarios_preferencia_pagamento;
create policy funcionarios_preferencia_pagamento_insert on public.funcionarios_preferencia_pagamento
  for insert to authenticated
  with check ((select public.has_permissao('folha_pagamentos.editar')));

drop policy if exists funcionarios_preferencia_pagamento_update on public.funcionarios_preferencia_pagamento;
create policy funcionarios_preferencia_pagamento_update on public.funcionarios_preferencia_pagamento
  for update to authenticated
  using ((select public.has_permissao('folha_pagamentos.editar')))
  with check ((select public.has_permissao('folha_pagamentos.editar')));


-- folha_pagamentos / folha_pagamentos_itens / folha_pagamentos_descontos /
-- folha_pagamentos_cancelamentos: SOMENTE SELECT para authenticated nesta
-- migration -- ZERO policy de insert/update/delete. Toda escrita fica
-- bloqueada ate a fase 2 trazer as RPCs SECURITY DEFINER (que escrevem
-- bypassando RLS como donas das tabelas) -- forca TODA escrita real por
-- um caminho validado, nunca INSERT direto via REST.
alter table public.folha_pagamentos enable row level security;

drop policy if exists folha_pagamentos_select on public.folha_pagamentos;
create policy folha_pagamentos_select on public.folha_pagamentos
  for select to authenticated
  using ((select public.has_permissao('folha_pagamentos.visualizar')));


alter table public.folha_pagamentos_itens enable row level security;

drop policy if exists folha_pagamentos_itens_select on public.folha_pagamentos_itens;
create policy folha_pagamentos_itens_select on public.folha_pagamentos_itens
  for select to authenticated
  using ((select public.has_permissao('folha_pagamentos.visualizar')));


alter table public.folha_pagamentos_descontos enable row level security;

drop policy if exists folha_pagamentos_descontos_select on public.folha_pagamentos_descontos;
create policy folha_pagamentos_descontos_select on public.folha_pagamentos_descontos
  for select to authenticated
  using ((select public.has_permissao('folha_pagamentos.visualizar')));


alter table public.folha_pagamentos_cancelamentos enable row level security;

drop policy if exists folha_pagamentos_cancelamentos_select on public.folha_pagamentos_cancelamentos;
create policy folha_pagamentos_cancelamentos_select on public.folha_pagamentos_cancelamentos
  for select to authenticated
  using ((select public.has_permissao('folha_pagamentos.visualizar')));

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO: 1) apaga toda a fundacao de Pagamentos da Folha criada ate o
-- momento do rollback -- nao ha soft-delete que sobreviva a um DROP TABLE
-- (NUNCA afeta public.pagamentos, tabela de outro dominio, intocada por
-- esta migration e por este rollback); 2) a volta de aplicar_escala_em_
-- lote para a versao anterior (0055/0060) e segura (o campo natureza_
-- financeira so existia como coluna aditiva, nunca exigido); 3) confirme
-- que nenhuma extra_remunerado real foi marcada antes de rodar (o DROP
-- COLUMN abaixo descarta esse dado). So use antes de haver dado real
-- relevante desta frente.
-- BEGIN;
-- drop policy if exists folha_pagamentos_cancelamentos_select on public.folha_pagamentos_cancelamentos;
-- drop policy if exists folha_pagamentos_descontos_select on public.folha_pagamentos_descontos;
-- drop policy if exists folha_pagamentos_itens_select on public.folha_pagamentos_itens;
-- drop policy if exists folha_pagamentos_select on public.folha_pagamentos;
-- drop policy if exists funcionarios_preferencia_pagamento_update on public.funcionarios_preferencia_pagamento;
-- drop policy if exists funcionarios_preferencia_pagamento_insert on public.funcionarios_preferencia_pagamento;
-- drop policy if exists funcionarios_preferencia_pagamento_select on public.funcionarios_preferencia_pagamento;
-- drop policy if exists folha_valor_hora_insert on public.folha_valor_hora;
-- drop policy if exists folha_valor_hora_select on public.folha_valor_hora;
-- drop policy if exists funcionarios_remuneracao_base_insert on public.funcionarios_remuneracao_base;
-- drop policy if exists funcionarios_remuneracao_base_select on public.funcionarios_remuneracao_base;
-- drop policy if exists funcionarios_forma_remuneracao_insert on public.funcionarios_forma_remuneracao;
-- drop policy if exists funcionarios_forma_remuneracao_select on public.funcionarios_forma_remuneracao;
-- drop policy if exists funcionarios_vinculo_historico_select on public.funcionarios_vinculo_historico;
-- delete from public.perfil_permissoes where permissao in ('folha_pagamentos.visualizar','folha_pagamentos.editar','folha_pagamentos.confirmar','folha_pagamentos.cancelar','folha_pagamentos.regras');
-- delete from public.permissoes where codigo in ('folha_pagamentos.visualizar','folha_pagamentos.editar','folha_pagamentos.confirmar','folha_pagamentos.cancelar','folha_pagamentos.regras');
-- drop table if exists public.folha_pagamentos_cancelamentos;
-- drop table if exists public.folha_pagamentos_descontos;
-- drop table if exists public.folha_pagamentos_itens;
-- drop table if exists public.folha_pagamentos;
-- drop table if exists public.funcionarios_preferencia_pagamento;
-- drop table if exists public.folha_valor_hora;
-- drop table if exists public.funcionarios_remuneracao_base;
-- drop table if exists public.funcionarios_forma_remuneracao;
-- alter table public.funcionarios_escala_periodos drop constraint if exists funcionarios_escala_periodos_natureza_valida;
-- alter table public.funcionarios_escala_periodos drop column if exists natureza_financeira;
-- drop trigger if exists funcionarios_vinculo_historico_trigger on public.funcionarios;
-- drop function if exists public.funcionarios_vinculo_historico_trigger_fn();
-- drop table if exists public.funcionarios_vinculo_historico;
-- -- aplicar_escala_em_lote: reverter manualmente para o corpo EXATO
-- -- publicado em 0055 (ou 0060, se aplicavel) se precisar desfazer a
-- -- extensao de natureza_financeira -- nao reproduzido aqui para nao
-- -- duplicar ~170 linhas; copie o CREATE OR REPLACE de 0055.
-- COMMIT;
