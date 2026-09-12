-- 0054_funcionarios_cadastro.sql
-- Fase 1 da nova frente FOLHA DE PAGAMENTO: Cadastro de Funcionários,
-- Cargos/Funções, Dependentes e Benefícios/condições recorrentes.
--
-- NÃO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor,
-- depois de conferir a preauditoria (preauditoria_0054_funcionarios_EXECUTAR.sql).
--
-- ============================================================
-- DECISÃO ARQUITETURAL CENTRAL (reafirmada, aprovada pelo usuário)
-- ============================================================
-- FUNCIONARIO != USUARIO DO SISTEMA.
--   * public.funcionarios.id é gen_random_uuid() PRÓPRIO -- NÃO referencia
--     auth.users. Um funcionário existe e é totalmente operável sem nunca
--     ter tido um login.
--   * public.funcionarios.usuario_id é NULLABLE + UNIQUE + FK para
--     public.usuarios(id) ON DELETE SET NULL -- vínculo OPCIONAL e
--     EXPLÍCITO. UNIQUE garante no máximo 1 funcionário por usuário (e
--     vice-versa, pela natureza de FK+UNIQUE numa coluna nullable, que o
--     Postgres permite múltiplos NULL). ON DELETE SET NULL (nunca CASCADE):
--     remover/desativar um usuário do sistema NUNCA apaga nem invalida o
--     cadastro do funcionário -- só desfaz o vínculo de login.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   1. public.funcionarios_cargos (nova) -- cargo/função, cadastro
--      estruturado (mesmo padrão de catalogo_secoes/catalogo_categorias,
--      migration 0028: id uuid, nome único funcional case-insensitive,
--      sem exclusão física, só ativar/inativar).
--   2. public.funcionarios (nova) -- identificação, endereço, contato de
--      emergência e dados operacionais. CPF opcional, único quando
--      informado (normalizado para somente dígitos pelo FRONTEND antes de
--      enviar -- ver lib/funcionarios/normalizacao.js -- este arquivo não
--      impõe normalização via trigger, mesmo raciocínio já usado no
--      projeto para nome em MAIÚSCULAS: contrato de disciplina no
--      frontend, não mágica no banco). Único invariante realmente
--      protegido no banco (trigger, não só frontend): data_demissao
--      preenchida força ativo=false -- é uma regra de integridade de
--      dado, não só formatação cosmética.
--   3. public.funcionarios_dependentes (nova) -- 1:N, idade NUNCA
--      armazenada (sempre derivada de data_nascimento no frontend).
--   4. public.funcionarios_beneficios_tipos (nova) -- catálogo pequeno,
--      seed inicial de 3 tipos (ADIANTAMENTO SALARIAL, VALE-TRANSPORTE,
--      VALE-REFEIÇÃO), extensível pela interface, sem exclusão física.
--   5. public.funcionarios_beneficios (nova) -- 1:N, condição recorrente
--      do funcionário associada a um tipo do catálogo acima.
--   6. 3 permissões novas: funcionarios.visualizar/.inserir/.editar,
--      concedidas SOMENTE a proprietario_admin (decisão explícita do
--      usuário para esta rodada -- nenhum outro perfil recebe automático).
--
-- Esta migration NÃO faz, e não deve fazer:
--   * nenhuma tabela/coluna de Escala, Folga, Pagamentos, Cálculo de
--     FOPAG ou Cartão Ponto -- fora de escopo desta Fase 1 (ver relatório
--     desta rodada para a arquitetura aprovada da próxima fase);
--   * nenhuma alteração em auth.users, public.usuarios, public.perfis,
--     public.permissoes (fora do INSERT de catálogo abaixo),
--     public.perfil_permissoes (fora do INSERT de concessão abaixo),
--     public.usuario_permissoes, nem em qualquer tabela de Agenda
--     (agenda_itens/agenda_ocorrencias/agenda_categorias), Produção,
--     Pedidos ou Sacos Fechados;
--   * nenhuma coluna de folga/horário/escala em public.funcionarios --
--     folga pertence exclusivamente ao futuro módulo Escala;
--   * nenhuma policy de DELETE em nenhuma das 5 tabelas novas -- exclusão
--     física nunca é oferecida pela interface (só ativo/inativo), e com
--     RLS habilitada e nenhuma policy de DELETE o comando fica bloqueado
--     para todo mundo, inclusive admin (mesmo padrão de
--     dashboard_lembretes/logs_auditoria/producao_tipos/producao_grupos).
--
-- Envolvida em transação explícita (BEGIN/COMMIT) -- só DDL padrão,
-- CREATE OR REPLACE FUNCTION e INSERT de seed/catálogo.

