import { createBrowserClient } from '@supabase/ssr';

let browserClient;

// Cliente Supabase único para uso no navegador (componentes/páginas).
// Usa @supabase/ssr para que a sessão fique também em cookie (não só em
// localStorage), permitindo que middleware.js e getServerSideProps
// enxerguem a sessão no servidor.
export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_KEY
    );
  }
  return browserClient;
}
