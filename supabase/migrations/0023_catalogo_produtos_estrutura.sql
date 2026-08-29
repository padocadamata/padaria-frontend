-- 0023_catalogo_produtos_estrutura.sql
-- Fase B do Catalogo de Produtos: estrutura essencial para transformar
-- public.produtos (390 registros, fora do historico de migrations, mesma
-- situacao de usuarios/fornecedores antes de suas migrations) em cadastro
-- mestre administravel, mais a relacao Produto x Fornecedor e o historico
-- de compras efetivas.
--
-- RASCUNHO EM AUDITORIA -- NAO COPIAR PARA supabase/migrations/ NEM
-- EXECUTAR ate autorizacao explicita. Gerado em scratchpad para revisao
-- estatica, SHA-256 e classificacao de risco.
--
-- Pre-requisitos: 0001..0022 ja aplicadas (usa public.has_permissao(),
-- public.produtos, public.fornecedores, public.permissoes,
-- public.perfil_permissoes -- nenhuma delas alterada estruturalmente
-- alem do que esta secao descreve). Numeracao confirmada livre: 0022 e a
-- ultima migration em origin/main no momento em que este arquivo foi
-- gerado (commit com pedidos_fase_a_estrutura + acompanhamento/
-- recebimento de pedidos), nenhuma 0023 publicada ainda.
--
-- ESCOPO -- SOMENTE:
--   * public.produtos: 1 coluna nova (codigo_g3, nullable, sem backfill);
--     RLS de escrita migrada de is_admin() puro para
--     has_permissao('catalogo_produtos.editar'); SELECT preservado
--     exatamente como esta (authenticated, sem restricao) -- Pedidos ja
--     depende disso hoje (components/pedidos/NovoPedidoForm.js);
--   * public.produto_fornecedores (nova) -- quais fornecedores vendem
--     cada produto, em quais configuracoes comerciais (mais de uma
--     configuracao por par produto+fornecedor e permitida de proposito,
--     sem UNIQUE(produto_id, fornecedor_id));
--   * public.produtos_historico_compras (nova) -- historico de compras
--     efetivas (nunca de cotacao), com preco comercial (snapshot exato
--     da transacao) e preco_unitario_base (SEMPRE derivado por coluna
--     GENERATED, nunca informado nem calculado por fora -- impede por
--     construcao qualquer divergencia entre preco comercial, fator de
--     conversao e preco base). origem='manual' e corrigivel por quem tem
--     catalogo_produtos.editar; origem='recebimento_pedido' (nenhum
--     registro existe ainda -- Fase C futura) e imutavel por design,
--     inclusive impedido de ser criado fora de uma RPC futura dedicada;
--   * public.produtos_resumo_compras (view) -- ultimo/menor preco
--     comprado (so a partir de preco_unitario_base, nunca do preco
--     comercial bruto), com security_invoker=true (ver justificativa na
--     secao da view) para que a RLS das tabelas base seja respeitada
--     pelo usuario real, nao pelo dono da view;
--   * 2 codigos novos de permissao (catalogo_produtos.visualizar/editar)
--     + concessao a proprietario_admin.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em pedidos, pedido_itens, cotacoes,
--     receita_ingredientes, receitas ou qualquer tabela de Producao;
--   * nenhuma alteracao em pedido_itens.produto_id (continua nullable --
--     fica para a Fase B.2, depois que esta tela existir e o catalogo
--     estiver populado o suficiente);
--   * nenhum campo de recebimento detalhado (quantidade/preco
--     efetivamente recebidos) -- Fase C;
--   * nenhuma renomeacao/alteracao de produtos.codigo_barras -- permanece
--     100% intocada (natureza mista confirmada por auditoria: 213
--     valores plausiveis como EAN de 8-14 digitos, 177 fora dessa faixa,
--     0 nulos/vazios, 390 distintos -- sem evidencia segura para separar
--     EAN de codigo interno, nenhuma tentativa de fazer isso aqui);
--   * nenhum backfill de codigo_g3 a partir de codigo_barras, mesmo para
--     os 213 valores plausiveis -- fica vazio para os 390 registros,
--     preenchimento manual e gradual;
--   * nenhuma exclusao/consolidacao das 4 linhas duplicadas (OVO BRANCO
--     x2, OVO VERMELHO x2, confirmadas com 0 uso em pedido_itens/
--     receita_ingredientes/cotacoes) -- limpeza separada, depois de
--     comparar os pares completos;
--   * nenhuma alteracao em public.cotacoes (legada, 0 registros, sem
--     nenhuma policy, nunca referenciada pelo frontend -- fica para a
--     fase propria de Cotacoes, substituicao defensiva versionada,
--     mesmo padrao ja usado para os legados pedidos/itens_pedidos na
--     migration 0022);
--   * nenhuma coluna de marca/apresentacao em produtos (apresentacao
--     comercial mora em produto_fornecedores, nao duplicada no cadastro
--     mestre);
--   * nenhum campo de EAN "confirmado" separado -- sem necessidade
--     operacional concreta ainda; extensao trivial (ADD COLUMN) quando
--     surgir processo real de validacao/leitura de codigo de barras;
--   * nenhuma alteracao de frontend.

