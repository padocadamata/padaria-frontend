-- 0066_folha_pagamentos_motor.sql
-- FOLHA DE PAGAMENTO > PAGAMENTOS -- motor operacional (RPCs de calculo de
-- pendencias, criacao de pagamento por_hora/mensal, cancelamento) + a
-- protecao "K" (bloqueio de alteracao de jornada ja paga) em
-- aplicar_escala_em_lote + 2 correcoes estruturais na fundacao 0065 (ja
-- aplicada e aprovada no banco real). NENHUM frontend nesta migration --
-- SQL somente.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor,
-- depois de conferir a pre-auditoria.
--
-- ============================================================
-- CORRECAO 1 -- "um pagamento por competencia" CANCELADA
-- ============================================================
-- A migration 0065 criou folha_pagamentos_competencia_unica_idx, um indice
-- UNICO parcial que permitia no maximo 1 pagamento mensal NAO cancelado por
-- funcionario+competencia. A instrucao desta rodada e explicita: NAO impor
-- essa arquitetura -- precisamos preservar a possibilidade operacional de
-- adiantamento, pagamento parcial e complemento dentro da MESMA competencia
-- (ex.: adianta parte do mes, depois paga o resto; ou paga, depois lanca um
-- complemento). Esta migration DERRUBA esse indice unico e o substitui por
-- um indice comum (nao-unico), mantendo a performance de consulta por
-- competencia sem nenhuma trava de quantidade. Nenhum controle de "quanto
-- falta pagar da competencia" e criado aqui (evita motor trabalhista
-- completo, fora de escopo) -- a tela de Pagos mostra todos os pagamentos
-- (inclusive multiplos) de uma competencia, e quem decide se ja esta
-- completa e a pessoa, olhando a soma exibida. (Complemento C6, abaixo: o
-- banco so impede quitar MAIS base do que o saldo da competencia.)
--
-- ============================================================
-- CORRECAO 2 -- motivo do cancelamento passa a ser OBRIGATORIO
-- ============================================================
-- folha_pagamentos_cancelamentos.motivo nascia NULLABLE em 0065 (decisao em
-- aberto naquele momento). A instrucao desta rodada fecha isso: todo
-- cancelamento PRECISA de motivo. A tabela ainda nao tem nenhuma linha real
-- (nenhuma RPC de cancelamento existia ate agora) -- ALTER COLUMN SET NOT
-- NULL e seguro, sem dado existente para migrar.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1. DROP do indice unico de competencia + indice comum no lugar
--      (correcao 1, acima).
--   2. folha_pagamentos_cancelamentos.motivo passa a NOT NULL + CHECK de
--      nao-vazio (correcao 2, acima).
--   3. CREATE OR REPLACE aplicar_escala_em_lote (0055 -> 0065 -> esta
--      versao): EXTENSAO CIRURGICA -- acrescenta a protecao "K", que a
--      0065 ja deixava explicitamente pendente no comentario da funcao.
--      Bloqueia alterar/remover uma jornada que ja tem pagamento confirmado
--      ativo (folha_pagamentos_itens.pagamento_cancelado = false) sem antes
--      cancelar o pagamento. NAO bloqueia: resalvar a jornada IDENTICA
--      (mesmo hora_inicio/hora_fim), nem adicionar um periodo NOVO e
--      nao-conflitante no mesmo dia. Mensagem de erro EXATA exigida:
--      "Esta jornada já possui pagamento confirmado. Cancele o pagamento
--      antes de alterar o horário." -- verificada no PASSE 1 (sem nenhuma
--      escrita), mesma disciplina ja usada por toda validacao desta RPC.
--      Nenhuma outra linha de logica (overlap, duplicidade, ocorrencia,
--      natureza_financeira) e alterada.
--   4. 5 RPCs novas, todas SECURITY DEFINER + search_path='' + checagem
--      explicita de permissao (mesmo padrao de toda a Folha de Pagamento):
--        a. folha_calcular_pendencias_por_hora(p_funcionario_id) -- lista
--           jornadas da Escala ainda nao pagas, excluindo dias com falta/
--           atestado, com valor calculado pelo valor/hora vigente na data.
--           Requer folha_pagamentos.visualizar.
--        b. folha_calcular_pendencia_mensal(p_funcionario_id, p_competencia)
--           -- resumo de 1 linha da competencia: valor-base vigente,
--           quantidade de faltas no mes, sugestao de desconto (base/30 por
--           falta, NUNCA aplicada automaticamente), extras remunerados
--           ainda nao pagos (lista + soma). Requer folha_pagamentos.
--           visualizar.
--        c. folha_criar_pagamento_por_hora(p_funcionario_id, p_jornadas,
--           p_descontos, p_data_efetiva, p_observacao) -- cria e confirma
--           atomicamente um pagamento por_hora (nao existe rascunho
--           persistido, mesmo principio ja documentado em 0065). Requer
--           folha_pagamentos.confirmar.
--        d. folha_criar_pagamento_mensal(p_funcionario_id, p_competencia,
--           p_extras, p_descontos, p_data_efetiva, p_observacao) -- idem,
--           natureza mensal; p_extras e a lista de periodos ja marcados
--           extra_remunerado na Escala que esta pagamento inclui. Requer
--           folha_pagamentos.confirmar.
--        e. folha_cancelar_pagamento(p_pagamento_id, p_motivo) -- estorno
--           logico: status=cancelado, libera os itens (pagamento_cancelado
--           =true), grava quem/quando/motivo (motivo obrigatorio). Requer
--           folha_pagamentos.cancelar.
--      Anti-duplicidade: cada RPC de criacao valida explicitamente ANTES de
--      escrever (mensagem amigavel no caso comum) E conta com o indice
--      unico parcial folha_pagamentos_itens_jornada_unica_idx (ja criado em
--      0065) como garantia final contra condicao de corrida real -- captura
--      unique_violation e devolve mensagem amigavel em vez do erro cru do
--      Postgres.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em public.pagamentos (tabela real, dominio
--     fornecedores/NF-e) -- confirmado por grep: zero referencia bare a
--     "public.pagamentos" neste arquivo;
--   * nenhuma tabela nova;
--   * nenhum motor de "saldo devedor por competencia" -- so lista
--     pagamentos, nunca calcula quanto falta;
--   * nenhuma alteracao na logica de overlap/duplicidade/ocorrencia ja
--     existente de aplicar_escala_em_lote, alem da protecao K aditiva;
--   * nenhuma tela de frontend (fica para os arquivos .js desta mesma
--     rodada, fora desta migration);
--   * popular funcionarios_forma_remuneracao/funcionarios_remuneracao_base
--     -- continua decisao de negocio pela interface, nunca presumida aqui.
--
-- ============================================================
-- COMPLEMENTO (retomada da rodada, antes de qualquer execucao no banco)
-- ============================================================
-- A revisao da versao anterior deste arquivo (nunca executada) encontrou
-- lacunas reais; corrigidas aqui, na MESMA migration 0066:
--   C3. funcionarios_vinculo_historico so era mantido por trigger AFTER
--       UPDATE (0065): funcionario cadastrado depois da 0065 ficaria SEM
--       nenhuma vigencia e folha_pagamentos.tipo_vinculo_snapshot (NOT
--       NULL) quebraria o pagamento com erro cru. Trigger passa a cobrir
--       INSERT tambem + backfill idempotente + helper interno
--       folha_tipo_vinculo_em(funcionario, data) com fallback explicito.
--   C4. Corrida Escala x Pagamento: a protecao K lia folha_pagamentos_itens
--       sem trava -- uma regravacao da Escala concorrente com a criacao de
--       um pagamento poderia apagar a jornada que estava sendo paga. Trava
--       transacional por funcionario (pg_advisory_xact_lock, helper
--       interno folha_travar_funcionario) usada pela Escala, pelas RPCs de
--       criacao e pela registro de configuracao.
--   C5. aplicar_escala_em_lote: periodo enviado SEM natureza_financeira
--       (lote, copiar dia/semana) sobre um periodo identico ja marcado
--       extra_remunerado nao vira mais 'normal' silenciosamente -- herda a
--       natureza existente. Envio EXPLICITO de 'normal' continua mudando.
--   C6. Mensal: a versao anterior sempre lancava a remuneracao-base
--       INTEIRA -- um 2o pagamento na mesma competencia (complemento/
--       parcial) pagaria a base de novo. Agora cada pagamento mensal
--       informa tipo_lancamento (integral|adiantamento|parcial|
--       complemento) e valor_base_pago (0..saldo da base na competencia);
--       o banco recusa pagar mais base do que o saldo (soma dos pagamentos
--       ATIVOS da competencia). Extras continuam independentes.
--   C7. Snapshot de autoria: confirmado_por_nome / cancelado_por_nome
--       (de public.usuarios, no momento da acao) -- auth.users nao e
--       legivel pela UI.
--   C8. Configuracoes (valor/hora, forma de remuneracao, remuneracao-base,
--       preferencia) passam a ser escritas SOMENTE por RPC (criado_por =
--       auth.uid() no servidor, nunca enviado pelo cliente); as policies
--       de INSERT/UPDATE diretas da 0065 sao removidas.
--   C9. Jornadas/extras com data FUTURA (hoje em America/Sao_Paulo) nao
--       aparecem como pendencia e nao podem ser pagas; extras em dia com
--       falta/atestado tambem nao.
--
-- Envolvida em transacao explicita (BEGIN/COMMIT).

