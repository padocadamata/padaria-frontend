-- 0007_reestruturar_fornecedores.sql
-- Reestruturação do cadastro de fornecedores da Padoca da Mata.
-- Migration estrutural: não importa dados e não altera os 28 registros atuais.

BEGIN;

-- ============================================================
-- 1. public.fornecedores — novas colunas (idempotente)
-- ============================================================

alter table public.fornecedores
  add column if not exists nome_fantasia text;

alter table public.fornecedores
  add column if not exists razao_social text;

alter table public.fornecedores
  add column if not exists tipo_documento text;

alter table public.fornecedores
  add column if not exists documento text;

alter table public.fornecedores
  add column if not exists contato_nome text;

alter table public.fornecedores
  add column if not exists whatsapp text;

alter table public.fornecedores
  add column if not exists observacoes text;

alter table public.fornecedores
  add column if not exists modalidade_compra text not null
  default 'pedido_com_entrega';

-- As colunas legadas:
-- cnpj
-- nome
-- data_pedido_padrao
-- data_entrega_padrao
--
-- são preservadas nesta migration.
-- A remoção, se necessária, ficará para uma migration posterior,
-- somente depois da importação e validação dos dados reais.


-- ============================================================
-- 2. Constraints novas em public.fornecedores
-- ============================================================

do $$
begin
  alter table public.fornecedores
    add constraint fornecedores_tipo_documento_check
    check (
      tipo_documento is null
      or tipo_documento in ('CNPJ', 'CPF')
    );
exception
  when duplicate_object then null;
end $$;


do $$
begin
  alter table public.fornecedores
    add constraint fornecedores_modalidade_compra_check
    check (
      modalidade_compra in (
        'pedido_com_entrega',
        'compra_presencial'
      )
    );
exception
  when duplicate_object then null;
end $$;


-- NOT VALID é intencional.
-- Os registros antigos ainda possuem sua identificação na coluna
-- legada "nome", enquanto nome_fantasia e razao_social estarão NULL.
-- Assim, não forçamos uma validação retroativa dos 28 registros atuais.

do $$
begin
  alter table public.fornecedores
    add constraint fornecedores_identificacao_check
    check (
      nome_fantasia is not null
      or razao_social is not null
    ) not valid;
exception
  when duplicate_object then null;
end $$;


-- ============================================================
-- 3. Unicidade de documento — somente quando preenchido
-- ============================================================

create unique index if not exists fornecedores_documento_unique_idx
  on public.fornecedores (documento)
  where documento is not null;

-- O campo documento aceita NULL.
-- Não serão criados CNPJs/CPFs fictícios.
-- A normalização para somente dígitos deverá ser feita na
-- importação e no formulário do sistema.


-- ============================================================
-- 4. public.fornecedor_regras_pedido
-- ============================================================

create table if not exists public.fornecedor_regras_pedido (
  id uuid primary key default gen_random_uuid(),

  fornecedor_id uuid not null
    references public.fornecedores(id)
    on delete restrict,

  dia_pedido smallint,

  horario_limite time,

  tipo_entrega text not null,

  dias_prazo smallint,

  dia_entrega smallint,

  observacao text,

  ativo boolean not null default true,

  criado_em timestamptz not null default now(),

  atualizado_em timestamptz,

  constraint fornecedor_regras_pedido_dia_pedido_check
    check (
      dia_pedido is null
      or dia_pedido between 1 and 7
    ),

  constraint fornecedor_regras_pedido_dia_entrega_check
    check (
      dia_entrega is null
      or dia_entrega between 1 and 7
    ),

  constraint fornecedor_regras_pedido_dias_prazo_check
    check (
      dias_prazo is null
      or dias_prazo >= 0
    ),

  constraint fornecedor_regras_pedido_tipo_entrega_check
    check (
      tipo_entrega in (
        'prazo_dias',
        'dia_fixo'
      )
    ),

  constraint fornecedor_regras_pedido_entrega_coerente_check
    check (
      (
        tipo_entrega = 'prazo_dias'
        and dias_prazo is not null
        and dia_entrega is null
      )
      or
      (
        tipo_entrega = 'dia_fixo'
        and dia_entrega is not null
        and dias_prazo is null
      )
    )
);


-- ============================================================
-- 5. Documentação das regras
-- ============================================================

comment on table public.fornecedor_regras_pedido is
  'Regras de pedido/entrega de um fornecedor. Um fornecedor pode ter várias regras, inclusive mais de uma para o mesmo dia de pedido.';

