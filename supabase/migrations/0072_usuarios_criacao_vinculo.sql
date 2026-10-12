-- 0072_usuarios_criacao_vinculo.sql
-- Criação de usuários pelo próprio sistema (Admin > Usuários), sem SQL
-- manual e sem abrir o painel do Supabase.
--
-- Contexto (diagnóstico de 2026-10-09): um login criado só no
-- Authentication, sem a linha correspondente em public.usuarios, entra no
-- sistema mas fica sem nenhuma permissão (useAuth trata a ausência da linha
-- como "sem acesso"). Até aqui o vínculo era um INSERT manual (template
-- 0006). Esta migration cria o vínculo como operação administrativa
-- validada e auditada.
--
-- Arquitetura (decisão desta frente):
--   * O login (auth.users) é criado pela rota server-side
--     pages/api/admin/usuarios/criar.js, que é a ÚNICA peça que usa a
--     service_role -- só para a Auth Admin API (createUser/deleteUser).
--   * O vínculo (public.usuarios + auditoria) é feito por
--     admin_vincular_usuario_auth(), chamada com a sessão do PRÓPRIO
--     administrador (nunca com service_role): is_admin() é checado aqui no
--     banco e a autoria em logs_auditoria vem de auth.uid() do admin.
--   * Logins que ficaram sem vínculo (fluxo antigo, ou falha de
--     compensação) aparecem em admin_listar_auth_sem_vinculo() e podem ser
--     vinculados pela mesma função, pela tela.
--
-- Por que NÃO um trigger em auth.users: nome e perfil são dados do
-- sistema, não do Auth. Um trigger teria de adivinhar perfil (risco de
-- acesso indevido) ou ler user_metadata (que, com signup aberto, é
-- controlado pelo próprio usuário -- autopromoção). Ver relatório da frente.
--
-- ESCOPO: só 2 funções novas + grants. NENHUMA tabela, coluna, policy ou
-- trigger nova; NENHUMA alteração em is_admin()/has_permissao()/RLS;
-- NENHUM dado é inserido/alterado pela aplicação desta migration.
--
-- SECURITY DEFINER é necessário para ler auth.users (authenticated não
-- tem acesso a esse schema). Por isso cada função começa exigindo
-- is_admin() explicitamente e usa search_path vazio com tudo
-- schema-qualificado (mesmo padrão de 0003/0004).
--
-- Pré-requisitos: 0001..0071 aplicadas.

BEGIN;

-- Guarda de ambiente: aborta (nada é criado) se qualquer objeto/coluna
-- usado pelas funções não existir. Necessário porque corpo plpgsql só é
-- validado na EXECUÇÃO -- sem esta guarda, um ambiente inesperado
-- aceitaria a migration e só falharia depois, na tela.
DO $$
BEGIN
  IF to_regprocedure('public.is_admin()') IS NULL
     OR to_regclass('public.usuarios') IS NULL
     OR to_regclass('public.perfis') IS NULL
     OR to_regclass('public.logs_auditoria') IS NULL
     OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION '0072 abortada: is_admin/usuarios/perfis/logs_auditoria/auth.users nao encontrados.';
  END IF;

  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid = to_regclass('auth.users') AND attnum > 0 AND NOT attisdropped
         AND attname IN ('id', 'email', 'created_at', 'email_confirmed_at', 'last_sign_in_at')) <> 5
     OR (SELECT count(*) FROM pg_attribute
       WHERE attrelid = to_regclass('public.usuarios') AND attnum > 0 AND NOT attisdropped
         AND attname IN ('id', 'nome', 'email', 'perfil', 'ativo')) <> 5
     OR (SELECT count(*) FROM pg_attribute
       WHERE attrelid = to_regclass('public.perfis') AND attnum > 0 AND NOT attisdropped
         AND attname IN ('nome', 'ativo')) <> 2
     OR (SELECT count(*) FROM pg_attribute
       WHERE attrelid = to_regclass('public.logs_auditoria') AND attnum > 0 AND NOT attisdropped
         AND attname IN ('entidade', 'registro_id', 'acao', 'campo', 'valor_anterior', 'valor_novo')) <> 6 THEN
    RAISE EXCEPTION '0072 abortada: colunas esperadas ausentes em auth.users/usuarios/perfis/logs_auditoria.';
  END IF;

  -- Sem este trigger (0004) a auditoria não identificaria o admin.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = to_regclass('public.logs_auditoria')
       AND tgname = 'logs_auditoria_preencher_usuario_trigger'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '0072 abortada: trigger logs_auditoria_preencher_usuario_trigger (0004) ausente.';
  END IF;
END $$;

-- ============================================================
-- 1. admin_vincular_usuario_auth(p_usuario_id, p_nome, p_perfil)
-- ============================================================
-- Cria a linha de public.usuarios para um login JÁ existente em
-- auth.users. O e-mail NÃO é recebido do cliente: vem de auth.users
-- (fonte de verdade do login), normalizado em minúsculas -- impossível
-- nascer divergente. Nasce sempre ativo. Falha alto (exceção, nada
-- gravado) se: quem chama não é admin; nome vazio/longo; login inexistente
-- ou sem e-mail; login já vinculado; e-mail já usado por outro usuário do
-- sistema; perfil inexistente/inativo.
create or replace function public.admin_vincular_usuario_auth(
  p_usuario_id uuid,
  p_nome text,
  p_perfil text
)
returns public.usuarios
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome    text := nullif(btrim(coalesce(p_nome, '')), '');
  v_email   text;
  v_usuario public.usuarios%rowtype;
