-- 0010_producao_registros.sql
-- Fundação estrutural do novo módulo de Produção da Padoca da Mata.
-- Cria 4 tabelas novas: producao_registros, producao_dias,
-- planejamento_producao, feriados_nacionais.
--
-- NÃO EXECUTADA AUTOMATICAMENTE. Este arquivo é uma PROPOSTA de migration.
-- Rode manualmente no Supabase SQL Editor (ou via `supabase db push` se o CLI
-- for adotado depois).
--
-- Pré-requisitos reais (dependências de SQL, não só de ordem cronológica):
--   * 0001_perfis_e_permissoes.sql — catálogo de permissões (usa
--     producao.visualizar/inserir/editar/cancelar, já seedados) e perfis.
--   * 0002_adaptar_usuarios.sql / 0002b — tabela public.usuarios, consultada
--     por is_admin()/has_permissao().
--   * 0003_funcoes_autorizacao.sql — public.is_admin() e
--     public.has_permissao(text), chamadas nas policies de RLS e dentro da
--     trigger de proteção abaixo.
--   * public.receitas já deve existir (existe hoje, 45 registros) — usada
--     como FK de receita_id em producao_registros e planejamento_producao.
-- 0004 (logs_auditoria) e 0005b (RLS das outras 8 tabelas) são relacionadas
-- em contexto, mas não são dependência de SQL desta migration — nenhum
-- objeto criado por elas é referenciado aqui.
--
-- ESCOPO — SOMENTE ESTRUTURAL. Esta migration NÃO faz:
--   * importação histórica da planilha Vendas_Sobras;
--   * limpeza das 8 receitas duplicadas/corrompidas em public.receitas;
--   * qualquer alteração ou remoção em public.producao_diaria (permanece
--     intocada, vazia, grão diário — não é usada como destino do novo
--     módulo, que tem grão data+turno+receita_id);
--   * seed do calendário de feriados_nacionais — só a estrutura da tabela
--     é criada aqui, sem nenhuma linha;
--   * código de frontend;
--   * algoritmo de sugestão de produção;
--   * qualquer INSERT de dado real.
-- Nenhuma linha é inserida por esta migration em nenhuma tabela.
--
-- Envolvida em transação explícita (BEGIN/COMMIT) — só DDL padrão, sem
-- CREATE INDEX CONCURRENTLY nem VACUUM, então é seguro rodar dentro de uma
-- transação única.
--
-- Reversível: ver bloco ROLLBACK ao final. Como as 4 tabelas são criadas do
-- zero por esta própria migration e nenhuma etapa posterior de importação
-- rodou ainda, o rollback (DROP) não tem risco de perda de dados de negócio.

BEGIN;

-- ============================================================
-- 1. public.producao_registros
-- ============================================================
-- Grão: data + turno + receita_id. Registro de produção/venda/sobra por
-- turno, independente de public.producao_diaria (grão diário, permanece
-- intocada e vazia).

