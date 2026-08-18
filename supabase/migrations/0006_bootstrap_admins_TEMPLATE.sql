-- 0006_bootstrap_admins_TEMPLATE.sql
--
-- ESTE ARQUIVO É UM TEMPLATE. NÃO RODE COMO ESTÁ.
-- Não crio usuários reais automaticamente sem dados fornecidos pelo
-- proprietário — os dois e-mails abaixo são placeholders que precisam ser
-- substituídos pelos donos do sistema. NUNCA coloque senha, UUID real ou
-- e-mail real diretamente neste arquivo versionado — edite uma CÓPIA local
-- só na hora de rodar no SQL Editor, ou substitua e cole direto no editor
-- sem salvar o valor real de volta no arquivo do repositório.
--
-- Por que este arquivo NÃO está envolvido em BEGIN/COMMIT como as demais
-- migrations: ele é pensado para ser rodado interativamente por uma pessoa,
-- que deve conferir o resultado do passo 3 (SELECT de verificação) antes de
-- considerar o bootstrap concluído — manter os statements soltos deixa
-- claro que é um roteiro de 3 passos, não uma transação atômica única. Os
-- dois INSERTs abaixo são independentes entre si (um proprietário pode ser
-- vinculado com sucesso mesmo que o outro ainda não tenha sido criado no
-- Supabase Auth) — atomicidade entre eles não traz benefício real aqui.
--
-- ============================================================
-- PASSO 1 — Criar os dois usuários no Supabase Auth (fora deste SQL)
-- ============================================================
-- No painel do Supabase: Authentication > Users > "Add user" (ou "Invite").
-- Crie os dois usuários com o e-mail e senha REAIS de cada proprietário,
-- diretamente na interface do Supabase — NUNCA digite a senha em SQL, em
-- nenhum arquivo, nem aqui. Isso cria a linha correspondente em auth.users
-- com um UUID gerado pelo Supabase (você não precisa saber esse UUID de
-- antemão — o passo 2 encontra pelo e-mail).
--
-- ============================================================
-- PASSO 2 — Vincular os UUIDs a public.usuarios com perfil proprietario_admin
-- ============================================================
-- Rode isto no SQL Editor do Supabase (Authentication > SQL Editor),
-- SUBSTITUINDO os e-mails abaixo pelos e-mails reais usados no passo 1.
-- O SQL Editor conecta com um papel privilegiado que ignora RLS — por
-- isso este INSERT funciona mesmo depois da migration 0005 ter deixado
-- `usuarios` com INSERT restrito a quem já é admin (ninguém é, ainda,
-- neste ponto do bootstrap): RLS não bloqueia o SQL Editor, só bloqueia
-- conexões normais da aplicação (via chave anon/authenticated do
-- PostgREST). NÃO tente rodar este INSERT autenticado pela aplicação —
-- ele vai falhar, e é esperado que falhe ali.
--
-- Cada INSERT abaixo só encontra uma linha em auth.users se o e-mail
-- exato já tiver sido criado no passo 1 — se o e-mail ainda não existir
-- lá, o SELECT interno não retorna nada e o INSERT correspondente NÃO
-- cria nenhuma linha (não é um erro, é silencioso — por isso o passo 3 é
-- obrigatório, não opcional).

insert into public.usuarios (id, nome, email, perfil, ativo)
select id, 'Proprietário 1', email, 'proprietario_admin', true
from auth.users
where email = '<EMAIL_DO_PROPRIETARIO_1>'
on conflict (id) do update
  set nome = excluded.nome, perfil = 'proprietario_admin', ativo = true;

insert into public.usuarios (id, nome, email, perfil, ativo)
select id, 'Proprietário 2', email, 'proprietario_admin', true
from auth.users
where email = '<EMAIL_DO_PROPRIETARIO_2>'
on conflict (id) do update
  set nome = excluded.nome, perfil = 'proprietario_admin', ativo = true;

-- ============================================================
-- PASSO 3 — CONFERIR (obrigatório, não pule)
-- ============================================================
-- Filtra especificamente pelos DOIS e-mails substituídos no passo 2 — não
-- por `perfil = 'proprietario_admin'` de forma genérica, para a conferência
-- não ficar ambígua se algum dia existir um terceiro proprietario_admin no
-- sistema (essa consulta continuaria mostrando só os dois que interessam
-- agora). SUBSTITUA os mesmos dois e-mails usados no passo 2 nas duas
-- consultas abaixo.

-- 3a) Detalhe — confira visualmente que aparecem exatamente 2 linhas, cada
--     uma com perfil = 'proprietario_admin' e ativo = true.
select id, nome, email, perfil, ativo, criado_em
from public.usuarios
where email in ('<EMAIL_DO_PROPRIETARIO_1>', '<EMAIL_DO_PROPRIETARIO_2>')
order by criado_em;

-- 3b) Contagem objetiva — o valor de proprietarios_encontrados TEM que ser
--     exatamente 2. Se vier 0 ou 1, pelo menos um e-mail não bateu com
--     nenhuma linha de auth.users (não foi criado no passo 1, ou foi
--     digitado com diferença de espaço/capitalização/domínio) — volte ao
--     passo 1, confirme o e-mail exato, e rode o passo 2 de novo antes de
--     considerar o bootstrap concluído.
select count(*) as proprietarios_encontrados
from public.usuarios
where email in ('<EMAIL_DO_PROPRIETARIO_1>', '<EMAIL_DO_PROPRIETARIO_2>')
  and perfil = 'proprietario_admin'
  and ativo = true;
