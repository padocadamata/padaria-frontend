-- 0041_estoque_movimentacoes_fundacao.sql
-- Fundacao REAL do futuro modulo geral de Estoque -- livro-razao generico
-- de movimentacoes em unidade-base, agnostico de origem. NAO especifico
-- de Sacos Fechados (essa frente vem na migration 0042, consumindo esta
-- tabela) -- nome, colunas e regras aqui nao mencionam sacos em nenhum
-- lugar, de proposito.
--
-- DECISOES DE MODELAGEM (fechadas antes desta migration, auditoria previa):
--   * Saldo NUNCA armazenado -- sempre SUM(quantidade) por produto_id,
--     nunca uma coluna de saldo corrente. Mesmo raciocinio de saldo de
--     sacos (0042).
--   * quantidade e ASSINADA (positivo=entrada, negativo=saida) -- evita
--     uma coluna "tipo/direcao" carregando o sinal por indirecao.
--   * unidade e SNAPSHOT em texto livre, mesma convencao ja usada em todo
--     o projeto (pedido_itens.unidade_recebida, produtos_historico_compras.
--     unidade_comercial/unidade_base_no_momento) -- produtos.unidade_medida
--     tambem e texto livre, sem dominio fechado (confirmado por auditoria:
--     nenhuma CHECK constraint restringe seus valores em nenhuma migration
--     ate 0040), entao esta tabela nao inventa uma normalizacao que o
--     resto do projeto nao tem.
--   * origem/origem_id sao o unico vinculo com quem gerou a movimentacao
--     -- generico de proposito (texto livre + uuid nullable), sem FK fixa
--     para nenhuma tabela especifica: a fundacao precisa aceitar origens
--     futuras (perda, ajuste de inventario, compra direta) sem alteracao
--     de schema. Protecao 1:1 via indice unico parcial em (origem,
--     origem_id) -- ver secao 3.
--   * RLS: SEM NENHUMA POLICY nesta migration (nem SELECT). Ainda nao
--     existe nenhum codigo de permissao "estoque.*" nem tela que precise
--     ler esta tabela diretamente via PostgREST -- inventar uma permissao
--     ou uma policy agora seria antecipar decisao de um modulo que nao
--     existe. Escrita/leitura, quando precisarem existir (0042 em diante),
--     acontecem so via funcoes SECURITY DEFINER, cujo dono tem BYPASSRLS
--     (mesmo mecanismo real ja documentado em 0022 para pedidos/
--     pedido_itens -- REVOKE/GRANT normais nao afetam esse bypass).
--
-- ESCOPO -- SOMENTE:
--   * public.estoque_movimentacoes (nova) -- tabela, indices, RLS
--     habilitado sem policies, trigger de autoria/imutabilidade.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma tabela/coluna/regra especifica de Sacos Fechados (fica
--     inteira na 0042);
--   * nenhuma alteracao em produtos, produto_fornecedores, pedidos,
--     pedido_itens ou qualquer tabela de Producao/Agenda;
--   * nenhuma RPC (a primeira RPC que grava aqui e
--     registrar_abertura_saco, criada na 0042 -- esta migration so cria a
--     tabela que ela vai usar);
--   * nenhum codigo de permissao novo.
--
-- Pre-requisitos: 0001..0040 ja aplicadas.

BEGIN;

-- ============================================================
-- 1. public.estoque_movimentacoes (nova)
-- ============================================================
create table if not exists public.estoque_movimentacoes (
  id             uuid primary key default gen_random_uuid(),

  produto_id     uuid not null
    references public.produtos(id) on delete restrict,

  -- Assinada: positivo = entrada, negativo = saida. Sem coluna de
  -- tipo/direcao separada -- o sinal e a propria direcao, sem
  -- indirecao nem risco de "tipo diz uma coisa, quantidade diz outra".
  quantidade     numeric(12,3) not null,

  -- Snapshot em texto livre -- mesma convencao ja usada em todo o
  -- projeto para unidade (nunca uma tabela de dominio fechado).
  unidade        text not null,

  -- Quem gerou esta movimentacao. Texto livre de proposito -- esta
  -- fundacao precisa aceitar origens futuras sem alteracao de schema.
  -- origem_id e generico (uuid nullable), sem FK fixa -- pode apontar
  -- para qualquer tabela de origem, dependendo do valor de origem.
  origem         text not null,
  origem_id      uuid,

  observacao     text,

  -- Autoria/timestamps -- nunca setados pelo cliente, forcados pela
  -- trigger estoque_movimentacoes_protecao abaixo.
  criado_por     uuid references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null,
  atualizado_em  timestamptz not null default now(),

  constraint estoque_movimentacoes_quantidade_nao_zero_check
    check (quantidade <> 0),

  constraint estoque_movimentacoes_unidade_nao_vazia_check
    check (btrim(unidade) <> ''),

  constraint estoque_movimentacoes_origem_nao_vazia_check
    check (btrim(origem) <> '')
);

