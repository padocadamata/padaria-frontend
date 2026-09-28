-- 0055_funcionarios_escala.sql
-- FOLHA DE PAGAMENTO > ESCALA -- V1, arquitetura por data (NUNCA escala
-- padrao recorrente -- decisao revisada explicitamente pelo usuario apos
-- a primeira auditoria concluir, incorretamente, que a Agenda seria um
-- precedente direto a copiar).
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor.
--
-- ============================================================
-- DECISAO ARQUITETURAL CENTRAL (aprovada pelo usuario, 2a rodada de
-- auditoria)
-- ============================================================
-- A operacao real da Padoca NAO tem dias/horarios fixos por funcionario:
-- horario muda de dia pra dia, folga roda de semana pra semana, um mesmo
-- funcionario pode ter 2+ periodos no mesmo dia (manha e tarde), e
-- freelancers aparecem por 1 unico dia. Por isso a V1 nao tem nenhuma
-- tabela de "regra recorrente" -- cada combinacao funcionario+data e seu
-- proprio registro, independente de qualquer padrao semanal.
--
-- Estrutura pai/filho:
--   funcionarios_escala_dias      -- 1 por funcionario+data: o PLANEJAMENTO
--     (trabalho ou folga). Ausencia de linha = "nao definido" (nunca
--     confundido com folga -- estado distinto, tratado no frontend).
--   funcionarios_escala_periodos  -- 0..N por dia (so quando tipo_dia=
--     trabalho): os periodos de trabalho previstos (entrada/saida). SEM
--     intervalo nesta V1 (fica para o futuro Cartao Ponto).
--   funcionarios_escala_ocorrencias -- 0..1 por dia (so quando tipo_dia=
--     trabalho): falta/atestado. NUNCA substitui o planejamento -- so se
--     ANEXA a ele. Preserva o previsto original mesmo quando o funcionario
--     falta -- essencial para o futuro Cartao Ponto/Folha (previsto x
--     realizado).
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1. public.funcionarios: 1 coluna aditiva nova, tipo_vinculo
--      ('funcionario'|'freelancer', default 'funcionario') -- retrocompa-
--      tivel, todo funcionario existente continua semanticamente
--      "funcionario". Freelancer usa o MESMO cadastro (ja so exige nome
--      hoje -- auditado antes desta migration), nunca uma tabela separada
--      -- preserva um unico funcionario_id para historico futuro.
--   2. public.funcionarios_escala_dias (nova).
--   3. public.funcionarios_escala_periodos (nova).
--   4. public.funcionarios_escala_ocorrencias (nova).
--   5. 2 permissoes novas: escala.visualizar/.editar, concedidas SOMENTE a
--      proprietario_admin nesta rodada (mesmo padrao da 0054) -- qualquer
--      outro perfil pode receber via override individual no Gerenciar
--      Acessos, que ja mostra estas 2 permissoes para qualquer usuario
--      independente do perfil base (arquitetura ja publicada).
--   6. 3 RPCs: aplicar_escala_em_lote (dia/copia/lote -- primitivo unico),
--      registrar_ocorrencia_escala, remover_ocorrencia_escala.
--
-- Esta migration NAO faz, e nao deve fazer (fora de escopo desta V1,
-- decisao explicita do usuario):
--   * nenhuma coluna de intervalo em funcionarios_escala_periodos;
--   * nenhuma tabela de Turno/Ferias/Afastamento/Feriado automatico;
--   * nenhuma recorrencia/template de semana (a V1 e 100% por data --
--     "copiar semana" e uma operacao client-side sobre o mesmo primitivo,
--     nunca uma regra viva no banco);
--   * nenhum bloqueio de edicao de datas passadas, nenhuma tabela de
--     auditoria dedicada (so criado_por/criado_em/atualizado_por/
--     atualizado_em nas tabelas novas);
--   * nenhuma permissao separada para ocorrencia -- escala.editar cobre
--     tudo nesta V1 (decisao aprovada);
--   * nenhuma alteracao em auth.users, public.usuarios, public.perfis,
--     public.agenda_*, Producao, Pedidos, Catalogo, Fornecedores, ou nas
--     demais tabelas de funcionarios (cargos/dependentes/beneficios).
--
-- Envolvida em transacao explicita (BEGIN/COMMIT) -- so DDL padrao,
-- CREATE OR REPLACE FUNCTION e INSERT de catalogo/concessao.

