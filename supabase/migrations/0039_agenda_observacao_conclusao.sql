-- 0039_agenda_observacao_conclusao.sql
-- Evolução da conclusão de tarefas da Agenda (módulo criado pela migration
-- 0038, NÃO alterada por este arquivo): adiciona um campo de texto livre
-- "observação da conclusão" (nome de quem concluiu + observação), tanto
-- para tarefa avulsa (agenda_itens) quanto para tarefa recorrente
-- (agenda_ocorrencias, pertencente SOMENTE à ocorrência concluída, nunca à
-- série). Obrigatória em toda NOVA conclusão (validada em profundidade —
-- na RPC E na trigger, nunca só na UI); registros históricos concluídos
-- antes desta migration permanecem válidos com o campo NULL. Corrige de
-- caminho a lacuna de auditoria pré-existente da conclusão de tarefa
-- avulsa (não existia nenhuma RPC para isso — era UPDATE direto sem
-- nenhum log em logs_auditoria); passa a existir concluir_tarefa_agenda/
-- reabrir_tarefa_agenda, espelhando o padrão já usado pelas RPCs de
-- ocorrência recorrente.
--
-- Não cria nenhuma permissão nova (agenda.editar já cobre tudo aqui, ver
-- seção 8 da 0038) nem toca em RLS/policies/índices existentes.


-- ============================================================
-- 1. agenda_itens — nova coluna + constraints
-- ============================================================
alter table public.agenda_itens
  add column if not exists observacao_conclusao text;

-- Nunca preenchida sem uma conclusão real (mesma filosofia de
-- agenda_itens_conclusao_par, já existente na 0038, agora estendida a
-- este campo) — mas NUNCA torna o campo NOT NULL: registros já
-- concluídos antes desta migration continuam válidos com o campo NULL.
-- A obrigatoriedade de preencher em toda NOVA conclusão é garantida pela
-- trigger agenda_itens_protecao (seção 3) + pelas RPCs concluir_tarefa_
-- agenda/concluir_ocorrencia_agenda, nunca por esta constraint sozinha.
do $$
begin
  alter table public.agenda_itens
    add constraint agenda_itens_observacao_conclusao_par
    check (observacao_conclusao is null or concluido_em is not null);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.agenda_itens
    add constraint agenda_itens_observacao_conclusao_tamanho
    check (observacao_conclusao is null or char_length(observacao_conclusao) <= 200);
exception
  when duplicate_object then null;
end $$;

comment on column public.agenda_itens.observacao_conclusao is
  'Nome/observação livre de quem concluiu a tarefa avulsa (obrigatória em toda NOVA conclusão via RPC concluir_tarefa_agenda — validada com trim/não-vazio/<=200 caracteres pela trigger agenda_itens_protecao, nunca confiando só na UI). NULL enquanto pendente, ou em registros históricos concluídos antes da migration 0039. Limpa automaticamente na reabertura (reabrir_tarefa_agenda) — o valor anterior fica preservado em logs_auditoria.';


-- ============================================================
-- 2. agenda_ocorrencias — nova coluna + constraints
-- ============================================================
alter table public.agenda_ocorrencias
  add column if not exists observacao_conclusao text;

-- Mesmo raciocínio da seção 1, agora pareado com a flag `concluida` (não
-- com um timestamp) — mesmo padrão de agenda_ocorrencias_conclusao_par.
do $$
begin
  alter table public.agenda_ocorrencias
    add constraint agenda_ocorrencias_observacao_conclusao_par
    check (observacao_conclusao is null or concluida);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.agenda_ocorrencias
    add constraint agenda_ocorrencias_observacao_conclusao_tamanho
    check (observacao_conclusao is null or char_length(observacao_conclusao) <= 200);
exception
  when duplicate_object then null;
end $$;

comment on column public.agenda_ocorrencias.observacao_conclusao is
  'Mesma semântica de agenda_itens.observacao_conclusao, mas pertence a UMA ocorrência específica de tarefa recorrente — identidade agenda_item_id + data_ocorrencia ORIGINAL, nunca a série inteira. Preenchida por concluir_ocorrencia_agenda, validada pela trigger agenda_ocorrencias_protecao, limpa na reabertura (reabrir_ocorrencia_agenda) — valor anterior preservado em logs_auditoria antes de ser limpo.';