create table if not exists public.producao_registros (
  id                    uuid primary key default gen_random_uuid(),
  data                  date not null,
  turno                 text not null,
  receita_id            uuid not null references public.receitas(id),
  origem                text not null default 'manual',
  status                text not null default 'aberto',
  quantidade_produzida  integer not null,
  quantidade_vendida    integer,
  sobra_total           integer,
  sobra_aproveitavel    integer,
  perda_descarte        integer,
  custo_producao        numeric,
  observacoes           text,
  criado_em             timestamp not null default current_timestamp,
  atualizado_em         timestamp,

  -- unicidade do slot (segunda fornada no mesmo turno consolida
  -- quantidade_produzida no mesmo registro via UPDATE, nunca vira 2ª linha)
  constraint producao_registros_slot_unico
    unique (data, turno, receita_id),

  constraint producao_registros_turno_check
    check (turno in ('manha', 'tarde')),

  constraint producao_registros_origem_check
    check (origem in ('manual', 'historico')),

  constraint producao_registros_status_check
    check (status in ('aberto', 'fechado', 'reaberto')),

  -- produção efetiva é obrigatória: só existe registro quando algo foi
  -- de fato produzido naquele turno (manual ou histórico). Linhas
  -- históricas com produção 0 não são importadas.
  constraint producao_registros_produzida_positiva
    check (quantidade_produzida > 0),

  -- não-negatividade explícita, incondicional (qualquer origem/status)
  constraint producao_registros_vendida_nao_negativa
    check (quantidade_vendida is null or quantidade_vendida >= 0),

  constraint producao_registros_sobra_total_nao_negativa
    check (sobra_total is null or sobra_total >= 0),

  constraint producao_registros_sobra_aproveitavel_nao_negativa
    check (sobra_aproveitavel is null or sobra_aproveitavel >= 0),

  constraint producao_registros_perda_descarte_nao_negativa
    check (perda_descarte is null or perda_descarte >= 0),

  -- histórico nunca nasce/permanece "aberto" (produção em andamento não
  -- existe para dado importado — já é fato consumado)
  constraint producao_registros_historico_nunca_aberto
    check (origem <> 'historico' or status in ('fechado', 'reaberto')),

  -- campos de fechamento só ficam NULL enquanto o registro nunca foi
  -- fechado (status='aberto'); um registro 'reaberto' PRESERVA os valores
  -- anteriores, não é forçado a NULL por esta constraint
  constraint producao_registros_vazio_apenas_quando_aberto
    check (
      status <> 'aberto'
      or (quantidade_vendida is null and sobra_total is null
          and sobra_aproveitavel is null and perda_descarte is null)
    ),

  -- fechamento manual exige os 4 campos preenchidos juntos — não basta
  -- classificar a sobra sem também ter quantidade_vendida/sobra_total
  constraint producao_registros_campos_fechamento_obrigatorios_manual
    check (
      origem <> 'manual' or status <> 'fechado'
      or (quantidade_vendida is not null
          and sobra_total is not null
          and sobra_aproveitavel is not null
          and perda_descarte is not null)
    ),

  -- histórico nunca ganha classificação de sobra — a planilha antiga nunca
  -- teve esse dado, não inventamos
  constraint producao_registros_historico_sem_classificacao
    check (
      origem <> 'historico'
      or (sobra_aproveitavel is null and perda_descarte is null)
    ),

  -- soma sobra_total = aproveitavel + perda — avaliada só quando fechado
  -- (para manual+fechado os dois operandos são garantidos not null pela
  -- constraint acima; para histórico ficam null e a checagem é inerte)
  constraint producao_registros_soma_sobra
    check (
      status <> 'fechado'
      or sobra_aproveitavel is null or perda_descarte is null
      or sobra_total = sobra_aproveitavel + perda_descarte
    ),

  -- fórmula quantidade_vendida = produzida - sobra_total — obrigatória só
  -- para origem='manual' e status='fechado'; NÃO exigida para histórico
  -- (permite o caso excepcional do Francês 09/06: 250 produzidos / 275
  -- vendidos / sobra_total=0 na tarde, sem violar esta constraint)
  constraint producao_registros_venda_consistente_manual
    check (
      status <> 'fechado' or origem <> 'manual'
      or quantidade_vendida is null or sobra_total is null
      or quantidade_vendida = quantidade_produzida - sobra_total
    )
);

comment on table public.producao_registros is
  'Registro de produção/venda/sobra por data+turno+receita. origem distingue lançamento manual (novo sistema) de importação histórica da planilha Vendas_Sobras. status (aberto/fechado/reaberto) controla o ciclo de vida — só status=fechado é histórico válido para o algoritmo de sugestão. quantidade_produzida > 0 sempre — não existe registro sem produção efetiva. public.producao_diaria (grão diário) permanece separada e não é usada por este módulo.';

create index if not exists producao_registros_data_idx
  on public.producao_registros (data);

create index if not exists producao_registros_receita_idx
  on public.producao_registros (receita_id);

create index if not exists producao_registros_origem_idx
  on public.producao_registros (origem);

create index if not exists producao_registros_status_idx
  on public.producao_registros (status);


