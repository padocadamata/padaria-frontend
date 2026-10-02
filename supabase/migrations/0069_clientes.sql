-- 0069_clientes.sql
-- CLIENTES | PADOCA DA MATA -- cadastro operacional simples de clientes e
-- dos produtos do Catalogo pelos quais cada cliente tem interesse, para
-- contato MANUAL (ex.: "quem gosta de LUA DE MEL?"). Nao e CRM: sem
-- WhatsApp, campanhas, mensagens, vendas, fidelidade ou financeiro.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Rode manualmente no Supabase SQL Editor,
-- depois de conferir a pre-auditoria (pre_auditoria_0069_clientes_EXECUTAR.sql).
--
-- ============================================================
-- DIAGNOSTICO QUE FUNDAMENTA ESTA MIGRATION (codigo/schema real)
-- ============================================================
--   * Nao existe nenhuma tabela, permissao, rota ou RPC de cliente/
--     consumidor/interesse no sistema ate a 0068.
--   * Fonte de produtos = public.produtos (cadastro mestre do Catalogo,
--     0023/0028; id uuid; ativo boolean). public.produtos nasceu como
--     catalogo de INSUMOS (comentario de receita_ingredientes.produto_id,
--     0012) e hoje reune insumos, revenda e os produtos feitos pela
--     Padoca. Nao ha coluna estrutural "vendavel".
--   * "Produto de Producao" (0034/0035) e o UNICO marcador estrutural de
--     produto feito pela Padoca: public.receitas.catalogo_produto_id
--     (UNIQUE, FK para produtos) com receitas.ativo. Revenda e Insumo sao
--     categorias de dado (catalogo_categorias, 0028) -- convencao por nome
--     ja usada pelo proprio sistema (0012: categoria 'Insumo').
--
-- ELEGIBILIDADE EXPLICITA (decisao apos a PRE real: inferir por
-- Producao/Revenda deixava de fora LUA DE MEL CREME/DOCE DE LEITE e as
-- CAROLINA RECHEADA ... KG, que precisam ser associaveis):
--   * public.produtos ganha disponivel_interesse_cliente boolean NOT NULL
--     DEFAULT false -- FONTE DE VERDADE para NOVOS interesses. Produto
--     novo nunca fica disponivel sozinho: o administrador marca no
--     Catalogo ("Disponivel para interesse de clientes").
--   * BACKFILL INICIAL (so na execucao que CRIA a coluna -- reexecutar a
--     migration nunca remarca o que o administrador desmarcou depois):
--       a) produtos ativos que hoje sao Produto de Producao (receita
--          ativa vinculada) OU da categoria Revenda;
--       b) + 5 produtos reais apontados pela usuaria, localizados por
--          igualdade EXATA de nome normalizado (sem LIKE), cada um
--          precisando existir exatamente 1 vez -- senao a migration
--          ABORTA (nunca marca produto errado):
--            CAROLINA RECHEADA CHOCOLATE KG, CAROLINA RECHEADA DOCE DE
--            LEITE KG, CAROLINA RECHEADA LIMAO KG, LUA DE MEL CREME,
--            LUA DE MEL DOCE DE LEITE.
--       Producao/Revenda e esses 5 nomes servem SO para este backfill;
--       nenhuma regra permanente depende deles.
--   * Regra permanente (public.clientes_produto_elegivel): produto existe,
--     ativo = true e disponivel_interesse_cliente = true. Um interesse ja
--     gravado continua existindo (visivel como indisponivel/inativo) se o
--     produto for desmarcado ou inativado depois; pode ser removido, mas
--     nao readicionado enquanto nao voltar a ser elegivel.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   0. public.produtos.disponivel_interesse_cliente (nova coluna, NOT NULL
--      DEFAULT false) + backfill inicial descrito acima + indice parcial
--      para a busca. Nenhuma outra coluna/regra do Catalogo muda.
--   1. public.clientes -- nome (MAIUSCULAS, espacos colapsados), telefone
--      (somente digitos, padrao nacional DDD+numero, 10 ou 11 digitos,
--      UNICO entre todos os clientes, ativos ou nao), observacao livre
--      opcional, ativo, criado/atualizado em/por. Sem exclusao fisica.
--   2. public.clientes_produtos -- interesse cliente x produto (N:N),
--      PK (cliente_id, produto_id) impede duplicidade.
--   3. RLS: SELECT por clientes.visualizar; NENHUMA policy de escrita --
--      toda escrita so pelas RPCs abaixo (SECURITY DEFINER).
--   4. RPCs: salvar_cliente, definir_status_cliente,
--      buscar_produtos_interesse_cliente; helpers internos
--      clientes_normalizar_telefone e clientes_produto_elegivel.
--   5. Permissoes clientes.visualizar / clientes.editar (padrao
--      modulo.acao de 0001), concedidas so a proprietario_admin.
--
-- Esta migration NAO faz, e nao deve fazer:
--   * nenhuma alteracao em public.produtos alem da coluna nova (nomes,
--     status, secao, categoria, codigos intactos), nem em receitas,
--     catalogo_*, Producao, Pedidos, estoque ou excluir_produto_catalogo: o
--     interesse usa ON DELETE CASCADE -- a exclusao fisica de produto so
--     e possivel para produto sem uso (0029/0035) e, nesse caso, a
--     preferencia simplesmente deixa de existir;
--   * nenhuma normalizacao de dados antigos; nenhum seed de cliente;
--   * nenhuma integracao WhatsApp/mensageria, CPF, e-mail, endereco,
--     vendas ou financeiro.
--
-- Envolvida em transacao explicita (BEGIN/COMMIT).