-- ============================================================
-- 3. agenda_itens_protecao() — atualizada (observacao_conclusao)
-- ============================================================
-- Corpo idêntico ao da 0038 (guardas estruturais de série inalteradas),
-- só a parte de conclusão/reabertura ganha o novo campo, seguindo
-- EXATAMENTE o mesmo mecanismo já usado para concluido_por: o cliente
-- NUNCA controla o campo diretamente — só a transição legítima de
-- conclusão (detectada pela própria trigger) decide o que acontece com
-- ele, o que fecha o caminho tanto para a nova RPC quanto para um
-- hipotético UPDATE direto via RLS (agenda_itens_update), que continua
-- tecnicamente permitido pela RLS mas agora rejeitado pela trigger se
-- tentar concluir sem observação.
create or replace function public.agenda_itens_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.concluido_em := null;
    new.concluido_por := null;
    -- NOVO (0039): um item nunca nasce já concluído (ver acima) — logo
    -- também nunca nasce com observação de conclusão.
    new.observacao_conclusao := null;
    return new;
  end if;

  new.criado_por := old.criado_por;

  if (old.concluido_em is null) <> (new.concluido_em is null) then
    if new.concluido_em is not null then
      -- NOVO (0039): observacao_conclusao passa a ser OBRIGATÓRIA em
      -- toda NOVA conclusão (trim + não vazia + <=200 caracteres),
      -- validada aqui — nunca só na RPC/UI — para que nenhum caminho
      -- (RPC concluir_tarefa_agenda OU um UPDATE direto hipotético
      -- autorizado pela RLS agenda_itens_update) consiga concluir uma
      -- tarefa sem observação. Registros históricos concluídos ANTES
      -- desta migration continuam válidos com observacao_conclusao NULL
      -- (esta validação só roda quando a transição para concluído
      -- acontece NESTA operação, nunca retroage).
      new.observacao_conclusao := btrim(coalesce(new.observacao_conclusao, ''));
      if new.observacao_conclusao = '' then
        raise exception 'agenda_itens: observacao_conclusao e obrigatoria para concluir uma tarefa.';
      end if;
      if char_length(new.observacao_conclusao) > 200 then
        raise exception 'agenda_itens: observacao_conclusao excede o limite de 200 caracteres.';
      end if;
      new.concluido_em := now();
      new.concluido_por := auth.uid();
    else
      new.concluido_por := null;
      -- NOVO (0039): reabertura limpa a observação do estado corrente —
      -- o histórico fica preservado em logs_auditoria pela RPC
      -- reabrir_tarefa_agenda (que loga o valor ANTES de chamar este
      -- UPDATE), nunca aqui (trigger não grava logs_auditoria, mesmo
      -- padrão já usado no projeto — ver logs_auditoria_preencher_
      -- usuario, 0004, que só DERIVA usuario_id, nunca decide o QUE
      -- logar).
      new.observacao_conclusao := null;
    end if;
  else
    new.concluido_em := old.concluido_em;
    new.concluido_por := old.concluido_por;
    -- NOVO (0039): preserva o texto existente em qualquer edição que NÃO
    -- seja a própria transição de conclusão/reabertura (mesmo raciocínio
    -- de concluido_por acima) — ignora silenciosamente qualquer valor de
    -- observacao_conclusao que porventura venha no payload de uma edição
    -- comum (ex.: renomear o título de uma tarefa já concluída).
    new.observacao_conclusao := old.observacao_conclusao;
  end if;

  -- ============================================================
  -- Guarda estrutural (inalterada desde a 0038): enquanto existir
  -- qualquer agenda_ocorrencias para este item, uma edição de "toda a
  -- série" NÃO pode alterar a fase/frequência da recorrência.
  -- ============================================================
  if exists (select 1 from public.agenda_ocorrencias where agenda_item_id = old.id) then
    if new.data_inicio <> old.data_inicio
       or new.tipo_recorrencia <> old.tipo_recorrencia
       or new.recorrencia_intervalo is distinct from old.recorrencia_intervalo
       or new.recorrencia_dias_semana is distinct from old.recorrencia_dias_semana
    then
      raise exception 'agenda_itens: item % ja tem ocorrencias/excecoes registradas -- data_inicio/tipo_recorrencia/recorrencia_intervalo/recorrencia_dias_semana nao podem ser alterados enquanto existirem excecoes. Use "esta e as proximas" para mudar a regra a partir de uma data especifica.', old.id;
    end if;

    if new.recorrencia_data_fim is distinct from old.recorrencia_data_fim then
      if old.recorrencia_data_fim is not null
         and (new.recorrencia_data_fim is null or new.recorrencia_data_fim > old.recorrencia_data_fim)
      then
        raise exception 'agenda_itens: item % ja tem ocorrencias/excecoes registradas -- recorrencia_data_fim so pode ser encurtada (nunca alongada ou limpa) enquanto existirem excecoes. Use "esta e as proximas" para uma mudanca de regra mais ampla.', old.id;
      end if;

      if exists (
        select 1 from public.agenda_ocorrencias
        where agenda_item_id = old.id
          and data_ocorrencia > coalesce(new.recorrencia_data_fim, 'infinity'::date)
      ) then
        raise exception 'agenda_itens: essa alteracao de recorrencia_data_fim deixaria excecoes ja existentes do item % fora da regra da serie.', old.id;
      end if;
    end if;

    if new.hora_inicio is distinct from old.hora_inicio
       or new.hora_fim is distinct from old.hora_fim
       or new.dia_inteiro is distinct from old.dia_inteiro
    then
      if new.dia_inteiro then
        if exists (
          select 1 from public.agenda_ocorrencias
          where agenda_item_id = old.id
            and (hora_inicio_override is not null or hora_fim_override is not null)
        ) then
          raise exception 'agenda_itens: nao e possivel aplicar esta mudanca de horario/dia inteiro ao item % -- existem excecoes com hora_inicio_override/hora_fim_override que ficariam incoerentes (item dia inteiro nao pode ter hora sobreposta). Ajuste/remova esses overrides antes, ou use "esta e as proximas".', old.id;
        end if;
      else
        if exists (
          select 1 from public.agenda_ocorrencias
          where agenda_item_id = old.id
            and coalesce(hora_inicio_override, new.hora_inicio) is not null
            and coalesce(hora_fim_override, new.hora_fim) is not null
            and coalesce(hora_fim_override, new.hora_fim) < coalesce(hora_inicio_override, new.hora_inicio)
        ) then
          raise exception 'agenda_itens: nao e possivel aplicar este novo horario ao item % -- pelo menos uma excecao existente ficaria com horario efetivo invalido (fim antes do inicio, considerando o fallback para o horario do item). Ajuste/remova o override dessa excecao antes, ou use "esta e as proximas" para uma serie nova.', old.id;
        end if;
      end if;
    end if;

    if new.tipo <> old.tipo and new.tipo <> 'tarefa' and exists (
      select 1 from public.agenda_ocorrencias where agenda_item_id = old.id and concluida = true
    ) then
      raise exception 'agenda_itens: nao e possivel mudar o tipo do item % para evento -- existem excecoes ja concluidas (concluida=true), validas somente para tarefa.', old.id;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.agenda_itens_protecao() is
  'BEFORE INSERT/UPDATE de agenda_itens. INSERT: força criado_por = auth.uid() e concluido_em/concluido_por/observacao_conclusao nulos (item nunca nasce concluído). UPDATE: criado_por é imutável; concluido_por/observacao_conclusao só são recalculados/exigidos quando concluido_em de fato transiciona NULL<->preenchido nesta operação (observacao_conclusao passa a ser OBRIGATÓRIA — trim/não-vazia/<=200 caracteres — na transição para concluído, desde a migration 0039; limpa na transição para reaberto; preservada intacta em qualquer outra edição). GUARDA ESTRUTURAL (inalterada desde a 0038, ver migration original): bloqueia mudanças de regra de recorrência enquanto existirem exceções gravadas. Objetivo: nenhuma edição de "toda a série" pode deixar uma exceção já gravada semanticamente órfã/incoerente, e nenhum caminho (RPC ou UPDATE direto) consegue concluir uma tarefa sem observação.';