BEGIN;

-- ============================================================
-- 1. public.funcionarios_cargos
-- ============================================================
create table if not exists public.funcionarios_cargos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz,

  constraint funcionarios_cargos_nome_nao_vazio check (btrim(nome) <> '')
);

comment on table public.funcionarios_cargos is
  'Cadastro estruturado de Cargos/Funções (Fase 1 de Funcionários, migration 0054). Mesmo desenho de catalogo_secoes/catalogo_categorias (0028): nome único case-insensitive, sem exclusão física (só ativo/inativo). Persistência em MAIUSCULAS e o trim/normalização de nome sao contrato do FRONTEND (lib/funcionarios/normalizacao.js), nao impostos por trigger aqui -- mesmo padrao ja usado no projeto para dados mestres.';

create unique index if not exists funcionarios_cargos_nome_normalizado_idx
  on public.funcionarios_cargos (lower(btrim(nome)));

-- ============================================================
-- 2. public.funcionarios
-- ============================================================
create table if not exists public.funcionarios (
  id                             uuid primary key default gen_random_uuid(),

  -- Identificação
  nome                           text not null,
  cpf                            text,
  rg                             text,
  data_nascimento                date,
  telefone                       text,
  email                          text,
  observacoes                    text,

  -- Endereço
  cep                            text,
  logradouro                     text,
  numero                         text,
  complemento                    text,
  bairro                         text,
  cidade                         text,
  estado                         text,

  -- Contato de emergência
  nome_contato_emergencia        text,
  telefone_contato_emergencia    text,
  parentesco_contato_emergencia  text,

  -- Dados operacionais
  cargo_id                       uuid references public.funcionarios_cargos(id),
  data_admissao                  date,
  data_demissao                  date,
  ativo                          boolean not null default true,
  usuario_id                     uuid unique references public.usuarios(id) on delete set null,

  criado_em                      timestamptz not null default now(),
  atualizado_em                  timestamptz,

  constraint funcionarios_nome_nao_vazio check (btrim(nome) <> ''),
  -- 'estado' é sempre populado pelo frontend via <select> fechado de UF
  -- (2 letras maiúsculas) -- este CHECK é defesa em profundidade, não a
  -- única barreira.
  constraint funcionarios_estado_formato check (estado is null or estado ~ '^[A-Z]{2}$')
);

comment on table public.funcionarios is
  'Cadastro de Funcionarios (Fase 1, migration 0054). FUNCIONARIO != USUARIO: id proprio (gen_random_uuid), NAO referencia auth.users -- um funcionario pode existir e ser totalmente operavel sem nunca ter tido login. usuario_id e o UNICO vinculo com login, sempre NULLABLE/opcional/explicito (ver comentario da coluna). Sem exclusao fisica pela interface -- so ativo/inativo, preservando historico. Folga/horario/escala ficam fora desta tabela por decisao de arquitetura -- pertencem ao futuro modulo Escala.';

comment on column public.funcionarios.usuario_id is
  'Vinculo OPCIONAL e EXPLICITO com public.usuarios (login do sistema). NULLABLE: a maioria dos funcionarios nunca tera login. UNIQUE: no maximo um funcionario por usuario. ON DELETE SET NULL: remover/desativar o usuario NUNCA apaga nem invalida o funcionario, so desfaz o vinculo de login.';

comment on column public.funcionarios.cpf is
  'Opcional. Quando informado, normalizado para somente digitos pelo FRONTEND antes de INSERT/UPDATE (lib/funcionarios/normalizacao.js) -- este banco nao reformata, so garante unicidade via indice parcial abaixo. Validacao de formato (11 digitos + digitos verificadores) e feita no frontend, minimamente, antes de enviar.';