BEGIN;

-- ============================================================
-- 1. public.funcionarios -- coluna aditiva tipo_vinculo
-- ============================================================
-- Auditado antes desta migration: 'nome' e o UNICO campo obrigatorio hoje
-- em funcionarios (banco e frontend) -- um freelancer ja pode ser
-- cadastrado com so o nome, sem nenhuma mudanca de schema. Esta coluna so
-- torna esse vinculo EXPLICITO (para filtros/relatorios futuros e para a
-- futura Folha excluir freelancers de calculos CLT-style), nunca cria uma
-- tabela paralela nem duplica cadastro.
alter table public.funcionarios
  add column if not exists tipo_vinculo text not null default 'funcionario';

do $$
begin
  alter table public.funcionarios
    add constraint funcionarios_tipo_vinculo_valido
    check (tipo_vinculo in ('funcionario', 'freelancer'));
exception
  when duplicate_object then null;
end $$;

comment on column public.funcionarios.tipo_vinculo is
  'Adicionada na migration 0055 (frente Escala). Distingue funcionario CLT-style de freelancer avulso -- MESMA tabela, MESMO funcionario_id (nunca uma tabela separada), preservando historico de dias trabalhados mesmo para quem so aparece 1 dia. Default funcionario preserva a semantica de todo cadastro existente antes desta migration, sem exigir nenhuma migracao de dados.';

-- ============================================================
-- 2. public.funcionarios_escala_dias -- o PLANEJAMENTO (trabalho ou
--    folga) de um funcionario numa data especifica.
-- ============================================================
create table if not exists public.funcionarios_escala_dias (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  data           date not null,
  tipo_dia       text not null,
  observacao     text,

  criado_por     uuid references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em  timestamptz,

  constraint funcionarios_escala_dias_funcionario_data_unico
    unique (funcionario_id, data),

  constraint funcionarios_escala_dias_tipo_valido
    check (tipo_dia in ('trabalho', 'folga'))
);

comment on table public.funcionarios_escala_dias is
  'Planejamento (trabalho ou folga) de UM funcionario em UMA data (migration 0055). Ausencia de linha para um funcionario+data = "nao definido" -- NUNCA confundido com folga, que e sempre uma decisao explicita de planejamento (tipo_dia=folga, linha existe). Arquitetura por data, NAO recorrente -- decisao aprovada: a operacao real varia demais (horario/folga mudam semana a semana, freelancers de 1 dia) para um modelo de regra+excecao fazer sentido. "Copiar semana"/"aplicar em lote" (frontend) so materializam mais linhas iguais a esta via aplicar_escala_em_lote -- nunca uma regra viva reavaliada na leitura. Sem exclusao fisica pela interface para dias PASSADOS por natureza (sao fatos ja ocorridos), mas esta V1 nao impoe bloqueio -- ver aplicar_escala_em_lote (tipo_dia=remover apaga a linha).';

comment on column public.funcionarios_escala_dias.tipo_dia is
  'trabalho: precisa ter 1+ linha em funcionarios_escala_periodos (garantido por aplicar_escala_em_lote, nao por CHECK -- invariante cross-row). folga: NUNCA pode ter periodos nem ocorrencia (garantido pelas triggers de protecao das tabelas filhas).';

create index if not exists funcionarios_escala_dias_data_idx
  on public.funcionarios_escala_dias (data);

-- ------------------------------------------------------------
-- 2a. Trigger: forca criado_por/atualizado_por/atualizado_em (nunca
--     confiados do cliente) -- mesmo padrao de funcionarios_aplicar_
--     invariantes (0054) e agenda_itens_protecao (0038).
-- ------------------------------------------------------------
create or replace function public.funcionarios_escala_dias_auditoria()
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