-- ============================================================
-- 2. public.producao_dias
-- ============================================================
-- Metadados no nível do dia: dia fechado (ex.: falta de energia) e
-- observação diária (evita repetir a mesma nota em dezenas de produtos).
-- Só recebe linha quando há algo a registrar — não é populada para todo
-- dia do calendário. Ausência de linha aqui NÃO significa dia fechado;
-- significa apenas que não há nota nem fechamento excepcional registrado.
--
-- NÃO tem coluna de feriado (ver public.feriados_nacionais, seção 3) —
-- feriado é identificado por uma tabela própria, porque a tela de
-- planejamento precisa reconhecer um feriado nacional futuro mesmo quando
-- ainda não existe nenhuma ocorrência/observação naquele dia; depender de
-- producao_dias.feriado exigiria criar uma linha "vazia" só para marcar o
-- feriado, contrariando a regra de que esta tabela só existe quando há
-- algo de fato a registrar.

create table if not exists public.producao_dias (
  data              date primary key,
  fechado           boolean not null default false,
  motivo_fechamento text,
  observacao_dia    text,
  criado_em         timestamp not null default current_timestamp,
  atualizado_em     timestamp
);

comment on table public.producao_dias is
  'Metadados por dia do módulo de Produção: dia fechado (ex.: falta de energia, com motivo_fechamento) e observação diária única. Linha só existe quando há algo a registrar; ausência de linha não indica dia fechado nem dia futuro. Feriado NÃO fica aqui — ver public.feriados_nacionais.';


-- ============================================================
-- 3. public.feriados_nacionais
-- ============================================================
-- Fonte única de verdade para feriados nacionais, independente de
-- producao_dias existir ou não para aquela data. Permite a tela de
-- planejamento identificar um feriado futuro sem precisar de nenhuma
-- ocorrência/observação registrada. Estrutura mínima, sem seed nesta
-- migration — o calendário será populado em etapa separada.
--
-- Feriado continua exclusivamente informativo: nenhuma constraint ou
-- lógica aqui faz este dado entrar no cálculo do algoritmo de sugestão.

create table if not exists public.feriados_nacionais (
  data date primary key,
  nome text not null
);

comment on table public.feriados_nacionais is
  'Calendário de feriados nacionais, fonte única de verdade (independente de producao_dias). Uso exclusivamente informativo na tela de planejamento — nunca entra no cálculo do algoritmo de sugestão. Estrutura criada por esta migration sem nenhum seed; o calendário é populado em etapa separada.';


-- ============================================================
-- 4. public.planejamento_producao
-- ============================================================
-- Quantidade "Planejado" definida manualmente pelo usuário. Sugestões
-- calculadas pelo algoritmo NUNCA são persistidas aqui — só existe linha
-- quando o usuário efetivamente define/altera o Planejado OU grava uma
-- observação de planejamento para aquele slot (uma linha só de observação,
-- sem quantidade ainda definida, é válida). O motor de sugestão nunca deve
-- fazer INSERT/UPDATE nesta tabela (contrato de aplicação, não impõe-se
-- via schema).

create table if not exists public.planejamento_producao (
  id                   uuid primary key default gen_random_uuid(),
  data                 date not null,
  turno                text not null,
  receita_id           uuid not null references public.receitas(id),
  quantidade_planejada integer,
  observacao           text,
  criado_em            timestamp not null default current_timestamp,
  atualizado_em        timestamp,

  constraint planejamento_producao_slot_unico
    unique (data, turno, receita_id),

  constraint planejamento_producao_turno_check
    check (turno in ('manha', 'tarde')),

  constraint planejamento_producao_quantidade_nao_negativa
    check (quantidade_planejada is null or quantidade_planejada >= 0),

  -- a linha não pode ser conceitualmente vazia: precisa ter quantidade
  -- definida OU uma observação com conteúdo real (btrim cobre string
  -- vazia e string só com espaços; NULL também não conta como conteúdo)
  constraint planejamento_producao_nao_vazio
    check (
      quantidade_planejada is not null
      or (observacao is not null and btrim(observacao) <> '')
    )
);