comment on column public.fornecedor_regras_pedido.dia_pedido is
  '1=segunda até 7=domingo. NULL = diário (pode pedir qualquer dia).';

comment on column public.fornecedor_regras_pedido.dia_entrega is
  '1=segunda até 7=domingo. Somente preenchido quando tipo_entrega = dia_fixo.';

comment on column public.fornecedor_regras_pedido.dias_prazo is
  'Prazo relativo à data do pedido (D+N). Aceita 0 para entrega no mesmo dia. Somente preenchido quando tipo_entrega = prazo_dias.';


-- ============================================================
-- 6. Índices de fornecedor_regras_pedido
-- ============================================================

create index if not exists fornecedor_regras_pedido_fornecedor_id_idx
  on public.fornecedor_regras_pedido (fornecedor_id);

create index if not exists fornecedor_regras_pedido_fornecedor_ativo_idx
  on public.fornecedor_regras_pedido (fornecedor_id, ativo);

create index if not exists fornecedor_regras_pedido_dia_pedido_ativo_idx
  on public.fornecedor_regras_pedido (dia_pedido)
  where ativo = true;


-- ============================================================
-- 7. RLS de fornecedor_regras_pedido
-- ============================================================
-- Utiliza as mesmas permissões já existentes de fornecedores.
--
-- Não existe hard delete pelo frontend.
-- Uma regra deixa de ser utilizada através de UPDATE ativo=false.

alter table public.fornecedor_regras_pedido
  enable row level security;


drop policy if exists fornecedor_regras_pedido_select
  on public.fornecedor_regras_pedido;

create policy fornecedor_regras_pedido_select
  on public.fornecedor_regras_pedido
  for select
  to authenticated
  using (
    (select public.has_permissao('fornecedores.visualizar'))
  );


drop policy if exists fornecedor_regras_pedido_insert
  on public.fornecedor_regras_pedido;

create policy fornecedor_regras_pedido_insert
  on public.fornecedor_regras_pedido
  for insert
  to authenticated
  with check (
    (select public.has_permissao('fornecedores.inserir'))
  );


drop policy if exists fornecedor_regras_pedido_update
  on public.fornecedor_regras_pedido;

create policy fornecedor_regras_pedido_update
  on public.fornecedor_regras_pedido
  for update
  to authenticated
  using (
    (select public.has_permissao('fornecedores.editar'))
  )
  with check (
    (select public.has_permissao('fornecedores.editar'))
  );


-- ============================================================
-- 8. Auditoria
-- ============================================================
-- A public.logs_auditoria criada pela 0004 não é alterada aqui.
--
-- Quando a nova tela de fornecedores for implementada,
-- alterações em fornecedores e em fornecedor_regras_pedido
-- deverão ser registradas no mecanismo de auditoria do sistema.
--
-- Entidades sugeridas:
-- fornecedor
-- fornecedor_regra_pedido


COMMIT;


-- ============================================================
-- ROLLBACK
-- ============================================================
-- O rollback abaixo é SOMENTE documentação.
-- Todas as linhas permanecem comentadas.
--
-- Não remove os 28 registros existentes.
-- Não remove as colunas legadas.
--
-- BEGIN;
--
-- drop policy if exists fornecedor_regras_pedido_update
--   on public.fornecedor_regras_pedido;
--
-- drop policy if exists fornecedor_regras_pedido_insert
--   on public.fornecedor_regras_pedido;
--
-- drop policy if exists fornecedor_regras_pedido_select
--   on public.fornecedor_regras_pedido;
--
-- drop table if exists public.fornecedor_regras_pedido;
--
-- drop index if exists public.fornecedores_documento_unique_idx;
--
-- alter table public.fornecedores
--   drop constraint if exists fornecedores_identificacao_check;
--
-- alter table public.fornecedores
--   drop constraint if exists fornecedores_modalidade_compra_check;
--
-- alter table public.fornecedores
--   drop constraint if exists fornecedores_tipo_documento_check;
--
-- alter table public.fornecedores
--   drop column if exists modalidade_compra;
--
-- alter table public.fornecedores
--   drop column if exists observacoes;
--
-- alter table public.fornecedores
--   drop column if exists whatsapp;
--
-- alter table public.fornecedores
--   drop column if exists contato_nome;
--
-- alter table public.fornecedores
--   drop column if exists documento;
--
-- alter table public.fornecedores
--   drop column if exists tipo_documento;
--
-- alter table public.fornecedores
--   drop column if exists razao_social;
--
-- alter table public.fornecedores
--   drop column if exists nome_fantasia;
--
-- COMMIT;