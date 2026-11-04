import { NextResponse } from 'next/server';

// HOMOLOGAÇÃO LOCAL -- substitui middleware.js SÓ na cópia temporária: sem
// Supabase, não há sessão a validar no servidor (o login é simulado).
export function middleware() {
  return NextResponse.next();
}
