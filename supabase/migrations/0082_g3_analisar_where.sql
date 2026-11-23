-- 0082_g3_analisar_where.sql
-- Correcao da Central de Importacoes do G3ERP (0081): a previa falhava pelo
-- app com "UPDATE requires a WHERE clause".
--
-- CAUSA: no Supabase, as conexoes da API (papel authenticator, usado pelo
-- app) carregam a extensao pg_safeupdate, que recusa UPDATE/DELETE sem WHERE
-- -- inclusive dentro de funcoes. Em public.g3_analisar (0081), a
-- classificacao das linhas fazia "update pg_temp.g3_l set tipo = case ...
-- end;" sem WHERE. No SQL Editor (papel postgres) e nos testes (PGlite) a
-- extensao nao esta carregada, por isso o defeito so apareceu no app.
--
-- CORRECAO: recria SOMENTE public.g3_analisar(uuid), com o corpo IDENTICO ao
-- da 0081 exceto por uma linha: o UPDATE ganha "where tipo is null". O
-- resultado e o mesmo: nesse ponto a tabela temporaria g3_l acabou de ser
-- criada e TODAS as linhas tem tipo nulo.
--
-- PRESERVA: CREATE OR REPLACE mantem dono, privilegios (ACL) e dependencias;
-- a definicao mantem SECURITY DEFINER, VOLATILE, plpgsql e search_path = ''.
-- Nada mais muda: nenhuma tabela, policy, grant, gatilho, RPC ou dado. A
-- 0081 continua imutavel e NAO deve ser reexecutada.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Aplicar manualmente no SQL Editor, depois do
-- PREAUDIT (0082_pre_auditoria_g3_analisar_where_EXECUTAR.sql); conferir com o
-- POSTAUDIT (0082_pos_auditoria_g3_analisar_where_EXECUTAR.sql).
--
-- GUARDAS (transacional, BEGIN/COMMIT): aborta sem alterar nada se a 0081
-- nao estiver aplicada, se a funcao atual nao for EXATAMENTE a da 0081
-- (md5 do corpo, sem CR) ou se a 0082 ja tiver sido aplicada. Depois da
-- troca, confere corpo, SECURITY DEFINER, search_path, dono e privilegios;
-- qualquer diferenca desfaz tudo.

BEGIN;

-- ============================================================
-- 0. Guarda de ambiente
-- ============================================================
DO $$
declare
  v_md5 text;
begin
  if to_regprocedure('public.g3_analisar(uuid)') is null
     or to_regprocedure('public.g3_gerar_previa(uuid)') is null
     or to_regclass('public.g3_importacoes') is null then
    raise exception '0082 abortada: a 0081 (Central de Importacoes G3) nao esta aplicada.';
  end if;

  select md5(replace(p.prosrc, chr(13), '')) into v_md5
  from pg_proc p where p.oid = to_regprocedure('public.g3_analisar(uuid)');

  if v_md5 = '05e3f84a8e1ebbd2545e3f6a2edd1a04' then
    raise exception '0082 abortada: ja aplicada (g3_analisar ja tem o filtro). Nada foi alterado.';
  end if;
  if v_md5 is distinct from 'cede04b9168f569076dd6c74b9eb3102' then
    raise exception '0082 abortada: g3_analisar difere da versao da 0081 (md5 %). Nada foi alterado.', v_md5;
  end if;
end $$;

-- Retrato do que precisa ficar igual (dono, privilegios, atributos).
create temp table g3_0082_antes on commit drop as
  select p.proowner, p.proacl, p.prosecdef, p.provolatile, p.prolang, p.proconfig, p.prorettype, p.proargtypes
  from pg_proc p where p.oid = to_regprocedure('public.g3_analisar(uuid)');

-- ============================================================
-- 1. public.g3_analisar: identica a 0081 + "where tipo is null"
-- ============================================================
create or replace function public.g3_analisar(p_lote uuid)
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
      end
     where tipo is null;
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
-- 2. Conferencia (qualquer diferenca desfaz a transacao inteira)
-- ============================================================
DO $$
declare
  v_ok boolean;
begin
  select (md5(replace(p.prosrc, chr(13), '')) = '05e3f84a8e1ebbd2545e3f6a2edd1a04')
         and p.proowner = a.proowner
         and p.proacl is not distinct from a.proacl
         and p.prosecdef and a.prosecdef
         and p.provolatile = a.provolatile
         and p.prolang = a.prolang
         and p.proconfig is not distinct from a.proconfig
         and p.proconfig = array['search_path=""']
         and p.prorettype = a.prorettype
         and p.proargtypes = a.proargtypes
    into v_ok
  from pg_proc p cross join pg_temp.g3_0082_antes a
  where p.oid = to_regprocedure('public.g3_analisar(uuid)');

  if v_ok is distinct from true then
    raise exception '0082 abortada na conferencia: g3_analisar ficou diferente do esperado. Nada foi alterado.';
  end if;
  if has_function_privilege('anon', 'public.g3_analisar(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.g3_analisar(uuid)', 'EXECUTE') then
    raise exception '0082 abortada na conferencia: anon/authenticated nao podem executar g3_analisar.';
  end if;
end $$;

COMMIT;

-- ============================================================
-- ROLLBACK: nao ha o que desfazer em dados (a 0082 so troca o corpo de uma
-- funcao interna). Voltar ao corpo da 0081 reintroduziria o erro na previa;
-- se for mesmo preciso, recriar a funcao com o bloco "create function
-- public.g3_analisar" da 0081 trocando "create" por "create or replace".
-- ============================================================