comment on function public.funcionarios_escala_dias_auditoria() is
  'BEFORE INSERT/UPDATE em funcionarios_escala_dias. INSERT: forca criado_por=auth.uid(), zera atualizado_por/atualizado_em (nunca nasce ja "editado"). UPDATE: forca atualizado_por=auth.uid() e atualizado_em=now(). criado_por/criado_em nunca sao tocados num UPDATE (nao reatribuidos aqui).';

drop trigger if exists funcionarios_escala_dias_auditoria_trigger on public.funcionarios_escala_dias;
create trigger funcionarios_escala_dias_auditoria_trigger
  before insert or update on public.funcionarios_escala_dias
  for each row
  execute function public.funcionarios_escala_dias_auditoria();

-- ============================================================
-- 3. public.funcionarios_escala_periodos -- periodos de trabalho
--    previstos de um dia (filho de funcionarios_escala_dias).
-- ============================================================
create table if not exists public.funcionarios_escala_periodos (
  id            uuid primary key default gen_random_uuid(),
  escala_dia_id uuid not null references public.funcionarios_escala_dias(id) on delete cascade,
  hora_inicio   time not null,
  hora_fim      time not null,
  criado_em     timestamptz not null default now(),

  constraint funcionarios_escala_periodos_horas_coerentes
    check (hora_fim > hora_inicio)
);

comment on table public.funcionarios_escala_periodos is
  'Periodos de trabalho PREVISTOS de um dia (migration 0055) -- 1:N com funcionarios_escala_dias, permite multiplos periodos no mesmo dia (ex.: 06:00-11:00 e 15:00-19:30). SEM intervalo nesta V1 (fica para o futuro Cartao Ponto). Sobreposicao entre periodos do MESMO dia e validada em aplicar_escala_em_lote (2 passes), nao por constraint de banco -- mesma disciplina ja usada no projeto para invariantes cross-row (ex.: producao_registros). Sempre substituidos por DELETE+INSERT dentro da mesma transacao ao salvar um dia -- nunca UPDATE em periodo existente. Sem coluna de ordem -- ordenar por hora_inicio asc e suficiente.';

create index if not exists funcionarios_escala_periodos_escala_dia_id_idx
  on public.funcionarios_escala_periodos (escala_dia_id);

-- Protecao estrutural: um periodo so pode existir num dia tipo_dia=
-- trabalho -- fecha o caminho de INSERT direto (bypass da RPC) via RLS
-- (quem tiver escala.editar poderia inserir period num dia folga sem
-- isso). SECURITY DEFINER necessario para ler funcionarios_escala_dias
-- independente do SELECT do usuario chamador (mesmo motivo de agenda_
-- ocorrencias_protecao, 0038).
create or replace function public.funcionarios_escala_periodos_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo_dia text;
begin
  select tipo_dia into v_tipo_dia
  from public.funcionarios_escala_dias
  where id = new.escala_dia_id;

  if v_tipo_dia is null then
    raise exception 'funcionarios_escala_periodos: escala_dia % nao encontrado.', new.escala_dia_id;
  end if;

  if v_tipo_dia <> 'trabalho' then
    raise exception 'funcionarios_escala_periodos: so pode existir periodo num dia tipo_dia=trabalho (escala_dia %, tipo_dia=%).', new.escala_dia_id, v_tipo_dia;
  end if;

  return new;
end;
$$;

comment on function public.funcionarios_escala_periodos_protecao() is
  'BEFORE INSERT/UPDATE em funcionarios_escala_periodos. Garante, no banco (nao so na RPC), que um periodo so existe vinculado a um dia tipo_dia=trabalho -- fecha o caminho de INSERT direto via RLS que a RPC sozinha nao bloquearia. SECURITY DEFINER: le funcionarios_escala_dias sem depender do SELECT do usuario chamador (mesmo raciocinio de agenda_ocorrencias_protecao, 0038).';

drop trigger if exists funcionarios_escala_periodos_protecao_trigger on public.funcionarios_escala_periodos;
create trigger funcionarios_escala_periodos_protecao_trigger
  before insert or update on public.funcionarios_escala_periodos
  for each row
  execute function public.funcionarios_escala_periodos_protecao();