begin
  if not (select public.is_admin()) then
    raise exception using errcode = '42501',
      message = 'admin_vincular_usuario_auth: requer administrador (proprietario_admin).';
  end if;

  if p_usuario_id is null then
    raise exception 'admin_vincular_usuario_auth: usuario_id obrigatorio.';
  end if;

  if v_nome is null then
    raise exception 'admin_vincular_usuario_auth: nome obrigatorio.';
  end if;

  if char_length(v_nome) > 120 then
    raise exception 'admin_vincular_usuario_auth: nome com mais de 120 caracteres.';
  end if;

  select nullif(lower(btrim(au.email::text)), '')
    into v_email
    from auth.users au
   where au.id = p_usuario_id;

  if not found then
    raise exception 'admin_vincular_usuario_auth: login % nao encontrado no Authentication.', p_usuario_id;
  end if;

  if v_email is null then
    raise exception 'admin_vincular_usuario_auth: login % nao tem e-mail.', p_usuario_id;
  end if;

  if exists (select 1 from public.usuarios u where u.id = p_usuario_id) then
    raise exception 'admin_vincular_usuario_auth: login % ja esta vinculado em usuarios.', p_usuario_id;
  end if;

  if exists (select 1 from public.usuarios u where lower(u.email) = v_email) then
    raise exception 'admin_vincular_usuario_auth: e-mail % ja usado por outro usuario do sistema.', v_email;
  end if;

  if not exists (select 1 from public.perfis pf where pf.nome = p_perfil and pf.ativo = true) then
    raise exception 'admin_vincular_usuario_auth: perfil "%" nao existe ou nao esta ativo.', p_perfil;
  end if;

  insert into public.usuarios (id, nome, email, perfil, ativo)
  values (p_usuario_id, v_nome, v_email, p_perfil, true)
  returning * into v_usuario;

  -- Autoria (usuario_id/nome/email) preenchida pelo trigger
  -- logs_auditoria_preencher_usuario (0004) a partir de auth.uid() do admin.
  insert into public.logs_auditoria
    (entidade, registro_id, acao, campo, valor_anterior, valor_novo)
  values
    ('usuario', p_usuario_id::text, 'criou_vinculo', 'perfil', null, p_perfil);

  return v_usuario;
end;
$$;

comment on function public.admin_vincular_usuario_auth(uuid, text, text) is
  'Vincula um login existente de auth.users a public.usuarios (nome, perfil ativo, ativo=true), com o e-mail copiado de auth.users em minusculas. Exige is_admin(); grava logs_auditoria (acao criou_vinculo) na mesma transacao. SECURITY DEFINER so para ler auth.users. Migration 0072.';

revoke execute on function public.admin_vincular_usuario_auth(uuid, text, text) from public;
revoke execute on function public.admin_vincular_usuario_auth(uuid, text, text) from anon;
-- service_role não precisa (a rota chama com a sessão do admin; sem
-- auth.uid() a função recusaria de qualquer forma) -- menor privilégio.
revoke execute on function public.admin_vincular_usuario_auth(uuid, text, text) from service_role;
grant execute on function public.admin_vincular_usuario_auth(uuid, text, text) to authenticated;

-- ============================================================
-- 2. admin_listar_auth_sem_vinculo()
-- ============================================================
-- Logins do Authentication que ainda não têm linha em public.usuarios
-- (o "caso Viviane"). Só leitura; exige is_admin().
create or replace function public.admin_listar_auth_sem_vinculo()
returns table (
  id uuid,
  email text,
  criado_em timestamptz,
  email_confirmado_em timestamptz,
  ultimo_login_em timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception using errcode = '42501',
      message = 'admin_listar_auth_sem_vinculo: requer administrador (proprietario_admin).';
  end if;

  return query
    select au.id,
           au.email::text,
           au.created_at,
           au.email_confirmed_at,
           au.last_sign_in_at
      from auth.users au
     where not exists (select 1 from public.usuarios u where u.id = au.id)
     order by au.created_at desc;
end;
$$;

comment on function public.admin_listar_auth_sem_vinculo() is
  'Lista logins de auth.users sem linha em public.usuarios (id, email, datas). Exige is_admin(). Migration 0072.';

revoke execute on function public.admin_listar_auth_sem_vinculo() from public;
revoke execute on function public.admin_listar_auth_sem_vinculo() from anon;
revoke execute on function public.admin_listar_auth_sem_vinculo() from service_role;
grant execute on function public.admin_listar_auth_sem_vinculo() to authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (execute manualmente se precisar desfazer esta migration)
-- ============================================================
-- Seguro: só remove as 2 funções. Linhas de public.usuarios já criadas
-- por elas permanecem (são usuários reais) e a auditoria não é tocada.
-- Depois do rollback, a criação pela tela passa a falhar de forma segura
-- (a rota desfaz o login criado se o vínculo não existir).
-- BEGIN;
-- drop function if exists public.admin_listar_auth_sem_vinculo();
-- drop function if exists public.admin_vincular_usuario_auth(uuid, text, text);
-- COMMIT;
