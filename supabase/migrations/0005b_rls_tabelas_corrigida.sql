-- 0005b_rls_tabelas_corrigida.sql
-- Substitui operacionalmente a 0005_rls_tabelas.sql (mantida só como
-- histórico). Fecha RLS nas 8 tabelas abaixo. Sem hard delete em nenhuma.
-- Sem FOR ALL — cada comando tem policy própria. Recria, pelos mesmos
-- nomes, as 4 policies de SELECT já testadas manualmente com login real.
-- Remove explicitamente as policies legadas `_admin_write`/`admin_insert`/
-- `admin_update` da 0005 antiga, para garantir que nenhuma policy mais
-- permissiva (inclusive com DELETE, via FOR ALL) sobreviva depois desta
-- migration — seguro mesmo que a 0005 antiga nunca tenha sido aplicada
-- (DROP POLICY IF EXISTS sobre algo inexistente é um no-op).
--
-- NÃO EXECUTADA AUTOMATICAMENTE. Rode manualmente no SQL Editor, depois de
-- 0001, 0002b, 0003 e 0004 (já aplicadas e validadas).

BEGIN;

-- ===================== perfis =====================
alter table public.perfis enable row level security;

drop policy if exists perfis_admin_write on public.perfis;

drop policy if exists perfis_select_authenticated on public.perfis;
create policy perfis_select_authenticated on public.perfis
  for select to authenticated using (true);

drop policy if exists perfis_insert_admin on public.perfis;
create policy perfis_insert_admin on public.perfis
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists perfis_update_admin on public.perfis;
create policy perfis_update_admin on public.perfis
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===================== permissoes =====================
alter table public.permissoes enable row level security;

drop policy if exists permissoes_admin_write on public.permissoes;

drop policy if exists permissoes_select_authenticated on public.permissoes;
create policy permissoes_select_authenticated on public.permissoes
  for select to authenticated using (true);

drop policy if exists permissoes_insert_admin on public.permissoes;
create policy permissoes_insert_admin on public.permissoes
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists permissoes_update_admin on public.permissoes;
create policy permissoes_update_admin on public.permissoes
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===================== perfil_permissoes =====================
alter table public.perfil_permissoes enable row level security;

drop policy if exists perfil_permissoes_admin_write on public.perfil_permissoes;

drop policy if exists perfil_permissoes_select_authenticated on public.perfil_permissoes;
create policy perfil_permissoes_select_authenticated on public.perfil_permissoes
  for select to authenticated using (true);

drop policy if exists perfil_permissoes_insert_admin on public.perfil_permissoes;
create policy perfil_permissoes_insert_admin on public.perfil_permissoes
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists perfil_permissoes_update_admin on public.perfil_permissoes;
create policy perfil_permissoes_update_admin on public.perfil_permissoes
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===================== usuarios =====================
alter table public.usuarios enable row level security;

drop policy if exists usuarios_admin_insert on public.usuarios;
drop policy if exists usuarios_admin_update on public.usuarios;

drop policy if exists usuarios_select_propria_ou_admin on public.usuarios;
create policy usuarios_select_propria_ou_admin on public.usuarios
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_admin())
  );

drop policy if exists usuarios_insert_admin on public.usuarios;
create policy usuarios_insert_admin on public.usuarios
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists usuarios_update_admin on public.usuarios;
create policy usuarios_update_admin on public.usuarios
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===================== fornecedores =====================
-- fornecedores.cancelar: reservada, sem policy própria, sem efeito hoje.
alter table public.fornecedores enable row level security;

drop policy if exists fornecedores_select on public.fornecedores;
create policy fornecedores_select on public.fornecedores
  for select to authenticated
  using ((select public.has_permissao('fornecedores.visualizar')));

drop policy if exists fornecedores_insert on public.fornecedores;
create policy fornecedores_insert on public.fornecedores
  for insert to authenticated
  with check ((select public.has_permissao('fornecedores.inserir')));

drop policy if exists fornecedores_update on public.fornecedores;
create policy fornecedores_update on public.fornecedores
  for update to authenticated
  using ((select public.has_permissao('fornecedores.editar')))
  with check ((select public.has_permissao('fornecedores.editar')));

-- ===================== produtos =====================
alter table public.produtos enable row level security;