comment on column public.funcionarios.data_demissao is
  'Preenchida (nao nula) FORCA ativo=false via trigger funcionarios_aplicar_invariantes abaixo -- e uma regra de integridade de dado, nao so cosmetica. O inverso NAO e automatico: inativar (ativo=false) NAO exige preencher data_demissao (permite afastamento/inativacao temporaria sem registrar demissao formal), e reativar (ativo=true) e sempre uma acao explicita do admin, que decide se tambem limpa data_demissao (recontratacao) ou nao.';

-- CPF único apenas quando informado (índice parcial) -- funcionário sem
-- CPF cadastrado nunca colide com outro sem CPF.
create unique index if not exists funcionarios_cpf_idx
  on public.funcionarios (cpf) where cpf is not null;

create index if not exists funcionarios_cargo_id_idx on public.funcionarios (cargo_id);
create index if not exists funcionarios_usuario_id_idx on public.funcionarios (usuario_id);
create index if not exists funcionarios_ativo_idx on public.funcionarios (ativo);

-- ------------------------------------------------------------
-- 2a. Trigger: invariante data_demissao -> ativo=false (unidirecional) +
--     atualizado_em.
-- ------------------------------------------------------------
create or replace function public.funcionarios_aplicar_invariantes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.data_demissao is not null then
    new.ativo := false;
  end if;

  new.atualizado_em := now();
  return new;
end;
$$;

comment on function public.funcionarios_aplicar_invariantes() is
  'BEFORE INSERT/UPDATE em funcionarios. Unico invariante de negocio protegido no banco (nao so no frontend): data_demissao preenchida forca ativo=false. Tambem mantem atualizado_em. Nao mexe em nenhum outro campo.';

drop trigger if exists funcionarios_invariantes_trigger on public.funcionarios;
create trigger funcionarios_invariantes_trigger
  before insert or update on public.funcionarios
  for each row
  execute function public.funcionarios_aplicar_invariantes();

-- ------------------------------------------------------------
-- 2b. Trigger genérico de atualizado_em, reaproveitado por
--     funcionarios_cargos / funcionarios_dependentes /
--     funcionarios_beneficios_tipos / funcionarios_beneficios
--     (funcionarios em si usa funcionarios_aplicar_invariantes, que já
--     inclui isso). Definido aqui, ANTES de qualquer CREATE TRIGGER que
--     o referencie, porque a função precisa existir no catálogo no
--     momento em que cada CREATE TRIGGER abaixo é executado.
-- ------------------------------------------------------------
create or replace function public.funcionarios_aplicar_invariantes_generico()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

comment on function public.funcionarios_aplicar_invariantes_generico() is
  'BEFORE UPDATE generico: so mantem atualizado_em. Reaproveitado por funcionarios_cargos, funcionarios_dependentes, funcionarios_beneficios_tipos e funcionarios_beneficios -- nenhuma logica de negocio adicional.';

drop trigger if exists funcionarios_cargos_atualizado_em_trigger on public.funcionarios_cargos;
create trigger funcionarios_cargos_atualizado_em_trigger
  before update on public.funcionarios_cargos
  for each row
  execute function public.funcionarios_aplicar_invariantes_generico();

-- ============================================================
-- 3. public.funcionarios_dependentes
-- ============================================================
create table if not exists public.funcionarios_dependentes (
  id               uuid primary key default gen_random_uuid(),
  funcionario_id   uuid not null references public.funcionarios(id) on delete cascade,
  nome             text not null,
  data_nascimento  date,
  parentesco       text,
  possui_pensao    boolean not null default false,
  valor_pensao     numeric(12,2),
  observacoes      text,
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz,

  constraint funcionarios_dependentes_nome_nao_vazio check (btrim(nome) <> ''),
  constraint funcionarios_dependentes_valor_pensao_coerente
    check (valor_pensao is null or possui_pensao)
);