-- ============================================================
-- 4. public.funcionarios_escala_ocorrencias -- falta/atestado. NUNCA
--    substitui o planejamento -- so se ANEXA a ele.
-- ============================================================
create table if not exists public.funcionarios_escala_ocorrencias (
  id             uuid primary key default gen_random_uuid(),
  escala_dia_id  uuid not null unique references public.funcionarios_escala_dias(id) on delete cascade,
  tipo           text not null,
  observacao     text,

  criado_por     uuid references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em  timestamptz,

  constraint funcionarios_escala_ocorrencias_tipo_valido
    check (tipo in ('falta', 'atestado'))
);

comment on table public.funcionarios_escala_ocorrencias is
  'Falta ou atestado de UM dia (migration 0055) -- no maximo 1 por escala_dia (UNIQUE em escala_dia_id). NUNCA substitui/apaga o planejamento (funcionarios_escala_dias/periodos permanecem intocados) -- a UI monta a tela juntando "PREVISTO" (dias+periodos) com "OCORRENCIA" (esta tabela, se existir). Exige que o dia ja esteja planejado como trabalho (garantido por trigger de protecao) -- registrar_ocorrencia_escala nunca cria planejamento implicitamente. Essencial para o futuro Cartao Ponto/Folha (previsto x realizado nunca se perde por causa de uma falta).';

-- Protecao estrutural: ocorrencia so pode existir num dia tipo_dia=
-- trabalho -- mesmo raciocinio de funcionarios_escala_periodos_protecao.
-- Tambem forca criado_por/atualizado_por/atualizado_em aqui (funde as
-- duas responsabilidades numa unica trigger, para nao duplicar o SELECT
-- em funcionarios_escala_dias).
create or replace function public.funcionarios_escala_ocorrencias_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipo_dia text;
begin
  select tipo_dia into v_tipo_dia
  from public.funcionarios_escala_dias
  where id = new.escala_dia_id;

  if v_tipo_dia is null then
    raise exception 'funcionarios_escala_ocorrencias: escala_dia % nao encontrado.', new.escala_dia_id;
  end if;

  if v_tipo_dia <> 'trabalho' then
    raise exception 'funcionarios_escala_ocorrencias: ocorrencia so pode existir num dia tipo_dia=trabalho (escala_dia %, tipo_dia=%).', new.escala_dia_id, v_tipo_dia;
  end if;

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

comment on function public.funcionarios_escala_ocorrencias_protecao() is
  'BEFORE INSERT/UPDATE em funcionarios_escala_ocorrencias. Garante, no banco, que uma ocorrencia so existe vinculada a um dia tipo_dia=trabalho (mesmo raciocinio de funcionarios_escala_periodos_protecao) e forca criado_por/atualizado_por/atualizado_em. SECURITY DEFINER pelo mesmo motivo da trigger irma.';

drop trigger if exists funcionarios_escala_ocorrencias_protecao_trigger on public.funcionarios_escala_ocorrencias;
create trigger funcionarios_escala_ocorrencias_protecao_trigger
  before insert or update on public.funcionarios_escala_ocorrencias
  for each row
  execute function public.funcionarios_escala_ocorrencias_protecao();

-- ------------------------------------------------------------
-- 4a. Protecao estrutural (CORRECAO da auditoria final pre-execucao):
--     aplicar_escala_em_lote ja bloqueia, na RPC, apagar/tornar folga um
--     dia que tenha ocorrencia -- mas a RLS de funcionarios_escala_dias
--     permite DELETE direto a qualquer usuario com escala.editar, e o ON
--     DELETE CASCADE apagaria a ocorrencia junto, SILENCIOSAMENTE, se
--     alguem apagar a linha do dia sem passar pela RPC (ex.: chamada REST
--     direta). Este trigger fecha essa brecha no banco -- mesma garantia
--     da RPC, agora tambem estrutural, nao so confiada em quem chama.
-- ------------------------------------------------------------
create or replace function public.funcionarios_escala_dias_protecao_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.funcionarios_escala_ocorrencias where escala_dia_id = old.id) then
    raise exception 'funcionarios_escala_dias: nao e possivel remover o dia % -- existe falta/atestado registrado; remova a ocorrencia antes (remover_ocorrencia_escala).', old.id;
  end if;
  return old;
