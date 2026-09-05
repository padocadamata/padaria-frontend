-- 0036_producao_classificacoes_tipo_grupo.sql
-- Introduz cadastro estruturado para Tipo e Grupo de Producao
-- (public.receitas.tipo/grupo sao hoje texto livre restrito por um
-- unico CHECK -- receitas_tipo_check IN ('doce','salgada') -- e por um
-- array/options fixos no frontend (GRUPOS_PRODUCAO em
-- ReceitaProducaoForm.js) -- confirmado por auditoria real do banco
-- (information_schema + pg_constraint, colada pelo usuario) e do
-- frontend (busca exaustiva por 'salgada'/'doce'/A/B/C/D em todo o
-- codigo -- unica ocorrencia e o proprio ReceitaProducaoForm.js).
--
-- RASCUNHO EM AUDITORIA -- NAO EXECUTAR ate autorizacao explicita.
-- Numeracao 0036 confirmada livre (ultima migration publicada e
-- 0035_camada_producao_produto_producao.sql). Melhoria SEPARADA da
-- unificacao Catalogo x Producao (ja encerrada e versionada, commit
-- 71f6cff) -- NAO reabre nem altera nada dela.
--
-- ============================================================
-- BASE DA AUDITORIA -- resultado real colado pelo usuario:
-- ============================================================
--   * receitas.tipo: character varying(50), nullable, default null.
--   * receitas.grupo: character varying(10), nullable, default null.
--   * Constraint receitas_tipo_check: CHECK (tipo IN ('doce','salgada')).
--     NAO existe constraint equivalente para grupo (nunca foi
--     encontrada, nem pelo codigo nem pela auditoria de pg_constraint) --
--     grupo e restrito SOMENTE pelo array fixo do frontend ate esta
--     migration.
--   * Valores vivos de tipo: doce=22, salgada=8, null=1 (total 31).
--   * Valores vivos de grupo: A=4, B=4, C=7, D=3, null=13 (total 31).
--   * RLS atual de receitas: SELECT authenticated=true (sem checagem de
--     permissao); INSERT/UPDATE exigem produtos_producao.editar.
--   * Permissoes confirmadas existentes: produtos_producao.visualizar,
--     produtos_producao.editar -- nenhuma nova e criada aqui.
--
-- ============================================================
-- ARQUITETURA -- decisao funcional confirmada pelo usuario
-- ============================================================
--   * public.produtos permanece cadastro mestre; public.receitas
--     permanece extensao operacional de Producao -- NADA disso muda.
--     receitas.tipo/grupo continuam pertencendo a Producao, NUNCA
--     migram para produtos;
--   * receitas.tipo/grupo permanecem varchar(50)/varchar(10), SEM
--     mudanca de tipo de dado, SEM coluna _id nova, SEM backfill de
--     receitas -- os 31 valores existentes continuam literalmente
--     identicos, byte a byte, depois desta migration;
--   * public.producao_tipos / public.producao_grupos (novas): CHAVE
--     NATURAL, sem duplicidade codigo/nome -- a coluna `valor` E o
--     proprio texto que fica gravado em receitas.tipo/grupo (decisao
--     explicita do usuario: "nao quero duplicidade desnecessaria entre
--     codigo e nome"). `valor` e a PRIMARY KEY -- nao ha coluna `id`
--     separada;
--   * Grafia preservada exatamente como esta hoje no banco (doce,
--     salgada, A, B, C, D) -- ZERO normalizacao (nem maiuscula, nem
--     qualquer outra) introduzida por esta migration;
--   * `ativo` controla apenas se a classificacao e OFERECIDA para
--     escolhas NOVAS (tratado no frontend) -- nao afeta a validade da
--     FK: uma receita ja gravada com um valor que depois for inativado
--     continua com FK valida (a FK checa so existencia da linha em
--     producao_tipos/grupos, nunca o campo ativo);
--   * FK com ON UPDATE CASCADE: renomear uma classificacao (UPDATE do
--     proprio valor, que e a PK) propaga atomicamente para toda
--     receitas.tipo/grupo que a use, no mesmo commit -- garantia dada
--     pelo proprio motor do Postgres, sem trigger nem codigo de
--     aplicacao. ON DELETE RESTRICT: nunca usado nesta versao (a UI nao
--     oferece exclusao fisica, e nao existe policy de DELETE nas 2
--     tabelas novas), mas protege o banco mesmo contra uma tentativa
--     manual de DELETE direto;
--   * SEM RPC de exclusao nesta versao -- decisao explicita do usuario
--     (ciclo e somente criar/renomear/ativar/inativar). Se uma exclusao
--     fisica for necessaria no futuro, fica para uma migration
--     separada, quando houver necessidade real.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   * public.producao_tipos (nova) -- valor (PK, varchar(50)), ativo,
--     criado_em, atualizado_em;
--   * public.producao_grupos (nova) -- valor (PK, varchar(10)), ativo,
--     criado_em, atualizado_em;
--   * RLS + policies nas duas tabelas novas -- SELECT aberto a
--     authenticated (mesmo padrao ja usado por receitas), INSERT/UPDATE
--     exigem produtos_producao.editar (mesmo codigo que ja protege
--     INSERT/UPDATE de receitas, migration 0016) -- NENHUM codigo de
--     permissao novo. ZERO policy de DELETE;
--   * seed das 2 tabelas com os 6 valores vivos confirmados, todos
--     ativo=true;
--   * remocao de receitas_tipo_check (substituida pela FK abaixo, que
--     garante a mesma validade e mais: impede digitar um valor que nao
--     exista na tabela de apoio, para tipo E grupo);
--   * 2 FKs novas em receitas (tipo -> producao_tipos.valor, grupo ->
--     producao_grupos.valor), ON UPDATE CASCADE, ON DELETE RESTRICT,
--     nullable (NULL continua permitido para ambos os campos).
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em receitas.id, produtos, catalogo_produto_id,
--     RPCs marcar_produto_producao/desmarcar_produto_producao, nem em
--     qualquer coisa das migrations 0033/0034/0035;
--   * nenhum UPDATE nos 31 valores existentes de receitas.tipo/grupo --
--     os prechecks confirmam isso explicitamente antes de prosseguir;
--   * nenhuma coluna `id`/`nome` separada em producao_tipos/grupos --
--     decisao explicita de nao duplicar codigo/nome nesta versao;
--   * nenhuma RPC de exclusao fisica -- nao e necessaria nesta versao
--     (UI so oferece criar/renomear/ativar/inativar);
--   * nenhuma normalizacao de caixa (upper/lower) em nenhum valor
--     existente ou novo -- fora de escopo, frente separada;
--   * nenhuma alteracao de frontend dentro deste arquivo (fica para os
--     arquivos de componente, fora desta migration).

BEGIN;

do $$
declare
  v_data_type text;
  v_max_len   integer;
  v_nullable  text;
  v_check_def text;
  v_qtd       int;
begin
  -- ============================================================
  -- 1) GUARDA -- receitas.tipo continua varchar(50) nullable.
  -- ============================================================
  select data_type, character_maximum_length, is_nullable
  into v_data_type, v_max_len, v_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'receitas' and column_name = 'tipo';

  if v_data_type is distinct from 'character varying' or v_max_len is distinct from 50 or v_nullable is distinct from 'YES' then
    raise exception 'classificacoes_producao: receitas.tipo mudou desde a auditoria (data_type=%, max_len=%, nullable=%; esperado character varying/50/YES) -- abortando.', v_data_type, v_max_len, v_nullable;
  end if;

  -- ============================================================
  -- 2) GUARDA -- receitas.grupo continua varchar(10) nullable.
  -- ============================================================
  select data_type, character_maximum_length, is_nullable
  into v_data_type, v_max_len, v_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'receitas' and column_name = 'grupo';

  if v_data_type is distinct from 'character varying' or v_max_len is distinct from 10 or v_nullable is distinct from 'YES' then
    raise exception 'classificacoes_producao: receitas.grupo mudou desde a auditoria (data_type=%, max_len=%, nullable=%; esperado character varying/10/YES) -- abortando.', v_data_type, v_max_len, v_nullable;
  end if;

  -- ============================================================
  -- 3) GUARDA -- receitas_tipo_check existe e ainda menciona
  --    exatamente doce/salgada (checagem por conteudo via ILIKE, nao
  --    por igualdade exata de texto -- o Postgres normaliza a
  --    definicao interna de um CHECK IN (...) para a forma
  --    "= ANY (ARRAY[...])", entao comparar string exata seria fragil).
  -- ============================================================
  select pg_get_constraintdef(oid) into v_check_def
  from pg_constraint
  where conrelid = 'public.receitas'::regclass and conname = 'receitas_tipo_check';

  if v_check_def is null then
    raise exception 'classificacoes_producao: constraint receitas_tipo_check nao encontrada -- abortando, schema mudou desde a auditoria.';
  end if;
  if v_check_def not ilike '%doce%' or v_check_def not ilike '%salgada%' then
    raise exception 'classificacoes_producao: receitas_tipo_check nao contem os valores esperados (definicao atual: %) -- abortando.', v_check_def;
  end if;

  -- ============================================================
  -- 4) GUARDA -- nenhum valor vivo de tipo fora de null/doce/salgada.
  -- ============================================================
  select count(*) into v_qtd from public.receitas
  where tipo is not null and tipo not in ('doce', 'salgada');
  if v_qtd <> 0 then
    raise exception 'classificacoes_producao: % receita(s) com tipo fora de doce/salgada -- abortando.', v_qtd;
  end if;

  -- ============================================================
  -- 5) GUARDA -- nenhum valor vivo de grupo fora de null/A/B/C/D.
  -- ============================================================
  select count(*) into v_qtd from public.receitas
  where grupo is not null and grupo not in ('A', 'B', 'C', 'D');
  if v_qtd <> 0 then
    raise exception 'classificacoes_producao: % receita(s) com grupo fora de A/B/C/D -- abortando.', v_qtd;
  end if;

  raise notice 'classificacoes_producao: todas as guardas previas passaram (schema de tipo/grupo inalterado, CHECK confirmado, 31 receitas dentro dos valores esperados). Prosseguindo.';