comment on table public.funcionarios_dependentes is
  'Dependentes do funcionario (Fase 1, migration 0054), 1:N, estrutura propria (nao campos soltos em funcionarios). Idade NUNCA armazenada -- sempre derivada de data_nascimento no frontend (lib/funcionarios/aniversarios.js:calcularIdade). Sem exclusao fisica pela interface -- remocao logica via ativo=false, preservando historico para uso futuro no calculo de FOPAG.';

comment on column public.funcionarios_dependentes.possui_pensao is
  'Indica que ha uma obrigacao/condicao de pensao (alimenticia ou outra) associada a este dependente, relevante para o FUNCIONARIO -- identificacao para uso futuro no calculo de FOPAG (ex.: desconto/retencao de pensao na folha do funcionario). Nome revisado (era recebe_pensao) porque "recebe pensao" seria lido como "o dependente recebe uma renda de pensao", quando o fato que este campo precisa registrar e o oposto operacionalmente: existe uma pensao vinculada a este dependente que pode gerar desconto no pagamento do FUNCIONARIO. Conceito distinto de "dependente para fins de Imposto de Renda", que nao existe nesta Fase 1 e nao deve ser confundido com este campo.';

comment on column public.funcionarios_dependentes.valor_pensao is
  'Nullable. So faz sentido preenchido quando possui_pensao=true (ver CHECK funcionarios_dependentes_valor_pensao_coerente) -- valor de referencia para uso futuro no calculo de FOPAG, nao gera nenhum lancamento nesta fase.';

create index if not exists funcionarios_dependentes_funcionario_id_idx
  on public.funcionarios_dependentes (funcionario_id);

drop trigger if exists funcionarios_dependentes_atualizado_em_trigger on public.funcionarios_dependentes;
create trigger funcionarios_dependentes_atualizado_em_trigger
  before update on public.funcionarios_dependentes
  for each row
  execute function public.funcionarios_aplicar_invariantes_generico();

-- ============================================================
-- 4. public.funcionarios_beneficios_tipos
-- ============================================================
create table if not exists public.funcionarios_beneficios_tipos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz,

  constraint funcionarios_beneficios_tipos_nome_nao_vazio check (btrim(nome) <> '')
);

comment on table public.funcionarios_beneficios_tipos is
  'Catalogo de tipos de beneficio/condicao recorrente (Fase 1, migration 0054) -- ex.: ADIANTAMENTO SALARIAL, VALE-TRANSPORTE, VALE-REFEICAO. Estrutura flexivel (catalogo + tabela de vinculo, nao booleanos rigidos em funcionarios) para comportar tipos futuros sem nova migration. Nome unico case-insensitive, sem exclusao fisica (so ativo/inativo).';

create unique index if not exists funcionarios_beneficios_tipos_nome_normalizado_idx
  on public.funcionarios_beneficios_tipos (lower(btrim(nome)));

-- ============================================================
-- 5. public.funcionarios_beneficios
-- ============================================================
create table if not exists public.funcionarios_beneficios (
  id             uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios(id) on delete cascade,
  tipo_id        uuid not null references public.funcionarios_beneficios_tipos(id),
  ativo          boolean not null default true,
  valor          numeric(12,2),
  periodicidade  text,
  data_inicio    date,
  data_fim       date,
  observacoes    text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz,

  constraint funcionarios_beneficios_periodicidade_check
    check (periodicidade is null or periodicidade in ('diaria', 'semanal', 'quinzenal', 'mensal'))
);

comment on table public.funcionarios_beneficios is
  'Beneficio/condicao recorrente vinculada a um funcionario e a um tipo do catalogo funcionarios_beneficios_tipos (Fase 1, migration 0054). Encerrar um beneficio e logico (ativo=false e/ou data_fim), nunca exclusao fisica. periodicidade reaproveita o mesmo vocabulario ja aprovado para o futuro modulo Pagamentos (diaria/semanal/quinzenal/mensal) -- ajustavel em migration futura se a Fase de Pagamentos exigir outra granularidade.';

create index if not exists funcionarios_beneficios_funcionario_id_idx
  on public.funcionarios_beneficios (funcionario_id);
