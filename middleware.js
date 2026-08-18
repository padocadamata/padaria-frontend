import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

// Gate de AUTENTICAÇÃO (não de permissão fina) a nível de servidor/edge,
// antes de qualquer página protegida renderizar. Isso resolve o pedido do
// Prompt 04 de não depender só de checagem client-side.
//
// A checagem de PERMISSÃO específica por módulo (ex.: só quem tem
// fornecedores.visualizar) continua sendo feita depois, dentro da página,
// via RequireAuth + a permissão real fica garantida de verdade pelo RLS no
// banco (mesmo que a página vazasse, a query ao Supabase não retornaria
// dado nenhum sem a permissão certa).
const ROTAS_PROTEGIDAS = [
  '/dashboard',
  '/fornecedores',
  '/producao',
  '/perfil',
  '/admin-aparencia',
  '/admin',
];

function ehRotaProtegida(pathname) {
  return ROTAS_PROTEGIDAS.some(
    (rota) => pathname === rota || pathname.startsWith(rota + '/')
  );
}

export async function middleware(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() (não getSession()) porque revalida o JWT contra o servidor de
  // auth do Supabase, em vez de só confiar no cookie local.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (ehRotaProtegida(request.nextUrl.pathname) && !user) {
    const redirectUrl = new URL('/', request.url);
    redirectUrl.searchParams.set('redirecionado', '1');
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};
