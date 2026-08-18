import { createServerClient, serializeCookieHeader } from '@supabase/ssr';

// Cliente Supabase para uso em getServerSideProps / API routes do Pages
// Router (não existe next/headers fora do App Router, então os cookies vêm
// de context.req / context.res).
export function createServerPropsClient(context) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_KEY,
    {
      cookies: {
        getAll() {
          return Object.keys(context.req.cookies || {}).map((name) => ({
            name,
            value: context.req.cookies[name] || '',
          }));
        },
        setAll(cookiesToSet) {
          context.res.setHeader(
            'Set-Cookie',
            cookiesToSet.map(({ name, value, options }) =>
              serializeCookieHeader(name, value, options)
            )
          );
        },
      },
    }
  );
}
