-- 0059_funcionarios_escala_padrao.sql
-- FOLHA DE PAGAMENTO > ESCALA PADRAO POR FUNCIONARIO.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor.
--
-- ============================================================
-- DECISAO ARQUITETURAL CENTRAL (aprovada pelo usuario apos rodada de
-- auditoria + revisao de concorrencia)
-- ============================================================
-- A Escala Padrao e um TEMPLATE semanal por funcionario (Domingo=0 ..
-- Sabado=6, mesma convencao de dia_semana ja usada no projeto para
-- agenda_itens.recorrencia_dias_semana e em lib/funcionarios/escala.js).
-- Ela NUNCA e uma referencia dinamica consultada para calcular a escala
-- operacional -- so serve para MATERIALIZAR dias vazios em
-- funcionarios_escala_dias/periodos (migration 0055), atraves da RPC
-- aplicar_escala_padrao abaixo. Depois de materializado, o dia e um
-- registro operacional comum, indistinguivel de um lancado manualmente --
-- mudar ou excluir o padrao NUNCA altera retroativamente escala ja
-- lancada. NENHUMA tabela de historico/versionamento do padrao existe:
-- so 1 padrao atual por funcionario, sem vigencia -- o historico real
-- continua exclusivamente nas tabelas operacionais ja existentes.
--
-- Sem tabela de "cabecalho" do padrao -- funcionario_id ja e a chave de
-- agrupamento natural (1 padrao por funcionario), uma tabela extra so de
-- nome/vigencia seria estrutura desnecessaria para este escopo.
--
-- ============================================================
-- REVISAO DE CONCORRENCIA (motivo da RPC aplicar_escala_padrao existir)
-- ============================================================
-- Fluxo REJEITADO explicitamente pelo usuario: frontend le quais dias
-- estao vazios -> frontend monta o array ja filtrado -> chama
-- aplicar_escala_em_lote (que faz UPSERT). Entre a leitura e a escrita
-- existe uma janela onde outra transacao pode lancar escala no mesmo
-- funcionario_id+data -- como aplicar_escala_em_lote faz
-- "on conflict (funcionario_id, data) do update", ela SOBRESCREVERIA um
-- lancamento concorrente, violando a regra "Escala Padrao nunca
-- sobrescreve escala existente".
--
-- Solucao adotada: RPC propria (aplicar_escala_padrao), que nunca usa
-- UPDATE em funcionarios_escala_dias -- so
-- "insert ... on conflict (funcionario_id, data) do nothing returning id".
-- Essa e a forma padrao e documentada do Postgres de fazer
-- "insere se nao existir" atomicamente, usando a UNIQUE ja existente
-- (funcionarios_escala_dias_funcionario_data_unico, migration 0055): o
-- proprio indice unico serve de ponto de serializacao entre transacoes
-- concorrentes -- no maximo UMA delas insere de verdade; a(s) outra(s)
-- recebe(m) zero linhas do RETURNING (nunca um erro, nunca um UPDATE) e a
-- RPC classifica esse caso como "ignorado" (dia preservado). Um simples
-- "SELECT ... WHERE NOT EXISTS" seguido de INSERT NAO resolveria isso (2
-- transacoes concorrentes podem ambas passar pelo SELECT antes de
-- qualquer uma commitar o INSERT) -- por isso NAO foi usado.
--
-- Os periodos do padrao so sao inseridos para o funcionario_id+data que a
-- PROPRIA chamada conseguiu inserir (usa o "id" devolvido pelo
-- RETURNING do INSERT que acabou de rodar, nunca um SELECT solto do dia)
-- -- torna estruturalmente impossivel anexar periodos do padrao a um dia
-- operacional preexistente ou inserido por outra transacao.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1. public.funcionarios_escala_padrao_dias (nova).
--   2. public.funcionarios_escala_padrao_periodos (nova).
--   3. RPC salvar_escala_padrao -- salva atomicamente a semana padrao
--      completa (0..7 dias) de UM funcionario, mesma disciplina de
--      validacao (2 passes) de aplicar_escala_em_lote.
--   4. RPC aplicar_escala_padrao -- materializa o padrao na escala
--      operacional para os funcionarios/datas informados, SOMENTE nos
--      dias ainda vazios (ver revisao de concorrencia acima).
--   5. NENHUMA permissao nova -- as 2 RPCs e a RLS das 2 tabelas novas
--      reaproveitam escala.visualizar/escala.editar, ja existentes e ja
--      concedidas (migration 0055). Leitura da aba (aberta na pagina do
--      funcionario) segue o acesso ja existente da pagina/modulo, sem
--      nenhuma alteracao de matriz de permissoes.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma tabela de versionamento/vigencia/historico do padrao;
--   * nenhuma alteracao em funcionarios_escala_dias/periodos/ocorrencias
--     ou nas RPCs aplicar_escala_em_lote/registrar_ocorrencia_escala/
--     remover_ocorrencia_escala (migration 0055) -- permanecem
--     inalteradas para os fluxos ja existentes (Semanal, copiar dia,
--     copiar semana, aplicar em lote, ocorrencias);
--   * nenhuma alteracao em Mensal ou Cobertura -- continuam lendo
--     exclusivamente a escala operacional materializada, nunca as
--     tabelas de padrao;
--   * nenhuma permissao nova, nenhuma alteracao em auth.users,
--     public.usuarios, public.perfis, PIX (0056) ou Beneficios (0057/58).
--
-- Envolvida em transacao explicita (BEGIN/COMMIT) -- so DDL padrao,
-- CREATE OR REPLACE FUNCTION.

