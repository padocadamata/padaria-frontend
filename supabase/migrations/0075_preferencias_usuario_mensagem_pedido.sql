-- 0075_preferencias_usuario_mensagem_pedido.sql
-- Rodada 3 de UX: Favoritos por usuario, personalizacao do Dashboard por
-- usuario e o modelo GLOBAL da mensagem de pedido (Pedidos > Gerar
-- mensagem).
--
-- NAO EXECUTADA AUTOMATICAMENTE. Aplicar manualmente no SQL Editor, depois do
-- PREAUDIT.
--
-- ESCOPO -- SOMENTE:
--   1. public.usuario_favoritos -- 1 linha por (usuario, tela favorita). A
--      chave e o identificador ESTAVEL da tela (ex.: 'pedidos.resumo'); rota,
--      rotulo, icone e permissao continuam definidos so no frontend
--      (lib/nav/navegacao.js). Favorito nunca concede acesso: cada tela segue
--      protegida pela propria permissao/RLS.
--   2. public.usuario_dashboard_layout -- 1 linha por usuario, so quando ele
--      personaliza o Dashboard: ordem + tamanho (P/M/G) dos widgets, por id
--      estavel. Sem linha = layout padrao. Validado por
--      public.dashboard_layout_valido(jsonb).
--   3. public.pedidos_mensagem_config -- linha UNICA com o modelo global da
--      mensagem de pedido. Le quem ve Pedidos; altera SOMENTE
--      proprietario_admin (is_admin(), 0003), garantido por RLS.
--   4. Triggers que derivam identidade/autoria no SERVIDOR (auth.uid()),
--      nunca do que o cliente enviar -- mesmo padrao de
--      dashboard_lembretes_preencher_usuario (0021).
--
-- NAO FAZ: nenhuma permissao nova (reaproveita dashboard.visualizar,
-- pedidos.visualizar e is_admin()); nenhuma RPC; nenhuma alteracao em
-- tabela/funcao/policy existente; nenhum backfill (ausencia de linha =
-- comportamento padrao); nenhum DELETE/UPDATE de dado existente.
--
-- Decisoes de seguranca:
--   * Preferencias: RLS "so a propria linha" (usuario_id = auth.uid()) para
--     ler/gravar; gravar exige tambem dashboard.visualizar (favoritos e
--     layout so aparecem no Dashboard). usuario_id e forcado para auth.uid()
--     no INSERT e imutavel no UPDATE.
--   * Modelo global: SELECT para pedidos.visualizar ou admin; UPDATE so com
--     is_admin(); sem policy de INSERT/DELETE (linha unica criada aqui).
--     Coluna-a-coluna: authenticated so pode UPDATE em template.
--     atualizado_em/atualizado_por/atualizado_por_nome preenchidos pelo
--     trigger.
--   * Grants minimos: anon/public sem nada; authenticated so o necessario.
--
-- Transacional (BEGIN/COMMIT). Aborta sem criar nada se os pressupostos nao
-- forem verdadeiros ou se algum objeto desta migration ja existir.

BEGIN;

-- ============================================================
-- 0. Guarda de ambiente
-- ============================================================
DO $$
begin
  if to_regprocedure('public.has_permissao(text)') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regclass('public.usuarios') is null
     or to_regclass('public.permissoes') is null
     or to_regclass('public.pedidos') is null
     or to_regclass('public.pedido_itens') is null then
    raise exception '0075 abortada: objetos base (has_permissao/is_admin/usuarios/permissoes/pedidos/pedido_itens) nao encontrados.';
  end if;

  if (select count(*) from public.permissoes where codigo in ('dashboard.visualizar', 'pedidos.visualizar')) <> 2 then
    raise exception '0075 abortada: permissoes dashboard.visualizar/pedidos.visualizar nao encontradas.';
  end if;

  if not exists (
    select 1 from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = 'public.usuarios'::regclass and (i.indisprimary or i.indisunique)
      and i.indnatts = 1 and a.attname = 'id'
  ) then
    raise exception '0075 abortada: public.usuarios.id sem chave primaria/unica (necessaria para as FKs).';
  end if;

  if (select count(*) from pg_attribute
       where attrelid = 'public.usuarios'::regclass and attnum > 0 and not attisdropped
         and attname in ('id', 'nome', 'ativo')) <> 3 then
    raise exception '0075 abortada: colunas esperadas (id/nome/ativo) ausentes em public.usuarios.';
  end if;

  if to_regclass('public.usuario_favoritos') is not null
     or to_regclass('public.usuario_dashboard_layout') is not null
     or to_regclass('public.pedidos_mensagem_config') is not null
     or to_regprocedure('public.dashboard_layout_valido(jsonb)') is not null
     or to_regprocedure('public.preferencias_usuario_preencher()') is not null
     or to_regprocedure('public.usuario_favoritos_limitar()') is not null
     or to_regprocedure('public.pedidos_mensagem_config_preencher()') is not null then
    raise exception '0075 abortada: objetos desta migration ja existem -- ela ja parece aplicada.';
  end if;
