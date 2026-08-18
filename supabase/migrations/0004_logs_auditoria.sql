-- 0004_logs_auditoria.sql
-- Fundação reutilizável de auditoria (Prompt 04, seção 11).
-- Guarda: usuário, data/hora, entidade, registro, ação, campo alterado,
-- valor anterior, valor novo. Ainda não é chamada por nenhum módulo de
-- negócio (Produção/Fluxo/Estoque não existem ainda) — é a base para os
-- próximos `services` chamarem via lib/audit/registrarAuditoria.js.
--
-- NÃO EXECUTADA AUTOMATICAMENTE. Rode manualmente no SQL Editor, depois de
-- 0001, 0002 e 0003 (esta migration usa public.has_permissao(), criada na 0003).
--
-- Envolvida em transação explícita (BEGIN/COMMIT) — só DDL padrão.

BEGIN;

create table if not exists public.logs_auditoria (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid references auth.users(id),
  usuario_nome   text,           -- snapshot do nome no momento da ação (sobrevive a troca/remoção de usuário)
  usuario_email  text,           -- snapshot do e-mail no momento da ação
  data_hora      timestamptz not null default now(),
  entidade       text not null,  -- ex.: 'pedido', 'producao', 'fornecedor'
  registro_id    text not null,  -- id do registro afetado (texto para caber uuid/serial/qualquer chave futura)
  acao           text not null,  -- ex.: 'criou', 'editou', 'cancelou', 'excluiu'
  campo          text,           -- nome do campo alterado, quando aplicável (nulo em ações de criação/exclusão inteiras)
  valor_anterior text,
  valor_novo     text
);

comment on table public.logs_auditoria is
  'Log de auditoria imutável. INSERT permitido para o próprio usuário autenticado; SELECT restrito a admin; sem UPDATE/DELETE para ninguém. usuario_id/usuario_nome/usuario_email são preenchidos server-side pelo trigger logs_auditoria_preencher_usuario, não pelo valor enviado pelo cliente — ver função abaixo.';

create index if not exists logs_auditoria_entidade_registro_idx
  on public.logs_auditoria (entidade, registro_id);

create index if not exists logs_auditoria_data_hora_idx
  on public.logs_auditoria (data_hora desc);

-- Índice na FK de usuário (Postgres não indexa FK automaticamente) — usado
-- por qualquer futura tela "histórico de ações de um usuário".
create index if not exists logs_auditoria_usuario_id_idx
  on public.logs_auditoria (usuario_id);

alter table public.logs_auditoria enable row level security;

-- INSERT: qualquer usuário autenticado pode gravar. A checagem abaixo
-- (usuario_id = auth.uid()) continua existindo como camada extra de defesa,
-- mas a garantia real contra falsificação de usuario_id/usuario_nome/
-- usuario_email é o TRIGGER logs_auditoria_preencher_usuario (ver abaixo),
-- que sobrescreve esses 3 campos com valores derivados do lado do servidor
-- antes mesmo desta policy avaliar — nesta política, a chamada é sobre
-- authenticated (o papel), não muda o comportamento.
drop policy if exists logs_auditoria_insert_propria on public.logs_auditoria;
create policy logs_auditoria_insert_propria
  on public.logs_auditoria
  for insert
  to authenticated
  with check (usuario_id = (select auth.uid()));

-- SELECT: só quem tem a permissão auditoria.visualizar (proprietario_admin
-- por padrão, ver migration 0001) pode ler o log. Função envolvida em
-- (select ...) — recomendação oficial de performance de RLS do Supabase:
-- evita reavaliar a função por linha, permite ao planner tratá-la como um
-- initPlan avaliado uma vez por statement.
drop policy if exists logs_auditoria_select_admin on public.logs_auditoria;
create policy logs_auditoria_select_admin
  on public.logs_auditoria
  for select
  to authenticated
  using ((select public.has_permissao('auditoria.visualizar')));

-- Nenhuma policy de UPDATE/DELETE é criada de propósito: com RLS habilitado
-- e sem policy para esses comandos, ambos ficam bloqueados para todo mundo,
-- inclusive admin — o log de auditoria é imutável por design.

-- ============================================================
-- ANTI-SPOOFING: trigger BEFORE INSERT que deriva usuario_id/usuario_nome/
-- usuario_email de fontes confiáveis do servidor, ignorando o que o
-- cliente mandou nesses 3 campos (achado da auditoria: usuario_id já era
-- protegido pela policy WITH CHECK acima, mas usuario_nome/usuario_email
-- podiam ser enviados como qualquer texto pelo cliente).
-- ============================================================

create or replace function public.logs_auditoria_preencher_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome  text;
  v_email text;