comment on table public.estoque_movimentacoes is
  'Livro-razao GENERICO de movimentacoes de estoque em unidade-base, agnostico de origem -- fundacao do futuro modulo geral de Estoque (nada especifico de Sacos Fechados aqui, ver 0042 para o consumidor inicial). Saldo por produto_id = SUM(quantidade), NUNCA uma coluna de saldo armazenada. Sem policy de RLS nesta migration -- escrita/leitura so via funcoes SECURITY DEFINER (BYPASSRLS do dono), ate que exista um caso de uso real que justifique acesso direto via PostgREST.';

comment on column public.estoque_movimentacoes.quantidade is
  'Assinada: positivo = entrada, negativo = saida. Snapshot definitivo desta movimentacao -- nunca recalculada a partir de outra tabela apos o INSERT.';

comment on column public.estoque_movimentacoes.unidade is
  'Snapshot em texto livre da unidade-base do produto no momento da movimentacao (mesma convencao de pedido_itens.unidade_recebida/produtos_historico_compras.unidade_base_no_momento) -- produtos.unidade_medida tambem e texto livre, sem dominio fechado.';

comment on column public.estoque_movimentacoes.origem is
  'Identifica quem gerou esta movimentacao (ex.: sacos_fechados_abertura, sacos_fechados_recebimento -- ver 0042/0043). Texto livre de proposito: novas origens futuras nao exigem alteracao de schema.';

comment on column public.estoque_movimentacoes.origem_id is
  'Id da linha de origem, quando aplicavel (ex.: sacos_fechados_movimentacoes.id). Sem FK fixa -- o significado depende do valor de origem. Nullable: nem toda movimentacao futura precisa ter uma origem referenciavel (ex.: lancamento manual direto de estoque, se algum dia existir).';

create index if not exists estoque_movimentacoes_produto_id_idx
  on public.estoque_movimentacoes (produto_id);

create index if not exists estoque_movimentacoes_criado_em_idx
  on public.estoque_movimentacoes (criado_em desc);

-- Protecao 1:1 -- no maximo UMA movimentacao de estoque por (origem,
-- origem_id). Compilado como par porque origem_id sozinho nao teria
-- significado unico entre origens diferentes (ex.: duas origens
-- distintas poderiam, em tese, referenciar ids de tabelas diferentes que
-- coincidem em valor). NULL e ignorado pela semantica padrao de indice
-- unico do Postgres -- movimentacoes sem origem_id (nenhuma ainda,
-- reservado para uso futuro) nao sao restringidas por este indice.
create unique index if not exists estoque_movimentacoes_origem_unico_idx
  on public.estoque_movimentacoes (origem, origem_id)
  where origem_id is not null;


-- ------------------------------------------------------------
-- 1.1 RLS -- HABILITADO, SEM NENHUMA POLICY (ver justificativa no
--     cabecalho desta migration).
-- ------------------------------------------------------------
alter table public.estoque_movimentacoes enable row level security;
-- Sem FORCE ROW LEVEL SECURITY -- mesma convencao ja documentada em
-- 0005b/0010/0022/0023 (nenhuma funcao SECURITY DEFINER precisa
-- bypassar RLS via FORCE; o mecanismo real e BYPASSRLS do papel dono).
--
-- Nenhuma policy de SELECT/INSERT/UPDATE/DELETE e criada nesta migration
-- -- com RLS habilitado e zero policies, authenticated fica SEM NENHUM
-- acesso direto via PostgREST a esta tabela, em qualquer comando. Toda
-- leitura/escrita, quando precisar existir, passa por uma funcao
-- SECURITY DEFINER (cujo dono tem BYPASSRLS), nunca por acesso direto do
-- cliente. Reavaliar quando um caso de uso real exigir leitura direta
-- (ex.: uma tela geral de Estoque).


