-- 0078 PREAUDIT -- FOLHA > CARTAO-PONTO
-- SOMENTE LEITURA. Rodar no Supabase SQL Editor ANTES da 0078.
-- Um UNICO resultset: ordem | verificacao | esperado | encontrado | status | observacao.
-- Pode aplicar a 0078 somente se TODAS as linhas tiverem status OK
-- (linhas INFO sao apenas informativas).

with checks (ordem, verificacao, esperado, encontrado, observacao) as (
  -- 1. Nada da 0078 existe ainda -------------------------------------------
  select 1, 'nenhuma relacao/indice/sequencia public.folha_ponto*', '0',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname like 'folha\_ponto%'),
         (select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname like 'folha\_ponto%')
  union all select 2, 'nenhuma funcao public.folha_ponto*', '0',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'folha\_ponto%'),
         (select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'folha\_ponto%')
  union all select 3, 'nenhum trigger folha_ponto*', '0',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname like 'folha\_ponto%'), null
  union all select 4, 'nenhuma policy folha_ponto*', '0',
         (select count(*)::text from pg_policies where policyname like 'folha\_ponto%'), null
  union all select 5, 'nenhuma permissao folha_ponto.*', '0',
         (select count(*)::text from public.permissoes where codigo like 'folha\_ponto.%'), null
  union all select 6, 'nenhum perfil_permissoes folha_ponto.*', '0',
         (select count(*)::text from public.perfil_permissoes where permissao like 'folha\_ponto.%'), null
  union all select 7, 'nenhum usuario_permissoes folha_ponto.*', '0',
         (select count(*)::text from public.usuario_permissoes where permissao like 'folha\_ponto.%'), null
  union all select 8, '0077 aplicada (folha_documentos e folha_documentos_config existem)', 'sim',
         case when to_regclass('public.folha_documentos') is not null and to_regclass('public.folha_documentos_config') is not null
              then 'sim' else 'AUSENTE' end, 'ultima migration esperada antes da 0078'

  -- 2. Funcoes de que a 0078 depende (a 0078 aborta se divergirem) ---------
  union all select 20, 'has_permissao(text) existe e e SECURITY DEFINER', 'sim',
         coalesce((select case when p.prosecdef then 'sim' else 'NAO e definer' end from pg_proc p
                   where p.oid = to_regprocedure('public.has_permissao(text)')), 'AUSENTE'), '0003/0016'
  union all select 21, 'has_permissao considera overrides (usuario_permissoes)', 'sim',
         coalesce((select case when p.prosrc like '%usuario_permissoes%' then 'sim' else 'NAO' end from pg_proc p
                   where p.oid = to_regprocedure('public.has_permissao(text)')), 'AUSENTE'), 'versao da 0016'
  union all select 22, 'folha_hoje() identica a 0066 (fingerprint)', 'a1f96c34e9488c9cd3a6779bd2b18c1e',
         coalesce((select md5(regexp_replace(lower(prosrc), '[[:space:]]+', '', 'g')) from pg_proc
                   where oid = to_regprocedure('public.folha_hoje()') and prorettype = 'date'::regtype), 'AUSENTE'),
         'limite de data futura (America/Sao_Paulo)'
  union all select 23, 'folha_tipo_vinculo_em(uuid,date) identica a 0066 (fingerprint)', 'f84ba99dc1276275ed84ce7b42ee4230',
         coalesce((select md5(regexp_replace(lower(prosrc), '[[:space:]]+', '', 'g')) from pg_proc
                   where oid = to_regprocedure('public.folha_tipo_vinculo_em(uuid,date)')), 'AUSENTE'),
         'vinculo CLT vigente em cada dia'
  union all select 24, 'folha_travar_funcionario(uuid) identica a 0066 (fingerprint)', 'f6d2369f89f0b2dec2a17e4969d469df',
         coalesce((select md5(regexp_replace(lower(prosrc), '[[:space:]]+', '', 'g')) from pg_proc
                   where oid = to_regprocedure('public.folha_travar_funcionario(uuid)')), 'AUSENTE'),
         'mesma trava da Escala e de Pagamentos'
  union all select 25, 'auth.uid() existe', 'sim',
         case when to_regprocedure('auth.uid()') is not null then 'sim' else 'AUSENTE' end, null
  union all select 26, 'auth.users existe', 'sim',
         case when to_regclass('auth.users') is not null then 'sim' else 'AUSENTE' end, null
  union all select 27, 'gen_random_uuid() disponivel', 'sim',
         case when to_regprocedure('gen_random_uuid()') is not null then 'sim' else 'AUSENTE' end, null

  -- 3. Tabelas/colunas lidas pela 0078 -------------------------------------
  union all select 30, 'funcionarios: id, nome, cargo_id, data_admissao, data_demissao, tipo_vinculo, ativo', '7',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'funcionarios'
          and column_name in ('id', 'nome', 'cargo_id', 'data_admissao', 'data_demissao', 'tipo_vinculo', 'ativo')), '0054/0055'
  union all select 31, 'funcionarios.tipo_vinculo aceita funcionario/freelancer/pj', 'sim',
         case when exists (select 1 from pg_constraint where conrelid = 'public.funcionarios'::regclass and contype = 'c'
                           and pg_get_constraintdef(oid) like '%pj%') then 'sim' else 'NAO' end, '0063'
  union all select 32, 'funcionarios_cargos: id, nome', '2',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'funcionarios_cargos'
          and column_name in ('id', 'nome')), '0054'
  union all select 33, 'funcionarios_vinculo_historico: funcionario_id, tipo_vinculo, vigente_desde', '3',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'funcionarios_vinculo_historico'
          and column_name in ('funcionario_id', 'tipo_vinculo', 'vigente_desde')), '0065'
  union all select 34, 'funcionarios_escala_dias: id, funcionario_id, data, tipo_dia, observacao', '5',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'funcionarios_escala_dias'
          and column_name in ('id', 'funcionario_id', 'data', 'tipo_dia', 'observacao')), '0055'
  union all select 35, 'funcionarios_escala_dias: UNIQUE (funcionario_id, data)', 'sim',
         case when exists (select 1 from pg_constraint where conname = 'funcionarios_escala_dias_funcionario_data_unico') then 'sim' else 'AUSENTE' end, '0055'
  union all select 36, 'funcionarios_escala_periodos: escala_dia_id, hora_inicio, hora_fim (time)', '3',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'funcionarios_escala_periodos'
          and ((column_name = 'escala_dia_id') or (column_name in ('hora_inicio', 'hora_fim') and data_type like 'time%'))), '0055'
  union all select 37, 'funcionarios_escala_ocorrencias: escala_dia_id, tipo, observacao', '3',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'funcionarios_escala_ocorrencias'
          and column_name in ('escala_dia_id', 'tipo', 'observacao')), '0055'
  union all select 38, 'feriados_nacionais: data, nome', '2',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'feriados_nacionais'
          and column_name in ('data', 'nome')), '0010'
  union all select 39, 'folha_documentos_config: id, nome_fantasia, razao_social, cnpj, cidade_uf', '5',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'folha_documentos_config'
          and column_name in ('id', 'nome_fantasia', 'razao_social', 'cnpj', 'cidade_uf')), '0077 (empresa no snapshot)'
  union all select 40, 'usuarios: id, nome', '2',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'usuarios'
          and column_name in ('id', 'nome')), 'nome do autor gravado nos registros'
  union all select 41, 'permissoes: codigo, modulo, acao, descricao', '4',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'permissoes'
          and column_name in ('codigo', 'modulo', 'acao', 'descricao')), null
  union all select 42, 'perfil_permissoes e usuario_permissoes existem', 'sim',
         case when to_regclass('public.perfil_permissoes') is not null and to_regclass('public.usuario_permissoes') is not null
              then 'sim' else 'AUSENTE' end, null
  union all select 43, 'perfil proprietario_admin existe', 'sim',
         case when exists (select 1 from public.perfis where nome = 'proprietario_admin') then 'sim' else 'AUSENTE' end, null
  union all select 44, 'roles anon / authenticated / service_role', '3',
         (select count(*)::text from pg_roles where rolname in ('anon', 'authenticated', 'service_role')), null

  -- 4. Qualidade dos dados que o cartao vai ler (informativo) ----------------
  union all select 60, 'INFO periodos da Escala com segundos (cartao trabalha por minuto)', null,
         (select count(*)::text from public.funcionarios_escala_periodos
          where extract(second from hora_inicio) <> 0 or extract(second from hora_fim) <> 0), 'esperado 0; segundos sao ignorados na apuracao'
  union all select 61, 'INFO dias de trabalho da Escala SEM periodo (previsto ficaria 0)', null,
         (select count(*)::text from public.funcionarios_escala_dias d
          where d.tipo_dia = 'trabalho' and not exists (select 1 from public.funcionarios_escala_periodos p where p.escala_dia_id = d.id)), 'esperado 0'
  union all select 62, 'INFO funcionarias CLT (tipo_vinculo atual = funcionario) / ativas', null,
         (select count(*)::text || ' / ' || count(*) filter (where ativo)::text from public.funcionarios where tipo_vinculo = 'funcionario'), null
  union all select 63, 'INFO CLT sem data de admissao (sem limite inferior no cartao)', null,
         (select count(*)::text from public.funcionarios where tipo_vinculo = 'funcionario' and data_admissao is null), null
  union all select 64, 'INFO funcionarios sem nenhuma vigencia de vinculo (usa o cadastro atual)', null,
         (select count(*)::text from public.funcionarios f
          where not exists (select 1 from public.funcionarios_vinculo_historico h where h.funcionario_id = f.id)), 'fallback de folha_tipo_vinculo_em'
  union all select 65, 'INFO ocorrencias da Escala: falta / atestado', null,
         (select count(*) filter (where tipo = 'falta')::text || ' / ' || count(*) filter (where tipo = 'atestado')::text
          from public.funcionarios_escala_ocorrencias), 'aparecem automaticamente no cartao'
  union all select 66, 'INFO feriados cadastrados (feriados_nacionais)', null,
         (select count(*)::text from public.feriados_nacionais), 'F* no cartao'
  union all select 67, 'INFO hoje (folha_hoje) = limite de data futura', null, public.folha_hoje()::text, null
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
