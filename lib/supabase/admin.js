import { createClient } from '@supabase/supabase-js';

// Cliente Supabase com a chave service_role -- SOMENTE SERVIDOR.
//
// Importado apenas por API routes (pages/api/**), que o Next nunca envia ao
// navegador. A variável SUPABASE_SERVICE_ROLE_KEY NÃO tem o prefixo
// NEXT_PUBLIC_, então o Next também nunca a embute no bundle do cliente.
//
// Uso restrito à Auth Admin API (criar/excluir login). Nenhuma escrita em
// tabela do sistema passa por este cliente: o vínculo em public.usuarios é
// feito com a sessão do próprio administrador (RPC
// admin_vincular_usuario_auth, migration 0072), para que is_admin() e a
// auditoria valham de verdade.
export function servidorAdminConfigurado() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient() só pode ser usado no servidor.');
  }
  if (!servidorAdminConfigurado()) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.');
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
