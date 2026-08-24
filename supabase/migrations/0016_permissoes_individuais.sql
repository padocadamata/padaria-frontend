-- 0016_permissoes_individuais.sql
-- Overrides individuais de permissao por usuario (concede/nega, com expiracao
-- opcional), sobre a base do perfil. Amplia produtos_producao e planejamento
-- para permissoes granulares proprias (hoje acopladas a is_admin()/producao.*).
-- Historico (Rota A, aprovada 2026-08-24): historico.visualizar/historico.editar
-- sao SO gate de tela -- a RLS real de producao_registros continua em
-- producao.visualizar/producao.editar, sem alteracao aqui.
--
-- RASCUNHO EM AUDITORIA -- NAO COPIAR PARA supabase/migrations/ NEM EXECUTAR
-- ate autorizacao explicita. Gerado em scratchpad para revisao estatica,
-- SHA-256 e classificacao de risco.
--
-- Pre-requisitos: 0001..0015 ja aplicadas.
--
-- Confirmado por auditoria estatica (2026-08-24) antes de escrever este
-- arquivo:
--   * has_permissao(text) e is_admin() so sao definidas em 0003 -- nunca
--     redefinidas depois. O CREATE OR REPLACE abaixo substitui exatamente
--     essa versao.
--   * Nomes fisicos de policy vigentes hoje (ultima versao "corrigida" de
--     cada tabela): receitas_select_authenticated/receitas_insert_admin/
--     receitas_update_admin (0005b); receita_ingredientes_select_authenticated/
--     receita_ingredientes_insert_admin/receita_ingredientes_update_admin (0012);
--     planejamento_producao_select/_insert/_update (0010);
--     usuarios_select_propria_ou_admin/usuarios_insert_admin/usuarios_update_admin (0005b).
--   * producao_registros_select/_insert/_update (0010) NAO sao tocadas por
--     este arquivo -- nenhum DROP/CREATE POLICY sobre producao_registros
--     aparece abaixo.
--   * Nenhum INSERT/UPDATE/DELETE sobre dado de negocio (producao_registros,
--     receitas, receita_ingredientes, planejamento_producao) -- o unico DML
--     deste arquivo e sobre as tabelas de catalogo permissoes/perfil_permissoes.

BEGIN;

-- ============================================================
-- 1. TABELA usuario_permissoes
-- ============================================================
create table if not exists public.usuario_permissoes (
  usuario_id    uuid not null references public.usuarios(id) on delete cascade,
  permissao     text not null references public.permissoes(codigo) on delete cascade,
  efeito        text not null check (efeito in ('concede', 'nega')),
  expira_em     timestamptz,
  concedido_por uuid references auth.users(id),
  motivo        text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  primary key (usuario_id, permissao)
);

comment on table public.usuario_permissoes is
  'Overrides individuais de permissao, por cima do perfil (usuarios.perfil). efeito=concede libera mesmo sem o perfil dar; efeito=nega bloqueia mesmo que o perfil de. PK (usuario_id,permissao) garante no maximo uma linha por par -- nunca concede e nega ao mesmo tempo. expira_em nulo = permanente; expirado e ignorado por has_permissao(). Escrita restrita a is_admin() (ver policies abaixo) -- nunca delegavel via has_permissao(), para nao criar um caminho de autopromocao.';

create index if not exists usuario_permissoes_usuario_idx
  on public.usuario_permissoes (usuario_id);

create or replace function public.usuario_permissoes_tocar_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists usuario_permissoes_atualizado_em_trigger on public.usuario_permissoes;
create trigger usuario_permissoes_atualizado_em_trigger
  before update on public.usuario_permissoes
  for each row
  execute function public.usuario_permissoes_tocar_atualizado_em();