BEGIN;

-- ============================================================
-- 1. public.produtos -- coluna nova codigo_g3
-- ============================================================
-- Mesmo padrao ja aprovado e em producao em receitas.codigo_g3
-- (migration 0013): texto livre, nullable, sem FK (nao existe tabela de
-- codigos G3 no projeto), sem vinculo por nome -- a ligacao e sempre
-- pelo codigo. Nenhum valor copiado de codigo_barras: nenhuma linha das
-- 390 tem qualquer garantia de que o valor la seja realmente o codigo
-- G3 (pode ser EAN, pode ser codigo interno de outra natureza) --
-- inventar essa ligacao seria pior do que deixar vazio.
alter table public.produtos
  add column if not exists codigo_g3 text;

do $$
begin
  alter table public.produtos
    add constraint produtos_codigo_g3_nao_vazio_check
    check (codigo_g3 is null or btrim(codigo_g3) <> '');
exception
  when duplicate_object then null;
end $$;

-- Unico funcional parcial: impede dois produtos com o mesmo codigo_g3,
-- tratando maiuscula/minuscula e espacos de borda como equivalentes.
-- NULL e ignorado pela semantica padrao de indice unico do Postgres --
-- quantos produtos quiserem podem ficar sem codigo_g3 preenchido.
create unique index if not exists produtos_codigo_g3_unico_idx
  on public.produtos (lower(btrim(codigo_g3)))
  where codigo_g3 is not null;

comment on column public.produtos.codigo_g3 is
  'Codigo do produto no sistema G3, texto livre, nullable. Sem backfill automatico a partir de codigo_barras -- a natureza mista desse campo legado (EAN e codigo interno misturados, confirmado por auditoria) nao permite inferir com seguranca qual valor seria o G3. Preenchimento manual e gradual via a tela do Catalogo.';


-- ============================================================
-- 2. public.produtos -- RLS: sai de is_admin() puro, entra
--    has_permissao('catalogo_produtos.editar')
-- ============================================================
-- SELECT preservado EXATAMENTE como esta hoje (migration 0005b) --
-- authenticated, sem nenhuma restricao. Nao e esquecimento: apertar o
-- SELECT para exigir catalogo_produtos.visualizar quebraria a busca de
-- produto ja em producao em components/pedidos/NovoPedidoForm.js (usada
-- por qualquer usuario com pedidos.inserir, independente de ter ou nao
-- catalogo_produtos.visualizar). Revisitar essa assimetria fica para
-- quando o Catalogo estiver mais consolidado.
drop policy if exists produtos_insert_admin on public.produtos;
create policy produtos_insert_catalogo on public.produtos
  for insert to authenticated
  with check ((select public.has_permissao('catalogo_produtos.editar')));

drop policy if exists produtos_update_admin on public.produtos;
create policy produtos_update_catalogo on public.produtos
  for update to authenticated
  using ((select public.has_permissao('catalogo_produtos.editar')))
  with check ((select public.has_permissao('catalogo_produtos.editar')));

-- DELETE continua sem policy nenhuma -- exclusao fisica bloqueada para
-- todo mundo, inclusive admin, como ja era antes desta migration.
-- "Inativar" e so ativo=false, um UPDATE comum ja coberto acima.