revoke execute on function public.agenda_itens_protecao() from public;
revoke execute on function public.agenda_itens_protecao() from anon;
revoke execute on function public.agenda_itens_protecao() from authenticated;
revoke execute on function public.agenda_itens_protecao() from service_role;


-- ============================================================
-- 4. agenda_ocorrencias_protecao() — atualizada (observacao_conclusao)
-- ============================================================
-- Mesmo raciocínio da seção 3, agora chaveado pela flag `concluida` (não
-- pela nulidade de um timestamp) — corpo idêntico ao da 0038 em tudo o
-- mais (imutabilidade de identidade, split de série, validação de
-- recorrência, horários efetivos).
create or replace function public.agenda_ocorrencias_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo                 text;
  v_dia_inteiro          boolean;
  v_hora_inicio_item     time;
  v_hora_fim_item        time;
  v_hora_inicio_efetiva  time;
  v_hora_fim_efetiva     time;
  v_tipo_recorrencia     text;
  v_data_inicio          date;
  v_intervalo            integer;
  v_dias_semana          integer[];
  v_data_fim_serie       date;
begin
  if tg_op = 'UPDATE' then
    if new.agenda_item_id <> old.agenda_item_id then
      if coalesce(current_setting('agenda.permitir_realocacao_ocorrencia', true), 'off') <> 'on'
         or current_user = session_user
      then
        raise exception 'agenda_ocorrencias: agenda_item_id e imutavel (identidade da ocorrencia, registro %) fora do fluxo de split de serie sob execucao privilegiada.', old.id;
      end if;
    end if;
    if new.data_ocorrencia <> old.data_ocorrencia then
      raise exception 'agenda_ocorrencias: data_ocorrencia e imutavel -- representa sempre a data original calculada pela regra da serie, nunca a data apos um override (registro %). Para mover a exibicao, use data_override.', old.id;
    end if;
  end if;

  select tipo, dia_inteiro, hora_inicio, hora_fim,
         tipo_recorrencia, data_inicio, recorrencia_intervalo, recorrencia_dias_semana, recorrencia_data_fim
    into v_tipo, v_dia_inteiro, v_hora_inicio_item, v_hora_fim_item,
         v_tipo_recorrencia, v_data_inicio, v_intervalo, v_dias_semana, v_data_fim_serie
  from public.agenda_itens where id = new.agenda_item_id;

  if v_tipo_recorrencia = 'nenhuma' then
    raise exception 'agenda_ocorrencias: item % nao e uma serie recorrente -- agenda_ocorrencias so representa excecoes de series recorrentes.', new.agenda_item_id;
  end if;

  if not public.agenda_ocorrencia_e_valida(
    v_tipo_recorrencia, v_data_inicio, v_intervalo, v_dias_semana, v_data_fim_serie, new.data_ocorrencia
  ) then
    raise exception 'agenda_ocorrencias: % nao e uma ocorrencia valida da serie % (item_id) pela regra atual -- CRUD direto e RPCs nunca podem gravar uma excecao em data arbitraria, e um split para uma nova regra incompativel com esta excecao deve abortar, nao descarta-la.', new.data_ocorrencia, new.agenda_item_id;
  end if;

  if new.concluida and v_tipo <> 'tarefa' then
    raise exception 'agenda_ocorrencias: so uma ocorrencia de tarefa pode ser concluida (item % e evento).', new.agenda_item_id;
  end if;

  if v_dia_inteiro and (new.hora_inicio_override is not null or new.hora_fim_override is not null) then
    raise exception 'agenda_ocorrencias: item % e dia inteiro -- nao faz sentido sobrepor hora_inicio_override/hora_fim_override.', new.agenda_item_id;
  end if;

  if not v_dia_inteiro then
    v_hora_inicio_efetiva := coalesce(new.hora_inicio_override, v_hora_inicio_item);
    v_hora_fim_efetiva := coalesce(new.hora_fim_override, v_hora_fim_item);
    if v_hora_inicio_efetiva is not null and v_hora_fim_efetiva is not null
       and v_hora_fim_efetiva < v_hora_inicio_efetiva
    then
      raise exception 'agenda_ocorrencias: horario efetivo desta ocorrencia (% -- %) e invalido -- fim antes do inicio, considerando o fallback para os horarios do item quando so um dos dois foi sobreposto.', v_hora_inicio_efetiva, v_hora_fim_efetiva;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.concluida then
      -- NOVO (0039): mesma validação obrigatória da seção 3, agora para
      -- o INSERT de uma ocorrência que já nasce concluída (caminho real
      -- — é exatamente o ramo INSERT do UPSERT de concluir_ocorrencia_
      -- agenda quando a ocorrência nunca tinha sido tocada antes).
      new.observacao_conclusao := btrim(coalesce(new.observacao_conclusao, ''));
      if new.observacao_conclusao = '' then
        raise exception 'agenda_ocorrencias: observacao_conclusao e obrigatoria para concluir uma ocorrencia.';
      end if;
      if char_length(new.observacao_conclusao) > 200 then
        raise exception 'agenda_ocorrencias: observacao_conclusao excede o limite de 200 caracteres.';
      end if;
      new.concluido_em := now();
      new.concluido_por := auth.uid();
    else
      new.concluido_em := null;
      new.concluido_por := null;
      new.observacao_conclusao := null;
    end if;
    return new;
  end if;

  -- UPDATE: mesma lógica anti-falsificação de agenda_itens_protecao,
  -- agora chaveada pela flag concluida em vez da nulidade de concluido_em.
  if old.concluida <> new.concluida then
    if new.concluida then
      -- NOVO (0039): idêntico ao ramo INSERT acima — cobre o ramo UPDATE
      -- do mesmo UPSERT (ocorrência que já existia, ex.: com um
      -- cancelamento anterior, e está sendo concluída agora).
      new.observacao_conclusao := btrim(coalesce(new.observacao_conclusao, ''));
      if new.observacao_conclusao = '' then
        raise exception 'agenda_ocorrencias: observacao_conclusao e obrigatoria para concluir uma ocorrencia.';
      end if;
      if char_length(new.observacao_conclusao) > 200 then
        raise exception 'agenda_ocorrencias: observacao_conclusao excede o limite de 200 caracteres.';
      end if;
      new.concluido_em := now();
      new.concluido_por := auth.uid();
    else
      new.concluido_em := null;
      new.concluido_por := null;
      -- NOVO (0039): reabertura limpa a observação -- o histórico fica
      -- preservado em logs_auditoria pela RPC reabrir_ocorrencia_agenda
      -- (que loga o valor ANTES de chamar este UPDATE).
      new.observacao_conclusao := null;
    end if;
  else
    new.concluido_em := old.concluido_em;
    new.concluido_por := old.concluido_por;
    -- NOVO (0039): preserva o texto existente em qualquer edição que NÃO
    -- seja a própria transição concluida<->não-concluida (ex.: um
    -- alterar_ocorrencia_agenda que só toca overrides, ou um re-UPSERT de
    -- concluir_ocorrencia_agenda numa ocorrência que já estava
    -- concluída -- o texto novo enviado é descartado silenciosamente,
    -- mesmo comportamento de idempotência já usado para concluido_por).
    new.observacao_conclusao := old.observacao_conclusao;
  end if;

  return new;