BEGIN;

-- ============================================================
-- 1. public.funcionarios_escala_padrao_dias -- o TEMPLATE (trabalho ou
--    folga) de um funcionario num dia da semana.
-- ============================================================
create table if not exists public.funcionarios_escala_padrao_dias (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  dia_semana     smallint not null,
  tipo_dia       text not null,
  observacao     text,

  criado_por     uuid references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em  timestamptz,

  constraint funcionarios_escala_padrao_dias_funcionario_dia_unico
    unique (funcionario_id, dia_semana),

  constraint funcionarios_escala_padrao_dias_dia_semana_valido
    check (dia_semana between 0 and 6),

  constraint funcionarios_escala_padrao_dias_tipo_valido
    check (tipo_dia in ('trabalho', 'folga'))
);

comment on table public.funcionarios_escala_padrao_dias is
  'Template semanal (Escala Padrao, migration 0059) de UM funcionario num dia da semana (0=domingo..6=sabado, mesma convencao de dia_semana ja usada no projeto). Ausencia de linha = "nao configurado" -- NUNCA confundido com folga (mesmo principio ja usado em funcionarios_escala_dias para "nao definido"). NUNCA e lido para calcular a escala operacional diretamente -- so serve de origem para a RPC aplicar_escala_padrao materializar dias vazios em funcionarios_escala_dias. Sem exclusao fisica pela interface fora do proprio ciclo de edicao (tipo_dia=remover em salvar_escala_padrao apaga a linha do dia da semana).';

comment on column public.funcionarios_escala_padrao_dias.tipo_dia is
  'trabalho: precisa ter 1+ linha em funcionarios_escala_padrao_periodos (garantido por salvar_escala_padrao, nao por CHECK -- invariante cross-row, mesmo raciocinio de funcionarios_escala_dias.tipo_dia). folga: NUNCA pode ter periodos (garantido pela trigger de protecao desta migration).';

-- ------------------------------------------------------------
-- 1a. Trigger: forca criado_por/atualizado_por/atualizado_em -- mesmo
--     padrao de funcionarios_escala_dias_auditoria (migration 0055).
-- ------------------------------------------------------------
create or replace function public.funcionarios_escala_padrao_dias_auditoria()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.atualizado_por := null;
    new.atualizado_em := null;
  else
    new.atualizado_por := auth.uid();
    new.atualizado_em := now();
  end if;
  return new;