BEGIN;

-- ============================================================
-- 0. Premissas -- aborta sem alterar nada se o banco nao estiver como
--    esperado.
-- ============================================================
do $$
begin
  if to_regclass('public.produtos') is null
     or to_regclass('public.receitas') is null
     or to_regclass('public.catalogo_categorias') is null then
    raise exception '0069 abortada: tabelas do Catalogo (produtos/receitas/catalogo_categorias) nao encontradas.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'receitas' and column_name = 'catalogo_produto_id')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'produtos' and column_name = 'categoria_id')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'produtos' and column_name = 'ativo') then
    raise exception '0069 abortada: colunas esperadas do Catalogo (0028/0034) nao encontradas.';
  end if;
  if to_regprocedure('public.has_permissao(text)') is null or to_regclass('public.usuarios') is null then
    raise exception '0069 abortada: has_permissao/usuarios nao encontrados.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'produtos'
             and column_name = 'disponivel_interesse_cliente' and (data_type <> 'boolean' or is_nullable <> 'NO')) then
    raise exception '0069 abortada: produtos.disponivel_interesse_cliente ja existe com outra definicao.';
  end if;
  if to_regclass('public.clientes') is not null and not exists (
       select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clientes' and column_name = 'telefone') then
    raise exception '0069 abortada: ja existe uma public.clientes com outra estrutura.';
  end if;
end $$;

-- ============================================================
-- 0b. public.produtos.disponivel_interesse_cliente + backfill inicial.
--     Coluna e backfill no MESMO bloco: o backfill so roda quando a coluna
--     e criada agora (reexecucao nunca sobrescreve decisoes do Catalogo).
-- ============================================================
do $$
declare
  v_nomes text[] := array[
    'CAROLINA RECHEADA CHOCOLATE KG',
    'CAROLINA RECHEADA DOCE DE LEITE KG',
    'CAROLINA RECHEADA LIMAO KG',
    'LUA DE MEL CREME',
    'LUA DE MEL DOCE DE LEITE'
  ];
  v_nome  text;
  v_ids   uuid[];
  v_todos uuid[] := '{}';
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'produtos' and column_name = 'disponivel_interesse_cliente') then
    raise notice '0069: produtos.disponivel_interesse_cliente ja existe -- backfill NAO reaplicado.';
    return;
  end if;

  -- Localiza os 5 produtos ANTES de qualquer alteracao: igualdade exata do
  -- nome normalizado (maiusculas, sem acento, espacos colapsados). Cada
  -- nome precisa casar com exatamente 1 produto.
  foreach v_nome in array v_nomes
  loop
    select coalesce(array_agg(p.id), '{}') into v_ids
    from public.produtos p
    where translate(upper(regexp_replace(btrim(p.nome), '\s+', ' ', 'g')),
                    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCAAAAAEEEEIIIIOOOOOUUUUC') = v_nome;
    if cardinality(v_ids) <> 1 then
      raise exception '0069 abortada: o produto "%" deveria existir exatamente 1 vez no Catalogo e foi encontrado % vez(es) -- nada foi alterado.', v_nome, cardinality(v_ids);
    end if;
    v_todos := v_todos || v_ids;
  end loop;

  alter table public.produtos
    add column disponivel_interesse_cliente boolean not null default false;

  -- a) universo inicial: Produto de Producao (receita ativa) OU Revenda, ativos.
  update public.produtos p
  set disponivel_interesse_cliente = true
  where p.ativo
    and (
      exists (select 1 from public.receitas r where r.catalogo_produto_id = p.id and r.ativo)
      or exists (select 1 from public.catalogo_categorias cc where cc.id = p.categoria_id and lower(btrim(cc.nome)) = 'revenda')
    );

  -- b) as 5 excecoes iniciais, pelos IDs localizados acima.
  update public.produtos
  set disponivel_interesse_cliente = true
  where id = any (v_todos);
