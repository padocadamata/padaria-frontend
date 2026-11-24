-- 0083_bi_gerencial.sql
-- BI Gerencial (fase 1: banco). Calendario operacional + funcoes SOMENTE DE
-- LEITURA sobre as tabelas da Central de Importacoes do G3 (0081/0082).
--
-- CRIA (so objetos novos, prefixo bi_):
--   * public.bi_calendario_regras   -- linha unica: inicio oficial da operacao
--                                      (09/07/2026), cobertura minima dos
--                                      comparativos (0,80), dias do periodo padrao (7)
--   * public.bi_calendario_excecoes -- dias com classificacao manual:
--                                      'cobertura_nao_confirmada' | 'sem_operacao'
--                                      (carga inicial: 24 e 25/07/2026, nao confirmada)
--   * internas (ninguem executa; so as funcoes abaixo): bi_hoje_int,
--     bi_periodo_int, bi_dias_int, bi_excecao_valida (gatilho)
--   * leitura (authenticated; 1a instrucao = g3_exigir_admin(), erro 42501):
--     bi_status, bi_calendario, bi_resumo, bi_serie, bi_produtos,
--     bi_produto_serie, bi_horarios, bi_produtos_horario, bi_comparar
--
-- NAO ALTERA nenhum objeto existente (tabela, funcao, policy, grant, dado).
-- Nenhum UPDATE/DELETE em lugar nenhum (pg_safeupdate).
--
-- REGRAS (aprovadas pelo proprietario):
--   * Cobertura de cada relatorio vem SO dos lotes confirmados, pela mesma
--     regra de g3_cobertura_int (0081): completo / parcial / com_pendencias /
--     sem_dados. confirmado_em nunca define cobertura.
--   * Bases: 'vendas' = FaturamGeral; 'itens' = FaturamGeral E
--     Vendas_ProdCliente (a pior das duas); Vendas_Periodo so confere (alerta_vp).
--   * Classe do dia (prioridade): futuro > pre_operacao > excecao >
--     sem_importacao > com_pendencias > parcial > completo_sem_vendas > completo.
--     Na base 'itens' ha ainda 'sem_conciliacao' (logo apos com_pendencias):
--     o dia tem vendas e NENHUMA conciliada -> produtos sem dado, nunca zero.
--   * Dia parcial com relatorios gerados em horarios diferentes: produtos so
--     ate o corte comum (o mais cedo); vendas depois dele ficam "fora do
--     corte" (contadas a parte, nao como problema de conciliacao).
--   * bi_produtos devolve jsonb com metadados (periodo, cobertura, totais,
--     paginacao) mesmo sem produtos; participacao = bruto do produto sobre
--     o bruto de todos os itens elegiveis do periodo (nao muda com filtros).
--   * 'registrado' = completo + completo_sem_vendas + parcial + com_pendencias
--     (valores efetivamente importados, com a cobertura identificada).
--     'base_media' = completo + completo_sem_vendas (dia coberto sem vendas
--     entra como R$ 0 no divisor -- so sai se houver excecao 'sem_operacao').
--   * Sem cobertura => valores NULOS, nunca zero.
--   * Faturamento: g3_vendas com fat_estado = 'presente' (bruto = prod,
--     liquido = liquido gravado). Produtos: SO vendas 'conciliada', valor
--     BRUTO do item. Ticket = liquido / vendas.
--
-- APLICACAO: manual no SQL Editor, depois do PREAUDIT; conferir com o
-- POSTAUDIT. A migration inteira e UM UNICO bloco DO: e atomica mesmo se o
-- editor executar instrucao por instrucao (licao do incidente da 0082) --
-- ou aplica e confere tudo, ou nao cria nada.

DO $migracao$
declare
  v_md5 text;
  v_n integer;