end $$;

-- ============================================================
-- 1. Validacao do layout do Dashboard
-- ============================================================
-- Array de ate 40 objetos {id, tamanho}, sem chaves extras, id no formato
-- [a-z0-9_]{1,40} e sem repeticao, tamanho em P/M/G. Espelhada no frontend
-- por layoutValidoParaBanco (lib/dashboard/layout.js).
create function public.dashboard_layout_valido(p_widgets jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_ids text[] := '{}';
begin
  if p_widgets is null or jsonb_typeof(p_widgets) <> 'array' or jsonb_array_length(p_widgets) > 40 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_widgets) loop
    if jsonb_typeof(v_item) <> 'object' then
      return false;
    end if;
    if exists (select 1 from jsonb_object_keys(v_item) k where k not in ('id', 'tamanho')) then
      return false;
    end if;
    if coalesce(jsonb_typeof(v_item -> 'id'), '') <> 'string'
       or (v_item ->> 'id') !~ '^[a-z0-9_]{1,40}$'
       or (v_item ->> 'id') = any (v_ids) then
      return false;
    end if;
    if coalesce(jsonb_typeof(v_item -> 'tamanho'), '') <> 'string'
       or (v_item ->> 'tamanho') not in ('P', 'M', 'G') then
      return false;
    end if;
    v_ids := v_ids || (v_item ->> 'id');
  end loop;
  return true;
end;
$$;

comment on function public.dashboard_layout_valido(jsonb) is
  'Migration 0075. Valida o layout do Dashboard: array (max 40) de {id, tamanho}, id [a-z0-9_]{1,40} sem repeticao, tamanho P/M/G, sem chaves extras. Usada no CHECK de usuario_dashboard_layout.widgets.';

-- ============================================================
-- 2. public.usuario_favoritos
-- ============================================================
create table public.usuario_favoritos (
  usuario_id  uuid not null default auth.uid()
    references public.usuarios(id) on delete cascade,
  chave       text not null,
  criado_em   timestamptz not null default now(),

  constraint usuario_favoritos_pkey primary key (usuario_id, chave),
  constraint usuario_favoritos_chave_formato
    check (char_length(chave) <= 60 and chave ~ '^[a-z0-9_]+(\.[a-z0-9_-]+)?$')
);

comment on table public.usuario_favoritos is
  'Migration 0075. Telas favoritas de cada usuario (atalhos no topo do Dashboard). chave = identificador estavel da tela no catalogo de navegacao do frontend (ex.: pedidos.resumo); nada de URL livre. Favorito nunca concede acesso: o frontend so mostra os que o usuario ainda pode abrir, e cada tela segue protegida pela propria permissao/RLS. Maximo de 40 por usuario (trigger usuario_favoritos_limitar).';
comment on column public.usuario_favoritos.usuario_id is
  'Dono do favorito -- sempre auth.uid() (forcado pelo trigger preferencias_usuario_preencher; RLS so permite a propria linha).';

-- ============================================================
-- 3. public.usuario_dashboard_layout
-- ============================================================
create table public.usuario_dashboard_layout (
  usuario_id     uuid primary key default auth.uid()
    references public.usuarios(id) on delete cascade,
  widgets        jsonb not null,
  atualizado_em  timestamptz not null default now(),

  constraint usuario_dashboard_layout_widgets_validos
    check (public.dashboard_layout_valido(widgets))
);

comment on table public.usuario_dashboard_layout is
  'Migration 0075. Personalizacao do Dashboard por usuario: ordem e tamanho (P/M/G) dos widgets, por id estavel. Sem linha = layout padrao (o frontend apaga a linha quando o usuario restaura o padrao). Widgets novos sempre aparecem (o frontend mescla com o catalogo atual) e ids que deixaram de existir sao ignorados.';