-- ============================================================
-- 3. public.produto_fornecedores (nova)
-- ============================================================
-- Quais fornecedores vendem cada produto, em quais configuracoes
-- comerciais. Deliberadamente SEM UNIQUE(produto_id, fornecedor_id): um
-- mesmo fornecedor pode vender o mesmo produto em mais de uma
-- configuracao legitima (ex. "pacote 500g" e "caixa com 12 pacotes" do
-- mesmo fornecedor, para o mesmo produto) -- a identificacao de cada
-- configuracao e por unidade_comercial + apresentacao (rotulo livre
-- opcional), nunca por uma constraint rigida que impediria cadastrar
-- duas ofertas reais.
--
-- criado_por usa ON DELETE SET NULL (nao o default RESTRICT que
-- public.pedidos.criado_por usa, migration 0022) -- decisao deliberada,
-- seguindo o precedente mais bem justificado do projeto:
-- dashboard_lembretes.criado_por (migration 0021) explicitamente usa SET
-- NULL "para nao criar dependencia rigida que impeca futuramente
-- remover/desativar um usuario". produto_fornecedores e cadastro
-- operacional, nao um registro transacional core como pedidos -- o
-- mesmo raciocinio de nao bloquear remocao de usuario se aplica aqui.
-- Sem coluna de snapshot de nome (diferente de dashboard_lembretes):
-- nao existe tela hoje que precise mostrar "quem cadastrou" depois que o
-- usuario for removido -- adicionar esse campo sem uso concreto seria
-- exatamente o tipo de metadado sem beneficio que foi pedido para evitar.
create table if not exists public.produto_fornecedores (
  id                          uuid primary key default gen_random_uuid(),

  produto_id                  uuid not null
    references public.produtos(id) on delete restrict,

  fornecedor_id                uuid not null
    references public.fornecedores(id) on delete restrict,

  -- Unidade em que ESTA configuracao e vendida (kg, pacote, caixa,
  -- fardo, peca, un -- texto livre, mesma convencao ja usada em
  -- pedido_itens.unidade/receita_ingredientes.unidade_medida). E o
  -- campo que entra na matematica de conversao para a unidade base do
  -- produto (produtos.unidade_medida).
  unidade_comercial           text not null,

  -- Rotulo humano livre, opcional -- so preenchido quando
  -- unidade_comercial sozinho nao distingue duas ofertas do mesmo
  -- fornecedor (ex. duas linhas "pacote" de tamanhos diferentes viram
  -- "Pacote 500g" e "Pacote 1kg").
  apresentacao                text,

  -- Quantas unidades da base equivalem a 1 unidade_comercial, QUANDO
  -- CONHECIDO (ex. caixa=12, pacote=5 significando 5kg se a base for
  -- KG). Nulo quando desconhecido, ou quando unidade_comercial ja e
  -- igual a base (conversao trivial=1, informada explicitamente por
  -- quem lancar o historico de compra, nao inferida aqui por
  -- comparacao textual fragil entre unidade_comercial e
  -- produtos.unidade_medida).
  quantidade_embalagem        numeric(12,3),

  -- SKU do fornecedor para esta configuracao especifica, quando houver.
  codigo_produto_fornecedor   text,

  -- Fornecedor pode deixar de oferecer esta configuracao sem apagar o
  -- historico de compras que ja a referenciou.
  ativo                       boolean not null default true,

  observacao                  text,

  -- Autoria/timestamps -- nunca setados pelo cliente, forcados pela
  -- trigger produto_fornecedores_protecao abaixo.
  criado_por                  uuid references auth.users(id) on delete set null,
  criado_em                   timestamptz not null default now(),
  atualizado_em                timestamptz not null default now(),

  constraint produto_fornecedores_unidade_comercial_nao_vazia_check
    check (btrim(unidade_comercial) <> ''),

  constraint produto_fornecedores_quantidade_embalagem_positiva_check
    check (quantidade_embalagem is null or quantidade_embalagem > 0)
);

comment on table public.produto_fornecedores is
  'Configuracoes comerciais pelas quais um fornecedor vende um produto do Catalogo. Sem UNIQUE(produto_id, fornecedor_id) de proposito -- um par pode ter varias linhas (uma por configuracao comercial legitima). Sem preco aqui -- preco vive em produtos_historico_compras (compra efetiva) ou nas futuras cotacao_propostas (preco cotado), nunca fixo nesta relacao.';

comment on column public.produto_fornecedores.quantidade_embalagem is
  'Fator de conversao para a unidade base do produto (produtos.unidade_medida), quando conhecido. Nulo nao significa "1" -- significa "nao sabemos"; quem lancar um historico de compra usando esta configuracao decide explicitamente o fator daquela compra especifica (produtos_historico_compras.fator_conversao_base), sem depender silenciosamente deste valor.';

create index if not exists produto_fornecedores_produto_id_idx
  on public.produto_fornecedores (produto_id);

create index if not exists produto_fornecedores_fornecedor_id_idx
  on public.produto_fornecedores (fornecedor_id);


-- ------------------------------------------------------------
-- 3.1 RLS de produto_fornecedores
-- ------------------------------------------------------------
alter table public.produto_fornecedores enable row level security;
-- Sem FORCE ROW LEVEL SECURITY -- mesma convencao ja documentada em
-- 0005b/0010/0022 (nenhuma funcao SECURITY DEFINER precisa bypassar RLS
-- nesta tabela; FORCE nao adicionaria protecao real).

create policy produto_fornecedores_select on public.produto_fornecedores
  for select to authenticated
  using ((select public.has_permissao('catalogo_produtos.visualizar')));

create policy produto_fornecedores_insert on public.produto_fornecedores
  for insert to authenticated
  with check ((select public.has_permissao('catalogo_produtos.editar')));