end $$;

comment on column public.produtos.disponivel_interesse_cliente is
  'Migration 0069. true = o produto pode receber NOVOS interesses de clientes (modulo Clientes). Default false: produto novo so fica disponivel quando o administrador marca no Catalogo. Desmarcar nao apaga interesses ja existentes. Backfill inicial: Produto de Producao/Revenda ativos + 5 produtos indicados (LUA DE MEL CREME/DOCE DE LEITE, CAROLINA RECHEADA ... KG).';

create index if not exists produtos_disponivel_interesse_cliente_idx
  on public.produtos (nome)
  where disponivel_interesse_cliente and ativo;

-- ============================================================
-- 1. public.clientes
-- ============================================================
create table if not exists public.clientes (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  telefone        text not null,
  observacao      text,
  ativo           boolean not null default true,
  criado_por      uuid references auth.users(id) on delete set null,
  criado_em       timestamptz not null default now(),
  atualizado_por  uuid references auth.users(id) on delete set null,
  atualizado_em   timestamptz not null default now(),

  constraint clientes_nome_valido
    check (nome = upper(nome) and nome = btrim(nome) and nome !~ '\s{2,}' and nome <> '' and char_length(nome) <= 120),
  -- Telefone brasileiro em formato NACIONAL, so digitos: DDD (2 digitos,
  -- sem zero) + celular de 9 digitos comecando por 9, ou fixo de 8
  -- digitos (2..8). Internacional/E.164 e derivavel: '+55' || telefone.
  constraint clientes_telefone_valido
    check (telefone ~ '^[1-9]{2}(9[0-9]{8}|[2-8][0-9]{7})$'),
  constraint clientes_observacao_valida
    check (observacao is null or (observacao = btrim(observacao) and observacao <> '' and char_length(observacao) <= 1000))
);

comment on table public.clientes is
  'Migration 0069. Cliente da Padoca (cadastro operacional simples para contato manual). Nome em MAIUSCULAS; telefone so digitos (DDD+numero, unico); sem exclusao fisica -- usar ativo=false. Escrita somente via salvar_cliente/definir_status_cliente.';
comment on column public.clientes.telefone is
  'Somente digitos, formato nacional: DDD + numero (11 digitos celular 9XXXXXXXX ou 10 digitos fixo). Unico entre todos os clientes (inclusive inativos). E.164 = ''+55'' || telefone.';

create unique index if not exists clientes_telefone_unico on public.clientes (telefone);
create index if not exists clientes_nome_idx on public.clientes (nome);
create index if not exists clientes_ativo_idx on public.clientes (ativo);

-- ============================================================
-- 2. public.clientes_produtos -- interesse cliente x produto
-- ============================================================
create table if not exists public.clientes_produtos (
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  produto_id  uuid not null references public.produtos(id) on delete cascade,
  criado_por  uuid references auth.users(id) on delete set null,
  criado_em   timestamptz not null default now(),
  primary key (cliente_id, produto_id)
);

