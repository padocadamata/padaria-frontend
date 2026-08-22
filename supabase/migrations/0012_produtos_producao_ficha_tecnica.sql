-- 0012_produtos_producao_ficha_tecnica.sql
-- Estrutura para a futura aba "Produtos de Produção": controle de quais
-- receitas aparecem na Tela Hoje (controlado_producao), rendimento/unidade
-- de saída da receita, e ficha técnica (receita_ingredientes) ligando
-- receitas a produtos (reaproveitado como catálogo de insumos).
--
-- Escopo desta migration: só estrutura (colunas, tabela, constraints,
-- índices, RLS) + UPDATE controlado marcando somente o Francês como
-- controlado_producao=true. NÃO cria custo automático, NÃO cria
-- versionamento histórico de ficha técnica, NÃO altera public.produtos,
-- NÃO altera o frontend (o ajuste do seletor "+ Outro produto" é uma
-- mudança separada, só em pages/producao.js, autorizada à parte).
--
-- Nota sobre "IF NOT EXISTS": reduz o risco de a reexecução desta migration
-- FALHAR, mas não comprova que um objeto pré-existente de mesmo nome tenha
-- exatamente esta definição (tipo, default, nullability). Esta migration
-- não deve ser tratada como "idempotente" no sentido de equivalência
-- estrutural garantida — só no sentido de "segura para rodar de novo sem
-- erro se os objetos já existirem do jeito que esta migration os cria".
--
-- Pré-requisito: 0010_producao_registros.sql e 0011_funcoes_producao_registros.sql
-- já aplicadas.

BEGIN;

-- ============================================================
-- 1. public.receitas — novas colunas
-- ============================================================

alter table public.receitas
  add column if not exists controlado_producao boolean not null default false;

alter table public.receitas
  add column if not exists rendimento_quantidade numeric;

alter table public.receitas
  add column if not exists unidade_medida_saida text;

-- controlado_producao default false: nenhuma receita existente muda de
-- comportamento só por essa coluna existir. rendimento_quantidade e
-- unidade_medida_saida ficam NULL para as 45 receitas atuais.

do $$
begin
  alter table public.receitas
    add constraint receitas_rendimento_unidade_coerentes_check
    check (
      (rendimento_quantidade is null and unidade_medida_saida is null)
      or (
        rendimento_quantidade > 0
        and unidade_medida_saida is not null
        and btrim(unidade_medida_saida) <> ''
      )
    );
exception
  when duplicate_object then null;
end $$;

-- rendimento_quantidade e unidade_medida_saida são tratados como par
-- coerente: ou os dois ficam NULL, ou os dois vêm preenchidos (quantidade
-- > 0 e unidade não vazia após trim). Não é possível ter quantidade sem
-- unidade nem unidade sem quantidade. Constraint criada já VALID (não NOT
-- VALID): o predicado aceita explicitamente o par (NULL, NULL), que é o
-- estado das 45 receitas atuais — não há necessidade de validação
-- retroativa adiada.


-- ============================================================
-- 2. public.receita_ingredientes (ficha técnica) — nova tabela
-- ============================================================
-- V1: sem versionamento histórico. Correção de quantidade/unidade é
-- UPDATE direto na linha ativa. ativo=false remove o ingrediente da
-- ficha (soft delete). Histórico/auditoria detalhada fica para evolução
-- futura.
--
-- unidade_medida permanece texto livre nesta tabela (não em produtos):
-- a unidade usada na ficha técnica pode legitimamente ser diferente da
-- unidade cadastral do insumo em public.produtos (ex.: produto cadastrado
-- em "pacote" mas usado na receita em "g"). Esta migration NÃO cria uma
-- tabela de unidades padronizadas — registra aqui, como pendência de
-- design para a futura UI, que texto livre sem padronização (kg / KG /
-- quilo / Kg) é um risco de qualidade de dado que a tela de cadastro
-- deverá mitigar (ex.: um <select> com uma lista fixa de unidades no
-- frontend), sem exigir uma tabela nova no banco nesta etapa.

create table if not exists public.receita_ingredientes (
  id             uuid primary key default gen_random_uuid(),

  receita_id     uuid not null
    references public.receitas(id)
    on delete restrict,

  produto_id     uuid not null
    references public.produtos(id)
    on delete restrict,

  quantidade     numeric not null,

  unidade_medida text not null,

  ativo          boolean not null default true,

  criado_em      timestamptz not null default now(),

  atualizado_em  timestamptz,

  constraint receita_ingredientes_quantidade_positiva_check
    check (quantidade > 0),

  constraint receita_ingredientes_unidade_medida_nao_vazia_check
    check (btrim(unidade_medida) <> '')
);

comment on table public.receita_ingredientes is
  'Ficha técnica: ingredientes/insumos (public.produtos) e suas quantidades por receita. V1 sem versionamento histórico — correção é UPDATE direto na linha ativa; ativo=false remove o ingrediente da ficha.';

comment on column public.receita_ingredientes.produto_id is
  'Referencia public.produtos, reaproveitado como catálogo de insumos. Seleção de insumo, por convenção de aplicação (não imposta por constraint aqui), deve preferir produtos com ativo=true and categoria=''Insumo''.';