BEGIN;

-- ============================================================
-- 0a. C3 -- historico de vinculo cobre INSERT + backfill + helper.
-- ============================================================
create or replace function public.funcionarios_vinculo_historico_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.funcionarios_vinculo_historico (funcionario_id, tipo_vinculo, vigente_desde, criado_por)
    values (new.id, new.tipo_vinculo, coalesce(new.data_admissao, current_date), auth.uid())
    on conflict (funcionario_id, vigente_desde) do nothing;
  elsif tg_op = 'UPDATE' and new.tipo_vinculo is distinct from old.tipo_vinculo then
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
  'AFTER INSERT OR UPDATE em funcionarios (INSERT desde 0066). INSERT: cria a vigencia inicial (data_admissao ou hoje). UPDATE: so reage quando tipo_vinculo realmente muda -- nova vigencia com vigente_desde=CURRENT_DATE; ON CONFLICT no mesmo dia, a ultima alteracao do dia prevalece. Nunca reescreve vigencias anteriores -- pagamentos ja confirmados guardam o proprio snapshot (folha_pagamentos.tipo_vinculo_snapshot) e nunca sao reinterpretados.';

drop trigger if exists funcionarios_vinculo_historico_trigger on public.funcionarios;
create trigger funcionarios_vinculo_historico_trigger
  after insert or update on public.funcionarios
  for each row
  execute function public.funcionarios_vinculo_historico_trigger_fn();

-- Backfill idempotente: funcionario cadastrado entre a 0065 e esta
-- migration (sem nenhuma vigencia) -- mesmo criterio do seed da 0065.
insert into public.funcionarios_vinculo_historico (funcionario_id, tipo_vinculo, vigente_desde)
select f.id, f.tipo_vinculo, coalesce(f.data_admissao, f.criado_em::date)
from public.funcionarios f
where not exists (
  select 1 from public.funcionarios_vinculo_historico h where h.funcionario_id = f.id
);

-- Helper INTERNO (sem EXECUTE para nenhum papel de API): vinculo vigente
-- numa data. Fallback explicito, nunca NULL para funcionario existente:
-- 1) vigencia <= data; 2) se a data for anterior a primeira vigencia
-- registrada, a primeira vigencia; 3) o tipo_vinculo atual do cadastro.
create or replace function public.folha_tipo_vinculo_em(p_funcionario_id uuid, p_data date)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select h.tipo_vinculo from public.funcionarios_vinculo_historico h
      where h.funcionario_id = p_funcionario_id and h.vigente_desde <= p_data
      order by h.vigente_desde desc limit 1),
    (select h.tipo_vinculo from public.funcionarios_vinculo_historico h
      where h.funcionario_id = p_funcionario_id
      order by h.vigente_desde asc limit 1),
    (select f.tipo_vinculo from public.funcionarios f where f.id = p_funcionario_id)
  );
$$;

comment on function public.folha_tipo_vinculo_em(uuid, date) is
  'Migration 0066 (interna). Vinculo (funcionario|freelancer|pj) vigente para o funcionario na data, com fallback explicito (primeira vigencia registrada, depois o cadastro atual). Usada so pelas RPCs de criacao de pagamento para congelar tipo_vinculo_snapshot. Sem EXECUTE para public/anon/authenticated/service_role.';

revoke execute on function public.folha_tipo_vinculo_em(uuid, date) from public;
revoke execute on function public.folha_tipo_vinculo_em(uuid, date) from anon;
revoke execute on function public.folha_tipo_vinculo_em(uuid, date) from authenticated;
revoke execute on function public.folha_tipo_vinculo_em(uuid, date) from service_role;

-- ============================================================
-- 0b. C4 -- trava transacional por funcionario (Escala x Pagamento).
-- ============================================================
create or replace function public.folha_travar_funcionario(p_funcionario_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('folha_jornadas:' || p_funcionario_id::text, 0));
end;
$$;

comment on function public.folha_travar_funcionario(uuid) is
  'Migration 0066 (interna). pg_advisory_xact_lock por funcionario, liberado no fim da transacao. Serializa, para o MESMO funcionario: regravacao da Escala (aplicar_escala_em_lote), criacao de pagamento (por_hora/mensal) e cancelamento -- fecha a corrida em que a Escala apagaria uma jornada enquanto ela esta sendo paga. Chamadores com varios funcionarios travam em ordem crescente de id (sem deadlock). Sem EXECUTE para papeis de API.';

revoke execute on function public.folha_travar_funcionario(uuid) from public;
revoke execute on function public.folha_travar_funcionario(uuid) from anon;
revoke execute on function public.folha_travar_funcionario(uuid) from authenticated;
revoke execute on function public.folha_travar_funcionario(uuid) from service_role;