end;
$$;

comment on function public.funcionarios_escala_padrao_dias_auditoria() is
  'BEFORE INSERT/UPDATE em funcionarios_escala_padrao_dias. Mesmo comportamento de funcionarios_escala_dias_auditoria (migration 0055): INSERT forca criado_por=auth.uid() e zera atualizado_por/atualizado_em; UPDATE forca atualizado_por/atualizado_em. criado_por/criado_em nunca sao tocados num UPDATE.';

drop trigger if exists funcionarios_escala_padrao_dias_auditoria_trigger on public.funcionarios_escala_padrao_dias;
create trigger funcionarios_escala_padrao_dias_auditoria_trigger
  before insert or update on public.funcionarios_escala_padrao_dias
  for each row
  execute function public.funcionarios_escala_padrao_dias_auditoria();

-- ============================================================
-- 2. public.funcionarios_escala_padrao_periodos -- periodos do template
--    (filho de funcionarios_escala_padrao_dias).
-- ============================================================
create table if not exists public.funcionarios_escala_padrao_periodos (
  id            uuid primary key default gen_random_uuid(),
  padrao_dia_id uuid not null references public.funcionarios_escala_padrao_dias(id) on delete cascade,
  hora_inicio   time not null,
  hora_fim      time not null,
  criado_em     timestamptz not null default now(),

  constraint funcionarios_escala_padrao_periodos_horas_coerentes
    check (hora_fim > hora_inicio)
);

comment on table public.funcionarios_escala_padrao_periodos is
  'Periodos de trabalho do TEMPLATE (Escala Padrao, migration 0059) -- 1:N com funcionarios_escala_padrao_dias, mesmo desenho de funcionarios_escala_periodos (0055): multiplos periodos por dia, sem intervalo. Sempre substituidos por DELETE+INSERT dentro da mesma transacao ao salvar o padrao (RPC salvar_escala_padrao) -- nunca UPDATE em periodo existente.';

-- Índice de apoio ao DELETE/lookup por padrao_dia_id (usado por
-- salvar_escala_padrao e pela trigger de protecao abaixo) -- mesmo padrao
-- de funcionarios_escala_periodos_escala_dia_id_idx (migration 0055).
-- PRECISA vir depois do CREATE TABLE acima (a tabela precisa existir).
create index if not exists funcionarios_escala_padrao_periodos_dia_id_idx
  on public.funcionarios_escala_padrao_periodos (padrao_dia_id);

-- ============================================================
-- 2a. Protecao estrutural: um periodo do padrao so pode existir num dia
--     tipo_dia=trabalho -- mesmo raciocinio EXATO de
--     funcionarios_escala_periodos_protecao (migration 0055), so
--     apontando para a tabela de padrao.
-- ============================================================
create or replace function public.funcionarios_escala_padrao_periodos_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo_dia text;
begin
  select tipo_dia into v_tipo_dia
  from public.funcionarios_escala_padrao_dias
  where id = new.padrao_dia_id;

  if v_tipo_dia is null then
    raise exception 'funcionarios_escala_padrao_periodos: padrao_dia % nao encontrado.', new.padrao_dia_id;
  end if;

  if v_tipo_dia <> 'trabalho' then
    raise exception 'funcionarios_escala_padrao_periodos: so pode existir periodo num dia tipo_dia=trabalho (padrao_dia %, tipo_dia=%).', new.padrao_dia_id, v_tipo_dia;
  end if;

  return new;
end;
$$;