end;
$$;

comment on function public.agenda_ocorrencias_protecao() is
  'BEFORE INSERT/UPDATE de agenda_ocorrencias. (1)-(6) inalterados desde a 0038: identidade imutável (exceto split de série sob execução privilegiada), item pai precisa ser série recorrente, NEW.data_ocorrencia validada contra a regra atual, só tarefa pode ser concluída, hora_*_override só faz sentido se o item pai não for dia_inteiro, horário efetivo (com fallback) sempre coerente. (7) concluido_em/concluido_por continuam nunca falsificáveis pelo cliente. NOVO (0039): observacao_conclusao passa a ser OBRIGATÓRIA (trim/não-vazia/<=200 caracteres) na transição para concluida=true (INSERT ou UPDATE), limpa na transição para concluida=false, e preservada intacta em qualquer outra edição/re-UPSERT idempotente -- pertence sempre à ocorrência (nunca à série).';

revoke execute on function public.agenda_ocorrencias_protecao() from public;
revoke execute on function public.agenda_ocorrencias_protecao() from anon;
revoke execute on function public.agenda_ocorrencias_protecao() from authenticated;
revoke execute on function public.agenda_ocorrencias_protecao() from service_role;


-- ============================================================
-- 5. concluir_tarefa_agenda(uuid, text) — NOVA RPC (tarefa avulsa)
-- ============================================================
-- Substitui o UPDATE direto que o frontend fazia até aqui (lacuna de
-- auditoria pré-existente, corrigida agora: nenhum log era gravado).
-- SECURITY INVOKER — não chama nenhum helper interno bloqueado (só
-- agenda_itens, sem regra de recorrência a validar), a RLS de
-- agenda_itens (agenda.editar) já é a garantia real; a checagem de
-- has_permissao abaixo é só para uma mensagem de erro amigável,
-- redundante com a RLS de propósito.
--
-- CONCORRÊNCIA (revisão obrigatória — comportamento mudou): a linha é
-- lida com SELECT ... FOR UPDATE, que trava fisicamente o registro até o
-- fim desta transação. Se uma SEGUNDA chamada concorrente (duplo clique,
-- duas abas, dois usuários) tentar concluir a MESMA tarefa, ela BLOQUEIA
-- neste SELECT até a primeira transação commitar (ou abortar); ao
-- destravar, relê o estado JÁ ATUALIZADO pela primeira chamada
-- (concluido_em não é mais NULL) e cai no `raise exception` abaixo --
-- nunca as duas conseguem passar da checagem, nunca duas escritas
-- independentes, nunca dois conjuntos de logs. Segunda tentativa de
-- concluir algo já concluído é SEMPRE rejeitada explicitamente (nunca
-- sucesso silencioso, nunca substitui observacao_conclusao existente,
-- nunca gera log novo) -- é o próprio raise exception abaixo que garante
-- isso, não mais um UPDATE incondicional seguido de uma trigger que
-- descartava o valor calado.
create or replace function public.concluir_tarefa_agenda(
  p_item_id uuid,
  p_observacao_conclusao text
)
returns public.agenda_itens
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_antes      public.agenda_itens;
  v_depois     public.agenda_itens;
  v_observacao text;