-- ============================================================
-- 2. GUARDA: codigos administrativos nunca podem ser delegados via override
-- ============================================================
-- Reforco em profundidade: mesmo sendo so is_admin() quem escreve aqui
-- (policy abaixo), esta trigger REJEITA explicitamente qualquer tentativa
-- de conceder/negar um codigo desta lista -- em vez de aceitar
-- silenciosamente uma linha que, de qualquer forma, nao teria efeito real
-- (porque as RLS de usuarios/perfis/permissoes/perfil_permissoes/
-- usuario_permissoes checam is_admin() direto, nunca has_permissao()).
create or replace function public.usuario_permissoes_bloquear_codigos_administrativos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.permissao in ('usuarios.administrar', 'permissoes.administrar', 'configuracoes.administrar') then
    raise exception
      'usuario_permissoes: o codigo % concede poder administrativo e nao pode ser atribuido via override individual -- e sempre is_admin() (perfil proprietario_admin), por design.', new.permissao;
  end if;
  return new;
end;
$$;

drop trigger if exists usuario_permissoes_bloquear_admin_trigger on public.usuario_permissoes;
create trigger usuario_permissoes_bloquear_admin_trigger
  before insert or update on public.usuario_permissoes
  for each row
  execute function public.usuario_permissoes_bloquear_codigos_administrativos();

-- ============================================================
-- 3. RLS de usuario_permissoes
-- ============================================================
alter table public.usuario_permissoes enable row level security;

drop policy if exists usuario_permissoes_select_propria_ou_admin on public.usuario_permissoes;
create policy usuario_permissoes_select_propria_ou_admin on public.usuario_permissoes
  for select to authenticated
  using (
    usuario_id = (select auth.uid())
    or (select public.is_admin())
  );

drop policy if exists usuario_permissoes_insert_admin on public.usuario_permissoes;
create policy usuario_permissoes_insert_admin on public.usuario_permissoes
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists usuario_permissoes_update_admin on public.usuario_permissoes;
create policy usuario_permissoes_update_admin on public.usuario_permissoes
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists usuario_permissoes_delete_admin on public.usuario_permissoes;
create policy usuario_permissoes_delete_admin on public.usuario_permissoes
  for delete to authenticated
  using ((select public.is_admin()));

-- ============================================================
-- 4. SEED -- novos codigos no catalogo de permissoes
-- ============================================================
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('historico.visualizar',      'historico',        'visualizar', 'Acessar a tela de Historico. Gate de TELA apenas -- a leitura real de producao_registros continua exigindo producao.visualizar (Rota A, decisao de 2026-08-24).'),
  ('historico.editar',          'historico',        'editar',     'Editar a partir da tela de Historico (ex.: gerenciar sobras). Gate de TELA apenas -- a escrita real continua exigindo producao.editar.'),
  ('planejamento.visualizar',   'planejamento',     'visualizar', 'Ver o planejamento de producao (planejamento_producao).'),
  ('planejamento.editar',       'planejamento',     'editar',     'Criar/editar linhas de planejamento_producao.'),
  ('produtos_producao.visualizar', 'produtos_producao', 'visualizar', 'Ver receitas/fichas tecnicas (Produtos de Producao).'),
  ('produtos_producao.editar',  'produtos_producao', 'editar',    'Editar receitas/receita_ingredientes (ficha tecnica). Substitui is_admin() nessas duas tabelas.')
on conflict (codigo) do nothing;

-- proprietario_admin preserva "acesso total": concede os 6 codigos novos
-- explicitamente (o INSERT...SELECT original da 0001 so rodou uma vez, nao
-- e retroativo a codigos criados depois).
insert into public.perfil_permissoes (perfil, permissao)
select 'proprietario_admin', codigo
from public.permissoes
where codigo in (
  'historico.visualizar', 'historico.editar',
  'planejamento.visualizar', 'planejamento.editar',
  'produtos_producao.visualizar', 'produtos_producao.editar'
)
on conflict do nothing;

-- Decisao conservadora (aprovada): NENHUM outro perfil (gestao, operacional,
-- financeiro_administrativo) recebe esses codigos por padrao. Quem precisar
-- deles usa usuario_permissoes -- perfil-base nao muda.