-- Data "hoje" operacional da Padoca (mesmo criterio de 0022/0026).
create or replace function public.folha_hoje()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

comment on function public.folha_hoje() is
  'Migration 0066 (interna). Data de hoje em America/Sao_Paulo -- limite para pendencias/pagamentos (nunca paga jornada futura).';

revoke execute on function public.folha_hoje() from public;
revoke execute on function public.folha_hoje() from anon;
revoke execute on function public.folha_hoje() from authenticated;
revoke execute on function public.folha_hoje() from service_role;

-- ============================================================
-- 0c. C6/C7 -- colunas novas em folha_pagamentos/cancelamentos. A tabela
--     folha_pagamentos ainda nao tem nenhuma linha real (nenhuma RPC de
--     criacao existia; conferido na pre-auditoria) -- CHECK novo e seguro.
-- ============================================================
alter table public.folha_pagamentos
  add column if not exists tipo_lancamento text,
  add column if not exists valor_base_pago numeric(12,2),
  add column if not exists confirmado_por_nome text;

do $$
begin
  alter table public.folha_pagamentos
    add constraint folha_pagamentos_lancamento_mensal_coerente
    check (
      (natureza = 'mensal'
        and tipo_lancamento in ('integral', 'adiantamento', 'parcial', 'complemento')
        and valor_base_pago is not null and valor_base_pago >= 0)
      or
      (natureza = 'por_hora' and tipo_lancamento is null and valor_base_pago is null)
    );
exception
  when duplicate_object then null;
end $$;

comment on column public.folha_pagamentos.tipo_lancamento is
  'Migration 0066. So natureza=mensal: integral|adiantamento|parcial|complemento -- rotulo operacional do lancamento dentro da competencia (varios pagamentos por competencia sao permitidos). NAO confundir com o beneficio ADIANTAMENTO SALARIAL do cadastro de funcionarios.';
comment on column public.folha_pagamentos.valor_base_pago is
  'Migration 0066. So natureza=mensal: quanto da remuneracao-base (valor_mensal_base_snapshot) este pagamento quita. Soma dos pagamentos ATIVOS da competencia nunca ultrapassa a base (validado em folha_criar_pagamento_mensal). 0 = pagamento so de extras.';
comment on column public.folha_pagamentos.confirmado_por_nome is
  'Migration 0066. Snapshot do nome (public.usuarios) de quem confirmou, no momento da confirmacao.';

alter table public.folha_pagamentos_cancelamentos
  add column if not exists cancelado_por_nome text;

comment on column public.folha_pagamentos_cancelamentos.cancelado_por_nome is
  'Migration 0066. Snapshot do nome (public.usuarios) de quem cancelou, no momento do cancelamento.';

create index if not exists folha_pagamentos_data_efetiva_idx
  on public.folha_pagamentos (data_efetiva desc);

-- ============================================================
-- 1. CORRECAO 1 -- remove a trava de "1 pagamento por competencia".
-- ============================================================
drop index if exists public.folha_pagamentos_competencia_unica_idx;

create index if not exists folha_pagamentos_competencia_idx
  on public.folha_pagamentos (funcionario_id, competencia)
  where natureza = 'mensal';

comment on index public.folha_pagamentos_competencia_idx is
  'Indice COMUM (nao-unico) por funcionario+competencia -- migration 0066 substitui folha_pagamentos_competencia_unica_idx (0065), que impedia mais de 1 pagamento mensal ativo por competencia. Decisao revista explicitamente: a Folha de Pagamento precisa suportar adiantamento/pagamento parcial/complemento dentro da MESMA competencia, sem se tornar um motor trabalhista completo -- a tela de Pagos soma e mostra todos os pagamentos de uma competencia; nenhuma trava de "quanto falta pagar" existe no banco.';

comment on table public.folha_pagamentos is
  'Cabecalho de um pagamento da FOLHA DE PAGAMENTO (migration 0065, corrigida em 0066) -- NAO CONFUNDIR com public.pagamentos (tabela ja existente, dominio fornecedores/NF-e, intocada). natureza=mensal (competencia + valor_mensal_base_snapshot, cobre CLT/freelancer/PJ configurados como mensal) ou natureza=por_hora (1+ linhas em folha_pagamentos_itens). SOMENTE 2 status: confirmado|cancelado -- nao existe "rascunho" persistido, o pagamento nasce ja confirmado (o "rascunho" e so estado de UI antes de chamar a RPC de criacao -- folha_criar_pagamento_por_hora/folha_criar_pagamento_mensal, migration 0066 -- que grava tudo atomicamente). Snapshot imutavel: tipo_vinculo_snapshot/valor_mensal_base_snapshot/valor_hora_snapshot congelam o que valia NA DATA RELEVANTE (jornada ou competencia), nunca o valor atual das tabelas de parametrizacao. Cancelamento e sempre logico (ver folha_pagamentos_cancelamentos, via folha_cancelar_pagamento) -- nunca DELETE. Migration 0066 removeu a trava de "1 pagamento ativo por competencia" -- multiplos pagamentos (adiantamento/parcial/complemento, coluna tipo_lancamento) sao permitidos para a mesma competencia; valor_base_pago registra quanto da base cada um quita e a soma dos ativos nunca ultrapassa a base. Autoria congelada em confirmado_por/confirmado_por_nome/confirmado_em.';

-- ============================================================
-- 2. CORRECAO 2 -- motivo do cancelamento passa a ser obrigatorio.
--    Tabela ainda sem nenhuma linha real (nenhuma RPC de cancelamento
--    existia ate esta migration) -- ALTER seguro, nada a migrar.
-- ============================================================
alter table public.folha_pagamentos_cancelamentos
  alter column motivo set not null;

do $$
begin
  alter table public.folha_pagamentos_cancelamentos
    add constraint folha_pagamentos_cancelamentos_motivo_nao_vazio
    check (btrim(motivo) <> '');
exception
  when duplicate_object then null;
end $$;

comment on table public.folha_pagamentos_cancelamentos is
  'Registro de cancelamento/estorno logico de um pagamento da Folha de Pagamento (migration 0065, motivo obrigatorio desde 0066) -- no maximo 1 por pagamento (UNIQUE). folha_pagamentos.status so vai para cancelado atraves desta tabela, pela RPC folha_cancelar_pagamento (migration 0066). Jornadas incluidas no pagamento cancelado voltam a ficar disponiveis automaticamente (via folha_pagamentos_itens.pagamento_cancelado=true, que libera o indice unico de identidade).';