begin
  if not (select public.has_permissao('agenda.editar')) then
    raise exception 'concluir_tarefa_agenda: requer a permissao agenda.editar.';
  end if;

  -- Validação também aqui (além da trigger) só para poder devolver uma
  -- mensagem de erro específica desta RPC antes de qualquer escrita --
  -- a trigger é quem garante de verdade que nada passa sem isto.
  v_observacao := btrim(coalesce(p_observacao_conclusao, ''));
  if v_observacao = '' then
    raise exception 'concluir_tarefa_agenda: observacao_conclusao e obrigatoria.';
  end if;
  if char_length(v_observacao) > 200 then
    raise exception 'concluir_tarefa_agenda: observacao_conclusao excede o limite de 200 caracteres.';
  end if;

  select * into v_antes from public.agenda_itens where id = p_item_id for update;
  if v_antes.id is null then
    raise exception 'concluir_tarefa_agenda: item % nao encontrado.', p_item_id;
  end if;

  if v_antes.tipo <> 'tarefa' then
    raise exception 'concluir_tarefa_agenda: so tarefas podem ser concluidas (item % e evento).', p_item_id;
  end if;

  if v_antes.tipo_recorrencia <> 'nenhuma' then
    raise exception 'concluir_tarefa_agenda: item % e uma serie recorrente -- conclua a ocorrencia especifica via concluir_ocorrencia_agenda.', p_item_id;
  end if;

  -- REVISÃO OBRIGATÓRIA: já concluída é rejeição explícita, nunca no-op
  -- silencioso -- sob o lock do FOR UPDATE acima, esta checagem é
  -- definitiva (ninguém mais pode ter mudado concluido_em desde a
  -- leitura, e ninguém mais vai conseguir mudar até esta transação
  -- terminar).
  if v_antes.concluido_em is not null then
    raise exception 'concluir_tarefa_agenda: esta tarefa ja esta concluida -- reabra antes de concluir novamente.';
  end if;

  update public.agenda_itens
  set concluido_em = now(), observacao_conclusao = v_observacao
  where id = p_item_id
  returning * into v_depois;

  -- Sempre uma transição real (garantido pela checagem acima sob lock) --
  -- log incondicional, nunca precisa comparar antes/depois.
  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('agenda_item', p_item_id::text, 'concluiu', 'concluido_em', 'null', v_depois.concluido_em::text);

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('agenda_item', p_item_id::text, 'concluiu', 'observacao_conclusao', null, v_depois.observacao_conclusao);

  return v_depois;
end;
$$;

comment on function public.concluir_tarefa_agenda(uuid, text) is
  'Conclui uma tarefa AVULSA (tipo_recorrencia=nenhuma), substituindo o UPDATE direto usado até a migration 0038 (que nunca gravava em logs_auditoria -- lacuna corrigida aqui). observacao_conclusao obrigatória (trim/não-vazia/<=200 caracteres), validada aqui E na trigger agenda_itens_protecao (defesa em profundidade). concluido_em/concluido_por continuam sendo preenchidos pela trigger, nunca por esta função. CONCORRÊNCIA: linha lida com SELECT...FOR UPDATE -- uma segunda chamada concorrente bloqueia até a primeira commitar e, ao destravar, encontra a tarefa já concluída, sendo REJEITADA explicitamente (nunca sucesso silencioso, nunca substitui observacao_conclusao existente, nunca gera log novo). SECURITY INVOKER -- não chama nenhum helper bloqueado, a RLS de agenda_itens (agenda.editar) é a garantia real; a checagem de has_permissao aqui é só para uma mensagem de erro amigável.';

