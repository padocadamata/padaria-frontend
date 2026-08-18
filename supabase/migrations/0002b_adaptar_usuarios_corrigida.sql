-- 0002b_adaptar_usuarios_corrigida.sql
-- Adapta public.usuarios para Supabase Auth.
-- Substitui operacionalmente a 0002_adaptar_usuarios.sql, que não deve ser executada.

BEGIN;

-- ============================================================
-- 1. REMOVER SENHA DO MODELO LEGADO
-- ============================================================

ALTER TABLE public.usuarios
DROP COLUMN IF EXISTS senha;


-- ============================================================
-- 2. GARANTIR PK/UNIQUE EM usuarios.id
-- ============================================================
-- O banco real já possui usuarios_pkey PRIMARY KEY (id).
-- Este bloco apenas protege a migration caso seja executada em outro
-- ambiente onde a unicidade de id não exista.

DO $$
DECLARE
    v_existe boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = 'public.usuarios'::regclass
          AND c.contype IN ('p', 'u')
          AND c.conkey = ARRAY[
              (
                  SELECT attnum
                  FROM pg_attribute
                  WHERE attrelid = 'public.usuarios'::regclass
                    AND attname = 'id'
              )
          ]
    )
    INTO v_existe;

    IF NOT v_existe THEN
        ALTER TABLE public.usuarios
        ADD CONSTRAINT usuarios_id_key_migracao UNIQUE (id);
    END IF;
END $$;


-- ============================================================
-- 3. REMOVER CHECK LEGADO DE PERFIL
-- ============================================================
-- Constraint confirmada no banco antigo:
-- usuarios_perfil_check
--
-- Os perfis passam a ser controlados pelo catálogo public.perfis.

ALTER TABLE public.usuarios
DROP CONSTRAINT IF EXISTS usuarios_perfil_check;


-- ============================================================
-- 4. GARANTIR UNIQUE EM usuarios.email
-- ============================================================
-- O banco real já possui usuarios_email_key UNIQUE(email).
-- Só cria uma constraint de fallback se nenhuma UNIQUE/PK equivalente
-- existir sobre email.

DO $$
DECLARE
    v_existe boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = 'public.usuarios'::regclass
          AND c.contype IN ('p', 'u')
          AND c.conkey = ARRAY[
              (
                  SELECT attnum
                  FROM pg_attribute
                  WHERE attrelid = 'public.usuarios'::regclass
                    AND attname = 'email'
              )
          ]
    )
    INTO v_existe;

    IF NOT v_existe THEN
        ALTER TABLE public.usuarios
        ADD CONSTRAINT usuarios_email_key_migracao UNIQUE (email);
    END IF;
END $$;


-- ============================================================
-- 5. VINCULAR usuarios.id AO SUPABASE AUTH
-- ============================================================

DO $$
DECLARE
    v_existe boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = 'public.usuarios'::regclass
          AND c.contype = 'f'
          AND c.confrelid = 'auth.users'::regclass
          AND c.conkey = ARRAY[
              (
                  SELECT attnum
                  FROM pg_attribute
                  WHERE attrelid = 'public.usuarios'::regclass
                    AND attname = 'id'
              )
          ]
          AND c.confkey = ARRAY[
              (
                  SELECT attnum
                  FROM pg_attribute
                  WHERE attrelid = 'auth.users'::regclass
                    AND attname = 'id'
              )
          ]
    )
    INTO v_existe;

    IF NOT v_existe THEN
        ALTER TABLE public.usuarios
        ADD CONSTRAINT usuarios_auth_id_fkey
        FOREIGN KEY (id)
        REFERENCES auth.users(id)
        ON DELETE CASCADE;
    END IF;
END $$;


-- ============================================================
-- 6. VINCULAR usuarios.perfil AO CATÁLOGO public.perfis
-- ============================================================

DO $$
DECLARE
    v_existe boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = 'public.usuarios'::regclass
          AND c.contype = 'f'
          AND c.confrelid = 'public.perfis'::regclass
          AND c.conkey = ARRAY[
              (
                  SELECT attnum
                  FROM pg_attribute
                  WHERE attrelid = 'public.usuarios'::regclass
                    AND attname = 'perfil'
              )
          ]
          AND c.confkey = ARRAY[
              (
                  SELECT attnum
                  FROM pg_attribute
                  WHERE attrelid = 'public.perfis'::regclass
                    AND attname = 'nome'
              )
          ]
    )
    INTO v_existe;

    IF NOT v_existe THEN
        ALTER TABLE public.usuarios
        ADD CONSTRAINT usuarios_perfil_nome_fkey
        FOREIGN KEY (perfil)
        REFERENCES public.perfis(nome);
    END IF;
END $$;


-- ============================================================
-- 7. ÍNDICE PARA PERFIL
-- ============================================================

CREATE INDEX IF NOT EXISTS usuarios_perfil_idx
ON public.usuarios (perfil);


-- ============================================================
-- 8. ÚLTIMO ACESSO
-- ============================================================

ALTER TABLE public.usuarios
ADD COLUMN IF NOT EXISTS ultimo_acesso_em timestamptz;


-- ============================================================
-- 9. FUNÇÃO PARA REGISTRAR ÚLTIMO ACESSO
-- ============================================================

CREATE OR REPLACE FUNCTION public.registrar_acesso()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.usuarios
       SET ultimo_acesso_em = now()
     WHERE id = auth.uid();
END;
$$;


COMMENT ON FUNCTION public.registrar_acesso() IS
'Atualiza ultimo_acesso_em somente para o usuario autenticado atual. Nao recebe parametros e nao concede UPDATE geral em public.usuarios.';


-- Menor privilégio:
REVOKE EXECUTE ON FUNCTION public.registrar_acesso() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.registrar_acesso() FROM anon;
GRANT EXECUTE ON FUNCTION public.registrar_acesso() TO authenticated;


COMMIT;


-- ============================================================
-- ROLLBACK MANUAL — SOMENTE DOCUMENTAÇÃO
-- ============================================================
-- ATENÇÃO:
-- - usuarios_pkey NÃO deve ser removida.
-- - usuarios_email_key NÃO deve ser removida.
-- - o antigo usuarios_perfil_check não é restaurado automaticamente.
-- - a coluna senha não é recriada neste rollback.
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.registrar_acesso();
-- ALTER TABLE public.usuarios DROP COLUMN IF EXISTS ultimo_acesso_em;
-- DROP INDEX IF EXISTS public.usuarios_perfil_idx;
-- ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_perfil_nome_fkey;
-- ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_auth_id_fkey;
-- ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_email_key_migracao;
-- ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_id_key_migracao;
-- COMMIT;