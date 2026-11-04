-- 0078 POSTAUDIT -- FOLHA > CARTAO-PONTO
-- SOMENTE LEITURA. Rodar no Supabase SQL Editor DEPOIS da 0078.
-- Um UNICO resultset: ordem | verificacao | esperado | encontrado | status | observacao.
-- Esperado: todas as linhas OK (INFO = informativo). Nenhuma escrita: as
-- unicas funcoes chamadas sao as puras de apuracao (IMMUTABLE, sem efeito,
-- sobre um mes ficticio escrito aqui mesmo -- nenhum dado real e lido) e
-- folha_ponto_alteracao_toca_fechado (STABLE, so leitura, uuid ficticio).

with
tabelas(nome, colunas) as (values
  ('folha_ponto_cartoes', 19), ('folha_ponto_dias', 13), ('folha_ponto_periodos', 5),
  ('folha_ponto_atestados', 21), ('folha_ponto_eventos', 14)),
restricoes(tabela, nome, tipo) as (values
  ('folha_ponto_cartoes', 'folha_ponto_cartoes_pkey', 'p'),
  ('folha_ponto_cartoes', 'folha_ponto_cartoes_funcionario_id_fkey', 'f'),
  ('folha_ponto_cartoes', 'folha_ponto_cartoes_conferido_por_fkey', 'f'),
  ('folha_ponto_cartoes', 'folha_ponto_cartoes_fechado_por_fkey', 'f'),
  ('folha_ponto_cartoes', 'folha_ponto_cartoes_criado_por_fkey', 'f'),
  ('folha_ponto_cartoes', 'folha_ponto_cartoes_atualizado_por_fkey', 'f'),
  ('folha_ponto_cartoes', 'folha_ponto_cartoes_competencia_unica', 'u'),
  ('folha_ponto_cartoes', 'folha_ponto_cartoes_competencia_mes', 'c'),
  ('folha_ponto_cartoes', 'folha_ponto_cartoes_status_valido', 'c'),
  ('folha_ponto_cartoes', 'folha_ponto_cartoes_versao_valida', 'c'),
  ('folha_ponto_cartoes', 'folha_ponto_cartoes_conferencia_coerente', 'c'),
  ('folha_ponto_cartoes', 'folha_ponto_cartoes_estado_coerente', 'c'),
  ('folha_ponto_dias', 'folha_ponto_dias_pkey', 'p'),
  ('folha_ponto_dias', 'folha_ponto_dias_cartao_id_fkey', 'f'),
  ('folha_ponto_dias', 'folha_ponto_dias_criado_por_fkey', 'f'),
  ('folha_ponto_dias', 'folha_ponto_dias_atualizado_por_fkey', 'f'),
  ('folha_ponto_dias', 'folha_ponto_dias_data_unica', 'u'),
  ('folha_ponto_dias', 'folha_ponto_dias_situacao_valida', 'c'),
  ('folha_ponto_dias', 'folha_ponto_dias_origem_valida', 'c'),
  ('folha_ponto_dias', 'folha_ponto_dias_ajuste_coerente', 'c'),
  ('folha_ponto_dias', 'folha_ponto_dias_motivo_valido', 'c'),
  ('folha_ponto_dias', 'folha_ponto_dias_observacao_valida', 'c'),
  ('folha_ponto_periodos', 'folha_ponto_periodos_pkey', 'p'),
  ('folha_ponto_periodos', 'folha_ponto_periodos_dia_id_fkey', 'f'),
  ('folha_ponto_periodos', 'folha_ponto_periodos_entrada_unica', 'u'),
  ('folha_ponto_periodos', 'folha_ponto_periodos_horas_coerentes', 'c'),
  ('folha_ponto_periodos', 'folha_ponto_periodos_minuto_exato', 'c'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_pkey', 'p'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_funcionario_id_fkey', 'f'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_criado_por_fkey', 'f'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_atualizado_por_fkey', 'f'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_cancelado_por_fkey', 'f'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_tipo_valido', 'c'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_abrangencia_valida', 'c'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_periodo_valido', 'c'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_horario_coerente', 'c'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_descricao_valida', 'c'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_status_valido', 'c'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_versao_valida', 'c'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_estado_coerente', 'c'),
  ('folha_ponto_eventos', 'folha_ponto_eventos_pkey', 'p'),
  ('folha_ponto_eventos', 'folha_ponto_eventos_funcionario_id_fkey', 'f'),
  ('folha_ponto_eventos', 'folha_ponto_eventos_cartao_id_fkey', 'f'),
  ('folha_ponto_eventos', 'folha_ponto_eventos_atestado_id_fkey', 'f'),
  ('folha_ponto_eventos', 'folha_ponto_eventos_criado_por_fkey', 'f'),
  ('folha_ponto_eventos', 'folha_ponto_eventos_acao_valida', 'c'),
  ('folha_ponto_eventos', 'folha_ponto_eventos_alvo_coerente', 'c'),
  ('folha_ponto_eventos', 'folha_ponto_eventos_data_coerente', 'c'),
  ('folha_ponto_eventos', 'folha_ponto_eventos_motivo_obrigatorio', 'c')),
indices(nome) as (values
  ('folha_ponto_cartoes_pkey'), ('folha_ponto_cartoes_competencia_unica'), ('folha_ponto_cartoes_competencia_idx'),
  ('folha_ponto_dias_pkey'), ('folha_ponto_dias_data_unica'),
  ('folha_ponto_periodos_pkey'), ('folha_ponto_periodos_entrada_unica'), ('folha_ponto_periodos_dia_idx'),
  ('folha_ponto_atestados_pkey'), ('folha_ponto_atestados_funcionario_idx'),
  ('folha_ponto_eventos_pkey'), ('folha_ponto_eventos_cartao_idx'), ('folha_ponto_eventos_atestado_idx')),
rpcs(assinatura) as (values
  ('public.folha_ponto_cartao_abrir(uuid,date)'),
  ('public.folha_ponto_dias_salvar(uuid,integer,jsonb)'),
  ('public.folha_ponto_atestado_salvar(uuid,integer,uuid,text,text,date,date,text,text,text)'),
  ('public.folha_ponto_atestado_cancelar(uuid,integer,text)'),
  ('public.folha_ponto_cartao_conferir(uuid,integer)'),
  ('public.folha_ponto_cartao_fechar(uuid,integer)'),
  ('public.folha_ponto_cartao_reabrir(uuid,integer,text)'),
  ('public.folha_ponto_base(uuid,date)'),
  ('public.folha_ponto_competencia_resumo(date)')),
internas(assinatura, definer) as (values
  ('public.folha_ponto_falhar(text,text)', false),
  ('public.folha_ponto_minutos(text)', false),
  ('public.folha_ponto_hora_valida(text)', false),
  ('public.folha_ponto_duracao(jsonb,text,text)', false),
  ('public.folha_ponto_lacunas(jsonb,text,text)', false),
  ('public.folha_ponto_categorias(jsonb,jsonb,jsonb)', false),
  ('public.folha_ponto_situacao_escala(jsonb)', false),
  ('public.folha_ponto_apurar_dia(jsonb,jsonb,jsonb,date)', false),
  ('public.folha_ponto_apurar(jsonb)', false),
  ('public.folha_ponto_hash(jsonb)', false),
  ('public.folha_ponto_funcionario_json(uuid)', true),
  ('public.folha_ponto_escala_dia(uuid,date)', true),
  ('public.folha_ponto_lancamento_dia(uuid,date,date)', true),
  ('public.folha_ponto_atestados_json(uuid,date,date)', true),
  ('public.folha_ponto_montar_base(uuid,date)', true),
  ('public.folha_ponto_vinculo_dia(uuid,date)', true),
  ('public.folha_ponto_tem_vinculo(uuid,date)', true),
  ('public.folha_ponto_periodo_fechado(uuid,date,date)', true),
  ('public.folha_ponto_alteracao_toca_fechado(uuid,date,date,date,date,boolean)', true),
  ('public.folha_ponto_invalidar_cartoes(uuid,date,date,text)', true),
  ('public.folha_ponto_bloquear_exclusao_fn()', true),
  ('public.folha_ponto_eventos_guarda_fn()', true),
  ('public.folha_ponto_cartoes_guarda_fn()', true),
  ('public.folha_ponto_dias_guarda_fn()', true),
  ('public.folha_ponto_periodos_guarda_fn()', true),
  ('public.folha_ponto_atestados_guarda_fn()', true)),
gatilhos(tabela, nome, evento) as (values
  ('folha_ponto_cartoes', 'folha_ponto_cartoes_guarda', 'INSERT,UPDATE'),
  ('folha_ponto_cartoes', 'folha_ponto_cartoes_sem_exclusao', 'DELETE'),
  ('folha_ponto_cartoes', 'folha_ponto_cartoes_sem_truncate', 'TRUNCATE'),
  ('folha_ponto_dias', 'folha_ponto_dias_guarda', 'INSERT,UPDATE,DELETE'),
  ('folha_ponto_dias', 'folha_ponto_dias_sem_truncate', 'TRUNCATE'),
  ('folha_ponto_periodos', 'folha_ponto_periodos_guarda', 'INSERT,UPDATE,DELETE'),
  ('folha_ponto_periodos', 'folha_ponto_periodos_sem_truncate', 'TRUNCATE'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_guarda', 'INSERT,UPDATE'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_sem_exclusao', 'DELETE'),
  ('folha_ponto_atestados', 'folha_ponto_atestados_sem_truncate', 'TRUNCATE'),
  ('folha_ponto_eventos', 'folha_ponto_eventos_imutavel', 'UPDATE,DELETE'),
  ('folha_ponto_eventos', 'folha_ponto_eventos_sem_truncate', 'TRUNCATE')),
eventos as (
  select c.relname as tabela, t.tgname as nome, t.tgenabled,
         concat_ws(',',
           case when t.tgtype & 4 <> 0 then 'INSERT' end,
           case when t.tgtype & 16 <> 0 then 'UPDATE' end,
           case when t.tgtype & 8 <> 0 then 'DELETE' end,
           case when t.tgtype & 32 <> 0 then 'TRUNCATE' end) as evento,
         (t.tgtype & 2) <> 0 as before
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal and c.relname like 'folha\_ponto%'),
mes_ficticio(base) as (values (
  '{"versao_base":1,"hoje":"2026-11-20","competencia":"2026-10-01","atestados":[],"funcionario":{"id":"f-1","nome":"Teste","cargo":null,"data_admissao":"2025-01-10","data_demissao":null},"dias":[{"data":"2026-10-05","vinculo":"funcionario","feriado":null,"escala":{"tipo":"trabalho","observacao":null,"periodos":[{"inicio":"06:00","fim":"12:00"}],"ocorrencia":null},"lancamento":{"situacao":null,"motivo":null,"origem":null,"observacao":null,"periodos":[{"entrada":"06:00","saida":"12:30"}]}},{"data":"2026-10-06","vinculo":"funcionario","feriado":null,"escala":{"tipo":"trabalho","observacao":null,"periodos":[{"inicio":"06:00","fim":"12:00"}],"ocorrencia":null},"lancamento":{"situacao":null,"motivo":null,"origem":null,"observacao":null,"periodos":[{"entrada":"06:00","saida":"11:30"}]}},{"data":"2026-10-07","vinculo":"funcionario","feriado":null,"escala":{"tipo":"trabalho","observacao":null,"periodos":[{"inicio":"06:00","fim":"12:00"}],"ocorrencia":{"tipo":"falta","observacao":null}},"lancamento":null},{"data":"2026-10-08","vinculo":"funcionario","feriado":null,"escala":{"tipo":"trabalho","observacao":null,"periodos":[{"inicio":"06:00","fim":"12:00"}],"ocorrencia":{"tipo":"atestado","observacao":null}},"lancamento":null},{"data":"2026-10-09","vinculo":"funcionario","feriado":null,"escala":{"tipo":"folga","observacao":null,"periodos":[],"ocorrencia":null},"lancamento":null},{"data":"2026-10-10","vinculo":"funcionario","feriado":null,"escala":{"tipo":"trabalho","observacao":null,"periodos":[{"inicio":"06:00","fim":"09:00"},{"inicio":"09:15","fim":"12:00"}],"ocorrencia":null},"lancamento":{"situacao":null,"motivo":null,"origem":null,"observacao":null,"periodos":[{"entrada":"06:00","saida":"09:00"},{"entrada":"09:20","saida":"12:00"}]}}]}'::jsonb)),
checks (ordem, verificacao, esperado, encontrado, observacao) as (
  -- 1. Tabelas, colunas, restricoes, indices -----------------------------------
  select 1, 'tabelas folha_ponto_* criadas', '5',
         (select count(*)::text from tabelas t where to_regclass('public.' || t.nome) is not null), null
  union all select 2, 'colunas por tabela conforme a 0078', '5',
         (select count(*)::text from tabelas t
          where (select count(*) from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.nome) = t.colunas),
         (select string_agg(t.nome || '=' || (select count(*) from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.nome), ', ')
          from tabelas t)
  union all select 3, 'restricoes (PK/FK/UNIQUE/CHECK) com nome e tipo', '49',
         (select count(*)::text from restricoes r join pg_constraint k on k.conname = r.nome and k.contype = r.tipo::"char"
          and k.conrelid = to_regclass('public.' || r.tabela)), null
  union all select 4, 'nenhuma restricao extra nas tabelas novas', '49',
         (select count(*)::text from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname like 'folha\_ponto%'), null
  union all select 5, 'indices', '13',
         (select count(*)::text from indices i join pg_indexes x on x.schemaname = 'public' and x.indexname = i.nome), null
  union all select 6, 'competencia unica por funcionaria (funcionario_id, competencia)', 'sim',
         coalesce((select case when pg_get_constraintdef(oid) = 'UNIQUE (funcionario_id, competencia)' then 'sim' else pg_get_constraintdef(oid) end
                   from pg_constraint where conname = 'folha_ponto_cartoes_competencia_unica'), 'AUSENTE'), null
  union all select 7, 'periodos apagados junto com o dia (ON DELETE CASCADE)', '1',
         (select count(*)::text from pg_constraint where conname = 'folha_ponto_periodos_dia_id_fkey' and confdeltype = 'c'), null
  union all select 8, 'cartao/atestado/eventos nunca em cascata (FK sem CASCADE)', '6',
         (select count(*)::text from pg_constraint where conname in ('folha_ponto_cartoes_funcionario_id_fkey', 'folha_ponto_dias_cartao_id_fkey',
            'folha_ponto_atestados_funcionario_id_fkey', 'folha_ponto_eventos_funcionario_id_fkey', 'folha_ponto_eventos_cartao_id_fkey',
            'folha_ponto_eventos_atestado_id_fkey') and confdeltype <> 'c'), null
  union all select 9, 'atestado: sem limite de dias (so fim >= inicio); parcial so num dia, com horario', 'sim',
         case when exists (select 1 from pg_constraint where conname = 'folha_ponto_atestados_periodo_valido'
                           and pg_get_constraintdef(oid) like '%data_fim >= data_inicio%' and pg_get_constraintdef(oid) not like '%89%')
               and exists (select 1 from pg_constraint where conname = 'folha_ponto_atestados_horario_coerente' and pg_get_constraintdef(oid) like '%data_inicio = data_fim%')
              then 'sim' else 'NAO' end, null

  -- 2. Guardas -------------------------------------------------------------------
  union all select 20, 'triggers BEFORE, ativos, com os eventos certos', '12',
         (select count(*)::text from gatilhos g join eventos e on e.tabela = g.tabela and e.nome = g.nome
          where e.evento = g.evento and e.before and e.tgenabled = 'O'), null
  union all select 21, 'nenhum trigger extra nas tabelas novas', '12',
         (select count(*)::text from eventos), null
  union all select 22, 'nenhum trigger folha_ponto* em tabelas existentes (Escala, Pagamentos...)', '0',
         (select count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal and t.tgname like 'folha\_ponto%' and c.relname not like 'folha\_ponto%'), null

  -- 3. Funcoes -------------------------------------------------------------------
  union all select 30, 'funcoes folha_ponto_* (9 RPCs + 26 internas)', '35',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'folha\_ponto%'), null
  union all select 31, 'RPCs existem, SECURITY DEFINER, search_path vazio', '9',
         (select count(*)::text from rpcs r join pg_proc p on p.oid = to_regprocedure(r.assinatura)
          where p.prosecdef and p.proconfig @> array['search_path=""']), null
  union all select 32, 'internas existem, definer conforme desenho, search_path vazio', '26',
         (select count(*)::text from internas i join pg_proc p on p.oid = to_regprocedure(i.assinatura)
          where p.prosecdef = i.definer and p.proconfig @> array['search_path=""']), null
  union all select 33, 'authenticated executa as 9 RPCs', '9',
         (select count(*)::text from rpcs r where has_function_privilege('authenticated', r.assinatura, 'EXECUTE')), null
  union all select 34, 'authenticated NAO executa nenhuma interna', '0',
         (select count(*)::text from internas i where has_function_privilege('authenticated', i.assinatura, 'EXECUTE')), null
  union all select 35, 'anon NAO executa nada folha_ponto_*', '0',
         (select count(*)::text from (select assinatura from rpcs union all select assinatura from internas) x
          where has_function_privilege('anon', x.assinatura, 'EXECUTE')), null
  union all select 36, 'service_role NAO executa nada folha_ponto_* (mesmo padrao da 0077)', '0',
         (select count(*)::text from (select assinatura from rpcs union all select assinatura from internas) x
          where has_function_privilege('service_role', x.assinatura, 'EXECUTE')), 'service_role ignora RLS, mas nao chama as RPCs'
  union all select 37, 'toda RPC confere a propria permissao folha_ponto.*', '9',
         (select count(*)::text from rpcs r join pg_proc p on p.oid = to_regprocedure(r.assinatura)
          where p.prosrc like '%has_permissao(''folha\_ponto.%'), null
  union all select 38, 'RPCs de escrita usam trava por funcionaria + versao esperada', '6',
         (select count(*)::text from rpcs r join pg_proc p on p.oid = to_regprocedure(r.assinatura)
          where p.prosrc like '%folha_travar_funcionario%' and p.prosrc like '%p_versao_esperada is distinct from%'), 'salvar dias, salvar/cancelar atestado, conferir, fechar, reabrir'

  -- 4. RLS e privilegios de tabela -----------------------------------------------
  union all select 50, 'RLS ligada nas 5 tabelas', '5',
         (select count(*)::text from tabelas t join pg_class c on c.oid = to_regclass('public.' || t.nome) where c.relrowsecurity), null
  union all select 51, 'policies: so SELECT, so authenticated, por folha_ponto.visualizar', '5',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename like 'folha\_ponto%'
          and cmd = 'SELECT' and roles = '{authenticated}' and qual like '%folha_ponto.visualizar%'), null
  union all select 52, 'nenhuma policy de escrita', '0',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename like 'folha\_ponto%' and cmd <> 'SELECT'), null
  union all select 53, 'authenticated: SELECT nas 5 tabelas', '5',
         (select count(*)::text from tabelas t where has_table_privilege('authenticated', 'public.' || t.nome, 'SELECT')), null
  union all select 54, 'authenticated: nenhum INSERT/UPDATE/DELETE/TRUNCATE', '0',
         (select count(*)::text from tabelas t, unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) pr
          where has_table_privilege('authenticated', 'public.' || t.nome, pr)), null
  union all select 55, 'anon: nenhum privilegio nas 5 tabelas', '0',
         (select count(*)::text from tabelas t, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) pr
          where has_table_privilege('anon', 'public.' || t.nome, pr)), null

  -- 5. Permissoes ----------------------------------------------------------------
  union all select 60, 'permissoes folha_ponto.* (visualizar, lancar, fechar, reabrir)', '4',
         (select count(*)::text from public.permissoes where codigo in
            ('folha_ponto.visualizar', 'folha_ponto.lancar', 'folha_ponto.fechar', 'folha_ponto.reabrir') and modulo = 'folha_ponto'), null
  union all select 61, 'nenhuma outra permissao folha_ponto.*', '4',
         (select count(*)::text from public.permissoes where codigo like 'folha\_ponto.%'), null
  union all select 62, 'proprietario_admin recebeu as 4', '4',
         (select count(*)::text from public.perfil_permissoes where perfil = 'proprietario_admin' and permissao like 'folha\_ponto.%'), null
  union all select 63, 'nenhum outro perfil recebeu folha_ponto.*', '0',
         (select count(*)::text from public.perfil_permissoes where perfil <> 'proprietario_admin' and permissao like 'folha\_ponto.%'), null
  union all select 64, 'INFO overrides individuais folha_ponto.* (usuario_permissoes)', null,
         (select count(*)::text from public.usuario_permissoes where permissao like 'folha\_ponto.%'), 'esperado 0 logo apos a migration'

  -- 6. Sem dados e sem efeito colateral -------------------------------------------
  union all select 70, 'tabelas novas vazias', '0 0 0 0 0',
         concat_ws(' ', (select count(*) from public.folha_ponto_cartoes), (select count(*) from public.folha_ponto_dias),
                   (select count(*) from public.folha_ponto_periodos), (select count(*) from public.folha_ponto_atestados),
                   (select count(*) from public.folha_ponto_eventos)), null
  union all select 71, 'folha_hoje() continua identica a 0066', 'a1f96c34e9488c9cd3a6779bd2b18c1e',
         (select md5(regexp_replace(lower(prosrc), '[[:space:]]+', '', 'g')) from pg_proc where oid = to_regprocedure('public.folha_hoje()')), null
  union all select 72, 'folha_tipo_vinculo_em continua identica a 0066', 'f84ba99dc1276275ed84ce7b42ee4230',
         (select md5(regexp_replace(lower(prosrc), '[[:space:]]+', '', 'g')) from pg_proc where oid = to_regprocedure('public.folha_tipo_vinculo_em(uuid,date)')), null
  union all select 73, 'folha_travar_funcionario continua identica a 0066', 'f6d2369f89f0b2dec2a17e4969d469df',
         (select md5(regexp_replace(lower(prosrc), '[[:space:]]+', '', 'g')) from pg_proc where oid = to_regprocedure('public.folha_travar_funcionario(uuid)')), null
  union all select 74, 'nenhuma funcao da 0078 referencia Pagamentos/lancamentos financeiros', '0',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'folha\_ponto%'
            and (p.prosrc like '%folha_pagamentos%' or p.prosrc like '%folha_lancamentos%' or p.prosrc like '%valor_hora%')), 'cartao = so tempo, nunca R$'

  -- 7. Apuracao (funcoes puras, mes ficticio) -------------------------------------
  union all select 80, 'minutos: 06:30 = 390; 6:30 invalido; 23:59 valido; 24:00 invalido', '390 false true false',
         concat_ws(' ', public.folha_ponto_minutos('06:30')::text, public.folha_ponto_hora_valida('6:30')::text,
                   public.folha_ponto_hora_valida('23:59')::text, public.folha_ponto_hora_valida('24:00')::text), null
  union all select 81, 'totais do mes ficticio (+30 e -30 em dias diferentes NAO se compensam)', 'sim',
         (select case when (public.folha_ponto_apurar(base) -> 'totais') = '{"previsto_min":1785,"trabalhado_min":1060,"trabalhado_no_previsto_min":1030,"trabalhado_fora_previsto_min":30,"intervalo_min":20,"atestado_min":360,"previsto_nao_coberto_min":395,"extra_min":30,"faltante_min":395,"faltas_qtd":1,"atestados_integrais_qtd":1,"dias_trabalhados":3,"dias_pendentes":0}'::jsonb
                      then 'sim' else (public.folha_ponto_apurar(base) -> 'totais')::text end from mes_ficticio), 'mesmo resultado de lib/ponto/apuracao.js'
  union all select 82, 'atestado parcial sobreposto ao trabalho nao conta duas vezes (trabalho 06-10, atestado 09-11)', '240 60 60',
         (select concat_ws(' ', d ->> 'trabalhado_min', d ->> 'atestado_min', d ->> 'faltante_min')
          from (select public.folha_ponto_apurar_dia('{"data":"2026-10-05","vinculo":"funcionario","escala":{"tipo":"trabalho","periodos":[{"inicio":"06:00","fim":"12:00"}],"ocorrencia":null},"lancamento":{"situacao":null,"periodos":[{"entrada":"06:00","saida":"10:00"}]}}'::jsonb, '{}'::jsonb, '[{"abrangencia":"parcial","data_inicio":"2026-10-05","data_fim":"2026-10-05","hora_inicio":"09:00","hora_fim":"11:00"}]'::jsonb, date '2026-11-20') as d) x), null
  union all select 83, 'atestado parcial + trabalho fora do previsto (atestado 06-10, trabalho 10-14): atestado 4h, extra 2h', '240 120 120 0',
         (select concat_ws(' ', d ->> 'atestado_min', d ->> 'trabalhado_no_previsto_min', d ->> 'extra_min', d ->> 'faltante_min')
          from (select public.folha_ponto_apurar_dia('{"data":"2026-10-05","vinculo":"funcionario","escala":{"tipo":"trabalho","periodos":[{"inicio":"06:00","fim":"12:00"}],"ocorrencia":null},"lancamento":{"situacao":null,"periodos":[{"entrada":"10:00","saida":"14:00"}]}}'::jsonb, '{}'::jsonb, '[{"abrangencia":"parcial","data_inicio":"2026-10-05","data_fim":"2026-10-05","hora_inicio":"06:00","hora_fim":"10:00"}]'::jsonb, date '2026-11-20') as d) x), null
  union all select 84, 'Falta da Escala coberta por atestado integral de varios dias vira Atestado (origem preservada)', 'falta atestado 360 0',
         (select concat_ws(' ', d ->> 'situacao_escala', d ->> 'situacao', d ->> 'atestado_min', d ->> 'faltante_min')
          from (select public.folha_ponto_apurar_dia('{"data":"2026-10-11","vinculo":"funcionario","escala":{"tipo":"trabalho","periodos":[{"inicio":"06:00","fim":"12:00"}],"ocorrencia":{"tipo":"falta"}},"lancamento":null}'::jsonb, '{}'::jsonb, '[{"abrangencia":"integral","data_inicio":"2026-10-10","data_fim":"2026-10-12"}]'::jsonb, date '2026-11-20') as d) x), null
  union all select 85, 'dia sem Escala = pendencia (nunca folga); dia futuro nao apurado', '["sem_escala"] true',
         (select concat_ws(' ',
                   (public.folha_ponto_apurar_dia('{"data":"2026-10-05","vinculo":"funcionario","escala":null,"lancamento":null}'::jsonb,
                                                  '{}'::jsonb, '[]'::jsonb, date '2026-11-20') -> 'pendencias')::text,
                   (public.folha_ponto_apurar_dia('{"data":"2026-11-21","vinculo":"funcionario","escala":null,"lancamento":null}'::jsonb,
                                                  '{}'::jsonb, '[]'::jsonb, date '2026-11-20') ->> 'futuro'))), null
  union all select 86, 'descricao do atestado opcional (coluna aceita NULL; vazio proibido)', 'YES sim',
         concat_ws(' ', (select is_nullable from information_schema.columns
                         where table_schema = 'public' and table_name = 'folha_ponto_atestados' and column_name = 'descricao'),
                   (select case when pg_get_constraintdef(oid) like '%descricao IS NULL%' then 'sim' else 'NAO' end
                    from pg_constraint where conname = 'folha_ponto_atestados_descricao_valida')), null
  union all select 87, 'atestado longo: so a ponta alterada conta (sem cartao fechado nenhum = false)', 'false false',
         concat_ws(' ', public.folha_ponto_alteracao_toca_fechado('00000000-0000-0000-0000-000000000000', date '2026-09-01', date '2027-03-19',
                                                                   date '2026-09-01', date '2027-01-15', true)::text,
                   public.folha_ponto_alteracao_toca_fechado('00000000-0000-0000-0000-000000000000', date '2026-09-01', date '2027-03-19',
                                                             date '2026-09-01', date '2027-03-19', false)::text), 'uuid ficticio: nenhum dado real'
  union all select 88, 'apuracao: entrada 06:30 e saida 12:30 (previsto 06-12) = saldo zero com desvios 30/30', '30 30 0 0',
         (select concat_ws(' ', d ->> 'trabalhado_fora_previsto_min', d ->> 'previsto_nao_coberto_min', d ->> 'extra_min', d ->> 'faltante_min')
          from (select public.folha_ponto_apurar_dia('{"data":"2026-10-05","vinculo":"funcionario","escala":{"tipo":"trabalho","periodos":[{"inicio":"06:00","fim":"12:00"}],"ocorrencia":null},"lancamento":{"situacao":null,"periodos":[{"entrada":"06:30","saida":"12:30"}]}}'::jsonb, '{}'::jsonb, '[]'::jsonb, date '2026-11-20') as d) x), null
  union all select 89, 'atestado depois do desligamento: dia fora do vinculo, sem previsto/atestado/faltante', 'fora_vinculo apos_desligamento - - - -',
         (select concat_ws(' ', d ->> 'situacao', d ->> 'fora_vinculo', coalesce(d ->> 'atestado_cobertura', '-'), coalesce(d ->> 'previsto_min', '-'),
                           coalesce(d ->> 'atestado_min', '-'), coalesce(d ->> 'faltante_min', '-'))
          from (select public.folha_ponto_apurar_dia('{"data":"2026-10-21","vinculo":"funcionario","escala":{"tipo":"trabalho","periodos":[{"inicio":"06:00","fim":"12:00"}],"ocorrencia":null},"lancamento":null}'::jsonb, '{"data_admissao":"2025-01-10","data_demissao":"2026-10-20"}'::jsonb, '[{"abrangencia":"integral","data_inicio":"2026-10-15","data_fim":"2026-12-31"}]'::jsonb, date '2026-11-20') as d) x), null
  union all select 90, 'INFO hoje (folha_hoje) = limite de data futura', null, public.folha_hoje()::text, null
)
select ordem,
       verificacao,
       esperado,
       encontrado,
       case when esperado is null then 'INFO'
            when encontrado is not distinct from esperado then 'OK'
            else 'FALHA' end as status,
       observacao
from checks
order by ordem;