create policy produto_fornecedores_update on public.produto_fornecedores
  for update to authenticated
  using ((select public.has_permissao('catalogo_produtos.editar')))
  with check ((select public.has_permissao('catalogo_produtos.editar')));

-- Sem policy de DELETE -- exclusao fisica indisponivel para todo mundo.
-- Retirar uma configuracao comercial e sempre ativo=false (UPDATE,
-- coberto pela policy acima), preservando o historico de compras que
-- ja a referenciou.


-- ------------------------------------------------------------
-- 3.2 Trigger de protecao -- autoria/timestamps, campos imutaveis
-- ------------------------------------------------------------
-- SECURITY INVOKER: nao precisa ler nada fora do que o proprio
-- chamador ja pode ler/escrever nesta linha -- diferente de
-- pedido_itens_protecao (migration 0022), que precisa SECURITY DEFINER
-- para ler pedidos.status independente da RLS de SELECT de pedidos do
-- chamador. Aqui nao ha essa dependencia cruzada.
create or replace function public.produto_fornecedores_protecao()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Autoria/timestamps nunca vem do cliente -- sobrescritos
    -- incondicionalmente, mesmo padrao anti-spoofing de
    -- logs_auditoria_preencher_usuario (migration 0004) e
    -- pedidos_protecao (migration 0022).
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.atualizado_em := now();
    return new;

  elsif tg_op = 'UPDATE' then
    if new.produto_id is distinct from old.produto_id then
      raise exception 'produto_fornecedores: produto_id e imutavel.';
    end if;
    if new.fornecedor_id is distinct from old.fornecedor_id then
      raise exception 'produto_fornecedores: fornecedor_id e imutavel.';
    end if;
    if new.criado_por is distinct from old.criado_por then
      raise exception 'produto_fornecedores: criado_por e imutavel.';
    end if;
    if new.criado_em is distinct from old.criado_em then
      raise exception 'produto_fornecedores: criado_em e imutavel.';
    end if;

    new.atualizado_em := now();
    return new;
  end if;

  return null;
end;
$$;

comment on function public.produto_fornecedores_protecao() is
  'BEFORE INSERT/UPDATE em produto_fornecedores. INSERT: forca criado_por/criado_em/atualizado_em. UPDATE: bloqueia produto_id/fornecedor_id/criado_por/criado_em imutaveis, forca atualizado_em.';

drop trigger if exists produto_fornecedores_protecao_trigger on public.produto_fornecedores;
create trigger produto_fornecedores_protecao_trigger
  before insert or update on public.produto_fornecedores
  for each row
  execute function public.produto_fornecedores_protecao();