create index if not exists funcionarios_beneficios_tipo_id_idx
  on public.funcionarios_beneficios (tipo_id);

-- Reaproveita funcionarios_aplicar_invariantes_generico(), já definida
-- na seção 2b (antes de funcionarios_dependentes) -- não redefinida aqui.
drop trigger if exists funcionarios_beneficios_tipos_atualizado_em_trigger on public.funcionarios_beneficios_tipos;
create trigger funcionarios_beneficios_tipos_atualizado_em_trigger
  before update on public.funcionarios_beneficios_tipos
  for each row
  execute function public.funcionarios_aplicar_invariantes_generico();

drop trigger if exists funcionarios_beneficios_atualizado_em_trigger on public.funcionarios_beneficios;
create trigger funcionarios_beneficios_atualizado_em_trigger
  before update on public.funcionarios_beneficios
  for each row
  execute function public.funcionarios_aplicar_invariantes_generico();

-- ============================================================
-- 6. Permissões novas -- SOMENTE 3 códigos, concedidos SOMENTE a
--    proprietario_admin nesta rodada (decisão explícita do usuário).
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('funcionarios.visualizar', 'funcionarios', 'visualizar', 'Ver cadastro de funcionarios, cargos, dependentes e beneficios.'),
  ('funcionarios.inserir',    'funcionarios', 'inserir',    'Cadastrar novo funcionario.'),
  ('funcionarios.editar',     'funcionarios', 'editar',     'Editar funcionario existente; gerenciar cargos, dependentes e beneficios; ativar/inativar; vincular/desvincular usuario do sistema.')
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil, permissao) values
  ('proprietario_admin', 'funcionarios.visualizar'),
  ('proprietario_admin', 'funcionarios.inserir'),
  ('proprietario_admin', 'funcionarios.editar')
on conflict do nothing;

-- Seed dos 3 tipos de benefício iniciais (idempotente via NOT EXISTS,
-- porque a unicidade é o índice funcional lower(btrim(nome)), não uma
-- UNIQUE constraint simples em `nome` -- mesmo raciocínio de
-- catalogo_secoes/categorias, 0028).
insert into public.funcionarios_beneficios_tipos (nome)
select v.nome
from (values ('ADIANTAMENTO SALARIAL'), ('VALE-TRANSPORTE'), ('VALE-REFEIÇÃO')) as v(nome)
where not exists (
  select 1 from public.funcionarios_beneficios_tipos t
  where lower(btrim(t.nome)) = lower(btrim(v.nome))
);

-- ============================================================
-- 7. RLS -- todas as 5 tabelas. Padrão: SELECT por funcionarios.visualizar;
--    INSERT em funcionarios por funcionarios.inserir; INSERT/UPDATE nas
--    demais 4 tabelas (cargos/dependentes/beneficios_tipos/beneficios) e
--    UPDATE em funcionarios por funcionarios.editar. NENHUMA policy de
--    DELETE em nenhuma tabela -- exclusão física bloqueada para todo
--    mundo, inclusive admin.
-- ============================================================

alter table public.funcionarios_cargos enable row level security;

drop policy if exists funcionarios_cargos_select on public.funcionarios_cargos;
create policy funcionarios_cargos_select on public.funcionarios_cargos
  for select to authenticated
  using ((select public.has_permissao('funcionarios.visualizar')));

drop policy if exists funcionarios_cargos_insert on public.funcionarios_cargos;
create policy funcionarios_cargos_insert on public.funcionarios_cargos
  for insert to authenticated
  with check ((select public.has_permissao('funcionarios.editar')));

drop policy if exists funcionarios_cargos_update on public.funcionarios_cargos;
create policy funcionarios_cargos_update on public.funcionarios_cargos
  for update to authenticated
  using ((select public.has_permissao('funcionarios.editar')))
  with check ((select public.has_permissao('funcionarios.editar')));


alter table public.funcionarios enable row level security;

drop policy if exists funcionarios_select on public.funcionarios;
create policy funcionarios_select on public.funcionarios
  for select to authenticated
  using ((select public.has_permissao('funcionarios.visualizar')));