revoke execute on function public.concluir_tarefa_agenda(uuid, text) from public;
revoke execute on function public.concluir_tarefa_agenda(uuid, text) from anon;
revoke execute on function public.concluir_tarefa_agenda(uuid, text) from service_role;
grant execute on function public.concluir_tarefa_agenda(uuid, text) to authenticated;


-- ============================================================
-- 6. reabrir_tarefa_agenda(uuid) — NOVA RPC (tarefa avulsa)
-- ============================================================
-- CONCORRÊNCIA (revisão obrigatória): mesmo mecanismo de concluir_
-- tarefa_agenda -- SELECT ... FOR UPDATE trava a linha; uma segunda
-- reabertura concorrente da MESMA tarefa bloqueia até a primeira
-- commitar, relê o estado já reaberto (concluido_em já NULL) e é
-- REJEITADA explicitamente pelo raise exception abaixo -- nunca duas
-- reaberturas conseguem ambas gravar log.
create or replace function public.reabrir_tarefa_agenda(
  p_item_id uuid
)
returns public.agenda_itens
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_antes  public.agenda_itens;
  v_depois public.agenda_itens;
begin
  if not (select public.has_permissao('agenda.editar')) then
    raise exception 'reabrir_tarefa_agenda: requer a permissao agenda.editar.';
  end if;

  select * into v_antes from public.agenda_itens where id = p_item_id for update;
  if v_antes.id is null then
    raise exception 'reabrir_tarefa_agenda: item % nao encontrado.', p_item_id;
  end if;

  if v_antes.concluido_em is null then
    raise exception 'reabrir_tarefa_agenda: este item nao esta concluido.';
  end if;

  update public.agenda_itens
  set concluido_em = null
  where id = p_item_id
  returning * into v_depois;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values ('agenda_item', p_item_id::text, 'reabriu', 'concluido_em', v_antes.concluido_em::text, 'null');

  -- Só loga a limpeza da observação se de fato havia uma (registros
  -- históricos concluídos antes da 0039 podem ter NULL -- não gera log
  -- falso "mudou de NULL para NULL"). O valor histórico (v_antes, lido
  -- ANTES do UPDATE) fica preservado neste log mesmo depois que o estado
  -- corrente volta a NULL -- nunca apagamos o que já foi para
  -- logs_auditoria.
  if v_antes.observacao_conclusao is not null then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values ('agenda_item', p_item_id::text, 'reabriu', 'observacao_conclusao', v_antes.observacao_conclusao, null);
  end if;

  return v_depois;
end;
$$;

comment on function public.reabrir_tarefa_agenda(uuid) is
  'Reabre (desfaz a conclusão de) uma tarefa AVULSA. concluido_por/observacao_conclusao são limpos pela trigger agenda_itens_protecao na transição concluido_em preenchido->NULL. Registra em logs_auditoria o valor anterior de concluido_em sempre, e de observacao_conclusao só quando ela não era NULL (nunca um log falso "NULL->NULL"; o valor histórico nunca é apagado dos logs mesmo com o estado corrente voltando a NULL). CONCORRÊNCIA: linha lida com SELECT...FOR UPDATE -- uma segunda reabertura concorrente bloqueia até a primeira commitar e é REJEITADA explicitamente ("este item nao esta concluido") ao encontrar o estado já atualizado. SECURITY INVOKER -- a RLS de agenda_itens (agenda.editar) é a proteção real, a checagem de has_permissao aqui é só para mensagem de erro amigável.';

revoke execute on function public.reabrir_tarefa_agenda(uuid) from public;
revoke execute on function public.reabrir_tarefa_agenda(uuid) from anon;
revoke execute on function public.reabrir_tarefa_agenda(uuid) from service_role;
grant execute on function public.reabrir_tarefa_agenda(uuid) to authenticated;


-- ============================================================
-- 7. concluir_ocorrencia_agenda — assinatura alterada (+ p_observacao_conclusao)
-- ============================================================
-- Muda de (uuid, date) para (uuid, date, text) -- CREATE OR REPLACE não
-- troca assinatura, por isso a função antiga é derrubada explicitamente
-- primeiro, para não deixar as duas coexistindo (o que permitiria
-- concluir sem observação pela assinatura velha).
drop function if exists public.concluir_ocorrencia_agenda(uuid, date);

create or replace function public.concluir_ocorrencia_agenda(
  p_agenda_item_id uuid,
  p_data_ocorrencia date,
  p_observacao_conclusao text
)
returns public.agenda_ocorrencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item       public.agenda_itens;
  v_ocorrencia public.agenda_ocorrencias;
  v_observacao text;