-- ============================================================
-- 4. public.produtos_historico_compras (nova)
-- ============================================================
-- Historico de COMPRAS EFETIVAS -- nunca de cotacao (cotacao tera seu
-- proprio historico de propostas, fase futura propria, sem escrever
-- aqui). Alimentado nesta fase somente por lancamento manual
-- (origem='manual'); origem='recebimento_pedido' existe no dominio do
-- CHECK desde ja (estrutura preparada), mas nenhum registro desse tipo
-- pode ser criado ainda -- a RLS de INSERT abaixo exige explicitamente
-- origem='manual', e o caminho automatico (Fase C, recebimento
-- detalhado) tera sua propria RPC dedicada quando existir.
--
-- preco_unitario_base e coluna GENERATED ALWAYS -- nunca informada pelo
-- cliente nem calculada por fora: e sempre
-- round(preco_unitario_comercial / fator_conversao_base, 4), com NULL
-- quando fator_conversao_base for NULL. Isso torna estruturalmente
-- impossivel qualquer divergencia entre os tres campos -- nao existe
-- caminho para inserir/atualizar um preco_unitario_base "errado", porque
-- a coluna nem aceita escrita direta (Postgres rejeita qualquer INSERT/
-- UPDATE que tente atribuir valor a uma coluna GENERATED ALWAYS).
--
-- Deliberadamente SEM produto_fornecedor_id (FK para
-- produto_fornecedores): um lancamento historico manual pode
-- representar uma compra antiga cuja configuracao comercial especifica
-- ainda nao esteja cadastrada em produto_fornecedores -- exigir esse
-- vinculo obrigaria a cadastrar a configuracao antes de poder registrar
-- o historico, ou inventar uma configuracao so para o vinculo existir.
-- produto_id + fornecedor_id + os snapshots comerciais proprios desta
-- tabela (unidade_comercial/quantidade_comercial/preco_unitario_comercial)
-- sao fonte suficiente nesta fase. Uma FK opcional (nullable) para
-- produto_fornecedores podera ser adicionada em migration futura, se e
-- quando houver beneficio operacional concreto (ex. relatorios que
-- precisem saber exatamente qual configuracao comercial cadastrada
-- originou aquela compra) -- nao adicionada agora sem esse caso de uso
-- real.
create table if not exists public.produtos_historico_compras (
  id                        uuid primary key default gen_random_uuid(),

  produto_id                uuid not null
    references public.produtos(id) on delete restrict,

  fornecedor_id             uuid not null
    references public.fornecedores(id) on delete restrict,

  -- Snapshot exato da transacao -- nunca alterado por recalculo
  -- posterior, mesmo que produto_fornecedores mude depois.
  unidade_comercial         text not null,
  quantidade_comercial      numeric(12,3) not null,
  preco_unitario_comercial  numeric(12,4) not null,

  -- Fator de conversao USADO NESTA COMPRA especifica -- pode vir de
  -- produto_fornecedores.quantidade_embalagem, ser digitado manualmente,
  -- ou (Fase C) ser derivado do peso efetivamente recebido quando o
  -- item e de peso variavel. Nulo quando desconhecido -- nunca
  -- inventado.
  fator_conversao_base      numeric(12,3),

  -- SEMPRE derivado -- ver comentario de cabecalho desta secao.
  preco_unitario_base       numeric(12,4)
    generated always as (round(preco_unitario_comercial / fator_conversao_base, 4)) stored,

  data_compra               date not null,

  -- 'manual': lancamento historico digitado por um humano.
  -- 'recebimento_pedido': viria do recebimento confirmado de um pedido
  -- (Fase C) -- nenhum registro deste tipo existe ainda nesta migration.
  origem                    text not null,

  observacao                text,

  -- Autoria/timestamps -- nunca setados pelo cliente, forcados pela
  -- trigger produtos_historico_compras_protecao abaixo. atualizado_em
  -- registra a ultima correcao de um lancamento manual (origem='manual'
  -- e o unico caso em que UPDATE e permitido -- ver RLS abaixo).
  criado_por                uuid references auth.users(id) on delete set null,
  criado_em                 timestamptz not null default now(),
  atualizado_em              timestamptz not null default now(),

  constraint produtos_historico_compras_unidade_comercial_nao_vazia_check
    check (btrim(unidade_comercial) <> ''),

  constraint produtos_historico_compras_quantidade_comercial_positiva_check
    check (quantidade_comercial > 0),

  constraint produtos_historico_compras_preco_comercial_nao_negativo_check
    check (preco_unitario_comercial >= 0),

  constraint produtos_historico_compras_fator_conversao_positivo_check
    check (fator_conversao_base is null or fator_conversao_base > 0),

  -- Redundante com as duas constraints acima (se preco_comercial>=0 e
  -- fator>0, o quociente ja e >=0) -- mantida mesmo assim como
  -- documentacao explicita da invariante, mesmo espirito de clareza ja
  -- usado em outras migrations deste projeto.
  constraint produtos_historico_compras_preco_base_nao_negativo_check
    check (preco_unitario_base is null or preco_unitario_base >= 0),

  constraint produtos_historico_compras_origem_valida_check
    check (origem in ('manual', 'recebimento_pedido'))
);

comment on table public.produtos_historico_compras is
  'Historico de compras EFETIVAS por produto e fornecedor -- nunca de cotacao. preco_unitario_comercial e quantidade_comercial preservam o snapshot exato da transacao (nunca reescritos); preco_unitario_base e SEMPRE derivado (coluna GENERATED, nunca escrito diretamente), unica base usada para "ultimo preco"/"menor preco" comprado (ver view produtos_resumo_compras). origem=manual e corrigivel por quem tem catalogo_produtos.editar; origem=recebimento_pedido (Fase C futura) e imutavel e so criavel por uma RPC dedicada, nunca pela RLS normal desta tabela.';

comment on column public.produtos_historico_compras.fator_conversao_base is
  'Quantas unidades da base do produto equivalem a 1 unidade_comercial NESTA compra. Nulo quando desconhecido -- neste caso preco_unitario_base tambem fica nulo e a linha nao entra em nenhuma comparacao de "menor/ultimo preco", mas continua visivel como registro bruto da compra. Para item de peso variavel, este fator deve vir do peso efetivamente recebido, nunca de uma estimativa fixa.';

comment on column public.produtos_historico_compras.preco_unitario_base is
  'SEMPRE derivado (GENERATED ALWAYS AS, STORED) -- nunca informado pelo cliente. round(preco_unitario_comercial / fator_conversao_base, 4), NULL quando fator_conversao_base for NULL. Estruturalmente impossivel divergir dos dois campos que o originam.';

