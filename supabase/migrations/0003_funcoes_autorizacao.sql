-- 0003_funcoes_autorizacao.sql
-- Funções auxiliares usadas dentro das policies de RLS (migrations 0004 e
-- 0005), para não repetir a mesma subquery em cada policy.
--
-- NÃO EXECUTADA AUTOMATICAMENTE. Rode manualmente no SQL Editor, depois de
-- 0001 e 0002.
--
-- Envolvida em transação explícita (BEGIN/COMMIT) — só DDL padrão.
--
-- HARDENING (revisão pós-auditoria):
--   - search_path trocado de 'public' para '' (vazio) — mais restritivo.
--     Só é seguro porque TODAS as referências dentro das funções já são
--     schema-qualificadas (public.usuarios, public.perfil_permissoes,
--     auth.uid()) — com search_path vazio, um nome NÃO qualificado
--     simplesmente não resolveria (a função falharia alto, nunca
--     silenciosamente resolveria para o objeto errado), então não há
--     ambiguidade possível de "sequestro" de search_path.
--   - EXECUTE explicitamente revogado de PUBLIC (o que inclui `anon`) e
--     concedido só para `authenticated` — são as únicas policies (0004,
--     0005) que chamam essas funções, e todas são `to authenticated`.
--     Isso não quebra o RLS: toda policy que usa is_admin()/has_permissao()
--     só é avaliada em sessões autenticadas, então authenticated precisa
--     continuar podendo executar. anon nunca precisava (já retornava
--     sempre false para anon, já que auth.uid() é nulo nesse caso — a
--     revogação é reforço de menor privilégio, não uma correção de
--     comportamento incorreto anterior).

BEGIN;

-- is_admin(): true se o usuário autenticado tem perfil proprietario_admin
-- e está ativo.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.perfil = 'proprietario_admin'
      and u.ativo = true
  );
$$;

comment on function public.is_admin() is
  'True se o usuário autenticado atual tem perfil proprietario_admin e está ativo. SECURITY DEFINER para poder ler usuarios independente das policies de SELECT dessa tabela. search_path vazio + todas as referências schema-qualificadas.';

-- has_permissao(codigo): true se o perfil do usuário autenticado tem a
-- permissão informada concedida em perfil_permissoes, e o usuário está ativo.
create or replace function public.has_permissao(perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.usuarios u
    join public.perfil_permissoes pp on pp.perfil = u.perfil
    where u.id = auth.uid()
      and u.ativo = true
      and pp.permissao = perm
  );
$$;

comment on function public.has_permissao(text) is
  'True se o perfil do usuário autenticado atual possui a permissão (codigo modulo.acao) informada. Fonte única de verdade para autorização — usada nas policies de RLS e deve ser espelhada no frontend por lib/auth/permissoes.js, nunca reimplementada com "if (perfil === ...)" espalhado. search_path vazio + todas as referências schema-qualificadas.';

-- Menor privilégio: ninguém executa por padrão, só `authenticated` (que é
-- quem as policies precisam que consiga rodar essas funções).
revoke execute on function public.is_admin() from public;
revoke execute on function public.has_permissao(text) from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.has_permissao(text) to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENÇÃO: rode isto SOMENTE depois de reverter 0005 e 0004 — ambas têm
-- policies (USING/WITH CHECK) que chamam has_permissao()/is_admin(). O
-- Postgres rastreia essa dependência; um DROP FUNCTION aqui, com essas
-- policies ainda existindo, falha com "cannot drop function ... because
-- other objects depend on it" (falha segura, não corrompe nada — só não
-- completa como escrito se a ordem for pulada).
-- BEGIN;
-- drop function if exists public.has_permissao(text);
-- drop function if exists public.is_admin();
-- COMMIT;