begin
  -- 1) usuario_id NUNCA vem do cliente: é sempre o auth.uid() da sessão
  --    atual, ponto. Isso torna a policy WITH CHECK (usuario_id = auth.uid())
  --    uma tautologia a partir daqui — mantida mesmo assim como defesa em
  --    profundidade (redundante, não prejudicial).
  new.usuario_id := auth.uid();

  -- 2) Sem sessão autenticada, não existe log possível. anon já é barrado
  --    pela ausência de policy de INSERT para esse papel — este RAISE é
  --    uma segunda barreira, útil se este trigger for reaproveitado em
  --    outro contexto de grants no futuro.
  if new.usuario_id is null then
    raise exception 'logs_auditoria: nao e possivel registrar auditoria sem uma sessao autenticada (auth.uid() nulo). Operacoes administrativas/server-side sem usuario real precisam de uma estrategia propria de atribuicao de autoria — ver comentario no final da migration 0004.';
  end if;

  -- 3) Nome/e-mail vêm de public.usuarios (perfil de app) quando existir;
  --    SECURITY DEFINER permite ler essa tabela mesmo que a policy de
  --    SELECT de usuarios restrinja a linha a "própria ou admin" (aqui
  --    sempre é a própria, então funcionaria de qualquer forma, mas
  --    SECURITY DEFINER também é o que permite o fallback abaixo em
  --    auth.users, que authenticated NÃO tem SELECT direto).
  select u.nome, u.email into v_nome, v_email
  from public.usuarios u
  where u.id = new.usuario_id;

  -- 4) Fallback: usuário existe no Supabase Auth mas ainda não tem linha
  --    em public.usuarios (ex.: acabou de ser criado no bootstrap e algo
  --    tentou logar auditoria antes do vínculo existir) — pega o e-mail
  --    diretamente de auth.users, que só é legível aqui por causa do
  --    SECURITY DEFINER (authenticated não tem SELECT em auth.users).
  if v_email is null then
    select au.email into v_email from auth.users au where au.id = new.usuario_id;
  end if;

  new.usuario_nome  := v_nome;   -- fica null se não houver linha em usuarios ainda; aceitável, é só o snapshot de exibição
  new.usuario_email := v_email;

  return new;
end;
$$;

comment on function public.logs_auditoria_preencher_usuario() is
  'BEFORE INSERT trigger de logs_auditoria. Deriva usuario_id de auth.uid() e usuario_nome/usuario_email de public.usuarios (com fallback em auth.users), ignorando qualquer valor desses 3 campos enviado pelo cliente. SECURITY DEFINER + search_path vazio (todas as referências schema-qualificadas) para poder ler auth.users, que authenticated não pode consultar diretamente.';

drop trigger if exists logs_auditoria_preencher_usuario_trigger on public.logs_auditoria;
create trigger logs_auditoria_preencher_usuario_trigger
  before insert on public.logs_auditoria
  for each row
  execute function public.logs_auditoria_preencher_usuario();

-- Menor privilégio: a função do trigger não precisa ser chamável
-- diretamente via RPC por ninguém (só é usada pelo próprio trigger).
-- Dupla proteção (revisão final pré-aplicação, item 4D): funções que
-- `returns trigger` não podem ser invocadas como função normal via SQL de
-- qualquer forma — o Postgres rejeita a chamada direta (ex.: `select
-- public.logs_auditoria_preencher_usuario()`) independente de GRANT/REVOKE,
-- porque o tipo de retorno `trigger` só é válido dentro do mecanismo de
-- trigger. O REVOKE abaixo é reforço de menor privilégio (evita listá-la
-- como RPC candidata no schema do PostgREST), não a única barreira.
revoke execute on function public.logs_auditoria_preencher_usuario() from public;

COMMIT;

-- ============================================================
-- AUDITORIA SEM auth.uid() — DECISÃO ADIADA DE PROPÓSITO, DOCUMENTADA
-- ============================================================
-- Hoje é IMPOSSÍVEL inserir em logs_auditoria sem uma sessão de usuário
-- real (o trigger lança exceção se auth.uid() for nulo — isso vale até
-- para uma conexão via service_role sem contexto de usuário, já que
-- auth.uid() também retorna nulo nesse caso; RLS bypass de service_role
-- não afeta o trigger, que roda para qualquer papel).
--
-- Isso é intencional por agora: não existe ainda nenhum processo
-- server-side/agendado que precise registrar auditoria sem um usuário
-- por trás. Quando existir (ex.: um job agendado, uma importação
-- automática), a estratégia recomendada — a decidir e implementar quando
-- o primeiro caso real aparecer, NÃO agora — é uma destas:
--   (a) atribuir a ação a um usuário "sistema" dedicado: uma linha real
--       em auth.users + public.usuarios (ex.: sistema@padocadamata...)
--       usada só por processos automatizados, que loga normalmente como
--       qualquer usuário; ou
--   (b) estender este trigger para reconhecer um segundo modo controlado
--       (ex.: checar uma GUC de sessão tipo `current_setting('app.actor',
--       true)`, setada só por conexões privilegiadas de confiança) — mais
--       flexível, mais complexo, maior superfície de abuso se mal
--       implementado.
-- Não implementar nenhuma das duas agora evita conceder um jeito de
-- burlar a exigência de usuário real antes de haver um caso concreto que
-- precise disso.

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENÇÃO: `drop table` abaixo APAGA TODO O HISTÓRICO DE AUDITORIA
-- acumulado até o momento do rollback — não há soft-delete aqui, é
-- destrutivo por natureza (é a própria tabela de log). Só use se tiver
-- certeza de que nenhum log até agora precisa ser preservado.
-- BEGIN;
-- drop table if exists public.logs_auditoria; -- também remove a trigger e a função do trigger via CASCADE implícito da tabela
-- drop function if exists public.logs_auditoria_preencher_usuario();
-- COMMIT;