create index if not exists produtos_historico_compras_produto_id_data_idx
  on public.produtos_historico_compras (produto_id, data_compra desc);

create index if not exists produtos_historico_compras_produto_id_preco_base_idx
  on public.produtos_historico_compras (produto_id, preco_unitario_base)
  where preco_unitario_base is not null;


-- ------------------------------------------------------------
-- 4.1 RLS de produtos_historico_compras
-- ------------------------------------------------------------
alter table public.produtos_historico_compras enable row level security;

create policy produtos_historico_compras_select on public.produtos_historico_compras
  for select to authenticated
  using ((select public.has_permissao('catalogo_produtos.visualizar')));

-- INSERT restrito a origem='manual' -- impede que qualquer usuario com
-- catalogo_produtos.editar insira diretamente uma linha alegando
-- origem='recebimento_pedido' sem essa origem ser real. O caminho
-- automatico futuro (Fase C) precisara de uma RPC propria (mesmo
-- desenho de criar_pedido, migration 0022: SECURITY DEFINER,
-- BYPASSRLS via o dono da funcao, checagem explicita propria) para
-- poder inserir origem='recebimento_pedido' -- esta policy normal nunca
-- permite isso.
create policy produtos_historico_compras_insert on public.produtos_historico_compras
  for insert to authenticated
  with check (
    origem = 'manual'
    and (select public.has_permissao('catalogo_produtos.editar'))
  );

-- UPDATE tambem restrito a origem='manual' -- reforco de RLS junto com
-- a trigger abaixo (que bloqueia origem mudar e bloqueia qualquer
-- UPDATE quando a linha ja e origem<>'manual'). As duas camadas juntas
-- impedem tanto "editar um registro que nao e manual" quanto
-- "transformar um registro manual em recebimento_pedido" (ou o
-- contrario) por qualquer caminho.
create policy produtos_historico_compras_update on public.produtos_historico_compras
  for update to authenticated
  using (
    origem = 'manual'
    and (select public.has_permissao('catalogo_produtos.editar'))
  )
  with check (
    origem = 'manual'
    and (select public.has_permissao('catalogo_produtos.editar'))
  );

-- Sem policy de DELETE -- historico de compra nunca e apagado
-- fisicamente, nem lancamento manual errado. Uma correcao usa UPDATE
-- (permitido so para origem=manual); um lancamento manual genuinamente
-- indevido precisa de tratamento operacional fora desta migration, nao
-- de exclusao silenciosa.


-- ------------------------------------------------------------
-- 4.2 Trigger de protecao -- autoria, imutabilidade, bloqueio de edicao
--     de registros nao-manuais
-- ------------------------------------------------------------
-- SECURITY INVOKER -- mesmo raciocinio de produto_fornecedores_protecao
-- acima: nenhuma leitura fora do que o proprio chamador ja enxerga
-- nesta linha.
create or replace function public.produtos_historico_compras_protecao()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    new.criado_em := now();
    new.atualizado_em := now();
    return new;

  elsif tg_op = 'UPDATE' then
    if new.produto_id is distinct from old.produto_id then
      raise exception 'produtos_historico_compras: produto_id e imutavel.';
    end if;
    if new.fornecedor_id is distinct from old.fornecedor_id then
      raise exception 'produtos_historico_compras: fornecedor_id e imutavel.';
    end if;
    if new.origem is distinct from old.origem then
      raise exception 'produtos_historico_compras: origem e imutavel -- nao e possivel transformar um lancamento manual em recebimento_pedido, nem o contrario.';
    end if;
    if new.criado_por is distinct from old.criado_por then
      raise exception 'produtos_historico_compras: criado_por e imutavel.';
    end if;
    if new.criado_em is distinct from old.criado_em then
      raise exception 'produtos_historico_compras: criado_em e imutavel.';
    end if;

    -- Redundante com a RLS de UPDATE (que ja filtra origem='manual' no
    -- USING), mantido como segunda camada: mesmo que a RLS um dia mude
    -- por engano, esta trigger sozinha ja impede editar um registro
    -- origem='recebimento_pedido'.
    if old.origem <> 'manual' then
      raise exception 'produtos_historico_compras: registro de origem=% nao pode ser editado pelo Catalogo.', old.origem;
    end if;

    new.atualizado_em := now();
    return new;
  end if;

  return null;
end;
$$;

comment on function public.produtos_historico_compras_protecao() is
  'BEFORE INSERT/UPDATE em produtos_historico_compras. INSERT: forca criado_por/criado_em/atualizado_em. UPDATE: bloqueia produto_id/fornecedor_id/origem/criado_por/criado_em imutaveis, bloqueia qualquer UPDATE quando a linha ja nao e origem=manual (segunda camada alem da RLS), forca atualizado_em. preco_unitario_base nunca e tocado aqui -- e coluna GENERATED, o Postgres a recalcula sozinho.';