comment on table public.planejamento_producao is
  'Quantidade "Planejado" definida manualmente pelo usuário por data+turno+receita, ou observação de planejamento sem quantidade ainda definida. Só existe linha quando há ação real do usuário — sugestão calculada dinamicamente pelo algoritmo nunca é persistida aqui nem sobrescreve um Planejado já definido. quantidade_planejada e observacao não podem estar ambos vazios na mesma linha.';

create index if not exists planejamento_producao_data_idx
  on public.planejamento_producao (data);


-- ============================================================
-- 5. Trigger de proteção de public.producao_registros
-- ============================================================
-- Um único BEFORE INSERT OR UPDATE cobre:
--   a) INSERT direto com status='reaberto' é sempre rejeitado — reabertura
--      só existe como transição de um registro que já estava 'fechado'.
--   b) origem é imutável após o INSERT, incondicional (qualquer status).
--   c) transições de status ficam restritas a
--      aberto -> fechado -> reaberto -> fechado (nunca volta para
--      'aberto'; nunca entra em 'reaberto' vindo de 'aberto').
--   d) a transição fechado -> reaberto exige permissão:
--        origem='historico'  -> public.is_admin()  (procedimento
--                                administrativo extraordinário)
--        origem='manual'     -> public.has_permissao('producao.cancelar')
--   e) a transição fechado -> reaberto é ATOMICAMENTE separada da
--      correção dos dados: o MESMO UPDATE que muda status para 'reaberto'
--      só pode alterar status/atualizado_em — nenhum campo quantitativo
--      ou identificador do lançamento. A correção só acontece em um
--      UPDATE posterior, com o registro já em status='reaberto'.
--   f) enquanto o registro permanece fechado (fechado -> fechado), os
--      mesmos campos quantitativos/identificadores são imutáveis;
--      observacoes e atualizado_em continuam livres para edição em
--      qualquer situação (inclusive junto com a reabertura, se quiser).
--   g) a reabertura PRESERVA os valores antigos — nenhuma lógica os zera.
--      Quem impede que um registro 'reaberto' seja lido como histórico
--      válido é o filtro por status='fechado' nas consultas do algoritmo,
--      não o conteúdo dos campos.

create or replace function public.producao_registros_protecao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campos_lancamento_alterados boolean;
begin
  if tg_op = 'INSERT' then
    if new.status = 'reaberto' then
      raise exception
        'producao_registros: nao e permitido inserir um registro diretamente com status = reaberto.';
    end if;
    return new;
  end if;

  -- tg_op = 'UPDATE' a partir daqui.

  if new.origem <> old.origem then
    raise exception
      'producao_registros: origem e imutavel apos o INSERT (registro %).', old.id;
  end if;

  if new.status = 'aberto' and old.status <> 'aberto' then
    raise exception
      'producao_registros: nao e permitido voltar o registro % para o status aberto.', old.id;
  end if;

  if new.status = 'reaberto' and old.status not in ('fechado', 'reaberto') then
    raise exception
      'producao_registros: so e possivel reabrir um registro que esteja fechado (registro %).', old.id;
  end if;

  -- campos de lançamento (quantidades + identificadores do slot) que só
  -- podem mudar quando o registro NAO estiver, antes ou depois deste
  -- UPDATE, permanecendo em status='fechado' sem passar por reabertura.
  v_campos_lancamento_alterados :=
    new.quantidade_produzida <> old.quantidade_produzida
    or new.quantidade_vendida is distinct from old.quantidade_vendida
    or new.sobra_total is distinct from old.sobra_total
    or new.sobra_aproveitavel is distinct from old.sobra_aproveitavel
    or new.perda_descarte is distinct from old.perda_descarte
    or new.receita_id <> old.receita_id
    or new.data <> old.data
    or new.turno <> old.turno
    or new.custo_producao is distinct from old.custo_producao;

  if old.status = 'fechado' and new.status = 'reaberto' then
    if new.origem = 'historico' then
      if not (select public.is_admin()) then
        raise exception
          'producao_registros: reabertura de registro historico (%) requer administrador (procedimento extraordinario).', old.id;
      end if;
    else
      if not (select public.has_permissao('producao.cancelar')) then
        raise exception
          'producao_registros: reabertura do registro % requer a permissao producao.cancelar.', old.id;
      end if;
    end if;

    -- separacao atomica: o UPDATE de reabertura em si nao corrige dado
    -- nenhum, so muda o status (e, se quiser, atualizado_em/observacoes).
    if v_campos_lancamento_alterados then
      raise exception
        'producao_registros: a reabertura do registro % deve alterar somente o status (e atualizado_em); corrija quantidade/sobra/venda/receita/data/turno/custo em um UPDATE separado, feito depois, com o registro ja em status = reaberto.', old.id;
    end if;
  end if;

  if old.status = 'fechado' and new.status = 'fechado' then
    if v_campos_lancamento_alterados then
      raise exception
        'producao_registros: registro % esta fechado; reabra-o (producao.cancelar ou administrador, conforme a origem) antes de editar estes campos.', old.id;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.producao_registros_protecao() is
  'BEFORE INSERT/UPDATE trigger de producao_registros. Bloqueia INSERT direto com status=reaberto; torna origem imutavel; restringe transicoes de status a aberto->fechado->reaberto->fechado; exige has_permissao(producao.cancelar) para reabrir registro manual e is_admin() para reabrir registro historico (procedimento extraordinario); separa atomicamente a reabertura (fechado->reaberto so pode alterar status/atualizado_em) da correcao dos dados (so permitida em UPDATE posterior, com o registro ja em status=reaberto); bloqueia edicao dos campos quantitativos/identificadores enquanto o registro permanece fechado (fechado->fechado); preserva observacoes/atualizado_em livres em qualquer situacao; preserva os valores antigos durante a reabertura (nao zera nada).';