-- ============================================================
-- 3. PROTECAO "K" -- extensao CIRURGICA de aplicar_escala_em_lote (0055 ->
--    0065 -> esta versao). Unica mudanca de comportamento: bloqueia, no
--    PASSE 1 (sem nenhuma escrita), alterar ou remover uma jornada que ja
--    tem pagamento confirmado ATIVO (folha_pagamentos_itens, migration
--    0065). Toda a logica ja publicada (funcionario existe, tipo_dia
--    valido, periodos coerentes, sobreposicao, duplicidade de funcionario+
--    data, conflito com ocorrencia, natureza_financeira) permanece
--    EXATAMENTE igual -- nao removida, nao reordenada, so com 2 blocos
--    novos (1 no ramo folga/remover, 1 no ramo trabalho).
-- ============================================================
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
  v_item_pago            record;
  v_trava_id             uuid;
  v_periodos_antigos     jsonb;
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

  -- NOVO (migration 0066, C4) -- trava transacional por funcionario, em
  -- ordem crescente de id (sem deadlock entre chamadas concorrentes),
  -- ANTES da protecao K: nenhuma criacao de pagamento do mesmo
  -- funcionario corre em paralelo com esta regravacao. ids invalidos sao
  -- ignorados aqui e rejeitados normalmente pela validacao abaixo.
  for v_trava_id in
    select distinct (item->>'funcionario_id')::uuid
    from jsonb_array_elements(p_atribuicoes) as item
    where (item->>'funcionario_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    order by 1
  loop
    perform public.folha_travar_funcionario(v_trava_id);
  end loop;

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

      -- NOVO (migration 0066) -- protecao K: folga/remover apagaria
      -- fisicamente qualquer jornada paga daquele dia (funcionarios_
      -- escala_periodos e sempre DELETE+INSERT) -- bloqueia sempre que
      -- exista pelo menos 1 item de pagamento ATIVO para este funcionario+
      -- data, independente do horario.
      if exists (
        select 1 from public.folha_pagamentos_itens i
        where i.funcionario_id = v_funcionario_id and i.data = v_data and not i.pagamento_cancelado
      ) then
        raise exception 'Esta jornada já possui pagamento confirmado. Cancele o pagamento antes de alterar o horário.';
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

      -- (migration 0065) -- campo opcional, ausente/vazio = 'normal'
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

    -- NOVO (migration 0066) -- protecao K: toda jornada ja paga
    -- (funcionario+data+hora_inicio+hora_fim) precisa continuar aparecendo
    -- EXATAMENTE (mesmo horario) entre os periodos do novo payload deste
    -- dia. Resalvar a jornada identica continua permitido (ela esta na
    -- lista); adicionar um periodo novo e nao-conflitante tambem continua
    -- permitido (so acrescenta, nao precisa "faltar" nada). So bloqueia
    -- quando uma jornada paga SUMIRIA ou MUDARIA de horario.
    for v_item_pago in (
      select i.hora_inicio, i.hora_fim
      from public.folha_pagamentos_itens i
      where i.funcionario_id = v_funcionario_id and i.data = v_data and not i.pagamento_cancelado
    ) loop
      if not exists (
        select 1 from jsonb_array_elements(v_periodos) as p
        where (p->>'hora_inicio')::time = v_item_pago.hora_inicio
          and (p->>'hora_fim')::time = v_item_pago.hora_fim
      ) then
        raise exception 'Esta jornada já possui pagamento confirmado. Cancele o pagamento antes de alterar o horário.';
      end if;
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

    -- NOVO (migration 0066, C5) -- guarda a natureza dos periodos atuais
    -- antes do DELETE, para herdar quando o payload nao informa o campo.
    select coalesce(jsonb_agg(jsonb_build_object(
      'hora_inicio', ep.hora_inicio, 'hora_fim', ep.hora_fim, 'natureza_financeira', ep.natureza_financeira
    )), '[]'::jsonb)
    into v_periodos_antigos
    from public.funcionarios_escala_periodos ep
    where ep.escala_dia_id = v_dia_id;

    delete from public.funcionarios_escala_periodos where escala_dia_id = v_dia_id;

    if v_tipo_dia = 'trabalho' then
      -- (migration 0065): grava natureza_financeira. (migration 0066, C5):
      -- informado -> usa o informado; ausente/vazio -> herda a natureza do
      -- periodo IDENTICO (mesmo hora_inicio/hora_fim) que ja existia neste
      -- dia; sem periodo identico -> 'normal' (default da coluna). Assim
      -- lote/copia nunca rebaixam um extra_remunerado silenciosamente. A
      -- coluna tambem tem CHECK proprio (defesa em profundidade).
      insert into public.funcionarios_escala_periodos (escala_dia_id, hora_inicio, hora_fim, natureza_financeira)
      select
        v_dia_id,
        (p->>'hora_inicio')::time,
        (p->>'hora_fim')::time,
        coalesce(
          nullif(p->>'natureza_financeira', ''),
          (select a->>'natureza_financeira' from jsonb_array_elements(v_periodos_antigos) as a
            where (a->>'hora_inicio')::time = (p->>'hora_inicio')::time
              and (a->>'hora_fim')::time = (p->>'hora_fim')::time
            limit 1),
          'normal'
        )
      from jsonb_array_elements(v_periodos) as p;
    end if;
  end loop;
end;
$$;

comment on function public.aplicar_escala_em_lote(jsonb) is
  'Primitivo UNICO de escrita da Escala: salva 1..N dias (funcionario+data) atomicamente -- salvar um dia, copiar dia, copiar semana e aplicar horario em lote (varios dias e/ou varios funcionarios) sao todos o MESMO array, so de tamanho diferente, montado no frontend. tipo_dia=trabalho substitui os periodos do dia (DELETE+INSERT); tipo_dia=folga limpa os periodos; tipo_dia=remover apaga a linha do dia inteiro (volta a "nao definido"). Nunca perde falta/atestado silenciosamente: folga/remover sao rejeitados se ja existir ocorrencia para aquele dia. Validacao completa (passe 1: funcionario existe, tipo_dia valido, periodos coerentes e sem sobreposicao dentro do mesmo dia, sem funcionario+data duplicado no array, sem conflito com ocorrencia existente, natureza_financeira valida quando informada, protecao K contra alterar/remover jornada ja paga) SEM nenhuma escrita, seguida da aplicacao (passe 2) -- tudo ou nada. SECURITY DEFINER + checagem explicita de escala.editar: necessario porque a validacao consulta public.funcionarios (RLS propria, funcionarios.visualizar) e public.folha_pagamentos_itens (RLS propria, folha_pagamentos.visualizar) -- um usuario com escala.editar mas sem essas outras permissoes nao pode ficar bloqueado por essas checagens cruzadas. Migration 0065 (frente Pagamentos): cada periodo aceita um campo opcional natureza_financeira (normal|extra_remunerado, default normal) -- 100% retrocompativel. Migration 0066 (protecao K, antes pendente): bloqueia alterar/remover (folga, remover ou trabalho com horario diferente) uma jornada (funcionario+data+hora_inicio+hora_fim) que ja tenha pagamento confirmado ATIVO em folha_pagamentos_itens -- mensagem exata "Esta jornada já possui pagamento confirmado. Cancele o pagamento antes de alterar o horário." Resalvar a jornada IDENTICA (mesmo horario, ainda que o periodo fisico seja recriado por tras) continua permitido; adicionar um periodo novo e nao-conflitante no mesmo dia tambem continua permitido -- a protecao so reage quando uma jornada paga sumiria ou mudaria de horario. Cancele o pagamento (folha_cancelar_pagamento) para liberar a jornada antes de editar. Ainda em 0066: trava transacional por funcionario (folha_travar_funcionario, ordem crescente de id) antes da protecao K -- serializa com a criacao de pagamento; e periodo enviado SEM natureza_financeira herda a natureza do periodo identico ja existente no dia (nunca rebaixa extra_remunerado silenciosamente em lote/copia) -- envio explicito de normal continua valendo.';

-- Grants inalterados (ja concedidos em 0055/0065) -- CREATE OR REPLACE
-- preserva owner/grants existentes, mas reafirma aqui por clareza e para
-- nunca depender de estado implicito.
revoke execute on function public.aplicar_escala_em_lote(jsonb) from public;
revoke execute on function public.aplicar_escala_em_lote(jsonb) from anon;
revoke execute on function public.aplicar_escala_em_lote(jsonb) from service_role;
grant execute on function public.aplicar_escala_em_lote(jsonb) to authenticated;


-- ============================================================
-- 4a. folha_calcular_pendencias_por_hora -- jornadas da Escala ainda nao
--     pagas para 1 funcionario, excluindo dias com falta/atestado, datas
--     futuras, e respeitando a forma_remuneracao vigente NA DATA DE CADA
--     JORNADA (nunca a forma atual).
-- ============================================================
create or replace function public.folha_calcular_pendencias_por_hora(
  p_funcionario_id uuid
)
returns table (
  data                 date,
  hora_inicio          time,
  hora_fim             time,
  duracao_minutos      integer,
  natureza_financeira  text,
  valor_hora_aplicado  numeric(12,2),
  valor                numeric(12,2)
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    round((x.duracao_minutos / 60.0) * x.valor_hora_aplicado, 2)::numeric(12,2)
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
      -- FALTA/ATESTADO nunca geram pendencia (decisao fechada em 0065).
      and not exists (select 1 from public.funcionarios_escala_ocorrencias o where o.escala_dia_id = d.id)
      -- forma_remuneracao vigente NA DATA DA JORNADA precisa ser por_hora.
      and (
        select fr.forma from public.funcionarios_forma_remuneracao fr
        where fr.funcionario_id = d.funcionario_id and fr.vigente_desde <= d.data
        order by fr.vigente_desde desc limit 1
      ) = 'por_hora'
      -- ainda nao paga (ativa).
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
  'Migration 0066. Lista as jornadas da Escala de 1 funcionario ainda nao pagas, elegiveis para pagamento por_hora: dia tipo_dia=trabalho, data <= hoje (America/Sao_Paulo), sem falta/atestado naquele dia, forma_remuneracao vigente NA DATA DA JORNADA = por_hora, sem item ativo em folha_pagamentos_itens para a identidade exata (funcionario+data+hora_inicio+hora_fim). Periodo extra_remunerado de pessoa por_hora aparece UMA vez, como qualquer jornada (nunca duplica). valor = duracao_minutos/60 * valor/hora vigente na data (valor_hora_aplicado NULL = sem valor/hora vigente; a criacao rejeita). SECURITY DEFINER: le Escala (RLS escala.visualizar) para quem so tem folha_pagamentos.visualizar.';

revoke execute on function public.folha_calcular_pendencias_por_hora(uuid) from public;
revoke execute on function public.folha_calcular_pendencias_por_hora(uuid) from anon;
revoke execute on function public.folha_calcular_pendencias_por_hora(uuid) from service_role;
grant execute on function public.folha_calcular_pendencias_por_hora(uuid) to authenticated;

-- ============================================================
-- 4b. folha_calcular_pendencia_mensal -- resumo de 1 competencia (mes) para
--     1 funcionario: base vigente, quanto da base ja foi pago (soma dos
--     pagamentos ATIVOS), saldo, faltas (so sugestao), extras pendentes.
-- ============================================================
create or replace function public.folha_calcular_pendencia_mensal(
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
  valor_extras_pendentes    numeric(12,2)
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
        and not exists (select 1 from public.funcionarios_escala_ocorrencias o where o.escala_dia_id = d.id)
        -- extra so e adicional para quem era MENSAL naquela data (para
        -- por_hora a jornada ja e paga pelo fluxo por hora -- nunca duplica).
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
    v_valor_extras::numeric(12,2);
end;
$$;

comment on function public.folha_calcular_pendencia_mensal(uuid, date) is
  'Migration 0066. Resumo de 1 competencia (mes de p_competencia) para 1 funcionario: forma vigente no fim do mes, remuneracao-base vigente no fim do mes, quanto dessa base ja foi quitado por pagamentos mensais ATIVOS da competencia (valor_base_ja_pago, pagamentos_ativos_qtd) e o saldo -- varios pagamentos por competencia sao permitidos (adiantamento/parcial/complemento). Faltas do mes: sugestao_desconto_falta = base/30 * faltas -- SO SUGESTAO, nunca aplicada automaticamente; atestado nunca gera sugestao (so contado). Extras: periodos extra_remunerado do mes, ate hoje, sem falta/atestado no dia, com forma mensal NA DATA, ainda nao pagos. SECURITY DEFINER pelo mesmo motivo de folha_calcular_pendencias_por_hora.';

revoke execute on function public.folha_calcular_pendencia_mensal(uuid, date) from public;
revoke execute on function public.folha_calcular_pendencia_mensal(uuid, date) from anon;
revoke execute on function public.folha_calcular_pendencia_mensal(uuid, date) from service_role;
grant execute on function public.folha_calcular_pendencia_mensal(uuid, date) to authenticated;

-- ============================================================
-- 4c. folha_criar_pagamento_por_hora -- cria e confirma atomicamente.
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
  v_valor_item          numeric(12,2);
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

  -- C4: serializa com a Escala e com outro pagamento do mesmo funcionario.
  perform public.folha_travar_funcionario(p_funcionario_id);

  select count(*), count(distinct (j->>'data') || '|' || (j->>'hora_inicio') || '|' || (j->>'hora_fim'))
  into v_total_jornadas, v_total_distintas
  from jsonb_array_elements(p_jornadas) as j;

  if v_total_jornadas <> v_total_distintas then
    raise exception 'folha_criar_pagamento_por_hora: p_jornadas contem jornada duplicada no mesmo pedido.';
  end if;

  -- Passe 1 -- valida cada jornada SEM nenhuma escrita, acumulando bruto.
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

    if not exists (
      select 1
      from public.funcionarios_escala_periodos p
      join public.funcionarios_escala_dias d on d.id = p.escala_dia_id
      where d.funcionario_id = p_funcionario_id and d.data = v_data and d.tipo_dia = 'trabalho'
        and p.hora_inicio = v_hora_inicio and p.hora_fim = v_hora_fim
    ) then
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
    if v_valor_hora is null then
      raise exception 'folha_criar_pagamento_por_hora: nao ha valor/hora vigente para %.', v_data;
    end if;

    v_duracao_minutos := (extract(epoch from (v_hora_fim - v_hora_inicio)) / 60)::integer;
    v_valor_item := round((v_duracao_minutos / 60.0) * v_valor_hora, 2);
    v_bruto := v_bruto + v_valor_item;
  end loop;

  select max(nullif(j->>'data', '')::date) into v_data_max from jsonb_array_elements(p_jornadas) as j;

  -- C3: nunca NULL para funcionario existente (fallback explicito).
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
      duracao_minutos, natureza_financeira, valor_hora_aplicado, valor, escala_periodo_id
    )
    select
      v_pagamento_id, p_funcionario_id, x.data, x.hora_inicio, x.hora_fim,
      x.duracao_minutos, coalesce(x.natureza_financeira, 'normal'), x.valor_hora,
      round((x.duracao_minutos / 60.0) * x.valor_hora, 2),
      x.periodo_id
    from (
      select
        (j->>'data')::date as data,
        (j->>'hora_inicio')::time as hora_inicio,
        (j->>'hora_fim')::time as hora_fim,
        (extract(epoch from ((j->>'hora_fim')::time - (j->>'hora_inicio')::time)) / 60)::integer as duracao_minutos,
        per.natureza_financeira,
        per.id as periodo_id,
        (select vh.valor from public.folha_valor_hora vh where vh.vigente_desde <= (j->>'data')::date order by vh.vigente_desde desc limit 1) as valor_hora
      from jsonb_array_elements(p_jornadas) as j
      left join lateral (
        select p.id, p.natureza_financeira
        from public.funcionarios_escala_periodos p
        join public.funcionarios_escala_dias d on d.id = p.escala_dia_id
        where d.funcionario_id = p_funcionario_id and d.data = (j->>'data')::date
          and p.hora_inicio = (j->>'hora_inicio')::time and p.hora_fim = (j->>'hora_fim')::time
        limit 1
      ) as per on true
    ) as x;
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
  'Migration 0066. Cria e confirma atomicamente 1 pagamento natureza=por_hora: p_jornadas = qualquer subconjunto (>=1) de {data,hora_inicio,hora_fim} pendentes -- precisam existir EXATAMENTE na Escala, dia de trabalho, data <= hoje, sem falta/atestado, forma vigente na data = por_hora, ainda nao pagas; p_descontos = 0..N {tipo,valor,observacao?}. Valor de cada jornada = duracao_minutos/60 * valor/hora vigente NA DATA DELA. Snapshot: tipo_vinculo (folha_tipo_vinculo_em na maior data), valor/hora por item (folha_pagamentos_itens.valor_hora_aplicado), nome de quem confirmou. Anti-duplicidade: trava por funcionario + checagem explicita + indice unico parcial folha_pagamentos_itens_jornada_unica_idx (captura unique_violation). Bloqueia descontos > bruto. Requer folha_pagamentos.confirmar.';

revoke execute on function public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text) from public;
revoke execute on function public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text) from anon;
revoke execute on function public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text) from service_role;
grant execute on function public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text) to authenticated;

