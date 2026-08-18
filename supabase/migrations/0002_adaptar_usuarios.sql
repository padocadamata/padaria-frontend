-- 0002_adaptar_usuarios.sql
-- Adapta a tabela `usuarios` (hoje vazia, 0 registros) para o modelo:
--   auth.users (Supabase Auth)  +  usuarios (perfil de aplicação)
-- vinculados pelo mesmo UUID.
--
-- NÃO EXECUTADA AUTOMATICAMENTE (mesma limitação da migration 0001 — sem
-- chave privilegiada neste ambiente). Rode manualmente no SQL Editor.
--
-- ============================================================
-- DIAGNÓSTICO DO SCHEMA ATUAL (feito por introspecção read-only via
-- PostgREST antes de escrever esta migration)
-- ============================================================
-- Colunas confirmadas em public.usuarios: id (uuid), nome, email, perfil,
-- senha, ativo, criado_em, atualizado_em.
-- Confirmado por teste de leitura: id é do tipo uuid (aceitou filtro por
-- UUID, rejeitou filtro por inteiro com erro 22P02).
-- Confirmado por teste de escrita (POST vazio, sem inserir nada): a tabela
-- JÁ TEM RLS habilitado e bloqueando INSERT anônimo (erro 42501) — ao
-- contrário de fornecedores/produtos/receitas/producao_diaria, que
-- aceitaram o POST vazio (só falharam depois, em constraint NOT NULL),
-- ou seja, hoje aceitam escrita anônima. Ver migration 0005.
-- NÃO existe hoje nenhuma coluna de vínculo com auth.users (sem user_id/
-- auth_id/uuid), nem perfil_id, nem ultimo_acesso.
--
-- ============================================================
-- VERIFICAÇÃO DE public.usuarios.id (PK/UNIQUE) — NÃO CONFIRMADO
-- ============================================================
-- Tentei confirmar, só por leitura, se usuarios.id tem PRIMARY KEY ou
-- UNIQUE (necessário para a FK desta migration e para o ON CONFLICT (id)
-- da migration 0006), usando exclusivamente a chave publicável (anon)
-- disponível neste ambiente:
--   1) GET /rest/v1/ com Accept: application/openapi+json  -> HTTP 401
--      "Secret API key required" (a introspecção OpenAPI do PostgREST
--      exige a chave secreta/service_role, que não está disponível aqui).
--   2) GET /rest/v1/table_constraints com Accept-Profile: information_schema
--      -> HTTP 406 (schema information_schema não exposto ao papel anon).
--   3) GET /rest/v1/pg_constraint -> HTTP 404 PGRST205 (pg_catalog não é
--      exposto via PostgREST).
-- CONCLUSÃO: NÃO FOI POSSÍVEL CONFIRMAR por leitura externa. Não presumo
-- que a PK existe. Em vez disso, o PASSO 2 abaixo GARANTE a constraint de
-- forma seguríssima e idempotente, verificando o catálogo real do Postgres
-- (pg_constraint) NO MOMENTO em que a migration for de fato aplicada — ali
-- sim há acesso privilegiado real (SQL Editor), então a checagem é
-- confiável. Como a tabela está com 0 registros, adicionar essa
-- constraint (se ainda não existir) é seguro e não pode falhar por
-- duplicidade de valores.
--
-- DECISÃO: a tabela `usuarios` é adequada para ser adaptada (não recriada). Ações:
--   1) dropar a coluna `senha` — o modelo de autenticação passa a ser
--      100% Supabase Auth (auth.users guarda a senha, com hash, fora do
--      schema public); manter uma coluna de senha na tabela de perfil da
--      aplicação seria duplicar/arriscar um segundo local de senha.
--      A tabela está com 0 linhas, então não há dado a perder.
--   2) garantir (sem presumir) que usuarios.id tem uma constraint UNIQUE
--      ou PRIMARY KEY, checando o catálogo real antes de agir.
--   3) vincular usuarios.id a auth.users.id via foreign key (mesmo UUID).
--   4) vincular usuarios.perfil a perfis.nome via foreign key.
--   5) adicionar ultimo_acesso_em (nullable) — pedido pela tela admin.
--   6) garantir e-mail único.
--   7) função registrar_acesso() para o próprio usuário atualizar seu
--      ultimo_acesso_em sem precisar de permissão de UPDATE geral na tabela.
--
-- Envolvida em transação explícita (BEGIN/COMMIT): todos os statements são
-- DDL padrão (ALTER TABLE, CREATE FUNCTION), nenhum incompatível com
-- transação.

BEGIN;

-- 1. Remover coluna de senha (não deve mais existir fora do auth.users).
alter table public.usuarios drop column if exists senha;