end;
$$;

comment on function public.funcionarios_escala_dias_protecao_delete() is
  'BEFORE DELETE em funcionarios_escala_dias. Bloqueia apagar um dia que ainda tenha uma ocorrencia (falta/atestado) associada -- mesma garantia que aplicar_escala_em_lote ja aplica antes de qualquer DELETE/UPDATE para folga/remover, agora tambem estrutural (cobre DELETE direto via RLS, nao so o caminho da RPC). SECURITY DEFINER: le funcionarios_escala_ocorrencias sem depender do SELECT do usuario chamador, mesmo raciocinio das demais triggers de protecao desta migration.';

drop trigger if exists funcionarios_escala_dias_protecao_delete_trigger on public.funcionarios_escala_dias;
create trigger funcionarios_escala_dias_protecao_delete_trigger
  before delete on public.funcionarios_escala_dias
  for each row
  execute function public.funcionarios_escala_dias_protecao_delete();

-- ============================================================
-- 5. Permissoes novas -- SOMENTE 2 codigos, concedidos SOMENTE a
--    proprietario_admin nesta rodada (mesmo padrao da 0054). Qualquer
--    outro perfil pode receber via override individual no Gerenciar
--    Acessos -- ja mostra estas 2 permissoes para qualquer usuario,
--    independente do perfil base (arquitetura publicada anteriormente).
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('escala.visualizar', 'escala', 'visualizar', 'Ver a escala de trabalho dos funcionarios (visao semanal, mensal, folgas, faltas e atestados).'),
  ('escala.editar',     'escala', 'editar',     'Editar a escala de trabalho dos funcionarios: definir horarios e folgas (individualmente ou em lote/copia), e registrar/remover falta e atestado.')
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil, permissao) values
  ('proprietario_admin', 'escala.visualizar'),
  ('proprietario_admin', 'escala.editar')
on conflict do nothing;

-- ============================================================
-- 6. RLS -- 3 tabelas novas. SELECT por escala.visualizar; INSERT/UPDATE/
--    DELETE por escala.editar (mesmo padrao de agenda_ocorrencias, 0038:
--    DELETE necessario para substituir periodos/remover ocorrencia, e
--    usa a MESMA permissao de edicao, nunca uma permissao de exclusao
--    separada -- decisao aprovada, secao 5).
-- ============================================================

alter table public.funcionarios_escala_dias enable row level security;

drop policy if exists funcionarios_escala_dias_select on public.funcionarios_escala_dias;
create policy funcionarios_escala_dias_select on public.funcionarios_escala_dias
  for select to authenticated
  using ((select public.has_permissao('escala.visualizar')));

drop policy if exists funcionarios_escala_dias_insert on public.funcionarios_escala_dias;
create policy funcionarios_escala_dias_insert on public.funcionarios_escala_dias
  for insert to authenticated
  with check ((select public.has_permissao('escala.editar')));

drop policy if exists funcionarios_escala_dias_update on public.funcionarios_escala_dias;
create policy funcionarios_escala_dias_update on public.funcionarios_escala_dias
  for update to authenticated
  using ((select public.has_permissao('escala.editar')))
  with check ((select public.has_permissao('escala.editar')));

drop policy if exists funcionarios_escala_dias_delete on public.funcionarios_escala_dias;
create policy funcionarios_escala_dias_delete on public.funcionarios_escala_dias
  for delete to authenticated
  using ((select public.has_permissao('escala.editar')));


alter table public.funcionarios_escala_periodos enable row level security;

drop policy if exists funcionarios_escala_periodos_select on public.funcionarios_escala_periodos;
create policy funcionarios_escala_periodos_select on public.funcionarios_escala_periodos
  for select to authenticated
  using ((select public.has_permissao('escala.visualizar')));