-- ------------------------------------------------------------
-- 1.2 Trigger de protecao -- autoria/timestamps, campos imutaveis
-- ------------------------------------------------------------
-- SECURITY INVOKER: nao precisa ler nada fora do que o proprio chamador
-- ja pode ler/escrever nesta linha -- nenhuma dependencia cruzada com
-- outra tabela (diferente do caso de produto_fornecedores_protecao em
-- 0042, que precisa SECURITY DEFINER por causa da checagem de
-- sacos_fechados_movimentacoes).
create or replace function public.estoque_movimentacoes_protecao()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.atualizado_por := auth.uid();
    new.atualizado_em := now();
    return new;

  elsif tg_op = 'UPDATE' then
    if new.produto_id is distinct from old.produto_id then
      raise exception 'estoque_movimentacoes: produto_id e imutavel.';
    end if;
    if new.unidade is distinct from old.unidade then
      raise exception 'estoque_movimentacoes: unidade e imutavel.';
    end if;
    if new.origem is distinct from old.origem then
      raise exception 'estoque_movimentacoes: origem e imutavel.';
    end if;
    if new.origem_id is distinct from old.origem_id then
      raise exception 'estoque_movimentacoes: origem_id e imutavel.';
    end if;
    if new.criado_por is distinct from old.criado_por then
      raise exception 'estoque_movimentacoes: criado_por e imutavel.';
    end if;
    if new.criado_em is distinct from old.criado_em then
      raise exception 'estoque_movimentacoes: criado_em e imutavel.';
    end if;

    new.atualizado_por := auth.uid();
    new.atualizado_em := now();
    return new;
  end if;

  return null;
end;
$$;

comment on function public.estoque_movimentacoes_protecao() is
  'BEFORE INSERT/UPDATE em estoque_movimentacoes. INSERT: forca criado_por/criado_em/atualizado_por/atualizado_em. UPDATE: bloqueia produto_id/unidade/origem/origem_id/criado_por/criado_em imutaveis (identidade estrutural da movimentacao) -- quantidade e observacao PODEM ser corrigidas, mas so por quem chegar a este UPDATE, o que na pratica e so uma funcao SECURITY DEFINER da origem que gerou a linha (ex.: editar_movimentacao_saco em 0042), ja com suas proprias validacoes de saldo/permissao feitas antes do UPDATE -- sem policy de UPDATE nesta tabela, nenhum authenticated comum chega aqui por conta propria. Sempre forca atualizado_por/atualizado_em, mesmo numa correcao.';

drop trigger if exists estoque_movimentacoes_protecao_trigger on public.estoque_movimentacoes;
create trigger estoque_movimentacoes_protecao_trigger
  before insert or update on public.estoque_movimentacoes
  for each row
  execute function public.estoque_movimentacoes_protecao();

-- Menor privilegio -- mesma logica defensiva de 0004/0023: mesmo que
-- `returns trigger` ja impeca chamada direta via RPC independente de
-- GRANT/REVOKE, o REVOKE abaixo evita listar a funcao como candidata no
-- schema do PostgREST.
revoke execute on function public.estoque_movimentacoes_protecao() from public;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro ENQUANTO nenhuma linha real tiver sido inserida (nenhum
-- consumidor existe ainda nesta migration isolada -- 0042 e quem
-- primeiro escreve aqui). Depois que 0042/0043 existirem e gravarem
-- dados reais, rodar isto DESTROI o livro-razao de estoque inteiro.
-- BEGIN;
--   drop trigger if exists estoque_movimentacoes_protecao_trigger on public.estoque_movimentacoes;
--   drop function if exists public.estoque_movimentacoes_protecao();
--   drop table if exists public.estoque_movimentacoes;
-- COMMIT;
