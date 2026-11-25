-- 0084_bi_complementar.sql
-- BI Gerencial (fase 2: banco). Funcoes COMPLEMENTARES, SOMENTE DE LEITURA,
-- sobre a 0083 (homologada em producao). NAO altera nenhuma funcao, tabela,
-- policy, grant ou dado existente -- inclusive as 13 funcoes bi_* da 0083,
-- que continuam byte a byte iguais (a guarda confere o md5 delas).
--
-- CRIA (so funcoes novas, prefixo bi_):
--   * internas (ninguem executa; so as funcoes abaixo):
--       bi_dias_semana_int   -- valida/normaliza o filtro de dias da semana
--       bi_dias_valores_int  -- classificacao do dia (bi_dias_int) + somas do
--                               faturamento do dia (reuso entre as funcoes)
--   * leitura (authenticated; 1a instrucao = g3_exigir_admin(), erro 42501):
--       bi_resumo_v2, bi_serie_v2, bi_produtos_v2, bi_produto_serie_v2,
--       bi_produtos_horario_v2  -- mesmas regras e mesmo contrato da v1 +
--                                  p_dias_semana (0 = domingo .. 6 = sabado) e
--                                  campos novos (filtro, descontos, medias).
--                                  Com p_dias_semana nulo devolvem EXATAMENTE
--                                  os valores da v1 (testado).
--       bi_produto_horarios     -- qualquer codigo G3 (1 a 10), por hora e dia
--                                  da semana, independente do ranking.
--       bi_comparar_periodos    -- dois periodos livres (A x B), com filtro de
--                                  dias da semana, criterio explicito
--                                  (pareado | media), descontos e produtos.
--
-- REGRAS (as da 0083, sem excecao): inicio 09/07/2026; pre-operacao fora;
-- 24-25/07 cobertura nao confirmada; sem cobertura = nulo, nunca zero; dia
-- parcial so no "registrado"; media/comparativos so com dias completos
-- (completo / completo_sem_vendas); bases separadas (vendas x itens);
-- produtos so de vendas conciliadas, valor BRUTO do item, por codigo G3;
-- ticket = liquido / vendas; descontos = desconto_item + desconto_rateado
-- (nivel da venda: nunca atribuidos a produto); fuso America/Sao_Paulo;
-- cobertura minima dos comparativos = bi_calendario_regras (0,80).
--
-- FILTRO DE DIAS DA SEMANA: os dias fora do filtro saem da BASE (numerador,
-- denominador, medias, cobertura e contagem de dias) -- nao e filtro visual.
--
-- APLICACAO: manual no SQL Editor, depois do PREAUDIT; conferir com o
-- POSTAUDIT. UM UNICO bloco DO: atomica mesmo se o editor executar
-- instrucao por instrucao (aplica e confere tudo, ou nao cria nada).

DO $migracao$
declare
  v_md5 text;
  v_n integer;