-- Menor privilégio: função `returns trigger` não é invocável como RPC de
-- qualquer forma (o Postgres rejeita chamada direta independente de
-- GRANT/REVOKE); o REVOKE abaixo é reforço de menor privilégio, mesmo
-- padrão usado em 0004 para logs_auditoria_preencher_usuario().
revoke execute on function public.producao_registros_protecao() from public;

drop trigger if exists producao_registros_protecao_trigger on public.producao_registros;
create trigger producao_registros_protecao_trigger
  before insert or update on public.producao_registros
  for each row
  execute function public.producao_registros_protecao();


-- ============================================================
-- 6. RLS
-- ============================================================
-- producao_registros, producao_dias, planejamento_producao: mesmo padrão
-- das 8 tabelas já fechadas em 0005b, reaproveitando integralmente os
-- códigos producao.visualizar/inserir/editar já seedados em 0001
-- (producao.cancelar segue reservada só para a trigger acima, agora com
-- uso real pela primeira vez). Sem FOR ALL — cada comando tem policy
-- própria. Sem nenhuma policy de DELETE em nenhuma das 4 tabelas.
--
-- feriados_nacionais: dado de referência de baixa sensibilidade (nome de
-- feriado nacional), no mesmo espírito de produtos/receitas — leitura
-- aberta a qualquer usuário autenticado, escrita restrita a
-- is_admin() (mesmo padrão de receitas_insert_admin/receitas_update_admin
-- em 0005b), já que popular/corrigir o calendário é tarefa administrativa
-- pontual, não uma operação rotineira do módulo de Produção. Esta é uma
-- escolha razoável na ausência de instrução explícita sua sobre o RLS
-- desta tabela especificamente — sinalize se preferir outro critério.
-- ============================================================

alter table public.producao_registros enable row level security;

drop policy if exists producao_registros_select on public.producao_registros;
create policy producao_registros_select on public.producao_registros
  for select to authenticated
  using ((select public.has_permissao('producao.visualizar')));

drop policy if exists producao_registros_insert on public.producao_registros;
create policy producao_registros_insert on public.producao_registros
  for insert to authenticated
  with check ((select public.has_permissao('producao.inserir')));

drop policy if exists producao_registros_update on public.producao_registros;
create policy producao_registros_update on public.producao_registros
  for update to authenticated
  using ((select public.has_permissao('producao.editar')))
  with check ((select public.has_permissao('producao.editar')));


alter table public.producao_dias enable row level security;