-- 2. Garantir que usuarios.id tem PRIMARY KEY ou UNIQUE, sem presumir.
--    Consulta o catálogo real (pg_constraint) e só adiciona a constraint
--    se nenhuma já cobrir essa coluna sozinha. Seguro com 0 registros —
--    não há valor duplicado possível que faria isso falhar.
--
--    VERIFICAÇÃO TÉCNICA (revisão final pré-aplicação, item 6):
--      * pg_constraint.conkey é um array de attnums (posições de coluna),
--        um por coluna que participa da constraint. Comparar
--        `c.conkey = array[<attnum de id>]` só é verdadeiro para uma
--        constraint de UMA coluna só, exatamente `id` — uma PK/UNIQUE
--        composta que inclua `id` junto de outra coluna NÃO bate aqui (e
--        de fato não serviria para `ON CONFLICT (id)` de qualquer forma,
--        que também exige unicidade só de `id`).
--      * `c.contype in ('p', 'u')` cobre as DUAS formas que o Postgres
--        aceita para `ON CONFLICT (id)`: PRIMARY KEY (id) e UNIQUE (id) —
--        ambas criam, por baixo, um índice único sobre a coluna, que é o
--        que o `ON CONFLICT` de fato usa para detectar o conflito.
--      * Caso de borda aceito conscientemente: um índice único "solto" em
--        `id` (criado via `CREATE UNIQUE INDEX` sem virar uma constraint
--        nomeada) não aparece em pg_constraint, então esta checagem não o
--        veria — o bloco tentaria criar `usuarios_id_key` mesmo já
--        existindo um índice único equivalente. Isso é seguro mesmo assim
--        (o Postgres permite mais de um índice único cobrindo a mesma
--        coluna; fica redundante, nunca é um erro) — optei por não
--        complicar a consulta para cobrir esse caso, extremamente
--        improvável em uma tabela criada por ferramenta padrão (toda tabela
--        até agora neste projeto usa PK nomeada, não índice solto).
do $$
declare
  v_tem_constraint boolean;
begin
  select exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.usuarios'::regclass
      and c.contype in ('p', 'u')            -- primary key ou unique
      and c.conkey = array[
            (select attnum from pg_attribute
             where attrelid = 'public.usuarios'::regclass and attname = 'id')
          ]
  ) into v_tem_constraint;

  if not v_tem_constraint then
    raise notice 'usuarios.id não tinha PK/UNIQUE — adicionando UNIQUE constraint (tabela tinha 0 registros no momento desta migration).';
    alter table public.usuarios add constraint usuarios_id_key unique (id);
  else
    raise notice 'usuarios.id já possui PK/UNIQUE — nenhuma ação necessária.';
  end if;
end $$;
-- GARANTIA LÓGICA para o rollback (item 7): este bloco só cria
-- usuarios_id_key quando v_tem_constraint é false, ou seja, quando NENHUMA
-- PK/UNIQUE de uma coluna só já cobria `id` — sob QUALQUER nome. Logo, se
-- `usuarios_id_key` existir depois desta migration rodar, ela foi
-- necessariamente criada por ela (não há como uma constraint pré-existente
-- com esse nome específico ter sobrevivido à checagem acima sem ser
-- detectada, exceto por uma colisão de nome com uma constraint que NÃO
-- cobre `id` sozinha — cenário não tratado de propósito, ver nota abaixo).
-- Isso é o que permite ao ROLLBACK, no final deste arquivo, remover
-- usuarios_id_key sem ambiguidade sobre quem a criou.

-- 3. Vincular id ao Supabase Auth.
do $$
begin
  alter table public.usuarios
    add constraint usuarios_id_fkey foreign key (id) references auth.users(id) on delete cascade;
exception
  when duplicate_object then null;
end $$;

-- 4. Vincular perfil ao catálogo de perfis (requer migration 0001 aplicada antes).
do $$
begin
  alter table public.usuarios
    add constraint usuarios_perfil_fkey foreign key (perfil) references public.perfis(nome);
exception
  when duplicate_object then null;
end $$;

-- 4b. Índice em usuarios.perfil — Postgres não indexa FK automaticamente, e
--     esta coluna é usada em JOIN dentro de public.has_permissao() (0003),
--     chamada em praticamente toda policy de RLS do sistema. Baixo impacto
--     hoje (0 registros), mas é o padrão correto antes de a equipe crescer.
create index if not exists usuarios_perfil_idx on public.usuarios (perfil);

-- 5. Último acesso (nullable — só é preenchido após o primeiro login real).
alter table public.usuarios add column if not exists ultimo_acesso_em timestamptz;

-- 6. E-mail único (idempotente).
do $$
begin
  alter table public.usuarios add constraint usuarios_email_key unique (email);
exception
  when duplicate_object then null;
end $$;

