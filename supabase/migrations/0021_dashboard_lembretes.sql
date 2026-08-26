-- 0021_dashboard_lembretes.sql
-- "Quadro coletivo" de lembretes rápidos do Dashboard — post-it digital
-- da Padoca. Sem status, sem histórico, sem UPDATE nesta primeira
-- versão: a existência da linha é o próprio estado "ativo"; concluir ou
-- excluir são, no banco, a mesma operação (DELETE) — a distinção entre
-- os dois é só de intenção na UI (dois botões diferentes chamando o
-- mesmo DELETE), não dois comportamentos diferentes de dado.
--
-- NAO EXECUTADA AUTOMATICAMENTE. Escrita do zero no scratchpad a partir
-- do desenho aprovado nesta conversa.
--
-- Pré-requisitos reais (dependências de SQL, já aplicadas):
--   * public.has_permissao(text) — 0003/0016.
--   * public.usuarios — 0002/0002b (para o snapshot de nome).
--   * auth.users (Supabase Auth, gerenciado pela plataforma).
--
-- ESCOPO — SOMENTE:
--   * 1 tabela nova: public.dashboard_lembretes;
--   * RLS + 3 policies (select/insert/delete — nenhuma de UPDATE, de
--     propósito: sem edição de texto nesta versão. Com RLS habilitada e
--     sem policy de UPDATE, o comando fica bloqueado para todo mundo,
--     inclusive admin — é o comportamento desejado, não um esquecimento);
--   * 1 função de trigger (dashboard_lembretes_preencher_usuario) +
--     1 trigger BEFORE INSERT, mesmo padrão já usado por
--     logs_auditoria_preencher_usuario (migration 0004): deriva
--     criado_por/criado_por_nome do lado do servidor, nunca confia no
--     que o cliente mandar nesses 2 campos.
-- Esta migration NÃO faz, e não deve fazer:
--   * nenhuma alteração em nenhuma tabela existente (producao_registros,
--     fornecedores, fornecedor_regras_pedido, logs_auditoria, usuarios);
--   * nenhum INSERT em logs_auditoria — decisão explícita: lembrete não
--     é dado de negócio auditável, é recado efêmero de post-it;
--   * nenhuma RPC — INSERT/DELETE acontecem via client direto
--     (supabase.from('dashboard_lembretes').insert/delete), protegidos
--     só por RLS, suficiente para este dado de baixo risco;
--   * nenhuma alteração em nenhuma migration anterior (0001..0020).
--
-- Permissão reaproveitada: dashboard.visualizar (já existe, 0001) para
-- SELECT/INSERT/DELETE — decisão aprovada: quem vê o Dashboard pode
-- adicionar/concluir/excluir qualquer lembrete do quadro coletivo, sem
-- distinção de autor. Nenhum código de permissão novo é criado.
--
-- Envolvida em transação explícita (BEGIN/COMMIT) — só DDL padrão e
-- CREATE OR REPLACE FUNCTION.

BEGIN;

-- ============================================================
-- 1. public.dashboard_lembretes
-- ============================================================
-- criado_por: FK para auth.users(id) com ON DELETE SET NULL — decisão
-- explícita para não criar dependência rígida que impeça futuramente
-- remover/desativar um usuário. criado_por_nome é o snapshot do nome no
-- momento da criação (mesmo raciocínio de logs_auditoria.usuario_nome,
-- 0004) — sobrevive à perda do vínculo, então mesmo com criado_por nulo
-- o lembrete continua mostrando quem o criou.

create table if not exists public.dashboard_lembretes (
  id               uuid primary key default gen_random_uuid(),
  texto            text not null,
  criado_por       uuid references auth.users(id) on delete set null,
  criado_por_nome  text,
  criado_em        timestamptz not null default now(),

  constraint dashboard_lembretes_texto_nao_vazio
    check (btrim(texto) <> '')
);

comment on table public.dashboard_lembretes is
  'Quadro coletivo de lembretes rapidos do Dashboard (post-it digital). Sem status e sem historico por design: a existencia da linha e o proprio estado "ativo". Concluir/excluir sao, no banco, o mesmo DELETE -- a distincao e so de intencao na UI. criado_por usa ON DELETE SET NULL de proposito (nunca impede remover/desativar um usuario); criado_por_nome preserva o snapshot mesmo depois disso. Nao ha auditoria em logs_auditoria para esta tabela -- decisao deliberada, nao e dado de negocio.';

comment on column public.dashboard_lembretes.criado_por is
  'FK para auth.users(id), ON DELETE SET NULL -- nunca bloqueia nem apaga em cascata a remocao de um usuario. Pode ficar NULL.';