comment on function public.funcionarios_escala_padrao_periodos_protecao() is
  'BEFORE INSERT/UPDATE em funcionarios_escala_padrao_periodos. Garante, no banco (nao so na RPC), que um periodo do template so existe vinculado a um dia tipo_dia=trabalho -- mesma garantia estrutural de funcionarios_escala_periodos_protecao (migration 0055). SECURITY DEFINER: le funcionarios_escala_padrao_dias sem depender do SELECT do usuario chamador, mesmo raciocinio das triggers de protecao da 0055.';

drop trigger if exists funcionarios_escala_padrao_periodos_protecao_trigger on public.funcionarios_escala_padrao_periodos;
create trigger funcionarios_escala_padrao_periodos_protecao_trigger
  before insert or update on public.funcionarios_escala_padrao_periodos
  for each row
  execute function public.funcionarios_escala_padrao_periodos_protecao();

-- ============================================================
-- 3. RLS -- 2 tabelas novas. SELECT por escala.visualizar; INSERT/UPDATE/
--    DELETE por escala.editar -- mesmo padrao EXATO das tabelas
--    operacionais (migration 0055), nenhuma permissao nova.
-- ============================================================

alter table public.funcionarios_escala_padrao_dias enable row level security;

drop policy if exists funcionarios_escala_padrao_dias_select on public.funcionarios_escala_padrao_dias;
create policy funcionarios_escala_padrao_dias_select on public.funcionarios_escala_padrao_dias
  for select to authenticated
  using ((select public.has_permissao('escala.visualizar')));

drop policy if exists funcionarios_escala_padrao_dias_insert on public.funcionarios_escala_padrao_dias;
create policy funcionarios_escala_padrao_dias_insert on public.funcionarios_escala_padrao_dias
  for insert to authenticated
  with check ((select public.has_permissao('escala.editar')));

drop policy if exists funcionarios_escala_padrao_dias_update on public.funcionarios_escala_padrao_dias;
create policy funcionarios_escala_padrao_dias_update on public.funcionarios_escala_padrao_dias
  for update to authenticated
  using ((select public.has_permissao('escala.editar')))
  with check ((select public.has_permissao('escala.editar')));

drop policy if exists funcionarios_escala_padrao_dias_delete on public.funcionarios_escala_padrao_dias;
create policy funcionarios_escala_padrao_dias_delete on public.funcionarios_escala_padrao_dias
  for delete to authenticated
  using ((select public.has_permissao('escala.editar')));


alter table public.funcionarios_escala_padrao_periodos enable row level security;

drop policy if exists funcionarios_escala_padrao_periodos_select on public.funcionarios_escala_padrao_periodos;
create policy funcionarios_escala_padrao_periodos_select on public.funcionarios_escala_padrao_periodos
  for select to authenticated
  using ((select public.has_permissao('escala.visualizar')));

drop policy if exists funcionarios_escala_padrao_periodos_insert on public.funcionarios_escala_padrao_periodos;
create policy funcionarios_escala_padrao_periodos_insert on public.funcionarios_escala_padrao_periodos
  for insert to authenticated
  with check ((select public.has_permissao('escala.editar')));

drop policy if exists funcionarios_escala_padrao_periodos_update on public.funcionarios_escala_padrao_periodos;
create policy funcionarios_escala_padrao_periodos_update on public.funcionarios_escala_padrao_periodos
  for update to authenticated
  using ((select public.has_permissao('escala.editar')))
  with check ((select public.has_permissao('escala.editar')));

drop policy if exists funcionarios_escala_padrao_periodos_delete on public.funcionarios_escala_padrao_periodos;
create policy funcionarios_escala_padrao_periodos_delete on public.funcionarios_escala_padrao_periodos
  for delete to authenticated
  using ((select public.has_permissao('escala.editar')));