drop policy if exists funcionarios_escala_periodos_insert on public.funcionarios_escala_periodos;
create policy funcionarios_escala_periodos_insert on public.funcionarios_escala_periodos
  for insert to authenticated
  with check ((select public.has_permissao('escala.editar')));

drop policy if exists funcionarios_escala_periodos_update on public.funcionarios_escala_periodos;
create policy funcionarios_escala_periodos_update on public.funcionarios_escala_periodos
  for update to authenticated
  using ((select public.has_permissao('escala.editar')))
  with check ((select public.has_permissao('escala.editar')));

drop policy if exists funcionarios_escala_periodos_delete on public.funcionarios_escala_periodos;
create policy funcionarios_escala_periodos_delete on public.funcionarios_escala_periodos
  for delete to authenticated
  using ((select public.has_permissao('escala.editar')));


alter table public.funcionarios_escala_ocorrencias enable row level security;

drop policy if exists funcionarios_escala_ocorrencias_select on public.funcionarios_escala_ocorrencias;
create policy funcionarios_escala_ocorrencias_select on public.funcionarios_escala_ocorrencias
  for select to authenticated
  using ((select public.has_permissao('escala.visualizar')));

drop policy if exists funcionarios_escala_ocorrencias_insert on public.funcionarios_escala_ocorrencias;
create policy funcionarios_escala_ocorrencias_insert on public.funcionarios_escala_ocorrencias
  for insert to authenticated
  with check ((select public.has_permissao('escala.editar')));

drop policy if exists funcionarios_escala_ocorrencias_update on public.funcionarios_escala_ocorrencias;
create policy funcionarios_escala_ocorrencias_update on public.funcionarios_escala_ocorrencias
  for update to authenticated
  using ((select public.has_permissao('escala.editar')))
  with check ((select public.has_permissao('escala.editar')));

drop policy if exists funcionarios_escala_ocorrencias_delete on public.funcionarios_escala_ocorrencias;
create policy funcionarios_escala_ocorrencias_delete on public.funcionarios_escala_ocorrencias
  for delete to authenticated
  using ((select public.has_permissao('escala.editar')));

-- ============================================================
-- 7. RPC aplicar_escala_em_lote -- PRIMITIVO UNICO de escrita da Escala.
--    Atende: salvar 1 dia, salvar varios dias, copiar dia, copiar semana,
--    aplicar horario a varios dias/funcionarios -- tudo e so um array
--    maior/menor da MESMA forma. Validacao completa (passe 1) ANTES de
--    qualquer escrita (passe 2) -- tudo ou nada, mesmo padrao de
--    aplicar_diff_permissoes_usuario (0018).
--
--    Cada item do array: {funcionario_id, data, tipo_dia, periodos?,
--    observacao?}. tipo_dia: 'trabalho' (periodos obrigatorio, 1+),
--    'folga' (periodos deve vir vazio) ou 'remover' (apaga a linha do
--    dia inteiro -- funcionario volta a "nao definido"; periodos deve vir
--    vazio). periodos: [{hora_inicio, hora_fim}, ...].
--
--    SECURITY DEFINER + checagem explicita de escala.editar (nao so RLS):
--    necessario porque a validacao verifica public.funcionarios
--    (funcionarios.visualizar), e nao queremos que um usuario com
--    escala.editar mas sem funcionarios.visualizar tenha esta operacao
--    bloqueada por um SELECT que a RLS de outra tabela rejeitaria --
--    mesmo raciocinio de aplicar_diff_permissoes_usuario (0018), que
--    tambem precisa ler alem do escopo estrito da propria tabela-alvo.
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
  v_item            jsonb;
  v_periodo         jsonb;
  v_periodo_a       jsonb;
  v_periodo_b       jsonb;
  v_funcionario_id  uuid;
  v_data            date;
  v_tipo_dia        text;
  v_observacao      text;
  v_periodos        jsonb;
  v_total_periodos  integer;
  v_total_itens     integer;
  v_total_distintos integer;
  v_hora_inicio     time;
  v_hora_fim        time;
  v_idx_a           integer;
  v_idx_b           integer;
  v_dia_id          uuid;
  v_tem_ocorrencia  boolean;
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

    delete from public.funcionarios_escala_periodos where escala_dia_id = v_dia_id;

    if v_tipo_dia = 'trabalho' then
      insert into public.funcionarios_escala_periodos (escala_dia_id, hora_inicio, hora_fim)
      select v_dia_id, (p->>'hora_inicio')::time, (p->>'hora_fim')::time
      from jsonb_array_elements(v_periodos) as p;
    end if;
  end loop;
