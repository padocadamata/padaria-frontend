import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createClient } from '../lib/supabase/client';

// Contexto único de autenticação/autorização, montado uma vez em
// pages/_app.js. Isso evita que cada página/componente que chama useAuth()
// (RequireAuth, MenuOpcoes, a própria página) dispare sua própria consulta
// redundante a usuarios/perfil_permissoes e seu próprio listener de sessão
// — todos compartilham o mesmo estado.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const supabase = createClient();
  const [carregando, setCarregando] = useState(true);
  const [usuarioAuth, setUsuarioAuth] = useState(null); // usuário do Supabase Auth (auth.users)
  const [perfilUsuario, setPerfilUsuario] = useState(null); // linha de public.usuarios
  const [permissoes, setPermissoes] = useState(new Set());
  const [erro, setErro] = useState(null);

  const carregarPerfil = useCallback(async (user) => {
    if (!user) {
      setPerfilUsuario(null);
      setPermissoes(new Set());
      return;
    }

    const { data: usuarioRow, error: erroUsuario } = await supabase
      .from('usuarios')
      .select('id, nome, email, perfil, ativo, ultimo_acesso_em')
      .eq('id', user.id)
      .maybeSingle();

    if (erroUsuario || !usuarioRow) {
      // Autenticado no Supabase Auth mas sem linha correspondente em
      // public.usuarios (ou inativo, bloqueado pela policy de SELECT) —
      // trata como sem permissão nenhuma, não como erro fatal de app.
      setPerfilUsuario(null);
      setPermissoes(new Set());
      return;
    }

    setPerfilUsuario(usuarioRow);

    if (!usuarioRow.ativo) {
      setPermissoes(new Set());
      return;
    }

    const { data: permissoesRows } = await supabase
      .from('perfil_permissoes')
      .select('permissao')
      .eq('perfil', usuarioRow.perfil);

    setPermissoes(new Set((permissoesRows || []).map((p) => p.permissao)));
  }, [supabase]);

  useEffect(() => {
    let ativo = true;

    async function init() {
      // getUser() revalida o token contra o Supabase, em vez de só ler o
      // cookie/localStorage local (getSession() não verifica o JWT).
      const { data: { user } } = await supabase.auth.getUser();
      if (!ativo) return;
      setUsuarioAuth(user);
      await carregarPerfil(user);
      if (ativo) setCarregando(false);
    }

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_evento, session) => {
      const user = session?.user ?? null;
      setUsuarioAuth(user);
      await carregarPerfil(user);
    });

    return () => {
      ativo = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase, carregarPerfil]);

  const signIn = useCallback(async (email, senha) => {
    setErro(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) {
      setErro(error.message);
      return { sucesso: false, erro: error.message };
    }
    await carregarPerfil(data.user);
    setUsuarioAuth(data.user);
    // Best-effort: registra o último acesso. Se falhar, não bloqueia o login.
    supabase.rpc('registrar_acesso').then(() => {}, () => {});
    return { sucesso: true };
  }, [supabase, carregarPerfil]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUsuarioAuth(null);
    setPerfilUsuario(null);
    setPermissoes(new Set());
  }, [supabase]);

  const value = useMemo(() => ({
    carregando,
    autenticado: !!usuarioAuth,
    usuarioAuth,
    perfilUsuario,
    permissoes,
    erro,
    signIn,
    signOut,
  }), [carregando, usuarioAuth, perfilUsuario, permissoes, erro, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() precisa ser usado dentro de <AuthProvider> (ver pages/_app.js).');
  }
  return ctx;
}
