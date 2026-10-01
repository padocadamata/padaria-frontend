-- 0067_folha_pagamento_mensal_integral.sql
-- FOLHA DE PAGAMENTO > PAGAMENTOS -- correcao CIRURGICA da semantica de
-- "Integral" no pagamento mensal. A 0066 (ja aplicada no banco real) so
-- validava 0 <= valor_base <= saldo para QUALQUER tipo de lancamento --
-- entao era possivel gravar tipo 'integral' com um valor MENOR que o
-- saldo (rotulo semanticamente incorreto).
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor,
-- depois de conferir a pre-auditoria.
--
-- ESCOPO -- SOMENTE:
--   1. CREATE OR REPLACE public.folha_criar_pagamento_mensal com a MESMA
--      assinatura (uuid, date, text, numeric, jsonb, jsonb, date, text) e o
--      MESMO corpo publicado em 0066, acrescido de 2 validacoes logo apos o
--      calculo do saldo (ja sob a trava por funcionario):
--        a. integral com saldo = 0 -> recusado (competencia ja quitada;
--           use complemento para lancar so extras);
--        b. integral com valor_base <> saldo -> recusado (integral = quitar
--           exatamente todo o saldo-base pendente).
--      Adiantamento / parcial / complemento: comportamento identico ao da
--      0066 (0..saldo).
--   2. Reafirma grants/comment da funcao (mesmos da 0066).
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao de tabela, coluna, constraint, indice, policy ou
--     permissao;
--   * nenhuma alteracao nas demais RPCs da 0066 (pendencias, por_hora,
--     cancelamento, configuracoes) nem em aplicar_escala_em_lote;
--   * nenhuma alteracao em dados (folha_pagamentos esta vazia; mesmo se
--     nao estivesse, pagamentos ja confirmados sao snapshots e nao sao
--     revalidados);
--   * nenhuma alteracao em public.pagamentos (fornecedores/NF-e).
--
-- Envolvida em transacao explicita (BEGIN/COMMIT).

BEGIN;

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

  -- NOVO (migration 0067) -- semantica de INTEGRAL: quitar EXATAMENTE
  -- todo o saldo-base ainda pendente da competencia (calculado acima, sob
  -- a trava por funcionario). Integral com valor menor que o saldo, ou com
  -- a competencia ja quitada (saldo 0), e recusado -- para pagar so parte
  -- use adiantamento/parcial; para so extras numa competencia ja quitada,
  -- use complemento. Adiantamento/parcial/complemento seguem inalterados.
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
  'Migration 0066 (+0067: integral = saldo exato). Cria e confirma atomicamente 1 pagamento natureza=mensal na competencia (mes de p_competencia, normalizado para o dia 1). Exige forma vigente no fim do mes = mensal e remuneracao-base configurada. p_tipo_lancamento = integral|adiantamento|parcial|complemento (rotulo; NAO e o beneficio Adiantamento Salarial). p_valor_base = quanto da base este pagamento quita (0..saldo; saldo = base - soma de valor_base_pago dos pagamentos ATIVOS da competencia) -- varios pagamentos por competencia sao permitidos, so nunca acima da base. Desde 0067: tipo integral exige p_valor_base = saldo exato (> 0); adiantamento/parcial/complemento aceitam 0..saldo. p_extras = {data,hora_inicio,hora_fim} marcados extra_remunerado, no mes, ate hoje, sem falta/atestado, forma mensal NA DATA, nao pagos; cada um soma duracao/60*valor_hora vigente na SUA data. p_descontos = 0..N {tipo,valor,observacao?} -- sugestao de falta nunca e aplicada aqui (vem da tela, revisavel). Bloqueia descontos > bruto e bruto = 0. Requer folha_pagamentos.confirmar.';

revoke execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text) from public;
revoke execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text) from anon;
revoke execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text) from service_role;
grant execute on function public.folha_criar_pagamento_mensal(uuid, date, text, numeric, jsonb, jsonb, date, text) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Recriar public.folha_criar_pagamento_mensal com o corpo EXATO publicado
-- em 0066_folha_pagamentos_motor.sql (secao 4d) -- remove apenas as 2
-- validacoes de integral. Nenhum dado e afetado.