-- ============================================================
-- 4d. folha_criar_pagamento_mensal -- cria e confirma atomicamente.
--     Varios pagamentos por competencia (adiantamento/parcial/
--     complemento); o banco so impede quitar MAIS base do que o saldo.
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
  v_valor_item          numeric(12,2);
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

  -- C4: serializa com a Escala e com outro pagamento do mesmo funcionario
  -- (inclusive o calculo de saldo abaixo).
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

    if not exists (
      select 1 from public.funcionarios_escala_periodos p
      join public.funcionarios_escala_dias d on d.id = p.escala_dia_id
      where d.funcionario_id = p_funcionario_id and d.data = v_data and d.tipo_dia = 'trabalho'
        and p.hora_inicio = v_hora_inicio and p.hora_fim = v_hora_fim
        and p.natureza_financeira = 'extra_remunerado'
    ) then
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
    if v_valor_hora is null then
      raise exception 'folha_criar_pagamento_mensal: nao ha valor/hora vigente para %.', v_data;
    end if;

    v_duracao_minutos := (extract(epoch from (v_hora_fim - v_hora_inicio)) / 60)::integer;
    v_valor_item := round((v_duracao_minutos / 60.0) * v_valor_hora, 2);
    v_bruto := v_bruto + v_valor_item;
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

  if jsonb_array_length(v_extras_norm) > 0 then
    begin
      insert into public.folha_pagamentos_itens (
        pagamento_id, funcionario_id, data, hora_inicio, hora_fim,
        duracao_minutos, natureza_financeira, valor_hora_aplicado, valor, escala_periodo_id
      )
      select
        v_pagamento_id, p_funcionario_id, x.data, x.hora_inicio, x.hora_fim,
        x.duracao_minutos, 'extra_remunerado', x.valor_hora,
        round((x.duracao_minutos / 60.0) * x.valor_hora, 2),
        x.periodo_id
      from (
        select
          (e->>'data')::date as data,
          (e->>'hora_inicio')::time as hora_inicio,
          (e->>'hora_fim')::time as hora_fim,
          (extract(epoch from ((e->>'hora_fim')::time - (e->>'hora_inicio')::time)) / 60)::integer as duracao_minutos,
          (select p.id from public.funcionarios_escala_periodos p
             join public.funcionarios_escala_dias d on d.id = p.escala_dia_id
            where d.funcionario_id = p_funcionario_id and d.data = (e->>'data')::date
              and p.hora_inicio = (e->>'hora_inicio')::time and p.hora_fim = (e->>'hora_fim')::time
            limit 1) as periodo_id,
          (select vh.valor from public.folha_valor_hora vh where vh.vigente_desde <= (e->>'data')::date order by vh.vigente_desde desc limit 1) as valor_hora
        from jsonb_array_elements(v_extras_norm) as e
      ) as x;
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
  'Migration 0066. Cria e confirma atomicamente 1 pagamento natureza=mensal na competencia (mes de p_competencia, normalizado para o dia 1). Exige forma vigente no fim do mes = mensal e remuneracao-base configurada. p_tipo_lancamento = integral|adiantamento|parcial|complemento (rotulo; NAO e o beneficio Adiantamento Salarial). p_valor_base = quanto da base este pagamento quita (0..saldo; saldo = base - soma de valor_base_pago dos pagamentos ATIVOS da competencia) -- varios pagamentos por competencia sao permitidos, so nunca acima da base. p_extras = {data,hora_inicio,hora_fim} marcados extra_remunerado, no mes, ate hoje, sem falta/atestado, forma mensal NA DATA, nao pagos; cada um soma duracao/60*valor_hora vigente na SUA data. p_descontos = 0..N {tipo,valor,observacao?} -- sugestao de falta nunca e aplicada aqui (vem da tela, revisavel). Bloqueia descontos > bruto e bruto = 0. Requer folha_pagamentos.confirmar.';