end $$;


-- ============================================================
-- 6) public.producao_tipos (nova) -- chave natural, sem id/nome
--    separados: `valor` E o proprio texto persistido em receitas.tipo.
-- ============================================================
create table if not exists public.producao_tipos (
  valor        varchar(50) primary key,
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

do $$
begin
  alter table public.producao_tipos
    add constraint producao_tipos_valor_nao_vazio_check
    check (btrim(valor) <> '');
exception
  when duplicate_object then null;
end $$;

comment on table public.producao_tipos is
  'Cadastro estruturado de Tipos de Producao (migration 0036) -- substitui as options fixas (salgada/doce) que existiam hardcoded em ReceitaProducaoForm.js. `valor` E o proprio texto persistido em receitas.tipo (chave natural, sem coluna id/nome separada, por decisao explicita) -- preserva a grafia historica exata. `ativo` controla apenas se a classificacao e oferecida para escolhas NOVAS no frontend -- uma receita ja gravada com um valor inativado continua com FK valida (a FK nao depende de ativo) e deve continuar exibindo esse valor no proprio formulario dela.';

alter table public.producao_tipos enable row level security;

create policy producao_tipos_select on public.producao_tipos
  for select to authenticated using (true);

create policy producao_tipos_insert on public.producao_tipos
  for insert to authenticated
  with check ((select public.has_permissao('produtos_producao.editar')));

create policy producao_tipos_update on public.producao_tipos
  for update to authenticated
  using ((select public.has_permissao('produtos_producao.editar')))
  with check ((select public.has_permissao('produtos_producao.editar')));

-- Zero policy de DELETE, de proposito -- UI nao oferece exclusao fisica
-- nesta versao (ciclo e criar/renomear/ativar/inativar). Sem policy de
-- DELETE, nenhum papel (nem authenticated) pode apagar uma linha via
-- supabase-js, independente do que o frontend tentar.


-- ============================================================
-- 7) public.producao_grupos (nova) -- mesmo desenho de producao_tipos.
-- ============================================================
create table if not exists public.producao_grupos (
  valor        varchar(10) primary key,
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

do $$
begin
  alter table public.producao_grupos
    add constraint producao_grupos_valor_nao_vazio_check
    check (btrim(valor) <> '');
exception
  when duplicate_object then null;
end $$;

comment on table public.producao_grupos is
  'Cadastro estruturado de Grupos de Producao (migration 0036). Mesmo desenho de producao_tipos -- ver comentario la (chave natural em `valor`, sem id/nome separados, ativo so afeta oferta para escolhas novas).';

alter table public.producao_grupos enable row level security;

create policy producao_grupos_select on public.producao_grupos
  for select to authenticated using (true);

create policy producao_grupos_insert on public.producao_grupos
  for insert to authenticated
  with check ((select public.has_permissao('produtos_producao.editar')));

create policy producao_grupos_update on public.producao_grupos
  for update to authenticated
  using ((select public.has_permissao('produtos_producao.editar')))
  with check ((select public.has_permissao('produtos_producao.editar')));

-- Zero policy de DELETE, mesmo raciocinio de producao_tipos.


-- ============================================================
-- 8) Seeds -- os 6 valores vivos confirmados pela auditoria, grafia
--    identica ao que ja esta gravado em receitas hoje, todos ativos.
-- ============================================================
insert into public.producao_tipos (valor) values ('doce'), ('salgada')
on conflict (valor) do nothing;