begin
  -- ============================================================
  -- 0. Guardas
  -- ============================================================
  if to_regclass('public.bi_calendario_regras') is null or to_regprocedure('public.bi_dias_int(date, date)') is null
     or to_regprocedure('public.bi_periodo_int(date, date, integer)') is null
     or to_regprocedure('public.g3_exigir_admin()') is null then
    raise exception '0084 abortada: a 0083 (BI Gerencial) precisa estar aplicada.';
  end if;

  -- as 13 funcoes da 0083 exatamente como homologadas
  select md5(string_agg((n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')') || ':' || md5(replace(p.prosrc, chr(13), '')), ',' order by (n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')')))
    into v_md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'bi\_%';
  if v_md5 is distinct from '5ee708f0dfe2d632233c4fe72cb5ad9f' then
    raise exception '0084 abortada: as funcoes bi_* nao correspondem a 0083 homologada (ou a 0084 ja foi aplicada).';
  end if;

  -- ============================================================
  -- 1. Funcoes internas
  -- ============================================================

  -- Filtro de dias da semana: nulo = todos; 1 a 7 valores entre 0 (domingo)
  -- e 6 (sabado); repetidos sao ignorados; devolve ordenado.
  execute $ddl$
    create function public.bi_dias_semana_int(p_dias smallint[])
    returns smallint[]
    language plpgsql
    immutable
    set search_path = ''
    as $fn$
    begin
      if p_dias is null then
        return null;
      end if;
      if cardinality(p_dias) not between 1 and 7 or array_position(p_dias, null) is not null
         or exists (select 1 from unnest(p_dias) x where x not between 0 and 6) then
        raise exception 'Dias da semana invalidos (0 = domingo a 6 = sabado).' using errcode = '22023';
      end if;
      return (select array_agg(distinct x order by x) from unnest(p_dias) x);
    end;
    $fn$
  $ddl$;

  -- Dia a dia: classificacao da 0083 (bi_dias_int, sem nenhuma mudanca) +
  -- somas do faturamento do dia (fat_estado = 'presente'), como bi_resumo.
  execute $ddl$
    create function public.bi_dias_valores_int(p_de date, p_ate date)
    returns table (
      dia date, dia_semana smallint,
      classe_vendas text, classe_itens text, media_vendas boolean, media_itens boolean,
      registrado_vendas boolean, registrado_itens boolean,
      hora_limite_vendas time, hora_limite_itens time,
      excecao_classificacao text, vendas_registradas integer, alerta_vp boolean,
      vendas_nao_conciliadas integer, bruto_nao_conciliado numeric, vendas_fora_corte integer,
      bruto numeric, liquido numeric, descontos numeric, acrescimos numeric, taxa_servico numeric, vendas bigint
    )
    language sql
    stable
    security definer
    set search_path = ''
    as $fn$
      with g as materialized (
        select vv.data, sum(vv.prod) as bruto, sum(vv.liquido) as liq,
               sum(vv.desconto_item + vv.desconto_rateado) as des,
               sum(vv.acrescimo_item + vv.acrescimo_rateado) as acr,
               sum(vv.taxa_servico) as tx, count(*) as n
        from public.g3_vendas vv
        where vv.data between p_de and p_ate and vv.fat_estado = 'presente'
        group by vv.data
      )
      select d.dia, extract(dow from d.dia)::smallint,
             d.classe_vendas, d.classe_itens, d.media_vendas, d.media_itens,
             d.classe_vendas in ('completo', 'completo_sem_vendas', 'parcial', 'com_pendencias'),
             d.classe_itens in ('completo', 'completo_sem_vendas', 'parcial', 'com_pendencias'),
             d.hora_limite_vendas, d.hora_limite_itens,
             d.excecao_classificacao, d.vendas_registradas, d.alerta_vp,
             d.vendas_nao_conciliadas, d.bruto_nao_conciliado, d.vendas_fora_corte,
             coalesce(g.bruto, 0), coalesce(g.liq, 0), coalesce(g.des, 0), coalesce(g.acr, 0), coalesce(g.tx, 0),
             coalesce(g.n, 0)
      from public.bi_dias_int(p_de, p_ate) d
      left join g on g.data = d.dia
      order by d.dia
    $fn$
  $ddl$;

  -- ============================================================
  -- 2. Funcoes de leitura (authenticated; so proprietario_admin ativo)
  -- ============================================================

  -- 2.1 Resumo com filtro de dias da semana e descontos na base_media.
  -- Contrato = bi_resumo + 'filtro' + registrado.percentual_descontos +
  -- base_media.{descontos, media_diaria_descontos, percentual_descontos}.
  execute $ddl$
    create function public.bi_resumo_v2(p_de date, p_ate date, p_dias_semana smallint[] default null)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    set statement_timeout = '20s'
    as $fn$
    declare
      p record;
      v_dias smallint[];
      v jsonb;
    begin
      perform public.g3_exigir_admin();
      v_dias := public.bi_dias_semana_int(p_dias_semana);
      select * into p from public.bi_periodo_int(p_de, p_ate, 1830);
      if p.motivo is not null then
        return jsonb_build_object(
          'periodo', jsonb_build_object('de', null, 'ate', null, 'de_solicitado', p_de, 'ate_solicitado', p_ate),
          'motivo', p.motivo, 'avisos', to_jsonb(p.avisos),
          'filtro', jsonb_build_object('dias_semana', to_jsonb(v_dias), 'dias_calendario', 0, 'dias_fora_filtro', 0),
          'registrado', null, 'base_media', null, 'dias', null, 'qualidade', null);
      end if;

      with t as materialized (
        select x.*, (v_dias is null or x.dia_semana = any(v_dias)) as nf
        from public.bi_dias_valores_int(p.de, p.ate) x
      ),
      j as (select t.*, t.registrado_vendas as reg from t where t.nf),
      nc as (
        select coalesce(sum(j.vendas_nao_conciliadas), 0) as vendas, coalesce(sum(j.bruto_nao_conciliado), 0) as bruto,
               coalesce(sum(j.vendas_fora_corte), 0) as fora
        from j where j.reg
      ),
      a as (
        select count(*) as dias_filtro,
               (select count(*) from t where not t.nf) as dias_fora,
               count(*) filter (where reg) as dias_reg,
               count(*) filter (where media_vendas) as dias_med,
               sum(bruto) filter (where reg) as bruto_r, sum(liquido) filter (where reg) as liq_r,
               sum(descontos) filter (where reg) as des_r, sum(acrescimos) filter (where reg) as acr_r,
               sum(taxa_servico) filter (where reg) as tx_r, sum(vendas) filter (where reg) as n_r,
               sum(bruto) filter (where media_vendas) as bruto_m, sum(liquido) filter (where media_vendas) as liq_m,
               sum(descontos) filter (where media_vendas) as des_m,
               sum(vendas) filter (where media_vendas) as n_m,
               count(*) filter (where classe_vendas = 'parcial') as d_parcial,
               count(*) filter (where classe_vendas = 'com_pendencias') as d_pend,
               count(*) filter (where classe_vendas = 'completo') as d_comp,
               count(*) filter (where classe_vendas = 'completo_sem_vendas') as d_semv,
               count(*) filter (where classe_vendas = 'sem_importacao') as d_semi,
               count(*) filter (where classe_vendas = 'cobertura_nao_confirmada') as d_nconf,
               count(*) filter (where classe_vendas = 'sem_operacao') as d_semop,
               count(*) filter (where classe_vendas = 'pre_operacao') as d_pre,
               count(*) filter (where classe_vendas = 'futuro') as d_fut,
               count(*) filter (where alerta_vp) as d_vp,
               coalesce(bool_or(excecao_classificacao is not null and vendas_registradas > 0), false) as exc_vendas
        from j
      )
      select jsonb_build_object(
        'periodo', jsonb_build_object('de', p.de, 'ate', p.ate, 'de_solicitado', p_de, 'ate_solicitado', p_ate),
        'motivo', case when a.dias_filtro = 0 then 'nenhum_dia_no_filtro' end,
        'avisos', to_jsonb(p.avisos
                    || case when a.exc_vendas then array['excecao_com_vendas']::text[] else array[]::text[] end
                    || case when a.dias_reg = 0 then array['sem_dados']::text[] else array[]::text[] end
                    || case when a.d_parcial > 0 then array['contem_dia_parcial']::text[] else array[]::text[] end),
        'filtro', jsonb_build_object('dias_semana', to_jsonb(v_dias), 'dias_calendario', a.dias_filtro,
                                     'dias_fora_filtro', a.dias_fora),
        'registrado', case when a.dias_reg = 0 then null else jsonb_build_object(
            'bruto', coalesce(a.bruto_r, 0), 'liquido', coalesce(a.liq_r, 0), 'descontos', coalesce(a.des_r, 0),
            'acrescimos', coalesce(a.acr_r, 0), 'taxa_servico', coalesce(a.tx_r, 0), 'vendas', coalesce(a.n_r, 0),
            'ticket', round(a.liq_r / nullif(a.n_r, 0), 2),
            'percentual_descontos', round(a.des_r / nullif(a.bruto_r, 0), 4),
            'dias_com_dados', a.dias_reg, 'dias_parciais', a.d_parcial, 'dias_com_pendencias', a.d_pend) end,
        'base_media', jsonb_build_object(
            'dias_validos', a.dias_med,
            'bruto', case when a.dias_med > 0 then coalesce(a.bruto_m, 0) end,
            'liquido', case when a.dias_med > 0 then coalesce(a.liq_m, 0) end,
            'vendas', case when a.dias_med > 0 then coalesce(a.n_m, 0) end,
            'descontos', case when a.dias_med > 0 then coalesce(a.des_m, 0) end,
            'ticket', round(a.liq_m / nullif(a.n_m, 0), 2),
            'media_diaria_bruto', round(a.bruto_m / nullif(a.dias_med, 0), 2),
            'media_diaria_liquido', round(a.liq_m / nullif(a.dias_med, 0), 2),
            'media_diaria_vendas', round(a.n_m::numeric / nullif(a.dias_med, 0), 2),
            'media_diaria_descontos', round(a.des_m / nullif(a.dias_med, 0), 2),
            'percentual_descontos', round(a.des_m / nullif(a.bruto_m, 0), 4)),
        'dias', jsonb_build_object(
            'completo', a.d_comp, 'completo_sem_vendas', a.d_semv, 'parcial', a.d_parcial,
            'com_pendencias', a.d_pend, 'sem_importacao', a.d_semi, 'cobertura_nao_confirmada', a.d_nconf,
            'sem_operacao', a.d_semop, 'pre_operacao', a.d_pre, 'futuro', a.d_fut),
        'qualidade', jsonb_build_object(
            'vendas_nao_conciliadas', nc.vendas, 'bruto_nao_conciliado', nc.bruto,
            'vendas_fora_corte_parcial', nc.fora, 'dias_alerta_vp', a.d_vp))
      into v
      from a cross join nc;

      return v;
    end;
    $fn$
  $ddl$;

  -- 2.2 Serie (dia/semana/mes) com filtro de dias da semana, descontos e
  -- medias diarias. Colunas = bi_serie + descontos_media, medias diarias,
  -- percentuais de desconto e dias_fora_filtro. No agrupamento 'dia', os
  -- dias fora do filtro nao geram linha; em semana/mes eles saem de todas as
  -- contagens e ficam so em dias_fora_filtro.
  execute $ddl$
    create function public.bi_serie_v2(p_de date, p_ate date, p_agrupamento text, p_dias_semana smallint[] default null)
    returns table (
      inicio date, fim date, rotulo text,
      bruto numeric, liquido numeric, descontos numeric, vendas bigint, ticket numeric,
      bruto_media numeric, liquido_media numeric, vendas_media bigint, ticket_media numeric, dias_validos bigint,
      dias_calendario bigint, dias_completos bigint, dias_sem_vendas bigint, dias_parciais bigint,
      dias_com_pendencias bigint, dias_sem_importacao bigint, dias_nao_confirmados bigint, dias_sem_operacao bigint,
      dias_pre_operacao bigint, dias_futuros bigint, dias_fora_periodo bigint,
      cobertura text, classe text, hora_limite time, mes_inicio_operacao boolean,
      descontos_media numeric,
      media_diaria_bruto numeric, media_diaria_liquido numeric, media_diaria_vendas numeric, media_diaria_descontos numeric,
      percentual_descontos numeric, percentual_descontos_media numeric,
      dias_fora_filtro bigint
    )
    language plpgsql
    stable
    security definer
    set search_path = ''
    set statement_timeout = '20s'
    as $fn$
    #variable_conflict use_column
    declare
      p record;
      v_dias smallint[];
      v_ini_op date;
      v_a date;
      v_b date;
    begin
      perform public.g3_exigir_admin();
      if p_agrupamento is null or p_agrupamento not in ('dia', 'semana', 'mes') then
        raise exception 'Agrupamento invalido (use dia, semana ou mes).' using errcode = '22023';
      end if;
      v_dias := public.bi_dias_semana_int(p_dias_semana);
      select * into p from public.bi_periodo_int(p_de, p_ate, case when p_agrupamento = 'dia' then 400 else 1830 end);
      if p.motivo is not null then
        return;
      end if;
      select r.data_inicio_operacao into v_ini_op from public.bi_calendario_regras r where r.id;
      v_a := case p_agrupamento when 'dia' then p.de when 'semana' then date_trunc('week', p.de)::date
                                else date_trunc('month', p.de)::date end;
      v_b := case p_agrupamento when 'dia' then p.ate when 'semana' then date_trunc('week', p.ate)::date + 6
                                else (date_trunc('month', p.ate) + interval '1 month - 1 day')::date end;
      return query
      with d as materialized (
        select x.*,
               (x.dia between p.de and p.ate) as dentro,
               (v_dias is null or x.dia_semana = any(v_dias)) as nf,
               case p_agrupamento when 'dia' then x.dia when 'semana' then date_trunc('week', x.dia)::date
                                  else date_trunc('month', x.dia)::date end as k
        from public.bi_dias_valores_int(v_a, v_b) x
      ),
      j as (
        select d.*,
               d.nf and d.dentro and d.registrado_vendas as reg,
               d.nf and d.dentro and d.media_vendas as med
        from d
      )
      select j.k,
             case p_agrupamento when 'dia' then j.k when 'semana' then j.k + 6
                                else (j.k + interval '1 month - 1 day')::date end,
             case p_agrupamento when 'dia' then to_char(j.k, 'DD/MM/YYYY')
                                when 'semana' then to_char(j.k, 'DD/MM') || ' a ' || to_char(j.k + 6, 'DD/MM/YYYY')
                                else to_char(j.k, 'MM/YYYY') end,
             case when bool_or(j.reg) then coalesce(sum(j.bruto) filter (where j.reg), 0) end,
             case when bool_or(j.reg) then coalesce(sum(j.liquido) filter (where j.reg), 0) end,
             case when bool_or(j.reg) then coalesce(sum(j.descontos) filter (where j.reg), 0) end,
             case when bool_or(j.reg) then coalesce(sum(j.vendas) filter (where j.reg), 0)::bigint end,
             round(sum(j.liquido) filter (where j.reg) / nullif(sum(j.vendas) filter (where j.reg), 0), 2),
             case when bool_or(j.med) then coalesce(sum(j.bruto) filter (where j.med), 0) end,
             case when bool_or(j.med) then coalesce(sum(j.liquido) filter (where j.med), 0) end,
             case when bool_or(j.med) then coalesce(sum(j.vendas) filter (where j.med), 0)::bigint end,
             round(sum(j.liquido) filter (where j.med) / nullif(sum(j.vendas) filter (where j.med), 0), 2),
             count(*) filter (where j.med),
             count(*) filter (where j.nf),
             count(*) filter (where j.nf and j.dentro and j.classe_vendas = 'completo'),
             count(*) filter (where j.nf and j.dentro and j.classe_vendas = 'completo_sem_vendas'),
             count(*) filter (where j.nf and j.dentro and j.classe_vendas = 'parcial'),
             count(*) filter (where j.nf and j.dentro and j.classe_vendas = 'com_pendencias'),
             count(*) filter (where j.nf and j.dentro and j.classe_vendas = 'sem_importacao'),
             count(*) filter (where j.nf and j.dentro and j.classe_vendas = 'cobertura_nao_confirmada'),
             count(*) filter (where j.nf and j.dentro and j.classe_vendas = 'sem_operacao'),
             count(*) filter (where j.nf and j.classe_vendas = 'pre_operacao'),
             count(*) filter (where j.nf and j.classe_vendas = 'futuro'),
             count(*) filter (where j.nf and not j.dentro and j.classe_vendas not in ('pre_operacao', 'futuro')),
             case when not coalesce(bool_or(j.reg), false) then 'sem_dados'
                  when bool_and(j.med) filter (where j.nf) then 'completa' else 'parcial' end,
             case when p_agrupamento = 'dia' then max(j.classe_vendas) end,
             case when p_agrupamento = 'dia' then max(j.hora_limite_vendas) end,
             (p_agrupamento = 'mes' and j.k = date_trunc('month', v_ini_op)::date),
             case when bool_or(j.med) then coalesce(sum(j.descontos) filter (where j.med), 0) end,
             round(sum(j.bruto) filter (where j.med) / nullif(count(*) filter (where j.med), 0), 2),
             round(sum(j.liquido) filter (where j.med) / nullif(count(*) filter (where j.med), 0), 2),
             round(sum(j.vendas) filter (where j.med)::numeric / nullif(count(*) filter (where j.med), 0), 2),
             round(sum(j.descontos) filter (where j.med) / nullif(count(*) filter (where j.med), 0), 2),
             round(sum(j.descontos) filter (where j.reg) / nullif(sum(j.bruto) filter (where j.reg), 0), 4),
             round(sum(j.descontos) filter (where j.med) / nullif(sum(j.bruto) filter (where j.med), 0), 4),
             count(*) filter (where not j.nf)
      from j
      group by j.k
      having p_agrupamento <> 'dia' or bool_or(j.nf)
      order by j.k;
    end;
    $fn$
  $ddl$;

  -- 2.3 Produtos (ranking/tabela) com filtro de dias da semana. Mesmas regras
  -- e mesmo jsonb da bi_produtos + 'filtro'. O filtro de dias define a BASE
  -- do periodo (inclusive o denominador da participacao); codigos, busca,
  -- ordem, pagina e limite continuam sem mexer no denominador.
  execute $ddl$
    create function public.bi_produtos_v2(
      p_de date, p_ate date,
      p_codigos text[] default null, p_busca text default null,
      p_ordem text default 'bruto', p_direcao text default 'desc',
      p_limite integer default 50, p_deslocamento integer default 0,
      p_dias_semana smallint[] default null)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    set statement_timeout = '20s'
    as $fn$
    declare
      p record;
      v_busca text;
      v_dias smallint[];
      v_res jsonb;
    begin
      perform public.g3_exigir_admin();
      if p_ordem is null or p_ordem not in ('codigo', 'descricao', 'quantidade', 'vendas', 'linhas', 'bruto', 'participacao', 'preco_medio') then
        raise exception 'Ordenacao invalida.' using errcode = '22023';
      end if;
      if p_direcao is null or p_direcao not in ('asc', 'desc') then
        raise exception 'Direcao invalida (asc ou desc).' using errcode = '22023';
      end if;
      if p_limite is null or p_limite not between 1 and 500 then
        raise exception 'Limite invalido (1 a 500).' using errcode = '22023';
      end if;
      if p_deslocamento is null or p_deslocamento not between 0 and 100000 then
        raise exception 'Deslocamento invalido (0 a 100000).' using errcode = '22023';
      end if;
      if p_codigos is not null and (cardinality(p_codigos) not between 1 and 50 or array_position(p_codigos, null) is not null) then
        raise exception 'Lista de codigos invalida (1 a 50 codigos).' using errcode = '22023';
      end if;
      v_busca := nullif(btrim(coalesce(p_busca, '')), '');
      if v_busca is not null and char_length(v_busca) not between 2 and 60 then
        raise exception 'Busca invalida (2 a 60 caracteres).' using errcode = '22023';
      end if;
      v_dias := public.bi_dias_semana_int(p_dias_semana);
      select * into p from public.bi_periodo_int(p_de, p_ate, 1830);
      if p.motivo is not null then
        return jsonb_build_object(
          'periodo', jsonb_build_object('de', null, 'ate', null, 'de_solicitado', p_de, 'ate_solicitado', p_ate),
          'motivo', p.motivo, 'avisos', to_jsonb(p.avisos),
          'filtro', jsonb_build_object('dias_semana', to_jsonb(v_dias), 'dias_calendario', 0, 'dias_fora_filtro', 0),
          'cobertura', null, 'totais', null,
          'paginacao', jsonb_build_object('total_linhas', 0, 'retornadas', 0, 'limite', p_limite,
                                          'deslocamento', p_deslocamento, 'ordem', p_ordem, 'direcao', p_direcao,
                                          'tem_mais', false),
          'produtos', '[]'::jsonb);
      end if;

      with t as materialized (
        select x.*, (v_dias is null or extract(dow from x.dia)::smallint = any(v_dias)) as nf
        from public.bi_dias_int(p.de, p.ate) x
      ),
      dd as materialized (
        select t.*, t.classe_itens in ('completo', 'completo_sem_vendas', 'parcial', 'com_pendencias') as reg
        from t where t.nf
      ),
      cob as (
        select count(*) as dias, count(*) filter (where dd.reg) as dias_reg,
               count(*) filter (where dd.media_itens) as dias_validos,
               count(*) filter (where dd.classe_itens = 'completo') as d_comp,
               count(*) filter (where dd.classe_itens = 'completo_sem_vendas') as d_semv,
               count(*) filter (where dd.classe_itens = 'parcial') as d_parc,
               count(*) filter (where dd.classe_itens = 'com_pendencias') as d_pend,
               count(*) filter (where dd.classe_itens = 'sem_conciliacao') as d_semc,
               count(*) filter (where dd.classe_itens = 'sem_importacao') as d_semi,
               count(*) filter (where dd.classe_itens = 'cobertura_nao_confirmada') as d_nconf,
               count(*) filter (where dd.classe_itens = 'sem_operacao') as d_semop,
               max(dd.hora_limite_itens) filter (where dd.classe_itens = 'parcial') as hora_limite,
               coalesce(sum(dd.vendas_nao_conciliadas) filter (where dd.reg or dd.classe_itens = 'sem_conciliacao'), 0) as excl,
               coalesce(sum(dd.vendas_fora_corte) filter (where dd.reg), 0) as fora,
               (select count(*) from t where not t.nf) as dias_fora
        from dd
      ),
      base as materialized (
        select i.codigo, i.descricao, i.quantidade, i.valor, i.numero, vv.data
        from public.g3_vendas vv
        join dd on dd.dia = vv.data and dd.reg
        join public.g3_venda_itens i on i.numero = vv.numero
        where vv.conciliacao = 'conciliada'
      ),
      agg as materialized (
        select b.codigo,
               (array_agg(b.descricao order by b.data desc, b.numero desc))[1] as descricao,
               count(distinct b.descricao)::int as descricoes_distintas,
               sum(b.quantidade) as quantidade,
               bool_or(b.quantidade <> trunc(b.quantidade)) as quantidade_decimal,
               count(distinct b.numero) as vendas,
               count(*) as linhas,
               sum(b.valor) as bruto
        from base b
        group by b.codigo
      ),
      tot as materialized (
        select coalesce((select sum(agg.bruto) from agg), 0) as bruto,
               (select count(distinct base.numero) from base) as vendas,
               (select count(*) from agg) as produtos
      ),
      enr as (
        select agg.*,
               count(*) over (partition by agg.descricao) > 1 as descricao_compartilhada,
               round(agg.bruto / nullif(tot.bruto, 0), 4) as participacao,
               round(agg.bruto / nullif(agg.quantidade, 0), 4) as preco_medio
        from agg cross join tot
      ),
      fil as materialized (
        select enr.*
        from enr
        where (p_codigos is null or enr.codigo = any(p_codigos))
          and (v_busca is null
               or enr.codigo = v_busca
               or enr.descricao ilike '%' || replace(replace(replace(v_busca, '\', '\\'), '%', '\%'), '_', '\_') || '%')
      ),
      ord as (
        select fil.*,
               row_number() over (
                 order by case when p_direcao = 'asc' then k.kn end asc nulls last,
                          case when p_direcao = 'desc' then k.kn end desc nulls last,
                          case when p_direcao = 'asc' then k.kt end asc,
                          case when p_direcao = 'desc' then k.kt end desc,
                          lpad(fil.codigo, 18, '0') asc, fil.codigo asc) as rn
        from fil
        cross join lateral (
          select case p_ordem when 'quantidade' then fil.quantidade when 'vendas' then fil.vendas::numeric
                              when 'linhas' then fil.linhas::numeric when 'bruto' then fil.bruto
                              when 'participacao' then fil.participacao when 'preco_medio' then fil.preco_medio end as kn,
                 case p_ordem when 'codigo' then lpad(fil.codigo, 18, '0')
                              when 'descricao' then lower(fil.descricao) end as kt) k
      ),
      pag as (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'codigo', ord.codigo, 'descricao', ord.descricao,
                 'descricoes_distintas', ord.descricoes_distintas, 'descricao_compartilhada', ord.descricao_compartilhada,
                 'quantidade', ord.quantidade, 'quantidade_decimal', ord.quantidade_decimal,
                 'vendas', ord.vendas, 'linhas', ord.linhas, 'bruto', ord.bruto,
                 'participacao', ord.participacao, 'preco_medio', ord.preco_medio) order by ord.rn), '[]'::jsonb) as lista,
               count(*) as n
        from ord
        where ord.rn > p_deslocamento and ord.rn <= p_deslocamento + p_limite
      ),
      nfil as (select count(*) as n from fil)
      select jsonb_build_object(
        'periodo', jsonb_build_object('de', p.de, 'ate', p.ate, 'de_solicitado', p_de, 'ate_solicitado', p_ate),
        'motivo', case when cob.dias = 0 then 'nenhum_dia_no_filtro' end,
        'avisos', to_jsonb(p.avisos
                    || case when cob.dias_reg = 0 then array['sem_dados']::text[] else array[]::text[] end
                    || case when cob.d_parc > 0 then array['contem_dia_parcial']::text[] else array[]::text[] end
                    || case when cob.d_pend > 0 then array['contem_dia_com_pendencias']::text[] else array[]::text[] end
                    || case when cob.d_semc > 0 then array['contem_dia_sem_conciliacao']::text[] else array[]::text[] end
                    || case when cob.excl > 0 then array['vendas_nao_conciliadas_excluidas']::text[] else array[]::text[] end),
        'filtro', jsonb_build_object('dias_semana', to_jsonb(v_dias), 'dias_calendario', cob.dias, 'dias_fora_filtro', cob.dias_fora),
        'cobertura', jsonb_build_object(
            'dias_calendario', cob.dias, 'dias_com_dados', cob.dias_reg, 'dias_validos', cob.dias_validos,
            'completo', cob.d_comp, 'completo_sem_vendas', cob.d_semv, 'parcial', cob.d_parc,
            'com_pendencias', cob.d_pend, 'sem_conciliacao', cob.d_semc, 'sem_importacao', cob.d_semi,
            'cobertura_nao_confirmada', cob.d_nconf, 'sem_operacao', cob.d_semop,
            'hora_limite_parcial', to_char(cob.hora_limite, 'HH24:MI')),
        'totais', jsonb_build_object(
            'bruto_total_periodo', case when cob.dias_reg > 0 then tot.bruto end,
            'vendas_conciliadas', case when cob.dias_reg > 0 then tot.vendas end,
            'produtos_distintos', case when cob.dias_reg > 0 then tot.produtos end,
            'vendas_excluidas_nao_conciliadas', cob.excl,
            'vendas_fora_corte_parcial', cob.fora),
        'paginacao', jsonb_build_object(
            'total_linhas', nfil.n, 'retornadas', pag.n, 'limite', p_limite, 'deslocamento', p_deslocamento,
            'ordem', p_ordem, 'direcao', p_direcao, 'tem_mais', p_deslocamento + pag.n < nfil.n),
        'produtos', pag.lista)
      into v_res
      from cob cross join tot cross join pag cross join nfil;

      return v_res;
    end;
    $fn$
  $ddl$;

  -- 2.4 Evolucao de 1 a 5 produtos com filtro de dias da semana e medias por
  -- dia valido. Colunas = bi_produto_serie + medias + dias_fora_filtro.
  execute $ddl$
    create function public.bi_produto_serie_v2(
      p_codigos text[], p_de date, p_ate date, p_agrupamento text, p_dias_semana smallint[] default null)
    returns table (
      codigo text, descricao text, inicio date, fim date,
      quantidade numeric, vendas bigint, bruto numeric,
      dias_registrados bigint, dias_validos bigint, dias_calendario bigint, cobertura text,
      quantidade_media_dia numeric, vendas_media_dia numeric, bruto_media_dia numeric,
      dias_fora_filtro bigint
    )
    language plpgsql
    stable
    security definer
    set search_path = ''
    set statement_timeout = '20s'
    as $fn$
    #variable_conflict use_column
    declare
      p record;
      v_dias smallint[];
      v_a date;
      v_b date;
    begin
      perform public.g3_exigir_admin();
      if p_codigos is null or cardinality(p_codigos) not between 1 and 5 or array_position(p_codigos, null) is not null
         or (select count(distinct c) from unnest(p_codigos) c) <> cardinality(p_codigos) then
        raise exception 'Informe de 1 a 5 codigos distintos.' using errcode = '22023';
      end if;
      if p_agrupamento is null or p_agrupamento not in ('dia', 'semana', 'mes') then
        raise exception 'Agrupamento invalido (use dia, semana ou mes).' using errcode = '22023';
      end if;
      v_dias := public.bi_dias_semana_int(p_dias_semana);
      select * into p from public.bi_periodo_int(p_de, p_ate, case when p_agrupamento = 'dia' then 400 else 1830 end);
      if p.motivo is not null then
        return;
      end if;
      v_a := case p_agrupamento when 'dia' then p.de when 'semana' then date_trunc('week', p.de)::date
                                else date_trunc('month', p.de)::date end;
      v_b := case p_agrupamento when 'dia' then p.ate when 'semana' then date_trunc('week', p.ate)::date + 6
                                else (date_trunc('month', p.ate) + interval '1 month - 1 day')::date end;
      return query
      with d as materialized (
        select x.dia,
               (v_dias is null or extract(dow from x.dia)::smallint = any(v_dias)) as nf,
               (x.dia between p.de and p.ate)
                 and x.classe_itens in ('completo', 'completo_sem_vendas', 'parcial', 'com_pendencias') as reg0,
               (x.dia between p.de and p.ate) and x.media_itens as med0,
               case p_agrupamento when 'dia' then x.dia when 'semana' then date_trunc('week', x.dia)::date
                                  else date_trunc('month', x.dia)::date end as k
        from public.bi_dias_int(v_a, v_b) x
      ),
      df as materialized (select d.*, d.nf and d.reg0 as reg, d.nf and d.med0 as med from d),
      cods as materialized (select c as codigo from unnest(p_codigos) c),
      it as materialized (
        select i.codigo, vv.data, sum(i.quantidade) as q, sum(i.valor) as b, count(distinct i.numero) as n
        from public.g3_vendas vv
        join public.g3_venda_itens i on i.numero = vv.numero
        where vv.data between p.de and p.ate and vv.conciliacao = 'conciliada' and i.codigo = any(p_codigos)
        group by i.codigo, vv.data
      ),
      nome as materialized (
        select cods.codigo,
               (select i2.descricao from public.g3_venda_itens i2 join public.g3_vendas v2 on v2.numero = i2.numero
                 where i2.codigo = cods.codigo order by v2.data desc, v2.numero desc limit 1) as descricao
        from cods
      )
      select c.codigo, nome.descricao, df.k,
             case p_agrupamento when 'dia' then df.k when 'semana' then df.k + 6
                                else (df.k + interval '1 month - 1 day')::date end,
             case when bool_or(df.reg) then coalesce(sum(it.q) filter (where df.reg), 0) end,
             case when bool_or(df.reg) then coalesce(sum(it.n) filter (where df.reg), 0)::bigint end,
             case when bool_or(df.reg) then coalesce(sum(it.b) filter (where df.reg), 0) end,
             count(*) filter (where df.reg),
             count(*) filter (where df.med),
             count(*) filter (where df.nf),
             case when not coalesce(bool_or(df.reg), false) then 'sem_dados'
                  when bool_and(df.med) filter (where df.nf) then 'completa' else 'parcial' end,
             round(coalesce(sum(it.q) filter (where df.med), 0) / nullif(count(*) filter (where df.med), 0), 4),
             round(coalesce(sum(it.n) filter (where df.med), 0)::numeric / nullif(count(*) filter (where df.med), 0), 2),
             round(coalesce(sum(it.b) filter (where df.med), 0) / nullif(count(*) filter (where df.med), 0), 2),
             count(*) filter (where not df.nf)
      from cods c
      join nome on nome.codigo = c.codigo
      cross join df
      left join it on it.codigo = c.codigo and it.data = df.dia
      group by c.codigo, nome.descricao, df.k
      having p_agrupamento <> 'dia' or bool_or(df.nf)
      order by c.codigo, df.k;
    end;
    $fn$
  $ddl$;

  -- 2.5 Ranking de produtos por horario com filtro de dias da semana e
  -- medias por dia valido. Colunas = bi_produtos_horario + medias.
  execute $ddl$
    create function public.bi_produtos_horario_v2(
      p_de date, p_ate date,
      p_hora_inicio smallint default 0, p_hora_fim smallint default 23,
      p_ordem text default 'bruto', p_limite integer default 10,
      p_dias_semana smallint[] default null)
    returns table (
      hora smallint, posicao integer, codigo text, descricao text,
      quantidade numeric, vendas bigint, bruto numeric, dias_considerados bigint,
      media_quantidade_dia numeric, media_vendas_dia numeric, media_bruto_dia numeric
    )
    language plpgsql
    stable
    security definer
    set search_path = ''
    set statement_timeout = '20s'
    as $fn$
    #variable_conflict use_column
    declare
      p record;
      v_dias smallint[];
      v_n bigint;
    begin
      perform public.g3_exigir_admin();
      if p_hora_inicio is null or p_hora_fim is null or p_hora_inicio not between 0 and 23
         or p_hora_fim not between 0 and 23 or p_hora_inicio > p_hora_fim then
        raise exception 'Faixa de horario invalida (0 a 23).' using errcode = '22023';
      end if;
      if p_ordem is null or p_ordem not in ('bruto', 'vendas', 'quantidade') then
        raise exception 'Ordenacao invalida (bruto, vendas ou quantidade).' using errcode = '22023';
      end if;
      if p_limite is null or p_limite not between 1 and 50 then
        raise exception 'Limite invalido (1 a 50).' using errcode = '22023';
      end if;
      v_dias := public.bi_dias_semana_int(p_dias_semana);
      select * into p from public.bi_periodo_int(p_de, p_ate, 1830);
      if p.motivo is not null then
        return;
      end if;
      select count(*) into v_n from public.bi_dias_int(p.de, p.ate) x
      where x.media_itens and (v_dias is null or extract(dow from x.dia)::smallint = any(v_dias));
      return query
      with dv as materialized (
        select x.dia from public.bi_dias_int(p.de, p.ate) x
        where x.media_itens and (v_dias is null or extract(dow from x.dia)::smallint = any(v_dias))
      ),
      base as materialized (
        select extract(hour from vv.data_hora at time zone 'America/Sao_Paulo')::smallint as hora,
               i.codigo, i.descricao, i.quantidade, i.valor, i.numero, vv.data
        from public.g3_vendas vv
        join dv on dv.dia = vv.data
        join public.g3_venda_itens i on i.numero = vv.numero
        where vv.conciliacao = 'conciliada'
      ),
      nomes as (
        select b.codigo, (array_agg(b.descricao order by b.data desc, b.numero desc))[1] as descricao
        from base b group by b.codigo
      ),
      agg as materialized (
        select b.hora, b.codigo, sum(b.quantidade) as q, count(distinct b.numero) as n, sum(b.valor) as v
        from base b
        where b.hora between p_hora_inicio and p_hora_fim
        group by b.hora, b.codigo
      ),
      rk as (
        select agg.*,
               row_number() over (partition by agg.hora
                                  order by case p_ordem when 'bruto' then agg.v when 'vendas' then agg.n::numeric
                                                        else agg.q end desc,
                                           agg.v desc, lpad(agg.codigo, 18, '0'), agg.codigo)::int as pos
        from agg
      )
      select rk.hora, rk.pos, rk.codigo, nomes.descricao, rk.q, rk.n, rk.v, v_n,
             round(rk.q / nullif(v_n, 0), 4), round(rk.n::numeric / nullif(v_n, 0), 2), round(rk.v / nullif(v_n, 0), 2)
      from rk join nomes on nomes.codigo = rk.codigo
      where rk.pos <= p_limite
      order by rk.hora, rk.pos;
    end;
    $fn$
  $ddl$;

  -- 2.6 Produtos escolhidos (1 a 10 codigos G3) por hora e dia da semana,
  -- INDEPENDENTE do ranking. So dias completos da base itens (como os
  -- horarios da 0083); soma do ITEM (nunca o total da venda); codigos com a
  -- mesma descricao continuam separados. Linhas (por codigo):
  --   dia_semana 0..6 x hora 0..23 | dia_semana nulo (todos os dias do
  --   filtro) x hora | dia_semana x hora nula (total do dia da semana) |
  --   dia_semana nulo x hora nula (total do produto).
  -- participacao_no_produto: bruto da linha / bruto do produto na linha-total
  --   (dia_semana x hora -> total do dia da semana; demais -> total geral).
  -- participacao_no_horario: bruto do produto / bruto de TODOS os itens na
  --   mesma celula (dia_semana, hora).
  execute $ddl$
    create function public.bi_produto_horarios(
      p_codigos text[], p_de date, p_ate date, p_dias_semana smallint[] default null)
    returns table (
      codigo text, descricao text, dia_semana smallint, hora smallint,
      quantidade numeric, vendas bigint, bruto numeric, dias_considerados bigint,
      media_quantidade_dia numeric, media_vendas_dia numeric, media_bruto_dia numeric,
      participacao_no_produto numeric, participacao_no_horario numeric, bruto_todos_itens numeric
    )
    language plpgsql
    stable
    security definer
    set search_path = ''
    set statement_timeout = '20s'
    as $fn$
    #variable_conflict use_column
    declare
      p record;
      v_dias smallint[];
    begin
      perform public.g3_exigir_admin();
      if p_codigos is null or cardinality(p_codigos) not between 1 and 10 or array_position(p_codigos, null) is not null
         or exists (select 1 from unnest(p_codigos) c where char_length(btrim(c)) not between 1 and 30 or c <> btrim(c))
         or (select count(distinct c) from unnest(p_codigos) c) <> cardinality(p_codigos) then
        raise exception 'Informe de 1 a 10 codigos distintos.' using errcode = '22023';
      end if;
      v_dias := public.bi_dias_semana_int(p_dias_semana);
      select * into p from public.bi_periodo_int(p_de, p_ate, 1830);
      if p.motivo is not null then
        return;
      end if;
      return query
      with dv as materialized (
        select x.dia, extract(dow from x.dia)::smallint as dow
        from public.bi_dias_int(p.de, p.ate) x
        where x.media_itens and (v_dias is null or extract(dow from x.dia)::smallint = any(v_dias))
      ),
      ndow as (select dv.dow, count(*) as n from dv group by dv.dow),
      nt as (select count(*) as n from dv),
      base as materialized (
        select dv.dow, extract(hour from vv.data_hora at time zone 'America/Sao_Paulo')::smallint as hora,
               i.codigo, i.quantidade, i.valor, i.numero
        from public.g3_vendas vv
        join dv on dv.dia = vv.data
        join public.g3_venda_itens i on i.numero = vv.numero
        where vv.conciliacao = 'conciliada'
      ),
      -- chaves dos agrupamentos: -1 = "todos" (joins por igualdade, com hash)
      tot as materialized (
        select coalesce(b.dow, -1)::smallint as kd, coalesce(b.hora, -1)::smallint as kh, sum(b.valor) as v
        from base b group by grouping sets ((b.dow, b.hora), (b.hora), (b.dow), ())
      ),
      agg as materialized (
        select b.codigo, coalesce(b.dow, -1)::smallint as kd, coalesce(b.hora, -1)::smallint as kh,
               sum(b.quantidade) as q, count(distinct b.numero) as n, sum(b.valor) as v
        from base b
        where b.codigo = any(p_codigos)
        group by b.codigo, grouping sets ((b.dow, b.hora), (b.hora), (b.dow), ())
      ),
      cods as (select c as codigo from unnest(p_codigos) c),
      horas as (select h::smallint as kh from generate_series(-1, 23) h),
      grade as (
        select c.codigo, nd.dow as kd, h.kh, nd.n from cods c cross join ndow nd cross join horas h
        union all
        select c.codigo, -1::smallint, h.kh, nt.n from cods c cross join nt cross join horas h where nt.n > 0
      ),
      nome as materialized (
        select cods.codigo,
               (select i2.descricao from public.g3_venda_itens i2 join public.g3_vendas v2 on v2.numero = i2.numero
                 where i2.codigo = cods.codigo order by v2.data desc, v2.numero desc limit 1) as descricao
        from cods
      )
      select g.codigo, nome.descricao, nullif(g.kd, -1)::smallint, nullif(g.kh, -1)::smallint,
             coalesce(a.q, 0), coalesce(a.n, 0)::bigint, coalesce(a.v, 0), g.n,
             round(coalesce(a.q, 0) / nullif(g.n, 0), 4),
             round(coalesce(a.n, 0)::numeric / nullif(g.n, 0), 2),
             round(coalesce(a.v, 0) / nullif(g.n, 0), 2),
             round(coalesce(a.v, 0) / nullif(ap.v, 0), 4),
             round(coalesce(a.v, 0) / nullif(t.v, 0), 4),
             coalesce(t.v, 0)
      from grade g
      join nome on nome.codigo = g.codigo
      left join agg a on a.codigo = g.codigo and a.kd = g.kd and a.kh = g.kh
      left join agg ap on ap.codigo = g.codigo and ap.kh = -1 and ap.kd = (case when g.kh <> -1 then g.kd else -1 end)
      left join tot t on t.kd = g.kd and t.kh = g.kh
      order by g.codigo, g.kd, g.kh;
    end;
    $fn$
  $ddl$;

  -- 2.7 Comparacao entre DOIS PERIODOS LIVRES (A = analisado, B = referencia;
  -- variacao = (A - B) / B), com filtro de dias da semana, descontos e ate 5
  -- produtos. Criterios (sempre informados na resposta):
  --   pareado: o k-esimo dia (do filtro) de A com o k-esimo de B; exige a
  --            MESMA quantidade de dias nos dois lados. Um par so conta se os
  --            dois dias forem completos (base vendas para os indicadores
  --            gerais; base itens para os produtos). Cobertura = pares
  --            validos / pares. Totais e medias comparaveis.
  --   media:   cada lado com os SEUS dias completos; cobertura de cada lado
  --            = dias validos / dias do filtro. So as grandezas normalizadas
  --            (medias diarias, ticket, % de desconto, preco medio,
  --            participacao) sao comparadas; totais aparecem, sem variacao.
  --   auto:    pareado se os dois lados tem a mesma quantidade de dias; senao media.
  -- Comparavel so com cobertura >= bi_calendario_regras.cobertura_minima_comparacao
  -- nos dois lados. Fim depois de hoje e ajustado (aviso); dias de
  -- pre-operacao contam como invalidos (nunca sao "ajustados" para dentro).
  execute $ddl$
    create function public.bi_comparar_periodos(
      p_a_de date, p_a_ate date, p_b_de date, p_b_ate date,
      p_dias_semana smallint[] default null, p_codigos text[] default null, p_criterio text default 'auto')
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    set statement_timeout = '20s'
    as $fn$
    declare
      v_r record;
      v_hoje date;
      v_dias smallint[];
      v_cods text[];
      v_ad date; v_aa date; v_bd date; v_ba date;
      v_av text[] := array[]::text[];
      v_na integer;
      v_nb integer;
      v_crit text;
      v_mot text;
      v_res jsonb;
    begin
      perform public.g3_exigir_admin();
      if p_a_de is null or p_a_ate is null or p_b_de is null or p_b_ate is null then
        raise exception 'Informe as datas inicial e final dos dois periodos.' using errcode = '22023';
      end if;
      if p_a_de > p_a_ate or p_b_de > p_b_ate then
        raise exception 'A data inicial nao pode ser posterior a data final.' using errcode = '22023';
      end if;
      if p_a_ate - p_a_de + 1 > 366 or p_b_ate - p_b_de + 1 > 366 then
        raise exception 'Periodo maior que o maximo permitido (366 dias).' using errcode = '22023';
      end if;
      if p_criterio is null or p_criterio not in ('auto', 'pareado', 'media') then
        raise exception 'Criterio invalido (auto, pareado ou media).' using errcode = '22023';
      end if;
      if p_codigos is not null and (cardinality(p_codigos) not between 1 and 5 or array_position(p_codigos, null) is not null
           or exists (select 1 from unnest(p_codigos) c where char_length(btrim(c)) not between 1 and 30 or c <> btrim(c))
           or (select count(distinct c) from unnest(p_codigos) c) <> cardinality(p_codigos)) then
        raise exception 'Informe de 1 a 5 codigos distintos.' using errcode = '22023';
      end if;
      v_cods := p_codigos;
      v_dias := public.bi_dias_semana_int(p_dias_semana);
      select * into v_r from public.bi_calendario_regras r where r.id;
      v_hoje := public.bi_hoje_int();

      -- periodo inteiro no futuro: lado vazio; fim depois de hoje: ajustado
      if p_a_de <= v_hoje then
        v_ad := p_a_de; v_aa := least(p_a_ate, v_hoje);
        if p_a_ate > v_hoje then v_av := v_av || 'fim_a_ajustado_hoje'::text; end if;
      end if;
      if p_b_de <= v_hoje then
        v_bd := p_b_de; v_ba := least(p_b_ate, v_hoje);
        if p_b_ate > v_hoje then v_av := v_av || 'fim_b_ajustado_hoje'::text; end if;
      end if;
      if v_ad is not null and v_bd is not null and v_ad <= v_ba and v_bd <= v_aa then
        v_av := v_av || 'periodos_sobrepostos'::text;
      end if;

      select count(*) into v_na from generate_series(v_ad, v_aa, interval '1 day') g
      where v_dias is null or extract(dow from g)::smallint = any(v_dias);
      select count(*) into v_nb from generate_series(v_bd, v_ba, interval '1 day') g
      where v_dias is null or extract(dow from g)::smallint = any(v_dias);
      v_crit := case when p_criterio <> 'auto' then p_criterio when v_na = v_nb then 'pareado' else 'media' end;

      v_mot := case when v_ad is null then 'periodo_a_futuro'
                    when v_bd is null then 'periodo_b_futuro'
                    when v_na = 0 or v_nb = 0 then 'nenhum_dia_no_filtro'
                    when v_crit = 'pareado' and v_na <> v_nb then 'quantidade_de_dias_diferente' end;

      with
      a as materialized (
        select x.*, row_number() over (order by x.dia)::int as k
        from public.bi_dias_valores_int(v_ad, v_aa) x
        where v_ad is not null and (v_dias is null or x.dia_semana = any(v_dias))
      ),
      b as materialized (
        select x.*, row_number() over (order by x.dia)::int as k
        from public.bi_dias_valores_int(v_bd, v_ba) x
        where v_bd is not null and (v_dias is null or x.dia_semana = any(v_dias))
      ),
      pr as materialized (
        select a.k, a.dia as dia_a, b.dia as dia_b,
               a.media_vendas and b.media_vendas as ok_v, a.media_itens and b.media_itens as ok_i,
               a.classe_vendas as cva, b.classe_vendas as cvb, a.classe_itens as cia, b.classe_itens as cib,
               a.dia_semana = b.dia_semana as mesmo_dow
        from a join b on b.k = a.k
        where v_crit = 'pareado' and v_na = v_nb
      ),
      u as materialized (
        select 'a'::text as lado, a.*,
               case when v_crit = 'pareado' then coalesce(pr.ok_v, false) else a.media_vendas end as usa_v,
               case when v_crit = 'pareado' then coalesce(pr.ok_i, false) else a.media_itens end as usa_i
        from a left join pr on pr.k = a.k
        union all
        select 'b'::text, b.*,
               case when v_crit = 'pareado' then coalesce(pr.ok_v, false) else b.media_vendas end,
               case when v_crit = 'pareado' then coalesce(pr.ok_i, false) else b.media_itens end
        from b left join pr on pr.k = b.k
      ),
      lados as (select l.lado, case l.lado when 'a' then v_na else v_nb end as n from (values ('a'), ('b')) l(lado)),
      -- indicadores gerais (base vendas)
      gl as (
        select l.lado, l.n,
               count(u.dia) filter (where u.usa_v) as d,
               sum(u.bruto) filter (where u.usa_v) as bruto,
               sum(u.liquido) filter (where u.usa_v) as liq,
               sum(u.descontos) filter (where u.usa_v) as des,
               sum(u.vendas) filter (where u.usa_v) as vendas,
               coalesce(bool_or(u.classe_vendas = 'pre_operacao'), false) as pre,
               coalesce(bool_and(u.classe_vendas = 'pre_operacao'), false) as so_pre
        from lados l left join u on u.lado = l.lado
        group by l.lado, l.n
      ),
      gm as (
        select gl.*,
               round(gl.d::numeric / nullif(gl.n, 0), 4) as cob,
               round(gl.liq / nullif(gl.vendas, 0), 2) as ticket,
               gl.bruto / nullif(gl.d, 0) as mb, gl.liq / nullif(gl.d, 0) as ml,
               gl.vendas::numeric / nullif(gl.d, 0) as mv, gl.des / nullif(gl.d, 0) as md,
               gl.des / nullif(gl.bruto, 0) as pd
        from gl
      ),
      ga as (select * from gm where lado = 'a'),
      gb as (select * from gm where lado = 'b'),
      gdec as (
        select v_mot is null and ga.d > 0 and gb.d > 0
               and ga.cob >= v_r.cobertura_minima_comparacao and gb.cob >= v_r.cobertura_minima_comparacao as comparavel,
               case when v_mot is not null then v_mot
                    when ga.so_pre then 'periodo_a_pre_operacao'
                    when gb.so_pre then 'periodo_b_pre_operacao'
                    when ga.pre or gb.pre then 'contem_pre_operacao'
                    when ga.d = 0 or gb.d = 0 then 'sem_dados'
                    else 'cobertura_insuficiente' end as motivo_nc
        from ga cross join gb
      ),
      gexc as (
        select coalesce(jsonb_agg(x.j order by x.o1, x.o2), '[]'::jsonb) as lista
        from (
          select pr.dia_a as o1, pr.dia_b as o2,
                 jsonb_build_object('dia_a', pr.dia_a, 'dia_b', pr.dia_b,
                                    'motivo', case when not (pr.cva in ('completo', 'completo_sem_vendas')) then 'a_' || pr.cva
                                                   else 'b_' || pr.cvb end) as j
          from pr where not pr.ok_v and v_crit = 'pareado'
          union all
          select u.dia, null::date, jsonb_build_object('lado', u.lado, 'dia', u.dia, 'motivo', u.classe_vendas)
          from u where v_crit = 'media' and not u.media_vendas
          order by 1, 2 limit 400
        ) x
      ),
      geral as (
        select jsonb_build_object(
          'base', 'vendas',
          'comparavel', gdec.comparavel,
          'motivo', case when gdec.comparavel then null else gdec.motivo_nc end,
          'a', jsonb_build_object('dias_filtrados', ga.n, 'dias_considerados', ga.d, 'cobertura', ga.cob,
                 'bruto', ga.bruto, 'liquido', ga.liq, 'descontos', ga.des, 'vendas', ga.vendas, 'ticket', ga.ticket,
                 'media_diaria_bruto', round(ga.mb, 2), 'media_diaria_liquido', round(ga.ml, 2),
                 'media_diaria_vendas', round(ga.mv, 2), 'media_diaria_descontos', round(ga.md, 2),
                 'percentual_descontos', round(ga.pd, 4)),
          'b', jsonb_build_object('dias_filtrados', gb.n, 'dias_considerados', gb.d, 'cobertura', gb.cob,
                 'bruto', gb.bruto, 'liquido', gb.liq, 'descontos', gb.des, 'vendas', gb.vendas, 'ticket', gb.ticket,
                 'media_diaria_bruto', round(gb.mb, 2), 'media_diaria_liquido', round(gb.ml, 2),
                 'media_diaria_vendas', round(gb.mv, 2), 'media_diaria_descontos', round(gb.md, 2),
                 'percentual_descontos', round(gb.pd, 4)),
          'diferencas', case when gdec.comparavel then jsonb_build_object(
                 'bruto', case when v_crit = 'pareado' then ga.bruto - gb.bruto end,
                 'liquido', case when v_crit = 'pareado' then ga.liq - gb.liq end,
                 'descontos', case when v_crit = 'pareado' then ga.des - gb.des end,
                 'vendas', case when v_crit = 'pareado' then ga.vendas - gb.vendas end,
                 'ticket', ga.ticket - gb.ticket,
                 'media_diaria_bruto', round(ga.mb - gb.mb, 2), 'media_diaria_liquido', round(ga.ml - gb.ml, 2),
                 'media_diaria_vendas', round(ga.mv - gb.mv, 2), 'media_diaria_descontos', round(ga.md - gb.md, 2),
                 'percentual_descontos', round(ga.pd - gb.pd, 4)) end,
          'variacoes', case when gdec.comparavel then jsonb_build_object(
                 'bruto', case when v_crit = 'pareado' then round((ga.bruto - gb.bruto) / nullif(gb.bruto, 0), 4) end,
                 'liquido', case when v_crit = 'pareado' then round((ga.liq - gb.liq) / nullif(gb.liq, 0), 4) end,
                 'descontos', case when v_crit = 'pareado' then round((ga.des - gb.des) / nullif(gb.des, 0), 4) end,
                 'vendas', case when v_crit = 'pareado' then round((ga.vendas - gb.vendas)::numeric / nullif(gb.vendas, 0), 4) end,
                 'ticket', round((ga.ticket - gb.ticket) / nullif(gb.ticket, 0), 4),
                 'media_diaria_bruto', round((ga.mb - gb.mb) / nullif(gb.mb, 0), 4),
                 'media_diaria_liquido', round((ga.ml - gb.ml) / nullif(gb.ml, 0), 4),
                 'media_diaria_vendas', round((ga.mv - gb.mv) / nullif(gb.mv, 0), 4),
                 'media_diaria_descontos', round((ga.md - gb.md) / nullif(gb.md, 0), 4),
                 'percentual_descontos', round((ga.pd - gb.pd) / nullif(gb.pd, 0), 4)) end,
          'base_zero', gdec.comparavel and (gb.bruto = 0 or gb.liq = 0 or gb.vendas = 0 or gb.des = 0),
          'dias_excluidos', gexc.lista) as j
        from ga cross join gb cross join gdec cross join gexc
      ),
      -- produtos (base itens)
      cods as (select c.codigo, c.ord from unnest(v_cods) with ordinality c(codigo, ord)),
      di as materialized (select distinct u.dia from u where u.usa_i and v_cods is not null),
      it as materialized (
        select vv.data, i.codigo, sum(i.quantidade) as q, sum(i.valor) as b, count(distinct i.numero) as n
        from public.g3_vendas vv
        join public.g3_venda_itens i on i.numero = vv.numero
        where vv.conciliacao = 'conciliada' and i.codigo = any(v_cods) and vv.data in (select di.dia from di)
        group by vv.data, i.codigo
      ),
      itt as materialized (
        select vv.data, sum(i.valor) as b
        from public.g3_vendas vv
        join public.g3_venda_itens i on i.numero = vv.numero
        where vv.conciliacao = 'conciliada' and vv.data in (select di.dia from di)
        group by vv.data
      ),
      pl as (
        select c.codigo, c.ord, l.lado, l.n,
               count(u.dia) filter (where u.usa_i) as d,
               sum(coalesce(it.q, 0)) filter (where u.usa_i) as q,
               sum(coalesce(it.n, 0)) filter (where u.usa_i) as nv,
               sum(coalesce(it.b, 0)) filter (where u.usa_i) as b,
               sum(coalesce(itt.b, 0)) filter (where u.usa_i) as tb,
               coalesce(bool_or(u.classe_itens = 'pre_operacao'), false) as pre,
               coalesce(bool_and(u.classe_itens = 'pre_operacao'), false) as so_pre
        from cods c
        cross join lados l
        left join u on u.lado = l.lado
        left join it on it.codigo = c.codigo and it.data = u.dia
        left join itt on itt.data = u.dia
        group by c.codigo, c.ord, l.lado, l.n
      ),
      pm as (
        select pl.*,
               round(pl.d::numeric / nullif(pl.n, 0), 4) as cob,
               pl.q / nullif(pl.d, 0) as mq, pl.nv::numeric / nullif(pl.d, 0) as mv, pl.b / nullif(pl.d, 0) as mb,
               round(pl.b / nullif(pl.q, 0), 4) as preco, round(pl.b / nullif(pl.tb, 0), 4) as part
        from pl
      ),
      pd as (
        select pa.codigo, pa.ord,
               v_mot is null and pa.d > 0 and pb.d > 0
               and pa.cob >= v_r.cobertura_minima_comparacao and pb.cob >= v_r.cobertura_minima_comparacao as comparavel,
               case when v_mot is not null then v_mot
                    when pa.so_pre then 'periodo_a_pre_operacao'
                    when pb.so_pre then 'periodo_b_pre_operacao'
                    when pa.pre or pb.pre then 'contem_pre_operacao'
                    when pa.d = 0 or pb.d = 0 then 'sem_dados'
                    else 'cobertura_insuficiente' end as motivo_nc,
               pa.n as an, pa.d as ad, pa.cob as acob, pa.q as aq, pa.nv as anv, pa.b as ab, pa.mq as amq, pa.mv as amv,
               pa.mb as amb, pa.preco as apreco, pa.part as apart,
               pb.n as bn, pb.d as bd, pb.cob as bcob, pb.q as bq, pb.nv as bnv, pb.b as bb, pb.mq as bmq, pb.mv as bmv,
               pb.mb as bmb, pb.preco as bpreco, pb.part as bpart
        from pm pa join pm pb on pb.codigo = pa.codigo and pb.lado = 'b'
        where pa.lado = 'a'
      ),
      produtos as (
        select coalesce(jsonb_agg(jsonb_build_object(
          'codigo', pd.codigo,
          'descricao', (select i2.descricao from public.g3_venda_itens i2 join public.g3_vendas v2 on v2.numero = i2.numero
                         where i2.codigo = pd.codigo order by v2.data desc, v2.numero desc limit 1),
          'base', 'itens',
          'comparavel', pd.comparavel,
          'motivo', case when pd.comparavel then null else pd.motivo_nc end,
          'a', jsonb_build_object('dias_filtrados', pd.an, 'dias_considerados', pd.ad, 'cobertura', pd.acob,
                 'quantidade', pd.aq, 'vendas', pd.anv, 'bruto', pd.ab,
                 'media_diaria_quantidade', round(pd.amq, 4), 'media_diaria_vendas', round(pd.amv, 2),
                 'media_diaria_bruto', round(pd.amb, 2), 'preco_medio', pd.apreco, 'participacao', pd.apart),
          'b', jsonb_build_object('dias_filtrados', pd.bn, 'dias_considerados', pd.bd, 'cobertura', pd.bcob,
                 'quantidade', pd.bq, 'vendas', pd.bnv, 'bruto', pd.bb,
                 'media_diaria_quantidade', round(pd.bmq, 4), 'media_diaria_vendas', round(pd.bmv, 2),
                 'media_diaria_bruto', round(pd.bmb, 2), 'preco_medio', pd.bpreco, 'participacao', pd.bpart),
          'diferencas', case when pd.comparavel then jsonb_build_object(
                 'quantidade', case when v_crit = 'pareado' then pd.aq - pd.bq end,
                 'vendas', case when v_crit = 'pareado' then pd.anv - pd.bnv end,
                 'bruto', case when v_crit = 'pareado' then pd.ab - pd.bb end,
                 'media_diaria_quantidade', round(pd.amq - pd.bmq, 4), 'media_diaria_vendas', round(pd.amv - pd.bmv, 2),
                 'media_diaria_bruto', round(pd.amb - pd.bmb, 2),
                 'preco_medio', pd.apreco - pd.bpreco, 'participacao', pd.apart - pd.bpart) end,
          'variacoes', case when pd.comparavel then jsonb_build_object(
                 'quantidade', case when v_crit = 'pareado' then round((pd.aq - pd.bq) / nullif(pd.bq, 0), 4) end,
                 'vendas', case when v_crit = 'pareado' then round((pd.anv - pd.bnv)::numeric / nullif(pd.bnv, 0), 4) end,
                 'bruto', case when v_crit = 'pareado' then round((pd.ab - pd.bb) / nullif(pd.bb, 0), 4) end,
                 'media_diaria_quantidade', round((pd.amq - pd.bmq) / nullif(pd.bmq, 0), 4),
                 'media_diaria_vendas', round((pd.amv - pd.bmv) / nullif(pd.bmv, 0), 4),
                 'media_diaria_bruto', round((pd.amb - pd.bmb) / nullif(pd.bmb, 0), 4),
                 'preco_medio', round((pd.apreco - pd.bpreco) / nullif(pd.bpreco, 0), 4),
                 'participacao', round((pd.apart - pd.bpart) / nullif(pd.bpart, 0), 4)) end,
          'base_zero', pd.comparavel and (pd.bq = 0 or pd.bnv = 0 or pd.bb = 0)) order by pd.ord), '[]'::jsonb) as lista
        from pd
      )
      select jsonb_build_object(
        'criterio_solicitado', p_criterio,
        'criterio', v_crit,
        'filtro', jsonb_build_object('dias_semana', to_jsonb(v_dias)),
        'cobertura_minima', v_r.cobertura_minima_comparacao,
        'avisos', to_jsonb(v_av
                    || case when exists (select 1 from pr where not pr.mesmo_dow)
                            then array['pares_com_dias_da_semana_diferentes'] else array[]::text[] end
                    || case when v_ad is not null and v_bd is not null and v_na <> v_nb
                            then array['quantidades_de_dias_diferentes'] else array[]::text[] end),
        'periodos', jsonb_build_object(
          'a', jsonb_build_object('de_solicitado', p_a_de, 'ate_solicitado', p_a_ate, 'de', v_ad, 'ate', v_aa,
                                  'dias_filtrados', v_na,
                                  'dias_fora_filtro', case when v_ad is not null then (v_aa - v_ad + 1) - v_na end),
          'b', jsonb_build_object('de_solicitado', p_b_de, 'ate_solicitado', p_b_ate, 'de', v_bd, 'ate', v_ba,
                                  'dias_filtrados', v_nb,
                                  'dias_fora_filtro', case when v_bd is not null then (v_ba - v_bd + 1) - v_nb end)),
        'pareamento', case when v_crit = 'pareado' and v_na = v_nb and v_na > 0 then jsonb_build_object(
                         'pares', v_na,
                         'pares_validos_vendas', (select count(*) from pr where pr.ok_v),
                         'pares_validos_itens', (select count(*) from pr where pr.ok_i),
                         'mesmo_dia_semana', (select bool_and(pr.mesmo_dow) from pr),
                         'pares_dias_semana_diferentes', (select count(*) from pr where not pr.mesmo_dow)) end,
        'geral', (select geral.j from geral),
        'produtos', (select produtos.lista from produtos))
      into v_res;

      return v_res;
    end;
    $fn$
  $ddl$;

  -- ============================================================
  -- 3. Seguranca: privilegios (so as novas funcoes; nada existente muda)
  -- ============================================================
  for v_md5 in
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('bi_dias_semana_int', 'bi_dias_valores_int', 'bi_resumo_v2', 'bi_serie_v2', 'bi_produtos_v2',
                        'bi_produto_serie_v2', 'bi_produtos_horario_v2', 'bi_produto_horarios', 'bi_comparar_periodos')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', v_md5);
  end loop;

  execute 'grant execute on function public.bi_resumo_v2(date, date, smallint[]) to authenticated';
  execute 'grant execute on function public.bi_serie_v2(date, date, text, smallint[]) to authenticated';
  execute 'grant execute on function public.bi_produtos_v2(date, date, text[], text, text, text, integer, integer, smallint[]) to authenticated';
  execute 'grant execute on function public.bi_produto_serie_v2(text[], date, date, text, smallint[]) to authenticated';
  execute 'grant execute on function public.bi_produtos_horario_v2(date, date, smallint, smallint, text, integer, smallint[]) to authenticated';
  execute 'grant execute on function public.bi_produto_horarios(text[], date, date, smallint[]) to authenticated';
  execute 'grant execute on function public.bi_comparar_periodos(date, date, date, date, smallint[], text[], text) to authenticated';

  -- ============================================================
  -- 4. Conferencia (qualquer diferenca desfaz TUDO: e o mesmo bloco)
  -- ============================================================
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'bi\_%';
  if v_n <> 22 then
    raise exception '0084 abortada na conferencia: esperadas 22 funcoes bi_* (13 da 0083 + 9), encontradas %.', v_n;
  end if;

  select md5(string_agg((n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')') || ':' || md5(replace(p.prosrc, chr(13), '')), ',' order by (n.nspname || '.' || p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')')))
    into v_md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('bi_calendario', 'bi_comparar', 'bi_dias_int', 'bi_excecao_valida', 'bi_hoje_int',
        'bi_horarios', 'bi_periodo_int', 'bi_produto_serie', 'bi_produtos', 'bi_produtos_horario', 'bi_resumo', 'bi_serie', 'bi_status');
  if v_md5 is distinct from '5ee708f0dfe2d632233c4fe72cb5ad9f' then
    raise exception '0084 abortada na conferencia: funcoes da 0083 alteradas.';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'bi\_%'
                and (p.proconfig is null or not ('search_path=""' = any(p.proconfig))
                     or (p.proname not in ('bi_hoje_int', 'bi_excecao_valida', 'bi_dias_semana_int') and not p.prosecdef))) then
    raise exception '0084 abortada na conferencia: funcao bi_* sem search_path vazio ou sem SECURITY DEFINER.';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'bi\_%'
                and (has_function_privilege('anon', p.oid, 'EXECUTE')
                     or has_function_privilege('public', p.oid, 'EXECUTE')
                     or (has_function_privilege('authenticated', p.oid, 'EXECUTE')
                         <> (p.proname in ('bi_status', 'bi_calendario', 'bi_resumo', 'bi_serie', 'bi_produtos',
                                           'bi_produto_serie', 'bi_horarios', 'bi_produtos_horario', 'bi_comparar',
                                           'bi_resumo_v2', 'bi_serie_v2', 'bi_produtos_v2', 'bi_produto_serie_v2',
                                           'bi_produtos_horario_v2', 'bi_produto_horarios', 'bi_comparar_periodos'))))) then
    raise exception '0084 abortada na conferencia: privilegios de execucao das funcoes bi_* incorretos.';
  end if;
end
$migracao$;

-- ============================================================
-- ROLLBACK (manual, so se precisar desfazer; nao toca na 0083 nem em dados):
-- drop function if exists public.bi_comparar_periodos(date, date, date, date, smallint[], text[], text);
-- drop function if exists public.bi_produto_horarios(text[], date, date, smallint[]);
-- drop function if exists public.bi_produtos_horario_v2(date, date, smallint, smallint, text, integer, smallint[]);
-- drop function if exists public.bi_produto_serie_v2(text[], date, date, text, smallint[]);
-- drop function if exists public.bi_produtos_v2(date, date, text[], text, text, text, integer, integer, smallint[]);
-- drop function if exists public.bi_serie_v2(date, date, text, smallint[]);
-- drop function if exists public.bi_resumo_v2(date, date, smallint[]);
-- drop function if exists public.bi_dias_valores_int(date, date);
-- drop function if exists public.bi_dias_semana_int(smallint[]);