drop trigger if exists produtos_historico_compras_protecao_trigger on public.produtos_historico_compras;
create trigger produtos_historico_compras_protecao_trigger
  before insert or update on public.produtos_historico_compras
  for each row
  execute function public.produtos_historico_compras_protecao();


-- ============================================================
-- 5. public.produtos_resumo_compras (view) -- 3 conceitos distintos,
--    nunca confundidos entre si
-- ============================================================
-- security_invoker=true e OBRIGATORIO aqui, nao cosmetico: sem essa
-- opcao, uma view no Postgres avalia permissoes (inclusive RLS das
-- tabelas base) usando a identidade do DONO da view, nao de quem
-- efetivamente consulta -- como as tabelas deste projeto sao
-- tipicamente owned pelo papel que aplica as migrations (que nao sofre
-- RLS por ser dono), uma view sem security_invoker aqui vazaria TODAS
-- as linhas de produtos_historico_compras para qualquer authenticated
-- com SELECT na view, independente de catalogo_produtos.visualizar --
-- exatamente o tipo de bypass de RLS que uma revisao de seguranca
-- precisa pegar. Com security_invoker=true, a view roda com os
-- privilegios de quem a consulta, entao a RLS de
-- produtos_historico_compras (secao 4.1 acima) e respeitada
-- normalmente.
--
-- Tres conceitos deliberadamente separados, com colunas prefixadas para
-- nunca serem confundidas:
--   * ultima_compra_* -- o registro CRONOLOGICAMENTE mais recente,
--     independente de ter conversao para a unidade base conhecida. Sem
--     este conceito separado, uma compra de agosto sem conversao ainda
--     conhecida (ex. "peca" sem peso confirmado) ficaria invisivel como
--     "ultima compra", e uma compra de julho comparavel apareceria
--     incorretamente como a mais recente -- factualmente errado.
--     ultima_compra_preco_base pode vir NULL (quando aquela compra
--     especifica nao tem conversao conhecida) -- isso e esperado, nao e
--     erro.
--   * ultimo_preco_base_* -- o registro comparavel (preco_unitario_base
--     nao nulo) mais recente. Pode ser uma compra ANTERIOR a
--     ultima_compra_data, exatamente no exemplo acima (julho comparavel
--     seria o ultimo_preco_base mesmo com agosto sendo a ultima_compra).
--   * menor_preco_base_* -- o menor preco_unitario_base ja registrado
--     (so entre os comparaveis), com empate resolvido pela compra mais
--     recente e depois por criterio estavel (criado_em desc, id desc).
--
-- Todos os tres so existem para produtos que ja tem pelo menos 1 linha
-- em produtos_historico_compras -- ultima_compra e a base (LEFT JOIN
-- para os outros dois, que podem nao existir se nenhuma compra daquele
-- produto tiver conversao conhecida ainda). Nada disso e persistido em
-- public.produtos -- e sempre recalculado na leitura.
create view public.produtos_resumo_compras
with (security_invoker = true) as
with ultima_compra as (
  select distinct on (produto_id)
    produto_id,
    fornecedor_id as ultima_compra_fornecedor_id,
    unidade_comercial as ultima_compra_unidade_comercial,
    preco_unitario_comercial as ultima_compra_preco_comercial,
    preco_unitario_base as ultima_compra_preco_base,
    data_compra as ultima_compra_data
  from public.produtos_historico_compras
  order by produto_id, data_compra desc, criado_em desc, id desc
),
ultimo_preco_base as (
  select distinct on (produto_id)
    produto_id,
    fornecedor_id as ultimo_preco_base_fornecedor_id,
    preco_unitario_base as ultimo_preco_base_valor,
    data_compra as ultimo_preco_base_data
  from public.produtos_historico_compras
  where preco_unitario_base is not null
  order by produto_id, data_compra desc, criado_em desc, id desc
),
menor_preco_base as (
  select distinct on (produto_id)
    produto_id,
    fornecedor_id as menor_preco_base_fornecedor_id,
    preco_unitario_base as menor_preco_base_valor,
    data_compra as menor_preco_base_data
  from public.produtos_historico_compras
  where preco_unitario_base is not null
  order by produto_id, preco_unitario_base asc, data_compra desc, criado_em desc, id desc
)
select
  ultima_compra.produto_id,
  ultima_compra.ultima_compra_data,
  ultima_compra.ultima_compra_fornecedor_id,
  ultima_compra.ultima_compra_unidade_comercial,
  ultima_compra.ultima_compra_preco_comercial,
  ultima_compra.ultima_compra_preco_base,
  ultimo_preco_base.ultimo_preco_base_valor,
  ultimo_preco_base.ultimo_preco_base_data,
  ultimo_preco_base.ultimo_preco_base_fornecedor_id,
  menor_preco_base.menor_preco_base_valor,
  menor_preco_base.menor_preco_base_data,
  menor_preco_base.menor_preco_base_fornecedor_id