end;
$$;

comment on function public.aplicar_escala_em_lote(jsonb) is
  'Primitivo UNICO de escrita da Escala: salva 1..N dias (funcionario+data) atomicamente -- salvar um dia, copiar dia, copiar semana e aplicar horario em lote (varios dias e/ou varios funcionarios) sao todos o MESMO array, so de tamanho diferente, montado no frontend. tipo_dia=trabalho substitui os periodos do dia (DELETE+INSERT); tipo_dia=folga limpa os periodos; tipo_dia=remover apaga a linha do dia inteiro (volta a "nao definido"). Nunca perde falta/atestado silenciosamente: folga/remover sao rejeitados se ja existir ocorrencia para aquele dia. Validacao completa (passe 1: funcionario existe, tipo_dia valido, periodos coerentes e sem sobreposicao dentro do mesmo dia, sem funcionario+data duplicado no array, sem conflito com ocorrencia existente) SEM nenhuma escrita, seguida da aplicacao (passe 2) -- tudo ou nada. SECURITY DEFINER + checagem explicita de escala.editar: necessario porque a validacao consulta public.funcionarios (RLS propria, funcionarios.visualizar) -- um usuario com escala.editar mas sem funcionarios.visualizar nao pode ficar bloqueado por essa checagem cruzada.';

revoke execute on function public.aplicar_escala_em_lote(jsonb) from public;
revoke execute on function public.aplicar_escala_em_lote(jsonb) from anon;
revoke execute on function public.aplicar_escala_em_lote(jsonb) from service_role;
grant execute on function public.aplicar_escala_em_lote(jsonb) to authenticated;

-- ============================================================
-- 8. RPC registrar_ocorrencia_escala -- exige planejamento existente
--    (NUNCA cria implicitamente), e o dia precisa ser tipo_dia=trabalho.
-- ============================================================
create or replace function public.registrar_ocorrencia_escala(
  p_funcionario_id uuid,
  p_data date,
  p_tipo text,
  p_observacao text default null
)
returns public.funcionarios_escala_ocorrencias
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dia public.funcionarios_escala_dias%rowtype;
  v_ocorrencia public.funcionarios_escala_ocorrencias%rowtype;
begin
  if not (select public.has_permissao('escala.editar')) then
    raise exception using errcode = '42501',
      message = 'registrar_ocorrencia_escala: requer a permissao escala.editar.';
  end if;

  if p_tipo is null or p_tipo not in ('falta', 'atestado') then
    raise exception 'registrar_ocorrencia_escala: tipo invalido "%"; use falta ou atestado.', p_tipo;
  end if;

  select * into v_dia
  from public.funcionarios_escala_dias
  where funcionario_id = p_funcionario_id and data = p_data;

  if v_dia.id is null then
    raise exception 'registrar_ocorrencia_escala: nao ha planejamento para % em % -- defina o dia (aplicar_escala_em_lote) antes de registrar uma ocorrencia.', p_funcionario_id, p_data;
  end if;

  if v_dia.tipo_dia <> 'trabalho' then
    raise exception 'registrar_ocorrencia_escala: folga nao aceita falta/atestado (% em %).', p_funcionario_id, p_data;
  end if;

  insert into public.funcionarios_escala_ocorrencias (escala_dia_id, tipo, observacao)
  values (v_dia.id, p_tipo, nullif(btrim(coalesce(p_observacao, '')), ''))
  on conflict (escala_dia_id) do update
    set tipo = excluded.tipo,
        observacao = excluded.observacao
  returning * into v_ocorrencia;

  return v_ocorrencia;
end;
$$;

