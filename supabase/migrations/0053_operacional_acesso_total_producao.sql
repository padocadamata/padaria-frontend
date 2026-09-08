-- 0053_operacional_acesso_total_producao.sql
-- Concede ao perfil 'operacional' (identificado como o perfil do
-- "pessoal da Produção" -- descrição original em 0001:
-- "Acesso restrito aos módulos operacionais explicitamente liberados")
-- as 19 permissões atuais do módulo Produção que ele ainda não possuía.
--
-- ACHADO desta auditoria (gestão de acessos): o perfil 'operacional' só
-- tinha, desde a migration 0001, os 3 códigos originais
-- (producao.visualizar/inserir/editar). NENHUMA das permissões
-- adicionadas depois (historico.*, planejamento.*, produtos_producao.*,
-- migration 0016; producao_expositores.*, migration 0030;
-- producao_sacos.*, migrations 0042/0050) foi concedida a este perfil em
-- nenhuma migration posterior -- todas seguiram o padrão "concedida
-- inicialmente só a proprietario_admin" e nunca foram estendidas depois.
-- Isso explica por que o "pessoal da Produção" não enxerga Histórico/
-- Planejamento/Produtos/Expositores/Sacos Fechados hoje. Precedente já
-- existente de estender este mesmo perfil depois do seed inicial:
-- migration 0038 concedeu agenda.visualizar/inserir/editar a
-- 'operacional'.
--
-- Mesmas 19 permissões que o novo controle de UX "Acesso total à
-- Produção" (lib/auth/matrizPermissoes.js, codigosDoGrupo('producao'))
-- usa na tela Admin > Usuários e Acessos -- ver relatório desta rodada.
-- producao.excluir fica de fora de propósito (reservada, nenhuma policy
-- a lê hoje -- mesmo critério já usado desde 0001 para não conceder
-- permissões reservadas/inertes sem necessidade real).
--
-- NÃO EXECUTAR sem autorização explícita. Rodar
-- pre_auditoria_operacional_producao_EXECUTAR.sql ANTES.
--
-- ============================================================
-- ESCOPO -- SOMENTE:
-- ============================================================
--   * INSERT em public.perfil_permissoes, SOMENTE para perfil='operacional',
--     SOMENTE as 19 permissões listadas abaixo, idempotente
--     (ON CONFLICT DO NOTHING -- mesmo padrão de toda concessão de perfil
--     já usada neste projeto, incl. 0001/0038).
--
-- Esta migration NÃO faz, e não deve fazer:
--   * nenhuma alteração em public.perfis, public.permissoes,
--     public.usuarios, public.usuario_permissoes;
--   * nenhuma alteração em nenhum OUTRO perfil (proprietario_admin,
--     gestao, financeiro_administrativo) -- nenhuma linha com
--     perfil <> 'operacional' é inserida;
--   * nenhuma alteração em permissão de módulos fora de Produção
--     (Pedidos, Fornecedores, Financeiro, Administração, Agenda,
--     Catálogo de Produtos) -- nenhum código fora da lista dos 19 é
--     mencionado;
--   * producao.excluir NÃO é concedida (reservada/inerte, fora da lista);
--   * nenhuma alteração em RLS/RPC/trigger/frontend -- migração puramente
--     de dado de associação perfil×permissão, mesma tabela e mesmo
--     padrão já usados desde a 0001;
--   * nenhuma alteração nas migrations 0051/0052 (integração
--     Pedidos→Sacos→Estoque, frente paralela) nem em qualquer objeto de
--     Sacos Fechados/Estoque/Pedidos.

BEGIN;

insert into public.perfil_permissoes (perfil, permissao) values
  ('operacional', 'producao.cancelar'),
  ('operacional', 'producao.corrigir'),
  ('operacional', 'historico.visualizar'),
  ('operacional', 'historico.editar'),
  ('operacional', 'planejamento.visualizar'),
  ('operacional', 'planejamento.editar'),
  ('operacional', 'produtos_producao.visualizar'),
  ('operacional', 'produtos_producao.editar'),
  ('operacional', 'producao_expositores.visualizar'),
  ('operacional', 'producao_expositores.operar'),
  ('operacional', 'producao_expositores.editar'),
  ('operacional', 'producao_expositores.excluir'),
  ('operacional', 'producao_sacos.visualizar'),
  ('operacional', 'producao_sacos.operar'),
  ('operacional', 'producao_sacos.editar'),
  ('operacional', 'producao_sacos.excluir')
on conflict do nothing;
-- Nota: producao.visualizar/inserir/editar já eram concedidas desde a
-- 0001 (ON CONFLICT DO NOTHING os deixaria intocados mesmo se
-- reincluídos aqui) -- omitidos da lista acima só para deixar explícito,
-- por leitura direta deste arquivo, exatamente quais 16 linhas são
-- NOVAS.

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro -- remove SOMENTE as linhas que esta própria migration insere,
-- pelo par exato (perfil, permissao); nunca por padrão de texto (LIKE),
-- nunca afeta producao.visualizar/inserir/editar (concedidas desde a
-- 0001, não tocadas por este arquivo).
-- BEGIN;
--
--   delete from public.perfil_permissoes
--   where perfil = 'operacional'
--     and permissao in (
--       'producao.cancelar', 'producao.corrigir',
--       'historico.visualizar', 'historico.editar',
--       'planejamento.visualizar', 'planejamento.editar',
--       'produtos_producao.visualizar', 'produtos_producao.editar',
--       'producao_expositores.visualizar', 'producao_expositores.operar',
--       'producao_expositores.editar', 'producao_expositores.excluir',
--       'producao_sacos.visualizar', 'producao_sacos.operar',
--       'producao_sacos.editar', 'producao_sacos.excluir'
--     );
--
-- COMMIT;