drop policy if exists funcionarios_insert on public.funcionarios;
create policy funcionarios_insert on public.funcionarios
  for insert to authenticated
  with check ((select public.has_permissao('funcionarios.inserir')));

drop policy if exists funcionarios_update on public.funcionarios;
create policy funcionarios_update on public.funcionarios
  for update to authenticated
  using ((select public.has_permissao('funcionarios.editar')))
  with check ((select public.has_permissao('funcionarios.editar')));


alter table public.funcionarios_dependentes enable row level security;

drop policy if exists funcionarios_dependentes_select on public.funcionarios_dependentes;
create policy funcionarios_dependentes_select on public.funcionarios_dependentes
  for select to authenticated
  using ((select public.has_permissao('funcionarios.visualizar')));

drop policy if exists funcionarios_dependentes_insert on public.funcionarios_dependentes;
create policy funcionarios_dependentes_insert on public.funcionarios_dependentes
  for insert to authenticated
  with check ((select public.has_permissao('funcionarios.editar')));

drop policy if exists funcionarios_dependentes_update on public.funcionarios_dependentes;
create policy funcionarios_dependentes_update on public.funcionarios_dependentes
  for update to authenticated
  using ((select public.has_permissao('funcionarios.editar')))
  with check ((select public.has_permissao('funcionarios.editar')));


alter table public.funcionarios_beneficios_tipos enable row level security;

drop policy if exists funcionarios_beneficios_tipos_select on public.funcionarios_beneficios_tipos;
create policy funcionarios_beneficios_tipos_select on public.funcionarios_beneficios_tipos
  for select to authenticated
  using ((select public.has_permissao('funcionarios.visualizar')));

drop policy if exists funcionarios_beneficios_tipos_insert on public.funcionarios_beneficios_tipos;
create policy funcionarios_beneficios_tipos_insert on public.funcionarios_beneficios_tipos
  for insert to authenticated
  with check ((select public.has_permissao('funcionarios.editar')));

drop policy if exists funcionarios_beneficios_tipos_update on public.funcionarios_beneficios_tipos;
create policy funcionarios_beneficios_tipos_update on public.funcionarios_beneficios_tipos
  for update to authenticated
  using ((select public.has_permissao('funcionarios.editar')))
  with check ((select public.has_permissao('funcionarios.editar')));


alter table public.funcionarios_beneficios enable row level security;

drop policy if exists funcionarios_beneficios_select on public.funcionarios_beneficios;
create policy funcionarios_beneficios_select on public.funcionarios_beneficios
  for select to authenticated
  using ((select public.has_permissao('funcionarios.visualizar')));

drop policy if exists funcionarios_beneficios_insert on public.funcionarios_beneficios;
create policy funcionarios_beneficios_insert on public.funcionarios_beneficios
  for insert to authenticated
  with check ((select public.has_permissao('funcionarios.editar')));

drop policy if exists funcionarios_beneficios_update on public.funcionarios_beneficios;
create policy funcionarios_beneficios_update on public.funcionarios_beneficios
  for update to authenticated
  using ((select public.has_permissao('funcionarios.editar')))
  with check ((select public.has_permissao('funcionarios.editar')));

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENÇÃO: apaga todo o cadastro de funcionários/cargos/dependentes/
-- benefícios criado até o momento do rollback -- não há soft-delete que
-- sobreviva a um DROP TABLE. Só use antes de haver dado real relevante.
-- BEGIN;
-- delete from public.perfil_permissoes where permissao in ('funcionarios.visualizar','funcionarios.inserir','funcionarios.editar');
-- delete from public.permissoes where codigo in ('funcionarios.visualizar','funcionarios.inserir','funcionarios.editar');
-- drop table if exists public.funcionarios_beneficios;
-- drop table if exists public.funcionarios_beneficios_tipos;
-- drop table if exists public.funcionarios_dependentes;
-- drop table if exists public.funcionarios;
-- drop table if exists public.funcionarios_cargos;
-- drop function if exists public.funcionarios_aplicar_invariantes();
-- drop function if exists public.funcionarios_aplicar_invariantes_generico();
-- COMMIT;