-- 7. Permite que o próprio usuário autenticado registre seu último acesso,
--    sem conceder UPDATE geral na tabela usuarios (que fica só para admin —
--    ver migration 0005).
--
--    HARDENING (revisão final pré-aplicação, item 2) — auditoria linha a
--    linha desta função:
--      * SECURITY DEFINER é realmente necessário: sem ele, o UPDATE abaixo
--        ficaria sujeito à policy de UPDATE de usuarios (0005), que é
--        "só admin" — um usuário comum não-admin não conseguiria nem
--        atualizar a própria ultimo_acesso_em. SECURITY DEFINER faz o UPDATE
--        rodar com o privilégio do dono da função, contornando essa policy
--        SÓ para este UPDATE específico e hardcoded.
--      * search_path = '' (vazio) — todas as referências já são
--        schema-qualificadas (public.usuarios, auth.uid()), então um
--        search_path vazio não quebra nada e elimina qualquer ambiguidade.
--      * A função NÃO recebe parâmetro nenhum — não existe forma de o
--        chamador escolher outro id além do próprio.
--      * O UPDATE só altera public.usuarios.ultimo_acesso_em, e só da linha
--        onde id = auth.uid() — nenhuma outra coluna (perfil, nome, email,
--        ativo) é tocada, nem poderia ser: elas não aparecem em nenhum SET.
--      * Se auth.uid() for nulo (sem sessão), a cláusula WHERE id = NULL não
--        casa com nenhuma linha (semântica padrão de NULL no Postgres) — o
--        UPDATE roda e afeta 0 linhas, não é um erro, não atualiza ninguém.
--      * EXECUTE: por padrão, uma função nova é executável por PUBLIC
--        (o que inclui `anon`). Revogado abaixo e concedido só para
--        `authenticated` — é o único papel que legitimamente chama isto
--        (via RPC, logo após um login bem-sucedido). anon não recebe
--        EXECUTE: mesmo que chamasse, auth.uid() seria nulo e o UPDATE não
--        afetaria nada, mas a revogação é reforço explícito de menor
--        privilégio, não uma correção de um comportamento inseguro anterior.
create or replace function public.registrar_acesso()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.usuarios
    set ultimo_acesso_em = now()
    where id = auth.uid();
end;
$$;

comment on function public.registrar_acesso() is
  'Chamada pelo próprio usuário autenticado (via RPC) logo após o login, para atualizar ultimo_acesso_em. Não concede UPDATE geral na tabela usuarios — só esta coluna, só da própria linha (id = auth.uid()), sem parâmetro que permita escolher outro usuário. search_path vazio, EXECUTE restrito a authenticated.';

revoke execute on function public.registrar_acesso() from public;
grant execute on function public.registrar_acesso() to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- ATENÇÃO — este rollback NÃO é totalmente reversível sem perda:
--   - Se ultimo_acesso_em já tiver sido preenchido por logins reais entre
--     a aplicação e o rollback desta migration, esses valores são
--     PERDIDOS ao dropar a coluna (não há como "desfazer" só o schema
--     preservando esse dado).
--   - A coluna `senha` original NÃO é restaurável com o tipo/valores
--     originais — a introspecção read-only nunca revelou o tipo exato
--     dessa coluna (só sabíamos que existia), e a tabela já estava vazia
--     quando foi dropada, então não há dado original para recuperar de
--     qualquer forma. O comando abaixo recria a coluna vazia, como
--     `text`, só para não deixar o schema "faltando" a coluna — não é
--     uma restauração fiel.
--   - Sobre dropar usuarios_id_key no rollback: NÃO é uma suposição. Pela
--     garantia lógica documentada junto ao bloco que a cria (passo 2 acima),
--     usuarios_id_key só existe se tiver sido esta migration que a criou —
--     se a tabela já tinha PK/UNIQUE antes (sob qualquer outro nome), o
--     bloco nunca chega a criar usuarios_id_key. Ou seja: se você rodou
--     esta migration e agora está revertendo ela, é seguro dropar
--     usuarios_id_key sem precisar confirmar nada à parte — se ela existir,
--     é porque esta migration a criou. (A única exceção teórica é uma
--     colisão de nome pré-existente com uma constraint que NÃO cobre `id`
--     sozinha — cenário não tratado, ver nota no passo 2; nesse caso
--     hipotético o `alter table ... add constraint usuarios_id_key` do
--     passo 2 já teria falhado com erro de nome duplicado, então a
--     migration original nunca teria completado, e você não estaria
--     revertendo algo que nunca aplicou.)
-- BEGIN;
-- drop function if exists public.registrar_acesso();
-- alter table public.usuarios drop constraint if exists usuarios_email_key;
-- alter table public.usuarios drop column if exists ultimo_acesso_em;
-- drop index if exists public.usuarios_perfil_idx;
-- alter table public.usuarios drop constraint if exists usuarios_perfil_fkey;
-- alter table public.usuarios drop constraint if exists usuarios_id_fkey;
-- alter table public.usuarios drop constraint if exists usuarios_id_key;
-- alter table public.usuarios add column if not exists senha text; -- não restaura valores/tipo original, ver nota acima
-- COMMIT;