insert into public.producao_grupos (valor) values ('A'), ('B'), ('C'), ('D')
on conflict (valor) do nothing;


-- ============================================================
-- 9) Remove o CHECK antigo de tipo -- a FK (secao 10) passa a garantir
--    a mesma validade, e tambem passa a valer para grupo (que nunca
--    teve CHECK nenhum ate agora).
-- ============================================================
alter table public.receitas drop constraint receitas_tipo_check;


-- ============================================================
-- 10) FKs -- ON UPDATE CASCADE (renomear a classificacao, isto e, dar
--     UPDATE no proprio `valor` que e a PK, propaga atomicamente para
--     toda receitas.tipo/grupo que a use, no mesmo commit -- garantia
--     do proprio motor do Postgres). ON DELETE RESTRICT (nunca
--     exercido nesta versao -- zero policy de DELETE nas tabelas novas
--     -- mas protege o banco mesmo contra um DELETE manual direto).
--     NULL continua permitido -- FK nao restringe valores NULL.
-- ============================================================
alter table public.receitas
  add constraint receitas_tipo_fkey
  foreign key (tipo) references public.producao_tipos(valor)
  on update cascade
  on delete restrict;

alter table public.receitas
  add constraint receitas_grupo_fkey
  foreign key (grupo) references public.producao_grupos(valor)
  on update cascade
  on delete restrict;