comment on column public.dashboard_lembretes.criado_por_nome is
  'Snapshot do nome de quem criou, no momento da criacao -- preenchido pelo trigger abaixo, nao pelo cliente. Sobrevive a criado_por virar NULL.';

create index if not exists dashboard_lembretes_criado_em_idx
  on public.dashboard_lembretes (criado_em desc);


-- ============================================================
-- 2. RLS de dashboard_lembretes
-- ============================================================
-- Só SELECT/INSERT/DELETE, reaproveitando dashboard.visualizar (0001) —
-- nenhum código de permissão novo. Sem policy de UPDATE, de proposito:
-- não existe edição de texto nesta primeira versão; com RLS habilitada
-- e nenhuma policy de UPDATE, o comando fica bloqueado para todo mundo.

alter table public.dashboard_lembretes enable row level security;

drop policy if exists dashboard_lembretes_select on public.dashboard_lembretes;
create policy dashboard_lembretes_select on public.dashboard_lembretes
  for select to authenticated
  using ((select public.has_permissao('dashboard.visualizar')));

drop policy if exists dashboard_lembretes_insert on public.dashboard_lembretes;
create policy dashboard_lembretes_insert on public.dashboard_lembretes
  for insert to authenticated
  with check ((select public.has_permissao('dashboard.visualizar')));

drop policy if exists dashboard_lembretes_delete on public.dashboard_lembretes;
create policy dashboard_lembretes_delete on public.dashboard_lembretes
  for delete to authenticated
  using ((select public.has_permissao('dashboard.visualizar')));

comment on policy dashboard_lembretes_select on public.dashboard_lembretes is
  'Quem ve o Dashboard (dashboard.visualizar) ve todos os lembretes do quadro coletivo, sem distincao de autor.';
comment on policy dashboard_lembretes_insert on public.dashboard_lembretes is
  'Quem ve o Dashboard pode adicionar lembrete -- mesma permissao de leitura, sem codigo novo.';
comment on policy dashboard_lembretes_delete on public.dashboard_lembretes is
  'Quem ve o Dashboard pode concluir OU excluir qualquer lembrete (mesmo criado por outra pessoa) -- DELETE, sem distincao entre os dois no banco.';


-- ============================================================
-- 3. Trigger BEFORE INSERT — deriva criado_por/criado_por_nome
-- ============================================================
-- Mesmo padrão de segurança de logs_auditoria_preencher_usuario (0004):
-- ignora qualquer valor de criado_por/criado_por_nome enviado pelo
-- cliente, deriva sempre do lado do servidor a partir de auth.uid().

create or replace function public.dashboard_lembretes_preencher_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
begin
  new.criado_por := auth.uid();

  if new.criado_por is null then
    raise exception
      'dashboard_lembretes: nao e possivel criar um lembrete sem uma sessao autenticada (auth.uid() nulo).';
  end if;

  select u.nome into v_nome
  from public.usuarios u
  where u.id = new.criado_por;

  new.criado_por_nome := v_nome;

  return new;
end;
$$;

comment on function public.dashboard_lembretes_preencher_usuario() is
  'BEFORE INSERT trigger de dashboard_lembretes. Deriva criado_por de auth.uid() e criado_por_nome de public.usuarios, ignorando qualquer valor desses 2 campos enviado pelo cliente. SECURITY DEFINER + search_path vazio, mesmo padrao de logs_auditoria_preencher_usuario (migration 0004).';

drop trigger if exists dashboard_lembretes_preencher_usuario_trigger on public.dashboard_lembretes;
create trigger dashboard_lembretes_preencher_usuario_trigger
  before insert on public.dashboard_lembretes
  for each row
  execute function public.dashboard_lembretes_preencher_usuario();

-- Menor privilégio: função de trigger não precisa ser chamável
-- diretamente via RPC por ninguém (mesmo raciocínio de 0004).
revoke execute on function public.dashboard_lembretes_preencher_usuario() from public;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENÇÃO: `drop table` abaixo apaga todos os lembretes ativos no
-- momento do rollback — não há soft-delete aqui, é a própria tabela.
-- BEGIN;
-- drop trigger if exists dashboard_lembretes_preencher_usuario_trigger on public.dashboard_lembretes;
-- drop function if exists public.dashboard_lembretes_preencher_usuario();
-- drop policy if exists dashboard_lembretes_delete on public.dashboard_lembretes;
-- drop policy if exists dashboard_lembretes_insert on public.dashboard_lembretes;
-- drop policy if exists dashboard_lembretes_select on public.dashboard_lembretes;
-- drop table if exists public.dashboard_lembretes;
-- COMMIT;
