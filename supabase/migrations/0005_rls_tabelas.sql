-- ============================================================
-- MIGRATION HISTÓRICA / OBSOLETA — NÃO EXECUTAR
-- Esta versão contém policies FOR ALL posteriormente corrigidas.
-- A versão válida é: 0005b_rls_tabelas_corrigida.sql
-- Mantida apenas para histórico da implementação.
-- ============================================================

-- 0005_rls_tabelas.sql
-- RLS para as tabelas de perfis/permissões, usuarios, e para as tabelas de
-- negócio já existentes (fornecedores, produtos, receitas, producao_diaria).
--
-- NÃO EXECUTADA AUTOMATICAMENTE. Rode manualmente no SQL Editor, depois de
-- 0001, 0002, 0003 e 0004.
--
-- Envolvida em transação explícita (BEGIN/COMMIT) — só DDL padrão
-- (ENABLE ROW LEVEL SECURITY, CREATE/DROP POLICY), nenhum incompatível com
-- transação.
--
-- HARDENING (revisão pós-auditoria): toda chamada a public.is_admin() e
-- public.has_permissao(...) dentro de USING/WITH CHECK agora está envolvida
-- em (select ...) — recomendação oficial de performance de RLS do Supabase
-- (ganho documentado de 5-10x em tabelas grandes): sem o (select ...), o
-- planner pode reavaliar a função uma vez por linha; com, ele consegue
-- tratá-la como um initPlan avaliado uma única vez por statement.
--
-- ============================================================
-- ESTADO ATUAL CONFIRMADO ANTES DESTA MIGRATION (introspecção read-only
-- feita com a chave publicável)
-- ============================================================
-- Testado com POST vazio (corpo "{}", sem inserir nada — falha sempre antes
-- de gravar qualquer linha, por violar NOT NULL ou RLS):
--   fornecedores      -> passou pela checagem de RLS, falhou só em NOT NULL
--                         (cnpj). Ou seja: RLS ausente ou com policy de
--                         INSERT liberada para o papel anon.
--   produtos          -> mesmo padrão (falhou em codigo_barras NOT NULL).
--   receitas          -> mesmo padrão (falhou em nome NOT NULL).
--   producao_diaria   -> mesmo padrão (falhou em data NOT NULL).
--   usuarios          -> BLOQUEADO por RLS antes de chegar em qualquer
--                         constraint (erro 42501). Ou seja, usuarios já
--                         tinha RLS habilitado e restritivo; as outras 4
--                         tabelas, não.
-- Confirmamos com uma tentativa real de escrita (sem persistir nada) que
-- fornecedores/produtos/receitas/producao_diaria aceitam hoje INSERT
-- anônimo pela internet com a chave publicável.
--
-- ============================================================
-- IMPACTO NOS SCRIPTS PYTHON DE IMPORTAÇÃO (documentado conforme pedido,
-- scripts NÃO foram alterados nem executados)
-- ============================================================
-- Importação/importar_dados_simples.py e importar_receitas_fix.py usam a
-- chave publicável (anon), SEM login/sessão. Depois desta migration, o
-- papel `anon` deixa de ter SELECT/INSERT em fornecedores, produtos,
-- receitas e producao_diaria — logo, ESSES SCRIPTS VÃO PARAR DE FUNCIONAR
-- até rodarem autenticados ou com uma estratégia de credencial mais
-- adequada (ver auditoria — recomendação: service_role em ambiente local
-- seguro, nunca commitado). Essa é uma consequência esperada e aceita.
--
-- ============================================================
-- DECISÃO APROVADA: SEM POLICY DE DELETE (nesta migration)
-- ============================================================
-- Nenhuma das tabelas abaixo recebe policy de DELETE — nem para
-- proprietario_admin. Isso significa que hard delete fica INDISPONÍVEL
-- para todo mundo via API/aplicação em fornecedores, produtos, receitas e
-- producao_diaria, mesmo para quem tem perfil proprietario_admin. Isso é
-- mais restritivo que a regra de negócio original ("admin pode excluir
-- quando aplicável") — decisão consciente e aprovada: "admin pode excluir
-- quando aplicável" será decidida INDIVIDUALMENTE por módulo, quando esse
-- módulo tiver uma tela/fluxo real pedindo exclusão, não de forma genérica
-- aqui. Preferência arquitetural confirmada: cancelar/inativar (via coluna
-- de status, ex.: fornecedores.ativo=false) é sempre preferível a hard
-- DELETE para dado histórico/operacional. Quando um módulo específico
-- precisar de exclusão definitiva, isso deve vir como uma migration própria
-- e deliberada para aquele módulo, não uma policy genérica "para admin"
-- aqui.

BEGIN;

-- ------------------------------------------------------------
-- 1. perfis / permissoes / perfil_permissoes: catálogo, não é dado sensível
--    por si (não tem PII nem segredo) — leitura liberada para qualquer
--    usuário autenticado (necessário para o frontend montar o menu),
--    escrita só para admin.
-- ------------------------------------------------------------
alter table public.perfis enable row level security;
alter table public.permissoes enable row level security;
alter table public.perfil_permissoes enable row level security;

drop policy if exists perfis_select_authenticated on public.perfis;
create policy perfis_select_authenticated on public.perfis
  for select to authenticated using (true);

drop policy if exists perfis_admin_write on public.perfis;
create policy perfis_admin_write on public.perfis
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists permissoes_select_authenticated on public.permissoes;
create policy permissoes_select_authenticated on public.permissoes
  for select to authenticated using (true);

drop policy if exists permissoes_admin_write on public.permissoes;
create policy permissoes_admin_write on public.permissoes
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists perfil_permissoes_select_authenticated on public.perfil_permissoes;
create policy perfil_permissoes_select_authenticated on public.perfil_permissoes
  for select to authenticated using (true);

drop policy if exists perfil_permissoes_admin_write on public.perfil_permissoes;
create policy perfil_permissoes_admin_write on public.perfil_permissoes
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ------------------------------------------------------------
-- 2. usuarios: dado sensível (é a base da autorização).
--    - SELECT: o próprio usuário vê a própria linha; admin vê todas
--      (necessário para a tela administrativa de usuários).
--    - INSERT/UPDATE: só admin. Isso é proposital — NÃO existe policy de
--      self-UPDATE, então um usuário não pode alterar seu próprio `perfil`
--      e se autopromover. A única exceção de autoatualização é
--      ultimo_acesso_em, feita pela função registrar_acesso() (SECURITY
--      DEFINER, migration 0002), que já ignora RLS para essa única coluna.
--    - DELETE: nenhuma policy — decisão aprovada, ver bloco de comentário
--      acima ("SEM POLICY DE DELETE"). Excluir usuário fica indisponível;
--      preferir usuarios.ativo = false.
-- ------------------------------------------------------------
alter table public.usuarios enable row level security;

drop policy if exists usuarios_select_propria_ou_admin on public.usuarios;
create policy usuarios_select_propria_ou_admin on public.usuarios
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists usuarios_admin_insert on public.usuarios;
create policy usuarios_admin_insert on public.usuarios
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists usuarios_admin_update on public.usuarios;
create policy usuarios_admin_update on public.usuarios
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ------------------------------------------------------------
-- 3. fornecedores: leitura e escrita passam a exigir autenticação +
--    permissão específica (em vez de abertas para o papel anon).
--    fornecedores.cancelar existe no catálogo (0001) mas NENHUMA policy
--    abaixo a consulta — isoladamente ela não concede nada, não herda
--    fornecedores.editar, e quem edita aqui é fornecedores_update, que
--    checa exclusivamente fornecedores.editar. Ver comentário detalhado
--    na migration 0001 sobre por que isso é proposital nesta etapa.
-- ------------------------------------------------------------
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

-- Sem policy de DELETE — ver decisão aprovada no topo do arquivo.

-- ------------------------------------------------------------
-- 4. produtos / receitas: catálogo de referência, usado por mais de um
--    módulo futuro. Leitura liberada para qualquer usuário autenticado
--    (não tem dado pessoal/financeiro sensível); escrita restrita a admin
--    até existir um módulo de gestão de catálogo dedicado.
-- ------------------------------------------------------------
alter table public.produtos enable row level security;
alter table public.receitas enable row level security;

drop policy if exists produtos_select_authenticated on public.produtos;
create policy produtos_select_authenticated on public.produtos
  for select to authenticated using (true);

drop policy if exists produtos_admin_write on public.produtos;
create policy produtos_admin_write on public.produtos
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists receitas_select_authenticated on public.receitas;
create policy receitas_select_authenticated on public.receitas
  for select to authenticated using (true);

drop policy if exists receitas_admin_write on public.receitas;
create policy receitas_admin_write on public.receitas
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ------------------------------------------------------------
-- 5. producao_diaria: ainda não usada pelo frontend (produção continua em
--    localStorage nesta etapa), mas já é protegida agora, com o mesmo
--    padrão de permissão usado para fornecedores. producao.cancelar tem a
--    mesma observação de fornecedores.cancelar acima: nenhuma policy
--    abaixo a consulta, não herda producao.editar, e quem edita aqui é
--    producao_diaria_update, que checa exclusivamente producao.editar.
-- ------------------------------------------------------------
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

-- Sem policy de DELETE — ver decisão aprovada no topo do arquivo.

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENÇÃO CRÍTICA: reverter esta migration REABRE a vulnerabilidade
-- original — fornecedores, produtos, receitas e producao_diaria voltam a
-- aceitar leitura/escrita anônima (o problema P0 que esta migration existe
-- para fechar). NÃO faça isso casualmente; só como último recurso, com
-- plena consciência de que reintroduz o risco confirmado pela auditoria
-- original (chave publicável conseguindo INSERT anônimo nessas 4 tabelas).
-- BEGIN;
-- alter table public.producao_diaria disable row level security;
-- drop policy if exists producao_diaria_update on public.producao_diaria;
-- drop policy if exists producao_diaria_insert on public.producao_diaria;
-- drop policy if exists producao_diaria_select on public.producao_diaria;
--
-- drop policy if exists receitas_admin_write on public.receitas;
-- drop policy if exists receitas_select_authenticated on public.receitas;
-- alter table public.receitas disable row level security;
--
-- drop policy if exists produtos_admin_write on public.produtos;
-- drop policy if exists produtos_select_authenticated on public.produtos;
-- alter table public.produtos disable row level security;
--
-- drop policy if exists fornecedores_update on public.fornecedores;
-- drop policy if exists fornecedores_insert on public.fornecedores;
-- drop policy if exists fornecedores_select on public.fornecedores;
-- alter table public.fornecedores disable row level security;
--
-- drop policy if exists usuarios_admin_update on public.usuarios;
-- drop policy if exists usuarios_admin_insert on public.usuarios;
-- drop policy if exists usuarios_select_propria_ou_admin on public.usuarios;
-- alter table public.usuarios disable row level security;
--
-- drop policy if exists perfil_permissoes_admin_write on public.perfil_permissoes;
-- drop policy if exists perfil_permissoes_select_authenticated on public.perfil_permissoes;
-- drop policy if exists permissoes_admin_write on public.permissoes;
-- drop policy if exists permissoes_select_authenticated on public.permissoes;
-- drop policy if exists perfis_admin_write on public.perfis;
-- drop policy if exists perfis_select_authenticated on public.perfis;
-- alter table public.perfil_permissoes disable row level security;
-- alter table public.permissoes disable row level security;
-- alter table public.perfis disable row level security;
-- COMMIT;