-- ============================================================
-- 5. has_permissao() -- passa a considerar overrides
-- ============================================================
create or replace function public.has_permissao(perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when not exists (
        select 1 from public.usuarios u where u.id = auth.uid() and u.ativo = true
      ) then false
      when exists (
        select 1 from public.usuario_permissoes up
        where up.usuario_id = auth.uid() and up.permissao = perm and up.efeito = 'nega'
          and (up.expira_em is null or up.expira_em > now())
      ) then false
      when exists (
        select 1 from public.usuario_permissoes up
        where up.usuario_id = auth.uid() and up.permissao = perm and up.efeito = 'concede'
          and (up.expira_em is null or up.expira_em > now())
      ) then true
      else exists (
        select 1
        from public.usuarios u
        join public.perfil_permissoes pp on pp.perfil = u.perfil
        where u.id = auth.uid() and pp.permissao = perm
      )
    end;
$$;

comment on function public.has_permissao(text) is
  'Fonte unica de verdade para autorizacao granular. Ordem: usuario inativo -> false; override nega (nao expirado) -> false; override concede (nao expirado) -> true; senao, cai no perfil (perfil_permissoes). is_admin() permanece funcao separada, nunca substituida por isto -- usuarios/perfis/permissoes/perfil_permissoes/usuario_permissoes continuam checando is_admin() puro, nunca has_permissao(), por design (ver migration 0016).';

-- ============================================================
-- 6. RLS de receitas / receita_ingredientes -- de is_admin() para granular
-- ============================================================
drop policy if exists receitas_insert_admin on public.receitas;
create policy receitas_insert_admin on public.receitas
  for insert to authenticated
  with check ((select public.has_permissao('produtos_producao.editar')));

drop policy if exists receitas_update_admin on public.receitas;
create policy receitas_update_admin on public.receitas
  for update to authenticated
  using ((select public.has_permissao('produtos_producao.editar')))
  with check ((select public.has_permissao('produtos_producao.editar')));

-- SELECT de receitas permanece 'authenticated using (true)' (0005b),
-- inalterado por esta migration -- outras telas do sistema fazem JOIN em
-- receitas (ex.: producao_registros.receita_id) e nao devem perder leitura.

drop policy if exists receita_ingredientes_insert_admin on public.receita_ingredientes;
create policy receita_ingredientes_insert_admin on public.receita_ingredientes
  for insert to authenticated
  with check ((select public.has_permissao('produtos_producao.editar')));

drop policy if exists receita_ingredientes_update_admin on public.receita_ingredientes;
create policy receita_ingredientes_update_admin on public.receita_ingredientes
  for update to authenticated
  using ((select public.has_permissao('produtos_producao.editar')))
  with check ((select public.has_permissao('produtos_producao.editar')));

-- ============================================================
-- 7. RLS de planejamento_producao -- de producao.* para planejamento.*
-- ============================================================
drop policy if exists planejamento_producao_select on public.planejamento_producao;
create policy planejamento_producao_select on public.planejamento_producao
  for select to authenticated
  using ((select public.has_permissao('planejamento.visualizar')));

drop policy if exists planejamento_producao_insert on public.planejamento_producao;
create policy planejamento_producao_insert on public.planejamento_producao
  for insert to authenticated
  with check ((select public.has_permissao('planejamento.editar')));

drop policy if exists planejamento_producao_update on public.planejamento_producao;
create policy planejamento_producao_update on public.planejamento_producao
  for update to authenticated
  using ((select public.has_permissao('planejamento.editar')))
  with check ((select public.has_permissao('planejamento.editar')));

-- ============================================================
-- 8. Protecao do ultimo administrador
-- ============================================================
create or replace function public.usuarios_protecao_ultimo_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outros_admins_ativos integer;
begin
  if old.perfil = 'proprietario_admin' and old.ativo = true
     and (new.perfil <> 'proprietario_admin' or new.ativo = false) then

    select count(*) into v_outros_admins_ativos
    from public.usuarios
    where perfil = 'proprietario_admin' and ativo = true and id <> old.id;

    if v_outros_admins_ativos = 0 then
      raise exception
        'usuarios: nao e possivel rebaixar/desativar % -- e o unico administrador ativo restante. Promova outro usuario a proprietario_admin antes.', old.id;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.usuarios_protecao_ultimo_admin() is
  'BEFORE UPDATE em usuarios. Bloqueia rebaixar perfil ou desativar o ultimo proprietario_admin ativo do sistema, seja a propria conta ou outra -- evita lockout total. Nao restringe usuario_permissoes (que nunca concede poder administrativo, ver 0016 secao 2), so a linha de usuarios em si.';

drop trigger if exists usuarios_protecao_ultimo_admin_trigger on public.usuarios;
create trigger usuarios_protecao_ultimo_admin_trigger
  before update on public.usuarios
  for each row
  execute function public.usuarios_protecao_ultimo_admin();

-- ============================================================
-- 9. RLS de usuarios -- leitura granular (usuarios.visualizar passa a valer)
-- ============================================================
drop policy if exists usuarios_select_propria_ou_admin on public.usuarios;
create policy usuarios_select_propria_ou_admin on public.usuarios
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_admin())
    or (select public.has_permissao('usuarios.visualizar'))
  );