begin
  -- ============================================================
  -- 0. Guardas
  -- ============================================================
  if to_regclass('public.g3_vendas') is null or to_regclass('public.g3_venda_itens') is null
     or to_regclass('public.g3_vendas_diarias') is null or to_regclass('public.g3_importacoes') is null
     or to_regprocedure('public.g3_exigir_admin()') is null
     or to_regprocedure('public.g3_cobertura_int(date, date)') is null
     or to_regprocedure('public.is_admin()') is null then
    raise exception '0083 abortada: a Central de Importacoes do G3 (0081) precisa estar aplicada.';
  end if;

  select md5(replace(p.prosrc, chr(13), '')) into v_md5
  from pg_proc p where p.oid = to_regprocedure('public.g3_analisar(uuid)');
  if v_md5 is distinct from '05e3f84a8e1ebbd2545e3f6a2edd1a04' then
    raise exception '0083 abortada: a 0082 (g3_analisar com WHERE) precisa estar aplicada antes.';
  end if;

  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname like 'bi\_%')
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname like 'bi\_%') then
    raise exception '0083 abortada: objetos bi_* ja existem -- ela ja parece aplicada.';
  end if;

  -- ============================================================
  -- 1. Calendario operacional
  -- ============================================================
  execute $ddl$
    create table public.bi_calendario_regras (
      id                           boolean primary key default true,
      data_inicio_operacao         date not null,
      fuso                         text not null default 'America/Sao_Paulo',
      cobertura_minima_comparacao  numeric(3,2) not null default 0.80,
      dias_periodo_padrao          smallint not null default 7,
      atualizado_em                timestamptz not null default now(),
      constraint bi_calendario_regras_unica check (id),
      constraint bi_calendario_regras_fuso check (fuso = 'America/Sao_Paulo'),
      constraint bi_calendario_regras_cobertura check (cobertura_minima_comparacao between 0.50 and 1.00),
      constraint bi_calendario_regras_dias check (dias_periodo_padrao between 1 and 31)
    )
  $ddl$;

  execute $ddl$
    create table public.bi_calendario_excecoes (
      dia            date primary key,
      classificacao  text not null,
      motivo         text not null,
      criado_em      timestamptz not null default now(),
      constraint bi_calendario_excecoes_classificacao check (classificacao in ('cobertura_nao_confirmada', 'sem_operacao')),
      constraint bi_calendario_excecoes_motivo check (char_length(btrim(motivo)) between 3 and 500)
    )
  $ddl$;

  -- Excecao so a partir do inicio oficial (antes disso o dia ja e pre-operacao).
  execute $ddl$
    create function public.bi_excecao_valida()
    returns trigger
    language plpgsql
    set search_path = ''
    as $fn$
    begin
      if new.dia < (select r.data_inicio_operacao from public.bi_calendario_regras r where r.id) then
        raise exception 'bi: excecao de calendario anterior ao inicio da operacao (%).', new.dia using errcode = '22023';
      end if;
      return new;
    end;
    $fn$
  $ddl$;
  execute $ddl$
    create trigger bi_calendario_excecoes_valida before insert or update on public.bi_calendario_excecoes
      for each row execute function public.bi_excecao_valida()
  $ddl$;

  execute $ddl$ insert into public.bi_calendario_regras (data_inicio_operacao) values (date '2026-07-09') $ddl$;
  execute $ddl$
    insert into public.bi_calendario_excecoes (dia, classificacao, motivo) values
      (date '2026-07-24', 'cobertura_nao_confirmada', 'Loja em funcionamento, sem vendas nos tres relatorios; hipotese de falta de energia nao confirmada'),
      (date '2026-07-25', 'cobertura_nao_confirmada', 'Loja em funcionamento, sem vendas nos tres relatorios; hipotese de falta de energia nao confirmada')
  $ddl$;

  -- ============================================================
  -- 2. Funcoes internas
  -- ============================================================

  -- "Hoje" no fuso da Padoca (unico ponto: os testes locais o substituem).
  execute $ddl$
    create function public.bi_hoje_int()
    returns date
    language sql
    stable
    set search_path = ''
    as $fn$ select (now() at time zone 'America/Sao_Paulo')::date $fn$
  $ddl$;

  -- Valida e ajusta o periodo pedido. Erros 22023; ajustes viram avisos;
  -- periodo inteiro no futuro / na pre-operacao devolve "motivo" (sem erro).
  execute $ddl$
    create function public.bi_periodo_int(p_de date, p_ate date, p_maximo integer)
    returns table (de date, ate date, avisos text[], motivo text)
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
    declare
      v_ini date;
      v_hoje date;
      v_de date := p_de;
      v_ate date := p_ate;
      v_av text[] := array[]::text[];
    begin
      if p_de is null or p_ate is null then
        raise exception 'Informe a data inicial e a data final.' using errcode = '22023';
      end if;
      if p_de > p_ate then
        raise exception 'A data inicial nao pode ser posterior a data final.' using errcode = '22023';
      end if;
      if p_ate - p_de + 1 > p_maximo then
        raise exception 'Periodo maior que o maximo permitido (% dias).', p_maximo using errcode = '22023';
      end if;
      select r.data_inicio_operacao into v_ini from public.bi_calendario_regras r where r.id;
      v_hoje := public.bi_hoje_int();
      if p_de > v_hoje then
        return query select null::date, null::date, array['periodo_futuro']::text[], 'periodo_futuro'::text;
        return;
      end if;
      if p_ate < v_ini then
        return query select null::date, null::date, array['periodo_pre_operacao']::text[], 'periodo_pre_operacao'::text;
        return;
      end if;
      if v_de < v_ini then
        v_de := v_ini;
        v_av := v_av || 'inicio_ajustado_operacao'::text;
      end if;
      if v_ate > v_hoje then
        v_ate := v_hoje;
        v_av := v_av || 'fim_ajustado_hoje'::text;
      end if;
      return query select v_de, v_ate, v_av, null::text;
    end;
    $fn$
  $ddl$;

  -- Classificacao de CADA dia do intervalo (sem ajuste de periodo: devolve
  -- pre_operacao/futuro quando for o caso). Base de todas as funcoes.
  execute $ddl$
    create function public.bi_dias_int(p_de date, p_ate date)
    returns table (
      dia date,
      cob_faturamento text, cob_produtos text, cob_periodo text,
      cob_vendas text, cob_itens text,
      hora_limite_vendas time, hora_limite_itens time,
      classe_vendas text, classe_itens text,
      media_vendas boolean, media_itens boolean,
      excecao_classificacao text, excecao_motivo text,
      vendas_registradas integer, bruto_registrado numeric, vendas_conciliadas integer,
      periodo_venda numeric, alerta_vp boolean,
      pendencias_faturamento integer, pendencias_produtos integer,
      vendas_nao_conciliadas integer, bruto_nao_conciliado numeric, vendas_fora_corte integer
    )
    language sql
    stable
    security definer
    set search_path = ''
    as $fn$
      with r as (select x.data_inicio_operacao as ini from public.bi_calendario_regras x where x.id),
      h as (select public.bi_hoje_int() as hoje),
      c as (
        select x.dia,
               max(x.estado) filter (where x.layout = 'faturamento_geral') as ef,
               max(x.estado) filter (where x.layout = 'vendas_produto_cliente') as ei,
               max(x.estado) filter (where x.layout = 'vendas_periodo') as ep,
               coalesce(sum(x.pendencias) filter (where x.layout = 'faturamento_geral'), 0)::int as pf,
               coalesce(sum(x.pendencias) filter (where x.layout = 'vendas_produto_cliente'), 0)::int as pi
        from public.g3_cobertura_int(p_de, p_ate) x
        group by x.dia
      ),
      m as (
        select c.dia, c.pf, c.pi,
               case c.ef when 'completo' then 'completa' when 'parcial' then 'parcial'
                         when 'com_pendencias' then 'pendente' else 'nenhuma' end as cf,
               case c.ei when 'completo' then 'completa' when 'parcial' then 'parcial'
                         when 'com_pendencias' then 'pendente' else 'nenhuma' end as ci,
               case c.ep when 'completo' then 'completa' when 'parcial' then 'parcial'
                         when 'com_pendencias' then 'pendente' else 'nenhuma' end as cp
        from c
      ),
      k as (
        select m.*,
               (array['nenhuma', 'pendente', 'parcial', 'completa'])[
                 least(array_position(array['nenhuma', 'pendente', 'parcial', 'completa'], m.cf),
                       array_position(array['nenhuma', 'pendente', 'parcial', 'completa'], m.ci))] as citens
        from m
      ),
      hl as (
        select l.dia_parcial as dia,
               max(l.gerado_em) filter (where l.layout = 'faturamento_geral') as gf,
               max(l.gerado_em) filter (where l.layout = 'vendas_produto_cliente') as gi
        from public.g3_importacoes l
        where l.status = 'confirmado' and l.dia_parcial between p_de and p_ate
        group by l.dia_parcial
      ),
      kc as materialized (
        select k.dia, k.cf, k.ci, hl.gf, hl.gi from k left join hl on hl.dia = k.dia
      ),
      -- "fora do corte": em dia parcial com relatorios gerados em horarios
      -- diferentes, a venda depois do corte de um deles ainda nao tem o outro
      -- lado; nao e problema de qualidade (so fica fora de produtos).
      vq as (
        select g.data, g.fat_estado, g.prod, g.conciliacao, g.itens_estado,
               coalesce((g.conciliacao = 'sem_itens' and kc.ci = 'parcial'
                         and (g.data_hora at time zone 'America/Sao_Paulo')::time > (kc.gi at time zone 'America/Sao_Paulo')::time)
                        or (g.conciliacao = 'sem_faturamento' and kc.cf = 'parcial'
                            and (kc.ci = 'completa' or kc.gi > kc.gf)), false) as fora
        from public.g3_vendas g
        join kc on kc.dia = g.data
        where g.data between p_de and p_ate
      ),
      v as materialized (
        select vq.data as dia,
               count(*) filter (where vq.fat_estado = 'presente')::int as n,
               coalesce(sum(vq.prod) filter (where vq.fat_estado = 'presente'), 0) as bruto,
               count(*) filter (where vq.conciliacao = 'conciliada')::int as nc,
               count(*) filter (where vq.conciliacao <> 'conciliada' and not vq.fora
                                  and (vq.fat_estado = 'presente' or vq.itens_estado = 'presente'))::int as nn,
               coalesce(sum(vq.prod) filter (where vq.conciliacao <> 'conciliada' and not vq.fora
                                               and vq.fat_estado = 'presente'), 0) as bn,
               count(*) filter (where vq.fora)::int as nf
        from vq
        group by vq.data
      ),
      vp as (
        select d.dia, d.venda from public.g3_vendas_diarias d
        where d.dia between p_de and p_ate and d.estado = 'presente'
      ),
      b as (
        select k.dia, k.cf, k.ci, k.cp, k.citens, k.pf, k.pi,
               coalesce(v.n, 0) as n, coalesce(v.bruto, 0) as bruto, coalesce(v.nc, 0) as nc,
               coalesce(v.nn, 0) as nn, coalesce(v.bn, 0) as bn, coalesce(v.nf, 0) as nf,
               vp.venda as vp_venda,
               e.classificacao as exc, e.motivo as exc_motivo,
               hl.gf, hl.gi, r.ini, h.hoje
        from k
        cross join r cross join h
        left join v on v.dia = k.dia
        left join vp on vp.dia = k.dia
        left join hl on hl.dia = k.dia
        left join public.bi_calendario_excecoes e on e.dia = k.dia
      ),
      cl as (
        select b.*,
               case when b.dia > b.hoje then 'futuro'
                    when b.dia < b.ini then 'pre_operacao'
                    when b.exc is not null then b.exc
                    when b.cf = 'nenhuma' then 'sem_importacao'
                    when b.cf = 'pendente' then 'com_pendencias'
                    when b.cf = 'parcial' then 'parcial'
                    when b.n = 0 then 'completo_sem_vendas'
                    else 'completo' end as classe_v,
               case when b.dia > b.hoje then 'futuro'
                    when b.dia < b.ini then 'pre_operacao'
                    when b.exc is not null then b.exc
                    when b.citens = 'nenhuma' then 'sem_importacao'
                    when b.citens = 'pendente' then 'com_pendencias'
                    -- ha vendas no dia e NENHUMA conciliada: produtos sem dado (nunca zero)
                    when b.nc = 0 and b.nn > 0 then 'sem_conciliacao'
                    when b.citens = 'parcial' then 'parcial'
                    when b.n = 0 then 'completo_sem_vendas'
                    else 'completo' end as classe_i
        from b
      )
      select cl.dia,
             cl.cf, cl.ci, cl.cp,
             cl.cf, cl.citens,
             case when cl.cf = 'parcial' then (cl.gf at time zone 'America/Sao_Paulo')::time end,
             case when cl.citens = 'parcial' then
               (least(case when cl.cf = 'parcial' then cl.gf end, case when cl.ci = 'parcial' then cl.gi end)
                  at time zone 'America/Sao_Paulo')::time end,
             cl.classe_v, cl.classe_i,
             cl.classe_v in ('completo', 'completo_sem_vendas'),
             cl.classe_i in ('completo', 'completo_sem_vendas'),
             cl.exc, cl.exc_motivo,
             cl.n, cl.bruto, cl.nc,
             cl.vp_venda,
             (cl.cp = 'completa' and cl.cf = 'completa' and coalesce(cl.vp_venda, 0) <> cl.bruto),
             cl.pf, cl.pi, cl.nn, cl.bn, cl.nf
      from cl
      order by cl.dia
    $fn$
  $ddl$;

  -- ============================================================
  -- 3. Funcoes de leitura (authenticated; so proprietario_admin ativo)
  -- ============================================================

  -- 3.1 Status: ultima importacao, cobertura por relatorio, periodo padrao.
  execute $ddl$
    create function public.bi_status()
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
      v_ultimo date;
      v_rel jsonb;
    begin
      perform public.g3_exigir_admin();
      select * into v_r from public.bi_calendario_regras r where r.id;
      v_hoje := public.bi_hoje_int();

      select max(d.dia) into v_ultimo
      from public.bi_dias_int(v_r.data_inicio_operacao, v_hoje) d
      where d.classe_vendas in ('completo', 'completo_sem_vendas');

      select jsonb_agg(x.j order by x.ordem) into v_rel
      from (
        select ly.ordem, jsonb_build_object(
                 'layout', ly.layout,
                 'lotes_confirmados', count(l.id),
                 'ultimo_dia_completo', max(l.cobertura_completa_fim) filter (where l.cobertura_completa_fim >= l.periodo_inicio),
                 'ultimo_gerado_em', max(l.gerado_em),
                 'dia_parcial', (array_agg(l.dia_parcial order by l.gerado_em desc, l.seq desc))[1],
                 'hora_limite', to_char((array_agg(l.gerado_em order by l.gerado_em desc, l.seq desc))[1] at time zone 'America/Sao_Paulo', 'HH24:MI'),
                 'ultima_confirmacao_em', max(l.confirmado_em)) as j
        from (values (1, 'faturamento_geral'), (2, 'vendas_produto_cliente'), (3, 'vendas_periodo')) ly(ordem, layout)
        left join public.g3_importacoes l on l.layout = ly.layout and l.status = 'confirmado'
        group by ly.ordem, ly.layout
      ) x;

      return jsonb_build_object(
        'hoje', v_hoje,
        'data_inicio_operacao', v_r.data_inicio_operacao,
        'fuso', v_r.fuso,
        'cobertura_minima_comparacao', v_r.cobertura_minima_comparacao,
        'dias_periodo_padrao', v_r.dias_periodo_padrao,
        'ultima_importacao_em', (select max(l.confirmado_em) from public.g3_importacoes l where l.status = 'confirmado'),
        'relatorios', coalesce(v_rel, '[]'::jsonb),
        'padrao_de', case when v_ultimo is not null
                          then greatest(v_ultimo - (v_r.dias_periodo_padrao - 1), v_r.data_inicio_operacao) end,
        'padrao_ate', v_ultimo,
        'avisos', case when v_ultimo is null then '["sem_dias_completos"]'::jsonb else '[]'::jsonb end
      );
    end;
    $fn$
  $ddl$;

  -- 3.2 Calendario de cobertura (faixa de cobertura e marcacao dos graficos).
  execute $ddl$
    create function public.bi_calendario(p_de date, p_ate date)
    returns table (
      dia date, classe_vendas text, classe_itens text,
      entra_media_vendas boolean, entra_media_itens boolean,
      cobertura_faturamento text, cobertura_produtos text, cobertura_periodo text,
      hora_limite_vendas time, hora_limite_itens time,
      excecao_motivo text, alerta_vp boolean,
      vendas_registradas integer, bruto_registrado numeric, aviso text,
      pendencias_faturamento integer, pendencias_produtos integer,
      vendas_nao_conciliadas integer, vendas_fora_corte integer
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
    begin
      perform public.g3_exigir_admin();
      select * into p from public.bi_periodo_int(p_de, p_ate, 400);
      if p.motivo is not null then
        return;
      end if;
      return query
      select d.dia, d.classe_vendas, d.classe_itens, d.media_vendas, d.media_itens,
             d.cob_faturamento, d.cob_produtos, d.cob_periodo,
             d.hora_limite_vendas, d.hora_limite_itens,
             d.excecao_motivo, d.alerta_vp,
             d.vendas_registradas, d.bruto_registrado,
             case when d.excecao_classificacao is not null and d.vendas_registradas > 0 then 'excecao_com_vendas'
                  when 'com_pendencias' in (d.classe_vendas, d.classe_itens) then 'dados_incompletos_pendencia'
                  when d.classe_itens = 'sem_conciliacao' then 'produtos_sem_conciliacao' end,
             d.pendencias_faturamento, d.pendencias_produtos,
             d.vendas_nao_conciliadas, d.vendas_fora_corte
      from public.bi_dias_int(p.de, p.ate) d
      order by d.dia;
    end;
    $fn$
  $ddl$;

  -- 3.3 Resumo (Visao Geral): registrado x base_media.
  execute $ddl$
    create function public.bi_resumo(p_de date, p_ate date)
    returns jsonb
    language plpgsql
    stable
    security definer
    set search_path = ''
    set statement_timeout = '20s'
    as $fn$
    declare
      p record;
      v jsonb;
    begin
      perform public.g3_exigir_admin();
      select * into p from public.bi_periodo_int(p_de, p_ate, 1830);
      if p.motivo is not null then
        return jsonb_build_object(
          'periodo', jsonb_build_object('de', null, 'ate', null, 'de_solicitado', p_de, 'ate_solicitado', p_ate),
          'motivo', p.motivo, 'avisos', to_jsonb(p.avisos),
          'registrado', null, 'base_media', null, 'dias', null, 'qualidade', null);
      end if;

      with d as materialized (
        select x.*,
               x.classe_vendas in ('completo', 'completo_sem_vendas', 'parcial', 'com_pendencias') as reg
        from public.bi_dias_int(p.de, p.ate) x
      ),
      g as materialized (
        select vv.data, sum(vv.prod) as bruto, sum(vv.liquido) as liq,
               sum(vv.desconto_item + vv.desconto_rateado) as des,
               sum(vv.acrescimo_item + vv.acrescimo_rateado) as acr,
               sum(vv.taxa_servico) as tx, count(*) as n
        from public.g3_vendas vv
        where vv.data between p.de and p.ate and vv.fat_estado = 'presente'
        group by vv.data
      ),
      j as (
        select d.*, coalesce(g.bruto, 0) as bruto, coalesce(g.liq, 0) as liq, coalesce(g.des, 0) as des,
               coalesce(g.acr, 0) as acr, coalesce(g.tx, 0) as tx, coalesce(g.n, 0) as n
        from d left join g on g.data = d.dia
      ),
      nc as (
        select coalesce(sum(d.vendas_nao_conciliadas), 0) as vendas, coalesce(sum(d.bruto_nao_conciliado), 0) as bruto,
               coalesce(sum(d.vendas_fora_corte), 0) as fora
        from d where d.reg
      ),
      a as (
        select count(*) filter (where reg) as dias_reg,
               count(*) filter (where media_vendas) as dias_med,
               sum(bruto) filter (where reg) as bruto_r, sum(liq) filter (where reg) as liq_r,
               sum(des) filter (where reg) as des_r, sum(acr) filter (where reg) as acr_r,
               sum(tx) filter (where reg) as tx_r, sum(n) filter (where reg) as n_r,
               sum(bruto) filter (where media_vendas) as bruto_m, sum(liq) filter (where media_vendas) as liq_m,
               sum(n) filter (where media_vendas) as n_m,
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
               bool_or(excecao_classificacao is not null and vendas_registradas > 0) as exc_vendas
        from j
      )
      select jsonb_build_object(
        'periodo', jsonb_build_object('de', p.de, 'ate', p.ate, 'de_solicitado', p_de, 'ate_solicitado', p_ate),
        'motivo', null,
        'avisos', to_jsonb(p.avisos
                    || case when a.exc_vendas then array['excecao_com_vendas']::text[] else array[]::text[] end
                    || case when a.dias_reg = 0 then array['sem_dados']::text[] else array[]::text[] end
                    || case when a.d_parcial > 0 then array['contem_dia_parcial']::text[] else array[]::text[] end),
        'registrado', case when a.dias_reg = 0 then null else jsonb_build_object(
            'bruto', coalesce(a.bruto_r, 0), 'liquido', coalesce(a.liq_r, 0), 'descontos', coalesce(a.des_r, 0),
            'acrescimos', coalesce(a.acr_r, 0), 'taxa_servico', coalesce(a.tx_r, 0), 'vendas', coalesce(a.n_r, 0),
            'ticket', round(a.liq_r / nullif(a.n_r, 0), 2),
            'dias_com_dados', a.dias_reg, 'dias_parciais', a.d_parcial, 'dias_com_pendencias', a.d_pend) end,
        'base_media', jsonb_build_object(
            'dias_validos', a.dias_med,
            'bruto', case when a.dias_med > 0 then coalesce(a.bruto_m, 0) end,
            'liquido', case when a.dias_med > 0 then coalesce(a.liq_m, 0) end,
            'vendas', case when a.dias_med > 0 then coalesce(a.n_m, 0) end,
            'ticket', round(a.liq_m / nullif(a.n_m, 0), 2),
            'media_diaria_bruto', round(a.bruto_m / nullif(a.dias_med, 0), 2),
            'media_diaria_liquido', round(a.liq_m / nullif(a.dias_med, 0), 2),
            'media_diaria_vendas', round(a.n_m::numeric / nullif(a.dias_med, 0), 2)),
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

  -- 3.4 Serie temporal por dia/semana/mes (registrado x base_media).
  execute $ddl$
    create function public.bi_serie(p_de date, p_ate date, p_agrupamento text)
    returns table (
      inicio date, fim date, rotulo text,
      bruto numeric, liquido numeric, descontos numeric, vendas bigint, ticket numeric,
      bruto_media numeric, liquido_media numeric, vendas_media bigint, ticket_media numeric, dias_validos bigint,
      dias_calendario bigint, dias_completos bigint, dias_sem_vendas bigint, dias_parciais bigint,
      dias_com_pendencias bigint, dias_sem_importacao bigint, dias_nao_confirmados bigint, dias_sem_operacao bigint,
      dias_pre_operacao bigint, dias_futuros bigint, dias_fora_periodo bigint,
      cobertura text, classe text, hora_limite time, mes_inicio_operacao boolean
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
      v_ini_op date;
      v_a date;
      v_b date;
    begin
      perform public.g3_exigir_admin();
      if p_agrupamento is null or p_agrupamento not in ('dia', 'semana', 'mes') then
        raise exception 'Agrupamento invalido (use dia, semana ou mes).' using errcode = '22023';
      end if;
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
               case p_agrupamento when 'dia' then x.dia when 'semana' then date_trunc('week', x.dia)::date
                                  else date_trunc('month', x.dia)::date end as k
        from public.bi_dias_int(v_a, v_b) x
      ),
      g as materialized (
        select vv.data, sum(vv.prod) as bruto, sum(vv.liquido) as liq,
               sum(vv.desconto_item + vv.desconto_rateado) as des, count(*) as n
        from public.g3_vendas vv
        where vv.data between p.de and p.ate and vv.fat_estado = 'presente'
        group by vv.data
      ),
      j as (
        select d.*, coalesce(g.bruto, 0) as bruto, coalesce(g.liq, 0) as liq, coalesce(g.des, 0) as des,
               coalesce(g.n, 0) as n,
               d.dentro and d.classe_vendas in ('completo', 'completo_sem_vendas', 'parcial', 'com_pendencias') as reg,
               d.dentro and d.media_vendas as med
        from d left join g on g.data = d.dia
      )
      select j.k,
             case p_agrupamento when 'dia' then j.k when 'semana' then j.k + 6
                                else (j.k + interval '1 month - 1 day')::date end,
             case p_agrupamento when 'dia' then to_char(j.k, 'DD/MM/YYYY')
                                when 'semana' then to_char(j.k, 'DD/MM') || ' a ' || to_char(j.k + 6, 'DD/MM/YYYY')
                                else to_char(j.k, 'MM/YYYY') end,
             case when bool_or(j.reg) then coalesce(sum(j.bruto) filter (where j.reg), 0) end,
             case when bool_or(j.reg) then coalesce(sum(j.liq) filter (where j.reg), 0) end,
             case when bool_or(j.reg) then coalesce(sum(j.des) filter (where j.reg), 0) end,
             case when bool_or(j.reg) then coalesce(sum(j.n) filter (where j.reg), 0)::bigint end,
             round(sum(j.liq) filter (where j.reg) / nullif(sum(j.n) filter (where j.reg), 0), 2),
             case when bool_or(j.med) then coalesce(sum(j.bruto) filter (where j.med), 0) end,
             case when bool_or(j.med) then coalesce(sum(j.liq) filter (where j.med), 0) end,
             case when bool_or(j.med) then coalesce(sum(j.n) filter (where j.med), 0)::bigint end,
             round(sum(j.liq) filter (where j.med) / nullif(sum(j.n) filter (where j.med), 0), 2),
             count(*) filter (where j.med),
             count(*),
             count(*) filter (where j.dentro and j.classe_vendas = 'completo'),
             count(*) filter (where j.dentro and j.classe_vendas = 'completo_sem_vendas'),
             count(*) filter (where j.dentro and j.classe_vendas = 'parcial'),
             count(*) filter (where j.dentro and j.classe_vendas = 'com_pendencias'),
             count(*) filter (where j.dentro and j.classe_vendas = 'sem_importacao'),
             count(*) filter (where j.dentro and j.classe_vendas = 'cobertura_nao_confirmada'),
             count(*) filter (where j.dentro and j.classe_vendas = 'sem_operacao'),
             count(*) filter (where j.classe_vendas = 'pre_operacao'),
             count(*) filter (where j.classe_vendas = 'futuro'),
             count(*) filter (where not j.dentro and j.classe_vendas not in ('pre_operacao', 'futuro')),
             case when not bool_or(j.reg) then 'sem_dados' when bool_and(j.med) then 'completa' else 'parcial' end,
             case when p_agrupamento = 'dia' then max(j.classe_vendas) end,
             case when p_agrupamento = 'dia' then max(j.hora_limite_vendas) end,
             (p_agrupamento = 'mes' and j.k = date_trunc('month', v_ini_op)::date)
      from j
      group by j.k
      order by j.k;
    end;
    $fn$
  $ddl$;

  -- 3.5 Produtos (ranking/tabela). Bruto do item; so vendas conciliadas;
  -- ordenacao por lista fechada, ANTES da paginacao. Devolve SEMPRE os
  -- metadados (periodo, cobertura, totais, paginacao), mesmo sem produtos.
  -- Participacao = bruto do produto / bruto de TODOS os itens elegiveis do
  -- periodo (nao muda com codigos, busca, ordem, pagina ou Top N).
  execute $ddl$
    create function public.bi_produtos(
      p_de date, p_ate date,
      p_codigos text[] default null, p_busca text default null,
      p_ordem text default 'bruto', p_direcao text default 'desc',
      p_limite integer default 50, p_deslocamento integer default 0)
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
      select * into p from public.bi_periodo_int(p_de, p_ate, 1830);
      if p.motivo is not null then
        return jsonb_build_object(
          'periodo', jsonb_build_object('de', null, 'ate', null, 'de_solicitado', p_de, 'ate_solicitado', p_ate),
          'motivo', p.motivo, 'avisos', to_jsonb(p.avisos), 'cobertura', null, 'totais', null,
          'paginacao', jsonb_build_object('total_linhas', 0, 'retornadas', 0, 'limite', p_limite,
                                          'deslocamento', p_deslocamento, 'ordem', p_ordem, 'direcao', p_direcao,
                                          'tem_mais', false),
          'produtos', '[]'::jsonb);
      end if;

      with dd as materialized (
        select x.*, x.classe_itens in ('completo', 'completo_sem_vendas', 'parcial', 'com_pendencias') as reg
        from public.bi_dias_int(p.de, p.ate) x
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
               coalesce(sum(dd.vendas_fora_corte) filter (where dd.reg), 0) as fora
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
        'motivo', null,
        'avisos', to_jsonb(p.avisos
                    || case when cob.dias_reg = 0 then array['sem_dados']::text[] else array[]::text[] end
                    || case when cob.d_parc > 0 then array['contem_dia_parcial']::text[] else array[]::text[] end
                    || case when cob.d_pend > 0 then array['contem_dia_com_pendencias']::text[] else array[]::text[] end
                    || case when cob.d_semc > 0 then array['contem_dia_sem_conciliacao']::text[] else array[]::text[] end
                    || case when cob.excl > 0 then array['vendas_nao_conciliadas_excluidas']::text[] else array[]::text[] end),
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

  -- 3.6 Evolucao de 1 a 5 produtos.
  execute $ddl$
    create function public.bi_produto_serie(p_codigos text[], p_de date, p_ate date, p_agrupamento text)
    returns table (
      codigo text, descricao text, inicio date, fim date,
      quantidade numeric, vendas bigint, bruto numeric,
      dias_registrados bigint, dias_validos bigint, dias_calendario bigint, cobertura text
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
               (x.dia between p.de and p.ate)
                 and x.classe_itens in ('completo', 'completo_sem_vendas', 'parcial', 'com_pendencias') as reg,
               (x.dia between p.de and p.ate) and x.media_itens as med,
               case p_agrupamento when 'dia' then x.dia when 'semana' then date_trunc('week', x.dia)::date
                                  else date_trunc('month', x.dia)::date end as k
        from public.bi_dias_int(v_a, v_b) x
      ),
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
      select c.codigo, nome.descricao, d.k,
             case p_agrupamento when 'dia' then d.k when 'semana' then d.k + 6
                                else (d.k + interval '1 month - 1 day')::date end,
             case when bool_or(d.reg) then coalesce(sum(it.q) filter (where d.reg), 0) end,
             case when bool_or(d.reg) then coalesce(sum(it.n) filter (where d.reg), 0)::bigint end,
             case when bool_or(d.reg) then coalesce(sum(it.b) filter (where d.reg), 0) end,
             count(*) filter (where d.reg),
             count(*) filter (where d.med),
             count(*),
             case when not bool_or(d.reg) then 'sem_dados' when bool_and(d.med) then 'completa' else 'parcial' end
      from cods c
      join nome on nome.codigo = c.codigo
      cross join d
      left join it on it.codigo = c.codigo and it.data = d.dia
      group by c.codigo, nome.descricao, d.k
      order by c.codigo, d.k;
    end;
    $fn$
  $ddl$;

  -- 3.7 Horarios: SO dias da base_media (parciais nunca entram).
  execute $ddl$
    create function public.bi_horarios(p_de date, p_ate date, p_dias_semana smallint[] default null)
    returns table (
      dia_semana smallint, hora smallint,
      vendas bigint, bruto numeric, liquido numeric,
      dias_considerados bigint, media_vendas_dia numeric, media_liquido_dia numeric
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
    begin
      perform public.g3_exigir_admin();
      if p_dias_semana is not null and (cardinality(p_dias_semana) not between 1 and 7
           or array_position(p_dias_semana, null) is not null
           or exists (select 1 from unnest(p_dias_semana) x where x not between 0 and 6)) then
        raise exception 'Dias da semana invalidos (0 = domingo a 6 = sabado).' using errcode = '22023';
      end if;
      select * into p from public.bi_periodo_int(p_de, p_ate, 1830);
      if p.motivo is not null then
        return;
      end if;
      return query
      with dv as materialized (
        select x.dia, extract(dow from x.dia)::smallint as dow
        from public.bi_dias_int(p.de, p.ate) x
        where x.media_vendas
          and (p_dias_semana is null or extract(dow from x.dia)::smallint = any(p_dias_semana))
      ),
      s as (
        select dv.dow, extract(hour from vv.data_hora at time zone 'America/Sao_Paulo')::smallint as hora,
               vv.prod, vv.liquido
        from public.g3_vendas vv
        join dv on dv.dia = vv.data
        where vv.fat_estado = 'presente'
      ),
      ndow as (select dv.dow, count(*) as n from dv group by dv.dow),
      grade as (
        select ndow.dow, h::smallint as hora, ndow.n from ndow cross join generate_series(0, 23) h
        union all
        select null::smallint, h::smallint, (select count(*) from dv) from generate_series(0, 23) h
        where exists (select 1 from dv)
      ),
      agg as materialized (
        select s.dow, s.hora, count(*) as vendas, sum(s.prod) as bruto, sum(s.liquido) as liq
        from s group by grouping sets ((s.dow, s.hora), (s.hora))
      )
      select g.dow, g.hora,
             coalesce(a.vendas, 0), coalesce(a.bruto, 0), coalesce(a.liq, 0),
             g.n,
             round(coalesce(a.vendas, 0)::numeric / nullif(g.n, 0), 2),
             round(coalesce(a.liq, 0) / nullif(g.n, 0), 2)
      from grade g
      left join agg a on a.hora = g.hora and a.dow is not distinct from g.dow
      order by g.dow nulls first, g.hora;
    end;
    $fn$
  $ddl$;

  -- 3.8 Produtos por horario: soma do ITEM (nunca o total da venda).
  execute $ddl$
    create function public.bi_produtos_horario(
      p_de date, p_ate date,
      p_hora_inicio smallint default 0, p_hora_fim smallint default 23,
      p_ordem text default 'bruto', p_limite integer default 10)
    returns table (
      hora smallint, posicao integer, codigo text, descricao text,
      quantidade numeric, vendas bigint, bruto numeric, dias_considerados bigint
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
      v_dias bigint;
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
      select * into p from public.bi_periodo_int(p_de, p_ate, 1830);
      if p.motivo is not null then
        return;
      end if;
      select count(*) into v_dias from public.bi_dias_int(p.de, p.ate) x where x.media_itens;
      return query
      with dv as materialized (select x.dia from public.bi_dias_int(p.de, p.ate) x where x.media_itens),
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
      select rk.hora, rk.pos, rk.codigo, nomes.descricao, rk.q, rk.n, rk.v, v_dias
      from rk join nomes on nomes.codigo = rk.codigo
      where rk.pos <= p_limite
      order by rk.hora, rk.pos;
    end;
    $fn$
  $ddl$;

  -- 3.9 Comparativos com periodos equivalentes (dias pareados).
  execute $ddl$
    create function public.bi_comparar(p_tipo text, p_de date, p_ate date, p_codigo text default null)
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
      v_de date;
      v_ate date;
      v_n integer;
      v_av text[] := array[]::text[];
      v_cod text;
      v_res jsonb;
    begin
      perform public.g3_exigir_admin();
      if p_tipo is null or p_tipo not in ('periodo', 'semana', 'mes') then
        raise exception 'Tipo de comparacao invalido (periodo, semana ou mes).' using errcode = '22023';
      end if;
      if p_ate is null then
        raise exception 'Informe a data final.' using errcode = '22023';
      end if;
      v_cod := nullif(btrim(coalesce(p_codigo, '')), '');
      if v_cod is not null and char_length(v_cod) > 30 then
        raise exception 'Codigo de produto invalido.' using errcode = '22023';
      end if;
      select * into v_r from public.bi_calendario_regras r where r.id;
      v_hoje := public.bi_hoje_int();

      if p_tipo = 'periodo' then
        if p_de is null or p_de > p_ate then
          raise exception 'Periodo invalido.' using errcode = '22023';
        end if;
        if p_ate - p_de + 1 > 366 then
          raise exception 'Periodo maior que o maximo permitido (366 dias).' using errcode = '22023';
        end if;
        v_de := p_de;
      end if;
      v_ate := p_ate;
      if v_ate > v_hoje then
        v_ate := v_hoje;
        v_av := v_av || 'fim_ajustado_hoje'::text;
      end if;
      if p_tipo = 'semana' then
        v_de := date_trunc('week', v_ate)::date;
      elsif p_tipo = 'mes' then
        v_de := date_trunc('month', v_ate)::date;
      end if;
      if v_de <= v_ate and v_ate < v_r.data_inicio_operacao then
        return jsonb_build_object('tipo', p_tipo, 'codigo', v_cod, 'comparavel', false, 'motivo', 'periodo_pre_operacao',
                                  'avisos', to_jsonb(v_av), 'atual', null, 'anterior', null, 'variacoes', null,
                                  'dias_pareaveis', 0, 'dias_comparados', 0, 'cobertura', null,
                                  'pares_excluidos', '[]'::jsonb);
      end if;
      if v_de > v_ate then
        return jsonb_build_object('tipo', p_tipo, 'codigo', v_cod, 'comparavel', false, 'motivo', 'periodo_futuro',
                                  'avisos', to_jsonb(v_av), 'atual', null, 'anterior', null, 'variacoes', null,
                                  'dias_pareaveis', 0, 'dias_comparados', 0, 'cobertura', null,
                                  'pares_excluidos', '[]'::jsonb);
      end if;
      v_n := v_ate - v_de + 1;

      with pares as (
        select g::date as a,
               case p_tipo when 'periodo' then g::date - v_n
                           when 'semana' then g::date - 7
                           else (v_de - interval '1 month')::date + (g::date - v_de) end as b
        from generate_series(v_de, v_ate, interval '1 day') g
      ),
      pv as (
        -- mes: o dia sem correspondente no mes anterior (ex.: 31) nao e pareavel
        select pares.* from pares where p_tipo <> 'mes' or pares.b < v_de
      ),
      lim as (select min(pv.b) as b0, max(pv.b) as b1 from pv),
      da as materialized (select x.* from public.bi_dias_int(v_de, v_ate) x),
      db as materialized (select x.* from lim cross join lateral public.bi_dias_int(lim.b0, lim.b1) x where lim.b0 is not null),
      vend as materialized (
        select vv.data, sum(vv.prod) as bruto, sum(vv.liquido) as liq, count(*) as n
        from public.g3_vendas vv
        where vv.fat_estado = 'presente'
          and (vv.data between v_de and v_ate or vv.data between (select b0 from lim) and (select b1 from lim))
        group by vv.data
      ),
      pr as materialized (
        select vv.data, sum(i.quantidade) as q, sum(i.valor) as bruto, count(distinct i.numero) as n
        from public.g3_vendas vv
        join public.g3_venda_itens i on i.numero = vv.numero
        where v_cod is not null and vv.conciliacao = 'conciliada' and i.codigo = v_cod
          and (vv.data between v_de and v_ate or vv.data between (select b0 from lim) and (select b1 from lim))
        group by vv.data
      ),
      j as (
        select pv.a, pv.b,
               case when v_cod is null then da.media_vendas else da.media_itens end as fa,
               case when v_cod is null then db.media_vendas else db.media_itens end as fb,
               case when v_cod is null then da.classe_vendas else da.classe_itens end as ca,
               case when v_cod is null then db.classe_vendas else db.classe_itens end as cb
        from pv
        join da on da.dia = pv.a
        join db on db.dia = pv.b
      ),
      ok as (select j.* from j where j.fa and j.fb),
      sa as (
        select coalesce(sum(vend.bruto), 0) as bruto, coalesce(sum(vend.liq), 0) as liq, coalesce(sum(vend.n), 0) as n,
               coalesce(sum(pr.q), 0) as pq, coalesce(sum(pr.bruto), 0) as pb, coalesce(sum(pr.n), 0) as pn
        from ok left join vend on vend.data = ok.a left join pr on pr.data = ok.a
      ),
      sb as (
        select coalesce(sum(vend.bruto), 0) as bruto, coalesce(sum(vend.liq), 0) as liq, coalesce(sum(vend.n), 0) as n,
               coalesce(sum(pr.q), 0) as pq, coalesce(sum(pr.bruto), 0) as pb, coalesce(sum(pr.n), 0) as pn
        from ok left join vend on vend.data = ok.b left join pr on pr.data = ok.b
      ),
      ct as (
        select (select count(*) from pv) as npar,
               (select count(*) from ok) as ncomp,
               (select bool_or(pv.b < v_r.data_inicio_operacao) from pv) as tem_pre,
               (select min(pv.b) from pv) as b0, (select max(pv.b) from pv) as b1
      ),
      decis as (
        select ct.*,
               ct.ncomp > 0 and ct.ncomp::numeric / nullif(ct.npar, 0) >= v_r.cobertura_minima_comparacao as comparavel
        from ct
      ),
      exc as (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'dia_atual', x.a, 'dia_anterior', x.b,
                 'motivo', case when not x.fa then 'atual_' || x.ca else 'anterior_' || x.cb end) order by x.a), '[]'::jsonb) as lista
        from (select j.* from j where not (j.fa and j.fb) order by j.a limit 400) x
      )
      select jsonb_build_object(
        'tipo', p_tipo,
        'codigo', v_cod,
        'descricao', case when v_cod is not null then
            (select i2.descricao from public.g3_venda_itens i2 join public.g3_vendas v2 on v2.numero = i2.numero
              where i2.codigo = v_cod order by v2.data desc, v2.numero desc limit 1) end,
        'avisos', to_jsonb(v_av
                    || case when decis.comparavel and (
                              (v_cod is null and (sb.bruto = 0 or sb.liq = 0 or sb.n = 0))
                              or (v_cod is not null and (sb.pq = 0 or sb.pb = 0 or sb.pn = 0)))
                            then array['base_zero']::text[] else array[]::text[] end),
        'atual', case when v_cod is null
                      then jsonb_build_object('de', v_de, 'ate', v_ate, 'bruto', sa.bruto, 'liquido', sa.liq, 'vendas', sa.n,
                                              'ticket', round(sa.liq / nullif(sa.n, 0), 2))
                      else jsonb_build_object('de', v_de, 'ate', v_ate, 'quantidade', sa.pq, 'vendas', sa.pn, 'bruto', sa.pb) end,
        'anterior', case when v_cod is null
                      then jsonb_build_object('de', decis.b0, 'ate', decis.b1, 'bruto', sb.bruto, 'liquido', sb.liq, 'vendas', sb.n,
                                              'ticket', round(sb.liq / nullif(sb.n, 0), 2))
                      else jsonb_build_object('de', decis.b0, 'ate', decis.b1, 'quantidade', sb.pq, 'vendas', sb.pn, 'bruto', sb.pb) end,
        'dias_pareaveis', decis.npar,
        'dias_comparados', decis.ncomp,
        'cobertura', round(decis.ncomp::numeric / nullif(decis.npar, 0), 4),
        'cobertura_minima', v_r.cobertura_minima_comparacao,
        'comparavel', coalesce(decis.comparavel, false),
        'motivo', case when coalesce(decis.comparavel, false) then null
                       when decis.npar = 0 then 'sem_dados'
                       when decis.tem_pre then 'periodo_anterior_pre_operacao'
                       when decis.ncomp = 0 then 'sem_dados'
                       else 'cobertura_insuficiente' end,
        'variacoes', case when not coalesce(decis.comparavel, false) then null
                          when v_cod is null then jsonb_build_object(
                            'bruto', round((sa.bruto - sb.bruto) / nullif(sb.bruto, 0), 4),
                            'liquido', round((sa.liq - sb.liq) / nullif(sb.liq, 0), 4),
                            'vendas', round((sa.n - sb.n)::numeric / nullif(sb.n, 0), 4),
                            'ticket', round((round(sa.liq / nullif(sa.n, 0), 2) - round(sb.liq / nullif(sb.n, 0), 2))
                                            / nullif(round(sb.liq / nullif(sb.n, 0), 2), 0), 4))
                          else jsonb_build_object(
                            'quantidade', round((sa.pq - sb.pq) / nullif(sb.pq, 0), 4),
                            'vendas', round((sa.pn - sb.pn)::numeric / nullif(sb.pn, 0), 4),
                            'bruto', round((sa.pb - sb.pb) / nullif(sb.pb, 0), 4)) end,
        'pares_excluidos', exc.lista)
      into v_res
      from decis cross join sa cross join sb cross join exc;

      return v_res;
    end;
    $fn$
  $ddl$;

  -- ============================================================
  -- 4. Seguranca: RLS, policies e privilegios
  -- ============================================================
  execute 'alter table public.bi_calendario_regras enable row level security';
  execute 'alter table public.bi_calendario_excecoes enable row level security';
  execute 'create policy bi_calendario_regras_select on public.bi_calendario_regras for select to authenticated using ((select public.is_admin()))';
  execute 'create policy bi_calendario_excecoes_select on public.bi_calendario_excecoes for select to authenticated using ((select public.is_admin()))';
  execute 'revoke all on public.bi_calendario_regras, public.bi_calendario_excecoes from public, anon, authenticated';
  execute 'grant select on public.bi_calendario_regras, public.bi_calendario_excecoes to authenticated';

  for v_md5 in
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'bi\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', v_md5);
  end loop;

  execute 'grant execute on function public.bi_status() to authenticated';
  execute 'grant execute on function public.bi_calendario(date, date) to authenticated';
  execute 'grant execute on function public.bi_resumo(date, date) to authenticated';
  execute 'grant execute on function public.bi_serie(date, date, text) to authenticated';
  execute 'grant execute on function public.bi_produtos(date, date, text[], text, text, text, integer, integer) to authenticated';
  execute 'grant execute on function public.bi_produto_serie(text[], date, date, text) to authenticated';
  execute 'grant execute on function public.bi_horarios(date, date, smallint[]) to authenticated';
  execute 'grant execute on function public.bi_produtos_horario(date, date, smallint, smallint, text, integer) to authenticated';
  execute 'grant execute on function public.bi_comparar(text, date, date, text) to authenticated';

  -- ============================================================
  -- 5. Conferencia (qualquer diferenca desfaz TUDO: e o mesmo bloco)
  -- ============================================================
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'bi\_%';
  if v_n <> 13 then
    raise exception '0083 abortada na conferencia: esperadas 13 funcoes bi_*, encontradas %.', v_n;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'bi\_%'
                and (p.proconfig is null or not ('search_path=""' = any(p.proconfig))
                     or (p.proname not in ('bi_hoje_int', 'bi_excecao_valida') and not p.prosecdef))) then
    raise exception '0083 abortada na conferencia: funcao bi_* sem search_path vazio ou sem SECURITY DEFINER.';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname like 'bi\_%'
                and (has_function_privilege('anon', p.oid, 'EXECUTE')
                     or has_function_privilege('public', p.oid, 'EXECUTE')
                     or (has_function_privilege('authenticated', p.oid, 'EXECUTE')
                         <> (p.proname in ('bi_status', 'bi_calendario', 'bi_resumo', 'bi_serie', 'bi_produtos',
                                           'bi_produto_serie', 'bi_horarios', 'bi_produtos_horario', 'bi_comparar'))))) then
    raise exception '0083 abortada na conferencia: privilegios de execucao das funcoes bi_* incorretos.';
  end if;

  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname in ('bi_calendario_regras', 'bi_calendario_excecoes')
                and (not c.relrowsecurity
                     or has_table_privilege('anon', c.oid, 'SELECT')
                     or has_table_privilege('authenticated', c.oid, 'INSERT')
                     or has_table_privilege('authenticated', c.oid, 'UPDATE')
                     or has_table_privilege('authenticated', c.oid, 'DELETE')
                     or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
                     or not has_table_privilege('authenticated', c.oid, 'SELECT'))) then
    raise exception '0083 abortada na conferencia: RLS/privilegios das tabelas bi_* incorretos.';
  end if;

  if (select count(*) from pg_policy pol join pg_class c on c.oid = pol.polrelid
       where c.relname in ('bi_calendario_regras', 'bi_calendario_excecoes')) <> 2
     or (select count(*) from public.bi_calendario_regras) <> 1
     or (select count(*) from public.bi_calendario_excecoes) <> 2 then
    raise exception '0083 abortada na conferencia: policies ou carga inicial do calendario incorretas.';
  end if;
end
$migracao$;

-- ============================================================
-- ROLLBACK (manual, so se precisar desfazer; nao toca em nenhum dado do G3):
-- drop function if exists public.bi_comparar(text, date, date, text);
-- drop function if exists public.bi_produtos_horario(date, date, smallint, smallint, text, integer);
-- drop function if exists public.bi_horarios(date, date, smallint[]);
-- drop function if exists public.bi_produto_serie(text[], date, date, text);
-- drop function if exists public.bi_produtos(date, date, text[], text, text, text, integer, integer);
-- drop function if exists public.bi_serie(date, date, text);
-- drop function if exists public.bi_resumo(date, date);
-- drop function if exists public.bi_calendario(date, date);
-- drop function if exists public.bi_status();
-- drop function if exists public.bi_dias_int(date, date);
-- drop function if exists public.bi_periodo_int(date, date, integer);
-- drop function if exists public.bi_hoje_int();
-- drop table if exists public.bi_calendario_excecoes, public.bi_calendario_regras;
-- drop function if exists public.bi_excecao_valida();