comment on table public.clientes_produtos is
  'Migration 0069. Produtos do Catalogo pelos quais o cliente tem interesse (N:N; PK impede duplicidade). Ao incluir, o produto precisa ser elegivel (clientes_produto_elegivel: ativo e disponivel_interesse_cliente); interesses ja gravados permanecem mesmo se o produto for inativado ou desmarcado depois. ON DELETE CASCADE em produto: so produto SEM uso pode ser excluido fisicamente (0029/0035) -- a preferencia acompanha.';

create index if not exists clientes_produtos_produto_idx on public.clientes_produtos (produto_id);

-- ============================================================
-- 3. RLS -- leitura por clientes.visualizar; nenhuma escrita direta.
-- ============================================================
alter table public.clientes enable row level security;
alter table public.clientes_produtos enable row level security;

drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes
  for select to authenticated
  using ((select public.has_permissao('clientes.visualizar')));

drop policy if exists clientes_produtos_select on public.clientes_produtos;
create policy clientes_produtos_select on public.clientes_produtos
  for select to authenticated
  using ((select public.has_permissao('clientes.visualizar')));

-- ============================================================
-- 4. Helpers internos (sem EXECUTE para papeis de API)
-- ============================================================
-- Telefone digitado -> so digitos, formato nacional. Aceita +55/0055 e
-- 0 de operadora antes de celular; devolve NULL quando nao resulta num numero
-- brasileiro valido.
create or replace function public.clientes_normalizar_telefone(p_telefone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g');
begin
  if v like '0055%' then v := substr(v, 5); end if;
  if length(v) in (12, 13) and v like '55%' then v := substr(v, 3); end if;
  -- 0 de operadora so com celular (0 + DDD + 9 digitos = 12): com 11
  -- digitos seria ambiguo (DDD digitado errado viraria outro numero).
  if length(v) = 12 and v like '0%' then v := substr(v, 2); end if;
  if v ~ '^[1-9]{2}(9[0-9]{8}|[2-8][0-9]{7})$' then
    return v;
  end if;
  return null;
end;
$$;

comment on function public.clientes_normalizar_telefone(text) is
  'Migration 0069 (interna). Normaliza telefone brasileiro para so digitos DDD+numero (aceita mascara, +55, 0055, 0 inicial antes de celular). NULL quando invalido.';

create or replace function public.clientes_produto_elegivel(p_produto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.produtos p
    where p.id = p_produto_id
      and p.ativo
      and p.disponivel_interesse_cliente
  );
$$;

comment on function public.clientes_produto_elegivel(uuid) is
  'Migration 0069 (interna). Produto pode receber NOVO interesse de cliente: existe, ativo = true e disponivel_interesse_cliente = true (marcacao explicita do Catalogo). Nao depende de receita nem de categoria.';

revoke execute on function public.clientes_normalizar_telefone(text) from public, anon, authenticated, service_role;
revoke execute on function public.clientes_produto_elegivel(uuid) from public, anon, authenticated, service_role;

-- ============================================================
-- 5. RPC salvar_cliente -- cria (p_cliente_id NULL) ou atualiza, e
--    sincroniza o conjunto de produtos de interesse, atomicamente.
-- ============================================================
create or replace function public.salvar_cliente(
  p_cliente_id  uuid,
  p_nome        text,
  p_telefone    text,
  p_observacao  text,
  p_produto_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id          uuid;
  v_nome        text := upper(regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g'));
  v_telefone    text := public.clientes_normalizar_telefone(p_telefone);
  v_observacao  text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_existente   record;
  v_produtos    uuid[];
  v_produto     uuid;
begin
  if not (select public.has_permissao('clientes.editar')) then
    raise exception using errcode = '42501',
      message = 'salvar_cliente: requer a permissao clientes.editar.';
  end if;

  if v_nome = '' then
    raise exception 'salvar_cliente: informe o nome do cliente.';
  end if;
  if char_length(v_nome) > 120 then
    raise exception 'salvar_cliente: nome muito longo (maximo 120 caracteres).';
  end if;
  if v_telefone is null then
    raise exception 'salvar_cliente: telefone invalido -- informe DDD + numero (celular com 9 digitos ou fixo com 8).';
  end if;
  if v_observacao is not null and char_length(v_observacao) > 1000 then
    raise exception 'salvar_cliente: observacao muito longa (maximo 1000 caracteres).';
  end if;

  if p_cliente_id is not null and not exists (select 1 from public.clientes where id = p_cliente_id) then
    raise exception 'salvar_cliente: cliente % nao encontrado.', p_cliente_id;
  end if;

  -- Duplicidade: telefone e a identidade pratica do contato. Mensagem
  -- amigavel com o nome do cadastro existente (o indice unico garante
  -- contra corrida).
  select c.id, c.nome, c.ativo into v_existente
  from public.clientes c
  where c.telefone = v_telefone and c.id is distinct from p_cliente_id
  limit 1;
  if v_existente.id is not null then
    raise exception 'salvar_cliente: telefone ja cadastrado para % (%).', v_existente.nome, case when v_existente.ativo then 'ativo' else 'inativo' end;
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_produtos
  from unnest(coalesce(p_produto_ids, '{}'::uuid[])) as x
  where x is not null;

  begin
    if p_cliente_id is null then
      insert into public.clientes (nome, telefone, observacao, criado_por, atualizado_por)
      values (v_nome, v_telefone, v_observacao, auth.uid(), auth.uid())
      returning id into v_id;
    else
      update public.clientes
      set nome = v_nome,
          telefone = v_telefone,
          observacao = v_observacao,
          atualizado_por = auth.uid(),
          atualizado_em = now()
      where id = p_cliente_id;
      v_id := p_cliente_id;
    end if;
  exception
    when unique_violation then
      raise exception 'salvar_cliente: telefone ja cadastrado para outro cliente.';
  end;

  -- Interesses removidos.
  delete from public.clientes_produtos cp
  where cp.cliente_id = v_id and not (cp.produto_id = any (v_produtos));

  -- Interesses novos: precisam ser elegiveis. Os ja existentes ficam como
  -- estao (mesmo que o produto tenha sido inativado depois).
  foreach v_produto in array v_produtos
  loop
    if not exists (select 1 from public.clientes_produtos where cliente_id = v_id and produto_id = v_produto) then
      if not exists (select 1 from public.produtos where id = v_produto) then
        raise exception 'salvar_cliente: produto % nao encontrado no Catalogo.', v_produto;
      end if;
      if not public.clientes_produto_elegivel(v_produto) then
        raise exception 'salvar_cliente: o produto "%" nao pode ser associado a clientes (precisa estar ativo e marcado como disponivel para interesse de clientes no Catalogo).',
          (select nome from public.produtos where id = v_produto);
      end if;
      insert into public.clientes_produtos (cliente_id, produto_id, criado_por)
      values (v_id, v_produto, auth.uid());
    end if;
  end loop;

  return v_id;
end;
$$;

comment on function public.salvar_cliente(uuid, text, text, text, uuid[]) is
  'Migration 0069. Cria (p_cliente_id NULL) ou atualiza 1 cliente e sincroniza o conjunto de produtos de interesse numa unica transacao. Nome -> MAIUSCULAS com espacos colapsados; telefone -> so digitos (clientes_normalizar_telefone), obrigatorio e unico (mensagem com o cadastro existente); observacao livre opcional (nao vira maiuscula). Interesses: remove os que sairam; inclui os novos somente se elegiveis (clientes_produto_elegivel); mantem os existentes. Nao altera status (ver definir_status_cliente). Requer clientes.editar.';

revoke execute on function public.salvar_cliente(uuid, text, text, text, uuid[]) from public;
revoke execute on function public.salvar_cliente(uuid, text, text, text, uuid[]) from anon;
revoke execute on function public.salvar_cliente(uuid, text, text, text, uuid[]) from service_role;
grant execute on function public.salvar_cliente(uuid, text, text, text, uuid[]) to authenticated;

-- ============================================================
-- 6. RPC definir_status_cliente -- ativar/inativar (sem exclusao fisica)
-- ============================================================
create or replace function public.definir_status_cliente(p_cliente_id uuid, p_ativo boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.has_permissao('clientes.editar')) then
    raise exception using errcode = '42501',
      message = 'definir_status_cliente: requer a permissao clientes.editar.';
  end if;
  if p_ativo is null then
    raise exception 'definir_status_cliente: informe o status.';
  end if;
  update public.clientes
  set ativo = p_ativo, atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_cliente_id;
  if not found then
    raise exception 'definir_status_cliente: cliente % nao encontrado.', p_cliente_id;
  end if;
end;
$$;

comment on function public.definir_status_cliente(uuid, boolean) is
  'Migration 0069. Ativa/inativa 1 cliente (preserva cadastro e interesses -- nunca exclui). Requer clientes.editar.';

revoke execute on function public.definir_status_cliente(uuid, boolean) from public;
revoke execute on function public.definir_status_cliente(uuid, boolean) from anon;
revoke execute on function public.definir_status_cliente(uuid, boolean) from service_role;
grant execute on function public.definir_status_cliente(uuid, boolean) to authenticated;

-- ============================================================
-- 7. RPC buscar_produtos_interesse_cliente -- seletor com busca (nunca
--    carrega o Catalogo inteiro).
-- ============================================================
create or replace function public.buscar_produtos_interesse_cliente(p_termo text, p_limite integer default 50)
returns table (
  id    uuid,
  nome  text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_termo  text := btrim(coalesce(p_termo, ''));
  v_padrao text := replace(replace(replace(btrim(coalesce(p_termo, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_limite integer := least(greatest(coalesce(p_limite, 50), 1), 50);
begin
  if not (select public.has_permissao('clientes.visualizar')) then
    raise exception using errcode = '42501',
      message = 'buscar_produtos_interesse_cliente: requer a permissao clientes.visualizar.';
  end if;

  return query
  select p.id, p.nome
  from public.produtos p
  where p.ativo
    and p.disponivel_interesse_cliente
    and (v_termo = '' or p.nome ilike '%' || v_padrao || '%')
  order by
    case when v_termo <> '' and p.nome ilike v_padrao || '%' then 0 else 1 end,
    p.nome
  limit v_limite;
end;
$$;

comment on function public.buscar_produtos_interesse_cliente(text, integer) is
  'Migration 0069. Busca (por nome, ilike, curingas do termo tratados como texto) produtos com ativo = true e disponivel_interesse_cliente = true -- no maximo 50 por chamada (padrao e teto), nomes que comecam com o termo primeiro. Nunca devolve o Catalogo inteiro. Requer clientes.visualizar.';

revoke execute on function public.buscar_produtos_interesse_cliente(text, integer) from public;
revoke execute on function public.buscar_produtos_interesse_cliente(text, integer) from anon;
revoke execute on function public.buscar_produtos_interesse_cliente(text, integer) from service_role;
grant execute on function public.buscar_produtos_interesse_cliente(text, integer) to authenticated;

-- ============================================================
-- 8. Permissoes (padrao modulo.acao, 0001) -- so proprietario_admin.
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('clientes.visualizar', 'clientes', 'visualizar', 'Ver clientes, telefones e produtos de interesse.'),
  ('clientes.editar',     'clientes', 'editar',     'Cadastrar e editar clientes, seus produtos de interesse e ativar/inativar.')
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil, permissao) values
  ('proprietario_admin', 'clientes.visualizar'),
  ('proprietario_admin', 'clientes.editar')
on conflict do nothing;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO: apaga clientes cadastrados e a marcacao "disponivel para
-- interesse de clientes" do Catalogo. Nenhuma outra tabela e afetada.
-- BEGIN;
-- drop function if exists public.buscar_produtos_interesse_cliente(text, integer);
-- drop function if exists public.definir_status_cliente(uuid, boolean);
-- drop function if exists public.salvar_cliente(uuid, text, text, text, uuid[]);
-- drop function if exists public.clientes_produto_elegivel(uuid);
-- drop function if exists public.clientes_normalizar_telefone(text);
-- drop index if exists public.produtos_disponivel_interesse_cliente_idx;
-- alter table public.produtos drop column if exists disponivel_interesse_cliente;
-- drop table if exists public.clientes_produtos;
-- drop table if exists public.clientes;
-- delete from public.perfil_permissoes where permissao in ('clientes.visualizar', 'clientes.editar');
-- delete from public.usuario_permissoes where permissao in ('clientes.visualizar', 'clientes.editar');
-- delete from public.permissoes where codigo in ('clientes.visualizar', 'clientes.editar');
-- COMMIT;