revoke execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text) from public;
revoke execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text) from anon;
revoke execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text) from service_role;
grant execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text) to authenticated;

-- ============================================================
-- 4e. folha_cancelar_pagamento -- estorno logico, motivo obrigatorio.
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

  insert into public.folha_pagamentos_cancelamentos (pagamento_id, cancelado_por, cancelado_por_nome, motivo)
  values (p_pagamento_id, auth.uid(), (select u.nome from public.usuarios u where u.id = auth.uid()), v_motivo);
end;
$$;

comment on function public.folha_cancelar_pagamento(uuid, text) is
  'Migration 0066. Estorno LOGICO (nunca DELETE) de 1 pagamento: status=cancelado, libera os itens (folha_pagamentos_itens.pagamento_cancelado=true -- a jornada volta a ser pendente e editavel na Escala), devolve o valor_base_pago ao saldo da competencia (a soma so considera pagamentos ativos), e grava quem/quando/motivo (OBRIGATORIO) + nome em folha_pagamentos_cancelamentos. Snapshot, itens e descontos permanecem consultaveis. Rejeita cancelar pagamento ja cancelado. Trava por funcionario + FOR UPDATE. Requer folha_pagamentos.cancelar.';

revoke execute on function public.folha_cancelar_pagamento(uuid, text) from public;
revoke execute on function public.folha_cancelar_pagamento(uuid, text) from anon;
revoke execute on function public.folha_cancelar_pagamento(uuid, text) from service_role;
grant execute on function public.folha_cancelar_pagamento(uuid, text) to authenticated;