begin
  -- SECURITY DEFINER (inalterado desde a 0038): a única razão é permitir
  -- chamar internamente o helper agenda_ocorrencia_e_valida, que fica
  -- deliberadamente sem EXECUTE para authenticated.
  if not (select public.has_permissao('agenda.editar')) then
    raise exception 'concluir_ocorrencia_agenda: requer a permissao agenda.editar.';
  end if;

  -- NOVO (0039): observacao_conclusao obrigatória (trim/não-vazia/<=200
  -- caracteres) -- validada aqui, na RPC, E TAMBÉM dentro da trigger
  -- agenda_ocorrencias_protecao (defesa em profundidade -- um UPSERT
  -- direto via RLS, sem passar por esta RPC, também seria pego).
  v_observacao := btrim(coalesce(p_observacao_conclusao, ''));
  if v_observacao = '' then
    raise exception 'concluir_ocorrencia_agenda: observacao_conclusao e obrigatoria.';
  end if;
  if char_length(v_observacao) > 200 then
    raise exception 'concluir_ocorrencia_agenda: observacao_conclusao excede o limite de 200 caracteres.';
  end if;

  select * into v_item from public.agenda_itens where id = p_agenda_item_id;
  if v_item.id is null then
    raise exception 'concluir_ocorrencia_agenda: item % nao encontrado.', p_agenda_item_id;
  end if;

  if v_item.tipo <> 'tarefa' then
    raise exception 'concluir_ocorrencia_agenda: so tarefas podem ser concluidas (item % e evento).', p_agenda_item_id;
  end if;

  if v_item.tipo_recorrencia = 'nenhuma' then
    raise exception 'concluir_ocorrencia_agenda: item % nao e uma serie recorrente -- conclua via concluir_tarefa_agenda.', p_agenda_item_id;
  end if;

  if not public.agenda_ocorrencia_e_valida(
    v_item.tipo_recorrencia, v_item.data_inicio, v_item.recorrencia_intervalo,
    v_item.recorrencia_dias_semana, v_item.recorrencia_data_fim, p_data_ocorrencia
  ) then
    raise exception 'concluir_ocorrencia_agenda: % nao e uma ocorrencia valida da serie % pela regra de recorrencia atual.', p_data_ocorrencia, p_agenda_item_id;
  end if;

  -- CONCORRÊNCIA (revisão obrigatória — comportamento mudou): a ocorrência
  -- pode não existir ainda (primeira conclusão de uma instância nunca
  -- tocada) -- por isso não dá para travar a linha com SELECT...FOR
  -- UPDATE antes (não há linha para travar). O mecanismo correto aqui é
  -- INSERT ... ON CONFLICT ... DO UPDATE ... WHERE concluida = false: o
  -- índice único (agenda_item_id, data_ocorrencia) serializa duas
  -- tentativas concorrentes de INSERT no MESMO conflito -- a segunda só
  -- prossegue depois que a primeira commita, e reavalia a cláusula WHERE
  -- contra o estado JÁ ATUALIZADO. Se a ocorrência já está concluida=true
  -- (seja porque já estava antes desta chamada, seja porque a chamada
  -- concorrente venceu a corrida agora), a cláusula WHERE torna o UPDATE
  -- um no-op equivalente a DO NOTHING -- RETURNING não devolve nenhuma
  -- linha, e v_ocorrencia.id fica NULL, que é exatamente o sinal usado
  -- abaixo para rejeitar explicitamente (nunca sucesso silencioso, nunca
  -- substitui observacao_conclusao existente, nunca gera log novo).
  insert into public.agenda_ocorrencias (agenda_item_id, data_ocorrencia, concluida, observacao_conclusao)
  values (p_agenda_item_id, p_data_ocorrencia, true, v_observacao)
  on conflict (agenda_item_id, data_ocorrencia)
  do update set concluida = true, observacao_conclusao = v_observacao, atualizado_em = now()
  where agenda_ocorrencias.concluida = false
  returning * into v_ocorrencia;

  if v_ocorrencia.id is null then
    raise exception 'concluir_ocorrencia_agenda: esta ocorrencia ja esta concluida -- reabra antes de concluir novamente.';
  end if;

  -- Sempre uma transição real (garantido pelo mecanismo acima) -- log
  -- incondicional, nunca precisa comparar antes/depois.
  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values (
    'agenda_ocorrencia', p_agenda_item_id::text || '|' || p_data_ocorrencia::text,
    'concluiu', 'concluida', 'false', 'true'
  );

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values (
    'agenda_ocorrencia', p_agenda_item_id::text || '|' || p_data_ocorrencia::text,
    'concluiu', 'observacao_conclusao', null, v_ocorrencia.observacao_conclusao
  );

  return v_ocorrencia;
end;
$$;

comment on function public.concluir_ocorrencia_agenda(uuid, date, text) is
  'Conclui UMA ocorrência de uma tarefa recorrente, via INSERT...ON CONFLICT...DO UPDATE...WHERE concluida=false -- preserva qualquer override/cancelamento/motivo já gravado na linha. observacao_conclusao obrigatória desde a migration 0039 (trim/não-vazia/<=200 caracteres), validada aqui E na trigger agenda_ocorrencias_protecao. concluido_em/concluido_por continuam preenchidos pela trigger. Valida p_data_ocorrencia contra a regra atual da série antes de gravar. CONCORRÊNCIA: o índice único (agenda_item_id, data_ocorrencia) serializa duas tentativas concorrentes -- a cláusula WHERE concluida=false faz o UPDATE virar no-op (RETURNING sem linha) quando a ocorrência já estava concluída, e isso é usado para REJEITAR explicitamente a chamada (nunca sucesso silencioso, nunca substitui observacao_conclusao existente). Registra em logs_auditoria (campo=concluida e campo=observacao_conclusao) de forma incondicional após um sucesso real -- nunca alcança essas linhas numa rejeição, então nunca há log falso/duplicado. SECURITY DEFINER -- necessário só para chamar o helper interno agenda_ocorrencia_e_valida.';