-- ============================================================
-- 4. public.pedidos_mensagem_config (linha unica)
-- ============================================================
create table public.pedidos_mensagem_config (
  id                   boolean primary key default true check (id),
  template             text not null,
  atualizado_em        timestamptz not null default now(),
  atualizado_por       uuid references auth.users(id) on delete set null,
  atualizado_por_nome  text,

  constraint pedidos_mensagem_config_template_valido
    check (btrim(template) <> '' and char_length(template) <= 4000)
);

comment on table public.pedidos_mensagem_config is
  'Migration 0075. Linha unica com o MODELO GLOBAL da mensagem de pedido (Pedidos > Gerar mensagem). Placeholders resolvidos no frontend (lib/pedidos/mensagemPedido.js): {{fornecedor}}, {{data_pedido}}, {{previsao_entrega}}, {{modalidade}}, {{observacoes}}, {{itens}}. Leitura: pedidos.visualizar (ou admin). Alteracao: somente proprietario_admin (is_admin()). O texto editado no preview de um pedido nunca e gravado aqui.';

-- Modelo padrao -- mesmo texto de TEMPLATE_PADRAO (lib/pedidos/mensagemPedido.js;
-- o teste da 0075 confere). Defensivo: nunca sobrescreve uma linha existente.
insert into public.pedidos_mensagem_config (id, template)
values (
  true,
  E'Olá, {{fornecedor}}!\n\nGostaria de fazer o seguinte pedido:\n\n{{itens}}\n\nPrevisão de entrega: {{previsao_entrega}}\nObservações: {{observacoes}}\n\nObrigado!'
)
on conflict (id) do nothing;

-- ============================================================
-- 5. Triggers -- identidade e autoria sempre do servidor
-- ============================================================

-- Favoritos e layout: usuario_id = auth.uid() no INSERT (ignora o que o
-- cliente mandar); imutavel no UPDATE; atualizado_em do layout = now().
create function public.preferencias_usuario_preencher()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.usuario_id := auth.uid();
    if new.usuario_id is null then
      raise exception '%: sessao autenticada obrigatoria (auth.uid() nulo).', tg_table_name;
    end if;
  elsif new.usuario_id is distinct from old.usuario_id then
    raise exception '%: usuario_id nao pode ser alterado.', tg_table_name;
  end if;
  if tg_table_name = 'usuario_dashboard_layout' then
    new.atualizado_em := now();
  end if;
  return new;
end;
$$;

create trigger usuario_favoritos_preencher_trigger
  before insert or update on public.usuario_favoritos
  for each row execute function public.preferencias_usuario_preencher();

create trigger usuario_dashboard_layout_preencher_trigger
  before insert or update on public.usuario_dashboard_layout
  for each row execute function public.preferencias_usuario_preencher();

-- Limite de 40 favoritos por usuario. SECURITY DEFINER so para contar as
-- linhas do proprio usuario independentemente da RLS; nao recebe parametro.
create function public.usuario_favoritos_limitar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.usuario_favoritos f where f.usuario_id = new.usuario_id) >= 40 then
    raise exception 'usuario_favoritos: limite de favoritos atingido (40).';
  end if;
  return new;
end;
$$;

-- Nome comeca com "usuario_favoritos_v" para rodar DEPOIS do _preencher
-- (triggers BEFORE disparam em ordem alfabetica): conta pelo usuario_id ja
-- forcado para auth.uid().
create trigger usuario_favoritos_v_limitar_trigger
  before insert on public.usuario_favoritos
  for each row execute function public.usuario_favoritos_limitar();

-- Modelo global: autoria derivada do servidor; id imutavel.
create function public.pedidos_mensagem_config_preencher()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
begin
  if new.id is distinct from old.id then
    raise exception 'pedidos_mensagem_config: a linha unica nao pode mudar de id.';
  end if;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  if new.atualizado_por is not null then
    select u.nome into v_nome from public.usuarios u where u.id = new.atualizado_por;
  end if;
  new.atualizado_por_nome := v_nome;
  return new;
end;
$$;

create trigger pedidos_mensagem_config_preencher_trigger
  before update on public.pedidos_mensagem_config
  for each row execute function public.pedidos_mensagem_config_preencher();