-- ============================================================
-- 5. C8 -- Configuracoes so por RPC (criado_por sempre do servidor).
--    Remove as policies de escrita direta da 0065 (SELECT permanece).
-- ============================================================
drop policy if exists funcionarios_forma_remuneracao_insert on public.funcionarios_forma_remuneracao;
drop policy if exists funcionarios_remuneracao_base_insert on public.funcionarios_remuneracao_base;
drop policy if exists folha_valor_hora_insert on public.folha_valor_hora;
drop policy if exists funcionarios_preferencia_pagamento_insert on public.funcionarios_preferencia_pagamento;
drop policy if exists funcionarios_preferencia_pagamento_update on public.funcionarios_preferencia_pagamento;

create or replace function public.folha_registrar_valor_hora(
  p_valor         numeric,
  p_vigente_desde date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (select public.has_permissao('folha_pagamentos.regras')) then
    raise exception using errcode = '42501',
      message = 'folha_registrar_valor_hora: requer a permissao folha_pagamentos.regras.';
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'folha_registrar_valor_hora: o valor/hora precisa ser maior que zero.';
  end if;
  if p_vigente_desde is null then
    raise exception 'folha_registrar_valor_hora: a data de vigencia e obrigatoria.';
  end if;

  begin
    insert into public.folha_valor_hora (valor, vigente_desde, criado_por)
    values (round(p_valor, 2), p_vigente_desde, auth.uid())
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'folha_registrar_valor_hora: ja existe valor/hora com vigencia em %.', to_char(p_vigente_desde, 'DD/MM/YYYY');
  end;
  return v_id;
end;
$$;

comment on function public.folha_registrar_valor_hora(numeric, date) is
  'Migration 0066. Nova vigencia do valor/hora GLOBAL (nunca edita/apaga uma vigencia existente). Jornadas ja pagas guardam o proprio valor_hora_aplicado e nunca mudam; jornadas pendentes sempre usam o valor vigente NA DATA DELAS. Requer folha_pagamentos.regras.';

create or replace function public.folha_registrar_forma_remuneracao(
  p_funcionario_id uuid,
  p_forma          text,
  p_vigente_desde  date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (select public.has_permissao('folha_pagamentos.regras')) then
    raise exception using errcode = '42501',
      message = 'folha_registrar_forma_remuneracao: requer a permissao folha_pagamentos.regras.';
  end if;
  if p_funcionario_id is null or not exists (select 1 from public.funcionarios where id = p_funcionario_id) then
    raise exception 'folha_registrar_forma_remuneracao: funcionario % nao encontrado.', p_funcionario_id;
  end if;
  if p_forma is null or p_forma not in ('mensal', 'por_hora') then
    raise exception 'folha_registrar_forma_remuneracao: forma invalida "%" -- use mensal ou por_hora.', p_forma;
  end if;
  if p_vigente_desde is null then
    raise exception 'folha_registrar_forma_remuneracao: a data de vigencia e obrigatoria.';
  end if;

  perform public.folha_travar_funcionario(p_funcionario_id);

  begin
    insert into public.funcionarios_forma_remuneracao (funcionario_id, forma, vigente_desde, criado_por)
    values (p_funcionario_id, p_forma, p_vigente_desde, auth.uid())
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'folha_registrar_forma_remuneracao: ja existe forma de remuneracao com vigencia em %.', to_char(p_vigente_desde, 'DD/MM/YYYY');
  end;
  return v_id;
end;
$$;

comment on function public.folha_registrar_forma_remuneracao(uuid, text, date) is
  'Migration 0066. Nova vigencia de forma de remuneracao (mensal|por_hora) de 1 funcionario -- independente do tipo de vinculo. Pagamentos ja confirmados nunca sao reinterpretados (natureza e snapshot proprios). Requer folha_pagamentos.regras.';

create or replace function public.folha_registrar_remuneracao_base(
  p_funcionario_id uuid,
  p_valor          numeric,
  p_vigente_desde  date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (select public.has_permissao('folha_pagamentos.regras')) then
    raise exception using errcode = '42501',
      message = 'folha_registrar_remuneracao_base: requer a permissao folha_pagamentos.regras.';
  end if;
  if p_funcionario_id is null or not exists (select 1 from public.funcionarios where id = p_funcionario_id) then
    raise exception 'folha_registrar_remuneracao_base: funcionario % nao encontrado.', p_funcionario_id;
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'folha_registrar_remuneracao_base: o valor precisa ser maior que zero.';
  end if;
  if p_vigente_desde is null then
    raise exception 'folha_registrar_remuneracao_base: a data de vigencia e obrigatoria.';
  end if;

  perform public.folha_travar_funcionario(p_funcionario_id);

  begin
    insert into public.funcionarios_remuneracao_base (funcionario_id, valor, vigente_desde, criado_por)
    values (p_funcionario_id, round(p_valor, 2), p_vigente_desde, auth.uid())
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'folha_registrar_remuneracao_base: ja existe remuneracao-base com vigencia em %.', to_char(p_vigente_desde, 'DD/MM/YYYY');
  end;
  return v_id;
end;
$$;

comment on function public.folha_registrar_remuneracao_base(uuid, numeric, date) is
  'Migration 0066. Nova vigencia da remuneracao-base mensal de 1 funcionario. Pagamentos ja confirmados guardam valor_mensal_base_snapshot e nunca mudam. Requer folha_pagamentos.regras.';

create or replace function public.folha_salvar_preferencia_pagamento(
  p_funcionario_id      uuid,
  p_periodicidade       text,
  p_dia_semana_habitual smallint,
  p_dia_mes_habitual    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.has_permissao('folha_pagamentos.editar')) then
    raise exception using errcode = '42501',
      message = 'folha_salvar_preferencia_pagamento: requer a permissao folha_pagamentos.editar.';
  end if;
  if p_funcionario_id is null or not exists (select 1 from public.funcionarios where id = p_funcionario_id) then
    raise exception 'folha_salvar_preferencia_pagamento: funcionario % nao encontrado.', p_funcionario_id;
  end if;
  if p_periodicidade is null or p_periodicidade not in ('diario', 'semanal', 'mensal') then
    raise exception 'folha_salvar_preferencia_pagamento: periodicidade invalida "%" -- use diario, semanal ou mensal.', p_periodicidade;
  end if;

  insert into public.funcionarios_preferencia_pagamento (
    funcionario_id, periodicidade, dia_semana_habitual, dia_mes_habitual, atualizado_por, atualizado_em
  ) values (
    p_funcionario_id,
    p_periodicidade,
    case when p_periodicidade = 'semanal' then p_dia_semana_habitual else null end,
    case when p_periodicidade = 'mensal' then nullif(btrim(coalesce(p_dia_mes_habitual, '')), '') else null end,
    auth.uid(),
    now()
  )
  on conflict (funcionario_id) do update
    set periodicidade       = excluded.periodicidade,
        dia_semana_habitual = excluded.dia_semana_habitual,
        dia_mes_habitual    = excluded.dia_mes_habitual,
        atualizado_por      = excluded.atualizado_por,
        atualizado_em       = excluded.atualizado_em;
end;
$$;

comment on function public.folha_salvar_preferencia_pagamento(uuid, text, smallint, text) is
  'Migration 0066. Preferencia OPERACIONAL de pagamento (diario|semanal|mensal) -- so organizacao/previsao, nunca bloqueia nenhum pagamento. Estado atual (sem vigencia), upsert. Requer folha_pagamentos.editar.';

revoke execute on function public.folha_registrar_valor_hora(numeric, date) from public;
revoke execute on function public.folha_registrar_valor_hora(numeric, date) from anon;
revoke execute on function public.folha_registrar_valor_hora(numeric, date) from service_role;
grant execute on function public.folha_registrar_valor_hora(numeric, date) to authenticated;

revoke execute on function public.folha_registrar_forma_remuneracao(uuid, text, date) from public;
revoke execute on function public.folha_registrar_forma_remuneracao(uuid, text, date) from anon;
revoke execute on function public.folha_registrar_forma_remuneracao(uuid, text, date) from service_role;
grant execute on function public.folha_registrar_forma_remuneracao(uuid, text, date) to authenticated;

revoke execute on function public.folha_registrar_remuneracao_base(uuid, numeric, date) from public;
revoke execute on function public.folha_registrar_remuneracao_base(uuid, numeric, date) from anon;
revoke execute on function public.folha_registrar_remuneracao_base(uuid, numeric, date) from service_role;
grant execute on function public.folha_registrar_remuneracao_base(uuid, numeric, date) to authenticated;

revoke execute on function public.folha_salvar_preferencia_pagamento(uuid, text, smallint, text) from public;
revoke execute on function public.folha_salvar_preferencia_pagamento(uuid, text, smallint, text) from anon;
revoke execute on function public.folha_salvar_preferencia_pagamento(uuid, text, smallint, text) from service_role;
grant execute on function public.folha_salvar_preferencia_pagamento(uuid, text, smallint, text) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO: 1) NUNCA afeta public.pagamentos (fornecedores/NF-e);
-- 2) so e seguro ANTES de qualquer pagamento real (folha_pagamentos vazia)
-- -- depois disso, cancele pagamentos pela RPC, nunca reverta schema;
-- 3) aplicar_escala_em_lote e funcionarios_vinculo_historico_trigger_fn:
-- recriar com o corpo EXATO publicado em 0065 (nao reproduzido aqui).
-- BEGIN;
-- drop function if exists public.folha_salvar_preferencia_pagamento(uuid, text, smallint, text);
-- drop function if exists public.folha_registrar_remuneracao_base(uuid, numeric, date);
-- drop function if exists public.folha_registrar_forma_remuneracao(uuid, text, date);
-- drop function if exists public.folha_registrar_valor_hora(numeric, date);
-- drop function if exists public.folha_cancelar_pagamento(uuid, text);
-- drop function if exists public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text);
-- drop function if exists public.folha_criar_pagamento_por_hora(uuid, jsonb, jsonb, date, text);
-- drop function if exists public.folha_calcular_pendencia_mensal(uuid, date);
-- drop function if exists public.folha_calcular_pendencias_por_hora(uuid);
-- create policy funcionarios_forma_remuneracao_insert on public.funcionarios_forma_remuneracao for insert to authenticated with check ((select public.has_permissao('folha_pagamentos.regras')));
-- create policy funcionarios_remuneracao_base_insert on public.funcionarios_remuneracao_base for insert to authenticated with check ((select public.has_permissao('folha_pagamentos.regras')));
-- create policy folha_valor_hora_insert on public.folha_valor_hora for insert to authenticated with check ((select public.has_permissao('folha_pagamentos.regras')));
-- create policy funcionarios_preferencia_pagamento_insert on public.funcionarios_preferencia_pagamento for insert to authenticated with check ((select public.has_permissao('folha_pagamentos.editar')));
-- create policy funcionarios_preferencia_pagamento_update on public.funcionarios_preferencia_pagamento for update to authenticated using ((select public.has_permissao('folha_pagamentos.editar'))) with check ((select public.has_permissao('folha_pagamentos.editar')));
-- -- (recriar aplicar_escala_em_lote e funcionarios_vinculo_historico_trigger_fn a partir de 0065; recriar o trigger so como AFTER UPDATE)
-- drop function if exists public.folha_hoje();
-- drop function if exists public.folha_travar_funcionario(uuid);
-- drop function if exists public.folha_tipo_vinculo_em(uuid, date);
-- drop index if exists public.folha_pagamentos_data_efetiva_idx;
-- alter table public.folha_pagamentos_cancelamentos drop column if exists cancelado_por_nome;
-- alter table public.folha_pagamentos drop constraint if exists folha_pagamentos_lancamento_mensal_coerente;
-- alter table public.folha_pagamentos drop column if exists confirmado_por_nome;
-- alter table public.folha_pagamentos drop column if exists valor_base_pago;
-- alter table public.folha_pagamentos drop column if exists tipo_lancamento;
-- alter table public.folha_pagamentos_cancelamentos drop constraint if exists folha_pagamentos_cancelamentos_motivo_nao_vazio;
-- alter table public.folha_pagamentos_cancelamentos alter column motivo drop not null;
-- drop index if exists public.folha_pagamentos_competencia_idx;
-- create unique index if not exists folha_pagamentos_competencia_unica_idx on public.folha_pagamentos (funcionario_id, competencia) where natureza = 'mensal' and status <> 'cancelado';
-- COMMIT;