drop policy if exists produtos_admin_write on public.produtos;

drop policy if exists produtos_select_authenticated on public.produtos;
create policy produtos_select_authenticated on public.produtos
  for select to authenticated using (true);

drop policy if exists produtos_insert_admin on public.produtos;
create policy produtos_insert_admin on public.produtos
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists produtos_update_admin on public.produtos;
create policy produtos_update_admin on public.produtos
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===================== receitas =====================
alter table public.receitas enable row level security;

drop policy if exists receitas_admin_write on public.receitas;

drop policy if exists receitas_select_authenticated on public.receitas;
create policy receitas_select_authenticated on public.receitas
  for select to authenticated using (true);

drop policy if exists receitas_insert_admin on public.receitas;
create policy receitas_insert_admin on public.receitas
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists receitas_update_admin on public.receitas;
create policy receitas_update_admin on public.receitas
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===================== producao_diaria =====================
-- producao.cancelar: reservada, sem policy própria, sem efeito hoje.
alter table public.producao_diaria enable row level security;

drop policy if exists producao_diaria_select on public.producao_diaria;
create policy producao_diaria_select on public.producao_diaria
  for select to authenticated
  using ((select public.has_permissao('producao.visualizar')));

drop policy if exists producao_diaria_insert on public.producao_diaria;
create policy producao_diaria_insert on public.producao_diaria
  for insert to authenticated
  with check ((select public.has_permissao('producao.inserir')));

drop policy if exists producao_diaria_update on public.producao_diaria;
create policy producao_diaria_update on public.producao_diaria
  for update to authenticated
  using ((select public.has_permissao('producao.editar')))
  with check ((select public.has_permissao('producao.editar')));

-- Nenhuma policy de DELETE em nenhuma das 8 tabelas acima.
-- public.logs_auditoria não é tocada aqui — RLS dela já é da 0004.
-- Sem FORCE ROW LEVEL SECURITY. Sem alteração de dados ou de grants.

COMMIT;

-- ============================================================
-- ROLLBACK (comentado — reabre a vulnerabilidade original se usado)
-- ============================================================
-- BEGIN;
-- drop policy if exists producao_diaria_update on public.producao_diaria;
-- drop policy if exists producao_diaria_insert on public.producao_diaria;
-- drop policy if exists producao_diaria_select on public.producao_diaria;
-- alter table public.producao_diaria disable row level security;
-- drop policy if exists receitas_update_admin on public.receitas;
-- drop policy if exists receitas_insert_admin on public.receitas;
-- drop policy if exists receitas_select_authenticated on public.receitas;
-- alter table public.receitas disable row level security;
-- drop policy if exists produtos_update_admin on public.produtos;
-- drop policy if exists produtos_insert_admin on public.produtos;
-- drop policy if exists produtos_select_authenticated on public.produtos;
-- alter table public.produtos disable row level security;
-- drop policy if exists fornecedores_update on public.fornecedores;
-- drop policy if exists fornecedores_insert on public.fornecedores;
-- drop policy if exists fornecedores_select on public.fornecedores;
-- alter table public.fornecedores disable row level security;
-- drop policy if exists usuarios_update_admin on public.usuarios;
-- drop policy if exists usuarios_insert_admin on public.usuarios;
-- drop policy if exists usuarios_select_propria_ou_admin on public.usuarios;
-- alter table public.usuarios disable row level security;
-- drop policy if exists perfil_permissoes_update_admin on public.perfil_permissoes;
-- drop policy if exists perfil_permissoes_insert_admin on public.perfil_permissoes;
-- drop policy if exists perfil_permissoes_select_authenticated on public.perfil_permissoes;
-- alter table public.perfil_permissoes disable row level security;
-- drop policy if exists permissoes_update_admin on public.permissoes;
-- drop policy if exists permissoes_insert_admin on public.permissoes;
-- drop policy if exists permissoes_select_authenticated on public.permissoes;
-- alter table public.permissoes disable row level security;
-- drop policy if exists perfis_update_admin on public.perfis;
-- drop policy if exists perfis_insert_admin on public.perfis;
-- drop policy if exists perfis_select_authenticated on public.perfis;
-- alter table public.perfis disable row level security;
-- COMMIT;