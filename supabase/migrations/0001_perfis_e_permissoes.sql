-- 0001_perfis_e_permissoes.sql
-- FUNDAÇÃO DE AUTORIZAÇÃO: perfis, catálogo de permissões e vínculo perfil->permissão.
--
-- NÃO EXECUTADA AUTOMATICAMENTE. Este arquivo é uma PROPOSTA de migration.
-- Rode manualmente no Supabase SQL Editor (ou via `supabase db push` se o CLI
-- for adotado depois). Este ambiente só possui a chave publicável (anon), que
-- não tem privilégio para rodar DDL — por isso a migration não foi aplicada
-- pelo assistente.
--
-- Reversível: ver bloco ROLLBACK ao final. Envolvida em transação explícita
-- (BEGIN/COMMIT) para garantir que aplica tudo ou nada, independente do
-- cliente SQL usado para rodar o arquivo. Nenhum statement abaixo é
-- incompatível com transação (sem CREATE INDEX CONCURRENTLY, sem VACUUM).

BEGIN;

-- 1. Tabela de perfis (papéis). Texto livre em vez de enum para permitir
--    criar novos perfis sem alterar schema/tipo no futuro.
create table if not exists public.perfis (
  nome        text primary key,
  descricao   text not null default '',
  nivel       integer not null default 0,        -- só para ordenação em telas de admin
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

comment on table public.perfis is
  'Catálogo de perfis de acesso (roles). Novos perfis podem ser inseridos aqui sem alterar código ou schema.';

-- 2. Catálogo de permissões. codigo segue o padrão "modulo.acao"
--    (ex.: 'fornecedores.visualizar', 'usuarios.administrar').
create table if not exists public.permissoes (
  codigo      text primary key,
  modulo      text not null,
  acao        text not null,
  descricao   text not null default '',
  criado_em   timestamptz not null default now()
);

comment on table public.permissoes is
  'Catálogo de permissões granulares (modulo.acao). Novas permissões podem ser inseridas aqui sem alterar código.';

-- 3. Vínculo N:N perfil -> permissão.
create table if not exists public.perfil_permissoes (
  perfil      text not null references public.perfis(nome) on delete cascade,
  permissao   text not null references public.permissoes(codigo) on delete cascade,
  primary key (perfil, permissao)
);

comment on table public.perfil_permissoes is
  'Concede uma permissão a um perfil. Um usuário herda todas as permissões do seu perfil (usuarios.perfil).';

-- 4. Seed dos 4 perfis iniciais aprovados (regras de negócio do Prompt 04).
insert into public.perfis (nome, descricao, nivel) values
  ('proprietario_admin',        'Acesso total ao sistema.', 100),
  ('gestao',                    'Acesso operacional e gerencial. Não administra usuários nem exclui definitivamente.', 60),
  ('operacional',               'Acesso restrito aos módulos operacionais explicitamente liberados.', 30),
  ('financeiro_administrativo', 'Reservado para o futuro módulo financeiro/administrativo.', 40)
on conflict (nome) do nothing;

-- 5. Seed do catálogo de permissões relevante ao que já existe hoje no
--    frontend (dashboard, fornecedores, produção-rota, aparência, perfil) +
--    permissões administrativas (usuarios, permissoes, auditoria, configuracoes)
--    + um placeholder para o futuro módulo financeiro. Módulos ainda não
--    implementados (Fluxo de Mercadorias, Estoque, Compras) NÃO são seedados
--    aqui de propósito — serão adicionados quando esses módulos existirem.
--
--    IMPORTANTE — semântica exata de fornecedores.cancelar e producao.cancelar
--    (decisão de negócio aprovada, revisão final pré-aplicação, item 1):
--      * `.cancelar` é uma permissão RESERVADA PARA IMPLEMENTAÇÃO FUTURA.
--      * Isoladamente, `.cancelar` HOJE NÃO CONCEDE OPERAÇÃO ALGUMA — não
--        existe nenhuma policy de RLS (migration 0005) que leia/verifique
--        `has_permissao('fornecedores.cancelar')` ou
--        `has_permissao('producao.cancelar')`. Nenhuma. Não é lida em
--        nenhum USING/WITH CHECK hoje.
--      * `.cancelar` NÃO herda `.editar` — são permissões independentes no
--        catálogo, sem nenhuma relação implícita entre elas.
--      * Usuários de `gestao` conseguem editar fornecedores/produção porque
--        TAMBÉM possuem `fornecedores.editar`/`producao.editar` (concedidas
--        separadamente, ver seção 6) — e não por possuírem `.cancelar`. Se
--        `.cancelar` fosse revogada de `gestao` hoje, absolutamente nada
--        mudaria no comportamento do sistema, porque nada a consulta.
--      * No futuro, cancelamento ganhará uma estrutura de negócio própria
--        (status, cancelado_por, cancelado_em, motivo_cancelamento — ver
--        Prompt 04 seção 12) e uma OPERAÇÃO/POLICY própria e dedicada, que aí
--        sim vai checar has_permissao('fornecedores.cancelar') /
--        has_permissao('producao.cancelar') especificamente, distinta da
--        policy de edição plena. Não implementado agora, de propósito — não
--        criar uma policy "falsa" só para "usar" a permissão.
insert into public.permissoes (codigo, modulo, acao, descricao) values
  ('dashboard.visualizar',   'dashboard',    'visualizar', 'Ver o dashboard inicial.'),
  ('perfil.visualizar',      'perfil',       'visualizar', 'Ver a própria página de perfil.'),
  ('aparencia.editar',       'aparencia',    'editar',     'Alterar tema/branding do sistema.'),
  ('fornecedores.visualizar','fornecedores', 'visualizar', 'Ver a lista de fornecedores.'),
  ('fornecedores.inserir',   'fornecedores', 'inserir',    'Cadastrar novo fornecedor.'),
  ('fornecedores.editar',    'fornecedores', 'editar',     'Editar fornecedor existente.'),
  ('fornecedores.cancelar',  'fornecedores', 'cancelar',   'RESERVADA PARA USO FUTURO — nenhuma policy consulta esta permissão hoje; isoladamente não concede nenhuma operação. Não herda fornecedores.editar. Ver comentário acima do bloco de seed.'),
  ('fornecedores.excluir',   'fornecedores', 'excluir',    'Excluir definitivamente um fornecedor (uso restrito).'),
  ('producao.visualizar',    'producao',     'visualizar', 'Ver registros de produção/vendas/sobras.'),
  ('producao.inserir',       'producao',     'inserir',    'Lançar novo registro de produção/vendas/sobras.'),
  ('producao.editar',        'producao',     'editar',     'Editar registro de produção existente.'),
  ('producao.cancelar',      'producao',     'cancelar',   'RESERVADA PARA USO FUTURO — nenhuma policy consulta esta permissão hoje; isoladamente não concede nenhuma operação. Não herda producao.editar. Ver comentário acima do bloco de seed.'),
  ('producao.excluir',       'producao',     'excluir',    'Excluir definitivamente um registro de produção (uso restrito).'),
  ('usuarios.visualizar',    'usuarios',     'visualizar', 'Ver a lista de usuários do sistema.'),
  ('usuarios.administrar',   'usuarios',     'administrar','Criar/editar/inativar usuários e atribuir perfil.'),
  ('permissoes.administrar', 'permissoes',   'administrar','Editar o catálogo de perfis/permissões.'),
  ('auditoria.visualizar',   'auditoria',    'visualizar', 'Ver o log de auditoria.'),
  ('configuracoes.administrar','configuracoes','administrar','Alterar configurações críticas do sistema.'),
  ('financeiro.visualizar',  'financeiro',   'visualizar', 'Reservado: acesso ao futuro módulo financeiro.')
on conflict (codigo) do nothing;

-- 6. Concessões por perfil, seguindo exatamente as regras aprovadas no Prompt 04.

-- proprietario_admin: acesso total (todas as permissões seedadas acima).
insert into public.perfil_permissoes (perfil, permissao)
select 'proprietario_admin', codigo from public.permissoes
on conflict do nothing;

-- gestao: recebe .visualizar/.inserir/.editar/.cancelar nos módulos
-- operacionais e gerenciais; NÃO excluir; NÃO administrar
-- usuários/permissões/configurações; NÃO ver auditoria; NÃO financeiro.
-- Nota: `.cancelar` é concedida aqui conforme a regra de negócio aprovada
-- ("gestão pode cancelar"), mas isso é só um REGISTRO no catálogo — ela não
-- é lida por nenhuma policy hoje (ver bloco de comentário acima). É
-- `fornecedores.editar`/`producao.editar` — concedidas nas linhas abaixo,
-- separadamente — que efetivamente permitem a `gestao` editar. Se
-- `.cancelar` não estivesse nesta lista, `gestao` continuaria editando
-- exatamente igual. Conceder a permissão agora não é incorreto: deixa o
-- catálogo pronto para quando a policy dedicada existir, sem exigir nova
-- migration de concessão depois.
insert into public.perfil_permissoes (perfil, permissao) values
  ('gestao', 'dashboard.visualizar'),
  ('gestao', 'perfil.visualizar'),
  ('gestao', 'aparencia.editar'),
  ('gestao', 'fornecedores.visualizar'),
  ('gestao', 'fornecedores.inserir'),
  ('gestao', 'fornecedores.editar'),
  ('gestao', 'fornecedores.cancelar'),
  ('gestao', 'producao.visualizar'),
  ('gestao', 'producao.inserir'),
  ('gestao', 'producao.editar'),
  ('gestao', 'producao.cancelar')
on conflict do nothing;

-- operacional: só produção (visualizar/inserir/editar); sem cancelar/excluir;
-- sem fornecedores; sem nada administrativo.
insert into public.perfil_permissoes (perfil, permissao) values
  ('operacional', 'dashboard.visualizar'),
  ('operacional', 'perfil.visualizar'),
  ('operacional', 'producao.visualizar'),
  ('operacional', 'producao.inserir'),
  ('operacional', 'producao.editar')
on conflict do nothing;

-- financeiro_administrativo: acesso básico + placeholder financeiro; SEM
-- administração global (nem usuarios, nem configuracoes) por padrão.
insert into public.perfil_permissoes (perfil, permissao) values
  ('financeiro_administrativo', 'dashboard.visualizar'),
  ('financeiro_administrativo', 'perfil.visualizar'),
  ('financeiro_administrativo', 'financeiro.visualizar')
on conflict do nothing;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro: estas 3 tabelas só contêm o seed criado por esta própria
-- migration (nenhum dado de negócio pré-existente passa por aqui).
-- BEGIN;
-- drop table if exists public.perfil_permissoes;
-- drop table if exists public.permissoes;
-- drop table if exists public.perfis;
-- COMMIT;