from ultima_compra
left join ultimo_preco_base using (produto_id)
left join menor_preco_base using (produto_id);

comment on view public.produtos_resumo_compras is
  'Tres conceitos distintos por produto, nunca confundidos: ultima_compra_* (registro cronologicamente mais recente, mesmo sem conversao para a base conhecida -- ultima_compra_preco_base pode ser NULL), ultimo_preco_base_* (registro comparavel mais recente, so entre os que tem preco_unitario_base preenchido -- pode ser mais antigo que ultima_compra_data), menor_preco_base_* (menor preco_unitario_base ja registrado, empate por compra mais recente). security_invoker=true: a view respeita a RLS de produtos_historico_compras do usuario que consulta, nao do dono da view. Nada aqui e persistido em produtos -- sempre recalculado na leitura.';


-- ============================================================
-- 6. SEED -- novos codigos no catalogo de permissoes
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('catalogo_produtos.visualizar', 'catalogo_produtos', 'visualizar', 'Ver o Catalogo de Produtos: cadastro de produtos, fornecedores por produto e historico de compras.'),
  ('catalogo_produtos.editar',     'catalogo_produtos', 'editar',     'Cadastrar/editar/inativar produtos do Catalogo, suas configuracoes comerciais por fornecedor (produto_fornecedores), e lancar/corrigir historico de compras manual (produtos_historico_compras, somente origem=manual).');

-- proprietario_admin preserva "acesso total": concede os 2 codigos
-- novos explicitamente (mesmo padrao ja usado nas migrations
-- 0016/0018/0022 -- o seed original de "todas as permissoes" da 0001
-- nao e retroativo a codigos criados depois). Nenhum outro perfil
-- recebe por padrao.
insert into public.perfil_permissoes (perfil, permissao)
select 'proprietario_admin', codigo
from public.permissoes
where codigo in ('catalogo_produtos.visualizar', 'catalogo_produtos.editar');

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro para tudo que esta migration CRIA: 2 tabelas novas (sem dado
-- pre-existente a perder), 1 view nova, 1 coluna nova em produtos (sem
-- nenhum valor preenchido para as 390 linhas existentes), 2 codigos de
-- permissao novos -- nenhuma outra migration/policy/trigger do projeto
-- depende de nada criado aqui.
--
-- ATENCAO: reverte tambem a RLS de escrita de produtos para
-- is_admin() puro (recriando as policies com os nomes e definicoes
-- exatas da migration 0005b) -- se este rollback for executado depois
-- de qualquer INSERT/UPDATE em produtos feito via
-- catalogo_produtos.editar por um usuario que NAO seja
-- proprietario_admin, o dado gravado permanece, so o mecanismo de
-- autorizacao de escritas futuras volta a exigir is_admin().
-- BEGIN;
-- delete from public.perfil_permissoes where permissao in
--   ('catalogo_produtos.visualizar', 'catalogo_produtos.editar');
-- delete from public.permissoes where codigo in
--   ('catalogo_produtos.visualizar', 'catalogo_produtos.editar');
--
-- drop view if exists public.produtos_resumo_compras;
--
-- drop trigger if exists produtos_historico_compras_protecao_trigger on public.produtos_historico_compras;
-- drop function if exists public.produtos_historico_compras_protecao();
-- drop table if exists public.produtos_historico_compras; -- ATENCAO: apaga todo historico ja lancado
--
-- drop trigger if exists produto_fornecedores_protecao_trigger on public.produto_fornecedores;
-- drop function if exists public.produto_fornecedores_protecao();
-- drop table if exists public.produto_fornecedores; -- ATENCAO: apaga todo cadastro ja feito
--
-- drop policy if exists produtos_update_catalogo on public.produtos;
-- create policy produtos_update_admin on public.produtos
--   for update to authenticated
--   using ((select public.is_admin()))
--   with check ((select public.is_admin()));
--
-- drop policy if exists produtos_insert_catalogo on public.produtos;
-- create policy produtos_insert_admin on public.produtos
--   for insert to authenticated
--   with check ((select public.is_admin()));
--
-- drop index if exists produtos_codigo_g3_unico_idx;
-- alter table public.produtos drop constraint if exists produtos_codigo_g3_nao_vazio_check;
-- alter table public.produtos drop column if exists codigo_g3; -- ATENCAO: apaga qualquer G3 ja preenchido manualmente
-- COMMIT;