-- ============================================================
-- 11) POS-CONDICOES DURAS -- confirma que nenhum valor de
--     receitas.tipo/grupo mudou (a distribuicao inteira precisa
--     continuar identica a auditoria -- so a garantia por tras trocou
--     de CHECK para FK, nenhum dado foi tocado).
-- ============================================================
do $$
declare
  v_doce int; v_salgada int; v_tipo_null int;
  v_a int; v_b int; v_c int; v_d int; v_grupo_null int;
begin
  select count(*) filter (where tipo = 'doce'),
         count(*) filter (where tipo = 'salgada'),
         count(*) filter (where tipo is null)
  into v_doce, v_salgada, v_tipo_null
  from public.receitas;

  if v_doce <> 22 or v_salgada <> 8 or v_tipo_null <> 1 then
    raise exception 'classificacoes_producao: distribuicao de tipo mudou (doce=%, salgada=%, null=%; esperado 22/8/1) -- abortando.', v_doce, v_salgada, v_tipo_null;
  end if;

  select count(*) filter (where grupo = 'A'),
         count(*) filter (where grupo = 'B'),
         count(*) filter (where grupo = 'C'),
         count(*) filter (where grupo = 'D'),
         count(*) filter (where grupo is null)
  into v_a, v_b, v_c, v_d, v_grupo_null
  from public.receitas;

  if v_a <> 4 or v_b <> 4 or v_c <> 7 or v_d <> 3 or v_grupo_null <> 13 then
    raise exception 'classificacoes_producao: distribuicao de grupo mudou (A=%, B=%, C=%, D=%, null=%; esperado 4/4/7/3/13) -- abortando.', v_a, v_b, v_c, v_d, v_grupo_null;
  end if;

  raise notice 'classificacoes_producao: migration concluida. producao_tipos (doce, salgada) e producao_grupos (A, B, C, D) criadas e populadas. receitas_tipo_check removida, substituida por 2 FKs (ON UPDATE CASCADE, ON DELETE RESTRICT). Distribuicao de tipo/grupo em receitas confirmada INALTERADA (doce=22,salgada=8,null=1 / A=4,B=4,C=7,D=3,null=13).';
end $$;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro para rodar mesmo depois de classificacoes novas terem sido
-- criadas/renomeadas -- ao remover as FKs e as tabelas, receitas.tipo/
-- grupo voltam a ser texto livre sem nenhuma validacao de banco (nem
-- FK nem o CHECK antigo, que NAO e recriado automaticamente por este
-- rollback). Se precisar do CHECK de volta, adicione manualmente:
--   alter table public.receitas add constraint receitas_tipo_check
--     check (tipo in ('doce','salgada'));
-- Isso so funciona se, no momento do rollback, todo valor vivo de tipo
-- ainda estiver em doce/salgada/NULL -- se alguma classificacao nova
-- tiver sido criada e usada (ex.: 'vegana'), esse CHECK falharia e
-- precisaria ser ajustado manualmente antes.
-- BEGIN;
--
--   alter table public.receitas drop constraint if exists receitas_grupo_fkey;
--   alter table public.receitas drop constraint if exists receitas_tipo_fkey;
--
--   drop table if exists public.producao_grupos;
--   drop table if exists public.producao_tipos;
--
-- COMMIT;