-- ============================================================
-- 4. RPC salvar_escala_padrao -- salva atomicamente a semana padrao
--    completa (0..7 itens) de UM funcionario. Mesma disciplina 2-passes
--    (validar tudo, so depois escrever) de aplicar_escala_em_lote
--    (migration 0055), mesmo vocabulario tipo_dia
--    (trabalho|folga|remover).
--
--    p_dias: array de {dia_semana, tipo_dia, periodos?}. tipo_dia=
--    'trabalho' (periodos obrigatorio, 1+), 'folga' (periodos vazio) ou
--    'remover' (apaga a linha daquele dia_semana -- volta a "nao
--    configurado"; periodos vazio).
--
--    SECURITY DEFINER + checagem explicita de escala.editar: necessario
--    porque a validacao consulta public.funcionarios (RLS por
--    funcionarios.visualizar) -- mesmo raciocinio exato de
--    aplicar_escala_em_lote (0055): um usuario com escala.editar mas sem
--    funcionarios.visualizar nao pode ficar bloqueado por essa checagem
--    cruzada.
-- ============================================================
create or replace function public.salvar_escala_padrao(
  p_funcionario_id uuid,
  p_dias jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item            jsonb;
  v_periodo         jsonb;
  v_periodo_a       jsonb;
  v_periodo_b       jsonb;
  v_dia_semana      smallint;
  v_tipo_dia        text;
  v_periodos        jsonb;
  v_total_periodos  integer;
  v_total_itens     integer;
  v_total_distintos integer;
  v_hora_inicio     time;
  v_hora_fim        time;
  v_idx_a           integer;
  v_idx_b           integer;
  v_padrao_dia_id   uuid;
begin
  if not (select public.has_permissao('escala.editar')) then
    raise exception using errcode = '42501',
      message = 'salvar_escala_padrao: requer a permissao escala.editar.';
  end if;

  if p_funcionario_id is null then
    raise exception 'salvar_escala_padrao: p_funcionario_id e obrigatorio.';
  end if;

  if not exists (select 1 from public.funcionarios where id = p_funcionario_id) then
    raise exception 'salvar_escala_padrao: funcionario % nao encontrado.', p_funcionario_id;
  end if;

  if p_dias is null or jsonb_typeof(p_dias) <> 'array' then
    raise exception 'salvar_escala_padrao: p_dias precisa ser um array JSON.';
  end if;

  if jsonb_array_length(p_dias) = 0 then
    raise exception 'salvar_escala_padrao: p_dias nao pode ser vazio.';
  end if;

  -- ------------------------------------------------------------
  -- Passe 1 -- validacao completa, SEM nenhuma escrita.
  -- ------------------------------------------------------------
  select count(*), count(distinct (item->>'dia_semana'))
  into v_total_itens, v_total_distintos
  from jsonb_array_elements(p_dias) as item;

  if v_total_itens <> v_total_distintos then
    raise exception 'salvar_escala_padrao: p_dias contem dia_semana duplicado -- cada dia da semana so pode aparecer uma vez por chamada.';
  end if;

  for v_item in select * from jsonb_array_elements(p_dias)
  loop
    v_dia_semana := nullif(v_item->>'dia_semana', '')::smallint;
    v_tipo_dia   := v_item->>'tipo_dia';
    v_periodos   := coalesce(v_item->'periodos', '[]'::jsonb);

    if jsonb_typeof(v_periodos) <> 'array' then
      raise exception 'salvar_escala_padrao: periodos precisa ser um array (dia_semana %).', v_dia_semana;
    end if;

    if v_dia_semana is null or v_dia_semana not between 0 and 6 then
      raise exception 'salvar_escala_padrao: dia_semana invalido: %', v_item;
    end if;

    if v_tipo_dia is null or v_tipo_dia not in ('trabalho', 'folga', 'remover') then
      raise exception 'salvar_escala_padrao: tipo_dia invalido "%" para dia_semana %; use trabalho, folga ou remover.', v_tipo_dia, v_dia_semana;
    end if;

    if v_tipo_dia in ('folga', 'remover') then
      if jsonb_array_length(v_periodos) > 0 then
        raise exception 'salvar_escala_padrao: tipo_dia=% nao aceita periodos (dia_semana %).', v_tipo_dia, v_dia_semana;
      end if;
      continue;
    end if;

    -- tipo_dia = 'trabalho' daqui pra baixo.
    v_total_periodos := jsonb_array_length(v_periodos);
    if v_total_periodos = 0 then
      raise exception 'salvar_escala_padrao: trabalho precisa de pelo menos 1 periodo (dia_semana %).', v_dia_semana;
    end if;

    for v_periodo in select * from jsonb_array_elements(v_periodos)
    loop
      v_hora_inicio := nullif(v_periodo->>'hora_inicio', '')::time;
      v_hora_fim    := nullif(v_periodo->>'hora_fim', '')::time;

      if v_hora_inicio is null or v_hora_fim is null then
        raise exception 'salvar_escala_padrao: periodo sem hora_inicio/hora_fim validos (dia_semana %): %', v_dia_semana, v_periodo;
      end if;

      if v_hora_fim <= v_hora_inicio then
        raise exception 'salvar_escala_padrao: periodo com hora_fim <= hora_inicio (dia_semana %): %', v_dia_semana, v_periodo;
      end if;
    end loop;

    for v_idx_a in 0 .. v_total_periodos - 2 loop
      for v_idx_b in v_idx_a + 1 .. v_total_periodos - 1 loop
        v_periodo_a := v_periodos -> v_idx_a;
        v_periodo_b := v_periodos -> v_idx_b;

        if (v_periodo_a->>'hora_inicio')::time < (v_periodo_b->>'hora_fim')::time
           and (v_periodo_b->>'hora_inicio')::time < (v_periodo_a->>'hora_fim')::time
        then
          raise exception 'salvar_escala_padrao: periodos sobrepostos (dia_semana %): % e %', v_dia_semana, v_periodo_a, v_periodo_b;
        end if;
      end loop;
    end loop;
  end loop;

  -- ------------------------------------------------------------
  -- Passe 2 -- aplicacao. So chega aqui se TODO o array passou no passe 1.
  -- ------------------------------------------------------------
  for v_item in select * from jsonb_array_elements(p_dias)
  loop
    v_dia_semana := (v_item->>'dia_semana')::smallint;
    v_tipo_dia   := v_item->>'tipo_dia';
    v_periodos   := coalesce(v_item->'periodos', '[]'::jsonb);

    if v_tipo_dia = 'remover' then
      delete from public.funcionarios_escala_padrao_dias
      where funcionario_id = p_funcionario_id and dia_semana = v_dia_semana;
      continue;
    end if;

    insert into public.funcionarios_escala_padrao_dias (funcionario_id, dia_semana, tipo_dia)
    values (p_funcionario_id, v_dia_semana, v_tipo_dia)
    on conflict (funcionario_id, dia_semana) do update
      set tipo_dia = excluded.tipo_dia
    returning id into v_padrao_dia_id;

    delete from public.funcionarios_escala_padrao_periodos where padrao_dia_id = v_padrao_dia_id;

    if v_tipo_dia = 'trabalho' then
      insert into public.funcionarios_escala_padrao_periodos (padrao_dia_id, hora_inicio, hora_fim)
      select v_padrao_dia_id, (p->>'hora_inicio')::time, (p->>'hora_fim')::time
      from jsonb_array_elements(v_periodos) as p;
    end if;
  end loop;
end;
$$;

comment on function public.salvar_escala_padrao(uuid, jsonb) is
  'Salva atomicamente a semana padrao completa (0..7 dias) de UM funcionario -- tipo_dia=trabalho substitui os periodos do dia (DELETE+INSERT); tipo_dia=folga limpa os periodos; tipo_dia=remover apaga a linha do dia da semana (volta a "nao configurado"). Validacao completa (passe 1: dia_semana 0-6 sem duplicata no array, tipo_dia valido, periodos coerentes e sem sobreposicao) SEM nenhuma escrita, seguida da aplicacao (passe 2) -- tudo ou nada, mesmo padrao de aplicar_escala_em_lote (migration 0055). SECURITY DEFINER + checagem explicita de escala.editar pelo mesmo motivo daquela RPC.';

revoke execute on function public.salvar_escala_padrao(uuid, jsonb) from public;
revoke execute on function public.salvar_escala_padrao(uuid, jsonb) from anon;
revoke execute on function public.salvar_escala_padrao(uuid, jsonb) from service_role;
grant execute on function public.salvar_escala_padrao(uuid, jsonb) to authenticated;

-- ============================================================
-- 5. RPC aplicar_escala_padrao -- materializa o padrao na escala
--    operacional, SOMENTE nos dias ainda vazios (ver "REVISAO DE
--    CONCORRENCIA" no topo deste arquivo). NUNCA faz UPDATE em
--    funcionarios_escala_dias -- so INSERT ... ON CONFLICT DO NOTHING,
--    atomico por linha via a UNIQUE ja existente (migration 0055).
--
--    Retorna 1 linha por (funcionario_id, data) processado, com
--    situacao em ('preenchido', 'ignorado', 'sem_padrao',
--    'funcionario_inativo') -- suficiente para a UI resumir quantos dias
--    foram preenchidos/ignorados e quais funcionarios nao tem padrao ou
--    estao inativos.
--
--    SECURITY DEFINER + checagem explicita de escala.editar, mesmo
--    raciocinio das demais RPCs desta frente -- le public.funcionarios
--    (funcionarios.visualizar) para filtrar inativos, alem de
--    funcionarios_escala_padrao_dias/periodos e funcionarios_escala_dias/
--    periodos (escala.visualizar/.editar).
-- ============================================================
create or replace function public.aplicar_escala_padrao(
  p_funcionario_ids uuid[],
  p_datas date[]
)
returns table (
  funcionario_id uuid,
  data           date,
  situacao       text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_par           record;
  v_ativo         boolean;
  v_dia_semana    smallint;
  v_padrao_dia_id uuid;
  v_tipo_dia      text;
  v_novo_dia_id   uuid;
begin
  if not (select public.has_permissao('escala.editar')) then
    raise exception using errcode = '42501',
      message = 'aplicar_escala_padrao: requer a permissao escala.editar.';
  end if;

  if p_funcionario_ids is null or array_length(p_funcionario_ids, 1) is null then
    raise exception 'aplicar_escala_padrao: informe pelo menos 1 funcionario.';
  end if;

  if p_datas is null or array_length(p_datas, 1) is null then
    raise exception 'aplicar_escala_padrao: informe pelo menos 1 data.';
  end if;

  for v_par in
    select distinct f.funcionario_id, d.data
    from unnest(p_funcionario_ids) as f(funcionario_id)
    cross join unnest(p_datas) as d(data)
  loop
    select f.ativo into v_ativo
    from public.funcionarios f
    where f.id = v_par.funcionario_id;

    if v_ativo is null or not v_ativo then
      funcionario_id := v_par.funcionario_id;
      data := v_par.data;
      situacao := 'funcionario_inativo';
      return next;
      continue;
    end if;

    v_dia_semana := extract(dow from v_par.data)::smallint;

    select pd.id, pd.tipo_dia
      into v_padrao_dia_id, v_tipo_dia
      from public.funcionarios_escala_padrao_dias pd
      where pd.funcionario_id = v_par.funcionario_id
        and pd.dia_semana = v_dia_semana;

    if v_padrao_dia_id is null then
      funcionario_id := v_par.funcionario_id;
      data := v_par.data;
      situacao := 'sem_padrao';
      return next;
      continue;
    end if;

    -- Materializacao atomica: nunca UPDATE. Se outra transacao concorrente
    -- ja inseriu (ou o dia ja existia de antes), esta instrucao devolve
    -- zero linhas e o dia existente permanece INTOCADO.
    insert into public.funcionarios_escala_dias (funcionario_id, data, tipo_dia)
    values (v_par.funcionario_id, v_par.data, v_tipo_dia)
    on conflict (funcionario_id, data) do nothing
    returning id into v_novo_dia_id;

    if v_novo_dia_id is null then
      funcionario_id := v_par.funcionario_id;
      data := v_par.data;
      situacao := 'ignorado';
      return next;
      continue;
    end if;

    -- Periodos SOMENTE para o dia que ESTA chamada acabou de inserir
    -- (v_novo_dia_id veio do RETURNING da instrucao acima) -- nunca de um
    -- SELECT solto que poderia enxergar um dia de outra transacao.
    if v_tipo_dia = 'trabalho' then
      insert into public.funcionarios_escala_periodos (escala_dia_id, hora_inicio, hora_fim)
      select v_novo_dia_id, pp.hora_inicio, pp.hora_fim
      from public.funcionarios_escala_padrao_periodos pp
      where pp.padrao_dia_id = v_padrao_dia_id;
    end if;

    funcionario_id := v_par.funcionario_id;
    data := v_par.data;
    situacao := 'preenchido';
    return next;
  end loop;

  return;
end;
$$;

comment on function public.aplicar_escala_padrao(uuid[], date[]) is
  'Materializa a Escala Padrao na escala operacional para os funcionarios/datas informados, SOMENTE nos dias ainda "nao definidos" -- nunca sobrescreve um dia ja existente (nunca faz UPDATE em funcionarios_escala_dias). Atomicidade por linha via "insert ... on conflict (funcionario_id, data) do nothing returning id" (usa a UNIQUE ja existente desde a migration 0055) -- uma corrida entre 2 transacoes concorrentes resulta em, no maximo, 1 insercao real; a outra recebe zero linhas e o dia e reportado como "ignorado", nunca sobrescrito. Periodos do padrao so sao inseridos para o dia que a PROPRIA chamada inseriu (via o id do RETURNING), nunca por um SELECT separado. Funcionario inativo ou sem padrao para aquele dia da semana e reportado sem nenhuma escrita. Retorna 1 linha por (funcionario_id, data) com situacao em preenchido/ignorado/sem_padrao/funcionario_inativo, para a UI resumir o resultado. SECURITY DEFINER + checagem explicita de escala.editar, mesmo raciocinio das demais RPCs desta area.';

revoke execute on function public.aplicar_escala_padrao(uuid[], date[]) from public;
revoke execute on function public.aplicar_escala_padrao(uuid[], date[]) from anon;
revoke execute on function public.aplicar_escala_padrao(uuid[], date[]) from service_role;
grant execute on function public.aplicar_escala_padrao(uuid[], date[]) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO: apaga toda a Escala Padrao configurada ate o momento do
-- rollback -- nao ha soft-delete que sobreviva a um DROP TABLE. Nunca
-- afeta a escala OPERACIONAL (funcionarios_escala_dias/periodos/
-- ocorrencias, migration 0055), que permanece intocada. So use antes de
-- haver dado real relevante.
-- BEGIN;
-- revoke execute on function public.aplicar_escala_padrao(uuid[], date[]) from authenticated;
-- drop function if exists public.aplicar_escala_padrao(uuid[], date[]);
-- revoke execute on function public.salvar_escala_padrao(uuid, jsonb) from authenticated;
-- drop function if exists public.salvar_escala_padrao(uuid, jsonb);
-- drop table if exists public.funcionarios_escala_padrao_periodos;
-- drop table if exists public.funcionarios_escala_padrao_dias;
-- drop function if exists public.funcionarios_escala_padrao_periodos_protecao();
-- drop function if exists public.funcionarios_escala_padrao_dias_auditoria();
-- COMMIT;