revoke execute on function public.concluir_ocorrencia_agenda(uuid, date, text) from public;
revoke execute on function public.concluir_ocorrencia_agenda(uuid, date, text) from anon;
revoke execute on function public.concluir_ocorrencia_agenda(uuid, date, text) from service_role;
grant execute on function public.concluir_ocorrencia_agenda(uuid, date, text) to authenticated;


-- ============================================================
-- 8. reabrir_ocorrencia_agenda — corpo atualizado (observacao_conclusao)
-- ============================================================
-- Assinatura (uuid, date) inalterada -- só o corpo ganha a limpeza/
-- auditoria do novo campo + a trava de concorrência. CREATE OR REPLACE
-- preserva os grants já concedidos na 0038 (não repetidos aqui de
-- propósito -- a ACL de uma função não muda por um REPLACE de mesma
-- assinatura).
--
-- CONCORRÊNCIA (revisão obrigatória): SELECT ... FOR UPDATE trava a
-- linha até o fim desta transação -- uma segunda reabertura concorrente
-- da MESMA ocorrência bloqueia aqui até a primeira commitar (ou, se a
-- primeira tiver DELETADO a linha por não sobrar nenhum desvio
-- relevante, a segunda simplesmente não encontra mais nada ao
-- destravar). Em qualquer um dos dois casos, a segunda chamada cai no
-- `raise exception` abaixo -- rejeição explícita, nunca duas
-- reaberturas conseguem ambas gravar log.
create or replace function public.reabrir_ocorrencia_agenda(
  p_agenda_item_id uuid,
  p_data_ocorrencia date
)
returns public.agenda_ocorrencias
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ocorrencia        public.agenda_ocorrencias;
  v_observacao_antiga text;
begin
  select * into v_ocorrencia
  from public.agenda_ocorrencias
  where agenda_item_id = p_agenda_item_id and data_ocorrencia = p_data_ocorrencia
  for update;

  if v_ocorrencia.id is null then
    raise exception 'reabrir_ocorrencia_agenda: nao ha ocorrencia concluida para % em %.', p_agenda_item_id, p_data_ocorrencia;
  end if;

  if not v_ocorrencia.concluida then
    raise exception 'reabrir_ocorrencia_agenda: esta ocorrencia nao esta concluida.';
  end if;

  -- NOVO (0039): captura o valor ANTES de qualquer DELETE/UPDATE -- é o
  -- único jeito de conseguir logar o valor anterior depois (o caminho
  -- DELETE apaga a linha inteira; o caminho UPDATE sobrescreve
  -- v_ocorrencia via RETURNING).
  v_observacao_antiga := v_ocorrencia.observacao_conclusao;

  if not v_ocorrencia.cancelada
     and v_ocorrencia.titulo_override is null
     and v_ocorrencia.descricao_override is null
     and v_ocorrencia.data_override is null
     and v_ocorrencia.hora_inicio_override is null
     and v_ocorrencia.hora_fim_override is null
  then
    delete from public.agenda_ocorrencias where id = v_ocorrencia.id;

    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values (
      'agenda_ocorrencia', p_agenda_item_id::text || '|' || p_data_ocorrencia::text,
      'reabriu', 'concluida', 'true', 'false'
    );

    if v_observacao_antiga is not null then
      insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
      values (
        'agenda_ocorrencia', p_agenda_item_id::text || '|' || p_data_ocorrencia::text,
        'reabriu', 'observacao_conclusao', v_observacao_antiga, null
      );
    end if;

    return null;
  end if;

  update public.agenda_ocorrencias
  set concluida = false, observacao_conclusao = null, atualizado_em = now()
  where id = v_ocorrencia.id
  returning * into v_ocorrencia;

  insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values (
    'agenda_ocorrencia', p_agenda_item_id::text || '|' || p_data_ocorrencia::text,
    'reabriu', 'concluida', 'true', 'false'
  );

  if v_observacao_antiga is not null then
    insert into public.logs_auditoria (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
    values (
      'agenda_ocorrencia', p_agenda_item_id::text || '|' || p_data_ocorrencia::text,
      'reabriu', 'observacao_conclusao', v_observacao_antiga, null
    );
  end if;

  return v_ocorrencia;
end;
$$;

comment on function public.reabrir_ocorrencia_agenda(uuid, date) is
  'Reabre (desfaz a conclusão de) uma ocorrência de tarefa recorrente, preservando qualquer override/cancelamento/motivo existente. Se, depois de limpar a conclusão, a linha não carregar mais nenhum desvio relevante, é REMOVIDA (DELETE); senão, UPDATE concluida=false. observacao_conclusao é sempre limpa (NULL) na reabertura -- o valor anterior é capturado ANTES do DELETE/UPDATE e registrado em logs_auditoria (campo=observacao_conclusao) nos dois caminhos de saída, só quando de fato havia um valor (nunca um log falso NULL->NULL; o valor histórico nunca é apagado dos logs). Registra também campo=concluida nos dois caminhos, como desde a 0038. CONCORRÊNCIA: linha lida com SELECT...FOR UPDATE -- uma segunda reabertura concorrente bloqueia até a primeira commitar (ou até a linha ser deletada) e é REJEITADA explicitamente ao encontrar o estado já atualizado. SECURITY INVOKER -- não chama nenhum helper interno bloqueado, a RLS de agenda_ocorrencias (agenda.editar) já é a garantia real.';