revoke execute on function public.preferencias_usuario_preencher() from public, anon, authenticated, service_role;
revoke execute on function public.usuario_favoritos_limitar() from public, anon, authenticated, service_role;
revoke execute on function public.pedidos_mensagem_config_preencher() from public, anon, authenticated, service_role;
-- dashboard_layout_valido e avaliada pelo CHECK com o privilegio de quem
-- grava (o Postgres confere EXECUTE): fica so para authenticated. E pura
-- (immutable, sem acesso a tabela) -- nao expoe nada.
revoke execute on function public.dashboard_layout_valido(jsonb) from public, anon, service_role;
grant execute on function public.dashboard_layout_valido(jsonb) to authenticated;

-- ============================================================
-- 6. RLS
-- ============================================================
alter table public.usuario_favoritos enable row level security;
alter table public.usuario_dashboard_layout enable row level security;
alter table public.pedidos_mensagem_config enable row level security;

create policy usuario_favoritos_select on public.usuario_favoritos
  for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy usuario_favoritos_insert on public.usuario_favoritos
  for insert to authenticated
  with check (usuario_id = (select auth.uid()) and (select public.has_permissao('dashboard.visualizar')));
create policy usuario_favoritos_delete on public.usuario_favoritos
  for delete to authenticated
  using (usuario_id = (select auth.uid()));

create policy usuario_dashboard_layout_select on public.usuario_dashboard_layout
  for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy usuario_dashboard_layout_insert on public.usuario_dashboard_layout
  for insert to authenticated
  with check (usuario_id = (select auth.uid()) and (select public.has_permissao('dashboard.visualizar')));
create policy usuario_dashboard_layout_update on public.usuario_dashboard_layout
  for update to authenticated
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()) and (select public.has_permissao('dashboard.visualizar')));
create policy usuario_dashboard_layout_delete on public.usuario_dashboard_layout
  for delete to authenticated
  using (usuario_id = (select auth.uid()));

create policy pedidos_mensagem_config_select on public.pedidos_mensagem_config
  for select to authenticated
  using ((select public.has_permissao('pedidos.visualizar')) or (select public.is_admin()));
create policy pedidos_mensagem_config_update on public.pedidos_mensagem_config
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

comment on policy usuario_favoritos_select on public.usuario_favoritos is 'Cada usuario le so os proprios favoritos.';
comment on policy usuario_favoritos_insert on public.usuario_favoritos is 'So para si mesmo e com dashboard.visualizar (os favoritos aparecem no Dashboard).';
comment on policy usuario_favoritos_delete on public.usuario_favoritos is 'Cada usuario remove so os proprios favoritos.';
comment on policy usuario_dashboard_layout_select on public.usuario_dashboard_layout is 'Cada usuario le so o proprio layout.';
comment on policy usuario_dashboard_layout_insert on public.usuario_dashboard_layout is 'So para si mesmo e com dashboard.visualizar.';
comment on policy usuario_dashboard_layout_update on public.usuario_dashboard_layout is 'So a propria linha e com dashboard.visualizar.';
comment on policy usuario_dashboard_layout_delete on public.usuario_dashboard_layout is 'Restaurar padrao = apagar a propria linha.';
comment on policy pedidos_mensagem_config_select on public.pedidos_mensagem_config is 'Quem ve Pedidos le o modelo para gerar mensagens (admin tambem).';
comment on policy pedidos_mensagem_config_update on public.pedidos_mensagem_config is 'Somente proprietario_admin altera o modelo global (is_admin()).';

-- ============================================================
-- 7. Grants minimos
-- ============================================================
revoke all on public.usuario_favoritos, public.usuario_dashboard_layout, public.pedidos_mensagem_config from public, anon;
revoke all on public.usuario_favoritos, public.usuario_dashboard_layout, public.pedidos_mensagem_config from authenticated;

grant select, insert, delete on public.usuario_favoritos to authenticated;
grant select, insert, update, delete on public.usuario_dashboard_layout to authenticated;
grant select on public.pedidos_mensagem_config to authenticated;
grant update (template) on public.pedidos_mensagem_config to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (manual, so se precisar desfazer -- apaga as preferencias e o
-- modelo gravados depois da aplicacao):
-- BEGIN;
-- drop table if exists public.usuario_favoritos;
-- drop table if exists public.usuario_dashboard_layout;
-- drop table if exists public.pedidos_mensagem_config;
-- drop function if exists public.usuario_favoritos_limitar();
-- drop function if exists public.preferencias_usuario_preencher();
-- drop function if exists public.pedidos_mensagem_config_preencher();
-- drop function if exists public.dashboard_layout_valido(jsonb);
-- COMMIT;
-- ============================================================