comment on function public.registrar_ocorrencia_escala(uuid, date, text, text) is
  'Registra (ou corrige, via UPSERT por escala_dia_id) falta/atestado de um funcionario numa data -- NUNCA cria o planejamento do dia implicitamente (exige que funcionarios_escala_dias ja exista e seja tipo_dia=trabalho, senao rejeita com mensagem explicita). Preserva integralmente o planejamento original (dias/periodos intocados) -- a ocorrencia so se ANEXA. SECURITY DEFINER + checagem explicita de escala.editar, mesmo raciocinio de aplicar_escala_em_lote.';

revoke execute on function public.registrar_ocorrencia_escala(uuid, date, text, text) from public;
revoke execute on function public.registrar_ocorrencia_escala(uuid, date, text, text) from anon;
revoke execute on function public.registrar_ocorrencia_escala(uuid, date, text, text) from service_role;
grant execute on function public.registrar_ocorrencia_escala(uuid, date, text, text) to authenticated;

-- ============================================================
-- 9. RPC remover_ocorrencia_escala -- devolve o dia ao previsto puro
--    (planejamento nunca e tocado).
-- ============================================================
create or replace function public.remover_ocorrencia_escala(
  p_funcionario_id uuid,
  p_data date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.has_permissao('escala.editar')) then
    raise exception using errcode = '42501',
      message = 'remover_ocorrencia_escala: requer a permissao escala.editar.';
  end if;

  delete from public.funcionarios_escala_ocorrencias
  where escala_dia_id = (
    select id from public.funcionarios_escala_dias
    where funcionario_id = p_funcionario_id and data = p_data
  );
end;
$$;

comment on function public.remover_ocorrencia_escala(uuid, date) is
  'Remove a falta/atestado (se existir) de um funcionario numa data -- idempotente (nao erra se nao houver ocorrencia). O planejamento (funcionarios_escala_dias/periodos) nunca e tocado -- a tela volta a mostrar so o previsto, sem nenhum badge de ocorrencia. SECURITY DEFINER + checagem explicita de escala.editar, mesmo raciocinio das demais RPCs desta migration.';

revoke execute on function public.remover_ocorrencia_escala(uuid, date) from public;
revoke execute on function public.remover_ocorrencia_escala(uuid, date) from anon;
revoke execute on function public.remover_ocorrencia_escala(uuid, date) from service_role;
grant execute on function public.remover_ocorrencia_escala(uuid, date) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENÇÃO: apaga toda a escala/ocorrências criadas até o momento do
-- rollback -- não há soft-delete que sobreviva a um DROP TABLE. Só use
-- antes de haver dado real relevante. tipo_vinculo é removida por último
-- (drop column), o que também descarta qualquer valor 'freelancer' já
-- gravado -- confirme que não há freelancer real cadastrado antes de
-- rodar isto.
-- BEGIN;
-- revoke execute on function public.remover_ocorrencia_escala(uuid, date) from authenticated;
-- drop function if exists public.remover_ocorrencia_escala(uuid, date);
-- revoke execute on function public.registrar_ocorrencia_escala(uuid, date, text, text) from authenticated;
-- drop function if exists public.registrar_ocorrencia_escala(uuid, date, text, text);
-- revoke execute on function public.aplicar_escala_em_lote(jsonb) from authenticated;
-- drop function if exists public.aplicar_escala_em_lote(jsonb);
-- delete from public.perfil_permissoes where permissao in ('escala.visualizar','escala.editar');
-- delete from public.permissoes where codigo in ('escala.visualizar','escala.editar');
-- drop table if exists public.funcionarios_escala_ocorrencias;
-- drop table if exists public.funcionarios_escala_periodos;
-- drop table if exists public.funcionarios_escala_dias;
-- drop function if exists public.funcionarios_escala_ocorrencias_protecao();
-- drop function if exists public.funcionarios_escala_periodos_protecao();
-- drop function if exists public.funcionarios_escala_dias_protecao_delete();
-- drop function if exists public.funcionarios_escala_dias_auditoria();
-- alter table public.funcionarios drop constraint if exists funcionarios_tipo_vinculo_valido;
-- alter table public.funcionarios drop column if exists tipo_vinculo;
-- COMMIT;