comment on column public.receita_ingredientes.unidade_medida is
  'Texto livre nesta V1 — pode divergir da unidade cadastral de produtos. Pendência de design: a futura UI deve restringir a um conjunto padronizado de unidades (ex. select fixo), para evitar inconsistência textual (kg/KG/quilo). Nenhuma tabela de unidades criada nesta migration.';


-- ============================================================
-- 3. Índices de receita_ingredientes
-- ============================================================

create index if not exists receita_ingredientes_receita_id_idx
  on public.receita_ingredientes (receita_id);

create index if not exists receita_ingredientes_produto_id_idx
  on public.receita_ingredientes (produto_id);

-- Único parcial: no máximo uma linha ATIVA por (receita, insumo). Permite
-- múltiplas linhas inativas para o mesmo par (histórico de remoções), sem
-- impor versionamento formal.
create unique index if not exists receita_ingredientes_unico_ativo_idx
  on public.receita_ingredientes (receita_id, produto_id)
  where ativo = true;


-- ============================================================
-- 4. RLS de receita_ingredientes — admin-only para escrita (Opção A)
-- ============================================================
-- SELECT liberado a authenticated, INSERT/UPDATE restritos a is_admin(),
-- SEM policy de DELETE — mesmo padrão já em vigor para receitas
-- (0005/0005b) e para todo o catálogo (fornecedores, produtos,
-- producao_diaria). Nenhuma permissão nova é criada — reaproveita
-- public.is_admin() de 0003.
--
-- As 3 colunas novas de receitas (passo 1) não exigem nenhuma alteração
-- nas policies já existentes de receitas_select_authenticated /
-- receitas_insert_admin / receitas_update_admin: RLS do Postgres é por
-- linha, não por coluna, então já ficam cobertas automaticamente.

alter table public.receita_ingredientes enable row level security;

drop policy if exists receita_ingredientes_select_authenticated on public.receita_ingredientes;
create policy receita_ingredientes_select_authenticated on public.receita_ingredientes
  for select to authenticated using (true);

drop policy if exists receita_ingredientes_insert_admin on public.receita_ingredientes;
create policy receita_ingredientes_insert_admin on public.receita_ingredientes
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists receita_ingredientes_update_admin on public.receita_ingredientes;
create policy receita_ingredientes_update_admin on public.receita_ingredientes
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Sem policy de DELETE.


-- ============================================================
-- 5. Ativação controlada: somente o Francês em controlado_producao=true
-- ============================================================
-- Localização por id + nome + ativo, combinados (não só por nome), com
-- guarda de row_count = 1 obrigatória.

do $$
declare
  linhas_afetadas int;
begin
  update public.receitas
  set controlado_producao = true
  where id = '4daf0857-6b9b-43b3-9253-e8909ad9b914'
    and nome = 'Francês'
    and ativo = true;

  get diagnostics linhas_afetadas = row_count;

  if linhas_afetadas <> 1 then
    raise exception
      'esperado exatamente 1 linha (Francês, id=4daf0857-6b9b-43b3-9253-e8909ad9b914, nome=Francês, ativo=true) afetada, obtido %',
      linhas_afetadas;
  end if;
end $$;

-- Todas as demais receitas (incluindo os 12 registros suspeitos)
-- permanecem controlado_producao=false, sem nenhum UPDATE adicional.

COMMIT;


-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENÇÃO: este rollback é mecanicamente executável (nenhuma constraint
-- impede reverter, ao contrário do caso de 0009), MAS deixa de ser seguro
-- do ponto de vista de DADO assim que receita_ingredientes ou as novas
-- colunas de receitas (rendimento_quantidade, unidade_medida_saida,
-- controlado_producao) começarem a receber informação real cadastrada por
-- um usuário (ex.: fichas técnicas já preenchidas, outras receitas já
-- marcadas controlado_producao=true pela futura tela). A partir desse
-- momento, rodar este rollback DESTRÓI esses dados de forma irreversível.
-- Antes de executar, é obrigatório auditar (SELECT) o conteúdo atual de
-- receita_ingredientes e das 3 colunas novas de receitas, e decidir
-- deliberadamente se essa perda é aceitável — nunca rodar este bloco "por
-- segurança" ou de forma automática.
--
-- BEGIN;
--
-- update public.receitas set controlado_producao = false where id = '4daf0857-6b9b-43b3-9253-e8909ad9b914';
--
-- drop policy if exists receita_ingredientes_update_admin on public.receita_ingredientes;
-- drop policy if exists receita_ingredientes_insert_admin on public.receita_ingredientes;
-- drop policy if exists receita_ingredientes_select_authenticated on public.receita_ingredientes;
-- alter table public.receita_ingredientes disable row level security;
--
-- drop index if exists public.receita_ingredientes_unico_ativo_idx;
-- drop index if exists public.receita_ingredientes_produto_id_idx;
-- drop index if exists public.receita_ingredientes_receita_id_idx;
-- drop table if exists public.receita_ingredientes;
--
-- alter table public.receitas drop constraint if exists receitas_rendimento_unidade_coerentes_check;
-- alter table public.receitas drop column if exists unidade_medida_saida;
-- alter table public.receitas drop column if exists rendimento_quantidade;
-- alter table public.receitas drop column if exists controlado_producao;
--
-- COMMIT;