drop policy if exists producao_dias_select on public.producao_dias;
create policy producao_dias_select on public.producao_dias
  for select to authenticated
  using ((select public.has_permissao('producao.visualizar')));

drop policy if exists producao_dias_insert on public.producao_dias;
create policy producao_dias_insert on public.producao_dias
  for insert to authenticated
  with check ((select public.has_permissao('producao.inserir')));

drop policy if exists producao_dias_update on public.producao_dias;
create policy producao_dias_update on public.producao_dias
  for update to authenticated
  using ((select public.has_permissao('producao.editar')))
  with check ((select public.has_permissao('producao.editar')));


alter table public.planejamento_producao enable row level security;

drop policy if exists planejamento_producao_select on public.planejamento_producao;
create policy planejamento_producao_select on public.planejamento_producao
  for select to authenticated
  using ((select public.has_permissao('producao.visualizar')));

drop policy if exists planejamento_producao_insert on public.planejamento_producao;
create policy planejamento_producao_insert on public.planejamento_producao
  for insert to authenticated
  with check ((select public.has_permissao('producao.inserir')));

drop policy if exists planejamento_producao_update on public.planejamento_producao;
create policy planejamento_producao_update on public.planejamento_producao
  for update to authenticated
  using ((select public.has_permissao('producao.editar')))
  with check ((select public.has_permissao('producao.editar')));


alter table public.feriados_nacionais enable row level security;

drop policy if exists feriados_nacionais_select_authenticated on public.feriados_nacionais;
create policy feriados_nacionais_select_authenticated on public.feriados_nacionais
  for select to authenticated using (true);

drop policy if exists feriados_nacionais_insert_admin on public.feriados_nacionais;
create policy feriados_nacionais_insert_admin on public.feriados_nacionais
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists feriados_nacionais_update_admin on public.feriados_nacionais;
create policy feriados_nacionais_update_admin on public.feriados_nacionais
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Nenhuma policy de DELETE em nenhuma das 4 tabelas acima.
-- Nenhuma FORCE ROW LEVEL SECURITY. Nenhuma alteração em RLS/policies de
-- tabelas já existentes (producao_diaria, receitas, etc.).
-- atualizado_em continua mantida pela aplicação a cada UPDATE (mesmo
-- padrão hoje usado em fornecedores/0009) — nenhuma trigger genérica de
-- updated_at foi criada.

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro: as 4 tabelas são criadas do zero por esta própria migration e
-- nenhuma etapa de importação/seed rodou ainda — não há dado de negócio a
-- perder. producao_diaria e receitas não são tocadas aqui, logo não fazem
-- parte deste rollback.
-- BEGIN;
-- drop policy if exists feriados_nacionais_update_admin on public.feriados_nacionais;
-- drop policy if exists feriados_nacionais_insert_admin on public.feriados_nacionais;
-- drop policy if exists feriados_nacionais_select_authenticated on public.feriados_nacionais;
-- alter table public.feriados_nacionais disable row level security;
--
-- drop policy if exists planejamento_producao_update on public.planejamento_producao;
-- drop policy if exists planejamento_producao_insert on public.planejamento_producao;
-- drop policy if exists planejamento_producao_select on public.planejamento_producao;
-- alter table public.planejamento_producao disable row level security;
--
-- drop policy if exists producao_dias_update on public.producao_dias;
-- drop policy if exists producao_dias_insert on public.producao_dias;
-- drop policy if exists producao_dias_select on public.producao_dias;
-- alter table public.producao_dias disable row level security;
--
-- drop policy if exists producao_registros_update on public.producao_registros;
-- drop policy if exists producao_registros_insert on public.producao_registros;
-- drop policy if exists producao_registros_select on public.producao_registros;
-- alter table public.producao_registros disable row level security;
--
-- drop trigger if exists producao_registros_protecao_trigger on public.producao_registros;
-- drop function if exists public.producao_registros_protecao();
--
-- drop table if exists public.feriados_nacionais;
-- drop table if exists public.planejamento_producao;
-- drop table if exists public.producao_dias;
-- drop table if exists public.producao_registros;
-- COMMIT;