-- INSERT/UPDATE de usuarios permanecem is_admin() puro (0005b) -- nao
-- alterados aqui, por decisao aprovada.

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENCAO: reverter os passos 6/7 volta receitas/receita_ingredientes/
-- planejamento_producao para o comportamento anterior (is_admin()/
-- producao.*) -- qualquer usuario_permissoes concedendo produtos_producao.*
-- ou planejamento.* fica sem efeito a partir dai (nao e um erro, so passa a
-- nao ser consultado por nenhuma policy).
-- BEGIN;
-- drop trigger if exists usuarios_protecao_ultimo_admin_trigger on public.usuarios;
-- drop function if exists public.usuarios_protecao_ultimo_admin();
-- drop policy if exists usuarios_select_propria_ou_admin on public.usuarios;
-- create policy usuarios_select_propria_ou_admin on public.usuarios
--   for select to authenticated
--   using (id = (select auth.uid()) or (select public.is_admin()));
--
-- drop policy if exists planejamento_producao_select on public.planejamento_producao;
-- create policy planejamento_producao_select on public.planejamento_producao
--   for select to authenticated using ((select public.has_permissao('producao.visualizar')));
-- drop policy if exists planejamento_producao_insert on public.planejamento_producao;
-- create policy planejamento_producao_insert on public.planejamento_producao
--   for insert to authenticated with check ((select public.has_permissao('producao.inserir')));
-- drop policy if exists planejamento_producao_update on public.planejamento_producao;
-- create policy planejamento_producao_update on public.planejamento_producao
--   for update to authenticated
--   using ((select public.has_permissao('producao.editar')))
--   with check ((select public.has_permissao('producao.editar')));
--
-- drop policy if exists receitas_insert_admin on public.receitas;
-- create policy receitas_insert_admin on public.receitas
--   for insert to authenticated with check ((select public.is_admin()));
-- drop policy if exists receitas_update_admin on public.receitas;
-- create policy receitas_update_admin on public.receitas
--   for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
-- drop policy if exists receita_ingredientes_insert_admin on public.receita_ingredientes;
-- create policy receita_ingredientes_insert_admin on public.receita_ingredientes
--   for insert to authenticated with check ((select public.is_admin()));
-- drop policy if exists receita_ingredientes_update_admin on public.receita_ingredientes;
-- create policy receita_ingredientes_update_admin on public.receita_ingredientes
--   for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
--
-- create or replace function public.has_permissao(perm text)
-- returns boolean language sql stable security definer set search_path = ''
-- as $$
--   select exists (
--     select 1 from public.usuarios u
--     join public.perfil_permissoes pp on pp.perfil = u.perfil
--     where u.id = auth.uid() and u.ativo = true and pp.permissao = perm
--   );
-- $$;
--
-- delete from public.perfil_permissoes where permissao in (
--   'historico.visualizar','historico.editar','planejamento.visualizar',
--   'planejamento.editar','produtos_producao.visualizar','produtos_producao.editar');
-- delete from public.permissoes where codigo in (
--   'historico.visualizar','historico.editar','planejamento.visualizar',
--   'planejamento.editar','produtos_producao.visualizar','produtos_producao.editar');
--
-- drop trigger if exists usuario_permissoes_bloquear_admin_trigger on public.usuario_permissoes;
-- drop function if exists public.usuario_permissoes_bloquear_codigos_administrativos();
-- drop trigger if exists usuario_permissoes_atualizado_em_trigger on public.usuario_permissoes;
-- drop function if exists public.usuario_permissoes_tocar_atualizado_em();
-- drop table if exists public.usuario_permissoes; -- ATENCAO: apaga todos os overrides ja configurados
-- COMMIT;
